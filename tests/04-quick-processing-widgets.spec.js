import { test, expect } from '@playwright/test';
import { buildRmaAlertXlsxBytes } from '../src/utils/rmaAlertXlsx.js';
import {
  attachStrictGuards,
  installPrintStubs,
  interceptAndCaptureEmails,
  mockPhotoUploadSuccess,
  isoDateDaysOffset,
  seedTestModeRma,
  gotoAdmin,
  cleanupTestRecords
} from './helpers/testUtils.js';

test.describe('Suite 04: Streamlined QuickRMAActionModal (Stream Switch, 4-Choice Launch, Split Qty, Auto-Suggest Edit & Audit Trail)', () => {
  test('verifies deprecated widgets are removed and exercises Stream Switcher, Print QR, Edit Details + AutoSuggest + >10k Governance, Split Qty (-B child), 4-Choice Window, Credit Memo launch & Audit Trail', async ({
    page,
    context
  }) => {
    test.setTimeout(180_000);
    await context.grantPermissions(['camera']).catch(() => { });
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);
    await interceptAndCaptureEmails(page);
    await mockPhotoUploadSuccess(page);

    let activeRmaNumber = null;
    let splitChildRma = null;

    try {
      activeRmaNumber = await seedTestModeRma(page, {
        stream: 'customer',
        photoCount: 1,
        quantity: 5
      });

      await gotoAdmin(page);
      await page.getByRole('button', { name: /Test Mode Sandbox/i }).first().click();
      await page.getByRole('button', { name: /Sandbox Customer RMAs/i }).click();

      const searchInput = page.locator('input[placeholder*="Search" i]').first();
      await searchInput.fill(activeRmaNumber);
      const targetRow = page.locator('tr', { hasText: activeRmaNumber }).first();
      await expect(targetRow).toBeVisible({ timeout: 30_000 });

      // Open QuickRMAActionModal via Split Qty / Details button
      await targetRow.getByRole('button', { name: /Split Qty|Details|Inspect/i }).first().click();
      await expect(page.getByText('RMA Details & Quick Actions')).toBeVisible({ timeout: 10_000 });

      // 1. Strictly verify ALL removed widgets & clutter inputs are ABSENT
      await expect(page.getByText(/Condition Grade/i)).toHaveCount(0);
      await expect(page.getByText(/Automated Lifecycle Stage/i)).toHaveCount(0);
      await expect(page.getByText(/Hold \/ Quarantine/i)).toHaveCount(0);
      await expect(page.getByText(/Supplier RTV Physical Actions/i)).toHaveCount(0);
      await expect(page.getByText(/Customer RMA Physical Actions/i)).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Driver QR Widget/i })).toHaveCount(0);
      await expect(page.locator('button[title*="4x6" i]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Buffer Stock Replacement/i })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Vendor RTV Gate Pass/i })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Rejected Return Gate Pass/i })).toHaveCount(0);

      // 2. Print QR Code sub-modal & Print
      await page.getByRole('button', { name: /Print QR Sticker/i }).click();
      await expect(page.getByText('Print RMA QR Code')).toBeVisible();
      const qrBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await page.getByRole('button', { name: /Print QR \(/i }).click();
      await expect.poll(() => page.evaluate(() => window.__pwPrintCount || 0), { timeout: 10_000 }).toBeGreaterThan(qrBefore);
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(page.getByText('Print RMA QR Code')).toBeHidden();

      // 3. Edit Details (ProductAutoSuggest on SKU & Name, no Store Branch / Batch Lot inputs, SI/DR/PO, Supplier, collapsed Advanced / Danger Zone, sticky Cancel + Save Changes)
      await page.getByRole('button', { name: /Edit Details & Documents/i }).click();
      await expect(page.getByRole('button', { name: /Save Changes/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Advanced \/ Danger Zone/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Advanced \/ Danger Zone/i })).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('input[placeholder*="Savemore Market" i]')).toHaveCount(0);
      await expect(page.locator('input[placeholder*="LOT-B42" i]')).toHaveCount(0);

      // Test ProductAutoSuggest inside Edit Details & Documents
      const skuEditField = page.locator('input[placeholder="Type SKU / code..."]').first();
      await skuEditField.click();
      await skuEditField.fill('ss1319p');
      const sugDropdown = page.getByText('Select to Auto-Populate Product Details');
      if (await sugDropdown.isVisible({ timeout: 5000 }).catch(() => false)) {
        const firstSug = page.locator('button:has-text("SKU:")').first();
        if (await firstSug.isVisible().catch(() => false)) {
          await firstSug.click();
        }
      }

      const nameEditField = page.locator('input[placeholder="Type product name to search catalog..."]').first();
      await nameEditField.click();
      await nameEditField.fill('Magnolia');
      if (await sugDropdown.isVisible({ timeout: 5000 }).catch(() => false)) {
        const firstByName = page.locator('button:has-text("SKU:")').first();
        if (await firstByName.isVisible().catch(() => false)) {
          await firstByName.click();
        }
      }

      // Cancel once then re-open & commit updates (Qty 350 > P10k, SI/DR/PO, Supplier, Expiry date, collapsed Advanced / Danger Zone)
      await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
      await page.getByRole('button', { name: /Edit Details & Documents/i }).click();

      const advBtn = page.getByRole('button', { name: /Advanced \/ Danger Zone/i });
      await expect(advBtn).toHaveAttribute('aria-expanded', 'false');
      await advBtn.click();
      await expect(advBtn).toHaveAttribute('aria-expanded', 'true');

      const liveBtn = page.getByRole('button', { name: /Live Production/i }).last();
      const testBtn = page.getByRole('button', { name: /Test Mode Sandbox/i }).last();
      if (await liveBtn.isVisible().catch(() => false)) {
        await liveBtn.click();
        await testBtn.click();
      }
      const genIdBtn = page.getByRole('button', { name: /Generate Test ID/i });
      if (await genIdBtn.isVisible().catch(() => false)) {
        await genIdBtn.click();
      }
      const rmaNumInput = page.locator('input[placeholder*="RMA-2026"]').first();
      if (await rmaNumInput.isVisible().catch(() => false)) {
        const val = (await rmaNumInput.inputValue()).trim();
        if (val.startsWith('RMA-TEST-')) activeRmaNumber = val;
      }

      await page.locator('input[type="number"][min="1"]').first().fill('350');
      await page.locator('input[placeholder="e.g. SI-2026-8819"]').fill('SI-2026-9910');
      await page.locator('input[placeholder="e.g. DR-44120"]').fill('DR-2026-4410');
      await page.locator('input[placeholder="e.g. PO-99120"]').fill('PO-2026-7710');
      await page.locator('input[placeholder*="Suy Sing" i]').first().fill('Playwright Master Vendor');
      const expStr = isoDateDaysOffset(90);
      await page.locator('div.fixed input[type="date"]').first().fill(expStr);
      await expect(page.locator('div.fixed input[type="date"]').first()).toHaveValue(expStr);
      await expect(page.getByText(/ISO \(YYYY-MM-DD\)/i)).toHaveCount(0);

      await page.getByRole('button', { name: /Save Changes/i }).click();
      await expect(page.getByRole('button', { name: /Edit Details & Documents/i })).toBeVisible({
        timeout: 25_000
      });
      await expect(page.getByText(/Super Admin Approved \(> ₱10,000 Claim\)/i)).toBeVisible({
        timeout: 10_000
      });

      // 4. Split Qty (Open split panel -> Swap Quantities -> Confirm & Execute Split -> creates -B child)
      await page.getByRole('button', { name: /Split Qty \(350\)/i }).click();
      await expect(page.getByRole('button', { name: /Swap Quantities/i })).toBeVisible();
      await page.getByRole('button', { name: /Swap Quantities/i }).click();
      await page.getByRole('button', { name: /Confirm & Execute Split/i }).click();
      await expect(page.getByText(/Split Parent Ticket|Part 1 of 2/i).first()).toBeVisible({
        timeout: 45_000
      });
      const openChildBtn = page.getByRole('button', { name: /Open Split Child \(/i }).first();
      if (await openChildBtn.waitFor({ state: 'visible', timeout: 6_000 }).then(() => true).catch(() => false)) {
        const childTxt = await openChildBtn.innerText();
        const m = childTxt.match(/(RMA-TEST-[A-Z0-9-]+)/i);
        if (m) splitChildRma = m[1];
      } else if (activeRmaNumber) {
        splitChildRma = `${activeRmaNumber}-B`;
      }

      // 5. Open 4-Choice / Pickup Window from prominent banner -> fill manual Processed By -> save Restock -> verify QuickRMAActionModal restores cleanly
      await page.getByRole('button', { name: /Open 4-Choice \/ Pickup Window/i }).click();
      await expect(page.getByText('What do you want to do with this item?')).toBeVisible({ timeout: 10_000 });
      await page.locator('#wizard-processed-by-step1').fill('Playwright Quick Processor');
      await page.getByRole('button', { name: /Put Back on Good Shelf \(Restock\)/i }).first().click();
      await page.getByRole('button', { name: /Confirm & Save: Put Back on Good Shelf \(Restock\)/i }).click();
      await expect(page.getByRole('button', { name: /^Done$/i })).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: /^Done$/i }).click();
      await expect(page.getByText('RMA Details & Quick Actions')).toBeVisible({ timeout: 10_000 });

      // 6. Stream Switcher: Customer Hub -> Supplier RTV (hides Credit Memo card) -> back to Customer Hub
      await expect(page.getByText(/Customer Credit Memo/i).first()).toBeVisible();
      const supplierStreamBtn = page.getByRole('button', { name: /📤 Supplier RTV/i });
      await supplierStreamBtn.click();
      await expect(page.getByRole('button', { name: /\+ Issue Credit Memo/i })).toBeHidden({ timeout: 10_000 });
      const customerStreamBtn = page.getByRole('button', { name: /📥 Customer Hub/i });
      await customerStreamBtn.click();
      await expect(page.getByRole('button', { name: /\+ Issue Credit Memo/i })).toBeVisible({ timeout: 10_000 });

      // 7. Customer Credit Memo launch & Cancel + Day 0..10 Workflow Timeline + Verify Manual .xlsx UI Buttons Removed + Backend .xlsx Ingest + Audit Trail + Done / Close
      await page.getByRole('button', { name: /\+ Issue Credit Memo/i }).click();
      await expect(page.getByText(/Issue Finance Credit Memo/i)).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
      await expect(page.getByText('RMA Details & Quick Actions')).toBeVisible({ timeout: 10_000 });

      // Assert Day 0..10 Step 1-4 Workflow Timeline & verify removed manual Check Email / Upload Edited .xlsx / Send Follow-Up UI controls
      await expect(page.getByText(/Day 0/i).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /Check Email \.xlsx Replies/i })).toHaveCount(0);
      await expect(page.getByText(/Upload Edited \.xlsx/i)).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Send Follow-Up/i })).toHaveCount(0);
      const xlsxReplyBuf = Buffer.from(
        buildRmaAlertXlsxBytes(
          {
            rma_number: activeRmaNumber,
            barcode: '4805358373037',
            name: 'Magnolia Playwright Updated Item',
            supplier_name: 'Playwright Master Vendor',
            si_number: 'SI-2026-XLSX-1',
            reason: 'Updated via Mirror .xlsx Upload',
            ai_document_metadata: { is_test: true, test_mode: true }
          },
          { subject: `[TEST] [RMA Alert] ${activeRmaNumber}` }
        )
      );
      const ingestResult = await page.evaluate(
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
              actorName: 'Playwright Quick Action Check'
            })
          });
          return { status: res.status, json: await res.json().catch(() => null) };
        },
        { b64: xlsxReplyBuf.toString('base64'), targetRma: activeRmaNumber }
      );
      expect(ingestResult.status).toBe(200);
      expect(ingestResult.json?.success).toBe(true);
      expect(ingestResult.json?.changedFields || []).toContain('si_number');

      const auditHeading = page.getByText(/RMA Audit Trail & Lifecycle Timeline/i).first();
      await expect(auditHeading).toBeVisible();
      await auditHeading.click();

      await page.getByRole('button', { name: /Done \/ Close/i }).click();
      await expect(page.getByText('RMA Quick Processing')).toBeHidden();

      // 8. Clean up parent + split child via Sandbox Trash UI
      for (const rmaNum of [splitChildRma, activeRmaNumber].filter(Boolean)) {
        await page.getByRole('button', { name: /Test Mode Sandbox/i }).first().click();
        await page.getByRole('button', { name: /Sandbox Customer RMAs/i }).click();
        await page.locator('input[placeholder*="Search" i]').first().fill(rmaNum);
        const r = page.locator('tr').filter({
          has: page.locator(`button[title*="Move RMA #${rmaNum} to 30-Day"]`)
        }).first();
        if (await r.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)) {
          await r.locator(`button[title*="Move RMA #${rmaNum} to 30-Day"]`).click();
          await page.getByRole('button', { name: /Move to Trash/i }).click();
          await expect(page.getByRole('button', { name: /Move to Trash/i })).toBeHidden({ timeout: 25_000 });
          await expect(r).toBeHidden({ timeout: 20_000 });
        }
      }
      await page.getByRole('button', { name: /Archive & Trash/i }).click();
      await page.getByRole('button', { name: /Trash Bin/i }).click();
      const escapedExact = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const rmaNum of [splitChildRma, activeRmaNumber].filter(Boolean)) {
        await page.locator('input[placeholder*="Search trashed" i], input[placeholder*="Search" i]').first().fill(rmaNum);
        const trashed = page.locator('tr').filter({
          hasText: new RegExp(`${escapedExact(rmaNum)}(?!-[A-Z0-9])`)
        }).first();
        if (await trashed.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)) {
          page.once('dialog', (dialog) => dialog.accept());
          await trashed.locator('button[title="Permanently destroy this record forever"]').click();
          await expect(trashed).toBeHidden({ timeout: 20_000 });
        }
      }

      guard.assertClean('suite 04 streamlined QuickRMAActionModal');
    } finally {
      await cleanupTestRecords(page, { rmaNumbers: [activeRmaNumber, splitChildRma] });
      guard.detach();
    }
  });
});
