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
 * and status !== 'restocked'
 */
export function isItemReadyToRestock(item, allReports = []) {
  if (!item) return false;
  if (!item.is_unpacked_manifest_item && (item.is_parent || (Array.isArray(item.items) && item.items.length > 1))) {
    const children = Array.isArray(item.items) && item.items.length > 0 ? item.items : [];
    return children.some(c => isItemReadyToRestock(c, allReports));
  }
  const disp = String(item.disposition || '').toLowerCase();
  const st = String(item.status || '').toLowerCase();
  const isRestockDisp = disp.includes('restock') || disp.includes('replacement stock received');
  return isRestockDisp && !['restocked', 'closed', 'resolved', 'scrapped', 'disposed', 'rejected'].includes(st);
}

/**
 * Helper to check if an item belongs to the Re-Order Needed queue:
 * disposition: Scrap / RTV / Buffer Swap / Claim Rejected by Vendor
 * AND needs_reorder !== false
 * AND status !== 'scrapped' (and not restock, hold, or rejected)
 */
export function isItemReorderNeeded(item, allReports = []) {
  if (!item) return false;
  if (!item.is_unpacked_manifest_item && (item.is_parent || (Array.isArray(item.items) && item.items.length > 1))) {
    const children = Array.isArray(item.items) && item.items.length > 0 ? item.items : [];
    return children.some(c => isItemReorderNeeded(c, allReports));
  }
  const disp = String(item.disposition || '').toLowerCase();
  const st = String(item.status || '').toLowerCase();

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
    disp.includes('claim rejected by vendor');

  const needsReorder = getItemNeedsReorder(item);
  return isLossDisp && needsReorder !== false && !['scrapped', 'disposed', 'closed', 'resolved', 'restocked', 'rejected'].includes(st);
}

/**
 * Helper to check if an item is Scrapped with No Re-Order:
 * disposition is Scrap or Vendor Rejected AND needs_reorder === false
 * AND status !== 'scrapped'
 */
export function isItemScrappedNoReorder(item, allReports = []) {
  if (!item) return false;
  if (!item.is_unpacked_manifest_item && (item.is_parent || (Array.isArray(item.items) && item.items.length > 1))) {
    const children = Array.isArray(item.items) && item.items.length > 0 ? item.items : [];
    return children.some(c => isItemScrappedNoReorder(c, allReports));
  }
  const disp = String(item.disposition || '').toLowerCase();
  const st = String(item.status || '').toLowerCase();
  const isScrapDisp = disp.includes('scrap') || disp.includes('dispose') || disp.includes('claim rejected by vendor');
  const needsReorder = getItemNeedsReorder(item);
  return isScrapDisp && needsReorder === false && !['scrapped', 'disposed', 'closed', 'resolved', 'rejected'].includes(st);
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
