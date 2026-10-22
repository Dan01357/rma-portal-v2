import nodemailer from 'nodemailer';

function getDiagnosticHelp(errMsg, user, pass) {
  const str = String(errMsg || '');
  if (str.includes('535') || str.includes('BadCredentials') || str.includes('Username and Password not accepted')) {
    return `Google SMTP rejected login for "${user}". Your App Password has ${pass.length} characters (Google App Passwords are 16 letters). If you see 535 Bad Credentials, please verify: (1) Ensure 2-Step Verification is enabled in your Google Account for ${user}, (2) Ensure the App Password was generated under ${user} (Google Account > Security > 2-Step Verification > App passwords), and (3) In Vercel Environment Variables, check GMAIL_APP_PASSWORD and make sure all 16 characters were pasted accurately.`;
  }
  return null;
}

export default async function handler(req, res) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
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

    const smtpUser = String(process.env.SMTP_USER || process.env.GMAIL_USER || 'finance2@keysysincorporated.com').trim();
    const rawPass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASSWORD || '';
    
    // CRITICAL: Google displays app passwords with spaces like "abcd efgh ijkl mnop".
    // We strip all spaces/whitespace to ensure pure 16-character authentication with Google SMTP.
    const cleanPass = String(rawPass).replace(/\s+/g, '').trim();

    if (!cleanPass) {
      console.warn('SMTP credentials (GMAIL_APP_PASSWORD) not configured in Vercel environment variables yet.');
      return res.status(200).json({
        success: false,
        notConfigured: true,
        user: smtpUser,
        message: 'SMTP credentials (GMAIL_APP_PASSWORD) not configured in Vercel environment variables. Email notifications will be logged in console.'
      });
    }

    const isGmail = !process.env.SMTP_HOST || process.env.SMTP_HOST.includes('gmail.com');
    const transporter = nodemailer.createTransport(
      isGmail
        ? {
            service: 'gmail',
            auth: {
              user: smtpUser,
              pass: cleanPass
            }
          }
        : {
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT || 465),
            secure: Number(process.env.SMTP_PORT || 465) === 465,
            auth: {
              user: smtpUser,
              pass: cleanPass
            }
          }
    );

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

    // Filter valid CC addresses
    const validCc = Array.isArray(cc)
      ? cc.filter(e => typeof e === 'string' && e.includes('@') && e.trim() !== '' && !e.endsWith('.test'))
      : (cc && typeof cc === 'string' && cc.includes('@') && !cc.endsWith('.test') ? [cc] : []);

    let finalTo = to;
    let finalCc = validCc;
    let finalSubject = subject || 'New RMA Return Submission Notification';
    let finalHtml = html || text || '';
    let finalText = text || '';

    // If Test Mode is active:
    // DO NOT send to actual coworkers or customer AE!
    // Instead, reroute the delivery to finance2@keysysincorporated.com so Danilo sees the sent and received email in Gmail without disturbing anyone!
    if (isTestMode) {
      const originalTo = to;
      const originalCc = validCc.join(', ');

      finalTo = smtpUser; // 'finance2@keysysincorporated.com'
      finalCc = []; // empty to prevent other recipients from receiving anything
      finalSubject = finalSubject.toLowerCase().startsWith('test') || finalSubject.startsWith('[TEST')
        ? finalSubject
        : `[TEST MODE] ${finalSubject}`;

      const testBanner = `
        <div style="background-color: #fef3c7; border: 2px dashed #f59e0b; color: #92400e; padding: 14px 18px; border-radius: 12px; margin-bottom: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px;">
          <div style="font-weight: 800; font-size: 14px; margin-bottom: 6px;">🧪 TEST MODE ACTIVE (Safe Sandbox Delivery)</div>
          <div>This test email was safely sent exclusively to <strong>${finalTo}</strong> so you can verify the layout, calculations, and photo attachments in your Gmail.</div>
          <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #fde68a; font-size: 11px; color: #78350f;">
            <strong>Live Production Recipients (Bypassed in Test Mode):</strong><br/>
            • <strong>Target TO:</strong> ${originalTo}<br/>
            • <strong>Target CC:</strong> ${originalCc || 'None'}
          </div>
        </div>
      `;

      finalHtml = testBanner + finalHtml;
      finalText = `[TEST MODE ACTIVE - Safe Sandbox Delivery]\nTarget TO: ${originalTo}\nTarget CC: ${originalCc}\n\n${finalText}`;
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

    const info = await transporter.sendMail(mailOptions);
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
