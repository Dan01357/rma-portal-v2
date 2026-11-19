import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  PNG_BUFFER,
  VERIFIED_BARCODE,
  attachStrictGuards,
  installPrintStubs
} from './helpers/testUtils.js';

function readSupabasePublicEnv() {
  let supaUrl = process.env.VITE_SUPABASE_URL || '';
  let anonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
  for (const filename of ['.env.local', '.env']) {
    if (supaUrl && anonKey) break;
    const envPath = path.resolve(process.cwd(), filename);
    if (!fs.existsSync(envPath)) continue;
    const raw = fs.readFileSync(envPath, 'utf8');
    if (!supaUrl) supaUrl = (raw.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1] || '').trim().replace(/^["']|["']$/g, '');
    if (!anonKey) anonKey = (raw.match(/^VITE_SUPABASE_ANON_KEY=(.+)$/m)?.[1] || '').trim().replace(/^["']|["']$/g, '');
  }
  return { supaUrl, anonKey };
}

async function setPublicPortalTestMode(page, enabled) {
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

async function submitPublicPortalRma(page, { isTestMode, reporterName }) {
  await setPublicPortalTestMode(page, isTestMode);

  // If previous submission success card is open, click Report Another
  const reportAnotherBtn = page.getByRole('button', { name: /Report Another/i });
  if (await reportAnotherBtn.isVisible().catch(() => false)) {
    await reportAnotherBtn.click();
  }

  await page.getByRole('button', { name: /Customer RMA Hub/i }).click();
  await page.locator('input[placeholder*="barcode" i]').first().fill(VERIFIED_BARCODE);
  await expect(page.getByText('Recognized Product')).toBeVisible({ timeout: 15_000 });

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
    { timeout: 25_000 }
  );

  await page.getByRole('button', { name: /Submit Return Report/i }).click();
  await expect(page.getByText('Box Sticker Ready')).toBeVisible({ timeout: 20_000 });

  const insertRes = await insertResponsePromise;
  expect(insertRes.status()).toBeLessThan(400);

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

  // Scanner modal must close cleanly after processing the scanned QR
  await expect(page.getByText('Product & RMA QR Scanner')).toBeHidden({ timeout: 10_000 });
}

test.describe('Suite 06: Public Portal QR Scanner -> 4-Option Wizard (Live & Test Mode + Cross-Mode Isolation)', () => {
  test('scans generated RMA QR codes in Live Mode and Test Mode, opens 4-option wizard, persists all choices, and blocks cross-mode scans', async ({
    page,
    context
  }) => {
    test.setTimeout(120_000);
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);

    let liveRmaNumber = null;
    let testRmaNumber = null;

    try {
      await page.goto('/', { waitUntil: 'commit', timeout: 30_000 });
      await expect(page.getByText(/Scan Product Barcode or RMA Sticker QR/i)).toBeVisible({
        timeout: 25_000
      });

      // =========================================================================
      // PART A: LIVE MODE — Generate Live RMA -> Scan PINGCON-RMA:LIVE:<RMA> -> 4-Option Wizard
      // =========================================================================
      liveRmaNumber = await submitPublicPortalRma(page, {
        isTestMode: false,
        reporterName: 'Playwright Live QR Tester'
      });

      // Cross-mode check in Live Mode: scanning a Test QR must be blocked with a clear visible alert
      await scanQrThroughPortalScanner(page, 'PINGCON-RMA:TEST:RMA-TEST-2026-9999-BLCK');
      await expect(page.getByText('What do you want to do with this item?')).toBeHidden();
      await expect(page.locator('[role="alert"]').filter({ hasText: /TEST MODE QR sticker/i }).first()).toBeVisible({
        timeout: 10_000
      });

      // Scan the newly generated Live Mode RMA QR via ScannerModal
      await scanQrThroughPortalScanner(page, `PINGCON-RMA:LIVE:${liveRmaNumber}`);

      // Assert 4-option wizard opens with all 4 options visible
      await expect(page.getByText('What do you want to do with this item?')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: /Return to supplier for Debit Claim/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Return to supplier for Replacement \/ Exchange/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Throw Away \/ Dispose \(Scrap\)/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Put Back on Good Shelf \(Restock\)/i })).toBeVisible();

      // Option 4 (Restock) persists cleanly in Live Mode without needing supplier name or 400 status error
      await page.getByRole('button', { name: /Put Back on Good Shelf \(Restock\)/i }).click();
      const liveRestockPatch = page.waitForResponse(
        (res) => res.url().includes('/rest/v1/rma_reports') && res.request().method() === 'PATCH',
        { timeout: 20_000 }
      );
      await page.getByRole('button', { name: /Confirm & Save: Put Back on Good Shelf \(Restock\)/i }).click();
      expect((await liveRestockPatch).status()).toBeLessThan(400);
      await expect(page.getByText('Supplier RTV Decision Saved!')).toBeVisible({ timeout: 15_000 });

      // Option 1 (Debit Claim - Wait Only) + Driver Pickup step verification in Live Mode
      await page.getByRole('button', { name: /Change Decision/i }).click();
      await page
        .locator('input[placeholder*="Supplier Company Name" i]')
        .fill('Playwright Live Vendor Corp');
      await page.getByRole('button', { name: /Return to supplier for Debit Claim/i }).click();
      const liveCreditPatch = page.waitForResponse(
        (res) => res.url().includes('/rest/v1/rma_reports') && res.request().method() === 'PATCH',
        { timeout: 20_000 }
      );
      await page.getByRole('button', { name: /Save Choice Only \(Waiting for Driver\)/i }).click();
      expect((await liveCreditPatch).status()).toBeLessThan(400);
      await expect(page.getByText('Supplier RTV Decision Saved!')).toBeVisible({ timeout: 15_000 });

      // Verify Driver Pickup step (5-photo flow) opens cleanly from Option 1
      await page.getByRole('button', { name: /Change Decision/i }).click();
      await page.getByRole('button', { name: /Return to supplier for Debit Claim/i }).click();
      await page.getByRole('button', { name: /Driver Is Here — Upload Photos & Print A4/i }).click();
      await expect(page.getByText(/Driver Pickup Verification \(0\/5 Photos\)/i)).toBeVisible();
      await page.getByRole('button', { name: /^Back$/i }).click();

      await page.locator('button[aria-label="Close modal"]').first().click();
      await expect(page.getByText('What do you want to do with this item?')).toBeHidden();

      // =========================================================================
      // PART B: TEST MODE — Generate Test RMA -> Scan PINGCON-RMA:TEST:<RMA> -> 4-Option Wizard
      // =========================================================================
      testRmaNumber = await submitPublicPortalRma(page, {
        isTestMode: true,
        reporterName: 'Playwright Test QR Tester'
      });

      // Cross-mode check in Test Mode: scanning the Live QR must be blocked with a clear visible alert
      await scanQrThroughPortalScanner(page, `PINGCON-RMA:LIVE:${liveRmaNumber}`);
      await expect(page.getByText('What do you want to do with this item?')).toBeHidden();
      await expect(
        page.locator('[role="alert"]').filter({ hasText: /LIVE PRODUCTION QR sticker/i }).first()
      ).toBeVisible({ timeout: 10_000 });

      // Scan the Test Mode RMA QR via ScannerModal
      await scanQrThroughPortalScanner(page, `PINGCON-RMA:TEST:${testRmaNumber}`);

      // Assert 4-option wizard opens with Test Mode badge & all 4 options visible
      await expect(page.getByText('What do you want to do with this item?')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('🧪 Test Mode').first()).toBeVisible();
      await expect(page.getByRole('button', { name: /Return to supplier for Debit Claim/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Return to supplier for Replacement \/ Exchange/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Throw Away \/ Dispose \(Scrap\)/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Put Back on Good Shelf \(Restock\)/i })).toBeVisible();

      // Option 3 (Scrap) persists cleanly in Test Mode
      await page.getByRole('button', { name: /Throw Away \/ Dispose \(Scrap\)/i }).click();
      const testScrapPatch = page.waitForResponse(
        (res) => res.url().includes('/rest/v1/rma_reports') && res.request().method() === 'PATCH',
        { timeout: 20_000 }
      );
      await page.getByRole('button', { name: /Confirm & Save: Throw Away \/ Dispose \(Scrap\)/i }).click();
      expect((await testScrapPatch).status()).toBeLessThan(400);
      await expect(page.getByText('Supplier RTV Decision Saved!')).toBeVisible({ timeout: 15_000 });

      // Option 2 (Replacement / Exchange - Wait Only) persists cleanly in Test Mode
      await page.getByRole('button', { name: /Change Decision/i }).click();
      await page
        .locator('input[placeholder*="Supplier Company Name" i]')
        .fill('Playwright Sandbox Vendor Corp');
      await page.getByRole('button', { name: /Return to supplier for Replacement \/ Exchange/i }).click();
      const testExchangePatch = page.waitForResponse(
        (res) => res.url().includes('/rest/v1/rma_reports') && res.request().method() === 'PATCH',
        { timeout: 20_000 }
      );
      await page.getByRole('button', { name: /Save Choice Only \(Waiting for Driver\)/i }).click();
      expect((await testExchangePatch).status()).toBeLessThan(400);
      await expect(page.getByText('Supplier RTV Decision Saved!')).toBeVisible({ timeout: 15_000 });

      await page.getByRole('button', { name: /^Done$/i }).click();
      await expect(page.getByText('Supplier RTV Decision Saved!')).toBeHidden();

      // Verify legacy ?rma= QR payload also opens 4-option wizard in Test Mode
      await scanQrThroughPortalScanner(page, `https://rma-portal-v2.vercel.app/?rma=${testRmaNumber}`);
      await expect(page.getByText('What do you want to do with this item?')).toBeVisible({ timeout: 15_000 });
      await page.locator('button[aria-label="Close modal"]').first().click();

      // Verify Test Mode record remained strictly tagged as Test in Supabase
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
      expect(persistedTestRow.disposition).toBe('supplier_exchange');
      expect(persistedTestRow.ai_document_metadata?.is_test).toBe(true);
      expect(String(persistedTestRow.notes || '')).toContain('[TEST_MODE]');

      guard.assertClean('suite 06 portal qr scanner 4-option wizard');
    } finally {
      // Clean up both synthetic Live & Test RMA rows so production and sandbox tables remain spotless
      const { supaUrl, anonKey } = readSupabasePublicEnv();
      for (const rmaNum of [liveRmaNumber, testRmaNumber].filter(Boolean)) {
        await page
          .evaluate(
            async ({ targetRma, url, key }) => {
              try {
                const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
                const token = supaKey ? JSON.parse(localStorage.getItem(supaKey))?.access_token : null;
                if (url && key && token) {
                  await fetch(
                    `${url}/rest/v1/rma_reports?rma_number=eq.${encodeURIComponent(targetRma)}`,
                    {
                      method: 'DELETE',
                      headers: {
                        apikey: key,
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json'
                      }
                    }
                  );
                }
              } catch {}
            },
            { targetRma: rmaNum, url: supaUrl, key: anonKey }
          )
          .catch(() => {});
      }
      // Leave Super Admin Test Mode OFF cleanly if needed or restore default
      guard.detach();
    }
  });
});
