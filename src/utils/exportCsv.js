/**
 * Enterprise Accounting & Logistics CSV Exporter
 * Formats financial records with clean headers and UTF-8 BOM for Microsoft Excel & Google Sheets.
 */

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

export function resolveFilenameWithTimestamp(defaultPrefix, customFilename) {
  const ts = formatFilenameDateTime();
  if (!customFilename) return `${defaultPrefix}_${ts}.csv`;
  if (customFilename.toLowerCase().endsWith('.csv')) {
    return customFilename.replace(/\.csv$/i, `_${ts}.csv`);
  }
  return `${customFilename}_${ts}.csv`;
}

/**
 * Format any date or timestamp strictly to 24-hour military time without colons:
 * YYYY-MM-DD HHMM (e.g. 2026-11-06 0845)
 */
export function formatMilitaryDateTime(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return String(val);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}${min}`;
}

function escapeCsvCell(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
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

function downloadCsvBlob(csvContent, filename) {
  // \uFEFF is UTF-8 Byte Order Mark (BOM) so Excel reads formatting and currencies properly
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}

/**
 * Export RMA Reports to CSV
 */
export function exportRMAReportsToCSV(reports, filename = null) {
  if (!reports || reports.length === 0) {
    alert('No reports available to export.');
    return;
  }

  const headers = [
    'SN',
    'RMA Number',
    'Date Logged (YYYY-MM-DD HHMM)',
    'Store / Branch',
    'Invoice / DR #',
    'Batch / Lot #',
    'Expiry Date',
    'Status',
    'Disposition',
    'Condition Grade',
    'Warehouse Location',
    'Supplier / Vendor',
    'Barcode',
    'Assigned SKU',
    'Product Description',
    'Quantity',
    'Packaging Unit',
    'Net Unit Price (PHP)',
    'Price w/ VAT (PHP)',
    'Total Claim Value (PHP)',
    'Reporter Name',
    'Reported By',
    'Inspected By',
    'Defect Reason',
    'Google Drive Photo Link',
    'Google Drive Folder',
    'Notes'
  ];

  const rows = reports.map((r, index) => {
    const qty = Number(r.quantity || 1);
    const unitPrice = Number(r.price_with_vat || r.price || 0);
    const totalVal = (qty * unitPrice).toFixed(2);
    const dateStr = formatMilitaryDateTime(r.created_at);
    const photoLink = extractPhotoLink(r);

    return [
      escapeCsvCell(index + 1),
      escapeCsvCell(r.rma_number),
      escapeCsvCell(dateStr),
      escapeCsvCell(r.store_branch || ''),
      escapeCsvCell(r.invoice_dr_number || ''),
      escapeCsvCell(r.batch_lot_number || ''),
      escapeCsvCell(r.expiry_date || ''),
      escapeCsvCell(r.status || 'pending'),
      escapeCsvCell(r.disposition || 'Pending Triage'),
      escapeCsvCell(r.condition_grade || 'Unassessed'),
      escapeCsvCell(r.warehouse_location || 'DOCK'),
      escapeCsvCell(r.supplier_name || 'Savemore'),
      escapeCsvCell(r.barcode),
      escapeCsvCell(r.code || r.sku || ''),
      escapeCsvCell(r.name),
      escapeCsvCell(qty),
      escapeCsvCell(r.unit_name || 'pc'),
      escapeCsvCell(Number(r.price || 0).toFixed(2)),
      escapeCsvCell(Number(r.price_with_vat || 0).toFixed(2)),
      escapeCsvCell(totalVal),
      escapeCsvCell(r.reporter_name || ''),
      escapeCsvCell(r.reported_by || ''),
      escapeCsvCell(r.inspected_by || ''),
      escapeCsvCell(r.reason || ''),
      escapeCsvCell(photoLink),
      escapeCsvCell(r.google_drive_folder_url || ''),
      escapeCsvCell(r.notes || '')
    ].join(',');
  });

  const csv = [headers.join(','), ...rows].join('\r\n');
  const actualFilename = resolveFilenameWithTimestamp('Pingcon_RMA_Reports', filename);
  downloadCsvBlob(csv, actualFilename);
}

/**
 * Export Customer Inbound RMAs to CSV
 */
export function exportCustomerInboundRMAsToCSV(reports, filename = null) {
  if (!reports || reports.length === 0) {
    alert('No customer return reports available to export.');
    return;
  }

  const headers = [
    'SN',
    'RMA Number',
    'Date Logged (YYYY-MM-DD HHMM)',
    'Customer Store / Branch',
    'Reporter Name',
    'Reporter Contact',
    'Sales Invoice (SI) #',
    'Delivery Receipt (DR) #',
    'Purchase Order (PO) #',
    'Account Executive (AE)',
    'AE Email',
    'Barcode',
    'Assigned SKU',
    'Product Description',
    'Quantity',
    'Packaging Unit',
    'Unit Price (PHP)',
    'Total Credit Claim (PHP)',
    'Lifecycle Stage / Status',
    'Disposition',
    'Condition Grade',
    'Defect Reason',
    'Credit Memo #',
    'Google Drive Photo Link',
    'Google Drive Folder',
    'Customer Notes'
  ];

  const rows = reports.map((r, index) => {
    const qty = Number(r.quantity || 1);
    const unitPrice = Number(r.price_with_vat || r.price || 0);
    const totalVal = (qty * unitPrice).toFixed(2);
    const dateStr = formatMilitaryDateTime(r.created_at);
    const photoLink = extractPhotoLink(r);

    return [
      escapeCsvCell(index + 1),
      escapeCsvCell(r.rma_number),
      escapeCsvCell(dateStr),
      escapeCsvCell(r.store_branch || ''),
      escapeCsvCell(r.reporter_name || ''),
      escapeCsvCell(r.reporter_contact || ''),
      escapeCsvCell(r.si_number || ''),
      escapeCsvCell(r.dr_number || r.invoice_dr_number || ''),
      escapeCsvCell(r.po_number || ''),
      escapeCsvCell(r.ae_name || ''),
      escapeCsvCell(r.ae_email || ''),
      escapeCsvCell(r.barcode),
      escapeCsvCell(r.code || r.sku || ''),
      escapeCsvCell(r.name),
      escapeCsvCell(qty),
      escapeCsvCell(r.unit_name || 'pc'),
      escapeCsvCell(unitPrice.toFixed(2)),
      escapeCsvCell(totalVal),
      escapeCsvCell(r.status || 'received_at_dock'),
      escapeCsvCell(r.disposition || 'Pending Triage'),
      escapeCsvCell(r.condition_grade || 'Unassessed'),
      escapeCsvCell(r.reason || ''),
      escapeCsvCell(r.credit_memo_no || r.credit_memo_number || ''),
      escapeCsvCell(photoLink),
      escapeCsvCell(r.google_drive_folder_url || ''),
      escapeCsvCell(r.notes || '')
    ].join(',');
  });

  const csv = [headers.join(','), ...rows].join('\r\n');
  const actualFilename = resolveFilenameWithTimestamp('Pingcon_Customer_Inbound_RMAs', filename);
  downloadCsvBlob(csv, actualFilename);
}

/**
 * Export Supplier Outbound / RTV Debit Claims to CSV
 */
export function exportSupplierOutboundClaimsToCSV(reports, filename = null) {
  if (!reports || reports.length === 0) {
    alert('No supplier outbound claims available to export.');
    return;
  }

  const headers = [
    'SN',
    'RMA Number',
    'Date Logged (YYYY-MM-DD HHMM)',
    'Master Supplier / Vendor',
    'Warehouse Bin / Location',
    'Batch / Lot #',
    'Expiry Date',
    'Barcode',
    'Assigned SKU',
    'Product Description',
    'Quantity',
    'Packaging Unit',
    'Net Purchase Price (PHP)',
    'Total Debit Value (PHP)',
    'Condition Grade',
    'Disposition',
    'Debit Claim Status',
    'Inspected By',
    'Defect Reason / Diagnosis',
    'Supplier PO #',
    'Google Drive Photo Link',
    'Google Drive Folder',
    'Warehouse Notes'
  ];

  const rows = reports.map((r, index) => {
    const qty = Number(r.quantity || 1);
    const unitPrice = Number(r.price || r.price_with_vat || 0);
    const totalVal = (qty * unitPrice).toFixed(2);
    const dateStr = formatMilitaryDateTime(r.created_at);
    const photoLink = extractPhotoLink(r);

    return [
      escapeCsvCell(index + 1),
      escapeCsvCell(r.rma_number),
      escapeCsvCell(dateStr),
      escapeCsvCell(r.supplier_name || 'Savemore'),
      escapeCsvCell(r.warehouse_location || 'DOCK'),
      escapeCsvCell(r.batch_lot_number || ''),
      escapeCsvCell(r.expiry_date || ''),
      escapeCsvCell(r.barcode),
      escapeCsvCell(r.code || r.sku || ''),
      escapeCsvCell(r.name),
      escapeCsvCell(qty),
      escapeCsvCell(r.unit_name || 'pc'),
      escapeCsvCell(unitPrice.toFixed(2)),
      escapeCsvCell(totalVal),
      escapeCsvCell(r.condition_grade || 'Unassessed'),
      escapeCsvCell(r.disposition || 'Return to Vendor (RTV)'),
      escapeCsvCell(r.status || 'Pending Debit'),
      escapeCsvCell(r.inspected_by || ''),
      escapeCsvCell(r.reason || r.explanation || ''),
      escapeCsvCell(r.po_number || r.supplier_po_no || ''),
      escapeCsvCell(photoLink),
      escapeCsvCell(r.google_drive_folder_url || ''),
      escapeCsvCell(r.notes || '')
    ].join(',');
  });

  const csv = [headers.join(','), ...rows].join('\r\n');
  const actualFilename = resolveFilenameWithTimestamp('Pingcon_Supplier_Outbound_Claims', filename);
  downloadCsvBlob(csv, actualFilename);
}

/**
 * Export Credit Memos to CSV
 */
export function exportCreditMemosToCSV(memos, filename = null) {
  if (!memos || memos.length === 0) {
    alert('No credit memos available to export.');
    return;
  }

  const headers = [
    'SN',
    'Credit Memo Number',
    'RMA Number',
    'Pull-Out Slip Ref',
    'Pull-Out Date',
    'Date Issued (YYYY-MM-DD HHMM)',
    'Supplier / Vendor',
    'Product Description',
    'SKU',
    'Barcode',
    'Quantity',
    'Packaging Unit',
    'Unit Price (PHP)',
    'Amount (PHP)',
    'Final Credit Amount (PHP)',
    'Status',
    'Issued By',
    'Account Executive',
    'AE Email',
    'Notes'
  ];

  const rows = memos.map((cm, index) => {
    return [
      escapeCsvCell(index + 1),
      escapeCsvCell(cm.credit_memo_number),
      escapeCsvCell(cm.rma_number),
      escapeCsvCell(cm.pull_out_ref),
      escapeCsvCell(cm.pull_out_date || ''),
      escapeCsvCell(formatMilitaryDateTime(cm.created_at)),
      escapeCsvCell(cm.supplier_name || 'Savemore'),
      escapeCsvCell(cm.product_name),
      escapeCsvCell(cm.sku || ''),
      escapeCsvCell(cm.barcode),
      escapeCsvCell(cm.quantity || 1),
      escapeCsvCell(cm.unit_name || 'pc'),
      escapeCsvCell(Number(cm.unit_price || 0).toFixed(2)),
      escapeCsvCell(Number(cm.amount || 0).toFixed(2)),
      escapeCsvCell(Number(cm.credit_amount || 0).toFixed(2)),
      escapeCsvCell(cm.status || 'issued'),
      escapeCsvCell(cm.credit_issued_by || ''),
      escapeCsvCell(cm.customer_ae_name || ''),
      escapeCsvCell(cm.customer_ae_email || ''),
      escapeCsvCell(cm.notes || '')
    ].join(',');
  });

  const csv = [headers.join(','), ...rows].join('\r\n');
  const actualFilename = resolveFilenameWithTimestamp('Pingcon_Credit_Memos_Export', filename);
  downloadCsvBlob(csv, actualFilename);
}
