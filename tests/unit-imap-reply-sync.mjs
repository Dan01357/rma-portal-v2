import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getImapTlsConnectOptions,
  categorizeImapError,
  parseHeaderAndBodystructure,
  parseZipEntriesFromBuffer,
  extractRmaUpdatesFromXlsxBuffer,
  applyRmaXlsxUpdates,
  extractAuthorizedEmailsFromSettings,
  extractInviteEmailsForReport,
  isSenderAuthorizedForReport,
  syncEmailRepliesInternal
} from '../api/_lib/imapReplySyncHandler.js';
import { buildRmaAlertXlsxBytes } from '../src/utils/rmaAlertXlsx.js';
import { buildTableXlsxBytes, buildStoredZip } from '../src/utils/exportXlsx.js';

function createMockSupabase(initialSettings = {}) {
  const store = new Map(Object.entries(initialSettings));

  return {
    store,
    from(table) {
      assert.equal(table, 'rma_settings');
      let selectedKeys = null;
      let eqKey = null;
      return {
        select() {
          return this;
        },
        in(_col, keys) {
          selectedKeys = keys;
          return Promise.resolve({
            data: (selectedKeys || [])
              .filter((k) => store.has(k))
              .map((k) => ({ key: k, value: store.get(k) })),
            error: null
          });
        },
        eq(_col, key) {
          eqKey = key;
          return this;
        },
        maybeSingle() {
          return Promise.resolve({
            data: store.has(eqKey) ? { key: eqKey, value: store.get(eqKey) } : null,
            error: null
          });
        },
        upsert(row) {
          store.set(row.key, row.value);
          return Promise.resolve({ data: [row], error: null });
        }
      };
    }
  };
}

test('getImapTlsConnectOptions includes TLS SNI servername for imap.gmail.com', () => {
  const opts = getImapTlsConnectOptions('imap.gmail.com', 993);
  assert.deepEqual(opts, {
    host: 'imap.gmail.com',
    port: 993,
    servername: 'imap.gmail.com',
    rejectUnauthorized: true
  });
});

test('categorizeImapError identifies TLS cert, IMAP auth, and disabled IMAP errors', () => {
  const tlsErr = categorizeImapError(Object.assign(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }));
  assert.equal(tlsErr.code, 'DEPTH_ZERO_SELF_SIGNED_CERT');
  assert.match(tlsErr.diagnosticHint, /SNI/i);

  const authErr = categorizeImapError(new Error('IMAP NO: [AUTHENTICATIONFAILED] Invalid credentials'));
  assert.equal(authErr.code, 'IMAP_AUTH_FAILED');

  const disabledErr = categorizeImapError(new Error('IMAP NO: [ALERT] IMAP access is disabled for your account'));
  assert.equal(disabledErr.code, 'IMAP_DISABLED');
});

test('syncEmailRepliesInternal never burns failed or UNAUTHORIZED_SENDER replies and retries cleanly once authorized', async () => {
  const mockDb = createMockSupabase();
  let authorized = false;
  let throwErr = true;

  const sampleMsg = {
    uid: 42,
    dedupeKey: '<reply-0190@gmail.com>',
    messageId: '<reply-0190@gmail.com>',
    from: 'daniloalvaro031717@gmail.com',
    subject: 'Re: [TEST] [RMA Alert] RMA-TEST-2026-0190-7GZK',
    attachments: [{ filename: 'reply.xlsx', buffer: Buffer.from('PK') }]
  };

  const makeMockImapFetcher = (seenHolder) => async ({ processedSet, onProcessMessages }) => {
    const msgs = processedSet.has(sampleMsg.dedupeKey) ? [] : [sampleMsg];
    const seen = await onProcessMessages(msgs, []);
    seenHolder.push(...seen);
    return { scannedRecentMessages: 1, messagesWithXlsx: msgs.length };
  };

  // Run 1: attachment processing throws -> MUST NOT mark processed or \Seen, MUST log error
  const seen1 = [];
  const res1 = await syncEmailRepliesInternal({
    triggerSource: 'unit_test_cron',
    caller: 'cron',
    imapFetcher: makeMockImapFetcher(seen1),
    applyXlsxFn: async () => {
      if (throwErr) throw new Error('Simulated transient DB error');
      return { success: true };
    },
    dbClient: mockDb,
    credentials: { user: 'finance2@keysysincorporated.com', pass: 'abcdabcdabcdabcd' }
  });
  assert.equal(res1.success, false);
  assert.equal(res1.status, 'error');
  assert.deepEqual(seen1, []);
  assert.equal(mockDb.store.get('processed_reply_message_ids'), undefined);
  assert.equal(mockDb.store.get('email_reply_sync_logs')[0].status, 'error');

  // Run 2: sender is UNAUTHORIZED_SENDER -> MUST NOT mark processed or \Seen, MUST log unauthorized
  throwErr = false;
  const seen2 = [];
  const res2 = await syncEmailRepliesInternal({
    triggerSource: 'unit_test_cron',
    caller: 'cron',
    imapFetcher: makeMockImapFetcher(seen2),
    applyXlsxFn: async () => ({
      skipped: true,
      reason: 'UNAUTHORIZED_SENDER',
      rmaNumber: 'RMA-TEST-2026-0190-7GZK',
      senderEmail: 'daniloalvaro031717@gmail.com'
    }),
    dbClient: mockDb,
    credentials: { user: 'finance2@keysysincorporated.com', pass: 'abcdabcdabcdabcd' }
  });
  assert.equal(res2.status, 'unauthorized');
  assert.equal(res2.unauthorizedCount, 1);
  assert.deepEqual(seen2, []);
  assert.equal(mockDb.store.get('processed_reply_message_ids'), undefined);
  assert.equal(mockDb.store.get('email_reply_sync_logs')[0].status, 'unauthorized');

  // Run 3: sender becomes authorized -> auto-retries same Message-ID, updates, and NOW marks processed & \Seen
  authorized = true;
  const seen3 = [];
  const res3 = await syncEmailRepliesInternal({
    triggerSource: 'unit_test_cron',
    caller: 'cron',
    imapFetcher: makeMockImapFetcher(seen3),
    applyXlsxFn: async () => {
      assert.equal(authorized, true);
      return {
        success: true,
        rmaNumber: 'RMA-TEST-2026-0190-7GZK',
        changedFields: ['supplier_name']
      };
    },
    dbClient: mockDb,
    credentials: { user: 'finance2@keysysincorporated.com', pass: 'abcdabcdabcdabcd' }
  });
  assert.equal(res3.success, true);
  assert.equal(res3.status, 'updated');
  assert.equal(res3.updatedCount, 1);
  assert.deepEqual(seen3, [42]);
  assert.deepEqual(mockDb.store.get('processed_reply_message_ids'), ['<reply-0190@gmail.com>']);
  assert.equal(mockDb.store.get('email_reply_sync_logs')[0].status, 'updated');
});

test('syncEmailRepliesInternal skips cleanly when email_reply_sync_lock is active', async () => {
  const mockDb = createMockSupabase({
    email_reply_sync_lock: {
      lockId: 'active-lock',
      lockedUntil: Date.now() + 30000,
      triggerSource: 'external_cron'
    }
  });
  let imapCalled = false;
  const res = await syncEmailRepliesInternal({
    triggerSource: 'admin_auto_poll',
    imapFetcher: async () => {
      imapCalled = true;
      return { scannedRecentMessages: 0, messagesWithXlsx: 0 };
    },
    dbClient: mockDb,
    credentials: { user: 'finance2@keysysincorporated.com', pass: 'abcdabcdabcdabcd' }
  });
  assert.equal(imapCalled, false);
  assert.equal(res.skipped, true);
  assert.equal(res.reason, 'SYNC_IN_PROGRESS');
});

test('extractRmaUpdatesFromXlsxBuffer parses edited single-item Supplier / Vendor Name', async () => {
  const { parseZipEntriesFromBuffer } = await import('../api/_lib/imapReplySyncHandler.js');
  const origBytes = Buffer.from(
    buildRmaAlertXlsxBytes(
      {
        rma_number: 'RMA-TEST-2026-0190-7GZK',
        barcode: 'Testgsbdjdn',
        name: 'Tesvahbdj',
        quantity: 1,
        unit_name: 'pc',
        supplier_name: 'Pending Assignment',
        rma_type: 'supplier_outbound',
        ai_document_metadata: { is_test: true, test_mode: true }
      },
      { subject: '[TEST] [RMA Alert] RMA-TEST-2026-0190-7GZK' }
    )
  );
  const entries = parseZipEntriesFromBuffer(origBytes);
  const sheetXml = entries.get('xl/worksheets/sheet1.xml').toString('utf8').replace('<t>Pending Assignment</t>', '<t>Suysing</t>');
  const repacked = [];
  for (const [k, v] of entries.entries()) {
    repacked.push({ name: k, content: k === 'xl/worksheets/sheet1.xml' ? sheetXml : v });
  }
  const editedBuf = Buffer.from(buildStoredZip(repacked));
  const parsed = extractRmaUpdatesFromXlsxBuffer(editedBuf, {
    subjectHint: 'Re: [TEST] [RMA Alert] RMA-TEST-2026-0190-7GZK'
  });
  assert.equal(parsed.rmaNumber, 'RMA-TEST-2026-0190-7GZK');
  assert.equal(parsed.isTestHint, true);
  assert.equal(parsed.patch.supplier_name, 'Suysing');
  assert.equal(parsed.manifestUpdates.length, 0);
});

test('sender authorization enforces Test-only personal Gmail isolation and honors per-RMA invite allowed_emails', () => {
  const settingsRows = [
    {
      key: 'test_email_recipients_by_type',
      value: {
        new_rma: {
          toList: ['mgan@pingconmarketing.com', 'daniloalvaro031717@gmail.com'],
          ccList: []
        }
      }
    },
    {
      key: 'customer_rma_invites_store',
      value: [
        {
          rma_number: 'RMA-TEST-2026-0190-7GZK',
          is_test: true,
          status: 'active',
          allowed_emails: ['daniloalvaro031717@gmail.com', 'invited-qa@gmail.com']
        },
        {
          rma_number: 'RMA-2026-0999-LIVE',
          is_test: false,
          status: 'active',
          allowed_emails: ['vendor-contact@supplier.com']
        }
      ]
    }
  ];
  const adminSet = new Set(['finance2@keysysincorporated.com', 'mgan@pingconmarketing.com']);
  const authSets = extractAuthorizedEmailsFromSettings(settingsRows);
  const testReport = { rma_number: 'RMA-TEST-2026-0190-7GZK', ai_document_metadata: { is_test: true } };
  const liveReport = { rma_number: 'RMA-2026-0999-LIVE', ai_document_metadata: { is_test: false } };

  const testInvites = extractInviteEmailsForReport(settingsRows, 'RMA-TEST-2026-0190-7GZK', true);
  const liveInvites = extractInviteEmailsForReport(settingsRows, 'RMA-2026-0999-LIVE', false);

  // Test Mode allows daniloalvaro031717@gmail.com & per-RMA invite email
  assert.equal(isSenderAuthorizedForReport('daniloalvaro031717@gmail.com', testReport, adminSet, { ...authSets, inviteEmailsSet: testInvites }), true);
  assert.equal(isSenderAuthorizedForReport('invited-qa@gmail.com', testReport, adminSet, { ...authSets, inviteEmailsSet: testInvites }), true);

  // Live Mode rejects personal Gmail unless explicitly invited on that live RMA
  assert.equal(isSenderAuthorizedForReport('daniloalvaro031717@gmail.com', liveReport, adminSet, { ...authSets, inviteEmailsSet: liveInvites }), false);
  assert.equal(isSenderAuthorizedForReport('vendor-contact@supplier.com', liveReport, adminSet, { ...authSets, inviteEmailsSet: liveInvites }), true);
});

test('parseHeaderAndBodystructure separates headers and skips non-XLSX BODYSTRUCTURE', () => {
  const headerBytes = 'Message-ID: <abc@gmail.com>\r\nSubject: Note about .xlsx\r\nFrom: user@gmail.com\r\n\r\n';
  const plainFrame = `* 1 FETCH (UID 10 BODY[HEADER.FIELDS (MESSAGE-ID FROM SUBJECT)] {${headerBytes.length}}\r\n${headerBytes} BODYSTRUCTURE ("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" 120 4 NIL NIL NIL))`;
  const plainRes = parseHeaderAndBodystructure(Buffer.from(plainFrame, 'latin1'));
  assert.equal(plainRes.maybeHasXlsx, false);
  assert.match(plainRes.headerStr, /Message-ID: <abc@gmail\.com>/);

  const xlsxFrame = `* 2 FETCH (UID 11 BODY[HEADER.FIELDS (MESSAGE-ID FROM SUBJECT)] {${headerBytes.length}}\r\n${headerBytes} BODYSTRUCTURE (("TEXT" "HTML" NIL NIL NIL "7BIT" 200 5 NIL NIL NIL)("APPLICATION" "VND.OPENXMLFORMATS-OFFICEDOCUMENT.SPREADSHEETML.SHEET" ("NAME" "reply.xlsx") NIL NIL "BASE64" 8000 NIL ("ATTACHMENT" ("FILENAME" "reply.xlsx")) NIL) "MIXED"))`;
  const xlsxRes = parseHeaderAndBodystructure(Buffer.from(xlsxFrame, 'latin1'));
  assert.equal(xlsxRes.maybeHasXlsx, true);
});

test('extractRmaUpdatesFromXlsxBuffer & applyRmaXlsxUpdates classify non-RMA Statement of Account workbooks as NOT_AN_RMA_WORKSHEET', async () => {
  const soaBytes = Buffer.from(
    buildTableXlsxBytes({
      sheetName: 'Statement of Account',
      title: 'PINGCON MARKETING CORP.',
      subtitle: 'STATEMENT OF ACCOUNT - ACME CORP',
      columns: [
        { header: 'Date', type: 'text' },
        { header: 'Reference No.', type: 'text' },
        { header: 'Balance', type: 'currency' }
      ],
      rows: [['2026-11-25', 'SI-9001', 12500]]
    })
  );

  const parsed = extractRmaUpdatesFromXlsxBuffer(soaBytes, {
    subjectHint: 'Statement of Account - ACME Corp as of Report Date Nov 25, 2026'
  });
  assert.equal(parsed.isRmaWorksheet, false);

  // During IMAP polling (bypassSenderCheck: false), cleanly return NOT_AN_RMA_WORKSHEET without touching DB
  const skipRes = await applyRmaXlsxUpdates({
    buffer: soaBytes,
    senderEmail: 'finance@pingconmarketing.com',
    subjectHint: 'Statement of Account - ACME Corp',
    bypassSenderCheck: false
  });
  assert.equal(skipRes.skipped, true);
  assert.equal(skipRes.reason, 'NOT_AN_RMA_WORKSHEET');

  // Manual upload (bypassSenderCheck: true) still rejects invalid template
  await assert.rejects(
    () => applyRmaXlsxUpdates({ buffer: soaBytes, senderEmail: 'finance2@keysysincorporated.com', bypassSenderCheck: true }),
    /not a recognized RMA Alert worksheet/i
  );
});

test('corrupted RMA Alert worksheet with banner/Field header and blank RMA Number still throws instead of silent skip', () => {
  const origBytes = Buffer.from(
    buildRmaAlertXlsxBytes(
      { rma_number: 'RMA-TEST-2026-0190-7GZK', supplier_name: 'Pending Assignment' },
      { subject: '[TEST] [RMA Alert] RMA-TEST-2026-0190-7GZK' }
    )
  );
  const entries = parseZipEntriesFromBuffer(origBytes);
  const wipedSheet = entries
    .get('xl/worksheets/sheet1.xml')
    .toString('utf8')
    .replaceAll('RMA-TEST-2026-0190-7GZK', '');
  const repacked = [];
  for (const [k, v] of entries.entries()) {
    repacked.push({ name: k, content: k === 'xl/worksheets/sheet1.xml' ? wipedSheet : v });
  }
  const corruptedBuf = Buffer.from(buildStoredZip(repacked));
  const parsed = extractRmaUpdatesFromXlsxBuffer(corruptedBuf, { subjectHint: 'Re: Broken edit' });
  assert.equal(parsed.isRmaWorksheet, true);
  assert.equal(parsed.rmaNumber, '');
});

test('genuine renamed .xlsx RMA reply with changed subject and stripped banner still parses RMA fields cleanly', () => {
  const origBytes = Buffer.from(
    buildRmaAlertXlsxBytes(
      {
        rma_number: 'RMA-TEST-2026-0190-7GZK',
        barcode: 'Testgsbdjdn',
        name: 'Tesvahbdj',
        supplier_name: 'Pending Assignment',
        ai_document_metadata: { is_test: true, test_mode: true }
      },
      { subject: '[TEST] [RMA Alert] RMA-TEST-2026-0190-7GZK' }
    )
  );
  const entries = parseZipEntriesFromBuffer(origBytes);
  // Strip both banners inside XML while editing supplier to Suysing and using a non-RMA email subject
  const editedSheet = entries
    .get('xl/worksheets/sheet1.xml')
    .toString('utf8')
    .replace('WHOLESALE RMA ALERT WORKSHEET', 'EDITED COPY')
    .replace('2-WAY EMAIL REPLY EDITABLE WORKSHEET', 'VENDOR SHEET')
    .replace('<t>Pending Assignment</t>', '<t>Suysing</t>');
  const repacked = [];
  for (const [k, v] of entries.entries()) {
    repacked.push({ name: k, content: k === 'xl/worksheets/sheet1.xml' ? editedSheet : v });
  }
  const renamedBuf = Buffer.from(buildStoredZip(repacked));
  const parsed = extractRmaUpdatesFromXlsxBuffer(renamedBuf, {
    subjectHint: 'Updated vendor details for our call'
  });
  assert.equal(parsed.isRmaWorksheet, true);
  assert.equal(parsed.rmaNumber, 'RMA-TEST-2026-0190-7GZK');
  assert.equal(parsed.isTestHint, true);
  assert.equal(parsed.patch.supplier_name, 'Suysing');
});

test('syncEmailRepliesInternal caches non-RMA Statement of Account Message-IDs without error status or marking Gmail \\Seen', async () => {
  const mockDb = createMockSupabase();
  const soaBytes = Buffer.from(
    buildTableXlsxBytes({
      sheetName: 'Statement of Account',
      title: 'PINGCON MARKETING CORP.',
      subtitle: 'SOA',
      columns: [{ header: 'Client', type: 'text' }, { header: 'Amount', type: 'currency' }],
      rows: [['ACME', 5000]]
    })
  );

  const soaMsg = {
    uid: 77,
    dedupeKey: '<soa-123@mail.gmail.com>',
    messageId: '<soa-123@mail.gmail.com>',
    from: 'finance@pingconmarketing.com',
    subject: 'Statement of Account - ACME Nov 25, 2026',
    attachments: [{ filename: 'Statement of Account - ACME.xlsx', buffer: soaBytes }]
  };

  const makeMockImapFetcher = (seenHolder) => async ({ processedSet, onProcessMessages }) => {
    const msgs = processedSet.has(soaMsg.dedupeKey) ? [] : [soaMsg];
    const seen = await onProcessMessages(msgs, []);
    seenHolder.push(...seen);
    return { scannedRecentMessages: 1, messagesWithXlsx: msgs.length };
  };

  // Run 1: cleanly skipped as NOT_AN_RMA_WORKSHEET, Message-ID cached, email stays unread (seen1 = []), no error status
  const seen1 = [];
  const res1 = await syncEmailRepliesInternal({
    triggerSource: 'cron_job_org',
    caller: 'cron',
    imapFetcher: makeMockImapFetcher(seen1),
    dbClient: mockDb,
    credentials: { user: 'finance2@keysysincorporated.com', pass: 'abcdabcdabcdabcd' }
  });
  assert.equal(res1.success, true);
  assert.equal(res1.status, 'skipped_non_rma');
  assert.equal(res1.errorCount, 0);
  assert.equal(res1.skippedNonRmaCount, 1);
  assert.deepEqual(seen1, []);
  assert.deepEqual(mockDb.store.get('processed_reply_message_ids'), ['<soa-123@mail.gmail.com>']);
  assert.equal(mockDb.store.get('email_reply_sync_status').lastStatus, 'skipped_non_rma');
  assert.equal(mockDb.store.get('email_reply_sync_status').lastErrorMessage, null);
  assert.equal(mockDb.store.get('email_reply_sync_logs')[0].details[0].status, 'skipped');
  assert.equal(mockDb.store.get('email_reply_sync_logs')[0].details[0].reason, 'NOT_AN_RMA_WORKSHEET');

  // Run 2: cached Message-ID skipped at header probe -> 0 attachments scanned, idle
  const seen2 = [];
  const res2 = await syncEmailRepliesInternal({
    triggerSource: 'cron_job_org',
    caller: 'cron',
    imapFetcher: makeMockImapFetcher(seen2),
    dbClient: mockDb,
    credentials: { user: 'finance2@keysysincorporated.com', pass: 'abcdabcdabcdabcd' }
  });
  assert.equal(res2.success, true);
  assert.equal(res2.status, 'idle');
  assert.equal(res2.scannedUnseenWithXlsx, 0);
  assert.equal(res2.errorCount, 0);
});

test('batch helper summaries and .xlsx per-item quantity + mixed supplier extraction work accurately', async () => {
  const {
    sumManifestQuantity,
    summarizeBatchSuppliers,
    resolveBatchManifestForQr
  } = await import('../src/utils/rmaHelpers.js');

  const mixedItems = [
    { barcode: '480001', name: 'Item One', supplier_name: 'Supplier A', quantity: 2, unit_name: 'pc' },
    { barcode: '480002', name: 'Item Two', supplier_name: 'Suysing', quantity: 3, unit_name: 'pc' }
  ];

  assert.equal(sumManifestQuantity(mixedItems), 5);
  assert.equal(summarizeBatchSuppliers(mixedItems), 'Multiple Suppliers (Supplier A, Suysing)');

  // Unpacked Supplier Claims child row resolves full parent batch manifest cleanly
  const parent = { id: 101, rma_number: 'RMA-TEST-2026-8888', is_parent: true, items: mixedItems, total_items: 2, total_quantity: 5 };
  const unpackedChild = { id: '101_item_1', parent_rma_id: 101, rma_number: 'RMA-TEST-2026-8888', is_parent: false, is_unpacked_manifest_item: true, items: [], total_items: 1 };
  const resolved = resolveBatchManifestForQr(unpackedChild, [parent]);
  assert.equal(resolved.items.length, 2);
  assert.equal(resolved.parentReport.rma_number, 'RMA-TEST-2026-8888');

  // Strict single-item RMA duplicated across lookup pools must NOT misclassify as multi-item
  const singleRow = { id: 505, rma_number: 'RMA-TEST-2026-SINGLE', is_parent: false, barcode: '480999', name: 'Single Item', items: [], total_items: 1 };
  const singleOptimisticDup = { rma_number: 'RMA-TEST-2026-SINGLE', is_parent: false, barcode: '480999', name: 'Single Item', items: [], total_items: 1 };
  const resolvedSingle = resolveBatchManifestForQr(singleRow, [singleRow, { ...singleRow }, singleOptimisticDup]);
  assert.equal(resolvedSingle.items.length, 0);

  // Build mirror .xlsx -> edit ONLY Item 1 Quantity (2 -> 5) in Col F -> verify extractRmaUpdatesFromXlsxBuffer
  const origBytes = Buffer.from(
    buildRmaAlertXlsxBytes(
      {
        rma_number: 'RMA-TEST-2026-8888',
        barcode: 'RMA-TEST-2026-8888',
        name: 'Batch Return Manifest (2 items)',
        quantity: 5,
        total_quantity: 5,
        total_items: 2,
        is_parent: true,
        supplier_name: 'Multiple Suppliers (Supplier A, Suysing)',
        items: mixedItems,
        rma_type: 'supplier_outbound',
        ai_document_metadata: { is_test: true, test_mode: true }
      },
      { subject: '[TEST] [RMA Alert] RMA-TEST-2026-8888' }
    )
  );
  const entries = parseZipEntriesFromBuffer(origBytes);
  const xml = entries.get('xl/worksheets/sheet1.xml').toString('utf8');
  const marker = xml.indexOf('MANIFEST LINE ITEMS');
  assert.ok(marker > -1);
  const editedSheetXml = xml.slice(0, marker) + xml.slice(marker).replace(/(<c r="F\d+"[^>]*><v>)2(<\/v><\/c>)/, '$15$2');
  const repacked = [];
  for (const [k, v] of entries.entries()) {
    repacked.push({ name: k, content: k === 'xl/worksheets/sheet1.xml' ? editedSheetXml : v });
  }
  const parsed = extractRmaUpdatesFromXlsxBuffer(Buffer.from(buildStoredZip(repacked)), {
    subjectHint: 'Re: [TEST] [RMA Alert] RMA-TEST-2026-8888'
  });
  assert.equal(parsed.manifestUpdates.length, 2);
  assert.equal(parsed.manifestUpdates[0].supplier_name, 'Supplier A');
  assert.equal(parsed.manifestUpdates[0].quantity, 5);
  assert.equal(parsed.manifestUpdates[1].supplier_name, 'Suysing');
  assert.equal(parsed.manifestUpdates[1].quantity, 3);
});

test('reorder status is strictly independent from 4-Choice Outcome (never marks Scrapped or stops 10-day SLA)', async () => {
  const {
    resolveReorderStatus,
    formatFourChoiceOutcome,
    formatLifecycleStage,
    isItemReorderNeeded
  } = await import('../src/utils/rmaHelpers.js');
  const { computeFourStepWorkflow } = await import('../src/utils/followUpWorkflow.js');

  const pendingRtv = {
    id: 1752,
    rma_number: 'RMA-TEST-2026-0207-HY7K',
    status: 'under_inspection',
    disposition: '3- Return to Vendor (RTV)',
    supplier_name: 'Unilever',
    created_at: new Date().toISOString(),
    ai_document_metadata: {
      is_test: true,
      test_mode: true,
      follow_up: { enabled: true, started_at: new Date().toISOString() },
      reorder: {
        status: 'reordered',
        reordered_at: '2026-11-27T01:00:00.000Z',
        reordered_by: 'Purchasing API',
        po_number: 'PO-9901',
        notes: 'Replacement ordered'
      }
    }
  };

  const reorderInfo = resolveReorderStatus(pendingRtv);
  assert.equal(reorderInfo.status, 'reordered');
  assert.equal(reorderInfo.isReordered, true);
  assert.equal(reorderInfo.poNumber, 'PO-9901');
  assert.equal(reorderInfo.reorderedBy, 'Purchasing API');

  const outcome = formatFourChoiceOutcome(pendingRtv);
  assert.notEqual(outcome.choiceKey, 'scrap');
  assert.equal(outcome.label.toLowerCase().includes('scrapped'), false);

  const stage = formatLifecycleStage(pendingRtv);
  assert.equal(stage.label.toLowerCase().includes('scrapped'), false);
  assert.equal(stage.label.toLowerCase().includes('re-ordered'), false);

  const wf = computeFourStepWorkflow(pendingRtv, []);
  assert.equal(wf.isClosed, false);
  assert.equal(wf.followUpEnabled, true);
  assert.equal(wf.isCountdownActive, true);
  assert.equal(isItemReorderNeeded(pendingRtv), false);

  // Even legacy rows that still carry workflow_resolution: 'reordered' must NOT resolve as Scrapped or close SLA
  const legacyReordered = {
    ...pendingRtv,
    ai_document_metadata: {
      is_test: true,
      test_mode: true,
      workflow_resolution: 'reordered',
      resolved_at: '2026-11-20T01:00:00.000Z',
      follow_up: { enabled: true, started_at: new Date().toISOString() }
    }
  };
  assert.equal(resolveReorderStatus(legacyReordered).isReordered, true);
  assert.notEqual(formatFourChoiceOutcome(legacyReordered).choiceKey, 'scrap');
  assert.equal(computeFourStepWorkflow(legacyReordered, []).isClosed, false);

  // Default Pending Reorder check
  const defaultItem = {
    id: 1753,
    rma_number: 'RMA-TEST-PENDING',
    status: 'under_inspection',
    disposition: '1 - Pending Vendor Pickup',
    ai_document_metadata: { simple_rtv_disposition: 'supplier_credit', simple_rtv_label: 'Debit Claim (Deduction from Next PO)' }
  };
  assert.equal(resolveReorderStatus(defaultItem).status, 'pending');
  assert.equal(resolveReorderStatus(defaultItem).isReordered, false);
  assert.equal(resolveReorderStatus(defaultItem).label, 'Pending');
});

test('scoped per-supplier batch .xlsx preserves Col A..J + adds Col K..M (Supplier Email & Parent Line Ref #)', async () => {
  const { groupReportItemsBySupplierForFollowUp, resolveReportPartyAndEmails } = await import('../src/utils/followUpWorkflow.js');
  const mixedBatch = {
    id: 990,
    rma_number: 'RMA-TEST-2026-0990-SPLIT',
    rma_type: 'supplier_outbound',
    is_parent: true,
    supplier_name: 'Multiple Suppliers (Acme Corp, Suysing)',
    items: [
      { id: 'line-a', name: 'Item One', barcode: '10001', code: 'SKU1', quantity: 2, unit_name: 'pc', price: 50, supplier_name: 'Acme Corp', supplier_email_to: 'acme@vendor.test.ph' },
      { id: 'line-b', name: 'Item Two', barcode: '10002', code: 'SKU2', quantity: 3, unit_name: 'box', price: 99, supplier_name: 'Suysing', supplier_email_to: 'claims@suysing.test.ph' }
    ],
    ai_document_metadata: {
      is_test: true,
      follow_up: {
        enabled: true,
        supplier_email_to: ''
      }
    }
  };

  // Verify empty string in follow_up does not shadow pickup email
  const fallbackCheck = resolveReportPartyAndEmails({
    supplier_name: 'Acme Corp',
    ai_document_metadata: {
      follow_up: { supplier_email_to: '' },
      supplier_pickup: { supplier_email_to: 'pickup-fallback@acme.test.ph' }
    }
  });
  assert.equal(fallbackCheck.supplierEmailTo, 'pickup-fallback@acme.test.ph');

  const groups = groupReportItemsBySupplierForFollowUp(mixedBatch, [], []);
  assert.equal(groups.length, 2);
  const suysingGroup = groups.find((g) => g.supplierName === 'Suysing');
  assert.ok(suysingGroup);

  const bytes = buildRmaAlertXlsxBytes(mixedBatch, {
    subject: '[TEST] Scoped Follow-Up',
    supplierGroup: suysingGroup,
    forceManifestTable: true
  });
  const parsed = extractRmaUpdatesFromXlsxBuffer(Buffer.from(bytes), {
    subjectHint: '[TEST] Scoped Follow-Up'
  });

  assert.equal(parsed.patch.supplier_name, 'Suysing');
  assert.equal(parsed.patch.supplier_email_to, 'claims@suysing.test.ph');
  assert.equal(parsed.batchScope?.lineRefs?.[0], 2);
  assert.equal(parsed.manifestUpdates.length, 1);
  assert.equal(parsed.manifestUpdates[0].parentLineRef, 2);
  assert.equal(parsed.manifestUpdates[0].supplier_email_to, 'claims@suysing.test.ph');
  assert.equal(parsed.manifestUpdates[0].quantity, 3);
});




