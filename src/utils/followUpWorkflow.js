/**
 * Shared 4-Step RMA Lifecycle Workflow, 10-Calendar-Day Pickup Follow-Up,
 * Schedule Guard (Asia/Manila HH:mm), and Email Template Builders.
 * Pure ES module safe for BOTH browser React components and Vercel Node.js handlers.
 */
import {
  formatDateYmd,
  formatDateTimeYmdHm,
  formatFourChoiceOutcome,
  formatLifecycleStage,
  formatTestEmailSubject,
  cleanExplanationText,
  getConsolidatedPickupItems,
  getRealPhotos,
  hasAssignedSku,
  formatPeso
} from './rmaHelpers.js';

export const FOLLOW_UP_MAX_DAYS = 10;
export const DEFAULT_SANDBOX_EMAIL = 'mgan@pingconmarketing.com';
export const DEFAULT_MATRIX_SEND_TIME_PHT = '13:00';
export const DEFAULT_FOLLOWUP_SEND_TIME_PHT = '08:00';

export const DEFAULT_FOLLOWUP_CONFIG = {
  autoEnabled: true,
  autoSendTimePht: DEFAULT_FOLLOWUP_SEND_TIME_PHT,
  customerFollowUpDefaultEnabled: false
};

export function normalizeSandboxEmail(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return s;
  return DEFAULT_SANDBOX_EMAIL;
}

export function normalizeTimeHhmm(raw, fallback = DEFAULT_MATRIX_SEND_TIME_PHT) {
  const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return fallback;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function formatTime12hFromHhmm(hhmm) {
  const norm = normalizeTimeHhmm(hhmm, '13:00');
  const [hh, mm] = norm.split(':').map(Number);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
}

export function getManilaDateYmd(dateInput = new Date()) {
  return formatDateYmd(dateInput) || new Date().toISOString().slice(0, 10);
}

export function getManilaTimeHhmm(dateInput = new Date()) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput || Date.now());
  if (Number.isNaN(d.getTime())) return '00:00';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Manila',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(d);
    const map = {};
    parts.forEach((p) => {
      if (p.type !== 'literal') map[p.type] = p.value;
    });
    const hh = map.hour === '24' ? '00' : String(map.hour || '00').padStart(2, '0');
    const mm = String(map.minute || '00').padStart(2, '0');
    return `${hh}:${mm}`;
  } catch {
    const utcMs = d.getTime() + 8 * 60 * 60 * 1000;
    const pht = new Date(utcMs);
    return `${String(pht.getUTCHours()).padStart(2, '0')}:${String(pht.getUTCMinutes()).padStart(2, '0')}`;
  }
}

export function hasReachedManilaSchedule(targetHhmm = '13:00', nowDate = new Date()) {
  const target = normalizeTimeHhmm(targetHhmm, '13:00');
  const current = getManilaTimeHhmm(nowDate);
  const [th, tm] = target.split(':').map(Number);
  const [ch, cm] = current.split(':').map(Number);
  return ch * 60 + cm >= th * 60 + tm;
}

export function formatMonthDayYear(dateInput) {
  if (!dateInput) return '';
  const ymd = formatDateYmd(dateInput);
  if (!ymd) return '';
  try {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 4, 0, 0));
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      month: 'short',
      day: '2-digit',
      year: 'numeric'
    }).format(dt);
  } catch {
    return ymd;
  }
}

export function formatMonthDayYearHm(dateInput) {
  if (!dateInput) return '';
  const hm = formatDateTimeYmdHm(dateInput);
  const ymd = hm ? hm.slice(0, 10) : formatDateYmd(dateInput);
  const timePart = hm && hm.length >= 16 ? hm.slice(11, 16) : '';
  const mdy = formatMonthDayYear(ymd);
  if (!mdy) return hm || '';
  return timePart ? `${mdy} ${timePart}` : mdy;
}

export function addManilaCalendarDaysYmd(ymd, offsetDays) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + Number(offsetDays || 0)));
  return utc.toISOString().slice(0, 10);
}

export function diffManilaCalendarDays(startVal, nowDate = new Date()) {
  const startYmd = getManilaDateYmd(startVal);
  const endYmd = getManilaDateYmd(nowDate);
  if (!startYmd || !endYmd) return 0;
  const [sy, sm, sd] = startYmd.split('-').map(Number);
  const [ey, em, ed] = endYmd.split('-').map(Number);
  const sUtc = Date.UTC(sy, sm - 1, sd);
  const eUtc = Date.UTC(ey, em - 1, ed);
  return Math.max(0, Math.round((eUtc - sUtc) / 86400000));
}

export function isPlaceholderSupplier(val) {
  const s = String(val || '').trim().toLowerCase();
  return (
    !s ||
    s === 'pending assignment' ||
    s === 'pending' ||
    s === 'unassigned' ||
    s === 'warehouse' ||
    s === 'n/a' ||
    s === 'direct return'
  );
}

export function splitEmailStringOrList(raw) {
  if (!raw) return [];
  const items = Array.isArray(raw) ? raw : String(raw).split(/[,;\s]+/);
  const unique = new Set();
  for (const entry of items) {
    const clean = String(entry || '').trim().toLowerCase();
    if (clean && clean.includes('@') && clean.includes('.') && !clean.endsWith('.test')) {
      unique.add(clean);
    }
  }
  return Array.from(unique);
}

function escapeHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function resolveReportPartyAndEmails(report, catalogProducts = []) {
  const meta = (report?.ai_document_metadata && typeof report.ai_document_metadata === 'object')
    ? report.ai_document_metadata
    : {};
  const pickup = (meta.supplier_pickup && typeof meta.supplier_pickup === 'object')
    ? meta.supplier_pickup
    : {};
  const followUp = (meta.follow_up && typeof meta.follow_up === 'object')
    ? meta.follow_up
    : {};

  const bc = String(report?.barcode || '').trim();
  const matchedCatalog = (Array.isArray(catalogProducts) && bc)
    ? catalogProducts.find((p) => p?.barcode && String(p.barcode).trim() === bc)
    : null;

  const supplierCandidate = [
    pickup.supplier_name,
    report?.supplier_name,
    report?.supplierName,
    report?.supplier,
    matchedCatalog?.supplier_name,
    matchedCatalog?.supplierName
  ].find((cand) => !isPlaceholderSupplier(cand));

  const supplierName = supplierCandidate ? String(supplierCandidate).trim() : '';
  const hasValidSupplier = Boolean(supplierName);

  const isSupplierStream = report?.rma_type === 'supplier_outbound';
  const customerBranch = !isPlaceholderSupplier(pickup.customer_name)
    ? String(pickup.customer_name).trim()
    : (!isPlaceholderSupplier(report?.store_branch) ? String(report.store_branch).trim() : '');

  const supplierEmailTo = String(followUp.supplier_email_to ?? pickup.supplier_email_to ?? '').trim();
  const supplierEmailCc = String(followUp.supplier_email_cc ?? pickup.supplier_email_cc ?? '').trim();

  const toEmails = splitEmailStringOrList(supplierEmailTo);
  const ccEmails = splitEmailStringOrList(supplierEmailCc).filter((e) => !toEmails.includes(e));

  return {
    supplierName: supplierName || 'Pending Assignment',
    hasValidSupplier,
    customerBranch: customerBranch || 'Wholesale Customer',
    supplierEmailTo,
    supplierEmailCc,
    toEmails,
    ccEmails,
    aeEmail: String(report?.ae_email || '').trim().toLowerCase(),
    pickupMeta: pickup,
    followUpMeta: followUp,
    meta
  };
}

/**
 * Computes the complete 4-Step Workflow & 10-Calendar-Day SLA state for an RMA report.
 */
export function computeFourStepWorkflow(report, catalogProducts = [], options = {}) {
  const nowDate = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const stream = report?.rma_type === 'supplier_outbound' ? 'supplier_outbound' : 'customer_inbound';
  const isSupplierStream = stream === 'supplier_outbound';
  const party = resolveReportPartyAndEmails(report, catalogProducts);
  const { meta, pickupMeta, followUpMeta } = party;

  const statusLower = String(report?.status || '').toLowerCase().trim();
  const workflowRes = String(meta.workflow_resolution || '').toLowerCase().trim();
  const dispLower = String(meta.simple_rtv_disposition || pickupMeta.disposition || report?.disposition || '').toLowerCase().trim();
  const outcome = formatFourChoiceOutcome(report);

  const pickedUpAtIso =
    pickupMeta.picked_up_at ||
    followUpMeta.picked_up_at ||
    (['picked_up', 'picked_up_by_supplier', 'buffer_replacement_dispatched', 'buffer_dispatched'].includes(statusLower)
      ? (pickupMeta.updated_at || meta.simple_rtv_updated_at || report?.updated_at || null)
      : null);

  const autoDisposedAtIso =
    followUpMeta.auto_disposed_at ||
    (followUpMeta.case_status === 'auto_disposed_after_10_days'
      ? followUpMeta.case_closed_at
      : null);

  const isAutoDisposed = Boolean(followUpMeta.auto_disposed_at) || followUpMeta.case_status === 'auto_disposed_after_10_days';
  const isAutoClosed = followUpMeta.case_status === 'auto_closed_10_days' || isAutoDisposed;

  const isRestocked = workflowRes === 'restocked' || statusLower === 'restocked';
  const isScrapped =
    isAutoDisposed ||
    workflowRes === 'reordered' ||
    workflowRes === 'scrapped_no_reorder' ||
    statusLower === 'scrapped' ||
    statusLower === 'disposed';
  const isCreditMemoIssued =
    statusLower === 'credit_memo_issued' ||
    Boolean(report?.credit_memo_number || report?.credit_memo_no);
  const isRejected = statusLower === 'rejected' || dispLower.includes('8- rejected');

  const caseClosedAtIso =
    followUpMeta.case_closed_at ||
    pickedUpAtIso ||
    ((isRestocked || isScrapped || isRejected || statusLower === 'resolved' || statusLower === 'closed' || (stream === 'customer_inbound' && isCreditMemoIssued && followUpMeta.enabled !== true))
      ? (meta.resolved_at || meta.simple_rtv_updated_at || report?.inspected_at || report?.updated_at || null)
      : null);

  const isPickedUp = Boolean(pickedUpAtIso) || outcome.isPickedUp;
  const isClosed = Boolean(
    caseClosedAtIso ||
    isPickedUp ||
    isRestocked ||
    isScrapped ||
    isRejected ||
    statusLower === 'resolved' ||
    statusLower === 'closed'
  );

  let followUpEnabled = false;
  if (followUpMeta.enabled === false) {
    followUpEnabled = false;
  } else if (followUpMeta.enabled === true) {
    followUpEnabled = true;
  } else if (isSupplierStream) {
    followUpEnabled = party.hasValidSupplier;
  } else {
    followUpEnabled = Boolean(options.customerFollowUpDefaultEnabled);
  }

  const reportDateIso = report?.created_at || followUpMeta.started_at || meta.simple_rtv_updated_at || report?.updated_at || nowDate.toISOString();
  const startedAtIso =
    followUpMeta.started_at ||
    (isSupplierStream && party.hasValidSupplier
      ? (report?.created_at || meta.simple_rtv_updated_at || report?.updated_at || nowDate.toISOString())
      : (report?.created_at || report?.updated_at || nowDate.toISOString()));

  const calendarDay = diffManilaCalendarDays(startedAtIso, nowDate);
  const isCountdownActive = !isClosed && followUpEnabled && (!isSupplierStream || party.hasValidSupplier || followUpMeta.enabled === true);
  const isExpiredAfter10Days = isCountdownActive && calendarDay > FOLLOW_UP_MAX_DAYS;
  const todayManila = getManilaDateYmd(nowDate);
  const lastSentPhtDate = String(followUpMeta.last_sent_pht_date || '').trim() || null;
  const alreadySentToday = lastSentPhtDate === todayManila;
  const sentCount = Number(followUpMeta.sent_count || 0);

  // Build Day 0..Day 10 timeline matrix anchored on Manila calendar dates
  const day0Ymd = getManilaDateYmd(reportDateIso) || getManilaDateYmd(startedAtIso);
  const dispatchedPhtDates = new Set();
  const dispatchedDays = new Set();
  if (lastSentPhtDate) dispatchedPhtDates.add(lastSentPhtDate);
  if (followUpMeta.last_sent_day !== undefined && followUpMeta.last_sent_day !== null) {
    dispatchedDays.add(Number(followUpMeta.last_sent_day));
  }
  if (Array.isArray(report?.audit_trail)) {
    report.audit_trail.forEach((entry) => {
      if (entry?.action === 'FOLLOWUP_EMAIL_SENT' && entry?.timestamp) {
        const y = getManilaDateYmd(entry.timestamp);
        if (y) dispatchedPhtDates.add(y);
      }
    });
  }

  const pickedUpDayIdx = pickedUpAtIso && day0Ymd
    ? diffManilaCalendarDays(`${day0Ymd}T00:00:00+08:00`, pickedUpAtIso)
    : null;
  const pickedUpDisplayHm = pickedUpAtIso ? formatMonthDayYearHm(pickedUpAtIso) : '';
  const currentDayFromReport = day0Ymd
    ? diffManilaCalendarDays(`${day0Ymd}T00:00:00+08:00`, nowDate)
    : calendarDay;
  const exceededAfter10 = !isPickedUp && (isAutoDisposed || (!isClosed && calendarDay > FOLLOW_UP_MAX_DAYS));

  const timelineDays = [];
  if (day0Ymd) {
    const day0Display = formatMonthDayYearHm(reportDateIso) || formatMonthDayYear(day0Ymd);
    timelineDays.push({
      day: 0,
      dateYmd: day0Ymd,
      dateLabel: day0Display,
      statusText: pickedUpAtIso && pickedUpDayIdx === 0
        ? `Yes — Picked up on ${pickedUpDisplayHm}`
        : `Report Logged (${day0Display})`,
      state: pickedUpAtIso && pickedUpDayIdx === 0 ? 'picked_up' : 'reported'
    });

    for (let d = 1; d <= FOLLOW_UP_MAX_DAYS; d++) {
      const dYmd = addManilaCalendarDaysYmd(day0Ymd, d);
      const dDateLabel = formatMonthDayYear(`${dYmd}T12:00:00+08:00`) || dYmd;
      const wasPickedUpOnDay = Boolean(pickedUpAtIso) && pickedUpDayIdx === d;
      const wasPickedUpEarlier = Boolean(pickedUpAtIso) && pickedUpDayIdx !== null && pickedUpDayIdx < d;
      const wasDispatched = dispatchedPhtDates.has(dYmd) || dispatchedDays.has(d);

      let statusText = 'Upcoming';
      let state = 'upcoming';

      if (wasPickedUpOnDay) {
        statusText = `Yes — Picked up on ${pickedUpDisplayHm}`;
        state = 'picked_up';
      } else if (wasPickedUpEarlier) {
        statusText = `Halted — Picked up on ${pickedUpDisplayHm}`;
        state = 'halted';
      } else if (exceededAfter10) {
        if (d === FOLLOW_UP_MAX_DAYS) {
          statusText = 'Exceeded Day 10 — Auto-Scrapped & Case Closed';
          state = 'expired';
        } else {
          statusText = wasDispatched ? 'No — Daily follow-up dispatched' : 'No — Not picked up';
          state = 'past';
        }
      } else if (isClosed) {
        statusText = `Halted — Case closed (${formatMonthDayYearHm(caseClosedAtIso || nowDate)})`;
        state = 'halted';
      } else if (d <= currentDayFromReport) {
        if (wasDispatched) {
          statusText = 'No — Daily follow-up dispatched';
          state = 'dispatched';
        } else {
          statusText = 'No — Waiting for pickup';
          state = 'waiting';
        }
      }

      timelineDays.push({
        day: d,
        dateYmd: dYmd,
        dateLabel: dDateLabel,
        statusText,
        state
      });
    }
  }

  const step1 = {
    key: 'report_date',
    label: 'Step 1: Report Date',
    dateIso: reportDateIso,
    dateYmd: formatDateYmd(reportDateIso),
    dateDisplay: formatMonthDayYearHm(reportDateIso) || 'N/A',
    done: true
  };

  const step2Text = isClosed
    ? (isAutoDisposed ? 'Exceeded Day 10 — Auto-Scrapped' : isPickedUp ? 'Completed (Picked Up)' : 'Closed')
    : !followUpEnabled
      ? (isSupplierStream && !party.hasValidSupplier ? 'Waiting Supplier Info' : 'Waiting Pickup Tracking')
      : calendarDay > FOLLOW_UP_MAX_DAYS
        ? `Exceeded Day 10 (Day ${calendarDay})`
        : `Day ${calendarDay} of ${FOLLOW_UP_MAX_DAYS}`;

  const step2 = {
    key: 'waiting_pickup',
    label: isSupplierStream ? 'Step 2: Waiting For Pickup' : 'Step 2: Waiting For Handover',
    calendarDay,
    maxDays: FOLLOW_UP_MAX_DAYS,
    status: isClosed ? 'completed' : isExpiredAfter10Days ? 'expired' : (isCountdownActive ? 'active' : 'paused'),
    text: step2Text,
    exceededAfter10,
    timelineDays,
    lastSentPhtDate,
    sentCount,
    done: isClosed
  };

  const step3DateDisplay = pickedUpAtIso
    ? `Picked up on ${pickedUpDisplayHm}`
    : (isAutoDisposed || isAutoClosed || isExpiredAfter10Days
        ? 'Not Picked Up (Auto-Scrapped after Day 10)'
        : 'Pending Pickup');

  const step3 = {
    key: 'pickup_date',
    label: 'Step 3: Driver Picked Up Date',
    dateIso: pickedUpAtIso,
    dateYmd: pickedUpAtIso ? formatDateYmd(pickedUpAtIso) : '',
    dateDisplay: step3DateDisplay,
    done: Boolean(pickedUpAtIso)
  };

  const step4Reason = isAutoDisposed
    ? 'Auto-Scrapped (>10 Days)'
    : followUpMeta.case_status === 'auto_closed_10_days'
      ? 'Auto-Closed (>10 Days)'
      : isPickedUp
        ? 'Picked Up — Case Closed'
        : isRestocked
          ? 'Restocked'
          : isScrapped
            ? 'Scrapped / Disposed'
            : isCreditMemoIssued
              ? 'Credit Memo Issued'
              : isClosed
                ? 'Case Closed'
                : 'Open';

  const step4Display = isClosed
    ? `Case Closed (${formatMonthDayYearHm(caseClosedAtIso || nowDate)})`
    : 'Open';

  const step4 = {
    key: 'case_close',
    label: 'Step 4: Case Close',
    dateIso: caseClosedAtIso,
    dateYmd: caseClosedAtIso ? formatDateYmd(caseClosedAtIso) : '',
    dateDisplay: step4Display,
    reason: step4Reason,
    done: isClosed
  };

  const activeStepNumber = isClosed ? 4 : isPickedUp ? 3 : 2;
  const stepSummary = isClosed
    ? `Step 4: ${step4Reason}`
    : isCountdownActive
      ? (calendarDay > FOLLOW_UP_MAX_DAYS
          ? `Step 2: Exceeded Day 10 (Day ${calendarDay})`
          : `Step 2: Waiting (Day ${calendarDay} of 10)`)
      : (isSupplierStream && !party.hasValidSupplier
          ? 'Step 2: Waiting Supplier Info'
          : 'Step 2: Intake / Triage');

  return {
    stream,
    isSupplierStream,
    party,
    startedAtIso,
    startedAtYmd: formatDateYmd(startedAtIso),
    startedAtDisplay: formatMonthDayYearHm(startedAtIso),
    calendarDay,
    maxDays: FOLLOW_UP_MAX_DAYS,
    followUpEnabled,
    isCountdownActive,
    isClosed,
    isPickedUp,
    isScrapped,
    isRestocked,
    isAutoDisposed,
    isAutoClosed,
    isCreditMemoIssued,
    isRejected,
    isExpiredAfter10Days,
    lastSentPhtDate,
    alreadySentToday,
    sentCount,
    pickedUpAtIso,
    pickedUpAtYmd: step3.dateYmd,
    caseClosedAtIso,
    caseClosedAtYmd: step4.dateYmd,
    activeStepNumber,
    stepSummary,
    timelineDays,
    step1,
    step2,
    step3,
    step4,
    outcome
  };
}

/**
 * Resolves a human-readable status label (zero raw DB snake_case strings)
 * for Supplier Claims, Customer Hub, and Excel exports.
 */
export function getCleanHumanWorkflowStatus(report, catalogProducts = [], options = {}) {
  const wf = computeFourStepWorkflow(report, catalogProducts, options);
  const statusLower = String(report?.status || '').toLowerCase().trim();
  const skuAssigned = hasAssignedSku(report, catalogProducts);

  if (wf.isAutoDisposed) {
    return {
      label: 'Auto-Disposed (>10 Days)',
      badgeColor: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-700',
      workflow: wf
    };
  }
  if (wf.isAutoClosed) {
    return {
      label: 'Auto-Closed (>10 Days)',
      badgeColor: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-700',
      workflow: wf
    };
  }
  if (wf.isPickedUp) {
    return {
      label: wf.outcome.formType === 'replacement' ? 'Picked Up (Replaced) — Case Closed' : 'Picked Up — Case Closed',
      badgeColor: 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-700',
      workflow: wf
    };
  }
  if (wf.isCreditMemoIssued) {
    return {
      label: 'Credit Memo Issued',
      badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-700',
      workflow: wf
    };
  }
  if (wf.isRestocked) {
    return {
      label: 'Restocked to Good Stock',
      badgeColor: 'bg-teal-50 text-teal-800 border-teal-300 dark:bg-teal-950/70 dark:text-teal-300 dark:border-teal-700',
      workflow: wf
    };
  }
  if (wf.isScrapped) {
    const resolvedStage = formatLifecycleStage(report?.status, report);
    return {
      label: resolvedStage?.label || 'Scrapped / Disposed',
      badgeColor: 'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-700',
      workflow: wf
    };
  }
  if (wf.isRejected) {
    return {
      label: 'Claim Rejected',
      badgeColor: 'bg-slate-200 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
      workflow: wf
    };
  }
  if (wf.isExpiredAfter10Days) {
    return {
      label: `10-Day Window Expired (Day ${wf.calendarDay})`,
      badgeColor: 'bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950/80 dark:text-rose-200 dark:border-rose-700',
      workflow: wf
    };
  }
  if (wf.isCountdownActive) {
    return {
      label: wf.isSupplierStream
        ? `Waiting Pickup (Day ${wf.calendarDay} of 10)`
        : `Waiting Handover (Day ${wf.calendarDay} of 10)`,
      badgeColor: wf.calendarDay >= 8
        ? 'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-700'
        : 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-700',
      workflow: wf
    };
  }
  if (!skuAssigned || statusLower === 'pending_admin_details') {
    return {
      label: 'Awaiting SKU',
      badgeColor: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/70 dark:text-orange-300 dark:border-orange-800',
      workflow: wf
    };
  }
  if (wf.isSupplierStream && !wf.party.hasValidSupplier) {
    return {
      label: 'Needs Supplier & Email',
      badgeColor: 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-700',
      workflow: wf
    };
  }
  if (wf.outcome.hasDecision) {
    return {
      label: wf.outcome.shortStatus,
      badgeColor: wf.outcome.badgeColor,
      workflow: wf
    };
  }
  const fallbackStage = formatLifecycleStage(report?.status, report);
  return {
    label: fallbackStage?.label || 'Pending Triage',
    badgeColor: fallbackStage?.color || 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    workflow: wf
  };
}

export function buildFollowUpEmailSubject({ report, supplierName, calendarDay, isTestMode = false, now = new Date() }) {
  const rmaNumber = report?.rma_number || report?.rmaNumber || 'RMA-PENDING';
  const monthDayYr = formatMonthDayYear(now);
  const clampedDay = Math.max(0, Math.min(FOLLOW_UP_MAX_DAYS, Number(calendarDay || 0)));
  const isSupplier = report?.rma_type === 'supplier_outbound';
  const partyLabel = supplierName || 'Pending Assignment';
  const base = isSupplier
    ? `[Follow-Up | ${monthDayYr} — Day ${clampedDay} of ${FOLLOW_UP_MAX_DAYS}] ${rmaNumber}: Waiting for Supplier Pickup (${partyLabel})`
    : `[Follow-Up | ${monthDayYr} — Day ${clampedDay} of ${FOLLOW_UP_MAX_DAYS}] ${rmaNumber}: Waiting for Customer Handover (${partyLabel})`;
  return formatTestEmailSubject(base, isTestMode);
}

export function renderWorkflowStepsHtml(wf) {
  const rows = [
    { step: 'Step 1: Report Date', status: wf.step1.dateDisplay, detail: `ISO (YYYY-MM-DD): ${wf.step1.dateYmd || 'N/A'}` },
    { step: 'Step 2: Waiting For Pickup (10 Calendar Days Max)', status: wf.step2.text, detail: `Day ${Math.min(wf.calendarDay, wf.maxDays)} of ${wf.maxDays} Calendar Days (Asia/Manila)` },
    { step: 'Step 3: Driver Picked Up Date', status: wf.step3.dateDisplay, detail: wf.step3.dateYmd ? `ISO (YYYY-MM-DD): ${wf.step3.dateYmd}` : 'Did the RMA get picked up yet?' },
    { step: 'Step 4: Case Close', status: wf.step4.dateDisplay, detail: wf.step4.reason }
  ];

  const days = Array.isArray(wf.timelineDays) ? wf.timelineDays : [];

  return `
    <table style="width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px;">
      <thead>
        <tr>
          <th style="background: #0f172a; color: #ffffff; text-align: left; padding: 8px; font-size: 11px; text-transform: uppercase;">4-Step Workflow Stage</th>
          <th style="background: #0f172a; color: #ffffff; text-align: left; padding: 8px; font-size: 11px; text-transform: uppercase;">Status / Date &amp; Time</th>
          <th style="background: #0f172a; color: #ffffff; text-align: left; padding: 8px; font-size: 11px; text-transform: uppercase;">Details</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-weight: 700; color: #0f172a;">${escapeHtml(r.step)}</td>
            <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-weight: 800; color: #1e3a8a; font-family: monospace;">${escapeHtml(r.status)}</td>
            <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #475569;">${escapeHtml(r.detail)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    ${days.length > 0 ? `
    <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: #475569; margin: 14px 0 6px;">Step 2 Daily Pickup Tracker — Day 0 to Day 10 (Did the RMA get picked up?)</div>
    <table style="width: 100%; border-collapse: collapse; font-size: 11px; border: 1px solid #e2e8f0;">
      <thead>
        <tr>
          <th style="background: #f1f5f9; color: #334155; text-align: left; padding: 6px 8px; border-bottom: 1px solid #cbd5e1;">Day &amp; Manila Date</th>
          <th style="background: #f1f5f9; color: #334155; text-align: left; padding: 6px 8px; border-bottom: 1px solid #cbd5e1;">Did the RMA get picked up?</th>
        </tr>
      </thead>
      <tbody>
        ${days.map((d) => {
          const badgeColor = d.state === 'picked_up'
            ? '#065f46'
            : d.state === 'expired'
              ? '#9f1239'
              : d.state === 'dispatched'
                ? '#3730a3'
                : d.state === 'waiting' || d.state === 'past'
                  ? '#92400e'
                  : '#64748b';
          return `
            <tr>
              <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-family: monospace; font-weight: 700; color: #0f172a;">
                ${escapeHtml(d.day === 0 ? `Day 0 (Report Date): ${d.dateLabel}` : `Day ${d.day} (${d.dateLabel})`)}
              </td>
              <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-weight: 700; color: ${badgeColor};">
                ${escapeHtml(d.statusText)}
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>` : ''}
  `;
}

function renderItemsAndPhotosHtml(report, allReports, catalogProducts) {
  const { items: itemsTable } = getConsolidatedPickupItems({
    report,
    reports: [report],
    allReports: allReports || [report],
    catalogProducts,
    combineIdentical: false
  });
  const rows = itemsTable.length > 0 ? itemsTable : [{
    idx: 1,
    name: report?.name || report?.barcode || 'Returned Item',
    cleanSku: report?.code || report?.sku || '',
    barcode: report?.barcode || '',
    totalPieces: Number(report?.quantity || 1),
    unitName: report?.unit_name || 'pc',
    reason: report?.reason || 'Damaged / Defective',
    explanation: cleanExplanationText(report?.explanation || '')
  }];

  const photos = getRealPhotos(report?.photos || []);
  const tableHtml = `
    <table style="width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px;">
      <thead>
        <tr>
          <th style="background: #0f172a; color: #ffffff; text-align: left; padding: 8px; font-size: 11px;">Item / SKU / Barcode</th>
          <th style="background: #0f172a; color: #ffffff; text-align: right; padding: 8px; font-size: 11px;">Qty</th>
          <th style="background: #0f172a; color: #ffffff; text-align: left; padding: 8px; font-size: 11px;">Reason &amp; Explanation</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((it) => `
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">
              <div style="font-weight: 700; color: #0f172a;">${escapeHtml(it.name)}</div>
              <div style="font-size: 11px; color: #64748b; font-family: monospace;">
                ${it.cleanSku ? `SKU: ${escapeHtml(it.cleanSku)}` : ''}${it.cleanSku && it.barcode ? ' • ' : ''}${it.barcode ? `BC: ${escapeHtml(it.barcode)}` : ''}
              </div>
            </td>
            <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 800; font-family: monospace; white-space: nowrap;">
              ${Number(it.totalPieces || 1).toLocaleString()} ${escapeHtml(it.unitName || 'pc')}
            </td>
            <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #334155;">
              <div style="font-weight: 700; color: #be123c;">${escapeHtml(it.reason || report?.reason || 'Damaged')}</div>
              ${it.explanation ? `<div style="font-size: 11px; color: #475569; margin-top: 2px;">${escapeHtml(it.explanation)}</div>` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  const photosHtml = photos.length > 0
    ? `
      <div style="margin-top: 16px;">
        <div style="font-size: 12px; font-weight: 800; text-transform: uppercase; color: #475569; margin-bottom: 8px;">Proof Photos (${photos.length})</div>
        ${photos.slice(0, 6).map((url, idx) => `
          <div style="margin-bottom: 10px; text-align: center;">
            <img src="${escapeHtml(url)}" alt="Proof Photo ${idx + 1}" style="max-width: 100%; max-height: 280px; border-radius: 10px; border: 1px solid #cbd5e1;" />
          </div>
        `).join('')}
      </div>
    `
    : '';

  return { rows, photos, tableHtml, photosHtml };
}

export function buildFollowUpEmailContent({
  report,
  allReports = [],
  catalogProducts = [],
  workflow = null,
  isTestMode = false,
  sandboxEmail = DEFAULT_SANDBOX_EMAIL,
  now = new Date()
}) {
  const wf = workflow || computeFourStepWorkflow(report, catalogProducts, { now });
  const rmaNumber = report?.rma_number || report?.rmaNumber || 'RMA-PENDING';
  const partyName = wf.isSupplierStream ? wf.party.supplierName : (wf.party.supplierName !== 'Pending Assignment' ? wf.party.supplierName : wf.party.customerBranch);
  const subject = buildFollowUpEmailSubject({
    report,
    supplierName: partyName,
    calendarDay: wf.calendarDay,
    isTestMode,
    now
  });

  const { rows, photos, tableHtml, photosHtml } = renderItemsAndPhotosHtml(report, allReports, catalogProducts);
  const warningText = wf.isSupplierStream
    ? 'Waiting for supplier to pick up bad order for only 10 calendar days. After 10 calendar days, items will be automatically disposed of / scrapped due to health and sanitation risks.'
    : 'Waiting for pickup / handover completion within 10 calendar days. After 10 calendar days, held items may be automatically closed / disposed of due to health and sanitation risks.';

  const daysRemaining = Math.max(0, FOLLOW_UP_MAX_DAYS - wf.calendarDay);
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b;">
      <div style="max-width: 660px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden;">
        <div style="background: #92400e; padding: 22px 26px; color: #ffffff;">
          <div style="display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 800; text-transform: uppercase; background: rgba(255,255,255,0.2); margin-bottom: 8px;">
            ${isTestMode ? `[TEST] DAY ${wf.calendarDay} OF 10 FOLLOW-UP` : `DAY ${wf.calendarDay} OF 10 PICKUP FOLLOW-UP`}
          </div>
          <h1 style="margin: 0; font-size: 19px; font-weight: 800;">${isTestMode ? '[TEST] ' : ''}Bad Order Pickup Follow-Up: ${escapeHtml(rmaNumber)}</h1>
          <div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">
            ${wf.isSupplierStream ? 'Supplier / Vendor' : 'Customer / Party'}: <strong>${escapeHtml(partyName)}</strong> • ${daysRemaining} calendar day(s) remaining in 10-day window
          </div>
        </div>
        <div style="padding: 24px;">
          ${isTestMode ? `
          <div style="background: #fef3c7; border: 2px dashed #f59e0b; color: #92400e; padding: 10px 14px; border-radius: 10px; margin-bottom: 16px; font-size: 12px; font-weight: 700;">
            🧪 TEST MODE ACTIVE — Delivered safely to ${escapeHtml(normalizeSandboxEmail(sandboxEmail))} only.
          </div>` : ''}

          <div style="background: #fff1f2; border: 2px solid #fda4af; color: #881337; padding: 14px 16px; border-radius: 12px; margin-bottom: 18px; font-size: 13px; line-height: 1.5;">
            <div style="font-weight: 900; text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; margin-bottom: 4px;">⚠️ 10-Calendar-Day Health &amp; Sanitation Disposal Notice</div>
            <strong>${escapeHtml(warningText)}</strong>
          </div>

          <div style="font-size: 12px; font-weight: 800; text-transform: uppercase; color: #475569; margin-bottom: 4px;">4-Step Workflow &amp; Dates (${escapeHtml(rmaNumber)})</div>
          ${renderWorkflowStepsHtml(wf)}

          <div style="font-size: 12px; font-weight: 800; text-transform: uppercase; color: #475569; margin: 18px 0 4px;">Item Details</div>
          ${tableHtml}
          ${photosHtml}
        </div>
        <div style="background: #f1f5f9; padding: 14px 24px; font-size: 11px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0;">
          Pingcon Marketing Operations • Automated 10-Calendar-Day RMA Follow-Up Reminder (${escapeHtml(getManilaDateYmd(now))} Asia/Manila)
        </div>
      </div>
    </body>
    </html>
  `;

  const timelineText = Array.isArray(wf.timelineDays)
    ? wf.timelineDays.map((d) => (
        d.day === 0
          ? `  - Day 0 (Report Date): ${d.dateLabel} => ${d.statusText}`
          : `  - Day ${d.day} (${d.dateLabel}) => ${d.statusText}`
      ))
    : [];

  const text = [
    subject,
    `${wf.isSupplierStream ? 'Supplier' : 'Party'}: ${partyName}`,
    warningText,
    `Step 1 (Report Date): ${wf.step1.dateDisplay} | Step 2: ${wf.step2.text} | Step 3 (Driver Picked Up): ${wf.step3.dateDisplay} | Step 4 (Case Close): ${wf.step4.dateDisplay}`,
    ...timelineText,
    ...rows.map((it) => `- ${it.name} (${it.totalPieces} ${it.unitName}) • ${it.reason || 'Damaged'}${it.explanation ? ` | ${it.explanation}` : ''}`),
    ...(photos.length > 0 ? [`Proof Photos: ${photos.join(', ')}`] : [])
  ].join('\n');

  return { subject, html, text };
}

export function buildAutoDisposedEmailContent({
  report,
  allReports = [],
  catalogProducts = [],
  workflow = null,
  isTestMode = false,
  sandboxEmail = DEFAULT_SANDBOX_EMAIL,
  now = new Date()
}) {
  const wf = workflow || computeFourStepWorkflow(report, catalogProducts, { now });
  const rmaNumber = report?.rma_number || report?.rmaNumber || 'RMA-PENDING';
  const partyName = wf.isSupplierStream ? wf.party.supplierName : (wf.party.supplierName !== 'Pending Assignment' ? wf.party.supplierName : wf.party.customerBranch);
  const rawSub = wf.isSupplierStream
    ? `[Auto-Disposed >10 Days] ${rmaNumber}: Unclaimed Supplier Bad Order Disposed (${partyName})`
    : `[Auto-Closed >10 Days] ${rmaNumber}: 10-Day Handover Window Elapsed (${partyName})`;
  const subject = formatTestEmailSubject(rawSub, isTestMode);

  const { rows, photos, tableHtml, photosHtml } = renderItemsAndPhotosHtml(report, allReports, catalogProducts);

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b;">
      <div style="max-width: 660px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden;">
        <div style="background: #9f1239; padding: 22px 26px; color: #ffffff;">
          <div style="display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 800; text-transform: uppercase; background: rgba(255,255,255,0.2); margin-bottom: 8px;">
            ${isTestMode ? '[TEST] 10-DAY SLA AUTO-DISPOSED' : '10-DAY SLA AUTO-DISPOSED & CLOSED'}
          </div>
          <h1 style="margin: 0; font-size: 19px; font-weight: 800;">${isTestMode ? '[TEST] ' : ''}RMA Auto-Disposed After 10 Calendar Days: ${escapeHtml(rmaNumber)}</h1>
          <div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">
            ${wf.isSupplierStream ? 'Supplier / Vendor' : 'Customer / Party'}: <strong>${escapeHtml(partyName)}</strong> • Case automatically closed on ${escapeHtml(formatDateTimeYmdHm(now))} (Asia/Manila)
          </div>
        </div>
        <div style="padding: 24px;">
          ${isTestMode ? `
          <div style="background: #fef3c7; border: 2px dashed #f59e0b; color: #92400e; padding: 10px 14px; border-radius: 10px; margin-bottom: 16px; font-size: 12px; font-weight: 700;">
            🧪 TEST MODE ACTIVE — Delivered safely to ${escapeHtml(normalizeSandboxEmail(sandboxEmail))} only.
          </div>` : ''}

          <div style="background: #fff1f2; border: 1px solid #fecdd3; color: #881337; padding: 14px 16px; border-radius: 12px; margin-bottom: 18px; font-size: 13px;">
            The 10-calendar-day pickup window (${wf.step1.dateYmd} to ${wf.step4.dateYmd || getManilaDateYmd(now)}) expired with no pickup recorded. This item has been automatically marked <strong>Scrapped / Disposed</strong> (<strong>Disposal / Scrap Area</strong>) due to health and sanitation risks, and the case is now closed.
          </div>

          <div style="font-size: 12px; font-weight: 800; text-transform: uppercase; color: #475569; margin-bottom: 4px;">4-Step Workflow &amp; Closure Audit</div>
          ${renderWorkflowStepsHtml(wf)}

          <div style="font-size: 12px; font-weight: 800; text-transform: uppercase; color: #475569; margin: 18px 0 4px;">Disposed Item Summary</div>
          ${tableHtml}
          ${photosHtml}
        </div>
        <div style="background: #f1f5f9; padding: 14px 24px; font-size: 11px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0;">
          Pingcon Marketing Operations • Dispatched to Configured New RMA Alert Recipients + Customer AE
        </div>
      </div>
    </body>
    </html>
  `;

  const text = [
    subject,
    `Party: ${partyName}`,
    `10-calendar-day pickup window expired on ${getManilaDateYmd(now)} (Asia/Manila). Item automatically disposed / case closed.`,
    `Step 1 Report: ${wf.step1.dateYmd} | Step 2: Expired (Day ${wf.calendarDay}) | Step 3: ${wf.step3.dateDisplay} | Step 4: ${wf.step4.dateDisplay} (${wf.step4.reason})`,
    ...rows.map((it) => `- ${it.name} (${it.totalPieces} ${it.unitName}) • ${it.reason || 'Damaged'}`)
  ].join('\n');

  return { subject, html, text };
}
