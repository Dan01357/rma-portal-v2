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
  // 1. Any item that has parent_rma_id populated is strictly a child item of a manifest
  if (item.parent_rma_id !== null && item.parent_rma_id !== undefined && String(item.parent_rma_id).trim() !== '') {
    return true;
  }
  // 2. If an item shares rma_number with a parent batch manifest, but is NOT the parent container itself
  if (Array.isArray(allReports) && item.rma_number) {
    const parent = allReports.find(p => (
      p &&
      p.rma_number === item.rma_number &&
      (p.is_parent === true || (Array.isArray(p.items) && p.items.length > 0) || String(p.name || '').toLowerCase().startsWith('batch return manifest'))
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
 * Example: "6 case (24 pcs/cs = 144 pcs total)"
 */
export function formatQuantityWithPackSize(quantity, unitName, piecesPerCase) {
  const qty = Number(quantity) || 1;
  const unit = String(unitName || 'pc').trim();
  const pcs = Number(piecesPerCase || 0);

  const isCase = unit.toLowerCase() === 'case' || unit.toLowerCase() === 'cases' || unit.toLowerCase() === 'cs';
  if (isCase && pcs > 0) {
    const totalPcs = qty * pcs;
    return `${qty} ${unit} (${pcs} pcs/cs = ${totalPcs} pcs total)`;
  }
  return `${qty} ${unit}`;
}




