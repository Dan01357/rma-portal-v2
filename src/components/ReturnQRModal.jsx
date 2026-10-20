import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, Printer, CheckCircle2, Mail, ExternalLink, ShieldCheck, MapPin, Building2, Package, Tag } from 'lucide-react';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden my-6">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90 no-print">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-100 text-lg">RMA Ticket Authorized</h3>
              <p className="text-xs text-slate-400 font-mono">ID: {ticket.id}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handlePrint}
              type="button"
              className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-sm"
            >
              <Printer className="w-4 h-4" />
              <span>Print Return Label</span>
            </button>
            <button
              onClick={onClose}
              type="button"
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Return Label Card */}
        <div className="p-6 bg-slate-950 print-card text-slate-100">
          <div className="border-2 border-dashed border-slate-700 rounded-2xl p-5 bg-slate-900/80">
            
            {/* Ticket Header & QR Code */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-6 pb-5 border-b border-slate-800">
              <div className="space-y-1 text-center sm:text-left">
                <span className="inline-block px-2.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-brand-500/15 text-brand-400 border border-brand-500/30">
                  Official Return Merchandise Authorization
                </span>
                <h2 className="text-2xl font-black text-white font-mono tracking-wide mt-1">
                  {ticket.id}
                </h2>
                <p className="text-xs text-slate-400">
                  Authorized on {new Date(ticket.created_at || Date.now()).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
                <div className="inline-flex items-center text-xs font-medium text-slate-300 bg-slate-800/90 px-2.5 py-1 rounded-md border border-slate-700 mt-2">
                  <span className="font-semibold text-brand-300 mr-1.5">Group:</span> {ticket.group}
                </div>
              </div>

              {/* QR Code Container */}
              <div className="flex flex-col items-center justify-center p-3 bg-white rounded-xl shadow-lg border border-slate-200">
                <QRCodeSVG
                  value={qrPayload}
                  size={140}
                  level="H"
                  includeMargin={true}
                />
                <span className="text-[10px] text-slate-700 font-mono font-bold mt-1 tracking-wider">
                  SCAN FOR RECEIVING
                </span>
              </div>
            </div>

            {/* Itemized Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-5 border-b border-slate-800 text-sm">
              <div className="space-y-2">
                <div className="flex items-start space-x-2">
                  <Package className="w-4 h-4 text-brand-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-xs text-slate-400 block">Product</span>
                    <span className="font-semibold text-slate-100">{ticket.product_name}</span>
                    <span className="text-xs text-slate-400 block font-mono">SKU: {ticket.sku} | Barcode: {ticket.barcode}</span>
                  </div>
                </div>

                <div className="flex items-start space-x-2">
                  <Building2 className="w-4 h-4 text-brand-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-xs text-slate-400 block">Customer / Store</span>
                    <span className="font-medium text-slate-200">{ticket.customer_name}</span>
                    <span className="text-xs text-slate-400 block">{ticket.store_branch}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/60">
                  <span className="text-xs text-slate-400">Return Quantity:</span>
                  <span className="text-base font-bold text-brand-400 font-mono">{ticket.quantity} Units</span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/60">
                  <span className="text-xs text-slate-400">Total RMA Value:</span>
                  <span className="text-base font-bold text-emerald-400 font-mono">{formatPeso(ticket.total_amount)}</span>
                </div>

                <div className="flex items-start space-x-2 text-xs text-slate-300">
                  <Tag className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                  <span><strong>Supplier:</strong> {ticket.supplier}</span>
                </div>
              </div>
            </div>

            {/* Defect & Diagnosis */}
            <div className="py-4 border-b border-slate-800 space-y-1.5 text-xs">
              <span className="text-slate-400 font-medium">Defect Classification & Diagnosis:</span>
              <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-lg text-slate-200 leading-relaxed font-mono">
                <span className="text-amber-400 font-semibold block mb-1">Reason: {ticket.defect_category}</span>
                {ticket.technical_diagnosis}
              </div>
              {ticket.gps_coordinates && (
                <div className="flex items-center space-x-1.5 text-[11px] text-slate-400 pt-1">
                  <MapPin className="w-3.5 h-3.5 text-rose-400" />
                  <span>Verified GPS Location: {ticket.gps_coordinates}</span>
                </div>
              )}
            </div>

            {/* Email Dispatch & AE Routing Notice */}
            <div className="pt-4 no-print space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-brand-400" />
                  Automated Email Routing Dispatch
                </span>
                {isTestMode && (
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    TEST MODE ACTIVE (.test appended)
                  </span>
                )}
              </div>

              <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 text-[11px] font-mono space-y-1">
                <div>
                  <span className="text-slate-500">From:</span> <span className="text-brand-300">{emailRouting.sender}</span>
                </div>
                <div>
                  <span className="text-slate-500">To:</span> <span className="text-slate-200">{emailRouting.to}</span>
                </div>
                <div className="flex flex-wrap items-baseline gap-1">
                  <span className="text-slate-500">CC:</span>
                  {emailRouting.cc.map((c, i) => (
                    <span key={i} className="inline-block bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end px-6 py-4 bg-slate-900 border-t border-slate-800 no-print space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Done
          </button>
          <button
            onClick={handlePrint}
            className="px-5 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-500 rounded-lg transition-colors flex items-center space-x-1.5 shadow-md shadow-brand-600/30"
          >
            <Printer className="w-4 h-4" />
            <span>Print Label Sheet</span>
          </button>
        </div>

      </div>
    </div>
  );
}
