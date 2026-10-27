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
  Sparkles
} from 'lucide-react';
import { exportRMAReportsToCSV } from '../utils/exportCsv';

export default function SupplierClaimsTab({
  reportsList = [],
  currentUser,
  onRefresh
}) {
  const [selectedSupplier, setSelectedSupplier] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
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

  // Filter reports suitable for RTV
  const rtvCandidates = useMemo(() => {
    return reportsList.filter(r => {
      const matchesSupplier = selectedSupplier === 'All' || 
        (r.supplier_name || 'Savemore').toLowerCase() === selectedSupplier.toLowerCase();

      const matchesSearch = !searchTerm || 
        r.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.barcode?.includes(searchTerm) ||
        r.rma_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.code?.toLowerCase().includes(searchTerm.toLowerCase());

      return matchesSupplier && matchesSearch;
    });
  }, [reportsList, selectedSupplier, searchTerm]);

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
    if (selectedRmaIds.size === rtvCandidates.length) {
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

    const supplierName = selectedSupplier !== 'All' 
      ? selectedSupplier 
      : (selectedItems[0]?.supplier_name || 'Savemore');

    const cleanSup = supplierName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(100 + Math.random() * 900);
    const claimNumber = `RTV-${cleanSup}-${dateStr}-${rand}`;

    setActiveClaimBatch({
      claimNumber,
      supplierName,
      createdAt: new Date().toISOString(),
      generatedBy: currentUser?.name || 'Logistics Admin',
      items: selectedItems,
      totalQuantity,
      totalClaimAmount
    });
  };

  const handlePrintClaimVoucher = () => {
    window.print();
  };

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

      {/* Filter Controls & Supplier Tabs */}
      <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Supplier Horizontal Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
            <span className="text-xs font-bold text-slate-400 dark:text-slate-500 shrink-0 mr-1">
              Supplier:
            </span>
            {suppliers.map(sup => (
              <button
                key={sup}
                type="button"
                onClick={() => {
                  setSelectedSupplier(sup);
                  setSelectedRmaIds(new Set());
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-colors cursor-pointer ${
                  selectedSupplier === sup
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                {sup}
              </button>
            ))}
          </div>

          {/* Search Bar */}
          <div className="relative min-w-[220px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search RMA#, product, SKU..."
              className="w-full pl-8 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-amber-600"
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
                {selectedRmaIds.size} items selected • <strong>₱{totalClaimAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
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
            No return merchandise matching the selected supplier filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={selectedRmaIds.size === rtvCandidates.length && rtvCandidates.length > 0}
                      onChange={handleSelectAll}
                      className="rounded-md border-slate-300 text-amber-600 focus:ring-amber-500"
                    />
                  </th>
                  <th className="p-3">RMA Identifier</th>
                  <th className="p-3">Vendor / Supplier</th>
                  <th className="p-3">Product Description & SKU</th>
                  <th className="p-3">Triage Disposition</th>
                  <th className="p-3 text-right">Qty</th>
                  <th className="p-3 text-right">Unit Price</th>
                  <th className="p-3 text-right">Total Claim</th>
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
                  <div className="text-slate-500">{activeClaimBatch.generatedBy}</div>
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
