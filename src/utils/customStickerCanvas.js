/**
 * Unified Printable RMA QR Card & Consolidated Sheet PNG Exporter.
 * Single source of truth for card metadata normalization, multi-up paper layout packing,
 * auto-fit grid math, and crisp high-DPI pure B&W canvas PNG rendering.
 */

import {
  formatQuantityWithPackSize,
  formatManifestBreakdown,
  formatDateYmd,
  formatDateTimeYmdHm,
  isTestRecord
} from './rmaHelpers';

export const PAPER_PRESETS = [
  { id: 'letter', label: 'US Letter', sub: '215.9 × 279.4 mm', widthMm: 215.9, heightMm: 279.4 },
  { id: 'legal', label: 'US Legal', sub: '215.9 × 355.6 mm', widthMm: 215.9, heightMm: 355.6 },
  { id: 'a4', label: 'A4', sub: '210 × 297 mm', widthMm: 210, heightMm: 297 },
  { id: 'half_letter', label: 'Half Letter', sub: '139.7 × 215.9 mm', widthMm: 139.7, heightMm: 215.9 },
  { id: 'thermal_4x6', label: 'Thermal 4" × 6"', sub: '101.6 × 152.4 mm', widthMm: 101.6, heightMm: 152.4 },
  { id: 'custom', label: 'Custom Paper Size', sub: 'Editable W × H mm', widthMm: 215.9, heightMm: 279.4 }
];

export const QR_SIZE_PRESETS = [
  { id: 'mini', label: 'Mini', sub: '50 × 58 mm', widthMm: 50, heightMm: 58 },
  { id: 'small', label: 'Small', sub: '58 × 68 mm', widthMm: 58, heightMm: 68 },
  { id: 'medium', label: 'Medium', sub: '90 × 105 mm', widthMm: 90, heightMm: 105 },
  { id: 'large', label: 'Large', sub: '115 × 148 mm', widthMm: 115, heightMm: 148 }
];

export function loadSvgAsImage(svgElementOrId) {
  const svgEl = typeof svgElementOrId === 'string'
    ? document.getElementById(svgElementOrId)
    : svgElementOrId;

  if (!svgEl) {
    throw new Error('QR SVG element not found in DOM.');
  }

  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!clone.getAttribute('width')) clone.setAttribute('width', '512');
  if (!clone.getAttribute('height')) clone.setAttribute('height', '512');

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clone);
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const blobUrl = URL.createObjectURL(svgBlob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ img, blobUrl });
    img.onerror = (err) => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error(`Failed to render QR SVG to image: ${err?.message || 'unknown'}`));
    };
    img.src = blobUrl;
  });
}

function triggerBlobOrDataUrlDownload(canvas, filename) {
  return new Promise((resolve) => {
    const fallbackDownload = () => {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      resolve(true);
    };

    if (typeof canvas.toBlob !== 'function') {
      fallbackDownload();
      return;
    }

    canvas.toBlob((blob) => {
      if (!blob) {
        fallbackDownload();
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (a.parentNode) document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 250);
      resolve(true);
    }, 'image/png');
  });
}

/**
 * Normalizes any RMA report row or explicit option bag into consistent fields
 * consumed by the React preview card and canvas PNG drawer alike.
 */
export function normalizeRmaQrCardData(input = {}) {
  const manifestItems = Array.isArray(input.items) ? input.items : [];
  const rmaNumber = String(input.rmaNumber || input.rma_number || input.id || 'RMA-TICKET').trim();
  const barcode = String(input.barcode || input.product_barcode || 'N/A').trim() || 'N/A';
  const sku = String(input.sku || input.code || '').trim();
  const itemName = String(
    input.itemName || input.productName || input.name || input.product_name || (barcode !== 'N/A' ? `Barcode ${barcode}` : 'Returned Merchandise')
  ).trim();
  const quantity = Number(input.quantity) || 1;
  const unit = String(input.unit || input.unit_name || 'pc').trim() || 'pc';
  const piecesPerCase = Number(input.piecesPerCase ?? input.pieces_per_case ?? manifestItems[0]?.pieces_per_case ?? manifestItems[0]?.piecesPerCase) || 1;
  const supplier = String(input.supplier || input.supplier_name || '').trim();
  const storeBranch = String(input.storeBranch || input.store_branch || input.store || '').trim();
  const streamType = input.streamType === 'supplier_outbound' || input.rma_type === 'supplier_outbound'
    ? 'supplier_outbound'
    : 'customer_inbound';
  const reason = String(input.reason || input.defect_category || '').trim();
  const reporter = String(input.reporter || input.reporter_name || input.reported_by || '').trim();

  let reporterContact = String(input.reporterContact || input.reporter_contact || input.reporter_phone || input.phone || '').trim();
  if (!reporterContact && typeof input.reported_by === 'string' && input.reported_by.includes('(')) {
    reporterContact = input.reported_by.replace(/.*\((.*)\).*/, '$1').trim();
  }
  if (!reporterContact) reporterContact = 'N/A';

  const isManifest = manifestItems.length > 1 || Number(input.totalItems || input.total_items) > 1;
  const totalItems = Number(input.totalItems || input.total_items) || (manifestItems.length > 0 ? manifestItems.length : 1);
  const totalQuantity = Number(input.totalQuantity || input.total_quantity) || (
    manifestItems.length > 0
      ? manifestItems.reduce((acc, it) => acc + (Number(it?.quantity ?? it?.qty) || 1), 0)
      : quantity
  );

  const rawExpiry = input.expiryDate || input.expiry_date || input.ai_document_metadata?.expiry_date || manifestItems[0]?.expiry_date || '';
  const expiryYmd = rawExpiry ? (formatDateYmd(rawExpiry) || String(rawExpiry).slice(0, 10)) : '';

  const isTest = Boolean(input.isTestMode || input.is_test || isTestRecord({ ...input, rma_number: rmaNumber }));
  const dateTimeFormatted = String(
    input.dateTimeFormatted || input.dateFormatted || (input.created_at ? formatDateTimeYmdHm(input.created_at) : formatDateTimeYmdHm(Date.now()))
  ).trim();

  const qtyFormatted = isManifest
    ? `${formatManifestBreakdown(manifestItems, true)} (${totalQuantity} units)`
    : formatQuantityWithPackSize(quantity, unit, piecesPerCase);

  const displayTitle = isManifest
    ? `Batch Manifest (${totalItems} SKUs)${manifestItems.length > 0 ? `: ${manifestItems.slice(0, 2).map((i) => i.name || i.barcode).filter(Boolean).join(', ')}${manifestItems.length > 2 ? '…' : ''}` : ''}`
    : itemName;

  const isPortalAccess = rmaNumber === 'PUBLIC-RMA-PORTAL';
  const headerTitle = isPortalAccess
    ? 'PUBLIC RMA PORTAL QR'
    : isTest
      ? 'TEST SANDBOX QR'
      : streamType === 'supplier_outbound'
        ? 'SUPPLIER RTV QR'
        : 'WHOLESALE RMA QR';

  const entityLabel = supplier && storeBranch && supplier !== storeBranch
    ? `${supplier} • ${storeBranch}`
    : supplier || storeBranch || (streamType === 'supplier_outbound' ? 'Supplier Pending' : 'Warehouse Intake');

  return {
    rmaNumber,
    barcode,
    sku,
    itemName,
    displayTitle,
    quantity,
    unit,
    piecesPerCase,
    qtyFormatted,
    supplier,
    storeBranch,
    entityLabel,
    streamType,
    reason,
    reporter,
    reporterContact,
    expiryYmd,
    isManifest,
    items: manifestItems,
    totalItems,
    totalQuantity,
    isTest,
    isPortalAccess,
    headerTitle,
    dateTimeFormatted
  };
}

/**
 * Shelf-packs a list of { key, widthMm, heightMm, ... } items into 1 or multiple pages.
 */
export function packQrCardsIntoPages({
  cards = [],
  printableW = 199.9,
  printableH = 263.4,
  gapMm = 4,
  layoutMode = 'one_page',
  centerSingleCard = true
}) {
  if (!Array.isArray(cards) || cards.length === 0) {
    return { pages: [], hasOverflow: false, neededHeightMm: 0 };
  }

  // Center a single card comfortably inside the sheet in 1-page mode if it fits
  if (cards.length === 1 && layoutMode === 'one_page' && centerSingleCard) {
    const c = cards[0];
    const fitsW = c.widthMm <= printableW;
    const fitsH = c.heightMm <= printableH;
    const xMm = fitsW ? Math.max(0, (printableW - c.widthMm) / 2) : 0;
    const yMm = fitsH ? Math.max(0, Math.min(18, (printableH - c.heightMm) / 4)) : 0;
    return {
      pages: [[{ ...c, xMm, yMm, wMm: c.widthMm, hMm: c.heightMm }]],
      hasOverflow: !fitsW || !fitsH,
      neededHeightMm: yMm + c.heightMm
    };
  }

  if (layoutMode === 'one_page') {
    const placements = [];
    let curX = 0;
    let curY = 0;
    let rowH = 0;
    let maxRight = 0;

    cards.forEach((c) => {
      const wMm = Math.min(c.widthMm, printableW);
      const hMm = c.heightMm;
      if (curX > 0 && curX + wMm > printableW + 0.01) {
        curX = 0;
        curY += rowH + gapMm;
        rowH = 0;
      }
      placements.push({ ...c, xMm: curX, yMm: curY, wMm: c.widthMm, hMm: c.heightMm });
      maxRight = Math.max(maxRight, curX + c.widthMm);
      curX += wMm + gapMm;
      rowH = Math.max(rowH, hMm);
    });

    const neededHeightMm = curY + rowH;
    const hasOverflow = neededHeightMm > printableH + 0.25 || maxRight > printableW + 0.25;
    return { pages: [placements], hasOverflow, neededHeightMm };
  }

  // Multi-page shelf packing: never split a single QR card across pages
  const pages = [];
  let pageItems = [];
  let curX = 0;
  let curY = 0;
  let rowH = 0;
  let maxPageHeight = 0;

  cards.forEach((c) => {
    const wMm = Math.min(c.widthMm, printableW);
    const hMm = Math.min(c.heightMm, printableH);

    if (curX > 0 && curX + wMm > printableW + 0.01) {
      curX = 0;
      curY += rowH + gapMm;
      rowH = 0;
    }

    if (pageItems.length > 0 && curY + hMm > printableH + 0.01) {
      maxPageHeight = Math.max(maxPageHeight, curY + rowH);
      pages.push(pageItems);
      pageItems = [];
      curX = 0;
      curY = 0;
      rowH = 0;
    }

    pageItems.push({ ...c, xMm: curX, yMm: curY, wMm: c.widthMm, hMm: c.heightMm });
    curX += wMm + gapMm;
    rowH = Math.max(rowH, hMm);
  });

  if (pageItems.length > 0) {
    maxPageHeight = Math.max(maxPageHeight, curY + rowH);
    pages.push(pageItems);
  }

  return { pages, hasOverflow: false, neededHeightMm: maxPageHeight };
}

/**
 * Computes the largest readable uniform card dimensions so `count` cards fit cleanly
 * inside `printableW × printableH` on a single consolidated page.
 */
export function autoFitGridCardSize(count, printableW, printableH, gapMm = 4, aspectRatio = 1.18) {
  const n = Math.max(1, Number(count) || 1);
  let best = { widthMm: 62, heightMm: 74, area: 0 };

  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const availW = (printableW - gapMm * (cols - 1)) / cols;
    const availH = (printableH - gapMm * (rows - 1)) / rows;
    if (availW <= 10 || availH <= 10) continue;

    const wFromH = availH / aspectRatio;
    const candidateW = Math.floor(Math.min(availW, wFromH, 160));
    const candidateH = Math.floor(Math.min(candidateW * aspectRatio, availH, 210));
    if (candidateW < 28 || candidateH < 32) continue;

    const area = candidateW * candidateH;
    if (area > best.area) {
      best = { widthMm: candidateW, heightMm: candidateH, area };
    }
  }

  if (best.area === 0) {
    return { widthMm: 36, heightMm: 42 };
  }
  return {
    widthMm: Math.max(34, best.widthMm),
    heightMm: Math.max(40, best.heightMm)
  };
}

function wrapLines(ctx, text, maxWidth, maxLines = 2) {
  const str = String(text || '').trim();
  if (!str) return [''];
  const words = str.split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      if (ctx.measureText(word).width > maxWidth) {
        let slice = '';
        for (const ch of word) {
          if (ctx.measureText(slice + ch).width > maxWidth && slice) {
            lines.push(slice);
            slice = ch;
          } else {
            slice += ch;
          }
        }
        current = slice;
      } else {
        current = word;
      }
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  } else if (current && lines.length === maxLines) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.length > 3 ? `${last.slice(0, -1)}…` : last;
  }
  return lines.slice(0, maxLines);
}

/**
 * Draws the ONE Unified Centered Printable QR Card directly inside rect `{ x, y, width, height }` (px).
 * Used identically for single QR PNG download and consolidated multi-up sheet PNG download.
 */
export function drawUnifiedRmaQrCard(ctx, rect, rawCardData, qrImg, { widthMm = 90, heightMm = 105 } = {}) {
  const data = normalizeRmaQrCardData(rawCardData);
  const { x, y, width: W, height: H } = rect;
  const s = Math.min(W / 1080, H / 1260);
  const inset = Math.max(4, Math.round(12 * s));
  const padX = Math.max(10, Math.round(28 * s));
  const innerX = x + inset + padX;
  const innerW = W - (inset + padX) * 2;
  const centerX = x + W / 2;

  ctx.save();

  // White card surface & crisp solid black border
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, W, H);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(2, Math.round(5 * s));
  ctx.strokeRect(x + inset, y + inset, W - inset * 2, H - inset * 2);

  // 1. Header Strip
  const headerH = Math.max(22, Math.round(62 * s));
  const headerY = y + inset;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + inset, headerY, W - inset * 2, headerH);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(1.5, Math.round(3 * s));
  ctx.beginPath();
  ctx.moveTo(x + inset, headerY + headerH);
  ctx.lineTo(x + W - inset, headerY + headerH);
  ctx.stroke();

  ctx.fillStyle = '#000000';
  ctx.font = `900 ${Math.max(9, Math.round(22 * s))}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(data.headerTitle, innerX, headerY + headerH * 0.5);

  if (!data.isPortalAccess) {
    ctx.font = `bold ${Math.max(8, Math.round(18 * s))}px Consolas, monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(widthMm)}×${Math.round(heightMm)}mm`, innerX + innerW, headerY + headerH * 0.5);
  }

  // 2. Bottom Pinned Area (Reporter + Date/Time + Reporter Signature)
  const footerPadB = Math.max(6, Math.round(16 * s));
  let bottomLimitY = y + H - inset - footerPadB;

  if (!data.isPortalAccess) {
    const sigBoxH = Math.max(30, Math.round(86 * s));
    const sigY = bottomLimitY - sigBoxH;

    // Signature box
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.max(1.2, Math.round(2.5 * s));
    ctx.strokeRect(innerX, sigY, innerW, sigBoxH);

    ctx.fillStyle = '#000000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${Math.max(7, Math.round(15 * s))}px Inter, sans-serif`;
    ctx.fillText('REPORTER SIGNATURE', innerX + Math.round(10 * s), sigY + Math.round(8 * s));

    const lineY = sigY + sigBoxH - Math.max(10, Math.round(20 * s));
    ctx.beginPath();
    ctx.moveTo(innerX + Math.round(10 * s), lineY);
    ctx.lineTo(innerX + Math.round(innerW * 0.68), lineY);
    ctx.moveTo(innerX + Math.round(innerW * 0.73), lineY);
    ctx.lineTo(innerX + innerW - Math.round(10 * s), lineY);
    ctx.stroke();

    ctx.font = `bold ${Math.max(6.5, Math.round(13 * s))}px Inter, sans-serif`;
    ctx.fillText('Date', innerX + Math.round(innerW * 0.73), lineY + Math.round(3 * s));

    // Reporter + Date & Time strip directly above Signature Box
    const repLineH = Math.max(11, Math.round(22 * s));
    const repStripH = repLineH * 2 + Math.round(10 * s);
    const repY = sigY - repStripH;

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.max(1, Math.round(2 * s));
    ctx.beginPath();
    ctx.moveTo(innerX, repY);
    ctx.lineTo(innerX + innerW, repY);
    ctx.stroke();

    const repText = data.reporter
      ? `By: ${data.reporter}${data.reporterContact && data.reporterContact !== 'N/A' ? ` (${data.reporterContact})` : ''}`
      : 'By: Staff';
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${Math.max(8, Math.round(17 * s))}px Inter, sans-serif`;
    ctx.fillText(wrapLines(ctx, repText, innerW, 1)[0], innerX, repY + Math.round(5 * s));

    ctx.font = `600 ${Math.max(7.5, Math.round(16 * s))}px Consolas, monospace`;
    ctx.fillText(`DT: ${data.dateTimeFormatted}`, innerX, repY + Math.round(6 * s) + repLineH);

    bottomLimitY = repY - Math.round(6 * s);
  } else {
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = `600 ${Math.max(9, Math.round(20 * s))}px Inter, sans-serif`;
    ctx.fillText(`RMA Portal Verification • ${formatDateYmd(new Date())}`, centerX, bottomLimitY);
    bottomLimitY -= Math.round(28 * s);
  }

  // 3. Top-to-Bottom Centered Body Flow (strictly clamped before bottomLimitY)
  let curY = headerY + headerH + Math.max(6, Math.round(16 * s));
  const availBodyH = Math.max(60, bottomLimitY - curY);

  // Centered High-Contrast Private Portal QR
  const qrCapH = Math.max(12, Math.round(26 * s));
  const maxQrFromH = Math.max(48, Math.round(availBodyH * (data.isPortalAccess ? 0.62 : 0.41)));
  const maxQrFromW = Math.max(48, Math.round(innerW * (data.isPortalAccess ? 0.72 : 0.56)));
  const qrSize = Math.min(maxQrFromH, maxQrFromW);
  const qrBoxX = Math.round(centerX - qrSize / 2);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(qrBoxX, curY, qrSize, qrSize);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(1.5, Math.round(3 * s));
  ctx.strokeRect(qrBoxX, curY, qrSize, qrSize);

  const qrPad = Math.max(4, Math.round(qrSize * 0.055));
  ctx.drawImage(qrImg, qrBoxX + qrPad, curY + qrPad, qrSize - qrPad * 2, qrSize - qrPad * 2);
  curY += qrSize + Math.max(3, Math.round(6 * s));

  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `900 ${Math.max(7, Math.round(15 * s))}px Consolas, monospace`;
  ctx.fillText(data.isPortalAccess ? 'SCAN TO REPORT MERCHANDISE' : 'PORTAL SCAN ONLY', centerX, curY);
  curY += qrCapH;

  // Bold RMA Reference Number
  let rmaFontPx = Math.max(13, Math.round(38 * s));
  ctx.font = `900 ${rmaFontPx}px Consolas, monospace`;
  while (ctx.measureText(data.rmaNumber).width > innerW && rmaFontPx > 10) {
    rmaFontPx -= 1;
    ctx.font = `900 ${rmaFontPx}px Consolas, monospace`;
  }
  if (curY + rmaFontPx <= bottomLimitY) {
    ctx.fillText(data.rmaNumber, centerX, curY);
    curY += rmaFontPx + Math.max(4, Math.round(10 * s));
  }

  // Product Name (1-2 lines centered)
  const prodFontPx = Math.max(9.5, Math.round(23 * s));
  const prodLineH = Math.round(prodFontPx * 1.2);
  ctx.font = `800 ${prodFontPx}px Inter, system-ui, sans-serif`;
  const prodLines = wrapLines(ctx, data.displayTitle, innerW, 2);
  prodLines.forEach((line) => {
    if (curY + prodLineH <= bottomLimitY) {
      ctx.fillText(line, centerX, curY);
      curY += prodLineH;
    }
  });
  curY += Math.max(3, Math.round(8 * s));

  if (data.isPortalAccess) {
    if (data.barcode && data.barcode !== 'N/A' && curY + 24 <= bottomLimitY) {
      ctx.font = `bold ${Math.max(9, Math.round(20 * s))}px Consolas, monospace`;
      wrapLines(ctx, data.barcode, innerW, 2).forEach((line) => {
        if (curY + 22 <= bottomLimitY) {
          ctx.fillText(line, centerX, curY);
          curY += Math.max(14, Math.round(24 * s));
        }
      });
    }
    ctx.restore();
    return;
  }

  // Quantity & Unit Box (Prominent outlined pill)
  const qtyText = `Qty: ${data.qtyFormatted}`;
  let qtyFontPx = Math.max(9, Math.round(22 * s));
  ctx.font = `900 ${qtyFontPx}px Inter, system-ui, sans-serif`;
  while (ctx.measureText(qtyText).width > innerW - Math.round(16 * s) && qtyFontPx > 8) {
    qtyFontPx -= 1;
    ctx.font = `900 ${qtyFontPx}px Inter, system-ui, sans-serif`;
  }
  const qtyBoxH = Math.max(18, qtyFontPx + Math.round(14 * s));
  if (curY + qtyBoxH <= bottomLimitY) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(innerX, curY, innerW, qtyBoxH);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.max(1.5, Math.round(3 * s));
    ctx.strokeRect(innerX, curY, innerW, qtyBoxH);

    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'middle';
    ctx.fillText(qtyText, centerX, curY + qtyBoxH / 2);
    ctx.textBaseline = 'top';
    curY += qtyBoxH + Math.max(4, Math.round(10 * s));
  }

  // Remaining structured lines (Barcode/SKU, Optional Expiry) — Supplier Name intentionally omitted
  const metaFontPx = Math.max(8, Math.round(17 * s));
  const metaLineH = Math.round(metaFontPx * 1.28);
  ctx.font = `bold ${metaFontPx}px Consolas, monospace`;

  const metaItems = [];
  if (!data.isManifest) {
    const bcPart = `BC: ${data.barcode}${data.sku ? ` • SKU: ${data.sku}` : ''}`;
    metaItems.push(bcPart);
  }
  if (data.expiryYmd) {
    metaItems.push(`Exp: ${data.expiryYmd}`);
  }

  metaItems.forEach((rawLine) => {
    const wrapped = wrapLines(ctx, rawLine, innerW, 1);
    wrapped.forEach((l) => {
      if (curY + metaLineH <= bottomLimitY) {
        ctx.fillText(l, centerX, curY);
        curY += metaLineH;
      }
    });
  });

  ctx.restore();
}

/**
 * Generates and downloads a crisp high-resolution PNG of a SINGLE unified RMA QR Card.
 * Defaults filename cleanly to `${rmaNumber}-QR.png`.
 */
export async function downloadCustomSizedStickerPng(options = {}) {
  const {
    svgElementOrId = 'rma-qr-code-svg',
    widthMm = 90,
    heightMm = 105,
    filename
  } = options;

  const data = normalizeRmaQrCardData(options);
  const { img, blobUrl } = await loadSvgAsImage(svgElementOrId);

  try {
    const clampedW = Math.max(34, Math.min(220, Number(widthMm) || 90));
    const clampedH = Math.max(40, Math.min(280, Number(heightMm) || 105));
    const pxPerMm = clampedW < 65 ? 16 : 12;
    const W = Math.round(clampedW * pxPerMm);
    const H = Math.round(clampedH * pxPerMm);

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not initialize canvas context.');

    drawUnifiedRmaQrCard(ctx, { x: 0, y: 0, width: W, height: H }, data, img, {
      widthMm: clampedW,
      heightMm: clampedH
    });

    const outName = filename || `${data.rmaNumber}-QR.png`;
    await triggerBlobOrDataUrlDownload(canvas, outName);
    return outName;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Exports 1 or more packed multi-up paper pages as exact WYSIWYG consolidated PNG files:
 * `{rmaCount}-QRs-{paperSlug}-Page-{n}.png`
 */
export async function downloadConsolidatedQrPagesPng({
  pages = [],
  paperWidthMm = 215.9,
  paperHeightMm = 279.4,
  marginMm = 8,
  paperSlug = 'letter',
  totalQrCount = 0
}) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('No QR pages prepared for PNG export.');
  }

  // Cap max canvas dimension safely (~2400px) while keeping print clarity crisp (~8–10 px/mm)
  const targetPxPerMm = Math.min(10, 2400 / Math.max(paperWidthMm, paperHeightMm, 1));
  const canvasW = Math.round(paperWidthMm * targetPxPerMm);
  const canvasH = Math.round(paperHeightMm * targetPxPerMm);
  const count = totalQrCount || pages.reduce((sum, p) => sum + p.length, 0);
  const savedFilenames = [];

  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const pageCards = pages[pIdx];
    const loadedAssets = [];

    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not initialize consolidated canvas context.');

      // Full white sheet
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvasW, canvasH);

      for (const item of pageCards) {
        const asset = await loadSvgAsImage(item.svgId);
        loadedAssets.push(asset);

        const cardX = Math.round((marginMm + item.xMm) * targetPxPerMm);
        const cardY = Math.round((marginMm + item.yMm) * targetPxPerMm);
        const cardW = Math.round(item.wMm * targetPxPerMm);
        const cardH = Math.round(item.hMm * targetPxPerMm);

        drawUnifiedRmaQrCard(
          ctx,
          { x: cardX, y: cardY, width: cardW, height: cardH },
          item.cardData,
          asset.img,
          { widthMm: item.wMm, heightMm: item.hMm }
        );
      }

      const fileName = `${count}-QRs-${paperSlug}-Page-${pIdx + 1}.png`;
      await triggerBlobOrDataUrlDownload(canvas, fileName);
      savedFilenames.push(fileName);
      if (pIdx < pages.length - 1) {
        await new Promise((r) => setTimeout(r, 140));
      }
    } finally {
      loadedAssets.forEach((a) => {
        if (a?.blobUrl) URL.revokeObjectURL(a.blobUrl);
      });
    }
  }

  return savedFilenames;
}
