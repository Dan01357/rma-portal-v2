import zlib from 'node:zlib';
import { test, expect } from '@playwright/test';
import { buildStoredZip } from '../src/utils/exportXlsx.js';
import { buildRmaAlertXlsxBytes } from '../src/utils/rmaAlertXlsx.js';
import {
  extractRmaUpdatesFromXlsxBuffer,
  parseZipEntriesFromBuffer
} from '../api/_lib/imapReplySyncHandler.js';
import {
  PNG_BUFFER,
  VERIFIED_BARCODE,
  attachStrictGuards,
  installPrintStubs,
  interceptAndCaptureEmails,
  mockPhotoUploadSuccess,
  setPublicPortalTestMode,
  assertNoHorizontalOverflow,
  isoDateDaysOffset,
  gotoAdmin,
  navigateAdminSidebar,
  openSettingsSubTab,
  readSupabasePublicEnv,
  cleanupTestRecords
} from './helpers/testUtils.js';

function readXlsxXmlCombined(buf) {
  const entries = parseZipEntriesFromBuffer(Buffer.from(buf));
  return [
    entries.get('xl/sharedStrings.xml') || '',
    entries.get('xl/worksheets/sheet1.xml') || ''
  ].join('\n');
}

function replaceSingleXmlValueInXlsxBuffer(origBuf, searchStr, replaceStr) {
  const entries = parseZipEntriesFromBuffer(Buffer.from(origBuf));
  const outFiles = [];
  for (const [name, dataBuf] of entries.entries()) {
    if (name === 'xl/worksheets/sheet1.xml') {
      const xml = dataBuf.toString('utf8');
      expect(xml).toContain(searchStr);
      outFiles.push({
        name,
        content: xml.replace(searchStr, replaceStr)
      });
    } else {
      outFiles.push({ name, content: dataBuf });
    }
  }
  return Buffer.from(buildStoredZip(outFiles));
}

test.describe('Suite 10: Prompt 8A Comprehensive QA (QR Toggle & Print Isolation, Zero Store Branch on RTV, 13:00 Auto Follow-Up, Per-Item .xlsx Sync)', () => {
  test('verifies Multi-Item QR Consolidated vs Per-Item + isolated iframe print, Zero Store Branch on Supplier RTV across UI/email/XLSX, no manual Follow-Up/XLSX buttons & 13:00 default across Desktop/Mobile/Landscape', async ({
    page,
    context,
    browser
  }) => {
    test.setTimeout(240_000);
    await context.grantPermissions(['camera']).catch(() => { });
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);
    const capturedEmails = await interceptAndCaptureEmails(page);
    await mockPhotoUploadSuccess(page);

    const postedRmaPayloads = [];
    page.on('request', (req) => {
      if (req.url().includes('/rest/v1/rma_reports') && req.method() === 'POST') {
        try {
          const json = req.postDataJSON();
          if (json) postedRmaPayloads.push(json);
        } catch {}
      }
    });

    const createdRmas = [];

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(page.getByText(/Scan Product Barcode or RMA Sticker QR/i)).toBeVisible({ timeout: 25_000 });
      await setPublicPortalTestMode(page, true);

      // =========================================================================
      // A. Public Portal 2-Item Batch RMA -> Consolidated vs Per-Item QRs & Print Isolation
      // =========================================================================
      await page.getByRole('button', { name: /Customer RMA Hub/i }).click();

      const barcodeInput = page.locator('input[placeholder*="barcode" i]').first();
      const qtyInput = page.locator('input[type="number"][min="1"]').first();
      const unitSelect = page.locator('select[title*="Select unit" i]').first();
      const itemPhotoInput = page.locator('input[type="file"][accept="image/*"]').first();

      // Queue Item 1: Verified catalog item (2 pc)
      await barcodeInput.fill(VERIFIED_BARCODE);
      await expect(page.getByText('Recognized Product')).toBeVisible({ timeout: 25_000 });
      await qtyInput.fill('2');
      await unitSelect.selectOption('pc');
      await itemPhotoInput.setInputFiles({ name: 'pw8a-item1.png', mimeType: 'image/png', buffer: PNG_BUFFER });
      await expect(page.getByText('1/10 photos')).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: /Add Another Item to Return/i }).click();
      await expect(page.getByText(/Queued Return Manifest \(1 Item\)/i)).toBeVisible({ timeout: 10_000 });

      // Queue Item 2 (active form on submit): 3 case
      const item2Barcode = `PW8A-CASE-${String(Date.now()).slice(-5)}`;
      await barcodeInput.fill(item2Barcode);
      await qtyInput.fill('3');
      await unitSelect.selectOption('case');
      await page
        .locator('input[placeholder*="Oishi Prawn Crackers" i]')
        .first()
        .fill('Playwright Case Item Two');
      await itemPhotoInput.setInputFiles({ name: 'pw8a-item2.png', mimeType: 'image/png', buffer: PNG_BUFFER });
      await expect(page.getByText('1/10 photos')).toBeVisible({ timeout: 10_000 });

      await page.locator('input[placeholder="Your Full Name *"]').fill('Playwright Batch Reporter');
      await page.locator('input[placeholder="Phone No. or Email *"]').fill('pw8a-batch@pingcon.local');

      const batchPostPromise = page.waitForResponse(
        (res) => res.url().includes('/rest/v1/rma_reports') && res.request().method() === 'POST',
        { timeout: 45_000 }
      );
      await page.getByRole('button', { name: /Submit Return (?:Report|Manifest)/i }).click();
      await expect(page.getByText('Printable QR Ready')).toBeVisible({ timeout: 45_000 });
      expect((await batchPostPromise).status()).toBeLessThan(400);

      const batchRmaNumber = (
        await page
          .locator('.font-mono.font-black.text-slate-900, .font-mono.font-black.dark\\:text-white')
          .filter({ hasText: /^RMA-TEST-/ })
          .first()
          .innerText()
      ).trim();
      expect(batchRmaNumber).toMatch(/^RMA-TEST-/);
      createdRmas.push(batchRmaNumber);

      // Open Resize / Print QR modal
      await page.getByRole('button', { name: /Resize \/ Print QR/i }).click();
      const qrModal = page.locator('div.fixed', { hasText: /Print RMA QR Code|Consolidated QR Print Studio/i }).first();
      await expect(qrModal).toBeVisible({ timeout: 15_000 });

      const sheetRoot = qrModal.locator('#rma-qr-batch-sheet-root');
      await expect(sheetRoot).toBeVisible();

      const consolidatedBtn = qrModal.getByRole('button', { name: /Consolidated \(1 QR per RMA\)/i });
      const perItemBtn = qrModal.getByRole('button', { name: /Single \/ Per-Item QRs/i });
      await expect(consolidatedBtn).toBeVisible();
      await expect(perItemBtn).toBeVisible();
      await expect(consolidatedBtn).toHaveAttribute('aria-pressed', 'true');

      // Default Consolidated mode renders exactly 1 card
      await expect(sheetRoot.locator(`[data-rma-qr-card="${batchRmaNumber}"]`)).toHaveCount(1);

      // Toggle to Single / Per-Item QRs -> expands to 2 individual item QR cards
      await perItemBtn.click();
      await expect(perItemBtn).toHaveAttribute('aria-pressed', 'true');
      const expandedCards = sheetRoot.locator(`[data-rma-qr-card="${batchRmaNumber}"]`);
      await expect(expandedCards).toHaveCount(2);

      const card1 = sheetRoot.locator(`[data-rma-qr-card="${batchRmaNumber}"][data-rma-qr-item-index="1"]`);
      const card2 = sheetRoot.locator(`[data-rma-qr-card="${batchRmaNumber}"][data-rma-qr-item-index="2"]`);
      await expect(card1).toContainText(/2\s*pc/i);
      await expect(card2).toContainText('Playwright Case Item Two');
      await expect(card2).toContainText(/3\s*case/i);

      // Check Mobile Portrait (390x844) & Landscape (840x390) inside ReturnQRModal with zero overflow
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(200);
      await assertNoHorizontalOverflow(page, 'Public QR Studio Mobile Portrait 390x844');
      await page.setViewportSize({ width: 840, height: 390 });
      await page.waitForTimeout(200);
      await assertNoHorizontalOverflow(page, 'Public QR Studio Landscape 840x390');
      await page.setViewportSize({ width: 1280, height: 800 });

      // Spy specifically on top window.print vs iframe.srcdoc printing
      await page.evaluate(() => {
        window.__pwTopWindowPrints = 0;
        const origTopPrint = window.print;
        window.print = () => {
          window.__pwTopWindowPrints += 1;
          return origTopPrint?.();
        };
      });
      const printCountBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await qrModal.getByRole('button', { name: /Print 2 QRs/i }).click();
      await expect.poll(() => page.evaluate(() => window.__pwPrintCount || 0), { timeout: 10_000 }).toBeGreaterThan(printCountBefore);

      const printCheck = await page.evaluate(() => {
        const htmls = window.__pwPrintHtmls || [];
        return {
          topWindowPrints: window.__pwTopWindowPrints || 0,
          lastHtml: htmls[htmls.length - 1] || ''
        };
      });
      // Main-window window.print() was NEVER invoked
      expect(printCheck.topWindowPrints).toBe(0);
      // Isolated iframe.srcdoc contains ONLY the #rma-qr-batch-sheet-root cards and NOT main website container
      expect(printCheck.lastHtml).toContain('id="rma-qr-batch-sheet-root"');
      expect(printCheck.lastHtml).toContain('Playwright Case Item Two');
      expect(printCheck.lastHtml).toContain('2 pc');
      expect(printCheck.lastHtml).toContain('3 case');
      expect(printCheck.lastHtml).not.toContain('id="app-main-view-container"');
      expect(printCheck.lastHtml).not.toContain('Report Item for Return');

      // Save QR (PNG) honors active Per-Item mode cleanly
      const [perItemPngDownload] = await Promise.all([
        page.waitForEvent('download', { timeout: 20_000 }),
        qrModal.getByRole('button', { name: /Save QR \(PNG\)/i }).click()
      ]);
      expect(perItemPngDownload.suggestedFilename()).toMatch(/2-QRs-.*\.png$/i);

      await qrModal.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(qrModal).toBeHidden();
      await page.getByRole('button', { name: /Report Another/i }).click();
      await expect(page.getByRole('button', { name: /Submit Return Report/i })).toBeVisible();

      // =========================================================================
      // B. Supplier RTV (`supplier_outbound`) -> Zero Store Branch Everywhere
      // =========================================================================
      await page.getByRole('button', { name: /Supplier RTV Hub/i }).click();
      const rtvBarcode = `PW8A-RTV-${String(Date.now()).slice(-6)}`;
      await barcodeInput.fill(rtvBarcode);
      await page.locator('input[placeholder*="Oishi Prawn Crackers" i]').first().fill('Supplier RTV NoBranch Widget');
      await page.locator('input[type="date"]').first().fill(isoDateDaysOffset(45));
      await page.locator('#intake-item-supplier-input').fill('Test Vendor NoBranch Corp');
      await itemPhotoInput.setInputFiles({ name: 'pw8a-rtv.png', mimeType: 'image/png', buffer: PNG_BUFFER });
      await expect(page.getByText('1/10 photos')).toBeVisible({ timeout: 10_000 });

      await page.locator('input[placeholder="Your Full Name *"]').fill('Playwright RTV Staff');
      await page.locator('input[placeholder="Phone No. or Email *"]').fill('pw8a-rtv@pingcon.local');

      const postCountBeforeRtv = postedRmaPayloads.length;
      const rtvPostPromise = page.waitForResponse(
        (res) =>
          res.url().includes('/rest/v1/rma_reports') &&
          res.request().method() === 'POST' &&
          (res.request().postData() || '').includes(rtvBarcode),
        { timeout: 90_000 }
      );
      await page.getByRole('button', { name: /Submit Return Report/i }).click();
      await expect(page.getByText('Printable QR Ready')).toBeVisible({ timeout: 45_000 });
      const rtvRes = await rtvPostPromise;
      expect(rtvRes.status()).toBeLessThan(400);

      const rtvRmaNumber = (
        await page
          .locator('.font-mono.font-black.text-slate-900, .font-mono.font-black.dark\\:text-white')
          .filter({ hasText: /^RMA-TEST-/ })
          .first()
          .innerText()
      ).trim();
      expect(rtvRmaNumber).toMatch(/^RMA-TEST-/);
      createdRmas.push(rtvRmaNumber);

      // Assert Supabase POST saved store_branch: null even though Section 3 had Vendor Name
      const rtvResJson = await rtvRes.json().catch(() => null);
      const rtvReqJson = (() => {
        try {
          return rtvRes.request().postDataJSON();
        } catch {
          return null;
        }
      })();
      const rtvPostCandidates = []
        .concat(rtvResJson || [])
        .concat(rtvReqJson || [])
        .concat(postedRmaPayloads.slice(postCountBeforeRtv).flat());
      const rtvObj = rtvPostCandidates.find(
        (r) => r && (r.rma_number === rtvRmaNumber || r.barcode === rtvBarcode)
      );
      expect(rtvObj).toBeTruthy();
      expect(rtvObj.rma_type).toBe('supplier_outbound');
      expect(rtvObj.store_branch ?? null).toBeNull();

      // Assert Success screen displays zero Store / Branch
      const successCard = page.locator('.bg-white.dark\\:bg-slate-900.border.border-emerald-200').first();
      await expect(successCard).not.toContainText(/Store \/ Branch:/i);

      // Verify New RMA Alert email & mirror .xlsx omit Store / Branch for supplier_outbound
      await expect
        .poll(() => capturedEmails.some((m) => m.isTestMode && String(m.subject || '').includes(rtvRmaNumber)), {
          timeout: 25_000
        })
        .toBe(true);
      const rtvEmail = capturedEmails.find(
        (m) => m.isTestMode && String(m.subject || '').includes(rtvRmaNumber)
      );
      expect(rtvEmail).toBeTruthy();
      expect(String(rtvEmail.html || '')).not.toContain('Store / Branch:');
      const rtvXlsxAtt = (rtvEmail.attachments || []).find((a) => /\.xlsx$/i.test(a.filename || ''));
      expect(rtvXlsxAtt).toBeTruthy();
      const rtvAlertXml = readXlsxXmlCombined(Buffer.from(rtvXlsxAtt.content, 'base64'));
      expect(rtvAlertXml).toContain('supplier_outbound');
      expect(rtvAlertXml).not.toContain('Store / Branch');

      // Check RmaEmailEditorView hides Store / Customer Branch on supplier_outbound and sends store_branch: null
      const urlMatch = String(rtvEmail.html || '').match(/https?:\/\/[^"'\s<>]+\/intake\?token=[^"'\s<>]+/);
      expect(urlMatch).toBeTruthy();
      const editorHref = urlMatch[0].replace(/&amp;/g, '&');
      const parsedUrl = new URL(editorHref);
      const editorPathWithQuery = `${parsedUrl.pathname}${parsedUrl.search}`;

      const editorCtx = await browser.newContext({
        ignoreHTTPSErrors: true,
        storageState: { cookies: [], origins: [] }
      });
      const editorPage = await editorCtx.newPage();
      const editorGuard = attachStrictGuards(editorPage);
      try {
        const { anonKey: editorAnonKey } = readSupabasePublicEnv();
        await editorPage.route('**/rest/v1/**', async (route) => {
          const req = route.request();
          const hdrs = { ...req.headers() };
          if (String(hdrs.authorization || '').includes('.pw8aeditsig') && editorAnonKey) {
            hdrs.authorization = `Bearer ${editorAnonKey}`;
          }
          return route.continue({ headers: hdrs });
        });
        const hdr = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
        const pay = Buffer.from(
          JSON.stringify({
            sub: '00000000-0000-4000-8000-000000000088',
            email: 'mgan@pingconmarketing.com',
            exp: Math.floor(Date.now() / 1000) + 3600,
            user_metadata: { full_name: 'RTV Email Editor' }
          })
        ).toString('base64url');
        const mockJwt = `${hdr}.${pay}.pw8aeditsig`;

        await editorPage.route('**/auth/v1/user**', async (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: '00000000-0000-4000-8000-000000000088',
              email: 'mgan@pingconmarketing.com',
              user_metadata: { full_name: 'RTV Email Editor' }
            })
          })
        );
        await editorPage.route('**/auth/v1/token**', async (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              access_token: mockJwt,
              token_type: 'bearer',
              expires_in: 3600,
              refresh_token: 'pw_ref_8a',
              user: { id: '00000000-0000-4000-8000-000000000088', email: 'mgan@pingconmarketing.com' }
            })
          })
        );
        let editorPatchPayload = null;
        await editorPage.route('**/api/v1/rma-email-edit**', async (route) => {
          const req = route.request();
          if (req.method() === 'GET') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                success: true,
                mode: 'test',
                authorized_email: 'mgan@pingconmarketing.com',
                scope_locked_rma: true,
                report: {
                  id: 99102,
                  rma_number: rtvRmaNumber,
                  rma_type: 'supplier_outbound',
                  barcode: rtvBarcode,
                  name: 'Supplier RTV NoBranch Widget',
                  supplier_name: 'Test Vendor NoBranch Corp',
                  store_branch: null,
                  quantity: 1,
                  unit_name: 'pc',
                  price: 50,
                  price_with_vat: 56,
                  expiry_date: isoDateDaysOffset(45),
                  notes: '[TEST_MODE]',
                  created_at: new Date().toISOString(),
                  items: []
                }
              })
            });
          }
          if (req.method() === 'PATCH') {
            editorPatchPayload = req.postDataJSON();
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                success: true,
                report: {
                  rma_number: rtvRmaNumber,
                  rma_type: 'supplier_outbound',
                  store_branch: null,
                  supplier_name: editorPatchPayload?.updates?.supplier_name || 'Test Vendor NoBranch Corp'
                }
              })
            });
          }
          return route.continue();
        });

        await editorPage.goto(`${editorPathWithQuery}#access_token=${mockJwt}&refresh_token=pw_ref_8a&expires_in=3600`, {
          waitUntil: 'domcontentloaded'
        });
        await expect(editorPage.getByText(rtvRmaNumber).first()).toBeVisible({ timeout: 20_000 });
        await expect(
          editorPage.locator('input[placeholder="Type product name to search catalog..."]')
        ).toHaveValue('Supplier RTV NoBranch Widget', { timeout: 15_000 });
        await expect(editorPage.getByText('Store / Customer Branch')).toHaveCount(0);
        await editorPage.getByRole('button', { name: /Save RMA Changes/i }).click();
        await expect.poll(() => editorPatchPayload !== null, { timeout: 10_000 }).toBe(true);
        expect(editorPatchPayload.updates.store_branch).toBeNull();
        editorGuard.assertClean('Prompt 8A RmaEmailEditorView supplier_outbound zero store_branch');
      } finally {
        editorGuard.detach();
        await editorCtx.close().catch(() => { });
      }

      // =========================================================================
      // C. Admin UI: Zero Store Branch in Supplier RTV + Zero Manual Follow-Up / XLSX Buttons + 13:00 Default
      // =========================================================================
      await gotoAdmin(page);

      // 1. Settings & SMTP: Default Daily Follow-Up time === 13:00 (editable), no Check Email .xlsx Replies button
      const settingsLoadPromise = page
        .waitForResponse((r) => r.url().includes('/rest/v1/rma_settings') && r.request().method() === 'GET', {
          timeout: 10_000
        })
        .catch(() => null);
      await navigateAdminSidebar(page, 'settings');
      await settingsLoadPromise;
      await openSettingsSubTab(page, 'Schedules & 10-Day SLA');
      await page.waitForTimeout(250);
      await expect(page.getByRole('button', { name: /Check Email \.xlsx Replies/i })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Send Follow-Up/i })).toHaveCount(0);
      const followUpTimeInput = page.locator('input[aria-label="Follow-Up Auto-Send Time (Asia/Manila HH:mm)"]');
      await expect(followUpTimeInput).toHaveValue('13:00');
      await followUpTimeInput.fill('14:15');
      await expect(followUpTimeInput).toHaveValue('14:15');
      await followUpTimeInput.fill('13:00');

      // 2. Test Mode Sandbox -> Customer Hub: Zero Send Follow-Up button + Multi-Item QR Per-Item check in Admin
      await navigateAdminSidebar(page, 'sandbox');
      await page.getByRole('button', { name: /Sandbox Customer RMAs/i }).click();
      await page.locator('input[placeholder*="Search" i]').first().fill(batchRmaNumber);
      const custRow = page.locator('tr', { hasText: batchRmaNumber }).first();
      await expect(custRow).toBeVisible({ timeout: 20_000 });
      await expect(custRow.getByRole('button', { name: /Send Follow-Up/i })).toHaveCount(0);
      await expect(custRow.getByRole('button', { name: /Case Close/i })).toBeVisible();

      // Verify Admin QR studio on multi-item batch RMA also has Consolidated / Per-Item toggle
      await custRow.locator('button[title*="QR" i]').first().click();
      const adminQrModal = page.locator('div.fixed', { hasText: /Print RMA QR Code|Consolidated QR Print Studio/i }).first();
      await expect(adminQrModal).toBeVisible({ timeout: 10_000 });
      await expect(adminQrModal.getByRole('button', { name: /Consolidated \(1 QR per RMA\)/i })).toBeVisible();
      await adminQrModal.getByRole('button', { name: /Single \/ Per-Item QRs/i }).click();
      await expect(adminQrModal.locator(`[data-rma-qr-card="${batchRmaNumber}"]`)).toHaveCount(2);
      await adminQrModal.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(adminQrModal).toBeHidden();

      // 3. Test Mode Sandbox -> Supplier RTVs: Zero Store Branch UI/export & zero Send Follow-Up / Upload / Check buttons
      await page.getByRole('button', { name: /Sandbox Supplier RTVs/i }).click();
      await page.locator('input[placeholder*="Search" i]').first().fill(rtvRmaNumber);
      const rtvRow = page.locator('tr', { hasText: rtvRmaNumber }).first();
      await expect(rtvRow).toBeVisible({ timeout: 20_000 });
      await expect(rtvRow.getByRole('button', { name: /Send Follow-Up/i })).toHaveCount(0);
      await expect(rtvRow.getByRole('button', { name: /Case Close/i })).toBeVisible();

      // Export Supplier Claims (.xlsx) -> zero Store Branch column
      const [claimsDl] = await Promise.all([
        page.waitForEvent('download', { timeout: 20_000 }),
        page.getByRole('button', { name: /Export Supplier Claims \(\.xlsx\)/i }).first().click()
      ]);
      const claimsPath = await claimsDl.path();
      const claimsXml = readXlsxXmlCombined(await (await import('node:fs')).promises.readFile(claimsPath));
      expect(claimsXml).toContain(rtvRmaNumber);
      expect(claimsXml).not.toMatch(/Store\s*\/?\s*Branch/i);

      // Open QuickRMAActionModal & SupplierFollowUpModal on supplier_outbound -> assert zero Store Branch, Send Follow-Up, Upload/Check buttons
      await rtvRow.getByRole('button', { name: /Details|Inspect|Split Qty/i }).first().click();
      const quickModal = page.locator('div.fixed', { hasText: 'RMA Details & Quick Actions' }).first();
      await expect(quickModal).toBeVisible({ timeout: 10_000 });
      await expect(quickModal.getByText(/Store Branch:/i)).toHaveCount(0);
      await expect(quickModal.getByRole('button', { name: /Send Follow-Up/i })).toHaveCount(0);
      await expect(quickModal.getByText(/Upload Edited \.xlsx/i)).toHaveCount(0);
      await expect(quickModal.getByRole('button', { name: /Check Email \.xlsx Replies/i })).toHaveCount(0);
      await expect(quickModal.getByRole('button', { name: /Case Close/i })).toBeVisible();

      await quickModal.getByRole('button', { name: /Edit Supplier & Email|\+ Set Supplier & Email/i }).first().click();
      const followModal = page
        .locator('div.fixed', { hasText: /Set Supplier & Email Details|Supplier & 10-Day Pickup Follow-Up/i })
        .last();
      await expect(followModal).toBeVisible({ timeout: 10_000 });
      await expect(followModal.getByRole('button', { name: /Send Follow-Up/i })).toHaveCount(0);
      await expect(followModal.getByRole('button', { name: /Case Close/i })).toBeVisible();
      await page.locator('button[aria-label="Close supplier follow-up modal"]').click();
      await expect(followModal).toBeHidden();
      await quickModal.getByRole('button', { name: /Done \/ Close/i }).click();
      await expect(quickModal).toBeHidden();

      guard.assertClean('Suite 10 Test A Multi-Item QR, RTV Zero Store Branch, No Manual Buttons');
    } finally {
      await cleanupTestRecords(page, { rmaNumbers: createdRmas });
      guard.detach();
    }
  });

  test('verifies automatic per-item .xlsx reply ingestion on a 2-item Test Mode Batch RMA updates ONLY edited Item 1 supplier while preserving Item 2 and [TEST_MODE]', async ({
    page,
    request
  }) => {
    test.setTimeout(180_000);
    const guard = attachStrictGuards(page);
    const createdRmas = [];

    try {
      await gotoAdmin(page);
      const { supaUrl, anonKey } = readSupabasePublicEnv();
      const rmaNumber = `RMA-TEST-2026-8A-${String(Date.now()).slice(-4)}`;
      createdRmas.push(rmaNumber);

      const twoItems = [
        {
          id: 'pw8a_item_1',
          barcode: '4800001110001',
          code: 'SKU-GAINS-1',
          sku: 'SKU-GAINS-1',
          name: 'Playwright Batch Item One',
          productName: 'Playwright Batch Item One',
          supplier_name: 'Gains Group Inc',
          supplierName: 'Gains Group Inc',
          supplier: 'Gains Group Inc',
          quantity: 2,
          unit_name: 'pc',
          unit: 'pc',
          price: 45,
          price_with_vat: 50.4,
          expiry_date: isoDateDaysOffset(60),
          reason: 'Damaged Box / Crushed Packaging',
          explanation: 'Item 1 dent'
        },
        {
          id: 'pw8a_item_2',
          barcode: '4800002220002',
          code: 'SKU-MARINA-2',
          sku: 'SKU-MARINA-2',
          name: 'Playwright Batch Item Two',
          productName: 'Playwright Batch Item Two',
          supplier_name: 'Marina Sales Inc',
          supplierName: 'Marina Sales Inc',
          supplier: 'Marina Sales Inc',
          quantity: 4,
          unit_name: 'case',
          unit: 'case',
          price: 120,
          price_with_vat: 134.4,
          expiry_date: isoDateDaysOffset(90),
          reason: 'Near Expiry / Expired',
          explanation: 'Item 2 short dated'
        }
      ];

      // Seed 2-item Test Mode Batch RMA (parent + child rma_reports rows) in Supabase via active Admin JWT
      const seedInfo = await page.evaluate(
        async ({ url, key, targetRma, items }) => {
          const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
          const token = supaKey ? JSON.parse(localStorage.getItem(supaKey))?.access_token : '';
          const headers = {
            apikey: key,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
          };
          const nowIso = new Date().toISOString();
          const parentPayload = {
            rma_number: targetRma,
            rma_type: 'customer_inbound',
            is_parent: true,
            barcode: targetRma,
            code: '',
            name: `Batch Return Manifest (${items.length} items)`,
            quantity: 6,
            total_items: 2,
            total_quantity: 6,
            unit_name: 'mixed',
            supplier_name: 'Gains Group Inc',
            store_branch: 'Playwright Branch 8A',
            price: 0,
            price_with_vat: 0,
            status: 'pending',
            disposition: 'Pending',
            condition_grade: 'B - Damaged Packaging Only',
            reason: 'Multi-Item Defect (2 items)',
            items,
            notes: '[TEST_MODE] Prompt 8A Batch Seed',
            ai_document_metadata: { is_test: true, test_mode: true },
            reporter_name: 'Playwright Batch Seeder',
            reporter_contact: 'mgan@pingconmarketing.com',
            reported_by: 'Playwright Batch Seeder (mgan@pingconmarketing.com)'
          };
          const pRes = await fetch(`${url}/rest/v1/rma_reports`, {
            method: 'POST',
            headers,
            body: JSON.stringify(parentPayload)
          });
          const pJson = await pRes.json().catch(() => null);
          const parentRow = Array.isArray(pJson) ? pJson[0] : pJson;
          let childStatus = null;
          if (parentRow?.id) {
            const childPayloads = items.map((it) => ({
              rma_number: targetRma,
              parent_rma_id: parentRow.id,
              is_parent: false,
              rma_type: 'customer_inbound',
              barcode: it.barcode,
              code: it.code,
              name: it.name,
              quantity: it.quantity,
              unit_name: it.unit_name,
              supplier_name: it.supplier_name,
              store_branch: 'Playwright Branch 8A',
              price: it.price,
              price_with_vat: it.price_with_vat,
              expiry_date: it.expiry_date,
              status: 'pending',
              disposition: 'Pending',
              condition_grade: 'B - Damaged Packaging Only',
              reason: it.reason,
              explanation: it.explanation,
              notes: '[TEST_MODE] Child Line',
              ai_document_metadata: { is_test: true, test_mode: true },
              reporter_name: 'Playwright Batch Seeder',
              reporter_contact: 'mgan@pingconmarketing.com',
              reported_by: 'Playwright Batch Seeder (mgan@pingconmarketing.com)'
            }));
            const cRes = await fetch(`${url}/rest/v1/rma_reports`, {
              method: 'POST',
              headers,
              body: JSON.stringify(childPayloads)
            });
            childStatus = cRes.status;
          }
          return { status: pRes.status, childStatus, err: !pRes.ok ? pJson : null, parentRow, token };
        },
        { url: supaUrl, key: anonKey, targetRma: rmaNumber, items: twoItems }
      );
      expect(seedInfo.status, `Seed error: ${JSON.stringify(seedInfo.err)}`).toBeLessThan(300);
      expect(seedInfo.parentRow?.id).toBeTruthy();

      // Optionally insert into rma_items using request context if table exists (no console/page error if absent)
      let hasRmaItemsTable = false;
      if (seedInfo.token) {
        const rmaItemInsert = await request.post(`${supaUrl}/rest/v1/rma_items`, {
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${seedInfo.token}`,
            'Content-Type': 'application/json'
          },
          data: twoItems.map((it) => ({
            rma_report_id: seedInfo.parentRow.id,
            rma_number: rmaNumber,
            barcode: it.barcode,
            sku: it.code,
            name: it.name,
            quantity: it.quantity,
            unit_name: it.unit_name,
            price: it.price,
            price_with_vat: it.price_with_vat,
            supplier_name: it.supplier_name,
            reason: it.reason,
            explanation: it.explanation,
            expiry_date: it.expiry_date
          }))
        });
        hasRmaItemsTable = rmaItemInsert.ok();
      }

      // 1. Build 2-item Test Mode mirror .xlsx workbook (Gains Group Inc & Marina Sales Inc)
      const originalXlsxBuf = Buffer.from(
        buildRmaAlertXlsxBytes(seedInfo.parentRow, {
          subject: `[TEST] [RMA Alert] ${rmaNumber}: Batch Return Manifest`
        })
      );
      const originalXml = readXlsxXmlCombined(originalXlsxBuf);
      expect(originalXml).toContain('Serial No.');
      expect(originalXml).toContain('Supplier Name');
      expect(originalXml).toContain('Gains Group Inc');
      expect(originalXml).toContain('Marina Sales Inc');

      // 2. Edit ONLY Item 1's Supplier Name inside MANIFEST LINE ITEMS to Suy Sing Commercial Corp
      // Notice first occurrence of Gains Group Inc may be top-level Value cell; replace the manifest row cell specifically
      const origEntries = parseZipEntriesFromBuffer(originalXlsxBuf);
      const origSheetXml = origEntries.get('xl/worksheets/sheet1.xml').toString('utf8');
      const manifestMarkerIdx = origSheetXml.indexOf('MANIFEST LINE ITEMS');
      expect(manifestMarkerIdx).toBeGreaterThan(-1);
      const beforeManifest = origSheetXml.slice(0, manifestMarkerIdx);
      const manifestAndAfter = origSheetXml.slice(manifestMarkerIdx).replace(
        '<t>Gains Group Inc</t>',
        '<t>Suy Sing Commercial Corp</t>'
      );
      expect(manifestAndAfter).toContain('<t>Suy Sing Commercial Corp</t>');
      expect(manifestAndAfter).toContain('<t>Marina Sales Inc</t>');

      const repackedFiles = [];
      for (const [fname, fbuf] of origEntries.entries()) {
        repackedFiles.push({
          name: fname,
          content: fname === 'xl/worksheets/sheet1.xml' ? `${beforeManifest}${manifestAndAfter}` : fbuf
        });
      }
      const editedXlsxBuf = Buffer.from(buildStoredZip(repackedFiles));

      // Verify extractRmaUpdatesFromXlsxBuffer parses Item 1 and Item 2 cleanly
      const parsedPreview = extractRmaUpdatesFromXlsxBuffer(editedXlsxBuf, {
        subjectHint: `[TEST] [RMA Alert] ${rmaNumber}`
      });
      expect(parsedPreview.rmaNumber).toBe(rmaNumber);
      expect(parsedPreview.isTestHint).toBe(true);
      expect(parsedPreview.manifestUpdates).toHaveLength(2);
      expect(parsedPreview.manifestUpdates[0].supplier_name).toBe('Suy Sing Commercial Corp');
      expect(parsedPreview.manifestUpdates[1].supplier_name).toBe('Marina Sales Inc');

      // 3. Ingest edited .xlsx via /api/send-email?action=ingest-xlsx-reply
      const ingestRes = await page.evaluate(
        async ({ b64, rmaNum, subj }) => {
          const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
          const token = supaKey ? JSON.parse(localStorage.getItem(supaKey))?.access_token : '';
          const res = await fetch('/api/send-email?action=ingest-xlsx-reply', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify({
              fileBase64: b64,
              rmaNumber: rmaNum,
              subject: subj,
              actorName: 'Playwright Per-Item Sync Test'
            })
          });
          return { status: res.status, json: await res.json().catch(() => null) };
        },
        {
          b64: editedXlsxBuf.toString('base64'),
          rmaNum: rmaNumber,
          subj: `[TEST] [RMA Alert] ${rmaNumber}`
        }
      );
      expect(ingestRes.status).toBe(200);
      expect(ingestRes.json?.success).toBe(true);
      expect(ingestRes.json?.noChanges).not.toBe(true);
      expect(ingestRes.json?.changedFields).toContain('item_1_supplier_name');

      // 4. Verify Database State (parent items[], child rma_reports, rma_items, and Test Mode preservation)
      const dbCheck = await page.evaluate(
        async ({ url, key, targetRma }) => {
          const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
          const token = supaKey ? JSON.parse(localStorage.getItem(supaKey))?.access_token : '';
          const r = await fetch(`${url}/rest/v1/rma_reports?rma_number=eq.${encodeURIComponent(targetRma)}&select=*`, {
            headers: { apikey: key, Authorization: `Bearer ${token}` }
          });
          return await r.json();
        },
        { url: supaUrl, key: anonKey, targetRma: rmaNumber }
      );
      const updatedParent = dbCheck.find((r) => !r.parent_rma_id);
      const updatedChildren = dbCheck.filter((r) => r.parent_rma_id === updatedParent.id);
      expect(updatedParent).toBeTruthy();
      expect(updatedParent.ai_document_metadata?.is_test).toBe(true);
      expect(String(updatedParent.notes || '')).toContain('[TEST_MODE]');
      expect(updatedParent.items[0].supplier_name).toBe('Suy Sing Commercial Corp');
      expect(updatedParent.items[1].supplier_name).toBe('Marina Sales Inc');

      const child1 = updatedChildren.find((c) => c.barcode === '4800001110001');
      const child2 = updatedChildren.find((c) => c.barcode === '4800002220002');
      expect(child1?.supplier_name).toBe('Suy Sing Commercial Corp');
      expect(child2?.supplier_name).toBe('Marina Sales Inc');
      expect(String(child1?.notes || '')).toContain('[TEST_MODE]');

      if (hasRmaItemsTable && seedInfo.token) {
        const itemsRes = await request.get(
          `${supaUrl}/rest/v1/rma_items?rma_report_id=eq.${seedInfo.parentRow.id}&select=*`,
          { headers: { apikey: anonKey, Authorization: `Bearer ${seedInfo.token}` } }
        );
        if (itemsRes.ok()) {
          const rmaItems = await itemsRes.json();
          const ri1 = rmaItems.find((x) => x.barcode === '4800001110001');
          const ri2 = rmaItems.find((x) => x.barcode === '4800002220002');
          expect(ri1?.supplier_name).toBe('Suy Sing Commercial Corp');
          expect(ri2?.supplier_name).toBe('Marina Sales Inc');
        }
      }

      // 5. Verify in Admin Test Mode Sandbox UI manifest drawer that Item 1 & Item 2 reflect independent suppliers
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Pingcon RMA Operations')).toBeVisible({ timeout: 30_000 });
      await navigateAdminSidebar(page, 'sandbox');
      await page.getByRole('button', { name: /Sandbox Customer RMAs/i }).click();
      await page.locator('input[placeholder*="Search" i]').first().fill(rmaNumber);
      const batchRow = page.locator('tr', { hasText: rmaNumber }).first();
      await expect(batchRow).toBeVisible({ timeout: 20_000 });
      await batchRow.locator('button:has-text("Manifest")').first().click();
      await expect(page.getByText('Suy Sing Commercial Corp').first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('Marina Sales Inc').first()).toBeVisible({ timeout: 10_000 });

      // Assert ?action=sync-email-replies returns structured 200 JSON safely under Admin auth
      const syncCheck = await page.evaluate(async () => {
        const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
        const token = supaKey ? JSON.parse(localStorage.getItem(supaKey))?.access_token : '';
        const res = await fetch('/api/send-email?action=sync-email-replies', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ action: 'sync-email-replies' })
        });
        return { status: res.status, json: await res.json().catch(() => null) };
      });
      expect(syncCheck.status).toBe(200);
      expect(syncCheck.json).toBeTruthy();

      // Assert ?action=reply-sync-logs rejects unauthenticated requests (401) without tripping browser console guard,
      // and returns structured logs for Admin
      const unauthLogsRes = await request.get('/api/send-email?action=reply-sync-logs');
      expect(unauthLogsRes.status()).toBe(401);

      const logsAuthCheck = await page.evaluate(async () => {
        const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
        const token = supaKey ? JSON.parse(localStorage.getItem(supaKey))?.access_token : '';
        const authRes = await fetch('/api/send-email?action=reply-sync-logs', {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        return {
          authStatus: authRes.status,
          json: await authRes.json().catch(() => null)
        };
      });
      expect(logsAuthCheck.authStatus).toBe(200);
      expect(logsAuthCheck.json?.success).toBe(true);
      expect(Array.isArray(logsAuthCheck.json?.logs)).toBe(true);

      guard.assertClean('Suite 10 Test B Per-Item .xlsx Batch Reply Ingestion & Test Mode Isolation');
    } finally {
      const { supaUrl, anonKey } = readSupabasePublicEnv();
      await page
        .evaluate(
          async ({ url, key, targetRmas }) => {
            try {
              const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
              const token = supaKey ? JSON.parse(localStorage.getItem(supaKey))?.access_token : '';
              if (!url || !key || !token) return;
              const headers = { apikey: key, Authorization: `Bearer ${token}` };
              for (const rmaNum of targetRmas) {
                await fetch(`${url}/rest/v1/rma_items?rma_number=eq.${encodeURIComponent(rmaNum)}`, {
                  method: 'DELETE',
                  headers
                }).catch(() => {});
              }
            } catch {}
          },
          { url: supaUrl, key: anonKey, targetRmas: createdRmas }
        )
        .catch(() => {});
      await cleanupTestRecords(page, { rmaNumbers: createdRmas });
      guard.detach();
    }
  });

  test('verifies editable batch item quantities (Portal + .xlsx), mixed suppliers per item, and QR Print Mode Toggle across Public Portal & Admin multi-row selections', async ({
    page,
    context,
    request
  }) => {
    test.setTimeout(240_000);
    await context.grantPermissions(['camera']).catch(() => {});
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);
    await interceptAndCaptureEmails(page);
    await mockPhotoUploadSuccess(page);

    const createdRmas = [];
    const { supaUrl, anonKey } = readSupabasePublicEnv();

    try {
      // 1. Public Portal Test Mode: Mixed-Supplier 2-Item Batch + Inline Manifest Queue Qty Edit
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect(page.getByText(/Scan Product Barcode or RMA Sticker QR/i)).toBeVisible({ timeout: 25_000 });
      await setPublicPortalTestMode(page, true);
      await page.getByRole('button', { name: /Customer RMA Hub/i }).click();
      await expect(page.locator('#intake-item-supplier-input')).toHaveCount(0);
      await expect(page.locator('#intake-company-input')).toBeVisible();

      await page.getByRole('button', { name: /Supplier RTV Hub/i }).click();
      await expect(page.locator('#intake-supplier-input')).toHaveCount(0);
      await expect(page.locator('#intake-company-input')).toHaveCount(0);

      const barcodeInput = page.locator('input[placeholder*="barcode" i]').first();
      const qtyInput = page.locator('input[type="number"][min="1"]').first();
      const itemSupplierInput = page.locator('#intake-item-supplier-input');
      await expect(itemSupplierInput).toBeVisible();
      const itemPhotoInput = page.locator('input[type="file"][accept="image/*"]').first();

      const uniq = String(Date.now()).slice(-5);
      await barcodeInput.fill(`PW-MIXED-1-${uniq}`);
      await page.locator('input[placeholder*="Oishi Prawn Crackers" i]').first().fill('Mixed Batch Item One');
      await page.locator('input[type="date"]').first().fill(isoDateDaysOffset(45));
      await qtyInput.fill('2');
      await itemSupplierInput.fill('Supplier A');
      await itemPhotoInput.setInputFiles({ name: 'mix1.png', mimeType: 'image/png', buffer: PNG_BUFFER });
      await expect(page.getByText('1/10 photos')).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: /Add Another Item to Return/i }).click();
      await expect(page.getByText(/Queued Return Manifest \(1 Item\)/i)).toBeVisible({ timeout: 10_000 });

      // Edit Item 1 Qty inline inside Queued Return Manifest (2 -> 5) and verify UOM-grouped auto-sum updates
      const queuedQty1 = page.locator('[data-manifest-item-index="0"] input[type="number"]');
      await expect(queuedQty1).toHaveValue('2');
      await queuedQty1.fill('5');
      await expect(page.getByText(/Total batch quantity updates automatically \(5 pcs across 1 item\)/i)).toBeVisible();

      // Add Item 2 with a DIFFERENT supplier ("Suysing") & Qty 3 directly via active form
      await barcodeInput.fill(`PW-MIXED-2-${uniq}`);
      await page.locator('input[placeholder*="Oishi Prawn Crackers" i]').first().fill('Mixed Batch Item Two');
      await page.locator('input[type="date"]').first().fill(isoDateDaysOffset(60));
      await qtyInput.fill('3');
      await itemSupplierInput.fill('Suysing');
      await itemPhotoInput.setInputFiles({ name: 'mix2.png', mimeType: 'image/png', buffer: PNG_BUFFER });
      await expect(page.getByText('1/10 photos')).toBeVisible({ timeout: 10_000 });

      await page.locator('input[placeholder="Your Full Name *"]').fill('Playwright Mixed Reporter');
      await page.locator('input[placeholder="Phone No. or Email *"]').fill('pw-mixed@pingcon.local');

      const mixedPostPromise = page.waitForResponse(
        (res) => res.url().includes('/rest/v1/rma_reports') && res.request().method() === 'POST',
        { timeout: 45_000 }
      );
      await page.getByRole('button', { name: /Submit Return (?:Report|Manifest)/i }).click();
      await expect(page.getByText('Printable QR Ready')).toBeVisible({ timeout: 45_000 });
      const mixedPostRes = await mixedPostPromise;
      expect(mixedPostRes.status()).toBeLessThan(400);

      const batchRma = (
        await page
          .locator('.font-mono.font-black.text-slate-900, .font-mono.font-black.dark\\:text-white')
          .filter({ hasText: /^RMA-TEST-/ })
          .first()
          .innerText()
      ).trim();
      expect(batchRma).toMatch(/^RMA-TEST-/);
      createdRmas.push(batchRma);

      // Verify Public Portal QR Studio shows Consolidated / Per-Item toggle on mixed-supplier batch
      await page.getByRole('button', { name: /Resize \/ Print QR/i }).click();
      const pubQrModal = page.locator('div.fixed', { hasText: /Print RMA QR Code|Consolidated QR Print Studio/i }).first();
      await expect(pubQrModal).toBeVisible({ timeout: 15_000 });
      await expect(pubQrModal.getByRole('button', { name: /Consolidated \(1 QR per RMA\)/i })).toBeVisible();
      await expect(pubQrModal.getByRole('button', { name: /Single \/ Per-Item QRs/i })).toBeVisible();
      await pubQrModal.getByRole('button', { name: /Single \/ Per-Item QRs/i }).click();
      await expect(pubQrModal.locator(`[data-rma-qr-card="${batchRma}"]`)).toHaveCount(2);
      await pubQrModal.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(pubQrModal).toBeHidden();

      // 2. Navigate to Admin Test Mode Sandbox -> Seed two strictly 1-item RMAs + one 2-item mixed Supplier RTV batch
      await gotoAdmin(page);

      const singleRma1 = `RMA-TEST-S1-${uniq}`;
      const singleRma2 = `RMA-TEST-S2-${uniq}`;
      const custBatchRma = `RMA-TEST-2026-CM${uniq.slice(-3)}`;
      const rtvMixedRma = `RMA-TEST-RM-${uniq}`;
      createdRmas.push(singleRma1, singleRma2, custBatchRma, rtvMixedRma);

      const rtvItems = [
        {
          id: `rtv_it1_${uniq}`,
          barcode: `4809911001${uniq.slice(-3)}`,
          code: `SKU-SUPA-${uniq}`,
          sku: `SKU-SUPA-${uniq}`,
          name: 'RTV Mixed Item Alpha',
          productName: 'RTV Mixed Item Alpha',
          supplier_name: 'Supplier A',
          supplierName: 'Supplier A',
          supplier: 'Supplier A',
          quantity: 5,
          unit_name: 'pc',
          unit: 'pc',
          price: 50,
          price_with_vat: 56,
          expiry_date: isoDateDaysOffset(45),
          reason: 'Damaged Box / Crushed Packaging'
        },
        {
          id: `rtv_it2_${uniq}`,
          barcode: `4809922002${uniq.slice(-3)}`,
          code: `SKU-SUYS-${uniq}`,
          sku: `SKU-SUYS-${uniq}`,
          name: 'RTV Mixed Item Beta',
          productName: 'RTV Mixed Item Beta',
          supplier_name: 'Suysing',
          supplierName: 'Suysing',
          supplier: 'Suysing',
          quantity: 3,
          unit_name: 'pc',
          unit: 'pc',
          price: 75,
          price_with_vat: 84,
          expiry_date: isoDateDaysOffset(75),
          reason: 'Near Expiry / Expired'
        }
      ];

      const seedExtra = await page.evaluate(
        async ({ url, key, s1, s2, cmNum, rtvNum, items, portalRtvNum }) => {
          const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
          const token = supaKey ? JSON.parse(localStorage.getItem(supaKey))?.access_token : '';
          const headers = {
            apikey: key,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
          };
          const common = {
            status: 'pending',
            disposition: 'Pending',
            condition_grade: 'B - Damaged Packaging Only',
            reporter_name: 'Playwright Admin QA',
            reporter_contact: 'mgan@pingconmarketing.com',
            reported_by: 'Playwright Admin QA (mgan@pingconmarketing.com)',
            ai_document_metadata: { is_test: true, test_mode: true }
          };

          const singleRows = [
            {
              ...common,
              rma_number: s1,
              rma_type: 'customer_inbound',
              is_parent: false,
              barcode: `480777111${s1.slice(-4)}`,
              name: 'Strict Single Item One',
              quantity: 1,
              total_items: 1,
              total_quantity: 1,
              unit_name: 'pc',
              supplier_name: 'Supplier A',
              store_branch: 'Test Branch 1',
              reason: 'Damaged Box / Crushed Packaging',
              notes: '[TEST_MODE] Strict Single 1'
            },
            {
              ...common,
              rma_number: s2,
              rma_type: 'customer_inbound',
              is_parent: false,
              barcode: `480777222${s2.slice(-4)}`,
              name: 'Strict Single Item Two',
              quantity: 2,
              total_items: 1,
              total_quantity: 2,
              unit_name: 'pc',
              supplier_name: 'Suysing',
              store_branch: 'Test Branch 2',
              reason: 'Damaged Box / Crushed Packaging',
              notes: '[TEST_MODE] Strict Single 2'
            }
          ];

          const sRes = await fetch(`${url}/rest/v1/rma_reports`, {
            method: 'POST',
            headers,
            body: JSON.stringify(singleRows)
          });

          const custItems = items.map((it, idx) => ({
            ...it,
            id: `cm_it${idx + 1}_${cmNum.slice(-5)}`,
            name: idx === 0 ? 'Customer Mixed Item One' : 'Customer Mixed Item Two',
            productName: idx === 0 ? 'Customer Mixed Item One' : 'Customer Mixed Item Two'
          }));
          const custParentPayload = {
            ...common,
            rma_number: cmNum,
            rma_type: 'customer_inbound',
            is_parent: true,
            barcode: cmNum,
            name: 'Batch Return Manifest (2 items)',
            quantity: 8,
            total_items: 2,
            total_quantity: 8,
            unit_name: 'pc',
            supplier_name: 'Multiple Suppliers (Supplier A, Suysing)',
            store_branch: 'PW Customer Branch',
            reason: 'Multi-Item Defect (2 items)',
            items: custItems,
            notes: '[TEST_MODE] Mixed Customer Batch'
          };
          const cmRes = await fetch(`${url}/rest/v1/rma_reports`, {
            method: 'POST',
            headers,
            body: JSON.stringify(custParentPayload)
          });
          const cmJson = await cmRes.json().catch(() => null);
          const cmRow = Array.isArray(cmJson) ? cmJson[0] : cmJson;
          if (cmRow?.id) {
            const cmChildren = custItems.map((it) => ({
              ...common,
              rma_number: cmNum,
              parent_rma_id: cmRow.id,
              is_parent: false,
              rma_type: 'customer_inbound',
              barcode: it.barcode,
              code: it.code,
              name: it.name,
              quantity: it.quantity,
              unit_name: it.unit_name,
              supplier_name: it.supplier_name,
              store_branch: 'PW Customer Branch',
              price: it.price,
              price_with_vat: it.price_with_vat,
              expiry_date: it.expiry_date,
              reason: it.reason,
              notes: '[TEST_MODE] Mixed Customer Child'
            }));
            await fetch(`${url}/rest/v1/rma_reports`, {
              method: 'POST',
              headers,
              body: JSON.stringify(cmChildren)
            });
          }

          const rtvParentPayload = {
            ...common,
            rma_number: rtvNum,
            rma_type: 'supplier_outbound',
            is_parent: true,
            barcode: rtvNum,
            name: 'Batch Return Manifest (2 items)',
            quantity: 8,
            total_items: 2,
            total_quantity: 8,
            unit_name: 'pc',
            supplier_name: 'Multiple Suppliers (Supplier A, Suysing)',
            store_branch: null,
            reason: 'Multi-Item Defect (2 items)',
            items,
            notes: '[TEST_MODE] Mixed Supplier RTV Batch'
          };
          const pRes = await fetch(`${url}/rest/v1/rma_reports`, {
            method: 'POST',
            headers,
            body: JSON.stringify(rtvParentPayload)
          });
          const pJson = await pRes.json().catch(() => null);
          const pRow = Array.isArray(pJson) ? pJson[0] : pJson;
          if (pRow?.id) {
            const childPayloads = items.map((it) => ({
              ...common,
              rma_number: rtvNum,
              parent_rma_id: pRow.id,
              is_parent: false,
              rma_type: 'supplier_outbound',
              barcode: it.barcode,
              code: it.code,
              name: it.name,
              quantity: it.quantity,
              unit_name: it.unit_name,
              supplier_name: it.supplier_name,
              store_branch: null,
              price: it.price,
              price_with_vat: it.price_with_vat,
              expiry_date: it.expiry_date,
              reason: it.reason,
              notes: '[TEST_MODE] Mixed RTV Child'
            }));
            await fetch(`${url}/rest/v1/rma_reports`, {
              method: 'POST',
              headers,
              body: JSON.stringify(childPayloads)
            });
          }
          const portalRes = await fetch(`${url}/rest/v1/rma_reports?rma_number=eq.${encodeURIComponent(portalRtvNum)}&select=*`, {
            headers
          });
          const portalRows = await portalRes.json().catch(() => []);
          const portalParent = Array.isArray(portalRows) ? portalRows.find((r) => !r.parent_rma_id) : null;
          return { sOk: sRes.ok, cmOk: cmRes.ok, pOk: pRes.ok, rtvParentId: pRow?.id, portalParent, token };
        },
        { url: supaUrl, key: anonKey, s1: singleRma1, s2: singleRma2, cmNum: custBatchRma, rtvNum: rtvMixedRma, items: rtvItems, portalRtvNum: batchRma }
      );
      expect(seedExtra.sOk).toBe(true);
      expect(seedExtra.cmOk).toBe(true);
      expect(seedExtra.pOk).toBe(true);
      expect(seedExtra.portalParent?.quantity).toBe(8);
      expect(seedExtra.portalParent?.total_quantity).toBe(8);
      expect(seedExtra.portalParent?.supplier_name).toBe('Multiple Suppliers (Supplier A, Suysing)');
      expect(seedExtra.portalParent?.ai_document_metadata?.follow_up?.enabled).toBe(true);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Pingcon RMA Operations')).toBeVisible({ timeout: 30_000 });
      await navigateAdminSidebar(page, 'sandbox');
      await page.getByRole('button', { name: /Sandbox Customer RMAs/i }).click();

      // Verify Customer Batch RMA persisted with Qty 8 (5+3) & Multiple Suppliers (Supplier A, Suysing)
      const searchCust = page.locator('input[placeholder*="Search" i]').first();
      await searchCust.fill(custBatchRma);
      const mixedRow = page.locator('tr', { hasText: custBatchRma }).first();
      await expect(mixedRow).toBeVisible({ timeout: 20_000 });
      await expect(mixedRow).toContainText('8 pcs');
      await expect(mixedRow).toContainText(/Multiple Suppliers \(Supplier A, Suysing\)/i);

      // Verify Cleaned-up Portal Batch Edit UI (QuickRMAActionModal): merged Edit Details & Documents, collapsed Advanced accordion, editable Qty + Name + Branch + per-item Supplier (no duplicate Supplier Email in Customer Hub), UOM-grouped totals, sticky Save Changes
      await mixedRow.getByRole('button', { name: /Details|Inspect|Split Qty/i }).first().click();
      const quickModal = page.locator('div.fixed', { hasText: 'RMA Details & Quick Actions' }).first();
      await expect(quickModal).toBeVisible({ timeout: 10_000 });
      await expect(quickModal.getByRole('button', { name: /Edit Batch Qty & Suppliers/i })).toHaveCount(0);
      await quickModal.getByRole('button', { name: /Edit Details & Documents/i }).click();
      await expect(quickModal.getByText('Edit RMA Details')).toBeVisible();
      await expect(quickModal.locator('input[aria-label="Ticket total quantity"]')).toHaveCount(0);
      await expect(quickModal.getByText(/Supplier & Product Expiry Information/i)).toHaveCount(0);
      await expect(quickModal.getByRole('button', { name: /Advanced \/ Danger Zone/i })).toHaveAttribute('aria-expanded', 'false');
      await expect(quickModal.locator('[data-testid="batch-summary-total-qty"]')).toContainText('8 pcs');
      await expect(quickModal.locator('input[aria-label="Store or customer branch"]')).toBeVisible();
      await expect(quickModal.locator('input[aria-label="Batch item 1 supplier email To"]')).toHaveCount(0);

      const item1QtyEdit = quickModal.locator('input[aria-label="Batch item 1 quantity"]');
      await expect(item1QtyEdit).toHaveValue('5');
      await item1QtyEdit.fill('6');
      await expect(quickModal.locator('[data-testid="batch-summary-total-qty"]')).toContainText('9 pcs');
      await expect(quickModal.locator('input[aria-label="Batch item 1 name"]')).toBeVisible();
      await expect(quickModal.locator('input[aria-label="Batch item 1 unit"]')).toHaveValue('pc');
      await expect(quickModal.locator('input[aria-label="Batch item 1 SKU"]')).toBeVisible();
      await expect(quickModal.locator('input[aria-label="Batch item 1 unit price"]')).toBeVisible();
      await expect(quickModal.locator('input[aria-label="Batch item 2 supplier"]')).toHaveValue('Suysing');
      await quickModal.getByRole('button', { name: /Save Changes/i }).click();
      await expect(quickModal.getByText('Total: 9 pcs')).toBeVisible({ timeout: 15_000 });
      await quickModal.getByRole('button', { name: /Done \/ Close/i }).click();
      await expect(quickModal).toBeHidden();

      // Verify Admin multi-select on strictly 1-item RMAs hides QR split toggle
      await searchCust.fill('RMA-TEST-S');
      const s1Row = page.locator('tr', { hasText: singleRma1 }).first();
      const s2Row = page.locator('tr', { hasText: singleRma2 }).first();
      await expect(s1Row).toBeVisible({ timeout: 15_000 });
      await expect(s2Row).toBeVisible({ timeout: 15_000 });
      await s1Row.locator('input[type="checkbox"]').first().check();
      await s2Row.locator('input[type="checkbox"]').first().check();
      await page.getByRole('button', { name: /Print \/ Save QRs \(2\)/i }).click();
      const adminQr1 = page.locator('div.fixed', { hasText: /Print RMA QR Code|Consolidated QR Print Studio/i }).first();
      await expect(adminQr1).toBeVisible({ timeout: 10_000 });
      await expect(adminQr1.getByRole('button', { name: /Single \/ Per-Item QRs/i })).toHaveCount(0);
      await expect(adminQr1.locator('#rma-qr-batch-sheet-root [data-rma-qr-card]')).toHaveCount(2);
      await adminQr1.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(adminQr1).toBeHidden();
      await page.getByRole('button', { name: /^Deselect$/i }).click();

      // Verify Admin multi-select in Customer Hub including a multi-item RMA ALWAYS shows QR split toggle
      await searchCust.fill('RMA-TEST-');
      const s1Pick = page.locator('tr', { hasText: singleRma1 }).first();
      const mixPick = page.locator('tr', { hasText: custBatchRma }).first();
      await expect(s1Pick).toBeVisible({ timeout: 15_000 });
      await expect(mixPick).toBeVisible({ timeout: 15_000 });
      await s1Pick.locator('input[type="checkbox"]').first().check();
      await mixPick.locator('input[type="checkbox"]').first().check();
      await page.getByRole('button', { name: /Print \/ Save QRs \(2\)/i }).click();
      const adminQrMix = page.locator('div.fixed', { hasText: /Print RMA QR Code|Consolidated QR Print Studio/i }).first();
      await expect(adminQrMix).toBeVisible({ timeout: 10_000 });
      await expect(adminQrMix.getByRole('button', { name: /Consolidated \(1 QR per RMA\)/i })).toBeVisible();
      await expect(adminQrMix.getByRole('button', { name: /Single \/ Per-Item QRs/i })).toBeVisible();
      await adminQrMix.getByRole('button', { name: /Single \/ Per-Item QRs/i }).click();
      await expect(adminQrMix.locator('#rma-qr-batch-sheet-root [data-rma-qr-card]')).toHaveCount(3);
      await adminQrMix.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(adminQrMix).toBeHidden();

      // 3. Supplier Claims Tab: Multi-Select Unpacked Rows ALWAYS shows QR toggle + supports Mixed Suppliers
      await page.getByRole('button', { name: /Sandbox Supplier RTVs/i }).click();
      const searchRtv = page.locator('input[placeholder*="Search" i]').first();
      await searchRtv.fill(rtvMixedRma);
      const rtvRowAlpha = page.locator('tr', { hasText: 'RTV Mixed Item Alpha' }).first();
      const rtvRowBeta = page.locator('tr', { hasText: 'RTV Mixed Item Beta' }).first();
      await expect(rtvRowAlpha).toBeVisible({ timeout: 15_000 });
      await expect(rtvRowBeta).toBeVisible({ timeout: 15_000 });
      await expect(rtvRowAlpha).toContainText('Supplier A');
      await expect(rtvRowBeta).toContainText('Suysing');

      await rtvRowAlpha.locator('input[type="checkbox"]').first().check();
      await rtvRowBeta.locator('input[type="checkbox"]').first().check();
      await page.getByRole('button', { name: /Print \/ Save QRs \(2\)/i }).click();
      const rtvQrModal = page.locator('div.fixed', { hasText: /Print RMA QR Code|Consolidated QR Print Studio/i }).first();
      await expect(rtvQrModal).toBeVisible({ timeout: 10_000 });
      await expect(rtvQrModal.getByRole('button', { name: /Consolidated \(1 QR per RMA\)/i })).toBeVisible();
      await expect(rtvQrModal.getByRole('button', { name: /Single \/ Per-Item QRs/i })).toBeVisible();
      await expect(rtvQrModal.locator('#rma-qr-batch-sheet-root [data-rma-qr-card]')).toHaveCount(1);
      await rtvQrModal.getByRole('button', { name: /Single \/ Per-Item QRs/i }).click();
      await expect(rtvQrModal.locator('#rma-qr-batch-sheet-root [data-rma-qr-card]')).toHaveCount(2);
      await rtvQrModal.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(rtvQrModal).toBeHidden();

      // Verify Supplier RTV Multi-Item Batch keeps per-item Supplier Name + Email (To/CC) editable cleanly in Edit Details & Documents
      await rtvRowAlpha.getByRole('button', { name: /Details|Inspect|Split Qty/i }).first().click();
      const rtvQuickModal = page.locator('div.fixed', { hasText: 'RMA Details & Quick Actions' }).first();
      await expect(rtvQuickModal).toBeVisible({ timeout: 10_000 });
      await rtvQuickModal.getByRole('button', { name: /Edit Details & Documents/i }).click();
      await expect(rtvQuickModal.locator('input[aria-label="Store or customer branch"]')).toHaveCount(0);
      await expect(rtvQuickModal.locator('input[aria-label="Batch item 1 supplier email To"]')).toBeVisible();
      await rtvQuickModal.locator('input[aria-label="Batch item 1 supplier email To"]').fill('claims-supa@pingcon-test.local');
      await rtvQuickModal.getByRole('button', { name: /Save Changes/i }).click();
      await expect(rtvQuickModal.getByRole('button', { name: /Edit Details & Documents/i })).toBeVisible({ timeout: 15_000 });
      await expect(rtvQuickModal.getByText('Total: 8 pcs').first()).toBeVisible({ timeout: 15_000 });
      await rtvQuickModal.getByRole('button', { name: /Done \/ Close/i }).click();
      await expect(rtvQuickModal).toBeHidden();

      // 4. Mirror .xlsx Reply Flow on Mixed-Supplier Batch Qty Edit -> Auto-updates parent quantity & total_quantity
      const parentFetch = await page.evaluate(
        async ({ url, key, targetRma }) => {
          const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
          const token = supaKey ? JSON.parse(localStorage.getItem(supaKey))?.access_token : '';
          const r = await fetch(`${url}/rest/v1/rma_reports?rma_number=eq.${encodeURIComponent(targetRma)}&select=*`, {
            headers: { apikey: key, Authorization: `Bearer ${token}` }
          });
          return await r.json();
        },
        { url: supaUrl, key: anonKey, targetRma: custBatchRma }
      );
      const currentParent = parentFetch.find((r) => !r.parent_rma_id);
      expect(currentParent).toBeTruthy();

      const xlsxOrig = Buffer.from(
        buildRmaAlertXlsxBytes(currentParent, {
          subject: `[TEST] [RMA Alert] ${custBatchRma}`
        })
      );
      const origEntries = parseZipEntriesFromBuffer(xlsxOrig);
      const origSheet = origEntries.get('xl/worksheets/sheet1.xml').toString('utf8');
      const marker = origSheet.indexOf('MANIFEST LINE ITEMS');
      const beforeM = origSheet.slice(0, marker);
      const afterM = origSheet.slice(marker).replace(/(<c r="F\d+"[^>]*><v>)6(<\/v><\/c>)/, '$17$2');
      expect(afterM).toContain('>7</v>');
      const modFiles = [];
      for (const [k, v] of origEntries.entries()) {
        modFiles.push({ name: k, content: k === 'xl/worksheets/sheet1.xml' ? `${beforeM}${afterM}` : v });
      }
      const modXlsx = Buffer.from(buildStoredZip(modFiles));

      const xlsxIngestRes = await page.evaluate(
        async ({ b64, targetRma }) => {
          const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
          const token = supaKey ? JSON.parse(localStorage.getItem(supaKey))?.access_token : '';
          const res = await fetch('/api/send-email?action=ingest-xlsx-reply', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify({
              fileBase64: b64,
              rmaNumber: targetRma,
              subject: `[TEST] [RMA Alert] ${targetRma}`,
              actorName: 'Playwright Batch Qty Sync'
            })
          });
          return { status: res.status, json: await res.json().catch(() => null) };
        },
        { b64: modXlsx.toString('base64'), targetRma: custBatchRma }
      );
      expect(xlsxIngestRes.status).toBe(200);
      expect(xlsxIngestRes.json?.success).toBe(true);
      expect(xlsxIngestRes.json?.changedFields).toContain('item_1_quantity');
      expect(xlsxIngestRes.json?.changedFields).toContain('total_quantity');

      const dbAfterXlsx = await page.evaluate(
        async ({ url, key, targetRma }) => {
          const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
          const token = supaKey ? JSON.parse(localStorage.getItem(supaKey))?.access_token : '';
          const r = await fetch(`${url}/rest/v1/rma_reports?rma_number=eq.${encodeURIComponent(targetRma)}&select=*`, {
            headers: { apikey: key, Authorization: `Bearer ${token}` }
          });
          return await r.json();
        },
        { url: supaUrl, key: anonKey, targetRma: custBatchRma }
      );
      const afterParent = dbAfterXlsx.find((r) => !r.parent_rma_id);
      expect(afterParent?.quantity).toBe(10);
      expect(afterParent?.total_quantity).toBe(10);
      expect(afterParent?.items[0]?.quantity).toBe(7);
      expect(afterParent?.items[0]?.supplier_name).toBe('Supplier A');
      expect(afterParent?.items[1]?.quantity).toBe(3);
      expect(afterParent?.items[1]?.supplier_name).toBe('Suysing');

      guard.assertClean('Suite 10 Test C Editable Batch Qty, Mixed Suppliers, & Persistent QR Toggle');
    } finally {
      await page
        .evaluate(
          async ({ url, key, targetRmas }) => {
            try {
              const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
              const token = supaKey ? JSON.parse(localStorage.getItem(supaKey))?.access_token : '';
              if (!url || !key || !token) return;
              const headers = { apikey: key, Authorization: `Bearer ${token}` };
              for (const rmaNum of targetRmas) {
                await fetch(`${url}/rest/v1/rma_items?rma_number=eq.${encodeURIComponent(rmaNum)}`, {
                  method: 'DELETE',
                  headers
                }).catch(() => {});
              }
            } catch {}
          },
          { url: supaUrl, key: anonKey, targetRmas: createdRmas }
        )
        .catch(() => {});
      await cleanupTestRecords(page, { rmaNumbers: createdRmas });
      guard.detach();
    }
  });
});
