import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Printer, ExternalLink, Box, Building2, User, Hash, PackageCheck, AlertCircle } from 'lucide-react';

export default function PrintableLabel({
  company,
  productName,
  sku,
  packagingUnit,
  deliveryRef,
  customerName,
  assignedAE,
  portalUrl
}) {
  const fallbackOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
  const resolvedPortalUrl = portalUrl || fallbackOrigin;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="flex flex-col items-center">
      {/* Visual Sticker Card (Designated as printable container in CSS via id="printable-sticker-container") */}
      <div
        id="printable-sticker-container"
        className="w-full max-w-md bg-white text-slate-900 rounded-2xl shadow-2xl border-4 border-slate-900 p-6 flex flex-col justify-between transition-all"
        style={{ minHeight: '440px' }}
      >
        {/* Top Header: Company Banner */}
        <div className="border-b-2 border-slate-900 pb-3 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center font-black text-xl tracking-tight">
              {company?.charAt(0) || 'R'}
            </div>
            <div>
              <h2 className="font-black text-base tracking-wider uppercase leading-tight text-slate-950">
                {company || 'PINGCON'}
              </h2>
              <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                Wholesale Logistics & Returns
              </p>
            </div>
          </div>
          <div className="text-right">
            <span className="inline-block bg-slate-900 text-white text-[11px] font-mono font-bold px-2.5 py-1 rounded">
              RMA READY
            </span>
          </div>
        </div>

        {/* Middle Section: QR Code + Product & Consignee Details */}
        <div className="my-4 grid grid-cols-12 gap-3 items-center">
          {/* QR Code Container */}
          <div className="col-span-5 flex flex-col items-center justify-center p-2 bg-slate-50 rounded-xl border-2 border-dashed border-slate-300">
            <div className="bg-white p-1 rounded-lg shadow-sm">
              <QRCodeSVG
                value={resolvedPortalUrl}
                size={135}
                level="M"
                includeMargin={false}
              />
            </div>
            <p className="text-[9px] font-black uppercase tracking-tight text-slate-700 mt-1.5 text-center leading-none">
              Scan for Zero-Login RMA
            </p>
          </div>

          {/* Label Metadata Info */}
          <div className="col-span-7 flex flex-col space-y-2 text-xs">
            {/* Delivery Ref */}
            <div>
              <span className="text-[10px] font-bold uppercase text-slate-500 flex items-center gap-1">
                <Hash className="w-3 h-3 text-slate-400" /> Ref / DR / SI #:
              </span>
              <p className="font-mono font-bold text-sm text-slate-900 tracking-wide">
                {deliveryRef || 'DR-PENDING'}
              </p>
            </div>

            {/* Consignee / Customer */}
            <div>
              <span className="text-[10px] font-bold uppercase text-slate-500 flex items-center gap-1">
                <User className="w-3 h-3 text-slate-400" /> Customer:
              </span>
              <p className="font-semibold text-xs text-slate-900 line-clamp-1">
                {customerName || 'General Wholesale Partner'}
              </p>
            </div>

            {/* Packaging Unit & Assigned AE */}
            <div className="flex items-center justify-between gap-1">
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-500 flex items-center gap-1">
                  <PackageCheck className="w-3 h-3 text-slate-400" /> Pkg:
                </span>
                <span className="inline-block bg-slate-100 border border-slate-300 text-slate-800 font-mono font-bold px-2 py-0.5 rounded text-[11px]">
                  {packagingUnit || 'PC'}
                </span>
              </div>
              {assignedAE && (
                <div className="text-right">
                  <span className="text-[9px] font-bold uppercase text-slate-500 block">
                    Assigned AE:
                  </span>
                  <span className="font-semibold text-[11px] text-slate-800 truncate max-w-[110px] block">
                    {assignedAE}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Product Box */}
        <div className="bg-slate-100 rounded-xl p-3 border border-slate-300 mb-3">
          <div className="flex justify-between items-start mb-0.5">
            <span className="text-[10px] font-bold uppercase text-slate-500">Item Specification:</span>
            <span className="font-mono font-bold text-xs bg-slate-900 text-white px-2 py-0.2 rounded">
              SKU: {sku || 'CUSTOM-SKU'}
            </span>
          </div>
          <p className="font-bold text-xs text-slate-900 line-clamp-2 mt-1">
            {productName || 'Unspecified Wholesale Product'}
          </p>
        </div>

        {/* Bottom Instructions Footer */}
        <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-600 font-medium">
          <span>Warranty Claims: Zero Password Required</span>
          <span className="font-mono text-slate-400 text-[9px]">4" x 4" LABEL</span>
        </div>
      </div>

      {/* Action Buttons (Non-printable) */}
      <div className="mt-5 flex flex-wrap gap-3 justify-center w-full max-w-md print:hidden">
        <button
          type="button"
          onClick={handlePrint}
          className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <Printer className="w-4 h-4" />
          <span>Print Sticker Label</span>
        </button>

        <a
          href={portalUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-sm font-medium transition-colors"
          title="Simulate scanning this QR code by opening customer return portal"
        >
          <ExternalLink className="w-4 h-4 text-indigo-400" />
          <span>Test QR Link</span>
        </a>
      </div>

      <p className="mt-2 text-xs text-slate-400 print:hidden text-center max-w-sm">
        Clicking <span className="text-slate-300 font-semibold">Test QR Link</span> or scanning with a phone camera directly launches the Zero-Login Customer Portal with these details pre-populated.
      </p>
    </div>
  );
}
