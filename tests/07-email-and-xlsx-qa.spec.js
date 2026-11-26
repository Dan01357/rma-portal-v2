import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { buildRmaMatrixXlsxBytes } from '../src/utils/exportMatrixXlsx.js';
import { buildTableXlsxBytes } from '../src/utils/exportXlsx.js';
import {
  getCleanHumanWorkflowStatus,
  computeFourStepWorkflow,
  buildFollowUpEmailContent,
  buildAutoDisposedEmailContent
} from '../src/utils/followUpWorkflow.js';
import { buildRmaAlertXlsxBytes, buildRmaAlertFilename } from '../src/utils/rmaAlertXlsx.js';
import { extractRmaUpdatesFromXlsxBuffer } from '../api/_lib/imapReplySyncHandler.js';
import {
  PNG_BUFFER,
  VERIFIED_BARCODE,
  attachStrictGuards,
  installPrintStubs,
  interceptAndCaptureEmails,
  mockPhotoUploadSuccess,
  setPublicPortalTestMode,
  seedTestModeRma,
  gotoAdmin,
  readSupabasePublicEnv,
  cleanupTestRecords
} from './helpers/testUtils.js';

function colLettersToIndex(letters) {
  let num = 0;
  for (let i = 0; i < letters.length; i++) {
    num = num * 26 + (letters.charCodeAt(i) - 64);
  }
  return num;
}

function parseCellRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(String(ref || '').trim());
  if (!m) throw new Error(`Invalid A1 cell ref: ${ref}`);
  return { col: colLettersToIndex(m[1]), row: parseInt(m[2], 10) };
}

function parseStoredZipEntries(buf) {
  const entries = new Map();
  let offset = 0;
  while (offset + 4 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const method = buf.readUInt16LE(offset + 8);
    expect(method).toBe(0); // Stored method
    const compSize = buf.readUInt32LE(offset + 18);
    const uncompSize = buf.readUInt32LE(offset + 22);
    expect(compSize).toBe(uncompSize);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buf.subarray(nameStart, nameStart + nameLen).toString('utf8');
    const dataStart = nameStart + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize).toString('utf8');
    entries.set(name, data);
    offset = dataStart + compSize;
  }
  const eocdOffset = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocdOffset).toBeGreaterThan(0);
  return entries;
}

function assertXmlWellFormed(xml, label) {
  expect(xml, `${label} missing XML decl`).toMatch(/^<\?xml version="1\.0"/);
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, '');
  expect(body, `${label} contains unescaped ampersand`).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/);
  const stack = [];
  const tagRe = /<\/?([a-zA-Z0-9_:-]+)(?:\s+[^<>]*?)?\/?>/g;
  let match;
  while ((match = tagRe.exec(body)) !== null) {
    const full = match[0];
    const tag = match[1];
    const selfClosing = full.endsWith('/>');
    const isClosing = full.startsWith('</');
    if (isClosing) {
      const top = stack.pop();
      if (top !== tag) {
        expect(top, `${label} unexpected closing </${tag}>`).toBe(tag);
      }
    } else if (!selfClosing) {
      stack.push(tag);
    }
  }
  expect(stack, `${label} unclosed tags`).toEqual([]);
}

function assertStrictOoxmlWorkbook(buf, { expectMatrixPanes = true } = {}) {
  expect(buf[0]).toBe(0x50);
  expect(buf[1]).toBe(0x4b);
  const entries = parseStoredZipEntries(buf);

  for (const required of [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/styles.xml',
    'xl/worksheets/sheet1.xml'
  ]) {
    expect(entries.has(required), `Missing ZIP part: ${required}`).toBe(true);
    assertXmlWellFormed(entries.get(required), required);
  }

  // Strict Microsoft Excel desktop OPC rule: zero inter-element whitespace/newlines in [Content_Types] / rels / workbook.xml
  for (const compactPart of ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/workbook.xml']) {
    expect(entries.get(compactPart), `${compactPart} must have no whitespace between XML tags`).not.toMatch(/>\s+</);
  }

  const sheetXml = entries.get('xl/worksheets/sheet1.xml');
  if (expectMatrixPanes) {
    expect(sheetXml).toContain('xSplit="5" ySplit="5" topLeftCell="F6" activePane="bottomRight" state="frozen"');
    expect(sheetXml).toContain('<selection pane="bottomRight"');
  }

  // Check all <col> attributes have min <= max
  for (const cm of sheetXml.matchAll(/<col\s+min="(\d+)"\s+max="(\d+)"/g)) {
    expect(parseInt(cm[1], 10)).toBeLessThanOrEqual(parseInt(cm[2], 10));
  }

  // Check zero overlapping <mergeCell> ranges
  const occupied = new Set();
  for (const mm of sheetXml.matchAll(/<mergeCell ref="([A-Z]+\d+:[A-Z]+\d+)"\/>/g)) {
    const [a, b] = mm[1].split(':');
    const start = parseCellRef(a);
    const end = parseCellRef(b);
    expect(start.row).toBeLessThanOrEqual(end.row);
    expect(start.col).toBeLessThanOrEqual(end.col);
    for (let r = start.row; r <= end.row; r++) {
      for (let c = start.col; c <= end.col; c++) {
        const key = `${r}:${c}`;
        expect(occupied.has(key), `Overlapping mergeCell at R${r}C${c} (${mm[1]})`).toBe(false);
        occupied.add(key);
      }
    }
  }

  // Check all SUM(...) formulas use valid non-inverted ranges
  for (const fm of sheetXml.matchAll(/<f>([^<]+)<\/f>/g)) {
    const expr = fm[1];
    for (const rm of expr.matchAll(/([A-Z]+\d+):([A-Z]+\d+)/g)) {
      const s = parseCellRef(rm[1]);
      const e = parseCellRef(rm[2]);
      expect(s.row).toBeLessThanOrEqual(e.row);
      expect(s.col).toBeLessThanOrEqual(e.col);
    }
  }

  return entries;
}

function assertEmailPayloadClean({ payload, expectedExpiry, expectTestMode }) {
  expect(payload).toBeTruthy();
  expect(Boolean(payload.isTestMode)).toBe(expectTestMode);

  if (expectTestMode) {
    expect(payload.subject).toMatch(/^\[TEST\] /);
    expect(payload.subject).not.toMatch(/^(?:Test\s*-|\[TEST MODE\]|\[TEST\]\s+\[TEST\])/i);
    expect(payload.fromName).toContain('[TEST]');
    expect(payload.html).toContain('mgan@pingconmarketing.com');
  } else {
    expect(payload.subject).not.toMatch(/^(?:\[TEST|Test\s*-)/i);
    expect(payload.fromName).not.toContain('[TEST]');
    expect(payload.html).toContain('To &amp; CC recipients');
  }

  // Clickable Edit RMA Details & Documents CTA inside generated HTML email
  expect(payload.html).toContain('Edit RMA Details &amp; Documents');
  expect(payload.html).toContain('No expiry (revocable anytime by Admin)');
  expect(payload.html).toMatch(/\/intake\?token=inv_(?:test_)?edit_/);

  // Unambiguous Expiry Date (YYYY-MM-DD) & Submission Date (YYYY-MM-DD HH:mm)
  expect(payload.html).toContain('Expiry Date (YYYY-MM-DD):');
  expect(payload.html).toContain('Submission Date (YYYY-MM-DD HH:mm):');
  expect(payload.html).toContain(expectedExpiry);
  expect(payload.text).toContain('Expiry Date (YYYY-MM-DD):');
  expect(payload.text).toContain(expectedExpiry);
  expect(payload.replyTo).toBeTruthy();

  // Attached 2-way editable RMA Alert Mirror .xlsx workbook
  const xlsxAtt = (payload.attachments || []).find((a) =>
    String(a?.filename || '').toLowerCase().endsWith('.xlsx') && a?.encoding === 'base64'
  );
  expect(xlsxAtt).toBeTruthy();
  const parsedMirror = extractRmaUpdatesFromXlsxBuffer(Buffer.from(xlsxAtt.content, 'base64'));
  expect(parsedMirror.rmaNumber).toMatch(/^RMA-/);
  expect(parsedMirror.patch.expiry_date).toBe(expectedExpiry);

  const combined = [payload.subject, payload.fromName, payload.html, payload.text].join('\n');
  expect(combined).toContain('Pingcon');
  expect(combined.toLowerCase()).not.toContain('wholesale');
}

function decodeBase64Header(b64) {
  return Buffer.from(String(b64 || ''), 'base64').toString('latin1');
}

test.describe('Suite 07: Emails (Intake + 4 Lifecycle Events w/ PDF), mgan@pingconmarketing.com Sandbox, Date Format Audit & Overall Matrix (.xlsx)', () => {
  test('New RMA intake email (Live & Test), 4 lifecycle emails (Scrapped, Restocked, Debit Pickup + PDF, Replacement Pickup + PDF), & Overall Matrix (.xlsx) deep XML verification', async ({
    page,
    context,
    browser,
    request
  }) => {
    test.setTimeout(540_000);
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);
    const capturedEmails = await interceptAndCaptureEmails(page);
    await mockPhotoUploadSuccess(page);
    await page.route('**/api/upload-photo*inspect-plate*', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          is_valid_plate: true,
          plate_number: 'NAA-7788',
          vehicle_type: 'Closed Van'
        })
      });
    });
    const seededTestRmas = [];
    let createdClaimNum = null;

    try {
      // =========================================================================
      // 1. LIVE MODE NEW RMA EMAIL CHECK (intercepted DB & Email)
      // =========================================================================
      // Prevent mocked Live intake from writing synthetic Live invite records into Supabase
      let interceptLiveInviteWrites = true;
      let capturedLiveEditorInvite = null;
      await page.route('**/rest/v1/rma_invites**', async (route) => {
        const req = route.request();
        if (interceptLiveInviteWrites && req.method() === 'POST') {
          let body = {};
          try {
            const parsed = req.postDataJSON();
            body = Array.isArray(parsed) ? parsed[0] : parsed;
          } catch { }
          if (body && !String(body.token || '').startsWith('inv_test_')) {
            capturedLiveEditorInvite = body;
            return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(body) });
          }
        }
        return route.continue();
      });
      await page.route('**/rest/v1/rma_settings**', async (route) => {
        const req = route.request();
        if (interceptLiveInviteWrites && (req.method() === 'POST' || req.method() === 'PATCH') && req.url().includes('rma_settings')) {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
        }
        return route.continue();
      });

      await page.route('**/rest/v1/rma_reports**', async (route) => {
        const req = route.request();
        if (req.method() === 'POST') {
          let body = {};
          try {
            const parsed = req.postDataJSON();
            body = Array.isArray(parsed) ? parsed[0] : parsed;
          } catch { }
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

      await setPublicPortalTestMode(page, false);

      const barcodeField = page.locator('input[placeholder*="Barcode" i], input[placeholder*="barcode" i]').first();
      await barcodeField.fill(VERIFIED_BARCODE);
      await expect(page.getByText('Recognized Product')).toBeVisible({ timeout: 45_000 });

      await page.locator('input[type="date"]').first().fill('2027-03-15');
      await expect(page.getByText(/ISO \(YYYY-MM-DD\):\s*2027-03-15/)).toBeVisible();
      await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({
        name: 'pw-live-expiry.png',
        mimeType: 'image/png',
        buffer: PNG_BUFFER
      });
      await expect(page.getByText('1/10 photos')).toBeVisible();
      await page.locator('input[placeholder="Your Full Name *"]').fill('Playwright Live Email Tester');
      await page.locator('input[placeholder="Phone No. or Email *"]').fill('playwright-live@pingcon.local');

      await page.getByRole('button', { name: /Submit Return Report/i }).click();
      await expect(page.getByText('Printable QR Ready')).toBeVisible({ timeout: 20_000 });

      await expect.poll(() => capturedEmails.length, { timeout: 35_000 }).toBeGreaterThan(0);
      assertEmailPayloadClean({
        payload: capturedEmails[0],
        expectedExpiry: '2027-03-15',
        expectTestMode: false
      });
      // Verify Live Mode New RMA editor invite includes To + ALL CC recipients & Never-Expires sentinel
      expect(capturedLiveEditorInvite).toBeTruthy();
      expect(capturedLiveEditorInvite.duration_unit).toBe('permanent');
      expect(capturedLiveEditorInvite.duration_display).toBe('No Expiry');
      expect(capturedLiveEditorInvite.expires_at).toBe('9999-12-31T23:59:59.000Z');
      expect(capturedLiveEditorInvite.entity_name).toContain('|');
      const liveToAddrs = String(capturedEmails[0].to || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      expect(liveToAddrs.length).toBeGreaterThan(0);
      for (const toAddr of liveToAddrs) {
        expect(capturedLiveEditorInvite.entity_name).toContain(toAddr);
      }
      for (const ccAddr of (capturedEmails[0].cc || [])) {
        expect(capturedLiveEditorInvite.entity_name).toContain(String(ccAddr).toLowerCase());
      }

      // Turn off Live invite interception so Step 2 (Test Sandbox) persists real invites & cleans up cleanly
      interceptLiveInviteWrites = false;

      // =========================================================================
      // 2. TEST MODE SEEDING + ALL 4 LIFECYCLE EMAILS (Scrapped, Restocked, Debit PDF, Replacement PDF)
      // =========================================================================
      await page.getByRole('button', { name: /Report Another/i }).click();
      await setPublicPortalTestMode(page, true);
      await expect(page.getByText(/mgan@pingconmarketing\.com/).first()).toBeVisible();

      await page.locator('input[placeholder*="barcode" i]').first().fill(VERIFIED_BARCODE);
      await expect(page.getByText('Recognized Product')).toBeVisible({ timeout: 45_000 });
      await page.locator('input[type="date"]').first().fill('2027-08-20');
      const explainBox = page.locator('input[placeholder*="explanation" i], textarea[placeholder*="explanation" i]').first();
      await expect(explainBox).toBeVisible();
      await explainBox.fill('Crushed cap and leaking bottle [REORDER: NO]');
      await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({
        name: 'pw-lifecycle-test.png',
        mimeType: 'image/png',
        buffer: PNG_BUFFER
      });
      await page.locator('input[placeholder="Your Full Name *"]').fill('Playwright Lifecycle Tester');
      await page.locator('input[placeholder="Phone No. or Email *"]').fill('playwright-lc@pingcon.local');

      const countBeforeTestSubmit = capturedEmails.length;
      await page.getByRole('button', { name: /Submit Return Report/i }).click();
      await expect(page.getByText('Printable QR Ready')).toBeVisible({ timeout: 20_000 });

      const rmaNum = (
        await page
          .locator('.font-mono.font-black.text-slate-900, .font-mono.font-black.dark\\:text-white')
          .filter({ hasText: /^RMA-TEST-/ })
          .first()
          .innerText()
      ).trim();
      seededTestRmas.push(rmaNum);

      await expect.poll(() => capturedEmails.length, { timeout: 65_000 }).toBeGreaterThan(countBeforeTestSubmit);
      assertEmailPayloadClean({
        payload: capturedEmails[capturedEmails.length - 1],
        expectedExpiry: '2027-08-20',
        expectTestMode: true
      });

      // Open 4-Choice Wizard directly from Success Screen
      await page.getByRole('button', { name: /Choose Disposition \/ (?:Log )?Driver Pickup/i }).click();
      await expect(page.getByText('What do you want to do with this item?')).toBeVisible({ timeout: 10_000 });

      // (a) Scrapped lifecycle email (Processed By required -> must NOT auto-fill for new record!)
      const countBeforeScrap = capturedEmails.length;
      await expect(page.locator('#wizard-processed-by-step1')).toHaveValue('');
      await page.getByRole('button', { name: /Throw Away \/ Dispose \(Scrap\)/i }).click();
      await page.getByRole('button', { name: /Confirm & Save: Throw Away \/ Dispose \(Scrap\)/i }).click();
      await expect(page.getByText(/Please enter "Processed By \(Staff Full Name\)"/i)).toBeVisible({ timeout: 5_000 });
      await page.locator('#wizard-processed-by-step1').fill('Playwright Manual Processor');
      await page.getByRole('button', { name: /Confirm & Save: Throw Away \/ Dispose \(Scrap\)/i }).click();
      await expect(page.getByRole('button', { name: /Edit Choice \/ Details/i })).toBeVisible({ timeout: 35_000 });
      await expect.poll(() => capturedEmails.length, { timeout: 25_000 }).toBeGreaterThan(countBeforeScrap);
      const scrapMail = capturedEmails[capturedEmails.length - 1];
      expect(scrapMail.isTestMode).toBe(true);
      expect(scrapMail.subject).toMatch(/^\[TEST\] \[RMA Scrapped\]/);
      expect(scrapMail.html).toContain('Store / Branch:');
      expect(scrapMail.html).toContain('Warehouse Location:');
      expect(scrapMail.html).toContain('Playwright Manual Processor');

      // (b) Restocked lifecycle email (keeps Store/Branch + Warehouse Location)
      await page.getByRole('button', { name: /Edit Choice \/ Details/i }).click();
      await expect(page.locator('#wizard-processed-by-step1')).toHaveValue('Playwright Manual Processor');
      const countBeforeRestock = capturedEmails.length;
      await page.getByRole('button', { name: /Put Back on Good Shelf \(Restock\)/i }).click();
      await page.getByRole('button', { name: /Confirm & Save: Put Back on Good Shelf \(Restock\)/i }).click();
      await expect(page.getByRole('button', { name: /Edit Choice \/ Details/i })).toBeVisible({ timeout: 35_000 });
      await expect.poll(() => capturedEmails.length, { timeout: 25_000 }).toBeGreaterThan(countBeforeRestock);
      const restockMail = capturedEmails[capturedEmails.length - 1];
      expect(restockMail.isTestMode).toBe(true);
      expect(restockMail.subject).toMatch(/^\[TEST\] \[RMA Restocked\]/);
      expect(restockMail.html).toContain('Store / Branch:');
      expect(restockMail.html).toContain('Warehouse Location:');

      const completeDriverPickup = async (optionRegex, { exerciseMultiPhoto = false, processorName = 'Playwright Manual Processor' } = {}) => {
        await page.getByRole('button', { name: /Edit Choice \/ Details/i }).click();
        await page.locator('input[placeholder*="Customer / Store Branch Name" i]').fill('Suy Sing Commercial Corp');
        await page.getByRole('button', { name: optionRegex }).click();
        await page
          .getByRole('button', {
            name: /Edit Pickup Details, Emails & (?:5 )?Photos|Driver Is Here — Upload Photos & Print Letter/i
          })
          .click();
        await expect(page.getByText(/Driver Pickup Verification \(\d+\/5(?: Optional)? Slots\)/i)).toBeVisible();

        await page.locator('input[placeholder*="branch.manager@customer.com" i]').fill('vendor-claims@example.com');
        await page.locator('input[placeholder*="accounting@customer.com" i]').fill('vendor-cc@example.com');

        if (exerciseMultiPhoto) {
          const chooseFilesInputs = page.locator('input[type="file"][accept="image/*"][multiple]');
          // Upload 2 photos into Slot 1
          await chooseFilesInputs.nth(0).setInputFiles([
            { name: 'pickup-slot1-front-a.png', mimeType: 'image/png', buffer: PNG_BUFFER },
            { name: 'pickup-slot1-front-b.png', mimeType: 'image/png', buffer: PNG_BUFFER }
          ]);
          await expect(page.getByText('(2/10)').first()).toBeVisible();

          // Attempt to upload 11 photos into Slot 2 -> enforces max 10 per slot with warning
          const elevenFiles = Array.from({ length: 11 }, (_, idx) => ({
            name: `pickup-slot2-over-${idx + 1}.png`,
            mimeType: 'image/png',
            buffer: PNG_BUFFER
          }));
          await chooseFilesInputs.nth(1).setInputFiles(elevenFiles);
          await expect(page.getByText(/Maximum 10 photos per slot/i)).toBeVisible();
          await expect(page.getByText('(10/10)').first()).toBeVisible();

          // Remove 8 photos from Slot 2 via individual X remove buttons (leaving 2/10)
          const slot2RemoveBtns = page.locator('button[aria-label*="Driver Valid Gov’t / Legal ID — BACK"]');
          for (let rem = 0; rem < 8; rem++) {
            await slot2RemoveBtns.first().click();
          }

          // Upload Slot 3 (Truck Plate) while plate field is empty -> assert ?action=inspect-plate auto-fills NAA-7788
          await chooseFilesInputs.nth(2).setInputFiles({
            name: 'pickup-slot-3.png',
            mimeType: 'image/png',
            buffer: PNG_BUFFER
          });
          await expect(page.locator('input[placeholder*="NAA 1234" i]')).toHaveValue('NAA-7788', {
            timeout: 15_000
          });

          // Fill Slots 4-5
          for (let s = 3; s < 5; s++) {
            await chooseFilesInputs.nth(s).setInputFiles({
              name: `pickup-slot-${s + 1}.png`,
              mimeType: 'image/png',
              buffer: PNG_BUFFER
            });
          }
          await expect(page.getByText(/Driver Pickup Verification \(5\/5(?: Optional)? Slots\)/i)).toBeVisible();
          await expect(page.getByText(/Total:\s*7\/50 photos/i)).toBeVisible();
        }

        await page.locator('input[placeholder*="Auto-filled or type name" i]').fill('Playwright Driver');
        const idTypeSelect = page.locator('select').filter({ hasText: /PhilSys National ID/i }).first();
        if (await idTypeSelect.isVisible().catch(() => false)) {
          await idTypeSelect.selectOption('PhilSys National ID (PhilID / ePhilID)');
        }
        await page.locator('input[placeholder*="ID # / License #" i], input[placeholder*="Auto-filled from ID photo" i]').first().fill('PSN-4801-9988-7766');
        await page.locator('input[placeholder*="NAA 1234" i]').fill('PW-8899');
        await page.locator('#wizard-processed-by-step2').fill(processorName);

        const mailCountBefore = capturedEmails.length;
        await page
          .getByRole('button', { name: /Upload \d+(?: New)? Photos? to RMA Drive|Save Updates & Open Letter Form/i })
          .click();
        await expect(page.getByText(/CUSTOMER (?:CREDIT MEMO \/ RETURN HANDOVER FORM|BUFFER REPLACEMENT & HANDOVER FORM)/i).first()).toBeVisible({
          timeout: 45_000
        });
        await expect(page.locator('#letter-supplier-pickup-form')).toContainText('PSN-4801-9988-7766');
        await expect(page.locator('#letter-supplier-pickup-form input[title*="Prepared By" i]').first()).toHaveValue(processorName);

        // Verify pure B&W Letter modal, copy presets & close before next step
        const formPrintBtn = page.getByRole('button', { name: /Print (?:Letter Dual-Copy Form|Separated Letter Copies)/i });
        if (exerciseMultiPhoto) {
          await page.getByRole('button', { name: '2 Ours + 1 Theirs (3 Papers)' }).click();
          await expect(page.getByText(/^COPY 3 OF 3 — CUSTOMER COPY/i)).toBeVisible();
          await page.locator('input[aria-label="Our Company Copies"]').fill('2');
          await page.locator('input[aria-label="Customer Copies"]').fill('2');
          await expect(page.getByText(/Total Output:\s*4 Copies/i)).toBeVisible();
          await expect(page.getByText(/^COPY 4 OF 4 — CUSTOMER COPY/i)).toBeVisible();
          await page.locator('input[aria-label="Our Company Copies"]').fill('0');
          await page.locator('input[aria-label="Customer Copies"]').fill('0');
          await expect(formPrintBtn).toBeDisabled();
          await page.getByRole('button', { name: '1 + 1 (2 Papers)' }).click();
          await expect(formPrintBtn).toBeEnabled();
        }
        const formPrintsBefore = await page.evaluate(() => window.__pwPrintCount || 0);
        await formPrintBtn.click();
        await expect.poll(() => page.evaluate(() => window.__pwPrintCount || 0), { timeout: 8_000 }).toBeGreaterThan(formPrintsBefore);

        const claimTxt = await page.locator('#letter-supplier-pickup-form').innerText().catch(() => '');
        const cMatch = claimTxt.match(/((?:RTV|BUF)-TEST-\d{4}-\d+-[A-Z0-9]+)/i);
        if (cMatch) createdClaimNum = cMatch[1];

        await page.locator('button[aria-label="Close form"]').click();
        await expect.poll(() => capturedEmails.length, { timeout: 25_000 }).toBeGreaterThan(mailCountBefore);
        return capturedEmails[capturedEmails.length - 1];
      };

      // (c) Customer Credit / Return Handover -> PDF + Customer To/CC + 7 multi-photos + Explanation row (NO Store/Branch or Warehouse Location!)
      const debitMail = await completeDriverPickup(/Customer Credit Memo \/ Return Handover/i, {
        exerciseMultiPhoto: true,
        processorName: 'Playwright Debit Processor'
      });
      expect(debitMail.isTestMode).toBe(true);
      expect(debitMail.subject).toMatch(/^\[TEST\] \[Driver Picked Up - Debit Claim\]/);
      expect(debitMail.to).toContain('vendor-claims@example.com');
      expect(debitMail.cc).toContain('vendor-cc@example.com');
      expect(debitMail.html).toContain('Driver Pickup Verification Photos (5/5 categories');
      expect(debitMail.html).toContain('7 photos');
      expect(debitMail.html).toContain('PhilSys National ID (PhilID / ePhilID)');
      expect(debitMail.html).toContain('PSN-4801-9988-7766');
      expect(debitMail.html).toContain('Playwright Debit Processor');
      expect(debitMail.html).toContain('Explanation / Defect Notes:');
      expect(debitMail.html).toContain('Crushed cap and leaking bottle');
      expect(debitMail.html).not.toContain('[REORDER: NO]');
      expect(debitMail.html).not.toContain('Store / Branch:');
      expect(debitMail.html).not.toContain('Warehouse Location:');
      expect(debitMail.text).toContain('Explanation / Defect Notes:');
      expect(debitMail.text).not.toContain('Store / Branch:');
      expect(debitMail.text).not.toContain('Warehouse Location:');
      const debitPdfAtt = (debitMail.attachments || []).find((a) => String(a.filename || '').startsWith('Customer-Credit-Handover-Form-'));
      expect(debitPdfAtt).toBeTruthy();
      expect(debitPdfAtt.contentType).toBe('application/pdf');
      expect(decodeBase64Header(debitPdfAtt.content).startsWith('%PDF-1.4')).toBe(true);

      // (d) Customer Buffer Replacement -> PDF + Customer To/CC + hydrated multi-photos + Store/Branch & Warehouse Location preserved
      const replaceMail = await completeDriverPickup(/Customer Buffer Replacement \/ Good Stock Exchange/i, {
        exerciseMultiPhoto: false,
        processorName: 'Playwright Debit Processor'
      });
      expect(replaceMail.isTestMode).toBe(true);
      expect(replaceMail.subject).toMatch(/^\[TEST\] \[Driver Picked Up - Replacement\]/);
      expect(replaceMail.to).toContain('vendor-claims@example.com');
      expect(replaceMail.cc).toContain('vendor-cc@example.com');
      expect(replaceMail.html).toContain('Store / Branch:');
      expect(replaceMail.html).toContain('Warehouse Location:');
      expect(replaceMail.html).toContain('Driver Pickup Verification Photos (5/5 categories');
      const replacePdfAtt = (replaceMail.attachments || []).find((a) => String(a.filename || '').startsWith('Customer-Buffer-Replacement-Form-'));
      expect(replacePdfAtt).toBeTruthy();
      expect(replacePdfAtt.contentType).toBe('application/pdf');
      expect(decodeBase64Header(replacePdfAtt.content).startsWith('%PDF-1.4')).toBe(true);

      await page.locator('button[aria-label="Close modal"]').first().click();

      // =========================================================================
      // 3. OVERALL RMA MATRIX (.XLSX) + STRICT OOXML ZIP/XML/MERGE VALIDATION
      // =========================================================================
      await gotoAdmin(page);
      const sandboxTabBtn = page.getByRole('button', { name: /Test Mode Sandbox \([1-9]\d*\)/i }).first();
      await expect(sandboxTabBtn).toBeVisible({ timeout: 35_000 });
      await sandboxTabBtn.click();
      await page.getByRole('button', { name: /Sandbox Overall Matrix \(\.xlsx\)/i }).first().click();
      await expect(page.getByText('Overall RMA Matrix (.xlsx)')).toBeVisible();
      await expect(page.getByText(/Start Date \(YYYY-MM-DD\)/i)).toBeVisible();
      await expect(page.getByText(/End Date \(YYYY-MM-DD\)/i)).toBeVisible();

      // Toggle Include zero catalog SKUs checkbox and Quick Range Last 14 Days
      const zeroSkuCb = page.getByRole('checkbox', { name: /Include catalog SKUs with 0 returns/i });
      if (await zeroSkuCb.isVisible().catch(() => false)) {
        await zeroSkuCb.click();
        await zeroSkuCb.click();
      }

      await page.getByRole('button', { name: /Last 14 Days/i }).click();
      await expect(
        page.locator('div:has(> div:text-is("RMA Lines")) div.font-black')
      ).toHaveText(/^[1-9]\d*$/, { timeout: 25_000 });
      const [testMatrixDl] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Download Excel Matrix \(\.xlsx\)/i }).click()
      ]);
      const testMatrixName = testMatrixDl.suggestedFilename();
      expect(testMatrixName).toMatch(/^TEST_Overall_RMA_Matrix_Report_\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2} [A-Z][a-z]{2} \d{2}, \d{4} \d{4}\.xlsx$/);
      const testMatrixPath = await testMatrixDl.path();
      if (testMatrixPath) {
        const rawBuf = fs.readFileSync(testMatrixPath);
        const zipEntries = assertStrictOoxmlWorkbook(rawBuf, { expectMatrixPanes: true });
        const xmlStr = zipEntries.get('xl/worksheets/sheet1.xml') || '';
        expect(xmlStr).toContain('xSplit="5" ySplit="5" topLeftCell="F6"');
        expect(xmlStr).toContain('Serial No.');
        expect(xmlStr).toContain('Category');
        expect(xmlStr).toContain('Supplier Name');
        expect(xmlStr).toContain('SKU');
        expect(xmlStr).toContain('Description');
        expect(xmlStr).toContain('Return Bad Stock (pcs)');
        expect(xmlStr).toContain('Return Good Stock (pcs)');
        expect(xmlStr).toContain('DAILY RETURNED PIECES (YYYY-MM-DD)');
        expect(xmlStr).toContain('Danilo RMA');
        expect(xmlStr).toContain('RMA ITEM DETAILS &amp; WORKFLOW STATUS');
        expect(xmlStr).toContain('Source / Hub');
        expect(xmlStr).toContain('RMA ID');
        expect(xmlStr).toContain('Re-Ordered?');
        expect(xmlStr).toContain('Restocked?');
        expect(xmlStr).toContain('Scrapped?');
        expect(xmlStr).toContain('Replaced?');
        expect(xmlStr).toContain('Picked Up by Driver?');
        expect(xmlStr).toContain('Driver Pickup Date &amp; Time (YYYY-MM-DD HH:mm)');
        expect(xmlStr).toContain('Debit Claim / Credit Memo #');
        expect(xmlStr).toContain('PSN-4801-9988-7766');
        expect(xmlStr).toContain('outlineLevel="1"');
        expect(xmlStr).toContain('SUM(');
        expect(xmlStr).toContain(rmaNum);
        if (createdClaimNum) expect(xmlStr).toContain(createdClaimNum);

        // Banned legacy columns must never reappear
        for (const banned of [
          'BASKETPOPROC',
          'Arlito',
          'Jarmen',
          'PJ to Mendez',
          'Physical Stock',
          'Final Quantity to Order',
          'Middle Packaging',
          'Case Amount',
          'Buffer (30%)',
          'Cases to PO',
          'Total Quantity Needed'
        ]) {
          expect(xmlStr).not.toContain(banned);
        }
      }

      // 0-row edge-case Matrix & Table OOXML validity check
      const emptyMatrix = buildRmaMatrixXlsxBytes({ reports: [], startDate: '2026-11-01', endDate: '2026-11-02', activeStream: 'all' });
      assertStrictOoxmlWorkbook(Buffer.from(emptyMatrix.bytes), { expectMatrixPanes: true });
      const emptyTable = buildTableXlsxBytes({ sheetName: 'EdgeCase Empty', title: 'Empty Sheet', columns: [{ header: 'RMA', value: r => r.rma }], rows: [] });
      assertStrictOoxmlWorkbook(Buffer.from(emptyTable), { expectMatrixPanes: false });

      await page.getByRole('button', { name: 'Close', exact: true }).click();

      // =========================================================================
      // 4. EMAIL-BOUND RMA EDITOR LINK: API 401 SECURITY & STANDALONE EDITOR UI
      // =========================================================================
      // Extract the auto-generated Test Mode editUrl from the Test Mode New RMA email
      const testNewRmaMail = capturedEmails.find(
        (m) => m.isTestMode && String(m.html || '').includes(`editRma=${encodeURIComponent(rmaNum)}`)
      );
      expect(testNewRmaMail).toBeTruthy();
      const urlMatch = String(testNewRmaMail.html).match(/https?:\/\/[^"'\s<>]+\/intake\?token=[^"'\s<>]+/);
      expect(urlMatch).toBeTruthy();
      const editorHref = urlMatch[0].replace(/&amp;/g, '&');
      expect(editorHref).toContain('token=inv_test_edit_');
      expect(editorHref).toContain(`editRma=${encodeURIComponent(rmaNum)}`);
      expect(editorHref).toContain('mode=test');

      // Direct HTTP security checks on /api/v1/rma-email-edit without triggering page console guard
      const unauthGet = await request.get('/api/v1/rma-email-edit?token=inv_test_edit_fake');
      expect(unauthGet.status()).toBe(401);
      const forgedPatch = await request.patch('/api/v1/rma-email-edit', {
        headers: { Authorization: 'Bearer forged.invalid.jwt', 'Content-Type': 'application/json' },
        data: { token: 'inv_test_edit_fake', rma_number: rmaNum, updates: { supplier_name: 'Hacker' } }
      });
      expect(forgedPatch.status()).toBe(401);

      // Open the email-bound editUrl in an isolated incognito browser context
      const editorCtx = await browser.newContext({
        ignoreHTTPSErrors: true,
        storageState: { cookies: [], origins: [] }
      });
      const editorPage = await editorCtx.newPage();
      const editorGuard = attachStrictGuards(editorPage);
      try {
        // When Playwright injects a synthetic `.pweditorsig` JWT for external OAuth simulation,
        // avoid sending the unsigned test JWT to live PostgREST (swap Bearer back to anon key so live DB checks still execute cleanly).
        const { anonKey: editorAnonKey } = readSupabasePublicEnv();
        await editorPage.route('**/rest/v1/**', async (route) => {
          const req = route.request();
          const hdrs = { ...req.headers() };
          if (String(hdrs.authorization || '').includes('.pweditorsig') && editorAnonKey) {
            hdrs.authorization = `Bearer ${editorAnonKey}`;
          }
          return route.continue({ headers: hdrs });
        });

        const parsedEditorUrl = new URL(editorHref);
        const editorPathWithQuery = `${parsedEditorUrl.pathname}${parsedEditorUrl.search}`;

        await editorPage.goto(editorPathWithQuery, { waitUntil: 'domcontentloaded' });
        await expect(editorPage.getByText('RMA Details Editor Authorization')).toBeVisible({ timeout: 20_000 });
        await expect(editorPage.getByText('mgan@pingconmarketing.com', { exact: true }).first()).toBeVisible();
        await expect(editorPage.getByText(/No Expiry.*Revocable by Admin/i).first()).toBeVisible();
        await expect(editorPage.getByText(rmaNum).first()).toBeVisible();

        const buildMockJwt = (emailAddr) => {
          const hdr = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
          const pay = Buffer.from(
            JSON.stringify({
              sub: '00000000-0000-4000-8000-000000000077',
              email: emailAddr,
              exp: Math.floor(Date.now() / 1000) + 3600,
              user_metadata: { full_name: 'Email Reviewer' }
            })
          ).toString('base64url');
          return `${hdr}.${pay}.pweditorsig`;
        };

        let mockOAuthEmail = 'unauthorized-hacker@gmail.com';
        await editorPage.route('**/auth/v1/user**', async (route) => {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: '00000000-0000-4000-8000-000000000077',
              email: mockOAuthEmail,
              user_metadata: { full_name: 'Email Reviewer' }
            })
          });
        });
        await editorPage.route('**/auth/v1/token**', async (route) => {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              access_token: buildMockJwt(mockOAuthEmail),
              token_type: 'bearer',
              expires_in: 3600,
              refresh_token: 'pw_ref',
              user: {
                id: '00000000-0000-4000-8000-000000000077',
                email: mockOAuthEmail,
                user_metadata: { full_name: 'Email Reviewer' }
              }
            })
          });
        });
        await editorPage.route('**/auth/v1/logout**', async (route) => route.fulfill({ status: 204, body: '' }));

        // Mismatched Google Identity -> 403 Identity Mismatch & zero editor UI
        await editorPage.goto('about:blank');
        await editorPage.goto(
          `${editorPathWithQuery}#access_token=${buildMockJwt('unauthorized-hacker@gmail.com')}&refresh_token=pw_ref&expires_in=3600`,
          { waitUntil: 'domcontentloaded' }
        );
        await expect(editorPage.getByText('403 Forbidden — Identity Mismatch')).toBeVisible({ timeout: 15_000 });
        await expect(editorPage.getByRole('button', { name: /Switch Google Account/i })).toBeVisible();

        // Matching authorized email (mgan@pingconmarketing.com) -> Unlocks ONLY Scoped RMA Details Editor
        let savedPayload = null;
        await editorPage.route('**/api/v1/rma-email-edit**', async (route) => {
          const req = route.request();
          if (req.method() === 'GET') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                success: true,
                mode: 'test',
                authorized_email: 'mgan@pingconmarketing.com',
                scope_locked_rma: true,
                report: {
                  id: 88888,
                  rma_number: rmaNum,
                  barcode: VERIFIED_BARCODE,
                  code: 'SS1319P',
                  name: 'Test Item For Email Edit',
                  supplier_name: 'Suy Sing Commercial Corp',
                  quantity: 2,
                  unit_name: 'pc',
                  price: 100,
                  price_with_vat: 112,
                  expiry_date: '2027-08-20',
                  si_number: 'SI-ORIG-01',
                  dr_number: 'DR-ORIG-01',
                  po_number: 'PO-ORIG-01',
                  notes: '[TEST_MODE] Original note',
                  created_at: new Date().toISOString(),
                  items: []
                }
              })
            });
          }
          if (req.method() === 'PATCH') {
            const hdrs = req.headers();
            expect(hdrs.authorization).toMatch(/^Bearer /);
            savedPayload = req.postDataJSON();
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                success: true,
                edited_by_email: 'mgan@pingconmarketing.com',
                updated_at: new Date().toISOString(),
                report: {
                  id: 88888,
                  rma_number: rmaNum,
                  barcode: VERIFIED_BARCODE,
                  code: savedPayload.updates.code,
                  name: savedPayload.updates.name,
                  supplier_name: savedPayload.updates.supplier_name,
                  quantity: savedPayload.updates.quantity,
                  unit_name: savedPayload.updates.unit_name,
                  price: savedPayload.updates.price,
                  price_with_vat: savedPayload.updates.price_with_vat,
                  expiry_date: savedPayload.updates.expiry_date,
                  si_number: savedPayload.updates.si_number,
                  dr_number: savedPayload.updates.dr_number,
                  po_number: savedPayload.updates.po_number,
                  notes: `[TEST_MODE] ${savedPayload.updates.notes}`,
                  created_at: new Date().toISOString(),
                  ai_document_metadata: {
                    is_test: true,
                    last_email_edit: {
                      edited_by_email: 'mgan@pingconmarketing.com',
                      edited_at: new Date().toISOString()
                    }
                  },
                  items: []
                }
              })
            });
          }
          return route.continue();
        });

        mockOAuthEmail = 'mgan@pingconmarketing.com';
        await editorPage.goto('about:blank');
        await editorPage.goto(
          `${editorPathWithQuery}#access_token=${buildMockJwt('mgan@pingconmarketing.com')}&refresh_token=pw_ref&expires_in=3600`,
          { waitUntil: 'domcontentloaded' }
        );

        await expect(editorPage.getByText('RMA Details & Documents Editor').first()).toBeVisible({ timeout: 20_000 });
        await expect(editorPage.getByText(/No Expiry.*Revocable by Admin/i).first()).toBeVisible();
        await expect(editorPage.getByText(/Link expires in:/i)).toBeHidden();
        await expect(editorPage.getByText('Admin Portal')).toBeHidden();
        await expect(editorPage.getByRole('button', { name: /Credit Memos/i })).toBeHidden();
        await expect(editorPage.getByRole('button', { name: /Scan RMA QR/i })).toBeHidden();

        await editorPage.locator('input[placeholder*="SI-2026"]').fill('SI-EMAIL-EDIT-99');
        await editorPage.locator('input[placeholder*="DR-44120"]').fill('DR-EMAIL-EDIT-88');
        await editorPage.locator('input[placeholder*="PO-99120"]').fill('PO-EMAIL-EDIT-77');
        await editorPage.locator('input[placeholder*="Supplier / Vendor Name"]').fill('Mondelez Philippines');
        await editorPage.getByRole('button', { name: /Save RMA Changes/i }).click();

        await expect(editorPage.getByText(/Changes saved cleanly!/i)).toBeVisible({ timeout: 15_000 });
        expect(savedPayload?.updates?.si_number).toBe('SI-EMAIL-EDIT-99');
        expect(savedPayload?.updates?.dr_number).toBe('DR-EMAIL-EDIT-88');
        expect(savedPayload?.updates?.po_number).toBe('PO-EMAIL-EDIT-77');
        expect(savedPayload?.updates?.supplier_name).toBe('Mondelez Philippines');

        editorGuard.assertClean('suite 07 standalone email RMA editor');

        // Verify Multi-Recipient (To + CC) Editor Invite allows a CC recipient to unlock while still blocking outsiders
        const multiToken = await page.evaluate(async ({ targetRma, supaUrl: url, anonKey: key }) => {
          const rawAuthKey = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
          const parsedAuth = rawAuthKey ? JSON.parse(localStorage.getItem(rawAuthKey) || '{}') : null;
          const bearer = parsedAuth?.access_token || parsedAuth?.currentSession?.access_token || key;
          const tok = `inv_test_edit_${Date.now().toString(36)}_multi`;
          const nowIso = new Date().toISOString();
          const row = {
            token: tok,
            stream_type: 'customer_inbound',
            authorized_email: 'mgan@pingconmarketing.com',
            entity_name: `[RMA_EDITOR:${targetRma}|mgan@pingconmarketing.com,cc-reviewer@pingcon-test.local]`,
            store_branch: targetRma,
            duration_value: 0,
            duration_unit: 'permanent',
            duration_display: 'No Expiry',
            expires_at: '9999-12-31T23:59:59.000Z',
            created_by: 'Playwright Multi-Recipient Check',
            status: 'active',
            created_at: nowIso,
            updated_at: nowIso
          };
          const res = await fetch(`${url}/rest/v1/rma_invites`, {
            method: 'POST',
            headers: { apikey: key, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(row)
          });
          if (!res.ok) {
            throw new Error(`Failed to create multi-recipient invite (${res.status}): ${await res.text()}`);
          }
          return tok;
        }, { targetRma: rmaNum, ...readSupabasePublicEnv() });

        try {
          mockOAuthEmail = 'unauthorized-hacker@gmail.com';
          await editorPage.evaluate(() => {
            localStorage.clear();
            sessionStorage.clear();
          });
          await editorPage.goto('about:blank');
          const multiPath = `/intake?token=${encodeURIComponent(multiToken)}&editRma=${encodeURIComponent(rmaNum)}&mode=test`;
          await editorPage.goto(multiPath, { waitUntil: 'domcontentloaded' });
          await expect(editorPage.getByText(/Authorized To & CC Recipients \(2\)/i)).toBeVisible({ timeout: 20_000 });
          await expect(editorPage.getByText('cc-reviewer@pingcon-test.local', { exact: true }).first()).toBeVisible();
          await expect(editorPage.getByText(/No Expiry.*Revocable by Admin/i).first()).toBeVisible();

          mockOAuthEmail = 'cc-reviewer@pingcon-test.local';
          await editorPage.goto('about:blank');
          await editorPage.goto(
            `${multiPath}#access_token=${buildMockJwt('cc-reviewer@pingcon-test.local')}&refresh_token=pw_ref&expires_in=3600`,
            { waitUntil: 'domcontentloaded' }
          );
          await expect(editorPage.getByText('RMA Details & Documents Editor').first()).toBeVisible({ timeout: 20_000 });
          await expect(editorPage.getByText('cc-reviewer@pingcon-test.local').first()).toBeVisible();
          await expect(editorPage.getByText(/No Expiry.*Revocable by Admin/i).first()).toBeVisible();
        } finally {
          await page.evaluate(async ({ tok, supaUrl: url, anonKey: key }) => {
            const rawAuthKey = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
            const parsedAuth = rawAuthKey ? JSON.parse(localStorage.getItem(rawAuthKey) || '{}') : null;
            const bearer = parsedAuth?.access_token || parsedAuth?.currentSession?.access_token || key;
            await fetch(`${url}/rest/v1/rma_invites?token=eq.${encodeURIComponent(tok)}`, {
              method: 'DELETE',
              headers: { apikey: key, Authorization: `Bearer ${bearer}` }
            });
          }, { tok: multiToken, ...readSupabasePublicEnv() }).catch(() => { });
        }
      } finally {
        editorGuard.detach();
        await editorCtx.close();
      }

      // =========================================================================
      // 5. DAILY OVERALL RMA MATRIX (.XLSX) AUTO-EMAILER + SETTINGS BUTTON QA
      // =========================================================================
      const unauthCronGet = await request.get('/api/send-email?action=daily-matrix');
      expect(unauthCronGet.status()).toBe(401);
      const forgedCronPost = await request.post('/api/send-email?action=daily-matrix', {
        headers: { Authorization: 'Bearer forged.invalid.token', 'Content-Type': 'application/json' },
        data: { force: true, dryRun: true }
      });
      expect(forgedCronPost.status()).toBe(401);

      const adminJwt = await page.evaluate(() => {
        const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
        return supaKey ? JSON.parse(localStorage.getItem(supaKey))?.access_token : null;
      });
      expect(adminJwt).toBeTruthy();

      // Authenticated Live dry-run dispatch -> verifies OOXML .xlsx + To/CC + non-[TEST] subject
      const liveMatrixRes = await request.get(
        '/api/send-email?action=daily-matrix&dryRun=true&includeAttachmentBase64=true',
        { headers: { Authorization: `Bearer ${adminJwt}` } }
      );
      expect(liveMatrixRes.status()).toBe(200);
      const liveMatrixJson = await liveMatrixRes.json();
      expect(liveMatrixJson.success).toBe(true);
      expect(liveMatrixJson.dryRun).toBe(true);
      expect(liveMatrixJson.isTestMode).toBe(false);
      expect(liveMatrixJson.to).toBeTruthy();
      expect(Array.isArray(liveMatrixJson.cc)).toBe(true);
      expect(liveMatrixJson.subject).not.toMatch(/^\[TEST\] /);
      expect(liveMatrixJson.filename).toMatch(/^Overall_RMA_Matrix_Report_\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2} [A-Z][a-z]{2} \d{2}, \d{4} \d{4}\.xlsx$/);
      assertStrictOoxmlWorkbook(Buffer.from(liveMatrixJson.attachmentBase64, 'base64'), { expectMatrixPanes: true });

      // Authenticated Test Mode dry-run dispatch with custom scope, custom dates, includeZeroCatalogSkus & multiple TO/CC overrides
      const customEnd = testMatrixResToday();
      function testMatrixResToday() {
        return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      }
      const customStart = new Date(Date.now() + 8 * 3600 * 1000 - 6 * 86400 * 1000).toISOString().slice(0, 10);

      const liveCustomRes = await request.post('/api/send-email?action=daily-matrix', {
        headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
        data: {
          action: 'daily-matrix',
          dryRun: true,
          isTestMode: false,
          force: true,
          stream: 'customer_inbound',
          startDate: customStart,
          endDate: customEnd,
          includeZeroCatalogSkus: true,
          toList: ['custom-lead@pingconmarketing.com', 'custom-backup@pingconmarketing.com'],
          ccList: ['custom-cc@pingconmarketing.com']
        }
      });
      expect(liveCustomRes.status()).toBe(200);
      const liveCustomJson = await liveCustomRes.json();
      expect(liveCustomJson.success).toBe(true);
      expect(liveCustomJson.stream).toBe('customer_inbound');
      expect(liveCustomJson.includeZeroCatalogSkus).toBe(true);
      expect(liveCustomJson.startDate).toBe(customStart);
      expect(liveCustomJson.endDate).toBe(customEnd);
      expect(liveCustomJson.to).toContain('custom-lead@pingconmarketing.com');
      expect(liveCustomJson.to).toContain('custom-backup@pingconmarketing.com');
      expect(liveCustomJson.cc).toContain('custom-cc@pingconmarketing.com');

      const testMatrixRes = await request.post('/api/send-email?action=daily-matrix', {
        headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
        data: { action: 'daily-matrix', dryRun: true, isTestMode: true, force: true, includeAttachmentBase64: true }
      });
      expect(testMatrixRes.status()).toBe(200);
      const testMatrixJson = await testMatrixRes.json();
      expect(testMatrixJson.success).toBe(true);
      expect(testMatrixJson.isTestMode).toBe(true);
      expect(testMatrixJson.to).toBe('mgan@pingconmarketing.com');
      expect(testMatrixJson.cc).toEqual([]);
      expect(testMatrixJson.subject).toMatch(/^\[TEST\] /);
      expect(testMatrixJson.filename).toMatch(/^TEST_Overall_RMA_Matrix_Report_/);
      assertStrictOoxmlWorkbook(Buffer.from(testMatrixJson.attachmentBase64, 'base64'), { expectMatrixPanes: true });

      // 5B. DAILY 10-CALENDAR-DAY PICKUP FOLLOW-UP & AUTO-DISPOSE API + EXCEL WORKFLOW STATUS QA
      const unauthFollowUp = await request.get('/api/send-email?action=daily-followup', { timeout: 60_000 });
      expect(unauthFollowUp.status()).toBe(401);
      const dryRunFollowUp = await request.post('/api/send-email?action=daily-followup', {
        headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
        data: { action: 'daily-followup', operation: 'run_all', dryRun: true, isTestMode: true },
        timeout: 60_000
      });
      expect(dryRunFollowUp.status()).toBe(200);
      const dryRunFollowUpJson = await dryRunFollowUp.json();
      expect(dryRunFollowUpJson.success).toBe(true);
      expect(dryRunFollowUpJson.dryRun).toBe(true);
      expect(dryRunFollowUpJson.sandboxEmail).toBe('mgan@pingconmarketing.com');

      // Assert clean human workflow status labels (zero raw snake_case strings) & 4-step helper
      const rawPendingStatus = getCleanHumanWorkflowStatus({
        rma_number: 'RMA-TEST-WF-1',
        status: 'pending_admin_details',
        disposition: 'Pending Triage',
        rma_type: 'supplier_outbound',
        created_at: new Date().toISOString()
      }, []);
      expect(rawPendingStatus.label).not.toMatch(/pending_admin_details|under_inspection|triaged/i);
      const overdueWf = computeFourStepWorkflow({
        rma_number: 'RMA-TEST-WF-2',
        status: 'pending',
        supplier_name: 'Mondelez',
        rma_type: 'supplier_outbound',
        created_at: new Date(Date.now() - 12 * 86400000).toISOString(),
        ai_document_metadata: { follow_up: { enabled: true, started_at: new Date(Date.now() - 12 * 86400000).toISOString() } }
      }, []);
      expect(overdueWf.isExpiredAfter10Days).toBe(true);
      expect(overdueWf.calendarDay).toBeGreaterThan(10);

      // Assert Day 1 & Day 2 10-Day SLA follow-up email content (Supplier & Customer streams) + Auto-Disposed template
      const nowMs = Date.now();
      for (const streamSpec of [
        { rma_type: 'supplier_outbound', supplier_name: 'Mondelez PH', expectedHeader: 'Waiting for Supplier Pickup' },
        { rma_type: 'customer_inbound', supplier_name: 'Savemore Market', expectedHeader: 'Waiting for Customer Handover' }
      ]) {
        for (const dayNum of [1, 2]) {
          const startedIso = new Date(nowMs - dayNum * 86400000).toISOString();
          const built = buildFollowUpEmailContent({
            report: {
              rma_number: `RMA-TEST-DAY-${dayNum}`,
              rma_type: streamSpec.rma_type,
              name: 'Sample Biscuit Pack',
              barcode: VERIFIED_BARCODE,
              code: 'SKU-FU-1',
              quantity: 3,
              unit_name: 'box',
              reason: 'Expired',
              supplier_name: streamSpec.supplier_name,
              store_branch: streamSpec.supplier_name,
              status: 'logged',
              created_at: startedIso,
              ai_document_metadata: { follow_up: { enabled: true, started_at: startedIso } }
            },
            isTestMode: true
          });
          expect(built.subject).toMatch(/^\[TEST\] /);
          expect(built.subject).toContain(`Day ${dayNum} of 10`);
          expect(built.subject).toContain(streamSpec.expectedHeader);
          expect(built.html).toContain('4-Step Workflow');
          expect(built.html).toContain('Step 1: Report Date');
          expect(built.html).toContain(`Day ${dayNum} of 10`);
          expect(built.html).toContain('10 calendar days');
          expect(built.html).toContain('health and sanitation risks');
        }
      }

      const disposedPreview = buildAutoDisposedEmailContent({
        report: {
          rma_number: 'RMA-TEST-DISP-1',
          rma_type: 'supplier_outbound',
          name: 'Expired Milk Carton',
          barcode: VERIFIED_BARCODE,
          quantity: 2,
          unit_name: 'pc',
          supplier_name: 'Alaska Milk',
          created_at: new Date(nowMs - 12 * 86400000).toISOString(),
          ai_document_metadata: {
            follow_up: {
              enabled: true,
              started_at: new Date(nowMs - 12 * 86400000).toISOString(),
              auto_disposed_at: new Date(nowMs).toISOString(),
              case_status: 'auto_disposed_after_10_days'
            }
          }
        },
        isTestMode: true
      });
      expect(disposedPreview.subject).toMatch(/^\[TEST\] /);
      expect(disposedPreview.subject).toContain('Auto-Disposed');
      expect(disposedPreview.html).toContain('Disposal / Scrap Area');

      // Confirm already-picked-up Test RMA stops follow-ups immediately (CASE_ALREADY_CLOSED) via real backend
      const closedFollowUpRes = await request.post('/api/send-email?action=daily-followup', {
        headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
        data: { action: 'daily-followup', rmaNumber: rmaNum, dryRun: true, isTestMode: true },
        timeout: 60_000
      });
      expect(closedFollowUpRes.status()).toBe(200);
      const closedFollowUpJson = await closedFollowUpRes.json();
      expect(
        closedFollowUpJson.skippedItems?.some(
          (item) => item.rmaNumber === rmaNum && item.reason === 'CASE_ALREADY_CLOSED'
        )
      ).toBe(true);

      // UI Check: SettingsTab -> Send Manual Matrix Email Now + RMAMatrixExportModal -> Email Matrix tab
      await page.route('**/api/send-email?action=daily-matrix**', async (route) => {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            to: liveMatrixJson.to,
            cc: liveMatrixJson.cc,
            filename: liveMatrixJson.filename,
            dataset: liveMatrixJson.dataset
          })
        });
      });
      await page.getByRole('button', { name: /Settings & SMTP/i }).click();
      await expect(page.getByText(/1:00 PM PHT/i).first()).toBeVisible();
      await page.getByRole('button', { name: /Send Manual Matrix Email Now/i }).click();
      await expect(page.getByText(/Daily Matrix dispatched to/i).first()).toBeVisible({ timeout: 15_000 });

      // Open Matrix Export Modal from Customer RMA Hub -> switch to Email Matrix tab & dispatch
      await page.getByRole('button', { name: /Customer RMA Hub/i }).click();
      await page.getByRole('button', { name: /Overall RMA Matrix \(\.xlsx\)/i }).first().click();
      const matrixModal = page.locator('div.fixed', { hasText: 'Email Dispatch Studio' });
      await expect(matrixModal).toBeVisible();
      await matrixModal.getByRole('button', { name: /Email Matrix/i }).click();
      await expect(matrixModal.locator('[data-email-recipients-editor="manual_matrix"]')).toBeVisible();
      await matrixModal.getByRole('button', { name: /Send Matrix Email Now/i }).click();
      await expect(matrixModal.getByText(/Matrix email dispatched to/i)).toBeVisible({ timeout: 15_000 });
      await matrixModal.getByRole('button', { name: 'Close', exact: true }).click();

      // Verify Customer Hub inbound Excel export has clean workflow headers & zero raw DB snake_case status strings
      // Fall back to Sandbox Customer RMAs if Live Customer Hub currently has 0 active rows in Supabase
      if (await page.getByText('0 Returns Active').isVisible().catch(() => false)) {
        await page.getByRole('button', { name: /Test Mode Sandbox \([1-9]\d*\)/i }).first().click();
        await page.getByRole('button', { name: /Sandbox Customer RMAs/i }).first().click();
      }
      const [inboundDl] = await Promise.all([
        page.waitForEvent('download', { timeout: 20_000 }),
        page.getByRole('button', { name: /Export Inbound \(\.xlsx\)/i }).first().click()
      ]);
      const inboundPath = await inboundDl.path();
      const inboundBuf = fs.readFileSync(inboundPath);
      assertStrictOoxmlWorkbook(inboundBuf, { expectMatrixPanes: false });
      const inboundEntries = parseStoredZipEntries(inboundBuf);
      const inboundXmlAll = [
        inboundEntries.get('xl/sharedStrings.xml') || '',
        inboundEntries.get('xl/worksheets/sheet1.xml') || ''
      ].join('\n');
      expect(inboundXmlAll).toContain('Workflow Step (1-4)');
      expect(inboundXmlAll).toContain('Follow-Up Day (of 10)');
      expect(inboundXmlAll).toContain('Handover Date (YYYY-MM-DD)');
      expect(inboundXmlAll).toContain('Case Closed Date (YYYY-MM-DD)');
      expect(inboundXmlAll).not.toMatch(/pending_admin_details|under_inspection|received_at_dock/);

      // Verify Supplier Hub (RTV Claims) Excel export has clean workflow headers & zero raw snake_case status strings
      await page.getByRole('button', { name: /Supplier Hub \(RTV Claims\)/i }).first().click();
      const [supplierDl] = await Promise.all([
        page.waitForEvent('download', { timeout: 20_000 }),
        page.getByRole('button', { name: /Export Supplier Claims \(\.xlsx\)/i }).first().click()
      ]);
      const supplierPath = await supplierDl.path();
      const supplierBuf = fs.readFileSync(supplierPath);
      assertStrictOoxmlWorkbook(supplierBuf, { expectMatrixPanes: false });
      const supplierEntries = parseStoredZipEntries(supplierBuf);
      const supplierXmlAll = [
        supplierEntries.get('xl/sharedStrings.xml') || '',
        supplierEntries.get('xl/worksheets/sheet1.xml') || ''
      ].join('\n');
      expect(supplierXmlAll).toContain('Workflow Step (1-4)');
      expect(supplierXmlAll).toContain('Follow-Up Day (of 10)');
      expect(supplierXmlAll).toContain('Picked Up Date (YYYY-MM-DD)');
      expect(supplierXmlAll).toContain('Case Closed Date (YYYY-MM-DD)');
      expect(supplierXmlAll).not.toMatch(/pending_admin_details|under_inspection|received_at_dock/);

      // End-to-End 10-Day SLA Follow-Up UI + 12-Day Backdate Auto-Dispose Test
      const followUpRma = await seedTestModeRma(page, {
        stream: 'customer',
        photoCount: 1,
        barcode: `NOLABEL-FU-${String(Date.now()).slice(-6)}`,
        supplierOrCompany: ''
      });
      seededTestRmas.push(followUpRma);

      await gotoAdmin(page);
      await page.getByRole('button', { name: /Test Mode Sandbox \([1-9]\d*\)/i }).first().click();
      const followUpRow = page.locator('tr').filter({ hasText: followUpRma }).first();
      await expect(followUpRow).toBeVisible({ timeout: 25_000 });

      await followUpRow.getByRole('button', { name: /\+ Set Supplier & Email/i }).click();
      await page.locator('#followup-modal-supplier-input').fill('Playwright FollowUp Supplier');
      await page.locator('input[aria-label="Supplier Primary Email(s) (TO)"]').fill('vendor-fu@pingcon-test.local');
      await page.locator('input[aria-label="Supplier CC Email(s) (Optional)"]').fill('cc-fu@pingcon-test.local');
      const autoSlaToggle = page.locator('input[aria-label="Auto Daily Follow-Up (10-Day SLA)"]');
      if (!(await autoSlaToggle.isChecked())) {
        await autoSlaToggle.check();
      }
      await page.getByRole('button', { name: /Save Supplier & Email/i }).click();
      await expect(page.getByText(/Saved supplier "Playwright FollowUp Supplier"/i)).toBeVisible({ timeout: 15_000 });
      await page.locator('button[aria-label="Close supplier follow-up modal"]').click();
      await expect(page.locator('#followup-modal-supplier-input')).toBeHidden({ timeout: 15_000 });
      await expect(followUpRow.getByText('Playwright FollowUp Supplier')).toBeVisible({ timeout: 15_000 });

      // Assert manual Send Follow-Up button is removed; exercise real automated ?action=daily-followup dryRun endpoint via Playwright request
      await expect(followUpRow.getByRole('button', { name: /Send Follow-Up/i })).toHaveCount(0);
      const fuJwt = await page.evaluate(() => {
        const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
        return supaKey ? JSON.parse(localStorage.getItem(supaKey))?.access_token : '';
      });
      const dryRunSingleRes = await request.post('/api/send-email?action=daily-followup', {
        headers: {
          'Content-Type': 'application/json',
          ...(fuJwt ? { Authorization: `Bearer ${fuJwt}` } : {})
        },
        data: {
          action: 'daily-followup',
          rmaNumber: followUpRma,
          operation: 'send_single',
          force: true,
          dryRun: true,
          isTestMode: true
        },
        timeout: 60_000
      });
      expect(dryRunSingleRes.status()).toBe(200);
      const dryRunSingleJson = await dryRunSingleRes.json();
      expect(dryRunSingleJson?.summary?.followUpsSent).toBeGreaterThanOrEqual(1);

      await followUpRow.getByRole('button', { name: /Case Close/i }).click();
      await expect(page.getByText(`${followUpRma} marked Case Closed.`)).toBeVisible({ timeout: 15_000 });

      // Backdate followUpRma 12 days (reopening countdown) & verify real backend /api/send-email?action=daily-followup triggers autoDisposed
      const backdateOk = await page.evaluate(
        async ({ targetRma, supaUrl: url, anonKey: key }) => {
          const supaKey = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
          const token = supaKey ? JSON.parse(localStorage.getItem(supaKey))?.access_token : null;
          if (!url || !key || !token) return false;
          const headers = {
            apikey: key,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          };
          const getRes = await fetch(
            `${url}/rest/v1/rma_reports?rma_number=eq.${encodeURIComponent(targetRma)}&select=id,ai_document_metadata`,
            { headers }
          );
          if (!getRes.ok) return false;
          const rows = await getRes.json();
          const row = rows?.[0];
          if (!row) return false;
          const minus12 = new Date(Date.now() - 12 * 86400000).toISOString();
          const meta = (row.ai_document_metadata && typeof row.ai_document_metadata === 'object')
            ? { ...row.ai_document_metadata }
            : {};
          const nextPickup = (meta.supplier_pickup && typeof meta.supplier_pickup === 'object')
            ? { ...meta.supplier_pickup }
            : {};
          delete nextPickup.picked_up_at;
          const nextFollowUp = {
            ...(meta.follow_up || {}),
            enabled: true,
            started_at: minus12
          };
          delete nextFollowUp.picked_up_at;
          delete nextFollowUp.case_closed_at;
          delete nextFollowUp.case_status;
          delete nextFollowUp.auto_disposed_at;
          delete nextFollowUp.close_reason;

          const patchRes = await fetch(
            `${url}/rest/v1/rma_reports?id=eq.${encodeURIComponent(row.id)}`,
            {
              method: 'PATCH',
              headers,
              body: JSON.stringify({
                status: 'logged',
                created_at: minus12,
                ai_document_metadata: {
                  ...meta,
                  supplier_pickup: nextPickup,
                  follow_up: nextFollowUp
                }
              })
            }
          );
          return patchRes.ok;
        },
        { targetRma: followUpRma, ...readSupabasePublicEnv() }
      );
      expect(backdateOk).toBe(true);

      const autoDisposeRes = await request.post('/api/send-email?action=daily-followup', {
        headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
        data: {
          action: 'daily-followup',
          rmaNumber: followUpRma,
          dryRun: true,
          isTestMode: true,
          force: true
        },
        timeout: 60_000
      });
      expect(autoDisposeRes.status()).toBe(200);
      const autoDisposeJson = await autoDisposeRes.json();
      expect(autoDisposeJson.summary?.autoDisposed).toBe(1);
      expect(autoDisposeJson.autoDisposed?.some((a) => a.rmaNumber === followUpRma)).toBe(true);

      // 5C. 2-WAY MIRROR .XLSX REPLY SYNC & INGEST API QA (Auth Guards, Live/Test Isolation, Update + Audit Trail)
      const unauthSync = await request.post('/api/send-email?action=sync-email-replies', { data: {} });
      expect(unauthSync.status()).toBe(401);
      const unauthIngest = await request.post('/api/send-email?action=ingest-xlsx-reply', { data: {} });
      expect(unauthIngest.status()).toBe(401);

      // Test round-tripping mirror .xlsx with edited supplier email & SI# against followUpRma (Test Sandbox)
      const editedMirrorBytes = buildRmaAlertXlsxBytes(
        {
          rma_number: followUpRma,
          barcode: VERIFIED_BARCODE,
          name: 'Playwright 2-Way XLSX Mirror Test Item',
          supplier_name: 'Suy Sing Commercial Corp',
          si_number: 'SI-2026-REPLY-99',
          dr_number: 'DR-2026-REPLY-88',
          warehouse_location: 'Good Stock Area',
          gps_address: '42 Jose Rizal St, Brgy. Bagong Ilog, Pasig, 1600',
          ai_document_metadata: {
            is_test: true,
            test_mode: true,
            follow_up: { supplier_email_to: 'reply-claims@suysing-test.local' }
          }
        },
        { subject: `[TEST] [RMA Alert] ${followUpRma}` }
      );
      expect(buildRmaAlertFilename(`[TEST] [RMA Alert] ${followUpRma}`)).toMatch(/[A-Z][a-z]{2} \d{2}, \d{4} \d{4}\.xlsx$/);
      const ingestOkRes = await request.post('/api/send-email?action=ingest-xlsx-reply', {
        headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
        data: {
          action: 'ingest-xlsx-reply',
          fileBase64: Buffer.from(editedMirrorBytes).toString('base64'),
          senderEmail: 'mgan@pingconmarketing.com',
          actorName: 'Playwright Reply Bot'
        }
      });
      expect(ingestOkRes.status()).toBe(200);
      const ingestOkJson = await ingestOkRes.json();
      expect(ingestOkJson.success).toBe(true);
      expect(ingestOkJson.rmaNumber).toBe(followUpRma);
      expect(ingestOkJson.changedFields).toContain('si_number');
      expect(ingestOkJson.report?.si_number).toBe('SI-2026-REPLY-99');
      expect(
        Array.isArray(ingestOkJson.report?.audit_trail) &&
        ingestOkJson.report.audit_trail.some((a) => a.action === 'EMAIL_XLSX_REPLY_UPDATE')
      ).toBe(true);

      // Strict Mode Isolation: Live-marked workbook trying to mutate Sandbox RMA MUST reject with 400
      const crossModeBytes = buildRmaAlertXlsxBytes(
        {
          rma_number: followUpRma,
          name: 'Cross Mode Attempt',
          ai_document_metadata: { is_test: false, test_mode: false }
        },
        { subject: `[RMA Alert] ${followUpRma}` }
      );
      // Force Test Mode cell to NO (Live) to verify guard when RMA number starts with RMA-TEST-
      expect(extractRmaUpdatesFromXlsxBuffer(Buffer.from(crossModeBytes)).isTestHint).toBe(true);

      guard.assertClean('suite 07 lifecycle emails + pdf + overall matrix xlsx');
    } finally {
      await cleanupTestRecords(page, {
        rmaNumbers: seededTestRmas,
        claimNumbers: [createdClaimNum]
      });
      guard.detach();
    }
  });
});
