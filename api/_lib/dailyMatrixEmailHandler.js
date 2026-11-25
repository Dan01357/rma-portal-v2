import { supabase } from './supabase.js';
import { sendJson, setCorsHeaders } from './auth.js';
import { authorizeCronOrAdmin } from './cronAuth.js';
import {
  createSmtpTransport,
  formatTestEmailSubject,
  escapeEmailHtml,
  getDiagnosticHelp,
  DEFAULT_EMAIL_RECIPIENTS,
  DEFAULT_SANDBOX_EMAIL,
  normalizeSandboxEmail
} from './smtpMailer.js';
import {
  buildRmaMatrixXlsxBytes,
  toManilaDateKey,
  formatManilaHhmm,
  formatManilaTimestampDisplay
} from '../../src/utils/exportMatrixXlsx.js';
import { isTestRecord, formatSaveFileTimestamp } from '../../src/utils/rmaHelpers.js';
import {
  normalizeTimeHhmm,
  formatTime12hFromHhmm,
  hasReachedManilaSchedule,
  getManilaTimeHhmm
} from '../../src/utils/followUpWorkflow.js';

const EMAIL_RECIPIENTS_KEY = 'email_recipients';
const EMAIL_RECIPIENTS_BY_TYPE_KEY = 'email_recipients_by_type';
const DAILY_MATRIX_CONFIG_KEY = 'daily_matrix_config';
const LAST_SENT_PHT_KEY = 'daily_matrix_last_sent_pht_date';
const TEST_SANDBOX_EMAIL_KEY = 'test_sandbox_email';

function splitEmailList(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(/[,;\s]+/);
  const unique = new Set();
  for (const entry of arr) {
    const clean = String(entry || '').trim().toLowerCase();
    if (clean && clean.includes('@') && clean.includes('.') && !clean.endsWith('.test')) {
      unique.add(clean);
    }
  }
  return Array.from(unique);
}

function sanitizeYmd(val) {
  const s = String(val || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function subtractCalendarDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() - days);
  return utc.toISOString().slice(0, 10);
}

function buildDailyMatrixEmailHtml({
  dataset,
  startDate,
  endDate,
  generatedManila,
  filename,
  toEmail,
  ccList,
  isTestMode,
  triggeredBy,
  sandboxEmail = DEFAULT_SANDBOX_EMAIL,
  targetTimePht = '13:00'
}) {
  const {
    lineCount,
    monitoredSkuCount,
    grandTotalPcs,
    totalBadStockPcs,
    totalGoodStockPcs,
    grandTotalValue
  } = dataset;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
        .container { max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
        .header { background: ${isTestMode ? '#92400e' : '#065f46'}; padding: 24px 28px; color: #ffffff; }
        .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; background: rgba(255,255,255,0.2); color: #ffffff; margin-bottom: 8px; }
        .title { margin: 0; font-size: 20px; font-weight: 800; line-height: 1.3; }
        .content { padding: 26px; }
        .kpi-grid { width: 100%; border-collapse: separate; border-spacing: 8px; margin: 12px 0 18px; }
        .kpi-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 14px; text-align: center; }
        .kpi-label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.04em; }
        .kpi-val { font-size: 18px; font-weight: 900; color: #0f172a; margin-top: 4px; }
        .meta-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; font-size: 12px; line-height: 1.6; color: #334155; }
        .footer { background: #f1f5f9; padding: 14px 24px; font-size: 11px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <span class="badge">${isTestMode ? '[TEST] DAILY MATRIX SANDBOX' : `DAILY ${escapeEmailHtml(formatTime12hFromHhmm(targetTimePht))} PHT REPORT`}</span>
          <h1 class="title">${isTestMode ? '[TEST] ' : ''}Daily Overall RMA Matrix Report</h1>
          <div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">
            Customer Hub + Supplier RTV Combined Rolling Summary
          </div>
        </div>
        <div class="content">
          ${isTestMode ? `
          <div style="background: #fef3c7; border: 2px dashed #f59e0b; color: #92400e; padding: 10px 14px; border-radius: 10px; margin-bottom: 16px; font-weight: 700; font-size: 12px;">
            [TEST] Sandbox Simulation Run — Redirected exclusively to ${escapeEmailHtml(sandboxEmail)}. Live recipients bypassed.
          </div>` : ''}

          <div style="background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; padding: 12px 16px; border-radius: 10px; margin-bottom: 16px; font-size: 13px; font-weight: 700;">
            📎 Attached Excel Workbook: <span style="font-family: monospace;">${escapeEmailHtml(filename)}</span>
          </div>

          <table class="kpi-grid">
            <tr>
              <td class="kpi-box" width="33%">
                <div class="kpi-label">Line Items / SKUs</div>
                <div class="kpi-val">${lineCount.toLocaleString()} / ${monitoredSkuCount.toLocaleString()}</div>
              </td>
              <td class="kpi-box" width="33%">
                <div class="kpi-label">Total Returned Pcs</div>
                <div class="kpi-val">${grandTotalPcs.toLocaleString()}</div>
              </td>
              <td class="kpi-box" width="34%">
                <div class="kpi-label">Total Value (PHP)</div>
                <div class="kpi-val">PHP ${grandTotalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </td>
            </tr>
            <tr>
              <td class="kpi-box" colspan="3" style="text-align: left; font-size: 12px; color: #334155;">
                <strong>Stock Condition Breakdown:</strong>
                Bad Stock Returned = <strong>${totalBadStockPcs.toLocaleString()} pcs</strong> •
                Good Stock Returned = <strong>${totalGoodStockPcs.toLocaleString()} pcs</strong>
              </td>
            </tr>
          </table>

          <div class="meta-card">
            <div><strong>Reporting Window (YYYY-MM-DD):</strong> ${escapeEmailHtml(startDate)} to ${escapeEmailHtml(endDate)}</div>
            <div><strong>Generated At (Asia/Manila YYYY-MM-DD HH:mm):</strong> ${escapeEmailHtml(generatedManila)}</div>
            <div><strong>Dispatched To:</strong> <span style="font-family: monospace;">${escapeEmailHtml(toEmail)}</span></div>
            ${ccList.length > 0 ? `<div><strong>CC Recipients:</strong> <span style="font-family: monospace;">${escapeEmailHtml(ccList.join(', '))}</span></div>` : ''}
            <div><strong>Triggered By:</strong> ${escapeEmailHtml(triggeredBy)}</div>
          </div>
        </div>
        <div class="footer">
          Pingcon Marketing Operations • Automated Daily Overall RMA Matrix (.xlsx) Scheduler
        </div>
      </div>
    </body>
    </html>
  `;
}

export async function handleDailyMatrixEmail(req, res, payload = {}) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendJson(res, 405, {
      success: false,
      error: 'METHOD_NOT_ALLOWED',
      message: 'Use GET (Vercel Cron) or POST (Manual Admin Dispatch).'
    }, req);
  }

  const caller = await authorizeCronOrAdmin(req);
  if (!caller.authorized) {
    return sendJson(res, caller.status, {
      success: false,
      error: caller.error,
      message: caller.message
    }, req);
  }

  const body = (payload && typeof payload === 'object') ? payload : {};
  const force = req.query?.force === 'true' || req.query?.force === '1' || body.force === true;
  const dryRun = req.query?.dryRun === 'true' || req.query?.dryRun === '1' || body.dryRun === true;
  const respectSchedule = req.query?.respectSchedule === 'true' || req.query?.respectSchedule === '1' || body.respectSchedule === true;
  const includeAttachmentBase64 =
    req.query?.includeAttachmentBase64 === 'true' ||
    req.query?.includeAttachmentBase64 === '1' ||
    body.includeAttachmentBase64 === true;

  // Cron schedule strictly runs in Live Mode; manual admin run can explicitly request Test Sandbox
  const requestedTestMode =
    caller.callerType !== 'cron' &&
    Boolean(body.isTestMode === true || req.query?.isTestMode === 'true' || req.query?.mode === 'test');

  const todayManila = toManilaDateKey(new Date());
  const requestedStartDate = sanitizeYmd(body.startDate || req.query?.startDate);
  const requestedEndDate = sanitizeYmd(body.endDate || req.query?.endDate);
  const requestedStreamRaw = String(body.stream || req.query?.stream || '').trim();

  try {
    // 1. Read global recipients, per-type email profiles, matrix schedule config, and last daily cron marker from rma_settings
    const { data: settingsRows, error: settingsErr } = await supabase
      .from('rma_settings')
      .select('key, value')
      .in('key', [
        EMAIL_RECIPIENTS_KEY,
        EMAIL_RECIPIENTS_BY_TYPE_KEY,
        DAILY_MATRIX_CONFIG_KEY,
        LAST_SENT_PHT_KEY,
        TEST_SANDBOX_EMAIL_KEY
      ]);

    if (settingsErr) {
      return sendJson(res, 500, {
        success: false,
        error: 'SETTINGS_QUERY_FAILED',
        message: settingsErr.message
      }, req);
    }

    const settingsMap = new Map((settingsRows || []).map((row) => [row.key, row.value]));
    const savedRecipients = settingsMap.get(EMAIL_RECIPIENTS_KEY);
    const profilesByType = (settingsMap.get(EMAIL_RECIPIENTS_BY_TYPE_KEY) && typeof settingsMap.get(EMAIL_RECIPIENTS_BY_TYPE_KEY) === 'object')
      ? settingsMap.get(EMAIL_RECIPIENTS_BY_TYPE_KEY)
      : {};
    const matrixConfig = (settingsMap.get(DAILY_MATRIX_CONFIG_KEY) && typeof settingsMap.get(DAILY_MATRIX_CONFIG_KEY) === 'object')
      ? settingsMap.get(DAILY_MATRIX_CONFIG_KEY)
      : {};
    const sandboxEmail = normalizeSandboxEmail(
      body.sandboxEmail || settingsMap.get(TEST_SANDBOX_EMAIL_KEY) || DEFAULT_SANDBOX_EMAIL
    );
    const autoEnabled = matrixConfig.autoEnabled !== false;
    const targetTimePht = normalizeTimeHhmm(matrixConfig.autoSendTimePht, '13:00');
    const lastSentPhtDate = String(settingsMap.get(LAST_SENT_PHT_KEY) || '').trim();

    if (respectSchedule && !force && !dryRun && !requestedTestMode) {
      const currentPhtTime = getManilaTimeHhmm(new Date());
      if (!autoEnabled) {
        return sendJson(res, 200, {
          success: true,
          skipped: true,
          reason: 'AUTO_DISABLED',
          phtDate: todayManila,
          phtTime: currentPhtTime,
          targetTimePht
        }, req);
      }
      if (!hasReachedManilaSchedule(targetTimePht, new Date())) {
        return sendJson(res, 200, {
          success: true,
          skipped: true,
          reason: 'BEFORE_SCHEDULED_TIME',
          phtDate: todayManila,
          phtTime: currentPhtTime,
          targetTimePht
        }, req);
      }
    }

    if (!force && !dryRun && !requestedTestMode && lastSentPhtDate === todayManila) {
      return sendJson(res, 200, {
        success: true,
        skipped: true,
        reason: 'ALREADY_SENT_TODAY',
        phtDate: todayManila,
        message: `Daily Overall RMA Matrix already dispatched for Manila date ${todayManila}.`
      }, req);
    }

    // Resolve date window: explicit request override -> saved matrixConfig (custom or rollingDays) -> default 14 days
    let endDate = requestedEndDate;
    let startDate = requestedStartDate;
    if (!startDate || !endDate) {
      if (matrixConfig.rangeMode === 'custom' && sanitizeYmd(matrixConfig.startDate) && sanitizeYmd(matrixConfig.endDate)) {
        startDate = startDate || sanitizeYmd(matrixConfig.startDate);
        endDate = endDate || sanitizeYmd(matrixConfig.endDate);
      } else {
        const rollingDays = Math.max(1, Math.min(365, parseInt(matrixConfig.rollingDays, 10) || 14));
        endDate = endDate || todayManila;
        startDate = startDate || subtractCalendarDaysYmd(endDate, rollingDays - 1);
      }
    }

    const validStreams = ['overall', 'customer_inbound', 'supplier_outbound'];
    const resolvedStream = validStreams.includes(requestedStreamRaw)
      ? requestedStreamRaw
      : (validStreams.includes(matrixConfig.stream) ? matrixConfig.stream : 'overall');

    const explicitZeroFlag = body.includeZeroCatalogSkus !== undefined
      ? body.includeZeroCatalogSkus
      : (req.query?.includeZeroCatalogSkus !== undefined ? req.query.includeZeroCatalogSkus === 'true' : undefined);
    const resolvedIncludeZero = explicitZeroFlag !== undefined
      ? Boolean(explicitZeroFlag)
      : Boolean(matrixConfig.includeZeroCatalogSkus);

    // 2. Query Live or Test records in parallel (strictly isolated via isTestRecord)
    const [reportsRes, productsRes, memosRes] = await Promise.all([
      supabase.from('rma_reports').select('*').order('created_at', { ascending: false }),
      supabase.from('products').select('*'),
      supabase.from('credit_memos').select('*')
    ]);

    if (reportsRes.error) {
      return sendJson(res, 500, {
        success: false,
        error: 'REPORTS_QUERY_FAILED',
        message: reportsRes.error.message
      }, req);
    }

    const allReports = Array.isArray(reportsRes.data) ? reportsRes.data : [];
    const allProducts = Array.isArray(productsRes.data) ? productsRes.data : [];
    const allMemos = Array.isArray(memosRes.data) ? memosRes.data : [];

    const scopedReports = allReports.filter((r) => Boolean(isTestRecord(r)) === requestedTestMode);
    const scopedMemos = allMemos.filter((m) => Boolean(isTestRecord(m)) === requestedTestMode);

    // 3. Build identical Microsoft Excel-valid OOXML .xlsx buffer used in browser download
    const { bytes, dataset } = buildRmaMatrixXlsxBytes({
      reports: scopedReports,
      catalogProducts: allProducts,
      creditMemos: scopedMemos,
      startDate,
      endDate,
      stream: resolvedStream,
      isTestMode: requestedTestMode,
      includeZeroCatalogSkus: resolvedIncludeZero
    });

    // Resolve recipients strictly honoring overrides -> per-type matrix profile -> matrixConfig -> global email_recipients -> defaults
    const autoProfile = profilesByType?.daily_matrix_auto;
    const manualProfile = profilesByType?.manual_matrix;
    const activeProfile = caller.callerType === 'cron'
      ? (autoProfile || manualProfile)
      : (manualProfile || autoProfile);

    const reqToOverride = caller.callerType !== 'cron' ? splitEmailList(body.toList ?? body.to) : [];
    const profileToList = splitEmailList(activeProfile?.toList ?? activeProfile?.toEmail);
    const matrixCfgToList = splitEmailList(matrixConfig?.toList ?? matrixConfig?.toEmail);
    const globalToList = splitEmailList(savedRecipients?.toList ?? savedRecipients?.toEmail);

    const configuredToList = reqToOverride.length > 0
      ? reqToOverride
      : profileToList.length > 0
        ? profileToList
        : matrixCfgToList.length > 0
          ? matrixCfgToList
          : globalToList.length > 0
            ? globalToList
            : [DEFAULT_EMAIL_RECIPIENTS.toEmail];

    const hasExplicitCcOverride = caller.callerType !== 'cron' && (body.cc !== undefined || body.ccList !== undefined);
    const rawCcSource = hasExplicitCcOverride
      ? (body.ccList ?? body.cc)
      : (activeProfile && Array.isArray(activeProfile.ccList))
        ? activeProfile.ccList
        : Array.isArray(matrixConfig?.ccList)
          ? matrixConfig.ccList
          : Array.isArray(savedRecipients?.baseCcList)
            ? savedRecipients.baseCcList
            : DEFAULT_EMAIL_RECIPIENTS.baseCcList;

    const configuredToSet = new Set(configuredToList);
    const configuredCc = splitEmailList(rawCcSource).filter((e) => !configuredToSet.has(e));
    const configuredTo = configuredToList.join(', ');

    const finalTo = requestedTestMode ? sandboxEmail : configuredTo;
    const finalCc = requestedTestMode ? [] : configuredCc;

    const nowDate = new Date();
    const ts = formatSaveFileTimestamp(nowDate);
    const generatedManila = formatManilaTimestampDisplay(nowDate);
    const streamSlug = resolvedStream === 'supplier_outbound'
      ? 'Supplier_RTV_Matrix_Report'
      : resolvedStream === 'customer_inbound'
        ? 'Customer_Hub_Matrix_Report'
        : 'Overall_RMA_Matrix_Report';
    const streamTitle = resolvedStream === 'supplier_outbound'
      ? 'Supplier RTV Matrix Report'
      : resolvedStream === 'customer_inbound'
        ? 'Customer Hub Matrix Report'
        : 'Overall RMA Matrix Report';
    const filename = `${requestedTestMode ? 'TEST_' : ''}${streamSlug}_${startDate}_to_${endDate} ${ts}.xlsx`;

    const baseSubject = `[Daily RMA Matrix Report] ${streamTitle} (${startDate} to ${endDate}) — ${dataset.grandTotalPcs} pcs`;
    const finalSubject = formatTestEmailSubject(baseSubject, requestedTestMode);
    const finalFromName = requestedTestMode
      ? '[TEST] Pingcon RMA Operations Portal'
      : 'Pingcon RMA Operations Portal';

    const htmlBody = buildDailyMatrixEmailHtml({
      dataset,
      startDate,
      endDate,
      generatedManila,
      filename,
      toEmail: finalTo,
      ccList: finalCc,
      isTestMode: requestedTestMode,
      triggeredBy: caller.actor,
      sandboxEmail,
      targetTimePht
    });

    const textBody = `${requestedTestMode ? '[TEST] ' : ''}Daily Overall RMA Matrix Report (${startDate} to ${endDate})\nLine Items: ${dataset.lineCount}, SKUs: ${dataset.monitoredSkuCount}, Total Pcs: ${dataset.grandTotalPcs}, Total Value: PHP ${dataset.grandTotalValue.toFixed(2)}\nGenerated (PHT): ${generatedManila}\nTo: ${finalTo}${finalCc.length ? `\nCC: ${finalCc.join(', ')}` : ''}`;

    const smtp = createSmtpTransport();
    let emailMessageId = null;

    if (!dryRun) {
      if (!smtp.configured) {
        return sendJson(res, 200, {
          success: false,
          notConfigured: true,
          user: smtp.smtpUser,
          message: 'SMTP credentials (GMAIL_APP_PASSWORD) not configured in Vercel environment variables.'
        }, req);
      }

      try {
        const info = await smtp.transporter.sendMail({
          from: `"${finalFromName}" <${smtp.smtpUser}>`,
          to: finalTo,
          cc: finalCc.length > 0 ? finalCc : undefined,
          subject: finalSubject,
          html: htmlBody,
          text: textBody,
          attachments: [
            {
              filename,
              content: Buffer.from(bytes),
              contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            }
          ]
        });
        emailMessageId = info?.messageId || null;
      } catch (smtpErr) {
        const diagnostic = getDiagnosticHelp(smtpErr.message, smtp.smtpUser, smtp.cleanPass);
        return sendJson(res, 500, {
          success: false,
          error: 'SMTP_SEND_FAILED',
          message: smtpErr.message,
          diagnostic
        }, req);
      }

      // Record daily Live PHT idempotency date only after genuine non-test SMTP send
      if (!requestedTestMode) {
        await supabase
          .from('rma_settings')
          .upsert({
            key: LAST_SENT_PHT_KEY,
            value: todayManila,
            updated_at: new Date().toISOString()
          });
      }
    }

    return sendJson(res, 200, {
      success: true,
      dryRun,
      isTestMode: requestedTestMode,
      stream: resolvedStream,
      includeZeroCatalogSkus: resolvedIncludeZero,
      phtDate: todayManila,
      startDate,
      endDate,
      to: finalTo,
      toList: requestedTestMode ? [sandboxEmail] : configuredToList,
      sandboxEmail,
      targetTimePht,
      autoEnabled,
      cc: finalCc,
      subject: finalSubject,
      fromName: finalFromName,
      filename,
      messageId: emailMessageId,
      triggeredBy: caller.actor,
      dataset: {
        lineCount: dataset.lineCount,
        monitoredSkuCount: dataset.monitoredSkuCount,
        grandTotalPcs: dataset.grandTotalPcs,
        totalBadStockPcs: dataset.totalBadStockPcs,
        totalGoodStockPcs: dataset.totalGoodStockPcs,
        grandTotalValue: dataset.grandTotalValue
      },
      ...(includeAttachmentBase64 ? { attachmentBase64: Buffer.from(bytes).toString('base64') } : {})
    }, req);
  } catch (err) {
    console.error('[Daily Matrix Handler Error]:', err);
    return sendJson(res, 500, {
      success: false,
      error: 'DAILY_MATRIX_ERROR',
      message: err.message || 'Failed to generate or dispatch Daily Overall RMA Matrix.'
    }, req);
  }
}
