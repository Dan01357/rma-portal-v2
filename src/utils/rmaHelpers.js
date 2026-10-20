// Utility functions for RMA Portal

/**
 * Generate RMA Ticket ID matching format: RMA-2026-####-[4 alphanumeric chars]
 * Example: RMA-2026-0004-3YNZ
 */
export function generateTicketId(existingCount = 0) {
  const currentYear = new Date().getFullYear(); // e.g. 2026
  const seqNum = String(existingCount + 1).padStart(4, '0');
  
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // exclude ambiguous 0,1,I,O
  let randomSuffix = '';
  for (let i = 0; i < 4; i++) {
    randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return `RMA-${currentYear}-${seqNum}-${randomSuffix}`;
}

/**
 * Warehouse scanner audio confirmation beep (Web Audio API)
 */
export function playBeep(type = 'success') {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1760, audioCtx.currentTime); // A6
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.12);
    } else if (type === 'increment') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1318.5, audioCtx.currentTime); // E6
      gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.09);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.09);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(350, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    }
  } catch (e) {
    // Audio context not allowed before gesture or not supported
    console.debug('Audio play skipped:', e);
  }
}

/**
 * Format Philippine Peso Currency (₱)
 */
export function formatPeso(amount) {
  const num = Number(amount) || 0;
  return '₱' + num.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Format email recipient based on Test Mode toggle
 * Appends .test to any email address if testMode is active
 */
export function applyEmailTestMode(email, isTestMode) {
  if (!email) return '';
  const clean = email.trim();
  if (!isTestMode) return clean;
  if (clean.endsWith('.test')) return clean;
  return `${clean}.test`;
}

/**
 * Compute the complete email routing payload for an RMA ticket
 */
export function getEmailRoutingPayload(ticket, isTestMode = false) {
  const isGroup1 = ticket.group && ticket.group.includes('KEYSYS');
  
  // Group 1 Routing
  if (isGroup1) {
    const sender = 'finance2@a2z2go.net';
    const rawTo = 'azgodev@gmail.com';
    const rawCC = [
      'mgan@a2z2go.net',
      'AZGan@a2z2go.net',
      'marketing@a2z2go.net',
      'jaezelle.benito@pingconmarketing.com',
      ticket.ae_email,
      ticket.supervisor_email
    ].filter(Boolean);

    return {
      groupName: 'Group 1 (KEYSYS & A2Z2GO)',
      sender,
      to: applyEmailTestMode(rawTo, isTestMode),
      cc: rawCC.map(email => applyEmailTestMode(email, isTestMode)),
      rawTo,
      rawCC,
      subject: `[RMA FILED] ${ticket.id} - ${ticket.customer_name} | ${ticket.product_name} (${ticket.quantity} units)`,
      isTestMode
    };
  }

  // Group 2 Routing (Default - Pingcon & Bonita)
  const sender = 'finance@pingconmarketing.com';
  const rawTo = 'azgodev@gmail.com';
  const rawCC = [
    'mgan@pingconmarketing.com',
    'AZGan@pingconmarketing.com',
    'marketing@pingconmarketing.com',
    'jaezelle.benito@pingconmarketing.com',
    ticket.ae_email,
    ticket.supervisor_email
  ].filter(Boolean);

  return {
    groupName: 'Group 2 (PINGCON & BONITA TISSUE)',
    sender,
    to: applyEmailTestMode(rawTo, isTestMode),
    cc: rawCC.map(email => applyEmailTestMode(email, isTestMode)),
    rawTo,
    rawCC,
    subject: `[RMA FILED] ${ticket.id} - ${ticket.customer_name} | ${ticket.product_name} (${ticket.quantity} units)`,
    isTestMode
  };
}

/**
 * Simulated AI Defect Diagnostics Generator
 */
export function generateAiDiagnosis(productName, defectCategory, photosCount = 0) {
  const pName = productName || 'Merchandise';
  const category = defectCategory || 'General Defect';

  const diagnoses = [
    `[AI Diagnostics: Verified 98.7% Confidence] Defect Category: ${category}. Spectral & structural scan reveals micro-fracture along primary carton corrugate and edge collapse. Product contents (${pName}) compromised by humidity ingress. Batch seal integrity breached. Unsellable for premium retail display. Recommendation: Immediate pull-out, issue Credit Memo, and forward batch lot to Quality Control.`,
    `[AI Diagnostics: Computer Vision Verified] Optical surface analysis detected crush deformities exceeding ISO-2233 drop-stress parameters. Retail packaging for ${pName} shows severe seal deformation. Internal hygiene/protective film violated. Recommended Action: Authorize Warehouse Inventory Buffer stock replenishment and supplier debit claim.`,
    `[AI Diagnostics: Automated Inspection Result] Batch defect inspection: Irregular dimensional tolerance detected on packaging unit. ${pName} failed retail shelf scanning alignment. Root cause traced to transit vibration fatigue during primary distributor logistics. Credit authorization approved pending repacker physical audit.`
  ];

  return diagnoses[Math.floor(Math.random() * diagnoses.length)];
}
