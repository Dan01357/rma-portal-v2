import { test, expect } from '@playwright/test';
import {
  PNG_BUFFER,
  VERIFIED_BARCODE,
  attachStrictGuards,
  installPrintStubs,
  interceptAndCaptureEmails,
  mockPhotoUploadSuccess,
  isoDateDaysOffset,
  setPublicPortalTestMode,
  assertValidXlsxFile,
  seedTestModeRma,
  gotoAdmin,
  cleanupTestRecords
} from './helpers/testUtils.js';

/**
 * Seeds a 2-item Multi-Item Manifest RMA in Test Mode Customer Hub
 * so the expandable Manifest Drawer, child photo/SKU/CM controls, and manifest XLSX are tested.
 */
async function seedTestModeManifestCustomerRma(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/Scan Product Barcode or RMA Sticker QR/i)).toBeVisible({
    timeout: 20_000
  });
  await setPublicPortalTestMode(page, true);
  await page.getByRole('button', { name: /Customer RMA Hub/i }).click();

  // Item 1: Cataloged SKU
  await page.locator('input[placeholder*="barcode" i]').first().fill(VERIFIED_BARCODE);
  await expect(page.getByText('Recognized Product')).toBeVisible({ timeout: 45_000 });
  const fileInput = page.locator('input[type="file"][accept="image/*"]').first();
  await fileInput.setInputFiles({ name: 'pw-mf-1.png', mimeType: 'image/png', buffer: PNG_BUFFER });
  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({ name: 'pw-mf-1b.png', mimeType: 'image/png', buffer: PNG_BUFFER });
  await expect(page.getByText('2/10 photos')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /\+ Add Another Item to Return/i }).click();
  await expect(page.getByText(/Queued Return Manifest \(1 Item\)/i)).toBeVisible();

  // Item 2: Unlabeled item without SKU (tests child Assign SKU button in drawer)
  await page.getByRole('button', { name: /Missing Barcode \/ Unlabeled Item\? Click here to report/i }).click();
  await page.locator('input[placeholder*="Oishi"], input[placeholder*="identif"]').first().fill('Playwright Manifest Child 2');
  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({
    name: 'pw-mf-2.png',
    mimeType: 'image/png',
    buffer: PNG_BUFFER
  });
  await page.getByRole('button', { name: /\+ Add Another Item to Return/i }).click();
  await expect(page.getByText(/Queued Return Manifest \(2 Items\)/i)).toBeVisible();

  await page.locator('input[placeholder="Your Full Name *"]').fill('Playwright Manifest Seeder');
  await page.locator('input[placeholder="Phone No. or Email *"]').fill('playwright-mf@pingcon.local');

  const submitPostPromise = page.waitForResponse(
    (res) => res.url().includes('/rest/v1/rma_reports') && res.request().method() === 'POST',
    { timeout: 60_000 }
  );
  await page.getByRole('button', { name: /Submit Return Manifest/i }).click();
  await expect(page.getByText('Printable QR Ready')).toBeVisible({ timeout: 20_000 });
  expect((await submitPostPromise).status()).toBeLessThan(400);

  const rmaText = await page
    .locator('.font-mono.font-black.text-slate-900, .font-mono.font-black.dark\\:text-white')
    .filter({ hasText: /^RMA-TEST-/ })
    .first()
    .innerText();
  const rmaNumber = rmaText.trim();
  await page.waitForLoadState('networkidle').catch(() => { });
  return rmaNumber;
}

async function assertZeroDeprecatedWidgets(page, scopeLabel) {
  await expect(page.locator('button[title*="Thermal Box Label" i]'), `${scopeLabel}: Thermal`).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Driver QR Widget/i }), `${scopeLabel}: Driver QR`).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Buffer Stock Replacement/i }), `${scopeLabel}: Buffer Slip`).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Vendor RTV Gate Pass/i }), `${scopeLabel}: Vendor Gate Pass`).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Rejected Return Gate Pass/i }), `${scopeLabel}: Rejected Gate Pass`).toHaveCount(0);
  await expect(page.getByRole('button', { name: /\+ Debit Claim/i }), `${scopeLabel}: + Debit Claim`).toHaveCount(0);
  await expect(page.getByText(/Supplier Debit Claim Voucher/i), `${scopeLabel}: Debit Voucher`).toHaveCount(0);
}

test.describe('Suite 03: Customer Hub, Supplier RTV Hub, Test Mode Sandbox, Manifest Drawer, Queues & Archive/Trash', () => {
  test('exercises all toolbars, deprecated widget removals, Full Audit Log, Matrix/XLSX exports, Manifest drawer, WMS/PO confirm + Reset to Pending, Archive & 30-Day Trash restore/destroy', async ({
    page,
    context
  }) => {
    test.setTimeout(180_000);
    await context.grantPermissions(['camera', 'clipboard-read', 'clipboard-write']).catch(() => { });
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);
    await interceptAndCaptureEmails(page);
    await mockPhotoUploadSuccess(page);

    let seededManifestRma = null;
    let seededSupplierRma = null;

    try {
      seededManifestRma = await seedTestModeManifestCustomerRma(page);
      seededSupplierRma = await seedTestModeRma(page, {
        stream: 'supplier',
        photoCount: 1,
        expiryDays: 60,
        supplierOrCompany: 'Monde Nissin Corp'
      });

      await gotoAdmin(page);

      // =========================================================================
      // PART A: LIVE CUSTOMER RMA HUB
      // =========================================================================
      await page.getByRole('button', { name: /Customer RMA Hub/i }).click();
      await expect(page.getByRole('button', { name: /Full Audit Log/i })).toBeVisible();
      await assertZeroDeprecatedWidgets(page, 'Live Customer Hub');

      await page.getByRole('button', { name: /Ready to Restock/i }).click();
      await page.getByRole('button', { name: /Supplier Re-Order/i }).click();
      await page.getByRole('button', { name: /No Re-Order \/ Write-Off/i }).click();
      await page.getByRole('button', { name: /Clear Queue Filter/i }).click();

      await page.getByRole('button', { name: 'Cards', exact: true }).click();
      await page.getByRole('button', { name: /Rows List/i }).click();

      // Full Audit Log (RMAReportsModal) -> Cards View, Rows List, Reset, Export Excel (.xlsx), Close
      await page.getByRole('button', { name: /Full Audit Log/i }).click();
      await expect(page.getByText(/Logged RMA Return Reports/i)).toBeVisible();
      await page.getByRole('button', { name: /Cards View/i }).click();
      await page.getByRole('button', { name: /Rows List/i }).last().click();
      const [liveAuditXlsx] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('button[title="Export filtered reports to Excel (.xlsx)"]').click()
      ]);
      assertValidXlsxFile(liveAuditXlsx, await liveAuditXlsx.path());
      await page
        .locator('div:has(> button[title="Export filtered reports to Excel (.xlsx)"]) > button')
        .last()
        .click();
      await expect(page.getByText(/Logged RMA Return Reports/i)).toBeHidden();

      // Overall RMA Matrix (.xlsx)
      await page.getByRole('button', { name: /Overall RMA Matrix \(\.xlsx\)/i }).click();
      await page.getByRole('button', { name: /Last 14 Days/i }).click();
      const [liveCustMatrix] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Download Excel Matrix \(\.xlsx\)/i }).click()
      ]);
      assertValidXlsxFile(liveCustMatrix, await liveCustMatrix.path());
      expect(liveCustMatrix.suggestedFilename()).toMatch(
        /^Overall_RMA_Matrix_Report_\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2} \d{4}\.xlsx$/
      );
      await page.getByRole('button', { name: 'Close', exact: true }).click();

      // Export Inbound (.xlsx)
      const hasLiveCustomerRows = (await page.locator('tbody tr').count()) > 0;
      if (hasLiveCustomerRows) {
        const [liveCustXlsx] = await Promise.all([
          page.waitForEvent('download'),
          page.getByRole('button', { name: /Export Inbound \(\.xlsx\)/i }).click()
        ]);
        assertValidXlsxFile(liveCustXlsx, await liveCustXlsx.path());
      } else {
        let alertMsg = '';
        page.once('dialog', async (dialog) => {
          alertMsg = dialog.message();
          await dialog.accept();
        });
        await page.getByRole('button', { name: /Export Inbound \(\.xlsx\)/i }).click();
        expect(alertMsg).toContain('No customer return reports available');
      }

      // Filters & Reset in Live Customer Hub
      const custSearch = page.locator('input[placeholder*="Search" i]').first();
      await custSearch.fill('SS1319P');
      const custSelects = page.locator('select');
      for (let i = 0; i < (await custSelects.count()); i++) {
        const sel = custSelects.nth(i);
        if ((await sel.locator('option').count()) > 1) {
          await sel.selectOption({ index: 1 });
        }
      }
      const custReset = page.getByRole('button', { name: 'Reset', exact: true }).first();
      if (await custReset.isVisible().catch(() => false)) {
        await custReset.click();
      }

      // =========================================================================
      // PART B: LIVE SUPPLIER HUB (RTV CLAIMS) — NO DEPRECATED WIDGETS
      // =========================================================================
      await page.getByRole('button', { name: /Supplier Hub \(RTV Claims\)/i }).click();
      await expect(page.getByRole('button', { name: /Export Supplier Claims \(\.xlsx\)/i })).toBeVisible();
      await assertZeroDeprecatedWidgets(page, 'Live Supplier RTV Hub');

      await page.getByRole('button', { name: /Ready to Restock/i }).click();
      await page.getByRole('button', { name: /Supplier Re-Order/i }).click();
      await page.getByRole('button', { name: /No Re-Order \/ Write-Off/i }).click();
      await page.getByRole('button', { name: /Clear Queue Filter/i }).click();

      const suppSelects = page.locator('select');
      for (let i = 0; i < (await suppSelects.count()); i++) {
        const sel = suppSelects.nth(i);
        if ((await sel.locator('option').count()) > 1) {
          await sel.selectOption({ index: 1 });
        }
      }
      const suppReset = page.getByRole('button', { name: 'Reset', exact: true }).first();
      if (await suppReset.isVisible().catch(() => false)) {
        await suppReset.click();
      }

      await page.getByRole('button', { name: /Overall RMA Matrix \(\.xlsx\)/i }).click();
      await page.getByRole('button', { name: /Last 7 Days/i }).click();
      const [liveSuppMatrix] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Download Excel Matrix \(\.xlsx\)/i }).click()
      ]);
      assertValidXlsxFile(liveSuppMatrix, await liveSuppMatrix.path());
      await page.getByRole('button', { name: 'Close', exact: true }).click();

      const [liveSuppXlsx] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Export Supplier Claims \(\.xlsx\)/i }).click()
      ]);
      assertValidXlsxFile(liveSuppXlsx, await liveSuppXlsx.path());

      // Row QR Quick-View + Photo Lightbox + Pagination on Live Supplier RTV
      const liveQrBtn = page.locator('button[title*="Quick-View & Print Box QR Sticker"]').first();
      if (await liveQrBtn.isVisible().catch(() => false)) {
        await liveQrBtn.click();
        await expect(page.getByText('Print RMA QR Code')).toBeVisible();
        await page.getByRole('button', { name: 'Done', exact: true }).click();
      }
      const livePhotoBtn = page.locator('button[title="Click to view full-size photo"]').first();
      if (await livePhotoBtn.isVisible().catch(() => false)) {
        await livePhotoBtn.click();
        await expect(page.locator('button[title="Close (Esc)"]')).toBeVisible();
        await page.locator('button[title="Close (Esc)"]').click();
      }

      const nextPageBtn = page.getByRole('button', { name: 'Next', exact: true }).first();
      if ((await nextPageBtn.isVisible().catch(() => false)) && (await nextPageBtn.isEnabled().catch(() => false))) {
        await nextPageBtn.click();
        await page.getByRole('button', { name: 'Prev', exact: true }).first().click();
      }

      // =========================================================================
      // PART C: TEST MODE SANDBOX (cURL, Manifest Drawer, Lightbox Next/Prev, WMS Confirm & Reset, Archive)
      // =========================================================================
      await page.getByRole('button', { name: /Test Mode Sandbox/i }).first().click();
      await assertZeroDeprecatedWidgets(page, 'Test Mode Sandbox');

      const showCurlBtn = page.getByRole('button', { name: /Show cURL Guide/i });
      if (await showCurlBtn.isVisible().catch(() => false)) {
        await showCurlBtn.click();
        await page.getByRole('button', { name: /Copy cURL/i }).first().click();
        await page.getByRole('button', { name: /Hide cURL Guide/i }).click();
      }

      // Sandbox Customer RMAs: Multi-Select Consolidated Batch QR Print Studio (2 QRs via Full Audit Log), Manifest Drawer, Lightbox Next/Prev, Bulk Archive
      await page.getByRole('button', { name: /Sandbox Customer RMAs/i }).click();

      // Open Full Audit Log to multi-select BOTH Sandbox Customer + Supplier RMAs for Consolidated QR Print Studio QA
      await page.getByRole('button', { name: /Full Audit Log/i }).first().click();
      const reportsModal = page.locator('div.fixed', { hasText: 'Logged Sandbox Test RMA Reports' });
      await expect(reportsModal).toBeVisible({ timeout: 10_000 });
      const custModalRow = reportsModal.locator('tr', { hasText: seededManifestRma }).first();
      const suppModalRow = reportsModal.locator('tr', { hasText: seededSupplierRma }).first();
      await expect(custModalRow).toBeVisible({ timeout: 10_000 });
      await expect(suppModalRow).toBeVisible({ timeout: 10_000 });
      await custModalRow.locator('input[type="checkbox"]').first().check();
      await suppModalRow.locator('input[type="checkbox"]').first().check();

      await reportsModal.getByRole('button', { name: /Print \/ Save QRs \(2\)/i }).click();
      const multiQrModal = page.locator('div.fixed', { hasText: 'Consolidated QR Print Studio (2 QRs)' });
      await expect(multiQrModal).toBeVisible({ timeout: 10_000 });

      const card1 = multiQrModal.locator(`[data-rma-qr-card="${seededManifestRma}"]`);
      const card2 = multiQrModal.locator(`[data-rma-qr-card="${seededSupplierRma}"]`);
      await expect(card1).toBeVisible();
      await expect(card2).toBeVisible();
      await expect(card1.getByText(/Qty:/i)).toBeVisible();
      await expect(card2.getByText(/Qty:/i)).toBeVisible();
      expect(await card1.innerText()).not.toMatch(/\bSupplier:/i);
      expect(await card2.innerText()).not.toMatch(/\bSupplier:/i);
      await expect(multiQrModal.locator('select[aria-label="Paper Size"]')).toHaveValue('letter');

      // Independent per-QR resize: select card 2 and shrink to Mini (50x58mm), card 1 stays 62x74mm
      await card2.click();
      await multiQrModal.getByRole('button', { name: /Mini/i }).click();
      await expect(card2.getByText('50×58mm')).toBeVisible();
      await expect(card1.getByText('62×74mm')).toBeVisible();

      // Toggle Multiple Pages -> verify multi-page label -> Auto-Fit All to 1 Page -> Save Consolidated Sheet PNG -> Print 2 QRs
      await multiQrModal.getByRole('button', { name: /Multiple Pages/i }).click();
      await expect(multiQrModal.getByRole('button', { name: /Multiple Pages/i })).toBeVisible();
      await multiQrModal.getByRole('button', { name: /Auto-Fit All to 1 Page/i }).click();
      await expect(card1).toBeVisible();
      await expect(card2).toBeVisible();

      const [multiSheetPng] = await Promise.all([
        page.waitForEvent('download'),
        multiQrModal.getByRole('button', { name: /Save QR \(PNG\)/i }).click()
      ]);
      expect(multiSheetPng.suggestedFilename()).toMatch(/2-QRs-letter-Page-1\.png/i);

      const multiPrintBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await multiQrModal.getByRole('button', { name: /Print 2 QRs/i }).click();
      await expect.poll(() => page.evaluate(() => window.__pwPrintCount || 0), { timeout: 10_000 }).toBeGreaterThan(multiPrintBefore);

      await multiQrModal.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(multiQrModal).toBeHidden();
      await reportsModal.locator('button[aria-label="Close Reports Modal"]').click();
      await expect(reportsModal).toBeHidden();

      const sbCustSearch = page.locator('input[placeholder*="Search" i]').first();
      await sbCustSearch.fill(seededManifestRma);
      const sbCustRow = page.locator('tr', { hasText: seededManifestRma }).first();
      await expect(sbCustRow).toBeVisible({ timeout: 10_000 });

      // Expand Manifest (2) drawer & inspect child items + collapse
      const manifestBtn = sbCustRow.getByRole('button', { name: /Manifest \(2\)/i }).first();
      await expect(manifestBtn).toBeVisible();
      await manifestBtn.click();
      await expect(page.getByText('Playwright Manifest Child 2').first()).toBeVisible();
      await manifestBtn.click();

      // Lightbox Prev / Next / Close on 2-photo first manifest item
      await sbCustRow.locator('button[title="Click to view full-size proof photo"]').click();
      await expect(page.locator('button[title="Close (Esc)"]')).toBeVisible();
      const nextImg = page.locator('button[aria-label="Next image"]');
      if (await nextImg.isVisible().catch(() => false)) {
        await nextImg.click();
        await page.locator('button[aria-label="Previous image"]').click();
      }
      await page.locator('button[title="Close (Esc)"]').click();

      // QR Quick-View & Print
      await sbCustRow.locator('button[title*="View & Print Box QR Sticker"]').click();
      await expect(page.getByText('Print RMA QR Code')).toBeVisible();
      const sbQrBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await page.getByRole('button', { name: /Print QR \(/i }).click();
      await expect.poll(() => page.evaluate(() => window.__pwPrintCount || 0), { timeout: 10_000 }).toBeGreaterThan(sbQrBefore);
      await page.getByRole('button', { name: 'Done', exact: true }).click();

      // Bulk select -> Archive Selected
      await sbCustRow.locator('input[type="checkbox"]').first().check();
      await expect(page.getByRole('button', { name: /Print \/ Save QRs \(1\)/i })).toBeVisible();
      await page.getByRole('button', { name: /Archive Selected \(1\)/i }).click();
      await expect(sbCustRow).toBeHidden({ timeout: 30_000 });

      // Sandbox Supplier RTVs -> WMS Restocked confirm + Reset to Pending -> Archive row
      await page.getByRole('button', { name: /Sandbox Supplier RTVs/i }).click();
      await page.locator('input[placeholder*="Search" i]').first().fill(seededSupplierRma);
      const sbSuppRow = page.locator('tr', { hasText: seededSupplierRma }).first();
      await expect(sbSuppRow).toBeVisible({ timeout: 10_000 });

      // Open 4-Choice on Supplier RTV, fill manual Processed By, and save Restock -> test "✓ Confirm Restocked in WMS" & "↩️ Reset to Pending"
      await sbSuppRow.locator('button[title*="Open 4-Choice" i]').first().click();
      await expect(page.getByText('What do you want to do with this item?')).toBeVisible();
      await expect(page.locator('#wizard-processed-by-step1')).toHaveValue('');
      await page.locator('#wizard-processed-by-step1').fill('Playwright Suite 03 Staff');
      await page.getByRole('button', { name: /Put Back on Good Shelf \(Restock\)|Return to Good Stock/i }).first().click();
      await page.getByRole('button', { name: /Confirm & Save/i }).first().click();
      await expect(page.getByRole('button', { name: /^Done$/i })).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: /^Done$/i }).click();

      const confirmRestockBtn = sbSuppRow.getByRole('button', { name: /Confirm Restocked in WMS/i });
      if (await confirmRestockBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await confirmRestockBtn.click();
        const resetPendingBtn = sbSuppRow.getByRole('button', { name: /Reset to Pending/i });
        await expect(resetPendingBtn).toBeVisible({ timeout: 10_000 });
        await resetPendingBtn.click();
        await page.waitForTimeout(400);
      }

      // Archive Sandbox Supplier RTV
      await sbSuppRow.locator(`button[title*="Archive RMA #${seededSupplierRma}"]`).click();
      await expect(sbSuppRow).toBeHidden({ timeout: 15_000 });

      // =========================================================================
      // PART D: ARCHIVE VAULT RESTORE -> 30-DAY TRASH BIN -> PERMANENT DELETE
      // =========================================================================
      await page.getByRole('button', { name: /Archive & Trash/i }).click();
      await page.getByRole('button', { name: /Archive Vault/i }).click();
      await page.getByRole('button', { name: /Live Production/i }).click();
      await page.getByRole('button', { name: /Test Mode Sandbox/i }).last().click();

      const archiveSearch = page.locator('input[placeholder*="Search" i]').first();
      for (const targetRma of [seededManifestRma, seededSupplierRma]) {
        await archiveSearch.fill(targetRma);
        const archRow = page.locator('tr', { hasText: targetRma }).first();
        await expect(archRow).toBeVisible({ timeout: 10_000 });
        await archRow.locator('button[title="Restore item back to active hub"]').click();
        await expect(archRow).toBeHidden({ timeout: 25_000 });
      }

      // Move both restored records to 30-Day Trash & permanently destroy
      await page.getByRole('button', { name: /Test Mode Sandbox/i }).first().click();
      await page.getByRole('button', { name: /Sandbox Customer RMAs/i }).click();
      await page.locator('input[placeholder*="Search" i]').first().fill(seededManifestRma);
      const restoredCustRow = page.locator('tr', { hasText: seededManifestRma }).first();
      await expect(restoredCustRow).toBeVisible({ timeout: 10_000 });
      await restoredCustRow.locator(`button[title*="Move RMA #${seededManifestRma} to 30-Day Trash Bin"]`).click();
      await page.getByRole('button', { name: /Move to Trash/i }).click();
      await expect(page.getByRole('button', { name: /Move to Trash/i })).toBeHidden({ timeout: 25_000 });
      await expect(restoredCustRow).toBeHidden({ timeout: 15_000 });

      await page.getByRole('button', { name: /Sandbox Supplier RTVs/i }).click();
      await page.locator('input[placeholder*="Search" i]').first().fill(seededSupplierRma);
      const restoredSuppRow = page.locator('tr', { hasText: seededSupplierRma }).first();
      await expect(restoredSuppRow).toBeVisible({ timeout: 10_000 });
      await restoredSuppRow.locator(`button[title*="Delete RMA #${seededSupplierRma}"]`).click();
      await page.getByRole('button', { name: /Move to Trash/i }).click();
      await expect(page.getByRole('button', { name: /Move to Trash/i })).toBeHidden({ timeout: 25_000 });
      await expect(restoredSuppRow).toBeHidden({ timeout: 15_000 });

      await page.getByRole('button', { name: /Archive & Trash/i }).click();
      await page.getByRole('button', { name: /Trash Bin/i }).click();
      await expect(page.getByRole('button', { name: /Empty Trash/i })).toBeVisible();

      const onConfirmDialog = async (dialog) => {
        await dialog.accept();
      };
      page.on('dialog', onConfirmDialog);
      try {
        const trashSearch = page.locator('input[placeholder*="Search" i]').first();
        for (const targetRma of [seededManifestRma, seededSupplierRma]) {
          await trashSearch.fill(targetRma);
          const trashedRow = page.locator('tr', { hasText: targetRma }).first();
          await expect(trashedRow).toBeVisible({ timeout: 10_000 });
          await trashedRow.locator('button[title="Permanently destroy this record forever"]').click();
          await expect(trashedRow).toBeHidden({ timeout: 15_000 });
        }
        await page.waitForLoadState('networkidle').catch(() => { });
      } finally {
        page.off('dialog', onConfirmDialog);
      }

      seededManifestRma = null;
      seededSupplierRma = null;
      guard.assertClean('suite 03 hubs, sandbox, manifest drawer, queue confirms & archive/trash');
    } finally {
      await cleanupTestRecords(page, { rmaNumbers: [seededManifestRma, seededSupplierRma] });
      guard.detach();
    }
  });
});
