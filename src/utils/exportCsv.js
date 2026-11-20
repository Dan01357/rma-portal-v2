/**
 * Enterprise Accounting & Logistics Excel (.xlsx) Exporter
 * Formats financial and warehouse records into genuine OOXML (.xlsx) spreadsheets
 * with bold frozen headers, clean column widths, numeric/currency cells, and plain-text IDs/barcodes.
 */
import { normalizeWarehouseLocation, isTestRecord, formatDateYmd, formatDateTimeYmdHm, stripCreditMemoMetaTag } from './rmaHelpers';
import { downloadTableXlsx } from './exportXlsx';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format timestamp strictly for filenames:
 * YYYY-MMMon-DD HHMM (e.g. 2026-11Nov-09 1430)
 */
export function formatFilenameDateTime(date = new Date()) {
  const d = (date instanceof Date && !isNaN(date.getTime())) ? date : new Date(date || Date.now());
  const safeDate = isNaN(d.getTime()) ? new Date() : d;
  const yyyy = safeDate.getFullYear();
  const mm = String(safeDate.getMonth() + 1).padStart(2, '0');
  const mon = MONTH_NAMES[safeDate.getMonth()] || 'Jan';
  const dd = String(safeDate.getDate()).padStart(2, '0');
  const hh = String(safeDate.getHours()).padStart(2, '0');
  const min = String(safeDate.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}${mon}-${dd} ${hh}${min}`;
}

export function resolveFilenameWithTimestamp(defaultPrefix, customFilename, isTestMode = false) {
  const ts = formatFilenameDateTime();
  const modePrefix = isTestMode ? 'TEST_' : '';
  if (!customFilename) return `${modePrefix}${defaultPrefix} ${ts}.xlsx`;
  const cleanName = customFilename.replace(/\.(csv|xlsx)$/i, '');
  const hasTestPrefix = /^(TEST_|Sandbox_)/i.test(cleanName);
  return `${hasTestPrefix ? '' : modePrefix}${cleanName} ${ts}.xlsx`;
}

/**
 * Format any date or timestamp strictly to 24-hour military time without colons:
 * YYYY-MM-DD HHMM (e.g. 2026-11-06 0845)
 */
export function formatMilitaryDateTime(val) {
  return formatDateTimeYmdHm(val);
}

/**
 * Format date cleanly as YYYY-MM-DD stripping time parts to prevent overflow in Excel.
 */
export function formatCleanDateOnly(val) {
  return formatDateYmd(val);
}

function extractPhotoLink(r) {
  if (!r) return 'N/A';
  if (r.google_drive_folder_url && r.google_drive_folder_url.startsWith('http')) {
    return r.google_drive_folder_url;
  }
  if (Array.isArray(r.photos) && r.photos.length > 0 && typeof r.photos[0] === 'string') {
    return r.photos[0];
  }
  if (typeof r.photos === 'string' && r.photos.startsWith('http')) {
    return r.photos;
  }
  if (r.photo_url && typeof r.photo_url === 'string' && r.photo_url.startsWith('http')) {
    return r.photo_url;
  }
  return 'N/A';
}

/**
 * Resolve master supplier name with robust fallback to catalog products
 */
export function resolveExportSupplier(r, savedProducts = []) {
  if (!r) return 'Pending Assignment';
  const cleanBarcode = String(r.barcode || '').trim();
  const matched = (Array.isArray(savedProducts) && cleanBarcode)
    ? savedProducts.find(p => p.barcode && String(p.barcode).trim() === cleanBarcode)
    : null;

  const rawSup = String(r.supplier_name || r.supplier || '').trim();
  const isInvalid = !rawSup || rawSup.toLowerCase().includes('pending') || rawSup.toLowerCase().includes('unassigned') || rawSup.toLowerCase() === 'warehouse';

  if (!isInvalid) return rawSup;
  if (matched?.supplier_name && matched.supplier_name.trim()) return matched.supplier_name.trim();
  if (matched?.supplierName && matched.supplierName.trim()) return matched.supplierName.trim();
  if (r.items?.[0]?.supplier_name && r.items[0].supplier_name.trim()) return r.items[0].supplier_name.trim();
  if (r.items?.[0]?.supplier && r.items[0].supplier.trim()) return r.items[0].supplier.trim();
  return rawSup || 'Pending Assignment';
}

function inferTestMode(records, explicitIsTestMode) {
  if (typeof explicitIsTestMode === 'boolean') return explicitIsTestMode;
  return Array.isArray(records) && records.length > 0 && records.every(r => isTestRecord(r));
}

/**
 * Export RMA Reports to genuine .xlsx
 */
export function exportRMAReportsToXlsx(reports, filename = null, savedProducts = [], isTestMode = undefined) {
  if (!reports || reports.length === 0) {
    alert('No reports available to export.');
    return;
  }

  const testActive = inferTestMode(reports, isTestMode);

  const columns = [
    { header: 'SN', width: 7, type: 'number' },
    { header: 'RMA Number', width: 20, type: 'text' },
    { header: 'Date Logged (YYYY-MM-DD HH:mm)', width: 25, type: 'text' },
    { header: 'Store / Branch', width: 24, type: 'text' },
    { header: 'Sales Invoice (SI) #', width: 18, type: 'text' },
    { header: 'Delivery Receipt (DR) #', width: 18, type: 'text' },
    { header: 'Purchase Order (PO) #', width: 18, type: 'text' },
    { header: 'Batch / Lot #', width: 16, type: 'text' },
    { header: 'Expiry Date (YYYY-MM-DD)', width: 22, type: 'text' },
    { header: 'Status', width: 18, type: 'text' },
    { header: 'Disposition', width: 24, type: 'text' },
    { header: 'Condition Grade', width: 18, type: 'text' },
    { header: 'Warehouse Location', width: 20, type: 'text' },
    { header: 'Supplier / Vendor', width: 24, type: 'text' },
    { header: 'Barcode', width: 18, type: 'text' },
    { header: 'Assigned SKU', width: 16, type: 'text' },
    { header: 'Product Description', width: 38, type: 'text' },
    { header: 'Quantity', width: 11, type: 'number' },
    { header: 'Packaging Unit', width: 14, type: 'text' },
    { header: 'Net Unit Price (PHP)', width: 18, type: 'currency' },
    { header: 'Price w/ VAT (PHP)', width: 18, type: 'currency' },
    { header: 'Total Claim Value (PHP)', width: 20, type: 'currency' },
    { header: 'Reporter Name', width: 20, type: 'text' },
    { header: 'Reported By', width: 20, type: 'text' },
    { header: 'Inspected By', width: 20, type: 'text' },
    { header: 'Defect Reason', width: 28, type: 'text' },
    { header: 'Google Drive Photo Link', width: 36, type: 'text' },
    { header: 'Google Drive Folder', width: 36, type: 'text' },
    { header: 'Notes', width: 32, type: 'text' }
  ];

  const rows = reports.map((r, index) => {
    const qty = Number(r.quantity || 1);
    const unitPrice = Number(r.price_with_vat || r.price || 0);
    const totalVal = Number((qty * unitPrice).toFixed(2));
    const dateStr = formatMilitaryDateTime(r.created_at);
    const photoLink = extractPhotoLink(r);
    const cleanExpiry = formatCleanDateOnly(r.expiry_date);
    const loc = normalizeWarehouseLocation(r.warehouse_location, r);
    const supplier = resolveExportSupplier(r, savedProducts);

    return [
      index + 1,
      r.rma_number || '',
      dateStr,
      r.store_branch || '',
      r.si_number || '',
      r.dr_number || r.invoice_dr_number || '',
      r.po_number || '',
      r.batch_lot_number || '',
      cleanExpiry,
      r.status || 'pending',
      r.disposition || 'Pending Triage',
      r.condition_grade || 'Unassessed',
      loc,
      supplier,
      r.barcode || '',
      r.code || r.sku || '',
      r.name || '',
      qty,
      r.unit_name || 'pc',
      Number(Number(r.price || 0).toFixed(2)),
      Number(Number(r.price_with_vat || 0).toFixed(2)),
      totalVal,
      r.reporter_name || '',
      r.reported_by || '',
      r.inspected_by || '',
      r.reason || '',
      photoLink,
      r.google_drive_folder_url || '',
      r.notes || ''
    ];
  });

  const actualFilename = resolveFilenameWithTimestamp('Pingcon_RMA_Reports', filename, testActive);
  downloadTableXlsx({
    sheetName: testActive ? 'Test RMA Audit Log' : 'RMA Audit Log',
    title: `${testActive ? 'TEST MODE SANDBOX — ' : ''}PINGCON RMA FULL AUDIT LOG REPORT`,
    subtitle: `Generated: ${formatFilenameDateTime()} (Asia/Manila) | Total Records: ${rows.length}`,
    filename: actualFilename,
    columns,
    rows
  });
}

/**
 * Export Customer Inbound RMAs to genuine .xlsx
 */
export function exportCustomerInboundRMAsToXlsx(reports, filename = null, savedProducts = [], isTestMode = undefined) {
  if (!reports || reports.length === 0) {
    alert('No customer return reports available to export.');
    return;
  }

  const testActive = inferTestMode(reports, isTestMode);

  const columns = [
    { header: 'SN', width: 7, type: 'number' },
    { header: 'RMA Number', width: 20, type: 'text' },
    { header: 'Date Logged (YYYY-MM-DD HH:mm)', width: 25, type: 'text' },
    { header: 'Customer Store / Branch', width: 26, type: 'text' },
    { header: 'Reporter Name', width: 20, type: 'text' },
    { header: 'Reporter Contact', width: 22, type: 'text' },
    { header: 'Sales Invoice (SI) #', width: 18, type: 'text' },
    { header: 'Delivery Receipt (DR) #', width: 18, type: 'text' },
    { header: 'Purchase Order (PO) #', width: 18, type: 'text' },
    { header: 'Account Executive (AE)', width: 22, type: 'text' },
    { header: 'AE Email', width: 26, type: 'text' },
    { header: 'Barcode', width: 18, type: 'text' },
    { header: 'Assigned SKU', width: 16, type: 'text' },
    { header: 'Product Description', width: 38, type: 'text' },
    { header: 'Quantity', width: 11, type: 'number' },
    { header: 'Packaging Unit', width: 14, type: 'text' },
    { header: 'Unit Price (PHP)', width: 16, type: 'currency' },
    { header: 'Total Credit Claim (PHP)', width: 20, type: 'currency' },
    { header: 'Lifecycle Stage / Status', width: 20, type: 'text' },
    { header: 'Disposition', width: 24, type: 'text' },
    { header: 'Condition Grade', width: 18, type: 'text' },
    { header: 'Defect Reason', width: 28, type: 'text' },
    { header: 'Credit Memo #', width: 18, type: 'text' },
    { header: 'Google Drive Photo Link', width: 36, type: 'text' },
    { header: 'Google Drive Folder', width: 36, type: 'text' },
    { header: 'Customer Notes', width: 32, type: 'text' }
  ];

  const rows = reports.map((r, index) => {
    const qty = Number(r.quantity || 1);
    const unitPrice = Number(r.price_with_vat || r.price || 0);
    const totalVal = Number((qty * unitPrice).toFixed(2));
    const dateStr = formatMilitaryDateTime(r.created_at);
    const photoLink = extractPhotoLink(r);

    return [
      index + 1,
      r.rma_number || '',
      dateStr,
      r.store_branch || '',
      r.reporter_name || '',
      r.reporter_contact || '',
      r.si_number || '',
      r.dr_number || r.invoice_dr_number || '',
      r.po_number || '',
      r.ae_name || '',
      r.ae_email || '',
      r.barcode || '',
      r.code || r.sku || '',
      r.name || '',
      qty,
      r.unit_name || 'pc',
      Number(unitPrice.toFixed(2)),
      totalVal,
      r.status || 'received_at_dock',
      r.disposition || 'Pending Triage',
      r.condition_grade || 'Unassessed',
      r.reason || '',
      r.credit_memo_no || r.credit_memo_number || '',
      photoLink,
      r.google_drive_folder_url || '',
      r.notes || ''
    ];
  });

  const actualFilename = resolveFilenameWithTimestamp('Pingcon_Customer_Inbound_RMAs', filename, testActive);
  downloadTableXlsx({
    sheetName: testActive ? 'Test Customer RMAs' : 'Customer Inbound RMAs',
    title: `${testActive ? 'TEST MODE SANDBOX — ' : ''}CUSTOMER RMA HUB — INBOUND RETURNS REPORT`,
    subtitle: `Generated: ${formatFilenameDateTime()} (Asia/Manila) | Total Inbound RMAs: ${rows.length}`,
    filename: actualFilename,
    columns,
    rows
  });
}

/**
 * Export Supplier Outbound / RTV Debit Claims to genuine .xlsx
 */
export function exportSupplierOutboundClaimsToXlsx(reports, filename = null, savedProducts = [], isTestMode = undefined) {
  if (!reports || reports.length === 0) {
    alert('No supplier outbound claims available to export.');
    return;
  }

  const testActive = inferTestMode(reports, isTestMode);

  const columns = [
    { header: 'SN', width: 7, type: 'number' },
    { header: 'RMA Number', width: 20, type: 'text' },
    { header: 'Date Logged (YYYY-MM-DD HH:mm)', width: 25, type: 'text' },
    { header: 'Master Supplier / Vendor', width: 26, type: 'text' },
    { header: 'Warehouse Bin / Location', width: 22, type: 'text' },
    { header: 'Batch / Lot #', width: 16, type: 'text' },
    { header: 'Expiry Date (YYYY-MM-DD)', width: 22, type: 'text' },
    { header: 'Barcode', width: 18, type: 'text' },
    { header: 'Assigned SKU', width: 16, type: 'text' },
    { header: 'Product Description', width: 38, type: 'text' },
    { header: 'Quantity', width: 11, type: 'number' },
    { header: 'Packaging Unit', width: 14, type: 'text' },
    { header: 'Net Purchase Price (PHP)', width: 20, type: 'currency' },
    { header: 'Total Debit Value (PHP)', width: 20, type: 'currency' },
    { header: 'Condition Grade', width: 18, type: 'text' },
    { header: 'Disposition', width: 24, type: 'text' },
    { header: 'Debit Claim Status', width: 18, type: 'text' },
    { header: 'Inspected By', width: 20, type: 'text' },
    { header: 'Defect Reason / Diagnosis', width: 28, type: 'text' },
    { header: 'Sales Invoice (SI) #', width: 18, type: 'text' },
    { header: 'Delivery Receipt (DR) #', width: 18, type: 'text' },
    { header: 'Purchase Order (PO) #', width: 18, type: 'text' },
    { header: 'Google Drive Photo Link', width: 36, type: 'text' },
    { header: 'Google Drive Folder', width: 36, type: 'text' },
    { header: 'Warehouse Notes', width: 32, type: 'text' }
  ];

  const rows = reports.map((r, index) => {
    const qty = Number(r.quantity || 1);
    const unitPrice = Number(r.price || r.price_with_vat || 0);
    const totalVal = Number((qty * unitPrice).toFixed(2));
    const dateStr = formatMilitaryDateTime(r.created_at);
    const photoLink = extractPhotoLink(r);
    const cleanExpiry = formatCleanDateOnly(r.expiry_date);
    const loc = normalizeWarehouseLocation(r.warehouse_location, r);
    const supplier = resolveExportSupplier(r, savedProducts);

    return [
      index + 1,
      r.rma_number || '',
      dateStr,
      supplier,
      loc,
      r.batch_lot_number || '',
      cleanExpiry,
      r.barcode || '',
      r.code || r.sku || '',
      r.name || '',
      qty,
      r.unit_name || 'pc',
      Number(unitPrice.toFixed(2)),
      totalVal,
      r.condition_grade || 'Unassessed',
      r.disposition || 'Return to Vendor (RTV)',
      r.status || 'Pending Debit',
      r.inspected_by || '',
      r.reason || r.explanation || '',
      r.si_number || '',
      r.dr_number || r.invoice_dr_number || '',
      r.po_number || r.supplier_po_no || '',
      photoLink,
      r.google_drive_folder_url || '',
      r.notes || ''
    ];
  });

  const actualFilename = resolveFilenameWithTimestamp('Pingcon_Supplier_Outbound_Claims', filename, testActive);
  downloadTableXlsx({
    sheetName: testActive ? 'Test Supplier RTV' : 'Supplier Outbound Claims',
    title: `${testActive ? 'TEST MODE SANDBOX — ' : ''}SUPPLIER RTV HUB — OUTBOUND VENDOR CLAIMS REPORT`,
    subtitle: `Generated: ${formatFilenameDateTime()} (Asia/Manila) | Total Supplier RTV Claims: ${rows.length}`,
    filename: actualFilename,
    columns,
    rows
  });
}

/**
 * Export Credit Memos to genuine .xlsx
 */
export function exportCreditMemosToXlsx(memos, filename = null, isTestMode = undefined) {
  if (!memos || memos.length === 0) {
    alert('No credit memos available to export.');
    return;
  }

  const testActive = inferTestMode(memos, isTestMode);

  const columns = [
    { header: 'SN', width: 7, type: 'number' },
    { header: 'Credit Memo Number', width: 20, type: 'text' },
    { header: 'RMA Number', width: 20, type: 'text' },
    { header: 'Pull-Out Slip Ref', width: 18, type: 'text' },
    { header: 'Pull-Out Date (YYYY-MM-DD)', width: 22, type: 'text' },
    { header: 'Date Issued (YYYY-MM-DD HH:mm)', width: 26, type: 'text' },
    { header: 'Supplier / Vendor', width: 24, type: 'text' },
    { header: 'Product Description', width: 38, type: 'text' },
    { header: 'SKU', width: 16, type: 'text' },
    { header: 'Barcode', width: 18, type: 'text' },
    { header: 'Quantity', width: 11, type: 'number' },
    { header: 'Packaging Unit', width: 14, type: 'text' },
    { header: 'Unit Price (PHP)', width: 16, type: 'currency' },
    { header: 'Amount (PHP)', width: 16, type: 'currency' },
    { header: 'Final Credit Amount (PHP)', width: 22, type: 'currency' },
    { header: 'Status', width: 14, type: 'text' },
    { header: 'Issued By', width: 20, type: 'text' },
    { header: 'Account Executive', width: 22, type: 'text' },
    { header: 'AE Email', width: 26, type: 'text' },
    { header: 'Notes', width: 32, type: 'text' }
  ];

  const rows = memos.map((cm, index) => {
    const pullOutDate = formatCleanDateOnly(cm.pull_out_date);
    const dateIssued = formatMilitaryDateTime(cm.created_at);

    return [
      index + 1,
      cm.credit_memo_number || '',
      cm.rma_number || '',
      cm.pull_out_ref || '',
      pullOutDate,
      dateIssued,
      cm.supplier_name || 'Savemore',
      cm.product_name || '',
      cm.sku || '',
      cm.barcode || '',
      Number(cm.quantity || 1),
      cm.unit_name || 'pc',
      Number(Number(cm.unit_price || 0).toFixed(2)),
      Number(Number(cm.amount || 0).toFixed(2)),
      Number(Number(cm.credit_amount || 0).toFixed(2)),
      cm.status || 'issued',
      cm.credit_issued_by || '',
      cm.customer_ae_name || '',
      cm.customer_ae_email || '',
      stripCreditMemoMetaTag(cm.clean_notes ?? cm.notes ?? '')
    ];
  });

  const actualFilename = resolveFilenameWithTimestamp('Pingcon_Credit_Memos_Export', filename, testActive);
  downloadTableXlsx({
    sheetName: testActive ? 'Test Credit Memos' : 'Credit Memos',
    title: `${testActive ? 'TEST MODE SANDBOX — ' : ''}PINGCON FINANCE CREDIT MEMOS REPORT`,
    subtitle: `Generated: ${formatFilenameDateTime()} (Asia/Manila) | Total Credit Memos: ${rows.length}`,
    filename: actualFilename,
    columns,
    rows
  });
}

// Backwards-compatible aliases (all output genuine .xlsx)
export const exportRMAReportsToCSV = exportRMAReportsToXlsx;
export const exportCustomerInboundRMAsToCSV = exportCustomerInboundRMAsToXlsx;
export const exportSupplierOutboundClaimsToCSV = exportSupplierOutboundClaimsToXlsx;
export const exportCreditMemosToCSV = exportCreditMemosToXlsx;
