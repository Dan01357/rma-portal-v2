import React from 'react';
import { Calendar, CheckCircle2, Clock, AlertTriangle, RotateCcw } from 'lucide-react';
import { computeFourStepWorkflow } from '../utils/followUpWorkflow';

/**
 * Reusable Full 4-Step + 10-Calendar-Day (Day 0..Day 10) Timeline Card.
 * Displays Step 1 Report Date, Step 2 Waiting For Pickup with visible Day 0..10 status rows,
 * Step 3 Driver Picked Up Date, and Step 4 Case Close.
 */
export default function FollowUpTimelineCard({
  report,
  catalogProducts = [],
  workflow = null,
  customerFollowUpDefaultEnabled = false,
  compact = false,
  onResetTimeline = null,
  isResettingTimeline = false
}) {
  const wf = workflow || (report
    ? computeFourStepWorkflow(report, catalogProducts, { customerFollowUpDefaultEnabled })
    : null);

  if (!wf) return null;

  const days = Array.isArray(wf.timelineDays) ? wf.timelineDays : [];

  const getBadgeClasses = (state) => {
    switch (state) {
      case 'picked_up':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/70 dark:text-emerald-200 dark:border-emerald-700';
      case 'halted':
        return 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
      case 'expired':
        return 'bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-700';
      case 'dispatched':
        return 'bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-950/60 dark:text-indigo-200 dark:border-indigo-700';
      case 'waiting':
      case 'past':
        return 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-700';
      case 'reported':
        return 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-700';
      default:
        return 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700';
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/70 p-3.5 space-y-3 text-xs">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 font-black uppercase tracking-wider text-[11px] text-slate-700 dark:text-slate-200">
          <Calendar className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span>Full 4-Step &amp; 10-Calendar-Day Pickup Timeline</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {typeof onResetTimeline === 'function' && (
            <button
              type="button"
              disabled={isResettingTimeline}
              onClick={onResetTimeline}
              className="px-2 py-0.5 rounded-lg bg-slate-200/80 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-600 text-[10px] font-black flex items-center gap-1 cursor-pointer disabled:opacity-50"
              title="Reset full 4-step workflow timeline, 10-day countdown & disposition outcome back to Pending"
            >
              <RotateCcw className="w-3 h-3" />
              <span>{isResettingTimeline ? 'Resetting...' : '🔄 Reset Timeline'}</span>
            </button>
          )}
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${
            wf.isClosed
              ? (wf.isAutoDisposed ? 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-700' : 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/70 dark:text-emerald-200 dark:border-emerald-700')
              : wf.isExpiredAfter10Days
                ? 'bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-700'
                : 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/70 dark:text-amber-200 dark:border-amber-700'
          }`}>
            {wf.step4.done ? wf.step4.dateDisplay : `Step ${wf.activeStepNumber} of 4 • ${wf.step2.text}`}
          </span>
        </div>
      </div>

      {/* Summary 4 Steps Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <div className="p-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
          <div className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400">
            Step 1: Report Date
          </div>
          <div className="font-mono font-bold text-slate-900 dark:text-white mt-0.5 leading-snug">
            {wf.step1.dateDisplay}
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
          <div className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400">
            Step 2: Waiting For Pickup
          </div>
          <div className="font-bold text-slate-900 dark:text-white mt-0.5 leading-snug">
            {wf.step2.text} (10 Days Max)
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
          <div className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400">
            Step 3: Driver Picked Up Date
          </div>
          <div className={`font-bold mt-0.5 leading-snug ${
            wf.isPickedUp ? 'text-emerald-700 dark:text-emerald-300' : wf.step2.exceededAfter10 ? 'text-rose-700 dark:text-rose-300' : 'text-slate-700 dark:text-slate-200'
          }`}>
            {wf.step3.dateDisplay}
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
          <div className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400">
            Step 4: Case Close
          </div>
          <div className={`font-bold mt-0.5 leading-snug ${
            wf.isClosed ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'
          }`}>
            {wf.step4.dateDisplay}
          </div>
        </div>
      </div>

      {/* Visible Day 0..Day 10 Progression */}
      {days.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden">
          <div className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">
            <span>Day 0 – Day 10 Calendar Check (Asia/Manila)</span>
            <span>Did the RMA get picked up?</span>
          </div>
          <div className={`divide-y divide-slate-100 dark:divide-slate-800/80 ${compact ? 'max-h-56 overflow-y-auto' : ''}`}>
            {days.map((row) => (
              <div
                key={row.day}
                className="px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]"
              >
                <div className="font-mono font-bold text-slate-800 dark:text-slate-200">
                  {row.day === 0
                    ? `Day 0 (Report Date): ${row.dateLabel}`
                    : `Day ${row.day} (${row.dateLabel})`}
                </div>
                <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold inline-flex items-center gap-1 ${getBadgeClasses(row.state)}`}>
                  {row.state === 'picked_up' && <CheckCircle2 className="w-3 h-3 shrink-0" />}
                  {row.state === 'expired' && <AlertTriangle className="w-3 h-3 shrink-0" />}
                  {(row.state === 'waiting' || row.state === 'dispatched') && <Clock className="w-3 h-3 shrink-0" />}
                  <span>{row.statusText}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
