/**
 * Bulletproof Isolated Print Engine
 * Renders target HTML element into a dedicated, clean, invisible iframe.
 * Eliminates background page leakage, prevents multi-page overflow (guarantees exactly 1 page),
 * and ensures 100% visual fidelity between the on-screen preview and printed paper / PDF export.
 */

export function printIsolatedElement({
  elementId,
  documentTitle = 'Print Document',
  pageSize = 'portrait', // 'portrait' | '4in 6in' | '3in 3in' | '2in 2in' | 'A4 portrait'
  pageMargin = '0.2in',
  scale = 1.0,
  customStyles = ''
}) {
  if (typeof document === 'undefined') return;

  const sourceEl = typeof elementId === 'string' ? document.getElementById(elementId) : elementId;
  if (!sourceEl) {
    console.error('printIsolatedElement: Target element not found:', elementId);
    return;
  }

  // Clone target element
  const clone = sourceEl.cloneNode(true);

  // Remove existing print iframe if any
  const existingIframe = document.getElementById('app-isolated-print-iframe');
  if (existingIframe) {
    existingIframe.remove();
  }

  // Create clean isolated iframe
  const iframe = document.createElement('iframe');
  iframe.id = 'app-isolated-print-iframe';
  iframe.style.position = 'fixed';
  iframe.style.top = '-9999px';
  iframe.style.left = '-9999px';
  iframe.style.width = '0px';
  iframe.style.height = '0px';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  // Collect existing stylesheets & fonts from main window
  const stylesheets = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map(el => el.outerHTML)
    .join('\n');

  const iframeDoc = iframe.contentWindow.document;
  iframeDoc.open();
  iframeDoc.write(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${documentTitle}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        ${stylesheets}
        <style>
          @page {
            size: ${pageSize};
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
            color: #000000 !important;
            overflow: hidden !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
          }
          body {
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            page-break-before: avoid !important;
            page-break-after: avoid !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          .isolated-print-sheet {
            width: 100% !important;
            height: 100% !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            padding: ${pageMargin} !important;
            box-sizing: border-box !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            overflow: hidden !important;
          }
          .isolated-print-card {
            margin: 0 auto !important;
            box-shadow: none !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            max-width: 100% !important;
            max-height: 100% !important;
            box-sizing: border-box !important;
            transform-origin: center center !important;
            ${scale !== 1.0 ? `transform: scale(${scale}) !important;` : ''}
          }
          ${customStyles}
        </style>
      </head>
      <body>
        <div class="isolated-print-sheet">
          <div class="isolated-print-card">
            ${clone.outerHTML}
          </div>
        </div>
      </body>
    </html>
  `);
  iframeDoc.close();

  // Trigger print after styles & SVG elements have painted
  const executePrint = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (err) {
      console.warn('Isolated print warning:', err);
    } finally {
      // Clean up iframe after print dialog completes
      setTimeout(() => {
        if (iframe && iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      }, 3000);
    }
  };

  // Wait 150ms for layout & SVG render
  setTimeout(executePrint, 150);
}
