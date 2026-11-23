import { supabase } from './supabase.js';
import { sendJson, setCorsHeaders } from './auth.js';
import {
  createSmtpTransport,
  formatTestEmailSubject,
  escapeEmailHtml,
  getDiagnosticHelp,
  DEFAULT_EMAIL_RECIPIENTS
} from './smtpMailer.js';
import {
  buildRmaMatrixXlsxBytes,
  toManilaDateKey,
  formatManilaHhmm,
  formatManilaTimestampDisplay
} from '../../src/utils/exportMatrixXlsx.js';
import { isTestRecord } from '../../src/utils/rmaHelpers.js';

const EMAIL_RECIPIENTS_KEY = 'email_recipients';
const LAST_SENT_PHT_KEY = 'daily_matrix_last_sent_pht_date';

const KNOWN_ADMIN_EMAILS = new Map([
  ['finance2@keysysincorporated.com', 'super_admin'],
  ['alleli.almaida@ph.keysys.com', 'admin'],
  ['finance@a2z2go.net', 'admin'],
  ['accountspayable@keysysincorporated.com', 'admin'],
  ['finance4@keysysincorporated.com', 'admin'],
  ['mark.aquino@a2z2go.net', 'admin'],
  ['ralph.alido@a2z2go.net', 'admin'],
  ['mgan@pingconmarketing.com', 'admin']
]);

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

async function authorizeDailyMatrixCaller(req) {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const authHeader = String(req.headers['authorization'] || req.headers['Authorization'] || '').trim();
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const xCronSecret = String(req.headers['x-cron-secret'] || '').trim();

  if (cronSecret && (xCronSecret === cronSecret || bearerToken === cronSecret)) {
    return { authorized: true, callerType: 'cron', actor: 'Vercel Cron Scheduler', role: 'cron' };
  }

  // When CRON_SECRET env var is unset on Vercel, trust Vercel's internal edge-stripped cron header
  if (!cronSecret && req.headers['x-vercel-cron'] === '1' && process.env.VERCEL === '1') {
    return { authorized: true, callerType: 'cron', actor: 'Vercel Cron Scheduler', role: 'cron' };
  }

  if (!bearerToken) {
    return {
      authorized: false,
      status: 401,
      error: 'UNAUTHORIZED',
      message: 'Authentication required. Provide valid CRON_SECRET or Admin Bearer JWT.'
    };
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser(bearerToken);
  const userEmail = String(userData?.user?.email || '').trim().toLowerCase();
  if (userErr || !userEmail) {
    return {
      authorized: false,
      status: 401,
      error: 'INVALID_SESSION',
      message: 'Session token is invalid or expired. Please sign in again.'
    };
  }

  let empRow = null;
  try {
    const { data } = await supabase
      .from('admin_users')
      .select('email, role, is_active')
      .eq('email', userEmail)
      .maybeSingle();
    empRow = data || null;
  } catch {}

  const role = empRow?.role || KNOWN_ADMIN_EMAILS.get(userEmail) || '';
  const isActive = empRow ? empRow.is_active !== false : KNOWN_ADMIN_EMAILS.has(userEmail);

  if (!isActive || !['super_admin', 'admin'].includes(role)) {
    return {
      authorized: false,
      status: 403,
      error: 'FORBIDDEN',
      message: `Admin or Super Admin privileges required. Account (${userEmail}) has role "${role || 'none'}".`
    };
  }

  return { authorized: true, callerType: 'admin', actor: userEmail, role };
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
  triggeredBy
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
          <span class="badge">${isTestMode ? '[TEST] DAILY MATRIX SANDBOX' : 'DAILY 1:00 PM PHT REPORT'}</span>
          <h1 class="title">${isTestMode ? '[TEST] ' : ''}Daily Overall RMA Matrix Report</h1>
          <div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">
            Customer Hub + Supplier RTV Combined Rolling Summary
          </div>
        </div>
        <div class="content">
          ${isTestMode ? `
          <div style="background: #fef3c7; border: 2px dashed #f59e0b; color: #92400e; padding: 10px 14px; border-radius: 10px; margin-bottom: 16px; font-weight: 700; font-size: 12px;">
            [TEST] Sandbox Simulation Run — Redirected exclusively to mgan@a2z2go.net. Live recipients bypassed.
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

  const caller = await authorizeDailyMatrixCaller(req);
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
  const includeAttachmentBase64 =
    req.query?.includeAttachmentBase64 === 'true' ||
    req.query?.includeAttachmentBase64 === '1' ||
    body.includeAttachmentBase64 === true;

  // Cron schedule strictly runs in Live Mode; manual admin run can explicitly request Test Sandbox
  const requestedTestMode =
    caller.callerType !== 'cron' &&
    Boolean(body.isTestMode === true || req.query?.isTestMode === 'true' || req.query?.mode === 'test');

  const todayManila = toManilaDateKey(new Date());
  const endDate = sanitizeYmd(body.endDate || req.query?.endDate) || todayManila;
  const startDate = sanitizeYmd(body.startDate || req.query?.startDate) || subtractCalendarDaysYmd(endDate, 13);

  try {
    // 1. Read email recipients & last daily cron marker from rma_settings
    const { data: settingsRows, error: settingsErr } = await supabase
      .from('rma_settings')
      .select('key, value')
      .in('key', [EMAIL_RECIPIENTS_KEY, LAST_SENT_PHT_KEY]);

    if (settingsErr) {
      return sendJson(res, 500, {
        success: false,
        error: 'SETTINGS_QUERY_FAILED',
        message: settingsErr.message
      }, req);
    }

    const settingsMap = new Map((settingsRows || []).map((row) => [row.key, row.value]));
    const savedRecipients = settingsMap.get(EMAIL_RECIPIENTS_KEY);
    const lastSentPhtDate = String(settingsMap.get(LAST_SENT_PHT_KEY) || '').trim();

    if (!force && !dryRun && !requestedTestMode && lastSentPhtDate === todayManila) {
      return sendJson(res, 200, {
        success: true,
        skipped: true,
        reason: 'ALREADY_SENT_TODAY',
        phtDate: todayManila,
        message: `Daily Overall RMA Matrix already dispatched for Manila date ${todayManila}.`
      }, req);
    }

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
      products: allProducts,
      creditMemos: scopedMemos,
      startDate,
      endDate,
      activeStream: 'all',
      isTestMode: requestedTestMode
    });

    const configuredToList = splitEmailList(savedRecipients?.toEmail);
    const configuredTo = configuredToList[0] || DEFAULT_EMAIL_RECIPIENTS.toEmail;
    const configuredCc = Array.isArray(savedRecipients?.baseCcList)
      ? splitEmailList(savedRecipients.baseCcList).filter((e) => e !== configuredTo)
      : DEFAULT_EMAIL_RECIPIENTS.baseCcList.filter((e) => e !== configuredTo);

    const finalTo = requestedTestMode ? 'mgan@a2z2go.net' : configuredTo;
    const finalCc = requestedTestMode ? [] : configuredCc;

    const hhmm = formatManilaHhmm(new Date());
    const generatedManila = formatManilaTimestampDisplay(new Date());
    const filename = `${requestedTestMode ? 'TEST_' : ''}Overall_RMA_Matrix_Report_${startDate}_to_${endDate} ${hhmm}.xlsx`;

    const baseSubject = `[Daily RMA Matrix Report] Overall RMA Matrix (${startDate} to ${endDate}) — ${dataset.grandTotalPcs} pcs`;
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
      triggeredBy: caller.actor
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
      phtDate: todayManila,
      startDate,
      endDate,
      to: finalTo,
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
