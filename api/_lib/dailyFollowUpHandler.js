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
  isMixedSuppliersSummary
} from '../../src/utils/rmaHelpers.js';
import {
  FOLLOW_UP_MAX_DAYS,
  DEFAULT_FOLLOWUP_CONFIG,
  normalizeTimeHhmm,
  getManilaDateYmd,
  getManilaTimeHhmm,
  hasReachedManilaSchedule,
  splitEmailStringOrList,
  computeFourStepWorkflow,
  buildFollowUpEmailContent,
  buildAutoDisposedEmailContent
} from '../../src/utils/followUpWorkflow.js';

const EMAIL_RECIPIENTS_KEY = 'email_recipients';
const EMAIL_RECIPIENTS_BY_TYPE_KEY = 'email_recipients_by_type';
const TEST_EMAIL_RECIPIENTS_KEY = 'test_email_recipients';
const TEST_EMAIL_RECIPIENTS_BY_TYPE_KEY = 'test_email_recipients_by_type';
const DAILY_FOLLOWUP_CONFIG_KEY = 'daily_followup_config';
const TEST_SANDBOX_EMAIL_KEY = 'test_sandbox_email';
const SUPPLIER_DIRECTORY_KEY = 'supplier_directory_store';

function normalizeDirKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildDirectoryLookupMap(rawDir) {
  const map = new Map();
  if (!Array.isArray(rawDir)) return map;
  for (const entry of rawDir) {
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

async function safeUpdateRmaReport(reportId, updates) {
  let { data, error } = await supabase
    .from('rma_reports')
    .update(updates)
    .eq('id', reportId)
    .select();

  if (error) {
    const fallback = { ...updates };
    if (String(error.message || '').includes('rma_reports_status_check') && fallback.status) {
      fallback.status = 'under_inspection';
    }
    const retry = await supabase
      .from('rma_reports')
      .update(fallback)
      .eq('id', reportId)
      .select();
    if (retry.error) throw retry.error;
    data = retry.data;
  }

  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

/**
 * Handles automated & manual 10-Calendar-Day Pickup Follow-Up emails and Auto-Dispose (>10 days).
 * Invoked via /api/send-email?action=daily-followup to stay within Vercel's 12-function cap.
 */
export async function handleDailyFollowUp(req, res, preParsedBody = null) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const auth = await authorizeCronOrAdmin(req);
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

  const nowDate = new Date();
  const nowIso = nowDate.toISOString();
  const todayManila = getManilaDateYmd(nowDate);
  const currentHhmm = getManilaTimeHhmm(nowDate);

  // 1. Load configuration from rma_settings
  const settingsMap = new Map();
  try {
    const { data: settingsRows } = await supabase
      .from('rma_settings')
      .select('key, value')
      .in('key', [
        EMAIL_RECIPIENTS_KEY,
        EMAIL_RECIPIENTS_BY_TYPE_KEY,
        TEST_EMAIL_RECIPIENTS_KEY,
        TEST_EMAIL_RECIPIENTS_BY_TYPE_KEY,
        DAILY_FOLLOWUP_CONFIG_KEY,
        TEST_SANDBOX_EMAIL_KEY,
        SUPPLIER_DIRECTORY_KEY
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

  let replySyncSummary = null;
  if (alsoSyncReplies && !dryRun) {
    try {
      replySyncSummary = await syncEmailRepliesInternal({
        triggerSource: auth.callerType === 'cron' ? 'cron_followup_sweep' : 'admin_followup',
        caller: auth.actor
      });
    } catch (syncErr) {
      replySyncSummary = { success: false, error: syncErr?.message || 'Reply sync failed' };
    }
  }

  if (respectSchedule && operation === 'run_all' && !force) {
    if (!autoEnabled) {
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: 'AUTO_DISABLED',
        phtDate: todayManila,
        phtTime: currentHhmm,
        targetTimePht,
        ...(replySyncSummary ? { emailReplySync: replySyncSummary } : {})
      });
    }
    if (!hasReachedManilaSchedule(targetTimePht, nowDate)) {
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: 'BEFORE_SCHEDULED_TIME',
        phtDate: todayManila,
        phtTime: currentHhmm,
        targetTimePht,
        ...(replySyncSummary ? { emailReplySync: replySyncSummary } : {})
      });
    }
  }

  // 2. Resolve recipient profiles
  const legacyRecipients = settingsMap.get(EMAIL_RECIPIENTS_KEY);
  const recipientsByType = settingsMap.get(EMAIL_RECIPIENTS_BY_TYPE_KEY);
  const defaultTo = Array.isArray(DEFAULT_EMAIL_RECIPIENTS?.to) ? DEFAULT_EMAIL_RECIPIENTS.to : [];
  const defaultCc = Array.isArray(DEFAULT_EMAIL_RECIPIENTS?.cc) ? DEFAULT_EMAIL_RECIPIENTS.cc : [];

  const newRmaProfile = recipientsByType?.new_rma || legacyRecipients || {};
  const rawNewRmaTo = splitEmailStringOrList(newRmaProfile?.to);
  const newRmaToList = rawNewRmaTo.length > 0 ? rawNewRmaTo : splitEmailStringOrList(defaultTo);
  const rawNewRmaCc = splitEmailStringOrList(newRmaProfile?.cc);
  const newRmaCcList = (rawNewRmaCc.length > 0 || rawNewRmaTo.length > 0 ? rawNewRmaCc : splitEmailStringOrList(defaultCc))
    .filter((e) => !newRmaToList.includes(e));

  const followUpProfile = recipientsByType?.supplier_followup || {};
  const followUpProfileTo = splitEmailStringOrList(followUpProfile?.to ?? followUpProfile?.toList);
  const followUpProfileCc = splitEmailStringOrList(followUpProfile?.cc ?? followUpProfile?.ccList);
  const directoryMap = buildDirectoryLookupMap(settingsMap.get(SUPPLIER_DIRECTORY_KEY));

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
  const gmailUser = String(process.env.GMAIL_USER || '').trim();
  const gmailPass = String(process.env.GMAIL_APP_PASSWORD || '').trim();
  if (!dryRun) {
    if (!gmailUser || !gmailPass) {
      return res.status(500).json({
        error: 'SMTP_NOT_CONFIGURED',
        message: 'Server email credentials (GMAIL_USER / GMAIL_APP_PASSWORD) are missing.'
      });
    }
    transporter = createSmtpTransport();
  }

  // 4. Fetch reports (targeted single-RMA lookup when rmaNumber is specified) + catalog products
  const buildReportsQuery = () => {
    const q = supabase.from('rma_reports').select('*');
    if (targetRmaNumber) {
      return q.ilike('rma_number', targetRmaNumber);
    }
    return q.order('created_at', { ascending: false });
  };

  const [reportsRes, productsRes] = await Promise.all([
    buildReportsQuery(),
    supabase
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
      const { data: childRows } = await supabase
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
  const candidates = activeRows.filter((r) => {
    if (isManifestSubItem(r, activeRows)) return false;
    if (targetRmaNumber) {
      return String(r.rma_number || '').trim().toUpperCase() === targetRmaNumber.toUpperCase();
    }
    return Boolean(isTestRecord(r)) === Boolean(isTestMode);
  });

  const followUpsSent = [];
  const autoDisposed = [];
  const skippedItems = [];
  const errors = [];

  for (const report of candidates) {
    const rmaNumber = report.rma_number || String(report.id);
    const wf = computeFourStepWorkflow(report, catalogProducts, {
      now: nowDate,
      customerFollowUpDefaultEnabled
    });

    if (wf.isClosed) {
      if (targetRmaNumber) {
        skippedItems.push({ rmaNumber, reason: 'CASE_ALREADY_CLOSED' });
      }
      continue;
    }

    // Check Auto-Dispose (> 10 calendar days) first
    if (wf.isExpiredAfter10Days && !wf.isAutoDisposed) {
      const existingMeta = (report.ai_document_metadata && typeof report.ai_document_metadata === 'object')
        ? report.ai_document_metadata
        : {};
      const prevFollowUp = (existingMeta.follow_up && typeof existingMeta.follow_up === 'object')
        ? existingMeta.follow_up
        : {};

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
          case_status: 'auto_disposed_after_10_days'
        }
      };

      const existingAudit = Array.isArray(report.audit_trail) ? report.audit_trail : [];
      const nextAudit = [
        ...existingAudit,
        {
          timestamp: nowIso,
          action: 'AUTO_DISPOSED_AFTER_10_DAYS',
          stage: 'RESOLVED',
          actor: auth.actor || '10-Day SLA Auto-Dispose',
          note: `Auto-disposed on ${todayManila} after >${FOLLOW_UP_MAX_DAYS} calendar days (${wf.calendarDay} days elapsed without pickup)`
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

      const emailPayload = buildAutoDisposedEmailContent({
        report: updatedReportPreview,
        allReports: activeRows,
        catalogProducts,
        isTestMode,
        sandboxEmail,
        now: nowDate
      });

      const testDisposeRec = isTestMode ? resolveTestRecipients('new_rma') : null;
      const finalTo = isTestMode ? testDisposeRec.toList : newRmaToList;
      const finalCc = isTestMode
        ? testDisposeRec.ccList
        : Array.from(new Set([...newRmaCcList, ...(wf.party.aeEmail ? [wf.party.aeEmail] : [])]))
            .filter((e) => !finalTo.includes(e));

      try {
        if (!dryRun) {
          await safeUpdateRmaReport(report.id, {
            status: 'resolved',
            disposition: '5- Scrap / Dispose',
            warehouse_location: 'Disposal / Scrap Area',
            ai_document_metadata: nextMeta,
            updated_at: nowIso,
            audit_trail: nextAudit
          });

          try {
            await supabase
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
              from: `Pingcon Marketing RMA <${gmailUser}>`,
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

    if (!wf.isCountdownActive || wf.calendarDay > FOLLOW_UP_MAX_DAYS) {
      if (targetRmaNumber) {
        skippedItems.push({
          rmaNumber,
          reason: !wf.followUpEnabled ? 'FOLLOW_UP_DISABLED' : 'OUTSIDE_COUNTDOWN_WINDOW'
        });
      }
      continue;
    }

    if (wf.alreadySentToday && !force) {
      skippedItems.push({ rmaNumber, reason: 'ALREADY_SENT_TODAY', lastSentPhtDate: wf.lastSentPhtDate });
      continue;
    }

    const dirContact = (!isMixedSuppliersSummary(wf.party.supplierName) && directoryMap.get(normalizeDirKey(wf.party.supplierName))) || null;
    const itemSuppliers = Array.isArray(report.items) ? extractDistinctSuppliersFromItems(report.items) : [];
    const itemDirTo = [];
    const itemDirCc = [];
    const perItemTo = [];
    const perItemCc = [];
    if (Array.isArray(report.items)) {
      for (const it of report.items) {
        splitEmailStringOrList(it?.supplier_email_to ?? it?.email_to).forEach((e) => perItemTo.push(e));
        splitEmailStringOrList(it?.supplier_email_cc ?? it?.email_cc).forEach((e) => perItemCc.push(e));
      }
    }
    for (const sup of itemSuppliers) {
      const match = directoryMap.get(normalizeDirKey(sup));
      if (match) {
        match.emailToList.forEach((e) => itemDirTo.push(e));
        match.emailCcList.forEach((e) => itemDirCc.push(e));
      }
    }
    const overrideTo = splitEmailStringOrList(body.overrideToEmail);
    const aggregatedSupplierTo = Array.from(new Set([
      ...wf.party.toEmails,
      ...perItemTo,
      ...(dirContact?.emailToList || []),
      ...itemDirTo
    ]));
    const liveTo = overrideTo.length > 0
      ? overrideTo
      : (aggregatedSupplierTo.length > 0 ? aggregatedSupplierTo : followUpProfileTo);

    if (!isTestMode && liveTo.length === 0) {
      skippedItems.push({ rmaNumber, reason: 'NO_SUPPLIER_EMAIL' });
      continue;
    }

    const testFollowUpRec = isTestMode
      ? resolveTestRecipients('supplier_followup', {
          overrideTo: body.isTestModeExplicitRecipients ? splitEmailStringOrList(body.toList ?? body.to) : overrideTo,
          overrideCc: body.isTestModeExplicitRecipients ? splitEmailStringOrList(body.ccList ?? body.cc) : []
        })
      : null;

    const finalTo = isTestMode ? testFollowUpRec.toList : liveTo;
    const finalCc = isTestMode
      ? testFollowUpRec.ccList
      : Array.from(
          new Set([
            ...wf.party.ccEmails,
            ...perItemCc,
            ...(dirContact?.emailCcList || []),
            ...itemDirCc,
            ...followUpProfileTo,
            ...followUpProfileCc,
            ...(wf.party.aeEmail ? [wf.party.aeEmail] : [])
          ])
        ).filter((e) => !finalTo.includes(e));

    const emailPayload = buildFollowUpEmailContent({
      report,
      allReports: activeRows,
      catalogProducts,
      workflow: wf,
      isTestMode,
      sandboxEmail,
      now: nowDate
    });

    try {
      if (!dryRun) {
        if (transporter && finalTo.length > 0) {
          await transporter.sendMail({
            from: `Pingcon Marketing RMA <${gmailUser}>`,
            to: finalTo.join(', '),
            ...(finalCc.length > 0 ? { cc: finalCc.join(', ') } : {}),
            subject: emailPayload.subject,
            html: emailPayload.html,
            text: emailPayload.text
          });
        }

        const existingMeta = (report.ai_document_metadata && typeof report.ai_document_metadata === 'object')
          ? report.ai_document_metadata
          : {};
        const prevFollowUp = (existingMeta.follow_up && typeof existingMeta.follow_up === 'object')
          ? existingMeta.follow_up
          : {};

        const nextMeta = {
          ...existingMeta,
          follow_up: {
            ...prevFollowUp,
            enabled: true,
            started_at: wf.startedAtIso,
            last_sent_at: nowIso,
            last_sent_pht_date: todayManila,
            last_sent_day: wf.calendarDay,
            sent_count: wf.sentCount + 1
          }
        };

        const existingAudit = Array.isArray(report.audit_trail) ? report.audit_trail : [];
        const nextAudit = [
          ...existingAudit,
          {
            timestamp: nowIso,
            action: 'FOLLOWUP_EMAIL_SENT',
            stage: 'FOLLOW_UP',
            actor: auth.actor || 'Daily Follow-Up Scheduler',
            note: `Sent Day ${wf.calendarDay} of ${FOLLOW_UP_MAX_DAYS} follow-up to ${finalTo.join(', ')}${finalCc.length ? ` (CC: ${finalCc.join(', ')})` : ''}`
          }
        ];

        await safeUpdateRmaReport(report.id, {
          ai_document_metadata: nextMeta,
          updated_at: nowIso,
          audit_trail: nextAudit
        });
      }

      followUpsSent.push({
        rmaNumber,
        supplierName: wf.party.supplierName,
        calendarDay: wf.calendarDay,
        to: finalTo,
        cc: finalCc,
        subject: emailPayload.subject,
        dryRun
      });
    } catch (err) {
      errors.push({ rmaNumber, step: 'send_followup', message: err?.message || 'Failed sending follow-up' });
    }
  }

  return res.status(200).json({
    success: errors.length === 0,
    dryRun,
    skipped: false,
    operation,
    phtDate: todayManila,
    phtTime: currentHhmm,
    targetTimePht,
    isTestMode,
    sandboxEmail,
    caller: auth.actor,
    summary: {
      scanned: candidates.length,
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
