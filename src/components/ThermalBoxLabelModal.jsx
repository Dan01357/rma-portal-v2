import React, { useRef } from 'react';
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
function SimpleBarcodeSVG({ value, height = 48 }) {
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
        className="w-full max-h-12 overflow-visible"
        preserveAspectRatio="none"
      >
        {bars.map((bar, idx) => (
          <rect key={idx} x={bar.x} y={0} width={bar.width} height={height} fill="#000000" />
        ))}
      </svg>
      <div className="font-mono text-[11px] tracking-widest font-black text-black mt-1">
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
  const createdDate = report?.created_at ? new Date(report.created_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }) : new Date().toLocaleDateString();

  const qrPayload = typeof window !== 'undefined'
    ? `${window.location.origin}/?rma=${encodeURIComponent(rmaNumber)}`
    : rmaNumber;

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
        pageMargin: '0.4in',
        scale: 1.0,
        customStyles: `
          #thermal-label-mount {
            width: 100% !important;
            max-width: 185mm !important;
            box-shadow: none !important;
            margin: auto !important;
          }
        `
      },
      '4x6': {
        pageSize: '4in 6in',
        pageMargin: '0.2in',
        scale: 1.0,
        customStyles: `
          #thermal-label-mount {
            width: 3.4in !important;
            max-width: 3.4in !important;
            box-shadow: none !important;
            margin: auto !important;
          }
        `
      },
      '3x3': {
        pageSize: '3in 3in',
        pageMargin: '0.1in',
        scale: 0.95,
        customStyles: `
          #thermal-label-mount {
            width: 2.75in !important;
            height: 2.75in !important;
            max-width: 2.75in !important;
            box-shadow: none !important;
            margin: auto !important;
            box-sizing: border-box !important;
          }
        `
      },
      '2x2': {
        pageSize: '2in 2in',
        pageMargin: '0.06in',
        scale: 0.88,
        customStyles: `
          #thermal-label-mount {
            width: 1.84in !important;
            height: 1.84in !important;
            max-width: 1.84in !important;
            box-shadow: none !important;
            margin: auto !important;
            box-sizing: border-box !important;
          }
        `
      }
    }[labelSize] || { pageSize: '4in 6in', pageMargin: '0.2in', scale: 1.0, customStyles: '' };

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
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 md:p-8 overflow-y-auto animate-in fade-in duration-150">
      {/* Container */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 max-w-xl w-full my-auto shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-in zoom-in-95">

        {/* Header Bar */}
        <div className="p-5 sm:px-7 bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
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
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 bg-slate-100 dark:bg-slate-950 flex flex-col items-center">

          {/* DYNAMIC THERMAL LABEL CONTAINER (Target of print stylesheet) */}
          <div
            id="thermal-label-mount"
            ref={printAreaRef}
            className={`bg-white text-black border-2 border-black rounded-lg shadow-md font-sans transition-all ${labelSize === '2x2'
                ? 'w-[200px] p-2.5 text-[10px] space-y-2'
                : labelSize === '3x3'
                  ? 'w-[280px] p-3 text-xs space-y-2.5'
                  : labelSize === '4x6'
                    ? 'w-full max-w-[380px] p-4 text-xs space-y-3 min-h-[500px]'
                    : 'w-full max-w-[460px] p-6 text-xs space-y-4'
              }`}
          >
            {/* Top Header */}
            <div className="border-b-2 border-black pb-2 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-black">
                  WHOLESALE REVERSE LOGISTICS
                </div>
                <div className="text-[14px] font-black tracking-tight text-black">
                  RMA INTAKE & TRIAGE LABEL
                </div>
              </div>
              <div className="text-right">
                <span className="inline-block border-2 border-black px-1.5 py-0.5 text-[10px] font-black uppercase bg-black text-white">
                  4x6 INTAKE
                </span>
                <div className="text-[9px] font-bold text-black mt-0.5">{createdDate}</div>
              </div>
            </div>

            {/* 1D Barcode & RMA Number */}
            <div className="text-center py-1 border-b border-black">
              <div className="text-[9px] font-extrabold uppercase tracking-wider text-black mb-1">
                RETURN IDENTIFIER
              </div>
              <SimpleBarcodeSVG value={rmaNumber} height={38} />
              <div className="text-xl font-black tracking-tight font-mono text-black mt-1">
                {rmaNumber}
              </div>
            </div>

            {/* Product & SKU Grid */}
            <div className="grid grid-cols-2 gap-2 border-b-2 border-black pb-2 text-[11px]">
              <div className="border-r border-black pr-2">
                <div className="text-[9px] font-extrabold text-black uppercase">PRODUCT NAME</div>
                <div className="font-extrabold text-black leading-tight text-xs line-clamp-2">
                  {name}
                </div>
                <div className="text-[10px] font-mono text-black mt-1">
                  BC: {barcode}
                </div>
              </div>

              <div className="pl-1">
                <div className="text-[9px] font-extrabold text-black uppercase">ASSIGNED SKU</div>
                <div className="font-mono font-black text-sm text-black truncate">
                  {sku}
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[9px] font-bold">QTY:</span>
                  <span className="font-mono text-base font-black text-black">
                    {quantity} {unit}
                  </span>
                </div>
              </div>
            </div>

            {/* Triage Destination & Condition Grade (High Visibility for Handlers) */}
            <div className="grid grid-cols-2 gap-2 border-b-2 border-black pb-2">
              <div className="bg-black text-white p-2 rounded-xs">
                <div className="text-[8px] font-extrabold uppercase tracking-wider text-slate-300">
                  DISPOSITION ACTION
                </div>
                <div className="text-xs font-black uppercase tracking-tight mt-0.5">
                  {disposition}
                </div>
              </div>

              <div className="border-2 border-black p-1.5 text-center flex flex-col justify-center">
                <div className="text-[8px] font-black uppercase text-black">
                  CONDITION GRADE
                </div>
                <div className="text-xs font-black uppercase text-black mt-0.5">
                  {grade.split(' - ')[0]}
                </div>
              </div>
            </div>

            {/* Warehouse Rack / Slot & QR Code for Instant Scanner Intake */}
            <div className="flex items-center justify-between pt-1">
              <div className="space-y-1">
                <div>
                  <div className="text-[9px] font-extrabold uppercase text-black">STORAGE LOCATION</div>
                  <div className="font-mono font-black text-base text-black bg-slate-100 px-2 py-0.5 border border-black inline-block">
                    {location}
                  </div>
                </div>

                <div className="text-[9px] text-black pt-1">
                  <div>Vendor: <strong>{supplier}</strong></div>
                  <div>Inspector: <strong>{inspectedBy}</strong></div>
                </div>
              </div>

              {/* 2D QR Code */}
              <div className="p-1 border-2 border-black bg-white shrink-0">
                <QRCodeSVG
                  value={JSON.stringify({ rma: rmaNumber, sku, bc: barcode, loc: location })}
                  size={76}
                  level="M"
                />
              </div>
            </div>

            {/* Footer Notice */}
            <div className="border-t border-black pt-1 text-center text-[8px] font-extrabold tracking-wider uppercase text-black">
              * AFFIX FIRMLY TO BULK CRATE / RETURN TOTE *
            </div>
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400 text-center max-w-sm">
            Ready to print on standard <strong>4" x 6" thermal adhesive rolls</strong> or standard letter/A4 warehouse paper.
          </div>
        </div>

        {/* Modal Action Footer */}
        <div className="p-4 sm:px-6 bg-slate-50 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
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
  );
}
