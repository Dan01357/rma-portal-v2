import { test, expect } from '@playwright/test';
import {
  PNG_BUFFER,
  VERIFIED_BARCODE,
  attachStrictGuards,
  installPrintStubs,
  interceptAndCaptureEmails,
  isoDateDaysOffset,
  gotoAdmin
} from './helpers/testUtils.js';

test.describe('Suite 01: Public Intake, Gatekeeper Lock, Test Mode Validation & QR Sticker', () => {
  test('unauthenticated visitors see Gatekeeper Lock on / and Email OTP Login on /admin', async ({
    browser
  }) => {
    const cleanContext = await browser.newContext({
      ignoreHTTPSErrors: true,
      storageState: { cookies: [], origins: [] }
    });
    await installPrintStubs(cleanContext);
    const page = await cleanContext.newPage();
    const guard = attachStrictGuards(page);

    try {
      // 1. Public root & /intake without invite token show Protected Portal Gatekeeper lock and zero admin controls
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Protected Portal')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Authorization Required')).toBeVisible();
      await expect(page.getByRole('button', { name: /Admin Portal/i })).toBeHidden();

      await page.goto('/intake', { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Authorization Required')).toBeVisible({ timeout: 15_000 });

      // 2. Visiting /admin without session opens AdminLoginModal OTP form and rejects non-company emails
      await page.goto('/admin', { waitUntil: 'domcontentloaded' });
      const sendOtpBtn = page.getByRole('button', { name: /Send OTP Verification Code/i });
      await expect(sendOtpBtn).toBeVisible({ timeout: 15_000 });
      const emailField = page.locator('input[type="email"]').first();
      await emailField.fill('unauthorized@gmail.com');
      await sendOtpBtn.click();
      await expect(page.getByText(/company email|restricted|keysys|pingcon|a2z2go/i).first()).toBeVisible({ timeout: 8_000 });

      guard.assertClean('unauthenticated gatekeeper & admin OTP check');
    } finally {
      guard.detach();
      await cleanContext.close();
    }
  });

  test('authenticated Super Admin public intake: Test Mode mandatory validation, expiry rules, scanner, barcode lookup, unlabeled item, multi-item manifest, submit & QR print/PNG', async ({
    page,
    context
  }) => {
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);
    await interceptAndCaptureEmails(page);
    let createdRmaNumber = null;

    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.getByText(/Scan Product Barcode or RMA Sticker QR/i)).toBeVisible({
        timeout: 20_000
      });

      // 1. Test Mode Switch on Super Admin panel (live <-> test)
      const toggleBtn = page.locator('button[title="Toggle Test / Sandbox Mode"]');
      await expect(toggleBtn).toBeVisible();

      const initiallyOn = /Test Mode:\s*ON/i.test(await toggleBtn.innerText());
      if (initiallyOn) {
        await toggleBtn.click();
        await expect(page.getByText('🟢 Live Delivery Mode Active')).toBeVisible();
      } else {
        await expect(page.getByText('🟢 Live Delivery Mode Active')).toBeVisible();
      }

      // 2. Customer Inbound vs Supplier RTV expiration & Section 3 labels in LIVE Mode
      await page.getByRole('button', { name: /Customer RMA Hub/i }).click();
      await expect(page.getByText('3. Company / Store Name (Optional)')).toBeVisible();
      const expiryInput = page.locator('input[type="date"]').first();
      await expect(expiryInput).not.toHaveAttribute('required', /.*/);
      await expect(page.getByText('Optional', { exact: true }).first()).toBeVisible();

      await page.getByRole('button', { name: /Supplier RTV Hub/i }).click();
      await expect(page.getByText('3. Supplier Name (Optional)')).toBeVisible();
      await expect(expiryInput).toHaveAttribute('required', '');
      await expect(page.getByText('Required *', { exact: true }).first()).toBeVisible();

      // 3. Enforce strict mandatory expiration validation in TEST Mode too (zero optional bypass) & mgan@a2z2go.net sandbox notice
      await toggleBtn.click();
      await expect(page.getByText('🧪 Super Admin Sandbox Active')).toBeVisible();
      await expect(page.getByText(/mgan@a2z2go\.net/)).toBeVisible();
      await expect(toggleBtn).toContainText(/Test Mode:\s*ON/i);
      await expect(expiryInput).toHaveAttribute('required', '');

      // 4. Open & Close Camera ScannerModal genuinely
      await page.getByRole('button', { name: /Scan Product Barcode or RMA Sticker QR/i }).click();
      await expect(page.getByText('Product & RMA QR Scanner')).toBeVisible();
      await page.locator('button[aria-label="Close scanner"]').click();
      await expect(page.getByText('Product & RMA QR Scanner')).toBeHidden();

      // 5. Test "Missing Barcode / Unlabeled Item" button + Cancel + Re-enable + photo + manifest add Blocked without Expiry
      const missingBtn = page.getByRole('button', {
        name: /Missing Barcode \/ Unlabeled Item\? Click here to report/i
      });
      await missingBtn.click();
      await expect(page.getByText('Missing Barcode Tracking Tag Assigned')).toBeVisible();
      const barcodeField = page.locator('input[placeholder*="Barcode" i], input[placeholder*="barcode" i]').first();
      await expect(barcodeField).toHaveValue(/^NO-LABEL-/);

      // Click Cancel and re-enable to test both paths
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByText('Missing Barcode Tracking Tag Assigned')).toBeHidden();
      await missingBtn.click();
      await expect(barcodeField).toHaveValue(/^NO-LABEL-/);

      const descField = page.locator(
        'input[placeholder*="Oishi"], input[placeholder*="identif"]'
      ).first();
      await descField.fill('Playwright Unlabeled Item (Test)');

      // Attach photo proof
      await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({
        name: 'pw-unlabeled.png',
        mimeType: 'image/png',
        buffer: PNG_BUFFER
      });
      await expect(page.getByText('1/10 photos')).toBeVisible();

      // Clicking "+ Add Another Item to Return" WITHOUT expiry in Supplier RTV Test Mode MUST be blocked!
      await page.getByRole('button', { name: /\+ Add Another Item to Return/i }).click();
      await expect(
        page.getByText(/Product expiration date is required for Supplier RTV items/i)
      ).toBeVisible();

      // Now fill mandatory expiration date and add unlabeled item to manifest
      await expiryInput.fill(isoDateDaysOffset(45));
      await page.getByRole('button', { name: /\+ Add Another Item to Return/i }).click();
      await expect(page.getByText(/Queued Return Manifest \(1 Item\)/i)).toBeVisible();

      // 6. Barcode lookup for verified catalog SKU + add second item + test removing 1 item from manifest
      await page.getByRole('button', { name: /Customer RMA Hub/i }).click();
      const nextBarcodeField = page.locator('input[placeholder*="barcode" i]').first();
      await nextBarcodeField.fill(VERIFIED_BARCODE);
      await expect(page.getByText('Recognized Product')).toBeVisible({ timeout: 12_000 });
      await expect(page.getByText(/SS1319P/).first()).toBeVisible();

      // Increase & decrease quantity stepper
      await page.locator('button[title="Increase quantity (+1)"]').click();
      await page.locator('button[title="Decrease quantity (-1)"]').click();

      await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({
        name: 'pw-catalog.png',
        mimeType: 'image/png',
        buffer: PNG_BUFFER
      });
      await page.getByRole('button', { name: /\+ Add Another Item to Return/i }).click();
      await expect(page.getByText(/Queued Return Manifest \(2 Items\)/i)).toBeVisible();

      // Remove the first (unlabeled) manifest item, keeping the catalogued item
      await page.locator('button[title="Remove this item from return manifest"]').first().click();
      await expect(page.getByText(/Queued Return Manifest \(1 Item\)/i)).toBeVisible();

      // 7. Fill reporter details & Submit Return Report (strictly in Test Mode Sandbox!)
      await expect(page.getByText('🧪 Super Admin Sandbox Active')).toBeVisible();
      await page.locator('input[placeholder="Your Full Name *"]').fill('Playwright Public Tester');
      await page.locator('input[placeholder="Phone No. or Email *"]').fill('playwright-test@pingcon.local');

      await page.getByRole('button', { name: /Submit Return Manifest/i }).click();

      // 8. Verify Success Screen & Box Sticker
      await expect(page.getByText('Box Sticker Ready')).toBeVisible({ timeout: 20_000 });
      const rmaText = await page.locator('.font-mono.font-black.text-slate-900, .font-mono.font-black.dark\\:text-white').filter({ hasText: /^RMA-TEST-/ }).first().innerText();
      createdRmaNumber = rmaText.trim();
      expect(createdRmaNumber).toMatch(/^RMA-TEST-/);

      // Download sticker PNG directly from success screen
      const [directPngDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Save Sticker \(PNG\)/i }).click()
      ]);
      expect(directPngDownload.suggestedFilename()).toContain('.png');

      // Open ReturnQRModal ("Resize / Print Sticker") & exercise every preset (incl. Half Letter, zero A4) + download + Print button
      await page.getByRole('button', { name: /Resize \/ Print Sticker/i }).click();
      await expect(page.getByText('Print RMA Sticker Label')).toBeVisible();

      await page.getByRole('button', { name: /Small \(Tuna Can\)/i }).click();
      await page.getByRole('button', { name: /Large \(Carton\)/i }).click();
      await page.getByRole('button', { name: /Extra Large \(Half Letter\)/i }).click();
      await page.getByRole('button', { name: /Medium \(Inner Box\)/i }).click();
      const modalText = await page.locator('div.fixed', { hasText: 'Print RMA Sticker Label' }).innerText();
      expect(modalText).not.toMatch(/\bA4\b/);

      const [qrPngDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Save QR PNG/i }).click()
      ]);
      expect(qrPngDownload.suggestedFilename()).toContain('.png');

      const [stickerPngDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Save Sticker PNG/i }).click()
      ]);
      expect(stickerPngDownload.suggestedFilename()).toContain('.png');

      const printsBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await page.getByRole('button', { name: /Print Sticker \(/i }).click();
      await page.waitForTimeout(350);
      const printsAfter = await page.evaluate(() => window.__pwPrintCount || 0);
      expect(printsAfter).toBeGreaterThan(printsBefore);
      const printedHtmls = await page.evaluate(() => window.__pwPrintHtmls || []);
      const lastPrint = printedHtmls[printedHtmls.length - 1] || '';
      expect(lastPrint.toLowerCase()).not.toContain('size: a4');

      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(page.getByText('Print RMA Sticker Label')).toBeHidden();

      // Click Report Another
      await page.getByRole('button', { name: /Report Another/i }).click();
      await expect(page.getByRole('button', { name: /Submit Return Report/i })).toBeVisible();

      // Allow any async background save/upload on the test submission to settle cleanly
      await page.waitForLoadState('networkidle').catch(() => {});

      // Clean up synthetic Playwright submission via Sandbox Trash -> Permanent Delete so Sandbox stays clean
      if (createdRmaNumber) {
        await gotoAdmin(page);
        await page.getByRole('button', { name: /Test Mode Sandbox/i }).click();
        const searchBox = page.locator('input[placeholder*="Search" i]').first();
        if (await searchBox.isVisible().catch(() => false)) {
          await searchBox.fill(createdRmaNumber);
        }
        const row = page.locator('tr', { hasText: createdRmaNumber }).first();
        if (await row.isVisible({ timeout: 5000 }).catch(() => false)) {
          const trashBtn = row.locator('button[title*="Delete" i], button[title*="Trash" i]').first();
          if (await trashBtn.isVisible().catch(() => false)) {
            await trashBtn.click();
            await page.getByRole('button', { name: /Move to Trash/i }).click();
            await expect(page.getByText(/Move to Trash \(30-Day Recovery\)\?/i)).toBeHidden({ timeout: 15_000 });
            await page.getByRole('button', { name: /Archive & Trash/i }).click();
            const onConfirm = async (dialog) => {
              await dialog.accept();
            };
            page.once('dialog', onConfirm);
            await page.getByRole('button', { name: /Trash Bin/i }).click();
            const trashedRow = page.locator('tr', { hasText: createdRmaNumber }).first();
            await expect(trashedRow).toBeVisible({ timeout: 10_000 });
            const delWait = page
              .waitForResponse(
                (res) => res.url().includes('/rest/v1/rma_reports') && res.request().method() === 'DELETE',
                { timeout: 20_000 }
              )
              .catch(() => null);
            await trashedRow
              .locator('button[title="Permanently destroy this record forever"]')
              .first()
              .click();
            await expect(trashedRow).toBeHidden({ timeout: 15_000 });
            await delWait;
            await page.waitForLoadState('networkidle').catch(() => {});
          }
        }
      }

      guard.assertClean('suite 01 public intake');
    } finally {
      guard.detach();
    }
  });
});
