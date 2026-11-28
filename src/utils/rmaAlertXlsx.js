import { escapeXml, colToLetter, buildStoredZip } from './exportXlsx.js';
import { createSupplierScopedReportView } from './followUpWorkflow.js';
import {
  isTestRecord,
  formatDateYmd,
  formatDateTimeYmdHm,
  formatSaveFileTimestamp,
  getGpsAddressDisplay,
  getGpsMapUrl,
  getReportManifestItems,
  sumManifestQuantity,
  summarizeBatchSuppliers,
  extractDistinctSuppliersFromItems,
  isMixedSuppliersSummary,
  isRealSupplierName
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
export function buildRmaAlertXlsxBytes(
  report = {},
  {
    subject = '',
    editUrl = '',
    resolvedRecipients = null,
    allReports = [],
    supplierGroup = null,
    forceManifestTable = false
  } = {}
) {
  const activeReport = supplierGroup ? createSupplierScopedReportView(report, supplierGroup) : report;
  const rmaNumber = String(activeReport.rma_number || activeReport.rmaNumber || 'RMA-PENDING').trim();
  const isTest = isTestRecord(activeReport);
  const meta = (activeReport.ai_document_metadata && typeof activeReport.ai_document_metadata === 'object')
    ? activeReport.ai_document_metadata
    : {};
  const followUpMeta = (meta.follow_up && typeof meta.follow_up === 'object') ? meta.follow_up : {};
  const items = supplierGroup?.items?.length
    ? supplierGroup.items
    : getReportManifestItems(activeReport, allReports);

  const isMultiItemBatch = items.length > 1;
  const distinctBatchSuppliers = extractDistinctSuppliersFromItems(items);
  const hasMixedBatchSuppliers = !supplierGroup && distinctBatchSuppliers.length > 1;
  const showManifestTable = Boolean(isMultiItemBatch || forceManifestTable || supplierGroup?.isBatchSlice);
  const effectiveQuantity = isMultiItemBatch
    ? sumManifestQuantity(items, activeReport.quantity ?? activeReport.total_quantity ?? 1)
    : (Number(activeReport.quantity ?? activeReport.total_quantity ?? 1) || 1);
  const rawTopSupplier = String(activeReport.supplier_name || activeReport.supplierName || '').trim();
  const effectiveTopSupplier = supplierGroup
    ? supplierGroup.supplierName
    : (isMultiItemBatch
        ? summarizeBatchSuppliers(items, isMixedSuppliersSummary(rawTopSupplier) ? '' : rawTopSupplier)
        : rawTopSupplier);

  const topSupplierEmailTo = supplierGroup
    ? (supplierGroup.supplierEmailTo || '')
    : (hasMixedBatchSuppliers ? '' : String(followUpMeta.supplier_email_to || activeReport.supplier_email_to || '').trim());
  const topSupplierEmailCc = supplierGroup
    ? (supplierGroup.supplierEmailCc || '')
    : (hasMixedBatchSuppliers ? '' : String(followUpMeta.supplier_email_cc || activeReport.supplier_email_cc || '').trim());

  const effectiveUnitPrice = items.length === 1
    ? Number(items[0]?.price ?? activeReport.price ?? 0)
    : Number(activeReport.price || 0);
  const effectivePriceVat = items.length === 1
    ? Number(items[0]?.price_with_vat ?? items[0]?.priceWithVat ?? activeReport.price_with_vat ?? activeReport.priceWithVat ?? 0)
    : Number(activeReport.price_with_vat || activeReport.priceWithVat || 0);

  const gpsAddress = getGpsAddressDisplay(activeReport) || '';
  const gpsMapUrl = getGpsMapUrl(activeReport) || '';
  const isSupplierStream = activeReport.rma_type === 'supplier_outbound';
  const toSummary = Array.isArray(resolvedRecipients?.toList) ? resolvedRecipients.toList.join(', ') : '';
  const ccSummary = Array.isArray(resolvedRecipients?.ccList) ? resolvedRecipients.ccList.join(', ') : '';

  const fieldRows = [
    ['RMA Number', rmaNumber, 'Identifier — do not rename'],
    ['Test Mode', isTest ? 'YES (Sandbox)' : 'NO (Live)', 'Test vs Live isolation guard'],
    ['Logistics Stream', isSupplierStream ? 'supplier_outbound' : 'customer_inbound', 'customer_inbound or supplier_outbound'],
    ...(isSupplierStream ? [] : [['Store / Branch', activeReport.store_branch || '', 'Editable text']]),
    ['Supplier / Vendor Name', effectiveTopSupplier, isMultiItemBatch && !supplierGroup ? 'Auto-summarized from item suppliers below' : 'Editable supplier / updates Supplier Directory'],
    ['Supplier Email (To)', topSupplierEmailTo, hasMixedBatchSuppliers ? 'Mixed-supplier batch — edit per row in MANIFEST LINE ITEMS below' : 'Comma-separated emails for auto follow-ups'],
    ['Supplier Email (CC)', topSupplierEmailCc, hasMixedBatchSuppliers ? 'Mixed-supplier batch — edit per row in MANIFEST LINE ITEMS below' : 'Comma-separated CC emails'],
    ['Barcode', activeReport.barcode || '', 'Plain text barcode'],
    ['Assigned SKU', activeReport.code || activeReport.sku || '', 'Editable SKU / Item Code'],
    ['Product Description', activeReport.name || activeReport.productName || activeReport.product_name || '', 'Editable product name'],
    ['Quantity', effectiveQuantity, isMultiItemBatch ? 'Auto-calculated sum of MANIFEST LINE ITEMS Qty on reply' : 'Numeric quantity', 'number'],
    ['Packaging Unit', activeReport.unit_name || activeReport.unitName || 'pc', 'pc / pack / box / case'],
    ['Unit Price (PHP)', effectiveUnitPrice, 'Net unit price', 'currency'],
    ['Price w/ VAT (PHP)', effectivePriceVat, 'VAT-inclusive unit price', 'currency'],
    ['Defect / Return Reason', activeReport.reason || '', 'Editable defect reason'],
    ['Explanation / Notes', activeReport.explanation || activeReport.notes || '', 'Editable detailed explanation / notes'],
    ['Sales Invoice (SI) #', activeReport.si_number || '', 'Editable SI number'],
    ['Delivery Receipt (DR) #', activeReport.dr_number || activeReport.invoice_dr_number || '', 'Editable DR number'],
    ['Purchase Order (PO) #', activeReport.po_number || '', 'Editable PO number'],
    ['Batch / Lot #', activeReport.batch_lot_number || '', 'Editable batch / lot number'],
    ['Expiry Date (YYYY-MM-DD)', formatDateYmd(activeReport.expiry_date) || '', 'Format: YYYY-MM-DD'],
    ['Warehouse Location', activeReport.warehouse_location || '', 'Editable rack / bin location'],
    ['Account Executive (AE)', activeReport.ae_name || '', 'Optional AE Name'],
    ['AE Email', activeReport.ae_email || '', 'Optional AE Email'],
    ['Reported By', activeReport.reporter_name || activeReport.reported_by || '', 'Reporter full name'],
    ['Contact Number/Email', activeReport.reporter_contact || '', 'Phone number or email'],
    ['Submission Date (YYYY-MM-DD HH:mm)', formatDateTimeYmdHm(activeReport.created_at || new Date()), 'Asia/Manila timestamp'],
    ['GPS Location', gpsAddress || (activeReport.gps_latitude && activeReport.gps_longitude ? `${activeReport.gps_latitude}, ${activeReport.gps_longitude}` : 'No GPS'), 'Clear Street / Barangay / City / ZIP'],
    ['GPS Maps Link', gpsMapUrl, 'Google Maps search URL'],
    ['Google Drive Folder', activeReport.google_drive_folder_url || '', 'Attached photos & paperwork folder'],
    ['Email Subject', subject || `${isTest ? '[TEST] ' : ''}[RMA Alert] ${rmaNumber}`, 'Email alert mirror subject'],
    ['Alert Recipients (To)', toSummary, 'Authorized TO list'],
    ['Alert Recipients (CC)', ccSummary, 'Authorized CC list'],
    ['Online RMA Editor Link', editUrl || '', 'Never-expiring To/CC portal edit link'],
    ...(supplierGroup?.isBatchSlice
      ? [['Batch Supplier Scope', `${supplierGroup.supplierName} | Line Refs: ${supplierGroup.parentLineRefs.join(', ')}`, 'Do not edit — scopes reply updates strictly to these items']]
      : [])
  ];

  const rowsXml = [];
  let rIdx = 1;

  // Title Row
  rowsXml.push(`<row r="${rIdx}" ht="26" customHeight="1">${makeCellXml(`A${rIdx}`, `${isTest ? '[TEST] ' : ''}WHOLESALE RMA ALERT WORKSHEET — ${rmaNumber}`, 1)}${makeCellXml(`B${rIdx}`, '', 1)}${makeCellXml(`C${rIdx}`, '', 1)}${makeCellXml(`D${rIdx}`, '', 1)}</row>`);
  rIdx += 1;

  // Instructions Row
  rowsXml.push(`<row r="${rIdx}" ht="24" customHeight="1">${makeCellXml(`A${rIdx}`, '', 4)}${makeCellXml(`B${rIdx}`, '2-WAY EMAIL REPLY EDITABLE WORKSHEET', 4)}${makeCellXml(`C${rIdx}`, 'Edit any Value cells in Column C (or Manifest rows below), save .xlsx, and Reply / Reply-All to this alert email.', 2)}${makeCellXml(`D${rIdx}`, formatSaveFileTimestamp(new Date()), 4)}</row>`);
  rIdx += 1;

  // Table Headers
  rowsXml.push(`<row r="${rIdx}" ht="22" customHeight="1">${makeCellXml(`A${rIdx}`, 'Serial No.', 3)}${makeCellXml(`B${rIdx}`, 'Field', 3)}${makeCellXml(`C${rIdx}`, 'Value', 3)}${makeCellXml(`D${rIdx}`, 'Format / Notes', 3)}</row>`);
  rIdx += 1;

  fieldRows.forEach(([label, val, note, kind], idx) => {
    const valStyle = kind === 'currency' ? 6 : 5;
    const valType = (kind === 'number' || kind === 'currency') ? 'number' : 'text';
    rowsXml.push(
      `<row r="${rIdx}" ht="20" customHeight="1">` +
      makeCellXml(`A${rIdx}`, idx + 1, 2, 'number') +
      makeCellXml(`B${rIdx}`, label, 4, 'text') +
      makeCellXml(`C${rIdx}`, val, valStyle, valType) +
      makeCellXml(`D${rIdx}`, note, 2, 'text') +
      `</row>`
    );
    rIdx += 1;
  });

  // Manifest table when multi-item batch return (2+ lines) or scoped batch slice
  if (showManifestTable) {
    rIdx += 1;
    rowsXml.push(`<row r="${rIdx}" ht="22" customHeight="1">${makeCellXml(`A${rIdx}`, `MANIFEST LINE ITEMS (${items.length})`, 1)}${makeCellXml(`B${rIdx}`, '', 1)}${makeCellXml(`C${rIdx}`, '', 1)}${makeCellXml(`D${rIdx}`, '', 1)}</row>`);
    rIdx += 1;
    const mHeaders = [
      'Serial No.',
      'Supplier Name',
      'Barcode',
      'Assigned SKU',
      'Product Description',
      'Quantity',
      'Packaging Unit',
      'Expiry Date (YYYY-MM-DD)',
      'Defect Reason',
      'Explanation',
      'Supplier Email (To)',
      'Supplier Email (CC)',
      'Parent Line Ref #'
    ];
    rowsXml.push(
      `<row r="${rIdx}" ht="22" customHeight="1">` +
      mHeaders.map((h, i) => makeCellXml(`${colToLetter(i)}${rIdx}`, h, 3, 'text')).join('') +
      `</row>`
    );
    rIdx += 1;
    items.forEach((it, idx) => {
      const itemSup = isRealSupplierName(it._effectiveSupplierName)
        ? String(it._effectiveSupplierName).trim()
        : (isRealSupplierName(it.supplier_name)
            ? String(it.supplier_name).trim()
            : (isRealSupplierName(it.supplierName)
                ? String(it.supplierName).trim()
                : (!isMixedSuppliersSummary(activeReport.supplier_name) ? String(activeReport.supplier_name || '').trim() : '')));
      const itemTo = String(
        it.supplier_email_to ??
        (supplierGroup && !supplierGroup.isUnassignedBucket ? supplierGroup.supplierEmailTo : '') ??
        ''
      ).trim();
      const itemCc = String(
        it.supplier_email_cc ??
        (supplierGroup && !supplierGroup.isUnassignedBucket ? supplierGroup.supplierEmailCc : '') ??
        ''
      ).trim();
      const parentLineRef = Number(it._parentLineRef || (idx + 1));
      const vals = [
        [idx + 1, 'number', 2],
        [itemSup, 'text', 5],
        [it.barcode || '', 'text', 2],
        [it.code || it.sku || '', 'text', 5],
        [it.name || it.productName || '', 'text', 5],
        [Math.max(1, Number(it.quantity ?? it.qty) || 1), 'number', 5],
        [it.unit_name || it.unit || 'pc', 'text', 5],
        [formatDateYmd(it.expiry_date) || '', 'text', 5],
        [it.reason || activeReport.reason || '', 'text', 5],
        [it.explanation || '', 'text', 5],
        [itemTo, 'text', 5],
        [itemCc, 'text', 5],
        [parentLineRef, 'number', 2]
      ];
      rowsXml.push(
        `<row r="${rIdx}" ht="20" customHeight="1">` +
        vals.map(([v, t, s], i) => makeCellXml(`${colToLetter(i)}${rIdx}`, v, s, t)).join('') +
        `</row>`
      );
      rIdx += 1;
    });
  }

  const maxCols = showManifestTable ? 13 : 4;
  const maxRow = rIdx - 1;
  const colWidths = [11, 32, 46, 40, 36, 12, 16, 22, 24, 34, 34, 30, 16].slice(0, maxCols);
  const colsXml = `<cols>${colWidths.map((w, idx) => `<col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;

  const sheetXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    `<dimension ref="A1:${colToLetter(maxCols - 1)}${maxRow}"/>`,
    '<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="C4" sqref="C4"/></sheetView></sheetViews>',
    '<sheetFormatPr defaultRowHeight="20"/>',
    colsXml,
    `<sheetData>${rowsXml.join('')}</sheetData>`,
    '<mergeCells count="1"><mergeCell ref="A1:D1"/></mergeCells>',
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
  const filename = options.filename || buildRmaAlertFilename(options.subject || report.rma_number || 'RMA Alert');
  const bytes = buildRmaAlertXlsxBytes(report, options);
  return {
    filename,
    content: uint8ToBase64(bytes),
    encoding: 'base64',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    byteLength: bytes.length
  };
}
