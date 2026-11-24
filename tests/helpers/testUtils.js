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
 * Deterministically mocks /api/upload-photo during automated upload/pickup tests
 * while preserving the AI paperwork inspection sub-route if passed through.
 */
export async function mockPhotoUploadSuccess(page) {
  let uploadSeq = 0;
  await page.route('**/pw-mock-photo-*.png', async (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: PNG_BUFFER
    });
  });
  await page.route('**/api/upload-photo**', async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'POST' && !url.includes('inspect-paperwork')) {
      const idx = ++uploadSeq;
      const localUrl = `https://localhost:5173/pw-mock-photo-${idx}.png`;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          url: localUrl,
          previewUrl: localUrl,
          rmaFolderId: 'pw_mock_folder_id',
          rmaFolderUrl: 'https://drive.google.com/drive/folders/pw_mock_folder_id',
          fileId: `pw_mock_photo_${idx}`,
          provider: 'google_drive'
        })
      });
    }
    return route.continue();
  });
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
  await page.goto('/admin', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByText('Pingcon RMA Operations')).toBeVisible({ timeout: 45_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page
    .getByRole('button', { name: /Saved Products \([1-9]/i })
    .waitFor({ state: 'visible', timeout: 25_000 })
    .catch(() => {});
}

/**
 * Returns YYYY-MM-DD N days from today.
 */
export function isoDateDaysOffset(days = 30) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Verifies a downloaded file is a genuine OOXML .xlsx ZIP archive (PK header + sheet1.xml).
 */
export function assertValidXlsxFile(download, filePath) {
  const name = download.suggestedFilename();
  expect(name).toMatch(/\.xlsx$/i);
  expect(name.toLowerCase()).not.toContain('.csv');
  if (filePath) {
    const buf = fs.readFileSync(filePath);
    expect(buf[0]).toBe(0x50); // 'P'
    expect(buf[1]).toBe(0x4b); // 'K'
    const xmlStr = buf.toString('utf8');
    expect(xmlStr).toContain('xl/worksheets/sheet1.xml');
    expect(xmlStr).toContain('application/vnd.openxmlformats-package.relationships+xml');
    return xmlStr;
  }
  return '';
}

/**
 * Asserts the document has no unintentional horizontal overflow at the active viewport.
 */
export async function assertNoHorizontalOverflow(page, label = 'viewport') {
  const dims = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth
  }));
  expect(
    dims.scrollWidth,
    `Horizontal overflow detected on ${label}: scrollWidth=${dims.scrollWidth} > innerWidth=${dims.innerWidth}`
  ).toBeLessThanOrEqual(dims.innerWidth + 1);
}

/**
 * Toggles the public intake page Super Admin Test Mode switch cleanly.
 */
export async function setPublicPortalTestMode(page, enabled) {
  const toggleBtn = page.locator('button[title="Toggle Test / Sandbox Mode"]');
  await expect(toggleBtn).toBeVisible({ timeout: 20_000 });
  const isCurrentlyOn = /Test Mode:\s*ON/i.test(await toggleBtn.innerText());
  if (isCurrentlyOn !== enabled) {
    await toggleBtn.click();
  }
  if (enabled) {
    await expect(page.getByText('🧪 Super Admin Sandbox Active')).toBeVisible({ timeout: 10_000 });
  } else {
    await expect(page.getByText('🟢 Live Delivery Mode Active')).toBeVisible({ timeout: 10_000 });
  }
}

/**
 * Seeds a Test Mode Sandbox RMA via the public intake page so Live DB stays untouched.
 */
export async function seedTestModeRma(
  page,
  {
    stream = 'customer',
    photoCount = 1,
    expiryDays = 45,
    supplierOrCompany = '',
    quantity = 1,
    barcode = VERIFIED_BARCODE,
    reporterName = 'Playwright Hub Seeder'
  } = {}
) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 35_000 });
  await expect(page.getByText(/Scan Product Barcode or RMA Sticker QR/i)).toBeVisible({
    timeout: 20_000
  });

  await setPublicPortalTestMode(page, true);

  if (stream === 'supplier') {
    await page.getByRole('button', { name: /Supplier RTV Hub/i }).click();
  } else {
    await page.getByRole('button', { name: /Customer RMA Hub/i }).click();
  }

  const barcodeField = page.locator('input[placeholder*="barcode" i]').first();
  await barcodeField.fill(barcode);
  if (barcode === VERIFIED_BARCODE) {
    await expect(page.getByText('Recognized Product')).toBeVisible({ timeout: 25_000 });
  } else {
    await page.waitForTimeout(400);
  }

  if (quantity > 1) {
    const qtyField = page.locator('input[type="number"][min="1"]').first();
    await qtyField.fill(String(quantity));
  }

  if (stream === 'supplier' || expiryDays !== null) {
    const expiryInput = page.locator('input[type="date"]').first();
    if (expiryDays !== null) {
      await expiryInput.fill(isoDateDaysOffset(expiryDays));
    }
  }

  if (supplierOrCompany) {
    const sec3Input = page
      .locator(
        stream === 'supplier'
          ? 'input[placeholder*="Supplier" i], input[placeholder*="Suy Sing" i]'
          : 'input[placeholder*="Store" i], input[placeholder*="Savemore" i], input[placeholder*="Company" i]'
      )
      .first();
    if (await sec3Input.isVisible().catch(() => false)) {
      await sec3Input.fill(supplierOrCompany);
    }
  }

  for (let idx = 0; idx < photoCount; idx += 1) {
    const fileInput = page.locator('input[type="file"][accept="image/*"]').first();
    await fileInput.setInputFiles({
      name: `pw-seed-${stream}-${idx + 1}.png`,
      mimeType: 'image/png',
      buffer: PNG_BUFFER
    });
    await expect(page.getByText(`${idx + 1}/10 photos`)).toBeVisible({ timeout: 10_000 });
  }

  await page.locator('input[placeholder="Your Full Name *"]').fill(reporterName);
  await page
    .locator('input[placeholder="Phone No. or Email *"]')
    .fill('playwright-hub@pingcon.local');

  const submitPostPromise = page.waitForResponse(
    (res) => res.url().includes('/rest/v1/rma_reports') && res.request().method() === 'POST',
    { timeout: 45_000 }
  );
  await page.getByRole('button', { name: /Submit Return Report/i }).click();
  await expect(page.getByText('Printable QR Ready')).toBeVisible({ timeout: 45_000 });
  const postRes = await submitPostPromise;
  expect(postRes.status()).toBeLessThan(400);

  const rmaText = await page
    .locator('.font-mono.font-black.text-slate-900, .font-mono.font-black.dark\\:text-white')
    .filter({ hasText: /^RMA-TEST-/ })
    .first()
    .innerText();
  const rmaNumber = rmaText.trim();
  expect(rmaNumber).toMatch(/^RMA-TEST-/);
  await page.waitForLoadState('networkidle').catch(() => {});
  return rmaNumber;
}

/**
 * Deletes synthetic RMAs, associated Credit Memos, Supplier Claims, and Consolidated CM entries from Supabase.
 */
export async function cleanupTestRecords(
  page,
  { rmaNumbers = [], claimNumbers = [], creditMemoNumbers = [] } = {}
) {
  const rmas = (rmaNumbers || []).filter(Boolean);
  const claims = (claimNumbers || []).filter(Boolean);
  const cms = (creditMemoNumbers || []).filter(Boolean);
  if (rmas.length === 0 && claims.length === 0 && cms.length === 0) return;

  const { supaUrl, anonKey } = readSupabasePublicEnv();
  await page
    .evaluate(
      async ({ targetRmas, targetClaims, targetCms, url, key }) => {
        try {
          const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
          const token = supaKey ? JSON.parse(localStorage.getItem(supaKey))?.access_token : null;
          if (!url || !key || !token) return;
          const headers = {
            apikey: key,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          };

          for (const cmNum of targetCms) {
            await fetch(
              `${url}/rest/v1/credit_memos?credit_memo_number=eq.${encodeURIComponent(cmNum)}`,
              { method: 'DELETE', headers }
            );
          }

          for (const rmaNum of targetRmas) {
            await fetch(
              `${url}/rest/v1/credit_memos?rma_number=eq.${encodeURIComponent(rmaNum)}`,
              { method: 'DELETE', headers }
            );
            await fetch(
              `${url}/rest/v1/rma_reports?rma_number=eq.${encodeURIComponent(rmaNum)}`,
              { method: 'DELETE', headers }
            );
          }

          for (const claimNum of targetClaims) {
            await fetch(
              `${url}/rest/v1/supplier_claims?claim_number=eq.${encodeURIComponent(claimNum)}`,
              { method: 'DELETE', headers }
            );
          }

          // Prune supplier_claims_store in rma_settings
          const sRes = await fetch(
            `${url}/rest/v1/rma_settings?key=eq.supplier_claims_store&select=value`,
            { headers }
          );
          if (sRes.ok) {
            const sJson = await sRes.json();
            const currentClaims = sJson?.[0]?.value;
            if (Array.isArray(currentClaims)) {
              const filtered = currentClaims.filter((c) => {
                const cNum = c.claim_number || c.claimNumber;
                if (targetClaims.includes(cNum)) return false;
                if (
                  Array.isArray(c.items) &&
                  c.items.some((it) => targetRmas.includes(it.rma_number))
                ) {
                  return false;
                }
                return true;
              });
              if (filtered.length !== currentClaims.length) {
                await fetch(`${url}/rest/v1/rma_settings?key=eq.supplier_claims_store`, {
                  method: 'PATCH',
                  headers,
                  body: JSON.stringify({ value: filtered })
                });
              }
            }
          }

          // Prune consolidated_cm_items_store in rma_settings
          const cmRes = await fetch(
            `${url}/rest/v1/rma_settings?key=eq.consolidated_cm_items_store&select=value`,
            { headers }
          );
          if (cmRes.ok) {
            const cmJson = await cmRes.json();
            const storeVal = cmJson?.[0]?.value;
            if (storeVal && typeof storeVal === 'object') {
              let changed = false;
              const next = { ...storeVal };
              for (const [cmKey, entry] of Object.entries(next)) {
                const linkedRmas = Array.isArray(entry?.consolidated_rma_numbers)
                  ? entry.consolidated_rma_numbers
                  : [];
                if (
                  targetCms.includes(cmKey) ||
                  linkedRmas.some((r) => targetRmas.includes(r))
                ) {
                  delete next[cmKey];
                  changed = true;
                }
              }
              if (changed) {
                await fetch(`${url}/rest/v1/rma_settings?key=eq.consolidated_cm_items_store`, {
                  method: 'PATCH',
                  headers,
                  body: JSON.stringify({ value: next })
                });
              }
            }
          }

          // Clean up any auto-generated Test Mode RMA Editor invites created for targetRmas
          for (const rmaNum of targetRmas) {
            await fetch(
              `${url}/rest/v1/rma_invites?entity_name=like.${encodeURIComponent(`[RMA_EDITOR:${rmaNum}*`)}`,
              { method: 'DELETE', headers }
            );
          }

          const invRes = await fetch(
            `${url}/rest/v1/rma_settings?key=eq.customer_rma_invites_store&select=value`,
            { headers }
          );
          if (invRes.ok) {
            const invJson = await invRes.json();
            const invList = invJson?.[0]?.value;
            if (Array.isArray(invList)) {
              const filteredInv = invList.filter((i) => {
                if (!i) return false;
                if (targetRmas.includes(i.rma_number) || targetRmas.includes(i.store_branch)) return false;
                if (String(i.entity_name || '').startsWith('[RMA_EDITOR:') && targetRmas.some((r) => String(i.entity_name).includes(r))) return false;
                return true;
              });
              if (filteredInv.length !== invList.length) {
                await fetch(`${url}/rest/v1/rma_settings?key=eq.customer_rma_invites_store`, {
                  method: 'PATCH',
                  headers,
                  body: JSON.stringify({ value: filteredInv })
                });
              }
            }
          }
        } catch {}
      },
      { targetRmas: rmas, targetClaims: claims, targetCms: cms, url: supaUrl, key: anonKey }
    )
    .catch(() => {});
}
