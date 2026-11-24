import nodemailer from 'nodemailer';

export const DEFAULT_SANDBOX_EMAIL = 'mgan@pingconmarketing.com';

export function normalizeSandboxEmail(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : DEFAULT_SANDBOX_EMAIL;
}

export const DEFAULT_EMAIL_RECIPIENTS = {
  toEmail: 'azgodev@gmail.com',
  baseCcList: [
    'mgan@pingconmarketing.com',
    'marketing@pingconmarketing.com',
    'azgan@pingconmarketing.com',
    'jaezelle.benito@pingconmarketing.com'
  ]
};

export function escapeEmailHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Ensures Test Mode email subjects ALWAYS begin with "[TEST] " as the first word,
 * stripping legacy "Test -" or "[TEST MODE]" prefixes to prevent duplication.
 */
export function formatTestEmailSubject(subject, isTestMode = false) {
  const raw = String(subject || '').trim();
  if (!isTestMode) return raw;
  let clean = raw;
  while (/^(?:\[test(?:\s+mode)?\]|test\s*[-:])\s*/i.test(clean)) {
    clean = clean.replace(/^(?:\[test(?:\s+mode)?\]|test\s*[-:])\s*/i, '').trim();
  }
  return clean ? `[TEST] ${clean}` : '[TEST] Notification';
}

export function getDiagnosticHelp(errMsg, user, pass) {
  const str = String(errMsg || '');
  if (str.includes('535') || str.includes('BadCredentials') || str.includes('Username and Password not accepted')) {
    return `Google SMTP rejected login for "${user}". Your App Password has ${pass.length} characters (Google App Passwords are 16 letters). If you see 535 Bad Credentials, please verify: (1) Ensure 2-Step Verification is enabled in your Google Account for ${user}, (2) Ensure the App Password was generated under ${user} (Google Account > Security > 2-Step Verification > App passwords), and (3) In Vercel Environment Variables, check GMAIL_APP_PASSWORD and make sure all 16 characters were pasted accurately.`;
  }
  return null;
}

export function createSmtpTransport() {
  const smtpUser = String(process.env.SMTP_USER || process.env.GMAIL_USER || 'finance2@keysysincorporated.com').trim();
  const rawPass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASSWORD || '';
  const cleanPass = String(rawPass).replace(/\s+/g, '').trim();

  if (!cleanPass) {
    return {
      configured: false,
      transporter: null,
      smtpUser,
      rawPass,
      cleanPass,
      hadSpaces: rawPass.includes(' ')
    };
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

  return {
    configured: true,
    transporter,
    smtpUser,
    rawPass,
    cleanPass,
    hadSpaces: rawPass.includes(' ')
  };
}
