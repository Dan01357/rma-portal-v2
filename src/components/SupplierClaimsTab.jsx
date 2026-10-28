import React, { useState, useMemo } from 'react';
import { 
  Building2, 
  Receipt, 
  CheckCircle2, 
  AlertTriangle, 
  Printer, 
  Download, 
  FileText, 
  Search, 
  Filter, 
  Check, 
  ArrowRight,
  ShieldCheck,
  PackageCheck,
  Calendar,
  Layers,
  Sparkles,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  RotateCcw
} from 'lucide-react';
import { exportRMAReportsToCSV } from '../utils/exportCsv';

export default function SupplierClaimsTab({
  reportsList = [],
  currentUser,
  onRefresh
}) {
  const [selectedSupplier, setSelectedSupplier] = useState('All');
  const [dispositionFilter, setDispositionFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('created_at');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selectedRmaIds, setSelectedRmaIds] = useState(new Set());
  const [activeClaimBatch, setActiveClaimBatch] = useState(null);

  // Extract unique suppliers from reports
  const suppliers = useMemo(() => {
    const set = new Set();
    reportsList.forEach(r => {
      const sup = (r.supplier_name || 'Savemore').trim();
      if (sup) set.add(sup);
    });
    return ['All', ...Array.from(set).sort()];
  }, [reportsList]);

  // Handle column sorting
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Filter & sort reports suitable for RTV
  const rtvCandidates = useMemo(() => {
    let list = reportsList.filter(r => {
      const matchesSupplier = selectedSupplier === 'All' || 
        (r.supplier_name || 'Savemore').toLowerCase() === selectedSupplier.toLowerCase();

      const matchesDisposition = dispositionFilter === 'All' || 
        (r.disposition || 'Pending Triage').toLowerCase() === dispositionFilter.toLowerCase();

      const q = searchTerm.toLowerCase().trim();
      const matchesSearch = !q || 
        r.name?.toLowerCase().includes(q) ||
        r.barcode?.includes(q) ||
        r.rma_number?.toLowerCase().includes(q) ||
        r.code?.toLowerCase().includes(q) ||
        r.supplier_name?.toLowerCase().includes(q);

      return matchesSupplier && matchesDisposition && matchesSearch;
    });

    list.sort((a, b) => {
      let valA, valB;
      switch (sortField) {
        case 'rma_number':
          valA = String(a.rma_number || '').toLowerCase();
          valB = String(b.rma_number || '').toLowerCase();
          break;
        case 'supplier_name':
          valA = String(a.supplier_name || 'Savemore').toLowerCase();
          valB = String(b.supplier_name || 'Savemore').toLowerCase();
          break;
        case 'name':
          valA = String(a.name || '').toLowerCase();
          valB = String(b.name || '').toLowerCase();
          break;
        case 'disposition':
          valA = String(a.disposition || 'Pending Triage').toLowerCase();
          valB = String(b.disposition || 'Pending Triage').toLowerCase();
          break;
        case 'quantity':
          valA = Number(a.quantity || 1);
          valB = Number(b.quantity || 1);
          break;
        case 'price':
          valA = Number(a.price_with_vat || a.price || 0);
          valB = Number(b.price_with_vat || b.price || 0);
          break;
        case 'total':
          valA = (Number(a.quantity || 1)) * (Number(a.price_with_vat || a.price || 0));
          valB = (Number(b.quantity || 1)) * (Number(b.price_with_vat || b.price || 0));
          break;
        case 'created_at':
        default:
          valA = new Date(a.created_at || 0).getTime();
          valB = new Date(b.created_at || 0).getTime();
          break;
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [reportsList, selectedSupplier, dispositionFilter, searchTerm, sortField, sortDirection]);

  // Calculate totals of selected items
  const selectedItems = useMemo(() => {
    return rtvCandidates.filter(r => selectedRmaIds.has(r.id || r.rma_number));
  }, [rtvCandidates, selectedRmaIds]);

  const totalClaimAmount = useMemo(() => {
    return selectedItems.reduce((sum, r) => {
      const qty = Number(r.quantity || 1);
      const price = Number(r.price_with_vat || r.price || 0);
      return sum + (qty * price);
    }, 0);
  }, [selectedItems]);

  const totalQuantity = useMemo(() => {
    return selectedItems.reduce((sum, r) => sum + Number(r.quantity || 1), 0);
  }, [selectedItems]);

  const handleToggleSelect = (id) => {
    setSelectedRmaIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedRmaIds.size === rtvCandidates.length && rtvCandidates.length > 0) {
      setSelectedRmaIds(new Set());
    } else {
      setSelectedRmaIds(new Set(rtvCandidates.map(r => r.id || r.rma_number)));
    }
  };

  const handleGenerateBatchClaim = () => {
    if (selectedItems.length === 0) {
      alert('Please select at least 1 RMA item to bundle into a supplier claim.');
      return;
    }

    // Enforce that all bundled items belong to a single vendor
    const suppliersInBatch = [...new Set(selectedItems.map(i => (i.supplier_name || 'Savemore').trim()))];
    if (suppliersInBatch.length > 1) {
      alert(`You have selected items across ${suppliersInBatch.length} different suppliers (${suppliersInBatch.join(', ')}).\n\nAn official Supplier Debit Claim (RTV) voucher must be issued to a single vendor.\n\nPlease select "${suppliersInBatch[0]}" from the Supplier dropdown to batch claims for that vendor.`);
      return;
    }

    const supplierName = suppliersInBatch[0] || (selectedSupplier !== 'All' ? selectedSupplier : 'Savemore');
    const cleanSup = supplierName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(100 + Math.random() * 900);
    const claimNumber = `RTV-${cleanSup}-${dateStr}-${rand}`;

    // Clean user name (strip parenthetical roles like "(Admin)", e.g. "Elisa (Admin)" -> "Elisa")
    // For Logistics/Warehouse debit claim, Danilo Alvaro Jr. is excluded as requested
    const rawName = currentUser?.name || 'Warehouse Staff';
    let cleanGeneratedBy = rawName.replace(/\s*\([^)]*\)/g, '').trim();
    if (!cleanGeneratedBy || cleanGeneratedBy.toLowerCase().includes('danilo alvaro')) {
      cleanGeneratedBy = 'Warehouse Staff';
    }

    setActiveClaimBatch({
      claimNumber,
      supplierName,
      createdAt: new Date().toISOString(),
      generatedBy: cleanGeneratedBy,
      items: selectedItems,
      totalQuantity,
      totalClaimAmount
    });
  };

  const handlePrintClaimVoucher = () => {
    window.print();
  };

  const hasActiveFilters = selectedSupplier !== 'All' || dispositionFilter !== 'All' || Boolean(searchTerm);

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      
      {/* Top Banner */}
      <div className="p-4 sm:p-5 bg-linear-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/20 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center font-black shadow-md shadow-amber-500/20 shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
              Supplier Claims & RTV Chargeback Batching
              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                Vendor Recovery
              </span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Bundle damaged/defective merchandise by vendor to issue consolidated <strong>Return to Vendor (RTV) Debit Claims</strong>.
            </p>
          </div>
        </div>

        {selectedItems.length > 0 && (
          <button
            type="button"
            onClick={handleGenerateBatchClaim}
            className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-black flex items-center gap-2 shadow-lg shadow-amber-600/20 transition-all cursor-pointer active:scale-95 shrink-0"
          >
            <Receipt className="w-4 h-4" />
            <span>Generate Debit Claim ({selectedItems.length} items • ₱{totalClaimAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })})</span>
          </button>
        )}
      </div>

      {/* Filter Controls Bar (Dropdowns + Search) */}
      <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-3 shadow-xs">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Supplier Select Dropdown */}
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0">
                Supplier:
              </label>
              <select
                value={selectedSupplier}
                onChange={(e) => {
                  setSelectedSupplier(e.target.value);
                  setSelectedRmaIds(new Set());
                }}
                className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-amber-600 cursor-pointer shadow-2xs max-w-[200px]"
                title="Filter by Supplier / Vendor"
              >
                {suppliers.map(sup => (
                  <option key={sup} value={sup}>
                    {sup === 'All' ? 'All Suppliers' : sup}
                  </option>
                ))}
              </select>
            </div>

            {/* Disposition Filter Dropdown */}
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0">
                Triage:
              </label>
              <select
                value={dispositionFilter}
                onChange={(e) => {
                  setDispositionFilter(e.target.value);
                  setSelectedRmaIds(new Set());
                }}
                className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-amber-600 cursor-pointer shadow-2xs"
                title="Filter by Triage Disposition"
              >
                <option value="All">All Dispositions</option>
                <option value="Return to Vendor (RTV)">Return to Vendor (RTV)</option>
                <option value="Restock to Inventory">Restock to Inventory</option>
                <option value="Quarantine">Quarantine</option>
                <option value="Scrap / Dispose">Scrap / Dispose</option>
                <option value="Pending Triage">Pending Triage</option>
              </select>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setSelectedSupplier('All');
                  setDispositionFilter('All');
                  setSearchTerm('');
                  setSelectedRmaIds(new Set());
                }}
                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                title="Reset all filters"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            )}
          </div>

          {/* Search Bar */}
          <div className="relative min-w-[240px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search RMA#, product, SKU..."
              className="w-full pl-8 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-amber-600"
            />
          </div>
        </div>

        {/* Selection Bar */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSelectAll}
              className="font-bold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
            >
              {selectedRmaIds.size === rtvCandidates.length && rtvCandidates.length > 0 ? 'Deselect All' : `Select All (${rtvCandidates.length})`}
            </button>
            {selectedRmaIds.size > 0 && (
              <span className="font-bold text-slate-700 dark:text-slate-300">
                {selectedRmaIds.size} item{selectedRmaIds.size > 1 ? 's' : ''} selected • <strong>₱{totalClaimAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => exportRMAReportsToCSV(selectedItems.length > 0 ? selectedItems : rtvCandidates)}
            className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-white flex items-center gap-1 font-bold cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export RTV CSV</span>
          </button>
        </div>
      </div>

      {/* RTV Items Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
        {rtvCandidates.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            No return merchandise matching the selected filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800 select-none">
                <tr>
                  <th className="p-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={selectedRmaIds.size === rtvCandidates.length && rtvCandidates.length > 0}
                      onChange={handleSelectAll}
                      className="rounded-md border-slate-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                    />
                  </th>
                  <th 
                    onClick={() => handleSort('rma_number')}
                    className="p-3 cursor-pointer hover:text-amber-600 transition-colors group"
                  >
                    <div className="flex items-center gap-1">
                      <span>RMA Identifier</span>
                      {sortField === 'rma_number' || sortField === 'created_at' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />
                      ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" />}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('supplier_name')}
                    className="p-3 cursor-pointer hover:text-amber-600 transition-colors group"
                  >
                    <div className="flex items-center gap-1">
                      <span>Vendor / Supplier</span>
                      {sortField === 'supplier_name' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />
                      ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" />}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('name')}
                    className="p-3 cursor-pointer hover:text-amber-600 transition-colors group"
                  >
                    <div className="flex items-center gap-1">
                      <span>Product Description & SKU</span>
                      {sortField === 'name' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />
                      ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" />}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('disposition')}
                    className="p-3 cursor-pointer hover:text-amber-600 transition-colors group"
                  >
                    <div className="flex items-center gap-1">
                      <span>Triage Disposition</span>
                      {sortField === 'disposition' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />
                      ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" />}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('quantity')}
                    className="p-3 text-right cursor-pointer hover:text-amber-600 transition-colors group"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Qty</span>
                      {sortField === 'quantity' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />
                      ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" />}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('price')}
                    className="p-3 text-right cursor-pointer hover:text-amber-600 transition-colors group"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Unit Price</span>
                      {sortField === 'price' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />
                      ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" />}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('total')}
                    className="p-3 text-right cursor-pointer hover:text-amber-600 transition-colors group"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Total Claim</span>
                      {sortField === 'total' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />
                      ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" />}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rtvCandidates.map((r) => {
                  const id = r.id || r.rma_number;
                  const isSelected = selectedRmaIds.has(id);
                  const qty = Number(r.quantity || 1);
                  const price = Number(r.price_with_vat || r.price || 0);
                  const total = qty * price;

                  return (
                    <tr 
                      key={id}
                      onClick={() => handleToggleSelect(id)}
                      className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer ${
                        isSelected ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''
                      }`}
                    >
                      <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(id)}
                          className="rounded-md border-slate-300 text-amber-600 focus:ring-amber-500"
                        />
                      </td>
                      <td className="p-3">
                        <div className="font-mono font-black text-slate-900 dark:text-white">
                          {r.rma_number}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}
                        </div>
                      </td>
                      <td className="p-3 font-semibold text-slate-700 dark:text-slate-300">
                        {r.supplier_name || 'Savemore'}
                      </td>
                      <td className="p-3">
                        <div className="font-bold text-slate-900 dark:text-white truncate max-w-xs">
                          {r.name}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400">
                          SKU: {r.code || r.sku || 'Unassigned'} • BC: {r.barcode}
                        </div>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          r.disposition === 'Return to Vendor (RTV)'
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}>
                          {r.disposition || 'Pending Triage'}
                        </span>
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {qty} {r.unit_name || 'pc'}
                      </td>
                      <td className="p-3 text-right font-mono text-slate-600 dark:text-slate-400">
                        ₱{price.toFixed(2)}
                      </td>
                      <td className="p-3 text-right font-mono font-black text-amber-700 dark:text-amber-400">
                        ₱{total.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* FORMAL RTV DEBIT CLAIM VOUCHER MODAL */}
      {activeClaimBatch && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 max-w-3xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[95vh] animate-in zoom-in-95">
            
            {/* Header */}
            <div className="p-4 sm:px-6 bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-amber-600" />
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                  Supplier Debit Claim Voucher (RTV)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveClaimBatch(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-xs font-bold"
              >
                ✕
              </button>
            </div>

            {/* Printable Voucher Mount */}
            <div id="rtv-voucher-mount" className="p-6 overflow-y-auto space-y-6 text-xs bg-white text-black font-sans">
              
              {/* Header Grid */}
              <div className="border-b-2 border-black pb-4 flex items-start justify-between">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                    WHOLESALE REVERSE LOGISTICS & RECOVERY
                  </div>
                  <h2 className="text-xl font-black text-black">
                    SUPPLIER DEBIT CLAIM VOUCHER
                  </h2>
                  <div className="text-xs text-slate-600 mt-1">
                    Vendor / Counterparty: <strong>{activeClaimBatch.supplierName}</strong>
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-mono text-sm font-black text-black bg-slate-100 px-2 py-1 border border-black inline-block">
                    {activeClaimBatch.claimNumber}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    Date: {new Date(activeClaimBatch.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>

              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 border border-black rounded-lg">
                <div>
                  <div className="text-[9px] font-black uppercase text-slate-500">TOTAL BUNDLED ITEMS</div>
                  <div className="text-base font-black text-black">{activeClaimBatch.items.length} Lines</div>
                </div>
                <div>
                  <div className="text-[9px] font-black uppercase text-slate-500">TOTAL RETURNED UNITS</div>
                  <div className="text-base font-black text-black">{activeClaimBatch.totalQuantity} Units</div>
                </div>
                <div>
                  <div className="text-[9px] font-black uppercase text-slate-500">TOTAL CLAIM AMOUNT</div>
                  <div className="text-base font-black text-amber-800">
                    ₱{activeClaimBatch.totalClaimAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              {/* Itemized Table */}
              <div className="border border-black rounded-lg overflow-hidden">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-100 text-black font-black border-b border-black">
                    <tr>
                      <th className="p-2">RMA #</th>
                      <th className="p-2">Barcode / SKU</th>
                      <th className="p-2">Description</th>
                      <th className="p-2 text-right">Qty</th>
                      <th className="p-2 text-right">Price</th>
                      <th className="p-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {activeClaimBatch.items.map((item, idx) => {
                      const qty = Number(item.quantity || 1);
                      const price = Number(item.price_with_vat || item.price || 0);
                      return (
                        <tr key={idx}>
                          <td className="p-2 font-mono font-bold">{item.rma_number}</td>
                          <td className="p-2 font-mono">{item.code || item.barcode}</td>
                          <td className="p-2">{item.name}</td>
                          <td className="p-2 text-right font-mono font-bold">{qty}</td>
                          <td className="p-2 text-right font-mono">₱{price.toFixed(2)}</td>
                          <td className="p-2 text-right font-mono font-bold">₱{(qty * price).toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Signatures */}
              <div className="grid grid-cols-2 gap-8 pt-8 border-t border-black text-center text-[10px]">
                <div>
                  <div className="border-b border-black pb-8"></div>
                  <div className="font-bold pt-1 uppercase">Prepared By (Logistics / Warehouse)</div>
                  <input
                    type="text"
                    value={activeClaimBatch.generatedBy || ''}
                    onChange={(e) => setActiveClaimBatch(prev => ({ ...prev, generatedBy: e.target.value }))}
                    className="text-center font-semibold text-slate-800 dark:text-slate-100 print:text-black w-full bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-brand-500 rounded text-[11px] px-1"
                    title="Click to edit name if needed"
                  />
                </div>
                <div>
                  <div className="border-b border-black pb-8"></div>
                  <div className="font-bold pt-1 uppercase">Supplier Acknowledgement / Driver Signature</div>
                  <div className="text-slate-500">Signature Over Printed Name & Date</div>
                </div>
              </div>

            </div>

            {/* Footer Actions */}
            <div className="p-4 sm:px-6 bg-slate-50 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <button
                type="button"
                onClick={() => setActiveClaimBatch(null)}
                className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400"
              >
                Close
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrintClaimVoucher}
                  className="px-4 py-2 bg-slate-900 hover:bg-black text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-md cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Voucher</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
