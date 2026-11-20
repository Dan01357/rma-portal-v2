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
  gotoAdmin,
  cleanupTestRecords
} from './helpers/testUtils.js';

test.describe('Suite 01: Public Intake, Gatekeeper Lock, Identity Verification, Paperwork AI & Sticker Studio', () => {
  test('Gatekeeper lock states (missing/invalid/expired/revoked), Google identity mismatch, valid token unlock + live countdown + realtime revoke & /admin OTP flow', async ({
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

      // 2. Invalid invite token -> "Authorization Unavailable"
      await page.goto('/intake?token=PW-INVALID-TOKEN-000', { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Authorization Unavailable')).toBeVisible({ timeout: 15_000 });

      // 3. Revoked invite token -> "403 Forbidden — Authorization Revoked"
      let inviteState = 'revoked';
      const activeExpiry = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      await page.route('**/rest/v1/rma_invites**', async (route) => {
        const req = route.request();
        if (req.method() === 'GET') {
          const url = req.url();
          if (url.includes('PW-TEST-TOKEN')) {
            const row = {
              id: '00000000-0000-4000-8000-000000009001',
              token: 'PW-TEST-TOKEN',
              authorized_email: 'pw-authorized@pingcon.local',
              entity_name: 'Playwright Partner Store',
              store_branch: 'Playwright Partner Store',
              stream_type: 'customer_inbound',
              is_test: true,
              status: inviteState === 'revoked' ? 'revoked' : 'active',
              expires_at:
                inviteState === 'expired'
                  ? new Date(Date.now() - 60 * 1000).toISOString()
                  : activeExpiry
            };
            const acceptHdr = String(req.headers()['accept'] || '');
            const isObj = acceptHdr.includes('application/vnd.pgrst.object+json');
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(isObj ? row : [row])
            });
          }
        }
        return route.continue();
      });

      await page.goto('/intake?token=PW-TEST-TOKEN', { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('403 Forbidden — Authorization Revoked')).toBeVisible({
        timeout: 15_000
      });
      await expect(page.getByText('Authorization Revoked', { exact: true })).toBeVisible();

      // 4. Expired invite token -> "Authorization Expired"
      inviteState = 'expired';
      await page.goto('/intake?token=PW-TEST-TOKEN', { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Authorization Expired')).toBeVisible({ timeout: 15_000 });

      // 5. Cross-account Google Identity Mismatch -> "403 Forbidden — Identity Mismatch" + "Switch Google Account"
      const buildMockJwt = (emailAddr) => {
        const hdr = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
        const pay = Buffer.from(
          JSON.stringify({
            sub: '00000000-0000-4000-8000-000000000001',
            email: emailAddr,
            user_metadata: { full_name: 'PW Tester' }
          })
        ).toString('base64url');
        return `${hdr}.${pay}.pwsig`;
      };

      inviteState = 'active';
      let mockGoogleUserEmail = 'wrong-account@gmail.com';
      await page.route('**/auth/v1/user**', async (route) => {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: '00000000-0000-4000-8000-000000000001',
            email: mockGoogleUserEmail,
            user_metadata: { full_name: 'PW Tester' }
          })
        });
      });
      await page.route('**/auth/v1/logout**', async (route) => {
        return route.fulfill({ status: 204, body: '' });
      });

      await page.goto('about:blank');
      await page.goto(
        `/intake?token=PW-TEST-TOKEN#access_token=${buildMockJwt('wrong-account@gmail.com')}&refresh_token=pw_ref&expires_in=3600`,
        { waitUntil: 'domcontentloaded' }
      );
      await expect(page.getByText('403 Forbidden — Identity Mismatch')).toBeVisible({
        timeout: 15_000
      });
      await expect(page.getByRole('button', { name: /Switch Google Account/i })).toBeVisible();

      // 6. Matching verified Google identity unlocks portal with readOnly Reporter Contact + live countdown + realtime revoke
      mockGoogleUserEmail = 'pw-authorized@pingcon.local';
      await page.goto('about:blank');
      await page.goto(
        `/intake?token=PW-TEST-TOKEN#access_token=${buildMockJwt('pw-authorized@pingcon.local')}&refresh_token=pw_ref&expires_in=3600`,
        { waitUntil: 'domcontentloaded' }
      );
      await expect(page.getByText(/Scan Product Barcode or RMA Sticker QR/i)).toBeVisible({
        timeout: 15_000
      });
      await expect(page.getByText(/Link expires in:/i).first()).toBeVisible({ timeout: 10_000 });

      const contactInput = page.locator('input[placeholder="Phone No. or Email *"]');
      await expect(contactInput).toHaveValue('pw-authorized@pingcon.local');
      await expect(contactInput).toHaveAttribute('readonly', '');

      // Simulate realtime admin revocation while external session is active
      inviteState = 'revoked';
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(page.getByText('403 Forbidden — Authorization Revoked')).toBeVisible({
        timeout: 15_000
      });

      // 7. Visiting /admin without session opens AdminLoginModal OTP form: rejects personal email & handles company OTP
      await page.unroute('**/rest/v1/rma_invites**');
      await page.unroute('**/auth/v1/user**');
      await page.route('**/auth/v1/otp**', async (route) => {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({})
        });
      });

      await page.goto('/admin', { waitUntil: 'domcontentloaded' });
      const sendOtpBtn = page.getByRole('button', { name: /Send OTP Verification Code/i });
      await expect(sendOtpBtn).toBeVisible({ timeout: 15_000 });
      const emailField = page.locator('input[type="email"]').first();
      await emailField.fill('unauthorized@gmail.com');
      await sendOtpBtn.click();
      await expect(
        page.getByText(/company email|restricted|keysys|pingcon|a2z2go/i).first()
      ).toBeVisible({ timeout: 8_000 });

      // Valid company email dispatches mocked OTP cleanly & shows Change Email + Resend Code controls
      await emailField.fill('finance2@keysysincorporated.com');
      await sendOtpBtn.click();
      await expect(page.getByRole('button', { name: /Change Email/i })).toBeVisible({
        timeout: 10_000
      });
      await expect(page.getByText(/Resend Code/i)).toBeVisible();
      await page.getByRole('button', { name: /Change Email/i }).click();
      await expect(sendOtpBtn).toBeVisible();

      guard.assertClean('unauthenticated gatekeeper, identity lock & admin OTP check');
    } finally {
      guard.detach();
      await cleanContext.close();
    }
  });

  test('authenticated Super Admin public intake: themes, Section 1-4 validation, AI paperwork rejection/auto-fill/cancel, unknown QR, catalog supplier preservation & QR studio resize/print', async ({
    page,
    context
  }) => {
    test.setTimeout(150_000);
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);
    await interceptAndCaptureEmails(page);
    await mockPhotoUploadSuccess(page);
    let createdRmaNumber = null;

    // Mock Gemini Paperwork AI inspection deterministically for both Invalid Rejection & Valid Auto-Fill
    let mockPaperworkMode = 'invalid';
    await page.route('**/api/**/*inspect-paperwork**', async (route) => {
      if (mockPaperworkMode === 'slow_valid') {
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (mockPaperworkMode === 'invalid') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            is_valid_document: false,
            rejection_reason: 'Image appears to be blank/non-commercial paperwork.'
          })
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          is_valid_document: true,
          document_type: 'Sales Invoice / Delivery Receipt',
          confidence: 0.97,
          si_number: 'SI-2026-8841',
          dr_number: 'DR-2026-4410',
          po_number: 'PO-2026-7721',
          invoice_dr_number: 'DR-2026-4410',
          store_branch: 'Robinsons Easymart Branch 12'
        })
      });
    });

    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.getByText(/Scan Product Barcode or RMA Sticker QR/i)).toBeVisible({
        timeout: 20_000
      });

      // 1. Light/Dark Theme toggle
      const themeToggleBtn = page.locator('button[aria-label="Toggle Theme"]').first();
      await expect(themeToggleBtn).toBeVisible();
      await themeToggleBtn.click();
      await themeToggleBtn.click();

      // 2. Test Mode Switch on Super Admin panel (Live vs Test)
      await setPublicPortalTestMode(page, false);

      // Customer Inbound vs Supplier RTV expiration & Section 3 labels in LIVE Mode
      await page.getByRole('button', { name: /Customer RMA Hub/i }).click();
      await expect(page.getByText('3. Company / Store Name (Optional)')).toBeVisible();
      const expiryInput = page.locator('input[type="date"]').first();
      await expect(expiryInput).not.toHaveAttribute('required', /.*/);
      await expect(page.getByText('Optional', { exact: true }).first()).toBeVisible();

      await page.getByRole('button', { name: /Supplier RTV Hub/i }).click();
      await expect(page.getByText('3. Supplier Name (Optional)')).toBeVisible();
      await expect(expiryInput).toHaveAttribute('required', '');
      await expect(page.getByText('Required *', { exact: true }).first()).toBeVisible();

      // Switch to Test Mode & verify mgan@a2z2go.net + strict Required * expiration
      await setPublicPortalTestMode(page, true);
      await expect(page.getByText(/mgan@a2z2go\.net/).first()).toBeVisible();
      await expect(expiryInput).toHaveAttribute('required', '');

      // 3. ScannerModal: Camera fallback, Unknown RMA QR warning banner, & Close
      await page.getByRole('button', { name: /Scan Product Barcode or RMA Sticker QR/i }).click();
      await expect(page.getByText('Product & RMA QR Scanner')).toBeVisible();
      await page.waitForTimeout(300);
      await page.locator('input[aria-label="Manual QR or barcode input"]').fill('PINGCON-RMA:TEST:RMA-TEST-0000-NONE');
      await page.getByRole('button', { name: /^Process$/i }).click();
      await expect(page.getByText('Product & RMA QR Scanner')).toBeHidden({ timeout: 10_000 });
      await expect(page.getByText('RMA Record Not Found')).toBeVisible({ timeout: 20_000 });

      // 4. Test "Missing Barcode / Unlabeled Item" button + Cancel + Re-enable + Defect Reasons + Explanation 250-char counter
      const missingBtn = page.getByRole('button', {
        name: /Missing Barcode \/ Unlabeled Item\? Click here to report/i
      });
      await missingBtn.click();
      await expect(page.getByText('Missing Barcode Tracking Tag Assigned')).toBeVisible();
      const barcodeField = page
        .locator('input[placeholder*="Barcode" i], input[placeholder*="barcode" i]')
        .first();
      await expect(barcodeField).toHaveValue(/^NO-LABEL-/);

      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByText('Missing Barcode Tracking Tag Assigned')).toBeHidden();
      await missingBtn.click();
      await expect(barcodeField).toHaveValue(/^NO-LABEL-/);

      const descField = page.locator('input[placeholder*="Oishi"], input[placeholder*="identif"]').first();
      await descField.fill('Playwright Unlabeled Item (Test)');

      const reasonSelect = page.locator('select').first();
      if (await reasonSelect.isVisible().catch(() => false)) {
        const optCount = await reasonSelect.locator('option').count();
        if (optCount > 1) {
          await reasonSelect.selectOption({ index: 1 });
          await reasonSelect.selectOption({ index: 0 });
        }
      }

      const expInput = page.locator('input[placeholder*="explanation" i]').first();
      await expInput.fill('Crushed carton');
      await expect(page.getByText('14/250 chars')).toBeVisible();

      // Mandatory photo check: clicking "+ Add Another Item to Return" with 0 photos must NOT queue
      await page.getByRole('button', { name: /\+ Add Another Item to Return/i }).click();
      await expect(page.getByText(/Queued Return Manifest/i)).toBeHidden();

      // Toggle Camera <-> Gallery (Batch) on Section 1, upload photo, open thumbnail Lightbox, remove & re-attach
      const galleryBtns = page.getByRole('button', { name: /Gallery \(Batch\)/i });
      const cameraBtns = page.getByRole('button', { name: /^Camera$/i });
      await galleryBtns.first().click();
      await cameraBtns.first().click();

      const itemPhotoInput = page.locator('input[type="file"][accept="image/*"]').first();
      await itemPhotoInput.setInputFiles({
        name: 'pw-unlabeled-1.png',
        mimeType: 'image/png',
        buffer: PNG_BUFFER
      });
      await expect(page.getByText('1/10 photos')).toBeVisible();

      // Click thumbnail to zoom into Lightbox then close, then remove photo & re-attach
      const thumbImg = page.locator('img[alt*="Proof" i], img[alt*="Damaged" i]').first();
      if (await thumbImg.isVisible().catch(() => false)) {
        await thumbImg.click();
        const closeLb = page.locator('button[title="Close (Esc)"]');
        if (await closeLb.isVisible({ timeout: 3000 }).catch(() => false)) {
          await closeLb.click();
        }
      }
      const removePhotoBtn = page.locator('button[title*="Remove photo" i]').first();
      if (await removePhotoBtn.isVisible().catch(() => false)) {
        await removePhotoBtn.click();
        await expect(page.getByText('0/10 photos')).toBeVisible();
        await itemPhotoInput.setInputFiles({
          name: 'pw-unlabeled-reattach.png',
          mimeType: 'image/png',
          buffer: PNG_BUFFER
        });
        await expect(page.getByText('1/10 photos')).toBeVisible();
      }

      // Clicking "+ Add Another Item to Return" WITHOUT expiry in Supplier RTV Test Mode MUST be blocked!
      await page.getByRole('button', { name: /\+ Add Another Item to Return/i }).click();
      await expect(
        page.getByText(/Product expiration date is required for Supplier RTV items/i)
      ).toBeVisible();

      // Fill mandatory expiration date (with ISO YYYY-MM-DD readout) and add item to manifest
      const futureExp = isoDateDaysOffset(45);
      await expiryInput.fill(futureExp);
      await expect(page.getByText(new RegExp(`ISO \\(YYYY-MM-DD\\):\\s*${futureExp}`))).toBeVisible();
      await page.getByRole('button', { name: /\+ Add Another Item to Return/i }).click();
      await expect(page.getByText(/Queued Return Manifest \(1 Item\)/i)).toBeVisible();

      // 5. Customer Hub verified catalog barcode lookup -> real supplier_name (never 'Pending Assignment'), qty stepper, Section 3 Clear (X)
      await page.getByRole('button', { name: /Customer RMA Hub/i }).click();
      const nextBarcodeField = page.locator('input[placeholder*="barcode" i]').first();
      await nextBarcodeField.fill(VERIFIED_BARCODE);
      await expect(page.getByText('Recognized Product')).toBeVisible({ timeout: 12_000 });
      await expect(page.getByText(/SS1319P/).first()).toBeVisible();

      await page.locator('button[title="Increase quantity (+1)"]').click();
      await page.locator('button[title="Decrease quantity (-1)"]').click();
      await itemPhotoInput.setInputFiles({
        name: 'pw-catalog.png',
        mimeType: 'image/png',
        buffer: PNG_BUFFER
      });
      await page.getByRole('button', { name: /\+ Add Another Item to Return/i }).click();
      await expect(page.getByText(/Queued Return Manifest \(2 Items\)/i)).toBeVisible();

      // Remove unlabeled item so manifest keeps the verified catalog item cleanly
      await page.locator('button[title="Remove this item from return manifest"]').first().click();
      await expect(page.getByText(/Queued Return Manifest \(1 Item\)/i)).toBeVisible();

      // 6. Section 2 Paperwork AI: Invalid rejection (.animate-shake) -> Slow inspection Cancel -> Valid auto-fill SI/DR/PO -> remove & leave blank
      const paperworkInput = page.locator('input[type="file"][accept="image/*"]').last();
      await galleryBtns.nth(1).click();
      await cameraBtns.nth(1).click();

      mockPaperworkMode = 'invalid';
      await paperworkInput.setInputFiles({
        name: 'pw-invalid-doc.png',
        mimeType: 'image/png',
        buffer: PNG_BUFFER
      });
      await expect(page.getByText(/Paperwork rejected:/i)).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.animate-shake').first()).toBeVisible();

      mockPaperworkMode = 'slow_valid';
      await paperworkInput.setInputFiles({
        name: 'pw-slow-doc.png',
        mimeType: 'image/png',
        buffer: PNG_BUFFER
      });
      const cancelInspBtn = page.getByRole('button', { name: /Cancel Inspection/i });
      if (await cancelInspBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await cancelInspBtn.click();
      }

      mockPaperworkMode = 'valid';
      await paperworkInput.setInputFiles({
        name: 'pw-valid-doc.png',
        mimeType: 'image/png',
        buffer: PNG_BUFFER
      });
      await expect(page.getByText(/Verified Sales Invoice/i).first()).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('input[value="SI-2026-8841"], input[placeholder*="SI-" i]').first()).toHaveValue('SI-2026-8841');

      // Remove paperwork photo and clear SI/DR/PO to prove blank docs submit cleanly
      const removePaperBtn = page.locator('button[title="Remove paperwork photo"]').first();
      if (await removePaperBtn.isVisible().catch(() => false)) {
        await removePaperBtn.click();
      }
      for (const ph of ['SI-', 'DR-', 'PO-']) {
        const inp = page.locator(`input[placeholder*="${ph}" i]`).first();
        if (await inp.isVisible().catch(() => false)) {
          await inp.fill('');
        }
      }

      // 7. Section 3 Clear (X) & blank leaving catalog supplier intact + Section 4 localStorage check
      const companyField = page.locator('input[placeholder*="company" i], input[placeholder*="Savemore" i], input[placeholder*="store" i], input[placeholder*="Supplier" i]').last();
      if (await companyField.isVisible().catch(() => false)) {
        await companyField.fill('Temporary Store Test');
        const clearSec3 = page.locator('button[title*="Clear company"], button[title*="Clear supplier"]').first();
        if (await clearSec3.isVisible().catch(() => false)) {
          await clearSec3.click();
          await expect(companyField).toHaveValue('');
        } else {
          await companyField.fill('');
        }
      }

      await page.locator('input[placeholder="Your Full Name *"]').fill('Playwright Public Tester');
      await page.locator('input[placeholder="Phone No. or Email *"]').fill('playwright-test@pingcon.local');

      // Check Reporter persistence saved in localStorage
      const savedReporter = await page.evaluate(() => ({
        name: localStorage.getItem('rma_reporter_name'),
        contact: localStorage.getItem('rma_reporter_contact')
      }));
      expect(savedReporter.name).toBe('Playwright Public Tester');
      expect(savedReporter.contact).toBe('playwright-test@pingcon.local');

      await page.getByRole('button', { name: /Submit Return Manifest/i }).click();

      // 8. Success Screen & ReturnQRModal (Presets, W/H mm edit, Reset, Zero A4, Pure B&W Print)
      await expect(page.getByText('Box Sticker Ready')).toBeVisible({ timeout: 20_000 });
      const rmaText = await page
        .locator('.font-mono.font-black.text-slate-900, .font-mono.font-black.dark\\:text-white')
        .filter({ hasText: /^RMA-TEST-/ })
        .first()
        .innerText();
      createdRmaNumber = rmaText.trim();
      expect(createdRmaNumber).toMatch(/^RMA-TEST-/);

      const [directPngDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Save Sticker \(PNG\)/i }).click()
      ]);
      expect(directPngDownload.suggestedFilename()).toContain('.png');

      await page.getByRole('button', { name: /Resize \/ Print Sticker/i }).click();
      await expect(page.getByText('Print RMA Sticker Label')).toBeVisible();

      await page.getByRole('button', { name: /Small \(Tuna Can\)/i }).click();
      await page.getByRole('button', { name: /Large \(Carton\)/i }).click();
      await page.getByRole('button', { name: /Extra Large \(Half Letter\)/i }).click();

      // Test manual W/H numeric inputs + Reset back to Medium
      const qrModal = page.locator('div.fixed', { hasText: 'Print RMA Sticker Label' });
      const wInput = qrModal.locator('input[type="number"]').first();
      const hInput = qrModal.locator('input[type="number"]').nth(1);
      await wInput.fill('110');
      await hInput.fill('145');
      await expect(wInput).toHaveValue('110');
      await qrModal.locator('button[title="Reset to Medium size"]').click();
      await expect(wInput).not.toHaveValue('110');

      const modalText = await qrModal.innerText();
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
      expect(await page.evaluate(() => window.__pwPrintCount || 0)).toBeGreaterThan(printsBefore);
      const printedHtmls = await page.evaluate(() => window.__pwPrintHtmls || []);
      const lastPrint = printedHtmls[printedHtmls.length - 1] || '';
      expect(lastPrint.toLowerCase()).not.toContain('size: a4');

      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(page.getByText('Print RMA Sticker Label')).toBeHidden();

      await page.getByRole('button', { name: /Report Another/i }).click();
      await expect(page.getByRole('button', { name: /Submit Return Report/i })).toBeVisible();
      await page.waitForLoadState('networkidle').catch(() => {});

      // Clean up synthetic submission via Sandbox Trash -> Permanent Delete
      if (createdRmaNumber) {
        await gotoAdmin(page);
        await page.getByRole('button', { name: /Test Mode Sandbox/i }).first().click();
        await page.locator('input[placeholder*="Search" i]').first().fill(createdRmaNumber);
        const row = page.locator('tr', { hasText: createdRmaNumber }).first();
        if (await row.isVisible({ timeout: 5000 }).catch(() => false)) {
          const trashBtn = row.locator('button[title*="Delete" i], button[title*="Trash" i]').first();
          await trashBtn.click();
          await page.getByRole('button', { name: /Move to Trash/i }).click();
          await expect(page.getByText(/Move to Trash \(30-Day Recovery\)\?/i)).toBeHidden({
            timeout: 15_000
          });
          await page.getByRole('button', { name: /Archive & Trash/i }).click();
          page.once('dialog', async (d) => await d.accept());
          await page.getByRole('button', { name: /Trash Bin/i }).click();
          const trashedRow = page.locator('tr', { hasText: createdRmaNumber }).first();
          await expect(trashedRow).toBeVisible({ timeout: 10_000 });
          await trashedRow.locator('button[title="Permanently destroy this record forever"]').click();
          await expect(trashedRow).toBeHidden({ timeout: 15_000 });
          await page.waitForLoadState('networkidle').catch(() => {});
        }
        createdRmaNumber = null;
      }

      guard.assertClean('suite 01 public intake & gatekeeper');
    } finally {
      if (createdRmaNumber) {
        await cleanupTestRecords(page, { rmaNumbers: [createdRmaNumber] });
      }
      guard.detach();
    }
  });
});
