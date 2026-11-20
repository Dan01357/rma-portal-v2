import { test, expect } from '@playwright/test';
import {
  PNG_BUFFER,
  VERIFIED_BARCODE,
  attachStrictGuards,
  installPrintStubs
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

  // Expiry Date must be present in both HTML and plain-text fallback
  expect(payload.html).toContain('Expiry Date:');
  expect(payload.html).toContain(expectedExpiry);
  expect(payload.text).toContain('Expiry Date:');
  expect(payload.text).toContain(expectedExpiry);

  // Pingcon branding present, zero "wholesale" (case-insensitive) anywhere
  const combined = [payload.subject, payload.fromName, payload.html, payload.text].join('\n');
  expect(combined).toContain('Pingcon');
  expect(combined.toLowerCase()).not.toContain('wholesale');
}

test.describe('Suite 07: Email Expiry Date & Pingcon Branding (Live Mode + Test Mode)', () => {
  test('Test Mode RMA submission dispatches /api/send-email with Expiry Date and Pingcon branding (zero Wholesale)', async ({
    page,
    context
  }) => {
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);
    const capturedEmails = [];

    await page.route('**/api/send-email**', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        try {
          capturedEmails.push(req.postDataJSON());
        } catch {}
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, mocked: true })
      });
    });

    try {
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

      const barcodeField = page.locator('input[placeholder*="Barcode" i], input[placeholder*="barcode" i]').first();
      await barcodeField.fill(VERIFIED_BARCODE);
      await expect(page.getByText('Recognized Product')).toBeVisible({ timeout: 12_000 });

      const expiryInput = page.locator('input[type="date"]').first();
      await expiryInput.fill('2026-12-31');

      await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({
        name: 'pw-test-expiry.png',
        mimeType: 'image/png',
        buffer: PNG_BUFFER
      });
      await expect(page.getByText('1/10 photos')).toBeVisible();

      await page.locator('input[placeholder="Your Full Name *"]').fill('Playwright Email Tester');
      await page.locator('input[placeholder="Phone No. or Email *"]').fill('playwright-email@pingcon.local');

      await page.getByRole('button', { name: /Submit Return Report/i }).click();
      await expect(page.getByText('Box Sticker Ready')).toBeVisible({ timeout: 20_000 });

      await expect.poll(() => capturedEmails.length, { timeout: 15_000 }).toBeGreaterThan(0);
      assertEmailPayloadClean({
        payload: capturedEmails[0],
        expectedExpiry: '2026-12-31',
        expectTestMode: true
      });

      guard.assertClean('Test Mode email expiry & Pingcon branding');
    } finally {
      guard.detach();
    }
  });

  test('Live Mode RMA submission dispatches /api/send-email with Expiry Date and Pingcon branding (zero Wholesale)', async ({
    page,
    context
  }) => {
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);
    const capturedEmails = [];

    // Intercept /api/send-email to inspect payload without sending real SMTP
    await page.route('**/api/send-email**', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        try {
          capturedEmails.push(req.postDataJSON());
        } catch {}
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, mocked: true })
      });
    });

    // Intercept Live DB POSTs to rma_reports so Live database stays 100% clean
    await page.route('**/rest/v1/rma_reports**', async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        let body = {};
        try {
          const parsed = req.postDataJSON();
          body = Array.isArray(parsed) ? parsed[0] : parsed;
        } catch {}
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 999999,
            ...body,
            created_at: new Date().toISOString()
          })
        });
        return;
      }
      await route.continue();
    });

    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.getByText(/Scan Product Barcode or RMA Sticker QR/i)).toBeVisible({
        timeout: 20_000
      });

      const toggleBtn = page.locator('button[title="Toggle Test / Sandbox Mode"]');
      await expect(toggleBtn).toBeVisible();
      if (/Test Mode:\s*ON/i.test(await toggleBtn.innerText())) {
        await toggleBtn.click();
      }
      await expect(page.getByText('🟢 Live Delivery Mode Active')).toBeVisible();

      const barcodeField = page.locator('input[placeholder*="Barcode" i], input[placeholder*="barcode" i]').first();
      await barcodeField.fill(VERIFIED_BARCODE);
      await expect(page.getByText('Recognized Product')).toBeVisible({ timeout: 12_000 });

      const expiryInput = page.locator('input[type="date"]').first();
      await expiryInput.fill('2027-03-15');

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

      guard.assertClean('Live Mode email expiry & Pingcon branding');
    } finally {
      guard.detach();
    }
  });
});
