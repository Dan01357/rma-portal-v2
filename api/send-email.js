import { handleDailyMatrixEmail } from './_lib/dailyMatrixEmailHandler.js';
import { handleDailyFollowUp } from './_lib/dailyFollowUpHandler.js';
import { handleSyncEmailReplies, handleIngestXlsxReply } from './_lib/imapReplySyncHandler.js';
import { supabase } from './_lib/supabase.js';
import {
  createSmtpTransport,
  DEFAULT_SANDBOX_EMAIL,
  normalizeSandboxEmail,
  formatTestEmailSubject,
  getDiagnosticHelp
} from './_lib/smtpMailer.js';

export default async function handler(req, res) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, x-cron-secret, x-vercel-cron'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let payload = req.body;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch (e) {
        // use as-is
      }
    }

    const requestedAction = String(req.query?.action || payload?.action || '').trim().toLowerCase();
    if (requestedAction === 'daily-matrix') {
      return await handleDailyMatrixEmail(req, res, payload);
    }
    if (requestedAction === 'daily-followup') {
      return await handleDailyFollowUp(req, res, payload);
    }
    if (requestedAction === 'sync-email-replies') {
      return await handleSyncEmailReplies(req, res, payload);
    }
    if (requestedAction === 'ingest-xlsx-reply') {
      return await handleIngestXlsxReply(req, res, payload);
    }

    const smtp = createSmtpTransport();
    const { smtpUser, rawPass, cleanPass, transporter, configured } = smtp;

    if (!configured || !cleanPass) {
      console.warn('SMTP credentials (GMAIL_APP_PASSWORD) not configured in Vercel environment variables yet.');
      return res.status(200).json({
        success: false,
        notConfigured: true,
        user: smtpUser,
        message: 'SMTP credentials (GMAIL_APP_PASSWORD) not configured in Vercel environment variables. Email notifications will be logged in console.'
      });
    }

    // Diagnostic/Testing Connection Ping
    if (req.method === 'GET' || payload?.action === 'test-connection') {
      try {
        console.log(`[SMTP Diagnostic Ping] Testing credentials for user: ${smtpUser} (password length: ${cleanPass.length}, had spaces originally: ${rawPass.includes(' ')})`);
        await transporter.verify();
        return res.status(200).json({
          success: true,
          verified: true,
          user: smtpUser,
          passLength: cleanPass.length,
          hadSpaces: rawPass.includes(' '),
          message: `Google SMTP connection & authentication successfully verified for ${smtpUser}!`
        });
      } catch (verifyErr) {
        console.error('SMTP Verify failed:', verifyErr);
        return res.status(200).json({
          success: false,
          verified: false,
          user: smtpUser,
          passLength: cleanPass.length,
          hadSpaces: rawPass.includes(' '),
          error: verifyErr.message,
          diagnostic: getDiagnosticHelp(verifyErr.message, smtpUser, cleanPass)
        });
      }
    }

    const {
      from,
      fromName,
      to = 'azgodev@gmail.com',
      cc = [],
      subject,
      html,
      text,
      isTestMode = false,
      isTestModeExplicitRecipients = false,
      emailType = '',
      attachments = []
    } = payload || {};

    const senderEmail = from || smtpUser;
    const formattedFrom = fromName ? `"${fromName}" <${senderEmail}>` : senderEmail;

    const normalizeEmailArray = (raw) => {
      if (!raw) return [];
      const items = Array.isArray(raw) ? raw : String(raw).split(/[,;\s]+/);
      const seen = new Set();
      for (const entry of items) {
        const clean = String(entry || '').trim();
        if (clean && clean.includes('@') && clean.includes('.') && !clean.toLowerCase().endsWith('.test')) {
          const lower = clean.toLowerCase();
          if (!seen.has(lower)) seen.add(lower);
        }
      }
      return Array.from(seen);
    };

    const validToList = normalizeEmailArray(to);
    const normalizedTo = validToList.length > 0 ? validToList.join(', ') : 'azgodev@gmail.com';
    const validCc = normalizeEmailArray(cc).filter((e) => !validToList.includes(e));

    let finalTo = normalizedTo;
    let finalCc = validCc;
    let finalSubject = subject || 'New RMA Return Submission Notification';
    let finalHtml = html || text || '';
    let finalText = text || '';

    // If Test Mode is active:
    // NEVER send to Live recipients or Live customer AE unless explicitly configured inside Test Mode settings!
    // Priority:
    //   1. Explicit Test Mode TO/CC passed from Test Mode frontend profile/editor (isTestModeExplicitRecipients)
    //   2. Saved per-type Test Mode profile (test_email_recipients_by_type[emailType])
    //   3. Saved global Test Mode recipients (test_email_recipients)
    //   4. Sandbox fallback (test_sandbox_email -> DEFAULT_SANDBOX_EMAIL)
    if (isTestMode) {
      const originalTo = isTestModeExplicitRecipients ? 'Bypassed (Using Test Mode Profile)' : normalizedTo;
      const originalCc = isTestModeExplicitRecipients ? 'Bypassed (Using Test Mode Profile)' : validCc.join(', ');
      let resolvedSandboxEmail = payload?.sandboxEmail
        ? normalizeSandboxEmail(payload.sandboxEmail)
        : DEFAULT_SANDBOX_EMAIL;
      let savedTestGlobal = null;
      let savedTestByType = null;

      try {
        const { data: testSettingRows } = await supabase
          .from('rma_settings')
          .select('key, value')
          .in('key', ['test_sandbox_email', 'test_email_recipients', 'test_email_recipients_by_type']);
        for (const row of testSettingRows || []) {
          if (row.key === 'test_sandbox_email' && row.value && !payload?.sandboxEmail) {
            resolvedSandboxEmail = normalizeSandboxEmail(row.value);
          } else if (row.key === 'test_email_recipients') {
            savedTestGlobal = typeof row.value === 'string'
              ? (() => { try { return JSON.parse(row.value); } catch { return null; } })()
              : row.value;
          } else if (row.key === 'test_email_recipients_by_type') {
            savedTestByType = typeof row.value === 'string'
              ? (() => { try { return JSON.parse(row.value); } catch { return null; } })()
              : row.value;
          }
        }
      } catch {}

      const cleanTypeKey = String(emailType || '').trim();
      const typeProf = cleanTypeKey && savedTestByType && typeof savedTestByType === 'object'
        ? savedTestByType[cleanTypeKey]
        : null;
      const typeToList = normalizeEmailArray(typeProf?.toList ?? typeProf?.toEmail ?? typeProf?.to);
      const typeCcList = normalizeEmailArray(typeProf?.ccList ?? typeProf?.cc);
      const globalTestToList = normalizeEmailArray(savedTestGlobal?.toList ?? savedTestGlobal?.toEmail);
      const globalTestCcList = normalizeEmailArray(savedTestGlobal?.baseCcList ?? savedTestGlobal?.ccList);

      const payloadTestToList = payload?.hasCustomTestRecipients ? normalizeEmailArray(payload?.testToList) : [];
      const payloadTestCcList = payload?.hasCustomTestRecipients ? normalizeEmailArray(payload?.testCcList) : [];

      let testToList = [];
      let testCcList = [];
      if (payloadTestToList.length > 0) {
        testToList = payloadTestToList;
        testCcList = payloadTestCcList.filter((e) => !testToList.includes(e));
      } else if (isTestModeExplicitRecipients && validToList.length > 0) {
        testToList = validToList;
        testCcList = validCc.filter((e) => !testToList.includes(e));
      } else if (typeToList.length > 0) {
        testToList = typeToList;
        testCcList = typeCcList.filter((e) => !testToList.includes(e));
      } else if (globalTestToList.length > 0) {
        testToList = globalTestToList;
        testCcList = globalTestCcList.filter((e) => !testToList.includes(e));
      } else {
        testToList = [resolvedSandboxEmail];
        testCcList = [];
      }

      finalTo = testToList.join(', ');
      finalCc = testCcList;
      finalSubject = formatTestEmailSubject(finalSubject, true);

      const testBanner = `
        <div style="background-color: #fef3c7; border: 2px dashed #f59e0b; color: #92400e; padding: 14px 18px; border-radius: 12px; margin-bottom: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px;">
          <div style="font-weight: 800; font-size: 14px; margin-bottom: 6px;">🧪 TEST MODE ACTIVE (Safe Sandbox Delivery)</div>
          <div>This test email was safely routed exclusively to Test Mode recipient(s) <strong>${finalTo}</strong>${finalCc.length ? ` (CC: <strong>${finalCc.join(', ')}</strong>)` : ''} — Live production stakeholders remain completely isolated.</div>
          <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #fde68a; font-size: 11px; color: #78350f;">
            <strong>Test Isolation Audit (Sandbox Fallback: ${resolvedSandboxEmail}):</strong><br/>
            • <strong>Test Mode TO:</strong> ${finalTo}<br/>
            • <strong>Test Mode CC:</strong> ${finalCc.length ? finalCc.join(', ') : 'None'}<br/>
            • <strong>Bypassed / Suppressed Live Target:</strong> ${originalTo}${originalCc && originalCc !== 'Bypassed (Using Test Mode Profile)' ? ` (CC: ${originalCc})` : ''}
          </div>
        </div>
      `;

      finalHtml = testBanner + finalHtml;
      finalText = `[TEST MODE ACTIVE - Safe Sandbox Delivery -> TO: ${finalTo}${finalCc.length ? ` | CC: ${finalCc.join(', ')}` : ''} | Sandbox: ${resolvedSandboxEmail}]\n\n${finalText}`;
      console.log(`🧪 [TEST MODE] Dispatched safely via SMTP to ${finalTo} (CC: ${finalCc.join(', ') || 'none'})`);
    }

    const mailOptions = {
      from: formattedFrom,
      replyTo: payload?.replyTo || from || smtpUser,
      to: finalTo,
      cc: finalCc,
      subject: finalSubject,
      text: finalText,
      html: finalHtml,
      attachments: Array.isArray(attachments) ? attachments : []
    };

    let info;
    try {
      info = await transporter.sendMail(mailOptions);
    } catch (sendErr) {
      if (mailOptions.attachments && mailOptions.attachments.length > 0) {
        const inlineDocAttachments = mailOptions.attachments.filter(
          (a) =>
            a &&
            !a.path &&
            (a.contentType === 'application/pdf' ||
              a.contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
              /\.(pdf|xlsx)$/i.test(String(a.filename || '')))
        );
        if (inlineDocAttachments.length > 0 && inlineDocAttachments.length < mailOptions.attachments.length) {
          console.warn('sendMail with remote image attachments failed, retrying with PDF/XLSX attachments only:', sendErr.message);
          mailOptions.attachments = inlineDocAttachments;
          try {
            info = await transporter.sendMail(mailOptions);
          } catch (pdfRetryErr) {
            console.warn('sendMail with PDF attachment failed, retrying without attachments:', pdfRetryErr.message);
            mailOptions.attachments = [];
            info = await transporter.sendMail(mailOptions);
          }
        } else {
          console.warn('sendMail with attachments failed, retrying without attachments:', sendErr.message);
          mailOptions.attachments = [];
          info = await transporter.sendMail(mailOptions);
        }
      } else {
        throw sendErr;
      }
    }

    console.log('Email dispatched successfully via Gmail SMTP:', info.messageId, 'TestMode:', isTestMode);

    return res.status(200).json({
      success: true,
      messageId: info.messageId,
      testMode: isTestMode,
      deliveredTo: finalTo
    });
  } catch (error) {
    console.error('Error in send-email API handler:', error);
    const smtpUser = String(process.env.SMTP_USER || process.env.GMAIL_USER || 'finance2@keysysincorporated.com').trim();
    const rawPass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASSWORD || '';
    const cleanPass = String(rawPass).replace(/\s+/g, '').trim();

    return res.status(200).json({
      success: false,
      error: error.message,
      diagnostic: getDiagnosticHelp(error.message, smtpUser, cleanPass),
      user: smtpUser,
      passLength: cleanPass.length
    });
  }
}
