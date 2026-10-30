import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { 
  X, 
  QrCode, 
  Download, 
  Printer, 
  Copy, 
  Check, 
  ExternalLink, 
  Camera, 
  Barcode, 
  FileCheck2, 
  Package, 
  Sparkles,
  Info,
  RefreshCw
} from 'lucide-react';
import { downloadPortalPosterPng, downloadQrCodePng, printPortalPoster } from '../utils/qrDownload';

export default function PortalAccessQRModal({ isOpen, onClose }) {
  const [isCopied, setIsCopied] = useState(false);
  const [isDownloadingPoster, setIsDownloadingPoster] = useState(false);
  const [isDownloadingQr, setIsDownloadingQr] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);

  if (!isOpen) return null;

  const portalUrl = typeof window !== 'undefined' && window.location.origin 
    ? window.location.origin 
    : 'https://rma-portal-v2.vercel.app';

  const handleCopyLink = () => {
    try {
      navigator.clipboard.writeText(portalUrl);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2200);
    } catch (e) {
      console.warn('Clipboard write failed:', e);
    }
  };

  const handleDownloadPoster = async () => {
    setIsDownloadingPoster(true);
    try {
      await downloadPortalPosterPng({
        svgElementOrId: 'portal-access-qr-svg',
        portalUrl,
        filename: 'RMA-Public-Reporting-Poster.png'
      });
    } catch (err) {
      console.error('Error downloading poster:', err);
      alert('Failed to generate poster. You can use browser print as an alternative.');
    } finally {
      setIsDownloadingPoster(false);
    }
  };

  const handleDownloadQr = async () => {
    setIsDownloadingQr(true);
    try {
      await downloadQrCodePng({
        svgElementOrId: 'portal-access-qr-svg',
        rmaNumber: 'PUBLIC-RMA-PORTAL',
        productName: 'Scan to Report Returned Merchandise',
        barcode: portalUrl,
        filename: 'RMA-Portal-Access-QR.png'
      });
    } catch (err) {
      console.error('Error downloading QR code:', err);
      alert('Failed to download QR code image.');
    } finally {
      setIsDownloadingQr(false);
    }
  };

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      await printPortalPoster({
        svgElementOrId: 'portal-access-qr-svg',
        portalUrl,
        documentTitle: 'RMA-Public-Reporting-Poster'
      });
    } catch (err) {
      console.error('Error printing poster:', err);
      window.print();
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 md:p-8 overflow-y-auto bg-slate-950/75 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-2xl sm:my-auto bg-white dark:bg-slate-900 border-t sm:border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] pb-safe animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile bottom-sheet drag handle */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700"></div>
        </div>

        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 sm:px-8 py-5 border-b border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-extrabold text-slate-900 dark:text-white text-base sm:text-lg tracking-tight">
                Public Reporting Portal QR
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Print or share this QR code for warehouse intake and customer returns
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 space-y-5 overflow-y-auto overscroll-contain flex-1">
          
          {/* Main Card: QR Code & Live Portal URL */}
          <div className="p-5 sm:p-6 bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-3xl flex flex-col items-center text-center space-y-4">
            
            {/* Tag Badge */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-[11px] font-black text-emerald-700 dark:text-emerald-300">
              <Sparkles className="w-3.5 h-3.5" />
              <span>OFFICIAL SCAN-TO-REPORT PORTAL</span>
            </div>

            {/* QR SVG Frame */}
            <div className="p-4 bg-white rounded-3xl border-2 border-slate-200 shadow-md inline-block">
              <QRCodeSVG
                id="portal-access-qr-svg"
                value={portalUrl}
                size={220}
                level="H"
                includeMargin={true}
              />
            </div>

            {/* URL Display with Copy Button */}
            <div className="w-full max-w-md">
              <div className="flex items-center justify-between gap-2 p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs">
                <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-300 truncate pl-2">
                  {portalUrl}
                </span>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className={`min-h-[38px] px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
                    isCopied
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{isCopied ? 'Copied!' : 'Copy URL'}</span>
                </button>
              </div>
            </div>

          </div>

          {/* Visual Instructions for Users / Warehouse Receivers */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <Info className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Step-by-Step Reporting Instructions</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              
              <div className="p-3.5 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-2xl flex items-start gap-3">
                <div className="w-7 h-7 rounded-xl bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-black flex items-center justify-center shrink-0">
                  1
                </div>
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">Step 1: Scan QR with Google Lens</div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                    Open Google Lens (or QR scanner app) on your phone and point at this QR code to launch the reporting portal.
                  </p>
                </div>
              </div>

              <div className="p-3.5 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-2xl flex items-start gap-3">
                <div className="w-7 h-7 rounded-xl bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-black flex items-center justify-center shrink-0">
                  2
                </div>
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">Step 2: Scan Barcode or Search</div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                    Use the built-in camera barcode reader or search the catalog.
                  </p>
                </div>
              </div>

              <div className="p-3.5 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-2xl flex items-start gap-3">
                <div className="w-7 h-7 rounded-xl bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-black flex items-center justify-center shrink-0">
                  3
                </div>
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">Step 3: Snap Defect Photos</div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                    Attach photos of damaged cartons or packaging breaches. Enter quantity and tap "Submit Return Ticket".
                  </p>
                </div>
              </div>

              <div className="p-3.5 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-2xl flex items-start gap-3">
                <div className="w-7 h-7 rounded-xl bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-black flex items-center justify-center shrink-0">
                  4
                </div>
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">Step 4: Print Box QR Sticker</div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                    Print the generated thermal sticker or download it to tape directly onto the returned carton for receiving dock intake.
                  </p>
                </div>
              </div>

            </div>
          </div>

        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 sm:px-6 bg-slate-50 dark:bg-slate-950/80 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="text-[11px] text-slate-400 font-medium">
            Post at receiving docks, return desks, and packing stations
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isDownloadingQr}
              onClick={handleDownloadQr}
              className="min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              {isDownloadingQr ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              <span>Save QR (PNG)</span>
            </button>

            <button
              type="button"
              disabled={isDownloadingPoster}
              onClick={handleDownloadPoster}
              className="min-h-[44px] px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold rounded-xl shadow-md shadow-blue-600/25 flex items-center gap-2 transition-all cursor-pointer"
            >
              {isDownloadingPoster ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              <span>Download Printable Poster</span>
            </button>

            <button
              type="button"
              disabled={isPrinting}
              onClick={handlePrint}
              className="min-h-[44px] px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Print high-resolution reporting poster"
            >
              {isPrinting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
              <span>{isPrinting ? 'Preparing Poster...' : 'Print'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
