// Utility functions for RMA Portal

/**
 * Generate RMA Ticket ID matching format: RMA-2026-####-[4 alphanumeric chars]
 * Example: RMA-2026-0004-3YNZ
 */
export function generateTicketId(existingCount = 0) {
  const currentYear = new Date().getFullYear(); // e.g. 2026
  const seqNum = String(existingCount + 1).padStart(4, '0');
  
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // exclude ambiguous 0,1,I,O
  let randomSuffix = '';
  for (let i = 0; i < 4; i++) {
    randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return `RMA-${currentYear}-${seqNum}-${randomSuffix}`;
}

/**
 * Generate a provisional tracking identifier for unlabeled / missing-barcode items.
 * Example: NO-LABEL-2026-K9P2
 */
export function generateUnlabeledBarcode() {
  const currentYear = new Date().getFullYear();
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let randomSuffix = '';
  for (let i = 0; i < 4; i++) {
    randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `NO-LABEL-${currentYear}-${randomSuffix}`;
}

/**
 * Checks whether a barcode string is a provisional unlabeled tracking tag.
 */
export function isUnlabeledBarcode(barcode) {
  if (!barcode) return false;
  return /^NO-LABEL/i.test(String(barcode).trim());
}

/**
 * Automatically maps a user-selected defect reason to its corresponding condition grade.
 */
export function mapReasonToConditionGrade(reason) {
  if (!reason) return 'B - Damaged Packaging Only';
  const r = String(reason).toLowerCase();
  if (r.includes('wrong item') || r.includes('pull-out') || r.includes('unsold') || r.includes('resellable') || r.includes('like new') || r.includes('incorrect shipment')) {
    return 'A - Like New / Resellable';
  }
  if (r.includes('expired') || r.includes('expiry') || r.includes('spoiled') || r.includes('leaking') || r.includes('broken seal') || r.includes('total loss') || r.includes('scrap')) {
    return 'D - Total Loss / Scrap';
  }
  if (r.includes('factory defect') || r.includes('not working') || r.includes('parts only') || r.includes('other defect') || r.includes('defective')) {
    return 'C - Defective / Parts Only';
  }
  if (r.includes('box') || r.includes('packaging') || r.includes('crushed') || r.includes('dent') || r.includes('damaged box')) {
    return 'B - Damaged Packaging Only';
  }
  return 'B - Damaged Packaging Only';
}

/**
 * Warehouse scanner audio confirmation beep (Web Audio API)
 */
export function playBeep(type = 'success') {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1760, audioCtx.currentTime); // A6
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.12);
    } else if (type === 'increment') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1318.5, audioCtx.currentTime); // E6
      gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.09);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.09);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(350, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    }
  } catch (e) {
    // Audio context not allowed before gesture or not supported
    console.debug('Audio play skipped:', e);
  }
}

/**
 * Format Philippine Peso Currency (₱)
 */
export function formatPeso(amount) {
  const num = Number(amount) || 0;
  return '₱' + num.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Format email recipient based on Test Mode toggle
 * Appends .test to any email address if testMode is active
 */
export function applyEmailTestMode(email, isTestMode) {
  if (!email) return '';
  const clean = email.trim();
  if (!isTestMode) return clean;
  return 'finance2@keysysincorporated.com (Sandbox)';
}

/**
 * Compute the complete email routing payload for an RMA ticket
 */
export function getEmailRoutingPayload(ticket, isTestMode = false) {
  const isGroup1 = ticket.group && ticket.group.includes('KEYSYS');
  
  // Group 1 Routing
  if (isGroup1) {
    const sender = 'finance2@a2z2go.net';
    const rawTo = 'azgodev@gmail.com';
    const rawCC = [
      'mgan@a2z2go.net',
      'AZGan@a2z2go.net',
      'marketing@a2z2go.net',
      'jaezelle.benito@pingconmarketing.com',
      ticket.ae_email,
      ticket.supervisor_email
    ].filter(Boolean);

    return {
      groupName: 'Group 1 (KEYSYS & A2Z2GO)',
      sender,
      to: applyEmailTestMode(rawTo, isTestMode),
      cc: rawCC.map(email => applyEmailTestMode(email, isTestMode)),
      rawTo,
      rawCC,
      subject: `[RMA FILED] ${ticket.id} - ${ticket.customer_name} | ${ticket.product_name} (${ticket.quantity} units)`,
      isTestMode
    };
  }

  // Group 2 Routing (Default - Pingcon & Bonita)
  const sender = 'finance@pingconmarketing.com';
  const rawTo = 'azgodev@gmail.com';
  const rawCC = [
    'mgan@pingconmarketing.com',
    'AZGan@pingconmarketing.com',
    'marketing@pingconmarketing.com',
    'jaezelle.benito@pingconmarketing.com',
    ticket.ae_email,
    ticket.supervisor_email
  ].filter(Boolean);

  return {
    groupName: 'Group 2 (PINGCON & BONITA TISSUE)',
    sender,
    to: applyEmailTestMode(rawTo, isTestMode),
    cc: rawCC.map(email => applyEmailTestMode(email, isTestMode)),
    rawTo,
    rawCC,
    subject: `[RMA FILED] ${ticket.id} - ${ticket.customer_name} | ${ticket.product_name} (${ticket.quantity} units)`,
    isTestMode
  };
}

/**
 * Simulated AI Defect Diagnostics Generator
 */
export function generateAiDiagnosis(productName, defectCategory, photosCount = 0) {
  const pName = productName || 'Merchandise';
  const category = defectCategory || 'General Defect';

  const diagnoses = [
    `[AI Diagnostics: Verified 98.7% Confidence] Defect Category: ${category}. Spectral & structural scan reveals micro-fracture along primary carton corrugate and edge collapse. Product contents (${pName}) compromised by humidity ingress. Batch seal integrity breached. Unsellable for premium retail display. Recommendation: Immediate pull-out, issue Credit Memo, and forward batch lot to Quality Control.`,
    `[AI Diagnostics: Computer Vision Verified] Optical surface analysis detected crush deformities exceeding ISO-2233 drop-stress parameters. Retail packaging for ${pName} shows severe seal deformation. Internal hygiene/protective film violated. Recommended Action: Authorize Warehouse Inventory Buffer stock replenishment and supplier debit claim.`,
    `[AI Diagnostics: Automated Inspection Result] Batch defect inspection: Irregular dimensional tolerance detected on packaging unit. ${pName} failed retail shelf scanning alignment. Root cause traced to transit vibration fatigue during primary distributor logistics. Credit authorization approved pending repacker physical audit.`
  ];

  return diagnoses[Math.floor(Math.random() * diagnoses.length)];
}

/**
 * Helper to identify whether a ticket is a split child ticket (Part 2 of 2)
 * Robustly checks:
 * 1. RMA number ends with split suffix (e.g. -B, -C, -D)
 * 2. Or ticket explicitly references parent RMA ID with a split explanation/note
 */
export function isSplitChildTicket(item) {
  if (!item) return false;
  const num = String(item.rma_number || '');
  const hasSplitSuffix = /-[B-Z]$/i.test(num);
  const hasSplitNote = String(item.explanation || '').toLowerCase().includes('split from') || 
                       String(item.notes || '').toLowerCase().includes('split from parent');
  return Boolean(hasSplitSuffix || (item.parent_rma_id && hasSplitNote));
}

/**
 * Helper to identify whether a ticket is a split parent ticket (Part 1 of 2)
 */
export function isSplitParentTicket(item, allReports = []) {
  if (!item) return false;
  const num = String(item.rma_number || '');
  if (/-[B-Z]$/i.test(num)) return false; // Child cannot be parent Part 1
  const hasChildInList = Array.isArray(allReports) && allReports.some(other => (
    (other.parent_rma_id === item.id || String(other.parent_rma_id) === String(item.id)) &&
    other.rma_number !== item.rma_number &&
    /-[B-Z]$/i.test(String(other.rma_number || ''))
  ));
  const hasSplitAudit = Array.isArray(item.audit_trail) && item.audit_trail.some(a => a.stage === 'SPLIT_EXECUTED');
  const hasSplitNotes = String(item.notes || '').includes('Split: Kept');
  return Boolean(hasChildInList || hasSplitAudit || hasSplitNotes);
}

/**
 * Validates whether a return report or product has an official assigned SKU and non-zero unit price.
 * Barcode and SKU are strictly distinct:
 * - A barcode value (e.g. 214124124) is NOT a valid SKU.
 * - Placeholders like "Awaiting SKU" or "Unidentified" are NOT valid SKUs.
 * - Unit price must be > 0.
 * Used as a Financial Validation & Safety Guard for Credit Memos & Claims.
 */
export function hasAssignedSku(report, savedProductsList = []) {
  if (!report) return false;
  const barcodeStr = report.barcode ? String(report.barcode).trim() : '';

  // Look up matched catalog product if available
  const matched = (barcodeStr && Array.isArray(savedProductsList))
    ? savedProductsList.find(p => p.barcode && String(p.barcode).trim() === barcodeStr)
    : null;

  // Check matched product SKU
  const matchedCode = matched?.code || matched?.sku || '';
  const matchedCodeStr = String(matchedCode).trim();
  const isMatchedCodeValid = Boolean(
    matchedCodeStr &&
    matchedCodeStr !== barcodeStr &&
    !matchedCodeStr.toLowerCase().includes('awaiting') &&
    !matchedCodeStr.toLowerCase().includes('unidentified')
  );

  // Check report SKU
  const reportCode = report.code || report.sku || '';
  const reportCodeStr = String(reportCode).trim();
  const isReportCodeValid = Boolean(
    reportCodeStr &&
    reportCodeStr !== barcodeStr &&
    !reportCodeStr.toLowerCase().includes('awaiting') &&
    !reportCodeStr.toLowerCase().includes('unidentified')
  );

  // Must have a real SKU assigned either directly on report or in catalog
  const hasValidSku = isMatchedCodeValid || isReportCodeValid;
  if (!hasValidSku) return false;

  // Price validation: Credit memo / claim requires price > 0
  const price = Number(report.price_with_vat ?? report.price ?? matched?.price_with_vat ?? matched?.price ?? 0);
  if (price <= 0) return false;

  return true;
}

/**
 * Safely extracts child line items from a batch manifest report
 */
export function getReportManifestItems(report, allReports = []) {
  if (!report) return [];
  if (Array.isArray(report.items) && report.items.length > 0) return report.items;
  if (typeof report.items === 'string' && report.items.trim()) {
    try {
      const parsed = JSON.parse(report.items);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (e) {}
  }
  if (Array.isArray(allReports) && allReports.length > 0 && report.id) {
    const children = allReports.filter(r => (
      (r.parent_rma_id === report.id || String(r.parent_rma_id) === String(report.id)) &&
      r.id !== report.id &&
      !r.is_parent
    ));
    if (children.length > 0) return children;
  }
  // Robust fallback: Match child records by rma_number if parent_rma_id was unpopulated
  if (Array.isArray(allReports) && allReports.length > 0 && report.rma_number) {
    const childrenByRma = allReports.filter(r => (
      r &&
      r.rma_number === report.rma_number &&
      r.id !== report.id &&
      !r.is_parent &&
      r.barcode !== report.barcode
    ));
    if (childrenByRma.length > 0) return childrenByRma;
  }
  return [];
}

/**
 * Checks whether an RMA return ticket is a multi-item batch manifest
 */
export function isBatchManifest(report, allReports = []) {
  if (!report) return false;
  if (report.is_parent) return true;
  const items = getReportManifestItems(report, allReports);
  if (items.length > 1) return true;
  const nameStr = String(report.name || '');
  if (nameStr.toLowerCase().startsWith('batch return manifest')) return true;
  return false;
}

/**
 * Checks if a report item is a child line item of a batch manifest
 */
export function isManifestSubItem(item, allReports = []) {
  if (!item) return false;
  // Standalone split tickets (e.g. -B, -C, -D) must ALWAYS be visible in the table
  if (/-(?:B|C|D|E)$/i.test(String(item.rma_number || ''))) {
    return false;
  }
  // Only collapse child items that share the EXACT same rma_number as an existing parent manifest container
  if (Array.isArray(allReports) && item.rma_number) {
    const parent = allReports.find(p => (
      p && p.rma_number === item.rma_number &&
      (p.is_parent === true || String(p.name || '').toLowerCase().startsWith('batch return manifest'))
    ));
    if (parent && String(parent.id) !== String(item.id)) {
      return true;
    }
  }
  return false;
}

/**
 * Safely extracts clean SKU decoupling it strictly from barcode.
 * Returns empty string if sku matches barcode, or is empty/placeholder.
 */
export function getCleanSku(skuOrCode, barcode) {
  if (!skuOrCode) return '';
  const cleanCode = String(skuOrCode).trim();
  const cleanBarcode = String(barcode || '').trim();
  if (cleanBarcode && cleanCode === cleanBarcode) return '';
  if (cleanCode.toLowerCase().includes('awaiting') || cleanCode.toLowerCase().includes('unidentified')) return '';
  return cleanCode;
}

/**
 * Format quantity and unit, appending pack size when unit is 'case' and pieces_per_case is available
 */
export function formatQuantityWithPackSize(quantity, unitName, piecesPerCase) {
  const qty = Number(quantity) || 1;
  const unit = String(unitName || 'pc').trim().toLowerCase();
  const pcs = Number(piecesPerCase || 0);

  if ((unit === 'case' || unit === 'cases' || unit === 'cs') && pcs > 0) {
    const totalPcs = qty * pcs;
    return `${qty} case${qty === 1 ? '' : 's'} (${totalPcs} pcs total)`;
  }
  return `${qty} ${unitName || 'pc'}`;
}

/**
 * Formats a multi-item manifest quantity breakdown by UOM without summing mixed units.
 * e.g., "3 Line Items (2 pcs, 24 cases)" or "2 pcs, 24 cases"
 */
export function formatManifestBreakdown(items = [], includeLineCount = true) {
  if (!Array.isArray(items) || items.length === 0) {
    return includeLineCount ? '0 Line Items' : '0 pcs';
  }
  let totalPcs = 0;
  let totalCases = 0;
  const otherUnits = {};

  items.forEach(it => {
    const q = Number(it?.quantity ?? it?.qty) || 1;
    const rawUnit = String(it?.unit_name || it?.unit || 'pc').trim().toLowerCase();
    if (rawUnit === 'case' || rawUnit === 'cases' || rawUnit === 'cs') {
      totalCases += q;
    } else if (rawUnit === 'pc' || rawUnit === 'pcs' || rawUnit === 'piece' || rawUnit === 'pieces' || !rawUnit) {
      totalPcs += q;
    } else {
      otherUnits[rawUnit] = (otherUnits[rawUnit] || 0) + q;
    }
  });

  const parts = [];
  if (totalPcs > 0) {
    parts.push(`${totalPcs} ${totalPcs === 1 ? 'pc' : 'pcs'}`);
  }
  if (totalCases > 0) {
    parts.push(`${totalCases} ${totalCases === 1 ? 'case' : 'cases'}`);
  }
  Object.entries(otherUnits).forEach(([u, count]) => {
    parts.push(`${count} ${u}`);
  });

  const breakdownStr = parts.join(', ') || '1 pc';
  if (includeLineCount) {
    return `${items.length} Line Item${items.length === 1 ? '' : 's'} (${breakdownStr})`;
  }
  return breakdownStr;
}

/**
 * Dynamically resolves parent batch manifest lifecycle status from child line item dispositions.
 * - All child items 'Restock to Inventory' -> '6- Restocked' (status: 'restocked')
 * - All child items 'Scrap / Dispose' -> '7- Scrapped / Disposed' (status: 'scrapped')
 * - Child items have mixed completed dispositions -> 'Partially Completed' (status: 'partially_completed')
 * - Child items are pending inspection -> '3- Under Inspection' (status: 'under_inspection')
 */
export function resolveBatchManifestLifecycle(report, allReports = []) {
  if (
    String(report?.status || '').toLowerCase() === 'picked_up' ||
    Boolean(report?.ai_document_metadata?.supplier_pickup?.picked_up_at)
  ) {
    return {
      status: 'picked_up',
      label: '🚚 Picked Up',
      color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
    };
  }

  const items = getReportManifestItems(report, allReports);
  if (!Array.isArray(items) || items.length === 0) {
    return {
      status: 'under_inspection',
      label: '3- Under Inspection',
      color: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border-amber-200 dark:border-amber-800'
    };
  }

  let restockCount = 0;
  let scrapCount = 0;
  let pendingCount = 0;
  let otherCompletedCount = 0;

  items.forEach(child => {
    const disp = String(child?.disposition || '').toLowerCase().trim();
    const st = String(child?.status || '').toLowerCase().trim();

    if (disp.includes('restock') || disp.includes('replacement stock received') || st === 'restocked') {
      restockCount += 1;
    } else if (disp.includes('scrap') || disp.includes('dispose') || st === 'scrapped' || st === 'disposed') {
      scrapCount += 1;
    } else if (
      (!disp || disp.includes('pending triage') || disp.includes('pending vendor pickup') || disp === 'pending') &&
      st !== 'credit_memo_issued' &&
      st !== 'buffer_replacement_dispatched'
    ) {
      pendingCount += 1;
    } else {
      otherCompletedCount += 1;
    }
  });

  const total = items.length;

  if (restockCount === total) {
    return {
      status: 'restocked',
      label: '6- Restocked',
      color: 'bg-teal-100 text-teal-800 dark:bg-teal-950/70 dark:text-teal-300 border-teal-200 dark:border-teal-800'
    };
  }

  if (scrapCount === total) {
    return {
      status: 'scrapped',
      label: '7- Scrapped / Disposed',
      color: 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border-rose-200 dark:border-rose-800'
    };
  }

  if (pendingCount === total) {
    return {
      status: 'under_inspection',
      label: '3- Under Inspection',
      color: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border-amber-200 dark:border-amber-800'
    };
  }

  return {
    status: 'partially_completed',
    label: 'Partially Completed',
    color: 'bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border-purple-300 dark:border-purple-800'
  };
}

/**
 * Strips internal operational bracket tags (e.g. [REORDER: NO], [HOLD REASON: ...], [REJECTED: ...])
 * from customer explanation or notes strings so UI displays clean human-readable text.
 */
export function cleanExplanationText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\s*\[(REORDER|HOLD REASON|REJECTED):[^\]]*\]/gi, '')
    .trim();
}

/**
 * Standardized Lifecycle Stage Formatter supporting 4-Pillar Resolutions
 */
export function formatLifecycleStage(status, item = null) {
  if (
    item?.ai_document_metadata?.supplier_pickup?.picked_up_at &&
    !['closed', 'resolved', 'restocked', 'scrapped', 'disposed', 'credit_memo_issued'].includes(String(status || '').toLowerCase())
  ) {
    return { label: '🚚 Picked Up', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700' };
  }
  if (!status) return { label: '2- Received at Dock', color: 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300 border-blue-200 dark:border-blue-800' };
  const s = String(status).toLowerCase();

  if (s === 'resolved' || s === 'closed') {
    const resolution = item?.ai_document_metadata?.workflow_resolution;
    const disp = String(item?.disposition || '').toLowerCase();
    if (resolution === 'reordered') {
      return { label: '7- Re-Ordered (PO Placed)', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' };
    }
    if (resolution === 'scrapped_no_reorder' || (!resolution && (disp.includes('scrap') || disp.includes('dispose')))) {
      return { label: '7- Scrapped / Written Off', color: 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border-rose-200 dark:border-rose-800' };
    }
    if (resolution === 'restocked' || (!resolution && (disp.includes('restock') || disp.includes('replacement')))) {
      return { label: '6- Restocked', color: 'bg-teal-100 text-teal-800 dark:bg-teal-950/70 dark:text-teal-300 border-teal-200 dark:border-teal-800' };
    }
    return { label: '6- Restocked', color: 'bg-teal-100 text-teal-800 dark:bg-teal-950/70 dark:text-teal-300 border-teal-200 dark:border-teal-800' };
  }

  switch (s) {
    case 'draft':
      return { label: '1- Draft / Intake', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700' };
    case 'pending':
    case 'received_at_dock':
      return { label: '2- Received at Dock', color: 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300 border-blue-200 dark:border-blue-800' };
    case 'under_inspection':
      return { label: '3- Under Inspection', color: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border-amber-200 dark:border-amber-800' };
    case 'pending_finance_approval':
      return { label: '4- Pending Finance Approval', color: 'bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border-purple-200 dark:border-purple-800' };
    case 'credit_memo_issued':
      return { label: '5- Credit Memo Issued', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' };
    case 'restocked':
      return { label: '6- Restocked', color: 'bg-teal-100 text-teal-800 dark:bg-teal-950/70 dark:text-teal-300 border-teal-200 dark:border-teal-800' };
    case 'scrapped':
    case 'disposed':
      return { label: '7- Scrapped / Disposed', color: 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border-rose-200 dark:border-rose-800' };
    case 'partially_completed':
      return { label: 'Partially Completed', color: 'bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border-purple-300 dark:border-purple-800' };
    case 'buffer_replacement_dispatched':
    case 'buffer_dispatched':
      return { label: '🚚 Buffer Dispatched', color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800' };
    case 'picked_up':
    case 'picked_up_by_supplier':
      return { label: '🚚 Picked Up', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700' };
    case 'rejected':
      return { label: '8- Rejected / Invalid Claim', color: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700' };
    case 'vendor_claimed':
      return { label: 'RTV Claimed', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700' };
    case 'pending_admin_details':
      return { label: 'Awaiting SKU', color: 'bg-orange-100 text-orange-800 dark:bg-orange-950/70 dark:text-orange-300 border-orange-200 dark:border-orange-800' };
    default:
      return { label: s.replace(/_/g, ' '), color: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-300' };
  }
}

/**
 * Resolves the explicit or inferred purchasing replenishment flag (needs_reorder).
 * Returns true if the lost stock should be reordered from supplier, false otherwise.
 */
export function getItemNeedsReorder(item) {
  if (item?.needs_reorder !== undefined && item?.needs_reorder !== null) {
    return Boolean(item.needs_reorder);
  }
  if (item?.ai_document_metadata?.needs_reorder !== undefined && item?.ai_document_metadata?.needs_reorder !== null) {
    return Boolean(item.ai_document_metadata.needs_reorder);
  }
  const notes = String(item?.notes || '');
  if (notes.includes('[REORDER: NO]')) return false;
  if (notes.includes('[REORDER: YES]')) return true;
  // Default for Scrap / RTV / Buffer Swap / Vendor Rejected is true
  return true;
}

/**
 * Computes recovery source for items flagged for replenishment: 'scrap' | 'vendor_rtv' | 'buffer_swap'
 */
export function getRecoverySource(item) {
  const disp = String(item?.disposition || '').toLowerCase();
  if (disp.includes('buffer')) return 'buffer_swap';
  if (disp.includes('rtv') || disp.includes('vendor') || item?.rma_type === 'supplier_outbound') return 'vendor_rtv';
  return 'scrap';
}

/**
 * Helper to check if an item (or child items in a batch manifest) belongs to the Ready to Restock queue:
 * disposition: 'Restock to Inventory' OR 'Vendor Replacement Stock Received'
 * and status !== 'restocked' and not finalized/resolved.
 */
export function isItemReadyToRestock(item, allReports = []) {
  if (!item) return false;
  if (!item.is_unpacked_manifest_item && (item.is_parent || (Array.isArray(item.items) && item.items.length > 1))) {
    const children = Array.isArray(item.items) && item.items.length > 0 ? item.items : [];
    return children.some(c => isItemReadyToRestock(c, allReports));
  }
  const disp = String(item.disposition || '').toLowerCase();
  const st = String(item.status || '').toLowerCase();
  const resolution = item?.ai_document_metadata?.workflow_resolution;
  if (resolution || ['restocked', 'closed', 'resolved', 'scrapped', 'disposed', 'rejected'].includes(st)) {
    return false;
  }
  const isRestockDisp = disp.includes('restock') || disp.includes('replacement stock received');
  return isRestockDisp;
}

/**
 * Helper to check if an item belongs to the Re-Order Needed queue:
 * disposition: Scrap / RTV / Buffer Swap / Claim Rejected by Vendor
 * AND needs_reorder !== false
 * AND not finalized/resolved.
 */
export function isItemReorderNeeded(item, allReports = []) {
  if (!item) return false;
  if (!item.is_unpacked_manifest_item && (item.is_parent || (Array.isArray(item.items) && item.items.length > 1))) {
    const children = Array.isArray(item.items) && item.items.length > 0 ? item.items : [];
    return children.some(c => isItemReorderNeeded(c, allReports));
  }
  const disp = String(item.disposition || '').toLowerCase();
  const st = String(item.status || '').toLowerCase();
  const resolution = item?.ai_document_metadata?.workflow_resolution;
  if (resolution || ['scrapped', 'disposed', 'closed', 'resolved', 'restocked', 'rejected'].includes(st)) {
    return false;
  }

  if (
    disp.includes('restock') ||
    disp.includes('replacement stock received') ||
    disp.includes('quarantine') ||
    disp.includes('hold') ||
    st === 'rejected' ||
    disp.includes('8- rejected')
  ) {
    return false;
  }

  const isLossDisp =
    disp.includes('scrap') ||
    disp.includes('dispose') ||
    disp.includes('reorder') ||
    disp.includes('rtv') ||
    disp.includes('vendor') ||
    disp.includes('buffer') ||
    disp.includes('claim rejected by vendor') ||
    disp.includes('pending vendor pickup');

  const needsReorder = getItemNeedsReorder(item);
  return isLossDisp && needsReorder !== false;
}

/**
 * Helper to check if an item is Scrapped with No Re-Order / Write-Off:
 * Any item in Scrap, RTV, Pending Vendor Pickup, Buffer Swap, or Vendor Rejected
 * where needs_reorder === false AND not finalized/resolved.
 */
export function isItemScrappedNoReorder(item, allReports = []) {
  if (!item) return false;
  if (!item.is_unpacked_manifest_item && (item.is_parent || (Array.isArray(item.items) && item.items.length > 1))) {
    const children = Array.isArray(item.items) && item.items.length > 0 ? item.items : [];
    return children.some(c => isItemScrappedNoReorder(c, allReports));
  }
  const disp = String(item.disposition || '').toLowerCase();
  const st = String(item.status || '').toLowerCase();
  const resolution = item?.ai_document_metadata?.workflow_resolution;
  if (resolution || ['scrapped', 'disposed', 'closed', 'resolved', 'rejected', 'restocked'].includes(st)) {
    return false;
  }

  if (
    disp.includes('restock') ||
    disp.includes('replacement stock received') ||
    disp.includes('quarantine') ||
    disp.includes('hold') ||
    st === 'rejected' ||
    disp.includes('8- rejected')
  ) {
    return false;
  }

  const isLossDisp =
    disp.includes('scrap') ||
    disp.includes('dispose') ||
    disp.includes('reorder') ||
    disp.includes('rtv') ||
    disp.includes('vendor') ||
    disp.includes('buffer') ||
    disp.includes('claim rejected by vendor') ||
    disp.includes('pending vendor pickup');

  const needsReorder = getItemNeedsReorder(item);
  return isLossDisp && needsReorder === false;
}

/**
 * Helper to check if an item is On Hold / Quarantine:
 * disposition includes Quarantine or Hold or status is quarantine / hold
 */
export function isItemOnHold(item, allReports = []) {
  if (!item) return false;
  if (!item.is_unpacked_manifest_item && (item.is_parent || (Array.isArray(item.items) && item.items.length > 1))) {
    const children = Array.isArray(item.items) && item.items.length > 0 ? item.items : [];
    return children.some(c => isItemOnHold(c, allReports));
  }
  const disp = String(item.disposition || '').toLowerCase();
  const st = String(item.status || '').toLowerCase();
  return (disp.includes('quarantine') || disp.includes('hold') || st === 'quarantine' || st === 'hold') && !['closed', 'resolved', 'rejected', 'deleted'].includes(st);
}

/**
 * Helper to check if an item is Rejected:
 * status === 'rejected' OR disposition includes '8- Rejected / Return to Customer' OR 'Claim Rejected by Vendor'
 */
export function isItemRejected(item, allReports = []) {
  if (!item) return false;
  if (!item.is_unpacked_manifest_item && (item.is_parent || (Array.isArray(item.items) && item.items.length > 1))) {
    const children = Array.isArray(item.items) && item.items.length > 0 ? item.items : [];
    return children.some(c => isItemRejected(c, allReports));
  }
  const disp = String(item.disposition || '').toLowerCase();
  const st = String(item.status || '').toLowerCase();
  return (st === 'rejected' || disp.includes('8- rejected') || disp.includes('claim rejected by vendor')) && !['closed', 'resolved', 'deleted'].includes(st);
}

/**
 * Filter out fake Unsplash stock photos and parse input cleanly.
 */
export function getRealPhotos(photosInput) {
  if (!photosInput) return [];
  let list = [];
  if (Array.isArray(photosInput)) {
    list = photosInput;
  } else if (typeof photosInput === 'string') {
    const trimmed = photosInput.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        list = JSON.parse(trimmed);
      } catch (e) {
        list = [trimmed];
      }
    } else if (trimmed) {
      list = [trimmed];
    }
  }
  return list.filter(url => typeof url === 'string' && url.trim().length > 0 && !url.includes('images.unsplash.com'));
}

/**
 * Standardized, Plain-English Warehouse Locations
 */
export const DEFAULT_WAREHOUSE_LOCATIONS = [
  'Receiving Area',
  'Good Stock Area',
  'Supplier Return Area (RTV)',
  'Customer Return Area',
  'Hold / Inspection Area',
  'Disposal / Scrap Area'
];

/**
 * Map legacy or messy location strings to clean, standard names.
 */
export function normalizeWarehouseLocation(loc, item = null) {
  const raw = String(loc || '').trim();
  const isSupplierOutbound = item?.rma_type === 'supplier_outbound' || 
    String(item?.disposition || '').toLowerCase().includes('rtv') || 
    String(item?.disposition || '').toLowerCase().includes('vendor');

  if (!raw || raw === '—' || raw === 'N/A' || raw.toLowerCase() === 'dock' || raw.toLowerCase() === 'dock-intake' || raw.toLowerCase() === 'rtv-dock') {
    return isSupplierOutbound ? 'Supplier Return Area (RTV)' : 'Receiving Area';
  }

  const upper = raw.toUpperCase();
  if (upper.includes('SCRAP') || upper.includes('DISPOS')) return 'Disposal / Scrap Area';
  if (upper.includes('QUARANTINE') || upper.includes('HOLD') || upper.includes('INSPECT')) return 'Hold / Inspection Area';
  if (upper.includes('OUTBOUND-RETURN') || upper.includes('CUSTOMER RETURN') || upper.includes('STORE')) return 'Customer Return Area';
  if (upper.includes('GOOD STOCK') || upper.includes('SHELF') || upper.includes('RESTOCK')) return 'Good Stock Area';
  if (upper.includes('SUPPLIER') || upper.includes('RTV') || upper.includes('VENDOR')) return 'Supplier Return Area (RTV)';
  if (upper.includes('RECEIV') || upper.includes('DOCK')) return 'Receiving Area';

  return raw;
}

/**
 * Load customized warehouse locations from localStorage (with fallback).
 */
export function getWarehouseLocations() {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('rma_warehouse_locations');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to parse stored warehouse locations:', e);
    }
  }
  return [...DEFAULT_WAREHOUSE_LOCATIONS];
}

/**
 * Save customized warehouse locations to localStorage and broadcast change.
 */
export function saveWarehouseLocations(list) {
  if (!Array.isArray(list) || list.length === 0) return;
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('rma_warehouse_locations', JSON.stringify(list));
      window.dispatchEvent(new CustomEvent('rma-locations-changed', { detail: { locations: list } }));
    } catch (e) {
      console.warn('Failed to save warehouse locations:', e);
    }
  }
}

/**
 * Test Mode helper: Check if an RMA report, Credit Memo, or Supplier Claim is a sandbox test record.
 */
export function isTestRecord(item) {
  if (!item) return false;
  const rmaNum = String(item.rma_number || item.rmaNumber || '');
  const cmNum = String(item.credit_memo_number || item.creditMemoNumber || '');
  const rtvNum = String(item.claim_number || item.claimNumber || '');
  const itemArrayHasTestRef = Array.isArray(item.items) && item.items.some((sub) =>
    /^RMA-TEST-/i.test(String(sub?.rma_number || sub?.rmaNumber || '')) ||
    sub?.is_test === true ||
    sub?.test_mode === true ||
    sub?.ai_document_metadata?.is_test === true ||
    sub?.ai_document_metadata?.test_mode === true
  );
  return Boolean(
    item.is_test === true ||
    item.test_mode === true ||
    item.ai_document_metadata?.is_test === true ||
    item.ai_document_metadata?.test_mode === true ||
    String(item.notes || '').includes('[TEST_MODE]') ||
    /^RMA-TEST-/i.test(rmaNum) ||
    /^CM-TEST-/i.test(cmNum) ||
    /^RTV-TEST-/i.test(rtvNum) ||
    itemArrayHasTestRef
  );
}

export const DEFECT_REASONS = [
  '1- Damaged Box / Crushed Packaging',
  '2- Expired / Near Expiry Date',
  '3- Spoiled / Broken Seal / Leaking',
  '4- Wrong Item / Incorrect Shipment',
  '5- Customer Pull-out / Unsold',
  '6- Other Defect'
];

/**
 * Resolve cleanly separated SI / DR / PO document numbers with legacy fallback.
 */
export function getDocumentNumbers(item) {
  if (!item) return { si: 'N/A', dr: 'N/A', po: 'N/A' };

  let si = item.si_number ? String(item.si_number).trim() : null;
  let dr = item.dr_number ? String(item.dr_number).trim() : null;
  let po = item.po_number ? String(item.po_number).trim() : null;

  const legacy = item.invoice_dr_number ? String(item.invoice_dr_number).trim() : null;
  if (legacy) {
    if (!si && /^SI/i.test(legacy)) {
      si = legacy;
    } else if (!po && /^PO/i.test(legacy)) {
      po = legacy;
    } else if (!dr && !si && !po) {
      dr = legacy;
    }
  }

  return {
    si: si || 'N/A',
    dr: dr || 'N/A',
    po: po || 'N/A'
  };
}

/**
 * Generates an internal, non-URL QR payload scoped cleanly by mode (TEST vs LIVE).
 * Prevents external Google Lens / standard phone camera scanners from opening portal routes.
 */
export function buildPortalQrPayload(rmaNumber, isTestMode = false) {
  const cleanRma = String(rmaNumber || '').trim();
  if (!cleanRma) return '';
  const inferredTest = Boolean(isTestMode || /^RMA-TEST-/i.test(cleanRma));
  const scope = inferredTest ? 'TEST' : 'LIVE';
  return `PINGCON-RMA:${scope}:${cleanRma}`;
}

/**
 * Parses an internal portal QR code or legacy RMA scan into normalized RMA identity + mode.
 * Returns null if the scanned code is a regular product barcode.
 */
export function parsePortalQrPayload(rawText) {
  if (!rawText) return null;
  const str = String(rawText).trim();

  // Preferred internal format: PINGCON-RMA:TEST:<RMA> or PINGCON-RMA:LIVE:<RMA>
  const privateMatch = str.match(/^PINGCON-RMA:(TEST|LIVE):(.+)$/i);
  if (privateMatch) {
    const scope = privateMatch[1].toUpperCase();
    const rmaNumber = privateMatch[2].trim();
    if (!rmaNumber) return null;
    return {
      rmaNumber,
      qrMode: scope === 'TEST' ? 'test' : 'live',
      isPrivatePayload: true
    };
  }

  // Legacy URL or JSON or raw RMA string formats (fallback for older printed labels)
  if (str.includes('rma=') || str.includes('rma_number=')) {
    try {
      const url = new URL(str.startsWith('http') ? str : `https://example.com/${str.replace(/^\/?/, '')}`);
      const val = url.searchParams.get('rma') || url.searchParams.get('rma_number');
      if (val) {
        return {
          rmaNumber: val.trim(),
          qrMode: /^RMA-TEST-/i.test(val.trim()) ? 'test' : 'live',
          isPrivatePayload: false
        };
      }
    } catch { }
  }

  if (str.startsWith('{') && str.endsWith('}')) {
    try {
      const parsed = JSON.parse(str);
      if (parsed.rma) {
        const clean = String(parsed.rma).trim();
        return {
          rmaNumber: clean,
          qrMode: (parsed.mode === 'test' || /^RMA-TEST-/i.test(clean)) ? 'test' : 'live',
          isPrivatePayload: true
        };
      }
    } catch { }
  }

  if (/^RMA-TEST-/i.test(str) || /^RMA-\d{4}-\d+/i.test(str) || /^RMA-/i.test(str)) {
    return {
      rmaNumber: str,
      qrMode: /^RMA-TEST-/i.test(str) ? 'test' : 'live',
      isPrivatePayload: false
    };
  }

  return null;
}

/**
 * Extracts a Google Drive folder ID from either a raw folder ID or folder URL.
 */
export function extractGoogleDriveFolderId(folderUrlOrId) {
  if (!folderUrlOrId) return null;
  const s = String(folderUrlOrId).trim();
  if (!s) return null;
  const match = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) return match[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(s) && !s.includes('http')) return s;
  return null;
}

/**
 * Trash helper: Check if an item is moved to 30-day soft trash bin.
 */
export function isTrashedRecord(item) {
  if (!item) return false;
  return Boolean(
    item.is_trashed === true ||
    item.ai_document_metadata?.is_trashed === true ||
    String(item.notes || '').includes('[TRASHED]')
  );
}

/**
 * Archive helper: Check if an item is stored in the Enterprise Archive Vault.
 */
export function isArchivedRecord(item) {
  if (!item) return false;
  if (isTrashedRecord(item)) return false;
  return Boolean(
    item.is_archived === true ||
    item.ai_document_metadata?.is_archived === true ||
    String(item.notes || '').includes('[ARCHIVED]')
  );
}

/**
 * Calculate remaining days before 30-day auto-purge for trashed items.
 */
export function getTrashDaysRemaining(item) {
  if (!item) return 0;
  const purgeAfterStr = item.purge_after || item.ai_document_metadata?.purge_after;
  const trashedAtStr = item.trashed_at || item.ai_document_metadata?.trashed_at;
  let targetDate;
  if (purgeAfterStr) {
    targetDate = new Date(purgeAfterStr).getTime();
  } else if (trashedAtStr) {
    targetDate = new Date(trashedAtStr).getTime() + (30 * 24 * 60 * 60 * 1000);
  } else {
    return 30;
  }
  const diffMs = targetDate - Date.now();
  const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  return days > 0 ? days : 0;
}

/**
 * Resolve piece conversion & monetary totals for a single RMA item or manifest child.
 * Converts case/box/carton quantities to pieces using pieces_per_case (or pack-size patterns like x24).
 */
export function computeItemPiecesAndValue(item, catalogProducts = []) {
  if (!item) {
    return {
      rawQty: 0,
      unitName: 'pc',
      isCaseUnit: false,
      piecesPerCase: 1,
      totalPieces: 0,
      recordedUnitPrice: 0,
      pricePerPiece: 0,
      lineTotal: 0
    };
  }

  const rawQty = Math.max(0, Number(item.quantity) || 0);
  const unitName = String(item.unit_name || item.unit || 'pc').trim() || 'pc';
  const unitLower = unitName.toLowerCase();
  const isCaseUnit =
    /^(case|cs|box|bx|ctn|carton|pack|pk|tray|sack|bag|bndl|bundle)s?$/i.test(unitLower) ||
    unitLower.includes('case') ||
    unitLower.includes('carton') ||
    unitLower.includes('box') ||
    unitLower.includes('pack');

  let matchedProduct = null;
  if (Array.isArray(catalogProducts) && catalogProducts.length > 0) {
    const itemBc = String(item.barcode || '').trim();
    const itemSku = String(item.code || item.sku || '').trim();
    matchedProduct = catalogProducts.find((p) => (
      (itemBc && String(p.barcode || '').trim() === itemBc) ||
      (itemSku && String(p.code || p.sku || '').trim() === itemSku)
    )) || null;
  }

  let piecesPerCase = Number(
    item.pieces_per_case ||
    item.piecesPerCase ||
    matchedProduct?.pieces_per_case ||
    matchedProduct?.piecesPerCase ||
    0
  );

  if (!piecesPerCase || piecesPerCase <= 0) {
    const nameStr = String(item.name || item.product_name || matchedProduct?.name || '');
    const packMatch =
      nameStr.match(/\bx\s*(\d+)\b/i) ||
      nameStr.match(/(\d+)\s*(?:pcs|pc|s)\b/i);
    if (packMatch) {
      const parsed = parseInt(packMatch[1], 10);
      if (Number.isFinite(parsed) && parsed > 1) piecesPerCase = parsed;
    }
  }
  if (!piecesPerCase || piecesPerCase <= 0) piecesPerCase = 1;

  const totalPieces = isCaseUnit && piecesPerCase > 1
    ? rawQty * piecesPerCase
    : rawQty;

  const recordedUnitPrice = Number(
    item.price_with_vat ??
    item.price ??
    item.unit_price ??
    matchedProduct?.price_with_vat ??
    matchedProduct?.price ??
    0
  ) || 0;

  const lineTotal = Number((rawQty * recordedUnitPrice).toFixed(2));
  const pricePerPiece = totalPieces > 0
    ? Number((lineTotal / totalPieces).toFixed(4))
    : recordedUnitPrice;

  return {
    rawQty,
    unitName,
    isCaseUnit,
    piecesPerCase,
    totalPieces,
    recordedUnitPrice,
    pricePerPiece,
    lineTotal
  };
}

