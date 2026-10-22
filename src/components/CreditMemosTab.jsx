import React, { useState, useMemo } from 'react';
import { 
  Receipt, 
  Search, 
  Plus, 
  Printer, 
  Edit3, 
  Trash2, 
  DollarSign, 
  Package, 
  ArrowUpDown, 
  ArrowUp, 
  ArrowDown, 
  Download, 
  FileText, 
  RotateCcw,
  Building2,
  Calendar,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import TablePagination from './TablePagination';

export default function CreditMemosTab({
  creditMemosList = [],
  onOpenCreateModal,
  onEditCreditMemo,
  onViewVoucher,
  onRequestDeleteCreditMemo,
  recentReportsList = [],
  currentUser
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [companyFilter, setCompanyFilter] = useState('all');
  const [sortField, setSortField] = useState('credit_issued_at');
  const [sortDirection, setSortDirection] = useState('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Financial summary metrics
  const metrics = useMemo(() => {
    let totalCredited = 0;
    let totalGross = 0;
    let totalUnits = 0;

    creditMemosList.forEach(m => {
      totalCredited += Number(m.credit_amount || m.amount || 0);
      totalGross += Number(m.amount || 0);
      totalUnits += Number(m.quantity || 1);
    });

    return {
      count: creditMemosList.length,
      totalCredited,
      totalGross,
      totalUnits
    };
  }, [creditMemosList]);

  // Filter & sort
  const processedMemos = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    let list = creditMemosList.filter(item => {
      if (q) {
        const matches = (
          (item.credit_memo_number || '').toLowerCase().includes(q) ||
          (item.rma_number || '').toLowerCase().includes(q) ||
          (item.barcode || '').toLowerCase().includes(q) ||
          (item.product_name || '').toLowerCase().includes(q) ||
          (item.pull_out_ref || '').toLowerCase().includes(q) ||
          (item.credit_issued_by || '').toLowerCase().includes(q) ||
          (item.supplier_name || '').toLowerCase().includes(q)
        );
        if (!matches) return false;
      }

      if (companyFilter !== 'all') {
        const comp = String(item.company || '').toLowerCase();
        if (companyFilter === 'pingcon' && !comp.includes('pingcon')) return false;
        if (companyFilter === 'keysys' && !comp.includes('keysys') && !comp.includes('a2z')) return false;
      }

      return true;
    });

    list.sort((a, b) => {
      let valA, valB;
      switch (sortField) {
        case 'credit_memo_number':
          valA = String(a.credit_memo_number || '').toLowerCase();
          valB = String(b.credit_memo_number || '').toLowerCase();
          break;
        case 'credit_amount':
          valA = Number(a.credit_amount || 0);
          valB = Number(b.credit_amount || 0);
          break;
        case 'quantity':
          valA = Number(a.quantity || 0);
          valB = Number(b.quantity || 0);
          break;
        case 'product_name':
          valA = String(a.product_name || '').toLowerCase();
          valB = String(b.product_name || '').toLowerCase();
          break;
        case 'credit_issued_at':
        default:
          valA = new Date(a.credit_issued_at || 0).getTime();
          valB = new Date(b.credit_issued_at || 0).getTime();
          break;
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [creditMemosList, searchQuery, companyFilter, sortField, sortDirection]);

  // Paginated slice
  const paginatedMemos = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return processedMemos.slice(start, start + pageSize);
  }, [processedMemos, currentPage, pageSize]);

  const handleSort = (field) => {
    setCurrentPage(1);
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const handleExportCsv = () => {
    if (!processedMemos.length) return;
    const headers = [
      'Credit Memo #',
      'RMA #',
      'Barcode',
      'Product Name',
      'Quantity',
      'Unit',
      'Unit Price',
      'Gross Amount',
      'Pull Out Ref',
      'Pull Out Date',
      'Credit Amount',
      'Credit Issued By',
      'Issued At',
      'Supplier',
      'Customer AE'
    ];

    const rows = processedMemos.map(m => [
      `"${m.credit_memo_number || ''}"`,
      `"${m.rma_number || ''}"`,
      `"${m.barcode || ''}"`,
      `"${(m.product_name || '').replace(/"/g, '""')}"`,
      m.quantity || 1,
      `"${m.unit_name || 'pc'}"`,
      m.unit_price || 0,
      m.amount || 0,
      `"${(m.pull_out_ref || '').replace(/"/g, '""')}"`,
      `"${m.pull_out_date || ''}"`,
      m.credit_amount || 0,
      `"${(m.credit_issued_by || '').replace(/"/g, '""')}"`,
      `"${m.credit_issued_at ? new Date(m.credit_issued_at).toLocaleString() : ''}"`,
      `"${(m.supplier_name || '').replace(/"/g, '""')}"`,
      `"${(m.customer_ae_name || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Finance_Credit_Memos_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4 animate-in fade-in">
      
      {/* Financial Summary KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400 mb-1.5">
            <Receipt className="w-5 h-5" />
            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
              Approved
            </span>
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white font-mono">
            {metrics.count}
          </div>
          <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">Credit Memos</div>
          <div className="text-[11px] text-slate-400">Total vouchers issued</div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400 mb-1.5">
            <DollarSign className="w-5 h-5" />
            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
              Credited
            </span>
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
            ₱{metrics.totalCredited.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">Total Credit Amount</div>
          <div className="text-[11px] text-slate-400">Financial deductions granted</div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-blue-600 dark:text-blue-400 mb-1.5">
            <Package className="w-5 h-5" />
            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300">
              Logistics
            </span>
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white font-mono">
            {metrics.totalUnits}
          </div>
          <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">Units Pulled Out</div>
          <div className="text-[11px] text-slate-400">Total defective/pull-out pcs</div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-indigo-600 dark:text-indigo-400 mb-1.5">
            <Building2 className="w-5 h-5" />
            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
              Ledger
            </span>
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white font-mono">
            ₱{metrics.totalGross.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">Gross Invoiced Value</div>
          <div className="text-[11px] text-slate-400">Initial gross claim</div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
        
        {/* Title and Top Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                Finance Credit Memorandum Section
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-mono">
                {creditMemosList.length} Total
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Manage approved customer deductions, pull-out receipts, credit amounts, and printable accounting vouchers.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {creditMemosList.length > 0 && (
              <button
                type="button"
                onClick={handleExportCsv}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenCreateModal}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-extrabold flex items-center gap-1.5 shadow-sm shadow-emerald-600/20 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Issue Credit Memo</span>
            </button>
          </div>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-3.5 space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search by CM #, RMA #, barcode, item name, pull-out ref, or issuer..."
                className="w-full pl-10 pr-9 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-emerald-600 transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setCurrentPage(1);
                  }}
                  className="absolute right-3 top-2 text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <select
              value={companyFilter}
              onChange={(e) => {
                setCompanyFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-emerald-600 cursor-pointer"
            >
              <option value="all">All Divisions</option>
              <option value="pingcon">Pingcon / Bonita</option>
              <option value="keysys">A2Z2GO / Keysys</option>
            </select>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 px-1 font-medium">
            <span>
              Showing <strong className="text-slate-900 dark:text-white font-bold">{processedMemos.length}</strong> of {creditMemosList.length} credit memos
            </span>
            <span className="text-slate-400">
              Click column headers to sort (<strong className="text-slate-700 dark:text-slate-300 capitalize">{sortField}</strong> {sortDirection === 'asc' ? '▲' : '▼'})
            </span>
          </div>
        </div>

        {/* Table Records */}
        {creditMemosList.length === 0 ? (
          <div className="text-center py-12 space-y-3 bg-slate-50/50 dark:bg-slate-800/40 rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 p-6">
            <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
              <Receipt className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
              No Credit Memos Issued Yet
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              When items are returned and pulled out from stores or warehouse inventory, Finance can issue official Credit Memos with approved credit amounts and printable vouchers.
            </p>
            <button
              type="button"
              onClick={onOpenCreateModal}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Issue First Credit Memo</span>
            </button>
          </div>
        ) : processedMemos.length === 0 ? (
          <div className="text-center py-10 text-xs font-bold text-slate-500 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700">
            No credit memos match "{searchQuery}"
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/90 dark:bg-slate-800/90 border-b border-slate-200 dark:border-slate-700 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <th 
                      onClick={() => handleSort('credit_memo_number')}
                      className="py-3 px-3.5 font-black text-slate-900 dark:text-white cursor-pointer select-none hover:text-emerald-600 transition-colors"
                    >
                      <div className="flex items-center gap-1">
                        <span>CM #</span>
                        {sortField === 'credit_memo_number' ? (
                          sortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-emerald-600" /> : <ArrowDown className="w-3.5 h-3.5 text-emerald-600" />
                        ) : <ArrowUpDown className="w-3 h-3 text-slate-300" />}
                      </div>
                    </th>
                    <th className="py-3 px-3.5 font-bold">RMA Return Ticket</th>
                    <th 
                      onClick={() => handleSort('product_name')}
                      className="py-3 px-3.5 font-bold cursor-pointer select-none hover:text-emerald-600 transition-colors"
                    >
                      <div className="flex items-center gap-1">
                        <span>Product & Barcode</span>
                        {sortField === 'product_name' ? (
                          sortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-emerald-600" /> : <ArrowDown className="w-3.5 h-3.5 text-emerald-600" />
                        ) : <ArrowUpDown className="w-3 h-3 text-slate-300" />}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('quantity')}
                      className="py-3 px-3 font-bold text-center cursor-pointer select-none hover:text-emerald-600 transition-colors"
                    >
                      <span>Quantity</span>
                    </th>
                    <th className="py-3 px-3 text-right font-bold">Gross Amount</th>
                    <th className="py-3 px-3.5 font-bold">Pull Out Reference</th>
                    <th 
                      onClick={() => handleSort('credit_amount')}
                      className="py-3 px-3.5 font-black text-right cursor-pointer select-none hover:text-emerald-600 transition-colors"
                    >
                      <div className="flex items-center justify-end gap-1">
                        <span>Credit Amount (₱)</span>
                        {sortField === 'credit_amount' ? (
                          sortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-emerald-600" /> : <ArrowDown className="w-3.5 h-3.5 text-emerald-600" />
                        ) : <ArrowUpDown className="w-3 h-3 text-slate-300" />}
                      </div>
                    </th>
                    <th className="py-3 px-3.5 font-bold">Credit Issued By</th>
                    <th className="py-3 px-3 text-center font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                  {paginatedMemos.map(memo => (
                    <tr 
                      key={memo.credit_memo_number}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      {/* CM # */}
                      <td className="py-3 px-3.5">
                        <button
                          type="button"
                          onClick={() => onViewVoucher(memo)}
                          className="font-mono font-black text-xs text-emerald-700 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
                          title="Click to view official printable voucher"
                        >
                          <Receipt className="w-3.5 h-3.5 shrink-0" />
                          <span>{memo.credit_memo_number}</span>
                        </button>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500 font-sans">
                          {memo.credit_issued_at ? new Date(memo.credit_issued_at).toLocaleDateString() : ''}
                        </div>
                      </td>

                      {/* RMA # */}
                      <td className="py-3 px-3.5 font-mono font-bold text-blue-700 dark:text-blue-400 text-xs">
                        {memo.rma_number || 'N/A'}
                        <div className="text-[10px] text-slate-400 font-sans">
                          Supplier: {memo.supplier_name || 'Savemore'}
                        </div>
                      </td>

                      {/* Product Name & Barcode */}
                      <td className="py-3 px-3.5 max-w-[200px]">
                        <div className="font-bold text-slate-900 dark:text-white truncate" title={memo.product_name}>
                          {memo.product_name}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {memo.barcode} {memo.sku ? `• SKU: ${memo.sku}` : ''}
                        </div>
                      </td>

                      {/* Quantity */}
                      <td className="py-3 px-3 text-center font-bold font-mono text-slate-900 dark:text-white">
                        {memo.quantity} {memo.unit_name || 'pc'}
                      </td>

                      {/* Gross Amount */}
                      <td className="py-3 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                        ₱{Number(memo.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>

                      {/* Pull Out Reference */}
                      <td className="py-3 px-3.5 max-w-[180px]">
                        <div className="font-bold text-slate-800 dark:text-slate-200 truncate" title={memo.pull_out_ref}>
                          {memo.pull_out_ref || 'Warehouse Pull-Out'}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          Date: {memo.pull_out_date || 'N/A'}
                        </div>
                      </td>

                      {/* Credit Amount (₱) */}
                      <td className="py-3 px-3.5 text-right font-black font-mono text-emerald-700 dark:text-emerald-400 text-sm">
                        ₱{Number(memo.credit_amount || memo.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>

                      {/* Credit Issued By */}
                      <td className="py-3 px-3.5">
                        <div className="font-bold text-slate-900 dark:text-white text-xs truncate max-w-[140px]" title={memo.credit_issued_by}>
                          {memo.credit_issued_by || 'Finance'}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono truncate max-w-[140px]">
                          {memo.credit_issued_by_email || ''}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onViewVoucher(memo)}
                            className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                            title="Print Official Credit Voucher"
                          >
                            <Printer className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => onEditCreditMemo(memo)}
                            className="p-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                            title="Edit Credit Memo"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>

                          {onRequestDeleteCreditMemo && (
                            <button
                              type="button"
                              onClick={() => onRequestDeleteCreditMemo(memo)}
                              className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                              title="Void / Delete Credit Memo"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <TablePagination
              currentPage={currentPage}
              pageSize={pageSize}
              totalItems={processedMemos.length}
              onPageChange={setCurrentPage}
              onPageSizeChange={(newSize) => {
                setPageSize(newSize);
                setCurrentPage(1);
              }}
            />
          </div>
        )}

      </div>
    </div>
  );
}
