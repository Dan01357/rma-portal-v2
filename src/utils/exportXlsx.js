/**
 * Zero-dependency OOXML (.xlsx) Table & ZIP Builder
 * Generates genuine .xlsx files (Stored ZIP + OOXML workbook) compatible with Microsoft Excel, Google Sheets, and Vercel/browser.
 * - Optional Title Row 1 + Metadata Subtitle Row 2 (matching Pingcon Matrix .xlsx styling)
 * - Bold navy header row with frozen panes
 * - Auto-fitted column widths
 * - Numeric & currency cells for quantities/prices/totals
 * - Plain inlineStr text cells for barcodes/SKUs/RMA#/phone numbers (no scientific notation, no ="..." raw formulas)
 */

const textEncoder = new TextEncoder();

export function escapeXml(str) {
  return String(str ?? '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function colToLetter(colIdxZeroBased) {
  let n = colIdxZeroBased + 1;
  let result = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
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

export function buildStoredZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = textEncoder.encode(file.name);
    const dataBytes = textEncoder.encode(file.content);
    const crc = crc32(dataBytes);

    const lh = new ArrayBuffer(30 + nameBytes.length);
    const lv = new DataView(lh);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x5421, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    new Uint8Array(lh, 30).set(nameBytes);

    localParts.push(new Uint8Array(lh), dataBytes);

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

function buildTableStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="#,##0"/>
    <numFmt numFmtId="165" formatCode="#,##0.00"/>
  </numFmts>
  <fonts count="4">
    <font><sz val="10"/><color rgb="FF0F172A"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="13"/><color rgb="FF0F172A"/><name val="Arial"/></font>
    <font><i/><sz val="10"/><color rgb="FF334155"/><name val="Arial"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF9C3"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="10">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
  </cellXfs>
</styleSheet>`;
}

/**
 * Build genuine .xlsx bytes from tabular columns & rows.
 * @param {{ sheetName?: string, title?: string, subtitle?: string, columns: Array<{header: string, width?: number, type?: 'text'|'number'|'currency'}>, rows: Array<Array<any>> }} params
 */
export function buildTableXlsxBytes({ sheetName = 'Export', title = '', subtitle = '', columns = [], rows = [] }) {
  const safeSheetName = String(sheetName || 'Export').replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 31) || 'Export';

  const colWidths = columns.map((col, cIdx) => {
    if (col.width) return col.width;
    let maxLen = String(col.header || '').length;
    const sampleLimit = Math.min(rows.length, 200);
    for (let r = 0; r < sampleLimit; r++) {
      const valLen = String(rows[r]?.[cIdx] ?? '').length;
      if (valLen > maxLen) maxLen = valLen;
    }
    return Math.min(48, Math.max(12, maxLen + 4));
  });

  const colsXml = `<cols>${colWidths.map((w, idx) => {
    const n = idx + 1;
    return `<col min="${n}" max="${n}" width="${w}" customWidth="1"/>`;
  }).join('')}</cols>`;

  const sheetRows = [];
  const merges = [];
  const lastColIdx = Math.max(0, columns.length - 1);
  const lastColLetter = colToLetter(lastColIdx);
  let currentRow = 1;

  if (title) {
    sheetRows.push(
      `<row r="${currentRow}" ht="24" customHeight="1"><c r="A${currentRow}" s="8" t="inlineStr"><is><t xml:space="preserve">${escapeXml(title)}</t></is></c></row>`
    );
    currentRow += 1;
  }

  if (subtitle) {
    const subCells = [
      `<c r="A${currentRow}" s="9" t="inlineStr"><is><t xml:space="preserve">${escapeXml(subtitle)}</t></is></c>`
    ];
    for (let c = 1; c <= lastColIdx; c++) {
      subCells.push(`<c r="${colToLetter(c)}${currentRow}" s="9"/>`);
    }
    sheetRows.push(`<row r="${currentRow}" ht="18" customHeight="1">${subCells.join('')}</row>`);
    if (lastColIdx > 0) {
      merges.push(`A${currentRow}:${lastColLetter}${currentRow}`);
    }
    currentRow += 1;
  }

  // Bold Navy Header Row
  const headerRowNum = currentRow;
  const headerCells = columns.map((col, cIdx) => {
    const ref = `${colToLetter(cIdx)}${headerRowNum}`;
    return `<c r="${ref}" s="1" t="inlineStr"><is><t xml:space="preserve">${escapeXml(col.header)}</t></is></c>`;
  });
  sheetRows.push(`<row r="${headerRowNum}" ht="24" customHeight="1">${headerCells.join('')}</row>`);
  currentRow += 1;

  const firstDataRowNum = currentRow;

  // Data Rows
  rows.forEach((row, rIdx) => {
    const rowNum = firstDataRowNum + rIdx;
    const isAlt = rIdx % 2 === 1;
    const cells = columns.map((col, cIdx) => {
      const ref = `${colToLetter(cIdx)}${rowNum}`;
      const rawVal = row[cIdx];
      const colType = col.type || 'text';

      if (colType === 'number' || colType === 'currency') {
        const num = Number(rawVal);
        if (rawVal !== '' && rawVal !== null && rawVal !== undefined && Number.isFinite(num)) {
          const styleIdx = colType === 'currency' ? (isAlt ? 7 : 6) : (isAlt ? 5 : 4);
          return `<c r="${ref}" s="${styleIdx}"><v>${num}</v></c>`;
        }
      }

      const textStyle = isAlt ? 3 : 2;
      const strVal = rawVal === null || rawVal === undefined ? '' : String(rawVal);
      return `<c r="${ref}" s="${textStyle}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(strVal)}</t></is></c>`;
    });
    sheetRows.push(`<row r="${rowNum}" ht="19" customHeight="1">${cells.join('')}</row>`);
  });

  const mergeXml = merges.length > 0
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
    : '';

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView tabSelected="1" workbookViewId="0">
      <pane ySplit="${headerRowNum}" topLeftCell="A${firstDataRowNum}" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="19"/>
  ${colsXml}
  <sheetData>
    ${sheetRows.join('\n    ')}
  </sheetData>
  ${mergeXml}
</worksheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(safeSheetName)}" sheetId="1" r:id="rId1"/>
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

  return buildStoredZip([
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: rootRelsXml },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', content: wbRelsXml },
    { name: 'xl/styles.xml', content: buildTableStylesXml() },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml }
  ]);
}

/**
 * Download a genuine .xlsx file in the browser.
 */
export function downloadTableXlsx({ sheetName = 'Export', title = '', subtitle = '', filename, columns = [], rows = [] }) {
  const bytes = buildTableXlsxBytes({ sheetName, title, subtitle, columns, rows });
  const safeFilename = String(filename || 'Export.xlsx').replace(/\.(csv|xlsx)$/i, '') + '.xlsx';
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFilename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);

  return safeFilename;
}
