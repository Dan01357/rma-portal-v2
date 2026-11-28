import { supabase } from './supabase.js';
import { authorizeCronOrAdmin } from './cronAuth.js';
import { syncEmailRepliesInternal } from './imapReplySyncHandler.js';
import {
  createSmtpTransport,
  DEFAULT_EMAIL_RECIPIENTS,
  DEFAULT_SANDBOX_EMAIL,
  normalizeSandboxEmail
} from './smtpMailer.js';
import {
  isTrashedRecord,
  isArchivedRecord,
  isTestRecord,
  isManifestSubItem,
  extractDistinctSuppliersFromItems,
  isMixedSuppliersSummary,
  getReportManifestItems
} from '../../src/utils/rmaHelpers.js';
import {
  FOLLOW_UP_MAX_DAYS,
  DEFAULT_FOLLOWUP_CONFIG,
  normalizeTestStepIntervalSeconds,
  normalizeTimeHhmm,
  getManilaDateYmd,
  getManilaTimeHhmm,
  hasReachedManilaSchedule,
  splitEmailStringOrList,
  normalizeSupplierGroupKey,
  lookupSupplierDirectoryContact,
  computeFourStepWorkflow,
  groupReportItemsBySupplierForFollowUp,
  buildFollowUpEmailSubject,
  buildFollowUpEmailContent,
  buildAutoDisposedEmailContent
} from '../../src/utils/followUpWorkflow.js';
import {
  buildRmaAlertFilename,
  buildRmaAlertXlsxAttachment
} from '../../src/utils/rmaAlertXlsx.js';

import {
  SUPPLIER_DIRECTORY_SETTINGS_KEY,
  TEST_SUPPLIER_DIRECTORY_SETTINGS_KEY,
  normalizeSupplierDirectoryKey,
  parseSupplierDirectoryValue
} from '../../src/utils/supplierDirectoryHelpers.js';

const EMAIL_RECIPIENTS_KEY = 'email_recipients';
const EMAIL_RECIPIENTS_BY_TYPE_KEY = 'email_recipients_by_type';
const TEST_EMAIL_RECIPIENTS_KEY = 'test_email_recipients';
const TEST_EMAIL_RECIPIENTS_BY_TYPE_KEY = 'test_email_recipients_by_type';
const DAILY_FOLLOWUP_CONFIG_KEY = 'daily_followup_config';
const TEST_SANDBOX_EMAIL_KEY = 'test_sandbox_email';
const SUPPLIER_DIRECTORY_KEY = SUPPLIER_DIRECTORY_SETTINGS_KEY;

function normalizeDirKey(name) {
  return normalizeSupplierDirectoryKey(name);
}

function buildDirectoryLookupMap(rawDir) {
  const map = new Map();
  const list = parseSupplierDirectoryValue(rawDir);
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const k = normalizeDirKey(entry.supplier_name || entry.supplierName);
    if (!k) continue;
    map.set(k, {
      emailToList: splitEmailStringOrList(entry.email_to || entry.supplier_email_to || ''),
      emailCcList: splitEmailStringOrList(entry.email_cc || entry.supplier_email_cc || '')
    });
  }
  return map;
}

export async function safeUpdateRmaReport(reportId, updates, db = supabase) {
  const currentUpdates = { ...updates };
  const maxAttempts = Object.keys(currentUpdates).length + 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data, error } = await db
      .from('rma_reports')
      .update(currentUpdates)
      .eq('id', reportId)
      .select();

    if (!error) {
      return Array.isArray(data) && data.length > 0 ? data[0] : null;
    }

    const msg = String(error.message || '');
    const colMatch = msg.match(/Could not find the '([^']+)' column/i)
      || msg.match(/column (?:rma_reports\.)?([a-zA-Z0-9_]+) does not exist/i);

    let modified = false;
    if (colMatch && colMatch[1] && Object.prototype.hasOwnProperty.call(currentUpdates, colMatch[1])) {
      delete currentUpdates[colMatch[1]];
      modified = true;
    }
    if (msg.includes('rma_reports_status_check') && currentUpdates.status && currentUpdates.status !== 'under_inspection') {
      currentUpdates.status = 'under_inspection';
      modified = true;
    }

    if (!modified) {
      throw error;
    }
  }

  return null;
}

/**
 * Handles automated & manual 10-Calendar-Day Pickup Follow-Up emails and Auto-Dispose (>10 days).
 * Invoked via /api/send-email?action=daily-followup to stay within Vercel's 12-function cap.
 */
export async function handleDailyFollowUp(req, res, preParsedBody = null, deps = {}) {
  const db = deps.supabaseClient || supabase;
  const authorize = deps.authorizeCronOrAdmin || authorizeCronOrAdmin;
  const createSmtp = deps.createSmtpTransport || createSmtpTransport;
  const syncReplies = deps.syncEmailRepliesInternal || syncEmailRepliesInternal;

  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const auth = await authorize(req);
  if (!auth.authorized) {
    return res.status(auth.status).json({
      error: auth.error,
      message: auth.message
    });
  }

  const body = (preParsedBody && typeof preParsedBody === 'object')
    ? preParsedBody
    : (typeof req.body === 'string'
        ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
        : (req.body || {}));

  const operation = String(body.operation || req.query?.operation || 'run_all').trim().toLowerCase();
  const targetRmaNumber = String(body.rmaNumber || req.query?.rmaNumber || '').trim();
  const isTestMode =
    auth.callerType !== 'cron' &&
    Boolean(
      body.isTestMode === true ||
      body.isTestMode === 'true' ||
      req.query?.testMode === 'true' ||
      req.query?.test === '1' ||
      targetRmaNumber.toUpperCase().startsWith('TEST-')
    );
  const alsoSyncReplies = Boolean(
    req.query?.syncReplies === '1' ||
    req.query?.syncReplies === 'true' ||
    body.syncReplies === true
  );
  const force = Boolean(
    body.force === true ||
    body.force === 'true' ||
    req.query?.force === 'true' ||
    req.query?.force === '1'
  );
  const dryRun = Boolean(
    body.dryRun === true ||
    body.dryRun === 'true' ||
    req.query?.dryRun === 'true' ||
    req.query?.dryRun === '1'
  );
  const respectSchedule = Boolean(
    body.respectSchedule === true ||
    body.respectSchedule === 'true' ||
    req.query?.respectSchedule === 'true' ||
    req.query?.respectSchedule === '1'
  );

  const nowDate = deps.now instanceof Date ? deps.now : new Date();
  const nowIso = nowDate.toISOString();
  const todayManila = getManilaDateYmd(nowDate);
  const currentHhmm = getManilaTimeHhmm(nowDate);

  // 1. Load configuration from rma_settings
  const settingsMap = new Map();
  try {
    const { data: settingsRows } = await db
      .from('rma_settings')
      .select('key, value')
      .in('key', [
        EMAIL_RECIPIENTS_KEY,
        EMAIL_RECIPIENTS_BY_TYPE_KEY,
        TEST_EMAIL_RECIPIENTS_KEY,
        TEST_EMAIL_RECIPIENTS_BY_TYPE_KEY,
        DAILY_FOLLOWUP_CONFIG_KEY,
        TEST_SANDBOX_EMAIL_KEY,
        SUPPLIER_DIRECTORY_KEY,
        TEST_SUPPLIER_DIRECTORY_SETTINGS_KEY
      ]);

    if (Array.isArray(settingsRows)) {
      for (const row of settingsRows) {
        if (row?.key) settingsMap.set(row.key, row.value);
      }
    }
  } catch (err) {
    console.warn('[dailyFollowUpHandler] Failed to read rma_settings:', err?.message);
  }

  const sandboxEmail = normalizeSandboxEmail(
    body.sandboxEmail || settingsMap.get(TEST_SANDBOX_EMAIL_KEY) || DEFAULT_SANDBOX_EMAIL
  );

  const rawFollowUpCfg = settingsMap.get(DAILY_FOLLOWUP_CONFIG_KEY);
  const followUpConfig = {
    ...DEFAULT_FOLLOWUP_CONFIG,
    ...(rawFollowUpCfg && typeof rawFollowUpCfg === 'object' ? rawFollowUpCfg : {})
  };
  const autoEnabled = followUpConfig.autoEnabled !== false;
  const targetTimePht = normalizeTimeHhmm(followUpConfig.autoSendTimePht, '13:00');
  const customerFollowUpDefaultEnabled = Number(followUpConfig.defaultPolicyVersion || 0) >= 2
    ? followUpConfig.customerFollowUpDefaultEnabled !== false
    : true;
  const testStepIntervalSeconds = normalizeTestStepIntervalSeconds(
    followUpConfig.testStepIntervalSeconds ?? DEFAULT_FOLLOWUP_CONFIG.testStepIntervalSeconds
  );
  const testAutoCronEnabled = Boolean(followUpConfig.testAutoCronEnabled) && testStepIntervalSeconds > 0;

  let replySyncSummary = null;
  if (alsoSyncReplies && !dryRun) {
    try {
      replySyncSummary = await syncReplies({
        triggerSource: auth.callerType === 'cron' ? 'cron_followup_sweep' : 'admin_followup',
        caller: auth.actor
      });
    } catch (syncErr) {
      replySyncSummary = { success: false, error: syncErr?.message || 'Reply sync failed' };
    }
  }

  let liveSkipReason = null;
  if (respectSchedule && operation === 'run_all' && !force) {
    if (!autoEnabled) {
      liveSkipReason = 'AUTO_DISABLED';
    } else if (!hasReachedManilaSchedule(targetTimePht, nowDate)) {
      liveSkipReason = 'BEFORE_SCHEDULED_TIME';
    }
  }

  // Cron requests skip Live Lane if before 13:00 PHT or disabled, EXCEPT when Test Sandbox Auto-Cron is enabled with an accelerated speed
  const runLiveLane = auth.callerType === 'cron'
    ? !liveSkipReason
    : !isTestMode && !liveSkipReason;
  const runTestLane = auth.callerType === 'cron'
    ? testAutoCronEnabled
    : isTestMode && !liveSkipReason;

  if (!runLiveLane && !runTestLane && liveSkipReason) {
    return res.status(200).json({
      success: true,
      skipped: true,
      reason: liveSkipReason,
      phtDate: todayManila,
      phtTime: currentHhmm,
      targetTimePht,
      testStepIntervalSeconds,
      testAutoCronEnabled,
      ...(replySyncSummary ? { emailReplySync: replySyncSummary } : {})
    });
  }

  // 2. Resolve recipient profiles
  const legacyRecipients = settingsMap.get(EMAIL_RECIPIENTS_KEY);
  const recipientsByType = settingsMap.get(EMAIL_RECIPIENTS_BY_TYPE_KEY);
  const defaultTo = Array.isArray(DEFAULT_EMAIL_RECIPIENTS?.to) ? DEFAULT_EMAIL_RECIPIENTS.to : [];
  const defaultCc = Array.isArray(DEFAULT_EMAIL_RECIPIENTS?.cc) ? DEFAULT_EMAIL_RECIPIENTS.cc : [];

  const newRmaProfile = recipientsByType?.new_rma || legacyRecipients || {};
  const rawNewRmaTo = splitEmailStringOrList(newRmaProfile?.to ?? newRmaProfile?.toList ?? newRmaProfile?.toEmail);
  const newRmaToList = rawNewRmaTo.length > 0 ? rawNewRmaTo : splitEmailStringOrList(defaultTo);
  const rawNewRmaCc = splitEmailStringOrList(newRmaProfile?.cc ?? newRmaProfile?.ccList ?? newRmaProfile?.baseCcList);
  const newRmaCcList = (rawNewRmaCc.length > 0 || rawNewRmaTo.length > 0 ? rawNewRmaCc : splitEmailStringOrList(defaultCc))
    .filter((e) => !newRmaToList.includes(e));

  const rmaScrappedProfile = recipientsByType?.rma_scrapped || {};
  const rmaScrappedTo = splitEmailStringOrList(rmaScrappedProfile?.to ?? rmaScrappedProfile?.toList ?? rmaScrappedProfile?.toEmail);
  const rmaScrappedCc = splitEmailStringOrList(rmaScrappedProfile?.cc ?? rmaScrappedProfile?.ccList);

  const followUpProfile = recipientsByType?.supplier_followup || {};
  const followUpProfileTo = splitEmailStringOrList(followUpProfile?.to ?? followUpProfile?.toList ?? followUpProfile?.toEmail);
  const followUpProfileCc = splitEmailStringOrList(followUpProfile?.cc ?? followUpProfile?.ccList);
  const liveDirectoryMap = buildDirectoryLookupMap(settingsMap.get(SUPPLIER_DIRECTORY_KEY));
  const testDirectoryMap = buildDirectoryLookupMap(settingsMap.get(TEST_SUPPLIER_DIRECTORY_SETTINGS_KEY));

  // Helper: collect all known external supplier emails for a report so scrap/auto-dispose emails NEVER reach suppliers
  const collectReportSupplierEmailsSet = (report, allRows = [], catalogProducts = [], activeDirMap = null) => {
    const blocked = new Set();
    const addRaw = (raw) => splitEmailStringOrList(raw).forEach((e) => blocked.add(e));
    const addFromRow = (row) => {
      if (!row) return;
      addRaw(row.supplier_email_to);
      addRaw(row.supplier_email_cc);
      const rMeta = (row.ai_document_metadata && typeof row.ai_document_metadata === 'object')
        ? row.ai_document_metadata
        : {};
      const rPickup = (rMeta.supplier_pickup && typeof rMeta.supplier_pickup === 'object') ? rMeta.supplier_pickup : {};
      const rFu = (rMeta.follow_up && typeof rMeta.follow_up === 'object') ? rMeta.follow_up : {};
      addRaw(rPickup.supplier_email_to);
      addRaw(rPickup.supplier_email_cc);
      addRaw(rFu.supplier_email_to);
      addRaw(rFu.supplier_email_cc);
      if (rFu.by_supplier && typeof rFu.by_supplier === 'object') {
        Object.values(rFu.by_supplier).forEach((ent) => {
          addRaw(ent?.supplier_email_to);
          addRaw(ent?.supplier_email_cc);
        });
      }
      if (rFu.item_emails && typeof rFu.item_emails === 'object') {
        Object.values(rFu.item_emails).forEach((ent) => {
          addRaw(ent?.supplier_email_to);
          addRaw(ent?.supplier_email_cc);
        });
      }
      getReportManifestItems(row, allRows).forEach((it) => {
        addRaw(it?.supplier_email_to);
        addRaw(it?.supplier_email_cc);
      });
    };
    addFromRow(report);
    (allRows || []).forEach(addFromRow);
    [activeDirMap, liveDirectoryMap, testDirectoryMap].forEach((dMap) => {
      if (!dMap) return;
      dMap.forEach((dirHit) => {
        (dirHit.emailToList || []).forEach((e) => blocked.add(e));
        (dirHit.emailCcList || []).forEach((e) => blocked.add(e));
      });
    });
    return blocked;
  };

  // Isolated Test Mode recipient profiles (never leaks Live recipients or Live defaults)
  const testGlobalRecipients = settingsMap.get(TEST_EMAIL_RECIPIENTS_KEY);
  const testRecipientsByType = (settingsMap.get(TEST_EMAIL_RECIPIENTS_BY_TYPE_KEY) && typeof settingsMap.get(TEST_EMAIL_RECIPIENTS_BY_TYPE_KEY) === 'object')
    ? settingsMap.get(TEST_EMAIL_RECIPIENTS_BY_TYPE_KEY)
    : {};
  const resolveTestRecipients = (profileKey, { overrideTo = [], overrideCc = [] } = {}) => {
    const prof = testRecipientsByType?.[profileKey] || {};
    const profTo = splitEmailStringOrList(prof?.toList ?? prof?.toEmail ?? prof?.to);
    const profCc = splitEmailStringOrList(prof?.ccList ?? prof?.cc);
    const globTo = splitEmailStringOrList(testGlobalRecipients?.toList ?? testGlobalRecipients?.toEmail);
    const globCc = splitEmailStringOrList(testGlobalRecipients?.baseCcList ?? testGlobalRecipients?.ccList);

    const toList = overrideTo.length > 0
      ? overrideTo
      : profTo.length > 0
        ? profTo
        : globTo.length > 0
          ? globTo
          : [sandboxEmail];
    const ccSource = overrideTo.length > 0
      ? overrideCc
      : profTo.length > 0
        ? profCc
        : globTo.length > 0
          ? globCc
          : [];
    const ccList = Array.from(new Set(ccSource)).filter((e) => !toList.includes(e));
    return { toList, ccList };
  };

  // 3. Prepare SMTP transport if sending real emails
  let transporter = null;
  let smtpUser = String(process.env.SMTP_USER || process.env.GMAIL_USER || 'finance2@keysysincorporated.com').trim();
  if (!dryRun) {
    const smtp = createSmtp() || {};
    if (!smtp.configured || !smtp.transporter) {
      return res.status(500).json({
        error: 'SMTP_NOT_CONFIGURED',
        message: 'Server email credentials (GMAIL_USER / GMAIL_APP_PASSWORD) are missing.'
      });
    }
    transporter = smtp.transporter;
    smtpUser = smtp.smtpUser || smtpUser;
  }

  // 4. Fetch reports (targeted single-RMA lookup when rmaNumber is specified) + catalog products
  const buildReportsQuery = () => {
    const q = db.from('rma_reports').select('*');
    if (targetRmaNumber) {
      return q.ilike('rma_number', targetRmaNumber);
    }
    return q.order('created_at', { ascending: false });
  };

  const [reportsRes, productsRes] = await Promise.all([
    buildReportsQuery(),
    db
      .from('products')
      .select('*')
  ]);

  if (reportsRes.error) {
    return res.status(500).json({
      error: 'DB_QUERY_FAILED',
      message: reportsRes.error.message || 'Failed to query rma_reports'
    });
  }

  let allRows = Array.isArray(reportsRes.data) ? reportsRes.data : [];
  if (targetRmaNumber && allRows.length > 0) {
    const parentIds = allRows.map((r) => r.id).filter(Boolean);
    if (parentIds.length > 0) {
      const { data: childRows } = await db
        .from('rma_reports')
        .select('*')
        .in('parent_rma_id', parentIds);
      if (Array.isArray(childRows) && childRows.length > 0) {
        const seen = new Set(allRows.map((r) => r.id));
        for (const c of childRows) {
          if (!seen.has(c.id)) allRows.push(c);
        }
      }
    }
  }
  const catalogProducts = Array.isArray(productsRes.data) ? productsRes.data : [];

  const activeRows = allRows.filter((r) => !isTrashedRecord(r) && !isArchivedRecord(r));

  const followUpsSent = [];
  const autoDisposed = [];
  const skippedItems = [];
  const errors = [];

  const executeFollowUpLane = async (laneIsTestMode) => {
    const laneStepSeconds = laneIsTestMode ? testStepIntervalSeconds : 0;
    const candidates = activeRows.filter((r) => {
      if (isManifestSubItem(r, activeRows)) return false;
      if (targetRmaNumber) {
        const matchesNum = String(r.rma_number || '').trim().toUpperCase() === targetRmaNumber.toUpperCase();
        if (!matchesNum) return false;
        if (auth.callerType === 'cron') return Boolean(isTestRecord(r)) === Boolean(laneIsTestMode);
        return true;
      }
      return Boolean(isTestRecord(r)) === Boolean(laneIsTestMode);
    });

    for (const report of candidates) {
      const rmaNumber = report.rma_number || String(report.id);
      const effectiveTestRecord = Boolean(laneIsTestMode || isTestRecord(report));
      const activeDirRaw = settingsMap.get(effectiveTestRecord ? TEST_SUPPLIER_DIRECTORY_SETTINGS_KEY : SUPPLIER_DIRECTORY_KEY);
      const activeDirMap = effectiveTestRecord ? testDirectoryMap : liveDirectoryMap;

      const wf = computeFourStepWorkflow(report, catalogProducts, {
        now: nowDate,
        customerFollowUpDefaultEnabled,
        testStepIntervalSeconds: effectiveTestRecord ? laneStepSeconds : 0,
        directory: activeDirRaw
      });

      const supplierGroups = groupReportItemsBySupplierForFollowUp(report, activeRows, catalogProducts, {
        now: nowDate,
        customerFollowUpDefaultEnabled,
        testStepIntervalSeconds: effectiveTestRecord ? laneStepSeconds : 0,
        directory: activeDirRaw
      });
      const openGroups = supplierGroups.filter((g) => !g.workflow.isClosed);

      if (wf.isClosed || (supplierGroups.length > 0 && openGroups.length === 0)) {
        if (targetRmaNumber) {
          skippedItems.push({ rmaNumber, reason: 'CASE_ALREADY_CLOSED' });
        }
        continue;
      }

      // Check Auto-Dispose (> 10 days or > 10 simulated intervals in accelerated Test Mode) first
      const shouldAutoDispose = !wf.isAutoDisposed && (
        wf.isExpiredAfter10Days ||
        (openGroups.length > 0 && openGroups.every((g) => g.workflow.isExpiredAfter10Days))
      );
      if (shouldAutoDispose) {
        const existingMeta = (report.ai_document_metadata && typeof report.ai_document_metadata === 'object')
          ? report.ai_document_metadata
          : {};
        const prevFollowUp = (existingMeta.follow_up && typeof existingMeta.follow_up === 'object')
          ? existingMeta.follow_up
          : {};

        const nextBySupDispose = (prevFollowUp.by_supplier && typeof prevFollowUp.by_supplier === 'object')
          ? { ...prevFollowUp.by_supplier }
          : {};
        supplierGroups.forEach((g) => {
          if (!g.workflow.isClosed) {
            nextBySupDispose[g.supplierKey] = {
              ...(nextBySupDispose[g.supplierKey] || {}),
              supplier_name: g.supplierName,
              auto_disposed_at: nowIso,
              case_closed_at: nowIso,
              case_status: 'auto_disposed_after_10_days'
            };
          }
        });

        const nextMeta = {
          ...existingMeta,
          workflow_resolution: 'scrapped_no_reorder',
          resolved_at: nowIso,
          simple_rtv_disposition: '5- Scrap / Dispose',
          follow_up: {
            ...prevFollowUp,
            enabled: false,
            started_at: wf.startedAtIso,
            auto_disposed_at: nowIso,
            case_closed_at: nowIso,
            case_status: 'auto_disposed_after_10_days',
            ...(Object.keys(nextBySupDispose).length > 0 ? { by_supplier: nextBySupDispose } : {})
          }
        };

        const simDisposeSuffix = wf.isAcceleratedTestSla
          ? ` [Simulated >10 Days @ ${wf.testStepIntervalSeconds}s/day]`
          : '';
        const existingAudit = Array.isArray(report.audit_trail) ? report.audit_trail : [];
        const nextAudit = [
          ...existingAudit,
          {
            timestamp: nowIso,
            action: 'AUTO_DISPOSED_AFTER_10_DAYS',
            stage: 'RESOLVED',
            actor: auth.actor || '10-Day SLA Auto-Dispose',
            note: `Auto-disposed on ${todayManila} after >${FOLLOW_UP_MAX_DAYS} ${wf.isAcceleratedTestSla ? 'simulated ' : 'calendar '}days (${wf.calendarDay} days elapsed without pickup)${simDisposeSuffix}`
          }
        ];

        const updatedReportPreview = {
          ...report,
          status: 'resolved',
          disposition: '5- Scrap / Dispose',
          warehouse_location: 'Disposal / Scrap Area',
          ai_document_metadata: nextMeta,
          updated_at: nowIso,
          audit_trail: nextAudit
        };

        // Strictly internal employee recipients ONLY — never send Auto-Dispose / Scrap notices to external suppliers
        const blockedSupplierEmails = collectReportSupplierEmailsSet(report, activeRows, catalogProducts, activeDirMap);
        const testScrappedProf = effectiveTestRecord ? (testRecipientsByType?.rma_scrapped || {}) : {};
        const testHasCustomScrapped = effectiveTestRecord && Boolean(
          splitEmailStringOrList(testScrappedProf?.toList ?? testScrappedProf?.toEmail ?? testScrappedProf?.to).length > 0
        );
        const testDisposeRec = effectiveTestRecord
          ? resolveTestRecipients(testHasCustomScrapped ? 'rma_scrapped' : 'new_rma')
          : null;

        const rawDisposeTo = effectiveTestRecord
          ? testDisposeRec.toList
          : (rmaScrappedTo.length > 0 ? rmaScrappedTo : newRmaToList);
        const rawDisposeCc = effectiveTestRecord
          ? testDisposeRec.ccList
          : Array.from(new Set([
              ...(rmaScrappedCc.length > 0 || rmaScrappedTo.length > 0 ? rmaScrappedCc : newRmaCcList),
              ...(wf.party.aeEmail ? [wf.party.aeEmail] : [])
            ]));

        const safeToFiltered = rawDisposeTo.filter((e) => !blockedSupplierEmails.has(e));
        const finalTo = safeToFiltered.length > 0
          ? safeToFiltered
          : (effectiveTestRecord
              ? [sandboxEmail].filter((e) => !blockedSupplierEmails.has(e) || e === sandboxEmail)
              : (newRmaToList.filter((e) => !blockedSupplierEmails.has(e)).length > 0
                  ? newRmaToList.filter((e) => !blockedSupplierEmails.has(e))
                  : splitEmailStringOrList(defaultTo).filter((e) => !blockedSupplierEmails.has(e))));
        const finalCc = rawDisposeCc.filter((e) => !blockedSupplierEmails.has(e) && !finalTo.includes(e));

        const emailPayload = buildAutoDisposedEmailContent({
          report: updatedReportPreview,
          allReports: activeRows,
          catalogProducts,
          workflow: wf,
          actualRecipients: { toList: finalTo, ccList: finalCc },
          isTestMode: effectiveTestRecord,
          sandboxEmail,
          now: nowDate
        });

        try {
          if (!dryRun) {
            await safeUpdateRmaReport(report.id, {
              status: 'resolved',
              disposition: '5- Scrap / Dispose',
              warehouse_location: 'Disposal / Scrap Area',
              ai_document_metadata: nextMeta,
              audit_trail: nextAudit
            }, db);

            try {
              await db
                .from('rma_reports')
                .update({
                  status: 'resolved',
                  disposition: '5- Scrap / Dispose',
                  warehouse_location: 'Disposal / Scrap Area'
                })
                .eq('parent_rma_id', report.id);
            } catch {}

            if (finalTo.length > 0 && transporter) {
              await transporter.sendMail({
                from: `Pingcon Marketing RMA <${smtpUser}>`,
                to: finalTo.join(', '),
                ...(finalCc.length > 0 ? { cc: finalCc.join(', ') } : {}),
                subject: emailPayload.subject,
                html: emailPayload.html,
                text: emailPayload.text
              });
            }
          }

          autoDisposed.push({
            rmaNumber,
            supplierName: wf.party.supplierName,
            calendarDay: wf.calendarDay,
            isAcceleratedTestSla: wf.isAcceleratedTestSla,
            testStepIntervalSeconds: wf.testStepIntervalSeconds,
            to: finalTo,
            cc: finalCc,
            subject: emailPayload.subject,
            dryRun
          });
        } catch (err) {
          errors.push({ rmaNumber, step: 'auto_dispose', message: err?.message || 'Failed auto-dispose' });
        }
        continue;
      }

      if (operation === 'check_dispose_only') {
        continue;
      }

      // Always merge saved `new_rma` internal recipients + `supplier_followup` ("Extra Internal CCs") in BOTH Live & Test Modes
      const overrideTo = splitEmailStringOrList(body.overrideToEmail ?? body.overrideTo ?? body.to);
      const overrideCc = splitEmailStringOrList(body.overrideCcEmail ?? body.overrideCc ?? body.cc);
      const explicitTestOverride = Boolean(effectiveTestRecord && body.isTestModeExplicitRecipients);
      const explicitTestTo = explicitTestOverride ? splitEmailStringOrList(body.toList ?? body.to) : overrideTo;
      const explicitTestCc = explicitTestOverride ? splitEmailStringOrList(body.ccList ?? body.cc) : overrideCc;

      const testFollowUpProf = testRecipientsByType?.supplier_followup || {};
      const testNewRmaProf = testRecipientsByType?.new_rma || {};
      const testGlobalTo = splitEmailStringOrList(testGlobalRecipients?.toList ?? testGlobalRecipients?.toEmail);
      const testGlobalCc = splitEmailStringOrList(testGlobalRecipients?.baseCcList ?? testGlobalRecipients?.ccList);

      const testMergedInternalTo = Array.from(new Set([
        ...splitEmailStringOrList(testFollowUpProf?.toList ?? testFollowUpProf?.toEmail ?? testFollowUpProf?.to),
        ...splitEmailStringOrList(testNewRmaProf?.toList ?? testNewRmaProf?.toEmail ?? testNewRmaProf?.to)
      ]));
      const testInternalTo = testMergedInternalTo.length > 0
        ? testMergedInternalTo
        : (testGlobalTo.length > 0 ? testGlobalTo : [sandboxEmail]);
      const testInternalCc = Array.from(new Set([
        ...splitEmailStringOrList(testFollowUpProf?.ccList ?? testFollowUpProf?.cc),
        ...splitEmailStringOrList(testNewRmaProf?.ccList ?? testNewRmaProf?.cc),
        ...testGlobalCc
      ]));

      const liveInternalTo = Array.from(new Set([
        ...followUpProfileTo,
        ...newRmaToList
      ]));
      const liveInternalCc = Array.from(new Set([
        ...followUpProfileCc,
        ...newRmaCcList,
        ...(wf.party.aeEmail ? [wf.party.aeEmail] : [])
      ]));

      const isBatchMultiSupplier = supplierGroups.length > 1 || Boolean(report.is_parent);
      const existingMeta = (report.ai_document_metadata && typeof report.ai_document_metadata === 'object')
        ? report.ai_document_metadata
        : {};
      const prevFollowUp = (existingMeta.follow_up && typeof existingMeta.follow_up === 'object')
        ? existingMeta.follow_up
        : {};
      const nextBySupplier = (prevFollowUp.by_supplier && typeof prevFollowUp.by_supplier === 'object')
        ? { ...prevFollowUp.by_supplier }
        : {};
      const existingAudit = Array.isArray(report.audit_trail) ? report.audit_trail : [];
      const nextAudit = [...existingAudit];
      let reportSentAnyGroup = false;
      let maxSentSimDay = Number(prevFollowUp.last_sent_sim_day ?? -1);
      let maxSentDay = Number(prevFollowUp.last_sent_day ?? -1);
      let totalParentSentCount = Number(prevFollowUp.sent_count || 0);
      let nextParentSimDays = Array.isArray(prevFollowUp.sent_sim_days) ? [...prevFollowUp.sent_sim_days] : [];

      for (const group of openGroups) {
        const gWf = group.workflow;

        if (!gWf.isCountdownActive || gWf.calendarDay > FOLLOW_UP_MAX_DAYS) {
          if (targetRmaNumber) {
            skippedItems.push({
              rmaNumber,
              supplierName: group.supplierName,
              reason: !gWf.followUpEnabled ? 'FOLLOW_UP_DISABLED' : 'OUTSIDE_COUNTDOWN_WINDOW'
            });
          }
          continue;
        }

        if (gWf.isAcceleratedTestSla && gWf.calendarDay === 0 && !force) {
          skippedItems.push({
            rmaNumber,
            supplierName: group.supplierName,
            reason: 'WAITING_FOR_SIMULATED_DAY_1',
            nextStepInSeconds: gWf.nextStepInSeconds
          });
          continue;
        }

        if (gWf.alreadySentToday && !force) {
          skippedItems.push({
            rmaNumber,
            supplierName: group.supplierName,
            reason: gWf.isAcceleratedTestSla ? 'ALREADY_SENT_SIMULATED_STEP' : 'ALREADY_SENT_TODAY',
            lastSentPhtDate: gWf.lastSentPhtDate,
            lastSentSimDay: gWf.lastSentSimDay
          });
          continue;
        }

        const dirContact = (!group.isUnassignedBucket && activeDirMap.get(normalizeDirKey(group.supplierName))) || null;
        const groupSupplierTo = Array.from(new Set([
          ...group.toEmails,
          ...(dirContact?.emailToList || [])
        ]));
        const groupSupplierCc = Array.from(new Set([
          ...group.ccEmails,
          ...(dirContact?.emailCcList || [])
        ])).filter((e) => !groupSupplierTo.includes(e));

        const baseInternalTo = effectiveTestRecord ? testInternalTo : liveInternalTo;
        const baseInternalCc = effectiveTestRecord ? testInternalCc : liveInternalCc;

        let finalTo = [];
        let finalCc = [];
        let internalOnly = false;

        if (explicitTestOverride && explicitTestTo.length > 0) {
          finalTo = explicitTestTo;
          finalCc = Array.from(new Set([...explicitTestCc, ...baseInternalTo, ...baseInternalCc]))
            .filter((e) => !finalTo.includes(e));
          internalOnly = groupSupplierTo.length === 0;
        } else if (overrideTo.length > 0) {
          finalTo = overrideTo;
          finalCc = Array.from(new Set([...overrideCc, ...groupSupplierCc, ...baseInternalTo, ...baseInternalCc]))
            .filter((e) => !finalTo.includes(e));
          internalOnly = groupSupplierTo.length === 0;
        } else if (groupSupplierTo.length > 0) {
          finalTo = groupSupplierTo;
          finalCc = Array.from(new Set([...groupSupplierCc, ...baseInternalTo, ...baseInternalCc]))
            .filter((e) => !finalTo.includes(e));
          internalOnly = false;
        } else {
          internalOnly = true;
          finalTo = baseInternalTo.length > 0 ? baseInternalTo : baseInternalCc;
          finalCc = baseInternalCc.filter((e) => !finalTo.includes(e));
        }

        if (finalTo.length === 0) {
          skippedItems.push({ rmaNumber, supplierName: group.supplierName, reason: 'NO_RECIPIENTS' });
          continue;
        }

        const effectiveGroup = {
          ...group,
          toEmails: groupSupplierTo,
          ccEmails: groupSupplierCc,
          supplierEmailTo: groupSupplierTo.join(', '),
          supplierEmailCc: groupSupplierCc.join(', '),
          internalOnly
        };

        const subjectForFilename = buildFollowUpEmailSubject({
          report,
          supplierName: group.supplierName,
          calendarDay: gWf.calendarDay,
          isTestMode: effectiveTestRecord,
          internalOnly,
          now: nowDate
        });
        const attachFilename = buildRmaAlertFilename(subjectForFilename, nowDate);

        const emailPayload = buildFollowUpEmailContent({
          report,
          allReports: activeRows,
          catalogProducts,
          workflow: gWf,
          supplierGroup: effectiveGroup,
          actualRecipients: { toList: finalTo, ccList: finalCc },
          internalOnly,
          attachFilename,
          isTestMode: effectiveTestRecord,
          sandboxEmail,
          now: nowDate
        });

        const xlsxAttachment = buildRmaAlertXlsxAttachment(report, {
          allReports: activeRows,
          supplierGroup: effectiveGroup,
          forceManifestTable: isBatchMultiSupplier,
          subject: emailPayload.subject,
          filename: attachFilename,
          resolvedRecipients: { toList: finalTo, ccList: finalCc }
        });

        try {
          if (!dryRun && transporter && finalTo.length > 0) {
            await transporter.sendMail({
              from: `Pingcon Marketing RMA <${smtpUser}>`,
              to: finalTo.join(', '),
              ...(finalCc.length > 0 ? { cc: finalCc.join(', ') } : {}),
              subject: emailPayload.subject,
              html: emailPayload.html,
              text: emailPayload.text,
              attachments: xlsxAttachment?.content ? [{
                filename: xlsxAttachment.filename,
                content: Buffer.from(xlsxAttachment.content, 'base64'),
                contentType: xlsxAttachment.contentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              }] : []
            });
          }

          if (!dryRun) {
            reportSentAnyGroup = true;
            const prevSupMeta = (nextBySupplier[group.supplierKey] && typeof nextBySupplier[group.supplierKey] === 'object')
              ? nextBySupplier[group.supplierKey]
              : {};
            const prevSupSimDays = Array.isArray(prevSupMeta.sent_sim_days) ? prevSupMeta.sent_sim_days : [];
            const sameSupSimCfg = Number(prevSupMeta.last_sent_sim_interval_sec || 0) === gWf.testStepIntervalSeconds;
            const nextSupSimDays = gWf.isAcceleratedTestSla
              ? Array.from(new Set([...(sameSupSimCfg ? prevSupSimDays : []), gWf.calendarDay])).slice(-15)
              : prevSupSimDays;

            nextBySupplier[group.supplierKey] = {
              ...prevSupMeta,
              supplier_name: group.supplierName,
              supplier_key: group.supplierKey,
              supplier_email_to: groupSupplierTo.join(', '),
              supplier_email_cc: groupSupplierCc.join(', '),
              line_refs: group.parentLineRefs,
              enabled: true,
              started_at: gWf.startedAtIso,
              last_sent_at: nowIso,
              last_sent_pht_date: todayManila,
              last_sent_day: gWf.calendarDay,
              ...(gWf.isAcceleratedTestSla ? {
                last_sent_sim_day: gWf.calendarDay,
                last_sent_sim_interval_sec: gWf.testStepIntervalSeconds,
                sent_sim_days: nextSupSimDays
              } : {}),
              sent_count: Number(prevSupMeta.sent_count || 0) + 1
            };

            maxSentDay = Math.max(maxSentDay, gWf.calendarDay);
            if (gWf.isAcceleratedTestSla) {
              maxSentSimDay = Math.max(maxSentSimDay, gWf.calendarDay);
              const sameParentSimCfg = Number(prevFollowUp.last_sent_sim_interval_sec || 0) === gWf.testStepIntervalSeconds;
              nextParentSimDays = Array.from(new Set([...(sameParentSimCfg ? nextParentSimDays : []), gWf.calendarDay])).slice(-15);
            }
            totalParentSentCount += 1;

            const simNoteTag = gWf.isAcceleratedTestSla
              ? ` [Simulated @ ${gWf.testStepIntervalSeconds}s/day]`
              : '';
            nextAudit.push({
              timestamp: nowIso,
              action: 'FOLLOWUP_EMAIL_SENT',
              stage: 'FOLLOW_UP',
              actor: auth.actor || 'Daily Follow-Up Scheduler',
              note: `Sent Day ${gWf.calendarDay} of ${FOLLOW_UP_MAX_DAYS} follow-up (${group.supplierName}${internalOnly ? ' — Internal Reminder' : ''}) to ${finalTo.join(', ')}${finalCc.length ? ` (CC: ${finalCc.join(', ')})` : ''}${simNoteTag}`
            });
          }

          followUpsSent.push({
            rmaNumber,
            supplierKey: group.supplierKey,
            supplierName: group.supplierName,
            lineRefs: group.parentLineRefs,
            internalOnly,
            attachmentFilename: xlsxAttachment.filename,
            calendarDay: gWf.calendarDay,
            isAcceleratedTestSla: gWf.isAcceleratedTestSla,
            testStepIntervalSeconds: gWf.testStepIntervalSeconds,
            to: finalTo,
            cc: finalCc,
            subject: emailPayload.subject,
            dryRun
          });
        } catch (err) {
          errors.push({
            rmaNumber,
            supplierName: group.supplierName,
            step: 'send_followup',
            message: err?.message || 'Failed sending follow-up'
          });
        }
      }

      if (!dryRun && reportSentAnyGroup) {
        const nextMeta = {
          ...existingMeta,
          follow_up: {
            ...prevFollowUp,
            enabled: true,
            started_at: wf.startedAtIso,
            last_sent_at: nowIso,
            last_sent_pht_date: todayManila,
            last_sent_day: maxSentDay >= 0 ? maxSentDay : wf.calendarDay,
            ...(wf.isAcceleratedTestSla ? {
              last_sent_sim_day: maxSentSimDay >= 0 ? maxSentSimDay : wf.calendarDay,
              last_sent_sim_interval_sec: wf.testStepIntervalSeconds,
              sent_sim_days: nextParentSimDays
            } : {}),
            sent_count: totalParentSentCount,
            by_supplier: nextBySupplier
          }
        };

        await safeUpdateRmaReport(report.id, {
          ai_document_metadata: nextMeta,
          audit_trail: nextAudit
        }, db);
      }
    }

    return candidates.length;
  };

  let candidatesScanned = 0;
  if (runLiveLane) {
    candidatesScanned += await executeFollowUpLane(false);
  }
  if (runTestLane) {
    candidatesScanned += await executeFollowUpLane(true);
  }

  return res.status(200).json({
    success: errors.length === 0,
    ...(errors.length > 0 ? {
      error: `${errors[0]?.rmaNumber ? `${errors[0].rmaNumber}: ` : ''}${errors[0]?.message || 'Failed processing follow-up tick.'}${errors.length > 1 ? ` (+${errors.length - 1} more error(s))` : ''}`
    } : {}),
    dryRun,
    skipped: false,
    ...(liveSkipReason ? { liveSkipped: true, liveSkipReason } : {}),
    operation,
    phtDate: todayManila,
    phtTime: currentHhmm,
    targetTimePht,
    isTestMode: Boolean(isTestMode || (runTestLane && !runLiveLane)),
    testStepIntervalSeconds,
    testAutoCronEnabled,
    sandboxEmail,
    caller: auth.actor,
    summary: {
      scanned: candidatesScanned,
      followUpsSent: followUpsSent.length,
      autoDisposed: autoDisposed.length,
      skippedCount: skippedItems.length,
      errorCount: errors.length
    },
    followUpsSent,
    autoDisposed,
    skippedItems,
    errors,
    ...(replySyncSummary ? { emailReplySync: replySyncSummary } : {})
  });
}
