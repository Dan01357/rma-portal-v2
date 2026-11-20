import React, { useState, useEffect } from 'react';
import { X, Printer, Scissors, CheckCircle2, FileCheck2, FolderOpen } from 'lucide-react';
import { printIsolatedElement } from '../utils/printIsolatedElement';
import {
  formatPeso,
  getReportManifestItems,
  computeItemPiecesAndValue,
  formatFourChoiceOutcome,
  isTestRecord
} from '../utils/rmaHelpers';

const isPlaceholderSupplier = (val) => {
  const s = String(val || '').trim().toLowerCase();
  return !s || s === 'pending assignment' || s === 'pending' || s === 'unassigned' || s === 'warehouse' || s === 'n/a';
};

/**
 * Unified Letter-Size (8.5" x 11") Debit Claim / Replacement & Driver Pickup Form.
 * - Pure black & white outline layout (#ffffff background, #000000 ink & borders).
 * - Smart Adaptive Copy Layout:
 *   - 1 to 4 items ('auto'): Compact Dual-Copy Letter sheet with dead-center 50% Cut Here line.
 *   - 5+ items (or 'full_page' toggle): Separate Full-Page Copies with repeating thead & page breaks.
 */
export default function SupplierPickupFormModal({
  isOpen,
  onClose,
  report,
  allReports = [],
  catalogProducts = []
}) {
  // Always declare hooks unconditionally before any early returns
  const [copyLayoutMode, setCopyLayoutMode] = useState('auto'); // 'auto' | 'full_page'
  const [preparedBy, setPreparedBy] = useState('Warehouse Staff');

  useEffect(() => {
    if (!isOpen || !report) return;
    setCopyLayoutMode('auto');
    const pickupMeta = report?.ai_document_metadata?.supplier_pickup || {};
    const initialPrepared = String(
      pickupMeta.processed_by ||
      report.inspected_by ||
      report?.ai_document_metadata?.simple_rtv_updated_by ||
      'Warehouse Staff'
    )
      .replace(/\s*\([^)]*\)/g, '')
      .trim() || 'Warehouse Staff';
    setPreparedBy(initialPrepared);
  }, [isOpen, report?.id, report?.rma_number]);

  if (!isOpen || !report) return null;

  const meta = report.ai_document_metadata || {};
  const pickup = meta.supplier_pickup || {};
  const outcome = formatFourChoiceOutcome(report);

  const rmaNumber = report.rma_number || report.rmaNumber || report.id || 'N/A';
  const isTest = isTestRecord(report);
  const isSupplierStream = report.rma_type === 'supplier_outbound';

  const bc = String(report.barcode || '').trim();
  const skuCode = String(report.code || report.sku || '').trim();
  const matchedCatalogProd = (catalogProducts || []).find((p) =>
    (bc && p.barcode && String(p.barcode).trim() === bc) ||
    (skuCode && (String(p.code || '').trim() === skuCode || String(p.sku || '').trim() === skuCode))
  );

  const supplierName = [
    pickup.supplier_name,
    report.supplier_name,
    report.supplierName,
    report.supplier,
    matchedCatalogProd?.supplier_name,
    matchedCatalogProd?.supplierName
  ].find((cand) => !isPlaceholderSupplier(cand)) || 'Pending Assignment';

  const supplierEmailTo = pickup.supplier_email_to || '';
  const supplierEmailCc = pickup.supplier_email_cc || '';
  const claimNumber = outcome.claimNumber || pickup.claim_number || '';
  const driverName = pickup.driver_name || report.driver_name || '';
  const driverLicense = pickup.driver_license_no || '';
  const truckPlate = pickup.truck_plate || '';
  const driveUrl = report.google_drive_folder_url || pickup.drive_folder_url || '';
  const photoCount = pickup.photos && typeof pickup.photos === 'object' ? Object.keys(pickup.photos).length : 0;

  const dispositionCode = String(pickup.disposition || meta.simple_rtv_disposition || report.disposition || '').toLowerCase();
  const isReplacementForm =
    dispositionCode === 'supplier_exchange' ||
    dispositionCode === 'customer_exchange' ||
    outcome.choiceKey === 'replacement';

  const formHeaderTitle = isReplacementForm
    ? 'SUPPLIER REPLACEMENT / EXCHANGE & PICKUP FORM'
    : 'SUPPLIER DEBIT CLAIM & PICKUP VALIDATION FORM';

  const claimPurposeLabel = isReplacementForm
    ? 'Return to Supplier for Replacement / Exchange'
    : 'Return to Supplier for Debit Claim / AP Deduction';

  const refLineLabel = isReplacementForm
    ? `Replacement Ref #: ${claimNumber || rmaNumber}`
    : `Claim #: ${claimNumber || rmaNumber}`;

  const modalTitleLabel = isReplacementForm ? 'Replacement & Pickup Form' : 'Debit Claim & Pickup Form';

  const manifestChildren = getReportManifestItems(report, allReports);
  const rawItems = manifestChildren.length > 0 ? manifestChildren : [report];

  const normalizedItems = rawItems.map((it, idx) => {
    const calc = computeItemPiecesAndValue(it, catalogProducts);
    const rawExp = String(it.expiry_date || it.ai_document_metadata?.expiry_date || report.expiry_date || '').trim();
    const cleanExpiry = rawExp && /^\d{4}-\d{2}-\d{2}/.test(rawExp) ? rawExp.slice(0, 10) : (rawExp || '—');
    return {
      idx: idx + 1,
      name: it.name || it.product_name || it.productName || `Item ${it.barcode || idx + 1}`,
      sku: (it.code && it.code !== it.barcode ? it.code : (it.sku && it.sku !== it.barcode ? it.sku : '')) || it.barcode || '—',
      expiry: cleanExpiry,
      ...calc
    };
  });

  const grandTotalPieces = normalizedItems.reduce((sum, it) => sum + it.totalPieces, 0);
  const grandTotalValue = normalizedItems.reduce((sum, it) => sum + it.lineTotal, 0);

  const useFullPagePerCopy = copyLayoutMode === 'full_page' || normalizedItems.length >= 5;
  const isCompactMode = !useFullPagePerCopy;

  const handlePrintLetter = () => {
    const compactStyles = `
      @media print {
        #letter-supplier-pickup-form {
          width: 8.5in !important;
          height: 10.95in !important;
          max-width: 8.5in !important;
          margin: 0 auto !important;
          padding: 0.35in 0.4in !important;
          display: flex !important;
          flex-direction: column !important;
          justify-content: space-between !important;
          background: #ffffff !important;
          color: #000000 !important;
          border: none !important;
          box-shadow: none !important;
          overflow: hidden !important;
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }
        .pickup-copy-compact {
          height: 4.75in !important;
          max-height: 4.75in !important;
          overflow: hidden !important;
          padding: 0.14in 0.18in !important;
          border: 1.5px solid #000000 !important;
          background: #ffffff !important;
          color: #000000 !important;
          display: flex !important;
          flex-direction: column !important;
          justify-content: space-between !important;
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }
        .pickup-cut-line {
          height: 0.75in !important;
          margin: 0 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
        }
      }
    `;

    const fullPageStyles = `
      @media print {
        #letter-supplier-pickup-form {
          width: 7.7in !important;
          max-width: 7.7in !important;
          margin: 0 auto !important;
          padding: 0 !important;
          background: #ffffff !important;
          color: #000000 !important;
          border: none !important;
          box-shadow: none !important;
          overflow: visible !important;
        }
        .pickup-copy-full {
          width: 100% !important;
          padding: 0.22in !important;
          border: 1.5px solid #000000 !important;
          background: #ffffff !important;
          color: #000000 !important;
        }
        .pickup-copy-full table {
          width: 100% !important;
          border-collapse: collapse !important;
        }
        .pickup-copy-full thead {
          display: table-header-group !important;
        }
        .pickup-copy-full tr {
          break-inside: avoid !important;
          page-break-inside: avoid !important;
        }
        .pickup-signatures-block {
          break-inside: avoid !important;
          page-break-inside: avoid !important;
        }
        .pickup-copy-break {
          page-break-before: always !important;
          break-before: page !important;
          height: 0 !important;
          margin: 0 !important;
          border: none !important;
        }
      }
    `;

    printIsolatedElement({
      elementId: 'letter-supplier-pickup-form',
      documentTitle: `${isReplacementForm ? 'RMA-Replacement-Pickup' : 'RMA-Debit-Claim-Pickup'}-${rmaNumber}`,
      pageSize: 'letter portrait',
      pageMargin: isCompactMode ? '0' : '0.4in',
      allowMultiPage: useFullPagePerCopy,
      customStyles: `
        #letter-supplier-pickup-form, #letter-supplier-pickup-form * {
          color: #000000 !important;
          box-shadow: none !important;
        }
        ${isCompactMode ? compactStyles : fullPageStyles}
      `
    });
  };

  const renderFormCopy = (copyTitle, layoutClass) => (
    <div
      className={`${layoutClass} bg-white border-[1.5px] border-black text-black ${
        isCompactMode ? 'p-3 space-y-1.5 text-[9.5px]' : 'p-4 space-y-3 text-[11px]'
      }`}
    >
      {/* Top Header Strip — Plain B&W Outline */}
      <div className="flex items-start justify-between gap-2 pb-1.5 border-b-[1.5px] border-black">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="px-2 py-0.5 border-[1.5px] border-black bg-white text-black font-black uppercase tracking-wider text-[8.5px]">
              {copyTitle}
            </span>
            {isTest && (
              <span className="px-2 py-0.5 border-[1.5px] border-black bg-white text-black font-black uppercase tracking-wider text-[8.5px]">
                [TEST MODE RECORD]
              </span>
            )}
          </div>
          <h3 className={`font-black tracking-tight text-black mt-1 leading-tight ${isCompactMode ? 'text-xs' : 'text-sm'}`}>
            {formHeaderTitle}
          </h3>
          <div className="font-bold text-[9.5px] text-black mt-0.5">
            Purpose: {claimPurposeLabel}
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="text-[9px] font-black font-mono text-black">
            {refLineLabel}
          </div>
          <div className={`font-mono font-black text-black leading-tight ${isCompactMode ? 'text-xs' : 'text-sm'}`}>
            RMA #: {rmaNumber}
          </div>
          <div className="text-[8.5px] text-black font-semibold">
            {outcome.formattedTime ? `${outcome.formattedTime} • ` : ''}
            {`${photoCount}/5 Drive Photos Verified`}
          </div>
        </div>
      </div>

      {/* Supplier, Driver, & Handwritten Fields — Plain B&W Box */}
      <div className={`grid grid-cols-12 gap-x-3 gap-y-1 border border-black bg-white ${isCompactMode ? 'p-1.5' : 'p-2.5'}`}>
        <div className="col-span-6">
          <span className="text-[8px] font-bold uppercase text-black block">Supplier Company Name</span>
          <span className={`font-black text-black break-words ${isCompactMode ? 'text-[10.5px]' : 'text-xs'}`}>
            {supplierName}
          </span>
          {(supplierEmailTo || supplierEmailCc) && (
            <div className="text-[8px] text-black font-mono break-all mt-0.5">
              {supplierEmailTo ? `To: ${supplierEmailTo}` : ''}
              {supplierEmailTo && supplierEmailCc ? ' • ' : ''}
              {supplierEmailCc ? `CC: ${supplierEmailCc}` : ''}
            </div>
          )}
        </div>
        <div className="col-span-6">
          <span className="text-[8px] font-bold uppercase text-black block">Truck Plate #</span>
          <span className="font-mono font-bold text-black">
            {truckPlate || '__________________________'}
          </span>
        </div>
        <div className="col-span-6">
          <span className="text-[8px] font-bold uppercase text-black block">Driver Name</span>
          <span className="font-bold text-black">
            {driverName || '_______________________________'}
          </span>
        </div>
        <div className="col-span-6">
          <span className="text-[8px] font-bold uppercase text-black block">Driver License #</span>
          <span className="font-mono font-bold text-black">
            {driverLicense || '__________________________'}
          </span>
        </div>
        {/* Handwritten blank lines for physical pickup */}
        <div className="col-span-6 pt-1 border-t border-black">
          <span className="text-[8px] font-bold uppercase text-black block">
            Pickup Date &amp; Time (YYYY-MM-DD HH:mm) (Driver Writes)
          </span>
          <div className={`${isCompactMode ? 'h-3' : 'h-4'} border-b border-black mt-0.5`} />
        </div>
        <div className="col-span-6 pt-1 border-t border-black">
          <span className="text-[8px] font-bold uppercase text-black block">
            Driver Contact # (Driver Writes)
          </span>
          <div className={`${isCompactMode ? 'h-3' : 'h-4'} border-b border-black mt-0.5`} />
        </div>
      </div>

      {/* Itemized Table — Plain B&W Outline & Repeating Header Support */}
      <div className="border border-black bg-white">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-white text-black border-b-[1.5px] border-black text-[8.5px] font-black uppercase tracking-wider">
              <th className="py-1 px-1.5 border-r border-black w-6 text-center">#</th>
              <th className="py-1 px-1.5 border-r border-black">Item Description / SKU</th>
              <th className="py-1 px-1.5 border-r border-black text-center whitespace-nowrap">Expiry Date (YYYY-MM-DD)</th>
              <th className="py-1 px-1.5 border-r border-black text-right whitespace-nowrap">Qty (Converted to Pcs)</th>
              <th className="py-1 px-1.5 border-r border-black text-right whitespace-nowrap">Unit Price</th>
              <th className="py-1 px-1.5 text-right whitespace-nowrap">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {normalizedItems.map((it) => (
              <tr key={it.idx} className="align-top border-b border-black last:border-b-0">
                <td className="py-1 px-1.5 font-mono text-black text-center border-r border-black">{it.idx}</td>
                <td className="py-1 px-1.5 border-r border-black">
                  <div className="font-bold text-black leading-tight">{it.name}</div>
                  <div className="text-[8px] font-mono text-black">SKU: {it.sku}</div>
                </td>
                <td className="py-1 px-1.5 text-center font-mono text-black whitespace-nowrap border-r border-black">
                  {it.expiry}
                </td>
                <td className="py-1 px-1.5 text-right font-mono font-bold text-black whitespace-nowrap border-r border-black">
                  {it.isCaseUnit && it.piecesPerCase > 1
                    ? `${it.totalPieces.toLocaleString()} pcs (${it.rawQty} ${it.unitName} × ${it.piecesPerCase})`
                    : `${it.totalPieces.toLocaleString()} ${it.unitName === 'pc' || it.totalPieces === 1 ? 'pc' : 'pcs'}`}
                </td>
                <td className="py-1 px-1.5 text-right font-mono text-black whitespace-nowrap border-r border-black">
                  {formatPeso(it.isCaseUnit && it.piecesPerCase > 1 ? it.pricePerPiece : it.recordedUnitPrice)}/pc
                </td>
                <td className="py-1 px-1.5 text-right font-mono font-bold text-black whitespace-nowrap">
                  {formatPeso(it.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-white border-t-[1.5px] border-black font-black text-black">
              <td colSpan={3} className="py-1 px-1.5 text-right uppercase text-[9px] border-r border-black">
                Total Summary ({normalizedItems.length} line{normalizedItems.length > 1 ? 's' : ''}):
              </td>
              <td className="py-1 px-1.5 text-right font-mono whitespace-nowrap border-r border-black">
                {grandTotalPieces.toLocaleString()} pcs
              </td>
              <td className="py-1 px-1.5 text-right text-[8.5px] font-bold border-r border-black">
                Total Value:
              </td>
              <td className="py-1 px-1.5 text-right font-mono text-[10.5px] whitespace-nowrap">
                {formatPeso(grandTotalValue)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Signatures & Editable Prepared By Block */}
      <div className="pickup-signatures-block grid grid-cols-3 gap-2.5 pt-0.5 text-center">
        <div className={`border border-black bg-white ${isCompactMode ? 'p-1.5' : 'p-2'}`}>
          <div className="text-[8px] font-bold uppercase text-black">
            Prepared By (Logistics / Warehouse)
          </div>
          <input
            type="text"
            value={preparedBy}
            onChange={(e) => setPreparedBy(e.target.value)}
            className={`w-full text-center font-bold text-black bg-transparent border-0 border-b border-black focus:outline-none text-[10px] ${
              isCompactMode ? 'mt-3 pb-0.5' : 'mt-5 pb-1'
            }`}
            title="Click to edit Prepared By name"
          />
          <div className="text-[8px] text-black mt-0.5">Printed Name &amp; Date</div>
        </div>

        <div className={`border border-black bg-white ${isCompactMode ? 'p-1.5' : 'p-2'}`}>
          <div className="text-[8px] font-bold uppercase text-black">
            Supplier Driver&apos;s Signature
          </div>
          <div className={`${isCompactMode ? 'mt-5' : 'mt-7'} border-b border-black`} />
          <div className="text-[8px] text-black mt-0.5">Signature Over Printed Name &amp; Date</div>
        </div>

        <div className={`border border-black bg-white ${isCompactMode ? 'p-1.5' : 'p-2'}`}>
          <div className="text-[8px] font-bold uppercase text-black">
            Releasing Staff&apos;s Signature
          </div>
          <div className={`${isCompactMode ? 'mt-5' : 'mt-7'} border-b border-black`} />
          <div className="text-[8px] text-black mt-0.5">Verified &amp; Released (Sign &amp; Date)</div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-2 sm:p-4 bg-slate-900/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 w-full max-w-5xl max-h-[95dvh] flex flex-col rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">

        {/* Top Modal Header */}
        <div className="shrink-0 bg-slate-900 text-white px-4 sm:px-6 py-3.5 flex items-center justify-between border-b border-slate-800 print:hidden">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-slate-800 rounded-xl shrink-0">
              <FileCheck2 className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold truncate">
                Letter {modalTitleLabel} — {rmaNumber}
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-300 truncate">
                8.5&quot; × 11&quot; Letter • Plain B&amp;W Print • {outcome.label}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            aria-label="Close form"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Non-Printed Status & Adaptive Layout Control Bar */}
        <div className="shrink-0 px-4 sm:px-6 py-2.5 bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2.5 text-xs print:hidden">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{outcome.label}</span>
            </span>

            {/* Active Layout Indicator Badge (never printed) */}
            <span
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-black border ${
                isCompactMode
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700'
                  : 'bg-indigo-50 text-indigo-800 border-indigo-300 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-700'
              }`}
            >
              {isCompactMode
                ? `Compact 1-Page Dual Copy (${normalizedItems.length} item${normalizedItems.length > 1 ? 's' : ''} • Cut at 50%)`
                : `Separate Full-Page Copies (${normalizedItems.length} items • Repeating Headers)`}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Auto | Full Page per Copy Layout Toggle */}
            <div className="inline-flex rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 p-0.5 shadow-2xs">
              <button
                type="button"
                onClick={() => setCopyLayoutMode('auto')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-black transition-colors cursor-pointer ${
                  copyLayoutMode === 'auto'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Automatically use 1-page half-sheet layout for 1–4 items, and full-page copies for 5+ items"
              >
                Auto
              </button>
              <button
                type="button"
                onClick={() => setCopyLayoutMode('full_page')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-black transition-colors cursor-pointer ${
                  copyLayoutMode === 'full_page'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Print Copy 1 and Copy 2 on separate full US Letter pages"
              >
                Full Page per Copy
              </button>
            </div>

            {driveUrl && (
              <a
                href={driveUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-bold hover:bg-slate-50 transition-colors"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Open RMA Drive Folder
              </a>
            )}
          </div>
        </div>

        {/* Scrollable Letter Sheet Preview */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-3 sm:p-6 bg-slate-200 dark:bg-slate-950 flex justify-center">
          {isCompactMode ? (
            <div
              id="letter-supplier-pickup-form"
              className="w-full max-w-[816px] bg-white p-4 sm:p-6 shadow-lg border border-black my-auto flex flex-col justify-between"
            >
              {/* Copy 1: Top Half (height: 4.75in in print) */}
              {renderFormCopy('COPY 1 — OUR COMPANY COPY (PINGCON RETAIN)', 'pickup-copy-compact')}

              {/* Dead-Center 50% Cut Line */}
              <div className="pickup-cut-line my-3 flex items-center gap-2 text-black">
                <div className="flex-1 border-t-[1.5px] border-dashed border-black" />
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 border border-dashed border-black bg-white text-[8.5px] font-black uppercase tracking-widest text-black shrink-0">
                  <Scissors className="w-3 h-3" />
                  ✂ Cut Here (50%) — Separate Company &amp; Supplier Copies
                </span>
                <div className="flex-1 border-t-[1.5px] border-dashed border-black" />
              </div>

              {/* Copy 2: Bottom Half (height: 4.75in in print) */}
              {renderFormCopy(
                isSupplierStream ? 'COPY 2 — SUPPLIER COPY (HAND TO DRIVER)' : 'COPY 2 — DRIVER / CUSTOMER COPY',
                'pickup-copy-compact'
              )}
            </div>
          ) : (
            <div
              id="letter-supplier-pickup-form"
              className="w-full max-w-[816px] bg-white p-4 sm:p-6 shadow-lg border border-black my-auto space-y-6"
            >
              {/* Full-Page Copy 1 */}
              {renderFormCopy('COPY 1 — OUR COMPANY COPY (PINGCON RETAIN)', 'pickup-copy-full')}

              {/* Explicit Page Break Indicator (hidden divider bar on screen, hard page break in print) */}
              <div className="pickup-copy-break border-t-2 border-dotted border-black pt-2 text-center text-[10px] font-bold uppercase tracking-widest text-black print:hidden">
                — Page Break Before Copy 2 —
              </div>

              {/* Full-Page Copy 2 */}
              {renderFormCopy(
                isSupplierStream ? 'COPY 2 — SUPPLIER COPY (HAND TO DRIVER)' : 'COPY 2 — DRIVER / CUSTOMER COPY',
                'pickup-copy-full'
              )}
            </div>
          )}
        </div>

        {/* Footer Buttons */}
        <div className="shrink-0 p-3.5 sm:px-6 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3 print:hidden">
          <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">
            Set printer paper size to <strong>Letter (8.5&quot; × 11&quot;)</strong> • Pure B&amp;W ink-saver output.
          </p>
          <div className="flex items-center gap-2.5 ml-auto">
            <button
              type="button"
              onClick={handlePrintLetter}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 dark:text-slate-900 text-white text-xs sm:text-sm font-black rounded-xl transition-colors flex items-center gap-2 shadow-sm cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              {isCompactMode ? 'Print Letter Dual-Copy Form' : 'Print Full-Page Letter Copies'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs sm:text-sm font-bold rounded-xl transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
