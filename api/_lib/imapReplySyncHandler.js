import tls from 'node:tls';
import zlib from 'node:zlib';
import { supabase } from './supabase.js';
import { authorizeCronOrAdmin } from './cronAuth.js';
import { DEFAULT_EMAIL_RECIPIENTS, DEFAULT_SANDBOX_EMAIL } from './smtpMailer.js';

function decodeXmlEntities(str) {
  return String(str || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&');
}

function colLettersToZeroIndex(letters) {
  let idx = 0;
  for (let i = 0; i < letters.length; i += 1) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(0, idx - 1);
}

function excelSerialToYmd(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return '';
  const utcMs = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(utcMs);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function normalizeYmdInput(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{5}(?:\.\d+)?$/.test(s)) {
    const converted = excelSerialToYmd(s);
    if (converted) return converted;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Extracts entries from a ZIP/XLSX Buffer using the ZIP Central Directory
 * so both Stored (method 0) and Deflate-compressed (method 8, Excel/Sheets/Calc) workbooks parse cleanly.
 */
export function parseZipEntriesFromBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) {
    throw new Error('Invalid XLSX/ZIP buffer.');
  }

  let eocdOffset = -1;
  const minOffset = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minOffset; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('ZIP End-Of-Central-Directory signature not found.');
  }

  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const entries = new Map();

  let offset = cdOffset;
  for (let idx = 0; idx < totalEntries && offset + 46 <= buf.length; idx += 1) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');

    if (localHeaderOffset + 30 <= buf.length && buf.readUInt32LE(localHeaderOffset) === 0x04034b50) {
      const lfhNameLen = buf.readUInt16LE(localHeaderOffset + 26);
      const lfhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
      const slice = buf.subarray(dataStart, dataStart + compSize);
      let rawBytes;
      if (method === 0) {
        rawBytes = slice;
      } else if (method === 8) {
        rawBytes = zlib.inflateRawSync(slice);
      } else {
        rawBytes = slice;
      }
      entries.set(name, rawBytes);
    }

    offset += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

function parseSharedStringsXml(xmlText) {
  if (!xmlText) return [];
  const strings = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match;
  while ((match = siRe.exec(xmlText)) !== null) {
    const inner = match[1];
    const tParts = [];
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tMatch;
    while ((tMatch = tRe.exec(inner)) !== null) {
      tParts.push(decodeXmlEntities(tMatch[1]));
    }
    strings.push(tParts.join(''));
  }
  return strings;
}

function parseWorksheetRows(sheetXml, sharedStrings = []) {
  const rows = [];
  const rowRe = /<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(sheetXml)) !== null) {
    const rowNumber = parseInt(rowMatch[1], 10);
    const rowInner = rowMatch[2];
    const rowArr = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowInner)) !== null) {
      const attrs = cellMatch[1] || '';
      const body = cellMatch[2] || '';
      const refM = /\br="([A-Z]+)\d+"/.exec(attrs);
      const colIdx = refM ? colLettersToZeroIndex(refM[1]) : rowArr.length;
      const typeM = /\bt="([^"]+)"/.exec(attrs);
      const cellType = typeM ? typeM[1] : '';

      let value = '';
      if (cellType === 'inlineStr') {
        const isParts = [];
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let tm;
        while ((tm = tRe.exec(body)) !== null) {
          isParts.push(decodeXmlEntities(tm[1]));
        }
        value = isParts.join('');
      } else {
        const vM = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
        const rawVal = vM ? decodeXmlEntities(vM[1]) : '';
        if (cellType === 's') {
          const sIdx = parseInt(rawVal, 10);
          value = Number.isFinite(sIdx) && sharedStrings[sIdx] !== undefined ? sharedStrings[sIdx] : '';
        } else if (cellType === 'b') {
          value = rawVal === '1' ? 'TRUE' : 'FALSE';
        } else {
          value = rawVal;
        }
      }

      rowArr[colIdx] = value;
    }
    rows[rowNumber - 1] = rowArr;
  }
  return Array.from({ length: rows.length }, (_, idx) => (Array.isArray(rows[idx]) ? rows[idx] : []));
}

/**
 * Parses an edited or original RMA Alert mirror `.xlsx` buffer into structured field + manifest updates.
 */
export function extractRmaUpdatesFromXlsxBuffer(buffer, { subjectHint = '' } = {}) {
  const entries = parseZipEntriesFromBuffer(buffer);
  const sharedStrings = entries.has('xl/sharedStrings.xml')
    ? parseSharedStringsXml(entries.get('xl/sharedStrings.xml').toString('utf8'))
    : [];

  let sheetEntryName = 'xl/worksheets/sheet1.xml';
  if (!entries.has(sheetEntryName)) {
    for (const key of entries.keys()) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(key)) {
        sheetEntryName = key;
        break;
      }
    }
  }
  if (!entries.has(sheetEntryName)) {
    throw new Error('Worksheet XML not found inside uploaded .xlsx workbook.');
  }

  const rows = parseWorksheetRows(entries.get(sheetEntryName).toString('utf8'), sharedStrings);
  const fieldMap = {};
  let manifestHeaderRowIdx = -1;
  let fieldColIdx = -1;
  let valueColIdx = -1;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const trimmedCells = Array.from(row, (c) => String(c ?? '').trim());
    if (!trimmedCells.some(Boolean)) continue;

    if (trimmedCells.some((c) => /^MANIFEST LINE ITEMS/i.test(c))) {
      manifestHeaderRowIdx = i + 1;
      break;
    }

    const detectedFieldCol = trimmedCells.findIndex((c) => /^field$/i.test(c));
    const detectedValueCol = trimmedCells.findIndex((c) => /^value$/i.test(c));
    if (detectedFieldCol >= 0 && detectedValueCol >= 0) {
      fieldColIdx = detectedFieldCol;
      valueColIdx = detectedValueCol;
      continue;
    }

    if (trimmedCells.some((c) => /^(?:\[TEST\]\s*)?WHOLESALE RMA|2-WAY EMAIL/i.test(c))) continue;

    const effFieldIdx = fieldColIdx >= 0 ? fieldColIdx : 0;
    const effValueIdx = valueColIdx >= 0 ? valueColIdx : 1;
    const fieldName = String(row[effFieldIdx] ?? '').trim();
    if (!fieldName || /^(?:serial\s*no\.?|field|sn)$/i.test(fieldName)) continue;

    const fieldVal = row[effValueIdx] !== undefined && row[effValueIdx] !== null ? String(row[effValueIdx]).trim() : '';
    fieldMap[fieldName.toLowerCase()] = fieldVal;
  }

  const manifestUpdates = [];
  if (manifestHeaderRowIdx >= 0 && manifestHeaderRowIdx < rows.length) {
    const headerRow = Array.from(rows[manifestHeaderRowIdx] || [], (h) => String(h ?? '').trim().toLowerCase());
    const colMap = {
      line: headerRow.findIndex((h) => h && (h.includes('serial') || h.includes('line') || h === 'sn')),
      barcode: headerRow.findIndex((h) => h.includes('barcode')),
      code: headerRow.findIndex((h) => h.includes('sku')),
      name: headerRow.findIndex((h) => h.includes('description') || h.includes('product')),
      quantity: headerRow.findIndex((h) => h.includes('qty') || h.includes('quantity')),
      unit_name: headerRow.findIndex((h) => h.includes('unit')),
      expiry_date: headerRow.findIndex((h) => h.includes('expiry')),
      reason: headerRow.findIndex((h) => h.includes('reason')),
      explanation: headerRow.findIndex((h) => h.includes('explanation'))
    };

    for (let r = manifestHeaderRowIdx + 1; r < rows.length; r += 1) {
      const row = rows[r] || [];
      if (!row.some((c) => String(c ?? '').trim())) continue;
      manifestUpdates.push({
        lineIndex: colMap.line >= 0 ? Math.max(0, (parseInt(row[colMap.line], 10) || 1) - 1) : manifestUpdates.length,
        barcode: colMap.barcode >= 0 ? String(row[colMap.barcode] ?? '').trim() : '',
        code: colMap.code >= 0 ? String(row[colMap.code] ?? '').trim() : '',
        name: colMap.name >= 0 ? String(row[colMap.name] ?? '').trim() : '',
        quantity: colMap.quantity >= 0 ? Number(row[colMap.quantity]) : undefined,
        unit_name: colMap.unit_name >= 0 ? String(row[colMap.unit_name] ?? '').trim() : '',
        expiry_date: colMap.expiry_date >= 0 ? normalizeYmdInput(row[colMap.expiry_date]) : null,
        reason: colMap.reason >= 0 ? String(row[colMap.reason] ?? '').trim() : '',
        explanation: colMap.explanation >= 0 ? String(row[colMap.explanation] ?? '').trim() : ''
      });
    }
  }

  const getField = (...keys) => {
    for (const k of keys) {
      const v = fieldMap[k.toLowerCase()];
      if (v !== undefined) return v;
    }
    return undefined;
  };

  const rmaNumber = String(getField('RMA Number', 'rma_number') || '').trim().toUpperCase();
  const testModeVal = String(getField('Test Mode', 'is_test') || '').trim().toLowerCase();
  const emailSubjectVal = String(subjectHint || getField('Email Subject', 'Subject') || '').trim();
  const hasTestSubjectTag = /\[TEST\]/i.test(emailSubjectVal);
  const isTestHint = /^rma-test-/i.test(rmaNumber) || testModeVal.startsWith('yes') || testModeVal === 'true' || hasTestSubjectTag;

  const patch = {
    store_branch: getField('Store / Branch'),
    supplier_name: getField('Supplier / Vendor Name', 'Supplier / Vendor'),
    supplier_email_to: getField('Supplier Email (To)'),
    supplier_email_cc: getField('Supplier Email (CC)'),
    code: getField('Assigned SKU', 'SKU'),
    name: getField('Product Description', 'Product Name'),
    quantity: getField('Quantity'),
    unit_name: getField('Packaging Unit', 'Unit'),
    price: getField('Unit Price (PHP)', 'Price'),
    price_with_vat: getField('Price w/ VAT (PHP)'),
    reason: getField('Defect / Return Reason'),
    explanation: getField('Explanation / Notes', 'Explanation'),
    si_number: getField('Sales Invoice (SI) #'),
    dr_number: getField('Delivery Receipt (DR) #'),
    po_number: getField('Purchase Order (PO) #'),
    batch_lot_number: getField('Batch / Lot #'),
    expiry_date: getField('Expiry Date (YYYY-MM-DD)'),
    warehouse_location: getField('Warehouse Location'),
    ae_name: getField('Account Executive (AE)'),
    ae_email: getField('AE Email')
  };

  return {
    rmaNumber,
    isTestHint,
    fieldMap,
    patch,
    manifestUpdates
  };
}

function cleanEmailAddr(raw) {
  const m = String(raw || '').match(/<([^>]+)>/);
  const candidate = (m ? m[1] : String(raw || '')).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : '';
}

function extractAuthorizedEmailsFromSettings(settingsRows = []) {
  const liveEmailsSet = new Set([
    DEFAULT_EMAIL_RECIPIENTS.toEmail.toLowerCase(),
    ...DEFAULT_EMAIL_RECIPIENTS.baseCcList.map((e) => e.toLowerCase())
  ]);
  const testEmailsSet = new Set([
    String(DEFAULT_SANDBOX_EMAIL || 'mgan@pingconmarketing.com').trim().toLowerCase()
  ]);

  const addEmailsToSet = (targetSet, raw) => {
    if (!raw) return;
    const arr = Array.isArray(raw) ? raw : String(raw).split(/[,;\s]+/);
    arr.forEach((entry) => {
      const c = cleanEmailAddr(entry);
      if (c) targetSet.add(c);
    });
  };

  for (const row of settingsRows) {
    if (!row?.key) continue;
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      if (row.key === 'email_recipients' && parsed && typeof parsed === 'object') {
        addEmailsToSet(liveEmailsSet, parsed.toList);
        addEmailsToSet(liveEmailsSet, parsed.toEmail);
        addEmailsToSet(liveEmailsSet, parsed.baseCcList);
      }
      if (row.key === 'email_recipients_by_type' && parsed && typeof parsed === 'object') {
        Object.values(parsed).forEach((prof) => {
          if (!prof || typeof prof !== 'object') return;
          addEmailsToSet(liveEmailsSet, prof.toList);
          addEmailsToSet(liveEmailsSet, prof.toEmail);
          addEmailsToSet(liveEmailsSet, prof.ccList);
        });
      }
      if (row.key === 'test_sandbox_email' && parsed) {
        addEmailsToSet(testEmailsSet, parsed);
      }
      if (row.key === 'test_email_recipients' && parsed && typeof parsed === 'object') {
        addEmailsToSet(testEmailsSet, parsed.toList);
        addEmailsToSet(testEmailsSet, parsed.toEmail);
        addEmailsToSet(testEmailsSet, parsed.baseCcList);
        addEmailsToSet(testEmailsSet, parsed.ccList);
      }
      if (row.key === 'test_email_recipients_by_type' && parsed && typeof parsed === 'object') {
        Object.values(parsed).forEach((prof) => {
          if (!prof || typeof prof !== 'object') return;
          addEmailsToSet(testEmailsSet, prof.toList);
          addEmailsToSet(testEmailsSet, prof.toEmail);
          addEmailsToSet(testEmailsSet, prof.ccList);
        });
      }
    } catch {}
  }
  return { liveEmailsSet, testEmailsSet };
}

function isSenderAuthorizedForReport(senderEmail, report, adminEmailsSet, { liveEmailsSet, testEmailsSet } = {}) {
  const clean = cleanEmailAddr(senderEmail);
  if (!clean) return false;
  if (adminEmailsSet?.has(clean)) return true;
  if (liveEmailsSet?.has(clean)) return true;
  const reportIsTest = Boolean(
    report?.ai_document_metadata?.is_test ||
    report?.ai_document_metadata?.test_mode ||
    /^RMA-TEST-/i.test(report?.rma_number || '') ||
    String(report?.notes || '').includes('[TEST_MODE]')
  );
  if (reportIsTest && testEmailsSet?.has(clean)) return true;
  if (report?.ae_email && cleanEmailAddr(report.ae_email) === clean) return true;
  if (report?.reporter_contact && cleanEmailAddr(report.reporter_contact) === clean) return true;
  const domain = clean.split('@')[1] || '';
  return ['pingconmarketing.com', 'a2z2go.net', 'keysysincorporated.com'].includes(domain);
}

/**
 * Applies parsed `.xlsx` reply changes onto Supabase `rma_reports` + `supplier_directory_store`.
 */
export async function applyRmaXlsxUpdates({
  buffer,
  rmaNumberHint = '',
  senderEmail = '',
  subjectHint = '',
  sourceLabel = 'manual_upload',
  bypassSenderCheck = false
}) {
  const parsed = extractRmaUpdatesFromXlsxBuffer(buffer, { subjectHint });
  const targetRma = parsed.rmaNumber || String(rmaNumberHint || '').trim().toUpperCase();
  if (!targetRma || !/^RMA-(?:TEST-)?\d{4}-/i.test(targetRma)) {
    throw new Error(`Invalid or missing RMA Number in uploaded .xlsx (${targetRma || 'blank'}).`);
  }

  const [{ data: matchedRows, error: fetchErr }, { data: adminRows }, { data: settingsRows }] = await Promise.all([
    supabase.from('rma_reports').select('*').ilike('rma_number', targetRma).limit(5),
    supabase.from('admin_users').select('email, is_active'),
    supabase
      .from('rma_settings')
      .select('key, value')
      .in('key', [
        'email_recipients',
        'email_recipients_by_type',
        'test_email_recipients',
        'test_email_recipients_by_type',
        'test_sandbox_email',
        'supplier_directory_store'
      ])
  ]);

  if (fetchErr) throw new Error(`Failed loading target RMA ${targetRma}: ${fetchErr.message}`);
  const existing = (matchedRows || []).find((r) => String(r.rma_number || '').toUpperCase() === targetRma && !r.parent_rma_id) || matchedRows?.[0];
  if (!existing) {
    throw new Error(`RMA record ${targetRma} not found in database.`);
  }

  const existingIsTest = Boolean(existing?.ai_document_metadata?.is_test || existing?.ai_document_metadata?.test_mode || /^RMA-TEST-/i.test(existing.rma_number || '') || String(existing.notes || '').includes('[TEST_MODE]'));
  if (parsed.isTestHint && !existingIsTest) {
    throw new Error(`Test Mode worksheet cannot modify Live Production RMA ${targetRma}.`);
  }
  if (!parsed.isTestHint && existingIsTest) {
    throw new Error(`Live worksheet cannot modify Test Mode Sandbox RMA ${targetRma}.`);
  }

  const adminSet = new Set(
    (adminRows || [])
      .filter((a) => a.is_active !== false && a.email)
      .map((a) => cleanEmailAddr(a.email))
      .filter(Boolean)
  );
  const authorizedSets = extractAuthorizedEmailsFromSettings(settingsRows || []);

  if (!bypassSenderCheck && senderEmail && !isSenderAuthorizedForReport(senderEmail, existing, adminSet, authorizedSets)) {
    return {
      skipped: true,
      reason: 'UNAUTHORIZED_SENDER',
      rmaNumber: targetRma,
      senderEmail
    };
  }

  const patch = parsed.patch || {};
  const updates = {};
  const changedFields = [];
  const compareAssignStr = (col, incoming, allowClear = false) => {
    if (incoming === undefined) return;
    const clean = String(incoming).trim();
    if (!clean && !allowClear) return;
    const prev = String(existing[col] ?? '').trim();
    if (clean !== prev) {
      updates[col] = clean || null;
      changedFields.push(col);
    }
  };

  compareAssignStr('store_branch', patch.store_branch);
  compareAssignStr('supplier_name', patch.supplier_name);
  compareAssignStr('code', patch.code);
  compareAssignStr('name', patch.name);
  compareAssignStr('unit_name', patch.unit_name);
  compareAssignStr('reason', patch.reason);
  compareAssignStr('explanation', patch.explanation);
  compareAssignStr('si_number', patch.si_number);
  compareAssignStr('dr_number', patch.dr_number);
  compareAssignStr('po_number', patch.po_number);
  compareAssignStr('batch_lot_number', patch.batch_lot_number);
  compareAssignStr('warehouse_location', patch.warehouse_location);
  compareAssignStr('ae_name', patch.ae_name);
  compareAssignStr('ae_email', patch.ae_email);

  if (patch.dr_number !== undefined && String(patch.dr_number).trim()) {
    const cleanDr = String(patch.dr_number).trim();
    if (cleanDr !== String(existing.invoice_dr_number || '').trim()) {
      updates.invoice_dr_number = cleanDr;
    }
  }

  if (patch.expiry_date !== undefined && String(patch.expiry_date).trim()) {
    const ymd = normalizeYmdInput(patch.expiry_date);
    if (ymd && ymd !== String(existing.expiry_date || '').slice(0, 10)) {
      updates.expiry_date = ymd;
      changedFields.push('expiry_date');
    }
  }

  const assignNum = (col, rawVal) => {
    if (rawVal === undefined || String(rawVal).trim() === '') return;
    const parsedNum = Number(String(rawVal).replace(/[,\s]/g, ''));
    if (Number.isFinite(parsedNum) && parsedNum >= 0 && parsedNum !== Number(existing[col] ?? 0)) {
      updates[col] = parsedNum;
      changedFields.push(col);
    }
  };
  assignNum('quantity', patch.quantity);
  assignNum('price', patch.price);
  assignNum('price_with_vat', patch.price_with_vat);

  const prevMeta = (existing.ai_document_metadata && typeof existing.ai_document_metadata === 'object')
    ? existing.ai_document_metadata
    : {};
  const prevFollowUp = (prevMeta.follow_up && typeof prevMeta.follow_up === 'object') ? prevMeta.follow_up : {};
  const nextFollowUp = { ...prevFollowUp };
  let metaChanged = false;

  if (patch.supplier_email_to !== undefined && String(patch.supplier_email_to).trim() !== String(prevFollowUp.supplier_email_to || '').trim()) {
    if (String(patch.supplier_email_to).trim()) {
      nextFollowUp.supplier_email_to = String(patch.supplier_email_to).trim();
      changedFields.push('supplier_email_to');
      metaChanged = true;
    }
  }
  if (patch.supplier_email_cc !== undefined && String(patch.supplier_email_cc).trim() !== String(prevFollowUp.supplier_email_cc || '').trim()) {
    if (String(patch.supplier_email_cc).trim()) {
      nextFollowUp.supplier_email_cc = String(patch.supplier_email_cc).trim();
      changedFields.push('supplier_email_cc');
      metaChanged = true;
    }
  }

  // Apply Manifest Line Item edits if present
  if (parsed.manifestUpdates.length > 0 && Array.isArray(existing.items) && existing.items.length > 0) {
    const nextItems = existing.items.map((item, idx) => {
      const m = parsed.manifestUpdates[idx];
      if (!m) return item;
      return {
        ...item,
        code: m.code || item.code,
        sku: m.code || item.sku,
        name: m.name || item.name,
        productName: m.name || item.productName,
        quantity: Number.isFinite(m.quantity) && m.quantity > 0 ? m.quantity : item.quantity,
        unit_name: m.unit_name || item.unit_name,
        unit: m.unit_name || item.unit,
        expiry_date: m.expiry_date || item.expiry_date,
        reason: m.reason || item.reason,
        explanation: m.explanation || item.explanation
      };
    });
    if (JSON.stringify(nextItems) !== JSON.stringify(existing.items)) {
      updates.items = nextItems;
      updates.total_quantity = nextItems.reduce((s, it) => s + (Number(it.quantity) || 1), 0);
      changedFields.push('items');
    }
  }

  if (changedFields.length === 0) {
    return {
      success: true,
      noChanges: true,
      rmaNumber: targetRma,
      changedFields: [],
      report: existing
    };
  }

  const actorLabel = cleanEmailAddr(senderEmail) || sourceLabel;
  const nowIso = new Date().toISOString();
  if (metaChanged || (existingIsTest && (!prevMeta.is_test || !prevMeta.test_mode))) {
    updates.ai_document_metadata = {
      ...prevMeta,
      ...(existingIsTest ? { is_test: true, test_mode: true } : {}),
      follow_up: nextFollowUp
    };
  }
  if (existingIsTest) {
    const existingNotesStr = String(existing.notes || '').trim();
    if (updates.notes !== undefined) {
      if (!String(updates.notes).includes('[TEST_MODE]')) {
        updates.notes = `[TEST_MODE] ${String(updates.notes).trim()}`.trim();
      }
    } else if (!existingNotesStr.includes('[TEST_MODE]')) {
      updates.notes = existingNotesStr ? `[TEST_MODE] ${existingNotesStr}` : '[TEST_MODE]';
    }
  }

  const prevAudit = Array.isArray(existing.audit_trail) ? existing.audit_trail : [];
  updates.audit_trail = [
    ...prevAudit,
    {
      timestamp: nowIso,
      action: 'EMAIL_XLSX_REPLY_UPDATE',
      stage: String(existing.status || 'PENDING').toUpperCase(),
      actor: actorLabel,
      note: `${existingIsTest ? '[TEST] ' : ''}Updated via replied .xlsx mirror (${changedFields.join(', ')})`
    }
  ];

  let { data: savedRows, error: updateErr } = await supabase
    .from('rma_reports')
    .update(updates)
    .eq('id', existing.id)
    .select();

  if (updateErr) {
    const fallback = { ...updates };
    const colM = String(updateErr.message || '').match(/Could not find the '([^']+)' column/i);
    if (colM?.[1] && colM[1] in fallback) delete fallback[colM[1]];
    const retry = await supabase.from('rma_reports').update(fallback).eq('id', existing.id).select();
    if (retry.error) throw new Error(retry.error.message);
    savedRows = retry.data;
  }

  // Upsert Supplier Directory entry if supplier email(s) updated
  const effectiveSupplier = String(updates.supplier_name || existing.supplier_name || '').trim();
  const effectiveSupTo = nextFollowUp.supplier_email_to || '';
  const effectiveSupCc = nextFollowUp.supplier_email_cc || '';
  if (effectiveSupplier && (effectiveSupTo || effectiveSupCc)) {
    try {
      const dirRow = (settingsRows || []).find((s) => s.key === 'supplier_directory_store');
      let dirList = [];
      if (dirRow?.value) {
        const parsedDir = typeof dirRow.value === 'string' ? JSON.parse(dirRow.value) : dirRow.value;
        if (Array.isArray(parsedDir)) dirList = parsedDir;
      }
      const lower = effectiveSupplier.toLowerCase();
      const idx = dirList.findIndex((e) => String(e?.supplier_name || '').trim().toLowerCase() === lower);
      const nextEntry = {
        supplier_name: effectiveSupplier,
        email_to: effectiveSupTo,
        email_cc: effectiveSupCc,
        updated_at: nowIso,
        updated_by: actorLabel
      };
      if (idx >= 0) dirList[idx] = { ...dirList[idx], ...nextEntry };
      else dirList.push(nextEntry);
      await supabase.from('rma_settings').upsert({ key: 'supplier_directory_store', value: JSON.stringify(dirList) }, { onConflict: 'key' });
    } catch {}
  }

  return {
    success: true,
    rmaNumber: targetRma,
    changedFields,
    report: Array.isArray(savedRows) && savedRows[0] ? savedRows[0] : { ...existing, ...updates }
  };
}

function decodeMimeHeader(headerVal) {
  return String(headerVal || '').replace(/=\?([^?]+)\?([BbQq])\?([^?]+)\?=/g, (_, _cs, enc, text) => {
    try {
      if (enc.toUpperCase() === 'B') return Buffer.from(text, 'base64').toString('utf8');
      const qp = text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (__, h) => String.fromCharCode(parseInt(h, 16)));
      return qp;
    } catch {
      return text;
    }
  });
}

function splitHeadersAndBody(rawStr) {
  const norm = rawStr.replace(/\r\n/g, '\n');
  const idx = norm.indexOf('\n\n');
  if (idx === -1) return { headerText: norm, bodyText: '' };
  return { headerText: norm.slice(0, idx), bodyText: norm.slice(idx + 2) };
}

function parseMimeHeaders(headerText) {
  const unfolded = headerText.replace(/\n[ \t]+/g, ' ');
  const headers = {};
  for (const line of unfolded.split('\n')) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const val = decodeMimeHeader(line.slice(colon + 1).trim());
    headers[key] = val;
  }
  return headers;
}

function extractXlsxAttachmentsFromMime(rawMessage) {
  const results = [];
  const walkPart = (partStr) => {
    const { headerText, bodyText } = splitHeadersAndBody(partStr);
    const headers = parseMimeHeaders(headerText);
    const ctype = headers['content-type'] || '';
    const cdisp = headers['content-disposition'] || '';
    const cenc = (headers['content-transfer-encoding'] || '').toLowerCase();

    const boundaryM = ctype.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
    if (boundaryM) {
      const boundary = boundaryM[1] || boundaryM[2];
      const sections = bodyText.split(`--${boundary}`);
      for (let i = 1; i < sections.length; i += 1) {
        const sec = sections[i];
        if (sec.startsWith('--')) break;
        walkPart(sec.replace(/^\n/, '').replace(/\n$/, ''));
      }
      return;
    }

    const nameM = (cdisp + ';' + ctype).match(/(?:filename|name)\*?=(?:UTF-8'')?(?:"([^"]+)"|([^;\s]+))/i);
    const filename = nameM ? decodeURIComponent(nameM[1] || nameM[2] || '') : '';
    if (/\.xlsx$/i.test(filename) || ctype.toLowerCase().includes('spreadsheetml.sheet')) {
      const buf = cenc.includes('base64')
        ? Buffer.from(bodyText.replace(/\s+/g, ''), 'base64')
        : Buffer.from(bodyText, 'binary');
      results.push({ filename: filename || 'reply.xlsx', buffer: buf });
    }
  };

  walkPart(rawMessage);
  return results;
}

function quoteImapStr(str) {
  return `"${String(str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function fetchUnseenImapXlsxReplies({ host, port, user, pass, onMarkSeen }) {
  return await new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, rejectUnauthorized: true });
    socket.setTimeout(15000);

    let buf = Buffer.alloc(0);
    let tagCounter = 1;
    let activeCmd = null;
    let connectedGreeted = false;

    const cleanup = () => {
      try { socket.destroy(); } catch {}
    };

    socket.on('timeout', () => {
      cleanup();
      reject(new Error('IMAP connection timed out.'));
    });

    socket.on('error', (err) => {
      cleanup();
      reject(err);
    });

    const sendCommand = (cmdBody) => new Promise((resCmd, rejCmd) => {
      const tag = `A${String(tagCounter++).padStart(4, '0')}`;
      activeCmd = { tag, resolve: resCmd, reject: rejCmd, chunks: [] };
      socket.write(`${tag} ${cmdBody}\r\n`);
    });

    const processBuffer = () => {
      const text = buf.toString('latin1');
      if (!connectedGreeted) {
        const lineEnd = text.indexOf('\r\n');
        if (lineEnd !== -1) {
          connectedGreeted = true;
          buf = buf.subarray(lineEnd + 2);
          activeCmd?.resolve?.({ ok: true, line: text.slice(0, lineEnd) });
          activeCmd = null;
        }
        return;
      }

      if (!activeCmd) return;
      const re = new RegExp(`(?:^|\\r\\n)${activeCmd.tag} (OK|NO|BAD) ([^\\r\\n]*)\\r\\n`, 'm');
      const m = re.exec(text);
      if (m) {
        const fullEndIdx = m.index + m[0].length;
        const payloadBuf = buf.subarray(0, m.index);
        buf = buf.subarray(fullEndIdx);
        const status = m[1];
        const infoLine = m[2];
        const cmd = activeCmd;
        activeCmd = null;
        if (status === 'OK') {
          cmd.resolve({ status, infoLine, payload: payloadBuf });
        } else {
          cmd.reject(new Error(`IMAP ${status}: ${infoLine}`));
        }
      }
    };

    const run = async () => {
      await new Promise((resGreet) => {
        activeCmd = { resolve: resGreet, reject };
      });
      await sendCommand(`LOGIN ${quoteImapStr(user)} ${quoteImapStr(pass)}`);
      await sendCommand('SELECT INBOX');
      const searchRes = await sendCommand('UID SEARCH UNSEEN');
      const searchText = searchRes.payload.toString('utf8');
      const searchLine = (searchText.match(/\* SEARCH([^\r\n]*)/i)?.[1] || '').trim();
      const uids = searchLine ? searchLine.split(/\s+/).filter((u) => /^\d+$/.test(u)) : [];

      const messages = [];
      for (const uid of uids.slice(0, 20)) {
        const fetchRes = await sendCommand(`UID FETCH ${uid} (BODY.PEEK[])`);
        const rawStr = fetchRes.payload.toString('latin1');
        const litM = /\{(\d+)\}\r\n/.exec(rawStr);
        let rfc822 = '';
        if (litM) {
          const litLen = parseInt(litM[1], 10);
          const startByte = rawStr.indexOf(litM[0]) + litM[0].length;
          rfc822 = fetchRes.payload.subarray(startByte, startByte + litLen).toString('utf8');
        } else {
          rfc822 = rawStr;
        }
        const { headerText } = splitHeadersAndBody(rfc822);
        const headers = parseMimeHeaders(headerText);
        const attachments = extractXlsxAttachmentsFromMime(rfc822);
        if (attachments.length > 0) {
          messages.push({
            uid,
            messageId: String(headers['message-id'] || '').trim(),
            from: cleanEmailAddr(headers.from || ''),
            subject: headers.subject || '',
            attachments
          });
        }
      }

      const processedUids = await onMarkSeen(messages);
      if (processedUids.length > 0) {
        await sendCommand(`UID STORE ${processedUids.join(',')} +FLAGS.SILENT (\\Seen)`);
      }
      await sendCommand('LOGOUT').catch(() => {});
      cleanup();
      return messages.length;
    };

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      processBuffer();
    });

    run().then(resolve).catch((err) => {
      cleanup();
      reject(err);
    });
  });
}

/**
 * In-app / Webhook `.xlsx` upload handler (`POST /api/send-email?action=ingest-xlsx-reply`).
 */
export async function handleIngestXlsxReply(req, res, payload = {}) {
  const auth = await authorizeCronOrAdmin(req);
  if (!auth?.authorized) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Admin Bearer token or CRON_SECRET required to ingest edited .xlsx updates.'
    });
  }

  try {
    const fileBase64 = String(payload.fileBase64 || payload.content || '').replace(/^data:[^;]+;base64,/i, '').trim();
    if (!fileBase64) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_XLSX_FILE',
        message: 'Provide base64-encoded .xlsx workbook bytes under fileBase64.'
      });
    }

    const buffer = Buffer.from(fileBase64, 'base64');
    const result = await applyRmaXlsxUpdates({
      buffer,
      rmaNumberHint: payload.rmaNumber || '',
      senderEmail: payload.senderEmail || '',
      subjectHint: payload.subject || '',
      sourceLabel: payload.actorName || 'Admin Manual .xlsx Upload',
      bypassSenderCheck: true
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error('[XLSX Ingest Error]:', err);
    return res.status(400).json({
      success: false,
      error: err?.message || 'Failed to parse or apply uploaded .xlsx updates.'
    });
  }
}

/**
 * Automated Gmail IMAP UNSEEN `.xlsx` reply poller (`GET`/`POST /api/send-email?action=sync-email-replies`).
 */
export async function handleSyncEmailReplies(req, res, payload = {}) {
  const auth = await authorizeCronOrAdmin(req);
  if (!auth?.authorized) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Unauthorized IMAP sync caller. Provide CRON_SECRET or Admin JWT.'
    });
  }

  const smtpUser = String(process.env.SMTP_USER || process.env.GMAIL_USER || '').trim();
  const cleanPass = String(process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASSWORD || '').replace(/\s+/g, '').trim();
  const imapHost = String(process.env.IMAP_HOST || 'imap.gmail.com').trim();
  const imapPort = Number(process.env.IMAP_PORT || 993);

  if (!smtpUser || !cleanPass) {
    return res.status(200).json({
      success: false,
      skipped: true,
      configured: false,
      message: 'Gmail IMAP/SMTP credentials not configured in server environment.'
    });
  }

  try {
    const { data: processedRow } = await supabase
      .from('rma_settings')
      .select('value')
      .eq('key', 'processed_reply_message_ids')
      .maybeSingle();

    let processedIds = [];
    if (processedRow?.value) {
      try {
        const parsed = typeof processedRow.value === 'string' ? JSON.parse(processedRow.value) : processedRow.value;
        if (Array.isArray(parsed)) processedIds = parsed;
      } catch {}
    }
    const processedSet = new Set(processedIds);

    const results = [];
    const seenUidsToMark = [];

    const totalMsgsWithXlsx = await fetchUnseenImapXlsxReplies({
      host: imapHost,
      port: imapPort,
      user: smtpUser,
      pass: cleanPass,
      onMarkSeen: async (messages) => {
        for (const msg of messages) {
          const dedupeKey = msg.messageId || `uid-${msg.uid}-${msg.from}`;
          if (processedSet.has(dedupeKey)) {
            seenUidsToMark.push(msg.uid);
            continue;
          }
          for (const att of msg.attachments) {
            try {
              const applyRes = await applyRmaXlsxUpdates({
                buffer: att.buffer,
                senderEmail: msg.from,
                subjectHint: msg.subject || '',
                sourceLabel: msg.from || 'Email Reply .xlsx'
              });
              results.push({ ...applyRes, filename: att.filename, from: msg.from, messageId: msg.messageId });
            } catch (attErr) {
              results.push({ success: false, error: attErr.message, filename: att.filename, from: msg.from });
            }
          }
          processedSet.add(dedupeKey);
          seenUidsToMark.push(msg.uid);
        }
        return seenUidsToMark;
      }
    });

    if (seenUidsToMark.length > 0) {
      const nextList = Array.from(processedSet).slice(-250);
      await supabase
        .from('rma_settings')
        .upsert({ key: 'processed_reply_message_ids', value: JSON.stringify(nextList) }, { onConflict: 'key' });
    }

    return res.status(200).json({
      success: true,
      scannedUnseenWithXlsx: totalMsgsWithXlsx,
      updatedCount: results.filter((r) => r.success && !r.noChanges).length,
      results
    });
  } catch (err) {
    console.error('[IMAP Reply Sync Error]:', err);
    return res.status(200).json({
      success: false,
      error: err?.message || 'IMAP reply sync encountered a network/auth error.'
    });
  }
}
