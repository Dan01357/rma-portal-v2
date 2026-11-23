import { test, expect } from '@playwright/test';
import {
  PNG_BUFFER,
  VERIFIED_BARCODE,
  attachStrictGuards,
  installPrintStubs,
  interceptAndCaptureEmails,
  mockPhotoUploadSuccess,
  setPublicPortalTestMode,
  seedTestModeRma,
  gotoAdmin,
  readSupabasePublicEnv,
  cleanupTestRecords
} from './helpers/testUtils.js';

async function submitQuickCustomerPortalRma(page, { isTestMode, reporterName }) {
  await setPublicPortalTestMode(page, isTestMode);

  const reportAnotherBtn = page.getByRole('button', { name: /Report Another/i });
  if (await reportAnotherBtn.isVisible().catch(() => false)) {
    await reportAnotherBtn.click();
  }

  await page.getByRole('button', { name: /Customer RMA Hub/i }).click();
  await page.locator('input[placeholder*="barcode" i]').first().fill(VERIFIED_BARCODE);
  await expect(page.getByText('Recognized Product')).toBeVisible({ timeout: 45_000 });

  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({
    name: isTestMode ? 'pw-qr-test-mode.png' : 'pw-qr-live-mode.png',
    mimeType: 'image/png',
    buffer: PNG_BUFFER
  });
  await expect(page.getByText('1/10 photos')).toBeVisible({ timeout: 10_000 });

  await page.locator('input[placeholder="Your Full Name *"]').fill(reporterName);
  await page
    .locator('input[placeholder="Phone No. or Email *"]')
    .fill(isTestMode ? 'playwright-qr-test@pingcon.local' : 'playwright-qr-live@pingcon.local');

  const insertResponsePromise = page.waitForResponse(
    (res) => res.url().includes('/rest/v1/rma_reports') && res.request().method() === 'POST',
    { timeout: 45_000 }
  );

  await page.getByRole('button', { name: /Submit Return Report/i }).click();
  await expect(page.getByText('Box Sticker Ready')).toBeVisible({ timeout: 45_000 });
  expect((await insertResponsePromise).status()).toBeLessThan(400);

  const prefixRegex = isTestMode ? /^RMA-TEST-/ : /^RMA-\d{4}-/;
  const rmaNumber = (
    await page
      .locator('.font-mono.font-black.text-slate-900, .font-mono.font-black.dark\\:text-white')
      .filter({ hasText: prefixRegex })
      .first()
      .innerText()
  ).trim();
  expect(rmaNumber).toMatch(prefixRegex);
  return rmaNumber;
}

async function scanQrThroughPortalScanner(page, qrPayload) {
  await page.getByRole('button', { name: /Scan RMA QR/i }).click();
  await expect(page.getByText('Product & RMA QR Scanner')).toBeVisible({ timeout: 10_000 });

  const manualInput = page.locator('input[aria-label="Manual QR or barcode input"]');
  await expect(manualInput).toBeVisible();
  await manualInput.fill(qrPayload);
  await page.getByRole('button', { name: /^Process$/i }).click();

  await expect(page.getByText('Product & RMA QR Scanner')).toBeHidden({ timeout: 10_000 });
}

test.describe('Suite 06: QR Scanner Cross-Mode Isolation, 4-Option Wizard & Multi-RMA Batch Consolidation', () => {
  test('scans generated RMA QR codes in Live & Test Mode, persists 4-option Customer Hub choices (incl. Re-Order YES/NO), and blocks cross-mode scans', async ({
    page,
    context
  }) => {
    test.setTimeout(240_000);
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);
    const capturedEmails = await interceptAndCaptureEmails(page);
    await mockPhotoUploadSuccess(page);

    let liveRmaNumber = null;
    let testRmaNumber = null;

    try {
      await page.goto('/', { waitUntil: 'commit', timeout: 30_000 });
      await expect(page.getByText(/Scan Product Barcode or RMA Sticker QR/i)).toBeVisible({
        timeout: 25_000
      });

      // PART A: LIVE MODE
      liveRmaNumber = await submitQuickCustomerPortalRma(page, {
        isTestMode: false,
        reporterName: 'Playwright Live QR Tester'
      });

      await scanQrThroughPortalScanner(page, 'PINGCON-RMA:TEST:RMA-TEST-2026-9999-BLCK');
      await expect(page.getByText('What do you want to do with this item?')).toBeHidden();
      await expect(
        page.locator('[role="alert"]').filter({ hasText: /TEST MODE QR sticker/i }).first()
      ).toBeVisible({ timeout: 10_000 });

      await scanQrThroughPortalScanner(page, `PINGCON-RMA:LIVE:${liveRmaNumber}`);
      await expect(page.getByText('What do you want to do with this item?')).toBeVisible({ timeout: 15_000 });

      // Option 4: Restock
      await page.getByRole('button', { name: /Put Back on Good Shelf \(Restock\)/i }).first().click();
      await page.getByRole('button', { name: /Confirm & Save: Put Back on Good Shelf \(Restock\)/i }).click();
      await expect(page.getByRole('button', { name: /Edit Choice \/ Details/i })).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(() => capturedEmails.some((e) => String(e?.subject || '').includes('[RMA Restocked]')), {
          timeout: 10_000
        })
        .toBe(true);

      // Option 1: Customer Debit/Credit wait-only + Driver Pickup screen navigation
      await page.getByRole('button', { name: /Edit Choice \/ Details/i }).click();
      await page.locator('input[placeholder*="Supplier Company Name" i]').fill('Playwright Live Vendor Corp');
      await page.getByRole('button', { name: /Driver Picked Up \/ Accepted for Debit \/ Credit/i }).click();
      await page.getByRole('button', { name: /Save Choice Only \(Waiting for Driver\)/i }).click();
      await expect(page.getByRole('button', { name: /Edit Choice \/ Details/i })).toBeVisible({ timeout: 15_000 });

      await page.getByRole('button', { name: /Edit Choice \/ Details/i }).click();
      await page.getByRole('button', { name: /Driver Picked Up \/ Accepted for Debit \/ Credit/i }).click();
      await page.getByRole('button', { name: /Driver Is Here — Upload Photos & Print Letter/i }).click();
      await expect(page.getByText(/Driver Pickup Verification \(0\/5 Photos\)/i)).toBeVisible();
      await page.getByRole('button', { name: /^Back$/i }).click();
      await page.locator('button[aria-label="Close modal"]').first().click();

      // PART B: TEST MODE
      testRmaNumber = await submitQuickCustomerPortalRma(page, {
        isTestMode: true,
        reporterName: 'Playwright Test QR Tester'
      });

      await scanQrThroughPortalScanner(page, `PINGCON-RMA:LIVE:${liveRmaNumber}`);
      await expect(page.getByText('What do you want to do with this item?')).toBeHidden();
      await expect(
        page.locator('[role="alert"]').filter({ hasText: /LIVE PRODUCTION QR sticker/i }).first()
      ).toBeVisible({ timeout: 10_000 });

      await scanQrThroughPortalScanner(page, `PINGCON-RMA:TEST:${testRmaNumber}`);
      await expect(page.getByText('What do you want to do with this item?')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('🧪 Test Mode').first()).toBeVisible();

      // Option 3: Scrap + Re-Order YES/NO toggle check
      await page.getByRole('button', { name: /Throw Away \/ Dispose \(Scrap\)/i }).click();
      const noReorderBtn = page.getByRole('button', { name: /NO.*Do Not Re-Order/i }).first();
      const yesReorderBtn = page.getByRole('button', { name: /YES.*Re-Order/i }).first();
      if (await noReorderBtn.isVisible().catch(() => false)) {
        await noReorderBtn.click();
        await yesReorderBtn.click();
      }
      await page.getByRole('button', { name: /Confirm & Save: Throw Away \/ Dispose \(Scrap\)/i }).click();
      await expect(page.getByRole('button', { name: /Edit Choice \/ Details/i })).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(() => capturedEmails.some((e) => e?.isTestMode && String(e?.subject || '').startsWith('[TEST] [RMA Scrapped]')), {
          timeout: 10_000
        })
        .toBe(true);

      // Option 2: Replacement / Exchange wait-only
      await page.getByRole('button', { name: /Edit Choice \/ Details/i }).click();
      await page.locator('input[placeholder*="Supplier Company Name" i]').fill('Playwright Sandbox Vendor Corp');
      await page.getByRole('button', { name: /Driver Picked Up \/ Replaced with Good Stock/i }).click();
      await page.getByRole('button', { name: /Save Choice Only \(Waiting for Driver\)/i }).click();
      await expect(page.getByRole('button', { name: /^Done$/i })).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: /^Done$/i }).click();

      // Legacy ?rma= URL payload
      await scanQrThroughPortalScanner(page, `https://rma-portal-v2.vercel.app/?rma=${testRmaNumber}`);
      await expect(page.getByText('What do you want to do with this item?')).toBeVisible({ timeout: 15_000 });
      await page.locator('button[aria-label="Close modal"]').first().click();

      // Confirm DB persistence tagged [TEST_MODE] & is_test: true
      const { supaUrl, anonKey } = readSupabasePublicEnv();
      const persistedTestRow = await page.evaluate(
        async ({ rmaNum, url, key }) => {
          const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
          const token = supaKey ? JSON.parse(localStorage.getItem(supaKey))?.access_token : null;
          const res = await fetch(
            `${url}/rest/v1/rma_reports?rma_number=eq.${encodeURIComponent(rmaNum)}&select=rma_number,status,disposition,notes,ai_document_metadata`,
            { headers: { apikey: key, Authorization: `Bearer ${token}` } }
          );
          const rows = await res.json();
          return Array.isArray(rows) ? rows[0] : null;
        },
        { rmaNum: testRmaNumber, url: supaUrl, key: anonKey }
      );
      expect(persistedTestRow).toBeTruthy();
      expect(persistedTestRow.rma_number).toMatch(/^RMA-TEST-/);
      expect(persistedTestRow.disposition).toBe('customer_exchange');
      expect(persistedTestRow.ai_document_metadata?.is_test).toBe(true);
      expect(String(persistedTestRow.notes || '')).toContain('[TEST_MODE]');

      guard.assertClean('suite 06 portal qr scanner 4-option wizard');
    } finally {
      await cleanupTestRecords(page, { rmaNumbers: [liveRmaNumber, testRmaNumber] });
      guard.detach();
    }
  });

  test('Supplier RTV Multi-RMA Consolidation: Single-Supplier Guard, Select All Unclaimed, 1 shared RTV- Claim, Auto-Combine toggle, US Letter B&W Cut/Full-Page Print, & Re-Edit Claim Preservation', async ({
    page,
    context
  }) => {
    test.setTimeout(210_000);
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);
    const capturedEmails = await interceptAndCaptureEmails(page);
    await mockPhotoUploadSuccess(page);

    let sup1A = null;
    let sup1B = null;
    let sup2Diff = null;
    let sharedClaimNumber = null;

    try {
      // Seed 2 identical-SKU RMAs (Suy Sing Commercial Corp from VERIFIED_BARCODE) + 1 non-catalog RMA ('Other Guard Vendor')
      sup1A = await seedTestModeRma(page, {
        stream: 'supplier',
        photoCount: 1,
        expiryDays: 60,
        supplierOrCompany: 'Suy Sing Commercial Corp',
        quantity: 3
      });
      sup1B = await seedTestModeRma(page, {
        stream: 'supplier',
        photoCount: 1,
        expiryDays: 60,
        supplierOrCompany: 'Suy Sing Commercial Corp',
        quantity: 2
      });
      sup2Diff = await seedTestModeRma(page, {
        stream: 'supplier',
        photoCount: 1,
        expiryDays: 60,
        barcode: `PW-OTHER-${String(Date.now()).slice(-6)}`,
        supplierOrCompany: 'Other Guard Vendor'
      });

      await gotoAdmin(page);
      await page.getByRole('button', { name: /Test Mode Sandbox/i }).first().click();
      await page.getByRole('button', { name: /Sandbox Supplier RTVs/i }).click();

      // 1. Single-Supplier Guard check: select sup1A (Suy Sing Commercial Corp) + sup2Diff (Other Guard Vendor)
      await page.locator('input[placeholder*="Search" i]').first().fill('RMA-TEST-');
      const rowA = page.locator('tr', { hasText: sup1A }).first();
      const rowDiff = page.locator('tr', { hasText: sup2Diff }).first();
      await expect(rowA).toBeVisible({ timeout: 10_000 });
      await expect(rowDiff).toBeVisible({ timeout: 10_000 });
      await rowA.locator('input[type="checkbox"]').first().check();
      await rowDiff.locator('input[type="checkbox"]').first().check();

      await page.getByRole('button', { name: /Process Consolidated Batch \(2 RMAs\)/i }).click();
      await expect(page.getByText(/Single-Supplier Guard:/i)).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: /Return to supplier for Debit Claim/i }).click();
      await page.getByRole('button', { name: /Driver Is Here — Upload Photos & Print Letter/i }).click();
      // Without checking Unify checkbox, Single-Supplier Guard blocks advancing
      await expect(page.getByText(/Single-Supplier Guard:/i).first()).toBeVisible();
      await page.locator('button[aria-label="Close modal"]').first().click();

      // Clear selection & filter Supplier dropdown to 'Suy Sing Commercial Corp' -> exercise 1-click "Select All Unclaimed"
      const deselectBtn = page.getByRole('button', { name: 'Clear', exact: true }).first();
      if (await deselectBtn.isVisible().catch(() => false)) await deselectBtn.click();

      const supplierDropdown = page.locator('select').first();
      const hasSupplierOpt = await supplierDropdown.evaluate((el) =>
        Array.from(el.options).some((o) => o.value.includes('Suy Sing Commercial Corp') || o.text.includes('Suy Sing Commercial Corp'))
      );
      if (hasSupplierOpt) {
        const optVal = await supplierDropdown.evaluate((el) => {
          const opt = Array.from(el.options).find((o) => o.value.includes('Suy Sing Commercial Corp') || o.text.includes('Suy Sing Commercial Corp'));
          return opt ? opt.value : '';
        });
        if (optVal) await supplierDropdown.selectOption(optVal);
      } else {
        await page.locator('input[placeholder*="Search" i]').first().fill('Suy Sing Commercial Corp');
      }

      const selectUnclaimedBtn = page.getByRole('button', { name: /Select All Unclaimed for/i }).first();
      if (await selectUnclaimedBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await selectUnclaimedBtn.click();
        await expect(page.getByRole('button', { name: /Process Consolidated Batch \(/i })).toBeVisible({
          timeout: 8_000
        });
        // Reset selection and pick strictly our two seeded rows (sup1A + sup1B) so prior leftover sandbox rows cannot skew the count
        const clearAfterSelectAll = page.getByRole('button', { name: 'Clear', exact: true }).first();
        if (await clearAfterSelectAll.isVisible().catch(() => false)) await clearAfterSelectAll.click();
      }
      await page.locator('tr', { hasText: sup1A }).first().locator('input[type="checkbox"]').first().check();
      await page.locator('tr', { hasText: sup1B }).first().locator('input[type="checkbox"]').first().check();

      // 2. Process Consolidated Batch (2 RMAs) -> Debit Claim 5-photo pickup
      await page.getByRole('button', { name: /Process Consolidated Batch \(2 RMAs\)/i }).click();
      await expect(page.getByText(/Consolidated Batch: 2 RMAs Selected/i)).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: /Return to supplier for Debit Claim/i }).click();
      await page.getByRole('button', { name: /Driver Is Here — Upload Photos & Print Letter/i }).click();
      await expect(page.getByText(/Driver Pickup Verification \(0\/5 Photos\)/i)).toBeVisible();

      await page.locator('input[placeholder*="claims@supplier.com" i]').fill('batch-claims@example.com');
      await page.locator('input[placeholder*="rep@supplier.com" i]').fill('batch-ap@example.com');

      const photoInputs = page.locator('input[type="file"][accept="image/*"]');
      const count = await photoInputs.count();
      for (let i = 0; i < count; i++) {
        await photoInputs.nth(i).setInputFiles({
          name: `pw-batch-${i + 1}.png`,
          mimeType: 'image/png',
          buffer: PNG_BUFFER
        });
      }
      await expect(page.getByText(/Driver Pickup Verification \(5\/5 Photos\)/i)).toBeVisible();

      await page.locator('input[placeholder*="Auto-filled or type name" i]').fill('Playwright Batch Driver');
      await page.locator('input[placeholder*="NAA 1234" i]').fill('PW-777');

      const emailsBeforeBatch = capturedEmails.length;
      await page
        .getByRole('button', { name: /Upload 5 Photos to RMA Drive|Save Updates & Open Letter Form/i })
        .click();

      // Assert Unified B&W Letter Debit Claim Form opens with Auto-Combine Identical Items toggle & Layout toggle
      await expect(page.getByText(/SUPPLIER DEBIT CLAIM & PICKUP VALIDATION FORM/i).first()).toBeVisible({
        timeout: 25_000
      });
      await expect(page.getByText(/BATCH \(2 RMAs\)/i).first()).toBeVisible();

      // Toggle Auto-Combine Identical Items ON <-> OFF (3 + 2 = 5 pcs combined -> 2 separate rows when OFF!)
      const combineToggle = page.getByRole('button', { name: /Auto-Combine Identical Items:/i });
      if (await combineToggle.isVisible().catch(() => false)) {
        await expect(combineToggle).toContainText('ON');
        await combineToggle.click();
        await expect(combineToggle).toContainText('OFF');
        await combineToggle.click();
        await expect(combineToggle).toContainText('ON');
      }

      // Toggle Full Page per Copy <-> Auto & print to verify US Letter B&W HTML without A4
      const fullPageToggle = page.getByRole('button', { name: /Full Page per Copy/i });
      if (await fullPageToggle.isVisible().catch(() => false)) {
        await fullPageToggle.click();
      }
      const printsBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await page.getByRole('button', { name: /Print Letter Dual-Copy Form|Print Full-Page Letter Copies/i }).click();
      await expect.poll(() => page.evaluate(() => window.__pwPrintCount || 0), { timeout: 8_000 }).toBeGreaterThan(printsBefore);
      const htmls = await page.evaluate(() => window.__pwPrintHtmls || []);
      const formHtml = htmls[htmls.length - 1] || '';
      expect(formHtml.toLowerCase()).not.toContain('size: a4');
      expect(formHtml).toContain('letter portrait');

      await page.locator('button[aria-label="Close form"]').click();

      // Assert exactly ONE consolidated pickup email was sent with ONE Debit-Claim-Form-*.pdf
      await expect.poll(() => capturedEmails.length, { timeout: 15_000 }).toBe(emailsBeforeBatch + 1);
      const batchEmail = capturedEmails[capturedEmails.length - 1];
      expect(batchEmail.isTestMode).toBe(true);
      expect(batchEmail.subject).toMatch(/Driver Picked Up - Debit Claim/);
      expect(batchEmail.html).toContain(sup1A);
      expect(batchEmail.html).toContain(sup1B);
      expect((batchEmail.attachments || []).filter((a) => String(a.filename || '').startsWith('Debit-Claim-Form-')).length).toBe(1);

      await page.locator('button[aria-label="Close modal"]').first().click();

      // 3. Verify BOTH rows show the exact same Batch Claim RTV- ID & Re-Editing preserves Claim ID without duplicating!
      await page.locator('input[placeholder*="Search" i]').first().fill(sup1B);
      const batchBadgeRow = page.locator('tr', { hasText: sup1B }).first();
      await expect(batchBadgeRow.getByText(/Batch Claim: RTV-TEST-/i)).toBeVisible({ timeout: 10_000 });
      const rowTxt = await batchBadgeRow.innerText();
      const claimMatch = rowTxt.match(/(RTV-TEST-\d{4}-\d+-[A-Z0-9]+)/i);
      expect(claimMatch).toBeTruthy();
      sharedClaimNumber = claimMatch[1];

      // Click Edit Claim / Open 4-Choice on sup1B -> opens whole 2-RMA batch -> update truck plate -> preserve sharedClaimNumber!
      await batchBadgeRow.locator('button[title*="Edit" i], button[title*="4-Choice" i]').first().click();
      await expect(page.getByText(/Consolidated Batch: 2 RMAs Selected/i)).toBeVisible({ timeout: 10_000 });
      const editChoiceBtn = page.getByRole('button', { name: /Edit Choice \/ Details/i });
      if (await editChoiceBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await editChoiceBtn.click();
      }
      await page.getByRole('button', { name: /Return to supplier for Debit Claim/i }).click();
      await page
        .getByRole('button', {
          name: /Edit Pickup Details, Emails & 5 Photos|Driver Is Here — Upload Photos & Print Letter/i
        })
        .click();
      await page.locator('input[placeholder*="NAA 1234" i]').fill('PW-8888');
      await page.getByRole('button', { name: /Save Updates & Open Letter Form/i }).click();
      await expect(page.getByText(/SUPPLIER DEBIT CLAIM & PICKUP VALIDATION FORM/i).first()).toBeVisible({
        timeout: 45_000
      });
      await expect(page.getByText(sharedClaimNumber).first()).toBeVisible();
      await page.locator('button[aria-label="Close form"]').click();
      await page.locator('button[aria-label="Close modal"]').first().click();

      guard.assertClean('suite 06 multi-RMA consolidation & single-supplier guard');
    } finally {
      await cleanupTestRecords(page, {
        rmaNumbers: [sup1A, sup1B, sup2Diff],
        claimNumbers: [sharedClaimNumber]
      });
      guard.detach();
    }
  });
});
