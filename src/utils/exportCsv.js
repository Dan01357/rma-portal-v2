/**
 * Enterprise Accounting & Logistics CSV Exporter
 * Formats financial records with clean headers and UTF-8 BOM for Microsoft Excel & Google Sheets.
 */

function escapeCsvCell(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
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
    'Date Logged',
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
    'Google Drive Folder',
    'Notes'
  ];

  const rows = reports.map((r, index) => {
    const qty = Number(r.quantity || 1);
    const unitPrice = Number(r.price_with_vat || r.price || 0);
    const totalVal = (qty * unitPrice).toFixed(2);
    const dateStr = r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '';

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
      escapeCsvCell(r.google_drive_folder_url || ''),
      escapeCsvCell(r.notes || '')
    ].join(',');
  });

  const csv = [headers.join(','), ...rows].join('\r\n');
  const actualFilename = filename || `RMA_Reports_Export_${new Date().toISOString().slice(0, 10)}.csv`;
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
    'Issued Date',
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
      escapeCsvCell(cm.created_at ? new Date(cm.created_at).toISOString().slice(0, 10) : ''),
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
  const actualFilename = filename || `Credit_Memos_Export_${new Date().toISOString().slice(0, 10)}.csv`;
  downloadCsvBlob(csv, actualFilename);
}
