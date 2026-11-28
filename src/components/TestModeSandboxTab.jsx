import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  FlaskConical,
  Trash2,
  Copy,
  Check,
  FileText,
  Building2,
  FileSpreadsheet,
  Terminal,
  ChevronDown,
  Zap,
  Clock,
  Play,
  RefreshCw,
  Sliders
} from 'lucide-react';
import {
  isManifestSubItem,
  isBatchManifest,
  getReportManifestItems
} from '../utils/rmaHelpers';
import {
  computeFourStepWorkflow,
  formatDurationCompact,
  normalizeTestStepIntervalSeconds
} from '../utils/followUpWorkflow';
import { notificationService, SETTINGS_SYNC_EVENT } from '../services/notificationService';
import CustomerHubTab from './CustomerHubTab';
import SupplierClaimsTab from './SupplierClaimsTab';
import { copyTextSafe } from '../utils/clipboard';

export default function TestModeSandboxTab({
  testReportsList = [],
  testCreditMemosList = [],
  savedProductsList = [],
  currentUser,
  coworkerQueueFilter = 'all',
  onClearCoworkerQueueFilter,
  updatingQueueId = null,
  activeSubTab: controlledSubTab,
  onSubTabChange,
  customerHubSubTab = 'returns',
  externalCustomerSubTab = null,
  onCustomerHubSubTabChange,
  onRefresh,
  onInspectTriage,
  onOpenQuickAction,
  onViewQR,
  onViewPhoto,
  onViewExplanation,
  onEditProductFromReport,
  onResetToPending,
  onConfirmCoworkerAction,
  onOpenReportsModal,
  onOpenMatrixExport,
  onArchiveReport,
  onBulkArchiveReports,
  onRequestDeleteReport,
  onRequestBulkDeleteReports,
  onClearAllSandbox,
  onAssignSku,
  onOpenCreateCreditMemo,
  onOpenCreditMemoForReport,
  onOpenCreditMemosLedger,
  onEditCreditMemo,
  onViewCreditMemoVoucher,
  onRequestDeleteCreditMemo,
  onRequestBulkDeleteCreditMemos,
  onOpenSimpleWizard,
  onOpenPickupForm
}) {
  const [internalSubTab, setInternalSubTab] = useState('customer');
  const rawSubTab = controlledSubTab || internalSubTab;
  const activeSubTab = rawSubTab === 'supplier' ? 'supplier' : 'customer';
  const setActiveSubTab = (nextTab) => {
    const normalized = nextTab === 'supplier' ? 'supplier' : 'customer';
    if (onSubTabChange) {
      onSubTabChange(normalized);
    } else {
      setInternalSubTab(normalized);
    }
  };

  const [copiedKey, setCopiedKey] = useState(null);
  const [showApiGuide, setShowApiGuide] = useState(false);

  // Isolated Test Mode Accelerated 10-Day SLA Speed & Live Countdown Ticker
  const [followUpConfig, setFollowUpConfig] = useState(() => notificationService.getDailyFollowUpConfig());
  const [autoTickEnabled, setAutoTickEnabled] = useState(false);
  const [isRunningTick, setIsRunningTick] = useState(false);
  const [tickFeedback, setTickFeedback] = useState(null);
  const [nowTick, setNowTick] = useState(() => new Date());
  const tickInFlightRef = useRef(false);
  const lastAutoTickAtRef = useRef(0);

  useEffect(() => {
    const syncCfg = () => setFollowUpConfig(notificationService.getDailyFollowUpConfig());
    window.addEventListener(SETTINGS_SYNC_EVENT, syncCfg);
    window.addEventListener('storage', syncCfg);
    return () => {
      window.removeEventListener(SETTINGS_SYNC_EVENT, syncCfg);
      window.removeEventListener('storage', syncCfg);
    };
  }, []);

  const testStepSec = normalizeTestStepIntervalSeconds(followUpConfig?.testStepIntervalSeconds || 0);

  useEffect(() => {
    if (testStepSec <= 0) return undefined;
    const id = setInterval(() => setNowTick(new Date()), 1000);
    return () => clearInterval(id);
  }, [testStepSec]);

  const activeCountdownSummary = useMemo(() => {
    if (testStepSec <= 0) return null;
    const openCandidates = testReportsList.filter((r) => !isManifestSubItem(r, testReportsList));
    let activeCount = 0;
    let soonestNextStep = null;
    let dueStepCount = 0;
    let dueDisposeCount = 0;

    for (const r of openCandidates) {
      const wf = computeFourStepWorkflow(r, savedProductsList, {
        now: nowTick,
        customerFollowUpDefaultEnabled: followUpConfig.customerFollowUpDefaultEnabled,
        testStepIntervalSeconds: testStepSec
      });
      if (!wf.isCountdownActive || wf.isClosed) continue;
      activeCount++;
      if (wf.isExpiredAfter10Days) {
        dueDisposeCount++;
      } else if (wf.calendarDay >= 1 && !wf.alreadySentToday) {
        dueStepCount++;
      }
      if (!wf.isExpiredAfter10Days) {
        if (soonestNextStep === null || wf.nextStepInSeconds < soonestNextStep) {
          soonestNextStep = wf.nextStepInSeconds;
        }
      }
    }

    return { activeCount, soonestNextStep, dueStepCount, dueDisposeCount };
  }, [testReportsList, savedProductsList, nowTick, followUpConfig.customerFollowUpDefaultEnabled, testStepSec]);

  const handleRunTestSlaTick = async (sourceLabel = 'manual') => {
    if (tickInFlightRef.current) return;
    tickInFlightRef.current = true;
    setIsRunningTick(true);
    try {
      const res = await notificationService.runDailyFollowUpNow({
        isTestMode: true,
        force: false,
        dryRun: false,
        operation: 'run_all',
        respectSchedule: false
      });
      if (res?.success) {
        const sent = Number(res?.summary?.followUpsSent || 0);
        const disposed = Number(res?.summary?.autoDisposed || 0);
        const skipped = Number(res?.summary?.skippedCount || 0);
        setTickFeedback({
          type: 'success',
          text: `${sourceLabel === 'auto' ? 'Auto-Tick' : 'Test SLA Tick'}: ${sent} follow-up(s) sent, ${disposed} auto-disposed (${skipped} waiting/up-to-date).`
        });
        if (sent > 0 || disposed > 0) {
          onRefresh?.();
        }
      } else {
        const errList = Array.isArray(res?.errors) ? res.errors : [];
        const firstErrObj = errList[0] || null;
        const firstErrMsg = firstErrObj
          ? `${firstErrObj?.rmaNumber ? `${firstErrObj.rmaNumber}: ` : ''}${firstErrObj?.message || 'Failed'}`
          : '';
        const sent = Number(res?.summary?.followUpsSent || 0);
        const disposed = Number(res?.summary?.autoDisposed || 0);
        const partialPrefix = (sent > 0 || disposed > 0)
          ? `${sent} follow-up(s) sent, ${disposed} auto-disposed, ${errList.length || 1} error(s) — `
          : '';
        const detail = res?.error || firstErrMsg || 'Failed running Test SLA tick.';
        const extraSuffix = errList.length > 1 && !String(detail).includes('more error')
          ? ` (+${errList.length - 1} more)`
          : '';
        setTickFeedback({
          type: 'error',
          text: `${partialPrefix}${detail}${extraSuffix}`
        });
        if (sent > 0 || disposed > 0) {
          onRefresh?.();
        }
      }
    } catch (err) {
      setTickFeedback({ type: 'error', text: err?.message || 'Error triggering Test SLA tick.' });
    } finally {
      tickInFlightRef.current = false;
      setIsRunningTick(false);
    }
  };

  useEffect(() => {
    if (!autoTickEnabled || testStepSec <= 0 || !activeCountdownSummary) return;
    if (activeCountdownSummary.dueStepCount === 0 && activeCountdownSummary.dueDisposeCount === 0) return;
    const nowMs = Date.now();
    if (nowMs - lastAutoTickAtRef.current < 8000) return;
    lastAutoTickAtRef.current = nowMs;
    handleRunTestSlaTick('auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTickEnabled, testStepSec, activeCountdownSummary?.dueStepCount, activeCountdownSummary?.dueDisposeCount]);

  const handleQuickSelectSpeed = async (seconds) => {
    const saved = await notificationService.saveDailyFollowUpConfig({
      ...followUpConfig,
      testStepIntervalSeconds: seconds
    });
    setFollowUpConfig(saved);
    setTickFeedback({
      type: 'success',
      text: seconds > 0
        ? `Sandbox SLA speed set to ${formatDurationCompact(seconds)} per simulated day (Live RMAs unaffected).`
        : 'Sandbox SLA speed reset to Normal (1 Manila calendar day).'
    });
  };

  const canManage = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';

  // Top-level counts mirroring CustomerHubTab & SupplierClaimsTab predicates
  const sandboxCustomerCount = useMemo(() => {
    return testReportsList.filter(
      (r) => r.rma_type !== 'supplier_outbound' && !isManifestSubItem(r, testReportsList)
    ).length;
  }, [testReportsList]);

  const sandboxSupplierCount = useMemo(() => {
    return testReportsList.filter((r) => {
      if (isManifestSubItem(r, testReportsList)) return false;
      const isExplicitSupplier = r.rma_type === 'supplier_outbound';
      if (isExplicitSupplier) return true;
      if (isBatchManifest(r, testReportsList)) {
        const children = getReportManifestItems(r, testReportsList);
        return children.some((c) => {
          const cDisp = String(c?.disposition || '').toLowerCase();
          return c?.rma_type === 'supplier_outbound' || cDisp.includes('rtv') || cDisp.includes('vendor') || cDisp.includes('supplier_credit') || cDisp.includes('supplier_exchange');
        });
      }
      const disp = String(r.disposition || '').toLowerCase();
      return disp.includes('rtv') || disp.includes('vendor') || disp.includes('supplier exchange') || disp.includes('supplier credit') || disp.includes('supplier_credit') || disp.includes('supplier_exchange');
    }).length;
  }, [testReportsList]);

  const totalSandboxRecords = testReportsList.length + testCreditMemosList.length;

  const copyToClipboard = (text, key) => {
    copyTextSafe(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const curlGetRestock = `curl -X GET "https://rma-portal-pingconmarketing.vercel.app/api/v1/rma?test_mode=true&queue=restock" \\
  -H "x-api-key: YOUR_SECRET_API_KEY"`;

  const curlPostTest = `curl -X POST "https://rma-portal-pingconmarketing.vercel.app/api/v1/rma" \\
  -H "x-api-key: YOUR_SECRET_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "is_test": true,
    "barcode": "4800016644833",
    "name": "Oishi Prawn Crackers 50g",
    "quantity": 5,
    "disposition": "Restock to Inventory",
    "warehouse_location": "Good Stock Area"
  }'`;

  const curlPatchRestock = `curl -X PATCH "https://rma-portal-pingconmarketing.vercel.app/api/v1/rma/RMA-ID-HERE" \\
  -H "x-api-key: YOUR_SECRET_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "status": "restocked",
    "warehouse_location": "Good Stock Area",
    "notes": "Added to inventory counts in WMS"
  }'`;

  return (
    <div className="space-y-4">
      {/* 1. Coworker API Sandbox Guide Banner */}
      <div className="bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/5 dark:from-amber-950/40 dark:via-orange-950/30 dark:to-slate-900 border-2 border-amber-300 dark:border-amber-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="p-2 rounded-xl bg-amber-500 text-white shadow-xs">
                <FlaskConical className="w-5 h-5" />
              </span>
              <h3 className="text-base sm:text-lg font-black text-amber-950 dark:text-amber-200">
                🧪 Coworker REST API Sandbox & Simulation Hub
              </h3>
            </div>
            <p className="text-xs text-amber-900/80 dark:text-amber-300/80 max-w-2xl leading-relaxed">
              Every return, RTV claim, or Credit Memo submitted here or via <code className="font-mono font-bold bg-amber-100 dark:bg-amber-900/60 px-1.5 py-0.5 rounded text-[11px]">?test_mode=true</code> is strictly isolated from live financial books and live production queues — with full Live Mode feature parity.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setShowApiGuide((prev) => !prev)}
              className="px-3 py-2 bg-white/80 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-800 text-amber-900 dark:text-amber-300 border border-amber-300 dark:border-amber-800 font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer transition-all"
              title="Toggle REST API cURL Snippets"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>{showApiGuide ? 'Hide cURL Guide' : 'Show cURL Guide'}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showApiGuide ? 'rotate-180' : ''}`} />
            </button>

            {onOpenMatrixExport && !(activeSubTab === 'customer' && customerHubSubTab === 'credit_memos') && (
              <button
                type="button"
                onClick={() => onOpenMatrixExport('overall')}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer transition-all"
                title="Download Test Sandbox Overall RMA Matrix (.xlsx) combining Customer Hub & Supplier RTV"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Sandbox Overall Matrix (.xlsx)</span>
              </button>
            )}

            {canManage && totalSandboxRecords > 0 && (
              <button
                type="button"
                onClick={onClearAllSandbox}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs rounded-xl shadow-xs flex items-center gap-2 cursor-pointer transition-all"
                title="Delete all sandbox test records"
              >
                <Trash2 className="w-4 h-4" />
                <span>Clear Sandbox ({totalSandboxRecords})</span>
              </button>
            )}
          </div>
        </div>

        {/* Accelerated 10-Day SLA Simulation Control Bar (Strictly Test Mode Sandbox Only) */}
        <div
          data-testid="sandbox-sla-control-bar"
          className="p-3.5 rounded-2xl bg-white/90 dark:bg-slate-900/90 border border-amber-300 dark:border-amber-800/80 space-y-2.5 text-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-950/70 text-amber-950 dark:text-amber-200 border border-amber-300 dark:border-amber-700 font-black">
                <Zap className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>
                  {testStepSec > 0
                    ? `Test SLA Speed: 1 Sim Day = ${formatDurationCompact(testStepSec)}`
                    : 'Test SLA Speed: Normal (1 Manila Day)'}
                </span>
              </span>
              {testStepSec > 0 && activeCountdownSummary && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono text-[11px] font-bold">
                  <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>
                    {activeCountdownSummary.activeCount === 0
                      ? 'No open Test SLA timers running'
                      : activeCountdownSummary.dueDisposeCount > 0 || activeCountdownSummary.dueStepCount > 0
                        ? `Due Now: ${activeCountdownSummary.dueStepCount} follow-up(s), ${activeCountdownSummary.dueDisposeCount} auto-dispose`
                        : activeCountdownSummary.soonestNextStep !== null
                          ? `Next Tick in ${formatDurationCompact(activeCountdownSummary.soonestNextStep)} (${activeCountdownSummary.activeCount} active)`
                          : `${activeCountdownSummary.activeCount} active`}
                  </span>
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { label: '1d (Normal)', sec: 0 },
                { label: '2m/day', sec: 120 },
                { label: '1m/day', sec: 60 },
                { label: '30s/day', sec: 30 }
              ].map((p) => (
                <button
                  key={p.sec}
                  type="button"
                  onClick={() => handleQuickSelectSpeed(p.sec)}
                  className={`px-2 py-1 rounded-lg text-[10.5px] font-black border cursor-pointer transition-colors ${
                    testStepSec === p.sec
                      ? 'bg-slate-900 text-white border-slate-900 dark:bg-amber-500 dark:text-slate-950 dark:border-amber-400'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-amber-400'
                  }`}
                >
                  {p.label}
                </button>
              ))}

              {testStepSec > 0 && (
                <button
                  type="button"
                  onClick={() => setAutoTickEnabled((v) => !v)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-black border flex items-center gap-1 cursor-pointer transition-all ${
                    autoTickEnabled
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700'
                  }`}
                  title="Automatically trigger simulated SLA follow-up & Auto-Dispose ticks while Sandbox is open"
                >
                  <RefreshCw className={`w-3 h-3 ${autoTickEnabled ? 'animate-spin' : ''}`} />
                  <span>{autoTickEnabled ? 'Auto-Tick ON' : 'Auto-Tick OFF'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => handleRunTestSlaTick('manual')}
                disabled={isRunningTick}
                className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-black flex items-center gap-1 cursor-pointer disabled:opacity-50 shadow-2xs"
                title="Immediately evaluate and dispatch due Test Mode Sandbox SLA follow-ups / Auto-Dispose (Live RMAs unaffected)"
              >
                <Play className="w-3 h-3" />
                <span>{isRunningTick ? 'Running Tick...' : 'Run Test SLA Tick Now'}</span>
              </button>
            </div>
          </div>

          {tickFeedback && (
            <div className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold ${
              tickFeedback.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
            }`}>
              {tickFeedback.text}
            </div>
          )}
        </div>

        {/* cURL Quick-Copy Cards */}
        {showApiGuide && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 pt-2 border-t border-amber-200 dark:border-amber-900/60">
            <div className="bg-white/90 dark:bg-slate-900/90 border border-amber-200 dark:border-amber-900/80 rounded-2xl p-3 space-y-1.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-amber-800 dark:text-amber-400 font-mono">1. Query Test Queue</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(curlGetRestock, 'get')}
                  className="text-[10px] font-bold text-slate-500 hover:text-amber-600 flex items-center gap-1 cursor-pointer"
                >
                  {copiedKey === 'get' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedKey === 'get' ? 'Copied' : 'Copy cURL'}</span>
                </button>
              </div>
              <pre className="text-[9px] font-mono text-slate-700 dark:text-slate-300 bg-amber-50/50 dark:bg-slate-950 p-2 rounded-xl overflow-x-auto whitespace-pre">
                {curlGetRestock}
              </pre>
            </div>

            <div className="bg-white/90 dark:bg-slate-900/90 border border-amber-200 dark:border-amber-900/80 rounded-2xl p-3 space-y-1.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-amber-800 dark:text-amber-400 font-mono">2. Ingest Test Return</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(curlPostTest, 'post')}
                  className="text-[10px] font-bold text-slate-500 hover:text-amber-600 flex items-center gap-1 cursor-pointer"
                >
                  {copiedKey === 'post' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedKey === 'post' ? 'Copied' : 'Copy cURL'}</span>
                </button>
              </div>
              <pre className="text-[9px] font-mono text-slate-700 dark:text-slate-300 bg-amber-50/50 dark:bg-slate-950 p-2 rounded-xl overflow-x-auto whitespace-pre">
                {curlPostTest}
              </pre>
            </div>

            <div className="bg-white/90 dark:bg-slate-900/90 border border-amber-200 dark:border-amber-900/80 rounded-2xl p-3 space-y-1.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-amber-800 dark:text-amber-400 font-mono">3. Simulate Restock PATCH</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(curlPatchRestock, 'patch')}
                  className="text-[10px] font-bold text-slate-500 hover:text-amber-600 flex items-center gap-1 cursor-pointer"
                >
                  {copiedKey === 'patch' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedKey === 'patch' ? 'Copied' : 'Copy cURL'}</span>
                </button>
              </div>
              <pre className="text-[9px] font-mono text-slate-700 dark:text-slate-300 bg-amber-50/50 dark:bg-slate-950 p-2 rounded-xl overflow-x-auto whitespace-pre">
                {curlPatchRestock}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* 2. Standardized Symmetrical 2-Hub Sandbox Sub-Tabs Bar */}
      <div className="grid grid-cols-1 sm:inline-flex sm:items-center gap-1.5 sm:gap-2 bg-slate-200/80 dark:bg-slate-800/80 p-1.5 sm:p-1 rounded-2xl w-full sm:w-auto">
        <button
          type="button"
          onClick={() => setActiveSubTab('customer')}
          className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-black flex items-center justify-center sm:justify-start gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeSubTab === 'customer'
              ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <FileText className="w-4 h-4 text-blue-600 shrink-0" />
          <span>Sandbox Customer RMAs ({sandboxCustomerCount})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('supplier')}
          className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-black flex items-center justify-center sm:justify-start gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeSubTab === 'supplier'
              ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Building2 className="w-4 h-4 text-amber-600 shrink-0" />
          <span>Sandbox Supplier RTVs ({sandboxSupplierCount})</span>
        </button>
      </div>

      {/* 3. Full-Parity Standardized Sandbox Views */}
      {activeSubTab === 'customer' && (
        <CustomerHubTab
          reportsList={testReportsList}
          creditMemosList={testCreditMemosList}
          savedProductsList={savedProductsList}
          currentUser={currentUser}
          coworkerQueueFilter={coworkerQueueFilter}
          onClearCoworkerQueueFilter={onClearCoworkerQueueFilter}
          updatingQueueId={updatingQueueId}
          isTestMode={true}
          onOpenReportsModal={() => onOpenReportsModal && onOpenReportsModal()}
          onOpenMatrixExport={() => onOpenMatrixExport && onOpenMatrixExport('overall')}
          onInspectTriage={onInspectTriage}
          onOpenSimpleWizard={onOpenSimpleWizard}
          onOpenPickupForm={onOpenPickupForm}
          onViewQR={onViewQR}
          onViewPhoto={onViewPhoto}
          onViewExplanation={onViewExplanation}
          onEditProductFromReport={onEditProductFromReport}
          onOpenCreditMemo={onOpenCreditMemoForReport}
          onOpenCreateCreditMemo={onOpenCreateCreditMemo}
          onOpenCreditMemosLedger={onOpenCreditMemosLedger}
          onEditCreditMemo={onEditCreditMemo}
          onViewCreditMemoVoucher={onViewCreditMemoVoucher}
          onPrintBulkCreditMemos={onViewCreditMemoVoucher}
          onRequestDeleteCreditMemo={onRequestDeleteCreditMemo}
          onRequestBulkDeleteCreditMemo={onRequestBulkDeleteCreditMemos}
          onConfirmCoworkerAction={onConfirmCoworkerAction}
          onResetToPending={onResetToPending}
          onArchiveReport={onArchiveReport}
          onBulkArchiveReports={onBulkArchiveReports}
          onRequestDeleteReport={onRequestDeleteReport}
          onRequestBulkDeleteReports={onRequestBulkDeleteReports}
          defaultSubTab={customerHubSubTab}
          externalSubTab={externalCustomerSubTab}
          onSubTabChange={onCustomerHubSubTabChange}
        />
      )}

      {activeSubTab === 'supplier' && (
        <SupplierClaimsTab
          reportsList={testReportsList}
          currentUser={currentUser}
          onRefresh={onRefresh}
          onViewPhoto={onViewPhoto}
          onRequestDeleteReport={onRequestDeleteReport}
          onRequestBulkDeleteReports={onRequestBulkDeleteReports}
          onRequestArchiveReport={onArchiveReport}
          onRequestBulkArchiveReports={onBulkArchiveReports}
          onArchiveReport={onArchiveReport}
          onBulkArchiveReports={onBulkArchiveReports}
          onAssignSku={onAssignSku}
          onEditProductFromReport={onEditProductFromReport}
          onOpenQuickAction={onOpenQuickAction}
          onViewQR={onViewQR}
          onViewExplanation={onViewExplanation}
          onOpenSimpleWizard={onOpenSimpleWizard}
          onOpenPickupForm={onOpenPickupForm}
          onResetToPending={onResetToPending}
          onOpenMatrixExport={() => onOpenMatrixExport && onOpenMatrixExport('overall')}
          savedProductsList={savedProductsList}
          coworkerQueueFilter={coworkerQueueFilter}
          isTestMode={true}
        />
      )}
    </div>
  );
}
