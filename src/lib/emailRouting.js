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
export const BRAND_SENDERS = {
  a2zGroup: {
    fromEmail:    'finance2@a2z2go.net',
    fromName:     'A2Z2GO / KEYSYS Warranty & RMA',
    replyTo:      'finance2@a2z2go.net'
  },
  pingconGroup: {
    fromEmail:    'finance@pingconmarketing.com',
    fromName:     'Pingcon Logistics RMA',
    replyTo:      'finance@pingconmarketing.com'
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

export const DEFAULT_EMAIL_ROUTING = {
  a2zGroup: {
    mainRecipient: 'azgodev@gmail.com',
    ccRecipients: [
      'mgan@a2z2go.net',
      'AZGan@a2z2go.net',
      'marketing@a2z2go.net',
      'jaezelle.benito@pingconmarketing.com'
    ]
  },
  pingconGroup: {
    mainRecipient: 'azgodev@gmail.com',
    ccRecipients: [
      'mgan@pingconmarketing.com',
      'AZGan@pingconmarketing.com',
      'marketing@pingconmarketing.com',
      'jaezelle.benito@pingconmarketing.com'
    ]
  }
};

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

  return {
    subject,
    from:          sender.fromEmail,
    fromName:      sender.fromName,
    replyTo:       sender.replyTo,
    mainRecipient: toEmail,
    ccList,
    ae:            assignedAE,
    body,
    mailtoUrl,
    group:         a2zBrand ? 'A2Z2GO / KEYSYS' : 'PINGCON / BONITA TISSUE',
    sender,
    isSandbox:     sandbox,
    timestamp:     new Date().toISOString()
  };
}

// ─── Dispatch Trigger ─────────────────────────────────────────────────────────
/**
 * Triggers the dispatch: logs payload, stores in dispatch event log.
 * Falls back to mailto: if no backend SMTP is configured.
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

  // Persist to local dispatch event log
  try {
    const key  = 'rma_email_dispatch_log';
    const logs = JSON.parse(localStorage.getItem(key) || '[]');
    logs.unshift({
      rma_id:     ticket.rma_id,
      timestamp:  new Date().toISOString(),
      subject:    payload.subject,
      from:       payload.from,
      recipients: { to: payload.mainRecipient, cc: payload.ccList },
      ae:         payload.ae.name,
      isSandbox:  payload.isSandbox
    });
    localStorage.setItem(key, JSON.stringify(logs.slice(0, 50)));
  } catch (e) {
    console.error('Failed to log dispatch email:', e);
  }

  return payload;
}
