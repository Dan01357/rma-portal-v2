import React from 'react';
import { X, CheckCircle, Clock, Barcode, FileText, Package } from 'lucide-react';

export default function RMAReportsModal({ isOpen, onClose, reports = [] }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-2xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-100 text-blue-700 rounded-xl">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Logged RMA Return Reports
              </h2>
              <p className="text-xs text-slate-500">
                Recorded returns from mobile scans and manual entries.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* List of Reports */}
        {reports.length === 0 ? (
          <div className="text-center py-10 space-y-2">
            <Package className="w-10 h-10 text-slate-300 mx-auto" />
            <h3 className="text-sm font-bold text-slate-700">No RMA Reports Yet</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Scan any item barcode and click "Report Item for Return" to create your first report.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {reports.map((item) => (
              <div
                key={item.id || item.rma_number}
                className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-black text-blue-700 text-sm">
                      {item.rma_number}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      item.status === 'pending_admin_details'
                        ? 'bg-amber-100 text-amber-800 border border-amber-200'
                        : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                    }`}>
                      {item.status === 'pending_admin_details' ? 'Unknown Item - Pending Details' : 'Recorded Return'}
                    </span>
                  </div>
                  <div className="font-semibold text-slate-800 text-sm">
                    {item.name}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500 text-[11px] font-mono">
                    <span>Barcode: {item.barcode}</span>
                    {item.code && <span>SKU: {item.code}</span>}
                    {item.supplier_name && <span>Supplier: {item.supplier_name}</span>}
                  </div>
                </div>

                <div className="flex items-center sm:flex-col sm:items-end justify-between border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-200">
                  <div className="font-mono font-bold text-slate-900 text-sm">
                    Qty: {item.quantity} {item.unit_name || 'pc'}
                  </div>
                  {item.price_with_vat > 0 && (
                    <div className="font-mono text-emerald-600 font-bold text-xs">
                      ₱{(Number(item.price_with_vat) * Number(item.quantity)).toFixed(2)}
                    </div>
                  )}
                  <span className="text-[10px] text-slate-400">
                    {new Date(item.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
