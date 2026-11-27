import fs from 'node:fs';
import zlib from 'node:zlib';
import { test, expect } from '@playwright/test';
import { buildRmaAlertXlsxBytes } from '../src/utils/rmaAlertXlsx.js';
import { buildTableXlsxBytes } from '../src/utils/exportXlsx.js';
import { extractRmaUpdatesFromXlsxBuffer } from '../api/_lib/imapReplySyncHandler.js';
import {
  PNG_BUFFER,
  VERIFIED_BARCODE,
  attachStrictGuards,
  installPrintStubs,
  interceptAndCaptureEmails,
  mockPhotoUploadSuccess,
  setPublicPortalTestMode,
  assertNoHorizontalOverflow,
  isoDateDaysOffset,
  seedTestModeRma,
  gotoAdmin,
  navigateAdminSidebar,
  openSettingsSubTab,
  readSupabasePublicEnv,
  cleanupTestRecords
} from './helpers/testUtils.js';

/**
 * Decodes stored (method 0) or deflate (method 8) ZIP entries from an .xlsx Buffer.
 */
function readXlsxEntries(buf) {
  const entries = new Map();
  let offset = 0;
  while (offset + 4 <= buf.length) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) break;
    const flags = buf.readUInt16LE(offset + 6);
    const method = buf.readUInt16LE(offset + 8);
    let compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buf.subarray(nameStart, nameStart + nameLen).toString('utf8');
    const dataStart = nameStart + nameLen + extraLen;
    if ((flags & 0x08) && compSize === 0) {
      const ddSig = buf.indexOf(Buffer.from([0x50, 0x4b, 0x07, 0x08]), dataStart);
      if (ddSig > dataStart) {
        compSize = ddSig - dataStart;
      }
    }
    const rawSlice = buf.subarray(dataStart, dataStart + compSize);
    let content = '';
    if (method === 0) {
      content = rawSlice.toString('utf8');
    } else if (method === 8) {
      content = zlib.inflateRawSync(rawSlice).toString('utf8');
    }
    entries.set(name, content);
    offset = dataStart + compSize;
    if ((flags & 0x08) && buf.readUInt32LE(offset) === 0x08074b50) {
      offset += 16;
    }
  }
  return entries;
}

/**
 * Parses cell A/B/C text rows from an .xlsx Buffer supporting inlineStr & sharedStrings.xml.
 */
function extractSheetRowsText(buf) {
  const entries = readXlsxEntries(buf);
  const ssXml = entries.get('xl/sharedStrings.xml') || '';
  const sharedStrings = [];
  const siRe = /<si[^>]*>([\s\S]*?)<\/si>/g;
  let siMatch;
  while ((siMatch = siRe.exec(ssXml)) !== null) {
    const tParts = [];
    const tRe = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g;
    let tMatch;
    while ((tMatch = tRe.exec(siMatch[1])) !== null) {
      tParts.push(tMatch[1]);
    }
    sharedStrings.push(
      tParts
        .join('')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
    );
  }

  const sheetXml = entries.get('xl/worksheets/sheet1.xml') || '';
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rMatch;
  while ((rMatch = rowRe.exec(sheetXml)) !== null) {
    const cells = {};
    const cRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cMatch;
    while ((cMatch = cRe.exec(rMatch[1])) !== null) {
      const attrs = cMatch[1];
      const inner = cMatch[2];
      const refM = /\br="([A-Z]+\d+)"/.exec(attrs);
      const col = refM ? refM[1].replace(/\d+$/, '') : '';
      const typeM = /\bt="([^"]+)"/.exec(attrs);
      const cType = typeM ? typeM[1] : '';
      let val = '';
      if (cType === 's') {
        const vM = /<v>(\d+)<\/v>/.exec(inner);
        val = vM ? (sharedStrings[parseInt(vM[1], 10)] ?? '') : '';
      } else if (cType === 'inlineStr') {
        const tM = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/.exec(inner);
        val = tM ? tM[1] : '';
      } else {
        const vM = /<v>([\s\S]*?)<\/v>/.exec(inner);
        val = vM ? vM[1] : '';
      }
      if (col) cells[col] = val.trim();
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * Rebuilds a ZIP buffer with updated xl/worksheets/sheet1.xml (Stored entries) to simulate edited email attachment.
 */
function buildEditedMirrorXlsxFromExisting(origBuf, replaceFn) {
  const entries = readXlsxEntries(origBuf);
  const oldSheet = entries.get('xl/worksheets/sheet1.xml') || '';
  const newSheet = replaceFn(oldSheet);
  entries.set('xl/worksheets/sheet1.xml', newSheet);

  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[i] = c;
  }
  const crc32 = (u8) => {
    let crc = 0xffffffff;
    for (let i = 0; i < u8.length; i++) crc = crcTable[(crc ^ u8[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };

  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of entries.entries()) {
    const nameBuf = Buffer.from(name, 'utf8');
    const dataBuf = Buffer.from(content, 'utf8');
    const crc = crc32(dataBuf);

    const lf = Buffer.alloc(30);
    lf.writeUInt32LE(0x04034b50, 0);
    lf.writeUInt16LE(20, 4);
    lf.writeUInt16LE(0x0800, 6);
    lf.writeUInt16LE(0, 8);
    lf.writeUInt32LE(crc, 14);
    lf.writeUInt32LE(dataBuf.length, 18);
    lf.writeUInt32LE(dataBuf.length, 22);
    lf.writeUInt16LE(nameBuf.length, 26);
    chunks.push(lf, nameBuf, dataBuf);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(dataBuf.length, 20);
    cd.writeUInt32LE(dataBuf.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += 30 + nameBuf.length + dataBuf.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.size, 8);
  eocd.writeUInt16LE(entries.size, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, centralBuf, eocd]);
}

test.describe('Suite 09: Serial No. Exports, Admin-Only Test Recipients, Pinpoint GPS & Live Cam, Multi-QR Sheet & Full Reset', () => {
  test('2a & 2b: verifies Serial No. Column A across .xlsx exports, Admin-only Test Mode TO/CC isolation & Test .xlsx reply ingestion', async ({
    page,
    context,
    request
  }) => {
    test.setTimeout(210_000);
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);
    const capturedEmails = await interceptAndCaptureEmails(page);
    await mockPhotoUploadSuccess(page);

    const createdRmas = [];
    const createdCms = [];
    let liveBaselineRma = null;
    let savedCustomTestRecipients = false;

    try {
      // 1. Offline / unit verification of Serial No. Column A on Alert Mirror .xlsx (single & multi-item) and Tickets Vault table builder
      const mirrorBytes = buildRmaAlertXlsxBytes(
        {
          rma_number: 'RMA-TEST-2026-SRL1',
          barcode: VERIFIED_BARCODE,
          name: 'Playwright Serial Check Item',
          supplier_name: 'Original Test Vendor',
          is_test: true,
          items: [
            { barcode: VERIFIED_BARCODE, code: 'SKU-A', name: 'Line A', quantity: 2, unit_name: 'pc' },
            { barcode: '4800000000002', code: 'SKU-B', name: 'Line B', quantity: 3, unit_name: 'box' }
          ]
        },
        { subject: '[TEST] [RMA Alert] RMA-TEST-2026-SRL1' }
      );
      const mirrorRows = extractSheetRowsText(Buffer.from(mirrorBytes));
      const mirrorHeaderRow = mirrorRows.find((r) => r.B === 'Field' && r.C === 'Value');
      expect(mirrorHeaderRow?.A).toBe('Serial No.');
      const manifestHeaderRow = mirrorRows.find(
        (r) => r.B === 'Supplier Name' && r.C === 'Barcode' && r.D === 'Assigned SKU'
      );
      expect(manifestHeaderRow?.A).toBe('Serial No.');

      // Backward-compatible legacy reply parsing AND shifted Serial No. column reply parsing
      const parsedShifted = extractRmaUpdatesFromXlsxBuffer(Buffer.from(mirrorBytes));
      expect(parsedShifted.rmaNumber).toBe('RMA-TEST-2026-SRL1');
      expect(parsedShifted.isTestHint).toBe(true);
      expect(parsedShifted.patch.supplier_name).toBe('Original Test Vendor');

      const vaultBytes = buildTableXlsxBytes({
        sheetName: 'RMA Vault',
        columns: [
          { header: 'Serial No.', width: 11, type: 'number' },
          { header: 'Ticket ID', width: 18, type: 'text' },
          { header: 'Supplier', width: 22, type: 'text' }
        ],
        rows: [[1, 'RMA-2026-VAULT-1', 'Pingcon Test']]
      });
      const vaultRows = extractSheetRowsText(Buffer.from(vaultBytes));
      expect(vaultRows[0]?.A).toBe('Serial No.');

      // 2. Assert <EmailRecipientsEditor /> is NEVER rendered on Public Portal (/) in BOTH Live Mode and Test Mode
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.getByText(/Scan Product Barcode or RMA Sticker QR/i)).toBeVisible({ timeout: 25_000 });
      await setPublicPortalTestMode(page, false);
      await expect(page.locator('[data-email-recipients-editor]')).toHaveCount(0);
      await expect(page.getByText('New RMA Email Alert Recipients')).toHaveCount(0);
      await setPublicPortalTestMode(page, true);
      await expect(page.locator('[data-email-recipients-editor]')).toHaveCount(0);
      await expect(page.getByText('New RMA Email Alert Recipients')).toHaveCount(0);

      // 3. Configure custom Test Mode TO & CC inside Admin Portal -> Settings & SMTP (isolated from Live)
      await gotoAdmin(page);
      const adminJwt = await page.evaluate(() => {
        const k = Object.keys(localStorage).find((key) => key.endsWith('-auth-token'));
        return k ? JSON.parse(localStorage.getItem(k) || '{}')?.access_token : null;
      });
      expect(adminJwt).toBeTruthy();

      await navigateAdminSidebar(page, 'settings');
      await expect(page.getByText('Per-Email Recipient Manager')).toBeVisible({ timeout: 15_000 });
      await page.locator('[aria-label="Email Recipient Mode Scope"]').getByRole('button', { name: /Test Mode/i }).click();
      await page.getByRole('button', { name: /New RMA Return Report Alert/i }).first().click();

      const newRmaTestEditor = page.locator('[data-email-recipients-editor="new_rma"]');
      await expect(newRmaTestEditor).toBeVisible();
      await newRmaTestEditor.getByRole('button', { name: /Reset Test Defaults/i }).click();
      await expect(newRmaTestEditor.getByText(/Reset to Test Mode Sandbox Defaults/i)).toBeVisible({ timeout: 15_000 });
      await newRmaTestEditor.locator('input[placeholder*="Add Primary TO email"]').fill('pw-test-to@pingconmarketing.com');
      await newRmaTestEditor.getByRole('button', { name: /Add TO/i }).click();
      await expect(newRmaTestEditor.getByText('pw-test-to@pingconmarketing.com')).toBeVisible();
      await newRmaTestEditor.locator('input[placeholder*="Add CC email"]').fill('pw-test-cc@pingconmarketing.com');
      await newRmaTestEditor.getByRole('button', { name: /Add CC/i }).click();
      await expect(newRmaTestEditor.getByText('pw-test-cc@pingconmarketing.com')).toBeVisible();
      await newRmaTestEditor.getByRole('button', { name: /Save Test Recipients/i }).click();
      await expect(newRmaTestEditor.getByText(/Test Mode recipients saved & synced to cloud/i)).toBeVisible({ timeout: 15_000 });
      savedCustomTestRecipients = true;

      // Also test RMAMatrixExportModal custom Test Mode recipient routing
      await navigateAdminSidebar(page, 'sandbox');
      const testRma = await seedTestModeRma(page, {
        stream: 'customer',
        photoCount: 1,
        quantity: 2,
        reporterName: 'Playwright Test Recipient Verifier'
      });
      createdRmas.push(testRma);

      // Assert New RMA Alert email payload delivered strictly to custom Test Mode TO & CC with [TEST] prefix & Serial No. mirror .xlsx
      await expect.poll(
        () => capturedEmails.find(
          (p) => typeof p?.subject === 'string' && p.subject.startsWith('[TEST] ') && p.subject.includes(testRma)
        ),
        { timeout: 20_000 }
      ).toBeTruthy();
      const newRmaEmail = capturedEmails.find(
        (p) => typeof p?.subject === 'string' && p.subject.startsWith('[TEST] ') && p.subject.includes(testRma)
      );
      expect(String(newRmaEmail.to || '').toLowerCase()).toContain('pw-test-to@pingconmarketing.com');
      expect(
        Array.isArray(newRmaEmail.cc)
          ? newRmaEmail.cc.map((c) => String(c).toLowerCase())
          : [String(newRmaEmail.cc || '').toLowerCase()]
      ).toContain('pw-test-cc@pingconmarketing.com');
      const xlsxAtt = (newRmaEmail.attachments || []).find((a) => String(a?.filename || '').endsWith('.xlsx'));
      expect(xlsxAtt?.content).toBeTruthy();
      const attRows = extractSheetRowsText(Buffer.from(xlsxAtt.content, 'base64'));
      expect(attRows.find((r) => r.B === 'Field')?.A).toBe('Serial No.');

      // 4. Download all UI .xlsx files inside Admin & verify Column A header === 'Serial No.'
      await gotoAdmin(page);
      await navigateAdminSidebar(page, 'sandbox');
      await page.getByRole('button', { name: /Sandbox Customer RMAs/i }).click();

      // Credit Memos Ledger (.xlsx): issue 1 quick Test CM against testRma so Export Excel (.xlsx) downloads genuine rows
      await page.getByRole('button', { name: /Credit Memos Ledger \(/i }).first().click();
      await page.getByRole('button', { name: /Issue.*Credit Memo/i }).first().click();
      await expect(page.getByRole('heading', { name: 'Issue Finance Credit Memo' })).toBeVisible({ timeout: 10_000 });
      const cmSelect = page.locator('#credit-memo-form').locator('..').locator('select').first();
      if (await cmSelect.isVisible().catch(() => false)) {
        const optVal = await cmSelect.evaluate((el, target) => {
          const found = Array.from(el.options).find((o) => o.text.includes(target));
          return found ? found.value : '';
        }, testRma);
        if (optVal) await cmSelect.selectOption(optVal);
      }
      await page.locator('#credit-memo-form input[inputmode="numeric"]').first().fill('2');
      await page.locator('#credit-memo-form input[inputmode="decimal"]').nth(0).fill('50.00');
      await page.getByRole('button', { name: /Save & View Voucher/i }).click();
      await expect(page.getByText('FINANCE CREDIT MEMORANDUM', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
      const issuedCmNum = (
        await page.locator('#credit-memo-voucher-print-root').innerText()
      ).match(/CM-TEST-[A-Z0-9-]+/i)?.[0];
      if (issuedCmNum) createdCms.push(issuedCmNum);
      await page.locator('#credit-memo-voucher-print-root button:has(svg.lucide-x)').first().click();

      const [cmDl] = await Promise.all([
        page.waitForEvent('download', { timeout: 20_000 }),
        page.getByRole('button', { name: /Export Excel \(\.xlsx\)/i }).click()
      ]);
      const cmRows = extractSheetRowsText(fs.readFileSync(await cmDl.path()));
      expect(cmRows.some((r) => r.A === 'Serial No.')).toBe(true);

      // Sandbox Customer Inbound (.xlsx), Matrix Test Mode email routing, & Full Audit Log (.xlsx)
      await navigateAdminSidebar(page, 'sandbox');
      await page.getByRole('button', { name: /Sandbox Customer RMAs/i }).click();
      const [custDl] = await Promise.all([
        page.waitForEvent('download', { timeout: 20_000 }),
        page.getByRole('button', { name: /Export Inbound \(\.xlsx\)/i }).click()
      ]);
      const custRows = extractSheetRowsText(fs.readFileSync(await custDl.path()));
      expect(custRows.some((r) => r.A === 'Serial No.')).toBe(true);

      // RMAMatrixExportModal Test Mode manual recipient routing check
      await page.getByRole('button', { name: /Sandbox Overall Matrix \(\.xlsx\)/i }).first().click();
      const matrixModal = page.locator('div.fixed', { hasText: 'Email Dispatch Studio' });
      await expect(matrixModal).toBeVisible();
      await matrixModal.getByRole('button', { name: /Email Matrix/i }).click();
      const matrixTestEditor = matrixModal.locator('[data-email-recipients-editor="manual_matrix"]');
      await expect(matrixTestEditor).toBeVisible();
      await matrixTestEditor.locator('input[placeholder*="Add Primary TO email"]').fill('pw-matrix-test@pingconmarketing.com');
      await matrixTestEditor.getByRole('button', { name: /Add TO/i }).click();
      await matrixModal.getByRole('button', { name: /Send Matrix Email Now/i }).click();
      await expect(matrixModal.getByText(/Matrix email dispatched to/i)).toBeVisible({ timeout: 20_000 });
      await matrixModal.getByRole('button', { name: 'Close', exact: true }).click();
      const testMatrixEmail = capturedEmails.find(
        (p) => p?.action === 'daily-matrix' && p?.isTestMode === true
      );
      expect(testMatrixEmail).toBeTruthy();
      expect(testMatrixEmail.toList || testMatrixEmail.to).toContain('pw-matrix-test@pingconmarketing.com');

      // Full Audit Log Export Excel (.xlsx)
      await page.getByRole('button', { name: /Full Audit Log/i }).first().click();
      const auditModal = page.locator('div.fixed', { hasText: 'Logged Sandbox Test RMA Reports' });
      await expect(auditModal).toBeVisible();
      const [auditDl] = await Promise.all([
        page.waitForEvent('download', { timeout: 20_000 }),
        auditModal.getByRole('button', { name: /Export Excel \(\.xlsx\)/i }).click()
      ]);
      const auditRows = extractSheetRowsText(fs.readFileSync(await auditDl.path()));
      expect(auditRows.some((r) => r.A === 'Serial No.')).toBe(true);
      await auditModal.locator('button[aria-label="Close Reports Modal"]').click();

      // Supplier Claims (.xlsx)
      await page.getByRole('button', { name: /Sandbox Supplier RTVs/i }).click();
      const sbSuppRma = await seedTestModeRma(page, { stream: 'supplier', photoCount: 1 });
      createdRmas.push(sbSuppRma);
      await gotoAdmin(page);
      await navigateAdminSidebar(page, 'sandbox');
      await page.getByRole('button', { name: /Sandbox Supplier RTVs/i }).click();
      const [suppDl] = await Promise.all([
        page.waitForEvent('download', { timeout: 20_000 }),
        page.getByRole('button', { name: /Export Supplier Claims \(\.xlsx\)/i }).first().click()
      ]);
      const suppRows = extractSheetRowsText(fs.readFileSync(await suppDl.path()));
      expect(suppRows.some((r) => r.A === 'Serial No.')).toBe(true);

      // 5. Modify Supplier / Brand in the captured Test Mode mirror .xlsx & ingest via ?action=ingest-xlsx-reply
      // First read one untouched Live record's supplier_name (if any) to assert Live DB stays untouched
      const liveCheckBefore = await page.evaluate(async ({ supaUrl: url, anonKey: key, tok }) => {
        const res = await fetch(`${url}/rest/v1/rma_reports?rma_number=not.like.RMA-TEST-%&select=rma_number,supplier_name&limit=1`, {
          headers: { apikey: key, Authorization: `Bearer ${tok}` }
        });
        return res.ok ? await res.json() : [];
      }, { ...readSupabasePublicEnv(), tok: adminJwt });
      liveBaselineRma = liveCheckBefore?.[0] || null;

      const editedTestMirror = buildEditedMirrorXlsxFromExisting(
        Buffer.from(xlsxAtt.content, 'base64'),
        (xml) =>
          xml.replace(
            /<t(?:\s+[^>]*)?>Supplier \/ Vendor Name<\/t><\/is><\/c><c r="([A-Z]+\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/,
            '<t>Supplier / Vendor Name</t></is></c><c r="$1" t="inlineStr" s="5"><is><t>Updated Sandbox Reply Brand Corp</t></is></c>'
          )
      );
      const parsedEdited = extractRmaUpdatesFromXlsxBuffer(editedTestMirror);
      expect(parsedEdited.rmaNumber).toBe(testRma);
      expect(parsedEdited.patch.supplier_name).toBe('Updated Sandbox Reply Brand Corp');

      const ingestRes = await request.post('/api/send-email?action=ingest-xlsx-reply', {
        headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
        data: {
          action: 'ingest-xlsx-reply',
          fileBase64: editedTestMirror.toString('base64'),
          senderEmail: 'pw-test-to@pingconmarketing.com',
          actorName: 'Playwright Test Mirror Sync'
        }
      });
      expect(ingestRes.status()).toBe(200);
      const ingestJson = await ingestRes.json();
      expect(ingestJson.success).toBe(true);
      expect(ingestJson.rmaNumber).toBe(testRma);
      expect(ingestJson.report?.supplier_name).toBe('Updated Sandbox Reply Brand Corp');
      expect(ingestJson.report?.ai_document_metadata?.is_test).toBe(true);

      if (liveBaselineRma) {
        const liveCheckAfter = await page.evaluate(async ({ supaUrl: url, anonKey: key, tok, target }) => {
          const res = await fetch(`${url}/rest/v1/rma_reports?rma_number=eq.${encodeURIComponent(target)}&select=rma_number,supplier_name`, {
            headers: { apikey: key, Authorization: `Bearer ${tok}` }
          });
          return res.ok ? await res.json() : [];
        }, { ...readSupabasePublicEnv(), tok: adminJwt, target: liveBaselineRma.rma_number });
        expect(liveCheckAfter?.[0]?.supplier_name).toBe(liveBaselineRma.supplier_name);
      }

      guard.assertClean('suite 09 Serial No & Test Mode Recipients / Sync');
    } finally {
      if (savedCustomTestRecipients) {
        await page.goto('/admin', { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.evaluate(async () => {
          const { notificationService } = await import('/src/services/notificationService.js');
          await notificationService.resetEmailProfileToDefaults('new_rma', true);
          await notificationService.resetEmailProfileToDefaults('manual_matrix', true);
        }).catch(() => {});
      }
      await cleanupTestRecords(page, { rmaNumbers: createdRmas, creditMemoNumbers: createdCms });
      guard.detach();
    }
  });

  test('2c, 2d & 2e: pinpoint GPS street+ZIP (1280x800, 390x844, 840x390), live camera, Section 3 fields, Multi-QR Sheet & Full Timeline Reset', async ({
    page,
    context
  }) => {
    test.setTimeout(210_000);
    await context.grantPermissions(['camera', 'geolocation']).catch(() => {});
    await context.setGeolocation({ latitude: 14.6683, longitude: 121.0114, accuracy: 15 });
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);
    await interceptAndCaptureEmails(page);
    await mockPhotoUploadSuccess(page);

    const sessionRmas = [];

    try {
      // Check pinpoint GPS, Live Camera, ZERO Capture Mode/duplicate supplier & Section 3 borders across Desktop, Mobile Portrait, Landscape
      for (const vp of [
        { name: 'Desktop', width: 1280, height: 800 },
        { name: 'Mobile Portrait', width: 390, height: 844 },
        { name: 'Mobile Landscape', width: 840, height: 390 }
      ]) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText(/Scan Product Barcode or RMA Sticker QR/i)).toBeVisible({ timeout: 25_000 });

        await expect(page.getByText('64 Mendez Rd, Baesa, Quezon City, Metro Manila 1106').first()).toBeVisible({
          timeout: 20_000
        });
        const mapHref = await page.locator('a:has-text("Maps")').first().getAttribute('href');
        expect(mapHref).toContain('google.com/maps/place/');
        expect(decodeURIComponent(mapHref || '')).toContain('64 Mendez Rd, Baesa, Quezon City, Metro Manila 1106');
        expect(mapHref).toContain('@14.6683,121.0114,18z');

        await expect(page.getByText('Capture Mode:')).toHaveCount(0);
        await expect(page.locator('input[capture]')).toHaveCount(0);
        await expect(page.getByText(/Supplier \/ Vendor Name \(Optional\)/i)).toHaveCount(0);

        // Live Mode vs Test Mode Section 3 stream swap (Customer Hub vs Supplier RTV) with visible borders
        for (const testFlag of [false, true]) {
          await setPublicPortalTestMode(page, testFlag);
          await expect(page.locator('[data-email-recipients-editor]')).toHaveCount(0);

          await page.getByRole('button', { name: /Customer RMA Hub/i }).click();
          await expect(page.locator('#intake-item-supplier-input')).toHaveCount(0);
          await expect(page.getByText(/3\. Company \/ Store Name \(Optional\)/i)).toBeVisible();
          const compInput = page.locator('#intake-company-input');
          await expect(compInput).toBeVisible();
          const compBorder = await compInput.evaluate((el) => getComputedStyle(el).borderTopWidth);
          expect(parseFloat(compBorder)).toBeGreaterThanOrEqual(1);

          await page.getByRole('button', { name: /Supplier RTV Hub/i }).click();
          await expect(page.locator('#intake-supplier-input')).toHaveCount(0);
          await expect(page.locator('#intake-company-input')).toHaveCount(0);
          await expect(page.getByText(/3\. Reporter Information/i)).toBeVisible();
          const suppInput = page.locator('#intake-item-supplier-input');
          await expect(suppInput).toBeVisible();
          const suppBorder = await suppInput.evaluate((el) => getComputedStyle(el).borderTopWidth);
          expect(parseFloat(suppBorder)).toBeGreaterThanOrEqual(1);
        }

        // Verify Take Photo opens timestamped CameraCaptureModal with object-cover & full address HUD
        await page.getByRole('button', { name: /Take Photo/i }).first().click();
        const camHud = page.getByTestId('camera-watermark-hud');
        await expect(camHud).toBeVisible({ timeout: 5_000 });
        await expect(camHud).toContainText('64 Mendez Rd, Baesa, Quezon City, Metro Manila 1106');
        await expect(camHud).toContainText('PHT');
        await expect(page.locator('video.object-cover')).toBeAttached();
        await page.getByRole('button', { name: 'Done', exact: true }).click();
        await expect(camHud).toBeHidden();

        await assertNoHorizontalOverflow(page, `${vp.name} Public Intake`);
      }

      // 2d: Submit 2 Test RMAs in the SAME public session & verify "Add More RMA QRs to Sheet" consolidates both cleanly
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.getByText(/Scan Product Barcode or RMA Sticker QR/i)).toBeVisible({ timeout: 25_000 });
      await setPublicPortalTestMode(page, true);
      await page.getByRole('button', { name: /Customer RMA Hub/i }).click();

      const submitPublicSessionItem = async (itemLabel) => {
        await page.getByRole('button', { name: /Missing Barcode \/ Unlabeled Item\? Click here to report/i }).click();
        await page.locator('input[placeholder*="Oishi" i], input[placeholder*="identif" i]').first().fill(itemLabel);
        await page.locator('input[type="date"]').first().fill(isoDateDaysOffset(60));
        await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({
          name: 'pw-multiqr.png',
          mimeType: 'image/png',
          buffer: PNG_BUFFER
        });
        await expect(page.getByText('1/10 photos')).toBeVisible({ timeout: 10_000 });
        await page.locator('input[placeholder="Your Full Name *"]').fill('Playwright MultiQR Tester');
        await page.locator('input[placeholder="Phone No. or Email *"]').fill('multiqr@pingcon.local');
        const postPromise = page.waitForResponse(
          (res) => res.url().includes('/rest/v1/rma_reports') && res.request().method() === 'POST',
          { timeout: 35_000 }
        );
        await page.getByRole('button', { name: /Submit Return Report/i }).click();
        await expect(page.getByText('Printable QR Ready')).toBeVisible({ timeout: 25_000 });
        expect((await postPromise).status()).toBeLessThan(400);
        const rmaNo = (
          await page
            .locator('.font-mono.font-black.text-slate-900, .font-mono.font-black.dark\\:text-white')
            .filter({ hasText: /^RMA-TEST-/ })
            .first()
            .innerText()
        ).trim();
        return rmaNo;
      };

      const sessionRma1 = await submitPublicSessionItem('MultiQR Session Item 1');
      sessionRmas.push(sessionRma1);
      await page.getByRole('button', { name: /Report Another/i }).click();
      await expect(page.getByRole('button', { name: /Submit Return Report/i })).toBeVisible();

      const sessionRma2 = await submitPublicSessionItem('MultiQR Session Item 2');
      sessionRmas.push(sessionRma2);

      // Open Resize / Print QR -> click "Add More RMA QRs to Sheet" -> add sessionRma1 -> consolidate & Auto-Fit 1 Page
      await page.getByRole('button', { name: /Resize \/ Print QR/i }).click();
      const qrStudio = page.locator('div.fixed', { hasText: /Print RMA QR Code|Consolidated QR Print Studio/ });
      await expect(qrStudio).toBeVisible();
      const addMoreBtn = qrStudio.getByRole('button', { name: /Add More RMA QRs to Sheet/i });
      await expect(addMoreBtn).toBeVisible();
      await addMoreBtn.click();

      const addCandidateBtn = qrStudio.locator(`button:has-text("${sessionRma1}")`).first();
      await expect(addCandidateBtn).toBeVisible({ timeout: 5_000 });
      // Ensure NO non-session or Live RMAs leak into the public picker
      const pickerText = await qrStudio.locator('.max-h-40').innerText();
      expect(pickerText).not.toMatch(/RMA-20\d{2}-/);

      await addCandidateBtn.click();
      await expect(qrStudio.getByText('Consolidated QR Print Studio (2 QRs)')).toBeVisible();
      await qrStudio.getByRole('button', { name: /Auto-Fit All to 1 Page/i }).click();
      await expect(qrStudio.locator(`[data-rma-qr-card="${sessionRma1}"]`)).toBeVisible();
      await expect(qrStudio.locator(`[data-rma-qr-card="${sessionRma2}"]`)).toBeVisible();
      await qrStudio.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(qrStudio).toBeHidden();

      // 2e: Full Timeline & Outcome Reset preserving Supplier Name & Emails
      await gotoAdmin(page);
      await navigateAdminSidebar(page, 'sandbox');
      await page.getByRole('button', { name: /Sandbox Customer RMAs/i }).click();
      await page.locator('input[placeholder*="Search" i]').first().fill(sessionRma1);
      const resetRow = page.locator('tr', { hasText: sessionRma1 }).first();
      await expect(resetRow).toBeVisible({ timeout: 15_000 });

      // Open Quick Actions -> set Supplier + Emails first so preservation after Reset Timeline can be verified explicitly
      await resetRow.getByRole('button', { name: /Details|Inspect|Split Qty/i }).first().click();
      const quickModal = page.locator('div.fixed', { hasText: 'RMA Details & Quick Actions' }).first();
      await expect(quickModal).toBeVisible({ timeout: 10_000 });
      const setSupBtn = quickModal.getByRole('button', { name: /\+ Set Supplier & Email/i }).first();
      await expect(setSupBtn).toBeVisible({ timeout: 10_000 });
      await setSupBtn.click();
      await page.locator('#followup-modal-supplier-input').fill('Reset Preservation Supplier');
      await page.locator('input[aria-label="Supplier Primary Email(s) (TO)"]').fill('preserve-to@supplier-test.local');
      await page.locator('input[aria-label="Supplier CC Email(s) (Optional)"]').fill('preserve-cc@supplier-test.local');
      await page.getByRole('button', { name: /Save Supplier & Email/i }).click();
      await expect(page.getByText(/Saved supplier "Reset Preservation Supplier"/i)).toBeVisible({ timeout: 10_000 });
      await page.locator('button[aria-label="Close supplier follow-up modal"]').click();
      await expect(page.locator('#followup-modal-supplier-input')).toBeHidden({ timeout: 10_000 });
      await expect(quickModal.getByText('Reset Preservation Supplier').first()).toBeVisible({ timeout: 10_000 });

      // Open 4-Choice Window from Quick Actions -> Scrap the RMA -> verify Scrapped outcome -> Reset Timeline -> verify Pending + Day 0 + Supplier preserved
      await quickModal.getByRole('button', { name: /Open 4-Choice \/ Pickup Window/i }).click();
      await expect(page.getByText('What do you want to do with this item?')).toBeVisible({ timeout: 10_000 });
      await page.locator('#wizard-processed-by-step1').fill('Playwright Reset Inspector');
      await page.getByRole('button', { name: /Throw Away \/ Dispose \(Scrap\)/i }).first().click();
      await page.getByRole('button', { name: /Confirm & Save: Throw Away \/ Dispose \(Scrap\)/i }).click();
      await expect(page.getByRole('button', { name: /^Done$/i })).toBeVisible({ timeout: 25_000 });
      await page.getByRole('button', { name: /^Done$/i }).click();

      // Back in QuickRMAActionModal -> expand Advanced / Danger Zone -> click Reset Timeline -> confirm Pending & preserved Supplier
      await expect(quickModal).toBeVisible({ timeout: 10_000 });
      const dangerToggle = quickModal.getByRole('button', { name: /Advanced \/ Danger Zone/i }).first();
      await expect(dangerToggle).toBeVisible();
      await dangerToggle.click();
      page.once('dialog', (dialog) => dialog.accept());
      const resetTimelineBtn = quickModal.getByRole('button', { name: /Reset Timeline/i }).first();
      await expect(resetTimelineBtn).toBeVisible();
      await resetTimelineBtn.click();

      await expect(quickModal.getByText(new RegExp(`Timeline, 10-day countdown & disposition outcome reset to Pending for ${sessionRma1}`))).toBeVisible({
        timeout: 20_000
      });
      await expect(quickModal.getByText(/Day 0/i).first()).toBeVisible();
      await expect(quickModal.getByText(/Pending Pickup/i).first()).toBeVisible();
      await expect(quickModal.getByText(/Step 2: Waiting For Pickup/i).first()).toBeVisible();
      await expect(quickModal.getByText('Reset Preservation Supplier').first()).toBeVisible();
      await quickModal.getByRole('button', { name: /Done \/ Close/i }).click();

      // Confirm row status badge shows Pending (YYYY-MM-DD HH:mm)
      await expect(resetRow.getByText(/Pending \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)/i)).toBeVisible({
        timeout: 15_000
      });

      guard.assertClean('suite 09 pinpoint GPS, Live Cam, Multi-QR Sheet & Full Reset');
    } finally {
      await cleanupTestRecords(page, { rmaNumbers: sessionRmas });
      guard.detach();
    }
  });
});
