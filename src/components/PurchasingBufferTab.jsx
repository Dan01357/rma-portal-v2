import React, { useState } from 'react';
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
  Printer
} from 'lucide-react';
import { formatPeso } from '../utils/rmaHelpers';

export default function PurchasingBufferTab({ tickets = [], onUpdateTicket }) {
  const [createdPoNotice, setCreatedPoNotice] = useState(null);

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

      {/* Supplier Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {supplierList.map((group) => {
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

    </div>
  );
}
