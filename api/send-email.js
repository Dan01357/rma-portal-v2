import nodemailer from 'nodemailer';

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

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
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

    const {
      from,
      fromName,
      to = 'azgodev@gmail.com',
      cc = [],
      subject,
      html,
      text
    } = payload || {};

    const isTestMode = Boolean(
      payload?.isTestMode ||
      (typeof to === 'string' && to.endsWith('.test')) ||
      (Array.isArray(cc) && cc.some(c => typeof c === 'string' && c.endsWith('.test')))
    );

    if (isTestMode) {
      console.log('🧪 [TEST MODE ACTIVE] Simulated email dispatch bypassed live SMTP:');
      console.log('From:', from);
      console.log('To:', to);
      console.log('CC:', cc);
      console.log('Subject:', subject);
      return res.status(200).json({
        success: true,
        testMode: true,
        message: `Test mode active: simulated email dispatch with subject "${subject}". Live emails to .test recipients safely suppressed.`,
        to,
        cc
      });
    }

    const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER || 'finance2@keysysincorporated.com';
    const smtpPass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASSWORD;

    if (!smtpPass) {
      console.warn('SMTP credentials (GMAIL_APP_PASSWORD) not configured in Vercel environment variables yet.');
      return res.status(200).json({
        success: false,
        notConfigured: true,
        message: 'SMTP credentials not configured in Vercel environment variables. Email notification was logged in console.'
      });
    }

    const smtpPort = Number(process.env.SMTP_PORT || 465);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: smtpPort,
      secure: smtpPort === 465, // true for 465, false for 587
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    });

    const senderEmail = from || smtpUser;
    const formattedFrom = fromName ? `"${fromName}" <${senderEmail}>` : senderEmail;

    // Filter valid CC addresses
    const validCc = Array.isArray(cc)
      ? cc.filter(e => typeof e === 'string' && e.includes('@') && e.trim() !== '')
      : (cc ? [cc] : []);

    const mailOptions = {
      from: formattedFrom,
      to: to,
      cc: validCc,
      subject: subject || 'New RMA Return Submission Notification',
      text: text || '',
      html: html || text
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('RMA Email dispatched successfully:', info.messageId);

    return res.status(200).json({
      success: true,
      messageId: info.messageId
    });
  } catch (error) {
    console.error('Error in send-email API handler:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
