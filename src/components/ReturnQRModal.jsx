import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, Printer, CheckCircle2, Mail, ExternalLink, ShieldCheck, MapPin, Building2, Package, Tag, Hash } from 'lucide-react';
import { formatPeso, getEmailRoutingPayload } from '../utils/rmaHelpers';

export default function ReturnQRModal({ isOpen, onClose, ticket, isTestMode }) {
  if (!isOpen || !ticket) return null;

  const emailRouting = getEmailRoutingPayload(ticket, isTestMode);

  const handlePrint = () => {
    window.print();
  };

  const qrPayload = JSON.stringify({
    ticketId: ticket.id,
    sku: ticket.sku,
    qty: ticket.quantity,
    customer: ticket.customer_name,
    supplier: ticket.supplier,
    authDate: ticket.created_at
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-6">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 no-print">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base sm:text-lg">Return Ticket Authorized</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">ID: {ticket.id}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handlePrint}
              type="button"
              className="px-3.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-sm"
            >
              <Printer className="w-4 h-4" />
              <span>Print Return Label</span>
            </button>
            <button
              onClick={onClose}
              type="button"
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Return Label Card */}
        <div className="p-6 bg-slate-50 dark:bg-slate-950 print-card text-slate-900 dark:text-slate-100">
          <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-3xl p-5 sm:p-6 bg-white dark:bg-slate-900 shadow-sm">
            
            {/* Ticket Header & QR Code */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-6 pb-5 border-b border-slate-100 dark:border-slate-800">
              <div className="space-y-1 text-center sm:text-left">
                <span className="inline-block px-2.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-500/30">
                  Return Merchandise Authorization
                </span>
                <h2 className="text-2xl font-black text-slate-900 dark:text-white font-mono tracking-wide mt-1">
                  {ticket.id}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Authorized on {new Date(ticket.created_at || Date.now()).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
                <div className="inline-flex items-center text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 mt-2">
                  <span className="font-semibold text-brand-600 dark:text-brand-300 mr-1.5">Brand:</span> {ticket.brand || 'Wholesale'}
                </div>
              </div>

              {/* QR Code Container */}
              <div className="flex flex-col items-center justify-center p-3 bg-white rounded-2xl shadow-md border border-slate-200">
                <QRCodeSVG
                  value={qrPayload}
                  size={135}
                  level="H"
                  includeMargin={true}
                />
                <span className="text-[10px] text-slate-700 font-mono font-bold mt-1 tracking-wider">
                  SCAN FOR RECEIVING
                </span>
              </div>
            </div>

            {/* Itemized Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-5 border-b border-slate-100 dark:border-slate-800 text-sm">
              <div className="space-y-2">
                <div className="flex items-start space-x-2">
                  <Package className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-xs text-slate-400 block">Product Item</span>
                    <span className="font-bold text-slate-900 dark:text-slate-100">{ticket.product_name}</span>
                    <span className="text-xs text-slate-500 font-mono block">SKU: {ticket.sku} | Barcode: {ticket.barcode}</span>
                  </div>
                </div>

                <div className="flex items-start space-x-2">
                  <Building2 className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-xs text-slate-400 block">Customer Store</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{ticket.customer_name}</span>
                    <span className="text-xs text-slate-500 block">{ticket.store_branch}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Return Quantity:</span>
                  <span className="text-base font-bold text-brand-600 dark:text-brand-400 font-mono">{ticket.quantity} Units</span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Total Credit Value:</span>
                  <span className="text-base font-bold text-emerald-600 dark:text-emerald-400 font-mono">{formatPeso(ticket.total_amount)}</span>
                </div>

                <div className="flex items-start space-x-2 text-xs text-slate-600 dark:text-slate-300">
                  <Tag className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                  <span><strong>Supplier:</strong> {ticket.supplier}</span>
                </div>
              </div>
            </div>

            {/* Serial Numbers if provided */}
            {ticket.serial_numbers && (
              <div className="py-3 border-b border-slate-100 dark:border-slate-800 text-xs flex items-center space-x-2">
                <Hash className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400 shrink-0" />
                <span className="font-semibold text-slate-700 dark:text-slate-300">Serial Number(s):</span>
                <span className="font-mono text-slate-800 dark:text-slate-200">{ticket.serial_numbers}</span>
              </div>
            )}

            {/* Defect Statement */}
            <div className="py-4 border-b border-slate-100 dark:border-slate-800 space-y-1.5 text-xs">
              <span className="text-slate-500 dark:text-slate-400 font-medium">Defect Classification & Diagnosis:</span>
              <div className="p-3 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 leading-relaxed font-mono">
                <span className="text-amber-600 dark:text-amber-400 font-bold block mb-1">Reason: {ticket.defect_category}</span>
                {ticket.technical_diagnosis}
              </div>
              {ticket.gps_coordinates && (
                <div className="flex items-center space-x-1.5 text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                  <MapPin className="w-3.5 h-3.5 text-rose-500" />
                  <span>Verified Dock GPS: {ticket.gps_coordinates}</span>
                </div>
              )}
            </div>

            {/* Email Dispatch Notice */}
            <div className="pt-4 no-print space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
                  Automated Outbound Routing
                </span>
                {isTestMode && (
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30">
                    TEST MODE (Safe Sandbox)
                  </span>
                )}
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 text-[11px] font-mono space-y-1 text-slate-600 dark:text-slate-300">
                <div>
                  <span className="text-slate-400">From:</span> <span className="text-brand-600 dark:text-brand-300">{emailRouting.sender}</span>
                </div>
                <div>
                  <span className="text-slate-400">To:</span> <span className="text-slate-900 dark:text-slate-100">{emailRouting.to}</span>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end px-6 py-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 no-print space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-xl transition-colors"
          >
            Close
          </button>
          <button
            onClick={handlePrint}
            className="px-5 py-2 text-xs font-bold text-white bg-brand-600 hover:bg-brand-500 rounded-xl transition-colors flex items-center space-x-1.5 shadow-md shadow-brand-600/30"
          >
            <Printer className="w-4 h-4" />
            <span>Print Label Sheet</span>
          </button>
        </div>

      </div>
    </div>
  );
}
