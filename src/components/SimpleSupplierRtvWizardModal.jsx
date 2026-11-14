import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X, DollarSign, RefreshCw, Trash2, PackageCheck, Truck, Camera,
  Upload, CheckCircle2, AlertTriangle, Loader2, FileCheck2, Sparkles,
  ArrowLeft, ArrowRight, Building2, UserCheck, Settings2, Clock
} from 'lucide-react';
import { catalogService } from '../services/catalogService';
import {
  extractGoogleDriveFolderId,
  formatQuantityWithPackSize,
  formatManifestBreakdown,
  getReportManifestItems,
  isTestRecord
} from '../utils/rmaHelpers';
import SupplierPickupFormModal from './SupplierPickupFormModal';

const FOUR_OPTIONS = [
  {
    id: 'supplier_credit',
    title: 'Return to supplier for Debit Claim',
    subtitle: 'We return these items to the supplier so we get our money back or lessen our next order balance.',
    badge: 'Money Back / Debit Claim',
    icon: DollarSign,
    accent: 'emerald',
    needsPickupForm: true
  },
  {
    id: 'supplier_exchange',
    title: 'Return to supplier for Replacement / Exchange',
    subtitle: 'The supplier driver picks up the damaged goods and replaces them with good stock.',
    badge: 'Swap / Replace Items',
    icon: RefreshCw,
    accent: 'sky',
    needsPickupForm: true
  },
  {
    id: 'scrap',
    title: 'Throw Away / Dispose (Scrap)',
    subtitle: 'Items cannot be claimed or sold. Dispose at the warehouse Scrap / Disposal Area.',
    badge: 'Dispose / Scrap',
    icon: Trash2,
    accent: 'rose',
    needsPickupForm: false
  },
  {
    id: 'restock_good',
    title: 'Put Back on Good Shelf (Restock)',
    subtitle: 'Items are actually undamaged and safe to sell. Return directly to Good Stock Area.',
    badge: 'Good Stock Restock',
    icon: PackageCheck,
    accent: 'indigo',
    needsPickupForm: false
  }
];

const PICKUP_PHOTO_SLOTS = [
  {
    key: 'driver_license_front',
    category: 'driver_license_front',
    stepNum: 1,
    title: "Driver's License / ID — FRONT",
    hint: 'AI will automatically read the Driver Name & License # from this photo!',
    ocrHighlight: true
  },
  {
    key: 'driver_license_back',
    category: 'driver_license_back',
    stepNum: 2,
    title: "Driver's License / ID — BACK",
    hint: 'Clear photo of the back of the driver ID / license card.',
    ocrHighlight: false
  },
  {
    key: 'truck_plate',
    category: 'truck_license_plate',
    stepNum: 3,
    title: 'Delivery Truck Plate Number',
    hint: 'Photo clearly showing the supplier truck or van plate number.',
    ocrHighlight: false
  },
  {
    key: 'driver_handover',
    category: 'driver_coworker_handover',
    stepNum: 4,
    title: 'Supplier Driver / Co-Worker Photo',
    hint: 'Photo of the supplier driver or staff handling the returned items.',
    ocrHighlight: false
  },
  {
    key: 'pickup_items',
    category: 'delivered_items_pickup',
    stepNum: 5,
    title: 'Damaged Item(s) Picked Up',
    hint: 'Photo showing the actual labeled items handed over for return.',
    ocrHighlight: false
  }
];

function isPendingSupplierName(name) {
  const s = String(name || '').trim().toLowerCase();
  return !s || s === 'pending assignment' || s === 'pending' || s === 'warehouse' || s === 'savemore' || s === 'n/a';
}

export default function SimpleSupplierRtvWizardModal({
  isOpen,
  onClose,
  report,
  allReports = [],
  catalogProducts = [],
  activeUser = null,
  isAdmin = false,
  onSuccess,
  onOpenFullAdminModal,
  initialMode = 'wizard'
}) {
  const [step, setStep] = useState('choose'); // 'choose' | 'pickup' | 'done'
  const [selectedOption, setSelectedOption] = useState(null);
  const [supplierName, setSupplierName] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverLicenseNo, setDriverLicenseNo] = useState('');
  const [truckPlate, setTruckPlate] = useState('');

  // Photo slots: { [slotKey]: { file, previewUrl, existingUrl } }
  const [photoSlots, setPhotoSlots] = useState({});
  const objectUrlsRef = useRef([]);

  const [isScanningId, setIsScanningId] = useState(false);
  const [ocrNotice, setOcrNotice] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [savedReport, setSavedReport] = useState(null);
  const [showA4Form, setShowA4Form] = useState(false);

  // Known suppliers list for autocomplete datalist
  const supplierSuggestions = useMemo(() => {
    const set = new Set();
    catalogProducts.forEach((p) => {
      const s = String(p.supplier_name || p.supplierName || '').trim();
      if (s && !isPendingSupplierName(s)) set.add(s);
    });
    allReports.forEach((r) => {
      const s = String(r.supplier_name || '').trim();
      if (s && !isPendingSupplierName(s)) set.add(s);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [catalogProducts, allReports]);

  // Revoke temporary preview URLs on unmount/reset
  const clearObjectUrls = () => {
    objectUrlsRef.current.forEach((u) => {
      try { URL.revokeObjectURL(u); } catch {}
    });
    objectUrlsRef.current = [];
  };

  useEffect(() => {
    if (!isOpen || !report) return;
    clearObjectUrls();

    const meta = report.ai_document_metadata || {};
    const pickup = meta.supplier_pickup || {};

    const initialSupplier = pickup.supplier_name || report.supplier_name || '';
    setSupplierName(isPendingSupplierName(initialSupplier) ? '' : initialSupplier);

    const existingDisp = String(pickup.disposition || report.disposition || '').toLowerCase();
    const matchedOpt = FOUR_OPTIONS.find((o) => o.id === existingDisp);
    setSelectedOption(matchedOpt ? matchedOpt.id : null);

    setDriverName(pickup.driver_name || report.driver_name || '');
    setDriverLicenseNo(pickup.driver_license_no || '');
    setTruckPlate(pickup.truck_plate || '');

    const savedPhotos = pickup.photos || {};
    const hydratedSlots = {};
    PICKUP_PHOTO_SLOTS.forEach((slot) => {
      const url = savedPhotos[slot.key] || '';
      if (url) {
        hydratedSlots[slot.key] = { file: null, previewUrl: url, existingUrl: url };
      }
    });
    setPhotoSlots(hydratedSlots);

    setErrorMsg('');
    setOcrNotice(null);
    setUploadProgress('');
    setSavedReport(null);

    if (initialMode === 'pickup_form' && report.status === 'picked_up') {
      setShowA4Form(true);
      setStep('done');
    } else {
      setShowA4Form(false);
      setStep('choose');
    }
  }, [isOpen, report?.id, report?.rma_number, initialMode]);

  useEffect(() => () => clearObjectUrls(), []);

  if (!isOpen || !report) return null;

  const activeReport = savedReport || report;
  const rmaNumber = activeReport.rma_number || activeReport.rmaNumber || activeReport.id || 'N/A';
  const isTest = isTestRecord(activeReport);
  const manifestItems = getReportManifestItems(activeReport, allReports);
  const isManifest = manifestItems.length > 1 || Number(activeReport.total_items) > 1;
  const isAlreadyPickedUp = String(activeReport.status || '').toLowerCase() === 'picked_up';
  const supplierMissing = isPendingSupplierName(supplierName);

  const actorName =
    activeUser?.user_name ||
    activeUser?.full_name ||
    activeUser?.name ||
    activeUser?.email ||
    activeUser?.authorized_email ||
    activeUser?.profileName ||
    'Warehouse Staff';

  const handleSelectPhoto = async (slotKey, file) => {
    if (!file) return;
    setErrorMsg('');
    const previewUrl = URL.createObjectURL(file);
    objectUrlsRef.current.push(previewUrl);

    setPhotoSlots((prev) => ({
      ...prev,
      [slotKey]: { file, previewUrl, existingUrl: '' }
    }));

    // Auto-read Driver's License Front with Gemini AI Vision
    if (slotKey === 'driver_license_front') {
      setIsScanningId(true);
      setOcrNotice({ type: 'info', text: 'Reading Driver Name & License # from photo...' });
      try {
        const res = await catalogService.inspectDriverLicense(file);
        if (res?.driver_name) {
          setDriverName((prev) => prev.trim() || res.driver_name.trim());
        }
        if (res?.license_number) {
          setDriverLicenseNo((prev) => prev.trim() || res.license_number.trim());
        }
        if (res?.driver_name || res?.license_number) {
          setOcrNotice({
            type: 'success',
            text: `Auto-filled from ID: ${res.driver_name || 'Name n/a'}${res.license_number ? ` • ID # ${res.license_number}` : ''}`
          });
        } else {
          setOcrNotice({
            type: 'warn',
            text: res?.rejection_reason || 'Photo saved! Could not read ID text clearly — please type Driver Name & License # below.'
          });
        }
      } catch (err) {
        console.warn('License OCR warning:', err);
        setOcrNotice({
          type: 'warn',
          text: 'Photo saved! Auto-read unavailable right now — please type Driver Name & License # below.'
        });
      } finally {
        setIsScanningId(false);
      }
    }
  };

  const handleSaveSimpleDecision = async (optionId, waitOnly = false) => {
    setErrorMsg('');
    const cleanSupplier = supplierName.trim();
    if (!cleanSupplier) {
      setErrorMsg('Please type or choose the Supplier Company Name first.');
      return;
    }

    const opt = FOUR_OPTIONS.find((o) => o.id === optionId);
    if (!opt) return;

    // If Debit Claim or Replacement and staff chose "Driver Is Here Now"
    if (opt.needsPickupForm && !waitOnly) {
      setSelectedOption(optionId);
      setStep('pickup');
      return;
    }

    setIsSaving(true);
    setUploadProgress('Saving your decision...');
    try {
      let nextStatus = 'triaged';
      let nextLocation = 'Supplier Return Zone';
      if (optionId === 'scrap') {
        nextStatus = 'scrapped';
        nextLocation = 'Disposal / Scrap Area';
      } else if (optionId === 'restock_good') {
        nextStatus = 'restocked';
        nextLocation = 'Good Stock Area';
      }

      const updated = await catalogService.saveSimpleSupplierRtvDisposition(activeReport, {
        disposition: optionId,
        status: nextStatus,
        warehouse_location: nextLocation,
        supplier_name: cleanSupplier,
        actorName,
        auditAction: 'SIMPLE_SUPPLIER_RTV_DECISION',
        auditNote: `Staff selected "${opt.title}"${waitOnly ? ' (waiting for supplier driver)' : ''}`,
        metadataPatch: {
          simple_rtv_disposition: optionId,
          simple_rtv_label: opt.title,
          simple_rtv_updated_at: new Date().toISOString(),
          simple_rtv_updated_by: actorName
        }
      });

      setSavedReport(updated);
      setStep('done');
      onSuccess?.(updated);
    } catch (err) {
      console.error('Failed saving Supplier RTV choice:', err);
      setErrorMsg(err?.message || 'Could not save choice. Please try again.');
    } finally {
      setIsSaving(false);
      setUploadProgress('');
    }
  };

  const handleCompletePickupAndGenerateForm = async () => {
    setErrorMsg('');
    const cleanSupplier = supplierName.trim();
    if (!cleanSupplier) {
      setErrorMsg('Please type or select the Supplier Company Name.');
      return;
    }

    const missingSlots = PICKUP_PHOTO_SLOTS.filter((slot) => {
      const s = photoSlots[slot.key];
      return !s || (!s.file && !s.existingUrl);
    });
    if (missingSlots.length > 0) {
      setErrorMsg(`Please upload all 5 required pickup photos (missing: ${missingSlots.map((m) => m.title).join(', ')}).`);
      return;
    }

    if (!driverName.trim()) {
      setErrorMsg("Please enter the Driver's Full Name (from their license).");
      return;
    }
    if (!truckPlate.trim()) {
      setErrorMsg('Please enter the Truck Plate Number.');
      return;
    }

    setIsSaving(true);
    try {
      let currentFolderId = extractGoogleDriveFolderId(
        activeReport.google_drive_folder_id || activeReport.google_drive_folder_url
      );
      let currentFolderUrl = activeReport.google_drive_folder_url || '';

      const uploadedUrlMap = {};
      const newPhotoUrls = [];

      for (let i = 0; i < PICKUP_PHOTO_SLOTS.length; i++) {
        const slot = PICKUP_PHOTO_SLOTS[i];
        const entry = photoSlots[slot.key];

        if (entry?.file) {
          setUploadProgress(`Uploading photo ${i + 1} of 5 to RMA Drive folder (${slot.title})...`);
          const res = await catalogService.uploadPhotoWithDetails(entry.file, rmaNumber, slot.category, {
            targetFolderId: currentFolderId || null,
            driverName: driverName.trim(),
            truckPlate: truckPlate.trim(),
            supplierName: cleanSupplier
          });

          if (!res?.url) {
            throw new Error(`Photo upload failed for "${slot.title}". Please check connection and retry.`);
          }
          uploadedUrlMap[slot.key] = res.url;
          newPhotoUrls.push(res.url);

          if (!currentFolderId && res.rmaFolderId) {
            currentFolderId = res.rmaFolderId;
          }
          if (!currentFolderUrl && res.rmaFolderUrl) {
            currentFolderUrl = res.rmaFolderUrl;
          }
        } else if (entry?.existingUrl) {
          uploadedUrlMap[slot.key] = entry.existingUrl;
        }
      }

      setUploadProgress('Marking RMA as Picked Up & generating A4 validation form...');
      const activeOpt = FOUR_OPTIONS.find((o) => o.id === selectedOption) || FOUR_OPTIONS[0];
      const nowIso = new Date().toISOString();

      const pickupPayload = {
        disposition: activeOpt.id,
        disposition_label: activeOpt.title,
        supplier_name: cleanSupplier,
        driver_name: driverName.trim(),
        driver_license_no: driverLicenseNo.trim(),
        truck_plate: truckPlate.trim().toUpperCase(),
        photos: uploadedUrlMap,
        drive_folder_id: currentFolderId || null,
        drive_folder_url: currentFolderUrl || null,
        picked_up_at: nowIso,
        processed_by: actorName
      };

      const updated = await catalogService.saveSimpleSupplierRtvDisposition(activeReport, {
        disposition: activeOpt.id,
        status: 'picked_up',
        warehouse_location: 'Supplier Return Zone',
        supplier_name: cleanSupplier,
        actorName,
        google_drive_folder_id: currentFolderId || null,
        google_drive_folder_url: currentFolderUrl || null,
        appendPhotoUrls: newPhotoUrls,
        auditAction: 'SUPPLIER_DRIVER_PICKUP_VERIFIED',
        auditNote: `Picked up by ${driverName.trim()} (Plate ${truckPlate.trim().toUpperCase()}) for "${activeOpt.title}" with 5 Drive photos archived.`,
        metadataPatch: {
          simple_rtv_disposition: activeOpt.id,
          simple_rtv_label: activeOpt.title,
          supplier_pickup: pickupPayload
        }
      });

      setSavedReport(updated);
      setStep('done');
      setShowA4Form(true);
      onSuccess?.(updated);
    } catch (err) {
      console.error('Pickup verification failed:', err);
      setErrorMsg(err?.message || 'Failed to upload photos or mark Picked Up. Please try again.');
    } finally {
      setIsSaving(false);
      setUploadProgress('');
    }
  };

  const completedPhotoCount = PICKUP_PHOTO_SLOTS.filter((s) => photoSlots[s.key]?.previewUrl).length;
  const chosenOptionObj = FOUR_OPTIONS.find((o) => o.id === selectedOption);

  return (
    <>
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-2 sm:p-4 bg-slate-900/75 backdrop-blur-sm animate-fadeIn">
        <div className="bg-white dark:bg-slate-900 w-full max-w-3xl max-h-[94dvh] flex flex-col rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">

          {/* Modal Header */}
          <div className={`shrink-0 px-4 sm:px-6 py-3.5 text-white flex items-center justify-between border-b ${
            isTest ? 'bg-amber-900 border-amber-800' : 'bg-slate-900 border-slate-800'
          }`}>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-black text-base sm:text-lg tracking-tight">
                  {rmaNumber}
                </span>
                {isTest ? (
                  <span className="px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[10px] font-black uppercase tracking-wider">
                    🧪 Test Mode
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[10px] font-bold uppercase tracking-wider">
                    Supplier RTV
                  </span>
                )}
                {isAlreadyPickedUp && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                    <Truck className="w-3 h-3" /> Picked Up
                  </span>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-slate-300 truncate mt-0.5">
                {step === 'choose'
                  ? 'Step 1 of 2: Choose what to do with this item'
                  : step === 'pickup'
                    ? 'Step 2 of 2: Upload 5 Driver Pickup Photos & Generate A4 Form'
                    : 'Action Saved — Ready for Warehouse & Supplier Records'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable Body */}
          <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-5">

            {/* Already Picked Up Banner -> Instant A4 Re-print */}
            {isAlreadyPickedUp && step !== 'pickup' && (
              <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 text-emerald-900 dark:text-emerald-200 text-xs sm:text-sm font-semibold">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span>
                    Already <strong>Picked Up</strong> by supplier driver. You can view or re-print the A4 2-copy form anytime.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowA4Form(true)}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black flex items-center gap-1.5 shadow-sm"
                >
                  <FileCheck2 className="w-4 h-4" />
                  View / Print A4 Pickup Form
                </button>
              </div>
            )}

            {/* Item Summary Card */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Reported Product / Contents
                </div>
                <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                  {isManifest
                    ? `Batch Manifest (${manifestItems.length} SKUs) — ${activeReport.name || rmaNumber}`
                    : (activeReport.name || activeReport.product_name || activeReport.barcode)}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300 font-mono mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>
                    Qty:{' '}
                    <strong>
                      {isManifest
                        ? formatManifestBreakdown(manifestItems, false)
                        : formatQuantityWithPackSize(activeReport.quantity || 1, activeReport.unit_name || 'pc', activeReport.pieces_per_case)}
                    </strong>
                  </span>
                  {(activeReport.expiry_date || activeReport.ai_document_metadata?.expiry_date) && (
                    <span className="text-amber-700 dark:text-amber-400 font-bold">
                      EXP: {activeReport.expiry_date || activeReport.ai_document_metadata?.expiry_date}
                    </span>
                  )}
                </div>
              </div>
              {isAdmin && onOpenFullAdminModal && (
                <button
                  type="button"
                  onClick={() => onOpenFullAdminModal(activeReport)}
                  className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:border-slate-500 flex items-center gap-1"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  Full Admin View
                </button>
              )}
            </div>

            {/* Required Inline Supplier Name Field (if missing/pending or needing edit) */}
            <div className={`p-4 rounded-xl border-2 transition-colors ${
              supplierMissing
                ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-400 dark:border-amber-600'
                : 'bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700'
            }`}>
              <label className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-1.5">
                <Building2 className={`w-4 h-4 ${supplierMissing ? 'text-amber-600' : 'text-slate-500'}`} />
                Supplier Company Name *
                {supplierMissing && (
                  <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 text-[10px]">
                    Required — Pending Name
                  </span>
                )}
              </label>
              <input
                type="text"
                list="supplier-rtv-company-list"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="Type or pick the Supplier Company Name (e.g. Century Pacific Food, Nestle)..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
              />
              <datalist id="supplier-rtv-company-list">
                {supplierSuggestions.map((sup) => (
                  <option key={sup} value={sup} />
                ))}
              </datalist>
            </div>

            {/* Error Alert */}
            {errorMsg && (
              <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 text-xs sm:text-sm font-semibold flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* STEP 1: 4 Simple Choices */}
            {step === 'choose' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                    What do you want to do with this item?
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Tap one of the 4 simple choices below. Everything in the system will update automatically.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {FOUR_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const isSelected = selectedOption === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setSelectedOption(opt.id);
                          setErrorMsg('');
                        }}
                        className={`p-4 rounded-2xl border-2 text-left transition-all flex flex-col justify-between gap-2 ${
                          isSelected
                            ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-950/30 ring-2 ring-amber-400/50 shadow-md'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 hover:border-slate-400 dark:hover:border-slate-500'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className={`p-2 rounded-xl ${
                            isSelected ? 'bg-amber-500 text-slate-950' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                          }`}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            isSelected
                              ? 'bg-amber-500 text-slate-950'
                              : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                          }`}>
                            {opt.badge}
                          </span>
                        </div>
                        <div>
                          <div className="font-black text-sm text-slate-900 dark:text-white leading-snug">
                            {opt.title}
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                            {opt.subtitle}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Action Strip once an Option is Selected */}
                {chosenOptionObj && (
                  <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-3 animate-fadeIn">
                    <div className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                      Selected: {chosenOptionObj.title}
                    </div>

                    {chosenOptionObj.needsPickupForm ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => handleSaveSimpleDecision(chosenOptionObj.id, true)}
                          className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                        >
                          <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                          <span>Save Choice Only (Waiting for Driver)</span>
                        </button>

                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => handleSaveSimpleDecision(chosenOptionObj.id, false)}
                          className="px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs sm:text-sm font-black flex items-center justify-center gap-2 transition-colors shadow-sm disabled:opacity-50"
                        >
                          <Truck className="w-4 h-4 shrink-0" />
                          <span>Driver Is Here — Upload Photos &amp; Print A4 →</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => handleSaveSimpleDecision(chosenOptionObj.id, false)}
                        className="w-full px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-black flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                      >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        {isSaving ? uploadProgress : `Confirm & Save: ${chosenOptionObj.title}`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* STEP 2: 5 Mandatory Photos + AI Driver ID Fill + Generate A4 Form */}
            {step === 'pickup' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                      <Truck className="w-5 h-5 text-amber-600" />
                      Driver Pickup Verification ({completedPhotoCount}/5 Photos)
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Purpose: <strong className="text-slate-800 dark:text-slate-200">{chosenOptionObj?.title}</strong> • All photos auto-save into this RMA&apos;s Google Drive folder.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStep('choose')}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1 shrink-0"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> Back
                  </button>
                </div>

                {/* OCR Status */}
                {ocrNotice && (
                  <div className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                    ocrNotice.type === 'success'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-700 dark:text-emerald-200'
                      : ocrNotice.type === 'warn'
                        ? 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-700 dark:text-amber-200'
                        : 'bg-sky-50 border-sky-200 text-sky-800 dark:bg-sky-950/40 dark:border-sky-700 dark:text-sky-200'
                  }`}>
                    {isScanningId ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : <Sparkles className="w-4 h-4 shrink-0" />}
                    <span>{ocrNotice.text}</span>
                  </div>
                )}

                {/* 5 Photo Checklist Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {PICKUP_PHOTO_SLOTS.map((slot) => {
                    const current = photoSlots[slot.key];
                    const hasImage = Boolean(current?.previewUrl);
                    return (
                      <div
                        key={slot.key}
                        className={`p-3 rounded-xl border-2 transition-colors flex flex-col gap-2.5 ${
                          hasImage
                            ? 'border-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20'
                            : slot.ocrHighlight
                              ? 'border-amber-300 bg-amber-50/30 dark:bg-amber-950/10'
                              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="w-5 h-5 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[10px] font-black flex items-center justify-center shrink-0">
                                {slot.stepNum}
                              </span>
                              <span className="text-xs font-black text-slate-900 dark:text-white">
                                {slot.title} *
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                              {slot.hint}
                            </p>
                          </div>
                          {hasImage && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                        </div>

                        {hasImage && (
                          <div className="relative h-28 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100">
                            <img
                              src={current.previewUrl}
                              alt={slot.title}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 mt-auto">
                          <label className="cursor-pointer px-2.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors">
                            <Camera className="w-3.5 h-3.5" />
                            <span>Take Photo</span>
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="hidden"
                              onChange={(e) => {
                                handleSelectPhoto(slot.key, e.target.files?.[0]);
                                e.target.value = '';
                              }}
                            />
                          </label>

                          <label className="cursor-pointer px-2.5 py-2 rounded-lg bg-white hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors">
                            <Upload className="w-3.5 h-3.5" />
                            <span>Choose File</span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                handleSelectPhoto(slot.key, e.target.files?.[0]);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Auto-filled Driver Info & Truck Plate */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
                    <UserCheck className="w-4 h-4 text-emerald-600" />
                    Driver &amp; Truck Details (Printed on A4 Form)
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                        Driver Full Name *
                      </label>
                      <input
                        type="text"
                        value={driverName}
                        onChange={(e) => setDriverName(e.target.value)}
                        placeholder="Auto-filled or type name"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                        Driver License / ID #
                      </label>
                      <input
                        type="text"
                        value={driverLicenseNo}
                        onChange={(e) => setDriverLicenseNo(e.target.value)}
                        placeholder="Auto-filled from ID photo"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-mono font-bold text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                        Truck Plate Number *
                      </label>
                      <input
                        type="text"
                        value={truckPlate}
                        onChange={(e) => setTruckPlate(e.target.value)}
                        placeholder="e.g. NAA 1234"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-mono font-bold uppercase text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Note: Pickup Date &amp; Time, Driver Contact #, Driver Signature, and Staff Name &amp; Signature stay blank on the printed A4 sheet so both parties can sign &amp; fill physically at handover.
                  </p>
                </div>

                {/* Final Confirm Button */}
                <button
                  type="button"
                  disabled={isSaving || isScanningId}
                  onClick={handleCompletePickupAndGenerateForm}
                  className="w-full px-5 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black flex items-center justify-center gap-2 shadow-md transition-colors disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileCheck2 className="w-5 h-5" />}
                  {isSaving
                    ? (uploadProgress || 'Uploading photos & saving...')
                    : 'Upload 5 Photos to RMA Drive, Mark PICKED UP & Print A4 Form'}
                </button>
              </div>
            )}

            {/* STEP 3: Done Summary */}
            {step === 'done' && (
              <div className="p-6 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-center space-y-4">
                <div className="w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white">
                    {isAlreadyPickedUp
                      ? 'Pickup Photos Archived & RMA Tagged as PICKED UP!'
                      : 'Supplier RTV Decision Saved!'}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1">
                    {isAlreadyPickedUp
                      ? 'Print the 2-copy A4 validation sheet, cut at the center line, and have both the driver and staff sign it.'
                      : 'The RMA record has been updated and is ready for warehouse tracking or driver pickup anytime.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
                  {isAlreadyPickedUp && (
                    <button
                      type="button"
                      onClick={() => setShowA4Form(true)}
                      className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-black flex items-center gap-2"
                    >
                      <FileCheck2 className="w-4 h-4" />
                      Open A4 2-Copy Pickup Form
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setStep('choose')}
                    className="px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 text-xs sm:text-sm font-bold"
                  >
                    Change Decision
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-black flex items-center gap-1"
                  >
                    Done
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Dual-Copy A4 Printable Form Modal */}
      <SupplierPickupFormModal
        isOpen={showA4Form}
        onClose={() => setShowA4Form(false)}
        report={activeReport}
        allReports={allReports}
        catalogProducts={catalogProducts}
      />
    </>
  );
}

