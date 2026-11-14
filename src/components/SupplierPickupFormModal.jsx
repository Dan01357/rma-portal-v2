import React from 'react';
import { X, Printer, Scissors, CheckCircle2, FileCheck2, FolderOpen } from 'lucide-react';
import { printIsolatedElement } from '../utils/printIsolatedElement';
import {
  formatPeso,
  getReportManifestItems,
  computeItemPiecesAndValue,
  isTestRecord
} from '../utils/rmaHelpers';

/**
 * Dual-Copy A4 Validation Form for Supplier RTV Driver Pickups.
 * Renders TWO identical validation copies on a single A4 portrait page separated by a cut guideline:
 *   Top Half: OUR COMPANY COPY (PINGCON)
 *   Bottom Half: SUPPLIER COPY
 */
export default function SupplierPickupFormModal({
  isOpen,
  onClose,
  report,
  allReports = [],
  catalogProducts = []
}) {
  if (!isOpen || !report) return null;

  const meta = report.ai_document_metadata || {};
  const pickup = meta.supplier_pickup || {};

  const rmaNumber = report.rma_number || report.rmaNumber || report.id || 'N/A';
  const isTest = isTestRecord(report);
  const supplierName = pickup.supplier_name || report.supplier_name || 'Pending Assignment';
  const driverName = pickup.driver_name || report.driver_name || '';
  const driverLicense = pickup.driver_license_no || '';
  const truckPlate = pickup.truck_plate || '';
  const driveUrl = report.google_drive_folder_url || pickup.drive_folder_url || '';

  const dispositionCode = String(pickup.disposition || report.disposition || '').toLowerCase();
  const claimPurposeLabel = dispositionCode === 'supplier_exchange'
    ? 'RETURN TO SUPPLIER FOR REPLACEMENT / EXCHANGE'
    : 'RETURN TO SUPPLIER FOR DEBIT CLAIM';

  const manifestChildren = getReportManifestItems(report, allReports);
  const rawItems = manifestChildren.length > 0 ? manifestChildren : [report];

  const normalizedItems = rawItems.map((it, idx) => {
    const calc = computeItemPiecesAndValue(it, catalogProducts);
    return {
      idx: idx + 1,
      name: it.name || it.product_name || it.productName || `Item ${it.barcode || idx + 1}`,
      sku: it.code || it.sku || it.barcode || '',
      expiry: it.expiry_date || it.ai_document_metadata?.expiry_date || '',
      ...calc
    };
  });

  const grandTotalPieces = normalizedItems.reduce((sum, it) => sum + it.totalPieces, 0);
  const grandTotalValue = normalizedItems.reduce((sum, it) => sum + it.lineTotal, 0);
  const isDense = normalizedItems.length > 4;

  const handlePrintA4 = () => {
    printIsolatedElement({
      elementId: 'a4-supplier-pickup-form',
      documentTitle: `RMA-Pickup-Validation-${rmaNumber}`,
      pageSize: 'A4 portrait',
      pageMargin: '6mm',
      customStyles: `
        @media print {
          #a4-supplier-pickup-form {
            width: 196mm !important;
            max-width: 196mm !important;
            margin: 0 auto !important;
            padding: 0 !important;
            box-shadow: none !important;
            border: none !important;
            background: #ffffff !important;
            color: #0f172a !important;
          }
          .pickup-copy-half {
            border: 1.5px solid #0f172a !important;
            border-radius: 6px !important;
            padding: ${isDense ? '2.5mm 3.5mm' : '3.2mm 4mm'} !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          .pickup-cut-line {
            margin: 3.5mm 0 !important;
          }
        }
      `
    });
  };

  const renderFormCopy = (copyTitle, copyTagColor) => (
    <div
      className={`pickup-copy-half bg-white border-2 border-slate-900 rounded-xl text-slate-900 ${
        isDense ? 'p-3 space-y-1.5 text-[10px]' : 'p-4 space-y-2.5 text-[11px]'
      }`}
    >
      {/* Top Header Strip */}
      <div className="flex items-start justify-between gap-2 pb-1.5 border-b-2 border-slate-900">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded font-black uppercase tracking-wider text-[9px] text-white ${copyTagColor}`}>
              {copyTitle}
            </span>
            {isTest && (
              <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-black uppercase tracking-wider text-[9px]">
                TEST MODE RECORD
              </span>
            )}
          </div>
          <h3 className="font-black text-xs sm:text-sm tracking-tight text-slate-900 mt-1">
            SUPPLIER RTV PICKUP &amp; DELIVERY VALIDATION FORM
          </h3>
          <div className="font-bold text-[10px] text-emerald-800 uppercase tracking-wide">
            Purpose: {claimPurposeLabel}
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="text-[9px] font-bold uppercase text-slate-500">RMA Reference ID</div>
          <div className="font-mono font-black text-sm sm:text-base text-slate-900 leading-tight">
            {rmaNumber}
          </div>
          <div className="text-[9px] text-slate-500 font-semibold">
            {pickup.photos ? `${Object.keys(pickup.photos).length}/5 Drive Photos Verified` : 'Pickup Proof Form'}
          </div>
        </div>
      </div>

      {/* Supplier, Driver (OCR Populated), & Blank Handwritten Driver Contact/Date Fields */}
      <div className="grid grid-cols-12 gap-x-3 gap-y-1.5 bg-slate-50 border border-slate-300 rounded-lg p-2">
        <div className="col-span-6">
          <span className="text-[9px] font-bold uppercase text-slate-500 block">Supplier Company Name</span>
          <span className="font-black text-slate-900 text-xs break-words">{supplierName}</span>
        </div>
        <div className="col-span-6">
          <span className="text-[9px] font-bold uppercase text-slate-500 block">Truck License Plate #</span>
          <span className="font-mono font-bold text-slate-900">
            {truckPlate || '__________________________'}
          </span>
        </div>
        <div className="col-span-6">
          <span className="text-[9px] font-bold uppercase text-slate-500 block">Driver&apos;s Name (From ID)</span>
          <span className="font-bold text-slate-900">
            {driverName || '_______________________________'}
          </span>
        </div>
        <div className="col-span-6">
          <span className="text-[9px] font-bold uppercase text-slate-500 block">Driver&apos;s License / ID #</span>
          <span className="font-mono font-bold text-slate-900">
            {driverLicense || '__________________________'}
          </span>
        </div>
        {/* Intentionally blank handwritten fields for Driver to fill out upon pickup */}
        <div className="col-span-6 pt-1 border-t border-slate-200">
          <span className="text-[9px] font-bold uppercase text-slate-500 block">Pickup Date &amp; Time (Driver Writes)</span>
          <div className="h-4 border-b border-slate-800 mt-0.5" />
        </div>
        <div className="col-span-6 pt-1 border-t border-slate-200">
          <span className="text-[9px] font-bold uppercase text-slate-500 block">Driver Contact # (Driver Writes)</span>
          <div className="h-4 border-b border-slate-800 mt-0.5" />
        </div>
      </div>

      {/* Items Table — Case Quantities Converted to Pieces + Prices */}
      <div className="overflow-hidden border border-slate-300 rounded-lg">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900 text-white text-[9px] uppercase tracking-wider">
              <th className="py-1 px-2 w-6">#</th>
              <th className="py-1 px-2">Item Description / SKU</th>
              <th className="py-1 px-2 text-right">Qty (Converted to Pcs)</th>
              <th className="py-1 px-2 text-right">Unit Price</th>
              <th className="py-1 px-2 text-right">Line Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {normalizedItems.map((it) => (
              <tr key={it.idx} className="align-top">
                <td className="py-1 px-2 font-mono text-slate-500">{it.idx}</td>
                <td className="py-1 px-2">
                  <div className="font-bold text-slate-900 leading-tight">{it.name}</div>
                  <div className="text-[9px] font-mono text-slate-500">
                    {it.sku}{it.expiry ? ` • EXP: ${it.expiry}` : ''}
                  </div>
                </td>
                <td className="py-1 px-2 text-right font-mono font-bold whitespace-nowrap">
                  {it.isCaseUnit && it.piecesPerCase > 1
                    ? `${it.totalPieces.toLocaleString()} pcs (${it.rawQty} ${it.unitName} × ${it.piecesPerCase})`
                    : `${it.totalPieces.toLocaleString()} ${it.unitName === 'pc' || it.totalPieces === 1 ? 'pc' : 'pcs'}`}
                </td>
                <td className="py-1 px-2 text-right font-mono whitespace-nowrap">
                  {formatPeso(it.isCaseUnit && it.piecesPerCase > 1 ? it.pricePerPiece : it.recordedUnitPrice)}
                  <span className="text-[8px] text-slate-400"> /pc</span>
                </td>
                <td className="py-1 px-2 text-right font-mono font-bold whitespace-nowrap">
                  {formatPeso(it.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 border-t-2 border-slate-900 font-black">
              <td colSpan={2} className="py-1.5 px-2 text-right uppercase text-[10px]">
                Total Returned Summary:
              </td>
              <td className="py-1.5 px-2 text-right font-mono">
                {grandTotalPieces.toLocaleString()} pcs
              </td>
              <td className="py-1.5 px-2 text-right text-[9px] text-slate-500 font-semibold">
                Total RMA Value:
              </td>
              <td className="py-1.5 px-2 text-right font-mono text-xs text-slate-900">
                {formatPeso(grandTotalValue)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Physical Signature Block for Driver & Releasing Staff */}
      <div className="grid grid-cols-2 gap-4 pt-1">
        <div className="border border-slate-300 rounded-lg p-2 bg-slate-50/70">
          <div className="text-[8.5px] font-bold uppercase text-slate-500">
            Supplier Driver&apos;s Signature Over Printed Name
          </div>
          <div className="mt-5 border-b border-slate-900" />
          <div className="text-[8.5px] text-slate-600 mt-0.5 flex justify-between">
            <span>Received in good order for return</span>
            <span>Sign &amp; Date</span>
          </div>
        </div>

        <div className="border border-slate-300 rounded-lg p-2 bg-slate-50/70">
          <div className="text-[8.5px] font-bold uppercase text-slate-500">
            Releasing Staff&apos;s Printed Name &amp; Signature
          </div>
          <div className="mt-5 border-b border-slate-900" />
          <div className="text-[8.5px] text-slate-600 mt-0.5 flex justify-between">
            <span>Verified &amp; Released by Pingcon Staff</span>
            <span>Sign &amp; Date</span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-2 sm:p-4 bg-slate-900/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 w-full max-w-4xl max-h-[95dvh] flex flex-col rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">

        {/* Top Modal Header */}
        <div className="shrink-0 bg-emerald-900 text-white px-4 sm:px-6 py-3.5 flex items-center justify-between border-b border-emerald-800">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-emerald-500/20 rounded-xl shrink-0">
              <FileCheck2 className="w-5 h-5 text-emerald-300" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold truncate">
                A4 Supplier Pickup Validation Form — {rmaNumber}
              </h2>
              <p className="text-[11px] sm:text-xs text-emerald-200 truncate">
                2 copies per A4 page (Top: Our Copy • Bottom: Supplier Copy) • Status tagged: Picked Up
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-emerald-200 hover:text-white hover:bg-emerald-800 rounded-lg transition-colors"
            aria-label="Close form"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status Confirmation Bar */}
        <div className="shrink-0 px-4 sm:px-6 py-2 bg-emerald-50 dark:bg-emerald-950/50 border-b border-emerald-200 dark:border-emerald-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-200 font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              RMA marked <strong>Picked Up</strong>. Print this A4 sheet, cut along the dashed center line, have Driver &amp; Staff sign, and keep our top copy.
            </span>
          </div>
          {driveUrl && (
            <a
              href={driveUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 font-bold hover:bg-emerald-100 transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Open RMA Drive Folder
            </a>
          )}
        </div>

        {/* Scrollable A4 Dual-Copy Preview */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-3 sm:p-6 bg-slate-200 dark:bg-slate-950 flex justify-center">
          <div
            id="a4-supplier-pickup-form"
            className="w-full max-w-[790px] bg-white p-4 sm:p-6 shadow-lg rounded-lg border border-slate-300 my-auto"
          >
            {/* Copy 1: PINGCON COMPANY COPY */}
            {renderFormCopy('COPY 1 — OUR COMPANY COPY (PINGCON RETAIN)', 'bg-slate-900')}

            {/* Dashed Cut Guide Line */}
            <div className="pickup-cut-line my-4 flex items-center gap-2 text-slate-500">
              <div className="flex-1 border-t-2 border-dashed border-slate-400" />
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-dashed border-slate-400 bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-600 shrink-0">
                <Scissors className="w-3 h-3" />
                Cut Here — Separate Company &amp; Supplier Copies
              </span>
              <div className="flex-1 border-t-2 border-dashed border-slate-400" />
            </div>

            {/* Copy 2: SUPPLIER COPY */}
            {renderFormCopy('COPY 2 — SUPPLIER COPY (HAND TO DRIVER)', 'bg-emerald-700')}
          </div>
        </div>

        {/* Footer Buttons */}
        <div className="shrink-0 p-3.5 sm:px-6 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">
            Tip: Set printer paper size to <strong>A4</strong> with Margins set to Default/Minimum for exact half-page cut alignment.
          </p>
          <div className="flex items-center gap-2.5 ml-auto">
            <button
              type="button"
              onClick={handlePrintA4}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white text-xs sm:text-sm font-black rounded-xl transition-colors flex items-center gap-2 shadow-sm"
            >
              <Printer className="w-4 h-4" />
              Print A4 Dual-Copy Form
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs sm:text-sm font-bold rounded-xl transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

