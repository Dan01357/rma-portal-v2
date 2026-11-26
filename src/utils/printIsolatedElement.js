/**
 * Bulletproof Isolated Print Engine
 * Synchronously serializes all loaded CSS rules directly from `document.styleSheets`
 * alongside lightweight structural utility CSS and mounts via `iframe.srcdoc`
 * (zero network `<link>` racing, zero `document.write()`, zero blind timeouts).
 */

function stripConflictingPageRules(cssText) {
  if (!cssText) return '';
  return String(cssText).replace(/@page\b(?:[^{]*)\{[\s\S]*?\}/gi, '');
}

function collectSerializedDocumentCss() {
  if (typeof document === 'undefined') return '';
  const chunks = [];

  if (document.styleSheets) {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = sheet?.cssRules;
        if (!rules) continue;
        const ruleTexts = [];
        for (const rule of Array.from(rules)) {
          const text = rule?.cssText || '';
          if (!text || /^\s*@page\b/i.test(text)) continue;
          ruleTexts.push(stripConflictingPageRules(text));
        }
        if (ruleTexts.length > 0) {
          chunks.push(ruleTexts.join('\n'));
        }
      } catch {
        // Cross-origin stylesheets (e.g. external font CDNs) cannot be read cleanly; ignore safely
      }
    }
  }

  // Also grab any inline <style> tags not reflected in styleSheets for maximum safety
  if (chunks.length === 0) {
    try {
      const styleEls = document.querySelectorAll('style');
      for (const el of Array.from(styleEls)) {
        const cleaned = stripConflictingPageRules(el.textContent || '');
        if (cleaned.trim()) chunks.push(cleaned);
      }
    } catch {}
  }

  return chunks.join('\n');
}

function escapeHtmlTitle(val) {
  return String(val || 'Print Document')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const FALLBACK_UTILITY_CSS = `
  .block { display: block; }
  .inline-block { display: inline-block; }
  .hidden { display: none; }
  .flex { display: flex; }
  .inline-flex { display: inline-flex; }
  .flex-col { flex-direction: column; }
  .flex-wrap { flex-wrap: wrap; }
  .items-start { align-items: flex-start; }
  .items-center { align-items: center; }
  .items-baseline { align-items: baseline; }
  .justify-between { justify-content: space-between; }
  .justify-end { justify-content: flex-end; }
  .justify-center { justify-content: center; }
  .grid { display: grid; }
  .grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
  .grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .grid-cols-12 { grid-template-columns: repeat(12, minmax(0, 1fr)); }
  .col-span-6 { grid-column: span 6 / span 6; }
  .col-span-12 { grid-column: span 12 / span 12; }
  .gap-1 { gap: 0.25rem; }
  .gap-1\\.5 { gap: 0.375rem; }
  .gap-2 { gap: 0.5rem; }
  .gap-2\\.5 { gap: 0.625rem; }
  .gap-3 { gap: 0.75rem; }
  .gap-4 { gap: 1rem; }
  .w-full { width: 100%; }
  .min-w-0 { min-width: 0; }
  .shrink-0 { flex-shrink: 0; }
  .mx-auto { margin-left: auto; margin-right: auto; }
  .text-left { text-align: left; }
  .text-center { text-align: center; }
  .text-right { text-align: right; }
  .font-bold { font-weight: 700; }
  .font-black { font-weight: 900; }
  .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  .uppercase { text-transform: uppercase; }
  .whitespace-nowrap { white-space: nowrap; }
  .break-words { overflow-wrap: break-word; }
  .break-all { word-break: break-all; }
  .border { border-width: 1px; border-style: solid; border-color: #000000; }
  .border-2 { border-width: 2px; border-style: solid; border-color: #000000; }
  .border-b { border-bottom-width: 1px; border-bottom-style: solid; border-bottom-color: #000000; }
  .border-b-2 { border-bottom-width: 2px; border-bottom-style: solid; border-bottom-color: #000000; }
  .border-t { border-top-width: 1px; border-top-style: solid; border-top-color: #000000; }
  .border-r { border-right-width: 1px; border-right-style: solid; border-right-color: #000000; }
  .border-black { border-color: #000000; }
  .border-collapse { border-collapse: collapse; }
  table { border-collapse: collapse; width: 100%; }
  .print\\:hidden, .print-hidden, .bottom-sheet-handle { display: none !important; }
`;

export function printIsolatedElement({
  elementId,
  documentTitle = 'Print Document',
  pageSize = 'letter portrait', // 'letter portrait' | '4in 6in' | '3in 3in' | '2in 2in'
  pageMargin = '0.2in',
  scale = 1.0,
  allowMultiPage = false,
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
  // Ensure pixel preview scaling variables (e.g. --u: 2.9px) convert strictly to physical millimeters in print
  if (
    clone?.style &&
    (clone.id === 'rma-qr-batch-sheet-root' || clone.id === 'rma-qr-print-root' || clone.style.getPropertyValue('--u'))
  ) {
    clone.style.setProperty('--u', '1mm', 'important');
  }

  // Synchronize dynamic form controls (inputs, textareas, selects) from live DOM into cloned DOM
  try {
    const sourceInputs = sourceEl.querySelectorAll('input, textarea, select');
    const cloneInputs = clone.querySelectorAll('input, textarea, select');
    sourceInputs.forEach((srcInput, idx) => {
      const clnInput = cloneInputs[idx];
      if (clnInput) {
        if (srcInput.type === 'checkbox' || srcInput.type === 'radio') {
          clnInput.checked = srcInput.checked;
          if (srcInput.checked) clnInput.setAttribute('checked', 'checked');
          else clnInput.removeAttribute('checked');
        } else if (srcInput.tagName === 'TEXTAREA') {
          clnInput.value = srcInput.value;
          clnInput.textContent = srcInput.value;
        } else if (srcInput.tagName === 'SELECT') {
          clnInput.selectedIndex = srcInput.selectedIndex;
        } else {
          clnInput.value = srcInput.value;
          clnInput.setAttribute('value', srcInput.value);
        }
      }
    });
  } catch (syncErr) {
    console.warn('Form controls clone sync notice:', syncErr);
  }

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
  iframe.style.width = '1024px';
  iframe.style.height = '1320px';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.setAttribute('aria-hidden', 'true');

  // Synchronously serialize already-loaded CSS rules (never depends on external <link> refetching)
  const serializedCss = collectSerializedDocumentCss();

  const fullHtmlString = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtmlTitle(documentTitle)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      ${FALLBACK_UTILITY_CSS}
    </style>
    ${serializedCss ? `<style>\n${serializedCss}\n</style>` : ''}
    <style>
      @page {
        size: ${pageSize} !important;
        margin: 0 !important;
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
        height: auto !important;
        background: #ffffff !important;
        color: #000000 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        overflow: visible !important;
      }
      body {
        display: ${allowMultiPage ? 'block' : 'flex'} !important;
        ${allowMultiPage ? '' : `
        flex-direction: column !important;
        align-items: center !important;
        justify-content: flex-start !important;
        page-break-before: avoid !important;
        page-break-after: avoid !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;`}
      }
      .isolated-print-sheet {
        width: 100% !important;
        height: auto !important;
        display: ${allowMultiPage ? 'block' : 'flex'} !important;
        ${allowMultiPage ? '' : `
        flex-direction: column !important;
        align-items: center !important;
        justify-content: flex-start !important;`}
        margin: 0 auto !important;
        padding: ${pageMargin} !important;
        box-sizing: border-box !important;
        text-align: ${allowMultiPage ? 'left' : 'center'} !important;
        ${allowMultiPage ? '' : `
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        page-break-after: avoid !important;
        break-after: avoid !important;`}
      }
      .isolated-print-card {
        margin: 0 auto !important;
        display: ${allowMultiPage ? 'block' : 'flex'} !important;
        ${allowMultiPage ? '' : `
        flex-direction: column !important;
        align-items: center !important;
        justify-content: flex-start !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        page-break-after: avoid !important;
        break-after: avoid !important;`}
        box-shadow: none !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
        transform-origin: top center !important;
        ${scale !== 1.0 ? `zoom: ${scale};` : ''}
      }
      @media print {
        ${allowMultiPage ? '' : `
        body, .isolated-print-sheet, .isolated-print-card, #thermal-label-mount, #rtv-voucher-mount {
          page-break-after: avoid !important;
          break-after: avoid !important;
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }`}
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
</html>`;

  let printed = false;
  const triggerPrintOnce = () => {
    if (printed) return;
    printed = true;
    const execute = () => {
      const cleanupIframe = () => {
        if (iframe && iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      };
      try {
        iframe.contentWindow?.addEventListener?.('afterprint', cleanupIframe, { once: true });
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (err) {
        console.warn('Isolated print warning:', err);
      } finally {
        setTimeout(cleanupIframe, 60000);
      }
    };

    const raf = window.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
    const fontWait = Promise.race([
      Promise.resolve(iframe.contentDocument?.fonts?.ready).catch(() => {}),
      Promise.resolve(document.fonts?.ready).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 400))
    ]);

    fontWait.then(() => {
      raf(() => {
        raf(execute);
      });
    });
  };

  iframe.onload = triggerPrintOnce;
  iframe.srcdoc = fullHtmlString;
  document.body.appendChild(iframe);

  // Safety fallback in case a browser does not re-fire onload cleanly on srcdoc
  setTimeout(() => {
    if (!printed && iframe.contentDocument?.readyState === 'complete') {
      triggerPrintOnce();
    }
  }, 450);
}
