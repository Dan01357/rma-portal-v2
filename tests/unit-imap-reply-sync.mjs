import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getImapTlsConnectOptions,
  categorizeImapError,
  extractRmaUpdatesFromXlsxBuffer,
  extractAuthorizedEmailsFromSettings,
  extractInviteEmailsForReport,
  isSenderAuthorizedForReport,
  syncEmailRepliesInternal
} from '../api/_lib/imapReplySyncHandler.js';
import { buildRmaAlertXlsxBytes } from '../src/utils/rmaAlertXlsx.js';
import { buildStoredZip } from '../src/utils/exportXlsx.js';

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

