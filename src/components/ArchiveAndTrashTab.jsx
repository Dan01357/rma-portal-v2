import React, { useState, useMemo } from 'react';
import { 
  Archive, 
  Trash2, 
  RotateCcw, 
  AlertTriangle, 
  Search, 
  Clock, 
  Flame, 
  Package, 
  CheckCircle2, 
  Sparkles,
  ArrowUpDown,
  Building2,
  FileText
} from 'lucide-react';
import { 
  isTestRecord, 
  getTrashDaysRemaining, 
  formatQuantityWithPackSize,
  normalizeWarehouseLocation
} from '../utils/rmaHelpers';
import TablePagination from './TablePagination';

export default function ArchiveAndTrashTab({
  archivedReports = [],
  trashedReports = [],
  currentUser,
  onRefresh,
  onRestore,
  onPermanentlyDelete,
  onEmptyTrash
}) {
  const [activeView, setActiveView] = useState('trash'); // 'archive' | 'trash'
  const [envFilter, setEnvFilter] = useState('all'); // 'all' | 'live' | 'test'
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [actionInProgressId, setActionInProgressId] = useState(null);

  const canManage = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';

  // Base list depending on active view
  const baseList = activeView === 'archive' ? archivedReports : trashedReports;

  // Filter list by environment and search query
  const filteredList = useMemo(() => {
    return baseList.filter(item => {
      const isTest = isTestRecord(item);
      if (envFilter === 'live' && isTest) return false;
      if (envFilter === 'test' && !isTest) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matches = 
          (item.rma_number || '').toLowerCase().includes(q) ||
          (item.barcode || '').toLowerCase().includes(q) ||
          (item.name || '').toLowerCase().includes(q) ||
          (item.code || item.sku || '').toLowerCase().includes(q) ||
          (item.supplier_name || '').toLowerCase().includes(q) ||
          (item.store_branch || '').toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [baseList, envFilter, searchQuery]);

  // Pagination
  const paginatedList = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredList.slice(start, start + pageSize);
  }, [filteredList, currentPage, pageSize]);

  const handleRestoreItem = async (item) => {
    if (!item) return;
    try {
      setActionInProgressId(item.id || item.rma_number);
      if (onRestore) {
        await onRestore(item);
      }
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleDeleteItemForever = async (item) => {
    if (!item) return;
    const confirmed = window.confirm(
      `PERMANENT DESTRUCTION WARNING:\n\nAre you sure you want to permanently delete return report ${item.rma_number}? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      setActionInProgressId(item.id || item.rma_number);
      if (onPermanentlyDelete) {
        await onPermanentlyDelete(item);
      }
    } finally {
      setActionInProgressId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Banner & View Switcher */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Archive className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              <span>Enterprise Archive & 30-Day Trash Bin</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Soft-deleted records are retained for 30 days before automatic permanent purge. Archived records are preserved indefinitely.
            </p>
          </div>

          {activeView === 'trash' && trashedReports.length > 0 && canManage && (
            <button
              type="button"
              onClick={onEmptyTrash}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl shadow-xs flex items-center gap-2 cursor-pointer transition-all self-start sm:self-auto shrink-0"
              title="Permanently delete all items currently in Trash Bin"
            >
              <Flame className="w-4 h-4" />
              <span>Empty Trash ({trashedReports.length})</span>
            </button>
          )}
        </div>

        {/* View Toggle Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-2xl">
            <button
              type="button"
              onClick={() => { setActiveView('trash'); setCurrentPage(1); }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black flex items-center gap-2 transition-all cursor-pointer ${
                activeView === 'trash'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>🗑️ Trash Bin — 30-Day Auto-Delete ({trashedReports.length})</span>
            </button>

            <button
              type="button"
              onClick={() => { setActiveView('archive'); setCurrentPage(1); }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-black flex items-center gap-2 transition-all cursor-pointer ${
                activeView === 'archive'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              <Archive className="w-3.5 h-3.5" />
              <span>🗄️ Archive Vault ({archivedReports.length})</span>
            </button>
          </div>

          {/* Environment Filter */}
          <div className="flex items-center gap-1.5 text-xs font-bold">
            <span className="text-slate-400 text-[11px] uppercase mr-1">Scope:</span>
            <button
              type="button"
              onClick={() => { setEnvFilter('all'); setCurrentPage(1); }}
              className={`px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                envFilter === 'all'
                  ? 'bg-slate-800 text-white border-slate-800 dark:bg-white dark:text-slate-900'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => { setEnvFilter('live'); setCurrentPage(1); }}
              className={`px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                envFilter === 'live'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
              }`}
            >
              🟢 Live Production
            </button>
            <button
              type="button"
              onClick={() => { setEnvFilter('test'); setCurrentPage(1); }}
              className={`px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                envFilter === 'test'
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
              }`}
            >
              🧪 Test Mode Sandbox
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            placeholder={`Search ${activeView === 'trash' ? 'trashed' : 'archived'} items by RMA number, barcode, product, vendor...`}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Table Content */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
        {filteredList.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
            <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200">
              {activeView === 'trash' ? 'Trash Bin is Clean' : 'Archive Vault is Empty'}
            </h4>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {activeView === 'trash'
                ? 'No items have been moved to the trash bin. Deleted returns will sit here for 30 days.'
                : 'No return reports are currently stored in the Archive Vault.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[10px] font-black uppercase text-slate-500 tracking-wider">
                  <th className="py-3 px-3.5 text-center">SN</th>
                  <th className="py-3 px-3.5">RMA Identifier</th>
                  <th className="py-3 px-3.5">Scope</th>
                  <th className="py-3 px-3.5">Product Description & SKU</th>
                  <th className="py-3 px-3.5 text-right">Qty</th>
                  <th className="py-3 px-3.5">Location</th>
                  {activeView === 'trash' ? (
                    <th className="py-3 px-3.5">Retention / Auto-Purge</th>
                  ) : (
                    <th className="py-3 px-3.5">Archived Details</th>
                  )}
                  <th className="py-3 px-3.5 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paginatedList.map((item, idx) => {
                  const isTest = isTestRecord(item);
                  const daysRemaining = getTrashDaysRemaining(item);
                  const isSupplier = item.rma_type === 'supplier_outbound';
                  const loc = normalizeWarehouseLocation(item.warehouse_location, item);
                  const meta = item.ai_document_metadata || {};

                  return (
                    <tr 
                      key={item.id || item.rma_number}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-3.5 text-center font-mono font-bold text-slate-400">
                        #{(currentPage - 1) * pageSize + idx + 1}
                      </td>

                      <td className="py-3 px-3.5 font-mono">
                        <div className="font-bold text-slate-900 dark:text-white">
                          {item.rma_number}
                        </div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                          {isSupplier ? (
                            <span className="text-purple-600 dark:text-purple-400 font-bold">📤 Supplier RTV</span>
                          ) : (
                            <span className="text-blue-600 dark:text-blue-400 font-bold">📥 Customer Inbound</span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-3.5">
                        {isTest ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                            🧪 Sandbox
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                            🟢 Live
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-3.5">
                        <div className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-xs" title={item.name}>
                          {item.name}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          BC: {item.barcode} {item.code || item.sku ? `• SKU: ${item.code || item.sku}` : ''}
                        </div>
                      </td>

                      <td className="py-3 px-3.5 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {formatQuantityWithPackSize(item.quantity, item.unit_name, item.pieces_per_case)}
                      </td>

                      <td className="py-3 px-3.5 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                        {loc}
                      </td>

                      {activeView === 'trash' ? (
                        <td className="py-3 px-3.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-black flex items-center gap-1 border ${
                              daysRemaining <= 7
                                ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border-rose-300 dark:border-rose-700 animate-pulse'
                                : 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                            }`}>
                              <Clock className="w-3 h-3" />
                              <span>⏳ {daysRemaining} days remaining</span>
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            By {meta.trashed_by || 'Staff'} on {meta.trashed_at ? new Date(meta.trashed_at).toLocaleDateString() : 'N/A'}
                          </div>
                        </td>
                      ) : (
                        <td className="py-3 px-3.5">
                          <div className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                            Archived Vault
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            By {meta.archived_by || 'Staff'} on {meta.archived_at ? new Date(meta.archived_at).toLocaleDateString() : 'N/A'}
                          </div>
                        </td>
                      )}

                      <td className="py-3 px-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {canManage && (
                            <button
                              type="button"
                              disabled={actionInProgressId === (item.id || item.rma_number)}
                              onClick={() => handleRestoreItem(item)}
                              className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
                              title="Restore item back to active hub"
                            >
                              <RotateCcw className="w-3 h-3 text-blue-600" />
                              <span>↩️ Restore</span>
                            </button>
                          )}

                          {canManage && (
                            <button
                              type="button"
                              disabled={actionInProgressId === (item.id || item.rma_number)}
                              onClick={() => handleDeleteItemForever(item)}
                              className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors cursor-pointer"
                              title="Permanently destroy this record forever"
                            >
                              <Flame className="w-3.5 h-3.5 text-rose-500" />
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

        {filteredList.length > 0 && (
          <div className="p-3 border-t border-slate-100 dark:border-slate-800">
            <TablePagination
              currentPage={currentPage}
              totalItems={filteredList.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              pageSizeOptions={[10, 15, 25, 50]}
              itemLabel="records"
            />
          </div>
        )}
      </div>
    </div>
  );
}
