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
  const [activeSupplier, setActiveSupplier] = useState('ALL');
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
        <div className="p-4 bg-purple-950 border border-purple-500/40 text-purple-200 rounded-xl flex items-center space-x-3 text-xs sm:text-sm animate-in slide-in-from-top-2">
          <CheckCircle className="w-5 h-5 text-purple-400 shrink-0" />
          <span className="font-semibold">{createdPoNotice}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/40">
              Purchasing & Inventory Buffer Control
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-1 flex items-center gap-2">
            <Truck className="w-6 h-6 text-purple-400" />
            Purchasing & Inventory Buffer: Supplier Claims & SLA Countdown
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Group defective merchandise by factory supplier to issue batch POs and monitor Inventory buffer replacement turnaround.
          </p>
        </div>

        <div className="flex items-center space-x-3 bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-xs font-mono">
          <div className="text-center px-2">
            <span className="text-slate-500 block text-[10px]">SUPPLIERS</span>
            <span className="text-purple-400 font-bold text-base">{supplierList.length}</span>
          </div>
          <div className="w-px h-7 bg-slate-800"></div>
          <div className="text-center px-2">
            <span className="text-slate-500 block text-[10px]">TOTAL DEFECTS</span>
            <span className="text-white font-bold text-base">
              {supplierList.reduce((acc, s) => acc + s.totalUnits, 0)} Units
            </span>
          </div>
        </div>
      </div>

      {/* Supplier Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {supplierList.map((group) => {
          const hasOverdue = group.tickets.some(t => t.buffer_days_left <= 0);
          const pendingTickets = group.tickets.filter(t => t.status !== 'Credit Memo Issued');

          return (
            <div 
              key={group.supplierName}
              className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 shadow-xl flex flex-col justify-between space-y-4"
            >
              {/* Header */}
              <div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center text-xs font-bold text-slate-200 bg-slate-800 px-3 py-1 rounded-lg border border-slate-700">
                    <Building2 className="w-3.5 h-3.5 text-purple-400 mr-1.5" />
                    {group.supplierName}
                  </span>

                  {/* Buffer Countdown Badge */}
                  <div className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold flex items-center space-x-1.5 border ${
                    group.pendingBufferDaysMin <= 0
                      ? 'bg-rose-950 text-rose-300 border-rose-500/50 animate-pulse'
                      : group.pendingBufferDaysMin <= 3
                      ? 'bg-amber-950 text-amber-300 border-amber-500/40'
                      : 'bg-emerald-950 text-emerald-300 border-emerald-500/40'
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
                  <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                    <span className="text-slate-500 text-[10px] block">Consolidated Units</span>
                    <span className="text-lg font-bold text-white">{group.totalUnits} Units</span>
                    <span className="text-slate-400 text-[10px] block">{group.tickets.length} Returns</span>
                  </div>

                  <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                    <span className="text-slate-500 text-[10px] block">Total Claim Value</span>
                    <span className="text-lg font-bold text-emerald-400">{formatPeso(group.totalAmount)}</span>
                    <span className="text-slate-400 text-[10px] block">To Debit / Replace</span>
                  </div>
                </div>
              </div>

              {/* Items in Supplier Pool */}
              <div className="space-y-2 border-t border-slate-800/80 pt-3">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                  Consolidated Defective Lots:
                </span>
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {group.tickets.map((t) => (
                    <div 
                      key={t.id} 
                      className="p-2 bg-slate-950/80 rounded-lg border border-slate-800/80 flex items-center justify-between text-xs"
                    >
                      <div className="truncate mr-2">
                        <span className="font-mono text-purple-300 font-bold mr-1.5">{t.id}</span>
                        <span className="text-slate-300">{t.sku} - {t.product_name}</span>
                        <div className="text-[10px] text-slate-500">
                          {t.quantity} pcs • {t.customer_name} • PO: {t.supplier_po_no || 'PO Unassigned'}
                        </div>
                      </div>

                      {t.status !== 'Buffer Replacement' && (
                        <button
                          type="button"
                          onClick={() => handleBufferDispatch(t)}
                          className="shrink-0 px-2 py-1 text-[11px] font-medium bg-purple-600/20 hover:bg-purple-600 text-purple-200 hover:text-white rounded border border-purple-500/40 transition-colors"
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
              <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-3">
                <span className="text-[11px] text-slate-400 font-mono">
                  Active PO: {group.tickets[0]?.supplier_po_no || 'None'}
                </span>

                <button
                  type="button"
                  onClick={() => handleGenerateSupplierPO(group.supplierName, group.tickets.map(t => t.id))}
                  className="px-3.5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-xl flex items-center space-x-1.5 shadow-md shadow-purple-600/30 transition-all"
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
