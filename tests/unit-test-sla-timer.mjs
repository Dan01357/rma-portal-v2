import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFourStepWorkflow,
  buildFollowUpEmailContent,
  buildAutoDisposedEmailContent,
  normalizeTestStepIntervalSeconds
} from '../src/utils/followUpWorkflow.js';

function makeBaseReport(overrides = {}) {
  return {
    id: 999,
    rma_number: 'RMA-TEST-2026-9901-ABCD',
    rma_type: 'supplier_outbound',
    barcode: '4800000000001',
    name: 'Test Item',
    supplier_name: 'Test Vendor',
    status: 'under_inspection',
    created_at: '2026-11-27T04:00:00.000Z', // 12:00:00 PHT
    ai_document_metadata: {
      is_test: true,
      test_mode: true,
      follow_up: {
        enabled: true,
        started_at: '2026-11-27T04:00:00.000Z'
      }
    },
    ...overrides
  };
}

test('normalizeTestStepIntervalSeconds clamps custom intervals safely and preserves 0 for normal mode', () => {
  assert.equal(normalizeTestStepIntervalSeconds(0), 0);
  assert.equal(normalizeTestStepIntervalSeconds(null), 0);
  assert.equal(normalizeTestStepIntervalSeconds(5), 10);
  assert.equal(normalizeTestStepIntervalSeconds(30), 30);
  assert.equal(normalizeTestStepIntervalSeconds(60), 60);
  assert.equal(normalizeTestStepIntervalSeconds(120), 120);
  assert.equal(normalizeTestStepIntervalSeconds(999999), 86400);
});

test('Live Production RMA NEVER accelerates even when testStepIntervalSeconds is set', () => {
  const liveReport = makeBaseReport({
    id: 1001,
    rma_number: 'RMA-2026-1001-LIVE',
    notes: '',
    ai_document_metadata: {
      follow_up: {
        enabled: true,
        started_at: '2026-11-27T04:00:00.000Z'
      }
    }
  });

  // +600 seconds (+10 minutes) on same calendar day
  const tenMinutesLater = new Date('2026-11-27T04:10:00.000Z');
  const wf = computeFourStepWorkflow(liveReport, [], {
    now: tenMinutesLater,
    testStepIntervalSeconds: 30
  });

  assert.equal(wf.isAcceleratedTestSla, false);
  assert.equal(wf.testStepIntervalSeconds, 0);
  assert.equal(wf.calendarDay, 0);
  assert.equal(wf.isExpiredAfter10Days, false);
});

test('Test Mode Sandbox RMA accelerates Day 0 -> Day 1 -> Day 10 -> Auto-Dispose (>Day 10) at custom seconds interval', () => {
  const start = new Date('2026-11-27T04:00:00.000Z');
  const report = makeBaseReport();

  // At +25s with 30s/day -> Still Day 0, next step in 5s
  const wf0 = computeFourStepWorkflow(report, [], {
    now: new Date(start.getTime() + 25_000),
    testStepIntervalSeconds: 30
  });
  assert.equal(wf0.isAcceleratedTestSla, true);
  assert.equal(wf0.testStepIntervalSeconds, 30);
  assert.equal(wf0.calendarDay, 0);
  assert.equal(wf0.nextStepInSeconds, 5);
  assert.equal(wf0.isExpiredAfter10Days, false);

  // At +30s -> Simulated Day 1
  const wf1 = computeFourStepWorkflow(report, [], {
    now: new Date(start.getTime() + 30_000),
    testStepIntervalSeconds: 30
  });
  assert.equal(wf1.calendarDay, 1);
  assert.equal(wf1.alreadySentToday, false);
  assert.equal(wf1.isExpiredAfter10Days, false);

  // Mark Day 1 sent on same PHT calendar date; Day 2 (+60s) must NOT be blocked by today calendar date!
  const afterDay1Sent = makeBaseReport({
    ai_document_metadata: {
      is_test: true,
      test_mode: true,
      follow_up: {
        enabled: true,
        started_at: start.toISOString(),
        last_sent_pht_date: '2026-11-27',
        last_sent_day: 1,
        last_sent_sim_day: 1,
        last_sent_sim_interval_sec: 30,
        sent_sim_days: [1],
        sent_count: 1
      }
    }
  });
  const wfStillDay1 = computeFourStepWorkflow(afterDay1Sent, [], {
    now: new Date(start.getTime() + 45_000),
    testStepIntervalSeconds: 30
  });
  assert.equal(wfStillDay1.calendarDay, 1);
  assert.equal(wfStillDay1.alreadySentToday, true);

  const wfDay2 = computeFourStepWorkflow(afterDay1Sent, [], {
    now: new Date(start.getTime() + 60_000),
    testStepIntervalSeconds: 30
  });
  assert.equal(wfDay2.calendarDay, 2);
  assert.equal(wfDay2.alreadySentToday, false);

  // At +300s (10 * 30s) -> Day 10 follow-up window
  const wfDay10 = computeFourStepWorkflow(afterDay1Sent, [], {
    now: new Date(start.getTime() + 300_000),
    testStepIntervalSeconds: 30
  });
  assert.equal(wfDay10.calendarDay, 10);
  assert.equal(wfDay10.isExpiredAfter10Days, false);

  // At +330s (11 * 30s) -> Exceeded Day 10 -> Auto-Dispose!
  const wfDispose = computeFourStepWorkflow(afterDay1Sent, [], {
    now: new Date(start.getTime() + 330_000),
    testStepIntervalSeconds: 30
  });
  assert.equal(wfDispose.calendarDay, 11);
  assert.equal(wfDispose.isExpiredAfter10Days, true);

  // Email builders annotate accelerated test mode cleanly and tag [TEST]
  const followMail = buildFollowUpEmailContent({
    report: afterDay1Sent,
    workflow: wfDay2,
    isTestMode: true,
    sandboxEmail: 'mgan@pingconmarketing.com',
    now: new Date(start.getTime() + 60_000)
  });
  assert.match(followMail.subject, /^\[TEST\]/);
  assert.match(followMail.html, /Accelerated SLA: 1 Simulated Day = 30s/i);

  const disposeMail = buildAutoDisposedEmailContent({
    report: afterDay1Sent,
    workflow: wfDispose,
    isTestMode: true,
    sandboxEmail: 'mgan@pingconmarketing.com',
    now: new Date(start.getTime() + 330_000)
  });
  assert.match(disposeMail.subject, /^\[TEST\]/);
});
