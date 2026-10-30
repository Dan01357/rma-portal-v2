/**
 * QR Code & Box Sticker Download Utility
 * Client-side high-resolution PNG & SVG generation for mobile and desktop devices.
 */

/**
 * Convert an SVG element to an HTMLImageElement
 */
function svgToImage(svgElement) {
  return new Promise((resolve, reject) => {
    try {
      const xml = new XMLSerializer().serializeToString(svgElement);
      const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      const URL = window.URL || window.webkitURL || window;
      const blobUrl = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        resolve({ img, blobUrl });
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(blobUrl);
        reject(err);
      };
      img.src = blobUrl;
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Trigger file download via a transient anchor element
 */
function triggerDownload(dataUrlOrBlob, filename) {
  const isBlob = dataUrlOrBlob instanceof Blob;
  const url = isBlob ? URL.createObjectURL(dataUrlOrBlob) : dataUrlOrBlob;
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    if (isBlob) URL.revokeObjectURL(url);
  }, 200);
}

/**
 * Helper: Draw multi-line wrapped text with strict boundary management (left aligned)
 * Returns the Y coordinate after the last line of text drawn.
 */
function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  if (!text) return y;
  const words = String(text).trim().split(/\s+/);
  let line = '';
  let currentY = y;
  let linesDrawn = 0;

  for (let n = 0; n < words.length; n++) {
    const testLine = line ? `${line} ${words[n]}` : words[n];
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      linesDrawn++;
      if (linesDrawn >= maxLines) {
        // Last line limit hit: append ellipsis only if more words remain
        let truncatedLine = line;
        while (ctx.measureText(truncatedLine + '...').width > maxWidth && truncatedLine.length > 0) {
          truncatedLine = truncatedLine.slice(0, -1);
        }
        ctx.fillText(truncatedLine + '...', x, currentY);
        return currentY + lineHeight;
      }
      ctx.fillText(line, x, currentY);
      line = words[n];
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }

  if (line) {
    ctx.fillText(line, x, currentY);
    currentY += lineHeight;
  }

  return currentY;
}

/**
 * Helper: Draw multi-line wrapped text with center alignment
 */
function drawWrappedTextCentered(ctx, text, centerX, y, maxWidth, lineHeight, maxLines = 2) {
  if (!text) return y;
  const words = String(text).trim().split(/\s+/);
  let line = '';
  let currentY = y;
  let linesDrawn = 0;

  for (let n = 0; n < words.length; n++) {
    const testLine = line ? `${line} ${words[n]}` : words[n];
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      linesDrawn++;
      if (linesDrawn >= maxLines) {
        let truncatedLine = line;
        while (ctx.measureText(truncatedLine + '...').width > maxWidth && truncatedLine.length > 0) {
          truncatedLine = truncatedLine.slice(0, -1);
        }
        ctx.fillText(truncatedLine + '...', centerX, currentY);
        return currentY + lineHeight;
      }
      ctx.fillText(line, centerX, currentY);
      line = words[n];
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }

  if (line) {
    ctx.fillText(line, centerX, currentY);
    currentY += lineHeight;
  }

  return currentY;
}

/**
 * Download High-Resolution QR Code (PNG)
 * Generates an ultra-crisp card with the QR code and RMA Ticket info.
 */
export async function downloadQrCodePng({
  svgElementOrId,
  rmaNumber = 'RMA-TICKET',
  productName = '',
  barcode = '',
  reporter = '',
  reporterContact = '',
  dateFormatted = '',
  filename
}) {
  const svgEl = typeof svgElementOrId === 'string'
    ? document.getElementById(svgElementOrId)
    : svgElementOrId;

  if (!svgEl) {
    throw new Error('QR SVG element not found in DOM.');
  }

  const { img, blobUrl } = await svgToImage(svgEl);

  try {
    // Canvas dimensions (high-res 1200 x 1420)
    const canvas = document.createElement('canvas');
    const width = 1200;
    const height = 1420;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not initialize 2D canvas context.');

    // 1. Clean White Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // 2. Subtle outer border with rounded corners
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 12;
    ctx.strokeRect(30, 30, width - 60, height - 60);

    // 3. Header badge
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(30, 30, width - 60, 90);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px "Inter", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('WHOLESALE RMA RETURN AUTHORIZATION', width / 2, 90);

    // 4. Draw QR Code centered (high contrast)
    const qrSize = 780;
    const qrX = (width - qrSize) / 2;
    const qrY = 160;

    // White backing box for QR with subtle border
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(qrX - 20, qrY - 20, qrSize + 40, qrSize + 40);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 4;
    ctx.strokeRect(qrX - 20, qrY - 20, qrSize + 40, qrSize + 40);

    ctx.drawImage(img, qrX, qrY, qrSize, qrSize);

    // 5. Instruction below QR
    ctx.fillStyle = '#475569';
    ctx.font = 'bold 24px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('▲ SCAN QR CODE FOR INSTANT WAREHOUSE INTAKE ▲', width / 2, 1000);

    // 6. RMA Ticket Number (Big Monospace)
    ctx.fillStyle = '#0f172a';
    let rmaFontSize = 64;
    ctx.font = `900 ${rmaFontSize}px "JetBrains Mono", Consolas, monospace`;
    while (ctx.measureText(rmaNumber).width > 1050 && rmaFontSize > 34) {
      rmaFontSize -= 2;
      ctx.font = `900 ${rmaFontSize}px "JetBrains Mono", Consolas, monospace`;
    }
    ctx.fillText(rmaNumber, width / 2, 1085);

    // 7. Product & Barcode Subtitle (Wrapped cleanly across up to 2 lines)
    let nextY = 1150;
    if (productName || barcode) {
      ctx.fillStyle = '#1e293b';
      ctx.font = 'bold 36px "Inter", system-ui, sans-serif';
      nextY = drawWrappedTextCentered(ctx, productName || 'Returned Merchandise', width / 2, nextY, 1040, 44, 2);

      if (barcode) {
        ctx.fillStyle = '#64748b';
        ctx.font = 'bold 28px "JetBrains Mono", Consolas, monospace';
        ctx.fillText(`Barcode: ${barcode}`, width / 2, nextY + 10);
        nextY += 45;
      }
      if (reporter || reporterContact || dateFormatted) {
        ctx.fillStyle = '#475569';
        ctx.font = 'bold 24px "Inter", sans-serif';
        const repInfo = reporter ? (reporterContact && reporterContact !== 'N/A' ? `${reporter} (${reporterContact})` : reporter) : '';
        const metaLine = [repInfo, dateFormatted].filter(Boolean).join('  •  ');
        if (metaLine) {
          ctx.fillText(metaLine, width / 2, nextY + 10);
        }
      }
    }

    // 8. Footer timestamp / system notice
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 22px "Inter", system-ui, sans-serif';
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    ctx.fillText(`RMA Portal Verification • Generated ${dateStr}`, width / 2, 1365);

    // Convert to PNG and download
    const finalFilename = filename || `${rmaNumber}-QR.png`;
    canvas.toBlob((blob) => {
      if (blob) {
        triggerDownload(blob, finalFilename);
      } else {
        triggerDownload(canvas.toDataURL('image/png'), finalFilename);
      }
    }, 'image/png');

    return true;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Generate Complete Official RMA Box Verification Label Canvas
 * High-res 1200 x 1680 px graphic formatted specifically for box adhesion & thermal prints.
 * Completely eliminates overlap and truncation of RMA number, full product names, and return reasons.
 */
export async function generateBoxStickerCanvas({
  svgElementOrId,
  rmaNumber = 'RMA-TICKET',
  supplier = 'Savemore',
  itemName = 'Returned Merchandise',
  barcode = '',
  sku = '',
  quantity = 1,
  unit = 'pc',
  reason = 'Defective / Return',
  reporter = 'Warehouse Staff',
  reporterContact = '',
  dateFormatted = ''
}) {
  const svgEl = typeof svgElementOrId === 'string'
    ? document.getElementById(svgElementOrId)
    : svgElementOrId;

  if (!svgEl) {
    throw new Error('QR SVG element not found in DOM.');
  }

  const { img, blobUrl } = await svgToImage(svgEl);

  try {
    const canvas = document.createElement('canvas');
    const width = 1200;
    const height = 1680;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not initialize canvas context.');

    // 1. Crisp White Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // 2. Outer Heavyweight Border
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 14;
    ctx.strokeRect(40, 40, width - 80, height - 80);

    // 3. Top Header: Wholesale Operations & Dock Intake badge
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 24px "Inter", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('WHOLESALE RMA OPERATIONS', 80, 110);

    ctx.fillStyle = '#0f172a';
    ctx.font = '900 38px "Inter", sans-serif';
    ctx.fillText('RETURN VERIFICATION LABEL', 80, 160);

    // Dock intake pill on top right
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(width - 320, 95, 240, 65);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('DOCK INTAKE', width - 200, 140);

    // Header divider line
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(80, 195);
    ctx.lineTo(width - 80, 195);
    ctx.stroke();

    // 4. Middle Right: High-contrast QR Code with framed border
    // Sized at 380px (qrX = 740), leaving a generous 630px left column for RMA number & supplier
    const qrSize = 380;
    const qrX = width - 80 - qrSize; // 740
    const qrY = 225;

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 6;
    ctx.strokeRect(qrX, qrY, qrSize, qrSize);
    ctx.drawImage(img, qrX + 15, qrY + 15, qrSize - 30, qrSize - 30);

    // Strip below QR: "SCAN FOR RMA DETAILS"
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(qrX, qrY + qrSize, qrSize, 42);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SCAN FOR RMA DETAILS', qrX + qrSize / 2, qrY + qrSize + 29);

    // 5. Middle Left Column: RMA Number, Supplier, and Status
    ctx.textAlign = 'left';
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 24px "Inter", sans-serif';
    ctx.fillText('RETURN AUTHORIZATION #', 80, 260);

    // Dynamic Font Sizing for RMA Number to strictly prevent overlapping the QR code!
    // Maximum left column width before reaching QR frame is 620px (from x=80 to x=700)
    let rmaFontSize = 54;
    ctx.font = `900 ${rmaFontSize}px "JetBrains Mono", Consolas, monospace`;
    while (ctx.measureText(rmaNumber).width > 610 && rmaFontSize > 26) {
      rmaFontSize -= 2;
      ctx.font = `900 ${rmaFontSize}px "JetBrains Mono", Consolas, monospace`;
    }
    ctx.fillStyle = '#0f172a';
    ctx.fillText(rmaNumber, 80, 335);

    // Dynamic Supplier Tag Pill (measures text width to fit neatly)
    const supplierText = `Supplier: ${supplier || 'Savemore'}`;
    ctx.font = 'bold 26px "Inter", sans-serif';
    const supplierPillWidth = Math.min(Math.max(ctx.measureText(supplierText).width + 50, 280), 610);

    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(80, 380, supplierPillWidth, 54);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 3;
    ctx.strokeRect(80, 380, supplierPillWidth, 54);

    ctx.fillStyle = '#334155';
    ctx.fillText(supplierText, 105, 417);

    // Verification Status Badge
    ctx.fillStyle = '#eff6ff';
    ctx.fillRect(80, 452, 360, 48);
    ctx.strokeStyle = '#bfdbfe';
    ctx.lineWidth = 3;
    ctx.strokeRect(80, 452, 360, 48);

    ctx.fillStyle = '#1d4ed8';
    ctx.font = 'bold 22px "Inter", sans-serif';
    ctx.fillText('STATUS: LOGGED & PENDING', 105, 484);

    // 6. Section 2: Returned Item Details Container Box (Taller & beautifully spaced)
    const boxY = 670;
    const boxH = 760;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(80, boxY, width - 160, boxH);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 4;
    ctx.strokeRect(80, boxY, width - 160, boxH);

    // Item details header
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 24px "Inter", sans-serif';
    ctx.fillText('RETURNED ITEM DETAILS', 120, boxY + 55);

    // Item name: Wrapped across up to 2 lines at 38px font (960px width) - NO TRUNCATION!
    ctx.fillStyle = '#0f172a';
    ctx.font = '900 38px "Inter", sans-serif';
    const prodNextY = drawWrappedText(ctx, itemName || 'Returned Merchandise', 120, boxY + 115, 960, 48, 2);

    // Barcode and SKU line (dynamically placed below wrapped item name)
    const codeY = Math.max(prodNextY + 10, boxY + 185);
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 30px "JetBrains Mono", Consolas, monospace';
    let codeStr = `Barcode: ${barcode || 'N/A'}`;
    if (sku) codeStr += `   •   SKU: ${sku}`;
    ctx.fillText(codeStr, 120, codeY);

    // Horizontal Divider 1
    const div1Y = codeY + 35;
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(120, div1Y);
    ctx.lineTo(width - 120, div1Y);
    ctx.stroke();

    // 2-Column Specs: Quantity & Defect / Return Reason
    const row1HeaderY = div1Y + 45;
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 24px "Inter", sans-serif';
    ctx.fillText('QUANTITY', 120, row1HeaderY);
    ctx.fillText('DEFECT / RETURN REASON', 520, row1HeaderY);

    const row1ValY = row1HeaderY + 50;
    ctx.fillStyle = '#0f172a';
    ctx.font = '900 48px "JetBrains Mono", Consolas, monospace';
    ctx.fillText(`${quantity} ${unit || 'pc'}`, 120, row1ValY);

    // Defect / Return Reason: Wrapped cleanly across up to 2 lines (560px width) - NO TRUNCATION!
    ctx.fillStyle = '#b91c1c';
    ctx.font = 'bold 32px "Inter", sans-serif';
    const reasonNextY = drawWrappedText(ctx, reason || 'Defective / Return', 520, row1ValY - 10, 560, 42, 2);

    // Horizontal Divider 2
    const div2Y = Math.max(row1ValY + 50, reasonNextY + 25);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(120, div2Y);
    ctx.lineTo(width - 120, div2Y);
    ctx.stroke();

    // 2-Column Specs: Reported By & Date Recorded
    const row2HeaderY = div2Y + 45;
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 24px "Inter", sans-serif';
    ctx.fillText('REPORTED BY & CONTACT', 120, row2HeaderY);
    ctx.fillText('DATE & TIME RECORDED', 520, row2HeaderY);

    const row2ValY = row2HeaderY + 45;
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 30px "Inter", sans-serif';
    const repInfo = reporterContact && reporterContact !== 'N/A'
      ? `${reporter || 'Warehouse Staff'} (${reporterContact})`
      : (reporter || 'Warehouse Staff');
    drawWrappedText(ctx, repInfo, 120, row2ValY, 380, 36, 2);

    ctx.fillStyle = '#334155';
    ctx.font = 'bold 26px "JetBrains Mono", Consolas, monospace';
    ctx.fillText(dateFormatted || new Date().toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), 520, row2ValY);

    // 7. Dashed Tear Line and Footer
    const cutLineY = 1495;
    ctx.strokeStyle = '#94a3b8';
    ctx.setLineDash([14, 10]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(80, cutLineY);
    ctx.lineTo(width - 80, cutLineY);
    ctx.stroke();
    ctx.setLineDash([]); // Reset line dash

    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 24px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ATTACH SECURELY TO OUTER BOX OR RETURNED MERCHANDISE', width / 2, 1560);

    return canvas;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Download Complete Official RMA Box Verification Label (PNG)
 */
export async function downloadBoxStickerPng(options) {
  const canvas = await generateBoxStickerCanvas(options);
  const finalFilename = options.filename || `${options.rmaNumber || 'RMA'}-Sticker-Label.png`;
  canvas.toBlob((blob) => {
    if (blob) {
      triggerDownload(blob, finalFilename);
    } else {
      triggerDownload(canvas.toDataURL('image/png'), finalFilename);
    }
  }, 'image/png');
  return true;
}

/**
 * Print Complete Official RMA Box Verification Label
 * Targets high-resolution label canvas directly, avoiding browser wrappers.
 */
export async function printBoxSticker(options) {
  const canvas = await generateBoxStickerCanvas(options);
  const documentTitle = options.documentTitle || `RMA-Verification-Label-${options.rmaNumber || 'Ticket'}`;
  await printHighResCanvas(canvas, documentTitle);
  return true;
}

/**
 * Generate Official Workplace Instruction Poster Canvas
 * High-resolution 1200x1750px poster with QR code and numbered step-by-step reporting instructions.
 */
export async function generatePortalPosterCanvas({
  svgElementOrId,
  portalUrl = 'https://rma-portal-v2.vercel.app'
}) {
  const svgEl = typeof svgElementOrId === 'string'
    ? document.getElementById(svgElementOrId)
    : svgElementOrId;

  if (!svgEl) {
    throw new Error('Portal QR SVG element not found in DOM.');
  }

  const { img, blobUrl } = await svgToImage(svgEl);

  try {
    const canvas = document.createElement('canvas');
    const width = 1200;
    const height = 1750;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not initialize 2D canvas context.');

    // 1. Clean White Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // 2. Outer Border
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 14;
    ctx.strokeRect(30, 30, width - 60, height - 60);

    // 3. Header Hero Banner (Navy Gradient)
    const grad = ctx.createLinearGradient(30, 30, width - 30, 240);
    grad.addColorStop(0, '#1e3a8a');
    grad.addColorStop(1, '#0f172a');
    ctx.fillStyle = grad;
    ctx.fillRect(30, 30, width - 60, 210);

    ctx.fillStyle = '#60a5fa';
    ctx.font = '900 24px "Inter", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('WHOLESALE RMA INTAKE & VERIFICATION', width / 2, 85);

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 44px "Inter", system-ui, sans-serif';
    ctx.fillText('SCAN TO REPORT RETURNED PRODUCT', width / 2, 145);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 22px "Inter", system-ui, sans-serif';
    ctx.fillText('Warehouse Dock Intake • Store Repackers • Customer Defect Reporting', width / 2, 195);

    // 4. Center QR Code Frame
    const qrFrameX = 260;
    const qrFrameY = 280;
    const qrFrameSize = 680;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(qrFrameX, qrFrameY, qrFrameSize, qrFrameSize);
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 6;
    ctx.strokeRect(qrFrameX, qrFrameY, qrFrameSize, qrFrameSize);

    // Draw QR code inside frame
    const qrSize = 580;
    const qrOffset = (qrFrameSize - qrSize) / 2;
    ctx.drawImage(img, qrFrameX + qrOffset, qrFrameY + qrOffset, qrSize, qrSize);

    // 5. Portal URL Pill
    ctx.fillStyle = '#2563eb';
    ctx.beginPath();
    ctx.roundRect((width - 640) / 2, 990, 640, 60, 16);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px "Inter", monospace, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(portalUrl.replace(/^https?:\/\//, ''), width / 2, 1030);

    // 6. Step-by-Step Instructions Container
    ctx.fillStyle = '#0f172a';
    ctx.font = '900 32px "Inter", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('HOW TO FILE A RETURN REPORT', width / 2, 1110);

    const steps = [
      { num: '1', title: 'Step 1: Scan QR with Phone', desc: 'Open camera app on mobile phone/tablet and point at this code' },
      { num: '2', title: 'Step 2: Scan Barcode or Search', desc: 'Use the built-in camera barcode reader or search the catalog.' },
      { num: '3', title: 'Step 3: Attach Defect Photos', desc: 'Snap photo of damaged packaging and enter return quantity' },
      { num: '4', title: 'Step 4: Print Box QR Sticker', desc: 'Tape generated thermal sticker on outer box for dock receiving' }
    ];

    steps.forEach((step, idx) => {
      const stepY = 1170 + idx * 115;

      // Step pill background
      ctx.fillStyle = '#f1f5f9';
      ctx.beginPath();
      ctx.roundRect(80, stepY, width - 160, 95, 18);
      ctx.fill();
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Number badge
      ctx.fillStyle = '#2563eb';
      ctx.beginPath();
      ctx.arc(135, stepY + 47, 30, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = '900 28px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(step.num, 135, stepY + 57);

      // Text
      ctx.textAlign = 'left';
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 26px "Inter", sans-serif';
      ctx.fillText(step.title, 190, stepY + 40);

      ctx.fillStyle = '#475569';
      ctx.font = '500 20px "Inter", sans-serif';
      ctx.fillText(step.desc, 190, stepY + 75);
    });

    // 7. Footer note
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 20px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No login required to submit return tickets • Authorized Wholesale System', width / 2, 1690);

    return canvas;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Download Official Workplace Instruction Poster (PNG)
 */
export async function downloadPortalPosterPng({
  svgElementOrId,
  portalUrl = 'https://rma-portal-v2.vercel.app',
  filename = 'RMA-Scan-To-Report-Poster.png'
}) {
  const canvas = await generatePortalPosterCanvas({ svgElementOrId, portalUrl });
  canvas.toBlob((blob) => {
    if (blob) {
      triggerDownload(blob, filename);
    } else {
      triggerDownload(canvas.toDataURL('image/png'), filename);
    }
  }, 'image/png');
  return true;
}

/**
 * Print Official Workplace Instruction Poster
 * Targets the high-resolution downloadable poster canvas directly.
 */
export async function printPortalPoster({
  svgElementOrId,
  portalUrl = 'https://rma-portal-v2.vercel.app',
  documentTitle = 'RMA-Public-Reporting-Poster'
}) {
  const canvas = await generatePortalPosterCanvas({ svgElementOrId, portalUrl });
  await printHighResCanvas(canvas, documentTitle);
  return true;
}

/**
 * Mount and print a high-resolution canvas element directly in an isolated iframe.
 * Eliminates background page bleeding and guarantees exactly 1 page output.
 */
export async function printHighResCanvas(canvas, documentTitle = 'Print Document') {
  if (typeof document === 'undefined') return;

  const dataUrl = canvas.toDataURL('image/png');

  // Remove existing print iframe if any
  let iframe = document.getElementById('canvas-isolated-print-iframe');
  if (iframe) iframe.remove();

  iframe = document.createElement('iframe');
  iframe.id = 'canvas-isolated-print-iframe';
  iframe.style.position = 'fixed';
  iframe.style.top = '-9999px';
  iframe.style.left = '-9999px';
  iframe.style.width = '0px';
  iframe.style.height = '0px';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${documentTitle}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 0;
          }
          *, *::before, *::after {
            box-sizing: border-box !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            height: 100% !important;
            background: #ffffff !important;
            overflow: hidden !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          img {
            display: block !important;
            margin: auto !important;
            max-width: 180mm !important;
            max-height: 255mm !important;
            width: auto !important;
            height: auto !important;
            object-fit: contain !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        </style>
      </head>
      <body>
        <img src="${dataUrl}" alt="${documentTitle}" />
      </body>
    </html>
  `);
  doc.close();

  const img = doc.querySelector('img');
  const trigger = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      console.warn('Canvas print error:', e);
    } finally {
      setTimeout(() => {
        if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 3000);
    }
  };

  if (img && img.complete) {
    setTimeout(trigger, 100);
  } else if (img) {
    img.onload = () => setTimeout(trigger, 100);
    img.onerror = () => setTimeout(trigger, 100);
  } else {
    setTimeout(trigger, 150);
  }
}

/**
 * Download raw SVG file
 */
export function downloadQrSvg(svgElementOrId, filename = 'rma-qr-code.svg') {
  const svgEl = typeof svgElementOrId === 'string'
    ? document.getElementById(svgElementOrId)
    : svgElementOrId;

  if (!svgEl) throw new Error('QR SVG element not found in DOM.');

  const xml = new XMLSerializer().serializeToString(svgEl);
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  triggerDownload(blob, filename.endsWith('.svg') ? filename : `${filename}.svg`);
  return true;
}

