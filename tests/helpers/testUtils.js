import { expect } from '@playwright/test';

// Valid 1x1 transparent PNG bytes for file upload & sticker verification
export const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

// Known catalog barcode verified in Supabase `products`
export const VERIFIED_BARCODE = '4805358373037';
export const VERIFIED_SKU = 'SS1319P';

/**
 * Installs global print / popup stubs on the Playwright BrowserContext so
 * `window.print()`, isolated iframe `contentWindow.print()`, and blank print popups
 * (`window.open('', '_blank')`) increment `window.__pwPrintCount` instead of blocking Chromium.
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

      window.print = () => {
        window.__pwPrintCount += 1;
      };

      const origAppendChild = Node.prototype.appendChild;
      Node.prototype.appendChild = function (child) {
        const res = origAppendChild.call(this, child);
        try {
          if (child && child.tagName === 'IFRAME' && child.contentWindow) {
            const cw = child.contentWindow;
            cw.print = () => {
              window.__pwPrintCount += 1;
            };
            const doc = cw.document;
            if (doc && typeof doc.open === 'function') {
              const origOpen = doc.open.bind(doc);
              doc.open = function (...args) {
                const r = origOpen(...args);
                try {
                  cw.print = () => {
                    window.__pwPrintCount += 1;
                  };
                } catch {}
                return r;
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
 * Attaches strict pageerror, console (error + React warnings + #310), and HTTP >=400 response guards.
 * Call `guard.assertClean(stageName)` after key interactions and in `afterEach`.
 */
export function attachStrictGuards(page) {
  const errors = [];

  const onPageError = (err) => {
    errors.push(`[PAGEERROR] ${err?.message || String(err)}`);
  };

  const onConsole = (msg) => {
    const type = msg.type();
    const text = msg.text() || '';
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
 * Ensures Test Mode is set explicitly to true or false via localStorage before/during public portal checks,
 * or clicks the visible toggle button in header / settings.
 */
export async function ensureAdminTestMode(page, enabled) {
  const currentState = await page.evaluate(() => {
    return localStorage.getItem('rma_portal_test_mode') === 'true';
  });
  if (currentState !== enabled) {
    // Open Settings & SMTP tab to toggle Super Admin Test Mode via UI button
    await page.getByRole('button', { name: /Settings & SMTP/i }).click();
    const toggleBtn = page.getByRole('button', {
      name: enabled ? /Test Mode: OFF/i : /Test Mode: ON/i
    });
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click();
    await expect(
      page.getByRole('button', {
        name: enabled ? /Test Mode: ON/i : /Test Mode: OFF/i
      })
    ).toBeVisible();
  }
}

/**
 * Returns YYYY-MM-DD N days from today.
 */
export function isoDateDaysOffset(days = 30) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
