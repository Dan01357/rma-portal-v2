/**
 * Smart AE & Email Routing Dispatch System
 * Configures Account Executives and routing rules for wholesale brands:
 * - A2Z2GO / KEYSYS
 * - PINGCON / BONITA TISSUE
 */

export const ACCOUNT_EXECUTIVES = [
  { id: 'galvez', name: 'Rodrigo Galvez', pingconEmail: 'rodrigo.galvez@pingconmarketing.com', a2zEmail: 'rgalvez@a2z2go.net' },
  { id: 'bautista', name: 'Mark Bautista', pingconEmail: 'mark.bautista@pingconmarketing.com', a2zEmail: 'mbautista@a2z2go.net' },
  { id: 'morta', name: 'Dennis Morta', pingconEmail: 'dennis.morta@pingconmarketing.com', a2zEmail: 'dmorta@a2z2go.net' },
  { id: 'valmeo', name: 'Allan Valmeo', pingconEmail: 'allan.valmeo@pingconmarketing.com', a2zEmail: 'avalmeo@a2z2go.net' },
  { id: 'vergara', name: 'Ronald Vergara', pingconEmail: 'ronald.vergara@pingconmarketing.com', a2zEmail: 'rvergara@a2z2go.net' },
  { id: 'dizon', name: 'Christian Dizon', pingconEmail: 'christian.dizon@pingconmarketing.com', a2zEmail: 'cdizon@a2z2go.net' },
  { id: 'duyag', name: 'Jerome Duyag', pingconEmail: 'jerome.duyag@pingconmarketing.com', a2zEmail: 'jduyag@a2z2go.net' },
  { id: 'ichon', name: 'Karen Ichon', pingconEmail: 'karen.ichon@pingconmarketing.com', a2zEmail: 'kichon@a2z2go.net' },
  { id: 'peria', name: 'Paolo Peria', pingconEmail: 'paolo.peria@pingconmarketing.com', a2zEmail: 'pperia@a2z2go.net' },
  { id: 'pitong', name: 'Arnel Pitong', pingconEmail: 'arnel.pitong@pingconmarketing.com', a2zEmail: 'apitong@a2z2go.net' },
  { id: 'ruado', name: 'Michael Ruado', pingconEmail: 'michael.ruado@pingconmarketing.com', a2zEmail: 'mruado@a2z2go.net' },
  { id: 'mallo', name: 'Jeffrey Mallo', pingconEmail: 'jeffrey.mallo@pingconmarketing.com', a2zEmail: 'jmallo@a2z2go.net' }
];

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
    if (raw) {
      return JSON.parse(raw);
    }
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

/**
 * Find AE by name or ID
 */
export function findAE(identifier) {
  if (!identifier) return ACCOUNT_EXECUTIVES[0];
  const query = identifier.trim().toLowerCase();
  return (
    ACCOUNT_EXECUTIVES.find(
      (ae) =>
        ae.name.toLowerCase() === query ||
        ae.name.toLowerCase().includes(query) ||
        ae.id.toLowerCase() === query
    ) || ACCOUNT_EXECUTIVES[0]
  );
}

/**
 * Builds automated email notification payload
 * Subject: [RMA FILED] [Tracking ID] - [Brand] - [Customer Name] - [DR #]
 */
export function buildDispatchEmailPayload(ticket) {
  const config = getEmailRoutingConfig();
  const company = (ticket.company || '').toUpperCase();
  const isA2ZGroup = company.includes('A2Z') || company.includes('KEYSYS');
  
  const rule = isA2ZGroup ? config.a2zGroup : config.pingconGroup;
  const assignedAE = findAE(ticket.assigned_ae);
  const aeEmail = isA2ZGroup ? assignedAE.a2zEmail : assignedAE.pingconEmail;

  // Combine CC list with AE email
  const ccList = Array.from(new Set([aeEmail, ...(rule.ccRecipients || [])]));

  const subject = `[RMA FILED] ${ticket.rma_id || 'RMA-PENDING'} - ${ticket.company || 'BRAND'} - ${ticket.customer_name || 'CUSTOMER'} - ${ticket.delivery_reference || 'NO-DR'}`;

  const body = `
WHOLESALE RMA RETURN MERCHANDISE AUTHORIZATION
============================================================
A new return authorization has been registered in the Supabase vault.

RMA TRACKING ID: ${ticket.rma_id}
FILING DATE    : ${new Date(ticket.created_at || Date.now()).toLocaleString()}
BRAND          : ${ticket.company}
ASSIGNED AE    : ${assignedAE.name} (${aeEmail})

CUSTOMER DETAILS:
- Customer Name : ${ticket.customer_name}
- Delivery Ref  : ${ticket.delivery_reference || 'N/A'}
- Contact Person: ${ticket.contact_person || 'N/A'}
- Contact Phone : ${ticket.contact_phone || 'N/A'}
- Contact Email : ${ticket.contact_email || 'N/A'}

PRODUCT DETAILS:
- Product Name  : ${ticket.product_name}
- SKU / Code    : ${ticket.sku}
- Packaging     : ${ticket.packaging_unit}

DEFECT INSPECTION:
- Defect Reason : ${ticket.defect_category}
- Defect Details: ${ticket.defect_description}
- Proof Photo   : ${ticket.photo_url || 'Attached to vault'}

STATUS: Pending Inspection
============================================================
Supervisor action is required to review defect proof and approve replacement or issue Credit Memo.
`;

  // Construct mailto link for direct client launch
  const mailtoUrl = `mailto:${encodeURIComponent(rule.mainRecipient)}?cc=${encodeURIComponent(ccList.join(','))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return {
    subject,
    mainRecipient: rule.mainRecipient,
    ccList,
    ae: assignedAE,
    body,
    mailtoUrl,
    group: isA2ZGroup ? 'A2Z2GO / KEYSYS' : 'PINGCON / BONITA TISSUE',
    timestamp: new Date().toISOString()
  };
}

/**
 * Simulates or logs dispatch trigger
 */
export async function dispatchRMANotification(ticket) {
  const payload = buildDispatchEmailPayload(ticket);
  console.log('📧 [AUTO-DISPATCH EMAIL TRIGGERED]', payload);
  
  // Store dispatch record in local event log for inspection
  try {
    const key = 'rma_email_dispatch_log';
    const logs = JSON.parse(localStorage.getItem(key) || '[]');
    logs.unshift({
      rma_id: ticket.rma_id,
      timestamp: new Date().toISOString(),
      subject: payload.subject,
      recipients: { to: payload.mainRecipient, cc: payload.ccList },
      ae: payload.ae.name
    });
    localStorage.setItem(key, JSON.stringify(logs.slice(0, 50)));
  } catch (e) {
    console.error('Failed to log dispatch email:', e);
  }

  return payload;
}
