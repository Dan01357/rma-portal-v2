import React, { useState, useEffect } from 'react';
import { 
  Truck, 
  Clock, 
  AlertCircle, 
  FilePlus, 
  CheckCircle, 
  Building2, 
  Package, 
  Layers, 
  ArrowRight,
  ShieldAlert,
  Printer,
  Phone,
  Mail,
  UserCheck,
  Search,
  ExternalLink
} from 'lucide-react';
import { formatPeso } from '../utils/rmaHelpers';
import { rmaApi } from '../supabaseClient';

export default function PurchasingBufferTab({ tickets = [], onUpdateTicket }) {
  const [createdPoNotice, setCreatedPoNotice] = useState(null);
  const [liveSuppliers, setLiveSuppliers] = useState([]);
  const [supplierSearchQuery, setSupplierSearchQuery] = useState('');
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);

  useEffect(() => {
    async function loadSuppliers() {
      try {
        const suppliers = await rmaApi.getLiveSuppliers(200);
        setLiveSuppliers(suppliers);
      } catch (e) {
        console.warn('Failed to load suppliers:', e);
      }
    }
    loadSuppliers();
  }, []);

  // Group tickets by supplier
  const supplierGroups = tickets.reduce((acc, ticket) => {
    const supp = ticket.supplier || 'Unassigned Supplier';
    if (!acc[supp]) {
      acc[supp] = {
        supplierName: supp,
        tickets: [],
        totalUnits: 0,
        totalAmount: 0,
        pendingBufferDaysMin: 7
      };
    }
    acc[supp].tickets.push(ticket);
    acc[supp].totalUnits += Number(ticket.quantity) || 0;
    acc[supp].totalAmount += Number(ticket.total_amount) || 0;
    if (ticket.buffer_days_left !== undefined && ticket.buffer_days_left < acc[supp].pendingBufferDaysMin) {
      acc[supp].pendingBufferDaysMin = ticket.buffer_days_left;
    }
    return acc;
  }, {});

  const supplierList = Object.values(supplierGroups);

  // Action: Generate Vendor Return PO
  const handleGenerateSupplierPO = async (suppName, ticketIds) => {
    const year = new Date().getFullYear();
    const poNumber = `PO-RET-${year}-${String(Math.floor(100 + Math.random() * 900))}`;

    for (const id of ticketIds) {
      await onUpdateTicket(id, {
        supplier_po_no: poNumber,
        status: 'In Transit'
      });
    }

    setCreatedPoNotice(`Consolidated Vendor Purchase Order #${poNumber} issued for ${suppName} (${ticketIds.length} RMA items consolidated)`);
    setTimeout(() => setCreatedPoNotice(null), 5000);
  };

  // Action: Buffer Dispatch
  const handleBufferDispatch = async (ticket) => {
    await onUpdateTicket(ticket.id, {
      status: 'Buffer Replacement',
      notes: `Buffer units dispatched from Warehouse Inventory Buffer stock on ${new Date().toLocaleDateString()}.`
    });
    setCreatedPoNotice(`Inventory buffer stock allocated for Ticket ${ticket.id} (${ticket.quantity} units)!`);
    setTimeout(() => setCreatedPoNotice(null), 5000);
  };

  return (
    <div className="space-y-6">
      
      {/* Toast Notice */}
      {createdPoNotice && (
        <div className="p-4 bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-500/40 text-purple-900 dark:text-purple-200 rounded-2xl flex items-center space-x-3 text-xs sm:text-sm animate-in slide-in-from-top-2 shadow-sm">
          <CheckCircle className="w-5 h-5 text-purple-600 dark:text-purple-400 shrink-0" />
          <span className="font-semibold">{createdPoNotice}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-purple-50 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-500/40">
              Purchasing & Inventory Buffer Control
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-1 flex items-center gap-2">
            <Truck className="w-6 h-6 text-purple-600 dark:text-purple-400" />
            Supplier Consolidated Claims & SLA Countdown
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Group defective merchandise by factory supplier to issue batch POs and monitor Inventory buffer replacement turnaround.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setIsSupplierModalOpen(true)}
            className="px-3.5 py-2 bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/80 dark:hover:bg-purple-900 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 rounded-2xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <Search className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
            <span>Supplier Directory ({liveSuppliers.length > 0 ? liveSuppliers.length : 610})</span>
          </button>

          <div className="flex items-center space-x-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-2.5 rounded-2xl text-xs font-mono">
            <div className="text-center px-3">
              <span className="text-slate-400 block text-[10px]">SUPPLIERS</span>
              <span className="text-purple-600 dark:text-purple-400 font-bold text-base">{supplierList.length}</span>
            </div>
            <div className="w-px h-7 bg-slate-200 dark:bg-slate-800"></div>
            <div className="text-center px-3">
              <span className="text-slate-400 block text-[10px]">TOTAL DEFECTS</span>
              <span className="text-slate-900 dark:text-white font-bold text-base">
                {supplierList.reduce((acc, s) => acc + s.totalUnits, 0)} Units
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Supplier Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {supplierList.map((group) => {
          const matchedSupplier = liveSuppliers.find(s => 
            s.sheet_supplier_name?.toLowerCase() === group.supplierName.toLowerCase() ||
            s.full_company_name?.toLowerCase().includes(group.supplierName.toLowerCase()) ||
            group.supplierName.toLowerCase().includes(s.sheet_supplier_name?.toLowerCase() || '___')
          );

          return (
            <div 
              key={group.supplierName}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col justify-between space-y-4"
            >
              {/* Header */}
              <div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center text-xs font-bold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
                    <Building2 className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 mr-1.5" />
                    {group.supplierName}
                  </span>

                  {/* Buffer Countdown Badge */}
                  <div className={`px-2.5 py-1 rounded-xl text-xs font-mono font-bold flex items-center space-x-1.5 border ${
                    group.pendingBufferDaysMin <= 0
                      ? 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border-rose-200 dark:border-rose-500/50 animate-pulse'
                      : group.pendingBufferDaysMin <= 3
                      ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-amber-200 dark:border-amber-500/40'
                      : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/40'
                  }`}>
                    <Clock className="w-3.5 h-3.5" />
                    <span>
                      {group.pendingBufferDaysMin <= 0 
                        ? 'SLA OVERDUE (0d)' 
                        : `${group.pendingBufferDaysMin} Days Buffer Left`}
                    </span>
                  </div>
                </div>

                {/* Live Vendor Contact Details from auto_po_supplier_contacts */}
                {matchedSupplier && (
                  <div className="mt-3 p-3 rounded-2xl bg-purple-50/70 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/40 text-xs text-slate-700 dark:text-slate-300 space-y-1">
                    <div className="flex items-center justify-between font-bold text-purple-900 dark:text-purple-200">
                      <span>{matchedSupplier.full_company_name || matchedSupplier.sheet_supplier_name}</span>
                      <span className="font-mono text-[10px] bg-purple-200/60 dark:bg-purple-800/60 px-2 py-0.5 rounded-md">
                        {matchedSupplier.terms || 'Standard Terms'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
                      {matchedSupplier.contact_person && <span>👤 {matchedSupplier.contact_person}</span>}
                      {matchedSupplier.phone && <span>📞 {matchedSupplier.phone}</span>}
                      {matchedSupplier.email && <span>✉️ {matchedSupplier.email}</span>}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 mt-4 text-xs font-mono">
                  <div className="bg-slate-50 dark:bg-slate-950/70 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-400 text-[10px] block">Consolidated Units</span>
                    <span className="text-lg font-bold text-slate-900 dark:text-white">{group.totalUnits} Units</span>
                    <span className="text-slate-500 text-[10px] block">{group.tickets.length} Returns</span>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-950/70 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-400 text-[10px] block">Total Claim Value</span>
                    <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{formatPeso(group.totalAmount)}</span>
                    <span className="text-slate-500 text-[10px] block">To Debit / Replace</span>
                  </div>
                </div>
              </div>

              {/* Items in Supplier Pool */}
              <div className="space-y-2 border-t border-slate-100 dark:border-slate-800/80 pt-3">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                  Consolidated Defective Lots:
                </span>
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {group.tickets.map((t) => (
                    <div 
                      key={t.id} 
                      className="p-2.5 bg-slate-50 dark:bg-slate-950/80 rounded-xl border border-slate-200 dark:border-slate-800/80 flex items-center justify-between text-xs"
                    >
                      <div className="truncate mr-2">
                        <span className="font-mono text-purple-600 dark:text-purple-300 font-bold mr-1.5">{t.id}</span>
                        <span className="text-slate-800 dark:text-slate-200">{t.sku} - {t.product_name}</span>
                        <div className="text-[10px] text-slate-500">
                          {t.quantity} pcs • {t.customer_name} • PO: {t.supplier_po_no || 'PO Unassigned'}
                        </div>
                      </div>

                      {t.status !== 'Buffer Replacement' && (
                        <button
                          type="button"
                          onClick={() => handleBufferDispatch(t)}
                          className="shrink-0 px-2 py-1 text-[11px] font-semibold bg-purple-100 hover:bg-purple-200 dark:bg-purple-600/20 dark:hover:bg-purple-600 text-purple-800 dark:text-purple-200 dark:hover:text-white rounded-lg border border-purple-200 dark:border-purple-500/40 transition-colors"
                          title="Allocate replacement from Inventory buffer"
                        >
                          Dispatch Buffer
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Action: Generate PO */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
                <span className="text-[11px] text-slate-500 font-mono">
                  PO: {group.tickets[0]?.supplier_po_no || 'None'}
                </span>

                <button
                  type="button"
                  onClick={() => handleGenerateSupplierPO(group.supplierName, group.tickets.map(t => t.id))}
                  className="px-3.5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl flex items-center space-x-1.5 shadow-md shadow-purple-600/20 transition-all"
                >
                  <FilePlus className="w-4 h-4" />
                  <span>Issue Supplier Return PO</span>
                </button>
              </div>

            </div>
          );
        })}
      </div>

      {/* Live Supplier Directory Modal (610 Suppliers) */}
      {isSupplierModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 border-t sm:border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-3xl w-full max-w-3xl max-h-[92dvh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200 pb-safe">
            {/* Mobile bottom-sheet drag handle */}
            <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0">
              <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700"></div>
            </div>

            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  Live Supplier Directory ({liveSuppliers.length > 0 ? liveSuppliers.length : 610} Vendors)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Connected to <code className="font-mono text-purple-600">auto_po_supplier_contacts</code> • Search primary and secondary suppliers
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSupplierModalOpen(false)}
                className="min-w-[44px] min-h-[44px] rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 font-bold transition-colors"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Modal Search Bar */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  value={supplierSearchQuery}
                  onChange={(e) => setSupplierSearchQuery(e.target.value)}
                  placeholder="Search vendor name, contact person, or payment terms (e.g. Banela, Munoz, Suy Sing, PDC)..."
                  className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium focus:outline-none focus:border-purple-500"
                  autoFocus
                />
              </div>
            </div>

            {/* Modal Supplier List */}
            <div className="p-4 overflow-y-auto space-y-2 flex-1">
              {liveSuppliers
                .filter(s => {
                  if (!supplierSearchQuery.trim()) return true;
                  const q = supplierSearchQuery.toLowerCase();
                  return (
                    s.sheet_supplier_name?.toLowerCase().includes(q) ||
                    s.full_company_name?.toLowerCase().includes(q) ||
                    s.contact_person?.toLowerCase().includes(q) ||
                    s.terms?.toLowerCase().includes(q) ||
                    s.phone?.includes(q)
                  );
                })
                .slice(0, 50)
                .map((sup) => (
                  <div
                    key={sup.id}
                    className="p-3 bg-white dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:border-purple-300 dark:hover:border-purple-800 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-slate-900 dark:text-white">
                          {sup.full_company_name || sup.sheet_supplier_name}
                        </span>
                        {sup.sheet_supplier_name && sup.sheet_supplier_name !== sup.full_company_name && (
                          <span className="text-[10px] text-purple-600 font-mono bg-purple-50 dark:bg-purple-950 px-1.5 py-0.5 rounded">
                            {sup.sheet_supplier_name}
                          </span>
                        )}
                        {sup.terms && (
                          <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-mono bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                            {sup.terms}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                        {sup.contact_person && <span>👤 Contact: <b className="text-slate-700 dark:text-slate-300">{sup.contact_person}</b></span>}
                        {sup.phone && <span>📞 Phone: <span className="font-mono">{sup.phone}</span></span>}
                        {sup.email && <span>✉️ Email: <span className="font-mono">{sup.email}</span></span>}
                      </div>
                      {sup.address && (
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          📍 {sup.address}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        handleGenerateSupplierPO(sup.sheet_supplier_name || sup.full_company_name, []);
                        setIsSupplierModalOpen(false);
                      }}
                      className="shrink-0 px-3 py-1.5 bg-purple-50 hover:bg-purple-100 dark:bg-purple-950 dark:hover:bg-purple-900 text-purple-700 dark:text-purple-300 font-bold text-[11px] rounded-xl border border-purple-200 dark:border-purple-800 transition-colors"
                    >
                      Draft Return PO
                    </button>
                  </div>
                ))}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
              <span>Showing up to 50 matching suppliers</span>
              <button
                type="button"
                onClick={() => setIsSupplierModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
