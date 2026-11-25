import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import {
  VERIFIED_BARCODE,
  attachStrictGuards,
  installPrintStubs,
  interceptAndCaptureEmails,
  mockPhotoUploadSuccess,
  seedTestModeRma,
  gotoAdmin,
  assertValidXlsxFile,
  cleanupTestRecords
} from './helpers/testUtils.js';

test.describe('Suite 05: Single & Consolidated Credit Memos (US Letter B&W, VAT, ₱10k Governance) & Settings/API Vault', () => {
  test('Single Credit Memo + ₱10k Governance + Multi-RMA Consolidated Credit Memo + Missing SKU Guard + Letter B&W Voucher + Void Reset', async ({
    page,
    context
  }) => {
    test.setTimeout(210_000);
    await context.grantPermissions(['camera']).catch(() => { });
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);
    await interceptAndCaptureEmails(page);
    await mockPhotoUploadSuccess(page);

    let rmaA = null;
    let rmaB = null;
    let rmaNoSku = null;
    const createdCms = [];

    const onDialog = async (dialog) => {
      await dialog.accept();
    };
    page.on('dialog', onDialog);

    try {
      // Seed 2 cataloged Customer RMAs (A & B) + 1 Unlabeled/No-SKU Customer RMA (C) strictly in Test Mode Sandbox
      rmaA = await seedTestModeRma(page, { stream: 'customer', photoCount: 1, barcode: VERIFIED_BARCODE });
      rmaB = await seedTestModeRma(page, { stream: 'customer', photoCount: 1, barcode: VERIFIED_BARCODE });
      rmaNoSku = await seedTestModeRma(page, {
        stream: 'customer',
        photoCount: 1,
        barcode: `NOLABEL-${String(Date.now()).slice(-6)}`
      });

      // 1. Live Customer RMA Hub -> Credit Memos Ledger sub-tab renders cleanly (hiding WMS / ERP Sync bar)
      await gotoAdmin(page);
      await page.getByRole('button', { name: /Customer RMA Hub/i }).first().click();
      await expect(page.getByText('WMS / ERP Sync').first()).toBeVisible();
      await page.getByRole('button', { name: /Credit Memos Ledger \(/i }).first().click();
      await expect(page.getByText('Finance Credit Memorandum Section')).toBeVisible();
      await expect(page.getByText('WMS / ERP Sync')).toHaveCount(0);
      await page.getByRole('button', { name: /Issue.*Credit Memo/i }).first().click();
      await expect(page.getByText(/Issue Finance Credit Memo/i)).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
      await expect(page.getByText(/Issue Finance Credit Memo/i)).toBeHidden();

      // 2. Test Mode Sandbox: 2 symmetrical hub tabs (no standalone Sandbox Credit Memos tab); apply qty 350 (> P10k)
      await page.getByRole('button', { name: /Test Mode Sandbox/i }).first().click();
      await expect(page.getByRole('button', { name: /Sandbox Credit Memos/i })).toHaveCount(0);
      await page.getByRole('button', { name: /Sandbox Customer RMAs/i }).click();
      await page.getByRole('button', { name: /Customer Returns \(/i }).first().click();
      await page.locator('input[placeholder*="Search" i]').first().fill(rmaA);
      const rmaRowA = page.locator('tr', { hasText: rmaA }).first();
      await expect(rmaRowA).toBeVisible({ timeout: 10_000 });

      await rmaRowA.getByRole('button', { name: /Split Qty|Details|Inspect/i }).first().click();
      await expect(page.getByText('RMA Details & Quick Actions')).toBeVisible();
      await page.getByRole('button', { name: /Edit Details & Documents/i }).click();
      await page.locator('input[type="number"][min="1"]').first().fill('350');
      await page.getByRole('button', { name: /Save & Apply Restitution/i }).click();
      await expect(page.getByText(/Super Admin Approved \(> ₱10,000 Claim\)/i)).toBeVisible({
        timeout: 25_000
      });
      await page.getByRole('button', { name: /Done \/ Close/i }).click();

      // 3. Single Credit Memo flow inside Sandbox Customer RMAs -> Credit Memos Ledger sub-tab
      await page.getByRole('button', { name: /Credit Memos Ledger \(/i }).first().click();
      await expect(page.getByText(/Finance Credit Memorandum Section/i)).toBeVisible();
      await expect(page.getByText('WMS / ERP Sync')).toHaveCount(0);

      await page.getByRole('button', { name: /Issue.*Credit Memo/i }).first().click();
      await expect(page.getByRole('heading', { name: 'Issue Finance Credit Memo' })).toBeVisible();
      await expect(page.getByText(/Pull Out Date \(YYYY-MM-DD\)/i).first()).toBeVisible();
      await expect(page.locator('#credit-memo-form input[placeholder*="Analiza" i]').first()).toHaveValue(/Analiza/i);

      const ticketSelect = page.locator('#credit-memo-form').locator('..').locator('select').first();
      if (await ticketSelect.isVisible().catch(() => false)) {
        const optValue = await ticketSelect.evaluate((el, targetRma) => {
          const opt = Array.from(el.options).find((o) => o.text.includes(targetRma));
          return opt ? opt.value : '';
        }, rmaA);
        if (optValue) await ticketSelect.selectOption(optValue);
      }

      const qtyInc = page.locator('button[title="Increase Quantity"]');
      const qtyDec = page.locator('button[title="Decrease Quantity"]');
      await qtyInc.click();
      await qtyDec.click();

      const cmQtyInput = page.locator('#credit-memo-form input[inputmode="numeric"]').first();
      await cmQtyInput.fill('200');
      await cmQtyInput.blur();

      const unitPriceInput = page.locator('#credit-memo-form input[inputmode="decimal"]').nth(0);
      await unitPriceInput.fill('60.00');
      await unitPriceInput.blur();

      const creditAmtInput = page.locator('#credit-memo-form input[inputmode="decimal"]').nth(2);
      await expect(creditAmtInput).toHaveValue('12000.00');

      await page.getByRole('button', { name: /90% \(-10%\)/i }).click();
      await expect(creditAmtInput).toHaveValue('10800.00');
      await page.getByRole('button', { name: /100% Full/i }).click();
      await expect(creditAmtInput).toHaveValue('12000.00');

      const porInput = page.locator('#credit-memo-form input[placeholder*="POR-"]').first();
      const porBefore = await porInput.inputValue();
      await page.getByRole('button', { name: /Regenerate POR/i }).click();
      await expect(porInput).not.toHaveValue(porBefore);

      await page.getByRole('button', { name: /Save & View Voucher/i }).click();
      await expect(page.getByText('FINANCE CREDIT MEMORANDUM', { exact: true }).first()).toBeVisible({
        timeout: 20_000
      });
      await expect(page.getByText(/₱12,000\.00/).first()).toBeVisible();

      const singlePrintBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await page.getByRole('button', { name: /Print Letter Voucher \/ PDF/i }).click();
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => window.__pwPrintCount || 0)).toBeGreaterThan(singlePrintBefore);
      const printHtmls1 = await page.evaluate(() => window.__pwPrintHtmls || []);
      const voucherHtml1 = printHtmls1[printHtmls1.length - 1] || '';
      expect(voucherHtml1.toLowerCase()).toContain('letter portrait');
      expect(voucherHtml1.toLowerCase()).not.toContain('size: a4');

      await page.locator('#credit-memo-voucher-print-root button:has(svg.lucide-x)').first().click();
      await expect(page.locator('#credit-memo-voucher-print-root')).toBeHidden();

      const cmSearch = page.locator('input[placeholder*="Search by CM #" i]').first();
      await cmSearch.fill(rmaA);
      const cmRow1 = page.locator('tr', { hasText: rmaA }).first();
      await expect(cmRow1).toBeVisible({ timeout: 20_000 });

      const [cmXlsxDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('button[title="Export all credit memos to Excel (.xlsx)"]').click()
      ]);
      const xlsxXml = assertValidXlsxFile(cmXlsxDownload, await cmXlsxDownload.path());
      expect(xlsxXml).toContain('12% VAT Amount (PHP)');
      expect(xlsxXml).toContain('1285.71');
      expect(xlsxXml).not.toContain('[CM_META:');

      await cmRow1.locator('button[title="Edit Credit Memo"]').click();
      await expect(page.getByText('Edit Finance Credit Memo')).toBeVisible();
      await page.locator('#credit-memo-form textarea').fill('Playwright verified 12% VAT & >10k governance');
      await page.getByRole('button', { name: /Update Credit Memo/i }).click();
      await expect(page.getByText('Edit Finance Credit Memo')).toBeHidden({ timeout: 10_000 });

      await cmRow1.locator('button[title="Void / Delete Credit Memo"]').click();
      await page.getByRole('button', { name: /Yes, Delete Permanently/i }).click();
      await expect(page.getByText(/Confirm Deletion/i)).toBeHidden({ timeout: 35_000 });
      await expect(cmRow1).toBeHidden({ timeout: 35_000 });

      // 4. Multi-RMA Consolidated Credit Memo flow + Financial Missing SKU Guard
      await page.getByRole('button', { name: /Customer Returns \(/i }).first().click();
      await expect(page.getByText('WMS / ERP Sync').first()).toBeVisible();
      await page.locator('input[placeholder*="Search" i]').first().fill('RMA-TEST-');

      for (const rma of [rmaA, rmaB, rmaNoSku]) {
        const row = page.locator('tr', { hasText: rma }).first();
        await expect(row).toBeVisible({ timeout: 10_000 });
        await row.locator('input[type="checkbox"]').first().check();
      }

      // Click "+ Consolidated Credit Memo (3 RMAs)"
      const consolCmBtn = page.getByRole('button', { name: /\+ Consolidated Credit Memo \(3 RMAs\)/i }).first();
      await expect(consolCmBtn).toBeVisible();
      await consolCmBtn.click();
      await expect(page.getByRole('heading', { name: /Issue Consolidated Credit Memo \(3 RMAs\)/i })).toBeVisible({
        timeout: 10_000
      });

      // Missing SKU Financial Guard must flag rmaNoSku & offer Assign SKU
      await expect(page.getByText(/Financial Validation Guard: 1 Selected RMA\(s\) Missing SKU or Price/i)).toBeVisible();
      await expect(page.getByRole('button', { name: /Assign SKU/i }).first()).toBeVisible();

      // Uncheck rmaNoSku from the consolidated checklist inside the modal -> guard clears!
      const rmaNoSkuCb = page.locator('label', { hasText: rmaNoSku }).locator('input[type="checkbox"]').first();
      await rmaNoSkuCb.uncheck();
      await expect(page.getByText(/Financial Validation Guard:/i)).toBeHidden();
      await expect(page.getByText(/Itemized Consolidated Breakdown \(2 RMAs\)/i)).toBeVisible();

      await page.locator('#credit-memo-form textarea').fill('Playwright Consolidated Settlement Note');
      await page.getByRole('button', { name: /Save & View Voucher/i }).click();

      // Verify Consolidated Voucher opens cleanly on B&W US Letter with BOTH rmaA & rmaB
      await expect(page.getByText('FINANCE CREDIT MEMORANDUM', { exact: true }).first()).toBeVisible({
        timeout: 20_000
      });
      await expect(page.getByText(/CONSOLIDATED \(2 RMAs\)/i).first()).toBeVisible();
      await expect(page.getByText(rmaA).first()).toBeVisible();
      await expect(page.getByText(rmaB).first()).toBeVisible();
      await expect(page.getByText('Playwright Consolidated Settlement Note').first()).toBeVisible();
      await expect(page.getByText(/Separated Full Pages \(Dedicated Paper per Copy\)/i)).toBeVisible();

      // Verify customizable copy counts & presets on Credit Memo Voucher
      await page.getByRole('button', { name: '2 Ours + 1 Theirs (3 Papers)' }).click();
      await expect(page.getByText('Total Output: 3 Papers')).toBeVisible();
      await expect(page.locator('#credit-memo-voucher-print-root .voucher-sheet')).toHaveCount(3);
      await expect(page.getByText(/^COPY 3 OF 3 — CUSTOMER COPY/i)).toBeVisible();

      await page.locator('input[aria-label="Our Company Copies"]').fill('0');
      await page.locator('input[aria-label="Customer Copies"]').fill('0');
      await expect(page.getByText(/Total copy count is 0\./i)).toBeVisible();
      const consolVoucherPrintBtn = page.getByRole('button', { name: /Print Letter Voucher \/ PDF/i });
      await expect(consolVoucherPrintBtn).toBeDisabled();

      // Verify custom 2 Ours + 2 Customer = 4 separated copies on CreditMemoVoucherModal
      await page.locator('input[aria-label="Our Company Copies"]').fill('2');
      await page.locator('input[aria-label="Customer Copies"]').fill('2');
      await expect(page.getByText('Total Output: 4 Papers')).toBeVisible();
      await expect(page.getByText(/Prepared Date & Time/i).first()).toBeVisible();
      await expect(page.locator('#credit-memo-voucher-print-root .voucher-sheet')).toHaveCount(4);
      await expect(page.getByText(/^COPY 4 OF 4 — CUSTOMER COPY/i)).toBeVisible();
      await expect(consolVoucherPrintBtn).toBeEnabled();

      await page.getByRole('button', { name: '1 + 1 (2 Papers)' }).click();
      await expect(page.getByText('Total Output: 2 Papers')).toBeVisible();
      await expect(consolVoucherPrintBtn).toBeEnabled();

      const consolPrintBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await consolVoucherPrintBtn.click();
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => window.__pwPrintCount || 0)).toBeGreaterThan(consolPrintBefore);
      await page.locator('#credit-memo-voucher-print-root button:has(svg.lucide-x)').first().click();

      // Verify Credit Memos Ledger shows "🔗 Consolidated (2 RMAs)" & clean notes (zero [CM_META:])
      await page.getByRole('button', { name: /Credit Memos Ledger \(/i }).first().click();
      await cmSearch.fill(rmaB);
      const cmRowConsol = page.locator('tr', { hasText: /Consolidated \(2 RMAs\)/i }).first();
      await expect(cmRowConsol).toBeVisible({ timeout: 15_000 });
      const cmText = await cmRowConsol.innerText();
      expect(cmText).not.toContain('[CM_META:');
      const cmMatch = cmText.match(/(CM-TEST-\d{4}-\d+-[A-Z0-9]+)/i);
      if (cmMatch) createdCms.push(cmMatch[1]);

      // Verify BOTH rmaA and rmaB show CM status on Customer Returns before voiding
      await page.getByRole('button', { name: /Customer Returns \(/i }).first().click();
      await page.locator('input[placeholder*="Search" i]').first().fill(rmaB);
      await expect(page.locator('tr', { hasText: rmaB }).first().getByText(/Credit Memo Issued/i)).toBeVisible({
        timeout: 10_000
      });

      // Void Consolidated CM -> verify BOTH RMAs revert cleanly and consolidated CM vanishes
      await page.getByRole('button', { name: /Credit Memos Ledger \(/i }).first().click();
      await cmSearch.fill(rmaB);
      await cmRowConsol.locator('button[title="Void / Delete Credit Memo"]').click();
      await page.getByRole('button', { name: /Yes, Delete Permanently/i }).click();
      await expect(page.getByText(/Confirm Deletion/i)).toBeHidden({ timeout: 35_000 });
      await expect(cmRowConsol).toBeHidden({ timeout: 35_000 });

      guard.assertClean('suite 05 single & consolidated credit memos');
    } finally {
      await cleanupTestRecords(page, {
        rmaNumbers: [rmaA, rmaB, rmaNoSku],
        creditMemoNumbers: createdCms
      });
      page.off('dialog', onDialog);
      guard.detach();
    }
  });

  test('Settings & SMTP tab: mgan@pingconmarketing.com Sandbox banner, Supabase/SMTP/Catalog tests, Email Recipients, Editable Schedules, Locations, Poster & API Keys + /docs link', async ({
    page,
    context
  }) => {
    test.setTimeout(150_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => { });
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);

    const onDialog = async (dialog) => {
      await dialog.accept();
    };
    page.on('dialog', onDialog);
    const trackedMaskedKeys = new Set();

    try {
      await gotoAdmin(page);
      await page.getByRole('button', { name: /Settings & SMTP/i }).click();
      await expect(page.getByText('Simulation / Test Mode Toggle')).toBeVisible();
      await expect(page.getByText(/mgan@pingconmarketing\.com/).first()).toBeVisible();
      await expect(page.locator('input[aria-label="Test Mode Sandbox Email Override"]')).toHaveValue(/mgan@pingconmarketing\.com/i);
      await expect(page.locator('input[aria-label="Matrix Auto-Send Time (Asia/Manila HH:mm)"]')).toHaveValue('13:00');
      await expect(page.locator('input[aria-label="Follow-Up Auto-Send Time (Asia/Manila HH:mm)"]')).toHaveValue('08:00');
      await expect(page.locator('input[aria-label="Auto Daily Matrix Email Enabled"]')).toBeVisible();
      await expect(page.locator('input[aria-label="Auto Daily Follow-Up Enabled"]')).toBeVisible();
      await expect(page.locator('input[aria-label="Customer Hub Default Follow-Up Enabled"]')).toBeVisible();

      const settingsTestToggle = page
        .locator('div:has(> div > h2:has-text("Simulation / Test Mode Toggle"))')
        .locator('..')
        .locator('button')
        .filter({ hasText: /Test Mode:/i })
        .first();
      const wasTestOn = /Test Mode:\s*ON/i.test(await settingsTestToggle.innerText());
      await settingsTestToggle.click();
      await page.waitForTimeout(250);
      await settingsTestToggle.click();
      await expect(settingsTestToggle).toContainText(wasTestOn ? /Test Mode:\s*ON/i : /Test Mode:\s*OFF/i);

      const testConnBtn = page.getByRole('button', { name: /Test Connection/i }).first();
      await expect(testConnBtn).toBeVisible({ timeout: 30_000 });
      await testConnBtn.click();
      await page.waitForTimeout(800);

      const smtpBtn = page.getByRole('button', { name: /Test SMTP Credentials/i });
      await expect(smtpBtn).toBeVisible();
      await smtpBtn.click();
      await expect(smtpBtn).toContainText(/Test SMTP Credentials/i, { timeout: 15_000 });

      const poTestBtn = page.getByRole('button', { name: /Test Connection/i }).last();
      if (await poTestBtn.isVisible().catch(() => false)) {
        await poTestBtn.click();
        await expect(poTestBtn).toContainText(/Test Connection/i, { timeout: 15_000 });
      }

      const ccInput = page.locator('input[placeholder*="cc" i], input[placeholder*="Add CC" i]').first();
      if (await ccInput.isVisible().catch(() => false)) {
        await ccInput.fill('pw-temp-cc@pingcon.local');
        await page.getByRole('button', { name: /Add CC/i }).first().click();
        await expect(page.getByText('pw-temp-cc@pingcon.local', { exact: true }).first()).toBeVisible();
        const tempChip = page.locator('button[title="Remove pw-temp-cc@pingcon.local"]').first();
        if (await tempChip.isVisible().catch(() => false)) {
          await tempChip.click();
          await expect(page.getByText('pw-temp-cc@pingcon.local', { exact: true })).toBeHidden();
        }
        await page.getByRole('button', { name: /Save Recipients/i }).first().click();
        await page.waitForTimeout(400);
      }

      // Per-Email Recipient Manager & Auto Daily Overall Matrix Config + Adjustable Schedules persistence verification
      await expect(page.getByText('Per-Email Recipient Manager')).toBeVisible();
      await page.getByRole('button', { name: /Driver Pickup — Debit Claim/i }).first().click();
      await expect(page.locator('[data-email-recipients-editor="pickup_debit_claim"]')).toBeVisible();
      await page.getByRole('button', { name: /Manual Overall Matrix Email/i }).first().click();
      const manualMatrixEditor = page.locator('[data-email-recipients-editor="manual_matrix"]');
      await expect(manualMatrixEditor).toBeVisible();
      await manualMatrixEditor.locator('input[placeholder*="Add Primary TO email"]').fill('pw-matrix-to@pingconmarketing.com');
      await manualMatrixEditor.getByRole('button', { name: /Add TO/i }).click();
      await expect(manualMatrixEditor.getByText('pw-matrix-to@pingconmarketing.com')).toBeVisible();
      await manualMatrixEditor.locator('button[title="Remove TO pw-matrix-to@pingconmarketing.com"]').click();
      await expect(manualMatrixEditor.getByText('pw-matrix-to@pingconmarketing.com')).toBeHidden();
      await manualMatrixEditor.locator('input[placeholder*="Add CC email"]').fill('pw-matrix-cc@pingconmarketing.com');
      await manualMatrixEditor.getByRole('button', { name: /Add CC/i }).click();
      await expect(manualMatrixEditor.getByText('pw-matrix-cc@pingconmarketing.com')).toBeVisible();
      await manualMatrixEditor.locator('button[title="Remove pw-matrix-cc@pingconmarketing.com"]').click();
      await expect(manualMatrixEditor.getByText('pw-matrix-cc@pingconmarketing.com')).toBeHidden();
      await manualMatrixEditor.getByRole('button', { name: /Save Recipients/i }).click();
      await expect(manualMatrixEditor.getByText(/Recipients saved & synced to cloud/i)).toBeVisible({ timeout: 10_000 });

      await page.getByRole('button', { name: /Sync Recipients Between Auto & Manual/i }).first().click();
      await expect(page.getByText(/Synced TO & CC recipients between Auto Daily .* Matrix and Manual Matrix/i)).toBeVisible();

      // Update Auto-Send Time (Matrix & Follow-Up) + Custom Date Range, save, reload to assert persistence, then restore defaults
      const matrixTimeInput = page.locator('input[aria-label="Matrix Auto-Send Time (Asia/Manila HH:mm)"]');
      const followUpTimeInput = page.locator('input[aria-label="Follow-Up Auto-Send Time (Asia/Manila HH:mm)"]');
      await matrixTimeInput.fill('14:30');
      await followUpTimeInput.fill('09:15');
      await page.getByRole('button', { name: /Custom Date Range/i }).click();
      await page.getByRole('button', { name: /Save Matrix Config/i }).click();
      await expect(page.getByText(/Overall Matrix schedule, date range & scope saved/i)).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: /Save Follow-Up (?:SLA|Time)/i }).click();
      await expect(page.getByText(/10-Day Pickup Follow-Up schedule .* saved to cloud/i)).toBeVisible({ timeout: 15_000 });

      await expect(page.getByRole('button', { name: /Check Email \.xlsx Replies/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Supplier (?:Emails )?Directory/i }).first()).toBeVisible();

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Pingcon RMA Operations')).toBeVisible({ timeout: 45_000 });
      await page.getByRole('button', { name: /Settings & SMTP/i }).click();
      await expect(page.locator('input[aria-label="Matrix Auto-Send Time (Asia/Manila HH:mm)"]')).toHaveValue('14:30');
      await expect(page.locator('input[aria-label="Follow-Up Auto-Send Time (Asia/Manila HH:mm)"]')).toHaveValue('09:15');

      // Restore clean corporate default schedules & Rolling Days
      await page.locator('input[aria-label="Matrix Auto-Send Time (Asia/Manila HH:mm)"]').fill('13:00');
      await page.locator('input[aria-label="Follow-Up Auto-Send Time (Asia/Manila HH:mm)"]').fill('08:00');
      await page.getByRole('button', { name: /Rolling Days/i }).click();
      await page.getByRole('button', { name: /Save Matrix Config/i }).click();
      await expect(page.getByText(/Overall Matrix schedule, date range & scope saved/i)).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: /Save Follow-Up (?:SLA|Time)/i }).click();
      await expect(page.getByText(/10-Day Pickup Follow-Up schedule .* saved to cloud/i)).toBeVisible({ timeout: 15_000 });

      await expect(page.getByRole('button', { name: /Check Email \.xlsx Replies/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Supplier (?:Emails )?Directory/i }).first()).toBeVisible();

      await page.getByRole('button', { name: /View & Download Poster/i }).click();
      await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Close', exact: true }).click();

      await page.getByRole('button', { name: /Manage Locations/i }).click();
      const locModal = page.locator('div.fixed', { hasText: 'Warehouse Locations & Areas' });
      await expect(locModal).toBeVisible();
      await locModal.locator('input[placeholder*="Bin Rack" i]').fill('PW-SETTINGS-RACK');
      await locModal.getByRole('button', { name: 'Add', exact: true }).click();
      const locRow = locModal.locator('div:has(> div > span:text-is("PW-SETTINGS-RACK"))').first();
      await expect(locRow).toBeVisible();
      await locRow.locator('button[title="Rename location"]').click();
      const renameInput = locModal.locator('input.font-mono.border-indigo-500').first();
      await renameInput.fill('PW-SETTINGS-RACK-2');
      await renameInput.locator('..').locator('button').first().click();
      const locRow2 = locModal.locator('div:has(> div > span:text-is("PW-SETTINGS-RACK-2"))').first();
      await expect(locRow2).toBeVisible();
      await locRow2.locator('button[title="Delete location"]').click();
      await expect(locRow2).toBeHidden();
      await locModal.locator('div:has(> div > div > h3:has-text("Warehouse Locations & Areas")) > button').click();
      await expect(locModal).toBeHidden();

      // Verify Known Warehouse / Dock GPS Anchors card & Pingcon Warehouse Google Maps Place/Pin URL
      const gpsAnchorsCard = page.getByTestId('known-gps-anchors-card');
      await expect(gpsAnchorsCard).toBeVisible();
      await expect(gpsAnchorsCard.locator('input[value="Pingcon Warehouse"]')).toBeVisible();
      await expect(gpsAnchorsCard.locator('input[value="64 Mendez Rd, Baesa, Quezon City, Metro Manila 1106"]')).toBeVisible();
      const mapPinHref = await gpsAnchorsCard.getByRole('link', { name: /Verify Map Pin/i }).first().getAttribute('href');
      expect(mapPinHref).toContain('google.com/maps/place/');
      expect(mapPinHref).toContain('@14.6683,121.0114,18z');

      // Verify /docs link visible in API Keys Management section & API Key Generate/Rotate/Revoke
      await expect(page.locator('a[href*="/docs"]').first()).toBeVisible();
      const refreshKeysBtn = page.getByRole('button', { name: 'Refresh', exact: true });
      await expect(refreshKeysBtn).toBeEnabled({ timeout: 25_000 });
      await refreshKeysBtn.click();

      await page.getByRole('button', { name: /Generate New Key/i }).click();
      await expect(page.getByText('Issue New API Key')).toBeVisible();
      await page.getByRole('button', { name: 'Generate Key', exact: true }).click();
      await expect(page.getByText('API Key Generated Successfully')).toBeVisible({ timeout: 25_000 });

      const createdMaskedKey = (await page.locator('div:has-text("Masked representation:") code').last().innerText()).trim();
      trackedMaskedKeys.add(createdMaskedKey);
      await page.getByRole('button', { name: /^Copy$/i }).click();
      await page.getByRole('button', { name: /I have saved this key safely/i }).click();

      const createdKeyRow = page.locator('tr', { hasText: createdMaskedKey }).first();
      await expect(createdKeyRow).toBeVisible({ timeout: 25_000 });
      await createdKeyRow.locator('button[title="Rotate API Key (Invalidate current and create new)"]').click();
      await expect(page.getByText('API Key Rotated Successfully')).toBeVisible({ timeout: 25_000 });

      const rotatedMaskedKey = (await page.locator('div:has-text("Masked representation:") code').last().innerText()).trim();
      trackedMaskedKeys.delete(createdMaskedKey);
      trackedMaskedKeys.add(rotatedMaskedKey);
      await page.getByRole('button', { name: /^Copy$/i }).click();
      await page.getByRole('button', { name: /I have saved this key safely/i }).click();

      const rotatedKeyRow = page.locator('tr', { hasText: rotatedMaskedKey }).first();
      await expect(rotatedKeyRow).toBeVisible({ timeout: 25_000 });
      await rotatedKeyRow.locator('button[title="Revoke and Delete API Key"]').click();
      await expect(rotatedKeyRow).toBeHidden({ timeout: 25_000 });
      trackedMaskedKeys.delete(rotatedMaskedKey);

      guard.assertClean('suite 05 settings, SMTP, locations & API key vault');
    } finally {
      const { readSupabasePublicEnv } = await import('./helpers/testUtils.js');
      const { supaUrl, anonKey } = readSupabasePublicEnv();
      await page
        .evaluate(async ({ masks, url, key }) => {
          try {
            const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
            const token = supaKey ? JSON.parse(localStorage.getItem(supaKey))?.access_token : null;
            if (url && key && token) {
              const hdrs = { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
              for (const m of masks) {
                await fetch(`${url}/rest/v1/api_keys?masked_key=eq.${encodeURIComponent(m)}`, {
                  method: 'DELETE',
                  headers: hdrs
                });
              }
              const sRes = await fetch(`${url}/rest/v1/rma_settings?key=in.(daily_matrix_config,daily_followup_config)&select=key,value`, { headers: hdrs });
              if (sRes.ok) {
                const rows = await sRes.json();
                for (const row of rows || []) {
                  if (row.key === 'daily_matrix_config' && row.value) {
                    await fetch(`${url}/rest/v1/rma_settings?key=eq.daily_matrix_config`, {
                      method: 'PATCH',
                      headers: hdrs,
                      body: JSON.stringify({ value: { ...row.value, autoSendTimePht: '13:00', rangeMode: 'rolling' } })
                    });
                  }
                  if (row.key === 'daily_followup_config' && row.value) {
                    await fetch(`${url}/rest/v1/rma_settings?key=eq.daily_followup_config`, {
                      method: 'PATCH',
                      headers: hdrs,
                      body: JSON.stringify({ value: { ...row.value, autoSendTimePht: '08:00' } })
                    });
                  }
                }
              }
            }
          } catch { }
        }, { masks: Array.from(trackedMaskedKeys), url: supaUrl, key: anonKey })
        .catch(() => { });
      page.off('dialog', onDialog);
      guard.detach();
    }
  });
});
