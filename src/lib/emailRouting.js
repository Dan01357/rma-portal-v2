/**
 * Smart AE & Email Routing Dispatch System
 * ─────────────────────────────────────────
 * Brands:
 *   A2Z2GO / KEYSYS    → From: finance2@a2z2go.net
 *   PINGCON / BONITA   → From: finance@pingconmarketing.com
 *
 * Sandbox / Test Mode (.test email routing):
 *   When localStorage 'rma_sandbox_test_mode' === 'true':
 *     - All email addresses get ".test" appended
 *     - Subject prefixed with "[TEST] "
 *     - On-screen badge shown
 */

// ─── Sandbox Helper ─────────────────────────────────────────────────────────
const SANDBOX_KEY = 'rma_sandbox_test_mode';

export function isSandboxMode() {
  try {
    return localStorage.getItem(SANDBOX_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setSandboxMode(enabled) {
  try {
    localStorage.setItem(SANDBOX_KEY, enabled ? 'true' : 'false');
  } catch (e) {
    console.error('Could not persist sandbox mode:', e);
  }
}

/**
 * Appends ".test" to an email address when sandbox mode is active.
 * e.g. "azgodev@gmail.com" → "azgodev@gmail.com.test"
 */
function sandboxEmail(email) {
  if (!email) return email;
  return isSandboxMode() ? `${email}.test` : email;
}

function sandboxEmailList(list) {
  return (list || []).map(sandboxEmail);
}

// ─── Brand Sender Identities ─────────────────────────────────────────────────
// Master sender account: finance2@keysysincorporated.com
// Aliases: finance@pingconmarketing.com and finance2@a2z2go.net
export const MASTER_SENDER_EMAIL = 'finance2@keysysincorporated.com';

export const BRAND_SENDERS = {
  a2zGroup: {
    fromEmail:    'finance2@keysysincorporated.com',
    aliasEmail:   'finance2@a2z2go.net',
    fromName:     'KEYSYS & A2Z2GO Warranty & RMA',
    replyTo:      'finance2@keysysincorporated.com'
  },
  pingconGroup: {
    fromEmail:    'finance2@keysysincorporated.com',
    aliasEmail:   'finance@pingconmarketing.com',
    fromName:     'Pingcon & Bonita Logistics RMA',
    replyTo:      'finance2@keysysincorporated.com'
  }
};

// ─── Account Executive Roster ────────────────────────────────────────────────
export const ACCOUNT_EXECUTIVES = [
  { id: 'galvez',   name: 'Rodrigo Galvez',   pingconEmail: 'rodrigo.galvez@pingconmarketing.com',   a2zEmail: 'rgalvez@a2z2go.net' },
  { id: 'bautista', name: 'Mark Bautista',     pingconEmail: 'mark.bautista@pingconmarketing.com',     a2zEmail: 'mbautista@a2z2go.net' },
  { id: 'morta',    name: 'Dennis Morta',      pingconEmail: 'dennis.morta@pingconmarketing.com',      a2zEmail: 'dmorta@a2z2go.net' },
  { id: 'valmeo',   name: 'Allan Valmeo',      pingconEmail: 'allan.valmeo@pingconmarketing.com',      a2zEmail: 'avalmeo@a2z2go.net' },
  { id: 'vergara',  name: 'Ronald Vergara',    pingconEmail: 'ronald.vergara@pingconmarketing.com',    a2zEmail: 'rvergara@a2z2go.net' },
  { id: 'dizon',    name: 'Christian Dizon',   pingconEmail: 'christian.dizon@pingconmarketing.com',   a2zEmail: 'cdizon@a2z2go.net' },
  { id: 'duyag',    name: 'Jerome Duyag',      pingconEmail: 'jerome.duyag@pingconmarketing.com',      a2zEmail: 'jduyag@a2z2go.net' },
  { id: 'ichon',    name: 'Karen Ichon',       pingconEmail: 'karen.ichon@pingconmarketing.com',       a2zEmail: 'kichon@a2z2go.net' },
  { id: 'peria',    name: 'Paolo Peria',       pingconEmail: 'paolo.peria@pingconmarketing.com',       a2zEmail: 'pperia@a2z2go.net' },
  { id: 'pitong',   name: 'Arnel Pitong',      pingconEmail: 'arnel.pitong@pingconmarketing.com',      a2zEmail: 'apitong@a2z2go.net' },
  { id: 'ruado',    name: 'Michael Ruado',     pingconEmail: 'michael.ruado@pingconmarketing.com',     a2zEmail: 'mruado@a2z2go.net' },
  { id: 'mallo',    name: 'Jeffrey Mallo',     pingconEmail: 'jeffrey.mallo@pingconmarketing.com',     a2zEmail: 'jmallo@a2z2go.net' }
];

// ─── Routing Config (saved to localStorage) ──────────────────────────────────
const ROUTING_STORAGE_KEY = 'rma_email_routing_config_v2';
const WEBHOOK_STORAGE_KEY = 'rma_email_webhook_url';

export const DEFAULT_EMAIL_ROUTING = {
  a2zGroup: {
    mainRecipient: 'finance2@keysysincorporated.com',
    ccRecipients: [
      'mgan@a2z2go.net',
      'AZGan@a2z2go.net',
      'marketing@a2z2go.net',
      'jaezelle.benito@pingconmarketing.com'
    ]
  },
  pingconGroup: {
    mainRecipient: 'finance2@keysysincorporated.com',
    ccRecipients: [
      'mgan@pingconmarketing.com',
      'AZGan@pingconmarketing.com',
      'marketing@pingconmarketing.com',
      'jaezelle.benito@pingconmarketing.com'
    ]
  }
};

export function getWebhookUrl() {
  try {
    return localStorage.getItem(WEBHOOK_STORAGE_KEY) || import.meta.env.VITE_EMAIL_WEBHOOK_URL || '';
  } catch {
    return import.meta.env.VITE_EMAIL_WEBHOOK_URL || '';
  }
}

export function saveWebhookUrl(url) {
  try {
    if (url) {
      localStorage.setItem(WEBHOOK_STORAGE_KEY, url.trim());
    } else {
      localStorage.removeItem(WEBHOOK_STORAGE_KEY);
    }
  } catch (err) {
    console.error('Error saving webhook URL:', err);
  }
}

export function getEmailRoutingConfig() {
  try {
    const raw = localStorage.getItem(ROUTING_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading email routing config:', err);
  }
  return DEFAULT_EMAIL_ROUTING;
}

export function saveEmailRoutingConfig(config) {
  try {
    localStorage.setItem(ROUTING_STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.error('Error saving email routing config:', err);
  }
}

// ─── AE Lookup ────────────────────────────────────────────────────────────────
export function findAE(identifier) {
  if (!identifier) return ACCOUNT_EXECUTIVES[0];
  const q = identifier.trim().toLowerCase();
  return (
    ACCOUNT_EXECUTIVES.find(
      ae =>
        ae.name.toLowerCase() === q ||
        ae.name.toLowerCase().includes(q) ||
        ae.id.toLowerCase() === q
    ) || ACCOUNT_EXECUTIVES[0]
  );
}

// ─── Brand Group Resolver ─────────────────────────────────────────────────────
export function isA2ZGroupBrand(company) {
  const c = (company || '').toUpperCase();
  return c.includes('A2Z') || c.includes('KEYSYS');
}

// ─── Build Dispatch Email Payload ─────────────────────────────────────────────
/**
 * Constructs the full email dispatch payload for a given RMA ticket.
 * Respects Sandbox Mode: appends ".test" to all emails, prefixes subject with "[TEST]".
 *
 * @param {object} ticket  - RMA ticket object
 * @returns {object}       - { subject, from, fromName, mainRecipient, ccList, body, mailtoUrl,
 *                             group, sender, isSandbox, timestamp }
 */
export function buildDispatchEmailPayload(ticket) {
  const config      = getEmailRoutingConfig();
  const sandbox     = isSandboxMode();
  const a2zBrand    = isA2ZGroupBrand(ticket.company);
  const rule        = a2zBrand ? config.a2zGroup    : config.pingconGroup;
  const sender      = a2zBrand ? BRAND_SENDERS.a2zGroup : BRAND_SENDERS.pingconGroup;
  const assignedAE  = findAE(ticket.assigned_ae);
  const aeEmail     = a2zBrand ? assignedAE.a2zEmail : assignedAE.pingconEmail;

  // Build CC list: AE first, then group CCs — all sandboxed if needed
  const rawCcList   = Array.from(new Set([aeEmail, ...(rule.ccRecipients || [])]));
  const ccList      = sandbox ? sandboxEmailList(rawCcList) : rawCcList;
  const toEmail     = sandbox ? sandboxEmail(rule.mainRecipient) : rule.mainRecipient;

  // Subject line — sandbox-prefixed
  const baseSubject = `[RMA FILED] ${ticket.rma_id || 'RMA-PENDING'} - ${ticket.company || 'BRAND'} - ${ticket.customer_name || 'CUSTOMER'} - ${ticket.delivery_reference || 'NO-DR'}`;
  const subject     = sandbox ? `[TEST] ${baseSubject}` : baseSubject;

  // Build email body
  const sandboxNote = sandbox
    ? '\n⚠️  SANDBOX / TEST MODE — This is a simulated dispatch. No real action required.\n'
    : '';

  const body = `${sandboxNote}
WHOLESALE RMA RETURN MERCHANDISE AUTHORIZATION
============================================================
A new return authorization has been registered in the system vault.

RMA TRACKING ID : ${ticket.rma_id}
FILING DATE     : ${new Date(ticket.created_at || Date.now()).toLocaleString()}
BRAND           : ${ticket.company}
SENDER (FROM)   : ${sender.fromName} <${sender.fromEmail}>
ASSIGNED AE     : ${assignedAE.name} (${aeEmail})

CUSTOMER DETAILS:
  Customer Name  : ${ticket.customer_name}
  Delivery Ref   : ${ticket.delivery_reference || 'N/A'}
  Contact Person : ${ticket.contact_person || 'N/A'}
  Contact Phone  : ${ticket.contact_phone || 'N/A'}
  Contact Email  : ${ticket.contact_email || 'N/A'}

PRODUCT DETAILS:
  Product Name   : ${ticket.product_name}
  SKU / Code     : ${ticket.sku}
  Packaging      : ${ticket.packaging_unit}

DEFECT INSPECTION:
  Defect Reason  : ${ticket.defect_category}
  Defect Details : ${ticket.defect_description}
  Proof Photo    : ${ticket.photo_url || 'Attached to vault'}

STATUS: Pending Inspection
============================================================
Supervisor action is required to review defect proof and approve replacement or issue Credit Memo.
${sandbox ? '\n[TEST EMAIL — Sent to .test sink. External delivery blocked.]' : ''}`;

  const mailtoUrl = `mailto:${encodeURIComponent(toEmail)}?cc=${encodeURIComponent(ccList.join(','))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const gmailComposeUrl = generateGmailComposeUrl({
    mainRecipient: toEmail,
    ccList,
    subject,
    body
  });

  return {
    rma_id:        ticket.rma_id,
    subject,
    from:          sender.fromEmail,
    fromName:      sender.fromName,
    replyTo:       sender.replyTo,
    mainRecipient: toEmail,
    ccList,
    ae:            assignedAE,
    body,
    mailtoUrl,
    gmailComposeUrl,
    group:         a2zBrand ? 'A2Z2GO / KEYSYS' : 'PINGCON / BONITA TISSUE',
    sender,
    isSandbox:     sandbox,
    timestamp:     new Date().toISOString()
  };
}

// ─── Direct Gmail Web Compose Link Generator ─────────────────────────────────
/**
 * Generates direct mail.google.com compose link so staff can click once to open
 * Gmail in browser with To, CC, Subject, and formatted body populated.
 */
export function generateGmailComposeUrl({ mainRecipient, ccList, subject, body }) {
  const to   = encodeURIComponent(mainRecipient || '');
  const cc   = encodeURIComponent((ccList || []).join(','));
  const su   = encodeURIComponent(subject || '');
  const b    = encodeURIComponent(body || '');
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&cc=${cc}&su=${su}&body=${b}`;
}

// ─── Automated Webhook Dispatch (Google Apps Script / Serverless) ────────────
/**
 * Sends dispatch payload via Google Apps Script Webhook or custom endpoint.
 * Content-Type: text/plain prevents CORS preflight OPTIONS redirect issues with Google Apps Script.
 */
export async function sendEmailViaWebhook(payload) {
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    return { 
      success: false, 
      status: 'Ready to Send in Gmail', 
      message: 'No webhook configured. Ready to dispatch via Gmail compose.' 
    };
  }

  if (payload.isSandbox) {
    return { 
      success: true, 
      status: 'Sandbox Simulated', 
      message: 'Sandbox active (.test sink). Email delivery simulated.' 
    };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({
        to:       payload.mainRecipient,
        cc:       (payload.ccList || []).join(', '),
        subject:  payload.subject,
        body:     payload.body,
        fromName: payload.fromName,
        replyTo:  payload.replyTo,
        rma_id:   payload.rma_id || 'RMA'
      })
    });

    const rawText = await response.text();
    let result = null;
    try {
      result = JSON.parse(rawText);
    } catch {
      result = { raw: rawText };
    }

    if (response.ok || result?.status === 'success') {
      return {
        success: true,
        status:  'Delivered via Google Webhook',
        message: 'Dispatched successfully via Google Apps Script Webhook.'
      };
    } else {
      return {
        success: false,
        status:  'Webhook Error',
        message: result?.message || `Webhook returned status ${response.status}`
      };
    }
  } catch (err) {
    console.warn('⚠️ Webhook send network note:', err);
    return {
      success: false,
      status:  'Webhook Network Failure',
      message: err.message
    };
  }
}

// ─── Dispatch Logs (Outbox Audit Trail) ──────────────────────────────────────
const DISPATCH_LOGS_KEY = 'rma_email_dispatch_log';

export function getDispatchLogs() {
  try {
    const raw = localStorage.getItem(DISPATCH_LOGS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearDispatchLogs() {
  try {
    localStorage.removeItem(DISPATCH_LOGS_KEY);
  } catch (e) {
    console.error('Error clearing dispatch logs:', e);
  }
}

// ─── Dispatch Trigger ─────────────────────────────────────────────────────────
/**
 * Triggers the dispatch:
 * 1. Builds structured payload
 * 2. Attempts automated Webhook send (if configured)
 * 3. Records detailed event into Outbox Dispatch Logs
 */
export async function dispatchRMANotification(ticket) {
  const payload = buildDispatchEmailPayload(ticket);
  const mode    = payload.isSandbox ? '🧪 SANDBOX' : '📧 LIVE';

  console.log(`${mode} [AUTO-DISPATCH EMAIL TRIGGERED]`, {
    to:      payload.mainRecipient,
    cc:      payload.ccList,
    subject: payload.subject,
    from:    `${payload.fromName} <${payload.from}>`,
    sandbox: payload.isSandbox
  });

  // Attempt silent webhook delivery (e.g. Google Apps Script)
  let sendResult = { status: 'Ready to Send in Gmail', success: false };
  try {
    sendResult = await sendEmailViaWebhook(payload);
  } catch (webhookErr) {
    console.warn('Webhook dispatch exception:', webhookErr);
    sendResult = { status: 'Webhook Exception', message: webhookErr.message, success: false };
  }

  // Persist to local dispatch outbox event log
  try {
    const logs = getDispatchLogs();
    const entry = {
      id:         `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      rma_id:     ticket.rma_id,
      timestamp:  new Date().toISOString(),
      subject:    payload.subject,
      from:       payload.from,
      fromName:   payload.fromName,
      recipients: { to: payload.mainRecipient, cc: payload.ccList },
      ae:         payload.ae?.name || 'Unassigned',
      isSandbox:  payload.isSandbox,
      status:     sendResult.status || (sendResult.success ? 'Delivered' : 'Ready to Send in Gmail'),
      details:    sendResult.message || '',
      body:       payload.body,
      mailtoUrl:  payload.mailtoUrl,
      gmailUrl:   payload.gmailComposeUrl
    };

    logs.unshift(entry);
    localStorage.setItem(DISPATCH_LOGS_KEY, JSON.stringify(logs.slice(0, 100)));
  } catch (e) {
    console.error('Failed to log dispatch email:', e);
  }

  return { ...payload, sendResult };
}
