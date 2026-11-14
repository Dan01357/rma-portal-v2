import React, { useState, useMemo } from 'react';
import {
  FlaskConical,
  Trash2,
  Copy,
  Check,
  FileText,
  Building2,
  Receipt,
  FileSpreadsheet,
  Terminal,
  ChevronDown
} from 'lucide-react';
import {
  isManifestSubItem,
  isBatchManifest,
  getReportManifestItems
} from '../utils/rmaHelpers';
import CustomerHubTab from './CustomerHubTab';
import SupplierClaimsTab from './SupplierClaimsTab';
import CreditMemosTab from './CreditMemosTab';
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
  onRefresh,
  onInspectTriage,
  onOpenQuickAction,
  onViewQR,
  onViewPhoto,
  onViewExplanation,
  onPrintLabel,
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
  onEditCreditMemo,
  onViewCreditMemoVoucher,
  onRequestDeleteCreditMemo,
  onRequestBulkDeleteCreditMemos,
  onOpenSimpleWizard,
  onOpenPickupForm
}) {
  const [internalSubTab, setInternalSubTab] = useState('customer');
  const activeSubTab = controlledSubTab || internalSubTab;
  const setActiveSubTab = (nextTab) => {
    if (onSubTabChange) {
      onSubTabChange(nextTab);
    } else {
      setInternalSubTab(nextTab);
    }
  };

  const [copiedKey, setCopiedKey] = useState(null);
  const [showApiGuide, setShowApiGuide] = useState(true);

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
          return c?.rma_type === 'supplier_outbound' || cDisp.includes('rtv') || cDisp.includes('vendor');
        });
      }
      const disp = String(r.disposition || '').toLowerCase();
      return disp.includes('rtv') || disp.includes('vendor') || disp.includes('supplier exchange') || disp.includes('supplier credit');
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

            {onOpenMatrixExport && activeSubTab !== 'memos' && (
              <button
                type="button"
                onClick={() => onOpenMatrixExport(activeSubTab)}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer transition-all"
                title={`Download Test Sandbox ${activeSubTab === 'supplier' ? 'Supplier RTV' : 'Customer Hub'} Matrix (.xlsx)`}
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Sandbox {activeSubTab === 'supplier' ? 'Supplier RTV' : 'Customer'} Matrix (.xlsx)</span>
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

      {/* 2. Standardized Sandbox Sub-Tabs Bar */}
      <div className="flex items-center gap-2 bg-slate-200/80 dark:bg-slate-800/80 p-1 rounded-2xl overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveSubTab('customer')}
          className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeSubTab === 'customer'
              ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <FileText className="w-4 h-4 text-blue-600" />
          <span>📥 Sandbox Customer RMAs ({sandboxCustomerCount})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('supplier')}
          className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeSubTab === 'supplier'
              ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Building2 className="w-4 h-4 text-amber-600" />
          <span>🚚 Sandbox Supplier RTVs ({sandboxSupplierCount})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('memos')}
          className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeSubTab === 'memos'
              ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Receipt className="w-4 h-4 text-emerald-600" />
          <span>💳 Sandbox Credit Memos ({testCreditMemosList.length})</span>
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
          onOpenMatrixExport={() => onOpenMatrixExport && onOpenMatrixExport('customer')}
          onInspectTriage={onInspectTriage}
          onViewQR={onViewQR}
          onViewPhoto={onViewPhoto}
          onViewExplanation={onViewExplanation}
          onPrintLabel={onPrintLabel}
          onEditProductFromReport={onEditProductFromReport}
          onOpenCreditMemo={onOpenCreditMemoForReport}
          onViewCreditMemoVoucher={onViewCreditMemoVoucher}
          onConfirmCoworkerAction={onConfirmCoworkerAction}
          onResetToPending={onResetToPending}
          onArchiveReport={onArchiveReport}
          onBulkArchiveReports={onBulkArchiveReports}
          onRequestDeleteReport={onRequestDeleteReport}
          onRequestBulkDeleteReports={onRequestBulkDeleteReports}
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
          onPrintLabel={onPrintLabel}
          onViewQR={onViewQR}
          onViewExplanation={onViewExplanation}
          onOpenSimpleWizard={onOpenSimpleWizard}
          onOpenPickupForm={onOpenPickupForm}
          onOpenMatrixExport={() => onOpenMatrixExport && onOpenMatrixExport('supplier')}
          savedProductsList={savedProductsList}
          coworkerQueueFilter={coworkerQueueFilter}
          isTestMode={true}
        />
      )}

      {activeSubTab === 'memos' && (
        <CreditMemosTab
          creditMemosList={testCreditMemosList}
          recentReportsList={testReportsList}
          currentUser={currentUser}
          onOpenCreateModal={onOpenCreateCreditMemo}
          onEditCreditMemo={onEditCreditMemo}
          onViewVoucher={onViewCreditMemoVoucher}
          onPrintBulk={onViewCreditMemoVoucher}
          onRequestDeleteCreditMemo={onRequestDeleteCreditMemo}
          onRequestBulkDeleteCreditMemo={onRequestBulkDeleteCreditMemos}
          isTestMode={true}
        />
      )}
    </div>
  );
}
