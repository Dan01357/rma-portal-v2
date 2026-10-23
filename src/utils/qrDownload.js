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
 * Download High-Resolution QR Code (PNG)
 * Generates an ultra-crisp card with the QR code and RMA Ticket info.
 */
export async function downloadQrCodePng({
  svgElementOrId,
  rmaNumber = 'RMA-TICKET',
  productName = '',
  barcode = '',
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
    // Canvas dimensions (high-res 1200 x 1400)
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
    const qrSize = 820;
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
    ctx.fillText('▲ SCAN QR CODE FOR INSTANT WAREHOUSE INTAKE ▲', width / 2, 1040);

    // 6. RMA Ticket Number (Big Monospace)
    ctx.fillStyle = '#0f172a';
    ctx.font = '900 68px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(rmaNumber, width / 2, 1140);

    // 7. Product & Barcode Subtitle
    if (productName || barcode) {
      ctx.fillStyle = '#1e293b';
      ctx.font = 'bold 36px "Inter", system-ui, sans-serif';
      const cleanProd = productName.length > 44 ? productName.substring(0, 42) + '...' : productName;
      ctx.fillText(cleanProd || 'Returned Merchandise', width / 2, 1220);

      if (barcode) {
        ctx.fillStyle = '#64748b';
        ctx.font = 'bold 28px "JetBrains Mono", Consolas, monospace';
        ctx.fillText(`Barcode: ${barcode}`, width / 2, 1275);
      }
    }

    // 8. Footer timestamp / system notice
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 22px "Inter", system-ui, sans-serif';
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    ctx.fillText(`RMA Portal Verification • Generated ${dateStr}`, width / 2, 1345);

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
 * Download Complete Official RMA Box Verification Label (PNG)
 * High-res 1200 x 1650 px graphic formatted specifically for box adhesion & thermal prints.
 */
export async function downloadBoxStickerPng({
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
    const canvas = document.createElement('canvas');
    const width = 1200;
    const height = 1680;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not initialize canvas context.');

    // White label background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Outer thick label border
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 14;
    ctx.strokeRect(40, 40, width - 80, height - 80);

    // Top Header: Wholesale Operations & Dock Intake badge
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 24px "Inter", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('WHOLESALE RMA OPERATIONS', 80, 110);

    ctx.fillStyle = '#0f172a';
    ctx.font = '900 38px "Inter", sans-serif';
    ctx.fillText('RETURN VERIFICATION LABEL', 80, 160);

    // Dock intake pill on right
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

    // Middle Left: RMA # and Supplier
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 26px "Inter", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('RETURN AUTHORIZATION #', 80, 260);

    ctx.fillStyle = '#0f172a';
    ctx.font = '900 64px "JetBrains Mono", Consolas, monospace';
    ctx.fillText(rmaNumber, 80, 340);

    // Supplier Tag Pill
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(80, 385, 420, 56);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 3;
    ctx.strokeRect(80, 385, 420, 56);

    ctx.fillStyle = '#334155';
    ctx.font = 'bold 26px "Inter", sans-serif';
    ctx.fillText(`Supplier: ${supplier || 'Savemore'}`, 105, 424);

    // Middle Right: High-contrast QR Code with border
    const qrSize = 440;
    const qrX = width - 80 - qrSize;
    const qrY = 220;

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 6;
    ctx.strokeRect(qrX, qrY, qrSize, qrSize);
    ctx.drawImage(img, qrX + 15, qrY + 15, qrSize - 30, qrSize - 30);

    // "SCAN FOR RMA" strip under QR
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(qrX, qrY + qrSize, qrSize, 40);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SCAN FOR RMA', qrX + qrSize / 2, qrY + qrSize + 28);

    // Section 2: Returned Item Details Container Box
    const boxY = 720;
    const boxH = 540;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(80, boxY, width - 160, boxH);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 4;
    ctx.strokeRect(80, boxY, width - 160, boxH);

    // Item details header
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 26px "Inter", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('RETURNED ITEM DETAILS', 120, boxY + 60);

    // Item name
    ctx.fillStyle = '#0f172a';
    ctx.font = '900 48px "Inter", sans-serif';
    const cleanName = itemName.length > 40 ? itemName.substring(0, 38) + '...' : itemName;
    ctx.fillText(cleanName, 120, boxY + 130);

    // Barcode and SKU line
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 34px "JetBrains Mono", Consolas, monospace';
    let codeStr = `Barcode: ${barcode || 'N/A'}`;
    if (sku) codeStr += `  •  SKU: ${sku}`;
    ctx.fillText(codeStr, 120, boxY + 195);

    // Divider inside box
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(120, boxY + 240);
    ctx.lineTo(width - 120, boxY + 240);
    ctx.stroke();

    // 2-Column Specs: Quantity & Defect Reason
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 24px "Inter", sans-serif';
    ctx.fillText('QUANTITY', 120, boxY + 295);
    ctx.fillText('DEFECT / RETURN REASON', 600, boxY + 295);

    ctx.fillStyle = '#0f172a';
    ctx.font = '900 46px "JetBrains Mono", Consolas, monospace';
    ctx.fillText(`${quantity} ${unit || 'pc'}`, 120, boxY + 360);

    ctx.fillStyle = '#b91c1c';
    ctx.font = 'bold 36px "Inter", sans-serif';
    const cleanReason = reason.length > 30 ? reason.substring(0, 28) + '...' : reason;
    ctx.fillText(cleanReason, 600, boxY + 355);

    // Divider for reporter
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(120, boxY + 410);
    ctx.lineTo(width - 120, boxY + 410);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 24px "Inter", sans-serif';
    ctx.fillText('REPORTED BY', 120, boxY + 460);
    ctx.fillText('DATE RECORDED', 600, boxY + 460);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 32px "Inter", sans-serif';
    ctx.fillText(reporter || 'Staff', 120, boxY + 505);

    ctx.fillStyle = '#334155';
    ctx.font = 'bold 30px "JetBrains Mono", Consolas, monospace';
    ctx.fillText(dateFormatted || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }), 600, boxY + 505);

    // Bottom Footer Banner
    ctx.strokeStyle = '#94a3b8';
    ctx.setLineDash([12, 10]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(80, 1500);
    ctx.lineTo(width - 80, 1500);
    ctx.stroke();
    ctx.setLineDash([]); // Reset line dash

    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 26px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ATTACH SECURELY TO OUTER BOX OR RETURNED MERCHANDISE', width / 2, 1560);

    const finalFilename = filename || `${rmaNumber}-Sticker-Label.png`;
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
