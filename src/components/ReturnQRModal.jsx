import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { 
  X, 
  Printer, 
  Download, 
  FileDown, 
  Check, 
  QrCode, 
  Building2, 
  Sparkles,
  RefreshCw
} from 'lucide-react';
import { downloadQrCodePng, downloadBoxStickerPng, printBoxSticker } from '../utils/qrDownload';

export default function ReturnQRModal({ isOpen, onClose, report, onOpenQuickAction }) {
  if (!isOpen || !report) return null;

  const [downloadingType, setDownloadingType] = useState(null); // 'qr' | 'label' | null
  const [downloadNotice, setDownloadNotice] = useState(null);
  const [isPrinting, setIsPrinting] = useState(false);

  const rmaNumber = report.rma_number || report.rmaNumber || report.id || 'N/A';
  const barcode = report.barcode || 'N/A';
  const sku = report.code || report.sku || '';
  const itemName = report.name || report.product_name || report.productName || `Barcode ${barcode}`;
  const quantity = report.quantity || 1;
  const unit = report.unit_name || report.unit || 'pc';
  const supplier = report.supplier_name || report.supplier || 'Warehouse';
  const reason = report.reason || report.defect_category || 'Damaged / Return';
  const reporter = report.reporter_name || report.reported_by || 'Staff';
  const dateFormatted = new Date(report.created_at || Date.now()).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  // Clean RMA URL payload: when scanned by smartphone camera or barcode gun, opens RMA Quick Action
  const qrPayload = typeof window !== 'undefined'
    ? `${window.location.origin}/?rma=${encodeURIComponent(rmaNumber)}`
    : rmaNumber;

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      await printBoxSticker({
        svgElementOrId: 'rma-sticker-qr-svg',
        rmaNumber,
        supplier,
        itemName,
        barcode,
        sku,
        quantity,
        unit,
        reason,
        reporter,
        dateFormatted,
        documentTitle: `RMA-Verification-Label-${rmaNumber}`
      });
    } catch (err) {
      console.error('Failed to print sticker directly:', err);
      window.print();
    } finally {
      setIsPrinting(false);
    }
  };

  const handleDownloadQrOnly = async () => {
    try {
      setDownloadingType('qr');
      setDownloadNotice(null);
      await downloadQrCodePng({
        svgElementOrId: 'rma-sticker-qr-svg',
        rmaNumber,
        productName: itemName,
        barcode
      });
      setDownloadNotice('QR Code downloaded successfully!');
      setTimeout(() => setDownloadNotice(null), 3500);
    } catch (err) {
      console.error('Failed to download QR code:', err);
      alert('Unable to download QR code. Please try again or use Print Sticker.');
    } finally {
      setDownloadingType(null);
    }
  };

  const handleDownloadFullLabel = async () => {
    try {
      setDownloadingType('label');
      setDownloadNotice(null);
      await downloadBoxStickerPng({
        svgElementOrId: 'rma-sticker-qr-svg',
        rmaNumber,
        supplier,
        itemName,
        barcode,
        sku,
        quantity,
        unit,
        reason,
        reporter,
        dateFormatted
      });
      setDownloadNotice('Box Sticker image downloaded!');
      setTimeout(() => setDownloadNotice(null), 3500);
    } catch (err) {
      console.error('Failed to download label:', err);
      alert('Unable to download label image. Please try again.');
    } finally {
      setDownloadingType(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-6 md:p-8 bg-slate-950/75 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
      <div 
        id="rma-qr-box-sticker-wrapper"
        className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92dvh] sm:max-h-[85vh] my-0 sm:my-auto"
      >
        {/* Mobile Drag Indicator */}
        <div className="bottom-sheet-handle sm:hidden" />

        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 sm:px-8 py-5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0 no-print">
          <div className="flex items-center space-x-2.5 min-w-0 pr-2">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 shrink-0">
              <QrCode className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm sm:text-base truncate">
                RMA Return Box QR Sticker
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
                Ticket: <strong className="text-blue-600 dark:text-blue-400">{rmaNumber}</strong>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            type="button"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0 touch-target"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback Alert if just downloaded */}
        {downloadNotice && (
          <div className="px-4 py-2 bg-emerald-50 dark:bg-emerald-950/70 border-b border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-bold flex items-center gap-2 animate-in fade-in shrink-0">
            <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>{downloadNotice}</span>
          </div>
        )}

        {/* Scrollable Body: Printable Box Sticker Card */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-3.5 sm:p-6 bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-start">
          <div 
            id="rma-qr-box-sticker"
            className="w-full max-w-md bg-white border-2 border-slate-900 rounded-2xl p-4 sm:p-5 shadow-sm text-slate-900 space-y-3.5 my-auto shrink-0"
          >
            {/* Top Bar: Company & Badge */}
            <div className="flex items-center justify-between border-b-2 border-slate-900 pb-2">
              <div>
                <span className="text-[9px] sm:text-[10px] uppercase font-black tracking-widest text-slate-500 block">
                  Wholesale RMA Operations
                </span>
                <span className="text-[11px] sm:text-xs font-black tracking-wider text-slate-900 uppercase">
                  Return Verification Label
                </span>
              </div>
              <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono font-black text-[9px] sm:text-[10px] uppercase tracking-wider">
                Dock Intake
              </span>
            </div>

            {/* Middle: RMA # + High-Contrast QR Code */}
            <div className="flex items-center justify-between gap-3 py-1">
              <div className="space-y-1 min-w-0 flex-1">
                <span className="text-[9px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Return Authorization #
                </span>
                <div className="text-sm sm:text-xl font-black font-mono text-slate-900 tracking-tight whitespace-nowrap overflow-hidden text-ellipsis">
                  {rmaNumber}
                </div>
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 border border-slate-300 text-slate-800 text-[11px] sm:text-xs font-bold max-w-full truncate">
                  <Building2 className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                  <span className="truncate">{supplier}</span>
                </div>
              </div>

              {/* QR Code */}
              <div className="p-1.5 sm:p-2 bg-white border-2 border-slate-900 rounded-xl shadow-xs shrink-0 text-center">
                <QRCodeSVG
                  id="rma-sticker-qr-svg"
                  value={qrPayload}
                  size={105}
                  level="H"
                  includeMargin={false}
                />
                <span className="text-[8px] font-mono font-black text-slate-700 block mt-1 tracking-wider">
                  SCAN FOR RMA
                </span>
              </div>
            </div>

            {/* Product & Defect Details Box */}
            <div className="bg-slate-50 border border-slate-300 rounded-xl p-3 space-y-2 text-xs">
              <div>
                <span className="text-[9px] sm:text-[10px] uppercase font-bold text-slate-400 block">Returned Item</span>
                <div className="font-black text-slate-900 text-xs sm:text-sm leading-snug">{itemName}</div>
                <div className="font-mono text-[10px] sm:text-[11px] text-slate-600 mt-0.5 truncate">
                  Barcode: <strong className="text-slate-900">{barcode}</strong> {sku ? `• SKU: ${sku}` : ''}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200">
                <div>
                  <span className="text-[9px] sm:text-[10px] uppercase font-bold text-slate-400 block">Quantity</span>
                  <span className="font-mono font-black text-slate-900 text-xs">
                    {quantity} {unit}
                  </span>
                </div>
                <div>
                  <span className="text-[9px] sm:text-[10px] uppercase font-bold text-slate-400 block">Defect Reason</span>
                  <span className="font-bold text-rose-700 text-xs line-clamp-1">
                    {reason}
                  </span>
                </div>
              </div>
            </div>

            {/* Bottom Strip: Reporter & Date */}
            <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-slate-600 border-t border-slate-200 pt-2 font-medium">
              <div className="truncate pr-2">
                Reported by: <strong className="text-slate-900">{reporter}</strong>
              </div>
              <div className="font-mono text-[9px] sm:text-[10px] text-slate-500 shrink-0">
                {dateFormatted}
              </div>
            </div>

            {/* Footer Instruction */}
            <div className="text-[8px] sm:text-[9px] text-center font-bold text-slate-400 uppercase tracking-wider border-t border-dashed border-slate-300 pt-1.5">
              Attach securely to outer box or returned merchandise
            </div>
          </div>
        </div>

        {/* Modal Footer / Action Toolbar */}
        <div className="p-3.5 sm:px-6 sm:py-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 shrink-0 no-print pb-safe space-y-2">
          
          {/* Action Buttons Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            
            {/* 1. Download QR Code Button */}
            <button
              onClick={handleDownloadQrOnly}
              disabled={downloadingType !== null}
              type="button"
              className="touch-target px-3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer active:scale-95"
              title="Download QR code image as PNG"
            >
              {downloadingType === 'qr' ? (
                <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
              ) : (
                <QrCode className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              )}
              <span className="truncate">Save QR (PNG)</span>
            </button>

            {/* 2. Download Full Box Sticker PNG */}
            <button
              onClick={handleDownloadFullLabel}
              disabled={downloadingType !== null}
              type="button"
              className="touch-target px-3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer active:scale-95"
              title="Download entire verification box sticker as PNG"
            >
              {downloadingType === 'label' ? (
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
              ) : (
                <Download className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              )}
              <span className="truncate">Save Sticker</span>
            </button>

            {/* 3. Print Sticker Button */}
            <button
              onClick={handlePrint}
              disabled={isPrinting}
              type="button"
              className="touch-target px-3 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black transition-all flex items-center justify-center gap-1.5 shadow-md shadow-blue-600/25 cursor-pointer active:scale-95 disabled:opacity-75"
              title="Print high-resolution official sticker label"
            >
              {isPrinting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              <span className="truncate">{isPrinting ? 'Preparing Label...' : 'Print Label'}</span>
            </button>

            {/* 4. Quick Actions / Close */}
            {onOpenQuickAction ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenQuickAction(rmaNumber);
                }}
                className="touch-target px-3 py-2.5 text-xs font-bold text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/70 hover:bg-amber-100 border border-amber-200 dark:border-amber-800 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                title="Open Quick Processing Actions for this RMA"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                <span className="truncate">Quick Actions</span>
              </button>
            ) : (
              <button
                onClick={onClose}
                type="button"
                className="touch-target px-3 py-2.5 text-xs font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-xl transition-all flex items-center justify-center cursor-pointer"
              >
                Close
              </button>
            )}

          </div>

          <p className="text-[10px] text-center text-slate-400 dark:text-slate-500 hidden sm:block">
            Standard label sizing for warehouse intake stickers, mobile downloads, and thermal printers.
          </p>
        </div>

      </div>
    </div>
  );
}
