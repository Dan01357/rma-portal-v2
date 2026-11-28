import React, { useEffect, useState } from 'react';
import { Calendar, CheckCircle2, Clock, AlertTriangle, RotateCcw, ChevronDown, ChevronUp, Zap } from 'lucide-react';
import { computeFourStepWorkflow, formatDurationCompact } from '../utils/followUpWorkflow';
import { notificationService, SETTINGS_SYNC_EVENT } from '../services/notificationService';
import { isTestRecord } from '../utils/rmaHelpers';

/**
 * Reusable Full 4-Step + 10-Calendar-Day (Day 0..Day 10) Timeline Card.
 * Displays Step 1 Report Date, Step 2 Waiting For Pickup (compact summary above the fold with collapsible Day 0..10 log),
 * Step 3 Driver Picked Up Date, and Step 4 Case Close.
 * For Test Mode Sandbox RMAs with accelerated testStepIntervalSeconds > 0, renders live countdowns.
 */
export default function FollowUpTimelineCard({
  report,
  catalogProducts = [],
  workflow = null,
  customerFollowUpDefaultEnabled = true,
  testStepIntervalSeconds = undefined,
  compact = false,
  defaultExpanded = false,
  onResetTimeline = null,
  isResettingTimeline = false
}) {
  const [isDaysExpanded, setIsDaysExpanded] = useState(Boolean(defaultExpanded));
  const [cfg, setCfg] = useState(() => notificationService.getDailyFollowUpConfig());
  const [nowTick, setNowTick] = useState(() => new Date());

  useEffect(() => {
    const sync = () => setCfg(notificationService.getDailyFollowUpConfig());
    window.addEventListener(SETTINGS_SYNC_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(SETTINGS_SYNC_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const resolvedStepSec = testStepIntervalSeconds !== undefined
    ? Number(testStepIntervalSeconds || 0)
    : Number(cfg?.testStepIntervalSeconds || 0);
  const resolvedCustomerDefault = customerFollowUpDefaultEnabled ?? cfg?.customerFollowUpDefaultEnabled ?? true;

  const isAcceleratedPreview = Boolean(report && isTestRecord(report) && resolvedStepSec > 0);
  useEffect(() => {
    if (!isAcceleratedPreview) return undefined;
    const id = setInterval(() => setNowTick(new Date()), 1000);
    return () => clearInterval(id);
  }, [isAcceleratedPreview]);

  const wf = workflow || (report
    ? computeFourStepWorkflow(report, catalogProducts, {
        customerFollowUpDefaultEnabled: resolvedCustomerDefault,
        testStepIntervalSeconds: resolvedStepSec,
        now: isAcceleratedPreview ? nowTick : undefined
      })
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
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/70 p-3.5 space-y-2.5 text-xs">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 font-black uppercase tracking-wider text-[11px] text-slate-700 dark:text-slate-200">
          <Calendar className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span>4-Step &amp; 10-Day Pickup Timeline</span>
          {wf.isAcceleratedTestSla && (
            <span className="px-2 py-0.5 rounded-full text-[9.5px] font-black bg-amber-200/80 dark:bg-amber-900/70 text-amber-950 dark:text-amber-100 border border-amber-400 dark:border-amber-600 inline-flex items-center gap-1">
              <Zap className="w-2.5 h-2.5" />
              <span>Test Speed: {formatDurationCompact(wf.testStepIntervalSeconds)}/day</span>
            </span>
          )}
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
              <span>{isResettingTimeline ? 'Resetting...' : 'Reset Timeline'}</span>
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

      {/* Live Accelerated Test Countdown Strip (only when Test Speed active & ticket open) */}
      {wf.isAcceleratedTestSla && wf.isCountdownActive && (
        <div className="px-3 py-1.5 rounded-xl bg-amber-100/80 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-[11px] font-bold text-amber-950 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 shrink-0" />
            <span>
              {wf.isExpiredAfter10Days
                ? 'Simulated Day 10 window elapsed — ready for Auto-Dispose on next tick.'
                : `Next simulated Day ${wf.calendarDay + 1} in ${formatDurationCompact(wf.nextStepInSeconds)}`}
            </span>
          </span>
          <span className="font-mono text-[10px] text-amber-800 dark:text-amber-300">
            Auto-Dispose in {formatDurationCompact(wf.autoDisposeInSeconds)}
          </span>
        </div>
      )}

      {/* Summary 4 Steps Row */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 ${compact ? 'gap-1.5' : 'gap-2'}`}>
        <div className={`${compact ? 'p-2' : 'p-2.5'} rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800`}>
          <div className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400">
            Step 1: Report Date
          </div>
          <div className="font-mono font-bold text-slate-900 dark:text-white mt-0.5 leading-snug">
            {wf.step1.dateDisplay}
          </div>
        </div>

        <div className={`${compact ? 'p-2' : 'p-2.5'} rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800`}>
          <div className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400">
            Step 2: Waiting For Pickup
          </div>
          <div className="font-bold text-slate-900 dark:text-white mt-0.5 leading-snug">
            {wf.step2.text} (10 Days Max)
          </div>
        </div>

        <div className={`${compact ? 'p-2' : 'p-2.5'} rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800`}>
          <div className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400">
            Step 3: Driver Picked Up Date
          </div>
          <div className={`font-bold mt-0.5 leading-snug ${
            wf.isPickedUp ? 'text-emerald-700 dark:text-emerald-300' : wf.step2.exceededAfter10 ? 'text-rose-700 dark:text-rose-300' : 'text-slate-700 dark:text-slate-200'
          }`}>
            {wf.step3.dateDisplay}
          </div>
        </div>

        <div className={`${compact ? 'p-2' : 'p-2.5'} rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800`}>
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

      {/* Collapsible Day 0..Day 10 Progression Toggle */}
      {days.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden">
          <button
            type="button"
            onClick={() => setIsDaysExpanded((v) => !v)}
            aria-expanded={isDaysExpanded}
            className="w-full px-3 py-2 bg-slate-100/80 hover:bg-slate-100 dark:bg-slate-800/80 dark:hover:bg-slate-800 flex items-center justify-between flex-wrap gap-x-2 gap-y-1 text-[10px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
          >
            <span className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 text-left min-w-0">
              <span>{isDaysExpanded ? 'Hide' : 'Show'} Day 0 – Day 10 Schedule ({days.length} steps)</span>
              <span className="font-mono text-[9.5px] font-bold text-slate-500 dark:text-slate-400 normal-case whitespace-nowrap shrink-0">
                • Sent: {wf.sentCount}
              </span>
            </span>
            <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 shrink-0 whitespace-nowrap">
              <span>{isDaysExpanded ? 'Collapse' : 'Expand'}</span>
              {isDaysExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </button>

          {isDaysExpanded && (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80 border-t border-slate-200 dark:border-slate-700">
              <div className="px-3 py-1 bg-slate-50 dark:bg-slate-900/60 flex items-center justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400">
                <span>{wf.isAcceleratedTestSla ? 'Simulated Step & Time (PHT)' : 'Day & Manila Calendar Date'}</span>
                <span>Pickup Check</span>
              </div>
              {days.map((row) => (
                <div
                  key={row.day}
                  className="px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                >
                  <div className="font-mono font-bold text-slate-800 dark:text-slate-200">
                    {row.day === 0
                      ? `Day 0 (Report): ${row.dateLabel}`
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
          )}
        </div>
      )}
    </div>
  );
}
