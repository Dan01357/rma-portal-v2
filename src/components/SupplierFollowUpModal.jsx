import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Building2,
  Mail,
  Send,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Save,
  FlaskConical,
  Loader2,
  ShieldCheck
} from 'lucide-react';
import SupplierInput from './SupplierInput';
import { catalogService } from '../services/catalogService';
import { notificationService } from '../services/notificationService';
import { formatQuantityWithPackSize, isTestRecord } from '../utils/rmaHelpers';
import {
  computeFourStepWorkflow,
  resolveReportPartyAndEmails,
  isPlaceholderSupplier,
  FOLLOW_UP_MAX_DAYS
} from '../utils/followUpWorkflow';

export default function SupplierFollowUpModal({
  isOpen,
  onClose,
  report,
  catalogProducts = [],
  isTestMode = false,
  currentUser = null,
  onUpdated = null,
  onShowToast = null
}) {
  const [supplierName, setSupplierName] = useState('');
  const [supplierEmailTo, setSupplierEmailTo] = useState('');
  const [supplierEmailCc, setSupplierEmailCc] = useState('');
  const [followUpEnabled, setFollowUpEnabled] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (!isOpen || !report) return;
    const party = resolveReportPartyAndEmails(report, catalogProducts);
    const defaultCfg = notificationService.getDailyFollowUpConfig();
    const wf = computeFourStepWorkflow(report, catalogProducts, {
      customerFollowUpDefaultEnabled: defaultCfg.customerFollowUpDefaultEnabled
    });
    setSupplierName(isPlaceholderSupplier(party.supplierName) ? '' : party.supplierName);
    setSupplierEmailTo(party.supplierEmailTo || '');
    setSupplierEmailCc(party.supplierEmailCc || '');
    setFollowUpEnabled(
      party.followUpMeta.enabled !== undefined
        ? Boolean(party.followUpMeta.enabled)
        : (report.rma_type === 'supplier_outbound' ? true : wf.followUpEnabled)
    );
    setFeedback(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, report?.id, report?.rma_number]);

  const recordIsTest = useMemo(
    () => Boolean(isTestMode || (report && isTestRecord(report))),
    [isTestMode, report]
  );

  const wfPreview = useMemo(() => {
    if (!report) return null;
    const defaultCfg = notificationService.getDailyFollowUpConfig();
    return computeFourStepWorkflow(
      {
        ...report,
        supplier_name: supplierName.trim() || report.supplier_name,
        ai_document_metadata: {
          ...(report.ai_document_metadata || {}),
          follow_up: {
            ...(report.ai_document_metadata?.follow_up || {}),
            supplier_email_to: supplierEmailTo,
            supplier_email_cc: supplierEmailCc,
            enabled: followUpEnabled
          }
        }
      },
      catalogProducts,
      { customerFollowUpDefaultEnabled: defaultCfg.customerFollowUpDefaultEnabled }
    );
  }, [report, supplierName, supplierEmailTo, supplierEmailCc, followUpEnabled, catalogProducts]);

  if (!isOpen || !report || !wfPreview) return null;

  const actorName = currentUser?.full_name || currentUser?.email || 'Admin';
  const sandboxEmail = notificationService.getTestSandboxEmail();

  const handleSave = async () => {
    const cleanSup = supplierName.trim();
    if (!cleanSup) {
      setFeedback({ type: 'error', message: 'Please enter a valid Supplier / Vendor Name.' });
      return null;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      const saved = await catalogService.saveSupplierAndFollowUpSettings(report, {
        supplier_name: cleanSup,
        supplier_email_to: supplierEmailTo.trim(),
        supplier_email_cc: supplierEmailCc.trim(),
        followUpEnabled,
        actorName
      });
      setFeedback({
        type: 'success',
        message: `Saved supplier "${cleanSup}"${followUpEnabled ? ' — 10-Calendar-Day follow-up countdown active.' : ' — Auto daily follow-up paused.'}`
      });
      onShowToast?.(`Updated supplier & follow-up settings for ${report.rma_number}`, 'success');
      onUpdated?.(saved);
      return saved;
    } catch (err) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to save supplier & follow-up settings.' });
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendFollowUpNow = async () => {
    const cleanSup = supplierName.trim() || (isPlaceholderSupplier(wfPreview.party.supplierName) ? '' : wfPreview.party.supplierName);
    if (!cleanSup) {
      setFeedback({ type: 'error', message: 'Please set a Supplier / Vendor Name before sending a follow-up.' });
      return;
    }
    if (!recordIsTest && !supplierEmailTo.trim()) {
      setFeedback({ type: 'error', message: 'Enter at least one Supplier Primary Email (TO) before dispatching a Live follow-up.' });
      return;
    }
    setIsSending(true);
    setFeedback(null);
    try {
      const saved = await catalogService.saveSupplierAndFollowUpSettings(report, {
        supplier_name: cleanSup,
        supplier_email_to: supplierEmailTo.trim(),
        supplier_email_cc: supplierEmailCc.trim(),
        followUpEnabled: true,
        actorName
      });
      setFollowUpEnabled(true);

      const res = await notificationService.runDailyFollowUpNow({
        isTestMode: recordIsTest,
        force: true,
        rmaNumber: report.rma_number,
        operation: 'send_single',
        overrideToEmail: supplierEmailTo.trim()
      });

      if (!res?.success && (res?.errors?.length > 0 || res?.error)) {
        const msg = res?.error || res?.errors?.[0]?.message || 'Failed to send follow-up email.';
        setFeedback({ type: 'error', message: msg });
        onShowToast?.(msg, 'error');
      } else if (res?.skippedItems?.length > 0 && (res?.summary?.followUpsSent || 0) === 0 && (res?.summary?.autoDisposed || 0) === 0) {
        const reason = res.skippedItems[0]?.reason || 'SKIPPED';
        setFeedback({ type: 'error', message: `Follow-up not sent: ${reason}` });
      } else {
        const disposed = (res?.summary?.autoDisposed || 0) > 0;
        const msg = disposed
          ? `Day >${FOLLOW_UP_MAX_DAYS} threshold reached — ${report.rma_number} auto-disposed & notification sent.`
          : `Sent Day ${wfPreview.calendarDay} of ${FOLLOW_UP_MAX_DAYS} pickup follow-up${recordIsTest ? ` cleanly to ${sandboxEmail}` : ` to ${supplierEmailTo.trim()}`}.`;
        setFeedback({ type: 'success', message: msg });
        onShowToast?.(msg, 'success');
      }
      onUpdated?.(saved);
    } catch (err) {
      setFeedback({ type: 'error', message: err?.message || 'Error sending follow-up email.' });
    } finally {
      setIsSending(false);
    }
  };

  const handleCloseCase = async () => {
    setIsClosing(true);
    setFeedback(null);
    try {
      const saved = await catalogService.closeFollowUpCase(report, {
        markPickedUp: true,
        reason: wfPreview.isSupplierStream ? 'Picked Up — Case Closed' : 'Handover Completed — Case Closed',
        actorName
      });
      setFollowUpEnabled(false);
      setFeedback({ type: 'success', message: `${report.rma_number} marked Picked Up / Case Closed. Countdown stopped.` });
      onShowToast?.(`${report.rma_number} Case Closed.`, 'success');
      onUpdated?.(saved);
    } catch (err) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to close case.' });
    } finally {
      setIsClosing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-3xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-950/60">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-black px-2 py-0.5 rounded-lg bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-200">
                {report.rma_number}
              </span>
              {recordIsTest && (
                <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                  <FlaskConical className="w-3 h-3" /> TEST ({sandboxEmail})
                </span>
              )}
            </div>
            <h3 className="text-base font-black text-slate-900 dark:text-white mt-1 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>Set Supplier, Email &amp; 10-Day Pickup Follow-Up</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-md">
              {report.name || report.barcode} • {formatQuantityWithPackSize(report.quantity || 1, report.unit_name || 'pc', report.pieces_per_case)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close supplier follow-up modal"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto text-xs">
          {/* 4-Step Workflow Status Tracker */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[wfPreview.step1, wfPreview.step2, wfPreview.step3, wfPreview.step4].map((st, idx) => (
              <div
                key={st.key}
                className={`p-2.5 rounded-2xl border ${
                  st.done
                    ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800'
                    : st.status === 'expired'
                      ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-700'
                      : idx === 1 && wfPreview.isCountdownActive
                        ? 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700'
                        : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'
                }`}
              >
                <div className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400">
                  {st.label}
                </div>
                <div className="font-bold text-slate-900 dark:text-white mt-0.5 leading-snug">
                  {st.text || st.dateDisplay}
                </div>
              </div>
            ))}
          </div>

          {/* Supplier Name */}
          <div>
            <label className="block text-[11px] font-black uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-1.5">
              Supplier / Vendor Name *
            </label>
            <SupplierInput
              id="followup-modal-supplier-input"
              name="followUpSupplierName"
              value={supplierName}
              onChange={setSupplierName}
              placeholder="Search or type vendor / manufacturer (e.g. Mondelez, URC)..."
              className="w-full"
            />
          </div>

          {/* Supplier Emails */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-1.5">
                Supplier Primary Email(s) (TO)
              </label>
              <input
                type="text"
                aria-label="Supplier Primary Email(s) (TO)"
                value={supplierEmailTo}
                onChange={(e) => setSupplierEmailTo(e.target.value)}
                placeholder="claims@supplier.com, rtv@supplier.com"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-xs font-mono outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-1.5">
                Supplier CC Email(s) (Optional)
              </label>
              <input
                type="text"
                aria-label="Supplier CC Email(s) (Optional)"
                value={supplierEmailCc}
                onChange={(e) => setSupplierEmailCc(e.target.value)}
                placeholder="coordinator@supplier.com"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-xs font-mono outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* 10-Calendar-Day SLA Toggle */}
          <label className="flex items-start gap-3 p-3.5 rounded-2xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/30 cursor-pointer">
            <input
              type="checkbox"
              aria-label="Auto Daily Follow-Up (10-Day SLA)"
              checked={followUpEnabled}
              onChange={(e) => setFollowUpEnabled(e.target.checked)}
              className="mt-0.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
            />
            <div className="space-y-0.5">
              <div className="font-black text-amber-950 dark:text-amber-200 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-600" />
                <span>Auto Daily Follow-Up (10-Day SLA): {followUpEnabled ? 'ON' : 'OFF'}</span>
              </div>
              <p className="text-[11px] text-amber-900/80 dark:text-amber-300/80 leading-relaxed">
                Starts a <strong>10-calendar-day pickup countdown</strong> (Asia/Manila). Sends daily pickup reminders with proof photos &amp; the health/sanitation notice, stops immediately when Picked Up / Closed, and automatically marks overdue items <strong>Scrapped / Disposed</strong> after Day 10.
              </p>
            </div>
          </label>

          {wfPreview.isExpiredAfter10Days && !wfPreview.isClosed && (
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-700 text-rose-900 dark:text-rose-200 flex items-start gap-2 font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <span>
                Overdue ({wfPreview.calendarDay} calendar days elapsed). Running Follow-Up Check will auto-dispose this RMA and notify configured New RMA Alert recipients.
              </span>
            </div>
          )}

          {feedback && (
            <div className={`p-3 rounded-2xl border font-bold flex items-center gap-2 ${
              feedback.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200'
                : 'bg-rose-50 dark:bg-rose-950/50 border-rose-300 dark:border-rose-700 text-rose-900 dark:text-rose-200'
            }`}>
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>{feedback.message}</span>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            Cancel
          </button>

          <div className="flex flex-wrap items-center gap-2">
            {!wfPreview.isClosed && (
              <button
                type="button"
                onClick={handleCloseCase}
                disabled={isClosing || isSaving || isSending}
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isClosing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                <span>✓ Case Close</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleSendFollowUpNow}
              disabled={isSending || isSaving || isClosing || wfPreview.isClosed}
              className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-black text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>📧 Send Follow-Up</span>
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || isSending || isClosing}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>Save Supplier &amp; Email</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
