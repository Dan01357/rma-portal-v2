import { test, expect } from '@playwright/test';
import {
  PNG_BUFFER,
  VERIFIED_BARCODE,
  attachStrictGuards,
  installPrintStubs,
  isoDateDaysOffset,
  gotoAdmin
} from './helpers/testUtils.js';

/**
 * Seeds a Test Mode Sandbox RMA via the public intake page so Live DB stays untouched.
 * Returns the generated RMA number (RMA-TEST-...).
 */
async function seedTestModeRma(page, { stream = 'customer', photoCount = 1, expiryDays = 45 } = {}) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/Scan Product Barcode or RMA Sticker QR/i)).toBeVisible({
    timeout: 20_000
  });

  const toggleBtn = page.locator('button[title="Toggle Test / Sandbox Mode"]');
  await expect(toggleBtn).toBeVisible();
  if (!/Test Mode:\s*ON/i.test(await toggleBtn.innerText())) {
    await toggleBtn.click();
  }
  await expect(page.getByText('🧪 Super Admin Sandbox Active')).toBeVisible();

  if (stream === 'supplier') {
    await page.getByRole('button', { name: /Supplier RTV Hub/i }).click();
  } else {
    await page.getByRole('button', { name: /Customer RMA Hub/i }).click();
  }

  const barcodeField = page.locator('input[placeholder*="barcode" i]').first();
  await barcodeField.fill(VERIFIED_BARCODE);
  await expect(page.getByText('Recognized Product')).toBeVisible({ timeout: 12_000 });

  if (stream === 'supplier') {
    const expiryInput = page.locator('input[type="date"]').first();
    await expiryInput.fill(isoDateDaysOffset(expiryDays));
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

  await page.locator('input[placeholder="Your Full Name *"]').fill('Playwright Hub Seeder');
  await page
    .locator('input[placeholder="Phone No. or Email *"]')
    .fill('playwright-hub@pingcon.local');

  const submitPostPromise = page.waitForResponse(
    (res) => res.url().includes('/rest/v1/rma_reports') && res.request().method() === 'POST',
    { timeout: 25_000 }
  );
  await page.getByRole('button', { name: /Submit Return Report/i }).click();
  await expect(page.getByText('Box Sticker Ready')).toBeVisible({ timeout: 20_000 });
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

test.describe('Suite 03: Customer Hub, Supplier RTV Hub, Test Mode Sandbox, Lightbox & Archive/Trash', () => {
  test('every button in Customer Hub & Supplier RTV Hub (Live + Sandbox), Full Audit Log, Matrix/CSV exports, Lightbox, QR, Thermal 4x6, Archive & 30-Day Trash restore/destroy', async ({
    page,
    context
  }) => {
    test.setTimeout(180_000);
    await context.grantPermissions(['camera', 'clipboard-read', 'clipboard-write']).catch(() => {});
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);

    let seededCustomerRma = null;
    let seededSupplierRma = null;

    try {
      // Seed 1 Customer RMA (2 proof photos for Lightbox Next/Prev) & 1 Supplier RTV (1 proof photo) strictly in Test Mode
      seededCustomerRma = await seedTestModeRma(page, { stream: 'customer', photoCount: 2 });
      seededSupplierRma = await seedTestModeRma(page, { stream: 'supplier', photoCount: 1 });

      await gotoAdmin(page);

      // =========================================================================
      // PART A: LIVE CUSTOMER RMA HUB
      // =========================================================================
      await page.getByRole('button', { name: /Customer RMA Hub/i }).click();
      await expect(page.getByRole('button', { name: /Full Audit Log/i })).toBeVisible();

      // 1. Click all 3 Coworker Queue buttons + Clear Queue Filter
      await page.getByRole('button', { name: /Ready to Restock/i }).click();
      await page.getByRole('button', { name: /Supplier Re-Order/i }).click();
      await page.getByRole('button', { name: /No Re-Order \/ Write-Off/i }).click();
      await page.getByRole('button', { name: /Clear Queue Filter/i }).click();

      // 2. Rows List vs Cards toggle
      await page.getByRole('button', { name: 'Cards', exact: true }).click();
      await page.getByRole('button', { name: /Rows List/i }).click();

      // 3. Full Audit Log modal (RMAReportsModal) -> Cards View / Rows List / Filters / Export CSV / Close
      await page.getByRole('button', { name: /Full Audit Log/i }).click();
      await expect(page.getByText(/Logged RMA Return Reports/i)).toBeVisible();
      await page.getByRole('button', { name: /Cards View/i }).click();
      await page.getByRole('button', { name: /Rows List/i }).last().click();
      const [liveAuditCsv] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('button[title="Export filtered reports to CSV"]').click()
      ]);
      expect(liveAuditCsv.suggestedFilename()).toContain('.csv');
      // Close RMAReportsModal (X button next to Export CSV)
      await page
        .locator('div:has(> button[title="Export filtered reports to CSV"]) > button')
        .last()
        .click();
      await expect(page.getByText(/Logged RMA Return Reports/i)).toBeHidden();

      // 4. Customer Matrix (.xlsx) (RMAMatrixExportModal)
      await page.getByRole('button', { name: /Customer Matrix \(\.xlsx\)/i }).click();
      await page.getByRole('button', { name: /Last 14 Days/i }).click();
      const [liveCustMatrix] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Download Excel Matrix \(\.xlsx\)/i }).click()
      ]);
      expect(liveCustMatrix.suggestedFilename()).toContain('.xlsx');
      await page.getByRole('button', { name: 'Close', exact: true }).click();

      // 5. Export Inbound CSV (downloads CSV when populated, or shows empty-state alert when Live Customer Hub has 0 rows)
      const hasLiveCustomerRows = (await page.locator('tbody tr').count()) > 0;
      if (hasLiveCustomerRows) {
        const [liveCustCsv] = await Promise.all([
          page.waitForEvent('download'),
          page.getByRole('button', { name: /Export Inbound CSV/i }).click()
        ]);
        expect(liveCustCsv.suggestedFilename()).toContain('.csv');
      } else {
        let alertMsg = '';
        page.once('dialog', async (dialog) => {
          alertMsg = dialog.message();
          await dialog.accept();
        });
        await page.getByRole('button', { name: /Export Inbound CSV/i }).click();
        expect(alertMsg).toContain('No customer return reports available');
      }

      // 6. All filter dropdowns + Search + Reset in Live Customer Hub
      const custSearch = page.locator('input[placeholder*="Search" i]').first();
      await custSearch.fill('SS1319P');
      const custSelects = page.locator('select');
      const custSelectCount = await custSelects.count();
      for (let i = 0; i < custSelectCount; i++) {
        const sel = custSelects.nth(i);
        const optCount = await sel.locator('option').count();
        if (optCount > 1) {
          await sel.selectOption({ index: 1 });
        }
      }
      const custReset = page.getByRole('button', { name: 'Reset', exact: true }).first();
      if (await custReset.isVisible().catch(() => false)) {
        await custReset.click();
      }

      // =========================================================================
      // PART B: LIVE SUPPLIER HUB (RTV CLAIMS)
      // =========================================================================
      await page.getByRole('button', { name: /Supplier Hub \(RTV Claims\)/i }).click();
      await expect(page.getByRole('button', { name: /Export Supplier Claims CSV/i })).toBeVisible();

      // 1. Click all 3 Coworker Queue buttons + Clear
      await page.getByRole('button', { name: /Ready to Restock/i }).click();
      await page.getByRole('button', { name: /Supplier Re-Order/i }).click();
      await page.getByRole('button', { name: /No Re-Order \/ Write-Off/i }).click();
      await page.getByRole('button', { name: /Clear Queue Filter/i }).click();

      // 2. Supplier & Triage filters + Search + Reset
      const suppSelects = page.locator('select');
      const suppSelectCount = await suppSelects.count();
      for (let i = 0; i < suppSelectCount; i++) {
        const sel = suppSelects.nth(i);
        if ((await sel.locator('option').count()) > 1) {
          await sel.selectOption({ index: 1 });
        }
      }
      const suppReset = page.getByRole('button', { name: 'Reset', exact: true }).first();
      if (await suppReset.isVisible().catch(() => false)) {
        await suppReset.click();
      }

      // 3. Supplier RTV Matrix (.xlsx)
      await page.getByRole('button', { name: /Supplier RTV Matrix \(\.xlsx\)/i }).click();
      await page.getByRole('button', { name: /Last 7 Days/i }).click();
      const [liveSuppMatrix] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Download Excel Matrix \(\.xlsx\)/i }).click()
      ]);
      expect(liveSuppMatrix.suggestedFilename()).toContain('.xlsx');
      await page.getByRole('button', { name: 'Close', exact: true }).click();

      // 4. Export Supplier Claims CSV
      const [liveSuppCsv] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Export Supplier Claims CSV/i }).click()
      ]);
      expect(liveSuppCsv.suggestedFilename()).toContain('.csv');

      // 5. Select All & Clear selection (without mutating Live DB)
      const selectAllCheckbox = page
        .locator('thead input[type="checkbox"]')
        .first();
      if (await selectAllCheckbox.isVisible().catch(() => false)) {
        await selectAllCheckbox.check();
        const clearSelBtn = page.getByRole('button', { name: /Clear Selection|Deselect/i }).first();
        if (await clearSelBtn.isVisible().catch(() => false)) {
          await clearSelBtn.click();
        } else {
          await selectAllCheckbox.uncheck();
        }
      }

      // 6. Live Supplier Row QR Quick-View & Print + Thermal 4x6 Label & Print + Photo Lightbox + Pagination
      const liveQrBtn = page.locator('button[title*="Quick-View & Print Box QR Sticker"]').first();
      await expect(liveQrBtn).toBeVisible();
      await liveQrBtn.click();
      await expect(page.getByText('Print RMA Sticker Label')).toBeVisible();
      const qrPrintBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await page.getByRole('button', { name: /Print Sticker \(/i }).click();
      await expect
        .poll(() => page.evaluate(() => window.__pwPrintCount || 0), { timeout: 10_000 })
        .toBeGreaterThan(qrPrintBefore);
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(page.getByText('Print RMA Sticker Label')).toBeHidden();

      const liveThermalBtn = page.locator('button[title="Print 4x6 inch Thermal Box Label"]').first();
      await liveThermalBtn.click();
      const thermPrintBtn = page.getByRole('button', { name: /Print 4x6" Box Label/i });
      await expect(thermPrintBtn).toBeVisible();
      const thermBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await thermPrintBtn.click();
      await expect
        .poll(() => page.evaluate(() => window.__pwPrintCount || 0), { timeout: 10_000 })
        .toBeGreaterThan(thermBefore);
      await page.getByRole('button', { name: 'Close', exact: true }).click();

      const livePhotoBtn = page.locator('button[title="Click to view full-size photo"]').first();
      if (await livePhotoBtn.isVisible().catch(() => false)) {
        await livePhotoBtn.click();
        const closeLb = page.locator('button[title="Close (Esc)"]');
        await expect(closeLb).toBeVisible();
        const nextImg = page.locator('button[aria-label="Next image"]');
        if (await nextImg.isVisible().catch(() => false)) {
          await nextImg.click();
          await page.locator('button[aria-label="Previous image"]').click();
        }
        await closeLb.click();
      }

      const nextPageBtn = page.getByRole('button', { name: 'Next', exact: true }).first();
      if ((await nextPageBtn.isVisible().catch(() => false)) && (await nextPageBtn.isEnabled().catch(() => false))) {
        await nextPageBtn.click();
        await page.getByRole('button', { name: 'Prev', exact: true }).first().click();
      }

      // =========================================================================
      // PART C: TEST MODE SANDBOX (cURL Guide, Customer RMAs, Supplier RTVs, Credit Memos)
      // =========================================================================
      await page.getByRole('button', { name: /Test Mode Sandbox/i }).click();

      // 1. Toggle & copy API Sandbox cURL guide
      const showCurlBtn = page.getByRole('button', { name: /Show cURL Guide/i });
      if (await showCurlBtn.isVisible().catch(() => false)) {
        await showCurlBtn.click();
        const copyCurlBtn = page.getByRole('button', { name: /Copy cURL/i }).first();
        await expect(copyCurlBtn).toBeVisible();
        await copyCurlBtn.click();
        await page.getByRole('button', { name: /Hide cURL Guide/i }).click();
      }

      // 2. Sandbox Customer RMAs sub-tab
      await page.getByRole('button', { name: /Sandbox Customer RMAs/i }).click();
      await expect(page.getByRole('button', { name: /Full Audit Log/i })).toBeVisible();

      // All 3 Coworker Queue buttons + Clear
      await page.getByRole('button', { name: /Ready to Restock/i }).click();
      await page.getByRole('button', { name: /Supplier Re-Order/i }).click();
      await page.getByRole('button', { name: /No Re-Order \/ Write-Off/i }).click();
      await page.getByRole('button', { name: /Clear Queue Filter/i }).click();

      // Rows List vs Cards View
      await page.getByRole('button', { name: 'Cards', exact: true }).click();
      await page.getByRole('button', { name: /Rows List/i }).click();

      // Sandbox Full Audit Log
      await page.getByRole('button', { name: /Full Audit Log/i }).click();
      await expect(page.getByText(/Logged Sandbox Test RMA Reports/i)).toBeVisible();
      await page.getByRole('button', { name: /Cards View/i }).click();
      await page.getByRole('button', { name: /Rows List/i }).last().click();
      const [sbAuditCsv] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('button[title="Export filtered reports to CSV"]').click()
      ]);
      expect(sbAuditCsv.suggestedFilename()).toContain('.csv');
      await page
        .locator('div:has(> button[title="Export filtered reports to CSV"]) > button')
        .last()
        .click();

      // Sandbox Customer Matrix (.xlsx) & Export Inbound CSV
      await page.getByRole('button', { name: /Sandbox Customer Matrix \(\.xlsx\)/i }).last().click();
      const [sbCustMatrix] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Download Excel Matrix \(\.xlsx\)/i }).click()
      ]);
      expect(sbCustMatrix.suggestedFilename()).toContain('.xlsx');
      await page.getByRole('button', { name: 'Close', exact: true }).click();

      const [sbCustCsv] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Export Inbound CSV/i }).click()
      ]);
      expect(sbCustCsv.suggestedFilename()).toContain('.csv');

      // Exercise filter dropdowns + Reset, then locate our 2-photo seededCustomerRma
      const sbCustSelects = page.locator('select');
      for (let i = 0; i < (await sbCustSelects.count()); i++) {
        const sel = sbCustSelects.nth(i);
        if ((await sel.locator('option').count()) > 1) {
          await sel.selectOption({ index: 1 });
        }
      }
      const sbCustReset = page.getByRole('button', { name: 'Reset', exact: true }).first();
      if (await sbCustReset.isVisible().catch(() => false)) {
        await sbCustReset.click();
      }

      const sbCustSearch = page.locator('input[placeholder*="Search" i]').first();
      await sbCustSearch.fill(seededCustomerRma);
      const sbCustRow = page.locator('tr', { hasText: seededCustomerRma }).first();
      await expect(sbCustRow).toBeVisible({ timeout: 10_000 });

      // Lightbox with Next / Previous / Close on our 2-photo Sandbox Customer RMA
      await sbCustRow.locator('button[title="Click to view full-size proof photo"]').click();
      await expect(page.locator('button[title="Close (Esc)"]')).toBeVisible();
      await expect(page.locator('button[aria-label="Next image"]')).toBeVisible();
      await page.locator('button[aria-label="Next image"]').click();
      await page.locator('button[aria-label="Previous image"]').click();
      await page.locator('button[title="Close (Esc)"]').click();

      // Row QR Quick-View & Print
      await sbCustRow.locator('button[title*="View & Print Box QR Sticker"]').click();
      await expect(page.getByText('Print RMA Sticker Label')).toBeVisible();
      const sbQrBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await page.getByRole('button', { name: /Print Sticker \(/i }).click();
      await expect
        .poll(() => page.evaluate(() => window.__pwPrintCount || 0), { timeout: 10_000 })
        .toBeGreaterThan(sbQrBefore);
      await page.getByRole('button', { name: 'Done', exact: true }).click();

      // Row Thermal 4x6 Label & Print
      await sbCustRow.locator('button[title="Print 4x6 inch Thermal Box Label"]').click();
      const sbThermBtn = page.getByRole('button', { name: /Print 4x6" Box Label/i });
      await expect(sbThermBtn).toBeVisible();
      const sbThermBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await sbThermBtn.click();
      await expect
        .poll(() => page.evaluate(() => window.__pwPrintCount || 0), { timeout: 10_000 })
        .toBeGreaterThan(sbThermBefore);
      await page.getByRole('button', { name: 'Close', exact: true }).click();

      // Row Archive button
      await sbCustRow.locator(`button[title*="Archive RMA #${seededCustomerRma}"]`).click();
      await expect(sbCustRow).toBeHidden({ timeout: 10_000 });

      // 3. Sandbox Supplier RTVs sub-tab
      await page.getByRole('button', { name: /Sandbox Supplier RTVs/i }).click();
      await page.getByRole('button', { name: /Ready to Restock/i }).click();
      await page.getByRole('button', { name: /Supplier Re-Order/i }).click();
      await page.getByRole('button', { name: /No Re-Order \/ Write-Off/i }).click();
      await page.getByRole('button', { name: /Clear Queue Filter/i }).click();

      // Sandbox Supplier RTV Matrix (.xlsx) & Export CSV
      await page.getByRole('button', { name: /Sandbox Supplier RTV Matrix \(\.xlsx\)/i }).last().click();
      const [sbSuppMatrix] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Download Excel Matrix \(\.xlsx\)/i }).click()
      ]);
      expect(sbSuppMatrix.suggestedFilename()).toContain('.xlsx');
      await page.getByRole('button', { name: 'Close', exact: true }).click();

      const [sbSuppCsv] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Export Supplier Claims CSV/i }).click()
      ]);
      expect(sbSuppCsv.suggestedFilename()).toContain('.csv');

      // Filter dropdowns + Reset then locate seededSupplierRma
      const sbSuppSelects = page.locator('select');
      for (let i = 0; i < (await sbSuppSelects.count()); i++) {
        const sel = sbSuppSelects.nth(i);
        if ((await sel.locator('option').count()) > 1) {
          await sel.selectOption({ index: 1 });
        }
      }
      const sbSuppReset = page.getByRole('button', { name: 'Reset', exact: true }).first();
      if (await sbSuppReset.isVisible().catch(() => false)) {
        await sbSuppReset.click();
      }

      const sbSuppSearch = page.locator('input[placeholder*="Search" i]').first();
      await sbSuppSearch.fill(seededSupplierRma);
      const sbSuppRow = page.locator('tr', { hasText: seededSupplierRma }).first();
      await expect(sbSuppRow).toBeVisible({ timeout: 10_000 });

      // Lightbox on Supplier RTV row
      await sbSuppRow.locator('button[title="Click to view full-size photo"]').click();
      await expect(page.locator('button[title="Close (Esc)"]')).toBeVisible();
      await page.locator('button[title="Close (Esc)"]').click();

      // QR Quick-View & Print on Sandbox Supplier RTV
      await sbSuppRow.locator('button[title*="Quick-View & Print Box QR Sticker"]').click();
      await expect(page.getByText('Print RMA Sticker Label')).toBeVisible();
      const sbSuppQrBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await page.getByRole('button', { name: /Print Sticker \(/i }).click();
      await expect
        .poll(() => page.evaluate(() => window.__pwPrintCount || 0), { timeout: 10_000 })
        .toBeGreaterThan(sbSuppQrBefore);
      await page.getByRole('button', { name: 'Done', exact: true }).click();

      // Thermal 4x6 on Sandbox Supplier RTV
      await sbSuppRow.locator('button[title="Print 4x6 inch Thermal Box Label"]').click();
      const sbSuppThermBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await page.getByRole('button', { name: /Print 4x6" Box Label/i }).click();
      await expect
        .poll(() => page.evaluate(() => window.__pwPrintCount || 0), { timeout: 10_000 })
        .toBeGreaterThan(sbSuppThermBefore);
      await page.getByRole('button', { name: 'Close', exact: true }).click();

      // Archive Sandbox Supplier RTV row
      await sbSuppRow.locator(`button[title*="Archive RMA #${seededSupplierRma}"]`).click();
      await expect(sbSuppRow).toBeHidden({ timeout: 10_000 });

      // Check Sandbox Credit Memos sub-tab renders cleanly
      await page.getByRole('button', { name: /Sandbox Credit Memos/i }).click();
      await expect(page.getByRole('button', { name: /Issue Credit Memo/i })).toBeVisible();

      // =========================================================================
      // PART D: ARCHIVE VAULT RESTORE + 30-DAY TRASH BIN PERMANENT DELETE
      // =========================================================================
      await page.getByRole('button', { name: /Archive & Trash/i }).click();
      await page.getByRole('button', { name: /Archive Vault/i }).click();

      // Exercise environment scope filter pills
      await page.getByRole('button', { name: /Live Production/i }).click();
      await page.getByRole('button', { name: /Test Mode Sandbox/i }).last().click();

      const archiveSearch = page.locator('input[placeholder*="Search" i]').first();

      // Restore both archived synthetic Sandbox RMAs back to active hubs
      await archiveSearch.fill(seededCustomerRma);
      const archCustRow = page.locator('tr', { hasText: seededCustomerRma }).first();
      await expect(archCustRow).toBeVisible({ timeout: 10_000 });
      await archCustRow.locator('button[title="Restore item back to active hub"]').click();
      await expect(archCustRow).toBeHidden({ timeout: 10_000 });

      await archiveSearch.fill(seededSupplierRma);
      const archSuppRow = page.locator('tr', { hasText: seededSupplierRma }).first();
      await expect(archSuppRow).toBeVisible({ timeout: 10_000 });
      await archSuppRow.locator('button[title="Restore item back to active hub"]').click();
      await expect(archSuppRow).toBeHidden({ timeout: 10_000 });

      // Move both restored records to 30-Day Trash Bin from Test Mode Sandbox
      await page.getByRole('button', { name: /Test Mode Sandbox/i }).first().click();

      await page.getByRole('button', { name: /Sandbox Customer RMAs/i }).click();
      await page.locator('input[placeholder*="Search" i]').first().fill(seededCustomerRma);
      const restoredCustRow = page.locator('tr', { hasText: seededCustomerRma }).first();
      await expect(restoredCustRow).toBeVisible({ timeout: 10_000 });
      await restoredCustRow.locator(`button[title*="Move RMA #${seededCustomerRma} to 30-Day Trash Bin"]`).click();
      await page.getByRole('button', { name: /Move to Trash/i }).click();
      await expect(restoredCustRow).toBeHidden({ timeout: 10_000 });

      await page.getByRole('button', { name: /Sandbox Supplier RTVs/i }).click();
      await page.locator('input[placeholder*="Search" i]').first().fill(seededSupplierRma);
      const restoredSuppRow = page.locator('tr', { hasText: seededSupplierRma }).first();
      await expect(restoredSuppRow).toBeVisible({ timeout: 10_000 });
      await restoredSuppRow.locator(`button[title*="Delete RMA #${seededSupplierRma}"]`).click();
      await page.getByRole('button', { name: /Move to Trash/i }).click();
      await expect(restoredSuppRow).toBeHidden({ timeout: 10_000 });

      // Permanently destroy both synthetic test records from 30-Day Trash Bin
      await page.getByRole('button', { name: /Archive & Trash/i }).click();
      await page.getByRole('button', { name: /Trash Bin/i }).click();
      await expect(page.getByRole('button', { name: /Empty Trash/i })).toBeVisible();

      const onConfirmDialog = async (dialog) => {
        await dialog.accept();
      };
      page.on('dialog', onConfirmDialog);

      try {
        const trashSearch = page.locator('input[placeholder*="Search" i]').first();
        for (const targetRma of [seededCustomerRma, seededSupplierRma]) {
          await trashSearch.fill(targetRma);
          const trashedRow = page.locator('tr', { hasText: targetRma }).first();
          await expect(trashedRow).toBeVisible({ timeout: 10_000 });
          const delWait = page
            .waitForResponse(
              (res) => res.url().includes('/rest/v1/rma_reports') && res.request().method() === 'DELETE',
              { timeout: 20_000 }
            )
            .catch(() => null);
          await trashedRow
            .locator('button[title="Permanently destroy this record forever"]')
            .click();
          await expect(trashedRow).toBeHidden({ timeout: 15_000 });
          await delWait;
        }
        await page.waitForLoadState('networkidle').catch(() => {});
      } finally {
        page.off('dialog', onConfirmDialog);
      }

      seededCustomerRma = null;
      seededSupplierRma = null;
      guard.assertClean('suite 03 hubs, sandbox, lightbox, archive and trash');
    } finally {
      guard.detach();
    }
  });
});
