import { handleDailyMatrixEmail } from './_lib/dailyMatrixEmailHandler.js';
import { handleDailyFollowUp } from './_lib/dailyFollowUpHandler.js';
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
    // DO NOT send to actual recipients or customer AE!
    // Instead, reroute delivery exclusively to the configured sandbox email (default mgan@pingconmarketing.com).
    if (isTestMode) {
      const originalTo = normalizedTo;
      const originalCc = validCc.join(', ');
      let resolvedSandboxEmail = DEFAULT_SANDBOX_EMAIL;
      if (payload?.sandboxEmail) {
        resolvedSandboxEmail = normalizeSandboxEmail(payload.sandboxEmail);
      } else {
        try {
          const { data: sandboxRow } = await supabase
            .from('rma_settings')
            .select('value')
            .eq('key', 'test_sandbox_email')
            .maybeSingle();
          if (sandboxRow?.value) {
            resolvedSandboxEmail = normalizeSandboxEmail(sandboxRow.value);
          }
        } catch {}
      }

      finalTo = resolvedSandboxEmail;
      finalCc = []; // empty to prevent other recipients from receiving anything
      finalSubject = formatTestEmailSubject(finalSubject, true);

      const testBanner = `
        <div style="background-color: #fef3c7; border: 2px dashed #f59e0b; color: #92400e; padding: 14px 18px; border-radius: 12px; margin-bottom: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px;">
          <div style="font-weight: 800; font-size: 14px; margin-bottom: 6px;">🧪 TEST MODE ACTIVE (Safe Sandbox Delivery)</div>
          <div>This test email was safely routed exclusively to <strong>${resolvedSandboxEmail}</strong> so you can verify the layout, calculations, attachments, and photo embeds without notifying live stakeholders.</div>
          <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #fde68a; font-size: 11px; color: #78350f;">
            <strong>Live Production Recipients (Bypassed in Test Mode):</strong><br/>
            • <strong>Target TO:</strong> ${originalTo}<br/>
            • <strong>Target CC:</strong> ${originalCc || 'None'}
          </div>
        </div>
      `;

      finalHtml = testBanner + finalHtml;
      finalText = `[TEST MODE ACTIVE - Safe Sandbox Delivery -> ${resolvedSandboxEmail}]\nTarget TO: ${originalTo}\nTarget CC: ${originalCc}\n\n${finalText}`;
      console.log(`🧪 [TEST MODE] Dispatched safely via SMTP to ${finalTo} (Original TO: ${originalTo}, CC: ${originalCc})`);
    }

    const mailOptions = {
      from: formattedFrom,
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
        const pdfOnlyAttachments = mailOptions.attachments.filter(
          (a) => a && (a.contentType === 'application/pdf' || String(a.filename || '').toLowerCase().endsWith('.pdf')) && !a.path
        );
        if (pdfOnlyAttachments.length > 0 && pdfOnlyAttachments.length < mailOptions.attachments.length) {
          console.warn('sendMail with remote image attachments failed, retrying with PDF attachment only:', sendErr.message);
          mailOptions.attachments = pdfOnlyAttachments;
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
