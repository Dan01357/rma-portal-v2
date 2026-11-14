import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

function readSupabasePublicEnv() {
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
import {
  PNG_BUFFER,
  VERIFIED_BARCODE,
  attachStrictGuards,
  installPrintStubs,
  isoDateDaysOffset,
  gotoAdmin
} from './helpers/testUtils.js';

/**
 * Seeds a temporary Test Mode Customer RMA via / so Live DB stays untouched.
 */
async function seedCustomerTestRma(page) {
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

  await page.getByRole('button', { name: /Customer RMA Hub/i }).click();
  await page.locator('input[placeholder*="barcode" i]').first().fill(VERIFIED_BARCODE);
  await expect(page.getByText('Recognized Product')).toBeVisible({ timeout: 12_000 });

  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({
    name: 'pw-quick-action.png',
    mimeType: 'image/png',
    buffer: PNG_BUFFER
  });
  await expect(page.getByText('1/10 photos')).toBeVisible({ timeout: 10_000 });

  await page.locator('input[placeholder="Your Full Name *"]').fill('Playwright Quick Triage');
  await page
    .locator('input[placeholder="Phone No. or Email *"]')
    .fill('playwright-triage@pingcon.local');

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

test.describe('Suite 04: QuickRMAActionModal & Every Inner Triage / Widget / Sub-Modal', () => {
  test('clicks every button, stream switch, QR/Thermal/Handover/Buffer/Locations/Wizard sub-modal, 6 Customer + 5 Supplier triage cards, Yes/No reorder, Debit Claim & Credit Memo trigger', async ({
    page,
    context
  }) => {
    test.setTimeout(180_000);
    await context.grantPermissions(['camera']).catch(() => {});
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);

    let activeRmaNumber = null;
    let createdClaimNumber = null;
    const capturedAlerts = [];

    const onDialog = async (dialog) => {
      const msg = dialog.message();
      capturedAlerts.push(msg);
      const claimMatch = msg.match(/\((RTV-(?:TEST-)?\d{4}-\d+-[A-Z0-9]+)\)/i);
      if (claimMatch && claimMatch[1]) {
        createdClaimNumber = claimMatch[1];
      }
      await dialog.accept();
    };
    page.on('dialog', onDialog);

    try {
      activeRmaNumber = await seedCustomerTestRma(page);

      await gotoAdmin(page);
      await page.getByRole('button', { name: /Test Mode Sandbox/i }).click();
      await page.getByRole('button', { name: /Sandbox Customer RMAs/i }).click();

      const searchInput = page.locator('input[placeholder*="Search" i]').first();
      await searchInput.fill(activeRmaNumber);
      const targetRow = page.locator('tr', { hasText: activeRmaNumber }).first();
      await expect(targetRow).toBeVisible({ timeout: 10_000 });

      // Open QuickRMAActionModal via Inspect / Triage button
      await targetRow.getByRole('button', { name: /Inspect \/ Triage/i }).click();
      await expect(page.getByText('RMA Quick Processing')).toBeVisible({ timeout: 10_000 });

      // 1. "Print QR Sticker" -> ReturnQRModal + Print + Done
      await page.getByRole('button', { name: /Print QR Sticker/i }).click();
      await expect(page.getByText('Print RMA Sticker Label')).toBeVisible();
      const qrPrintsBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await page.getByRole('button', { name: /Print Sticker \(/i }).click();
      await expect
        .poll(() => page.evaluate(() => window.__pwPrintCount || 0), { timeout: 10_000 })
        .toBeGreaterThan(qrPrintsBefore);
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(page.getByText('Print RMA Sticker Label')).toBeHidden();

      // 2. "Driver QR Widget" -> DriverDeliveryHandoverModal + Close
      const driverWidgetBtn = page.locator('button[title="Open Driver Delivery Handover Mobile Screen"]');
      await expect(driverWidgetBtn).toBeVisible();
      await driverWidgetBtn.click();
      await expect(page.getByText('Delivery Handover Confirmation')).toBeVisible({ timeout: 10_000 });
      await page.locator('button[title="Close"]').last().click();
      await expect(page.getByText('Delivery Handover Confirmation')).toBeHidden();

      // 3. "Edit Details & Documents" (Super Admin Silent Restitution + qty 350 for >P10k test)
      await page.getByRole('button', { name: /Edit Details & Documents/i }).click();
      await expect(page.getByRole('button', { name: /Save & Apply Restitution/i })).toBeVisible();

      // Toggle Live/Test restitution radio buttons while keeping Test Mode active at the end
      const liveBtn = page.getByRole('button', { name: /Live Production/i }).last();
      const testBtn = page.getByRole('button', { name: /Test Mode Sandbox/i }).last();
      if (await liveBtn.isVisible().catch(() => false)) {
        await liveBtn.click();
        await testBtn.click();
      }

      // Click Generate Test ID & capture updated RMA number
      const genIdBtn = page.getByRole('button', { name: /Generate Test ID/i });
      if (await genIdBtn.isVisible().catch(() => false)) {
        await genIdBtn.click();
      }
      const rmaNumInput = page.locator('input[placeholder*="RMA-2026"]').first();
      if (await rmaNumInput.isVisible().catch(() => false)) {
        const val = (await rmaNumInput.inputValue()).trim();
        if (val.startsWith('RMA-TEST-')) {
          activeRmaNumber = val;
        }
      }

      // Update Quantity to 350 (> ₱10,000 high-value claim) & supplier/branch metadata
      const qtyInput = page.locator('input[type="number"][min="1"]').first();
      await qtyInput.fill('350');
      const supplierEdit = page.locator('input[placeholder*="Mondelez" i]').first();
      if (await supplierEdit.isVisible().catch(() => false)) {
        if (!(await supplierEdit.inputValue()).trim()) {
          await supplierEdit.fill('Playwright Master Vendor');
        }
      }
      await page
        .locator('input[placeholder*="Savemore Market" i]')
        .first()
        .fill('Playwright Test Branch');
      await page.locator('input[placeholder*="LOT-B42" i]').first().fill('LOT-PW-99');

      // Test Cancel button once then re-open & Save & Apply Restitution
      await page
        .locator('div:has(> button:has-text("Save & Apply Restitution")) > button:has-text("Cancel")')
        .click();
      await page.getByRole('button', { name: /Edit Details & Documents/i }).click();
      await page.locator('input[type="number"][min="1"]').first().fill('350');
      const rmaNumInput2 = page.locator('input[placeholder*="RMA-2026"]').first();
      if (await rmaNumInput2.isVisible().catch(() => false)) {
        await rmaNumInput2.fill(activeRmaNumber);
      }
      await page.getByRole('button', { name: /Save & Apply Restitution/i }).click();
      await expect(page.getByRole('button', { name: /Edit Details & Documents/i })).toBeVisible({
        timeout: 25_000
      });

      // Verify High-Value Claim (> P10,000) Super Admin notice now appears on QuickRMAActionModal!
      await expect(page.getByText(/Super Admin Approved \(> ₱10,000 Claim\)/i)).toBeVisible({
        timeout: 10_000
      });

      // 4. "Print 4x6" Label" (Vendor RTV Gate Pass renders after toggling to Supplier RTV stream below)
      await page.locator('button[title="Print 4x6 inch thermal sticker label"]').click();
      await expect(page.getByRole('button', { name: /Print 4x6" Box Label/i })).toBeVisible();
      const thermBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await page.getByRole('button', { name: /Print 4x6" Box Label/i }).click();
      await expect
        .poll(() => page.evaluate(() => window.__pwPrintCount || 0), { timeout: 10_000 })
        .toBeGreaterThan(thermBefore);
      await page.getByRole('button', { name: 'Close', exact: true }).last().click();

      // 5. All 6 Customer Triage Cards + WarehouseLocationsModal + Purchasing Replenishment YES/NO + Buffer Slip + Release Hold + Reject Gate Pass
      await page.getByRole('button', { name: /1\. Restock to Shelf/i }).click();

      // Test WarehouseLocationsModal via "⚙️ Manage Locations" inside Restock card
      const manageLocBtn = page.getByRole('button', { name: /Manage Locations/i }).first();
      if (await manageLocBtn.isVisible().catch(() => false)) {
        await manageLocBtn.click();
        await expect(page.getByText('Warehouse Locations & Areas')).toBeVisible();
        await page.locator('input[placeholder*="Bin Rack" i]').fill('PW-TEMP-RACK');
        await page.getByRole('button', { name: 'Add', exact: true }).click();
        const locRow = page.locator('div:has(> div > span:text-is("PW-TEMP-RACK"))').last();
        await expect(locRow).toBeVisible();
        // Clean up temporary warehouse location
        await locRow.locator('button[title="Delete location"]').click();
        await expect(locRow).toBeHidden();
        await page
          .locator('div:has(> div > div > h3:has-text("Warehouse Locations & Areas")) > button')
          .click();
        await expect(page.getByText('Warehouse Locations & Areas')).toBeHidden();
      }

      await page.getByRole('button', { name: /2\. Move to Supplier RTV/i }).click();

      // Card 3: Scrap / Dispose -> toggle Purchasing Replenishment NO then YES
      await page.getByRole('button', { name: /3\. Scrap \/ Dispose/i }).click();
      await page.getByRole('button', { name: /NO — Do Not Re-Order/i }).click();
      await page.getByRole('button', { name: /YES — Flag for Supplier Re-Order/i }).click();

      // Card 4: Buffer Stock Swap automatically opens BufferExchangeSlipModal
      await page.getByRole('button', { name: /4\. Buffer Stock Swap/i }).click();
      await expect(page.getByText('Buffer Stock Replacement Dispatch Slip', { exact: true })).toBeVisible();
      const bufPrintBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await page.getByRole('button', { name: /Print Slip \/ PDF/i }).click();
      await expect
        .poll(() => page.evaluate(() => window.__pwPrintCount || 0), { timeout: 10_000 })
        .toBeGreaterThan(bufPrintBefore);
      await page.locator('#buffer-exchange-slip-print-root button:has(svg.lucide-x)').first().click();
      await expect(page.getByText('Buffer Stock Replacement Dispatch Slip', { exact: true })).toBeHidden();

      // Card 5: On Hold / Quarantine -> verify & click "🔓 Release Hold"
      await page.getByRole('button', { name: /5\. On Hold \/ Quarantine/i }).click();
      const releaseHoldBtn = page.getByRole('button', { name: /Release Hold/i }).first();
      await expect(releaseHoldBtn).toBeVisible();
      await releaseHoldBtn.click();

      // Card 6: Reject & Return -> fill reason & click "🖨️ Print Rejected Return Gate Pass"
      await page.getByRole('button', { name: /6\. Reject & Return/i }).click();
      await page
        .locator('textarea[placeholder*="Customer physical damage" i]')
        .fill('Playwright automated policy rejection test');
      const rejPrintBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await page.getByRole('button', { name: /Print Rejected Return Gate Pass/i }).click();
      await expect
        .poll(() => page.evaluate(() => window.__pwPrintCount || 0), { timeout: 10_000 })
        .toBeGreaterThan(rejPrintBefore);

      // Settle on valid Customer Restock disposition & Save Physical Triage
      await page.getByRole('button', { name: /1\. Restock to Shelf/i }).click();
      await page.getByRole('button', { name: /Save Physical Triage/i }).click();
      await expect(page.getByRole('button', { name: /Save Physical Triage/i })).toBeEnabled({
        timeout: 15_000
      });

      // 6. "Buffer Stock Replacement Slip" buttons (header banner + bottom financial card)
      await page.getByRole('button', { name: /Buffer Stock Replacement Slip/i }).first().click();
      await expect(page.getByText('Buffer Stock Replacement Dispatch Slip', { exact: true })).toBeVisible();
      await page.locator('#buffer-exchange-slip-print-root button:has(svg.lucide-x)').first().click();
      await expect(page.getByText('Buffer Stock Replacement Dispatch Slip', { exact: true })).toBeHidden();

      await page.getByRole('button', { name: /Buffer Stock Replacement Slip/i }).last().click();
      await expect(page.getByText('Buffer Stock Replacement Dispatch Slip', { exact: true })).toBeVisible();
      await page.locator('#buffer-exchange-slip-print-root button:has(svg.lucide-x)').first().click();
      await expect(page.getByText('Buffer Stock Replacement Dispatch Slip', { exact: true })).toBeHidden();

      // 7. "+ Issue Credit Memo" button opens CreditMemoModal -> verify & Cancel
      await page.getByRole('button', { name: /\+ Issue Credit Memo/i }).click();
      await expect(page.getByText('Issue Finance Credit Memo')).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
      await expect(page.getByText('Issue Finance Credit Memo')).toBeHidden();
      await expect(page.getByText('RMA Quick Processing')).toBeVisible({ timeout: 10_000 });
      await expect(
        page.getByRole('button', { name: /Supplier Claim \(Outbound \/ RTV\)/i })
      ).toBeVisible({ timeout: 10_000 });

      // 8. Stream Toggle -> Switch to Supplier Claim (Outbound / RTV)
      const supplierStreamBtn = page.getByRole('button', { name: /Supplier Claim \(Outbound \/ RTV\)/i });
      await supplierStreamBtn.click();
      await expect(page.getByText('Supplier RTV Physical Actions (5 Cards)')).toBeVisible();
      await expect(supplierStreamBtn).toBeEnabled({ timeout: 15_000 });

      // 9. Simple 4-Choice Wizard launched from QuickRMAActionModal
      const openWizardBtn = page.getByRole('button', { name: /Open 4-Choice Wizard/i });
      if (await openWizardBtn.isVisible().catch(() => false)) {
        await openWizardBtn.click();
        await expect(page.getByText('What do you want to do with this item?')).toBeVisible();
        await page.locator('button:has-text("Return to supplier for Debit Claim")').first().click();
        await page.locator('button[aria-label="Close modal"]').last().click();
        await expect(page.getByText('What do you want to do with this item?')).toBeHidden();
        await expect(page.getByText('RMA Quick Processing')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText('Supplier RTV Physical Actions (5 Cards)')).toBeVisible({ timeout: 10_000 });
      }

      // 10. All 5 Supplier RTV Triage Cards + Save Physical Triage
      await page.getByRole('button', { name: /2\. Vendor Credit Settled/i }).click();
      await page.getByRole('button', { name: /3\. Replacement Received/i }).click();
      await page.getByRole('button', { name: /4\. Vendor Rejected Claim/i }).click();
      await page.getByRole('button', { name: /5\. Under Vendor Dispute/i }).click();
      await page.getByRole('button', { name: /1\. Pending Vendor Pickup/i }).click();

      // Toggle Purchasing Replenishment NO then YES on Supplier RTV too
      await page.getByRole('button', { name: /NO — Do Not Re-Order/i }).click();
      await page.getByRole('button', { name: /YES — Flag for Supplier Re-Order/i }).click();

      await page.getByRole('button', { name: /Save Physical Triage/i }).click();
      await expect(page.getByRole('button', { name: /Save Physical Triage/i })).toBeEnabled({
        timeout: 15_000
      });

      // 11. "+ Debit Claim", "Print Debit Voucher", and both header + card "Vendor RTV Gate Pass" buttons
      await page.getByRole('button', { name: /\+ Debit Claim/i }).click();
      await expect.poll(() => createdClaimNumber, { timeout: 15_000 }).toBeTruthy();

      const debPrintsBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await page.getByRole('button', { name: /Print Debit Voucher/i }).click();
      await expect
        .poll(() => page.evaluate(() => window.__pwPrintCount || 0), { timeout: 10_000 })
        .toBeGreaterThan(debPrintsBefore);

      const headerGateBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await page.locator('button[title="Print Official Vendor RTV Gate Pass"]').first().click();
      await expect
        .poll(() => page.evaluate(() => window.__pwPrintCount || 0), { timeout: 10_000 })
        .toBeGreaterThan(headerGateBefore);

      const suppGateBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await page.getByRole('button', { name: /Vendor RTV Gate Pass/i }).last().click();
      await expect
        .poll(() => page.evaluate(() => window.__pwPrintCount || 0), { timeout: 10_000 })
        .toBeGreaterThan(suppGateBefore);

      // 12. Toggle Stream back to Customer Return (Inbound) then Done / Close
      const customerStreamBtn = page.getByRole('button', { name: /Customer Return \(Inbound\)/i });
      await customerStreamBtn.click();
      await expect(page.getByText('Customer RMA Physical Actions (6 Cards)')).toBeVisible();
      await expect(customerStreamBtn).toBeEnabled({ timeout: 15_000 });
      await page.getByRole('button', { name: /Done \/ Close/i }).click();
      await expect(page.getByText('RMA Quick Processing')).toBeHidden();

      // 13. Clean up synthetic RMA permanently via Trash UI + any synthetic Sandbox Debit Claim
      await page.getByRole('button', { name: /Test Mode Sandbox/i }).click();
      // Check Supplier RTV tab since stream toggled back to customer or wherever it lives now
      await page.getByRole('button', { name: /Sandbox Customer RMAs/i }).click();
      await page.locator('input[placeholder*="Search" i]').first().fill(activeRmaNumber);
      let rowToTrash = page.locator('tr', { hasText: activeRmaNumber }).first();
      if (!(await rowToTrash.isVisible({ timeout: 3000 }).catch(() => false))) {
        await page.getByRole('button', { name: /Sandbox Supplier RTVs/i }).click();
        await page.locator('input[placeholder*="Search" i]').first().fill(activeRmaNumber);
        rowToTrash = page.locator('tr', { hasText: activeRmaNumber }).first();
      }

      if (await rowToTrash.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Wait for table to stabilize after any background refresh before clicking the delete button
        await page.waitForTimeout(1500);
        const trashBtn = rowToTrash
          .locator('button[title*="30-Day Trash Bin" i], button[title*="Delete RMA #" i]')
          .first();
        // Retry up to 3 times in case background refresh detaches the row
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await trashBtn.click({ timeout: 5000 });
            break;
          } catch {
            await page.waitForTimeout(1000);
          }
        }
        await page.getByRole('button', { name: /Move to Trash/i }).click();
        await expect(page.getByText(/Move to Trash \(30-Day Recovery\)\?/i)).toBeHidden({
          timeout: 15_000
        });

        await page.getByRole('button', { name: /Archive & Trash/i }).click();
        await page.getByRole('button', { name: /Trash Bin/i }).click();
        await page.locator('input[placeholder*="Search" i]').first().fill(activeRmaNumber);
        const trashedRow = page.locator('tr', { hasText: activeRmaNumber }).first();
        await expect(trashedRow).toBeVisible({ timeout: 8000 });
        await page.waitForTimeout(1000);
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
        await page.waitForLoadState('networkidle').catch(() => {});
      }

      guard.assertClean('suite 04 quick processing widgets');
    } finally {
      // Fallback cleanup of synthetic Test Mode RMA if test aborted before UI trash step
      if (activeRmaNumber) {
        const { supaUrl, anonKey } = readSupabasePublicEnv();
        await page
          .evaluate(async ({ rmaNum, url, key }) => {
            try {
              const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
              const rawAuth = supaKey ? JSON.parse(localStorage.getItem(supaKey)) : null;
              const token = rawAuth?.access_token;
              if (url && key && token) {
                const headers = {
                  apikey: key,
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json'
                };
                await fetch(
                  `${url}/rest/v1/rma_reports?rma_number=eq.${encodeURIComponent(rmaNum)}`,
                  { method: 'DELETE', headers }
                );
              }
            } catch {}
          }, { rmaNum: activeRmaNumber, url: supaUrl, key: anonKey })
          .catch(() => {});
      }
      // Remove any synthetic Test Mode supplier debit claim created during + Debit Claim test
      if (createdClaimNumber) {
        const { supaUrl, anonKey } = readSupabasePublicEnv();
        await page
          .evaluate(async ({ claimNum, url, key }) => {
            try {
              const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
              const rawAuth = supaKey ? JSON.parse(localStorage.getItem(supaKey)) : null;
              const token = rawAuth?.access_token;
              if (url && key && token) {
                const headers = {
                  apikey: key,
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json'
                };
                await fetch(
                  `${url}/rest/v1/supplier_claims?claim_number=eq.${encodeURIComponent(claimNum)}`,
                  { method: 'DELETE', headers }
                );
                const settingsRes = await fetch(
                  `${url}/rest/v1/rma_settings?key=eq.supplier_claims_store&select=value`,
                  { headers }
                );
                const settingsJson = await settingsRes.json();
                const currentList = settingsJson?.[0]?.value;
                if (Array.isArray(currentList)) {
                  const filtered = currentList.filter(
                    (c) => (c.claim_number || c.claimNumber) !== claimNum
                  );
                  await fetch(`${url}/rest/v1/rma_settings?key=eq.supplier_claims_store`, {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({ value: filtered })
                  });
                }
              }
            } catch {}
          }, { claimNum: createdClaimNumber, url: supaUrl, key: anonKey })
          .catch(() => {});
      }
      page.off('dialog', onDialog);
      guard.detach();
    }
  });
});
