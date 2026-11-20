import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import {
  PNG_BUFFER,
  VERIFIED_BARCODE,
  attachStrictGuards,
  installPrintStubs,
  interceptAndCaptureEmails,
  isoDateDaysOffset,
  gotoAdmin,
  readSupabasePublicEnv
} from './helpers/testUtils.js';

function assertEmailPayloadClean({ payload, expectedExpiry, expectTestMode }) {
  expect(payload).toBeTruthy();
  expect(Boolean(payload.isTestMode)).toBe(expectTestMode);

  if (expectTestMode) {
    expect(payload.subject).toMatch(/^Test - /);
    expect(payload.fromName).toContain('[TEST]');
  } else {
    expect(payload.subject).not.toMatch(/^Test - /);
    expect(payload.fromName).not.toContain('[TEST]');
  }

  // Unambiguous Expiry Date (YYYY-MM-DD) & Submission Date (YYYY-MM-DD HH:mm)
  expect(payload.html).toContain('Expiry Date (YYYY-MM-DD):');
  expect(payload.html).toContain('Submission Date (YYYY-MM-DD HH:mm):');
  expect(payload.html).toContain(expectedExpiry);
  expect(payload.text).toContain('Expiry Date:');
  expect(payload.text).toContain(expectedExpiry);

  // Pingcon branding present, zero "wholesale" (case-insensitive) anywhere
  const combined = [payload.subject, payload.fromName, payload.html, payload.text].join('\n');
  expect(combined).toContain('Pingcon');
  expect(combined.toLowerCase()).not.toContain('wholesale');
}

function decodeBase64Header(b64) {
  return Buffer.from(String(b64 || ''), 'base64').toString('latin1');
}

test.describe('Suite 07: Emails (Intake + 4 Lifecycle Events w/ PDF), mgan@a2z2go.net Sandbox & Overall RMA Matrix (.xlsx)', () => {
  test('New RMA intake email (Live & Test), 4 lifecycle emails (Scrapped, Restocked, Debit Pickup + PDF, Replacement Pickup + PDF), & Overall Matrix (.xlsx) deep XML verification', async ({
    page,
    context
  }) => {
    test.setTimeout(180_000);
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);
    const capturedEmails = await interceptAndCaptureEmails(page);
    const seededTestRmas = [];

    // Mock photo upload endpoint so 5-photo driver pickup runs deterministically without Drive network flakiness
    await page.route('**/api/upload-photo**', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        const idx = Date.now() % 10000;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            url: `https://drive.google.com/uc?id=pw_mock_photo_${idx}`,
            previewUrl: `https://drive.google.com/uc?id=pw_mock_photo_${idx}`,
            rmaFolderId: 'pw_mock_folder_id',
            rmaFolderUrl: 'https://drive.google.com/drive/folders/pw_mock_folder_id',
            fileId: `pw_mock_photo_${idx}`,
            provider: 'google_drive'
          })
        });
      }
      return route.continue();
    });

    try {
      // =========================================================================
      // 1. LIVE MODE NEW RMA EMAIL CHECK (intercepted DB & Email)
      // =========================================================================
      await page.route('**/rest/v1/rma_reports**', async (route) => {
        const req = route.request();
        if (req.method() === 'POST') {
          let body = {};
          try {
            const parsed = req.postDataJSON();
            body = Array.isArray(parsed) ? parsed[0] : parsed;
          } catch {}
          if (body && !String(body.rma_number || '').startsWith('RMA-TEST-') && body.is_test !== true) {
            return route.fulfill({
              status: 201,
              contentType: 'application/json',
              body: JSON.stringify({
                id: 999999,
                ...body,
                created_at: new Date().toISOString()
              })
            });
          }
        }
        return route.continue();
      });

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.getByText(/Scan Product Barcode or RMA Sticker QR/i)).toBeVisible({ timeout: 20_000 });

      const toggleBtn = page.locator('button[title="Toggle Test / Sandbox Mode"]');
      await expect(toggleBtn).toBeVisible();
      if (/Test Mode:\s*ON/i.test(await toggleBtn.innerText())) {
        await toggleBtn.click();
      }
      await expect(page.getByText('🟢 Live Delivery Mode Active')).toBeVisible();

      const barcodeField = page.locator('input[placeholder*="Barcode" i], input[placeholder*="barcode" i]').first();
      await barcodeField.fill(VERIFIED_BARCODE);
      await expect(page.getByText('Recognized Product')).toBeVisible({ timeout: 12_000 });

      await page.locator('input[type="date"]').first().fill('2027-03-15');
      await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({
        name: 'pw-live-expiry.png',
        mimeType: 'image/png',
        buffer: PNG_BUFFER
      });
      await expect(page.getByText('1/10 photos')).toBeVisible();
      await page.locator('input[placeholder="Your Full Name *"]').fill('Playwright Live Email Tester');
      await page.locator('input[placeholder="Phone No. or Email *"]').fill('playwright-live@pingcon.local');

      await page.getByRole('button', { name: /Submit Return Report/i }).click();
      await expect(page.getByText('Box Sticker Ready')).toBeVisible({ timeout: 20_000 });

      await expect.poll(() => capturedEmails.length, { timeout: 15_000 }).toBeGreaterThan(0);
      assertEmailPayloadClean({
        payload: capturedEmails[0],
        expectedExpiry: '2027-03-15',
        expectTestMode: false
      });

      // =========================================================================
      // 2. TEST MODE SEEDING + ALL 4 LIFECYCLE EMAILS (Scrapped, Restocked, Debit PDF, Replacement PDF)
      // =========================================================================
      await page.getByRole('button', { name: /Report Another/i }).click();
      await toggleBtn.click();
      await expect(page.getByText('🧪 Super Admin Sandbox Active')).toBeVisible();
      await expect(page.getByText(/mgan@a2z2go\.net/)).toBeVisible();

      await page.locator('input[placeholder*="barcode" i]').first().fill(VERIFIED_BARCODE);
      await expect(page.getByText('Recognized Product')).toBeVisible({ timeout: 12_000 });
      await page.locator('input[type="date"]').first().fill('2027-08-20');
      await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({
        name: 'pw-lifecycle-test.png',
        mimeType: 'image/png',
        buffer: PNG_BUFFER
      });
      await page.locator('input[placeholder="Your Full Name *"]').fill('Playwright Lifecycle Tester');
      await page.locator('input[placeholder="Phone No. or Email *"]').fill('playwright-lc@pingcon.local');

      const countBeforeTestSubmit = capturedEmails.length;
      await page.getByRole('button', { name: /Submit Return Report/i }).click();
      await expect(page.getByText('Box Sticker Ready')).toBeVisible({ timeout: 20_000 });

      const rmaNum = (
        await page
          .locator('.font-mono.font-black.text-slate-900, .font-mono.font-black.dark\\:text-white')
          .filter({ hasText: /^RMA-TEST-/ })
          .first()
          .innerText()
      ).trim();
      seededTestRmas.push(rmaNum);

      await expect.poll(() => capturedEmails.length, { timeout: 15_000 }).toBeGreaterThan(countBeforeTestSubmit);
      assertEmailPayloadClean({
        payload: capturedEmails[capturedEmails.length - 1],
        expectedExpiry: '2027-08-20',
        expectTestMode: true
      });

      // Open 4-Choice Wizard directly from Success Screen!
      await page.getByRole('button', { name: /Choose Disposition \/ Driver Pickup/i }).click();
      await expect(page.getByText('What do you want to do with this item?')).toBeVisible({ timeout: 10_000 });

      // (a) Scrapped lifecycle email
      const countBeforeScrap = capturedEmails.length;
      await page.getByRole('button', { name: /Throw Away \/ Dispose \(Scrap\)/i }).click();
      await page.getByRole('button', { name: /Confirm & Save: Throw Away \/ Dispose \(Scrap\)/i }).click();
      await expect(page.getByText(/Decision Saved/i).first()).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => capturedEmails.length, { timeout: 12_000 }).toBeGreaterThan(countBeforeScrap);
      const scrapMail = capturedEmails[capturedEmails.length - 1];
      expect(scrapMail.isTestMode).toBe(true);
      expect(scrapMail.subject).toMatch(/^Test - \[RMA Scrapped\]/);

      // (b) Restocked lifecycle email
      await page.getByRole('button', { name: /Change Decision/i }).click();
      const countBeforeRestock = capturedEmails.length;
      await page.getByRole('button', { name: /Put Back on Good Shelf \(Restock\)/i }).click();
      await page.getByRole('button', { name: /Confirm & Save: Put Back on Good Shelf \(Restock\)/i }).click();
      await expect(page.getByText(/Decision Saved/i).first()).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => capturedEmails.length, { timeout: 12_000 }).toBeGreaterThan(countBeforeRestock);
      const restockMail = capturedEmails[capturedEmails.length - 1];
      expect(restockMail.isTestMode).toBe(true);
      expect(restockMail.subject).toMatch(/^Test - \[RMA Restocked\]/);

      // Helper for completing 5-photo driver pickup for Debit Claim or Replacement
      const completeDriverPickup = async (optionRegex) => {
        await page.getByRole('button', { name: /Change Decision/i }).click();
        await page.locator('input[placeholder*="Supplier Company Name" i]').fill('Suy Sing Commercial Corp');
        await page.getByRole('button', { name: optionRegex }).click();
        await page.getByRole('button', { name: /Driver Is Here — Upload Photos & Print Letter/i }).click();
        await expect(page.getByText(/Driver Pickup Verification/i)).toBeVisible();

        const emailToInput = page.locator('input[placeholder*="claims@supplier.com" i]');
        await emailToInput.fill('vendor-claims@example.com');
        const emailCcInput = page.locator('input[placeholder*="ap@supplier.com" i]');
        await emailCcInput.fill('vendor-cc@example.com');

        const photoFileInputs = page.locator('input[type="file"][accept="image/*"]');
        const slotCount = await photoFileInputs.count();
        for (let i = 0; i < slotCount; i++) {
          await photoFileInputs.nth(i).setInputFiles({
            name: `pickup-slot-${i + 1}.png`,
            mimeType: 'image/png',
            buffer: PNG_BUFFER
          });
        }
        await expect(page.getByText(/Driver Pickup Verification \(5\/5 Photos\)/i)).toBeVisible();

        await page.locator('input[placeholder*="Juan Dela Cruz" i]').fill('Playwright Driver');
        await page.locator('input[placeholder*="ABC 1234" i]').fill('PW-8899');

        const mailCountBefore = capturedEmails.length;
        await page
          .getByRole('button', { name: /Upload 5 Photos to RMA Drive|Save Updates & Open Letter Form/i })
          .click();
        await expect(page.getByText(/SUPPLIER (DEBIT CLAIM|REPLACEMENT \/ EXCHANGE)/i)).toBeVisible({
          timeout: 25_000
        });

        // Verify pure B&W Letter modal and close it before next step
        const formPrintBtn = page.getByRole('button', { name: /Print Letter Form/i });
        const formPrintsBefore = await page.evaluate(() => window.__pwPrintCount || 0);
        await formPrintBtn.click();
        await expect.poll(() => page.evaluate(() => window.__pwPrintCount || 0), { timeout: 8_000 }).toBeGreaterThan(formPrintsBefore);

        await page.locator('button[aria-label="Close form"]').click();
        await expect.poll(() => capturedEmails.length, { timeout: 15_000 }).toBeGreaterThan(mailCountBefore);
        return capturedEmails[capturedEmails.length - 1];
      };

      // (c) Driver Picked Up for Debit Claim -> PDF + Supplier To/CC + 5 photos
      const debitMail = await completeDriverPickup(/Return to supplier for Debit Claim/i);
      expect(debitMail.isTestMode).toBe(true);
      expect(debitMail.subject).toMatch(/^Test - \[Driver Picked Up - Debit Claim\]/);
      expect(debitMail.to).toContain('vendor-claims@example.com');
      expect(debitMail.cc).toContain('vendor-cc@example.com');
      expect(debitMail.html).toContain('Driver Pickup Verification Photos (5/5)');
      const debitPdfAtt = (debitMail.attachments || []).find((a) => String(a.filename || '').startsWith('Debit-Claim-Form-'));
      expect(debitPdfAtt).toBeTruthy();
      expect(debitPdfAtt.contentType).toBe('application/pdf');
      expect(decodeBase64Header(debitPdfAtt.content).startsWith('%PDF-1.4')).toBe(true);

      // (d) Driver Picked Up for Replacement -> PDF + Supplier To/CC + 5 photos
      const replaceMail = await completeDriverPickup(/Return to supplier for Replacement \/ Exchange/i);
      expect(replaceMail.isTestMode).toBe(true);
      expect(replaceMail.subject).toMatch(/^Test - \[Driver Picked Up - Replacement\]/);
      expect(replaceMail.to).toContain('vendor-claims@example.com');
      expect(replaceMail.cc).toContain('vendor-cc@example.com');
      const replacePdfAtt = (replaceMail.attachments || []).find((a) => String(a.filename || '').startsWith('Replacement-Form-'));
      expect(replacePdfAtt).toBeTruthy();
      expect(replacePdfAtt.contentType).toBe('application/pdf');
      expect(decodeBase64Header(replacePdfAtt.content).startsWith('%PDF-1.4')).toBe(true);

      await page.locator('button[aria-label="Close modal"]').first().click();

      // =========================================================================
      // 3. OVERALL RMA MATRIX (.XLSX) EXPORT VERIFICATION IN ADMIN SANDBOX + LIVE
      // =========================================================================
      await gotoAdmin(page);
      await page.getByRole('button', { name: /Test Mode Sandbox/i }).first().click();
      await page.getByRole('button', { name: /Sandbox Overall Matrix \(\.xlsx\)/i }).first().click();
      await expect(page.getByText('Overall RMA Matrix (.xlsx)')).toBeVisible();
      await page.getByRole('button', { name: /Last 14 Days/i }).click();
      const [testMatrixDl] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Download Excel Matrix \(\.xlsx\)/i }).click()
      ]);
      const testMatrixName = testMatrixDl.suggestedFilename();
      expect(testMatrixName).toMatch(/^TEST_Overall_RMA_Matrix_Report_\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2} \d{4}\.xlsx$/);
      const testMatrixPath = await testMatrixDl.path();
      if (testMatrixPath) {
        const xmlStr = fs.readFileSync(testMatrixPath).toString('utf8');
        expect(xmlStr).toContain('xSplit="5" ySplit="5" topLeftCell="F6"');
        expect(xmlStr).toContain('Serial No.');
        expect(xmlStr).toContain('Supplier Name');
        expect(xmlStr).toContain('Return Bad Stock (pcs)');
        expect(xmlStr).toContain('Return Good Stock (pcs)');
        expect(xmlStr).toContain('DAILY RETURNED PIECES (YYYY-MM-DD)');
        expect(xmlStr).toContain('Danilo RMA');
        expect(xmlStr).toContain('RMA ITEM DETAILS &amp; WORKFLOW STATUS');
        expect(xmlStr).toContain('Picked Up by Driver?');
        expect(xmlStr).toContain('Driver Pickup Date &amp; Time (YYYY-MM-DD HH:mm)');
        expect(xmlStr).toContain('outlineLevel="1"');
        expect(xmlStr).toContain('SUM(');
        expect(xmlStr).toContain(rmaNum);
        expect(xmlStr).not.toContain('BASKETPOPROC');
        expect(xmlStr).not.toContain('Buffer (30%)');
        expect(xmlStr).not.toContain('Cases to PO');
        expect(xmlStr).not.toContain('Total Quantity Needed');
      }
      await page.getByRole('button', { name: 'Close', exact: true }).click();

      guard.assertClean('suite 07 lifecycle emails + pdf + overall matrix xlsx');
    } finally {
      const { supaUrl, anonKey } = readSupabasePublicEnv();
      for (const targetRma of seededTestRmas) {
        await page
          .evaluate(async ({ rma, url, key }) => {
            try {
              const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
              const token = supaKey ? JSON.parse(localStorage.getItem(supaKey))?.access_token : null;
              if (url && key && token) {
                await fetch(`${url}/rest/v1/rma_reports?rma_number=eq.${encodeURIComponent(rma)}`, {
                  method: 'DELETE',
                  headers: { apikey: key, Authorization: `Bearer ${token}` }
                });
                const sRes = await fetch(`${url}/rest/v1/rma_settings?key=eq.supplier_claims_store&select=value`, {
                  headers: { apikey: key, Authorization: `Bearer ${token}` }
                });
                const sJson = await sRes.json();
                if (Array.isArray(sJson?.[0]?.value)) {
                  const filtered = sJson[0].value.filter((c) => !c.items?.some((it) => it.rma_number === rma));
                  await fetch(`${url}/rest/v1/rma_settings?key=eq.supplier_claims_store`, {
                    method: 'PATCH',
                    headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ value: filtered })
                  });
                }
              }
            } catch {}
          }, { rma: targetRma, url: supaUrl, key: anonKey })
          .catch(() => {});
      }
      guard.detach();
    }
  });
});
