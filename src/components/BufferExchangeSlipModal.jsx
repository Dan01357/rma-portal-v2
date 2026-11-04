import React, { useState } from 'react';
import { X, Printer, Truck, ArrowLeftRight, CheckCircle2, Building2, Package, ShieldCheck, UserCheck, Calendar, FileText, RefreshCw, AlertCircle } from 'lucide-react';
import { printIsolatedElement } from '../utils/printIsolatedElement';
import { supabase } from '../supabaseClient';

export default function BufferExchangeSlipModal({
  isOpen,
  onClose,
  report,
  reports = [],
  onDispatched
}) {
  if (!isOpen) return null;

  // Resolve target reports array
  const reportsToRender = (reports && reports.length > 0)
    ? reports
    : (report ? [report] : []);

  if (reportsToRender.length === 0) return null;

  // Driver, vehicle, and dispatch state
  const [driverName, setDriverName] = useState(report?.ai_document_metadata?.buffer_driver || '');
  const [plateNumber, setPlateNumber] = useState(report?.ai_document_metadata?.buffer_plate || '');
  const [dispatcherName, setDispatcherName] = useState('Logistics Lead');
  const [sourceBin, setSourceBin] = useState(report?.warehouse_location || 'BUFFER-STOCK-RACK-01');
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchSuccess, setDispatchSuccess] = useState(false);
  const [autoPrintOnDispatch, setAutoPrintOnDispatch] = useState(true);

  const isAlreadyDispatched = reportsToRender.some(
    r => r.status === 'buffer_replacement_dispatched' || (r.disposition && r.disposition.includes('Buffer'))
  );

  const handleConfirmDispatch = async () => {
    if (isDispatching) return;
    setIsDispatching(true);
    try {
      const timestamp = new Date().toISOString();
      const driver = driverName.trim() || 'Authorized Driver';
      const plate = plateNumber.trim().toUpperCase() || 'TRUCK-ASSIGNED';
      const dispatcher = dispatcherName.trim() || 'Logistics Lead';
      const bin = sourceBin.trim().toUpperCase() || 'BUFFER-STOCK-RACK-01';

      const updatedReports = [];
      for (const rep of reportsToRender) {
        const existingAudit = Array.isArray(rep.audit_trail) ? [...rep.audit_trail] : [];
        const payload = {
          status: 'buffer_replacement_dispatched',
          disposition: '6- Buffer Stock Exchange',
          warehouse_location: bin,
          inspected_by: dispatcher,
          inspected_at: timestamp,
          notes: `${rep.notes ? rep.notes + ' | ' : ''}1-to-1 Buffer Stock Replacement Dispatched (${rep.quantity} ${rep.unit_name || 'pc'}). Driver: ${driver} (${plate}). Released by: ${dispatcher}.`,
          audit_trail: [
            ...existingAudit,
            {
              timestamp,
              stage: 'BUFFER_DISPATCHED',
              actor: dispatcher,
              disposition: 'Buffer Stock Exchange',
              note: `1-to-1 Buffer stock replacement dispatched: ${rep.quantity} ${rep.unit_name || 'pc'} released to driver ${driver} (${plate}). Gate pass authorized.`
            }
          ]
        };

        const { data: updated, error } = await supabase
          .from('rma_reports')
          .update(payload)
          .eq('id', rep.id)
          .select('*')
          .single();

        if (error) throw error;
        updatedReports.push(updated || { ...rep, ...payload });
      }

      setDispatchSuccess(true);
      if (autoPrintOnDispatch) {
        handlePrint();
      }
      if (onDispatched) {
        onDispatched(updatedReports[0], updatedReports);
      }
      window.dispatchEvent(new CustomEvent('rma-data-changed', {
        detail: { type: 'buffer-dispatched', rma: updatedReports[0]?.rma_number }
      }));

      setTimeout(() => {
        setDispatchSuccess(false);
        onClose();
      }, 2500);
    } catch (err) {
      console.error('Buffer dispatch error:', err);
      alert(`Buffer Dispatch failed: ${err.message}`);
    } finally {
      setIsDispatching(false);
    }
  };

  const handlePrint = () => {
    const docTitle = reportsToRender.length === 1 && reportsToRender[0]?.rma_number
      ? `Buffer-Exchange-Slip-${reportsToRender[0].rma_number}`
      : `Batch-Buffer-Exchange-Slips-${reportsToRender.length}`;

    printIsolatedElement({
      elementId: 'buffer-exchange-slip-print-root',
      documentTitle: docTitle,
      pageSize: 'portrait',
      pageMargin: '0.35in',
      customStyles: `
        #buffer-exchange-slip-print-root {
          width: 100% !important;
          max-width: 195mm !important;
          margin: 0 auto !important;
          padding: 0 !important;
          box-shadow: none !important;
          border: none !important;
          background: #ffffff !important;
          color: #0f172a !important;
          max-height: none !important;
          height: auto !important;
          overflow: visible !important;
        }
        #buffer-exchange-slip-print-root > div {
          max-height: none !important;
          height: auto !important;
          overflow: visible !important;
        }
        .slip-sheet {
          page-break-after: always !important;
          break-after: page !important;
          page-break-inside: avoid !important;
          break-inside: avoid !important;
          padding: 16px 20px !important;
          background: #ffffff !important;
          border: none !important;
          box-shadow: none !important;
        }
        .slip-sheet:last-child {
          page-break-after: auto !important;
          break-after: auto !important;
        }
        .print-hidden, .print\\:hidden, .bottom-sheet-handle,
        #buffer-exchange-slip-print-root .print\\:hidden,
        #buffer-exchange-slip-print-root .bottom-sheet-handle {
          display: none !important;
        }
        input {
          border: none !important;
          outline: none !important;
          background: transparent !important;
        }
      `
    });
  };

  const isBulk = reportsToRender.length > 1;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-6 md:p-8 bg-slate-900/70 backdrop-blur-md animate-in fade-in overflow-y-auto">
      
      {/* Print Specific Stylesheet Injection */}
      <style>{`
        @media print {
          @page {
            size: portrait;
            margin: 10mm 14mm;
          }
          html, body {
            background: #ffffff !important;
            color: #0f172a !important;
            font-size: 11pt !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          #app-main-view-container,
          .print-hidden, .print\\:hidden {
            display: none !important;
          }
          #buffer-exchange-slip-print-root {
            position: static !important;
            display: block !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            overflow: visible !important;
          }
          .slip-sheet {
            page-break-after: always;
            break-after: page;
            page-break-inside: avoid;
            break-inside: avoid;
            margin: 0 0 10mm 0;
            padding: 16px 20px !important;
            box-sizing: border-box;
            background: #ffffff !important;
          }
          .slip-sheet:last-child {
            page-break-after: auto;
            break-after: auto;
          }
        }
      `}</style>

      <div
        id="buffer-exchange-slip-print-root"
        className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 max-w-2xl w-full flex flex-col max-h-[92dvh] sm:max-h-[95vh] overflow-hidden text-slate-900 my-0 sm:my-auto pb-safe"
      >
        {/* Mobile Drag Indicator */}
        <div className="bottom-sheet-handle sm:hidden print:hidden" />

        {/* Top Control Bar (Hidden when printing) */}
        <div className="p-4 sm:px-6 bg-slate-100 border-b border-slate-200 flex items-center justify-between shrink-0 print:hidden">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-100 text-indigo-700 rounded-xl">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <span className="font-extrabold text-xs text-slate-800 block">
                {isBulk ? `Batch Buffer Exchange Slips (${reportsToRender.length})` : 'Buffer Stock Replacement Dispatch Slip'}
              </span>
              <span className="text-[11px] text-slate-500">
                Official Gate Pass & Store Handover Delivery Voucher
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleConfirmDispatch}
              disabled={isDispatching}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50"
              title="Update system to Buffer Dispatched, record driver & vehicle, and authorize gate pass"
            >
              {isDispatching ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Recording Dispatch...</span>
                </>
              ) : isAlreadyDispatched ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Update &amp; Re-dispatch</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>🚀 Confirm &amp; Dispatch Buffer</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
              title="Print Physical Gate Pass Slip"
            >
              <Printer className="w-4 h-4" />
              <span>Print Slip / PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-200 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Success Alert Banner */}
        {dispatchSuccess && (
          <div className="px-6 py-3 bg-emerald-500 text-white font-bold text-xs flex items-center justify-between gap-2 print:hidden animate-in fade-in">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Buffer Stock Replacement Confirmed &amp; Dispatched! System lifecycle updated to "Buffer Dispatched".</span>
            </div>
          </div>
        )}

        {/* Notice if already dispatched */}
        {isAlreadyDispatched && !dispatchSuccess && (
          <div className="px-6 py-2 bg-indigo-50 border-b border-indigo-200 text-indigo-900 text-xs font-medium flex items-center gap-2 print:hidden">
            <Truck className="w-4 h-4 text-indigo-600 shrink-0" />
            <span>This RMA ticket was already recorded as <strong>Buffer Replacement Dispatched</strong>. You can reprint or re-authorize dispatch below.</span>
          </div>
        )}

        {/* Driver, Truck, Bin & Dispatcher Quick Inputs */}
        <div className="px-6 py-2.5 bg-indigo-50/70 border-b border-indigo-100 grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs print:hidden">
          <div>
            <label className="text-[9.5px] font-black uppercase tracking-wider text-indigo-900 block mb-0.5">Assigned Driver</label>
            <input
              type="text"
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              placeholder="e.g. Juan Delivery / Repacker"
              className="w-full px-2.5 py-1 bg-white border border-indigo-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-600"
            />
          </div>
          <div>
            <label className="text-[9.5px] font-black uppercase tracking-wider text-indigo-900 block mb-0.5">Vehicle / Plate #</label>
            <input
              type="text"
              value={plateNumber}
              onChange={(e) => setPlateNumber(e.target.value)}
              placeholder="e.g. NBD-1042 / Truck 03"
              className="w-full px-2.5 py-1 bg-white border border-indigo-200 rounded-lg text-xs font-bold text-slate-800 uppercase focus:outline-none focus:border-indigo-600"
            />
          </div>
          <div>
            <label className="text-[9.5px] font-black uppercase tracking-wider text-indigo-900 block mb-0.5">Source Buffer Bin</label>
            <input
              type="text"
              value={sourceBin}
              onChange={(e) => setSourceBin(e.target.value)}
              placeholder="e.g. BUFFER-STOCK-RACK-01"
              className="w-full px-2.5 py-1 bg-white border border-indigo-200 rounded-lg text-xs font-bold text-slate-800 uppercase focus:outline-none focus:border-indigo-600 font-mono"
            />
          </div>
          <div>
            <label className="text-[9.5px] font-black uppercase tracking-wider text-indigo-900 block mb-0.5">Warehouse Dispatcher</label>
            <input
              type="text"
              value={dispatcherName}
              onChange={(e) => setDispatcherName(e.target.value)}
              placeholder="e.g. Warehouse Supervisor"
              className="w-full px-2.5 py-1 bg-white border border-indigo-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-600"
            />
          </div>
        </div>

        {/* Scrollable Document Container */}
        <div className="flex-1 overflow-y-auto divide-y-4 divide-slate-200 print:divide-y-0 print:overflow-visible">
          {reportsToRender.map((rep, idx) => {
            const slipNumber = rep?.rma_number
              ? `BES-${rep.rma_number.replace(/^RMA-/, '')}`
              : `BES-${new Date().getFullYear()}-${String(idx + 1).padStart(4, '0')}`;

            return (
              <div
                key={rep.id || rep.rma_number || idx}
                className="slip-sheet p-6 sm:p-8 space-y-4 sm:space-y-5 print:p-2 print:space-y-3.5"
              >
                {/* Header */}
                <div className="border-b-2 border-slate-900 pb-3 sm:pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="pl-1">
                      <div className="text-[11px] font-black tracking-wider uppercase text-slate-500">
                        PINGCON MARKETING • WHOLESALE REVERSE LOGISTICS
                      </div>
                      <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 mt-0.5 flex items-center gap-2">
                        <span>BUFFER STOCK REPLACEMENT SLIP</span>
                      </h1>
                      <p className="text-xs text-slate-600 font-medium mt-0.5">
                        Official Warehouse Gate Pass & Store 1-to-1 Replacement Voucher
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="px-3 py-1 bg-indigo-100 text-indigo-900 rounded-lg text-xs font-black uppercase tracking-wider inline-block">
                        GATE PASS / DISPATCH
                      </span>
                      <div className="font-mono font-black text-sm text-slate-900 mt-1">
                        {slipNumber}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Date: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Reference Overview Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                  <div>
                    <span className="text-[9.5px] uppercase font-bold text-slate-400 block">Receiving Customer / Store</span>
                    <div className="font-black text-slate-900 text-xs sm:text-sm mt-0.5">
                      {rep.store_branch || rep.supplier_name || 'Savemore'}
                    </div>
                  </div>
                  <div>
                    <span className="text-[9.5px] uppercase font-bold text-slate-400 block">Linked Return Ticket</span>
                    <div className="font-mono font-black text-indigo-700 text-xs sm:text-sm mt-0.5">
                      {rep.rma_number}
                    </div>
                  </div>
                  <div>
                    <span className="text-[9.5px] uppercase font-bold text-slate-400 block">Original SI / DR #</span>
                    <div className="font-mono font-bold text-slate-800 text-xs mt-0.5">
                      {rep.si_number || rep.dr_number || rep.invoice_dr_number || 'N/A (Intake Verified)'}
                    </div>
                  </div>
                  <div>
                    <span className="text-[9.5px] uppercase font-bold text-slate-400 block">Assigned AE / Coordinator</span>
                    <div className="font-bold text-slate-800 text-xs mt-0.5">
                      {rep.ae_name || rep.reported_by || 'Wholesale Operations'}
                    </div>
                  </div>
                </div>

                {/* Replacement Goods Table */}
                <div className="border border-slate-300 rounded-2xl overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 uppercase font-black text-[10px] tracking-wider">
                        <th className="py-2.5 px-3">Item Description / Name</th>
                        <th className="py-2.5 px-3">Barcode / SKU</th>
                        <th className="py-2.5 px-3 text-center">Unit</th>
                        <th className="py-2.5 px-3 text-center">Replacement Qty</th>
                        <th className="py-2.5 px-3">Exchange Category</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      <tr>
                        <td className="py-3 px-3">
                          <div className="font-black text-slate-900 text-xs sm:text-sm">{rep.name}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            Original Defect: <strong className="text-amber-700">{rep.reason || 'Damaged packaging'}</strong>
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono font-bold text-slate-700">
                          <div>{rep.barcode}</div>
                          {rep.code && <div className="text-[10px] text-slate-400">SKU: {rep.code}</div>}
                        </td>
                        <td className="py-3 px-3 text-center font-bold text-slate-700 uppercase">
                          {rep.unit_name || 'pc'}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className="inline-block px-2.5 py-1 bg-emerald-100 text-emerald-900 rounded-lg font-black text-sm">
                            {rep.quantity} {rep.unit_name || 'pc'}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                            <ArrowLeftRight className="w-3 h-3 text-indigo-600" />
                            <span>1-to-1 Buffer Swap</span>
                          </span>
                          <div className="text-[9.5px] text-slate-500 mt-0.5">Zero Balance Deduction</div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Warehouse Location & Gate Pass Info Banner */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-slate-600 shrink-0" />
                    <div>
                      <span className="font-bold text-slate-700">Source Buffer Bin: </span>
                      <strong className="font-mono text-indigo-900">{sourceBin || rep.warehouse_location || 'BUFFER-STOCK-RACK-01'}</strong>
                    </div>
                  </div>
                  <div className="text-[10px] font-black uppercase text-slate-500">
                    Condition: <strong className="text-emerald-700">Brand New / Sealed Wholesale Stock</strong>
                  </div>
                </div>

                {/* Transport & Vehicle Details Box */}
                <div className="p-3 bg-indigo-50/50 border border-indigo-200 rounded-xl grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-[9.5px] uppercase font-bold text-indigo-800 block">Delivery Truck / Plate #</span>
                    <div className="font-mono font-black text-slate-900 uppercase">
                      {plateNumber || 'TRUCK-ASSIGNED'}
                    </div>
                  </div>
                  <div>
                    <span className="text-[9.5px] uppercase font-bold text-indigo-800 block">Authorized Delivery Driver</span>
                    <div className="font-bold text-slate-900">
                      {driverName || 'Authorized Driver'}
                    </div>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <span className="text-[9.5px] uppercase font-bold text-indigo-800 block">Warehouse Gate Pass Release</span>
                    <div className="text-[10px] font-bold text-emerald-700 flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>RELEASE AUTHORIZED</span>
                    </div>
                  </div>
                </div>

                {/* Triple Signature Blocks */}
                <div className="border-t-2 border-slate-900 pt-4 mt-6">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    {/* Warehouse Release */}
                    <div className="border-t border-slate-400 pt-1.5">
                      <div className="font-black text-xs text-slate-900">{dispatcherName || 'Warehouse Supervisor'}</div>
                      <div className="text-[10px] font-bold uppercase text-slate-500 mt-0.5">Warehouse Dispatcher</div>
                      <div className="text-[9px] text-slate-400">Stock Inspected & Released</div>
                    </div>

                    {/* Driver Handover */}
                    <div className="border-t border-slate-400 pt-1.5">
                      <div className="font-black text-xs text-slate-900">{driverName || 'Delivery Driver'}</div>
                      <div className="text-[10px] font-bold uppercase text-slate-500 mt-0.5">Logistics Transport (Driver)</div>
                      <div className="text-[9px] text-slate-400">Received for Store Handover</div>
                    </div>

                    {/* Customer Store Receiving */}
                    <div className="border-t border-slate-400 pt-1.5">
                      <div className="font-bold text-xs text-slate-400">(Customer Signature & Date)</div>
                      <div className="text-[10px] font-black uppercase text-slate-700 mt-0.5">Store Receiving In-Charge</div>
                      <div className="text-[9px] text-slate-500">Replacement Received in Good Condition</div>
                    </div>
                  </div>
                </div>

                {/* Official Legal & Audit Footnote */}
                <div className="text-[9px] text-slate-400 text-center pt-2">
                  This Buffer Stock Replacement Dispatch Slip serves as an official warehouse gate pass and delivery handover confirmation under RMA Ticket {rep.rma_number}. No monetary credit or deduction is granted for this physical item replacement.
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

