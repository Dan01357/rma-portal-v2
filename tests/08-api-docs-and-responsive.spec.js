import { test, expect } from '@playwright/test';
import {
  VERIFIED_BARCODE,
  attachStrictGuards,
  installPrintStubs,
  gotoAdmin,
  assertNoHorizontalOverflow,
  cleanupTestRecords
} from './helpers/testUtils.js';

test.describe('Suite 08: REST API Endpoints, /docs & /api/context, Date Format Audit & Responsive Viewport Overflow', () => {
  test('verifies /docs, /api/openapi.json, /api/context, /PROJECT_CONTEXT.txt, /api/v1/* auth + CRUD & cleans up temporary key/RMA', async ({
    page,
    request
  }) => {
    const guard = attachStrictGuards(page, {
      allowHttp: [(res) => res.status() === 401 && res.url().includes('/api/v1/rma')]
    });

    let tempKeyId = null;
    let tempApiKeySecret = null;
    let createdApiRma = null;

    try {
      // 1. Documentation & Context endpoints
      const docsRes = await request.get('/docs');
      expect(docsRes.status()).toBe(200);
      const docsHtml = await docsRes.text();
      expect(docsHtml).toContain('/api/openapi.json');
      expect(docsHtml).toContain('@scalar/api-reference');

      const openapiRes = await request.get('/api/openapi.json');
      expect(openapiRes.status()).toBe(200);
      const openapiJson = await openapiRes.json();
      expect(openapiJson.openapi).toMatch(/^3\./);
      expect(openapiJson.paths).toHaveProperty('/api/v1/rma');
      expect(openapiJson.paths).toHaveProperty('/api/v1/rma-email-edit');
      expect(openapiJson.paths).toHaveProperty('/api/upload-photo');
      expect(openapiJson.paths).toHaveProperty('/api/send-email');
      expect(openapiJson.paths).toHaveProperty('/api/v1/products');
      expect(openapiJson.paths).toHaveProperty('/api/v1/credit-memos');
      expect(openapiJson.paths).toHaveProperty('/api/v1/health');
      expect(openapiJson.components?.schemas).toHaveProperty('SupplierPickupMetadata');
      expect(openapiJson.components?.schemas).toHaveProperty('FollowUpMetadata');
      const openapiRawStr = JSON.stringify(openapiJson);
      expect(openapiRawStr).toContain('customer_credit');
      expect(openapiRawStr).toContain('daily-followup');
      expect(openapiRawStr).toContain('inspect-plate');
      expect(openapiRawStr).toContain('ourCopyCount');
      expect(openapiRawStr).toContain('Credit Memos Ledger');
      expect(openapiRawStr).toContain('mgan@pingconmarketing.com');

      const ctxApiRes = await request.get('/api/context');
      expect(ctxApiRes.status()).toBe(200);
      expect(await ctxApiRes.text()).toContain('Pingcon');

      const ctxStaticRes = await request.get('/PROJECT_CONTEXT.txt');
      expect(ctxStaticRes.status()).toBe(200);
      expect(await ctxStaticRes.text()).toContain('wholesale-rma-portal');

      // 2. /api/v1/health & /api/v1/products/lookup (case-insensitive SKU + barcode)
      const healthRes = await request.get('/api/v1/health', { timeout: 45_000 });
      expect(healthRes.status()).toBe(200);
      const healthJson = await healthRes.json();
      expect(healthJson).toHaveProperty('status');

      const lookupSkuRes = await request.get('/api/v1/products/lookup?search=ss1319p', { timeout: 30_000 });
      expect(lookupSkuRes.status()).toBe(200);
      const lookupSkuJson = await lookupSkuRes.json();
      expect(lookupSkuJson.success).toBe(true);
      expect(Array.isArray(lookupSkuJson.data || lookupSkuJson.products || [])).toBe(true);

      const lookupBcRes = await request.get(`/api/v1/products/lookup?barcode=${VERIFIED_BARCODE}`, { timeout: 30_000 });
      expect(lookupBcRes.status()).toBe(200);
      const lookupBcJson = await lookupBcRes.json();
      expect(lookupBcJson.success).toBe(true);

      // 3. Unauthenticated GET /api/v1/rma MUST fail with HTTP 401
      const unauthRmaRes = await request.get('/api/v1/rma');
      expect(unauthRmaRes.status()).toBe(401);

      // 4. API Keys list + temporary test key creation -> authenticated CRUD across /api/v1/rma & /api/v1/credit-memos
      const keysListRes = await request.get('/api/v1/api-keys');
      expect(keysListRes.status()).toBe(200);
      const keysJson = await keysListRes.json();
      expect(keysJson.success).toBe(true);
      expect(Array.isArray(keysJson.keys)).toBe(true);

      const createKeyRes = await request.post('/api/v1/api-keys', {
        data: { name: 'Primary System', rate_limit: 60 }
      });
      expect(createKeyRes.status()).toBe(201);
      const createKeyJson = await createKeyRes.json();
      tempKeyId = createKeyJson.keyRecord?.id || createKeyJson.data?.id || createKeyJson.id;
      tempApiKeySecret = createKeyJson.apiKey || createKeyJson.secret_key || createKeyJson.rawKey;
      expect(tempKeyId).toBeTruthy();
      expect(tempApiKeySecret).toBeTruthy();

      const authHeaders = { 'x-api-key': tempApiKeySecret };

      // GET /api/v1/rma?test_mode=true
      const listRmaRes = await request.get('/api/v1/rma?test_mode=true&limit=5', { headers: authHeaders });
      expect(listRmaRes.status()).toBe(200);
      expect((await listRmaRes.json()).success).toBe(true);

      // POST /api/v1/rma?test_mode=true -> creates RMA-TEST-...
      const postRmaRes = await request.post('/api/v1/rma?test_mode=true', {
        headers: authHeaders,
        data: {
          barcode: VERIFIED_BARCODE,
          name: 'Playwright API RMA Test',
          quantity: 2,
          expiry_date: '2027-12-31',
          is_test: true,
          reason: '1- Damaged Box / Crushed Packaging'
        }
      });
      expect(postRmaRes.status()).toBe(201);
      const postRmaJson = await postRmaRes.json();
      createdApiRma = postRmaJson.data?.rma_number;
      expect(createdApiRma).toMatch(/^RMA-TEST-/);

      // PATCH /api/v1/rma/:id
      const patchRmaRes = await request.patch(`/api/v1/rma/${encodeURIComponent(createdApiRma)}?test_mode=true`, {
        headers: authHeaders,
        data: { status: 'restocked', warehouse_location: 'Good Stock Area', notes: '[TEST_MODE] Playwright API PATCH' }
      });
      expect(patchRmaRes.status()).toBe(200);

      // DELETE /api/v1/rma/:id
      const delRmaRes = await request.delete(`/api/v1/rma/${encodeURIComponent(createdApiRma)}?test_mode=true`, {
        headers: authHeaders
      });
      expect(delRmaRes.status()).toBe(200);
      createdApiRma = null;

      // GET /api/v1/credit-memos
      const cmListRes = await request.get('/api/v1/credit-memos?test_mode=true&limit=5', { headers: authHeaders });
      expect(cmListRes.status()).toBe(200);
      expect((await cmListRes.json()).success).toBe(true);

      // POST /api/upload-photo?action=inspect-plate -> verifies truck plate OCR route contract under 12-function cap
      const plateOcrRes = await request.post('/api/upload-photo?action=inspect-plate', {
        data: {
          fileData: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          mimeType: 'image/png'
        }
      });
      expect(plateOcrRes.status()).toBe(200);
      const plateOcrJson = await plateOcrRes.json();
      expect(typeof plateOcrJson).toBe('object');
      expect('is_valid_plate' in plateOcrJson).toBe(true);
      expect('plate_number' in plateOcrJson).toBe(true);

      // Navigate once so strict guards observe page cleanly too
      await page.goto('/docs', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      guard.assertClean('suite 08 REST API & /docs');
    } finally {
      if (tempKeyId) {
        await request.delete(`/api/v1/api-keys/${encodeURIComponent(tempKeyId)}`).catch(() => {});
      }
      if (createdApiRma) {
        await cleanupTestRecords(page, { rmaNumbers: [createdApiRma] });
      }
      guard.detach();
    }
  });

  test('verifies zero horizontal overflow across Desktop (1280x800), Mobile Portrait (390x844), & Mobile Landscape (840x390) + global date formatting audit', async ({
    page,
    context
  }) => {
    test.setTimeout(240_000);
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);

    const viewports = [
      { name: 'Desktop 1280x800', width: 1280, height: 800 },
      { name: 'Mobile Portrait 390x844', width: 390, height: 844 },
      { name: 'Mobile Landscape 840x390', width: 840, height: 390 }
    ];

    try {
      for (const vp of viewports) {
        await page.setViewportSize({ width: vp.width, height: vp.height });

        // 1. Public Intake responsive layout
        await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await expect(page.getByText(/Scan Product Barcode or RMA Sticker QR/i)).toBeVisible({
          timeout: 40_000
        });
        await assertNoHorizontalOverflow(page, `${vp.name} Public Intake`);

        // 2. Admin Dashboard all 6 top-level tabs + Customer Hub Credit Memos Ledger sub-tab responsive check
        await gotoAdmin(page);
        for (const tabLabel of [
          'Saved Products',
          'Customer RMA Hub',
          'Supplier Hub',
          'Test Mode Sandbox',
          'Archive & Trash',
          'Settings & SMTP'
        ]) {
          await page.getByRole('button', { name: new RegExp(tabLabel, 'i') }).first().click();
          await page.waitForTimeout(250);
          await assertNoHorizontalOverflow(page, `${vp.name} Admin Tab: ${tabLabel}`);
          if (tabLabel === 'Customer RMA Hub') {
            await page.getByRole('button', { name: /Credit Memos Ledger \(/i }).first().click();
            await page.waitForTimeout(200);
            await assertNoHorizontalOverflow(page, `${vp.name} Customer Hub Sub-Tab: Credit Memos Ledger`);
          }
        }
      }

      // Global Date Format Audit on Admin Tables: ensure zero locale-ambiguous MM/DD/YYYY in rendered table headers/badges
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByRole('button', { name: /Customer RMA Hub/i }).click();
      await page.getByRole('button', { name: /Customer Returns \(/i }).first().click();
      const custText = await page.locator('table').first().innerText().catch(() => '');
      if (custText) {
        expect(custText).not.toMatch(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/\d{4}\b/);
      }

      await page.getByRole('button', { name: /Credit Memos Ledger \(/i }).first().click();
      await expect(page.getByText(/From \(YYYY-MM-DD\)/i).first()).toBeVisible();
      await expect(page.getByText(/To \(YYYY-MM-DD\)/i).first()).toBeVisible();

      guard.assertClean('suite 08 responsive viewports & global date format audit');
    } finally {
      guard.detach();
    }
  });
});
