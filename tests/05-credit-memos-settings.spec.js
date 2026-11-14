import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  PNG_BUFFER,
  VERIFIED_BARCODE,
  attachStrictGuards,
  installPrintStubs,
  gotoAdmin
} from './helpers/testUtils.js';

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

/**
 * Seeds a temporary Test Mode Customer RMA via / so Live DB stays untouched.
 */
async function seedCustomerRmaForFinance(page) {
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
    name: 'pw-finance-cm.png',
    mimeType: 'image/png',
    buffer: PNG_BUFFER
  });
  await expect(page.getByText('1/10 photos')).toBeVisible({ timeout: 10_000 });

  await page.locator('input[placeholder="Your Full Name *"]').fill('Playwright Finance Tester');
  await page
    .locator('input[placeholder="Phone No. or Email *"]')
    .fill('playwright-finance@pingcon.local');

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

test.describe('Suite 05: Credit Memos (Live & Sandbox, 12% VAT, ₱10k Governance, Vouchers) & Settings/API Keys', () => {
  test('Credit Memos Live & Sandbox + VAT CSV breakdown + ₱10,000 Super Admin governance + Voucher Print + Void/Delete cleanup', async ({
    page,
    context
  }) => {
    test.setTimeout(180_000);
    await context.grantPermissions(['camera']).catch(() => {});
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);

    let seededRma = null;

    const onDialog = async (dialog) => {
      await dialog.accept();
    };
    page.on('dialog', onDialog);

    try {
      seededRma = await seedCustomerRmaForFinance(page);

      // 1. Verify Live Credit Memos tab renders cleanly and Issue Credit Memo modal opens/cancels without mutating Live DB
      await gotoAdmin(page);
      await page.getByRole('button', { name: /Credit Memos/i }).first().click();
      await expect(page.getByText('Finance Credit Memorandum Section')).toBeVisible();
      await page.getByRole('button', { name: /Issue.*Credit Memo/i }).first().click();
      await expect(page.getByText(/Issue Finance Credit Memo/i)).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
      await expect(page.getByText(/Issue Finance Credit Memo/i)).toBeHidden();

      // 2. Navigate to Test Mode Sandbox -> check ₱10,000 Super Admin Governance on high-value claim in QuickRMAActionModal
      await page.getByRole('button', { name: /Test Mode Sandbox/i }).first().click();
      await page.getByRole('button', { name: /Sandbox Customer RMAs/i }).click();
      await page.locator('input[placeholder*="Search" i]').first().fill(seededRma);
      const rmaRow = page.locator('tr', { hasText: seededRma }).first();
      await expect(rmaRow).toBeVisible({ timeout: 10_000 });

      await rmaRow.getByRole('button', { name: /Inspect \/ Triage/i }).click();
      await expect(page.getByText('RMA Quick Processing')).toBeVisible();
      await page.getByRole('button', { name: /Edit Details & Documents/i }).click();
      await page.locator('input[type="number"][min="1"]').first().fill('350');
      await page.getByRole('button', { name: /Save & Apply Restitution/i }).click();
      await expect(page.getByText(/Super Admin Approved \(> ₱10,000 Claim\)/i)).toBeVisible({
        timeout: 25_000
      });
      await page.getByRole('button', { name: /Done \/ Close/i }).click();

      // 3. Open Sandbox Credit Memos sub-tab & exercise Issue Credit Memo modal (POR, Stepper, Unit Price, 90%, 100%, Save & View Voucher)
      await page.getByRole('button', { name: /Sandbox Credit Memos/i }).click();
      await expect(page.getByText(/Finance Credit Memorandum Section/i)).toBeVisible();

      await page.getByRole('button', { name: /Issue.*Credit Memo/i }).first().click();
      await expect(page.getByText(/Issue Finance Credit Memo/i)).toBeVisible();

      // Select our seeded Test Mode RMA in the linked ticket picker
      const ticketSelect = page.locator('#credit-memo-form').locator('..').locator('select').first();
      if (await ticketSelect.isVisible().catch(() => false)) {
        const optValue = await ticketSelect.evaluate((el, targetRma) => {
          const opt = Array.from(el.options).find((o) => o.text.includes(targetRma));
          return opt ? opt.value : '';
        }, seededRma);
        if (optValue) {
          await ticketSelect.selectOption(optValue);
        }
      }

      // Exercise Quantity +/- stepper, Unit Price w/ VAT (exact 12,000.00 = 200 * 60.00), Regenerate POR, 90% (-10%) & 100% Full
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

      // Test 90% (-10%) then 100% Full
      await page.getByRole('button', { name: /90% \(-10%\)/i }).click();
      await expect(creditAmtInput).toHaveValue('10800.00');
      await page.getByRole('button', { name: /100% Full/i }).click();
      await expect(creditAmtInput).toHaveValue('12000.00');

      // Regenerate POR reference code
      const porInput = page.locator('#credit-memo-form input[placeholder*="POR-"]').first();
      const porBefore = await porInput.inputValue();
      await page.getByRole('button', { name: /Regenerate POR/i }).click();
      await expect(porInput).not.toHaveValue(porBefore);

      // Save & View Voucher -> CreditMemoVoucherModal -> Print Voucher / Save PDF
      await page.getByRole('button', { name: /Save & View Voucher/i }).click();
      await expect(page.getByText('FINANCE CREDIT MEMORANDUM', { exact: true })).toBeVisible({
        timeout: 20_000
      });
      await expect(page.getByText(/₱12,000\.00/).first()).toBeVisible();

      const cmPrintBefore = await page.evaluate(() => window.__pwPrintCount || 0);
      await page.getByRole('button', { name: /Print Voucher \/ Save PDF/i }).click();
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => window.__pwPrintCount || 0)).toBeGreaterThan(cmPrintBefore);

      // Close CreditMemoVoucherModal
      await page.locator('#credit-memo-voucher-print-root button:has(svg.lucide-x)').first().click();
      await expect(page.locator('#credit-memo-voucher-print-root')).toBeHidden();

      // 4. Verify row appears in Sandbox Credit Memos, verify 12% VAT breakdown in Export CSV, Print, Edit, then Void/Delete cleanly
      const cmSearch = page.locator('input[placeholder*="Search by CM #" i]').first();
      await cmSearch.fill(seededRma);
      const cmRow = page.locator('tr', { hasText: seededRma }).first();
      await expect(cmRow).toBeVisible({ timeout: 20_000 });

      // Verify 12% VAT breakdown in Export CSV (12000 / 1.12 = 10714.29 Net, 1285.71 VAT)
      const [cmCsvDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('button[title="Export all credit memos to Excel CSV"]').click()
      ]);
      const csvPath = await cmCsvDownload.path();
      if (csvPath) {
        const csvContent = fs.readFileSync(csvPath, 'utf-8');
        expect(csvContent).toContain('12% VAT Amount (PHP)');
        expect(csvContent).toContain('1285.71');
      }

      // Click row Print Official Credit Voucher icon
      await cmRow.locator('button[title="Print Official Credit Voucher"]').click();
      await expect(page.getByText('FINANCE CREDIT MEMORANDUM', { exact: true })).toBeVisible();
      await page.locator('#credit-memo-voucher-print-root button:has(svg.lucide-x)').first().click();
      await expect(page.locator('#credit-memo-voucher-print-root')).toBeHidden();

      // Click row Edit Credit Memo -> Update Credit Memo
      await cmRow.locator('button[title="Edit Credit Memo"]').click();
      await expect(page.getByText('Edit Finance Credit Memo')).toBeVisible();
      await page
        .locator('#credit-memo-form textarea')
        .fill('Playwright verified 12% VAT & >10k governance');
      await page.getByRole('button', { name: /Update Credit Memo/i }).click();
      await expect(page.getByText('Edit Finance Credit Memo')).toBeHidden({ timeout: 10_000 });

      // Void / Delete synthetic Sandbox Credit Memo cleanly
      await cmRow.locator('button[title="Void / Delete Credit Memo"]').click();
      await page.getByRole('button', { name: /Yes, Delete Permanently/i }).click();
      await expect(page.getByRole('button', { name: /Yes, Delete Permanently/i })).toBeHidden({
        timeout: 15_000
      });
      await expect(cmRow).toBeHidden({ timeout: 10_000 });

      // 5. Permanently delete seeded synthetic RMA via Trash Bin
      await page.getByRole('button', { name: /Sandbox Customer RMAs/i }).click();
      await page.locator('input[placeholder*="Search" i]').first().fill(seededRma);
      const cleanupRow = page.locator('tr', { hasText: seededRma }).first();
      if (await cleanupRow.isVisible({ timeout: 4000 }).catch(() => false)) {
        await cleanupRow.locator(`button[title*="Move RMA #${seededRma} to 30-Day Trash Bin"]`).click();
        await page.getByRole('button', { name: /Move to Trash/i }).click();
        await expect(page.getByText(/Move to Trash \(30-Day Recovery\)\?/i)).toBeHidden({
          timeout: 15_000
        });
        await page.getByRole('button', { name: /Archive & Trash/i }).click();
        await page.getByRole('button', { name: /Trash Bin/i }).click();
        await page.locator('input[placeholder*="Search" i]').first().fill(seededRma);
        const trashed = page.locator('tr', { hasText: seededRma }).first();
        await expect(trashed).toBeVisible({ timeout: 8000 });
        await trashed.locator('button[title="Permanently destroy this record forever"]').click();
        await expect(trashed).toBeHidden({ timeout: 10_000 });
      }

      guard.assertClean('suite 05 credit memos, VAT breakdown & governance');
    } finally {
      if (seededRma) {
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
                  `${url}/rest/v1/credit_memos?rma_number=eq.${encodeURIComponent(rmaNum)}`,
                  { method: 'DELETE', headers }
                );
                await fetch(
                  `${url}/rest/v1/rma_reports?rma_number=eq.${encodeURIComponent(rmaNum)}`,
                  { method: 'DELETE', headers }
                );
              }
            } catch {}
          }, { rmaNum: seededRma, url: supaUrl, key: anonKey })
          .catch(() => {});
      }
      page.off('dialog', onDialog);
      guard.detach();
    }
  });

  test('Settings & SMTP tab: Supabase test, SMTP test, Catalog API test, Email Recipients, Locations, Invites Poster, Test Mode toggle & API Key Vault generate/rotate/revoke', async ({
    page,
    context
  }) => {
    test.setTimeout(180_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
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

      // 1. Test Mode toggle (ON <-> OFF and restore initial state)
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
      await expect(settingsTestToggle).toContainText(
        wasTestOn ? /Test Mode:\s*ON/i : /Test Mode:\s*OFF/i
      );

      // 2. Supabase Connection Test
      const supaCard = page.locator('div:has(> div:has-text("Supabase Cloud Database"))').first();
      const supaBtn = supaCard.getByRole('button', { name: /Test Connection/i }).first();
      if (await supaBtn.isVisible().catch(() => false)) {
        await supaBtn.click();
        await expect(supaBtn).toContainText(/Test Connection/i, { timeout: 15_000 });
      } else {
        await page.getByRole('button', { name: /Test Connection/i }).first().click();
        await page.waitForTimeout(1000);
      }

      // 3. Google SMTP Credentials Test
      const smtpBtn = page.getByRole('button', { name: /Test SMTP Credentials/i });
      await expect(smtpBtn).toBeVisible();
      await smtpBtn.click();
      await expect(smtpBtn).toContainText(/Test SMTP Credentials/i, { timeout: 15_000 });

      // 4. Live Product Catalog API Test Connection (if configured; avoid triggering 401 on invalid key)
      const poTestBtn = page.getByRole('button', { name: /Test Connection/i }).last();
      if (await poTestBtn.isVisible().catch(() => false)) {
        await poTestBtn.click();
        await expect(poTestBtn).toContainText(/Test Connection/i, { timeout: 15_000 });
      }

      // 5. Email Recipients: Add CC -> Save Recipients -> clean up temp CC -> Reset Defaults / Restore
      const ccInput = page.locator('input[placeholder*="cc" i], input[placeholder*="Add CC" i]').first();
      if (await ccInput.isVisible().catch(() => false)) {
        await ccInput.fill('pw-temp-cc@pingcon.local');
        await page.getByRole('button', { name: /Add CC/i }).click();
        await expect(page.getByText('pw-temp-cc@pingcon.local', { exact: true })).toBeVisible();
        // Remove our temp CC chip so company recipients remain clean
        const tempChip = page.locator('button[title="Remove pw-temp-cc@pingcon.local"]').first();
        if (await tempChip.isVisible().catch(() => false)) {
          await tempChip.click();
          await expect(page.getByText('pw-temp-cc@pingcon.local', { exact: true })).toBeHidden();
        }
        await page.getByRole('button', { name: /Save Recipients/i }).click();
        await page.waitForTimeout(400);
      }

      // 6. "View & Download Poster" opens CustomerRMAInvitesModal -> close cleanly
      await page.getByRole('button', { name: /View & Download Poster/i }).click();
      await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible({
        timeout: 10_000
      });
      await page.getByRole('button', { name: 'Close', exact: true }).click();

      // 7. "⚙️ Manage Locations" -> WarehouseLocationsModal add/rename/delete/close
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
      await locModal
        .locator('div:has(> div > div > h3:has-text("Warehouse Locations & Areas")) > button')
        .click();
      await expect(locModal).toBeHidden();

      // 8. API Key Vault: Refresh -> Generate -> Copy -> Rotate -> Copy -> Revoke
      const refreshKeysBtn = page.getByRole('button', { name: 'Refresh', exact: true });
      await expect(refreshKeysBtn).toBeVisible();
      await refreshKeysBtn.click();
      await page.waitForTimeout(400);

      await page.getByRole('button', { name: /Generate New Key/i }).click();
      await expect(page.getByText('Issue New API Key')).toBeVisible();
      await page.getByRole('button', { name: 'Generate Key', exact: true }).click();
      await expect(page.getByText('API Key Generated Successfully')).toBeVisible({ timeout: 25_000 });

      const maskedCodeLocator = page
        .locator('div:has-text("Masked representation:") code')
        .last();
      const createdMaskedKey = (await maskedCodeLocator.innerText()).trim();
      trackedMaskedKeys.add(createdMaskedKey);
      await page.getByRole('button', { name: /^Copy$/i }).click();
      await page.getByRole('button', { name: /I have saved this key safely/i }).click();

      // Rotate our newly generated key row specifically
      const createdKeyRow = page.locator('tr', { hasText: createdMaskedKey }).first();
      await expect(createdKeyRow).toBeVisible({ timeout: 25_000 });
      await createdKeyRow
        .locator('button[title="Rotate API Key (Invalidate current and create new)"]')
        .click();
      await expect(page.getByText('API Key Rotated Successfully')).toBeVisible({ timeout: 25_000 });

      const rotatedMaskedKey = (
        await page.locator('div:has-text("Masked representation:") code').last().innerText()
      ).trim();
      trackedMaskedKeys.delete(createdMaskedKey);
      trackedMaskedKeys.add(rotatedMaskedKey);
      await page.getByRole('button', { name: /^Copy$/i }).click();
      await page.getByRole('button', { name: /I have saved this key safely/i }).click();

      // Revoke and permanently delete ONLY the synthetic rotated key
      const rotatedKeyRow = page.locator('tr', { hasText: rotatedMaskedKey }).first();
      await expect(rotatedKeyRow).toBeVisible({ timeout: 25_000 });
      await rotatedKeyRow.locator('button[title="Revoke and Delete API Key"]').click();
      await expect(rotatedKeyRow).toBeHidden({ timeout: 25_000 });
      trackedMaskedKeys.delete(rotatedMaskedKey);

      guard.assertClean('suite 05 settings, SMTP, locations & API key vault');
    } finally {
      if (trackedMaskedKeys.size > 0) {
        const { supaUrl, anonKey } = readSupabasePublicEnv();
        await page
          .evaluate(async ({ masks, url, key }) => {
            try {
              const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
              const rawAuth = supaKey ? JSON.parse(localStorage.getItem(supaKey)) : null;
              const token = rawAuth?.access_token;
              if (url && key && token) {
                const headers = {
                  apikey: key,
                  Authorization: `Bearer ${token}`
                };
                for (const m of masks) {
                  await fetch(
                    `${url}/rest/v1/api_keys?masked_key=eq.${encodeURIComponent(m)}`,
                    { method: 'DELETE', headers }
                  );
                }
              }
            } catch {}
          }, { masks: Array.from(trackedMaskedKeys), url: supaUrl, key: anonKey })
          .catch(() => {});
      }
      page.off('dialog', onDialog);
      guard.detach();
    }
  });
});
