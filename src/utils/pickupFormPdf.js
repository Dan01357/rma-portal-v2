import {
  formatPeso,
  getReportManifestItems,
  computeItemPiecesAndValue,
  formatFourChoiceOutcome,
  isTestRecord,
  formatDateYmd
} from './rmaHelpers.js';

const PAGE_W = 1700; // 8.5 in * 200 dpi
const PAGE_H = 2200; // 11.0 in * 200 dpi
const PDF_W = 612;   // 8.5 in * 72 pt
const PDF_H = 792;   // 11.0 in * 72 pt

const MARGIN_X = 76;
const CONTENT_W = PAGE_W - MARGIN_X * 2; // 1548 px

const isPlaceholderSupplier = (val) => {
  const s = String(val || '').trim().toLowerCase();
  return !s || s === 'pending assignment' || s === 'pending' || s === 'unassigned' || s === 'warehouse' || s === 'n/a';
};

function sanitizeFilenamePart(val) {
  return String(val || 'RMA').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'RMA';
}

function uint8ToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

function base64ToUint8(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/**
 * Assemble valid PDF 1.4 binary bytes from JPEG page buffers (612x792 US Letter pt).
 * Exported for deterministic unit verification in Node.
 */
export function buildPdfFromJpegPages(jpegBytePages = [], widthPx = PAGE_W, heightPx = PAGE_H) {
  if (!Array.isArray(jpegBytePages) || jpegBytePages.length === 0) {
    return new Uint8Array(0);
  }

  const encoder = new TextEncoder();
  const parts = [];
  let byteLen = 0;
  const pushBytes = (u8) => {
    parts.push(u8);
    byteLen += u8.length;
  };
  const pushStr = (str) => pushBytes(encoder.encode(str));

  // Header + 4-byte binary marker recommended by PDF 1.4 spec
  pushStr('%PDF-1.4\n');
  pushBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  // Object ID allocation:
  // 1 = Catalog, 2 = Pages
  // For each page i: pageObjId = 3 + i*3, imgObjId = 4 + i*3, contentObjId = 5 + i*3
  const pageCount = jpegBytePages.length;
  const totalObjs = 2 + pageCount * 3;
  const offsets = new Array(totalObjs + 1).fill(0);

  const pageKidsRefs = [];
  for (let i = 0; i < pageCount; i++) {
    pageKidsRefs.push(`${3 + i * 3} 0 R`);
  }

  offsets[1] = byteLen;
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  offsets[2] = byteLen;
  pushStr(`2 0 obj\n<< /Type /Pages /Kids [ ${pageKidsRefs.join(' ')} ] /Count ${pageCount} >>\nendobj\n`);

  for (let i = 0; i < pageCount; i++) {
    const jpegBytes = jpegBytePages[i];
    const pageObjId = 3 + i * 3;
    const imgObjId = 4 + i * 3;
    const contentObjId = 5 + i * 3;
    const imName = `/Im${i + 1}`;

    offsets[pageObjId] = byteLen;
    pushStr(
      `${pageObjId} 0 obj\n` +
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_W} ${PDF_H}] ` +
      `/Resources << /XObject << ${imName} ${imgObjId} 0 R >> >> ` +
      `/Contents ${contentObjId} 0 R >>\nendobj\n`
    );

    offsets[imgObjId] = byteLen;
    pushStr(
      `${imgObjId} 0 obj\n` +
      `<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\n` +
      `stream\n`
    );
    pushBytes(jpegBytes);
    pushStr('\nendstream\nendobj\n');

    const contentStream = `q\n${PDF_W} 0 0 ${PDF_H} 0 0 cm\n${imName} Do\nQ\n`;
    offsets[contentObjId] = byteLen;
    pushStr(
      `${contentObjId} 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`
    );
  }

  const xrefOffset = byteLen;
  pushStr(`xref\n0 ${totalObjs + 1}\n`);
  pushStr('0000000000 65535 f \n');
  for (let id = 1; id <= totalObjs; id++) {
    const offStr = String(offsets[id]).padStart(10, '0');
    pushStr(`${offStr} 00000 n \n`);
  }

  pushStr(
    `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`
  );

  const out = new Uint8Array(byteLen);
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    out.set(parts[i], pos);
    pos += parts[i].length;
  }
  return out;
}

function wrapTextLines(ctx, text, maxWidth) {
  const str = String(text ?? '');
  if (!str) return [''];
  const paragraphs = str.split(/\r?\n/);
  const lines = [];

  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        if (ctx.measureText(word).width <= maxWidth) {
          current = word;
        } else {
          // Break very long token (e.g. email string without spaces)
          let chunk = '';
          for (const ch of word) {
            if (ctx.measureText(chunk + ch).width > maxWidth && chunk) {
              lines.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          current = chunk;
        }
      }
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}

function createBlankPageCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.strokeStyle = '#000000';
  ctx.fillStyle = '#000000';
  return { canvas, ctx };
}

function drawBadge(ctx, x, y, text, fontSize = 17, compact = false) {
  ctx.font = `900 ${fontSize}px Arial, Helvetica, sans-serif`;
  const padX = compact ? 10 : 12;
  const h = compact ? 26 : 30;
  const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = '#000000';
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + h / 2 + 1);
  return w;
}

function drawCopyHeaderAndMeta(ctx, startX, startY, width, copyTitle, info, compact = false) {
  let y = startY;
  const pad = compact ? 18 : 24;
  const innerX = startX + pad;
  const innerW = width - pad * 2;

  // Badges row + right-side Ref/RMA strip
  let badgeX = innerX;
  const bw1 = drawBadge(ctx, badgeX, y, copyTitle.toUpperCase(), compact ? 15 : 16, compact);
  badgeX += bw1 + 10;
  if (info.isTest) {
    drawBadge(ctx, badgeX, y, '[TEST MODE RECORD]', compact ? 15 : 16, compact);
  }

  // Right column info
  ctx.textAlign = 'right';
  ctx.fillStyle = '#000000';
  ctx.font = `900 ${compact ? 17 : 19}px "Courier New", Courier, monospace`;
  ctx.textBaseline = 'top';
  ctx.fillText(info.refLineLabel, innerX + innerW, y);
  ctx.font = `900 ${compact ? 22 : 26}px "Courier New", Courier, monospace`;
  ctx.fillText(`RMA #: ${info.rmaNumber}`, innerX + innerW, y + (compact ? 22 : 26));
  ctx.font = `600 ${compact ? 15 : 16}px Arial, Helvetica, sans-serif`;
  const statusLine = `${info.formattedTime ? `${info.formattedTime} • ` : ''}${info.photoCount}/5 Drive Photos Verified`;
  ctx.fillText(statusLine, innerX + innerW, y + (compact ? 48 : 56));

  // Title on left
  ctx.textAlign = 'left';
  const leftMaxW = innerW * 0.62;
  y += compact ? 32 : 38;
  ctx.font = `900 ${compact ? 22 : 27}px Arial, Helvetica, sans-serif`;
  ctx.fillText(info.formHeaderTitle, innerX, y, leftMaxW);
  y += compact ? 27 : 33;
  ctx.font = `700 ${compact ? 16 : 18}px Arial, Helvetica, sans-serif`;
  ctx.fillText(`Purpose: ${info.claimPurposeLabel}`, innerX, y, leftMaxW);

  y = Math.max(y + (compact ? 24 : 28), startY + (compact ? 86 : 100));
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(innerX, y);
  ctx.lineTo(innerX + innerW, y);
  ctx.stroke();

  y += compact ? 10 : 14;

  // Supplier, Driver, Handwritten box
  const boxX = innerX;
  const boxW = innerW;
  const colHalf = boxW / 2;

  ctx.font = `700 ${compact ? 14 : 15}px Arial, Helvetica, sans-serif`;
  const emailSummary = [
    info.supplierEmailTo ? `To: ${info.supplierEmailTo}` : '',
    info.supplierEmailCc ? `CC: ${info.supplierEmailCc}` : ''
  ].filter(Boolean).join(' • ');
  ctx.font = `600 ${compact ? 14 : 15}px "Courier New", Courier, monospace`;
  const emailLines = emailSummary ? wrapTextLines(ctx, emailSummary, colHalf - 24).slice(0, 2) : [];

  const row1H = compact ? (52 + emailLines.length * 16) : (62 + emailLines.length * 18);
  const row2H = compact ? 44 : 52;
  const row3H = compact ? 52 : 62;
  const metaBoxH = row1H + row2H + row3H;

  ctx.lineWidth = 1.6;
  ctx.strokeRect(boxX, y, boxW, metaBoxH);

  // Row 1: Supplier Company Name | Truck Plate #
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';
  ctx.font = `700 ${compact ? 13 : 14}px Arial, Helvetica, sans-serif`;
  ctx.fillText('SUPPLIER COMPANY NAME', boxX + 12, y + 8);
  ctx.fillText('TRUCK PLATE #', boxX + colHalf + 12, y + 8);

  ctx.font = `900 ${compact ? 19 : 22}px Arial, Helvetica, sans-serif`;
  ctx.fillText(info.supplierName, boxX + 12, y + 26, colHalf - 24);
  if (emailLines.length > 0) {
    ctx.font = `600 ${compact ? 13 : 14}px "Courier New", Courier, monospace`;
    emailLines.forEach((line, idx) => {
      ctx.fillText(line, boxX + 12, y + (compact ? 48 : 54) + idx * (compact ? 16 : 18), colHalf - 24);
    });
  }

  ctx.font = `700 ${compact ? 18 : 20}px "Courier New", Courier, monospace`;
  ctx.fillText(info.truckPlate || '________________________', boxX + colHalf + 12, y + 27, colHalf - 24);

  // Row 2: Driver Name | Driver License #
  const r2Y = y + row1H;
  ctx.font = `700 ${compact ? 13 : 14}px Arial, Helvetica, sans-serif`;
  ctx.fillText('DRIVER NAME', boxX + 12, r2Y + 4);
  ctx.fillText('DRIVER LICENSE #', boxX + colHalf + 12, r2Y + 4);
  ctx.font = `700 ${compact ? 17 : 19}px Arial, Helvetica, sans-serif`;
  ctx.fillText(info.driverName || '___________________________', boxX + 12, r2Y + 21, colHalf - 24);
  ctx.font = `700 ${compact ? 17 : 19}px "Courier New", Courier, monospace`;
  ctx.fillText(info.driverLicense || '___________________________', boxX + colHalf + 12, r2Y + 21, colHalf - 24);

  // Row 3: Handwritten fields
  const r3Y = r2Y + row2H;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(boxX, r3Y);
  ctx.lineTo(boxX + boxW, r3Y);
  ctx.stroke();

  ctx.font = `700 ${compact ? 13 : 14}px Arial, Helvetica, sans-serif`;
  ctx.fillText('PICKUP DATE & TIME (YYYY-MM-DD HH:mm) (DRIVER WRITES)', boxX + 12, r3Y + 7);
  ctx.fillText('DRIVER CONTACT # (DRIVER WRITES)', boxX + colHalf + 12, r3Y + 7);

  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(boxX + 12, r3Y + metaBoxH - row1H - row2H - 10);
  ctx.lineTo(boxX + colHalf - 16, r3Y + metaBoxH - row1H - row2H - 10);
  ctx.moveTo(boxX + colHalf + 12, r3Y + metaBoxH - row1H - row2H - 10);
  ctx.lineTo(boxX + boxW - 12, r3Y + metaBoxH - row1H - row2H - 10);
  ctx.stroke();

  return y + metaBoxH + (compact ? 10 : 14);
}

function getTableColumns(width) {
  // Proportions sum to 1.0: #, Desc/SKU, Expiry, Qty, Unit Price, Line Total
  const w0 = 48;
  const w2 = 225;
  const w3 = 270;
  const w4 = 165;
  const w5 = 175;
  const w1 = width - (w0 + w2 + w3 + w4 + w5);
  return [
    { x: 0, w: w0, label: '#', align: 'center' },
    { x: w0, w: w1, label: 'ITEM DESCRIPTION / SKU', align: 'left' },
    { x: w0 + w1, w: w2, label: 'EXPIRY DATE (YYYY-MM-DD)', align: 'center' },
    { x: w0 + w1 + w2, w: w3, label: 'QTY (CONVERTED TO PCS)', align: 'right' },
    { x: w0 + w1 + w2 + w3, w: w4, label: 'UNIT PRICE', align: 'right' },
    { x: w0 + w1 + w2 + w3 + w4, w: w5, label: 'LINE TOTAL', align: 'right' }
  ];
}

function drawTableHeader(ctx, tableX, y, tableW, cols, compact = false) {
  const h = compact ? 32 : 38;
  ctx.lineWidth = 1.8;
  ctx.strokeRect(tableX, y, tableW, h);
  ctx.font = `900 ${compact ? 13 : 14}px Arial, Helvetica, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000000';

  cols.forEach((c, idx) => {
    const cx = tableX + c.x;
    if (idx > 0) {
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.lineTo(cx, y + h);
      ctx.stroke();
    }
    ctx.textAlign = c.align;
    const textX = c.align === 'center' ? cx + c.w / 2 : (c.align === 'right' ? cx + c.w - 8 : cx + 8);
    ctx.fillText(c.label, textX, y + h / 2 + 1, c.w - 14);
  });

  return y + h;
}

function measureItemRowHeight(ctx, it, cols, compact = false) {
  ctx.font = `700 ${compact ? 16 : 18}px Arial, Helvetica, sans-serif`;
  const nameLines = wrapTextLines(ctx, it.name, cols[1].w - 16);
  const lineH = compact ? 20 : 23;
  return Math.max(compact ? 42 : 48, 12 + nameLines.length * lineH + (compact ? 16 : 19));
}

function drawItemRow(ctx, tableX, y, tableW, cols, it, rowH, compact = false) {
  ctx.lineWidth = 1.4;
  ctx.strokeRect(tableX, y, tableW, rowH);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';

  cols.forEach((c, idx) => {
    if (idx > 0) {
      ctx.beginPath();
      ctx.moveTo(tableX + c.x, y);
      ctx.lineTo(tableX + c.x, y + rowH);
      ctx.stroke();
    }
  });

  // Col 0: #
  ctx.font = `700 ${compact ? 15 : 17}px "Courier New", Courier, monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(String(it.idx), tableX + cols[0].x + cols[0].w / 2, y + 8);

  // Col 1: Description + SKU
  ctx.font = `700 ${compact ? 16 : 18}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'left';
  const nameLines = wrapTextLines(ctx, it.name, cols[1].w - 16);
  const lineH = compact ? 20 : 23;
  nameLines.forEach((ln, i) => {
    ctx.fillText(ln, tableX + cols[1].x + 8, y + 7 + i * lineH, cols[1].w - 14);
  });
  ctx.font = `600 ${compact ? 13 : 14}px "Courier New", Courier, monospace`;
  ctx.fillText(`SKU: ${it.sku}`, tableX + cols[1].x + 8, y + 7 + nameLines.length * lineH, cols[1].w - 14);

  // Col 2: Expiry Date
  ctx.font = `600 ${compact ? 15 : 17}px "Courier New", Courier, monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(it.expiry, tableX + cols[2].x + cols[2].w / 2, y + 8, cols[2].w - 12);

  // Col 3: Qty
  const qtyText = it.isCaseUnit && it.piecesPerCase > 1
    ? `${it.totalPieces.toLocaleString()} pcs (${it.rawQty} ${it.unitName} × ${it.piecesPerCase})`
    : `${it.totalPieces.toLocaleString()} ${it.unitName === 'pc' || it.totalPieces === 1 ? 'pc' : 'pcs'}`;
  ctx.font = `700 ${compact ? 15 : 17}px "Courier New", Courier, monospace`;
  ctx.textAlign = 'right';
  ctx.fillText(qtyText, tableX + cols[3].x + cols[3].w - 8, y + 8, cols[3].w - 14);

  // Col 4: Unit Price
  const unitPrice = it.isCaseUnit && it.piecesPerCase > 1 ? it.pricePerPiece : it.recordedUnitPrice;
  ctx.font = `600 ${compact ? 15 : 17}px "Courier New", Courier, monospace`;
  ctx.fillText(`${formatPeso(unitPrice)}/pc`, tableX + cols[4].x + cols[4].w - 8, y + 8, cols[4].w - 14);

  // Col 5: Line Total
  ctx.font = `700 ${compact ? 15 : 17}px "Courier New", Courier, monospace`;
  ctx.fillText(formatPeso(it.lineTotal), tableX + cols[5].x + cols[5].w - 8, y + 8, cols[5].w - 14);

  return y + rowH;
}

function drawTotalRow(ctx, tableX, y, tableW, cols, info, compact = false) {
  const h = compact ? 36 : 42;
  ctx.lineWidth = 2.0;
  ctx.strokeRect(tableX, y, tableW, h);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'middle';

  const col3X = tableX + cols[3].x;
  const col4X = tableX + cols[4].x;
  const col5X = tableX + cols[5].x;

  [col3X, col4X, col5X].forEach((vx) => {
    ctx.beginPath();
    ctx.moveTo(vx, y);
    ctx.lineTo(vx, y + h);
    ctx.stroke();
  });

  ctx.textAlign = 'right';
  ctx.font = `900 ${compact ? 14 : 16}px Arial, Helvetica, sans-serif`;
  ctx.fillText(
    `TOTAL SUMMARY (${info.normalizedItems.length} LINE${info.normalizedItems.length > 1 ? 'S' : ''}):`,
    col3X - 10,
    y + h / 2 + 1
  );

  ctx.font = `900 ${compact ? 16 : 18}px "Courier New", Courier, monospace`;
  ctx.fillText(`${info.grandTotalPieces.toLocaleString()} pcs`, col4X - 8, y + h / 2 + 1, cols[3].w - 14);

  ctx.font = `700 ${compact ? 14 : 15}px Arial, Helvetica, sans-serif`;
  ctx.fillText('Total Value:', col5X - 8, y + h / 2 + 1, cols[4].w - 14);

  ctx.font = `900 ${compact ? 17 : 19}px "Courier New", Courier, monospace`;
  ctx.fillText(formatPeso(info.grandTotalValue), tableX + tableW - 8, y + h / 2 + 1, cols[5].w - 14);

  return y + h;
}

function drawSignatures(ctx, innerX, y, innerW, preparedBy, compact = false) {
  const gap = 20;
  const boxW = (innerW - gap * 2) / 3;
  const boxH = compact ? 102 : 124;

  const boxes = [
    { title: 'PREPARED BY (LOGISTICS / WAREHOUSE)', name: preparedBy, footer: 'Printed Name & Date' },
    { title: "SUPPLIER DRIVER'S SIGNATURE", name: '', footer: 'Signature Over Printed Name & Date' },
    { title: "RELEASING STAFF'S SIGNATURE", name: '', footer: 'Verified & Released (Sign & Date)' }
  ];

  boxes.forEach((b, idx) => {
    const bx = innerX + idx * (boxW + gap);
    ctx.lineWidth = 1.6;
    ctx.strokeRect(bx, y, boxW, boxH);

    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `700 ${compact ? 13 : 14}px Arial, Helvetica, sans-serif`;
    ctx.fillText(b.title, bx + boxW / 2, y + (compact ? 10 : 12), boxW - 14);

    if (b.name) {
      ctx.font = `700 ${compact ? 17 : 19}px Arial, Helvetica, sans-serif`;
      ctx.fillText(b.name, bx + boxW / 2, y + (compact ? 42 : 52), boxW - 20);
    }

    const lineY = y + boxH - (compact ? 30 : 34);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx + 18, lineY);
    ctx.lineTo(bx + boxW - 18, lineY);
    ctx.stroke();

    ctx.font = `500 ${compact ? 13 : 14}px Arial, Helvetica, sans-serif`;
    ctx.fillText(b.footer, bx + boxW / 2, lineY + 6, boxW - 14);
  });

  return y + boxH;
}

function renderCompactDualCopyPage(info) {
  const { canvas, ctx } = createBlankPageCanvas();
  const topBoxY = 64;
  const boxH = 950;
  const bottomBoxY = 1186;

  [
    { title: 'OUR COMPANY COPY', y: topBoxY },
    { title: "SUPPLIER DRIVER'S COPY", y: bottomBoxY }
  ].forEach(({ title, y }) => {
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(MARGIN_X, y, CONTENT_W, boxH);

    const pad = 18;
    const innerX = MARGIN_X + pad;
    const innerW = CONTENT_W - pad * 2;
    let curY = drawCopyHeaderAndMeta(ctx, MARGIN_X, y + pad, CONTENT_W, title, info, true);

    const cols = getTableColumns(innerW);
    curY = drawTableHeader(ctx, innerX, curY, innerW, cols, true);
    for (const it of info.normalizedItems) {
      const rh = measureItemRowHeight(ctx, it, cols, true);
      curY = drawItemRow(ctx, innerX, curY, innerW, cols, it, rh, true);
    }
    drawTotalRow(ctx, innerX, curY, innerW, cols, info, true);

    drawSignatures(ctx, innerX, y + boxH - pad - 102, innerW, info.preparedBy, true);
  });

  // Dead-center cut line
  const cutY = 1100;
  ctx.save();
  ctx.setLineDash([12, 10]);
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = '#000000';
  ctx.beginPath();
  ctx.moveTo(MARGIN_X, cutY);
  ctx.lineTo(MARGIN_X + CONTENT_W, cutY);
  ctx.stroke();
  ctx.restore();

  ctx.font = `900 17px Arial, Helvetica, sans-serif`;
  const cutLabel = '  CUT HERE (50% US LETTER)  ';
  const tw = ctx.measureText(cutLabel).width;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect((PAGE_W - tw) / 2 - 12, cutY - 14, tw + 24, 28);
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(cutLabel, PAGE_W / 2, cutY);

  return [canvas];
}

function renderFullPageCopy(info, copyTitle) {
  const canvases = [];
  const boxY = 70;
  const boxH = PAGE_H - 140;
  const bottomLimit = boxY + boxH - 26;
  const pad = 24;
  const innerX = MARGIN_X + pad;
  const innerW = CONTENT_W - pad * 2;
  const cols = getTableColumns(innerW);

  let pageObj = createBlankPageCanvas();
  let { canvas, ctx } = pageObj;
  canvases.push(canvas);

  const drawFrame = () => {
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(MARGIN_X, boxY, CONTENT_W, boxH);
  };
  drawFrame();

  let curY = drawCopyHeaderAndMeta(ctx, MARGIN_X, boxY + pad, CONTENT_W, copyTitle, info, false);
  curY = drawTableHeader(ctx, innerX, curY, innerW, cols, false);

  for (let i = 0; i < info.normalizedItems.length; i++) {
    const it = info.normalizedItems[i];
    const rowH = measureItemRowHeight(ctx, it, cols, false);
    const isLast = i === info.normalizedItems.length - 1;
    const reserveAfter = isLast ? (42 + 16 + 124) : 0;

    if (curY + rowH + reserveAfter > bottomLimit) {
      pageObj = createBlankPageCanvas();
      canvas = pageObj.canvas;
      ctx = pageObj.ctx;
      canvases.push(canvas);
      drawFrame();

      ctx.font = `900 18px Arial, Helvetica, sans-serif`;
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`${copyTitle} (Continued) — ${info.formHeaderTitle} • RMA #: ${info.rmaNumber}`, innerX, boxY + pad);
      curY = boxY + pad + 32;
      curY = drawTableHeader(ctx, innerX, curY, innerW, cols, false);
    }

    curY = drawItemRow(ctx, innerX, curY, innerW, cols, it, rowH, false);
  }

  curY = drawTotalRow(ctx, innerX, curY, innerW, cols, info, false);
  drawSignatures(ctx, innerX, curY + 18, innerW, info.preparedBy, false);

  return canvases;
}

/**
 * Generates a Base64-encoded Letter-size Plain B&W PDF attachment matching SupplierPickupFormModal.
 * Returns null gracefully if running outside a Canvas-capable browser.
 */
export function generatePickupFormPdfAttachment({
  report,
  allReports = [],
  catalogProducts = [],
  preparedByOverride = null
}) {
  if (!report || typeof document === 'undefined') return null;

  try {
    const meta = report.ai_document_metadata || {};
    const pickup = meta.supplier_pickup || {};
    const outcome = formatFourChoiceOutcome(report);

    const rmaNumber = report.rma_number || report.rmaNumber || report.id || 'N/A';
    const isTest = isTestRecord(report);
    const bc = String(report.barcode || '').trim();
    const skuCode = String(report.code || report.sku || '').trim();
    const matchedCatalogProd = (catalogProducts || []).find((p) =>
      (bc && p.barcode && String(p.barcode).trim() === bc) ||
      (skuCode && (String(p.code || '').trim() === skuCode || String(p.sku || '').trim() === skuCode))
    );

    const supplierName = [
      pickup.supplier_name,
      report.supplier_name,
      report.supplierName,
      report.supplier,
      matchedCatalogProd?.supplier_name,
      matchedCatalogProd?.supplierName
    ].find((cand) => !isPlaceholderSupplier(cand)) || 'Pending Assignment';

    const dispositionCode = String(pickup.disposition || meta.simple_rtv_disposition || report.disposition || '').toLowerCase();
    const isReplacementForm =
      dispositionCode === 'supplier_exchange' ||
      dispositionCode === 'customer_exchange' ||
      outcome.choiceKey === 'replacement';

    const claimNumber = outcome.claimNumber || pickup.claim_number || '';
    const formHeaderTitle = isReplacementForm
      ? 'SUPPLIER REPLACEMENT / EXCHANGE & PICKUP FORM'
      : 'SUPPLIER DEBIT CLAIM & PICKUP VALIDATION FORM';
    const claimPurposeLabel = isReplacementForm
      ? 'Return to Supplier for Replacement / Exchange'
      : 'Return to Supplier for Debit Claim / AP Deduction';
    const refLineLabel = isReplacementForm
      ? `Replacement Ref #: ${claimNumber || rmaNumber}`
      : `Claim #: ${claimNumber || rmaNumber}`;

    const manifestChildren = getReportManifestItems(report, allReports);
    const rawItems = manifestChildren.length > 0 ? manifestChildren : [report];
    const normalizedItems = rawItems.map((it, idx) => {
      const calc = computeItemPiecesAndValue(it, catalogProducts);
      const rawExp = String(it.expiry_date || it.ai_document_metadata?.expiry_date || report.expiry_date || '').trim();
      const cleanExpiry = formatDateYmd(rawExp) || rawExp || '—';
      return {
        idx: idx + 1,
        name: it.name || it.product_name || it.productName || `Item ${it.barcode || idx + 1}`,
        sku: (it.code && it.code !== it.barcode ? it.code : (it.sku && it.sku !== it.barcode ? it.sku : '')) || it.barcode || '—',
        expiry: cleanExpiry,
        ...calc
      };
    });

    const preparedBy = String(
      preparedByOverride ||
      pickup.processed_by ||
      report.inspected_by ||
      meta.simple_rtv_updated_by ||
      'Warehouse Staff'
    ).replace(/\s*\([^)]*\)/g, '').trim() || 'Warehouse Staff';

    const info = {
      rmaNumber,
      isTest,
      isReplacementForm,
      formHeaderTitle,
      claimPurposeLabel,
      refLineLabel,
      formattedTime: outcome.formattedTime || '',
      photoCount: pickup.photos && typeof pickup.photos === 'object' ? Object.keys(pickup.photos).length : 0,
      supplierName,
      supplierEmailTo: pickup.supplier_email_to || '',
      supplierEmailCc: pickup.supplier_email_cc || '',
      truckPlate: pickup.truck_plate || '',
      driverName: pickup.driver_name || report.driver_name || '',
      driverLicense: pickup.driver_license_no || '',
      preparedBy,
      normalizedItems,
      grandTotalPieces: normalizedItems.reduce((s, it) => s + it.totalPieces, 0),
      grandTotalValue: normalizedItems.reduce((s, it) => s + it.lineTotal, 0)
    };

    const canvases = normalizedItems.length <= 4
      ? renderCompactDualCopyPage(info)
      : [
          ...renderFullPageCopy(info, 'OUR COMPANY COPY'),
          ...renderFullPageCopy(info, "SUPPLIER DRIVER'S COPY")
        ];

    const encodeAtQuality = (quality) => {
      const jpegPages = canvases.map((c) => {
        const dataUrl = c.toDataURL('image/jpeg', quality);
        const b64 = dataUrl.split(',')[1] || '';
        return base64ToUint8(b64);
      });
      const pdfBytes = buildPdfFromJpegPages(jpegPages, PAGE_W, PAGE_H);
      return uint8ToBase64(pdfBytes);
    };

    let base64Pdf = encodeAtQuality(0.82);
    if (base64Pdf.length > 2_400_000) {
      base64Pdf = encodeAtQuality(0.65);
    }

    const safeRma = sanitizeFilenamePart(rmaNumber);
    const filename = isReplacementForm
      ? `Replacement-Form-${safeRma}.pdf`
      : `Debit-Claim-Form-${safeRma}.pdf`;

    return {
      filename,
      content: base64Pdf,
      encoding: 'base64',
      contentType: 'application/pdf',
      pageCount: canvases.length
    };
  } catch (err) {
    console.warn('Could not generate pickup PDF attachment:', err);
    return null;
  }
}
