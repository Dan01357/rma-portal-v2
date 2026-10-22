import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { 
  X, 
  Printer, 
  CheckCircle2, 
  QrCode, 
  Package, 
  Building2, 
  Tag, 
  Hash, 
  Calendar, 
  User, 
  AlertTriangle,
  Sparkles
} from 'lucide-react';

export default function ReturnQRModal({ isOpen, onClose, report, onOpenQuickAction }) {
  if (!isOpen || !report) return null;

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

  const handlePrint = () => {
    const originalTitle = document.title;
    document.title = `RMA-QR-Sticker-${rmaNumber}`;
    document.body.classList.add('printing-sticker');
    window.print();
    setTimeout(() => {
      document.title = originalTitle;
      document.body.classList.remove('printing-sticker');
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200 modal-backdrop-print-fix">
      
      {/* Print Specific Stylesheet Injection */}
      <style>{`
        @media print {
          @page {
            size: auto;
            margin: 6mm;
          }
          html, body {
            background: #ffffff !important;
            color: #000000 !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          #app-main-view-container,
          .no-print, 
          .print\\:hidden {
            display: none !important;
          }
          .modal-backdrop-print-fix {
            position: static !important;
            background: transparent !important;
            padding: 0 !important;
            overflow: visible !important;
            display: block !important;
          }
          #rma-qr-box-sticker-wrapper {
            position: static !important;
            background: #ffffff !important;
            box-shadow: none !important;
            border: none !important;
            max-width: 100% !important;
            overflow: visible !important;
            padding: 0 !important;
            margin: 0 !important;
            display: block !important;
          }
          #rma-qr-box-sticker {
            position: relative !important;
            border: 2.5px solid #000000 !important;
            box-shadow: none !important;
            width: 100% !important;
            max-width: 440px !important;
            margin: 2mm auto !important;
            background: #ffffff !important;
            color: #000000 !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        }
      `}</style>

      <div 
        id="rma-qr-box-sticker-wrapper"
        className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-4 sm:my-6 flex flex-col max-h-[95vh]"
      >
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0 no-print">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">RMA Return Box QR Sticker</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">Ticket: {rmaNumber}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handlePrint}
              type="button"
              className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center space-x-1.5 transition-colors shadow-sm cursor-pointer"
              title="Print Sticker / Save PDF"
            >
              <Printer className="w-4 h-4" />
              <span>Print Sticker</span>
            </button>
            <button
              onClick={onClose}
              type="button"
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Body: Printable Box Sticker Card (Never clipped at top) */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-start">
          <div 
            id="rma-qr-box-sticker"
            className="w-full max-w-md bg-white border-2 border-slate-900 rounded-2xl p-5 shadow-sm text-slate-900 space-y-4 my-auto shrink-0"
          >
            {/* Top Bar: Company & Badge */}
            <div className="flex items-center justify-between border-b-2 border-slate-900 pb-2.5">
              <div>
                <span className="text-[10px] uppercase font-black tracking-widest text-slate-500 block">
                  Wholesale RMA Operations
                </span>
                <span className="text-xs font-black tracking-wider text-slate-900 uppercase">
                  Return Verification Label
                </span>
              </div>
              <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono font-black text-[10px] uppercase tracking-wider">
                Dock Intake
              </span>
            </div>

            {/* Middle: Big RMA # + High-Contrast QR Code */}
            <div className="flex items-center justify-between gap-4 py-1">
              <div className="space-y-1.5 min-w-0 flex-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Return Authorization #
                </span>
                <div className="text-xl sm:text-2xl font-black font-mono text-slate-900 tracking-tight break-all">
                  {rmaNumber}
                </div>
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 border border-slate-300 text-slate-800 text-xs font-bold">
                  <Building2 className="w-3.5 h-3.5 text-slate-600" />
                  <span>{supplier}</span>
                </div>
              </div>

              {/* QR Code */}
              <div className="p-2 bg-white border-2 border-slate-900 rounded-xl shadow-xs shrink-0 text-center">
                <QRCodeSVG
                  value={qrPayload}
                  size={120}
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
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Returned Item</span>
                <div className="font-black text-slate-900 text-sm leading-snug">{itemName}</div>
                <div className="font-mono text-[11px] text-slate-600 mt-0.5">
                  Barcode: <strong className="text-slate-900">{barcode}</strong> {sku ? `• SKU: ${sku}` : ''}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Quantity</span>
                  <span className="font-mono font-black text-slate-900 text-xs">
                    {quantity} {unit}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Defect Reason</span>
                  <span className="font-bold text-rose-700 text-xs line-clamp-1">
                    {reason}
                  </span>
                </div>
              </div>
            </div>

            {/* Bottom Strip: Reporter & Date */}
            <div className="flex items-center justify-between text-[11px] text-slate-600 border-t border-slate-200 pt-2 font-medium">
              <div>
                Reported by: <strong className="text-slate-900">{reporter}</strong>
              </div>
              <div className="font-mono text-[10px] text-slate-500">
                {dateFormatted}
              </div>
            </div>

            {/* Footer Instruction */}
            <div className="text-[9px] text-center font-bold text-slate-400 uppercase tracking-wider border-t border-dashed border-slate-300 pt-2">
              Attach securely to outer box or returned merchandise
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-3.5 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 shrink-0 no-print">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Standard label sizing for warehouse box stickers and thermal printers.
          </p>
          <div className="flex items-center gap-2">
            {onOpenQuickAction && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenQuickAction(rmaNumber);
                }}
                className="px-3.5 py-2 text-xs font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/70 hover:bg-blue-100 dark:hover:bg-blue-900/70 border border-blue-200 dark:border-blue-800 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                title="Open Quick Processing Actions for this RMA"
              >
                <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                <span>Quick Actions</span>
              </button>
            )}
            <button
              onClick={onClose}
              type="button"
              className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
            >
              Close
            </button>
            <button
              onClick={handlePrint}
              type="button"
              className="px-4 py-2 text-xs font-black text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-colors flex items-center space-x-1.5 shadow-md shadow-blue-600/30 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Print Sticker</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

