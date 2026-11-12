import React, { useState, useMemo } from 'react';
import { 
  FlaskConical, 
  Trash2, 
  Terminal, 
  Copy, 
  Check, 
  FileText, 
  Building2, 
  Receipt, 
  RotateCcw,
  Sparkles,
  ClipboardCheck,
  Package,
  Layers,
  ArrowRight
} from 'lucide-react';
import { 
  formatQuantityWithPackSize, 
  normalizeWarehouseLocation,
  formatLifecycleStage
} from '../utils/rmaHelpers';
import TablePagination from './TablePagination';

export default function TestModeSandboxTab({
  testReportsList = [],
  testCreditMemosList = [],
  currentUser,
  onRefresh,
  onInspectTriage,
  onResetToPending,
  onClearAllSandbox,
  onAssignSku,
  onViewCreditMemo,
  savedProductsList = []
}) {
  const [activeSubTab, setActiveSubTab] = useState('customer'); // 'customer' | 'supplier' | 'memos'
  const [copiedKey, setCopiedKey] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const canManage = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';

  // Sub-divide sandbox reports into customer inbound vs supplier outbound
  const sandboxCustomerReports = useMemo(() => {
    return testReportsList.filter(r => r.rma_type !== 'supplier_outbound');
  }, [testReportsList]);

  const sandboxSupplierReports = useMemo(() => {
    return testReportsList.filter(r => r.rma_type === 'supplier_outbound');
  }, [testReportsList]);

  const activeList = useMemo(() => {
    if (activeSubTab === 'customer') return sandboxCustomerReports;
    if (activeSubTab === 'supplier') return sandboxSupplierReports;
    return testCreditMemosList;
  }, [activeSubTab, sandboxCustomerReports, sandboxSupplierReports, testCreditMemosList]);

  const paginatedList = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return activeList.slice(start, start + pageSize);
  }, [activeList, currentPage, pageSize]);

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text);
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
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-amber-500 text-white shadow-xs">
                <FlaskConical className="w-5 h-5" />
              </span>
              <h3 className="text-base sm:text-lg font-black text-amber-950 dark:text-amber-200">
                🧪 Coworker REST API Sandbox & Simulation Hub
              </h3>
            </div>
            <p className="text-xs text-amber-900/80 dark:text-amber-300/80 max-w-2xl leading-relaxed">
              Every return submitted here or created with <code className="font-mono font-bold bg-amber-100 dark:bg-amber-900/60 px-1.5 py-0.5 rounded text-[11px]">?test_mode=true</code> is strictly isolated from live financial books and live production queues. Coworkers can simulate inventory restocks, supplier re-orders, and debit memos here safely!
            </p>
          </div>

          {canManage && testReportsList.length > 0 && (
            <button
              type="button"
              onClick={onClearAllSandbox}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs rounded-xl shadow-xs flex items-center gap-2 cursor-pointer transition-all shrink-0 self-start sm:self-auto"
              title="Delete all sandbox test records"
            >
              <Trash2 className="w-4 h-4" />
              <span>Clear Sandbox ({testReportsList.length})</span>
            </button>
          )}
        </div>

        {/* cURL Quick-Copy Cards */}
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
      </div>

      {/* 2. Sub-Tabs Bar */}
      <div className="flex items-center gap-2 bg-slate-200/80 dark:bg-slate-800/80 p-1 rounded-2xl overflow-x-auto">
        <button
          type="button"
          onClick={() => { setActiveSubTab('customer'); setCurrentPage(1); }}
          className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeSubTab === 'customer'
              ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          <FileText className="w-4 h-4 text-blue-600" />
          <span>📥 Sandbox Customer RMAs ({sandboxCustomerReports.length})</span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveSubTab('supplier'); setCurrentPage(1); }}
          className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeSubTab === 'supplier'
              ? 'bg-white dark:bg-slate-900 text-purple-700 dark:text-purple-300 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          <Building2 className="w-4 h-4 text-purple-600" />
          <span>📤 Sandbox Supplier RTVs ({sandboxSupplierReports.length})</span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveSubTab('memos'); setCurrentPage(1); }}
          className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeSubTab === 'memos'
              ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          <Receipt className="w-4 h-4 text-emerald-600" />
          <span>💳 Sandbox Credit Memos ({testCreditMemosList.length})</span>
        </button>
      </div>

      {/* 3. Sandbox Data Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
        {activeList.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            <FlaskConical className="w-10 h-10 text-amber-500 mx-auto" />
            <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200">
              No Sandbox {activeSubTab === 'customer' ? 'Customer Returns' : activeSubTab === 'supplier' ? 'Supplier Claims' : 'Credit Memos'} Found
            </h4>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Enable Test Mode in the top header or call the REST API with <code className="font-mono">?test_mode=true</code> to generate test tickets here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[10px] font-black uppercase text-slate-500 tracking-wider">
                  <th className="py-3 px-3.5 text-center">SN</th>
                  <th className="py-3 px-3.5">RMA Identifier</th>
                  <th className="py-3 px-3.5">Store / Supplier</th>
                  <th className="py-3 px-3.5">Product & SKU</th>
                  <th className="py-3 px-3.5 text-right">Qty</th>
                  <th className="py-3 px-3.5">Lifecycle Stage</th>
                  <th className="py-3 px-3.5">Location</th>
                  <th className="py-3 px-3.5 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paginatedList.map((item, idx) => {
                  const stageInfo = formatLifecycleStage(item.status, item);
                  const loc = normalizeWarehouseLocation(item.warehouse_location, item);
                  const isResolved = Boolean(item.ai_document_metadata?.workflow_resolution || item.status === 'resolved' || item.status === 'closed');

                  return (
                    <tr key={item.id || item.rma_number} className="hover:bg-amber-50/20 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-3.5 text-center font-mono font-bold text-slate-400">
                        #{(currentPage - 1) * pageSize + idx + 1}
                      </td>

                      <td className="py-3 px-3.5 font-mono">
                        <div className="font-bold text-amber-700 dark:text-amber-400">
                          {item.rma_number || item.credit_memo_number}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {new Date(item.created_at).toLocaleDateString()}
                        </div>
                      </td>

                      <td className="py-3 px-3.5 font-semibold text-slate-800 dark:text-slate-200">
                        {item.store_branch || item.supplier_name || 'N/A'}
                      </td>

                      <td className="py-3 px-3.5">
                        <div className="font-bold text-slate-900 dark:text-white truncate max-w-xs" title={item.name || item.product_name}>
                          {item.name || item.product_name}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          BC: {item.barcode} {item.code || item.sku ? `• SKU: ${item.code || item.sku}` : ''}
                        </div>
                      </td>

                      <td className="py-3 px-3.5 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {formatQuantityWithPackSize(item.quantity, item.unit_name, item.pieces_per_case)}
                      </td>

                      <td className="py-3 px-3.5">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border inline-flex items-center gap-1 shadow-2xs ${stageInfo.color}`}>
                          {stageInfo.label}
                        </span>
                      </td>

                      <td className="py-3 px-3.5 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                        {loc}
                      </td>

                      <td className="py-3 px-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          {onInspectTriage && (
                            <button
                              type="button"
                              onClick={() => onInspectTriage(item)}
                              className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-700 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer shadow-2xs"
                              title="Triage condition and operational disposition"
                            >
                              <ClipboardCheck className="w-3 h-3 text-amber-600" />
                              <span>Triage</span>
                            </button>
                          )}

                          {isResolved && onResetToPending && (
                            <button
                              type="button"
                              onClick={() => onResetToPending(item)}
                              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer shadow-2xs whitespace-nowrap"
                              title="Reset to pending to allow re-testing coworker queues"
                            >
                              <RotateCcw className="w-3 h-3 text-slate-500" />
                              <span>↩️ Reset</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {activeList.length > 0 && (
          <div className="p-3 border-t border-slate-100 dark:border-slate-800">
            <TablePagination
              currentPage={currentPage}
              totalItems={activeList.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              pageSizeOptions={[5, 10, 20]}
              itemLabel="test records"
            />
          </div>
        )}
      </div>
    </div>
  );
}
