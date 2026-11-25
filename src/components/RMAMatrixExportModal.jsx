import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  FileSpreadsheet,
  Calendar,
  Download,
  CheckCircle2,
  Info,
  Mail,
  Send,
  RefreshCw,
  AlertCircle,
  Link2
} from 'lucide-react';
import {
  buildRmaMatrixDataset,
  downloadRmaMatrixXlsx,
  toManilaDateKey
} from '../utils/exportMatrixXlsx';
import { formatPeso } from '../utils/rmaHelpers';
import { notificationService } from '../services/notificationService';
import EmailRecipientsEditor from './EmailRecipientsEditor';

/**
 * Overall RMA Matrix (.xlsx) Exporter & Email Dispatcher Modal.
 * Defaults to Overall RMA (combining Customer Hub + Supplier RTV) with optional single-hub filter,
 * strictly isolating Live Production vs Test Mode Sandbox.
 */
export default function RMAMatrixExportModal({
  isOpen,
  onClose,
  reports = [],
  catalogProducts = [],
  creditMemos = [],
  stream = 'overall', // 'overall' | 'supplier_outbound' | 'customer_inbound'
  isTestMode = false
}) {
  // Always declare React hooks unconditionally before any early returns
  const todayManila = useMemo(() => toManilaDateKey(new Date()), []);
  const defaultStart = useMemo(() => {
    const d = new Date(`${todayManila}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 13);
    return d.toISOString().slice(0, 10);
  }, [todayManila]);

  const [selectedScope, setSelectedScope] = useState(stream || 'overall');
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(todayManila);
  const [includeZeroCatalogSkus, setIncludeZeroCatalogSkus] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState('');

  // Email Matrix Tab / Expandable State
  const [showEmailPanel, setShowEmailPanel] = useState(false);
  const [manualRecipients, setManualRecipients] = useState(() => {
    const prof = notificationService.getEmailProfile('manual_matrix');
    return { toList: prof.toList || [], ccList: prof.ccList || [] };
  });
  const [syncWithAuto, setSyncWithAuto] = useState(false);
  const [emailStatus, setEmailStatus] = useState({
    loading: false,
    done: false,
    success: false,
    message: '',
    detail: ''
  });

  useEffect(() => {
    if (isOpen) {
      setSelectedScope(stream || 'overall');
      setDownloadMsg('');
      setEmailStatus({ loading: false, done: false, success: false, message: '', detail: '' });
      const prof = notificationService.getEmailProfile('manual_matrix', Boolean(isTestMode));
      setManualRecipients({ toList: prof.toList || [], ccList: prof.ccList || [] });
    }
  }, [isOpen, stream, isTestMode]);

  const preview = useMemo(() => {
    if (!isOpen) return null;
    return buildRmaMatrixDataset({
      reports,
      catalogProducts,
      creditMemos,
      stream: selectedScope,
      isTestMode,
      startDate,
      endDate,
      includeZeroCatalogSkus
    });
  }, [isOpen, reports, catalogProducts, creditMemos, selectedScope, isTestMode, startDate, endDate, includeZeroCatalogSkus]);

  if (!isOpen || !preview) return null;

  const isInvalidRange = preview.allDates.length === 0;
  const scopeLabel = selectedScope === 'supplier_outbound'
    ? 'Supplier RTV Only'
    : selectedScope === 'customer_inbound'
      ? 'Customer Hub Only'
      : 'Overall RMA (Customer Hub + Supplier RTV)';

  const applyQuickRange = (daysBack) => {
    const end = toManilaDateKey(new Date());
    const d = new Date(`${end}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - daysBack);
    setStartDate(d.toISOString().slice(0, 10));
    setEndDate(end);
  };

  const handleDownload = () => {
    if (isInvalidRange) return;
    const { filename } = downloadRmaMatrixXlsx({
      reports,
      catalogProducts,
      creditMemos,
      stream: selectedScope,
      isTestMode,
      startDate,
      endDate,
      includeZeroCatalogSkus
    });
    setDownloadMsg(`Downloaded ${filename}`);
    setTimeout(() => setDownloadMsg(''), 4000);
  };

  const handleSyncToAutoProfile = async (recipientsOverride = null) => {
    const rec = recipientsOverride || manualRecipients;
    await notificationService.saveEmailProfile('manual_matrix', rec, Boolean(isTestMode));
    await notificationService.saveEmailProfile('daily_matrix_auto', rec, Boolean(isTestMode));
    setDownloadMsg(
      isTestMode
        ? 'Synced Test Mode Manual & Auto Matrix recipients cleanly!'
        : 'Synced Manual & Daily Auto Matrix recipients cleanly!'
    );
    setTimeout(() => setDownloadMsg(''), 3500);
  };

  const handleSendEmailNow = async () => {
    if (isInvalidRange) return;
    setEmailStatus({
      loading: true,
      done: false,
      success: false,
      message: 'Generating & dispatching Overall RMA Matrix (.xlsx)...',
      detail: ''
    });
    try {
      if (syncWithAuto) {
        await handleSyncToAutoProfile(manualRecipients).catch(() => {});
      }
      const res = await notificationService.sendDailyMatrixEmailNow({
        startDate,
        endDate,
        stream: selectedScope,
        includeZeroCatalogSkus,
        toList: manualRecipients.toList,
        ccList: manualRecipients.ccList,
        isTestMode: Boolean(isTestMode),
        force: true
      });
      if (res?.success) {
        const ccTxt = Array.isArray(res.cc) && res.cc.length > 0 ? ` (CC: ${res.cc.join(', ')})` : '';
        setEmailStatus({
          loading: false,
          done: true,
          success: true,
          message: `Matrix email dispatched to ${res.to || manualRecipients.toList.join(', ')}${ccTxt}`,
          detail: `${res.filename || 'Overall_RMA_Matrix_Report.xlsx'} • ${res.dataset?.lineCount ?? 0} lines • ${res.dataset?.grandTotalPcs ?? 0} pcs`
        });
      } else {
        setEmailStatus({
          loading: false,
          done: true,
          success: false,
          message: res?.message || res?.error || 'Failed to dispatch Matrix email.',
          detail: res?.diagnostic || ''
        });
      }
    } catch (err) {
      setEmailStatus({
        loading: false,
        done: true,
        success: false,
        message: err?.message || 'Error sending matrix email.',
        detail: ''
      });
    }
  };

  return (
    <div className="fixed inset-0 z-[115] flex items-center justify-center p-3 sm:p-4 bg-slate-900/75 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[94dvh]">

        {/* Header */}
        <div className={`px-5 py-4 text-white flex items-center justify-between border-b shrink-0 ${
          isTestMode ? 'bg-amber-900 border-amber-800' : 'bg-emerald-900 border-emerald-800'
        }`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-white/15 shrink-0">
              <FileSpreadsheet className="w-5 h-5 text-emerald-200" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-black truncate">
                  {selectedScope === 'overall' ? 'Overall RMA Matrix (.xlsx)' : `${scopeLabel} Matrix (.xlsx)`}
                </h2>
                {isTestMode && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[10px] font-black uppercase">
                    🧪 Test Mode Only
                  </span>
                )}
              </div>
              <p className="text-xs text-emerald-100/80 truncate">
                Daily returned pieces, Bad/Good stock split, &amp; Email Dispatch Studio
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Mode Tabs: Export File vs Email Matrix */}
        <div className="px-5 pt-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowEmailPanel(false)}
            className={`px-3.5 py-2 rounded-t-xl text-xs font-black flex items-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
              !showEmailPanel
                ? 'border-emerald-600 text-emerald-700 dark:text-emerald-300 bg-white dark:bg-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Excel (.xlsx)</span>
          </button>
          <button
            type="button"
            onClick={() => setShowEmailPanel(true)}
            className={`px-3.5 py-2 rounded-t-xl text-xs font-black flex items-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
              showEmailPanel
                ? 'border-blue-600 text-blue-700 dark:text-blue-300 bg-white dark:bg-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            <span>📧 Email Matrix</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Hub Scope Selector (Overall Default) */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-bold uppercase text-slate-400 block">Report Scope</span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
              {[
                { id: 'overall', label: 'Overall RMA (Combined)' },
                { id: 'customer_inbound', label: 'Customer Hub Only' },
                { id: 'supplier_outbound', label: 'Supplier RTV Only' }
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelectedScope(opt.id)}
                  className={`px-3 py-2 rounded-xl text-xs font-black border transition-all cursor-pointer ${
                    selectedScope === opt.id
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold uppercase text-slate-400 mr-1">Quick Range:</span>
            {[
              { label: 'Last 7 Days', days: 6 },
              { label: 'Last 14 Days', days: 13 },
              { label: 'Last 30 Days', days: 29 },
              { label: 'Last 60 Days', days: 59 },
              { label: 'Last 90 Days', days: 89 }
            ].map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => applyQuickRange(p.days)}
                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition-colors cursor-pointer"
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Date Range Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                  <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                  Start Date (YYYY-MM-DD)
                </label>
                {startDate && (
                  <span className="text-[10px] font-mono font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                    ISO (YYYY-MM-DD): {startDate}
                  </span>
                )}
              </div>
              <input
                type="date"
                value={startDate}
                max={endDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-mono font-bold text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                  <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                  End Date (YYYY-MM-DD)
                </label>
                {endDate && (
                  <span className="text-[10px] font-mono font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                    ISO (YYYY-MM-DD): {endDate}
                  </span>
                )}
              </div>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-mono font-bold text-slate-900 dark:text-white"
              />
            </div>
          </div>

          {/* Option Toggle */}
          <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={includeZeroCatalogSkus}
              onChange={(e) => setIncludeZeroCatalogSkus(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span className="text-slate-700 dark:text-slate-200 font-semibold">
              Include catalog SKUs with 0 returns during this period (blank RMA workflow columns)
            </span>
          </label>

          {/* Preview Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center">
              <div className="text-[10px] font-bold uppercase text-slate-400">Days / Weeks</div>
              <div className="text-sm font-black text-slate-900 dark:text-white mt-0.5">
                {preview.allDates.length}d / {preview.weekBlocks.length}w
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center">
              <div className="text-[10px] font-bold uppercase text-slate-400">RMA Lines</div>
              <div className="text-sm font-black text-slate-900 dark:text-white mt-0.5">
                {preview.lineCount.toLocaleString()}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center">
              <div className="text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-300">Total Pieces</div>
              <div className="text-sm font-black text-emerald-800 dark:text-emerald-200 mt-0.5">
                {preview.grandTotalPcs.toLocaleString()} pcs
              </div>
            </div>
            <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-center">
              <div className="text-[10px] font-bold uppercase text-blue-700 dark:text-blue-300">Total Value</div>
              <div className="text-sm font-black text-blue-800 dark:text-blue-200 mt-0.5">
                {formatPeso(preview.grandTotalValue)}
              </div>
            </div>
          </div>

          {/* Expandable Email Matrix Section */}
          {showEmailPanel && (
            <div className="space-y-3 pt-1 border-t border-slate-200 dark:border-slate-700 animate-in fade-in">
              <EmailRecipientsEditor
                emailType="manual_matrix"
                value={manualRecipients}
                onChange={setManualRecipients}
                compact={true}
                defaultExpanded={true}
                isTestMode={isTestMode}
                title="Manual Overall Matrix Email Recipients"
              />

              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 text-xs">
                <label className="flex items-center gap-2 font-semibold text-indigo-950 dark:text-indigo-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncWithAuto}
                    onChange={(e) => setSyncWithAuto(e.target.checked)}
                    className="rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Also sync with Auto Daily 1:00 PM PHT Matrix recipients on send</span>
                </label>
                <button
                  type="button"
                  onClick={() => handleSyncToAutoProfile()}
                  className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-black flex items-center gap-1 cursor-pointer"
                >
                  <Link2 className="w-3 h-3" />
                  <span>Sync Auto &amp; Manual Now</span>
                </button>
              </div>

              {emailStatus.done && (
                <div className={`p-3 rounded-xl border text-xs space-y-1 ${
                  emailStatus.success
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200'
                    : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-700 text-rose-900 dark:text-rose-200'
                }`}>
                  <div className="font-bold flex items-center gap-1.5">
                    {emailStatus.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    )}
                    <span>{emailStatus.message}</span>
                  </div>
                  {emailStatus.detail && (
                    <div className="text-[11px] font-mono opacity-85 pl-5">{emailStatus.detail}</div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="p-3 rounded-xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 flex items-start gap-2 text-xs text-sky-900 dark:text-sky-200">
            <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
            <span>
              Strictly processes <strong>{isTestMode ? 'Test Sandbox' : 'Live Production'}</strong> data only ({scopeLabel}).
              Cases auto-converted to pieces; frozen columns A–E &amp; rows 1–5 matching Pingcon Matrix template.
            </span>
          </div>

          {downloadMsg && (
            <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{downloadMsg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/70 border-t border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-end gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            Close
          </button>

          {showEmailPanel ? (
            <button
              type="button"
              disabled={isInvalidRange || emailStatus.loading}
              onClick={handleSendEmailNow}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-black flex items-center gap-2 shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
            >
              {emailStatus.loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>{emailStatus.loading ? 'Dispatching...' : 'Send Matrix Email Now'}</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={isInvalidRange}
              onClick={handleDownload}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-black flex items-center gap-2 shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download Excel Matrix (.xlsx)</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
