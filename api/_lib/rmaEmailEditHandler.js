import { supabase } from './supabase.js';
import { sendJson, setCorsHeaders } from './auth.js';
import {
  sumManifestQuantity,
  summarizeBatchSuppliers,
  isMixedSuppliersSummary,
  isRealSupplierName,
  extractDistinctSuppliersFromItems
} from '../../src/utils/rmaHelpers.js';
import { normalizeSupplierGroupKey } from '../../src/utils/followUpWorkflow.js';

const INVITES_SETTINGS_KEY = 'customer_rma_invites_store';

function isTestInvite(invite) {
  if (!invite) return false;
  return Boolean(invite.is_test || String(invite.token || '').startsWith('inv_test_'));
}

function isEditorInvite(invite) {
  if (!invite) return false;
  const token = String(invite.token || '');
  const entity = String(invite.entity_name || '');
  return (
    invite.stream_type === 'rma_editor' ||
    /^inv_(test_)?edit_/i.test(token) ||
    entity.startsWith('[RMA_EDITOR')
  );
}

function extractInviteRmaNumber(invite) {
  if (!invite) return '';
  if (invite.rma_number && String(invite.rma_number).trim()) {
    return String(invite.rma_number).trim();
  }
  const ent = String(invite.entity_name || '');
  const match = ent.match(/^\[RMA_EDITOR:([^|\]]+)(?:\|([^\]]*))?\]/);
  if (match && match[1] && match[1] !== 'ANY') {
    return match[1].trim();
  }
  const branch = String(invite.store_branch || '').trim();
  if (/^RMA-(TEST-)?\d{4}-/i.test(branch)) {
    return branch;
  }
  return '';
}

function extractAllowedEmails(invite) {
  if (!invite) return [];
  const set = new Set();
  const addEmail = (val) => {
    const clean = String(val || '').trim().toLowerCase();
    if (clean && clean.includes('@')) set.add(clean);
  };
  addEmail(invite.authorized_email);
  if (Array.isArray(invite.authorized_emails)) invite.authorized_emails.forEach(addEmail);
  if (Array.isArray(invite.allowed_emails)) invite.allowed_emails.forEach(addEmail);
  const ent = String(invite.entity_name || '');
  const match = ent.match(/^\[RMA_EDITOR:[^|\]]*\|([^\]]*)\]/);
  if (match && match[1]) {
    match[1].split(',').forEach(addEmail);
  }
  return Array.from(set);
}

function isPermanentInvite(invite) {
  if (!invite) return false;
  const exp = invite.expires_at;
  return Boolean(
    invite.no_expiry === true ||
    invite.never_expires === true ||
    String(invite.duration_unit || '').toLowerCase() === 'permanent' ||
    exp === null ||
    exp === undefined ||
    String(exp).startsWith('9999-') ||
    (typeof exp === 'string' && new Date(exp).getUTCFullYear() >= 9999)
  );
}

function isTestReport(report) {
  if (!report) return false;
  return Boolean(
    report.is_test === true ||
    report.ai_document_metadata?.is_test === true ||
    report.ai_document_metadata?.test_mode === true ||
    String(report.notes || '').includes('[TEST_MODE]') ||
    /^RMA-(?:TEST-)/i.test(String(report.rma_number || ''))
  );
}

async function resolveInviteByToken(token) {
  const cleanToken = String(token || '').trim();
  if (!cleanToken) return null;

  const [tblRes, settingsRes] = await Promise.allSettled([
    supabase.from('rma_invites').select('*').eq('token', cleanToken).maybeSingle(),
    supabase.from('rma_settings').select('value').eq('key', INVITES_SETTINGS_KEY).maybeSingle()
  ]);

  const tblRow = tblRes.status === 'fulfilled' && !tblRes.value?.error ? tblRes.value?.data : null;
  let settingsRow = null;
  if (settingsRes.status === 'fulfilled' && !settingsRes.value?.error && Array.isArray(settingsRes.value?.data?.value)) {
    settingsRow = settingsRes.value.data.value.find((i) => i && i.token === cleanToken) || null;
  }

  if (!tblRow && !settingsRow) return null;

  const merged = {
    ...(tblRow || {}),
    ...(settingsRow || {}),
    token: cleanToken
  };

  // Strict revocation / expiry win if either store marked revoked
  if (tblRow?.status === 'revoked' || settingsRow?.status === 'revoked') {
    merged.status = 'revoked';
  }
  merged.is_test = isTestInvite(merged);
  merged.stream_type = isEditorInvite(merged) ? 'rma_editor' : (merged.stream_type || 'customer_inbound');
  merged.rma_number = extractInviteRmaNumber(merged) || null;
  return merged;
}

async function findTargetReport(rmaNumber) {
  const cleanRma = String(rmaNumber || '').trim();
  if (!cleanRma) return null;

  const { data, error } = await supabase
    .from('rma_reports')
    .select('*')
    .eq('rma_number', cleanRma)
    .order('is_parent', { ascending: false })
    .order('created_at', { ascending: true });

  if (error || !Array.isArray(data) || data.length === 0) return null;
  const parent = data.find((r) => !r.parent_rma_id) || data[0];
  return { parent, allRows: data };
}

export async function handleRmaEmailEdit(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'PATCH' && req.method !== 'POST') {
    return sendJson(res, 405, {
      success: false,
      error: 'METHOD_NOT_ALLOWED',
      message: `Method ${req.method} is not allowed. Use GET or PATCH.`
    }, req);
  }

  // 1. Verify Google / Supabase User Bearer JWT cryptographically with Supabase Auth
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!bearerToken) {
    return sendJson(res, 401, {
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Google Sign-In session token (Authorization: Bearer <token>) is required.'
    }, req);
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser(bearerToken);
  const userEmail = userData?.user?.email ? String(userData.user.email).trim().toLowerCase() : '';
  if (userErr || !userEmail) {
    return sendJson(res, 401, {
      success: false,
      error: 'INVALID_SESSION',
      message: 'Your Google Sign-In session is invalid or expired. Please sign in again.'
    }, req);
  }

  // 2. Resolve and verify Invite Token
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const inviteToken = String(req.query?.token || body.token || body.inviteToken || '').trim();
  if (!inviteToken) {
    return sendJson(res, 400, {
      success: false,
      error: 'MISSING_INVITE_TOKEN',
      message: 'Invite authorization token is required.'
    }, req);
  }

  const invite = await resolveInviteByToken(inviteToken);
  if (!invite) {
    return sendJson(res, 404, {
      success: false,
      error: 'INVITE_NOT_FOUND',
      message: 'Authorization link was deleted or does not exist.'
    }, req);
  }

  if (invite.status === 'revoked') {
    return sendJson(res, 403, {
      success: false,
      error: 'INVITE_REVOKED',
      message: 'This RMA editor authorization link has been revoked.'
    }, req);
  }

  const inviteIsPermanent = isPermanentInvite(invite);
  if (!inviteIsPermanent) {
    const expTs = new Date(invite.expires_at).getTime();
    if (!Number.isFinite(expTs) || Date.now() > expTs) {
      return sendJson(res, 403, {
        success: false,
        error: 'INVITE_EXPIRED',
        message: 'This RMA editor authorization link has expired.'
      }, req);
    }
  }

  if (!isEditorInvite(invite)) {
    return sendJson(res, 403, {
      success: false,
      error: 'INVALID_INVITE_SCOPE',
      message: 'This invite token is not authorized for RMA record editing.'
    }, req);
  }

  const allowedEmails = extractAllowedEmails(invite);
  if (allowedEmails.length === 0 || !allowedEmails.includes(userEmail)) {
    return sendJson(res, 403, {
      success: false,
      error: 'IDENTITY_MISMATCH',
      message: `Access Denied: Signed-in Google account (${userEmail}) is not in authorized recipients (${allowedEmails.join(', ')}).`
    }, req);
  }
  const authorizedEmail = userEmail;

  // 3. Enforce RMA Scope & Live vs Test Isolation
  const requestedRma = String(req.query?.rma || req.query?.rma_number || body.rma_number || body.editRma || '').trim();
  const lockedRma = invite.rma_number ? String(invite.rma_number).trim() : '';

  if (lockedRma && requestedRma && requestedRma !== lockedRma) {
    return sendJson(res, 403, {
      success: false,
      error: 'RMA_SCOPE_MISMATCH',
      message: `This link is locked exclusively to RMA ${lockedRma} and cannot modify ${requestedRma}.`
    }, req);
  }

  const targetRmaNumber = lockedRma || requestedRma;
  if (!targetRmaNumber) {
    return sendJson(res, 400, {
      success: false,
      error: 'MISSING_RMA_NUMBER',
      message: 'Target RMA number is required.'
    }, req);
  }

  const found = await findTargetReport(targetRmaNumber);
  if (!found?.parent) {
    return sendJson(res, 404, {
      success: false,
      error: 'RMA_NOT_FOUND',
      message: `RMA record "${targetRmaNumber}" was not found.`
    }, req);
  }

  const report = found.parent;
  const inviteIsTest = isTestInvite(invite);
  const recordIsTest = isTestReport(report);
  if (inviteIsTest !== recordIsTest) {
    return sendJson(res, 403, {
      success: false,
      error: 'MODE_ISOLATION_VIOLATION',
      message: inviteIsTest
        ? 'Security Block: Test Mode editor links cannot access or modify Live Production RMA records.'
        : 'Security Block: Live Mode editor links cannot access or modify Test Sandbox RMA records.'
    }, req);
  }

  // 4. GET: Return scoped RMA details for standalone editor view
  if (req.method === 'GET') {
    let manifestItems = Array.isArray(report.items) && report.items.length > 0
      ? report.items
      : (found.allRows.length > 1 ? found.allRows.filter((r) => r.id !== report.id) : []);

    if (manifestItems.length === 0 && report.id) {
      try {
        const { data: riRows } = await supabase
          .from('rma_items')
          .select('*')
          .eq('rma_report_id', report.id)
          .order('id', { ascending: true });
        if (Array.isArray(riRows) && riRows.length > 0) {
          manifestItems = riRows;
        }
      } catch {}
    }

    const totalQty = manifestItems.length > 1
      ? sumManifestQuantity(manifestItems, report.quantity)
      : (Number(report.quantity) || 1);

    return sendJson(res, 200, {
      success: true,
      mode: inviteIsTest ? 'test' : 'live',
      authorized_email: authorizedEmail,
      authorized_emails: allowedEmails,
      no_expiry: inviteIsPermanent,
      expires_at: inviteIsPermanent ? null : (invite.expires_at || null),
      scope_locked_rma: Boolean(lockedRma),
      report: {
        id: report.id,
        rma_number: report.rma_number,
        rma_type: report.rma_type,
        barcode: report.barcode,
        code: report.code || '',
        name: report.name || '',
        supplier_name: report.supplier_name || '',
        store_branch: report.store_branch || '',
        quantity: totalQty,
        total_quantity: report.total_quantity ?? totalQty,
        unit_name: report.unit_name || 'pc',
        price: report.price ?? 0,
        price_with_vat: report.price_with_vat ?? 0,
        expiry_date: report.expiry_date || '',
        si_number: report.si_number || '',
        dr_number: report.dr_number || '',
        po_number: report.po_number || '',
        invoice_dr_number: report.invoice_dr_number || '',
        notes: report.notes || '',
        reason: report.reason || '',
        explanation: report.explanation || '',
        status: report.status || '',
        disposition: report.disposition || '',
        created_at: report.created_at,
        updated_at: report.updated_at || null,
        ai_document_metadata: report.ai_document_metadata || {},
        items: manifestItems
      }
    }, req);
  }

  // 5. PATCH / POST: Persist sanitized edits + commercial documents + audit trail
  const u = (body.updates && typeof body.updates === 'object') ? body.updates : body;
  const nowIso = new Date().toISOString();

  const updates = {};
  if (u.supplier_name !== undefined) updates.supplier_name = String(u.supplier_name || '').trim() || null;
  if (u.name !== undefined) updates.name = String(u.name || '').trim() || report.name;
  if (u.code !== undefined || u.sku !== undefined) {
    updates.code = String(u.code !== undefined ? u.code : u.sku || '').trim() || null;
  }
  if (u.barcode !== undefined && String(u.barcode).trim()) {
    updates.barcode = String(u.barcode).trim();
  }
  if (u.quantity !== undefined) {
    const qtyNum = Number(u.quantity);
    if (Number.isFinite(qtyNum) && qtyNum >= 1) {
      updates.quantity = Math.round(qtyNum);
    }
  }
  if (u.unit_name !== undefined) updates.unit_name = String(u.unit_name || '').trim() || 'pc';

  const hasNetPrice = u.price !== undefined && u.price !== '';
  const hasVatPrice = u.price_with_vat !== undefined && u.price_with_vat !== '';
  if (hasNetPrice) {
    const netNum = parseFloat(u.price);
    if (Number.isFinite(netNum) && netNum >= 0) {
      updates.price = Number(netNum.toFixed(2));
      if (!hasVatPrice) {
        updates.price_with_vat = Number((netNum * 1.12).toFixed(2));
      }
    }
  }
  if (hasVatPrice) {
    const vatNum = parseFloat(u.price_with_vat);
    if (Number.isFinite(vatNum) && vatNum >= 0) {
      updates.price_with_vat = Number(vatNum.toFixed(2));
      if (!hasNetPrice) {
        updates.price = Number((vatNum / 1.12).toFixed(2));
      }
    }
  }

  if (u.expiry_date !== undefined) {
    const cleanExp = String(u.expiry_date || '').trim();
    updates.expiry_date = cleanExp ? cleanExp.slice(0, 10) : null;
  }
  if (u.store_branch !== undefined) updates.store_branch = String(u.store_branch || '').trim() || null;

  if (u.si_number !== undefined) updates.si_number = String(u.si_number || '').trim() || null;
  if (u.dr_number !== undefined) updates.dr_number = String(u.dr_number || '').trim() || null;
  if (u.po_number !== undefined) updates.po_number = String(u.po_number || '').trim() || null;

  const effectiveDr = updates.dr_number !== undefined ? updates.dr_number : report.dr_number;
  const effectiveSi = updates.si_number !== undefined ? updates.si_number : report.si_number;
  const effectivePo = updates.po_number !== undefined ? updates.po_number : report.po_number;
  if (u.si_number !== undefined || u.dr_number !== undefined || u.po_number !== undefined) {
    updates.invoice_dr_number = effectiveDr || effectiveSi || effectivePo || null;
  }

  if (u.notes !== undefined) {
    const cleaned = String(u.notes || '').replace(/\[TEST_MODE\]/gi, '').trim();
    updates.notes = recordIsTest ? (`[TEST_MODE] ${cleaned}`).trim() : cleaned;
  }

  if (Array.isArray(u.items) && u.items.length > 0) {
    const fallbackSingleSup =
      (!isMixedSuppliersSummary(updates.supplier_name) && isRealSupplierName(updates.supplier_name))
        ? updates.supplier_name
        : ((!isMixedSuppliersSummary(report.supplier_name) && isRealSupplierName(report.supplier_name)) ? report.supplier_name : '');

    const sanitizedItems = u.items.map((it) => {
      const qtyVal = Number(it.quantity ?? it.qty);
      const netVal = parseFloat(it.price);
      const vatVal = parseFloat(it.price_with_vat ?? it.priceWithVat);
      const rawSup = String(it.supplier_name || it.supplierName || it.supplier || '').trim();
      const resolvedItemSup = isRealSupplierName(rawSup) ? rawSup : (fallbackSingleSup || 'Pending Assignment');
      return {
        ...it,
        name: String(it.name || it.productName || '').trim() || 'Item',
        code: String(it.code || it.sku || '').trim() || null,
        sku: String(it.sku || it.code || '').trim() || null,
        supplier_name: resolvedItemSup,
        supplierName: resolvedItemSup,
        supplier: resolvedItemSup,
        supplier_email_to: String(it.supplier_email_to ?? '').trim(),
        supplier_email_cc: String(it.supplier_email_cc ?? '').trim(),
        quantity: Number.isFinite(qtyVal) && qtyVal >= 1 ? Math.round(qtyVal) : 1,
        unit_name: String(it.unit_name || it.unit || 'pc').trim() || 'pc',
        price: Number.isFinite(netVal) && netVal >= 0 ? Number(netVal.toFixed(2)) : 0,
        price_with_vat: Number.isFinite(vatVal) && vatVal >= 0
          ? Number(vatVal.toFixed(2))
          : (Number.isFinite(netVal) && netVal >= 0 ? Number((netVal * 1.12).toFixed(2)) : 0),
        expiry_date: it.expiry_date ? String(it.expiry_date).slice(0, 10) : null
      };
    });
    const totalBatchQty = sumManifestQuantity(sanitizedItems, 1);
    updates.items = sanitizedItems;
    updates.total_items = sanitizedItems.length;
    updates.total_quantity = totalBatchQty;
    updates.quantity = totalBatchQty;
    updates.supplier_name = summarizeBatchSuppliers(sanitizedItems, fallbackSingleSup);
  } else if (Array.isArray(report.items) && report.items.length > 0 && (updates.supplier_name || updates.expiry_date !== undefined || u.supplier_email_to !== undefined || u.supplier_email_cc !== undefined)) {
    const existingDistinctSups = extractDistinctSuppliersFromItems(report.items);
    const hasMixedSups = existingDistinctSups.length > 1;
    updates.items = report.items.map((it) => {
      const shouldCascadeSup = updates.supplier_name && !isMixedSuppliersSummary(updates.supplier_name) && (!hasMixedSups || !isRealSupplierName(it.supplier_name));
      return {
        ...it,
        ...(shouldCascadeSup ? { supplier_name: updates.supplier_name, supplierName: updates.supplier_name, supplier: updates.supplier_name } : {}),
        ...(u.supplier_email_to !== undefined && !hasMixedSups ? { supplier_email_to: String(u.supplier_email_to || '').trim() } : {}),
        ...(u.supplier_email_cc !== undefined && !hasMixedSups ? { supplier_email_cc: String(u.supplier_email_cc || '').trim() } : {}),
        ...(updates.expiry_date !== undefined ? { expiry_date: updates.expiry_date } : {})
      };
    });
  }

  const prevMeta = (report.ai_document_metadata && typeof report.ai_document_metadata === 'object')
    ? report.ai_document_metadata
    : {};
  const prevFollowUp = (prevMeta.follow_up && typeof prevMeta.follow_up === 'object') ? prevMeta.follow_up : {};
  const nextItemEmails = (prevFollowUp.item_emails && typeof prevFollowUp.item_emails === 'object') ? { ...prevFollowUp.item_emails } : {};
  const nextBySup = (prevFollowUp.by_supplier && typeof prevFollowUp.by_supplier === 'object') ? { ...prevFollowUp.by_supplier } : {};

  if (Array.isArray(updates.items) && updates.items.length > 0) {
    updates.items.forEach((it, idx) => {
      const iKey = String(it.id || it.item_id || `line_${idx + 1}`).trim();
      const sName = String(it.supplier_name || '').trim();
      const sKey = normalizeSupplierGroupKey(sName);
      const sTo = String(it.supplier_email_to || '').trim();
      const sCc = String(it.supplier_email_cc || '').trim();
      if (sTo || sCc) {
        nextItemEmails[iKey] = { supplier_name: sName, supplier_email_to: sTo, supplier_email_cc: sCc };
        if (sKey !== '__unassigned__') {
          nextBySup[sKey] = { ...(nextBySup[sKey] || {}), supplier_name: sName, supplier_key: sKey, supplier_email_to: sTo, supplier_email_cc: sCc };
        }
      }
    });
  }
  const singleSupTo = u.supplier_email_to !== undefined ? String(u.supplier_email_to || '').trim() : prevFollowUp.supplier_email_to;
  const singleSupCc = u.supplier_email_cc !== undefined ? String(u.supplier_email_cc || '').trim() : prevFollowUp.supplier_email_cc;

  updates.ai_document_metadata = {
    ...prevMeta,
    ...(recordIsTest ? { is_test: true, test_mode: true } : {}),
    follow_up: {
      ...prevFollowUp,
      ...(u.supplier_email_to !== undefined ? { supplier_email_to: singleSupTo || '', supplier_email_cleared: !singleSupTo } : {}),
      ...(u.supplier_email_cc !== undefined ? { supplier_email_cc: singleSupCc || '' } : {}),
      item_emails: nextItemEmails,
      by_supplier: nextBySup
    },
    last_email_edit: {
      edited_by_email: userEmail,
      edited_at: nowIso,
      invite_token: inviteToken
    }
  };

  const existingAudit = Array.isArray(report.audit_trail) ? report.audit_trail : [];
  updates.audit_trail = [
    ...existingAudit,
    {
      timestamp: nowIso,
      stage: 'EMAIL_EDITOR_UPDATE',
      actor: `${userEmail} (Email Editor)`,
      note: `RMA details & commercial documents updated via Google Identity email-bound editor by ${userEmail}.`
    }
  ];
  updates.updated_at = nowIso;

  let payloadToApply = { ...updates };
  let updatedRecord = null;
  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from('rma_reports')
      .update(payloadToApply)
      .eq('id', report.id)
      .select()
      .single();

    if (!error && data) {
      updatedRecord = data;
      lastError = null;
      break;
    }

    lastError = error;
    const msg = String(error?.message || '');
    const colMatch =
      msg.match(/Could not find the '([^']+)' column/i) ||
      msg.match(/column rma_reports\.([a-zA-Z0-9_]+) does not exist/i);
    if (colMatch && colMatch[1] && colMatch[1] in payloadToApply) {
      delete payloadToApply[colMatch[1]];
      continue;
    }
    break;
  }

  if (lastError || !updatedRecord) {
    return sendJson(res, 500, {
      success: false,
      error: 'UPDATE_FAILED',
      message: lastError?.message || 'Failed to update RMA record.'
    }, req);
  }

  // Cascade commercial documents & per-item qty/supplier/details to child rma_reports & rma_items rows
  const childRows = found.allRows.filter((r) => r.parent_rma_id === report.id);
  const editedItemsList = Array.isArray(updates.items) ? updates.items : [];

  if (childRows.length > 0) {
    const commonChildDocPatch = {};
    if (updates.si_number !== undefined) commonChildDocPatch.si_number = updates.si_number;
    if (updates.dr_number !== undefined) commonChildDocPatch.dr_number = updates.dr_number;
    if (updates.po_number !== undefined) commonChildDocPatch.po_number = updates.po_number;
    if (updates.invoice_dr_number !== undefined) commonChildDocPatch.invoice_dr_number = updates.invoice_dr_number;
    if (updates.store_branch !== undefined) commonChildDocPatch.store_branch = updates.store_branch;

    if (editedItemsList.length > 0) {
      const sortedChildren = [...childRows].sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
      for (let i = 0; i < sortedChildren.length; i++) {
        const ch = sortedChildren[i];
        const matchedItem = editedItemsList.find((it) => (it.id != null && String(it.id) === String(ch.id)) || (it.barcode && ch.barcode && String(it.barcode).trim() === String(ch.barcode).trim())) || editedItemsList[i];
        const rowPatch = { ...commonChildDocPatch };
        if (matchedItem) {
          rowPatch.name = matchedItem.name;
          rowPatch.code = matchedItem.code || null;
          rowPatch.quantity = matchedItem.quantity;
          rowPatch.price = matchedItem.price;
          rowPatch.price_with_vat = matchedItem.price_with_vat;
          rowPatch.expiry_date = matchedItem.expiry_date || null;
          if (matchedItem.supplier_name) rowPatch.supplier_name = matchedItem.supplier_name;
        }
        if (Object.keys(rowPatch).length > 0 && ch.id) {
          await supabase.from('rma_reports').update(rowPatch).eq('id', ch.id).catch(() => {});
        }
      }
    } else {
      const childUpdates = { ...commonChildDocPatch };
      if (updates.supplier_name !== undefined && !isMixedSuppliersSummary(updates.supplier_name) && childRows.length === 1) {
        childUpdates.supplier_name = updates.supplier_name;
      }
      if (Object.keys(childUpdates).length > 0) {
        await supabase.from('rma_reports').update(childUpdates).eq('parent_rma_id', report.id).catch(() => {});
      }
    }
  }

  if (editedItemsList.length > 0 && report.id) {
    try {
      const { data: rmaItemRows } = await supabase
        .from('rma_items')
        .select('*')
        .eq('rma_report_id', report.id)
        .order('id', { ascending: true });
      if (Array.isArray(rmaItemRows) && rmaItemRows.length > 0) {
        for (let i = 0; i < rmaItemRows.length; i++) {
          const ri = rmaItemRows[i];
          const matchedItem = editedItemsList.find((it) => (it.id != null && String(it.id) === String(ri.id)) || (it.barcode && ri.barcode && String(it.barcode).trim() === String(ri.barcode).trim())) || editedItemsList[i];
          if (!matchedItem || !ri.id) continue;
          const riPatch = {
            name: matchedItem.name,
            sku: matchedItem.code || matchedItem.sku || null,
            quantity: matchedItem.quantity,
            price: matchedItem.price,
            price_with_vat: matchedItem.price_with_vat,
            expiry_date: matchedItem.expiry_date || null,
            ...(matchedItem.supplier_name ? { supplier_name: matchedItem.supplier_name } : {})
          };
          await supabase.from('rma_items').update(riPatch).eq('id', ri.id).catch(() => {});
        }
      }
    } catch {}
  }

  return sendJson(res, 200, {
    success: true,
    message: `RMA ${report.rma_number} updated successfully.`,
    edited_by_email: userEmail,
    updated_at: updatedRecord.updated_at || nowIso,
    report: {
      ...updatedRecord,
      ...(editedItemsList.length > 0 ? {
        items: editedItemsList,
        total_quantity: updates.total_quantity,
        quantity: updates.quantity
      } : {})
    }
  }, req);
}
