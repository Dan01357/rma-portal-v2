import React, { useState, useEffect } from 'react';
import {
  X, DollarSign, RefreshCw, Trash2, PackageCheck, Camera, Upload,
  Printer, CheckCircle2, Loader2, AlertCircle, Truck, Sparkles, UserCheck
} from 'lucide-react';
import { catalogService } from '../services/catalogService';
import { formatQuantityWithPackSize } from '../utils/rmaHelpers';
import { printIsolatedElement } from '../utils/printIsolatedElement';

const PHOTO_SLOTS = [
  { key: 'license_front', label: "1. Driver's License / ID (FRONT)", hint: 'AI reads Driver Name & License #', ocr: true },
  { key: 'license_back', label: "2. Driver's License / ID (BACK)", hint: 'Back side of Driver ID' },
  { key: 'truck_plate', label: '3. Delivery Truck License Plate #', hint: 'Clear photo of truck plate' },
  { key: 'driver_staff', label: '4. Driver & Staff Handover', hint: 'Driver or coworker handing over item' },
  { key: 'items_photo', label: '5. Damaged Item(s) for Pickup', hint: 'Items with RMA sticker attached' },
];

export default function SupplierRtvSimpleModal({
  isOpen,
  onClose,
  rmaNumber,
  initialReport = null,
  currentUser = null,
  gateSession = null,
  onCompleted = () => {}
}) {
  const [report, setReport] = useState(initialReport);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [step, setStep] = useState(1); // 1: Choose 1 of 4 options, 2: Photos + A4 Form
  const [selectedAction, setSelectedAction] = useState(null); // 'debit_claim' | 'exchange' | 'scrap' | 'restock'

  // Supplier Name (if Pending Assignment)
  const [supplierName, setSupplierName] = useState('');

  // Pickup Evidence State
  const [photos, setPhotos] = useState({}); // { key: { url, preview, uploading, error } }
  const [driverName, setDriverName] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [truckPlate, setTruckPlate] = useState('');
  const [ocrStatus, setOcrStatus] = useState(null);

  useEffect(() => {
    if (!isOpen || !rmaNumber) return;
    setErrorMsg(null);
    setStep(1);
    setSelectedAction(null);
    setPhotos({});
    setOcrStatus(null);

    const load = async () => {
      if (initialReport && initialReport.rma_number === rmaNumber) {
        setReport(initialReport);
        const sup = initialReport.supplier_name || '';
        setSupplierName(sup && !/pending/i.test(sup) ? sup : '');
        return;
      }
      setLoading(true);
      try {
        const res = await catalogService.getReportByRmaNumber(rmaNumber);
        if (res) {
          setReport(res);
          const sup = res.supplier_name || '';
          setSupplierName(sup && !/pending/i.test(sup) ? sup : '');
        } else {
          setErrorMsg(`RMA ${rmaNumber} could not be found.`);
        }
      } catch (err) {
        setErrorMsg(err.message || 'Failed to load RMA.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isOpen, rmaNumber, initialReport]);

  if (!isOpen) return null;

  const isSupplierPending = !report?.supplier_name || /pending/i.test(report.supplier_name);
  const effectiveSupplier = (supplierName || report?.supplier_name || '').trim();

  // Manifest items & Case-to-Piece conversion
  const lineItems = (Array.isArray(report?.items) && report.items.length > 0)
    ? report.items
    : (report ? [report] : []);

  const computedItems = lineItems.map((it) => {
    const qty = Number(it.quantity || it.qty || 1);
    const unit = String(it.unit_name || it.unit || 'pc').trim().toLowerCase();
    const pcsPerCase = Number(it.pieces_per_case || it.piecesPerCase || report?.pieces_per_case || 0);
    const isCase = (unit === 'case' || unit === 'cases' || unit === 'cs') && pcsPerCase > 0;
    const totalPieces = isCase ? qty * pcsPerCase : qty;
    const unitPrice = Number(it.price_with_vat || it.price || 0);
    const lineTotal = unitPrice * totalPieces;
    return {
      name: it.name || it.product_name || 'Item',
      sku: it.code || it.barcode || 'N/A',
      qtyDisplay: formatQuantityWithPackSize(qty, unit, pcsPerCase),
      totalPieces,
      unitPrice,
      lineTotal
    };
  });

  const grandTotal = computedItems.reduce((sum, it) => sum + it.lineTotal, 0);

  const handleChooseOption = async (optionKey) => {
    setErrorMsg(null);
    if (!effectiveSupplier || /pending/i.test(effectiveSupplier)) {
      setErrorMsg('Please enter the Supplier Company Name first.');
      return;
    }

    if (optionKey === 'debit_claim' || optionKey === 'exchange') {
      setSelectedAction(optionKey);
      setStep(2);
      return;
    }

    // Immediate save for Scrap or Restock (no driver pickup needed)
    setSaving(true);
    try {
      const isScrap = optionKey === 'scrap';
      const existingMeta = (report?.ai_document_metadata && typeof report.ai_document_metadata === 'object')
        ? { ...report.ai_document_metadata }
        : {};
      await catalogService.updateReport(report.id, {
        supplier_name: effectiveSupplier,
        disposition: isScrap ? 'Scrap / Dispose' : 'Restock to Inventory',
        status: isScrap ? 'scrapped' : 'restocked',
        warehouse_location: isScrap ? 'Disposal / Scrap Area' : 'Good Stock Area',
        ai_document_metadata: {
          ...existingMeta,
          simple_rtv_action: optionKey,
          workflow_resolution: isScrap ? 'scrapped_no_reorder' : 'restocked',
          updated_by_staff: gateSession?.authorized_email || currentUser?.email || 'Warehouse Staff',
          updated_at: new Date().toISOString()
        }
      });
      onCompleted({ rmaNumber, action: optionKey });
      onClose();
    } catch (err) {
      setErrorMsg(err.message || 'Failed to save decision.');
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (slotKey, file, runOcr = false) => {
    if (!file) return;
    setErrorMsg(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64Data = ev.target.result;
      setPhotos((prev) => ({
        ...prev,
        [slotKey]: { preview: base64Data, uploading: true, url: null }
      }));

      try {
        // 1. Upload to this RMA's Google Drive folder
        const upRes = await fetch('/api/upload-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileData: base64Data,
            fileName: `${rmaNumber}_${slotKey}_${Date.now()}.jpg`,
            mimeType: file.type || 'image/jpeg',
            rmaNumber,
            category: `supplier_pickup_${slotKey}`
          })
        });
        const upJson = await upRes.json();
        const uploadedUrl = upJson.url || upJson.previewUrl || upJson.webViewLink || base64Data;

        setPhotos((prev) => ({
          ...prev,
          [slotKey]: { preview: base64Data, uploading: false, url: uploadedUrl }
        }));

        // 2. If Driver's License Front, run Gemini OCR
        if (runOcr) {
          setOcrStatus('Reading Driver License...');
          const ocrRes = await fetch('/api/upload-photo?action=inspect-license', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileData: base64Data, mimeType: file.type || 'image/jpeg' })
          });
          const ocrJson = await ocrRes.json();
          if (ocrJson.driver_name) setDriverName(ocrJson.driver_name);
          if (ocrJson.license_number) setLicenseNumber(ocrJson.license_number);
          setOcrStatus(
            ocrJson.driver_name
              ? `Auto-filled: ${ocrJson.driver_name} (${ocrJson.license_number || 'ID read'})`
              : 'Could not read ID clearly — please type Driver Name & License # below.'
          );
        }
      } catch (err) {
        setPhotos((prev) => ({
          ...prev,
          [slotKey]: { preview: base64Data, uploading: false, url: base64Data }
        }));
      }
    };
    reader.readAsDataURL(file);
  };

  const allPhotosUploaded = PHOTO_SLOTS.every((s) => Boolean(photos[s.key]?.url || photos[s.key]?.preview));

  const handlePrintAndMarkPickedUp = async () => {
    setErrorMsg(null);
    if (!allPhotosUploaded) {
      setErrorMsg('Please upload all 5 required pickup photos before printing.');
      return;
    }
    if (!driverName.trim() || !licenseNumber.trim() || !truckPlate.trim()) {
      setErrorMsg('Please confirm Driver Name, License #, and Truck Plate #.');
      return;
    }

    setSaving(true);
    try {
      const existingMeta = (report?.ai_document_metadata && typeof report.ai_document_metadata === 'object')
        ? { ...report.ai_document_metadata }
        : {};
      const dispLabel = selectedAction === 'debit_claim'
        ? 'Return to supplier for Debit Claim'
        : 'Exchange / Replace with Supplier';

      await catalogService.updateReport(report.id, {
        supplier_name: effectiveSupplier,
        disposition: dispLabel,
        status: 'picked_up',
        warehouse_location: 'Supplier Return Area (RTV)',
        ai_document_metadata: {
          ...existingMeta,
          simple_rtv_action: selectedAction,
          supplier_pickup: {
            picked_up_at: new Date().toISOString(),
            driver_name: driverName.trim(),
            license_number: licenseNumber.trim(),
            truck_plate: truckPlate.trim().toUpperCase(),
            handled_by: gateSession?.authorized_email || currentUser?.email || 'Warehouse Staff',
            photos: Object.fromEntries(Object.entries(photos).map(([k, v]) => [k, v.url]))
          }
        }
      });

      printIsolatedElement({
        elementId: 'supplier-rtv-a4-dual-form',
        documentTitle: `Supplier-Pickup-Form-${rmaNumber}`,
        pageSize: 'A4 portrait',
        pageMargin: '0.2in'
      });

      onCompleted({ rmaNumber, action: selectedAction, status: 'picked_up' });
    } catch (err) {
      setErrorMsg(err.message || 'Failed to save pickup record.');
    } finally {
      setSaving(false);
    }
  };

  const renderCopyHalf = (copyTitle) => (
    <div className="border-2 border-slate-900 rounded-lg p-3 bg-white text-slate-900 text-[10px] space-y-2">
      <div className="flex items-center justify-between border-b-2 border-slate-900 pb-1.5">
        <div>
          <div className="font-black text-xs uppercase tracking-wider">PINGCON WHOLESALE — SUPPLIER PICKUP SLIP</div>
          <div className="font-bold text-[10px] text-slate-700">
            Purpose: {selectedAction === 'debit_claim' ? 'Return to supplier for Debit Claim' : 'Exchange / Replace with Good Stock'}
          </div>
        </div>
        <div className="text-right">
          <span className="px-2 py-0.5 bg-slate-900 text-white font-black text-[9px] uppercase rounded">{copyTitle}</span>
          <div className="font-mono font-black text-xs mt-0.5">{rmaNumber}</div>
        </div>
      </div>

      <div className="flex justify-between font-bold text-[10px]">
        <span>Supplier: <strong>{effectiveSupplier}</strong></span>
        <span>Driver: <strong>{driverName || '________________'}</strong> | Lic#: <strong>{licenseNumber || '____________'}</strong> | Plate: <strong>{truckPlate || '________'}</strong></span>
      </div>

      <table className="w-full border-collapse border border-slate-400 text-[9px]">
        <thead>
          <tr className="bg-slate-100">
            <th className="border border-slate-400 p-1 text-left">Item</th>
            <th className="border border-slate-400 p-1 text-left">Qty (Converted to Pcs)</th>
            <th className="border border-slate-400 p-1 text-right">Unit Price</th>
            <th className="border border-slate-400 p-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {computedItems.map((it, i) => (
            <tr key={i}>
              <td className="border border-slate-400 p-1 font-bold">{it.name}</td>
              <td className="border border-slate-400 p-1">{it.qtyDisplay} ({it.totalPieces} pcs)</td>
              <td className="border border-slate-400 p-1 text-right">₱{it.unitPrice.toFixed(2)}</td>
              <td className="border border-slate-400 p-1 text-right font-bold">₱{it.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
          <tr className="bg-slate-100 font-black">
            <td colSpan={3} className="border border-slate-400 p-1 text-right">GRAND TOTAL RMA VALUE:</td>
            <td className="border border-slate-400 p-1 text-right">₱{grandTotal.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>

      <div className="grid grid-cols-2 gap-3 pt-2 text-[9px] font-bold">
        <div>Pickup Date & Time: _________________________</div>
        <div>Driver Contact #: ___________________________</div>
        <div className="pt-3">Driver Signature: ___________________________</div>
        <div className="pt-3">Staff Name & Signature: ____________________</div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[120] bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Supplier RTV — Simple Action</span>
            <h2 className="text-base sm:text-lg font-black font-mono">{rmaNumber}</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-800 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {loading ? (
            <div className="py-12 flex flex-col items-center gap-2 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              <span className="text-sm font-bold">Loading RMA details...</span>
            </div>
          ) : (
            <>
              {errorMsg && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 rounded-2xl text-xs font-bold text-rose-700 dark:text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Item & Supplier Summary */}
              <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {computedItems.map((it, idx) => (
                    <div key={idx}>{it.name} — <span className="text-blue-600">{it.qtyDisplay}</span></div>
                  ))}
                </div>
                {isSupplierPending ? (
                  <div>
                    <label className="block text-[11px] font-black text-amber-700 dark:text-amber-400 mb-1">
                      Supplier Name (Pending — Please Enter):
                    </label>
                    <input
                      type="text"
                      value={supplierName}
                      onChange={(e) => setSupplierName(e.target.value)}
                      placeholder="e.g. Century Pacific Food Inc."
                      className="w-full px-3 py-2 rounded-xl border-2 border-amber-400 bg-white dark:bg-slate-900 text-xs font-bold"
                    />
                  </div>
                ) : (
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    Supplier: <strong className="text-slate-900 dark:text-white">{effectiveSupplier}</strong>
                  </div>
                )}
              </div>

              {step === 1 ? (
                <div className="space-y-3">
                  <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-white">
                    What do you want to do with this item?
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleChooseOption('debit_claim')}
                      className="p-4 rounded-2xl border-2 border-emerald-500/40 bg-emerald-50/70 hover:bg-emerald-100 dark:bg-emerald-950/30 text-left space-y-1 cursor-pointer transition-all"
                    >
                      <div className="flex items-center gap-2 font-black text-sm text-emerald-800 dark:text-emerald-300">
                        <DollarSign className="w-5 h-5" /> Get Money Back / Deduct Next Order
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400">Return to supplier for Debit Claim</p>
                    </button>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleChooseOption('exchange')}
                      className="p-4 rounded-2xl border-2 border-blue-500/40 bg-blue-50/70 hover:bg-blue-100 dark:bg-blue-950/30 text-left space-y-1 cursor-pointer transition-all"
                    >
                      <div className="flex items-center gap-2 font-black text-sm text-blue-800 dark:text-blue-300">
                        <RefreshCw className="w-5 h-5" /> Swap / Replace with Good Stock
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400">Driver picks up & replaces items</p>
                    </button>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleChooseOption('scrap')}
                      className="p-4 rounded-2xl border-2 border-rose-500/40 bg-rose-50/70 hover:bg-rose-100 dark:bg-rose-950/30 text-left space-y-1 cursor-pointer transition-all"
                    >
                      <div className="flex items-center gap-2 font-black text-sm text-rose-800 dark:text-rose-300">
                        <Trash2 className="w-5 h-5" /> Throw Away / Dispose (Scrap)
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400">Item is ruined — dispose immediately</p>
                    </button>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleChooseOption('restock')}
                      className="p-4 rounded-2xl border-2 border-teal-500/40 bg-teal-50/70 hover:bg-teal-100 dark:bg-teal-950/30 text-left space-y-1 cursor-pointer transition-all"
                    >
                      <div className="flex items-center gap-2 font-black text-sm text-teal-800 dark:text-teal-300">
                        <PackageCheck className="w-5 h-5" /> Put Back in Good Stock
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400">Item is fine — restock to shelf</p>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                      <Truck className="w-4 h-4 text-blue-600" />
                      Upload 5 Required Pickup Photos (Saved to RMA Drive Folder)
                    </h3>
                    <button onClick={() => setStep(1)} className="text-xs font-bold text-blue-600 hover:underline cursor-pointer">
                      ← Change Choice
                    </button>
                  </div>

                  {ocrStatus && (
                    <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs font-bold text-blue-800 dark:text-blue-300 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 shrink-0" />
                      <span>{ocrStatus}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {PHOTO_SLOTS.map((slot) => {
                      const p = photos[slot.key];
                      return (
                        <label
                          key={slot.key}
                          className={`p-3 rounded-2xl border-2 border-dashed flex items-center gap-3 cursor-pointer transition-colors ${
                            p?.url || p?.preview
                              ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20'
                              : 'border-slate-300 dark:border-slate-700 hover:border-blue-500'
                          }`}
                        >
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            onChange={(e) => handlePhotoUpload(slot.key, e.target.files?.[0], slot.ocr)}
                          />
                          {p?.uploading ? (
                            <Loader2 className="w-6 h-6 animate-spin text-blue-600 shrink-0" />
                          ) : p?.preview ? (
                            <img src={p.preview} alt={slot.label} className="w-10 h-10 rounded-lg object-cover shrink-0 border" />
                          ) : (
                            <Camera className="w-6 h-6 text-slate-400 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="text-xs font-black text-slate-800 dark:text-slate-200 truncate">{slot.label}</div>
                            <div className="text-[10px] text-slate-500">{p?.url ? '✓ Uploaded to Drive' : slot.hint}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Driver Full Name *</label>
                      <input
                        type="text"
                        value={driverName}
                        onChange={(e) => setDriverName(e.target.value)}
                        placeholder="Auto-filled from ID"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Driver License # *</label>
                      <input
                        type="text"
                        value={licenseNumber}
                        onChange={(e) => setLicenseNumber(e.target.value)}
                        placeholder="Auto-filled from ID"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Truck Plate # *</label>
                      <input
                        type="text"
                        value={truckPlate}
                        onChange={(e) => setTruckPlate(e.target.value)}
                        placeholder="e.g. ABC-1234"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold uppercase"
                      />
                    </div>
                  </div>

                  {/* Hidden/Printable A4 Dual-Copy Form */}
                  <div className="border rounded-2xl p-2 bg-slate-100 dark:bg-slate-800/50">
                    <div className="text-[10px] font-bold text-slate-500 mb-1.5 px-1">
                      A4 Print Preview (2 Copies with Cut Line — Date/Time, Contact & Signatures left blank for wet-ink pen):
                    </div>
                    <div id="supplier-rtv-a4-dual-form" className="space-y-3 bg-white p-2 rounded-xl">
                      {renderCopyHalf('OUR COMPANY COPY (PINGCON)')}
                      <div className="border-t-2 border-dashed border-slate-500 text-center text-[9px] font-black tracking-widest text-slate-600 py-0.5">
                        ✂ — — — — — CUT HERE (TEAR ALONG LINE) — — — — — ✂
                      </div>
                      {renderCopyHalf('SUPPLIER COPY')}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={saving}
                    onClick={handlePrintAndMarkPickedUp}
                    className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-black text-sm rounded-2xl flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                  >
                    {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Printer className="w-5 h-5" />}
                    <span>Generate & Print A4 Pickup Form (Tags as Picked Up)</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

