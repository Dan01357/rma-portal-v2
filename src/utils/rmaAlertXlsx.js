import { escapeXml, colToLetter, buildStoredZip } from './exportXlsx.js';
import {
  isTestRecord,
  formatDateYmd,
  formatDateTimeYmdHm,
  formatSaveFileTimestamp,
  getGpsAddressDisplay,
  getGpsMapUrl,
  getReportManifestItems
} from './rmaHelpers.js';

function sanitizeFilenameSegment(raw) {
  return String(raw || 'RMA Alert')
    .replace(/[\\/:*?"<>|[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

/**
 * Generates an unambiguous save filename matching the New RMA Email subject
 * followed by `formatSaveFileTimestamp()` (e.g. `TEST RMA Alert RMA-TEST-2026-0001 Nov 25, 2026 0832.xlsx`).
 */
export function buildRmaAlertFilename(subjectOrRma, date = new Date()) {
  const base = sanitizeFilenameSegment(subjectOrRma || 'RMA Alert');
  const ts = formatSaveFileTimestamp(date);
  return `${base} ${ts}.xlsx`;
}

function makeCellXml(ref, value, styleIdx = 2, type = 'text') {
  if (value === null || value === undefined || value === '') {
    return `<c r="${ref}" s="${styleIdx}"/>`;
  }
  if (type === 'number' && typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}" s="${styleIdx}"><v>${value}</v></c>`;
  }
  const str = String(value);
  const preserve = /^\s|\s$|\n/.test(str) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}" t="inlineStr" s="${styleIdx}"><is><t${preserve}>${escapeXml(str)}</t></is></c>`;
}

function buildMirrorStylesXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>',
    '<fonts count="5">',
    '<font><sz val="11"/><name val="Calibri"/><color rgb="FF0F172A"/></font>',
    '<font><b/><sz val="13"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>',
    '<font><b/><sz val="10"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>',
    '<font><b/><sz val="10"/><name val="Calibri"/><color rgb="FF1E293B"/></font>',
    '<font><i/><sz val="10"/><name val="Calibri"/><color rgb="FF475569"/></font>',
    '</fonts>',
    '<fills count="6">',
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FF1D4ED8"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill>',
    '</fills>',
    '<borders count="2">',
    '<border><left/><right/><top/><bottom/><diagonal/></border>',
    '<border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border>',
    '</borders>',
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
    '<cellXfs count="7">',
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>',
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>',
    '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>',
    '<xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>',
    '<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>',
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>',
    '</cellXfs>',
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>',
    '</styleSheet>'
  ].join('');
}

/**
 * Builds strict OOXML `.xlsx` bytes mirroring a New RMA Email Alert payload.
 * Preserves Field | Value mapping and optional MANIFEST LINE ITEMS table for 2-way reply ingestion.
 */
export function buildRmaAlertXlsxBytes(report = {}, { subject = '', editUrl = '', resolvedRecipients = null } = {}) {
  const rmaNumber = String(report.rma_number || report.rmaNumber || 'RMA-PENDING').trim();
  const isTest = isTestRecord(report);
  const meta = (report.ai_document_metadata && typeof report.ai_document_metadata === 'object')
    ? report.ai_document_metadata
    : {};
  const followUpMeta = (meta.follow_up && typeof meta.follow_up === 'object') ? meta.follow_up : {};
  const items = getReportManifestItems(report);

  const gpsAddress = getGpsAddressDisplay(report) || '';
  const gpsMapUrl = getGpsMapUrl(report) || '';
  const isSupplierStream = report.rma_type === 'supplier_outbound';
  const toSummary = Array.isArray(resolvedRecipients?.toList) ? resolvedRecipients.toList.join(', ') : '';
  const ccSummary = Array.isArray(resolvedRecipients?.ccList) ? resolvedRecipients.ccList.join(', ') : '';

  const fieldRows = [
    ['RMA Number', rmaNumber, 'Identifier — do not rename'],
    ['Test Mode', isTest ? 'YES (Sandbox)' : 'NO (Live)', 'Test vs Live isolation guard'],
    ['Logistics Stream', isSupplierStream ? 'supplier_outbound' : 'customer_inbound', 'customer_inbound or supplier_outbound'],
    ['Store / Branch', report.store_branch || '', 'Editable text'],
    ['Supplier / Vendor Name', report.supplier_name || report.supplierName || '', 'Editable supplier / updates Supplier Directory'],
    ['Supplier Email (To)', followUpMeta.supplier_email_to || '', 'Comma-separated emails for auto follow-ups'],
    ['Supplier Email (CC)', followUpMeta.supplier_email_cc || '', 'Comma-separated CC emails'],
    ['Barcode', report.barcode || '', 'Plain text barcode'],
    ['Assigned SKU', report.code || report.sku || '', 'Editable SKU / Item Code'],
    ['Product Description', report.name || report.productName || report.product_name || '', 'Editable product name'],
    ['Quantity', Number(report.quantity ?? report.total_quantity ?? 1) || 1, 'Numeric quantity', 'number'],
    ['Packaging Unit', report.unit_name || report.unitName || 'pc', 'pc / pack / box / case'],
    ['Unit Price (PHP)', Number(report.price || 0), 'Net unit price', 'currency'],
    ['Price w/ VAT (PHP)', Number(report.price_with_vat || report.priceWithVat || 0), 'VAT-inclusive unit price', 'currency'],
    ['Defect / Return Reason', report.reason || '', 'Editable defect reason'],
    ['Explanation / Notes', report.explanation || report.notes || '', 'Editable detailed explanation / notes'],
    ['Sales Invoice (SI) #', report.si_number || '', 'Editable SI number'],
    ['Delivery Receipt (DR) #', report.dr_number || report.invoice_dr_number || '', 'Editable DR number'],
    ['Purchase Order (PO) #', report.po_number || '', 'Editable PO number'],
    ['Batch / Lot #', report.batch_lot_number || '', 'Editable batch / lot number'],
    ['Expiry Date (YYYY-MM-DD)', formatDateYmd(report.expiry_date) || '', 'Format: YYYY-MM-DD'],
    ['Warehouse Location', report.warehouse_location || '', 'Editable rack / bin location'],
    ['Account Executive (AE)', report.ae_name || '', 'Optional AE Name'],
    ['AE Email', report.ae_email || '', 'Optional AE Email'],
    ['Reported By', report.reporter_name || report.reported_by || '', 'Reporter full name'],
    ['Contact Number/Email', report.reporter_contact || '', 'Phone number or email'],
    ['Submission Date (YYYY-MM-DD HH:mm)', formatDateTimeYmdHm(report.created_at || new Date()), 'Asia/Manila timestamp'],
    ['GPS Location', gpsAddress || (report.gps_latitude && report.gps_longitude ? `${report.gps_latitude}, ${report.gps_longitude}` : 'No GPS'), 'Clear Street / Barangay / City / ZIP'],
    ['GPS Maps Link', gpsMapUrl, 'Google Maps search URL'],
    ['Google Drive Folder', report.google_drive_folder_url || '', 'Attached photos & paperwork folder'],
    ['Email Subject', subject || `${isTest ? '[TEST] ' : ''}[RMA Alert] ${rmaNumber}`, 'Email alert mirror subject'],
    ['Alert Recipients (To)', toSummary, 'Authorized TO list'],
    ['Alert Recipients (CC)', ccSummary, 'Authorized CC list'],
    ['Online RMA Editor Link', editUrl || '', 'Never-expiring To/CC portal edit link']
  ];

  const rowsXml = [];
  let rIdx = 1;

  // Title Row
  rowsXml.push(`<row r="${rIdx}" ht="26" customHeight="1">${makeCellXml(`A${rIdx}`, `${isTest ? '[TEST] ' : ''}WHOLESALE RMA ALERT WORKSHEET — ${rmaNumber}`, 1)}${makeCellXml(`B${rIdx}`, '', 1)}${makeCellXml(`C${rIdx}`, '', 1)}</row>`);
  rIdx += 1;

  // Instructions Row
  rowsXml.push(`<row r="${rIdx}" ht="24" customHeight="1">${makeCellXml(`A${rIdx}`, '2-WAY EMAIL REPLY EDITABLE WORKSHEET', 4)}${makeCellXml(`B${rIdx}`, 'Edit any Value cells in Column B (or Manifest rows below), save .xlsx, and Reply / Reply-All to this alert email.', 2)}${makeCellXml(`C${rIdx}`, formatSaveFileTimestamp(new Date()), 4)}</row>`);
  rIdx += 1;

  // Table Headers
  rowsXml.push(`<row r="${rIdx}" ht="22" customHeight="1">${makeCellXml(`A${rIdx}`, 'Field', 3)}${makeCellXml(`B${rIdx}`, 'Value', 3)}${makeCellXml(`C${rIdx}`, 'Format / Notes', 3)}</row>`);
  rIdx += 1;

  for (const [label, val, note, kind] of fieldRows) {
    const valStyle = kind === 'currency' ? 6 : 5;
    const valType = (kind === 'number' || kind === 'currency') ? 'number' : 'text';
    rowsXml.push(
      `<row r="${rIdx}" ht="20" customHeight="1">` +
      makeCellXml(`A${rIdx}`, label, 4, 'text') +
      makeCellXml(`B${rIdx}`, val, valStyle, valType) +
      makeCellXml(`C${rIdx}`, note, 2, 'text') +
      `</row>`
    );
    rIdx += 1;
  }

  // Manifest table when multi-item batch return (2+ lines)
  if (items.length > 1) {
    rIdx += 1;
    rowsXml.push(`<row r="${rIdx}" ht="22" customHeight="1">${makeCellXml(`A${rIdx}`, `MANIFEST LINE ITEMS (${items.length})`, 1)}${makeCellXml(`B${rIdx}`, '', 1)}${makeCellXml(`C${rIdx}`, '', 1)}</row>`);
    rIdx += 1;
    const mHeaders = ['Line #', 'Barcode', 'Assigned SKU', 'Product Description', 'Quantity', 'Packaging Unit', 'Expiry Date (YYYY-MM-DD)', 'Defect Reason', 'Explanation'];
    rowsXml.push(
      `<row r="${rIdx}" ht="22" customHeight="1">` +
      mHeaders.map((h, i) => makeCellXml(`${colToLetter(i + 1)}${rIdx}`, h, 3, 'text')).join('') +
      `</row>`
    );
    rIdx += 1;
    items.forEach((it, idx) => {
      const vals = [
        [idx + 1, 'number', 2],
        [it.barcode || '', 'text', 2],
        [it.code || it.sku || '', 'text', 5],
        [it.name || it.productName || '', 'text', 5],
        [Number(it.quantity) || 1, 'number', 5],
        [it.unit_name || it.unit || 'pc', 'text', 5],
        [formatDateYmd(it.expiry_date) || '', 'text', 5],
        [it.reason || report.reason || '', 'text', 5],
        [it.explanation || '', 'text', 5]
      ];
      rowsXml.push(
        `<row r="${rIdx}" ht="20" customHeight="1">` +
        vals.map(([v, t, s], i) => makeCellXml(`${colToLetter(i + 1)}${rIdx}`, v, s, t)).join('') +
        `</row>`
      );
      rIdx += 1;
    });
  }

  const maxCols = items.length > 1 ? 9 : 3;
  const maxRow = rIdx - 1;
  const colWidths = [34, 48, 42, 34, 14, 16, 22, 26, 36].slice(0, maxCols);
  const colsXml = `<cols>${colWidths.map((w, idx) => `<col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;

  const sheetXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    `<dimension ref="A1:${colToLetter(maxCols)}${maxRow}"/>`,
    '<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="B4" sqref="B4"/></sheetView></sheetViews>',
    '<sheetFormatPr defaultRowHeight="20"/>',
    colsXml,
    `<sheetData>${rowsXml.join('')}</sheetData>`,
    '<mergeCells count="1"><mergeCell ref="A1:C1"/></mergeCells>',
    '</worksheet>'
  ].join('');

  const contentTypes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
    '</Types>'
  ].join('');

  const relsRoot = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
    '</Relationships>'
  ].join('');

  const workbookXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '<sheets><sheet name="RMA Alert Mirror" sheetId="1" r:id="rId1"/></sheets>',
    '</workbook>'
  ].join('');

  const workbookRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '</Relationships>'
  ].join('');

  return buildStoredZip([
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: relsRoot },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRels },
    { name: 'xl/styles.xml', content: buildMirrorStylesXml() },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml }
  ]);
}

function uint8ToBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Generates an email-ready base64 `.xlsx` attachment object for `sendRMANotification`.
 */
export function buildRmaAlertXlsxAttachment(report = {}, options = {}) {
  const filename = buildRmaAlertFilename(options.subject || report.rma_number || 'RMA Alert');
  const bytes = buildRmaAlertXlsxBytes(report, options);
  return {
    filename,
    content: uint8ToBase64(bytes),
    encoding: 'base64',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    byteLength: bytes.length
  };
}
