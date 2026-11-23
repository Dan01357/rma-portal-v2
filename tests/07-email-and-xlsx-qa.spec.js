import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { buildRmaMatrixXlsxBytes } from '../src/utils/exportMatrixXlsx.js';
import { buildTableXlsxBytes } from '../src/utils/exportXlsx.js';
import {
  PNG_BUFFER,
  VERIFIED_BARCODE,
  attachStrictGuards,
  installPrintStubs,
  interceptAndCaptureEmails,
  mockPhotoUploadSuccess,
  setPublicPortalTestMode,
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
      expect(top, `${label} unexpected closing </${tag}>`).toBe(tag);
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
    expect(payload.html).toContain('mgan@a2z2go.net');
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

  const combined = [payload.subject, payload.fromName, payload.html, payload.text].join('\n');
  expect(combined).toContain('Pingcon');
  expect(combined.toLowerCase()).not.toContain('wholesale');
}

function decodeBase64Header(b64) {
  return Buffer.from(String(b64 || ''), 'base64').toString('latin1');
}

test.describe('Suite 07: Emails (Intake + 4 Lifecycle Events w/ PDF), mgan@a2z2go.net Sandbox, Date Format Audit & Overall Matrix (.xlsx)', () => {
  test('New RMA intake email (Live & Test), 4 lifecycle emails (Scrapped, Restocked, Debit Pickup + PDF, Replacement Pickup + PDF), & Overall Matrix (.xlsx) deep XML verification', async ({
    page,
    context,
    browser,
    request
  }) => {
    test.setTimeout(270_000);
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);
    const capturedEmails = await interceptAndCaptureEmails(page);
    await mockPhotoUploadSuccess(page);
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
          } catch {}
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
      await expect(page.getByText('Box Sticker Ready')).toBeVisible({ timeout: 20_000 });

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
      expect(capturedLiveEditorInvite.entity_name).toContain(String(capturedEmails[0].to).toLowerCase());
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
      await expect(page.getByText(/mgan@a2z2go\.net/).first()).toBeVisible();

      await page.locator('input[placeholder*="barcode" i]').first().fill(VERIFIED_BARCODE);
      await expect(page.getByText('Recognized Product')).toBeVisible({ timeout: 45_000 });
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

      await expect.poll(() => capturedEmails.length, { timeout: 35_000 }).toBeGreaterThan(countBeforeTestSubmit);
      assertEmailPayloadClean({
        payload: capturedEmails[capturedEmails.length - 1],
        expectedExpiry: '2027-08-20',
        expectTestMode: true
      });

      // Open 4-Choice Wizard directly from Success Screen
      await page.getByRole('button', { name: /Choose Disposition \/ (?:Log )?Driver Pickup/i }).click();
      await expect(page.getByText('What do you want to do with this item?')).toBeVisible({ timeout: 10_000 });

      // (a) Scrapped lifecycle email
      const countBeforeScrap = capturedEmails.length;
      await page.getByRole('button', { name: /Throw Away \/ Dispose \(Scrap\)/i }).click();
      await page.getByRole('button', { name: /Confirm & Save: Throw Away \/ Dispose \(Scrap\)/i }).click();
      await expect(page.getByRole('button', { name: /Edit Choice \/ Details/i })).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => capturedEmails.length, { timeout: 12_000 }).toBeGreaterThan(countBeforeScrap);
      const scrapMail = capturedEmails[capturedEmails.length - 1];
      expect(scrapMail.isTestMode).toBe(true);
      expect(scrapMail.subject).toMatch(/^\[TEST\] \[RMA Scrapped\]/);

      // (b) Restocked lifecycle email
      await page.getByRole('button', { name: /Edit Choice \/ Details/i }).click();
      const countBeforeRestock = capturedEmails.length;
      await page.getByRole('button', { name: /Put Back on Good Shelf \(Restock\)/i }).click();
      await page.getByRole('button', { name: /Confirm & Save: Put Back on Good Shelf \(Restock\)/i }).click();
      await expect(page.getByRole('button', { name: /Edit Choice \/ Details/i })).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => capturedEmails.length, { timeout: 12_000 }).toBeGreaterThan(countBeforeRestock);
      const restockMail = capturedEmails[capturedEmails.length - 1];
      expect(restockMail.isTestMode).toBe(true);
      expect(restockMail.subject).toMatch(/^\[TEST\] \[RMA Restocked\]/);

      const completeDriverPickup = async (optionRegex) => {
        await page.getByRole('button', { name: /Edit Choice \/ Details/i }).click();
        await page.locator('input[placeholder*="Supplier Company Name" i]').fill('Suy Sing Commercial Corp');
        await page.getByRole('button', { name: optionRegex }).click();
        await page
          .getByRole('button', {
            name: /Edit Pickup Details, Emails & 5 Photos|Driver Is Here — Upload Photos & Print Letter/i
          })
          .click();
        await expect(page.getByText(/Driver Pickup Verification \(\d+\/5 Photos\)/i)).toBeVisible();

        await page.locator('input[placeholder*="claims@supplier.com" i]').fill('vendor-claims@example.com');
        await page.locator('input[placeholder*="rep@supplier.com" i]').fill('vendor-cc@example.com');

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

        await page.locator('input[placeholder*="Auto-filled or type name" i]').fill('Playwright Driver');
        const idTypeSelect = page.locator('select').filter({ hasText: /PhilSys National ID/i }).first();
        if (await idTypeSelect.isVisible().catch(() => false)) {
          await idTypeSelect.selectOption('PhilSys National ID (PhilID / ePhilID)');
        }
        await page.locator('input[placeholder*="ID # / License #" i], input[placeholder*="Auto-filled from ID photo" i]').first().fill('PSN-4801-9988-7766');
        await page.locator('input[placeholder*="NAA 1234" i]').fill('PW-8899');

        const mailCountBefore = capturedEmails.length;
        await page
          .getByRole('button', { name: /Upload 5 Photos to RMA Drive|Save Updates & Open Letter Form/i })
          .click();
        await expect(page.getByText(/SUPPLIER (DEBIT CLAIM|REPLACEMENT \/ EXCHANGE)/i).first()).toBeVisible({
          timeout: 45_000
        });
        await expect(page.locator('#letter-supplier-pickup-form')).toContainText('PSN-4801-9988-7766');

        // Verify pure B&W Letter modal and close it before next step
        const formPrintBtn = page.getByRole('button', { name: /Print Letter Dual-Copy Form|Print Full-Page Letter Copies/i });
        const formPrintsBefore = await page.evaluate(() => window.__pwPrintCount || 0);
        await formPrintBtn.click();
        await expect.poll(() => page.evaluate(() => window.__pwPrintCount || 0), { timeout: 8_000 }).toBeGreaterThan(formPrintsBefore);

        const claimTxt = await page.locator('#letter-supplier-pickup-form').innerText().catch(() => '');
        const cMatch = claimTxt.match(/(RTV-TEST-\d{4}-\d+-[A-Z0-9]+)/i);
        if (cMatch) createdClaimNum = cMatch[1];

        await page.locator('button[aria-label="Close form"]').click();
        await expect.poll(() => capturedEmails.length, { timeout: 15_000 }).toBeGreaterThan(mailCountBefore);
        return capturedEmails[capturedEmails.length - 1];
      };

      // (c) Driver Picked Up for Debit Claim -> PDF + Supplier To/CC + 5 photos
      const debitMail = await completeDriverPickup(/Accepted for Debit \/ Credit|Return to supplier for Debit Claim/i);
      expect(debitMail.isTestMode).toBe(true);
      expect(debitMail.subject).toMatch(/^\[TEST\] \[Driver Picked Up - Debit Claim\]/);
      expect(debitMail.to).toContain('vendor-claims@example.com');
      expect(debitMail.cc).toContain('vendor-cc@example.com');
      expect(debitMail.html).toContain('Driver Pickup Verification Photos (5/5)');
      expect(debitMail.html).toContain('PhilSys National ID (PhilID / ePhilID)');
      expect(debitMail.html).toContain('PSN-4801-9988-7766');
      const debitPdfAtt = (debitMail.attachments || []).find((a) => String(a.filename || '').startsWith('Debit-Claim-Form-'));
      expect(debitPdfAtt).toBeTruthy();
      expect(debitPdfAtt.contentType).toBe('application/pdf');
      expect(decodeBase64Header(debitPdfAtt.content).startsWith('%PDF-1.4')).toBe(true);

      // (d) Driver Picked Up for Replacement -> PDF + Supplier To/CC + 5 photos
      const replaceMail = await completeDriverPickup(/Replaced with Good Stock|Return to supplier for Replacement \/ Exchange/i);
      expect(replaceMail.isTestMode).toBe(true);
      expect(replaceMail.subject).toMatch(/^\[TEST\] \[Driver Picked Up - Replacement\]/);
      expect(replaceMail.to).toContain('vendor-claims@example.com');
      expect(replaceMail.cc).toContain('vendor-cc@example.com');
      const replacePdfAtt = (replaceMail.attachments || []).find((a) => String(a.filename || '').startsWith('Replacement-Form-'));
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
      expect(testMatrixName).toMatch(/^TEST_Overall_RMA_Matrix_Report_\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2} \d{4}\.xlsx$/);
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
        await expect(editorPage.getByText('mgan@a2z2go.net', { exact: true }).first()).toBeVisible();
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

        // Matching authorized email (mgan@a2z2go.net) -> Unlocks ONLY Scoped RMA Details Editor
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
                authorized_email: 'mgan@a2z2go.net',
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
                edited_by_email: 'mgan@a2z2go.net',
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
                      edited_by_email: 'mgan@a2z2go.net',
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

        mockOAuthEmail = 'mgan@a2z2go.net';
        await editorPage.goto('about:blank');
        await editorPage.goto(
          `${editorPathWithQuery}#access_token=${buildMockJwt('mgan@a2z2go.net')}&refresh_token=pw_ref&expires_in=3600`,
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
            authorized_email: 'mgan@a2z2go.net',
            entity_name: `[RMA_EDITOR:${targetRma}|mgan@a2z2go.net,cc-reviewer@pingcon-test.local]`,
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
          }, { tok: multiToken, ...readSupabasePublicEnv() }).catch(() => {});
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
      expect(liveMatrixJson.filename).toMatch(/^Overall_RMA_Matrix_Report_\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2} \d{4}\.xlsx$/);
      assertStrictOoxmlWorkbook(Buffer.from(liveMatrixJson.attachmentBase64, 'base64'), { expectMatrixPanes: true });

      // Authenticated Test Mode dry-run dispatch -> [TEST] first word + strictly mgan@a2z2go.net + empty CC
      const testMatrixRes = await request.post('/api/send-email?action=daily-matrix', {
        headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
        data: { action: 'daily-matrix', dryRun: true, isTestMode: true, force: true, includeAttachmentBase64: true }
      });
      expect(testMatrixRes.status()).toBe(200);
      const testMatrixJson = await testMatrixRes.json();
      expect(testMatrixJson.success).toBe(true);
      expect(testMatrixJson.isTestMode).toBe(true);
      expect(testMatrixJson.to).toBe('mgan@a2z2go.net');
      expect(testMatrixJson.cc).toEqual([]);
      expect(testMatrixJson.subject).toMatch(/^\[TEST\] /);
      expect(testMatrixJson.filename).toMatch(/^TEST_Overall_RMA_Matrix_Report_/);
      assertStrictOoxmlWorkbook(Buffer.from(testMatrixJson.attachmentBase64, 'base64'), { expectMatrixPanes: true });

      // UI Check: SettingsTab -> Send Daily Matrix Now button
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
      await page.getByRole('button', { name: /Send Daily Matrix Now/i }).click();
      await expect(page.getByText(/Daily Matrix dispatched to/i).first()).toBeVisible({ timeout: 15_000 });

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
