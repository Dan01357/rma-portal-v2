import tls from 'node:tls';
import zlib from 'node:zlib';
import { supabase } from './supabase.js';
import { authorizeCronOrAdmin } from './cronAuth.js';
import { DEFAULT_EMAIL_RECIPIENTS, DEFAULT_SANDBOX_EMAIL } from './smtpMailer.js';
import {
  sumManifestQuantity,
  summarizeBatchSuppliers,
  isMixedSuppliersSummary,
  isRealSupplierName
} from '../../src/utils/rmaHelpers.js';
import {
  SUPPLIER_DIRECTORY_SETTINGS_KEY,
  TEST_SUPPLIER_DIRECTORY_SETTINGS_KEY,
  getSupplierDirectorySettingsKey,
  parseSupplierDirectoryValue,
  isBlockedLiveDirectoryContact
} from '../../src/utils/supplierDirectoryHelpers.js';
import {
  normalizeSupplierGroupKey,
  buildSupplierDirectoryMap,
  lookupSupplierDirectoryContact,
  splitEmailStringOrList
} from '../../src/utils/followUpWorkflow.js';

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
  let sharedStringsEntry = entries.get('xl/sharedStrings.xml');
  if (!sharedStringsEntry) {
    for (const [k, v] of entries.entries()) {
      if (/^xl\/sharedstrings\.xml$/i.test(k)) {
        sharedStringsEntry = v;
        break;
      }
    }
  }
  const sharedStrings = sharedStringsEntry
    ? parseSharedStringsXml(sharedStringsEntry.toString('utf8'))
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
  let hasRmaHeaderBanner = false;

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

    if (trimmedCells.some((c) => /^(?:\[TEST\]\s*)?WHOLESALE RMA|2-WAY EMAIL/i.test(c))) {
      hasRmaHeaderBanner = true;
      continue;
    }

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
      line: headerRow.findIndex((h) => h && (h.includes('serial') || h === 'sn' || /^line\s*(?:#|no)?$/i.test(h))),
      parent_line_ref: headerRow.findIndex((h) => h.includes('parent line') || h.includes('line ref')),
      supplier_name: headerRow.findIndex((h) => (h.includes('supplier') || h.includes('vendor')) && !h.includes('email')),
      supplier_email_to: headerRow.findIndex((h) => (h.includes('supplier') || h.includes('vendor')) && h.includes('email') && h.includes('to')),
      supplier_email_cc: headerRow.findIndex((h) => (h.includes('supplier') || h.includes('vendor')) && h.includes('email') && h.includes('cc')),
      barcode: headerRow.findIndex((h) => h.includes('barcode')),
      code: headerRow.findIndex((h) => h.includes('sku') || h.includes('item code')),
      name: headerRow.findIndex((h) => h.includes('description') || h.includes('product')),
      quantity: headerRow.findIndex((h) => h.includes('qty') || h.includes('quantity')),
      unit_name: headerRow.findIndex((h) => h.includes('unit')),
      price: headerRow.findIndex((h) => h.includes('price')),
      expiry_date: headerRow.findIndex((h) => h.includes('expiry')),
      reason: headerRow.findIndex((h) => h.includes('reason')),
      explanation: headerRow.findIndex((h) => h.includes('explanation'))
    };

    for (let r = manifestHeaderRowIdx + 1; r < rows.length; r += 1) {
      const row = rows[r] || [];
      if (!row.some((c) => String(c ?? '').trim())) continue;
      const rawSerial = colMap.line >= 0 ? parseInt(row[colMap.line], 10) : NaN;
      const serialNo = Number.isFinite(rawSerial) && rawSerial > 0 ? rawSerial : (manifestUpdates.length + 1);
      const rawParentRef = colMap.parent_line_ref >= 0 ? parseInt(row[colMap.parent_line_ref], 10) : NaN;
      const parentLineRef = Number.isFinite(rawParentRef) && rawParentRef > 0 ? rawParentRef : null;
      const rawPrice = colMap.price >= 0 && String(row[colMap.price] ?? '').trim() !== ''
        ? Number(String(row[colMap.price]).replace(/[,\s]/g, ''))
        : undefined;
      const rawQty = colMap.quantity >= 0 && String(row[colMap.quantity] ?? '').trim() !== ''
        ? Number(String(row[colMap.quantity]).replace(/[,\s]/g, ''))
        : undefined;
      manifestUpdates.push({
        serialNo,
        lineIndex: (parentLineRef || serialNo) - 1,
        parentLineRef,
        supplier_name: colMap.supplier_name >= 0 ? String(row[colMap.supplier_name] ?? '').trim() : '',
        supplier_email_to: colMap.supplier_email_to >= 0 ? String(row[colMap.supplier_email_to] ?? '').trim() : undefined,
        supplier_email_cc: colMap.supplier_email_cc >= 0 ? String(row[colMap.supplier_email_cc] ?? '').trim() : undefined,
        barcode: colMap.barcode >= 0 ? String(row[colMap.barcode] ?? '').trim() : '',
        code: colMap.code >= 0 ? String(row[colMap.code] ?? '').trim() : '',
        name: colMap.name >= 0 ? String(row[colMap.name] ?? '').trim() : '',
        quantity: Number.isFinite(rawQty) && rawQty >= 1 ? Math.round(rawQty) : undefined,
        unit_name: colMap.unit_name >= 0 ? String(row[colMap.unit_name] ?? '').trim() : '',
        price: Number.isFinite(rawPrice) && rawPrice >= 0 ? rawPrice : undefined,
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
  const hasFieldValueHeader = fieldColIdx >= 0 && valueColIdx >= 0;
  const hasRmaNumberLabel =
    Object.prototype.hasOwnProperty.call(fieldMap, 'rma number') ||
    Object.prototype.hasOwnProperty.call(fieldMap, 'rma_number');
  const hasValidRmaFormat = /^RMA-(?:TEST-)?\d{4}-/i.test(rmaNumber);
  const hasKnownRmaMetaLabel = [
    'test mode',
    'logistics stream',
    'supplier / vendor name',
    'supplier / vendor',
    'defect / return reason',
    'barcode',
    'product description'
  ].some((k) => Object.prototype.hasOwnProperty.call(fieldMap, k));
  const isRmaWorksheet = Boolean(
    hasRmaHeaderBanner ||
    (hasRmaNumberLabel && (hasValidRmaFormat || hasFieldValueHeader || hasKnownRmaMetaLabel))
  );

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

  const batchScopeRaw = String(getField('Batch Supplier Scope') || '').trim();
  let batchScope = null;
  if (batchScopeRaw) {
    const [supPart, refsPart] = batchScopeRaw.split('|').map((s) => s.trim());
    const refsMatch = (refsPart || batchScopeRaw).match(/line\s*refs?\s*:\s*([0-9,\s]+)/i);
    const lineRefs = refsMatch
      ? refsMatch[1].split(',').map((n) => parseInt(n.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    batchScope = {
      raw: batchScopeRaw,
      supplierName: supPart || '',
      lineRefs
    };
  }

  return {
    isRmaWorksheet,
    rmaNumber,
    isTestHint,
    fieldMap,
    patch,
    manifestUpdates,
    batchScope
  };
}

function cleanEmailAddr(raw) {
  const m = String(raw || '').match(/<([^>]+)>/);
  const candidate = (m ? m[1] : String(raw || '')).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : '';
}

export function extractInviteEmailsForReport(settingsRows = [], targetRma = '', existingIsTest = false) {
  const inviteEmailsSet = new Set();
  const normTarget = String(targetRma || '').trim().toUpperCase();
  if (!normTarget) return inviteEmailsSet;

  const inviteRow = (settingsRows || []).find((s) => s?.key === 'customer_rma_invites_store');
  if (!inviteRow?.value) return inviteEmailsSet;

  let list = [];
  try {
    const parsed = typeof inviteRow.value === 'string' ? JSON.parse(inviteRow.value) : inviteRow.value;
    if (Array.isArray(parsed)) list = parsed;
  } catch {}

  for (const inv of list) {
    if (!inv || typeof inv !== 'object') continue;
    if (String(inv.status || 'active').toLowerCase() === 'revoked') continue;
    if (String(inv.rma_number || '').trim().toUpperCase() !== normTarget) continue;
    const invIsTest = Boolean(
      inv.is_test ||
      /^RMA-TEST-/i.test(inv.rma_number || '') ||
      String(inv.token || '').startsWith('inv_test_')
    );
    if (invIsTest !== Boolean(existingIsTest)) continue;

    const candidates = [
      ...(Array.isArray(inv.allowed_emails) ? inv.allowed_emails : []),
      ...(Array.isArray(inv.authorized_emails) ? inv.authorized_emails : []),
      inv.authorized_email
    ];
    for (const raw of candidates) {
      const clean = cleanEmailAddr(raw);
      if (clean) inviteEmailsSet.add(clean);
    }
  }
  return inviteEmailsSet;
}

export function extractAuthorizedEmailsFromSettings(settingsRows = []) {
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
        addEmailsToSet(liveEmailsSet, parsed.to);
        addEmailsToSet(liveEmailsSet, parsed.baseCcList);
        addEmailsToSet(liveEmailsSet, parsed.ccList);
        addEmailsToSet(liveEmailsSet, parsed.cc);
      }
      if (row.key === 'email_recipients_by_type' && parsed && typeof parsed === 'object') {
        Object.values(parsed).forEach((prof) => {
          if (!prof || typeof prof !== 'object') return;
          addEmailsToSet(liveEmailsSet, prof.toList);
          addEmailsToSet(liveEmailsSet, prof.toEmail);
          addEmailsToSet(liveEmailsSet, prof.to);
          addEmailsToSet(liveEmailsSet, prof.ccList);
          addEmailsToSet(liveEmailsSet, prof.cc);
        });
      }
      if (row.key === 'test_sandbox_email' && parsed) {
        addEmailsToSet(testEmailsSet, parsed);
      }
      if (row.key === 'test_email_recipients' && parsed && typeof parsed === 'object') {
        addEmailsToSet(testEmailsSet, parsed.toList);
        addEmailsToSet(testEmailsSet, parsed.toEmail);
        addEmailsToSet(testEmailsSet, parsed.to);
        addEmailsToSet(testEmailsSet, parsed.baseCcList);
        addEmailsToSet(testEmailsSet, parsed.ccList);
        addEmailsToSet(testEmailsSet, parsed.cc);
      }
      if (row.key === 'test_email_recipients_by_type' && parsed && typeof parsed === 'object') {
        Object.values(parsed).forEach((prof) => {
          if (!prof || typeof prof !== 'object') return;
          addEmailsToSet(testEmailsSet, prof.toList);
          addEmailsToSet(testEmailsSet, prof.toEmail);
          addEmailsToSet(testEmailsSet, prof.to);
          addEmailsToSet(testEmailsSet, prof.ccList);
          addEmailsToSet(testEmailsSet, prof.cc);
        });
      }
    } catch {}
  }
  return { liveEmailsSet, testEmailsSet };
}

export function isSenderAuthorizedForReport(senderEmail, report, adminEmailsSet, { liveEmailsSet, testEmailsSet, inviteEmailsSet } = {}) {
  const clean = cleanEmailAddr(senderEmail);
  if (!clean) return false;
  if (adminEmailsSet?.has(clean)) return true;
  if (liveEmailsSet?.has(clean)) return true;
  if (inviteEmailsSet?.has(clean)) return true;
  const reportIsTest = Boolean(
    report?.ai_document_metadata?.is_test ||
    report?.ai_document_metadata?.test_mode ||
    /^RMA-TEST-/i.test(report?.rma_number || '') ||
    String(report?.notes || '').includes('[TEST_MODE]')
  );
  if (reportIsTest && testEmailsSet?.has(clean)) return true;
  if (report?.ae_email && cleanEmailAddr(report.ae_email) === clean) return true;
  if (report?.reporter_contact && cleanEmailAddr(report.reporter_contact) === clean) return true;

  const assignedSupplierEmails = new Set();
  const collectEmails = (raw) => {
    splitEmailStringOrList(raw).forEach((e) => assignedSupplierEmails.add(e));
  };
  const fu = report?.ai_document_metadata?.follow_up;
  const pickup = report?.ai_document_metadata?.supplier_pickup;
  collectEmails(report?.supplier_email_to);
  collectEmails(report?.supplier_email_cc);
  collectEmails(fu?.supplier_email_to);
  collectEmails(fu?.supplier_email_cc);
  collectEmails(pickup?.supplier_email_to);
  collectEmails(pickup?.supplier_email_cc);
  if (fu?.by_supplier && typeof fu.by_supplier === 'object') {
    Object.values(fu.by_supplier).forEach((entry) => {
      collectEmails(entry?.supplier_email_to);
      collectEmails(entry?.supplier_email_cc);
    });
  }
  if (fu?.item_emails && typeof fu.item_emails === 'object') {
    Object.values(fu.item_emails).forEach((entry) => {
      collectEmails(entry?.supplier_email_to);
      collectEmails(entry?.supplier_email_cc);
    });
  }
  if (Array.isArray(report?.items)) {
    report.items.forEach((it) => {
      collectEmails(it?.supplier_email_to);
      collectEmails(it?.supplier_email_cc);
    });
  }
  if (assignedSupplierEmails.has(clean)) return true;

  const domain = clean.split('@')[1] || '';
  return ['pingconmarketing.com', 'a2z2go.net', 'keysysincorporated.com'].includes(domain);
}

async function safeUpdateTableRow(table, rowId, rowUpdates) {
  if (!rowId || !rowUpdates || Object.keys(rowUpdates).length === 0) return null;
  let candidate = { ...rowUpdates };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (Object.keys(candidate).length === 0) return null;
    const { data, error } = await supabase
      .from(table)
      .update(candidate)
      .eq('id', rowId)
      .select();
    if (!error) {
      return Array.isArray(data) && data[0] ? data[0] : null;
    }
    const errMsg = String(error.message || '');
    const colM =
      errMsg.match(/Could not find the '([^']+)' column/i) ||
      errMsg.match(/column [a-zA-Z0-9_.]*\.([a-zA-Z0-9_]+) does not exist/i);
    if (colM?.[1] && colM[1] in candidate) {
      delete candidate[colM[1]];
      continue;
    }
    if (table === 'rma_items') {
      return null;
    }
    throw new Error(errMsg);
  }
  return null;
}

function normMatchKey(val) {
  return String(val ?? '').trim().toUpperCase();
}

/**
 * Applies parsed `.xlsx` reply changes onto Supabase `rma_reports`, child `rma_reports`, `rma_items`, and `supplier_directory_store`.
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
  if (!parsed.isRmaWorksheet) {
    if (bypassSenderCheck) {
      throw new Error('Uploaded .xlsx is not a recognized RMA Alert worksheet (missing RMA Number field).');
    }
    return {
      skipped: true,
      nonRmaWorksheet: true,
      reason: 'NOT_AN_RMA_WORKSHEET',
      rmaNumber: null,
      senderEmail
    };
  }
  const targetRma = parsed.rmaNumber || String(rmaNumberHint || '').trim().toUpperCase();
  if (!targetRma || !/^RMA-(?:TEST-)?\d{4}-/i.test(targetRma)) {
    throw new Error(`Invalid or missing RMA Number in uploaded .xlsx (${targetRma || 'blank'}).`);
  }

  const [{ data: matchedRows, error: fetchErr }, { data: adminRows }, { data: settingsRows }] = await Promise.all([
    supabase.from('rma_reports').select('*').ilike('rma_number', targetRma).limit(20),
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
        SUPPLIER_DIRECTORY_SETTINGS_KEY,
        TEST_SUPPLIER_DIRECTORY_SETTINGS_KEY,
        'customer_rma_invites_store'
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
  const inviteEmailsSet = extractInviteEmailsForReport(settingsRows || [], targetRma, existingIsTest);

  if (
    !bypassSenderCheck &&
    senderEmail &&
    !isSenderAuthorizedForReport(senderEmail, existing, adminSet, { ...authorizedSets, inviteEmailsSet })
  ) {
    return {
      skipped: true,
      reason: 'UNAUTHORIZED_SENDER',
      rmaNumber: targetRma,
      senderEmail
    };
  }

  const [{ data: childReportRows }, { data: rmaItemRows }] = await Promise.all([
    supabase.from('rma_reports').select('*').eq('parent_rma_id', existing.id),
    supabase.from('rma_items').select('*').eq('rma_report_id', existing.id)
  ]);

  const activeDirKey = getSupplierDirectorySettingsKey(existingIsTest);
  const activeDirRow = (settingsRows || []).find((s) => s.key === activeDirKey);
  const activeDirMap = buildSupplierDirectoryMap(activeDirRow?.value);

  const baseItemsList = Array.isArray(existing.items) && existing.items.length > 0
    ? existing.items
    : (Array.isArray(childReportRows) && childReportRows.length > 0
        ? childReportRows
        : (Array.isArray(rmaItemRows) && rmaItemRows.length > 0 ? rmaItemRows : []));

  const scopeLineRefs = Array.isArray(parsed.batchScope?.lineRefs) ? parsed.batchScope.lineRefs : [];
  const hasExplicitScope = Boolean(
    scopeLineRefs.length > 0 ||
    parsed.manifestUpdates.some((m) => Number.isFinite(m.parentLineRef) && m.parentLineRef > 0)
  );
  const scopedIndicesSet = (() => {
    if (baseItemsList.length <= 1) return null;
    if (scopeLineRefs.length > 0) {
      return new Set(scopeLineRefs.map((n) => n - 1).filter((idx) => idx >= 0 && idx < baseItemsList.length));
    }
    const explicitRefs = parsed.manifestUpdates
      .map((m) => m.parentLineRef)
      .filter((n) => Number.isFinite(n) && n > 0 && n <= baseItemsList.length);
    if (explicitRefs.length > 0 && explicitRefs.length < baseItemsList.length) {
      return new Set(explicitRefs.map((n) => n - 1));
    }
    return null;
  })();
  const isScopedMultiItemReply = Boolean(scopedIndicesSet && scopedIndicesSet.size > 0 && baseItemsList.length > 1);

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

  if (existing.rma_type !== 'supplier_outbound') {
    compareAssignStr('store_branch', patch.store_branch);
  }
  if (!isScopedMultiItemReply) {
    compareAssignStr('supplier_name', patch.supplier_name);
    compareAssignStr('code', patch.code);
    compareAssignStr('name', patch.name);
    compareAssignStr('unit_name', patch.unit_name);
    compareAssignStr('reason', patch.reason);
    compareAssignStr('explanation', patch.explanation);
    compareAssignStr('expiry_date', patch.expiry_date);
  }
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

  if (!isScopedMultiItemReply && patch.expiry_date !== undefined && String(patch.expiry_date).trim()) {
    const ymd = normalizeYmdInput(patch.expiry_date);
    if (ymd && ymd !== String(existing.expiry_date || '').slice(0, 10)) {
      updates.expiry_date = ymd;
      if (!changedFields.includes('expiry_date')) changedFields.push('expiry_date');
    } else {
      delete updates.expiry_date;
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
  if (!isScopedMultiItemReply) {
    assignNum('quantity', patch.quantity);
    assignNum('price', patch.price);
    assignNum('price_with_vat', patch.price_with_vat);
  }

  const resolveEmailsWithDirAutoFill = ({ nextSup, prevSup, incomingTo, incomingCc, prevTo, prevCc }) => {
    const cleanNextTo = incomingTo !== undefined ? String(incomingTo).trim() : '';
    const cleanNextCc = incomingCc !== undefined ? String(incomingCc).trim() : '';
    const cleanPrevTo = String(prevTo || '').trim();
    const cleanPrevCc = String(prevCc || '').trim();
    const supChanged = Boolean(
      isRealSupplierName(nextSup) &&
      normalizeSupplierGroupKey(nextSup) !== normalizeSupplierGroupKey(prevSup)
    );
    const toExplicitlyEdited = incomingTo !== undefined && cleanNextTo !== cleanPrevTo;
    const ccExplicitlyEdited = incomingCc !== undefined && cleanNextCc !== cleanPrevCc;

    if (toExplicitlyEdited || ccExplicitlyEdited) {
      return {
        emailTo: toExplicitlyEdited ? cleanNextTo : cleanPrevTo,
        emailCc: ccExplicitlyEdited ? cleanNextCc : cleanPrevCc,
        explicitClear: toExplicitlyEdited && !cleanNextTo
      };
    }

    if (supChanged) {
      const dirMatch = lookupSupplierDirectoryContact(activeDirMap, nextSup);
      if (dirMatch) {
        return {
          emailTo: dirMatch.emailToList.join(', '),
          emailCc: dirMatch.emailCcList.join(', '),
          explicitClear: false
        };
      }
      return { emailTo: '', emailCc: '', explicitClear: true };
    }

    if (!cleanPrevTo && isRealSupplierName(nextSup)) {
      const dirMatch = lookupSupplierDirectoryContact(activeDirMap, nextSup);
      if (dirMatch) {
        return {
          emailTo: dirMatch.emailToList.join(', '),
          emailCc: cleanPrevCc || dirMatch.emailCcList.join(', '),
          explicitClear: false
        };
      }
    }

    return { emailTo: cleanPrevTo, emailCc: cleanPrevCc, explicitClear: false };
  };

  const prevMeta = (existing.ai_document_metadata && typeof existing.ai_document_metadata === 'object')
    ? existing.ai_document_metadata
    : {};
  const prevFollowUp = (prevMeta.follow_up && typeof prevMeta.follow_up === 'object') ? prevMeta.follow_up : {};
  const prevPickup = (prevMeta.supplier_pickup && typeof prevMeta.supplier_pickup === 'object') ? prevMeta.supplier_pickup : {};
  const nextFollowUp = {
    ...prevFollowUp,
    item_emails: (prevFollowUp.item_emails && typeof prevFollowUp.item_emails === 'object') ? { ...prevFollowUp.item_emails } : {},
    by_supplier: (prevFollowUp.by_supplier && typeof prevFollowUp.by_supplier === 'object') ? { ...prevFollowUp.by_supplier } : {}
  };
  let nextPickup = prevMeta.supplier_pickup ? { ...prevPickup } : null;
  let metaChanged = false;

  if (!isScopedMultiItemReply) {
    const prevTopSup = String(existing.supplier_name || '').trim();
    const nextTopSup = String(updates.supplier_name || prevTopSup).trim();
    const prevTopTo = String(prevFollowUp.supplier_email_to || prevPickup.supplier_email_to || '').trim();
    const prevTopCc = String(prevFollowUp.supplier_email_cc || prevPickup.supplier_email_cc || '').trim();
    const resolvedTopEmails = resolveEmailsWithDirAutoFill({
      nextSup: nextTopSup,
      prevSup: prevTopSup,
      incomingTo: patch.supplier_email_to,
      incomingCc: patch.supplier_email_cc,
      prevTo: prevTopTo,
      prevCc: prevTopCc
    });

    if (resolvedTopEmails.emailTo !== prevTopTo || resolvedTopEmails.explicitClear) {
      if (resolvedTopEmails.emailTo || (patch.supplier_email_to !== undefined && prevTopTo) || resolvedTopEmails.explicitClear) {
        nextFollowUp.supplier_email_to = resolvedTopEmails.emailTo;
        if (resolvedTopEmails.explicitClear && !resolvedTopEmails.emailTo) {
          nextFollowUp.supplier_email_cleared = true;
        } else {
          delete nextFollowUp.supplier_email_cleared;
        }
        if (nextPickup) nextPickup.supplier_email_to = resolvedTopEmails.emailTo;
        if (!changedFields.includes('supplier_email_to')) changedFields.push('supplier_email_to');
        metaChanged = true;
      }
    }
    if (resolvedTopEmails.emailCc !== prevTopCc) {
      nextFollowUp.supplier_email_cc = resolvedTopEmails.emailCc;
      if (nextPickup) nextPickup.supplier_email_cc = resolvedTopEmails.emailCc;
      if (!changedFields.includes('supplier_email_cc')) changedFields.push('supplier_email_cc');
      metaChanged = true;
    }
    if (nextTopSup && isRealSupplierName(nextTopSup)) {
      nextFollowUp.supplier_name = nextTopSup;
      const supKey = normalizeSupplierGroupKey(nextTopSup);
      if (supKey !== '__unassigned__' && (resolvedTopEmails.emailTo || resolvedTopEmails.emailCc || nextFollowUp.by_supplier[supKey])) {
        nextFollowUp.by_supplier[supKey] = {
          ...(nextFollowUp.by_supplier[supKey] || {}),
          supplier_name: nextTopSup,
          supplier_email_to: nextFollowUp.supplier_email_to ?? prevTopTo,
          supplier_email_cc: nextFollowUp.supplier_email_cc ?? prevTopCc,
          ...(resolvedTopEmails.explicitClear && !nextFollowUp.supplier_email_to ? { email_cleared: true } : { email_cleared: false })
        };
        metaChanged = true;
      }
    }
  }

  if (
    prevFollowUp.manually_disabled !== true &&
    nextFollowUp.enabled !== true &&
    (nextFollowUp.supplier_email_to || patch.supplier_name || parsed.manifestUpdates.some((m) => m.supplier_name || m.supplier_email_to))
  ) {
    nextFollowUp.enabled = true;
    if (!nextFollowUp.started_at) {
      nextFollowUp.started_at = existing.created_at || new Date().toISOString();
    }
    metaChanged = true;
  }

  // Apply per-item Manifest Line Item edits independently (never touching sibling supplier rows outside scoped subset)
  const editedManifestEntries = [];

  const synthesizedManifestUpdates = (() => {
    const list = [...parsed.manifestUpdates];
    // Handle a scoped single-supplier batch .xlsx where edits were made only in Column C Field|Value without adding manifest row changes
    if (isScopedMultiItemReply && list.length === 0) {
      for (const idx of scopedIndicesSet) {
        list.push({
          serialNo: idx + 1,
          lineIndex: idx,
          parentLineRef: idx + 1,
          supplier_name: patch.supplier_name || '',
          supplier_email_to: patch.supplier_email_to,
          supplier_email_cc: patch.supplier_email_cc,
          barcode: baseItemsList[idx]?.barcode || '',
          code: scopedIndicesSet.size === 1 ? (patch.code || '') : '',
          name: scopedIndicesSet.size === 1 ? (patch.name || '') : '',
          quantity: scopedIndicesSet.size === 1 && patch.quantity !== undefined ? Number(String(patch.quantity).replace(/[,\s]/g, '')) : undefined,
          unit_name: scopedIndicesSet.size === 1 ? (patch.unit_name || '') : '',
          price: scopedIndicesSet.size === 1 && patch.price !== undefined ? Number(String(patch.price).replace(/[,\s]/g, '')) : undefined,
          expiry_date: scopedIndicesSet.size === 1 ? normalizeYmdInput(patch.expiry_date) : null,
          reason: scopedIndicesSet.size === 1 ? (patch.reason || '') : '',
          explanation: scopedIndicesSet.size === 1 ? (patch.explanation || '') : ''
        });
      }
    }
    return list;
  })();

  if (synthesizedManifestUpdates.length > 0 && baseItemsList.length > 0) {
    const nextItems = baseItemsList.map((it) => ({ ...it }));
    const usedIndices = new Set();
    const isAllowedIndex = (idx) => !scopedIndicesSet || scopedIndicesSet.has(idx);

    for (const m of synthesizedManifestUpdates) {
      let matchIdx = -1;
      const mBarcode = normMatchKey(m.barcode);
      const mSku = normMatchKey(m.code);

      if (Number.isFinite(m.parentLineRef) && m.parentLineRef >= 1) {
        const refIdx = m.parentLineRef - 1;
        if (refIdx >= 0 && refIdx < nextItems.length && !usedIndices.has(refIdx) && isAllowedIndex(refIdx)) {
          matchIdx = refIdx;
        }
      }

      if (matchIdx === -1 && mBarcode) {
        const barcodeMatches = [];
        nextItems.forEach((it, idx) => {
          if (!usedIndices.has(idx) && isAllowedIndex(idx) && normMatchKey(it.barcode) === mBarcode) barcodeMatches.push(idx);
        });
        if (barcodeMatches.length === 1) {
          matchIdx = barcodeMatches[0];
        } else if (barcodeMatches.length > 1) {
          matchIdx = barcodeMatches.includes(m.lineIndex) ? m.lineIndex : barcodeMatches[0];
        }
      }

      if (matchIdx === -1 && mSku) {
        const skuMatches = [];
        nextItems.forEach((it, idx) => {
          if (!usedIndices.has(idx) && isAllowedIndex(idx) && normMatchKey(it.code || it.sku) === mSku) skuMatches.push(idx);
        });
        if (skuMatches.length === 1) {
          matchIdx = skuMatches[0];
        } else if (skuMatches.length > 1) {
          matchIdx = skuMatches.includes(m.lineIndex) ? m.lineIndex : skuMatches[0];
        }
      }

      if (
        matchIdx === -1 &&
        !hasExplicitScope &&
        !isScopedMultiItemReply &&
        Number.isFinite(m.lineIndex) &&
        m.lineIndex >= 0 &&
        m.lineIndex < nextItems.length &&
        !usedIndices.has(m.lineIndex)
      ) {
        matchIdx = m.lineIndex;
      }

      if (matchIdx === -1) continue;
      usedIndices.add(matchIdx);

      const origItem = nextItems[matchIdx];
      const itemKey = String(origItem.id || origItem.item_id || `line_${matchIdx + 1}`).trim();
      const prevItemSup = String(origItem.supplier_name || origItem.supplierName || '').trim();
      const topScopedSup = isScopedMultiItemReply && patch.supplier_name && String(patch.supplier_name).trim() !== String(parsed.batchScope?.supplierName || '').trim()
        ? String(patch.supplier_name).trim()
        : '';
      const incomingSup = m.supplier_name || topScopedSup;
      const nextItemSup = incomingSup || prevItemSup;

      const itemPatch = {};
      if (incomingSup && incomingSup !== prevItemSup) {
        itemPatch.supplier_name = incomingSup;
        itemPatch.supplierName = incomingSup;
        itemPatch.supplier = incomingSup;
      }

      const prevItemTo = String(
        origItem.supplier_email_to ??
        prevFollowUp.item_emails?.[itemKey]?.supplier_email_to ??
        prevFollowUp.by_supplier?.[normalizeSupplierGroupKey(prevItemSup)]?.supplier_email_to ??
        ''
      ).trim();
      const prevItemCc = String(
        origItem.supplier_email_cc ??
        prevFollowUp.item_emails?.[itemKey]?.supplier_email_cc ??
        prevFollowUp.by_supplier?.[normalizeSupplierGroupKey(prevItemSup)]?.supplier_email_cc ??
        ''
      ).trim();
      const incomingItemTo = m.supplier_email_to !== undefined
        ? m.supplier_email_to
        : (isScopedMultiItemReply ? patch.supplier_email_to : undefined);
      const incomingItemCc = m.supplier_email_cc !== undefined
        ? m.supplier_email_cc
        : (isScopedMultiItemReply ? patch.supplier_email_cc : undefined);

      const resolvedItemEmails = resolveEmailsWithDirAutoFill({
        nextSup: nextItemSup,
        prevSup: prevItemSup,
        incomingTo: incomingItemTo,
        incomingCc: incomingItemCc,
        prevTo: prevItemTo,
        prevCc: prevItemCc
      });

      if (resolvedItemEmails.emailTo !== prevItemTo || resolvedItemEmails.explicitClear) {
        if (resolvedItemEmails.emailTo || resolvedItemEmails.explicitClear || incomingItemTo !== undefined) {
          itemPatch.supplier_email_to = resolvedItemEmails.emailTo;
          if (resolvedItemEmails.explicitClear && !resolvedItemEmails.emailTo) {
            itemPatch.email_cleared = true;
          } else {
            itemPatch.email_cleared = false;
          }
        }
      }
      if (resolvedItemEmails.emailCc !== prevItemCc || incomingItemCc !== undefined) {
        itemPatch.supplier_email_cc = resolvedItemEmails.emailCc;
      }

      if (m.code && m.code !== String(origItem.code || origItem.sku || '').trim()) {
        itemPatch.code = m.code;
        itemPatch.sku = m.code;
      }
      if (m.name && m.name !== String(origItem.name || origItem.productName || origItem.product_name || '').trim()) {
        itemPatch.name = m.name;
        itemPatch.productName = m.name;
      }
      if (Number.isFinite(m.quantity) && m.quantity > 0 && m.quantity !== Number(origItem.quantity ?? origItem.qty ?? 1)) {
        itemPatch.quantity = m.quantity;
      }
      if (m.unit_name && m.unit_name !== String(origItem.unit_name || origItem.unit || '').trim()) {
        itemPatch.unit_name = m.unit_name;
        itemPatch.unit = m.unit_name;
      }
      if (Number.isFinite(m.price) && m.price >= 0 && m.price !== Number(origItem.price ?? 0)) {
        itemPatch.price = m.price;
      }
      if (m.expiry_date && m.expiry_date !== String(origItem.expiry_date || '').slice(0, 10)) {
        itemPatch.expiry_date = m.expiry_date;
      }
      if (m.reason && m.reason !== String(origItem.reason || '').trim()) {
        itemPatch.reason = m.reason;
      }
      if (m.explanation && m.explanation !== String(origItem.explanation || '').trim()) {
        itemPatch.explanation = m.explanation;
      }

      if (Object.keys(itemPatch).length > 0) {
        const updatedItem = { ...origItem, ...itemPatch };
        nextItems[matchIdx] = updatedItem;

        const finalSupName = String(updatedItem.supplier_name || '').trim();
        const finalSupKey = normalizeSupplierGroupKey(finalSupName);
        if (itemPatch.supplier_email_to !== undefined || itemPatch.supplier_email_cc !== undefined || itemPatch.supplier_name) {
          nextFollowUp.item_emails[itemKey] = {
            supplier_name: finalSupName,
            supplier_email_to: updatedItem.supplier_email_to || '',
            supplier_email_cc: updatedItem.supplier_email_cc || '',
            email_cleared: Boolean(updatedItem.email_cleared && !updatedItem.supplier_email_to)
          };
          if (finalSupKey !== '__unassigned__') {
            nextFollowUp.by_supplier[finalSupKey] = {
              ...(nextFollowUp.by_supplier[finalSupKey] || {}),
              supplier_name: finalSupName,
              supplier_email_to: updatedItem.supplier_email_to || nextFollowUp.by_supplier[finalSupKey]?.supplier_email_to || '',
              supplier_email_cc: updatedItem.supplier_email_cc || nextFollowUp.by_supplier[finalSupKey]?.supplier_email_cc || '',
              email_cleared: Boolean(updatedItem.email_cleared && !updatedItem.supplier_email_to)
            };
          }
          metaChanged = true;
        }

        editedManifestEntries.push({
          idx: matchIdx,
          serialNo: m.parentLineRef || m.serialNo || matchIdx + 1,
          origItem,
          updatedItem,
          itemPatch
        });
      }
    }

    if (editedManifestEntries.length > 0) {
      updates.items = nextItems;
      const batchTotalQty = sumManifestQuantity(nextItems, 1);
      updates.total_quantity = batchTotalQty;
      updates.quantity = batchTotalQty;
      updates.total_items = nextItems.length;

      const supFallback = (!isMixedSuppliersSummary(updates.supplier_name) && isRealSupplierName(updates.supplier_name))
        ? updates.supplier_name
        : ((!isMixedSuppliersSummary(existing.supplier_name) && isRealSupplierName(existing.supplier_name)) ? existing.supplier_name : '');
      const nextSummarySupplier = summarizeBatchSuppliers(nextItems, supFallback);
      if (nextSummarySupplier && nextSummarySupplier !== 'Pending Assignment' && nextSummarySupplier !== String(existing.supplier_name || '').trim()) {
        updates.supplier_name = nextSummarySupplier;
        if (!changedFields.includes('supplier_name')) changedFields.push('supplier_name');
      }

      if (!changedFields.includes('items')) changedFields.push('items');
      if (batchTotalQty !== Number(existing.total_quantity ?? existing.quantity ?? 0)) {
        if (!changedFields.includes('total_quantity')) changedFields.push('total_quantity');
        if (!changedFields.includes('quantity')) changedFields.push('quantity');
      }
      editedManifestEntries.forEach((e) => {
        if (e.itemPatch.supplier_name) changedFields.push(`item_${e.serialNo}_supplier_name`);
        if (e.itemPatch.supplier_email_to !== undefined) changedFields.push(`item_${e.serialNo}_supplier_email_to`);
        if (e.itemPatch.supplier_email_cc !== undefined) changedFields.push(`item_${e.serialNo}_supplier_email_cc`);
        if (e.itemPatch.quantity !== undefined) changedFields.push(`item_${e.serialNo}_quantity`);
        if (e.itemPatch.code) changedFields.push(`item_${e.serialNo}_code`);
        if (e.itemPatch.name) changedFields.push(`item_${e.serialNo}_name`);
        if (e.itemPatch.price !== undefined) changedFields.push(`item_${e.serialNo}_price`);
        if (e.itemPatch.expiry_date) changedFields.push(`item_${e.serialNo}_expiry_date`);
      });
    }
  } else if (Array.isArray(existing.items) && existing.items.length === 1 && !isScopedMultiItemReply) {
    // Keep single-item JSONB mirror consistent when top-level Field|Value rows were edited
    const origSingle = existing.items[0] || {};
    const singleItemPatch = {};
    if (updates.supplier_name) {
      singleItemPatch.supplier_name = updates.supplier_name;
      singleItemPatch.supplierName = updates.supplier_name;
      singleItemPatch.supplier = updates.supplier_name;
    }
    if (nextFollowUp.supplier_email_to !== undefined && String(nextFollowUp.supplier_email_to) !== String(origSingle.supplier_email_to ?? '')) {
      singleItemPatch.supplier_email_to = nextFollowUp.supplier_email_to;
      singleItemPatch.email_cleared = Boolean(nextFollowUp.supplier_email_cleared && !nextFollowUp.supplier_email_to);
    }
    if (nextFollowUp.supplier_email_cc !== undefined && String(nextFollowUp.supplier_email_cc) !== String(origSingle.supplier_email_cc ?? '')) {
      singleItemPatch.supplier_email_cc = nextFollowUp.supplier_email_cc;
    }
    if (updates.code) {
      singleItemPatch.code = updates.code;
      singleItemPatch.sku = updates.code;
    }
    if (updates.name) {
      singleItemPatch.name = updates.name;
      singleItemPatch.productName = updates.name;
    }
    if (updates.quantity !== undefined) singleItemPatch.quantity = updates.quantity;
    if (updates.unit_name) {
      singleItemPatch.unit_name = updates.unit_name;
      singleItemPatch.unit = updates.unit_name;
    }
    if (updates.price !== undefined) singleItemPatch.price = updates.price;
    if (updates.price_with_vat !== undefined) singleItemPatch.price_with_vat = updates.price_with_vat;
    if (updates.expiry_date) singleItemPatch.expiry_date = updates.expiry_date;
    if (updates.reason) singleItemPatch.reason = updates.reason;
    if (updates.explanation) singleItemPatch.explanation = updates.explanation;
    if (Object.keys(singleItemPatch).length > 0) {
      updates.items = [{ ...origSingle, ...singleItemPatch }];
      if (updates.quantity !== undefined) updates.total_quantity = updates.quantity;
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
      ...(nextPickup ? { supplier_pickup: nextPickup } : {}),
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

  const savedParent = await safeUpdateTableRow('rma_reports', existing.id, updates);

  // Sync single-item updates to single child row / rma_items row if present
  if (editedManifestEntries.length === 0) {
    if (Array.isArray(childReportRows) && childReportRows.length === 1 && childReportRows[0]?.id) {
      const childPatch = {};
      for (const k of ['supplier_name', 'code', 'name', 'quantity', 'unit_name', 'price', 'price_with_vat', 'expiry_date', 'reason', 'explanation']) {
        if (updates[k] !== undefined) childPatch[k] = updates[k];
      }
      if (Object.keys(childPatch).length > 0) {
        if ('updated_at' in childReportRows[0]) childPatch.updated_at = nowIso;
        await safeUpdateTableRow('rma_reports', childReportRows[0].id, childPatch).catch(() => {});
      }
    }
    if (Array.isArray(rmaItemRows) && rmaItemRows.length === 1 && rmaItemRows[0]?.id) {
      const riPatch = {};
      if (updates.supplier_name) riPatch.supplier_name = updates.supplier_name;
      if (updates.code) riPatch.sku = updates.code;
      if (updates.name) {
        if ('product_name' in rmaItemRows[0]) riPatch.product_name = updates.name;
        else riPatch.name = updates.name;
      }
      if (updates.quantity !== undefined) riPatch.quantity = updates.quantity;
      if (updates.unit_name) riPatch.unit_name = updates.unit_name;
      if (updates.price !== undefined) riPatch.price = updates.price;
      if (updates.expiry_date) riPatch.expiry_date = updates.expiry_date;
      if (updates.reason) riPatch.reason = updates.reason;
      if (updates.explanation) riPatch.explanation = updates.explanation;
      if (Object.keys(riPatch).length > 0) {
        await safeUpdateTableRow('rma_items', rmaItemRows[0].id, riPatch).catch(() => {});
      }
    }
  }

  // Sync per-item changes onto ONLY the matching child rows in `rma_reports` (parent_rma_id) and `rma_items` (rma_report_id)
  if (editedManifestEntries.length > 0) {
    const usedChildReportIds = new Set();
    const usedRmaItemIds = new Set();
    const childReportsSorted = Array.isArray(childReportRows) ? childReportRows : [];
    const rmaItemsSorted = Array.isArray(rmaItemRows) ? rmaItemRows : [];

    for (const entry of editedManifestEntries) {
      const { idx, origItem, updatedItem, itemPatch } = entry;
      const origBc = normMatchKey(origItem.barcode || updatedItem.barcode);
      const origSku = normMatchKey(origItem.code || origItem.sku || updatedItem.code || updatedItem.sku);

      // 1. Matching child row in rma_reports (`parent_rma_id = existing.id`)
      let matchedChild = childReportsSorted.find((c) => !usedChildReportIds.has(c.id) && origBc && normMatchKey(c.barcode) === origBc);
      if (!matchedChild && origSku) {
        matchedChild = childReportsSorted.find((c) => !usedChildReportIds.has(c.id) && normMatchKey(c.code || c.sku) === origSku);
      }
      if (!matchedChild && idx < childReportsSorted.length && !usedChildReportIds.has(childReportsSorted[idx]?.id)) {
        matchedChild = childReportsSorted[idx];
      }
      if (matchedChild?.id) {
        usedChildReportIds.add(matchedChild.id);
        const childUpdate = {};
        if ('updated_at' in matchedChild) childUpdate.updated_at = nowIso;
        if (itemPatch.supplier_name) childUpdate.supplier_name = itemPatch.supplier_name;
        if (itemPatch.code) childUpdate.code = itemPatch.code;
        if (itemPatch.name) childUpdate.name = itemPatch.name;
        if (itemPatch.quantity !== undefined) childUpdate.quantity = itemPatch.quantity;
        if (itemPatch.unit_name) childUpdate.unit_name = itemPatch.unit_name;
        if (itemPatch.price !== undefined) childUpdate.price = itemPatch.price;
        if (itemPatch.expiry_date) childUpdate.expiry_date = itemPatch.expiry_date;
        if (itemPatch.reason) childUpdate.reason = itemPatch.reason;
        if (itemPatch.explanation) childUpdate.explanation = itemPatch.explanation;
        if (itemPatch.supplier_email_to !== undefined) childUpdate.supplier_email_to = itemPatch.supplier_email_to;
        if (itemPatch.supplier_email_cc !== undefined) childUpdate.supplier_email_cc = itemPatch.supplier_email_cc;
        if (existingIsTest || itemPatch.supplier_email_to !== undefined || itemPatch.supplier_email_cc !== undefined) {
          const prevChildMeta = (matchedChild.ai_document_metadata && typeof matchedChild.ai_document_metadata === 'object')
            ? matchedChild.ai_document_metadata
            : {};
          const prevChildFu = (prevChildMeta.follow_up && typeof prevChildMeta.follow_up === 'object') ? prevChildMeta.follow_up : {};
          childUpdate.ai_document_metadata = {
            ...prevChildMeta,
            ...(existingIsTest ? { is_test: true, test_mode: true } : {}),
            ...((itemPatch.supplier_email_to !== undefined || itemPatch.supplier_email_cc !== undefined) ? {
              follow_up: {
                ...prevChildFu,
                ...(itemPatch.supplier_email_to !== undefined ? { supplier_email_to: itemPatch.supplier_email_to } : {}),
                ...(itemPatch.supplier_email_cc !== undefined ? { supplier_email_cc: itemPatch.supplier_email_cc } : {})
              }
            } : {})
          };
          if (existingIsTest) {
            const cNotes = String(matchedChild.notes || '').trim();
            if (!cNotes.includes('[TEST_MODE]')) childUpdate.notes = cNotes ? `[TEST_MODE] ${cNotes}` : '[TEST_MODE]';
          }
        }
        await safeUpdateTableRow('rma_reports', matchedChild.id, childUpdate).catch(() => {});
      }

      // 2. Matching child row in rma_items (`rma_report_id = existing.id`)
      let matchedRmaItem = rmaItemsSorted.find((it) => !usedRmaItemIds.has(it.id) && origBc && normMatchKey(it.barcode) === origBc);
      if (!matchedRmaItem && origSku) {
        matchedRmaItem = rmaItemsSorted.find((it) => !usedRmaItemIds.has(it.id) && normMatchKey(it.sku || it.code) === origSku);
      }
      if (!matchedRmaItem && idx < rmaItemsSorted.length && !usedRmaItemIds.has(rmaItemsSorted[idx]?.id)) {
        matchedRmaItem = rmaItemsSorted[idx];
      }
      if (matchedRmaItem?.id) {
        usedRmaItemIds.add(matchedRmaItem.id);
        const rmaItemUpdate = {};
        if (itemPatch.supplier_name) rmaItemUpdate.supplier_name = itemPatch.supplier_name;
        if (itemPatch.code) rmaItemUpdate.sku = itemPatch.code;
        if (itemPatch.name) {
          if ('product_name' in matchedRmaItem) rmaItemUpdate.product_name = itemPatch.name;
          else rmaItemUpdate.name = itemPatch.name;
        }
        if (itemPatch.quantity !== undefined) rmaItemUpdate.quantity = itemPatch.quantity;
        if (itemPatch.unit_name) rmaItemUpdate.unit_name = itemPatch.unit_name;
        if (itemPatch.price !== undefined) rmaItemUpdate.price = itemPatch.price;
        if (itemPatch.expiry_date) rmaItemUpdate.expiry_date = itemPatch.expiry_date;
        if (itemPatch.reason) rmaItemUpdate.reason = itemPatch.reason;
        if (itemPatch.explanation) rmaItemUpdate.explanation = itemPatch.explanation;
        if (Object.keys(rmaItemUpdate).length > 0) {
          await safeUpdateTableRow('rma_items', matchedRmaItem.id, rmaItemUpdate).catch(() => {});
        }
      }
    }
  }

  // Upsert Supplier Directory entries for all updated supplier/email pairs (including mixed-supplier batch lines, isolated Live vs Test)
  const dirUpsertCandidates = [];
  if (editedManifestEntries.length > 0) {
    editedManifestEntries.forEach(({ updatedItem }) => {
      const sName = String(updatedItem?.supplier_name || '').trim();
      const sTo = String(updatedItem?.supplier_email_to || '').trim();
      const sCc = String(updatedItem?.supplier_email_cc || '').trim();
      if (isRealSupplierName(sName) && (sTo || sCc)) {
        dirUpsertCandidates.push({ supplier_name: sName, email_to: sTo, email_cc: sCc });
      }
    });
  } else {
    const effectiveSupplier = String(updates.supplier_name || existing.supplier_name || '').trim();
    const effectiveSupTo = nextFollowUp.supplier_email_to || '';
    const effectiveSupCc = nextFollowUp.supplier_email_cc || '';
    if (isRealSupplierName(effectiveSupplier) && !isMixedSuppliersSummary(effectiveSupplier) && (effectiveSupTo || effectiveSupCc)) {
      dirUpsertCandidates.push({ supplier_name: effectiveSupplier, email_to: effectiveSupTo, email_cc: effectiveSupCc });
    }
  }

  const validDirUpserts = [];
  const seenDirKeys = new Set();
  for (const cand of dirUpsertCandidates) {
    const lower = cand.supplier_name.toLowerCase();
    if (seenDirKeys.has(lower)) continue;
    if (!existingIsTest && isBlockedLiveDirectoryContact(cand.supplier_name, cand.email_to, cand.email_cc)) continue;
    seenDirKeys.add(lower);
    validDirUpserts.push(cand);
  }

  if (validDirUpserts.length > 0) {
    try {
      const dirKey = getSupplierDirectorySettingsKey(existingIsTest);
      const dirRow = (settingsRows || []).find((s) => s.key === dirKey);
      let dirList = parseSupplierDirectoryValue(dirRow?.value);
      validDirUpserts.forEach((cand) => {
        const lower = cand.supplier_name.toLowerCase();
        const idx = dirList.findIndex((e) => String(e?.supplier_name || '').trim().toLowerCase() === lower);
        const nextEntry = {
          supplier_name: cand.supplier_name,
          email_to: cand.email_to,
          email_cc: cand.email_cc,
          updated_at: nowIso,
          updated_by: actorLabel
        };
        if (idx >= 0) dirList[idx] = { ...dirList[idx], ...nextEntry };
        else dirList.push(nextEntry);
      });
      await supabase.from('rma_settings').upsert({ key: dirKey, value: dirList, updated_at: nowIso }, { onConflict: 'key' });
    } catch {}
  }

  return {
    success: true,
    rmaNumber: targetRma,
    changedFields,
    report: savedParent || { ...existing, ...updates }
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

function decodeQuotedPrintableToBuffer(str) {
  const cleaned = String(str || '').replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < cleaned.length; i += 1) {
    if (cleaned[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(cleaned.slice(i + 1, i + 3))) {
      bytes.push(parseInt(cleaned.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(cleaned.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function extractMimeFilename(cdisp, ctype) {
  const combined = `${cdisp}; ${ctype}`;
  const rfc2231Parts = [];
  const segRe = /(?:filename|name)\*(\d+)\*?\s*=\s*(?:"([^"]*)"|([^;\s]*))/gi;
  let sm;
  while ((sm = segRe.exec(combined)) !== null) {
    const idx = parseInt(sm[1], 10);
    const val = (sm[3] ?? sm[4] ?? '').replace(/^[A-Za-z0-9_-]+''/, '');
    rfc2231Parts[idx] = val;
  }
  if (rfc2231Parts.length > 0) {
    const joined = rfc2231Parts.filter((v) => v !== undefined).join('');
    try {
      return decodeMimeHeader(decodeURIComponent(joined));
    } catch {
      return decodeMimeHeader(joined);
    }
  }
  const nameM = combined.match(/(?:filename|name)\*?\s*=\s*(?:[A-Za-z0-9_-]+'')?(?:"([^"]+)"|([^;\s]+))/i);
  const rawName = nameM ? (nameM[1] || nameM[2] || '') : '';
  if (!rawName) return '';
  try {
    return decodeMimeHeader(decodeURIComponent(rawName));
  } catch {
    return decodeMimeHeader(rawName);
  }
}

function extractXlsxAttachmentsFromMime(rawMessage) {
  const results = [];
  const walkPart = (partStr) => {
    if (!partStr) return;
    const { headerText, bodyText } = splitHeadersAndBody(partStr);
    const headers = parseMimeHeaders(headerText);
    const ctype = headers['content-type'] || '';
    const ctypeLower = ctype.toLowerCase();
    const cdisp = headers['content-disposition'] || '';
    const cenc = (headers['content-transfer-encoding'] || '').toLowerCase();

    // Recursively walk nested multipart/* containers (mixed -> related / alternative -> leaf parts)
    const boundaryM = ctype.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
    if (boundaryM || ctypeLower.startsWith('multipart/')) {
      const boundary = boundaryM ? (boundaryM[1] || boundaryM[2]) : '';
      if (boundary) {
        const sections = bodyText.split(`--${boundary}`);
        for (let i = 1; i < sections.length; i += 1) {
          const sec = sections[i];
          if (sec.startsWith('--')) break;
          walkPart(sec.replace(/^\r?\n/, '').replace(/\r?\n$/, ''));
        }
        return;
      }
    }

    // Handle forwarded/embedded RFC822 message parts recursively
    if (ctypeLower.includes('message/rfc822') && bodyText) {
      walkPart(bodyText);
      return;
    }

    const filename = extractMimeFilename(cdisp, ctype);
    const hasXlsxExt = /\.xlsx$/i.test(filename);
    const hasXlsxMime = ctypeLower.includes('spreadsheetml.sheet');
    if (hasXlsxExt || hasXlsxMime) {
      let decodedBuf;
      if (cenc.includes('base64')) {
        decodedBuf = Buffer.from(bodyText.replace(/\s+/g, ''), 'base64');
      } else if (cenc.includes('quoted-printable')) {
        decodedBuf = decodeQuotedPrintableToBuffer(bodyText);
      } else {
        decodedBuf = Buffer.from(bodyText, 'latin1');
      }
      if (decodedBuf && decodedBuf.length > 0 && (hasXlsxExt || (decodedBuf[0] === 0x50 && decodedBuf[1] === 0x4b))) {
        results.push({ filename: filename || 'reply.xlsx', buffer: decodedBuf });
      }
    }
  };

  walkPart(rawMessage);
  return results;
}

function quoteImapStr(str) {
  return `"${String(str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function extractImapLiteralPayload(payloadBuf) {
  const rawStr = payloadBuf.toString('latin1');
  const litM = /\{(\d+)\}\r\n/.exec(rawStr);
  if (litM) {
    const litLen = parseInt(litM[1], 10);
    const startByte = rawStr.indexOf(litM[0]) + litM[0].length;
    return payloadBuf.subarray(startByte, startByte + litLen).toString('latin1');
  }
  return rawStr;
}

const IMAP_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PROCESSED_IDS_KEY = 'processed_reply_message_ids';
const SYNC_LOGS_KEY = 'email_reply_sync_logs';
const SYNC_STATUS_KEY = 'email_reply_sync_status';
const SYNC_LOCK_KEY = 'email_reply_sync_lock';
const MAX_SYNC_LOG_ENTRIES = 100;
const SYNC_LOCK_TTL_MS = 35000;
const MAX_IMAP_SCAN_MS = 18000;
const IMAP_SOCKET_TIMEOUT_MS = 18000;
const LOG_DEDUPE_WINDOW_MS = 15 * 60 * 1000;

export function parseHeaderAndBodystructure(payloadBuf) {
  const rawStr = payloadBuf.toString('latin1');
  const litM = /\{(\d+)\}\r\n/.exec(rawStr);
  let headerStr = '';
  let metaStr = rawStr;
  if (litM) {
    const litLen = parseInt(litM[1], 10);
    const startByte = litM.index + litM[0].length;
    headerStr = payloadBuf.subarray(startByte, startByte + litLen).toString('latin1');
    metaStr = `${rawStr.slice(0, litM.index)} ${rawStr.slice(startByte + litLen)}`;
  }
  const decodedMeta = decodeMimeHeader(metaStr).toLowerCase();
  const maybeHasXlsx =
    decodedMeta.includes('.xlsx') ||
    decodedMeta.includes('spreadsheetml') ||
    decodedMeta.includes('octet-stream') ||
    decodedMeta.includes('message/rfc822');
  return { headerStr, bodystructureRaw: metaStr, maybeHasXlsx };
}

function formatImapSinceDate(daysAgo = 2) {
  const d = new Date(Date.now() - Math.max(0, daysAgo) * 24 * 60 * 60 * 1000);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mon = IMAP_MONTHS[d.getUTCMonth()] || 'Jan';
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mon}-${yyyy}`;
}

/**
 * Builds TLS options with explicit SNI `servername` so Google IMAP (`imap.gmail.com:993`)
 * serves the valid leaf certificate instead of its `invalid2.invalid` fallback cert.
 */
export function getImapTlsConnectOptions(host, port) {
  return {
    host,
    port,
    servername: host,
    rejectUnauthorized: true
  };
}

export function categorizeImapError(err) {
  const codeRaw = String(err?.code || '').trim();
  const msg = String(err?.message || err || 'Unknown IMAP error');
  const lower = msg.toLowerCase();

  if (
    codeRaw === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    codeRaw.startsWith('CERT_') ||
    codeRaw === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    lower.includes('self-signed certificate') ||
    lower.includes('certificate')
  ) {
    return {
      code: codeRaw || 'TLS_CERT_ERROR',
      message: msg,
      diagnosticHint: 'TLS handshake certificate check failed. Verify IMAP host and TLS SNI servername.'
    };
  }
  if (lower.includes('imap access is disabled') || lower.includes('webalert') || lower.includes('not enabled for imap')) {
    return {
      code: 'IMAP_DISABLED',
      message: msg,
      diagnosticHint: 'IMAP access appears disabled on this Google Workspace mailbox. Enable IMAP in Gmail Settings or Workspace Admin Console.'
    };
  }
  if (lower.includes('authenticationfailed') || lower.includes('invalid credentials') || lower.includes('application-specific password')) {
    return {
      code: 'IMAP_AUTH_FAILED',
      message: msg,
      diagnosticHint: 'Gmail rejected the IMAP login credentials. Verify GMAIL_USER and the 16-character GMAIL_APP_PASSWORD in Vercel.'
    };
  }
  if (lower.includes('too many simultaneous connections')) {
    return {
      code: 'IMAP_TOO_MANY_CONNECTIONS',
      message: msg,
      diagnosticHint: 'Gmail temporary simultaneous connection limit reached. Next sync tick will retry automatically.'
    };
  }
  if (lower.includes('timed out') || codeRaw === 'ETIMEDOUT' || codeRaw === 'ECONNRESET') {
    return {
      code: codeRaw || 'IMAP_TIMEOUT',
      message: msg,
      diagnosticHint: 'IMAP connection timed out or reset before completion. Next sync tick will retry automatically.'
    };
  }
  return {
    code: codeRaw || 'IMAP_SYNC_ERROR',
    message: msg,
    diagnosticHint: null
  };
}

function parseSettingJson(raw, fallback) {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  return raw;
}

async function readSettingsMap(dbClient, keys) {
  const map = new Map();
  try {
    const { data } = await dbClient
      .from('rma_settings')
      .select('key, value')
      .in('key', keys);
    if (Array.isArray(data)) {
      for (const row of data) {
        if (row?.key) map.set(row.key, row.value);
      }
    }
  } catch {}
  return map;
}

async function upsertSetting(dbClient, key, value) {
  try {
    await dbClient
      .from('rma_settings')
      .upsert({ key, value }, { onConflict: 'key' });
  } catch {}
}

export async function fetchRecentImapXlsxReplies({ host, port, user, pass, processedSet, onProcessMessages }) {
  return await new Promise((resolve, reject) => {
    const socket = tls.connect(getImapTlsConnectOptions(host, port));
    socket.setTimeout(IMAP_SOCKET_TIMEOUT_MS);

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
      if (!connectedGreeted) {
        const text = buf.toString('latin1');
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
      // Scan only the trailing 2 KB window so large multi-MB attachment payloads remain O(1) per TCP chunk
      const tailOffset = Math.max(0, buf.length - 2048);
      const tailText = buf.subarray(tailOffset).toString('latin1');
      const re = tailOffset === 0
        ? new RegExp(`(?:^|\\r\\n)${activeCmd.tag} (OK|NO|BAD) ([^\\r\\n]*)\\r\\n`, 'm')
        : new RegExp(`\\r\\n${activeCmd.tag} (OK|NO|BAD) ([^\\r\\n]*)\\r\\n`, 'm');
      const m = re.exec(tailText);
      if (m) {
        const matchAbsIdx = tailOffset + m.index;
        const fullEndIdx = matchAbsIdx + m[0].length;
        const payloadBuf = buf.subarray(0, matchAbsIdx);
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
      const scanDeadlineMs = Date.now() + MAX_IMAP_SCAN_MS;
      await new Promise((resGreet) => {
        activeCmd = { resolve: resGreet, reject };
      });
      await sendCommand(`LOGIN ${quoteImapStr(user)} ${quoteImapStr(pass)}`);
      await sendCommand('SELECT INBOX');
      const sinceStr = formatImapSinceDate(2);
      const searchRes = await sendCommand(`UID SEARCH SINCE ${sinceStr}`);
      const searchText = searchRes.payload.toString('utf8');
      const searchLine = (searchText.match(/\* SEARCH([^\r\n]*)/i)?.[1] || '').trim();
      const uids = searchLine ? searchLine.split(/\s+/).filter((u) => /^\d+$/.test(u)) : [];

      const messages = [];
      const scannedNonXlsxKeys = [];
      const recentUids = uids.slice(-40).reverse();
      let scannedCount = 0;
      let partialScan = false;

      for (const uid of recentUids) {
        if (Date.now() >= scanDeadlineMs) {
          partialScan = true;
          break;
        }
        scannedCount += 1;

        // Lightweight header + BODYSTRUCTURE probe first so already-processed or non-XLSX emails skip BODY.PEEK[]
        const probeRes = await sendCommand(
          `UID FETCH ${uid} (BODY.PEEK[HEADER.FIELDS (MESSAGE-ID FROM SUBJECT)] BODYSTRUCTURE)`
        );
        const { headerStr, maybeHasXlsx } = parseHeaderAndBodystructure(probeRes.payload);
        const hdrs = parseMimeHeaders(headerStr);
        const msgIdHeader = String(hdrs['message-id'] || '').trim();
        const hdrFrom = cleanEmailAddr(hdrs.from || '');
        const dedupeKey = msgIdHeader || `uid-${uid}-${hdrFrom}`;
        if (processedSet?.has(dedupeKey)) {
          continue;
        }
        if (!maybeHasXlsx) {
          if (msgIdHeader) scannedNonXlsxKeys.push(msgIdHeader);
          continue;
        }
        if (Date.now() >= scanDeadlineMs) {
          partialScan = true;
          break;
        }

        const fetchRes = await sendCommand(`UID FETCH ${uid} (BODY.PEEK[])`);
        const rfc822 = extractImapLiteralPayload(fetchRes.payload);
        const { headerText } = splitHeadersAndBody(rfc822);
        const headers = parseMimeHeaders(headerText);
        const messageId = String(headers['message-id'] || msgIdHeader || '').trim();
        const from = cleanEmailAddr(headers.from || hdrFrom || '');
        const fullKey = messageId || dedupeKey;
        const attachments = extractXlsxAttachmentsFromMime(rfc822);
        if (attachments.length > 0) {
          messages.push({
            uid,
            dedupeKey: fullKey,
            messageId,
            from,
            subject: headers.subject || hdrs.subject || '',
            attachments
          });
        } else if (messageId) {
          scannedNonXlsxKeys.push(messageId);
        }
      }

      const processedUids = await onProcessMessages(messages, scannedNonXlsxKeys);
      if (processedUids.length > 0) {
        await sendCommand(`UID STORE ${processedUids.join(',')} +FLAGS.SILENT (\\Seen)`).catch(() => {});
      }
      await sendCommand('LOGOUT').catch(() => {});
      cleanup();
      return {
        scannedRecentMessages: scannedCount,
        totalRecentUids: recentUids.length,
        partialScan,
        messagesWithXlsx: messages.length
      };
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

function buildSyncLogDedupeSignature(status, errorInfo, results) {
  if (status === 'error' || status === 'partial') {
    if (errorInfo) {
      return `err:${errorInfo.code || ''}:${String(errorInfo.message || '').slice(0, 120)}`;
    }
    const errItems = (results || [])
      .filter((r) => !r.success && r.reason !== 'UNAUTHORIZED_SENDER' && r.reason !== 'NOT_AN_RMA_WORKSHEET')
      .map((r) => `${r.messageId || r.filename || ''}:${String(r.error || '').slice(0, 60)}`);
    if (errItems.length > 0) {
      return `item_err:${status}:${errItems.slice(0, 8).join('|')}`;
    }
  }
  if (status === 'unauthorized') {
    const first = (results || []).find((r) => r.reason === 'UNAUTHORIZED_SENDER');
    if (first) return `unauth:${first.messageId || ''}:${first.from || first.senderEmail || ''}:${first.rmaNumber || ''}`;
  }
  if (status === 'skipped_non_rma') {
    const skipIds = (results || [])
      .filter((r) => r.reason === 'NOT_AN_RMA_WORKSHEET')
      .map((r) => r.messageId || r.filename || '');
    if (skipIds.length > 0) return `skip_non_rma:${skipIds.slice(0, 8).join('|')}`;
  }
  return null;
}

async function persistSyncOutcome({
  dbClient,
  settingsMap,
  nowIso,
  durationMs,
  triggerSource,
  caller,
  runStatus,
  errorInfo = null,
  scanStats = null,
  results = [],
  processedCount = 0,
  includeIdleLogs = false
}) {
  const prevStatus = parseSettingJson(settingsMap.get(SYNC_STATUS_KEY), {});
  const updatedCount = results.filter((r) => r.success && !r.noChanges).length;
  const noChangesCount = results.filter((r) => r.success && r.noChanges).length;
  const skippedNonRmaCount = results.filter((r) => r.reason === 'NOT_AN_RMA_WORKSHEET').length;
  const unauthorizedCount = results.filter((r) => r.reason === 'UNAUTHORIZED_SENDER').length;
  const errorCount = results.filter(
    (r) => !r.success && r.reason !== 'UNAUTHORIZED_SENDER' && r.reason !== 'NOT_AN_RMA_WORKSHEET'
  ).length;
  const firstItemErr =
    results.find((r) => !r.success && r.reason !== 'UNAUTHORIZED_SENDER' && r.reason !== 'NOT_AN_RMA_WORKSHEET')?.error ||
    null;

  const nextStatus = {
    lastRunAt: nowIso,
    lastStatus: runStatus,
    lastTriggerSource: triggerSource,
    lastCaller: caller,
    durationMs,
    lastSuccessAt: runStatus !== 'error' ? nowIso : (prevStatus?.lastSuccessAt || null),
    lastUpdatedAt: updatedCount > 0 ? nowIso : (prevStatus?.lastUpdatedAt || null),
    lastErrorAt: runStatus === 'error' ? nowIso : (prevStatus?.lastErrorAt || null),
    lastErrorCode: errorInfo?.code || (errorCount > 0 ? 'ATTACHMENT_PROCESSING_ERROR' : null),
    lastErrorMessage: errorInfo?.message || firstItemErr || null,
    lastDiagnosticHint: errorInfo?.diagnosticHint || null,
    processedCount,
    lastStats: {
      scannedRecentMessages: scanStats?.scannedRecentMessages || 0,
      messagesWithXlsx: scanStats?.messagesWithXlsx || 0,
      updatedCount,
      noChangesCount,
      skippedNonRmaCount,
      unauthorizedCount,
      errorCount
    }
  };

  await upsertSetting(dbClient, SYNC_STATUS_KEY, nextStatus);

  const shouldLogEntry = runStatus !== 'idle' || includeIdleLogs;
  if (!shouldLogEntry) return nextStatus;

  const rawLogs = parseSettingJson(settingsMap.get(SYNC_LOGS_KEY), []);
  const logs = Array.isArray(rawLogs) ? [...rawLogs] : [];
  const sig = buildSyncLogDedupeSignature(runStatus, errorInfo, results);
  const nowMs = new Date(nowIso).getTime();

  if (sig && logs[0] && logs[0].signature === sig) {
    const prevMs = new Date(logs[0].lastSeenAt || logs[0].timestamp || 0).getTime();
    if (Number.isFinite(prevMs) && nowMs - prevMs <= LOG_DEDUPE_WINDOW_MS) {
      logs[0] = {
        ...logs[0],
        lastSeenAt: nowIso,
        triggerSource,
        caller,
        durationMs,
        attemptCount: (Number(logs[0].attemptCount) || 1) + 1
      };
      await upsertSetting(dbClient, SYNC_LOGS_KEY, logs.slice(0, MAX_SYNC_LOG_ENTRIES));
      return nextStatus;
    }
  }

  const compactDetails = results.slice(0, 15).map((r) => ({
    rmaNumber: r.rmaNumber || null,
    from: r.from || r.senderEmail || null,
    filename: r.filename || null,
    messageId: r.messageId || null,
    status: r.success
      ? (r.noChanges ? 'no_changes' : 'updated')
      : (r.reason === 'UNAUTHORIZED_SENDER'
          ? 'unauthorized'
          : (r.reason === 'NOT_AN_RMA_WORKSHEET' ? 'skipped' : 'error')),
    changedFields: Array.isArray(r.changedFields) ? r.changedFields : [],
    reason: r.reason || null,
    error: r.error || null
  }));

  const newEntry = {
    id: `sync_${nowMs}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: nowIso,
    lastSeenAt: nowIso,
    attemptCount: 1,
    signature: sig,
    triggerSource,
    caller,
    status: runStatus,
    durationMs,
    scannedRecentMessages: scanStats?.scannedRecentMessages || 0,
    messagesWithXlsx: scanStats?.messagesWithXlsx || 0,
    updatedCount,
    noChangesCount,
    skippedNonRmaCount,
    unauthorizedCount,
    errorCount,
    errorCode: nextStatus.lastErrorCode,
    error: nextStatus.lastErrorMessage,
    diagnosticHint: nextStatus.lastDiagnosticHint,
    details: compactDetails
  };

  logs.unshift(newEntry);
  await upsertSetting(dbClient, SYNC_LOGS_KEY, logs.slice(0, MAX_SYNC_LOG_ENTRIES));
  return nextStatus;
}

/**
 * Reusable internal Gmail IMAP SINCE `.xlsx` reply poller (searches recent INBOX messages,
 * including read/opened replies, deduplicated via `processed_reply_message_ids`).
 * Never marks failed or `UNAUTHORIZED_SENDER` replies as processed.
 */
export async function syncEmailRepliesInternal({
  triggerSource = 'internal',
  caller = 'system',
  includeIdleLogs = false,
  imapFetcher = fetchRecentImapXlsxReplies,
  applyXlsxFn = applyRmaXlsxUpdates,
  dbClient = supabase,
  credentials = null
} = {}) {
  const startedAt = Date.now();
  const smtpUser = String(credentials?.user ?? (process.env.SMTP_USER || process.env.GMAIL_USER || '')).trim();
  const cleanPass = String(credentials?.pass ?? (process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASSWORD || '')).replace(/\s+/g, '').trim();
  const imapHost = String(credentials?.host ?? (process.env.IMAP_HOST || 'imap.gmail.com')).trim();
  const imapPort = Number(credentials?.port ?? (process.env.IMAP_PORT || 993));

  if (!smtpUser || !cleanPass) {
    return {
      success: false,
      skipped: true,
      configured: false,
      message: 'Gmail IMAP/SMTP credentials not configured in server environment.'
    };
  }

  const settingsMap = await readSettingsMap(dbClient, [
    PROCESSED_IDS_KEY,
    SYNC_LOGS_KEY,
    SYNC_STATUS_KEY,
    SYNC_LOCK_KEY
  ]);

  const existingLock = parseSettingJson(settingsMap.get(SYNC_LOCK_KEY), null);
  const lockNow = Date.now();
  if (existingLock && Number(existingLock.lockedUntil) > lockNow) {
    return {
      success: true,
      skipped: true,
      reason: 'SYNC_IN_PROGRESS',
      lockedUntil: existingLock.lockedUntil,
      message: `Another IMAP reply sync (${existingLock.triggerSource || 'active'}) is already in progress.`
    };
  }

  const lockId = `lock_${lockNow}_${Math.random().toString(36).slice(2, 8)}`;
  await upsertSetting(dbClient, SYNC_LOCK_KEY, {
    lockId,
    lockedAt: new Date(lockNow).toISOString(),
    lockedUntil: lockNow + SYNC_LOCK_TTL_MS,
    triggerSource,
    caller
  });

  try {
    const rawProcessed = parseSettingJson(settingsMap.get(PROCESSED_IDS_KEY), []);
    const processedIds = Array.isArray(rawProcessed) ? rawProcessed : [];
    const processedSet = new Set(processedIds);
    const initialSize = processedSet.size;

    const results = [];
    const seenUidsToMark = [];

    const scanStats = await imapFetcher({
      host: imapHost,
      port: imapPort,
      user: smtpUser,
      pass: cleanPass,
      processedSet,
      onProcessMessages: async (messages, nonXlsxKeys = []) => {
        nonXlsxKeys.forEach((k) => {
          if (k) processedSet.add(k);
        });
        for (const msg of messages) {
          const dedupeKey = msg.dedupeKey || msg.messageId || `uid-${msg.uid}-${msg.from}`;
          if (processedSet.has(dedupeKey)) {
            continue;
          }

          let allAttachmentsResolved = msg.attachments.length > 0;
          let hasGenuineRmaSuccess = false;
          for (const att of msg.attachments) {
            try {
              const applyRes = await applyXlsxFn({
                buffer: att.buffer,
                senderEmail: msg.from,
                subjectHint: msg.subject || '',
                sourceLabel: msg.from || 'Email Reply .xlsx'
              });
              results.push({ ...applyRes, filename: att.filename, from: msg.from, messageId: msg.messageId });
              if (applyRes?.reason === 'NOT_AN_RMA_WORKSHEET') {
                // Cleanly skip unrelated workbooks and cache Message-ID without marking Gmail \Seen
                continue;
              }
              if (applyRes?.skipped || applyRes?.success === false) {
                allAttachmentsResolved = false;
              } else {
                hasGenuineRmaSuccess = true;
              }
            } catch (attErr) {
              allAttachmentsResolved = false;
              results.push({
                success: false,
                error: attErr?.message || 'Failed applying .xlsx reply update.',
                filename: att.filename,
                from: msg.from,
                messageId: msg.messageId
              });
            }
          }

          // Cache Message-ID if every attachment succeeded OR was cleanly skipped as NOT_AN_RMA_WORKSHEET.
          // Never burn failed or UNAUTHORIZED_SENDER replies, and only mark Gmail \Seen for genuine RMA workbooks.
          if (allAttachmentsResolved) {
            processedSet.add(dedupeKey);
            if (hasGenuineRmaSuccess) {
              seenUidsToMark.push(msg.uid);
            }
          }
        }
        return seenUidsToMark;
      }
    });

    if (seenUidsToMark.length > 0 || processedSet.size !== initialSize) {
      const nextList = Array.from(processedSet).slice(-800);
      await upsertSetting(dbClient, PROCESSED_IDS_KEY, nextList);
    }

    const updatedCount = results.filter((r) => r.success && !r.noChanges).length;
    const noChangesCount = results.filter((r) => r.success && r.noChanges).length;
    const skippedNonRmaCount = results.filter((r) => r.reason === 'NOT_AN_RMA_WORKSHEET').length;
    const unauthorizedCount = results.filter((r) => r.reason === 'UNAUTHORIZED_SENDER').length;
    const errorCount = results.filter(
      (r) => !r.success && r.reason !== 'UNAUTHORIZED_SENDER' && r.reason !== 'NOT_AN_RMA_WORKSHEET'
    ).length;

    let runStatus = 'idle';
    if (errorCount > 0 && updatedCount > 0) runStatus = 'partial';
    else if (errorCount > 0) runStatus = 'error';
    else if (unauthorizedCount > 0) runStatus = 'unauthorized';
    else if (updatedCount > 0) runStatus = 'updated';
    else if (noChangesCount > 0) runStatus = 'no_changes';
    else if (skippedNonRmaCount > 0) runStatus = 'skipped_non_rma';

    const nowIso = new Date().toISOString();
    const durationMs = Date.now() - startedAt;
    const syncStatus = await persistSyncOutcome({
      dbClient,
      settingsMap,
      nowIso,
      durationMs,
      triggerSource,
      caller,
      runStatus,
      scanStats,
      results,
      processedCount: processedSet.size,
      includeIdleLogs
    });

    return {
      success: errorCount === 0,
      status: runStatus,
      triggerSource,
      durationMs,
      scannedUnseenWithXlsx: scanStats?.messagesWithXlsx || 0,
      scannedRecentMessages: scanStats?.scannedRecentMessages || 0,
      updatedCount,
      noChangesCount,
      skippedNonRmaCount,
      unauthorizedCount,
      errorCount,
      syncStatus,
      results
    };
  } catch (err) {
    console.error('[IMAP Reply Sync Error]:', err);
    const errorInfo = categorizeImapError(err);
    const nowIso = new Date().toISOString();
    const durationMs = Date.now() - startedAt;
    const syncStatus = await persistSyncOutcome({
      dbClient,
      settingsMap,
      nowIso,
      durationMs,
      triggerSource,
      caller,
      runStatus: 'error',
      errorInfo,
      includeIdleLogs: true
    });
    return {
      success: false,
      status: 'error',
      triggerSource,
      durationMs,
      errorCode: errorInfo.code,
      error: errorInfo.message,
      diagnosticHint: errorInfo.diagnosticHint,
      syncStatus
    };
  } finally {
    try {
      const { data: curLockRow } = await dbClient
        .from('rma_settings')
        .select('value')
        .eq('key', SYNC_LOCK_KEY)
        .maybeSingle();
      const curLock = parseSettingJson(curLockRow?.value, null);
      if (!curLock || curLock.lockId === lockId) {
        await upsertSetting(dbClient, SYNC_LOCK_KEY, {
          lockId: null,
          lockedUntil: 0,
          releasedAt: new Date().toISOString()
        });
      }
    } catch {}
  }
}

/**
 * Automated Gmail IMAP SINCE `.xlsx` reply poller (`GET`/`POST /api/send-email?action=sync-email-replies`).
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

  const triggerSource = String(
    req.query?.source || payload?.source || (auth.callerType === 'cron' ? 'external_cron' : 'admin_manual_or_poll')
  ).trim();
  const includeIdleLogs = Boolean(
    req.query?.includeIdleLogs === '1' ||
    req.query?.includeIdleLogs === 'true' ||
    payload?.includeIdleLogs === true
  );
  const strictStatus = Boolean(
    auth.callerType === 'cron' ||
    req.query?.strict === '1' ||
    req.query?.strict === 'true'
  );

  const syncResult = await syncEmailRepliesInternal({
    triggerSource,
    caller: auth.actor || auth.callerType || 'unknown',
    includeIdleLogs
  });

  const httpStatus =
    strictStatus && syncResult.configured !== false && syncResult.success === false && !syncResult.skipped
      ? 502
      : 200;

  return res.status(httpStatus).json(syncResult);
}

/**
 * Admin / Cron diagnostics endpoint (`GET /api/send-email?action=reply-sync-logs`)
 * returning persisted IMAP sync health status and recent run/error logs.
 */
export async function handleGetReplySyncLogs(req, res) {
  const auth = await authorizeCronOrAdmin(req);
  if (!auth?.authorized) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Unauthorized caller. Provide CRON_SECRET or Admin Bearer JWT.'
    });
  }

  const settingsMap = await readSettingsMap(supabase, [
    SYNC_STATUS_KEY,
    SYNC_LOGS_KEY,
    PROCESSED_IDS_KEY
  ]);

  const statusSummary = parseSettingJson(settingsMap.get(SYNC_STATUS_KEY), null);
  const rawLogs = parseSettingJson(settingsMap.get(SYNC_LOGS_KEY), []);
  const logs = Array.isArray(rawLogs) ? rawLogs : [];
  const rawProcessed = parseSettingJson(settingsMap.get(PROCESSED_IDS_KEY), []);
  const processedMessageIdCount = Array.isArray(rawProcessed) ? rawProcessed.length : 0;

  return res.status(200).json({
    success: true,
    statusSummary,
    logs,
    processedMessageIdCount
  });
}
