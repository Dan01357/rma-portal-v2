import React, { useState, useEffect, useMemo } from 'react';
import { X, Printer, Scissors, CheckCircle2, FileCheck2, FolderOpen, Layers, AlertTriangle } from 'lucide-react';
import { printIsolatedElement } from '../utils/printIsolatedElement';
import { buildPickupFormCopiesList } from '../utils/pickupFormPdf';
import {
  formatPeso,
  getConsolidatedPickupItems,
  formatFourChoiceOutcome,
  formatDateTimeYmdHm,
  formatSaveFileTimestamp,
  isTestRecord,
  getPickupPhotosSummary
} from '../utils/rmaHelpers';

const isPlaceholderSupplier = (val) => {
  const s = String(val || '').trim().toLowerCase();
  return !s || s === 'pending assignment' || s === 'pending' || s === 'unassigned' || s === 'warehouse' || s === 'n/a';
};

const clampCopies = (val) => {
  const parsed = parseInt(val, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(10, parsed));
};

/**
 * Unified Letter-Size (8.5" x 11") Handover, Debit Claim, Buffer Replacement & Driver Pickup Form.
 * - Pure black & white outline layout (#ffffff background, #000000 ink & borders only).
 * - Automatically distinguishes Customer Hub (`customer_inbound`) vs Supplier RTV (`supplier_outbound`).
 * - Page Separation & Customizable Copy Count:
 *   - Separated Full Pages (auto-selected when items >= 4 or copy count !== 1+1): dedicated page breaks, no clipping, repeating thead.
 *   - Combined 1-Page (Cut at 50%): 1 Our Company Copy + 1 Counterparty Copy on one US Letter sheet with overflow warning when items >= 4.
 */
export default function SupplierPickupFormModal({
  isOpen,
  onClose,
  report = null,
  reports = [],
  allReports = [],
  catalogProducts = []
}) {
  const effectiveReports = useMemo(() => {
    const raw = Array.isArray(reports) && reports.length > 0 ? reports : (report ? [report] : []);
    const seen = new Set();
    return raw.filter((r) => {
      if (!r) return false;
      const k = String(r.rma_number || r.rmaNumber || r.id || '');
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [report, reports]);

  const primaryReport = effectiveReports[0] || null;

  // Always declare ALL React hooks unconditionally before any early returns
  const [layoutMode, setLayoutMode] = useState('separated'); // 'separated' | 'combined'
  const [combineIdentical, setCombineIdentical] = useState(true);
  const [ourCopyCount, setOurCopyCount] = useState(1);
  const [otherCopyCount, setOtherCopyCount] = useState(1);
  const [preparedBy, setPreparedBy] = useState('');

  const {
    items: normalizedItems,
    rawCount: rawLineCount,
    hasCombinableDuplicates
  } = useMemo(() => {
    if (!primaryReport) {
      return { items: [], rawCount: 0, hasCombinableDuplicates: false };
    }
    return getConsolidatedPickupItems({
      report: primaryReport,
      reports: effectiveReports,
      allReports,
      catalogProducts,
      combineIdentical
    });
  }, [primaryReport, effectiveReports, allReports, catalogProducts, combineIdentical]);

  useEffect(() => {
    if (!isOpen || !primaryReport) return;
    setCombineIdentical(true);
    setOurCopyCount(1);
    setOtherCopyCount(1);
    const initialItems = getConsolidatedPickupItems({
      report: primaryReport,
      reports: effectiveReports,
      allReports,
      catalogProducts,
      combineIdentical: true
    }).items;
    setLayoutMode(initialItems.length >= 4 ? 'separated' : 'combined');
    const pickupMeta = primaryReport?.ai_document_metadata?.supplier_pickup || {};
    const initialPrepared = String(pickupMeta.processed_by || '')
      .replace(/\s*\([^)]*\)/g, '')
      .trim();
    setPreparedBy(initialPrepared);
  }, [isOpen, primaryReport?.id, primaryReport?.rma_number, effectiveReports.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen || !primaryReport) return null;

  const meta = primaryReport.ai_document_metadata || {};
  const pickup = meta.supplier_pickup || {};
  const outcome = formatFourChoiceOutcome(primaryReport);
  const preparedDateTime = formatDateTimeYmdHm(
    pickup.updated_at ||
    pickup.picked_up_at ||
    meta.simple_rtv_updated_at ||
    new Date()
  );

  const isBatch = effectiveReports.length > 1;
  const rmaNumbersList = effectiveReports
    .map((r) => r.rma_number || r.rmaNumber || String(r.id || ''))
    .filter(Boolean);
  const rmaNumber = primaryReport.rma_number || primaryReport.rmaNumber || primaryReport.id || 'N/A';
  const rmaDisplayHeadline = isBatch
    ? `${effectiveReports.length} Consolidated RMAs (${rmaNumbersList[0]} + ${effectiveReports.length - 1})`
    : rmaNumber;
  const isTest = effectiveReports.some((r) => isTestRecord(r));
  const isCustomerStream = primaryReport.rma_type !== 'supplier_outbound';
  const isSupplierStream = !isCustomerStream;

  const bc = String(primaryReport.barcode || '').trim();
  const skuCode = String(primaryReport.code || primaryReport.sku || '').trim();
  const matchedCatalogProd = (catalogProducts || []).find((p) =>
    (bc && p.barcode && String(p.barcode).trim() === bc) ||
    (skuCode && (String(p.code || '').trim() === skuCode || String(p.sku || '').trim() === skuCode))
  );

  const partyCandidates = isCustomerStream
    ? [
        pickup.customer_name,
        !isPlaceholderSupplier(pickup.supplier_name) ? pickup.supplier_name : '',
        primaryReport.store_branch,
        primaryReport.customer_name,
        primaryReport.reporter_name
      ]
    : [
        pickup.supplier_name,
        primaryReport.supplier_name,
        primaryReport.supplierName,
        primaryReport.supplier,
        matchedCatalogProd?.supplier_name,
        matchedCatalogProd?.supplierName
      ];
  const partyDisplayName = partyCandidates.find((cand) => !isPlaceholderSupplier(cand))
    || (isCustomerStream ? 'Wholesale Customer' : 'Pending Assignment');

  const supplierEmailTo = pickup.supplier_email_to || '';
  const supplierEmailCc = pickup.supplier_email_cc || '';
  const claimNumber = outcome.claimNumber || pickup.claim_number || '';
  const driverName = pickup.driver_name || primaryReport.driver_name || '';
  const driverIdType = pickup.driver_id_type || '';
  const driverLicense = pickup.driver_license_no || '';
  const formattedDriverIdDisplay = driverLicense
    ? (driverIdType ? `${driverIdType}: ${driverLicense}` : driverLicense)
    : (driverIdType ? `${driverIdType}: ___________________` : '__________________________');
  const truckPlate = pickup.truck_plate || '';
  const driveUrl = primaryReport.google_drive_folder_url || pickup.drive_folder_url || '';
  const pickupPhotosStats = getPickupPhotosSummary(pickup.photos);
  const photoSlotCount = pickupPhotosStats.slotCount;
  const photoTotalCount = pickupPhotosStats.totalPhotos;

  const dispositionCode = String(pickup.disposition || meta.simple_rtv_disposition || primaryReport.disposition || '').toLowerCase();
  const isReplacementForm =
    dispositionCode === 'supplier_exchange' ||
    dispositionCode === 'customer_exchange' ||
    outcome.choiceKey === 'replacement';

  const formHeaderTitle = isCustomerStream
    ? (isReplacementForm
      ? 'CUSTOMER BUFFER REPLACEMENT & HANDOVER FORM'
      : 'CUSTOMER CREDIT MEMO / RETURN HANDOVER FORM')
    : (isReplacementForm
      ? 'SUPPLIER REPLACEMENT / EXCHANGE & PICKUP FORM'
      : 'SUPPLIER DEBIT CLAIM & PICKUP VALIDATION FORM');

  const claimPurposeLabel = isCustomerStream
    ? (isReplacementForm
      ? '1-to-1 Buffer Replacement / Good Stock Exchange with Customer'
      : 'Customer Return Accepted for Credit Memo / Account Deduction')
    : (isReplacementForm
      ? 'Return to Supplier for Replacement / Exchange'
      : 'Return to Supplier for Debit Claim / AP Deduction');

  const refLineLabel = isCustomerStream
    ? (isReplacementForm ? `Buffer Ref #: ${claimNumber || rmaNumber}` : `Ref / CM #: ${claimNumber || rmaNumber}`)
    : (isReplacementForm ? `Replacement Ref #: ${claimNumber || rmaNumber}` : `Claim #: ${claimNumber || rmaNumber}`);

  const modalTitleLabel = isCustomerStream
    ? (isReplacementForm ? 'Customer Buffer Replacement Form' : 'Customer Credit Return Handover Form')
    : (isReplacementForm ? 'Replacement & Pickup Form' : 'Debit Claim & Pickup Form');

  const grandTotalPieces = normalizedItems.reduce((sum, it) => sum + it.totalPieces, 0);
  const grandTotalValue = normalizedItems.reduce((sum, it) => sum + it.lineTotal, 0);

  const copiesList = buildPickupFormCopiesList({
    ourCopyCount,
    otherCopyCount,
    isCustomerStream
  });
  const totalCopiesCount = copiesList.length;

  const canUseCombinedOnePage =
    layoutMode === 'combined' &&
    ourCopyCount === 1 &&
    otherCopyCount === 1 &&
    totalCopiesCount === 2;
  const isCompactMode = canUseCombinedOnePage;
  const showCombinedOverflowWarning =
    canUseCombinedOnePage &&
    (normalizedItems.length >= 4 || isBatch);

  const handleApplyCopyPreset = (ours, others) => {
    setOurCopyCount(ours);
    setOtherCopyCount(others);
    if (ours + others !== 2 || ours !== 1 || others !== 1 || normalizedItems.length >= 4) {
      setLayoutMode('separated');
    }
  };

  const handlePrintLetter = () => {
    if (totalCopiesCount === 0) return;

    const docSlug = isCustomerStream
      ? (isReplacementForm ? 'Customer-Buffer-Replacement-Form' : 'Customer-Credit-Handover-Form')
      : (isReplacementForm ? 'RMA-Replacement-Pickup' : 'RMA-Debit-Claim-Pickup');

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
          display: block !important;
          width: 7.7in !important;
          max-width: 7.7in !important;
          margin: 0 auto !important;
          padding: 0 !important;
          background: #ffffff !important;
          color: #000000 !important;
          border: none !important;
          box-shadow: none !important;
          height: auto !important;
          max-height: none !important;
          overflow: visible !important;
        }
        .pickup-copy-full {
          display: block !important;
          width: 100% !important;
          height: auto !important;
          max-height: none !important;
          padding: 0.22in !important;
          border: 1.5px solid #000000 !important;
          background: #ffffff !important;
          color: #000000 !important;
          overflow: visible !important;
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
          padding: 0 !important;
          border: none !important;
          display: block !important;
        }
      }
    `;

    printIsolatedElement({
      elementId: 'letter-supplier-pickup-form',
      documentTitle: `${docSlug}-${claimNumber || rmaNumber} ${formatSaveFileTimestamp(new Date())}`,
      pageSize: 'letter portrait',
      pageMargin: isCompactMode ? '0' : '0.4in',
      allowMultiPage: !isCompactMode,
      customStyles: `
        #letter-supplier-pickup-form, #letter-supplier-pickup-form * {
          color: #000000 !important;
          background-color: #ffffff !important;
          box-shadow: none !important;
        }
        ${isCompactMode ? compactStyles : fullPageStyles}
      `
    });
  };

  const renderFormCopy = (copyTitle, layoutClass, keyPrefix = 'copy') => (
    <div
      key={keyPrefix}
      className={`${layoutClass} bg-white border-[1.5px] border-black text-black ${
        isCompactMode ? 'p-3 space-y-1.5 text-[9.5px]' : 'p-4 space-y-3 text-[11px]'
      }`}
    >
      {/* Top Header Strip — Pure B&W Outline */}
      <div className="flex items-start justify-between gap-2 pb-1.5 border-b-[1.5px] border-black bg-white text-black">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="px-2 py-0.5 border-[1.5px] border-black bg-white text-black font-black uppercase tracking-wider text-[8.5px]">
              {copyTitle}
            </span>
            {isBatch && (
              <span className="px-2 py-0.5 border-[1.5px] border-black bg-white text-black font-black uppercase tracking-wider text-[8.5px]">
                BATCH ({effectiveReports.length} RMAs)
              </span>
            )}
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
            {isBatch ? `Batch (${effectiveReports.length} RMAs)` : `RMA #: ${rmaNumber}`}
          </div>
          <div className="text-[8.5px] text-black font-semibold">
            {outcome.formattedTime ? `${outcome.formattedTime} • ` : ''}
            {photoTotalCount > 0 && photoTotalCount !== photoSlotCount
              ? `${photoSlotCount}/5 Cats (${photoTotalCount} Photos) Verified`
              : `${photoSlotCount}/5 Drive Photos Verified`}
          </div>
        </div>
      </div>

      {/* Party (Customer / Store Branch OR Supplier), Driver, & Handwritten Fields — Pure B&W Box */}
      <div className={`grid grid-cols-12 gap-x-3 gap-y-1 border border-black bg-white text-black ${isCompactMode ? 'p-1.5' : 'p-2.5'}`}>
        <div className="col-span-6">
          <span className="text-[8px] font-bold uppercase text-black block">
            {isCustomerStream ? 'Customer / Store Branch Name' : 'Supplier Company Name'}
          </span>
          <span className={`font-black text-black break-words ${isCompactMode ? 'text-[10.5px]' : 'text-xs'}`}>
            {partyDisplayName}
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
          <span className="text-[8px] font-bold uppercase text-black block">Driver / Representative Name</span>
          <span className="font-bold text-black">
            {driverName || '_______________________________'}
          </span>
        </div>
        <div className="col-span-6">
          <span className="text-[8px] font-bold uppercase text-black block">Valid PH Gov&apos;t / Legal ID #</span>
          <span className="font-mono font-bold text-black">
            {formattedDriverIdDisplay}
          </span>
        </div>
        {/* Handwritten blank lines for physical handover */}
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

      {/* Itemized Table — Pure B&W Outline & Repeating Header Support */}
      <div className="border border-black bg-white text-black">
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
              <tr key={it.idx} className="align-top border-b border-black last:border-b-0 bg-white text-black">
                <td className="py-1 px-1.5 font-mono text-black text-center border-r border-black">{it.idx}</td>
                <td className="py-1 px-1.5 border-r border-black">
                  <div className="font-bold text-black leading-tight">{it.name}</div>
                  <div className="text-[8px] font-mono text-black">SKU: {it.sku}</div>
                  {(isBatch || (Array.isArray(it.rmaNumbers) && it.rmaNumbers.length > 1)) && Array.isArray(it.rmaNumbers) && it.rmaNumbers.length > 0 && (
                    <div className="text-[8px] font-mono font-bold text-black break-words">
                      {it.rmaNumbers.length > 1 ? `RMAs: ${it.rmaNumbers.join(', ')}` : `RMA: ${it.rmaNumbers[0]}`}
                    </div>
                  )}
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

      {/* Signatures & Editable Prepared By Block — Pure B&W */}
      <div className="pickup-signatures-block grid grid-cols-3 gap-2.5 pt-0.5 text-center bg-white text-black">
        <div className={`border border-black bg-white ${isCompactMode ? 'p-1.5' : 'p-2'}`}>
          <div className="text-[8px] font-bold uppercase text-black">
            Prepared By (Logistics / Warehouse)
          </div>
          <input
            type="text"
            value={preparedBy}
            onChange={(e) => setPreparedBy(e.target.value)}
            placeholder="Staff Printed Name"
            className={`w-full text-center font-bold text-black bg-transparent border-0 border-b border-black focus:outline-none print:placeholder-transparent text-[10px] ${
              isCompactMode ? 'mt-3 pb-0.5' : 'mt-5 pb-1'
            }`}
            title="Click to edit Prepared By name"
          />
          <div className="text-[8px] text-black mt-0.5">Printed Name &amp; Date</div>
          <div className="text-[7.5px] font-mono font-bold text-black mt-0.5">
            Prepared Date &amp; Time (YYYY-MM-DD HH:mm): {preparedDateTime}
          </div>
        </div>

        <div className={`border border-black bg-white ${isCompactMode ? 'p-1.5' : 'p-2'}`}>
          <div className="text-[8px] font-bold uppercase text-black">
            {isCustomerStream ? "Customer / Receiving Driver's Signature" : "Supplier Driver's Signature"}
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
                Letter {modalTitleLabel} — {rmaDisplayHeadline}
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-300 truncate">
                8.5&quot; × 11&quot; Letter • Pure B&amp;W Ink-Saver ({totalCopiesCount} Copy Paper{totalCopiesCount === 1 ? '' : 's'}) • {outcome.label}
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

        {/* Non-Printed Page Separation & Customizable Copy Count Control Bar */}
        <div className="shrink-0 px-4 sm:px-6 py-2.5 bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 space-y-2 text-xs print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{outcome.label}</span>
              </span>

              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-black border ${
                  isCompactMode
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700'
                    : 'bg-indigo-50 text-indigo-800 border-indigo-300 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-700'
                }`}
              >
                {isCompactMode
                  ? `Combined 1-Page (${normalizedItems.length} item${normalizedItems.length > 1 ? 's' : ''} • Cut at 50%)`
                  : `Separated Full Pages (${totalCopiesCount} Paper${totalCopiesCount === 1 ? '' : 's'} • Repeating Headers)`}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {(isBatch || rawLineCount > 1) && (
                <button
                  type="button"
                  onClick={() => setCombineIdentical((prev) => !prev)}
                  className={`px-2.5 py-1 rounded-xl text-[11px] font-black border flex items-center gap-1.5 transition-colors cursor-pointer ${
                    combineIdentical
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title="Automatically combine items sharing the exact same SKU, Unit Price, and Expiry Date"
                >
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Auto-Combine Identical Items: {combineIdentical ? 'ON' : 'OFF'}
                    {hasCombinableDuplicates ? (combineIdentical ? ` (${rawLineCount}→${normalizedItems.length})` : ` (${rawLineCount} rows)`) : ''}
                  </span>
                </button>
              )}

              {/* Page Separation Mode Selector */}
              <div className="inline-flex rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 p-0.5 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setLayoutMode('separated')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-black transition-colors cursor-pointer ${
                    !isCompactMode
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title="Dedicated full US Letter sheet per copy with repeating headers & zero clipping"
                >
                  Separated Full Pages (Dedicated Paper per Copy)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOurCopyCount(1);
                    setOtherCopyCount(1);
                    setLayoutMode('combined');
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-black transition-colors cursor-pointer ${
                    isCompactMode
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title="Fit 1 Our Company Copy + 1 Counterparty Copy onto 1 cut US Letter sheet"
                >
                  Combined 1-Page (Cut at 50%)
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

          {/* Customizable Copy Count Steppers & Presets */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-200 dark:border-slate-700">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-black uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Paper Copies:
              </span>

              <label className="inline-flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-700 dark:text-slate-200">
                <span>Our Company Copies:</span>
                <input
                  type="number"
                  aria-label="Our Company Copies"
                  min={0}
                  max={10}
                  value={ourCopyCount}
                  onChange={(e) => {
                    const nextVal = clampCopies(e.target.value);
                    setOurCopyCount(nextVal);
                    if (nextVal !== 1 || otherCopyCount !== 1) setLayoutMode('separated');
                  }}
                  className="w-11 text-center font-mono font-black bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded px-1 py-0.5 text-slate-900 dark:text-white"
                />
              </label>

              <label className="inline-flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-700 dark:text-slate-200">
                <span>{isCustomerStream ? 'Customer Copies:' : 'Supplier Copies:'}</span>
                <input
                  type="number"
                  aria-label={isCustomerStream ? 'Customer Copies' : 'Supplier Copies'}
                  min={0}
                  max={10}
                  value={otherCopyCount}
                  onChange={(e) => {
                    const nextVal = clampCopies(e.target.value);
                    setOtherCopyCount(nextVal);
                    if (ourCopyCount !== 1 || nextVal !== 1) setLayoutMode('separated');
                  }}
                  className="w-11 text-center font-mono font-black bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded px-1 py-0.5 text-slate-900 dark:text-white"
                />
              </label>

              <button
                type="button"
                onClick={() => handleApplyCopyPreset(1, 1)}
                className="px-2 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 text-[11px] font-black text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                1 + 1 (2 Papers)
              </button>
              <button
                type="button"
                onClick={() => handleApplyCopyPreset(2, 1)}
                className="px-2 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 text-[11px] font-black text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                2 Ours + 1 Theirs (3 Papers)
              </button>
            </div>

            <span className="text-[11px] font-mono font-black text-slate-700 dark:text-slate-200">
              Total Output: {totalCopiesCount} Cop{totalCopiesCount === 1 ? 'y' : 'ies'}
            </span>
          </div>

          {showCombinedOverflowWarning && (
            <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 text-[11px] font-bold flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                Overflow Risk: {normalizedItems.length} item line(s) may clip inside a half-page 50% cut sheet. Switch to Separated Full Pages to avoid cut text.
              </span>
              <button
                type="button"
                onClick={() => setLayoutMode('separated')}
                className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-black shrink-0 cursor-pointer"
              >
                Use Separated Pages
              </button>
            </div>
          )}

          {totalCopiesCount === 0 && (
            <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 text-[11px] font-bold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>Total copy count is 0. Increase Our Company Copies or {isCustomerStream ? 'Customer' : 'Supplier'} Copies to at least 1 before printing.</span>
            </div>
          )}
        </div>

        {/* Scrollable Letter Sheet Preview */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-3 sm:p-6 bg-slate-200 dark:bg-slate-950 flex justify-center">
          {totalCopiesCount === 0 ? (
            <div className="my-auto p-8 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl text-center space-y-2 max-w-md">
              <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" />
              <p className="text-sm font-black text-slate-900 dark:text-white">No Copies Selected (0 Total Copies)</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Set Our Company Copies or {isCustomerStream ? 'Customer' : 'Supplier'} Copies to 1 or higher above to preview and print.
              </p>
            </div>
          ) : isCompactMode ? (
            <div
              id="letter-supplier-pickup-form"
              className="w-full max-w-[816px] bg-white p-4 sm:p-6 shadow-lg border border-black my-auto flex flex-col justify-between"
            >
              {renderFormCopy(copiesList[0].title, 'pickup-copy-compact', copiesList[0].key)}

              <div className="pickup-cut-line my-3 flex items-center gap-2 text-black">
                <div className="flex-1 border-t-[1.5px] border-dashed border-black" />
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 border border-dashed border-black bg-white text-[8.5px] font-black uppercase tracking-widest text-black shrink-0">
                  <Scissors className="w-3 h-3" />
                  {isCustomerStream
                    ? '✂ Cut Here (50%) — Separate Company & Customer Copies'
                    : '✂ Cut Here (50%) — Separate Company & Supplier Copies'}
                </span>
                <div className="flex-1 border-t-[1.5px] border-dashed border-black" />
              </div>

              {renderFormCopy(copiesList[1].title, 'pickup-copy-compact', copiesList[1].key)}
            </div>
          ) : (
            <div
              id="letter-supplier-pickup-form"
              className="w-full max-w-[816px] bg-white p-4 sm:p-6 shadow-lg border border-black my-auto space-y-6"
            >
              {copiesList.map((cp, idx) => (
                <React.Fragment key={cp.key}>
                  {idx > 0 && (
                    <div className="pickup-copy-break border-t-2 border-dotted border-black pt-2 text-center text-[10px] font-bold uppercase tracking-widest text-black print:hidden">
                      — Page Break Before {cp.title} —
                    </div>
                  )}
                  {renderFormCopy(cp.title, 'pickup-copy-full', cp.key)}
                </React.Fragment>
              ))}
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
              disabled={totalCopiesCount === 0}
              onClick={handlePrintLetter}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 dark:text-slate-900 text-white text-xs sm:text-sm font-black rounded-xl transition-colors flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Printer className="w-4 h-4" />
              <span>
                {isCompactMode
                  ? 'Print Letter Dual-Copy Form'
                  : `Print Separated Letter Copies (${totalCopiesCount})`}
              </span>
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
