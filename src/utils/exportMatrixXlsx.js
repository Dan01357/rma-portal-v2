/**
 * Genuine OOXML (.xlsx) Matrix Exporter matching Pingcon's Daily Ordered/Returned Products template.
 * Zero external dependencies: builds valid Stored ZIP + OOXML workbook with:
 *   - Title Row 1, Italic Metadata Row 2, Alternating Navy/Blue Week Banners Row 3 + Green TOTAL Banner
 *   - Navy Header Row 4: SKU | Description | YYYY-MM-DD... | Week total (pcs) | Total pcs returned
 *   - Real Excel =SUM(...) formulas with cached values, green non-zero highlights (#DCFCE7)
 *   - Collapsible daily date column outlines (outlineLevel="1") & Freeze Panes at C5
 *   - Strict Customer Hub vs Supplier RTV stream separation and Live vs Test Mode isolation
 */

import {
  computeItemPiecesAndValue,
  getCleanSku,
  getReportManifestItems,
  isBatchManifest,
  isManifestSubItem,
  isTestRecord,
  isTrashedRecord
} from './rmaHelpers.js';

const textEncoder = new TextEncoder();

function escapeXml(str) {
  return String(str ?? '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colToLetter(colIdxZeroBased) {
  let n = colIdxZeroBased + 1;
  let result = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

/** Format an ISO timestamp or YYYY-MM-DD string into Asia/Manila YYYY-MM-DD */
export function toManilaDateKey(dateInput) {
  if (!dateInput) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateInput).trim())) {
    return String(dateInput).trim();
  }
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function formatManilaTimestampDisplay(date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      month: 'long',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(date).replace(' at ', ' ');
  } catch {
    return date.toISOString();
  }
}

function enumerateDateRange(startYmd, endYmd) {
  const [sy, sm, sd] = startYmd.split('-').map(Number);
  const [ey, em, ed] = endYmd.split('-').map(Number);
  const start = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(ey, em - 1, ed));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }
  const dates = [];
  const cur = new Date(start.getTime());
  // Hard cap at 370 days to prevent runaway browser memory on typos
  let guard = 0;
  while (cur <= end && guard < 370) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
    guard += 1;
  }
  return dates;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatShortMonDay(utcDate) {
  const mon = SHORT_MONTHS[utcDate.getUTCMonth()];
  const day = String(utcDate.getUTCDate()).padStart(2, '0');
  return `${mon} ${day}`;
}

/**
 * Group consecutive YYYY-MM-DD dates into Monday..Sunday week buckets
 * matching banners like "Sep 28 - Oct 04", "Oct 05 - Oct 11", "Nov 09 - Nov 15".
 */
function buildWeekBlocks(dateStrings) {
  const blocks = [];
  let current = null;

  dateStrings.forEach((ymd) => {
    const [y, m, d] = ymd.split('-').map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d));
    const dow = utc.getUTCDay(); // 0 = Sun, 1 = Mon, ... 6 = Sat
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(utc.getTime());
    monday.setUTCDate(monday.getUTCDate() + mondayOffset);
    const sunday = new Date(monday.getTime());
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    const weekKey = monday.toISOString().slice(0, 10);

    if (!current || current.weekKey !== weekKey) {
      current = {
        weekKey,
        label: `${formatShortMonDay(monday)} - ${formatShortMonDay(sunday)}`,
        dates: []
      };
      blocks.push(current);
    }
    current.dates.push(ymd);
  });

  return blocks;
}

/**
 * Prepare matrix dataset cleanly respecting stream & mode separation without mutating inputs.
 */
export function buildRmaMatrixDataset({
  reports = [],
  catalogProducts = [],
  stream = 'supplier_outbound', // 'supplier_outbound' | 'customer_inbound'
  isTestMode = false,
  startDate = '',
  endDate = '',
  includeZeroCatalogSkus = false
}) {
  const safeEnd = endDate || toManilaDateKey(new Date());
  let safeStart = startDate;
  if (!safeStart) {
    const d = new Date(`${safeEnd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 29);
    safeStart = d.toISOString().slice(0, 10);
  }

  const allDates = enumerateDateRange(safeStart, safeEnd);
  const weekBlocks = buildWeekBlocks(allDates);
  const dateSet = new Set(allDates);

  // Strict Live vs Test & Stream filtering
  const filteredTopReports = (Array.isArray(reports) ? reports : []).filter((r) => {
    if (!r || isTrashedRecord(r)) return false;
    const recordIsTest = isTestRecord(r);
    if (Boolean(isTestMode) !== recordIsTest) return false;
    const rStream = r.rma_type === 'supplier_outbound' ? 'supplier_outbound' : 'customer_inbound';
    if (rStream !== stream) return false;
    if (isManifestSubItem(r, reports)) return false;
    return true;
  });

  // Aggregate pieces by SKU/key + date
  const skuMap = new Map();

  const ensureSkuEntry = (rawKey, skuLabel, descLabel) => {
    const mapKey = String(rawKey || descLabel || 'UNKNOWN').trim().toUpperCase();
    if (!skuMap.has(mapKey)) {
      skuMap.set(mapKey, {
        sku: skuLabel || mapKey,
        description: descLabel || skuLabel || 'Unnamed Product',
        dailyPcs: Object.create(null),
        totalInPeriod: 0
      });
    }
    return skuMap.get(mapKey);
  };

  if (includeZeroCatalogSkus && Array.isArray(catalogProducts)) {
    catalogProducts.forEach((p) => {
      const sku = getCleanSku(p.code || p.sku, p.barcode) || String(p.barcode || '').trim();
      const desc = p.name || `Barcode ${p.barcode || sku}`;
      if (sku) ensureSkuEntry(sku, sku, desc);
    });
  }

  filteredTopReports.forEach((report) => {
    const reportDate = toManilaDateKey(report.created_at || report.updated_at);
    if (!reportDate || !dateSet.has(reportDate)) return;

    const lines = isBatchManifest(report, reports)
      ? getReportManifestItems(report, reports)
      : [report];
    const effectiveLines = lines.length > 0 ? lines : [report];

    effectiveLines.forEach((line) => {
      const bc = String(line.barcode || report.barcode || '').trim();
      const matchedCatalog = Array.isArray(catalogProducts)
        ? catalogProducts.find((p) => (
            (bc && String(p.barcode || '').trim() === bc) ||
            (line.code && String(p.code || '').trim() === String(line.code).trim())
          ))
        : null;

      const cleanSku =
        getCleanSku(line.code || line.sku || matchedCatalog?.code || matchedCatalog?.sku, bc) ||
        bc ||
        'UNASSIGNED';

      const desc =
        line.name ||
        line.product_name ||
        line.productName ||
        matchedCatalog?.name ||
        (bc ? `Barcode ${bc}` : 'Returned Item');

      const { totalPieces } = computeItemPiecesAndValue(line, catalogProducts);
      if (totalPieces <= 0) return;

      const entry = ensureSkuEntry(cleanSku, cleanSku, desc);
      if (!entry.description || entry.description.startsWith('Barcode ')) {
        entry.description = desc;
      }
      entry.dailyPcs[reportDate] = (entry.dailyPcs[reportDate] || 0) + totalPieces;
      entry.totalInPeriod += totalPieces;
    });
  });

  const rows = Array.from(skuMap.values())
    .filter((entry) => includeZeroCatalogSkus || entry.totalInPeriod > 0)
    .sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }));

  const grandTotalPcs = rows.reduce((sum, r) => sum + r.totalInPeriod, 0);

  return {
    startDate: safeStart,
    endDate: safeEnd,
    allDates,
    weekBlocks,
    rows,
    monitoredSkuCount: rows.length,
    grandTotalPcs
  };
}

// ==========================================
// Minimal CRC-32 + Stored ZIP Builder
// ==========================================
const CRC_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    tbl[i] = c >>> 0;
  }
  return tbl;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildStoredZip(files) {
  // files: [{ name: string, content: string }]
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = textEncoder.encode(file.name);
    const dataBytes = textEncoder.encode(file.content);
    const crc = crc32(dataBytes);

    // Local file header (30 bytes + name)
    const lh = new ArrayBuffer(30 + nameBytes.length);
    const lv = new DataView(lh);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed 2.0
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 0, true); // compression 0 = stored
    lv.setUint16(10, 0, true); // mod time
    lv.setUint16(12, 0x5421, true); // mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    new Uint8Array(lh, 30).set(nameBytes);

    localParts.push(new Uint8Array(lh), dataBytes);

    // Central directory header (46 bytes + name)
    const ch = new ArrayBuffer(46 + nameBytes.length);
    const cv = new DataView(ch);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x5421, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    new Uint8Array(ch, 46).set(nameBytes);

    centralParts.push(new Uint8Array(ch));
    offset += 30 + nameBytes.length + dataBytes.length;
  });

  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalLen = offset + centralSize + 22;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  [...localParts, ...centralParts, new Uint8Array(eocd)].forEach((chunk) => {
    out.set(chunk, pos);
    pos += chunk.length;
  });
  return out;
}

// ==========================================
// OOXML Styles & Sheet XML Builders
// ==========================================
function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1">
    <numFmt numFmtId="164" formatCode="#,##0"/>
  </numFmts>
  <fonts count="7">
    <font><sz val="10"/><color rgb="FF0F172A"/><name val="Arial"/></font>
    <font><b/><sz val="14"/><color rgb="FF0F172A"/><name val="Arial"/></font>
    <font><i/><sz val="10"/><color rgb="FF334155"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF14532D"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF1E3A5F"/><name val="Arial"/></font>
  </fonts>
  <fills count="8">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF9C3"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0284C7"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF14532D"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FF94A3B8"/></left>
      <right style="thin"><color rgb="FF94A3B8"/></right>
      <top style="medium"><color rgb="FF1E3A5F"/></top>
      <bottom style="medium"><color rgb="FF1E3A5F"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="15">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="4" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="4" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="6" fillId="7" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="7" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
  </cellXfs>
</styleSheet>`;
}

function inlineStrCell(ref, styleIdx, value) {
  return `<c r="${ref}" s="${styleIdx}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function numCell(ref, styleIdx, value) {
  return `<c r="${ref}" s="${styleIdx}"><v>${Number(value) || 0}</v></c>`;
}

function formulaNumCell(ref, styleIdx, formula, cachedVal) {
  return `<c r="${ref}" s="${styleIdx}"><f>${escapeXml(formula)}</f><v>${Number(cachedVal) || 0}</v></c>`;
}

/**
 * Generates the raw Uint8Array bytes of the genuine .xlsx file.
 * Exported directly so automated Node QA tests can verify ZIP + XML + formulas + totals.
 */
export function buildRmaMatrixXlsxBytes({
  reports = [],
  catalogProducts = [],
  stream = 'supplier_outbound', // 'supplier_outbound' | 'customer_inbound'
  isTestMode = false,
  startDate = '',
  endDate = '',
  includeZeroCatalogSkus = false
}) {
  const dataset = buildRmaMatrixDataset({
    reports,
    catalogProducts,
    stream,
    isTestMode,
    startDate,
    endDate,
    includeZeroCatalogSkus
  });

  const { startDate: sDate, endDate: eDate, weekBlocks, rows, monitoredSkuCount, grandTotalPcs } = dataset;

  // Map physical columns:
  // Col 0: SKU, Col 1: Description
  // Then for each weekBlock: dates (outlineLevel=1), followed by Week total (pcs)
  // Final col: Total pcs returned
  const columns = [
    { kind: 'sku', header: 'SKU', width: 16 },
    { kind: 'desc', header: 'Description', width: 42 }
  ];

  const weekMeta = [];
  const weekTotalCols = [];

  weekBlocks.forEach((wb, wIdx) => {
    const startCol = columns.length;
    wb.dates.forEach((ymd) => {
      columns.push({ kind: 'date', ymd, header: ymd, width: 13, outlineLevel: 1 });
    });
    const lastDateCol = columns.length - 1;
    const weekTotalCol = columns.length;
    columns.push({ kind: 'weekTotal', header: 'Week total (pcs)', width: 16, startDateCol: startCol, endDateCol: lastDateCol });
    weekTotalCols.push(weekTotalCol);
    weekMeta.push({
      label: wb.label,
      startCol,
      endCol: weekTotalCol,
      bannerStyle: wIdx % 2 === 0 ? 3 : 4
    });
  });

  const grandTotalCol = columns.length;
  columns.push({ kind: 'grandTotal', header: 'Total pcs returned', width: 20 });

  const lastColIdx = columns.length - 1;
  const lastColLetter = colToLetter(lastColIdx);
  const grandTotalLetter = colToLetter(grandTotalCol);

  const streamTitle = stream === 'supplier_outbound'
    ? 'SUPPLIER RTV'
    : 'CUSTOMER RMA HUB';
  const modePrefix = isTestMode ? 'TEST MODE SANDBOX — ' : '';
  const row1Title = `${modePrefix}${streamTitle} — DAILY RETURNED PRODUCTS REPORT`;
  const row2Meta = `Generated: ${formatManilaTimestampDisplay()} (Asia/Manila) | Period: ${sDate} to ${eDate} | Monitored SKUs: ${monitoredSkuCount} | Total Returned: ${grandTotalPcs.toLocaleString()} pcs`;

  const sheetRows = [];
  const merges = [];

  // Row 1: Title
  sheetRows.push(`<row r="1" ht="24" customHeight="1">${inlineStrCell('A1', 1, row1Title)}</row>`);

  // Row 2: Subtitle strip across A..lastCol so yellow highlight fills neatly
  const r2Cells = [inlineStrCell('A2', 2, row2Meta)];
  for (let c = 1; c <= lastColIdx; c++) {
    r2Cells.push(`<c r="${colToLetter(c)}2" s="2"/>`);
  }
  sheetRows.push(`<row r="2" ht="18" customHeight="1">${r2Cells.join('')}</row>`);
  if (lastColIdx > 0) merges.push(`A2:${lastColLetter}2`);

  // Row 3: Week Banners + Green TOTAL banner
  const r3Cells = [];
  weekMeta.forEach((wm) => {
    const startRef = `${colToLetter(wm.startCol)}3`;
    const endRef = `${colToLetter(wm.endCol)}3`;
    r3Cells.push(inlineStrCell(startRef, wm.bannerStyle, wm.label));
    for (let c = wm.startCol + 1; c <= wm.endCol; c++) {
      r3Cells.push(`<c r="${colToLetter(c)}3" s="${wm.bannerStyle}"/>`);
    }
    if (wm.endCol > wm.startCol) {
      merges.push(`${startRef}:${endRef}`);
    }
  });
  r3Cells.push(inlineStrCell(`${grandTotalLetter}3`, 5, 'TOTAL'));
  sheetRows.push(`<row r="3" ht="20" customHeight="1">${r3Cells.join('')}</row>`);

  // Row 4: Column Headers
  const r4Cells = columns.map((col, cIdx) => {
    const style = (col.kind === 'sku' || col.kind === 'desc') ? 6 : 7;
    return inlineStrCell(`${colToLetter(cIdx)}4`, style, col.header);
  });
  sheetRows.push(`<row r="4" ht="22" customHeight="1">${r4Cells.join('')}</row>`);

  // Data Rows starting at Row 5
  const firstDataRow = 5;
  rows.forEach((entry, rIdx) => {
    const rowNum = firstDataRow + rIdx;
    const cells = [];

    columns.forEach((col, cIdx) => {
      const ref = `${colToLetter(cIdx)}${rowNum}`;
      if (col.kind === 'sku') {
        cells.push(inlineStrCell(ref, 8, entry.sku));
      } else if (col.kind === 'desc') {
        cells.push(inlineStrCell(ref, 8, entry.description));
      } else if (col.kind === 'date') {
        const val = entry.dailyPcs[col.ymd] || 0;
        cells.push(numCell(ref, val > 0 ? 10 : 9, val));
      } else if (col.kind === 'weekTotal') {
        const weekDates = weekBlocks.find((_, wIdx) => weekTotalCols[wIdx] === cIdx)?.dates || [];
        const cachedWeekSum = weekDates.reduce((s, d) => s + (entry.dailyPcs[d] || 0), 0);
        const startL = colToLetter(col.startDateCol);
        const endL = colToLetter(col.endDateCol);
        const formula = startL === endL
          ? `${startL}${rowNum}`
          : `SUM(${startL}${rowNum}:${endL}${rowNum})`;
        cells.push(formulaNumCell(ref, 11, formula, cachedWeekSum));
      } else if (col.kind === 'grandTotal') {
        const refs = weekTotalCols.map((wtIdx) => `${colToLetter(wtIdx)}${rowNum}`);
        const formula = refs.length > 0 ? `SUM(${refs.join(',')})` : '0';
        cells.push(formulaNumCell(ref, 12, formula, entry.totalInPeriod));
      }
    });

    sheetRows.push(`<row r="${rowNum}" ht="18" customHeight="1">${cells.join('')}</row>`);
  });

  // Grand Totals Footer Row
  const footerRowNum = firstDataRow + rows.length;
  const lastDataRow = Math.max(firstDataRow, footerRowNum - 1);
  const footerCells = columns.map((col, cIdx) => {
    const L = colToLetter(cIdx);
    const ref = `${L}${footerRowNum}`;
    if (col.kind === 'sku') return inlineStrCell(ref, 14, 'TOTAL');
    if (col.kind === 'desc') return inlineStrCell(ref, 14, `${monitoredSkuCount} Returned SKUs (${sDate} to ${eDate})`);

    let cachedColSum = 0;
    if (col.kind === 'date') {
      cachedColSum = rows.reduce((s, r) => s + (r.dailyPcs[col.ymd] || 0), 0);
    } else if (col.kind === 'weekTotal') {
      const weekDates = weekBlocks.find((_, wIdx) => weekTotalCols[wIdx] === cIdx)?.dates || [];
      cachedColSum = rows.reduce(
        (s, r) => s + weekDates.reduce((ws, d) => ws + (r.dailyPcs[d] || 0), 0),
        0
      );
    } else if (col.kind === 'grandTotal') {
      cachedColSum = grandTotalPcs;
    }

    const formula = rows.length > 0 ? `SUM(${L}${firstDataRow}:${L}${lastDataRow})` : '0';
    return formulaNumCell(ref, 13, formula, cachedColSum);
  });
  sheetRows.push(`<row r="${footerRowNum}" ht="21" customHeight="1">${footerCells.join('')}</row>`);

  const colsXml = `<cols>${columns.map((col, idx) => {
    const n = idx + 1;
    const outlineAttr = col.outlineLevel ? ` outlineLevel="${col.outlineLevel}"` : '';
    return `<col min="${n}" max="${n}" width="${col.width}" customWidth="1"${outlineAttr}/>`;
  }).join('')}</cols>`;

  const mergeXml = merges.length > 0
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
    : '';

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView tabSelected="1" workbookViewId="0">
      <pane xSplit="2" ySplit="4" topLeftCell="C5" activePane="bottomRight" state="frozen"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="18" outlineLevelCol="1"/>
  ${colsXml}
  <sheetData>
    ${sheetRows.join('\n    ')}
  </sheetData>
  ${mergeXml}
</worksheet>`;

  const sheetTabName = stream === 'supplier_outbound'
    ? (isTestMode ? 'Test Supplier RTV Matrix' : 'Daily Returned - RTV')
    : (isTestMode ? 'Test Customer RMA Matrix' : 'Daily Returned - Customer');

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(sheetTabName.slice(0, 31))}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const wbRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const bytes = buildStoredZip([
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: rootRelsXml },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', content: wbRelsXml },
    { name: 'xl/styles.xml', content: buildStylesXml() },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml }
  ]);

  return { bytes, dataset };
}

/**
 * Generates and downloads the real .xlsx file in the browser.
 */
export function downloadRmaMatrixXlsx(options) {
  const { bytes, dataset } = buildRmaMatrixXlsxBytes(options);
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  const prefix = options.isTestMode ? 'TEST_' : '';
  const streamTag = options.stream === 'supplier_outbound'
    ? 'Supplier_RTV_Daily_Returned'
    : 'Customer_Hub_Daily_Returned';
  const filename = `${prefix}${streamTag}_Pieces_${dataset.startDate}_to_${dataset.endDate}.xlsx`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return { filename, dataset };
}
