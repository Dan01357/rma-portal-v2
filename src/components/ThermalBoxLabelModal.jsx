import React, { useRef, useState } from 'react';
import {
  Printer,
  X,
  Download,
  CheckCircle2,
  Package,
  MapPin,
  Calendar,
  Building2,
  Tag,
  ShieldCheck,
  AlertTriangle
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../supabaseClient';
import { printIsolatedElement } from '../utils/printIsolatedElement';

/**
 * Generates pseudo-Code128 SVG Barcode pattern based on string input
 */
function SimpleBarcodeSVG({ value, height = 36 }) {
  const cleanVal = String(value || '000000000000').trim();
  // Generate deterministic bar widths from character codes
  const bars = [];
  let currentX = 0;

  // Guard quiet zone
  bars.push({ x: 0, width: 4 });
  currentX += 8;

  for (let i = 0; i < cleanVal.length; i++) {
    const code = cleanVal.charCodeAt(i);
    const w1 = ((code % 3) + 1) * 2;
    const w2 = (((code >> 1) % 2) + 1) * 2;
    const w3 = (((code >> 2) % 3) + 1) * 2;

    bars.push({ x: currentX, width: w1 });
    currentX += w1 + 3;
    bars.push({ x: currentX, width: w2 });
    currentX += w2 + 2;
    bars.push({ x: currentX, width: w3 });
    currentX += w3 + 3;
  }

  // End quiet zone
  bars.push({ x: currentX, width: 4 });
  currentX += 8;

  return (
    <div className="flex flex-col items-center">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${currentX} ${height}`}
        className="w-full max-h-9 overflow-visible"
        preserveAspectRatio="none"
      >
        {bars.map((bar, idx) => (
          <rect key={idx} x={bar.x} y={0} width={bar.width} height={height} fill="#000000" />
        ))}
      </svg>
      <div className="font-mono text-[10px] tracking-widest font-black text-black mt-0.5">
        *{cleanVal}*
      </div>
    </div>
  );
}

export default function ThermalBoxLabelModal({
  isOpen,
  onClose,
  report,
  currentUser
}) {
  const printAreaRef = useRef(null);
  // Dynamic Print Sizing: '4x6' | '3x3' | '2x2' | 'a4'
  const [labelSize, setLabelSize] = useState('4x6');

  if (!isOpen || !report) return null;

  const rmaNumber = report?.rma_number || report?.rmaNumber || 'RMA-PENDING';
  const barcode = report?.barcode || 'N/A';
  const sku = report?.code || report?.sku || 'UNASSIGNED';
  const name = report?.name || report?.productName || 'Returned Merchandise';
  const quantity = report?.quantity || 1;
  const unit = report?.unit_name || report?.unit || 'pc';
  const supplier = report?.supplier_name || report?.supplier || 'Wholesale Distribution';
  const location = report?.warehouse_location || 'DOCK-INTAKE';
  const grade = report?.condition_grade || 'B - Damaged Packaging Only';
  const disposition = report?.disposition || 'Pending Triage';
  const inspectedBy = report?.inspected_by || report?.reported_by || 'Warehouse Dock';
  const reporterName = report?.reporter_name || report?.reported_by || inspectedBy || 'Warehouse Staff';
  const reporterContact = report?.reporter_contact || report?.reporter_phone || report?.phone || (report?.reported_by && report.reported_by.includes('(') ? report.reported_by.replace(/.*\((.*)\).*/, '$1') : '') || 'N/A';
  const storeBranch = report?.store_branch || report?.store || '';
  const manifestItems = Array.isArray(report?.items) ? report.items : [];
  const isManifest = manifestItems.length > 1 || (report?.total_items && report.total_items > 1);
  const totalItems = report?.total_items || (manifestItems.length > 0 ? manifestItems.length : 1);
  const totalQuantity = report?.total_quantity || (manifestItems.length > 0 ? manifestItems.reduce((acc, it) => acc + (Number(it.quantity) || 1), 0) : quantity);
  const createdDateObj = new Date(report?.created_at || Date.now());
  const createdDateTime = createdDateObj.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  const createdDate = createdDateObj.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  const handlePrint = async () => {
    try {
      if (report?.id) {
        const actor = currentUser?.name || 'Warehouse Staff';
        const existingAudit = Array.isArray(report.audit_trail) ? [...report.audit_trail] : [];
        const newEvent = {
          timestamp: new Date().toISOString(),
          stage: 'THERMAL_PRINT',
          actor,
          note: `${labelSize} Thermal Label printed by ${actor}`
        };
        await supabase
          .from('rma_reports')
          .update({ audit_trail: [...existingAudit, newEvent] })
          .eq('id', report.id);
      }
    } catch (e) {
      console.warn('Audit print event notice:', e);
    }

    const sizeConfig = {
      'a4': {
        pageSize: 'A4 portrait',
        pageMargin: '0.25in',
        scale: 1.0,
        customStyles: `
          #thermal-label-mount {
            width: 100% !important;
            max-width: 175mm !important;
            min-height: auto !important;
            border: 2.5px solid #000000 !important;
            border-radius: 8px !important;
            box-shadow: none !important;
            margin: 0 auto !important;
            box-sizing: border-box !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        `
      },
      '4x6': {
        pageSize: '4in 6in',
        pageMargin: '0.08in',
        scale: 0.82,
        customStyles: `
          #thermal-label-mount {
            width: 3.35in !important;
            max-width: 3.35in !important;
            max-height: 5.2in !important;
            border: 2px solid #000000 !important;
            border-radius: 6px !important;
            box-shadow: none !important;
            margin: 0 auto !important;
            box-sizing: border-box !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
            overflow: hidden !important;
          }
          #thermal-label-mount * {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        `
      },
      '3x3': {
        pageSize: '3in 3in',
        pageMargin: '0.06in',
        scale: 0.82,
        customStyles: `
          #thermal-label-mount {
            width: 2.3in !important;
            max-width: 2.3in !important;
            min-height: auto !important;
            border: 2px solid #000000 !important;
            border-radius: 6px !important;
            box-shadow: none !important;
            margin: 0 auto !important;
            box-sizing: border-box !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        `
      },
      '2x2': {
        pageSize: '2in 2in',
        pageMargin: '0.04in',
        scale: 0.70,
        customStyles: `
          #thermal-label-mount {
            width: 1.55in !important;
            max-width: 1.55in !important;
            min-height: auto !important;
            border: 1.5px solid #000000 !important;
            border-radius: 4px !important;
            box-shadow: none !important;
            margin: 0 auto !important;
            box-sizing: border-box !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        `
      }
    }[labelSize] || { pageSize: '4in 6in', pageMargin: '0.1in', scale: 1.0, customStyles: '' };

    printIsolatedElement({
      elementId: 'thermal-label-mount',
      documentTitle: `RMA-Label-${rmaNumber}`,
      pageSize: sizeConfig.pageSize,
      pageMargin: sizeConfig.pageMargin,
      scale: sizeConfig.scale,
      customStyles: sizeConfig.customStyles
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-150">
      {/* Container */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 max-w-lg w-full my-auto shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95">

        {/* Header Bar */}
        <div className="p-4 sm:px-6 bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 flex items-center justify-center font-black text-xs">
              <Printer className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900 dark:text-white">
                Thermal 4x6" RMA Box Label
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Optimized for Zebra / Dymo / Thermal sticker roll printers
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-4 sm:p-6 overflow-y-auto bg-slate-100 dark:bg-slate-950 flex flex-col items-center justify-center">

          {/* DYNAMIC THERMAL LABEL CONTAINER (Target of print stylesheet) */}
          <div
            id="thermal-label-mount"
            ref={printAreaRef}
            className="shrink-0 w-full max-w-[340px] p-3 bg-white text-black border-2 border-black rounded-lg shadow-md font-sans space-y-1.5 select-none"
          >
            {/* Top Header */}
            <div className="border-b-2 border-black pb-1 flex items-center justify-between">
              <div>
                <div className="text-[8.5px] font-black uppercase tracking-widest text-black">
                  WHOLESALE REVERSE LOGISTICS
                </div>
                <div className="text-[12px] font-black tracking-tight text-black">
                  RMA INTAKE & TRIAGE LABEL
                </div>
              </div>
              <div className="text-right">
                <span className="inline-block border border-black px-1 py-0.5 text-[8.5px] font-black uppercase bg-black text-white">
                  4x6 INTAKE
                </span>
                <div className="text-[8.5px] font-bold text-black mt-0.5">{createdDate}</div>
              </div>
            </div>

            {/* 1D Barcode & RMA Number */}
            <div className="text-center py-0.5 border-b border-black">
              <div className="text-[7.5px] font-extrabold uppercase tracking-wider text-black mb-0.5">
                RETURN IDENTIFIER
              </div>
              <SimpleBarcodeSVG value={rmaNumber} height={28} />
              <div className="text-base font-black tracking-tight font-mono text-black mt-0.5">
                {rmaNumber}
              </div>
            </div>

            {/* Product & SKU Grid (Single Item or Batch Manifest) */}
            {isManifest ? (
              <div className="border-b-2 border-black pb-1 text-[9px] space-y-1">
                <div className="flex items-center justify-between font-black border-b border-black pb-0.5">
                  <span className="uppercase text-[8px] bg-black text-white px-1">
                    MANIFEST: {totalItems} ITEMS
                  </span>
                  <span className="font-mono text-[11px] font-black">{totalQuantity} UNITS TOTAL</span>
                </div>
                {storeBranch && (
                  <div className="text-[8.5px] font-bold text-black truncate">
                    STORE: <span className="uppercase">{storeBranch}</span>
                  </div>
                )}
                <div className="space-y-0.5 max-h-20 overflow-hidden text-[8px]">
                  {manifestItems.slice(0, 4).map((it, idx) => (
                    <div key={idx} className="flex justify-between items-center border-b border-dashed border-slate-300 pb-0.5">
                      <span className="truncate pr-1">• {it.name || it.productName || it.barcode}</span>
                      <span className="font-mono font-bold shrink-0">{it.quantity} {it.unit_name || it.unit || 'pc'}</span>
                    </div>
                  ))}
                  {manifestItems.length > 4 && (
                    <div className="text-[7.5px] font-bold text-center italic text-slate-700">
                      + {manifestItems.length - 4} more line items in this manifest
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 border-b-2 border-black pb-1 text-[9.5px]">
                <div className="border-r border-black pr-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[7.5px] font-extrabold text-black uppercase">PRODUCT NAME</div>
                    {storeBranch && (
                      <span className="text-[7px] font-bold text-black truncate">STORE: {storeBranch}</span>
                    )}
                  </div>
                  <div className="font-extrabold text-black leading-snug text-[11px] line-clamp-2">
                    {name}
                  </div>
                  <div className="text-[8.5px] font-mono text-black mt-0.5">
                    BC: {barcode}
                  </div>
                </div>

                <div className="pl-1">
                  <div className="text-[7.5px] font-extrabold text-black uppercase">ASSIGNED SKU</div>
                  <div className="font-mono font-black text-[11px] text-black truncate">
                    {sku}
                  </div>
                  <div className="mt-0.5 flex items-center justify-between">
                    <span className="text-[7.5px] font-bold">QTY:</span>
                    <span className="font-mono text-xs font-black text-black">
                      {quantity} {unit}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Triage Destination & Condition Grade */}
            <div className="grid grid-cols-2 gap-2 border-b-2 border-black pb-1">
              <div className="bg-black text-white p-1 rounded-xs">
                <div className="text-[7px] font-extrabold uppercase tracking-wider text-slate-300">
                  DISPOSITION ACTION
                </div>
                <div className="text-[10px] font-black uppercase tracking-tight mt-0.5 leading-tight">
                  {disposition}
                </div>
              </div>

              <div className="border border-black p-1 text-center flex flex-col justify-center">
                <div className="text-[7px] font-black uppercase text-black">
                  CONDITION GRADE
                </div>
                <div className="text-[10px] font-black uppercase text-black mt-0.5">
                  {grade.split(' - ')[0]}
                </div>
              </div>
            </div>

            {/* Warehouse Rack / Slot & QR Code for Instant Scanner Intake */}
            <div className="flex items-center justify-between pt-0.5">
              <div className="space-y-0.5">
                <div>
                  <div className="text-[7.5px] font-extrabold uppercase text-black">STORAGE LOCATION</div>
                  <div className="font-mono font-black text-xs text-black bg-slate-100 px-1.5 py-0.5 border border-black inline-block">
                    {location}
                  </div>
                </div>

                <div className="text-[8px] text-black space-y-0.5">
                  <div>Vendor: <strong>{supplier}</strong></div>
                  <div>Reported By: <strong>{reporterName}</strong></div>
                  <div>Contact: <strong>{reporterContact}</strong></div>
                  <div>Date & Time: <strong>{createdDateTime}</strong></div>
                </div>
              </div>

              {/* 2D QR Code */}
              <div className="p-0.5 border border-black bg-white shrink-0">
                <QRCodeSVG
                  value={JSON.stringify({
                    rma: rmaNumber,
                    sku,
                    bc: barcode,
                    loc: location,
                    rep: reporterName,
                    contact: reporterContact,
                    time: createdDateTime
                  })}
                  size={54}
                  level="M"
                />
              </div>
            </div>

            {/* Reporter Signature Area for Thermal Label */}
            <div className="border-t-2 border-dashed border-black pt-1 text-[8.5px] space-y-0.5">
              <div className="flex items-center justify-between text-[7.5px] font-black text-black uppercase">
                <span>REPORTER SIGNATURE / SIGN-OFF:</span>
                <span>DATE: ____________</span>
              </div>
              <div className="h-3"></div>
              <div className="border-b border-black w-full"></div>
              <div className="text-[7.5px] text-black font-bold text-center">
                Signed by {reporterName} • Physical Return Handover Acknowledged
              </div>
            </div>

            {/* Footer Notice */}
            <div className="border-t border-black pt-0.5 text-center text-[7px] font-extrabold tracking-wider uppercase text-black">
              * AFFIX FIRMLY TO BULK CRATE / RETURN TOTE *
            </div>
          </div>

        </div>

        {/* Modal Action Footer */}
        <div className="p-4 sm:px-6 bg-slate-50 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Ready to print on standard <strong>4" x 6" thermal adhesive rolls</strong> or warehouse paper.
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              Close
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="px-5 py-2.5 bg-slate-900 hover:bg-black text-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 rounded-xl text-xs font-black flex items-center gap-2 shadow-md transition-all cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Print {labelSize === '4x6' ? '4x6" Box Label' : labelSize === '3x3' ? '3x3" Label' : labelSize === '2x2' ? '2x2" Tag (Unboxed)' : 'A4 Document'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
