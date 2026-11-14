/**
 * Dynamic-size RMA Box Sticker PNG exporter.
 * Renders a crisp 300-DPI proportional sticker canvas matching the user's chosen
 * widthMm x heightMm physical dimensions (Small Tuna Can up to Extra Large Carton).
 */

import { formatQuantityWithPackSize, formatManifestBreakdown } from './rmaHelpers';

function loadSvgAsImage(svgElementOrId) {
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

function wrapLines(ctx, text, maxWidth, maxLines = 4) {
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
      // Break overly long unspaced tokens cleanly
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
 * Generates and downloads a high-resolution PNG of the RMA sticker using the user's
 * custom millimeter dimensions while keeping all required details readable.
 */
export async function downloadCustomSizedStickerPng({
  svgElementOrId = 'rma-qr-code-svg',
  widthMm = 90,
  heightMm = 105,
  rmaNumber = 'RMA-TICKET',
  isTestMode = false,
  streamType = 'supplier_outbound',
  supplier = 'Warehouse',
  storeBranch = '',
  itemName = 'Returned Merchandise',
  barcode = 'N/A',
  sku = '',
  quantity = 1,
  unit = 'pc',
  piecesPerCase = 1,
  expiryDate = '',
  reason = 'Damaged / Return',
  reporter = 'Warehouse Staff',
  reporterContact = 'N/A',
  dateTimeFormatted = '',
  items = [],
  totalItems = 1,
  totalQuantity = 1
}) {
  const { img, blobUrl } = await loadSvgAsImage(svgElementOrId);

  try {
    // 300 DPI equivalent clamped so even small tuna can stickers remain ultra sharp when saved
    const clampedW = Math.max(40, Math.min(200, Number(widthMm) || 90));
    const clampedH = Math.max(38, Math.min(250, Number(heightMm) || 105));
    const pxPerMm = clampedW < 65 ? 16 : 12;
    const W = Math.round(clampedW * pxPerMm);
    const H = Math.round(clampedH * pxPerMm);
    const s = Math.min(W / 1080, H / 1260);
    const pad = Math.max(22, Math.round(36 * s));

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not initialize canvas context.');

    // White sheet background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // Outer solid border
    const borderInset = Math.max(10, Math.round(16 * s));
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = Math.max(4, Math.round(6 * s));
    ctx.strokeRect(borderInset, borderInset, W - borderInset * 2, H - borderInset * 2);

    let y = borderInset + Math.round(pad * 0.65);
    const innerX = borderInset + Math.round(pad * 0.7);
    const innerW = W - (borderInset + Math.round(pad * 0.7)) * 2;

    // Header bar
    const headerH = Math.max(48, Math.round(82 * s));
    ctx.fillStyle = isTestMode ? '#78350f' : '#0f172a';
    ctx.fillRect(innerX, y, innerW, headerH);

    ctx.fillStyle = '#ffffff';
    const titleSize = Math.max(16, Math.round(28 * s));
    ctx.font = `900 ${titleSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const headerTitle = isTestMode
      ? 'TEST SANDBOX • DO NOT SHIP LIVE'
      : streamType === 'supplier_outbound'
        ? 'PINGCON • SUPPLIER RTV STICKER'
        : 'PINGCON • RETURN VERIFICATION';
    ctx.fillText(headerTitle, innerX + Math.round(16 * s), y + headerH * 0.5);

    ctx.font = `bold ${Math.max(13, Math.round(20 * s))}px Consolas, monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(clampedW)}×${Math.round(clampedH)}mm`, innerX + innerW - Math.round(16 * s), y + headerH * 0.5);

    y += headerH + Math.round(18 * s);

    // Middle top row: Left = RMA ID + Supplier/Branch, Right = Private QR
    const qrBoxSize = Math.max(150, Math.min(Math.round(W * 0.34), Math.round(H * 0.36)));
    const qrX = innerX + innerW - qrBoxSize;
    const leftW = innerW - qrBoxSize - Math.round(18 * s);

    // QR border + image + footer bar
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = Math.max(3, Math.round(4 * s));
    ctx.strokeRect(qrX, y, qrBoxSize, qrBoxSize);
    const qrPad = Math.max(8, Math.round(12 * s));
    ctx.drawImage(img, qrX + qrPad, y + qrPad, qrBoxSize - qrPad * 2, qrBoxSize - qrPad * 2);

    const qrCapH = Math.max(24, Math.round(34 * s));
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(qrX, y + qrBoxSize, qrBoxSize, qrCapH);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.max(11, Math.round(16 * s))}px Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('IN-APP PORTAL ONLY', qrX + qrBoxSize / 2, y + qrBoxSize + qrCapH / 2);

    // Left details beside QR
    let ly = y + Math.round(10 * s);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#64748b';
    ctx.font = `bold ${Math.max(12, Math.round(18 * s))}px Inter, sans-serif`;
    ctx.fillText('RMA REFERENCE ID', innerX, ly);
    ly += Math.max(18, Math.round(24 * s));

    ctx.fillStyle = '#0f172a';
    let rmaFontSize = Math.max(20, Math.round(36 * s));
    ctx.font = `900 ${rmaFontSize}px Consolas, monospace`;
    while (ctx.measureText(rmaNumber).width > leftW && rmaFontSize > 16) {
      rmaFontSize -= 2;
      ctx.font = `900 ${rmaFontSize}px Consolas, monospace`;
    }
    ctx.fillText(rmaNumber, innerX, ly);
    ly += rmaFontSize + Math.round(14 * s);

    const entityLabel = streamType === 'supplier_outbound' ? 'SUPPLIER' : 'BRANCH / ENTITY';
    const entityVal = streamType === 'supplier_outbound'
      ? (supplier || 'Pending Assignment')
      : (storeBranch || supplier || 'Warehouse');
    ctx.fillStyle = '#64748b';
    ctx.font = `bold ${Math.max(11, Math.round(16 * s))}px Inter, sans-serif`;
    ctx.fillText(entityLabel, innerX, ly);
    ly += Math.max(15, Math.round(20 * s));

    ctx.fillStyle = '#0f172a';
    ctx.font = `bold ${Math.max(15, Math.round(24 * s))}px Inter, sans-serif`;
    const entityLines = wrapLines(ctx, entityVal, leftW, 2);
    entityLines.forEach((line) => {
      ctx.fillText(line, innerX, ly);
      ly += Math.max(19, Math.round(28 * s));
    });

    if (expiryDate) {
      ly += Math.round(4 * s);
      ctx.fillStyle = '#b45309';
      ctx.font = `bold ${Math.max(13, Math.round(20 * s))}px Consolas, monospace`;
      ctx.fillText(`EXP: ${expiryDate}`, innerX, ly);
      ly += Math.max(18, Math.round(26 * s));
    }

    y = Math.max(y + qrBoxSize + qrCapH + Math.round(16 * s), ly + Math.round(12 * s));

    // Divider
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = Math.max(2, Math.round(3 * s));
    ctx.beginPath();
    ctx.moveTo(innerX, y);
    ctx.lineTo(innerX + innerW, y);
    ctx.stroke();
    y += Math.round(14 * s);

    // Item & Qty summary
    const isManifest = (Array.isArray(items) && items.length > 1) || Number(totalItems) > 1;
    const itemDisplay = isManifest
      ? `BATCH MANIFEST (${totalItems || items.length} SKUs): ${items.slice(0, 3).map((i) => i.name || i.barcode).join(', ')}${items.length > 3 ? '...' : ''}`
      : itemName;

    ctx.fillStyle = '#64748b';
    ctx.font = `bold ${Math.max(11, Math.round(16 * s))}px Inter, sans-serif`;
    ctx.fillText('PRODUCT / RETURN CONTENTS', innerX, y);
    y += Math.max(16, Math.round(22 * s));

    ctx.fillStyle = '#0f172a';
    ctx.font = `bold ${Math.max(15, Math.round(24 * s))}px Inter, sans-serif`;
    const itemLines = wrapLines(ctx, itemDisplay, innerW, 2);
    itemLines.forEach((line) => {
      ctx.fillText(line, innerX, y);
      y += Math.max(19, Math.round(28 * s));
    });

    const qtyText = isManifest
      ? `${totalQuantity} pcs total across ${totalItems || items.length} SKUs`
      : formatQuantityWithPackSize(quantity, unit, piecesPerCase);
    const metaLine = isManifest
      ? `Qty: ${qtyText} • ${formatManifestBreakdown(items, quantity, unit, true)}`
      : `Barcode: ${barcode}${sku ? ` | SKU: ${sku}` : ''} | Qty: ${qtyText}`;

    ctx.fillStyle = '#334155';
    ctx.font = `bold ${Math.max(12, Math.round(19 * s))}px Consolas, monospace`;
    wrapLines(ctx, metaLine, innerW, 2).forEach((line) => {
      ctx.fillText(line, innerX, y);
      y += Math.max(16, Math.round(24 * s));
    });

    y += Math.round(6 * s);
    ctx.fillStyle = '#dc2626';
    ctx.font = `bold ${Math.max(13, Math.round(20 * s))}px Inter, sans-serif`;
    wrapLines(ctx, `Reason: ${reason || 'Damaged / Return'}`, innerW, 2).forEach((line) => {
      ctx.fillText(line, innerX, y);
      y += Math.max(17, Math.round(25 * s));
    });

    // Bottom section pinned before footer border: Reporter + Date/Time + Physical Signature Line
    const sigBoxH = Math.max(66, Math.round(108 * s));
    const sigY = H - borderInset - Math.round(pad * 0.55) - sigBoxH;

    // Reporter metadata strip right above signature box
    const repY = Math.max(y + Math.round(6 * s), sigY - Math.max(44, Math.round(68 * s)));
    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(innerX, repY);
    ctx.lineTo(innerX + innerW, repY);
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = `bold ${Math.max(12, Math.round(19 * s))}px Inter, sans-serif`;
    ctx.fillText(`Reported by: ${reporter || 'Staff'} (${reporterContact || 'N/A'})`, innerX, repY + Math.round(10 * s));
    ctx.fillStyle = '#475569';
    ctx.font = `600 ${Math.max(11, Math.round(17 * s))}px Consolas, monospace`;
    ctx.fillText(`Date & Time: ${dateTimeFormatted}`, innerX, repY + Math.round(34 * s));

    // Signature Box
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(innerX, sigY, innerW, sigBoxH);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = Math.max(2, Math.round(2.5 * s));
    ctx.strokeRect(innerX, sigY, innerW, sigBoxH);

    ctx.fillStyle = '#475569';
    ctx.font = `bold ${Math.max(11, Math.round(16 * s))}px Inter, sans-serif`;
    ctx.fillText('REPORTER SIGNATURE (SIGN AFTER PRINTING)', innerX + Math.round(14 * s), sigY + Math.round(10 * s));

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = Math.max(2, Math.round(3 * s));
    ctx.beginPath();
    ctx.moveTo(innerX + Math.round(16 * s), sigY + sigBoxH - Math.round(22 * s));
    ctx.lineTo(innerX + Math.round(innerW * 0.66), sigY + sigBoxH - Math.round(22 * s));
    ctx.moveTo(innerX + Math.round(innerW * 0.72), sigY + sigBoxH - Math.round(22 * s));
    ctx.lineTo(innerX + innerW - Math.round(16 * s), sigY + sigBoxH - Math.round(22 * s));
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = `bold ${Math.max(10, Math.round(14 * s))}px Inter, sans-serif`;
    ctx.fillText('Date Signed', innerX + Math.round(innerW * 0.72), sigY + sigBoxH - Math.round(16 * s));

    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${rmaNumber}-Sticker-${Math.round(clampedW)}x${Math.round(clampedH)}mm.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

