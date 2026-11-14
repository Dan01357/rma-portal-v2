import React, { useState, useRef, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  X, Printer, QrCode, ShieldCheck, CheckCircle2, AlertTriangle,
  Download, FileImage, Lock, Move, RotateCcw, ArrowRight
} from 'lucide-react';
import { downloadQrCodePng } from '../utils/qrDownload';
import { downloadCustomSizedStickerPng } from '../utils/customStickerCanvas';
import { printIsolatedElement } from '../utils/printIsolatedElement';
import {
  formatQuantityWithPackSize,
  formatManifestBreakdown,
  buildPortalQrPayload,
  isTestRecord
} from '../utils/rmaHelpers';

const STICKER_PRESETS = [
  { id: 'small', label: 'Small (Tuna Can)', sub: '58 × 52 mm', widthMm: 58, heightMm: 52 },
  { id: 'medium', label: 'Medium (Inner Box)', sub: '90 × 105 mm', widthMm: 90, heightMm: 105 },
  { id: 'large', label: 'Large (Carton)', sub: '115 × 148 mm', widthMm: 115, heightMm: 148 },
  { id: 'xlarge', label: 'Extra Large (A5)', sub: '148 × 200 mm', widthMm: 148, heightMm: 200 }
];

const MM_TO_SCREEN_PX = 3.55;

export default function ReturnQRModal({ isOpen, onClose, report, onOpenQuickAction }) {
  const [downloadingType, setDownloadingType] = useState(null); // 'qr' | 'label' | null
  const [downloadNotice, setDownloadNotice] = useState(null);
  const [isPrinting, setIsPrinting] = useState(false);

  // Dynamic size in physical millimeters (freely resizable via presets, drag handles, or inputs)
  const [sizeMm, setSizeMm] = useState({ widthMm: 90, heightMm: 105 });
  const [activePreset, setActivePreset] = useState('medium');
  const dragStateRef = useRef(null);

  useEffect(() => {
    const handlePointerMove = (e) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      e.preventDefault();
      const dxMm = (e.clientX - drag.startX) / MM_TO_SCREEN_PX;
      const dyMm = (e.clientY - drag.startY) / MM_TO_SCREEN_PX;

      setSizeMm(() => {
        const nextW = drag.axis === 'y'
          ? drag.startW
          : Math.round(Math.max(42, Math.min(185, drag.startW + dxMm)));
        const nextH = drag.axis === 'x'
          ? drag.startH
          : Math.round(Math.max(40, Math.min(240, drag.startH + dyMm)));
        return { widthMm: nextW, heightMm: nextH };
      });
      setActivePreset('custom');
    };

    const handlePointerUp = () => {
      if (dragStateRef.current) {
        dragStateRef.current = null;
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, []);

  const startDrag = useCallback((axis, e) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.style.userSelect = 'none';
    dragStateRef.current = {
      axis, // 'x' | 'y' | 'xy'
      startX: e.clientX,
      startY: e.clientY,
      startW: sizeMm.widthMm,
      startH: sizeMm.heightMm
    };
  }, [sizeMm]);

  if (!isOpen || !report) return null;

  const rmaNumber = report.rma_number || report.rmaNumber || report.id || 'N/A';
  const barcode = report.barcode || 'N/A';
  const sku = report.code || report.sku || '';
  const itemName = report.name || report.product_name || report.productName || `Barcode ${barcode}`;
  const quantity = report.quantity || 1;
  const unit = report.unit_name || report.unit || 'pc';
  const piecesPerCase = Number(report.pieces_per_case) || 1;
  const supplier = report.supplier_name || report.supplier || '';
  const storeBranch = report.store_branch || report.store || '';
  const streamType = report.rma_type === 'supplier_outbound' ? 'supplier_outbound' : 'customer_inbound';
  const reason = report.reason || report.defect_category || 'Damaged / Return';
  const reporter = report.reporter_name || report.reported_by || 'Staff';
  const reporterContact =
    report.reporter_contact ||
    report.reporter_phone ||
    report.phone ||
    (report.reported_by && report.reported_by.includes('(')
      ? report.reported_by.replace(/.*\((.*)\).*/, '$1')
      : '') ||
    'N/A';

  const manifestItems = Array.isArray(report.items) ? report.items : [];
  const isManifest = manifestItems.length > 1 || (report.total_items && report.total_items > 1);
  const totalItems = report.total_items || (manifestItems.length > 0 ? manifestItems.length : 1);
  const totalQuantity = report.total_quantity || (
    manifestItems.length > 0
      ? manifestItems.reduce((acc, it) => acc + (Number(it.quantity) || 1), 0)
      : quantity
  );
  const expiryDate = report.expiry_date || report.ai_document_metadata?.expiry_date || (manifestItems[0]?.expiry_date) || '';
  const isTest = isTestRecord(report);

  const createdDateObj = new Date(report.created_at || Date.now());
  const dateFormatted = createdDateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  const timeFormatted = createdDateObj.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  });
  const dateTimeFormatted = `${dateFormatted} • ${timeFormatted}`;

  // Private non-URL payload: external phone cameras & Google Lens cannot open it!
  const qrPayload = buildPortalQrPayload(rmaNumber, isTest);

  // Responsive layout tiers based on user-selected mm box
  const isCompact = sizeMm.widthMm < 76 || sizeMm.heightMm < 78;
  const isSpacious = sizeMm.widthMm >= 122 && sizeMm.heightMm >= 148;
  const screenWidthPx = Math.round(sizeMm.widthMm * MM_TO_SCREEN_PX);
  const screenMinHeightPx = Math.round(sizeMm.heightMm * MM_TO_SCREEN_PX);
  const qrDisplayPx = isCompact
    ? Math.max(66, Math.min(92, Math.round(sizeMm.widthMm * 1.35)))
    : isSpacious
      ? Math.min(185, Math.round(sizeMm.widthMm * 1.15))
      : Math.max(95, Math.min(140, Math.round(sizeMm.widthMm * 1.25)));

  const handleSelectPreset = (preset) => {
    setActivePreset(preset.id);
    setSizeMm({ widthMm: preset.widthMm, heightMm: preset.heightMm });
  };

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      const targetEl = document.getElementById('rma-qr-box-sticker');
      if (!targetEl) {
        setDownloadNotice({ type: 'error', msg: 'Sticker preview not ready.' });
        return;
      }
      printIsolatedElement({
        elementId: 'rma-qr-box-sticker',
        documentTitle: `RMA-Sticker-${rmaNumber}-${sizeMm.widthMm}x${sizeMm.heightMm}mm`,
        pageSize: 'auto',
        pageMargin: '6mm',
        customStyles: `
          @media print {
            #rma-qr-box-sticker {
              width: ${sizeMm.widthMm}mm !important;
              min-height: ${sizeMm.heightMm}mm !important;
              max-width: ${sizeMm.widthMm}mm !important;
              border: 1.8px solid #0f172a !important;
              border-radius: 6px !important;
              padding: ${isCompact ? '2.5mm' : '4mm'} !important;
              box-shadow: none !important;
              margin: 0 auto !important;
              background: #ffffff !important;
              box-sizing: border-box !important;
            }
          }
        `
      });
    } catch (err) {
      console.error('Print sticker failed:', err);
      setDownloadNotice({ type: 'error', msg: 'Could not open print dialog.' });
    } finally {
      setTimeout(() => setIsPrinting(false), 600);
    }
  };

  const handleDownloadQrOnly = async () => {
    setDownloadingType('qr');
    setDownloadNotice(null);
    try {
      await downloadQrCodePng({
        svgElementOrId: 'rma-qr-code-svg',
        rmaNumber,
        productName: isManifest ? `BATCH MANIFEST (${totalItems} SKUs)` : itemName,
        barcode: isManifest ? 'MULTI-ITEM' : barcode,
        reporter,
        reporterContact,
        dateFormatted: dateTimeFormatted,
        filename: `${rmaNumber}-QR.png`
      });
      setDownloadNotice({ type: 'success', msg: `Saved ${rmaNumber}-QR.png` });
    } catch (err) {
      console.error('Failed to download QR image:', err);
      setDownloadNotice({ type: 'error', msg: 'Could not generate QR PNG.' });
    } finally {
      setDownloadingType(null);
      setTimeout(() => setDownloadNotice(null), 4000);
    }
  };

  const handleDownloadFullLabel = async () => {
    setDownloadingType('label');
    setDownloadNotice(null);
    try {
      await downloadCustomSizedStickerPng({
        svgElementOrId: 'rma-qr-code-svg',
        widthMm: sizeMm.widthMm,
        heightMm: sizeMm.heightMm,
        rmaNumber,
        isTestMode: isTest,
        streamType,
        supplier,
        storeBranch,
        itemName,
        barcode,
        sku,
        quantity,
        unit,
        piecesPerCase,
        expiryDate,
        reason,
        reporter,
        reporterContact,
        dateTimeFormatted,
        items: manifestItems,
        totalItems,
        totalQuantity
      });
      setDownloadNotice({
        type: 'success',
        msg: `Saved ${rmaNumber}-Sticker-${sizeMm.widthMm}x${sizeMm.heightMm}mm.png`
      });
    } catch (err) {
      console.error('Failed to download Box Sticker:', err);
      setDownloadNotice({ type: 'error', msg: 'Could not generate sticker PNG.' });
    } finally {
      setDownloadingType(null);
      setTimeout(() => setDownloadNotice(null), 4000);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 bg-slate-900/75 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 w-full max-w-4xl max-h-[94dvh] flex flex-col rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">

        {/* Modal Top Header */}
        <div className="shrink-0 bg-slate-900 text-white px-4 sm:px-6 py-3.5 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-amber-500/20 rounded-xl shrink-0">
              <QrCode className="w-5 h-5 text-amber-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-bold tracking-tight truncate">
                  Print RMA Sticker Label
                </h2>
                {isTest && (
                  <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 text-[10px] font-black uppercase tracking-wider">
                    🧪 Test Mode
                  </span>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                Choose preset or drag edges to fit cans, boxes, or pallets • In-app portal scan only
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors shrink-0"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Preset & Size Controls Bar */}
        <div className="shrink-0 px-4 sm:px-6 py-2.5 bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {STICKER_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectPreset(preset)}
                className={`px-2.5 py-1.5 rounded-lg text-left transition-all border text-xs font-bold ${
                  activePreset === preset.id
                    ? 'bg-slate-900 text-white border-slate-900 dark:bg-amber-500 dark:text-slate-950 dark:border-amber-500 shadow-sm'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600 hover:border-amber-500'
                }`}
              >
                <span className="block leading-tight">{preset.label}</span>
                <span className={`block text-[10px] font-mono ${activePreset === preset.id ? 'opacity-80' : 'text-slate-400'}`}>
                  {preset.sub}
                </span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-2.5 py-1">
            <Move className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">W:</label>
            <input
              type="number"
              min={42}
              max={185}
              value={sizeMm.widthMm}
              onChange={(e) => {
                setActivePreset('custom');
                setSizeMm((prev) => ({
                  ...prev,
                  widthMm: Math.max(42, Math.min(185, Number(e.target.value) || 42))
                }));
              }}
              className="w-12 text-xs font-mono font-bold text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-1 py-0.5 text-center"
            />
            <span className="text-[11px] text-slate-400">×</span>
            <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">H:</label>
            <input
              type="number"
              min={40}
              max={240}
              value={sizeMm.heightMm}
              onChange={(e) => {
                setActivePreset('custom');
                setSizeMm((prev) => ({
                  ...prev,
                  heightMm: Math.max(40, Math.min(240, Number(e.target.value) || 40))
                }));
              }}
              className="w-12 text-xs font-mono font-bold text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-1 py-0.5 text-center"
            />
            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              mm ({(sizeMm.widthMm / 25.4).toFixed(1)}×{(sizeMm.heightMm / 25.4).toFixed(1)}&quot;)
            </span>
            <button
              type="button"
              onClick={() => handleSelectPreset(STICKER_PRESETS[1])}
              title="Reset to Medium size"
              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Scrollable Workspace: Drag-Resizable Physical Sticker */}
        <div className="flex-1 overflow-auto overscroll-contain p-4 sm:p-8 bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-start">
          <div className="mb-3 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-full px-3 py-1 shadow-xs">
            <Lock className="w-3.5 h-3.5 text-emerald-600" />
            <span>
              <strong>Private Portal QR:</strong> Google Lens / phone cameras cannot read this. Use the portal&apos;s{' '}
              <strong>Barcode / QR Scanner</strong> button.
            </span>
          </div>

          {/* Drag Resizable Container */}
          <div className="relative inline-block my-auto shrink-0 select-none pb-5 pr-5">
            <div
              id="rma-qr-box-sticker"
              style={{
                width: `${screenWidthPx}px`,
                minHeight: `${screenMinHeightPx}px`
              }}
              className={`bg-white border-2 border-slate-900 rounded-xl shadow-md text-slate-900 flex flex-col justify-between transition-[box-shadow] ${
                isCompact ? 'p-2.5 gap-1.5' : isSpacious ? 'p-6 gap-4' : 'p-4 gap-2.5'
              }`}
            >
              {/* Sticker Header Bar */}
              <div
                className={`flex items-center justify-between rounded-lg text-white ${
                  isTest ? 'bg-amber-800' : 'bg-slate-900'
                } ${isCompact ? 'px-2 py-1' : 'px-3 py-1.5'}`}
              >
                <span className={`font-black uppercase tracking-wider truncate ${isCompact ? 'text-[8px]' : isSpacious ? 'text-xs' : 'text-[10px]'}`}>
                  {isTest
                    ? '🧪 TEST SANDBOX LABEL'
                    : streamType === 'supplier_outbound'
                      ? 'PINGCON • SUPPLIER RTV'
                      : 'PINGCON • CUSTOMER RMA'}
                </span>
                <span className={`font-mono font-bold opacity-85 shrink-0 ml-2 ${isCompact ? 'text-[8px]' : 'text-[10px]'}`}>
                  {sizeMm.widthMm}×{sizeMm.heightMm}mm
                </span>
              </div>

              {/* RMA ID + Supplier + QR Row */}
              <div className={`flex items-start justify-between ${isCompact ? 'gap-2' : 'gap-3'}`}>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className={`font-bold uppercase tracking-wider text-slate-500 ${isCompact ? 'text-[7px]' : 'text-[9px]'}`}>
                    RMA Reference ID
                  </div>
                  <div className={`font-mono font-black text-slate-900 tracking-tight break-all leading-none ${
                    isCompact ? 'text-xs' : isSpacious ? 'text-2xl' : 'text-lg'
                  }`}>
                    {rmaNumber}
                  </div>
                  <div className="pt-0.5">
                    <div className={`font-bold uppercase text-slate-500 ${isCompact ? 'text-[7px]' : 'text-[9px]'}`}>
                      {streamType === 'supplier_outbound' ? 'Supplier' : 'Branch / Hub'}
                    </div>
                    <div className={`font-bold text-slate-900 leading-tight break-words ${
                      isCompact ? 'text-[9px]' : isSpacious ? 'text-base' : 'text-xs'
                    }`}>
                      {streamType === 'supplier_outbound'
                        ? (supplier || 'Pending Assignment')
                        : (storeBranch || supplier || 'Warehouse')}
                    </div>
                  </div>
                  {expiryDate && (
                    <div className={`inline-block font-mono font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded px-1.5 py-0.5 ${
                      isCompact ? 'text-[8px]' : 'text-[10px]'
                    }`}>
                      EXP: {expiryDate}
                    </div>
                  )}
                </div>

                <div className="shrink-0 flex flex-col items-center">
                  <div className={`bg-white border-2 border-slate-900 rounded-lg ${isCompact ? 'p-1' : 'p-1.5'}`}>
                    <QRCodeSVG
                      id="rma-qr-code-svg"
                      value={qrPayload}
                      size={qrDisplayPx}
                      level="M"
                      includeMargin={false}
                    />
                  </div>
                  <div className={`mt-1 px-1.5 py-0.5 rounded bg-slate-900 text-white font-mono font-bold tracking-wider uppercase ${
                    isCompact ? 'text-[6.5px]' : 'text-[8px]'
                  }`}>
                    PORTAL SCAN
                  </div>
                </div>
              </div>

              {/* Product & Defect Block */}
              <div className={`border-t border-b border-slate-200 ${isCompact ? 'py-1 space-y-0.5' : 'py-2 space-y-1'}`}>
                <div className={`font-bold text-slate-900 leading-snug break-words ${
                  isCompact ? 'text-[9px]' : isSpacious ? 'text-sm' : 'text-xs'
                }`}>
                  {isManifest ? `Batch Manifest (${totalItems} SKUs): ${itemName}` : itemName}
                </div>
                <div className={`font-mono text-slate-600 flex flex-wrap gap-x-2 gap-y-0.5 ${
                  isCompact ? 'text-[8px]' : isSpacious ? 'text-xs' : 'text-[10px]'
                }`}>
                  {!isManifest && <span>SKU/BC: {sku || barcode}</span>}
                  <span>
                    Qty:{' '}
                    <strong>
                      {isManifest
                        ? `${totalQuantity} pcs total (${formatManifestBreakdown(manifestItems, quantity, unit, true)})`
                        : formatQuantityWithPackSize(quantity, unit, piecesPerCase)}
                    </strong>
                  </span>
                </div>
                <div className={`font-semibold text-rose-700 leading-tight break-words ${
                  isCompact ? 'text-[8px]' : isSpacious ? 'text-xs' : 'text-[10px]'
                }`}>
                  Defect / Reason: {reason}
                </div>
              </div>

              {/* Reporter Metadata + Physical Signature Box */}
              <div className={`space-y-1.5 ${isCompact ? 'text-[8px]' : 'text-[10px]'}`}>
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-slate-700">
                  <span className="font-semibold">
                    By: <strong className="text-slate-900">{reporter}</strong> ({reporterContact})
                  </span>
                  <span className="font-mono text-slate-500">{dateTimeFormatted}</span>
                </div>

                {/* Signable handwritten line for physical attachment */}
                <div className={`border border-slate-400 rounded-md bg-slate-50 ${isCompact ? 'p-1.5' : 'p-2.5'}`}>
                  <div className={`font-bold uppercase tracking-wider text-slate-500 ${isCompact ? 'text-[6.5px]' : 'text-[8px]'}`}>
                    Staff Signature (Sign after printing & attach to item)
                  </div>
                  <div className={`flex items-end gap-2 ${isCompact ? 'mt-3' : isSpacious ? 'mt-7' : 'mt-5'}`}>
                    <div className="flex-1 border-b border-slate-800" />
                    <span className={`font-bold text-slate-500 shrink-0 ${isCompact ? 'text-[6.5px]' : 'text-[8px]'}`}>
                      Date: ______
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Edge Drag Handle (Width) */}
            <button
              type="button"
              onPointerDown={(e) => startDrag('x', e)}
              title="Drag horizontally to resize sticker width"
              aria-label="Drag to resize width"
              className="absolute top-2 bottom-7 -right-1 w-4 flex items-center justify-center cursor-ew-resize group print:hidden"
            >
              <span className="w-1.5 h-12 rounded-full bg-amber-500/70 group-hover:bg-amber-600 shadow transition-colors" />
            </button>

            {/* Bottom Edge Drag Handle (Height) */}
            <button
              type="button"
              onPointerDown={(e) => startDrag('y', e)}
              title="Drag vertically to resize sticker height"
              aria-label="Drag to resize height"
              className="absolute left-2 right-7 -bottom-1 h-4 flex items-center justify-center cursor-ns-resize group print:hidden"
            >
              <span className="h-1.5 w-12 rounded-full bg-amber-500/70 group-hover:bg-amber-600 shadow transition-colors" />
            </button>

            {/* Bottom-Right Corner Drag Handle (Width + Height) */}
            <button
              type="button"
              onPointerDown={(e) => startDrag('xy', e)}
              title="Drag corner to resize width & height freely"
              aria-label="Drag corner to resize"
              className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-md flex items-center justify-center cursor-nwse-resize print:hidden"
            >
              <Move className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Status Toast */}
        {downloadNotice && (
          <div className={`shrink-0 mx-4 sm:mx-6 mt-2 px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 ${
            downloadNotice.type === 'success'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700'
              : 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-700'
          }`}>
            {downloadNotice.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            <span>{downloadNotice.msg}</span>
          </div>
        )}

        {/* Modal Action Footer */}
        <div className="shrink-0 p-3.5 sm:px-6 sm:py-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadQrOnly}
              disabled={downloadingType !== null}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 border border-slate-300 dark:border-slate-600 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              {downloadingType === 'qr' ? 'Saving...' : 'Save QR PNG'}
            </button>

            <button
              type="button"
              onClick={handleDownloadFullLabel}
              disabled={downloadingType !== null}
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              <FileImage className="w-3.5 h-3.5" />
              {downloadingType === 'label' ? 'Generating...' : `Save Sticker PNG (${sizeMm.widthMm}×${sizeMm.heightMm})`}
            </button>

            <button
              type="button"
              onClick={handlePrint}
              disabled={isPrinting}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-slate-900 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              <Printer className="w-3.5 h-3.5" />
              {isPrinting ? 'Printing...' : `Print Sticker (${sizeMm.widthMm}×${sizeMm.heightMm}mm)`}
            </button>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {onOpenQuickAction && (
              <button
                type="button"
                onClick={() => onOpenQuickAction(report)}
                className="px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black rounded-xl transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <ShieldCheck className="w-4 h-4" />
                {streamType === 'supplier_outbound' ? 'Choose Disposition / Driver Pickup' : 'Quick Action'}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold rounded-xl transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
