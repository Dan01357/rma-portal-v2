import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';

// Valid 1x1 transparent PNG bytes for file upload & sticker verification
export const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

// Known catalog barcode verified in Supabase `products`
export const VERIFIED_BARCODE = '4805358373037';
export const VERIFIED_SKU = 'SS1319P';

export function readSupabasePublicEnv() {
  let supaUrl = process.env.VITE_SUPABASE_URL || '';
  let anonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
  if (!supaUrl || !anonKey) {
    for (const fileName of ['.env.local', '.env']) {
      try {
        const envRaw = fs.readFileSync(path.join(process.cwd(), fileName), 'utf-8');
        for (const line of envRaw.split(/\r?\n/)) {
          const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
          if (!m) continue;
          const val = m[2].trim().replace(/^["']|["']$/g, '');
          if (m[1] === 'VITE_SUPABASE_URL' && !supaUrl) supaUrl = val;
          if (m[1] === 'VITE_SUPABASE_ANON_KEY' && !anonKey) anonKey = val;
        }
      } catch {}
    }
  }
  return { supaUrl, anonKey };
}

/**
 * Installs global print / popup stubs on the Playwright BrowserContext so
 * `window.print()`, isolated iframe `contentWindow.print()`, and blank print popups
 * (`window.open('', '_blank')`) increment `window.__pwPrintCount` and record HTML in `window.__pwPrintHtmls`.
 */
export async function installPrintStubs(context) {
  await context.addInitScript(() => {
    try {
      if (window.top !== window) {
        window.print = () => {
          try {
            window.top.__pwPrintCount = (window.top.__pwPrintCount || 0) + 1;
          } catch {}
        };
        return;
      }

      window.__pwPrintCount = 0;
      window.__pwOpenedHtmls = [];
      window.__pwPrintHtmls = [];

      window.print = () => {
        window.__pwPrintCount += 1;
      };

      const origAppendChild = Node.prototype.appendChild;
      Node.prototype.appendChild = function (child) {
        const res = origAppendChild.call(this, child);
        try {
          if (child && child.tagName === 'IFRAME' && child.contentWindow) {
            const cw = child.contentWindow;
            let iframeHtml = '';
            cw.print = () => {
              window.__pwPrintCount += 1;
              if (iframeHtml) window.__pwPrintHtmls.push(iframeHtml);
            };
            const doc = cw.document;
            if (doc && typeof doc.open === 'function') {
              const origOpen = doc.open.bind(doc);
              const origWrite = doc.write.bind(doc);
              doc.open = function (...args) {
                iframeHtml = '';
                const r = origOpen(...args);
                try {
                  cw.print = () => {
                    window.__pwPrintCount += 1;
                    if (iframeHtml) window.__pwPrintHtmls.push(iframeHtml);
                  };
                } catch {}
                return r;
              };
              doc.write = function (chunk) {
                iframeHtml += String(chunk || '');
                return origWrite(chunk);
              };
            }
          }
        } catch {}
        return res;
      };

      const origWindowOpen = window.open.bind(window);
      window.open = function (url = '', target = '_blank', features = '') {
        if (!url || url === 'about:blank') {
          let writtenHtml = '';
          return {
            closed: false,
            focus() {},
            print() {
              window.__pwPrintCount += 1;
              if (writtenHtml) window.__pwPrintHtmls.push(writtenHtml);
            },
            close() {
              this.closed = true;
            },
            document: {
              open() {
                writtenHtml = '';
              },
              write(chunk) {
                writtenHtml += String(chunk || '');
              },
              close() {
                window.__pwOpenedHtmls.push(writtenHtml);
                window.__pwPrintHtmls.push(writtenHtml);
                if (writtenHtml.includes('window.print')) {
                  window.__pwPrintCount += 1;
                }
              }
            }
          };
        }
        return origWindowOpen(url, target, features);
      };
    } catch {}
  });
}

/**
 * Intercepts outbound /api/send-email POST requests (letting ?action=test-connection pass through)
 * so real Gmail inboxes are never spammed during automated tests while capturing every payload.
 */
export async function interceptAndCaptureEmails(page) {
  const capturedEmails = [];
  await page.route('**/api/send-email**', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.includes('action=test-connection')) {
      return route.continue();
    }
    if (req.method() === 'POST') {
      try {
        capturedEmails.push(req.postDataJSON());
      } catch {}
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, mocked: true })
      });
    }
    return route.continue();
  });
  return capturedEmails;
}

/**
 * Attaches strict pageerror, console (error + React warnings + #310), and HTTP >=400 response guards.
 * Optionally accepts `allowHttp` (array of `(res) => boolean`) and `allowConsole` (array of RegExp)
 * ONLY for intentional negative security/validation test assertions.
 */
export function attachStrictGuards(page, { allowHttp = [], allowConsole = [] } = {}) {
  const errors = [];

  const onPageError = (err) => {
    errors.push(`[PAGEERROR] ${err?.message || String(err)}`);
  };

  const onConsole = (msg) => {
    const type = msg.type();
    const text = msg.text() || '';
    if (allowConsole.some((re) => re.test(text))) return;

    const isReactWarn =
      /Warning:|Minified React error|#310|Cannot update a component|Rendered more hooks|Rendered fewer hooks|Invalid hook call|Each child in a list/i.test(
        text
      );
    if (type === 'error') {
      errors.push(`[CONSOLE ERROR] ${text}`);
    } else if (isReactWarn) {
      errors.push(`[REACT WARNING] ${text}`);
    }
  };

  const onResponse = (res) => {
    const status = res.status();
    if (status >= 400) {
      if (allowHttp.some((pred) => pred(res))) return;
      errors.push(`[HTTP ${status}] ${res.request().method()} ${res.url()}`);
    }
  };

  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  page.on('response', onResponse);

  return {
    errors,
    assertClean(contextLabel = 'test execution') {
      if (errors.length > 0) {
        throw new Error(
          `Strict console/network guard tripped (${contextLabel}):\n- ${errors.join('\n- ')}`
        );
      }
    },
    detach() {
      page.off('pageerror', onPageError);
      page.off('console', onConsole);
      page.off('response', onResponse);
    }
  };
}

/**
 * Ensures /admin finished authenticating and loaded the header & KPI grid.
 */
export async function gotoAdmin(page) {
  await page.goto('/admin', { waitUntil: 'commit', timeout: 30_000 });
  await expect(page.getByText('Pingcon RMA Operations')).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
}

/**
 * Returns YYYY-MM-DD N days from today.
 */
export function isoDateDaysOffset(days = 30) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
