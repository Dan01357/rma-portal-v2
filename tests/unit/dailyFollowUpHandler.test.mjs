import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleDailyFollowUp,
  safeUpdateRmaReport
} from '../../api/_lib/dailyFollowUpHandler.js';

const VALID_RMA_REPORT_COLUMNS = new Set([
  'id',
  'rma_number',
  'rma_type',
  'status',
  'disposition',
  'warehouse_location',
  'supplier_name',
  'store_branch',
  'barcode',
  'code',
  'name',
  'quantity',
  'unit_name',
  'reason',
  'explanation',
  'photos',
  'items',
  'parent_rma_id',
  'is_parent',
  'ae_name',
  'ae_email',
  'created_at',
  'inspected_at',
  'ai_document_metadata',
  'audit_trail'
]);

function createSupabaseStub({ settings = [], reports = [], products = [] } = {}) {
  const settingsRows = settings.map((s) => ({ ...s }));
  const reportRows = reports.map((r) => structuredClone(r));
  const productRows = products.map((p) => structuredClone(p));
  const updatePayloads = [];

  const db = {
    updatePayloads,
    reportRows,
    from(table) {
      if (table === 'rma_settings') {
        return {
          select() {
            return {
              in(_col, keys) {
                const matched = settingsRows.filter((r) => keys.includes(r.key));
                return Promise.resolve({ data: matched, error: null });
              }
            };
          }
        };
      }

      if (table === 'products') {
        return {
          select() {
            return Promise.resolve({ data: productRows, error: null });
          }
        };
      }

      if (table === 'rma_reports') {
        return {
          select() {
            return {
              order() {
                return Promise.resolve({ data: reportRows.map((r) => structuredClone(r)), error: null });
              },
              ilike(_col, pattern) {
                const needle = String(pattern || '').trim().toLowerCase();
                const matched = reportRows.filter((r) => String(r.rma_number || '').trim().toLowerCase() === needle);
                return Promise.resolve({ data: matched.map((r) => structuredClone(r)), error: null });
              },
              in(_col, ids) {
                const matched = reportRows.filter((r) => ids.includes(r.parent_rma_id));
                return Promise.resolve({ data: matched.map((r) => structuredClone(r)), error: null });
              }
            };
          },
          update(updates) {
            const payload = { ...updates };
            updatePayloads.push(payload);
            const runEq = (col, val) => {
              const badCol = Object.keys(payload).find((k) => !VALID_RMA_REPORT_COLUMNS.has(k));
              if (badCol) {
                return {
                  data: null,
                  error: { message: `Could not find the '${badCol}' column of 'rma_reports' in the schema cache` }
                };
              }
              const updated = [];
              for (const row of reportRows) {
                if (row[col] === val) {
                  Object.assign(row, structuredClone(payload));
                  updated.push(structuredClone(row));
                }
              }
              return { data: updated, error: null };
            };
            return {
              eq(col, val) {
                const res = runEq(col, val);
                return {
                  then(resolve, reject) {
                    return Promise.resolve(res).then(resolve, reject);
                  },
                  select() {
                    return Promise.resolve(res);
                  }
                };
              }
            };
          }
        };
      }

      throw new Error(`Unexpected table in test stub: ${table}`);
    }
  };

  return db;
}

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
  return res;
}

test('safeUpdateRmaReport strips unknown schema columns (updated_at) and falls back status constraint errors', async () => {
  const attemptedUpdates = [];
  const fakeDb = {
    from() {
      return {
        update(payload) {
          attemptedUpdates.push({ ...payload });
          return {
            eq() {
              return {
                select() {
                  if ('updated_at' in payload) {
                    return Promise.resolve({
                      data: null,
                      error: { message: "Could not find the 'updated_at' column of 'rma_reports' in the schema cache" }
                    });
                  }
                  if (payload.status === 'resolved') {
                    return Promise.resolve({
                      data: null,
                      error: { message: 'new row for relation "rma_reports" violates check constraint "rma_reports_status_check"' }
                    });
                  }
                  return Promise.resolve({ data: [{ id: 10, ...payload }], error: null });
                }
              };
            }
          };
        }
      };
    }
  };

  const saved = await safeUpdateRmaReport(10, {
    status: 'resolved',
    disposition: '5- Scrap / Dispose',
    updated_at: '2026-11-28T05:00:00.000Z'
  }, fakeDb);

  assert.equal(saved.status, 'under_inspection');
  assert.equal('updated_at' in saved, false);
  assert.equal(attemptedUpdates.length, 3);
});

test('handleDailyFollowUp non-dryRun sends Day 1 accelerated email via smtp.transporter and saves without updated_at', async () => {
  const sentEmails = [];
  const now = new Date('2026-11-28T05:01:15.000Z');
  const db = createSupabaseStub({
    settings: [
      {
        key: 'daily_followup_config',
        value: {
          autoEnabled: false,
          autoSendTimePht: '13:00',
          customerFollowUpDefaultEnabled: false,
          testStepIntervalSeconds: 60,
          testAutoCronEnabled: true
        }
      },
      {
        key: 'test_sandbox_email',
        value: 'sandbox-qa@pingconmarketing.com'
      },
      {
        key: 'supplier_directory_store',
        value: [{ supplier_name: 'Suy Sing Commercial Corp', email_to: 'real-live-vendor@suysing.com' }]
      },
      {
        key: 'test_supplier_directory_store',
        value: [{ supplier_name: 'PW Test Supplier Corp', email_to: 'pw-dir@pingcon-test.local' }]
      }
    ],
    reports: [
      {
        id: 501,
        rma_number: 'RMA-TEST-2026-0999-ABCD',
        rma_type: 'supplier_outbound',
        status: 'pending',
        disposition: 'Pending',
        supplier_name: 'Suy Sing Commercial Corp',
        barcode: '4805358373037',
        code: 'SS1319P',
        name: 'Magnolia Daily Quezo',
        quantity: 2,
        unit_name: 'pc',
        created_at: '2026-11-28T05:00:00.000Z',
        ai_document_metadata: {
          is_test_mode: true,
          follow_up: {
            enabled: true,
            started_at: '2026-11-28T05:00:00.000Z'
          }
        },
        audit_trail: []
      }
    ]
  });

  const req = { method: 'POST', query: {}, body: {} };
  const res = createMockRes();

  await handleDailyFollowUp(
    req,
    res,
    { action: 'daily-followup', isTestMode: true, dryRun: false, respectSchedule: false },
    {
      supabaseClient: db,
      authorizeCronOrAdmin: async () => ({ authorized: true, callerType: 'admin', actor: 'qa@pingconmarketing.com' }),
      createSmtpTransport: () => ({
        configured: true,
        smtpUser: 'mailer@pingconmarketing.com',
        transporter: {
          async sendMail(mail) {
            sentEmails.push(mail);
            return { messageId: 'msg-followup-1' };
          }
        }
      }),
      now
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.summary.followUpsSent, 1);
  assert.equal(res.body.summary.errorCount, 0);

  assert.equal(sentEmails.length, 1);
  assert.match(sentEmails[0].from, /mailer@pingconmarketing\.com/);
  assert.equal(sentEmails[0].to, 'sandbox-qa@pingconmarketing.com');
  assert.doesNotMatch(sentEmails[0].to, /real-live-vendor@suysing\.com/);
  assert.match(sentEmails[0].subject, /^\[TEST\] \[Follow-Up \| .+ — Day 1 of 10\] RMA-TEST-2026-0999-ABCD/);

  assert.equal(db.updatePayloads.length, 1);
  assert.equal('updated_at' in db.updatePayloads[0], false);
  const updatedRow = db.reportRows.find((r) => r.id === 501);
  assert.equal(updatedRow.ai_document_metadata.follow_up.last_sent_sim_day, 1);
  assert.equal(updatedRow.ai_document_metadata.follow_up.sent_count, 1);
  assert.equal(updatedRow.audit_trail[0].action, 'FOLLOWUP_EMAIL_SENT');
});

test('handleDailyFollowUp non-dryRun auto-disposes >10 simulated days, updates children, and sends [TEST] alert', async () => {
  const sentEmails = [];
  const now = new Date('2026-11-28T05:12:00.000Z');
  const db = createSupabaseStub({
    settings: [
      {
        key: 'daily_followup_config',
        value: {
          autoEnabled: false,
          autoSendTimePht: '13:00',
          customerFollowUpDefaultEnabled: false,
          testStepIntervalSeconds: 60,
          testAutoCronEnabled: true
        }
      },
      {
        key: 'test_email_recipients_by_type',
        value: {
          new_rma: { toList: ['qa-dispose@pingconmarketing.com'], ccList: ['qa-cc@pingconmarketing.com'] }
        }
      }
    ],
    reports: [
      {
        id: 601,
        is_parent: true,
        rma_number: 'RMA-TEST-2026-0888-DISP',
        rma_type: 'supplier_outbound',
        status: 'pending',
        disposition: 'Pending',
        supplier_name: 'PW Test Supplier',
        barcode: 'PWBC-1',
        name: 'PW Item Parent',
        quantity: 3,
        unit_name: 'pc',
        created_at: '2026-11-28T05:00:00.000Z',
        ai_document_metadata: {
          is_test_mode: true,
          follow_up: {
            enabled: true,
            started_at: '2026-11-28T05:00:00.000Z'
          }
        },
        audit_trail: []
      },
      {
        id: 602,
        parent_rma_id: 601,
        rma_number: 'RMA-TEST-2026-0888-DISP',
        rma_type: 'supplier_outbound',
        status: 'pending',
        disposition: 'Pending',
        created_at: '2026-11-28T05:00:00.000Z',
        ai_document_metadata: { is_test_mode: true }
      }
    ]
  });

  const req = { method: 'POST', query: {}, body: {} };
  const res = createMockRes();

  await handleDailyFollowUp(
    req,
    res,
    { action: 'daily-followup', isTestMode: true, dryRun: false, respectSchedule: false },
    {
      supabaseClient: db,
      authorizeCronOrAdmin: async () => ({ authorized: true, callerType: 'cron', actor: 'Scheduled Cron Runner' }),
      createSmtpTransport: () => ({
        configured: true,
        smtpUser: 'mailer@pingconmarketing.com',
        transporter: {
          async sendMail(mail) {
            sentEmails.push(mail);
            return { messageId: 'msg-dispose-1' };
          }
        }
      }),
      now
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.summary.autoDisposed, 1);
  assert.equal(res.body.summary.errorCount, 0);

  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, 'qa-dispose@pingconmarketing.com');
  assert.equal(sentEmails[0].cc, 'qa-cc@pingconmarketing.com');
  assert.match(sentEmails[0].subject, /^\[TEST\] \[Auto-Disposed >10 Days\] RMA-TEST-2026-0888-DISP/);

  const parent = db.reportRows.find((r) => r.id === 601);
  const child = db.reportRows.find((r) => r.id === 602);
  assert.equal(parent.status, 'resolved');
  assert.equal(parent.disposition, '5- Scrap / Dispose');
  assert.equal(parent.warehouse_location, 'Disposal / Scrap Area');
  assert.ok(parent.ai_document_metadata.follow_up.auto_disposed_at);
  assert.equal(parent.audit_trail[0].action, 'AUTO_DISPOSED_AFTER_10_DAYS');
  assert.equal(child.status, 'resolved');
  assert.equal(child.disposition, '5- Scrap / Dispose');
});

test('handleDailyFollowUp surfaces top-level error string when an email or DB failure occurs', async () => {
  const now = new Date('2026-11-28T05:02:00.000Z');
  const db = createSupabaseStub({
    settings: [
      {
        key: 'daily_followup_config',
        value: { testStepIntervalSeconds: 60 }
      }
    ],
    reports: [
      {
        id: 701,
        rma_number: 'RMA-TEST-2026-0777-ERR1',
        rma_type: 'supplier_outbound',
        status: 'pending',
        disposition: 'Pending',
        supplier_name: 'PW Test Supplier',
        created_at: '2026-11-28T05:00:00.000Z',
        ai_document_metadata: {
          is_test_mode: true,
          follow_up: { enabled: true, started_at: '2026-11-28T05:00:00.000Z' }
        }
      }
    ]
  });

  const req = { method: 'POST', query: {}, body: {} };
  const res = createMockRes();

  await handleDailyFollowUp(
    req,
    res,
    { action: 'daily-followup', isTestMode: true, dryRun: false, respectSchedule: false },
    {
      supabaseClient: db,
      authorizeCronOrAdmin: async () => ({ authorized: true, callerType: 'admin', actor: 'qa@pingconmarketing.com' }),
      createSmtpTransport: () => ({
        configured: true,
        smtpUser: 'mailer@pingconmarketing.com',
        transporter: {
          async sendMail() {
            throw new Error('535 BadCredentials simulated');
          }
        }
      }),
      now
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, false);
  assert.equal(res.body.summary.errorCount, 1);
  assert.match(res.body.error, /RMA-TEST-2026-0777-ERR1: 535 BadCredentials simulated/);
});

test('handleDailyFollowUp Live Mode uses Live supplier_directory_store (never Test directory) and saves cleanly', async () => {
  const sentEmails = [];
  // 2026-11-28T05:30:00.000Z is 13:30 Asia/Manila (past 13:00 PHT gate)
  const now = new Date('2026-11-28T05:30:00.000Z');
  const db = createSupabaseStub({
    settings: [
      {
        key: 'daily_followup_config',
        value: {
          autoEnabled: true,
          autoSendTimePht: '13:00',
          customerFollowUpDefaultEnabled: false,
          testStepIntervalSeconds: 60,
          testAutoCronEnabled: false
        }
      },
      {
        key: 'supplier_directory_store',
        value: [{ supplier_name: 'Suy Sing Commercial Corp', email_to: 'claims@suysing-corp.ph', email_cc: 'ap@suysing-corp.ph' }]
      },
      {
        key: 'test_supplier_directory_store',
        value: [{ supplier_name: 'Suy Sing Commercial Corp', email_to: 'pw-sandbox-only@pingcon-test.local' }]
      },
      {
        key: 'email_recipients_by_type',
        value: {
          supplier_followup: { toList: [], ccList: ['accounts.payable@pingconmarketing.com'] }
        }
      }
    ],
    reports: [
      {
        id: 801,
        rma_number: 'RMA-2026-0148-B8Q2',
        rma_type: 'supplier_outbound',
        status: 'pending',
        disposition: 'Pending',
        supplier_name: 'Suy Sing Commercial Corp',
        created_at: '2026-11-27T05:00:00.000Z',
        ai_document_metadata: {
          follow_up: { enabled: true, started_at: '2026-11-27T05:00:00.000Z' }
        },
        audit_trail: []
      }
    ]
  });

  const req = { method: 'POST', query: {}, body: {} };
  const res = createMockRes();

  await handleDailyFollowUp(
    req,
    res,
    { action: 'daily-followup', isTestMode: false, dryRun: false, respectSchedule: true },
    {
      supabaseClient: db,
      authorizeCronOrAdmin: async () => ({ authorized: true, callerType: 'cron', actor: 'Scheduled Cron Runner' }),
      createSmtpTransport: () => ({
        configured: true,
        smtpUser: 'mailer@pingconmarketing.com',
        transporter: {
          async sendMail(mail) {
            sentEmails.push(mail);
            return { messageId: 'msg-live-1' };
          }
        }
      }),
      now
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.summary.followUpsSent, 1);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, 'claims@suysing-corp.ph');
  assert.match(sentEmails[0].cc, /ap@suysing-corp\.ph/);
  assert.match(sentEmails[0].cc, /accounts\.payable@pingconmarketing\.com/);
  assert.doesNotMatch(sentEmails[0].to, /pw-sandbox-only/);
  assert.doesNotMatch(sentEmails[0].subject, /^\[TEST\]/);
  assert.equal(db.reportRows[0].ai_document_metadata.follow_up.last_sent_day, 1);
  assert.equal(db.reportRows[0].ai_document_metadata.follow_up.sent_count, 1);
});

