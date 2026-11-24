import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X, DollarSign, RefreshCw, Trash2, PackageCheck, Truck, Camera,
  Upload, CheckCircle2, AlertTriangle, Loader2, FileCheck2, Sparkles,
  ArrowLeft, ArrowRight, Building2, UserCheck, Settings2, Clock, Mail
} from 'lucide-react';
import { catalogService } from '../services/catalogService';
import { supplierClaimService } from '../services/supplierClaimService';
import { notificationService } from '../services/notificationService';
import {
  extractGoogleDriveFolderId,
  formatQuantityWithPackSize,
  formatManifestBreakdown,
  getReportManifestItems,
  getItemNeedsReorder,
  formatFourChoiceOutcome,
  computeItemPiecesAndValue,
  formatPeso,
  getConsolidatedPickupItems,
  isTestRecord,
  formatDateYmd,
  normalizePhotoUrlArray
} from '../utils/rmaHelpers';
import SupplierPickupFormModal from './SupplierPickupFormModal';
import EmailRecipientsEditor from './EmailRecipientsEditor';

function getFourOptions(isSupplierStream) {
  if (isSupplierStream) {
    return [
      {
        id: 'supplier_credit',
        title: 'Return to supplier for Debit Claim',
        subtitle: 'We return these items to the supplier so we get our money back or lessen our next order balance.',
        badge: 'Money Back / Debit Claim',
        icon: DollarSign,
        needsPickupForm: true,
        formType: 'debit'
      },
      {
        id: 'supplier_exchange',
        title: 'Return to supplier for Replacement / Exchange',
        subtitle: 'The supplier driver picks up the damaged goods and replaces them with good stock.',
        badge: 'Swap / Replace Items',
        icon: RefreshCw,
        needsPickupForm: true,
        formType: 'replacement'
      },
      {
        id: 'scrap',
        title: 'Throw Away / Dispose (Scrap)',
        subtitle: 'Items cannot be claimed or sold. Dispose at the warehouse Scrap / Disposal Area.',
        badge: 'Dispose / Scrap',
        icon: Trash2,
        needsPickupForm: false,
        formType: null
      },
      {
        id: 'restock_good',
        title: 'Put Back on Good Shelf (Restock)',
        subtitle: 'Items are actually undamaged and safe to sell. Return directly to Good Stock Area.',
        badge: 'Good Stock Restock',
        icon: PackageCheck,
        needsPickupForm: false,
        formType: null
      }
    ];
  }

  return [
    {
      id: 'customer_credit',
      title: 'Customer Credit Memo / Return Handover',
      subtitle: 'Returned items accepted from customer for Credit Memo or account deduction with verification.',
      badge: 'Credit / Return',
      icon: DollarSign,
      needsPickupForm: true,
      formType: 'debit'
    },
    {
      id: 'customer_exchange',
      title: 'Customer Buffer Replacement / Good Stock Exchange',
      subtitle: 'Returned items swapped / replaced with good buffer stock for customer with handover verification.',
      badge: 'Buffer Replacement',
      icon: RefreshCw,
      needsPickupForm: true,
      formType: 'replacement'
    },
    {
      id: 'scrap',
      title: 'Throw Away / Dispose (Scrap)',
      subtitle: 'Items cannot be claimed or sold. Dispose at the warehouse Scrap / Disposal Area.',
      badge: 'Dispose / Scrap',
      icon: Trash2,
      needsPickupForm: false,
      formType: null
    },
    {
      id: 'restock_good',
      title: 'Put Back on Good Shelf (Restock)',
      subtitle: 'Items are actually undamaged and safe to sell. Return directly to Good Stock Area.',
      badge: 'Good Stock Restock',
      icon: PackageCheck,
      needsPickupForm: false,
      formType: null
    }
  ];
}

const PH_LEGAL_ID_TYPES = [
  "Driver's License (LTO)",
  'PhilSys National ID (PhilID / ePhilID)',
  'Philippine Passport',
  'UMID Card',
  'SSS ID',
  'Postal ID',
  'PRC Professional ID',
  'Voter’s ID / COMELEC',
  'TIN / BIR Card',
  'Company / Agency ID',
  'Other Valid PH Gov’t / Legal ID'
];

const MAX_PHOTOS_PER_SLOT = 10;
const MAX_TOTAL_PICKUP_PHOTOS = 50;

const PICKUP_PHOTO_SLOTS = [
  {
    key: 'driver_license_front',
    legacyKeys: ['driver_license_front', 'id_license'],
    category: 'driver_license_front',
    stepNum: 1,
    title: 'Driver Valid Gov’t / Legal ID — FRONT',
    hint: 'Upload ANY valid PH gov’t/legal ID (Driver’s License, National ID, Passport, UMID, PRC, SSS, Postal, etc.). AI reads Name, ID Type & ID #!',
    ocrHighlight: true
  },
  {
    key: 'driver_license_back',
    legacyKeys: ['driver_license_back'],
    category: 'driver_license_back',
    stepNum: 2,
    title: 'Driver Valid Gov’t / Legal ID — BACK',
    hint: 'Clear photo of the back of the representative’s valid PH government or legal ID card.',
    ocrHighlight: false
  },
  {
    key: 'truck_plate',
    legacyKeys: ['truck_plate'],
    category: 'truck_license_plate',
    stepNum: 3,
    title: 'Delivery Truck Plate Number',
    hint: 'Photo clearly showing the delivery truck or van plate number. AI auto-fills Truck Plate #!',
    ocrHighlight: true
  },
  {
    key: 'driver_handover',
    legacyKeys: ['driver_handover', 'driver_face'],
    category: 'driver_coworker_handover',
    stepNum: 4,
    title: 'Driver / Co-Worker Photo',
    hint: 'Photo of the driver or staff handling the returned items.',
    ocrHighlight: false
  },
  {
    key: 'pickup_items',
    legacyKeys: ['pickup_items', 'loaded_items', 'signed_form'],
    category: 'delivered_items_pickup',
    stepNum: 5,
    title: 'Damaged Item(s) Picked Up',
    hint: 'Photo showing the actual labeled items handed over for return.',
    ocrHighlight: false
  }
];

function isPendingSupplierName(name) {
  const s = String(name || '').trim().toLowerCase();
  return !s || s === 'pending assignment' || s === 'pending' || s === 'unassigned' || s === 'warehouse' || s === 'n/a';
}

function resolveSavedOptionId(report, isSupplierStream) {
  const meta = (report?.ai_document_metadata && typeof report.ai_document_metadata === 'object')
    ? report.ai_document_metadata
    : {};
  const pickup = (meta.supplier_pickup && typeof meta.supplier_pickup === 'object')
    ? meta.supplier_pickup
    : {};
  const raw = String(meta.simple_rtv_disposition || pickup.disposition || report?.disposition || '').toLowerCase().trim();

  if (!raw) return null;
  if (
    raw === 'supplier_credit' ||
    raw === 'customer_credit' ||
    raw.includes('debit claim') ||
    raw.includes('vendor credit') ||
    raw.includes('ap deduction') ||
    raw.includes('debit / credit')
  ) {
    return isSupplierStream ? 'supplier_credit' : 'customer_credit';
  }
  if (
    raw === 'supplier_exchange' ||
    raw === 'customer_exchange' ||
    raw.includes('replacement') ||
    raw.includes('exchange') ||
    raw.includes('buffer')
  ) {
    return isSupplierStream ? 'supplier_exchange' : 'customer_exchange';
  }
  if (raw === 'scrap' || raw.includes('scrap') || raw.includes('dispose')) {
    return 'scrap';
  }
  if (raw === 'restock_good' || raw.includes('restock')) {
    return 'restock_good';
  }
  if (pickup.picked_up_at) {
    return isSupplierStream ? 'supplier_credit' : 'customer_credit';
  }
  return null;
}

function extractExistingClaimIdFromReport(report) {
  if (!report) return null;
  const pickup = report.ai_document_metadata?.supplier_pickup || {};
  if (pickup.claim_number) return String(pickup.claim_number).trim();
  const noteMatch = String(report.notes || '').match(/\[(?:RTV|BUF):\s*([^\]]+)\]/i);
  if (noteMatch && noteMatch[1]) return noteMatch[1].trim();
  if (Array.isArray(report.audit_trail)) {
    const entry = report.audit_trail.find((a) => a?.rtv_number || a?.buf_number);
    if (entry?.rtv_number) return String(entry.rtv_number).trim();
    if (entry?.buf_number) return String(entry.buf_number).trim();
  }
  return null;
}

export default function SimpleSupplierRtvWizardModal({
  isOpen,
  onClose,
  report = null,
  reports = [],
  allReports = [],
  catalogProducts = [],
  activeUser = null,
  isAdmin = false,
  onSuccess,
  onOpenFullAdminModal,
  initialMode = 'wizard'
}) {
  const rawBatchReports = useMemo(() => {
    const base = Array.isArray(reports) && reports.length > 0 ? reports : (report ? [report] : []);
    const seen = new Set();
    return base.filter((r) => {
      if (!r) return false;
      const k = String(r.rma_number || r.rmaNumber || r.id || '');
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [reports, report]);

  const primaryInputReport = rawBatchReports[0] || null;
  const batchKey = useMemo(
    () => rawBatchReports.map((r) => r.id || r.rma_number).join('|'),
    [rawBatchReports]
  );

  const [step, setStep] = useState('choose'); // 'choose' | 'pickup' | 'done'
  const [selectedOption, setSelectedOption] = useState(null);
  const [supplierName, setSupplierName] = useState('');
  const [supplierEmailTo, setSupplierEmailTo] = useState('');
  const [supplierEmailCc, setSupplierEmailCc] = useState('');
  const [confirmUnifySupplier, setConfirmUnifySupplier] = useState(false);
  const [scrapNeedsReorder, setScrapNeedsReorder] = useState(true);
  const [driverName, setDriverName] = useState('');
  const [driverIdType, setDriverIdType] = useState("Driver's License (LTO)");
  const [driverLicenseNo, setDriverLicenseNo] = useState('');
  const [truckPlate, setTruckPlate] = useState('');
  const [processedBy, setProcessedBy] = useState('');
  const [existingClaimNumber, setExistingClaimNumber] = useState(null);

  // Photo slots: { [slotKey]: Array<{ id, file, previewUrl, existingUrl }> }
  const [photoSlots, setPhotoSlots] = useState({});
  const objectUrlsRef = useRef([]);

  const [isScanningId, setIsScanningId] = useState(false);
  const [isScanningPlate, setIsScanningPlate] = useState(false);
  const [ocrNotice, setOcrNotice] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [savedReport, setSavedReport] = useState(null);
  const [savedBatchReports, setSavedBatchReports] = useState(null);
  const [showA4Form, setShowA4Form] = useState(false);

  // Known suppliers list & customer/store branch list for autocomplete datalists
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

  const customerBranchSuggestions = useMemo(() => {
    const set = new Set();
    allReports.forEach((r) => {
      [
        r?.ai_document_metadata?.supplier_pickup?.customer_name,
        r?.store_branch,
        r?.customer_name,
        r?.reporter_name
      ].forEach((cand) => {
        const s = String(cand || '').trim();
        if (s && !isPendingSupplierName(s)) set.add(s);
      });
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allReports]);

  // Revoke temporary preview URLs on unmount/reset
  const clearObjectUrls = () => {
    objectUrlsRef.current.forEach((u) => {
      try { URL.revokeObjectURL(u); } catch {}
    });
    objectUrlsRef.current = [];
  };

  // Keep freshest snapshots in refs so background report/catalog refreshes never wipe active user selections mid-flow
  const allReportsRef = useRef(allReports);
  allReportsRef.current = allReports;
  const catalogProductsRef = useRef(catalogProducts);
  catalogProductsRef.current = catalogProducts;
  const rawBatchReportsRef = useRef(rawBatchReports);
  rawBatchReportsRef.current = rawBatchReports;
  const primaryInputReportRef = useRef(primaryInputReport);
  primaryInputReportRef.current = primaryInputReport;

  useEffect(() => {
    const targetReport = primaryInputReportRef.current;
    if (!isOpen || !targetReport) return;
    let isMounted = true;
    clearObjectUrls();

    const meta = (targetReport.ai_document_metadata && typeof targetReport.ai_document_metadata === 'object')
      ? targetReport.ai_document_metadata
      : {};
    const pickup = (meta.supplier_pickup && typeof meta.supplier_pickup === 'object')
      ? meta.supplier_pickup
      : {};
    const reportIsSupplier = targetReport.rma_type === 'supplier_outbound';

    const bc = String(targetReport.barcode || '').trim();
    const sku = String(targetReport.code || targetReport.sku || '').trim();
    const matchedProd = (catalogProductsRef.current || []).find((p) => {
      const pBc = String(p.barcode || '').trim();
      const pCode = String(p.code || '').trim();
      const pSku = String(p.sku || '').trim();
      return (bc && pBc === bc) || (sku && (pCode === sku || pSku === sku));
    });

    const manifestFirstItem = Array.isArray(targetReport.items) && targetReport.items.length > 0 ? targetReport.items[0] : null;
    const relatedReport = (allReportsRef.current || []).find((r) => {
      if (!r || (targetReport.id && r.id === targetReport.id)) return false;
      const sameParent = targetReport.id && r.parent_rma_id && String(r.parent_rma_id) === String(targetReport.id);
      const sameBc = bc && String(r.barcode || '').trim() === bc;
      const sameSku = sku && (String(r.code || '').trim() === sku || String(r.sku || '').trim() === sku);
      return (sameParent || sameBc || sameSku) && !isPendingSupplierName(r.supplier_name || r.supplierName || r.supplier);
    });

    const partyCandidates = reportIsSupplier
      ? [
          pickup.supplier_name,
          targetReport.supplier_name,
          targetReport.supplierName,
          targetReport.supplier,
          matchedProd?.supplier_name,
          matchedProd?.supplierName,
          matchedProd?.supplier,
          manifestFirstItem?.supplier_name,
          manifestFirstItem?.supplierName,
          relatedReport?.supplier_name,
          relatedReport?.supplierName
        ]
      : [
          pickup.customer_name,
          !isPendingSupplierName(pickup.supplier_name) ? pickup.supplier_name : '',
          targetReport.store_branch,
          targetReport.customer_name,
          targetReport.reporter_name
        ];
    const initialSupplier = partyCandidates.find((s) => !isPendingSupplierName(s)) || '';
    setSupplierName(String(initialSupplier).trim());
    setSupplierEmailTo(pickup.supplier_email_to || '');
    setSupplierEmailCc(pickup.supplier_email_cc || '');
    setConfirmUnifySupplier(false);

    const matchedOptId = resolveSavedOptionId(targetReport, reportIsSupplier);
    setSelectedOption(matchedOptId);
    setScrapNeedsReorder(getItemNeedsReorder(targetReport));

    setDriverName(pickup.driver_name || targetReport.driver_name || '');
    setDriverIdType(pickup.driver_id_type || targetReport.driver_id_type || "Driver's License (LTO)");
    setDriverLicenseNo(pickup.driver_license_no || '');
    setTruckPlate(pickup.truck_plate || '');

    const activeBatchSnapshot = rawBatchReportsRef.current || [];
    const savedProcessor = String(
      pickup.processed_by ||
      meta.simple_rtv_updated_by ||
      activeBatchSnapshot
        .map((r) => r?.ai_document_metadata?.supplier_pickup?.processed_by || r?.ai_document_metadata?.simple_rtv_updated_by)
        .find((v) => String(v || '').trim()) ||
      ''
    ).trim();
    setProcessedBy(savedProcessor);

    const hydratedPhotos = activeBatchSnapshot.find((r) => r?.ai_document_metadata?.supplier_pickup?.photos)?.ai_document_metadata?.supplier_pickup?.photos || pickup.photos || {};
    const hydratedSlots = {};
    PICKUP_PHOTO_SLOTS.forEach((slot) => {
      const urlSet = new Set();
      const keysToCheck = Array.isArray(slot.legacyKeys) ? slot.legacyKeys : [slot.key];
      keysToCheck.forEach((k) => {
        normalizePhotoUrlArray(hydratedPhotos[k]).forEach((u) => urlSet.add(u));
      });
      hydratedSlots[slot.key] = Array.from(urlSet).slice(0, MAX_PHOTOS_PER_SLOT).map((url, idx) => ({
        id: `${slot.key}-existing-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        file: null,
        previewUrl: url,
        existingUrl: url
      }));
    });
    setPhotoSlots(hydratedSlots);

    const directClaimId = activeBatchSnapshot
      .map((r) => extractExistingClaimIdFromReport(r))
      .find(Boolean) || null;
    setExistingClaimNumber(directClaimId);

    // Also look up saved claims store so an existing RTV- ID is never duplicated on edit
    const rmaNumsToCheck = activeBatchSnapshot.map((r) => r.rma_number).filter(Boolean);
    if (!directClaimId && rmaNumsToCheck.length > 0) {
      supplierClaimService.getClaims().then((claims) => {
        if (!isMounted || !Array.isArray(claims)) return;
        const found = claims.find((c) =>
          Array.isArray(c.items) && c.items.some((it) => rmaNumsToCheck.includes(it.rma_number))
        );
        const foundNum = found?.claimNumber || found?.claim_number || null;
        if (foundNum) {
          setExistingClaimNumber((prev) => prev || foundNum);
        }
      }).catch(() => {});
    }

    setErrorMsg('');
    setOcrNotice(null);
    setUploadProgress('');
    setSavedReport(null);
    setSavedBatchReports(null);

    const isPickedUpNow = activeBatchSnapshot.some((r) => Boolean(
      r?.ai_document_metadata?.supplier_pickup?.picked_up_at ||
      String(r?.status || '').toLowerCase() === 'picked_up'
    ));

    if (initialMode === 'pickup_form' && isPickedUpNow) {
      setShowA4Form(true);
      setStep('done');
    } else {
      setShowA4Form(false);
      setStep('choose');
    }

    return () => {
      isMounted = false;
    };
  }, [isOpen, batchKey, initialMode]);

  useEffect(() => () => clearObjectUrls(), []);

  const distinctSuppliersInBatch = useMemo(() => {
    const map = new Map();
    rawBatchReports.forEach((r) => {
      const cand = [
        r?.ai_document_metadata?.supplier_pickup?.supplier_name,
        r?.supplier_name,
        r?.supplierName,
        r?.supplier
      ].find((s) => !isPendingSupplierName(s));
      if (cand) {
        const clean = String(cand).trim();
        const k = clean.toLowerCase();
        if (!map.has(k)) map.set(k, clean);
      }
    });
    return Array.from(map.values());
  }, [rawBatchReports]);

  const activeWizardEmailType = useMemo(() => {
    if (selectedOption === 'scrap') return 'rma_scrapped';
    if (selectedOption === 'restock_good') return 'rma_restocked';
    if (selectedOption === 'supplier_exchange' || selectedOption === 'customer_exchange') {
      return 'pickup_replacement';
    }
    return 'pickup_debit_claim';
  }, [selectedOption]);

  const [wizardCustomRecipients, setWizardCustomRecipients] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    const prof = notificationService.getEmailProfile(activeWizardEmailType);
    setWizardCustomRecipients({ toList: prof.toList || [], ccList: prof.ccList || [] });
  }, [isOpen, activeWizardEmailType]);

  if (!isOpen || !primaryInputReport) return null;

  const activeBatchReports = (Array.isArray(savedBatchReports) && savedBatchReports.length > 0)
    ? savedBatchReports
    : rawBatchReports;
  const activeReport = savedReport || activeBatchReports[0];
  const isConsolidatedBatch = activeBatchReports.length > 1;
  const batchRmaNumbers = activeBatchReports.map((r) => r.rma_number || r.rmaNumber || String(r.id || '')).filter(Boolean);
  const rmaNumber = activeReport.rma_number || activeReport.rmaNumber || activeReport.id || 'N/A';
  const isTest = activeBatchReports.some((r) => isTestRecord(r));
  const isSupplierStream = activeReport.rma_type === 'supplier_outbound';
  const optionsList = getFourOptions(isSupplierStream);

  const hasMultipleSuppliersConflict = isConsolidatedBatch && distinctSuppliersInBatch.length > 1;

  const batchSummary = getConsolidatedPickupItems({
    report: activeReport,
    reports: activeBatchReports,
    allReports,
    catalogProducts,
    combineIdentical: false
  });
  const grandBatchPieces = batchSummary.items.reduce((s, it) => s + it.totalPieces, 0);
  const grandBatchValue = batchSummary.items.reduce((s, it) => s + it.lineTotal, 0);

  const manifestItems = getReportManifestItems(activeReport, allReports);
  const isManifest = manifestItems.length > 1 || Number(activeReport.total_items) > 1;
  const currentOutcome = formatFourChoiceOutcome(activeReport);
  const isAlreadyPickedUp = currentOutcome.isPickedUp;
  const supplierMissing = isPendingSupplierName(supplierName);
  const effectiveClaimNumber =
    existingClaimNumber ||
    currentOutcome.claimNumber ||
    activeBatchReports.map((r) => extractExistingClaimIdFromReport(r)).find(Boolean) ||
    null;

  const handleSelectPhotos = async (slotKey, filesInput) => {
    const incomingFiles = filesInput instanceof File
      ? [filesInput]
      : Array.from(filesInput || []).filter((f) => Boolean(f));
    if (incomingFiles.length === 0) return;

    const slotObj = PICKUP_PHOTO_SLOTS.find((s) => s.key === slotKey);
    const currentSlotList = Array.isArray(photoSlots[slotKey]) ? photoSlots[slotKey] : [];
    const currentTotalCount = PICKUP_PHOTO_SLOTS.reduce(
      (sum, s) => sum + (Array.isArray(photoSlots[s.key]) ? photoSlots[s.key].length : 0),
      0
    );

    const slotRemaining = Math.max(0, MAX_PHOTOS_PER_SLOT - currentSlotList.length);
    const totalRemaining = Math.max(0, MAX_TOTAL_PICKUP_PHOTOS - currentTotalCount);
    const allowedCount = Math.min(slotRemaining, totalRemaining);

    if (slotRemaining <= 0) {
      setErrorMsg(`Maximum ${MAX_PHOTOS_PER_SLOT} photos allowed for "${slotObj?.title || slotKey}". Remove a photo to add another.`);
      return;
    }
    if (totalRemaining <= 0) {
      setErrorMsg(`Maximum ${MAX_TOTAL_PICKUP_PHOTOS} total pickup photos reached across all 5 categories. Remove a photo first.`);
      return;
    }

    const acceptedFiles = incomingFiles.slice(0, allowedCount);
    if (incomingFiles.length > allowedCount) {
      setErrorMsg(
        `Maximum ${MAX_PHOTOS_PER_SLOT} photos per slot (${MAX_TOTAL_PICKUP_PHOTOS} total). Added ${acceptedFiles.length} photo(s); ${incomingFiles.length - acceptedFiles.length} extra photo(s) were skipped.`
      );
    } else {
      setErrorMsg('');
    }

    const newEntries = acceptedFiles.map((file, idx) => {
      const previewUrl = URL.createObjectURL(file);
      objectUrlsRef.current.push(previewUrl);
      return {
        id: `${slotKey}-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        previewUrl,
        existingUrl: ''
      };
    });

    setPhotoSlots((prev) => {
      const prevList = Array.isArray(prev[slotKey]) ? prev[slotKey] : [];
      const prevTotal = PICKUP_PHOTO_SLOTS.reduce(
        (sum, s) => sum + (Array.isArray(prev[s.key]) ? prev[s.key].length : 0),
        0
      );
      const room = Math.max(0, Math.min(MAX_PHOTOS_PER_SLOT - prevList.length, MAX_TOTAL_PICKUP_PHOTOS - prevTotal));
      if (room <= 0) return prev;
      return {
        ...prev,
        [slotKey]: [...prevList, ...newEntries.slice(0, room)]
      };
    });

    // Auto-read Driver's Valid Gov't / Legal ID Front with Gemini AI Vision on first ID photo when Driver Name & ID # are empty
    if (
      slotKey === 'driver_license_front' &&
      currentSlotList.length === 0 &&
      !driverName.trim() &&
      !driverLicenseNo.trim()
    ) {
      setIsScanningId(true);
      setOcrNotice({ type: 'info', text: 'Reading Driver Name, Valid ID Type & ID # from photo...' });
      try {
        const res = await catalogService.inspectDriverLicense(acceptedFiles[0]);
        if (res?.id_type && res.id_type !== 'Unknown') {
          setDriverIdType(String(res.id_type).trim());
        }
        if (res?.driver_name) {
          setDriverName((prev) => prev.trim() || res.driver_name.trim());
        }
        if (res?.license_number) {
          setDriverLicenseNo((prev) => prev.trim() || res.license_number.trim());
        }
        if (res?.driver_name || res?.license_number) {
          const detectedLabel = res?.id_type && res.id_type !== 'Unknown' ? `${res.id_type}: ` : '';
          setOcrNotice({
            type: 'success',
            text: `Auto-filled from ${detectedLabel}${res.driver_name || 'Name n/a'}${res.license_number ? ` • ID # ${res.license_number}` : ''}`
          });
        } else {
          setOcrNotice({
            type: 'warn',
            text: res?.rejection_reason || 'Photo saved! Could not read ID text clearly — please select ID Type and enter Name & ID # below.'
          });
        }
      } catch (err) {
        console.warn('Valid ID OCR warning:', err);
        setOcrNotice({
          type: 'warn',
          text: 'Photo saved! Auto-read unavailable right now — please select Valid ID Type and enter Name & ID # below.'
        });
      } finally {
        setIsScanningId(false);
      }
    }

    // Auto-read Delivery Truck Plate Number with Gemini AI Vision on first Slot 3 photo when Truck Plate is empty
    if (
      slotKey === 'truck_plate' &&
      currentSlotList.length === 0 &&
      !truckPlate.trim()
    ) {
      setIsScanningPlate(true);
      setOcrNotice({ type: 'info', text: 'Reading Delivery Truck Plate Number from photo...' });
      try {
        const res = await catalogService.inspectTruckPlate(acceptedFiles[0]);
        if (res?.is_valid_plate !== false && res?.plate_number) {
          const cleanPlate = String(res.plate_number).trim().toUpperCase();
          setTruckPlate((prev) => prev.trim() || cleanPlate);
          setOcrNotice({
            type: 'success',
            text: `Auto-filled Truck Plate #: ${cleanPlate}${res?.vehicle_type && res.vehicle_type !== 'Unknown' ? ` (${res.vehicle_type})` : ''}`
          });
        } else {
          setOcrNotice({
            type: 'warn',
            text: res?.rejection_reason || 'Photo saved! Could not read truck plate clearly — please enter Truck Plate Number manually below.'
          });
        }
      } catch (err) {
        console.warn('Truck Plate OCR warning:', err);
        setOcrNotice({
          type: 'warn',
          text: 'Photo saved! Truck plate auto-read unavailable right now — please enter Truck Plate Number manually below.'
        });
      } finally {
        setIsScanningPlate(false);
      }
    }
  };

  const handleRemovePhoto = (slotKey, photoId) => {
    setErrorMsg('');
    setPhotoSlots((prev) => {
      const prevList = Array.isArray(prev[slotKey]) ? prev[slotKey] : [];
      const target = prevList.find((item) => item.id === photoId);
      if (target?.previewUrl && !target?.existingUrl) {
        try { URL.revokeObjectURL(target.previewUrl); } catch {}
      }
      return {
        ...prev,
        [slotKey]: prevList.filter((item) => item.id !== photoId)
      };
    });
  };

  const handleSaveSimpleDecision = async (optionId, waitOnly = false) => {
    setErrorMsg('');
    const opt = optionsList.find((o) => o.id === optionId);
    if (!opt) return;

    const cleanSupplier = supplierName.trim();
    if (opt.needsPickupForm && !cleanSupplier) {
      setErrorMsg(
        isSupplierStream
          ? 'Please type or choose the Supplier Company Name first.'
          : 'Please type or enter the Customer / Store Branch Name first.'
      );
      return;
    }

    if (opt.needsPickupForm && hasMultipleSuppliersConflict && !confirmUnifySupplier) {
      setErrorMsg(
        `Single-Supplier Guard: Bundled RMAs come from different suppliers (${distinctSuppliersInBatch.join(', ')}). Check "Unify supplier across all bundled RMAs" below or go back and filter to one supplier.`
      );
      return;
    }

    // If Debit Claim or Replacement and staff chose "Driver Is Here Now" / "Edit Pickup"
    if (opt.needsPickupForm && !waitOnly) {
      setSelectedOption(optionId);
      setStep('pickup');
      return;
    }

    const cleanProcessedBy = processedBy.trim();
    if (!cleanProcessedBy) {
      setErrorMsg('Please enter "Processed By (Staff Full Name)" before saving this decision.');
      return;
    }

    const effectiveSupplier = cleanSupplier || activeReport.supplier_name || 'Pending Assignment';
    const nowIso = new Date().toISOString();

    setIsSaving(true);
    setUploadProgress(
      isConsolidatedBatch
        ? `Updating ${activeBatchReports.length} bundled RMAs...`
        : 'Saving your decision...'
    );
    try {
      const nextStatus = opt.needsPickupForm
        ? (isSupplierStream ? 'vendor_claimed' : 'under_inspection')
        : 'under_inspection';

      let nextLocation = isSupplierStream ? 'Supplier Return Area (RTV)' : 'Receiving Area';
      if (optionId === 'scrap') {
        nextLocation = 'Disposal / Scrap Area';
      } else if (optionId === 'restock_good') {
        nextLocation = 'Good Stock Area';
      }

      const auditDetail = optionId === 'scrap'
        ? ` [Re-Order: ${scrapNeedsReorder ? 'YES' : 'NO'}]`
        : (waitOnly ? ' (waiting for driver)' : '');

      const updatedBatchList = [];
      for (let i = 0; i < activeBatchReports.length; i++) {
        const rep = activeBatchReports[i];
        if (isConsolidatedBatch) {
          setUploadProgress(`Updating RMA ${i + 1} of ${activeBatchReports.length} (${rep.rma_number})...`);
        }
        const repMeta = (rep.ai_document_metadata && typeof rep.ai_document_metadata === 'object')
          ? rep.ai_document_metadata
          : {};
        const repPickup = (repMeta.supplier_pickup && typeof repMeta.supplier_pickup === 'object')
          ? repMeta.supplier_pickup
          : {};

        const updatedPickup = (Object.keys(repPickup).length > 0 || supplierEmailTo.trim() || supplierEmailCc.trim() || isConsolidatedBatch || (!isSupplierStream && cleanSupplier))
          ? {
              ...repPickup,
              disposition: optionId,
              disposition_label: opt.title,
              supplier_name: effectiveSupplier,
              ...(isSupplierStream ? {} : { customer_name: cleanSupplier || repPickup.customer_name || rep.store_branch || '' }),
              supplier_email_to: supplierEmailTo.trim(),
              supplier_email_cc: supplierEmailCc.trim(),
              ...(isConsolidatedBatch ? { consolidated_rma_numbers: batchRmaNumbers } : {}),
              picked_up_at: null,
              updated_at: nowIso,
              processed_by: cleanProcessedBy
            }
          : undefined;

        const metadataPatch = {
          simple_rtv_disposition: optionId,
          simple_rtv_label: opt.title,
          simple_rtv_updated_at: nowIso,
          simple_rtv_updated_by: cleanProcessedBy,
          needs_reorder: optionId === 'scrap' ? Boolean(scrapNeedsReorder) : false
        };
        if (updatedPickup) {
          metadataPatch.supplier_pickup = updatedPickup;
        }

        const updated = await catalogService.saveSimpleSupplierRtvDisposition(rep, {
          disposition: optionId,
          status: nextStatus,
          warehouse_location: nextLocation,
          supplier_name: isSupplierStream ? effectiveSupplier : (rep.supplier_name || effectiveSupplier),
          actorName: cleanProcessedBy,
          inspected_by: cleanProcessedBy,
          clearWorkflowResolution: true,
          auditAction: isConsolidatedBatch ? 'CONSOLIDATED_4CHOICE_DECISION' : 'SIMPLE_4CHOICE_DECISION',
          auditNote: `Staff selected "${opt.title}"${auditDetail}${isConsolidatedBatch ? ` [Batch of ${activeBatchReports.length} RMAs]` : ''}`,
          metadataPatch
        });
        updatedBatchList.push(updated);
      }

      if (optionId === 'scrap' || optionId === 'restock_good') {
        setUploadProgress(
          isConsolidatedBatch
            ? `Sending ONE consolidated email for ${updatedBatchList.length} RMAs...`
            : 'Sending lifecycle email notification...'
        );
        try {
          await notificationService.sendRmaLifecycleNotification({
            eventType: optionId === 'scrap' ? 'scrapped' : 'restocked',
            report: updatedBatchList[0],
            reports: updatedBatchList,
            allReports,
            catalogProducts,
            actorName: cleanProcessedBy,
            isTestMode: isTest,
            customRecipients: wizardCustomRecipients
          });
        } catch (mailErr) {
          console.warn('Non-blocking error sending 4-Choice lifecycle email:', mailErr);
        }
      }

      setSavedReport(updatedBatchList[0]);
      setSavedBatchReports(updatedBatchList);
      setStep('done');
      onSuccess?.(updatedBatchList.length > 1 ? updatedBatchList : updatedBatchList[0]);
    } catch (err) {
      console.error('Failed saving 4-Choice decision:', err);
      setErrorMsg(err?.message || 'Could not save choice. Please try again.');
    } finally {
      setIsSaving(false);
      setUploadProgress('');
    }
  };

  const handleCompletePickupAndGenerateForm = async () => {
    setErrorMsg('');
    const cleanProcessedBy = processedBy.trim();
    if (!cleanProcessedBy) {
      setErrorMsg('Please enter "Processed By (Staff Full Name)" before completing pickup verification.');
      return;
    }

    const cleanSupplier = supplierName.trim();
    if (!cleanSupplier) {
      setErrorMsg(
        isSupplierStream
          ? 'Please type or select the Supplier Company Name.'
          : 'Please type or enter the Customer / Store Branch Name.'
      );
      return;
    }

    if (hasMultipleSuppliersConflict && !confirmUnifySupplier) {
      setErrorMsg(
        `Single-Supplier Guard: Bundled RMAs come from different suppliers (${distinctSuppliersInBatch.join(', ')}). Check "Unify supplier across all bundled RMAs" or go back and filter to one supplier.`
      );
      return;
    }

    const cleanEmailTo = supplierEmailTo.trim();
    const cleanEmailCc = supplierEmailCc.trim();

    const missingSlots = PICKUP_PHOTO_SLOTS.filter((slot) => {
      const list = Array.isArray(photoSlots[slot.key]) ? photoSlots[slot.key] : [];
      return !list.some((item) => Boolean(item?.file || item?.existingUrl));
    });
    if (missingSlots.length > 0) {
      setErrorMsg(`Please upload at least 1 photo for each of the 5 required categories (missing: ${missingSlots.map((m) => m.title).join(', ')}).`);
      return;
    }

    const oversizedSlots = PICKUP_PHOTO_SLOTS.filter((slot) => (photoSlots[slot.key] || []).length > MAX_PHOTOS_PER_SLOT);
    if (oversizedSlots.length > 0) {
      setErrorMsg(`Maximum ${MAX_PHOTOS_PER_SLOT} photos allowed per category (${oversizedSlots.map((s) => s.title).join(', ')}).`);
      return;
    }

    const totalPhotosSelected = PICKUP_PHOTO_SLOTS.reduce(
      (sum, slot) => sum + (Array.isArray(photoSlots[slot.key]) ? photoSlots[slot.key].length : 0),
      0
    );
    if (totalPhotosSelected > MAX_TOTAL_PICKUP_PHOTOS) {
      setErrorMsg(`Maximum ${MAX_TOTAL_PICKUP_PHOTOS} total pickup photos allowed across all 5 categories.`);
      return;
    }

    if (!driverName.trim()) {
      setErrorMsg("Please enter the Driver's / Representative's Full Name (from their valid gov't/legal ID).");
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
      const pendingUploads = [];
      PICKUP_PHOTO_SLOTS.forEach((slot) => {
        const entries = Array.isArray(photoSlots[slot.key]) ? photoSlots[slot.key] : [];
        uploadedUrlMap[slot.key] = new Array(entries.length).fill('');
        entries.forEach((entry, idx) => {
          if (entry?.file) {
            pendingUploads.push({ slot, idx, entry });
          } else if (entry?.existingUrl) {
            uploadedUrlMap[slot.key][idx] = entry.existingUrl;
          }
        });
      });

      const newPhotoUrls = [];
      const totalToUpload = pendingUploads.length;
      if (totalToUpload > 0) {
        let completedUploads = 0;

        // Upload the first new photo sequentially to obtain/reuse currentFolderId before batch concurrency
        const firstTask = pendingUploads[0];
        setUploadProgress(`Uploading 1 of ${totalToUpload} photos (${firstTask.slot.title})...`);
        const firstRes = await catalogService.uploadPhotoWithDetails(
          firstTask.entry.file,
          rmaNumber,
          firstTask.slot.category,
          {
            targetFolderId: currentFolderId || null,
            driverName: driverName.trim(),
            truckPlate: truckPlate.trim(),
            supplierName: cleanSupplier
          }
        );
        if (!firstRes?.url) {
          throw new Error(`Photo upload failed for "${firstTask.slot.title}". Please check connection and retry.`);
        }
        uploadedUrlMap[firstTask.slot.key][firstTask.idx] = firstRes.url;
        newPhotoUrls.push(firstRes.url);
        completedUploads = 1;
        if (!currentFolderId && firstRes.rmaFolderId) currentFolderId = firstRes.rmaFolderId;
        if (!currentFolderUrl && firstRes.rmaFolderUrl) currentFolderUrl = firstRes.rmaFolderUrl;

        // Upload remaining new photos in controlled batches of 4
        const UPLOAD_BATCH_SIZE = 4;
        const remainingTasks = pendingUploads.slice(1);
        for (let b = 0; b < remainingTasks.length; b += UPLOAD_BATCH_SIZE) {
          const chunk = remainingTasks.slice(b, b + UPLOAD_BATCH_SIZE);
          setUploadProgress(`Uploading ${completedUploads + 1} of ${totalToUpload} photos...`);
          const chunkResults = await Promise.all(
            chunk.map(async (task) => {
              const res = await catalogService.uploadPhotoWithDetails(
                task.entry.file,
                rmaNumber,
                task.slot.category,
                {
                  targetFolderId: currentFolderId || null,
                  driverName: driverName.trim(),
                  truckPlate: truckPlate.trim(),
                  supplierName: cleanSupplier
                }
              );
              if (!res?.url) {
                throw new Error(`Photo upload failed for "${task.slot.title}". Please check connection and retry.`);
              }
              completedUploads += 1;
              setUploadProgress(`Uploading ${completedUploads} of ${totalToUpload} photos...`);
              if (!currentFolderId && res.rmaFolderId) currentFolderId = res.rmaFolderId;
              if (!currentFolderUrl && res.rmaFolderUrl) currentFolderUrl = res.rmaFolderUrl;
              return { task, res };
            })
          );
          chunkResults.forEach(({ task, res }) => {
            uploadedUrlMap[task.slot.key][task.idx] = res.url;
            newPhotoUrls.push(res.url);
          });
        }
      }

      PICKUP_PHOTO_SLOTS.forEach((slot) => {
        uploadedUrlMap[slot.key] = (uploadedUrlMap[slot.key] || []).filter(Boolean);
      });
      const totalSavedPhotosCount = PICKUP_PHOTO_SLOTS.reduce(
        (sum, slot) => sum + (uploadedUrlMap[slot.key]?.length || 0),
        0
      );

      const activeOpt = optionsList.find((o) => o.id === selectedOption) || optionsList[0];
      const existingMeta = (activeReport.ai_document_metadata && typeof activeReport.ai_document_metadata === 'object')
        ? activeReport.ai_document_metadata
        : {};
      const existingPickup = (existingMeta.supplier_pickup && typeof existingMeta.supplier_pickup === 'object')
        ? existingMeta.supplier_pickup
        : {};

      // Reuse existing RTV- / BUF- ref if present across any bundled RMA; only generate ONE shared ID
      let resolvedClaimNumber = effectiveClaimNumber || existingPickup.claim_number || null;
      const shouldPersistSupplierClaim =
        isSupplierStream && (
          activeOpt.id === 'supplier_credit' ||
          activeOpt.id === 'supplier_exchange' ||
          isConsolidatedBatch
        );

      let existingClaimsList = null;
      if (shouldPersistSupplierClaim && !resolvedClaimNumber) {
        setUploadProgress('Checking existing claim records...');
        existingClaimsList = await supplierClaimService.getClaims();
        const existingInStore = (existingClaimsList || []).find((c) =>
          Array.isArray(c.items) && c.items.some((it) => batchRmaNumbers.includes(it.rma_number))
        );
        if (existingInStore) {
          resolvedClaimNumber = existingInStore.claimNumber || existingInStore.claim_number;
        } else {
          resolvedClaimNumber = supplierClaimService.generateRtvId(existingClaimsList || [], isTest);
        }
      } else if (!isSupplierStream && activeOpt.id === 'customer_exchange' && !resolvedClaimNumber) {
        resolvedClaimNumber = supplierClaimService.generateBufferId([...allReports, ...activeBatchReports], isTest);
      }

      if (resolvedClaimNumber) {
        setExistingClaimNumber(resolvedClaimNumber);
      }

      setUploadProgress(
        isConsolidatedBatch
          ? `Synchronizing ${activeBatchReports.length} bundled RMAs (${resolvedClaimNumber || rmaNumber})...`
          : 'Saving pickup verification & generating Letter form...'
      );
      const nowIso = new Date().toISOString();
      const pickedUpAtIso = existingPickup.picked_up_at || nowIso;

      const updatedBatchList = [];
      for (let idx = 0; idx < activeBatchReports.length; idx++) {
        const rep = activeBatchReports[idx];
        const repMeta = (rep.ai_document_metadata && typeof rep.ai_document_metadata === 'object')
          ? rep.ai_document_metadata
          : {};
        const repPickup = (repMeta.supplier_pickup && typeof repMeta.supplier_pickup === 'object')
          ? repMeta.supplier_pickup
          : {};

        const pickupPayload = {
          ...repPickup,
          disposition: activeOpt.id,
          disposition_label: activeOpt.title,
          claim_number: resolvedClaimNumber || null,
          consolidated_rma_numbers: batchRmaNumbers,
          supplier_name: cleanSupplier,
          ...(isSupplierStream ? {} : { customer_name: cleanSupplier }),
          supplier_email_to: cleanEmailTo,
          supplier_email_cc: cleanEmailCc,
          driver_name: driverName.trim(),
          driver_id_type: driverIdType.trim() || "Driver's License (LTO)",
          driver_license_no: driverLicenseNo.trim(),
          truck_plate: truckPlate.trim().toUpperCase(),
          photos: uploadedUrlMap,
          drive_folder_id: currentFolderId || null,
          drive_folder_url: currentFolderUrl || null,
          picked_up_at: repPickup.picked_up_at || pickedUpAtIso,
          updated_at: nowIso,
          processed_by: cleanProcessedBy
        };

        const nextLocation = isSupplierStream ? 'Supplier Return Area (RTV)' : 'Customer Return Area';
        const updatedRep = await catalogService.saveSimpleSupplierRtvDisposition(rep, {
          disposition: activeOpt.id,
          status: 'picked_up',
          warehouse_location: nextLocation,
          supplier_name: isSupplierStream ? cleanSupplier : (rep.supplier_name || cleanSupplier),
          actorName: cleanProcessedBy,
          inspected_by: cleanProcessedBy,
          clearWorkflowResolution: true,
          google_drive_folder_id: currentFolderId || null,
          google_drive_folder_url: currentFolderUrl || null,
          appendPhotoUrls: newPhotoUrls,
          auditAction: repPickup.picked_up_at ? 'PICKUP_DETAILS_UPDATED' : 'SUPPLIER_DRIVER_PICKUP_VERIFIED',
          auditNote: `${repPickup.picked_up_at ? 'Updated' : 'Picked up by'} ${driverName.trim()} (Plate ${truckPlate.trim().toUpperCase()}) for "${activeOpt.title}"${resolvedClaimNumber ? ` [${resolvedClaimNumber}]` : ''}${isConsolidatedBatch ? ` (Consolidated Batch: ${batchRmaNumbers.length} RMAs)` : ''} with ${totalSavedPhotosCount} Drive photo(s) archived.`,
          metadataPatch: {
            simple_rtv_disposition: activeOpt.id,
            simple_rtv_label: activeOpt.title,
            simple_rtv_updated_at: pickupPayload.picked_up_at,
            simple_rtv_updated_by: cleanProcessedBy,
            needs_reorder: false,
            supplier_pickup: pickupPayload
          }
        });
        updatedBatchList.push(updatedRep);
      }

      // Persist ONE consolidated Claim record across all bundled RMAs (without creating duplicate RTV- IDs)
      if ((shouldPersistSupplierClaim || resolvedClaimNumber) && isSupplierStream && resolvedClaimNumber) {
        const claimItems = [];
        updatedBatchList.forEach((rep) => {
          const repRma = rep.rma_number || rep.rmaNumber;
          const repChildren = getReportManifestItems(rep, allReports);
          const lines = repChildren.length > 0 ? repChildren : [rep];
          lines.forEach((it) => {
            const calc = computeItemPiecesAndValue(it, catalogProducts);
            claimItems.push({
              ...it,
              rma_number: repRma,
              supplier_name: cleanSupplier,
              quantity: calc.rawQty || Number(it.quantity) || 1,
              price: calc.recordedUnitPrice,
              price_with_vat: calc.recordedUnitPrice
            });
          });
        });
        const totalUnits = claimItems.reduce((sum, it) => sum + (Number(it.quantity) || 1), 0);
        const totalClaimAmt = claimItems.reduce((sum, it) => {
          const calc = computeItemPiecesAndValue(it, catalogProducts);
          return sum + calc.lineTotal;
        }, 0);

        await supplierClaimService.saveClaim({
          claimNumber: resolvedClaimNumber,
          supplierName: cleanSupplier,
          generatedBy: cleanProcessedBy,
          items: claimItems,
          totalQuantity: totalUnits,
          totalClaimAmount: totalClaimAmt,
          notes: isTest
            ? `[TEST_MODE] Sandbox${isConsolidatedBatch ? ' Consolidated' : ''} RTV Claim (${batchRmaNumbers.length} RMAs)`
            : (isConsolidatedBatch ? `Consolidated Claim (${batchRmaNumbers.length} RMAs): ${batchRmaNumbers.join(', ')}` : ''),
          isTest,
          preserveReportFields: true
        });

        const tag = `[RTV: ${resolvedClaimNumber}]`;
        for (let i = 0; i < updatedBatchList.length; i++) {
          const curNotes = String(updatedBatchList[i]?.notes || '');
          if (!curNotes.includes(tag)) {
            updatedBatchList[i] = {
              ...updatedBatchList[i],
              notes: curNotes ? `${curNotes}\n${tag}` : tag
            };
          }
        }
      }

      const isExchangeOutcome =
        activeOpt.id === 'supplier_exchange' ||
        activeOpt.id === 'customer_exchange';
      setUploadProgress(
        isConsolidatedBatch
          ? `Generating consolidated PDF & emailing for ${updatedBatchList.length} RMAs...`
          : 'Generating PDF form & dispatching email notification...'
      );
      try {
        await notificationService.sendRmaLifecycleNotification({
          eventType: isExchangeOutcome ? 'pickup_replacement' : 'pickup_debit_claim',
          report: updatedBatchList[0],
          reports: updatedBatchList,
          allReports,
          catalogProducts,
          actorName: cleanProcessedBy,
          isTestMode: isTest,
          customRecipients: wizardCustomRecipients
        });
      } catch (mailErr) {
        console.warn('Non-blocking error sending pickup notification email:', mailErr);
      }

      setSavedReport(updatedBatchList[0]);
      setSavedBatchReports(updatedBatchList);
      setStep('done');
      setShowA4Form(true);
      onSuccess?.(updatedBatchList.length > 1 ? updatedBatchList : updatedBatchList[0]);
    } catch (err) {
      console.error('Pickup verification failed:', err);
      setErrorMsg(err?.message || 'Failed to upload photos or save pickup verification. Please try again.');
    } finally {
      setIsSaving(false);
      setUploadProgress('');
    }
  };

  const completedPhotoCount = PICKUP_PHOTO_SLOTS.filter((s) => Array.isArray(photoSlots[s.key]) && photoSlots[s.key].length > 0).length;
  const totalPhotoCount = PICKUP_PHOTO_SLOTS.reduce(
    (sum, s) => sum + (Array.isArray(photoSlots[s.key]) ? photoSlots[s.key].length : 0),
    0
  );
  const newPendingPhotoCount = PICKUP_PHOTO_SLOTS.reduce(
    (sum, s) => sum + (Array.isArray(photoSlots[s.key]) ? photoSlots[s.key].filter((p) => p?.file).length : 0),
    0
  );
  const processedByMissing = !processedBy.trim();
  const chosenOptionObj = optionsList.find((o) => o.id === selectedOption);
  const existingFormLabel = !isSupplierStream
    ? (currentOutcome.formType === 'replacement' ? 'Buffer Replacement Form' : 'Credit Return Form')
    : (currentOutcome.formType === 'replacement' ? 'Replacement Form' : 'Debit Claim Form');
  const activePartySuggestions = isSupplierStream ? supplierSuggestions : customerBranchSuggestions;

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
                  {isConsolidatedBatch ? `Consolidated Batch (${activeBatchReports.length} RMAs)` : rmaNumber}
                </span>
                {isTest && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[10px] font-black uppercase tracking-wider">
                    🧪 Test Mode
                  </span>
                )}
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                  isSupplierStream
                    ? 'bg-purple-500/20 border-purple-400/40 text-purple-200'
                    : 'bg-blue-500/20 border-blue-400/40 text-blue-200'
                }`}>
                  {isSupplierStream ? 'Supplier RTV' : 'Customer Hub'}
                </span>
                {effectiveClaimNumber && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 font-mono text-[10px] font-bold">
                    {effectiveClaimNumber}
                  </span>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-slate-300 truncate mt-0.5">
                {step === 'choose'
                  ? 'Step 1 of 2: Choose 4-Choice Outcome (Edit or Update Anytime)'
                  : step === 'pickup'
                    ? (isSupplierStream
                      ? 'Step 2 of 2: Driver Pickup Verification, Supplier Emails & Drive Photos (Max 10/Slot)'
                      : 'Step 2 of 2: Customer Handover Verification, Customer Emails & Drive Photos (Max 10/Slot)')
                    : (isSupplierStream
                      ? 'Decision Saved — Ready for Warehouse & Supplier Records'
                      : 'Decision Saved — Ready for Warehouse & Customer Records')}
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

            {/* Consolidated Batch Summary Banner */}
            {isConsolidatedBatch && (
              <div className="p-3.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border-2 border-indigo-300 dark:border-indigo-700 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-xs sm:text-sm font-black text-indigo-950 dark:text-indigo-100">
                    ⚡ Consolidated Batch: {activeBatchReports.length} RMAs Selected
                  </div>
                  <div className="text-xs font-mono font-black text-indigo-800 dark:text-indigo-200">
                    {batchSummary.items.length} Line(s) • {grandBatchPieces.toLocaleString()} pcs • {formatPeso(grandBatchValue)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {batchRmaNumbers.map((num) => (
                    <span
                      key={num}
                      className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 font-mono text-[10px] font-bold text-indigo-800 dark:text-indigo-200"
                    >
                      {num}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Single-Supplier Guard Banner when bundled RMAs contain different suppliers */}
            {hasMultipleSuppliersConflict && (
              <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-400 dark:border-amber-600 space-y-2">
                <div className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200 font-bold">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <div>
                      Single-Supplier Guard: Bundled RMAs currently belong to multiple suppliers:{' '}
                      <span className="font-black underline">{distinctSuppliersInBatch.join(', ')}</span>.
                    </div>
                    <p className="font-normal text-[11px] mt-0.5">
                      Debit Claim &amp; Replacement forms must belong to a single supplier. Either filter the table to one supplier first, or confirm unifying all bundled RMAs under <strong>{supplierName || distinctSuppliersInBatch[0]}</strong> below:
                    </p>
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-black text-amber-950 dark:text-amber-100 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={confirmUnifySupplier}
                    onChange={(e) => {
                      setConfirmUnifySupplier(e.target.checked);
                      if (e.target.checked && !supplierName.trim() && distinctSuppliersInBatch[0]) {
                        setSupplierName(distinctSuppliersInBatch[0]);
                      }
                      setErrorMsg('');
                    }}
                    className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                  />
                  <span>Unify all {activeBatchReports.length} RMAs under &quot;{supplierName || distinctSuppliersInBatch[0]}&quot;</span>
                </label>
              </div>
            )}

            {/* Existing Saved Outcome / Instant View & Edit Banner */}
            {currentOutcome.hasDecision && step !== 'pickup' && (
              <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 text-emerald-900 dark:text-emerald-200 text-xs sm:text-sm font-semibold min-w-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div className="min-w-0">
                    <div>
                      Current Outcome: <strong>{currentOutcome.label}</strong>
                    </div>
                    {(effectiveClaimNumber || driverName || truckPlate) && (
                      <div className="text-[11px] font-mono text-emerald-800/90 dark:text-emerald-300/90 truncate">
                        {[
                          effectiveClaimNumber ? `Claim: ${effectiveClaimNumber}` : null,
                          driverName ? `Driver: ${driverName}` : null,
                          truckPlate ? `Plate: ${truckPlate}` : null
                        ].filter(Boolean).join(' • ')}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {isAlreadyPickedUp && (
                    <button
                      type="button"
                      onClick={() => setShowA4Form(true)}
                      className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black flex items-center gap-1.5 shadow-sm cursor-pointer"
                    >
                      <FileCheck2 className="w-4 h-4" />
                      <span>📄 {existingFormLabel}</span>
                    </button>
                  )}
                  {chosenOptionObj?.needsPickupForm && (
                    <button
                      type="button"
                      onClick={() => setStep('pickup')}
                      className="px-3 py-2 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 border border-emerald-400 dark:border-emerald-600 text-emerald-800 dark:text-emerald-200 text-xs font-bold cursor-pointer"
                    >
                      ✏️ Edit Pickup &amp; Photos
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Item Summary Card */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Reported Product / Contents
                </div>
                <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                  {isConsolidatedBatch
                    ? `${activeBatchReports.length} Consolidated RMAs (${batchSummary.items.length} Line Item${batchSummary.items.length > 1 ? 's' : ''})`
                    : isManifest
                      ? `Batch Manifest (${manifestItems.length} SKUs) — ${activeReport.name || rmaNumber}`
                      : (activeReport.name || activeReport.product_name || activeReport.barcode)}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300 font-mono mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>
                    Qty:{' '}
                    <strong>
                      {isConsolidatedBatch
                        ? `${grandBatchPieces.toLocaleString()} pcs (${formatPeso(grandBatchValue)})`
                        : isManifest
                          ? formatManifestBreakdown(manifestItems, false)
                          : formatQuantityWithPackSize(activeReport.quantity || 1, activeReport.unit_name || 'pc', activeReport.pieces_per_case)}
                    </strong>
                  </span>
                  {(activeReport.expiry_date || activeReport.ai_document_metadata?.expiry_date) && (
                    <span className="text-amber-700 dark:text-amber-400 font-bold">
                      Expiry Date (YYYY-MM-DD): {formatDateYmd(activeReport.expiry_date || activeReport.ai_document_metadata?.expiry_date) || activeReport.expiry_date || activeReport.ai_document_metadata?.expiry_date}
                    </span>
                  )}
                </div>
              </div>
              {isAdmin && onOpenFullAdminModal && (
                <button
                  type="button"
                  onClick={() => onOpenFullAdminModal(activeReport)}
                  className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:border-slate-500 flex items-center gap-1 cursor-pointer"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  <span>Split Qty / Details</span>
                </button>
              )}
            </div>

            {/* Step 1: Party Name (Supplier OR Customer / Store Branch) * & Manual Processed By * fields */}
            {step === 'choose' && (
              <div className="space-y-3">
                <div className={`p-4 rounded-xl border-2 transition-colors ${
                  supplierMissing
                    ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-400 dark:border-amber-600'
                    : 'bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700'
                }`}>
                  <label className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-1.5">
                    <Building2 className={`w-4 h-4 ${supplierMissing ? 'text-amber-600' : 'text-slate-500'}`} />
                    <span>{isSupplierStream ? 'Supplier Company Name *' : 'Customer / Store Branch Name *'}</span>
                    {supplierMissing && (
                      <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 text-[10px]">
                        {isSupplierStream ? 'Required for Claim / Replacement' : 'Required for Credit / Replacement'}
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    list="supplier-rtv-company-list"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    placeholder={
                      isSupplierStream
                        ? 'Type or pick the Supplier Company Name (e.g. Century Pacific Food, Nestle)...'
                        : 'Type or pick Customer / Store Branch Name...'
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                  />
                  <datalist id="supplier-rtv-company-list">
                    {activePartySuggestions.map((sup) => (
                      <option key={sup} value={sup} />
                    ))}
                  </datalist>
                </div>

                <div className={`p-4 rounded-xl border-2 transition-colors ${
                  processedByMissing
                    ? 'bg-amber-50/70 dark:bg-amber-950/20 border-amber-300 dark:border-amber-700'
                    : 'bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700'
                }`}>
                  <label
                    htmlFor="wizard-processed-by-step1"
                    className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-1.5"
                  >
                    <UserCheck className={`w-4 h-4 ${processedByMissing ? 'text-amber-600' : 'text-emerald-600'}`} />
                    <span>Processed By (Staff Full Name) *</span>
                    {processedByMissing && (
                      <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 text-[10px]">
                        Required
                      </span>
                    )}
                  </label>
                  <input
                    id="wizard-processed-by-step1"
                    type="text"
                    value={processedBy}
                    onChange={(e) => {
                      setProcessedBy(e.target.value);
                      if (errorMsg) setErrorMsg('');
                    }}
                    placeholder="Type staff full name processing this RMA (required for Scrap, Restock & Waiting)"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                  />
                </div>
              </div>
            )}

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
                    Tap one of the 4 simple choices below ({isSupplierStream ? 'Supplier RTV' : 'Customer Hub'}). Everything updates automatically.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {optionsList.map((opt) => {
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
                        className={`p-4 rounded-2xl border-2 text-left transition-all flex flex-col justify-between gap-2 cursor-pointer ${
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
                          className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                          <span>Save Choice Only (Waiting for Driver)</span>
                        </button>

                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => handleSaveSimpleDecision(chosenOptionObj.id, false)}
                          className="px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs sm:text-sm font-black flex items-center justify-center gap-2 transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
                        >
                          <Truck className="w-4 h-4 shrink-0" />
                          <span>
                            {isAlreadyPickedUp
                              ? 'Edit Pickup Details, Emails & Photos →'
                              : 'Driver Is Here — Upload Photos & Print Letter →'}
                          </span>
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* Re-Order Replacement Stock? YES / NO toggle when Scrap is selected */}
                        {chosenOptionObj.id === 'scrap' && (
                          <div className="p-3 rounded-xl bg-slate-800 border border-slate-700 space-y-2">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-xs font-black text-white">
                                Re-Order Replacement Stock?
                              </span>
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                                scrapNeedsReorder
                                  ? 'bg-amber-400 text-slate-950'
                                  : 'bg-slate-700 text-slate-300'
                              }`}>
                                {scrapNeedsReorder ? 'YES — Queue for Supplier Re-Order' : 'NO — Write-Off Only'}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => setScrapNeedsReorder(true)}
                                className={`py-2 px-3 rounded-xl text-xs font-black transition-all cursor-pointer ${
                                  scrapNeedsReorder
                                    ? 'bg-amber-500 text-slate-950 ring-2 ring-amber-300/60 shadow-sm'
                                    : 'bg-slate-900 text-slate-300 border border-slate-600 hover:bg-slate-700'
                                }`}
                              >
                                YES — Re-Order Stock
                              </button>
                              <button
                                type="button"
                                onClick={() => setScrapNeedsReorder(false)}
                                className={`py-2 px-3 rounded-xl text-xs font-black transition-all cursor-pointer ${
                                  !scrapNeedsReorder
                                    ? 'bg-rose-600 text-white ring-2 ring-rose-400/60 shadow-sm'
                                    : 'bg-slate-900 text-slate-300 border border-slate-600 hover:bg-slate-700'
                                }`}
                              >
                                NO — Do Not Re-Order
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Editable Lifecycle Email Recipients before Confirm & Save */}
                        <div className="text-left">
                          <EmailRecipientsEditor
                            emailType={chosenOptionObj.id === 'scrap' ? 'rma_scrapped' : 'rma_restocked'}
                            value={wizardCustomRecipients}
                            onChange={setWizardCustomRecipients}
                            compact={true}
                            defaultExpanded={false}
                            isTestMode={isTest}
                            title="Lifecycle Email Recipients"
                            extraHint="Customer AE email is appended automatically to CC if present."
                          />
                        </div>

                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => handleSaveSimpleDecision(chosenOptionObj.id, false)}
                          className="w-full px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-black flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                          <span>{isSaving ? uploadProgress : `Confirm & Save: ${chosenOptionObj.title}`}</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* STEP 2: Supplier & Email Recipients + 5 Multi-Photo Categories + AI Driver ID Fill + Generate Letter Form */}
            {step === 'pickup' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                        <Truck className="w-5 h-5 text-amber-600" />
                        <span>Driver Pickup Verification ({completedPhotoCount}/5 Slots)</span>
                      </h3>
                      <span className="px-2.5 py-0.5 rounded-full bg-slate-900 dark:bg-slate-700 text-white text-[11px] font-mono font-black">
                        Total: {totalPhotoCount}/{MAX_TOTAL_PICKUP_PHOTOS} photos
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Purpose: <strong className="text-slate-800 dark:text-slate-200">{chosenOptionObj?.title}</strong> • Max {MAX_PHOTOS_PER_SLOT} photos per slot ({MAX_TOTAL_PICKUP_PHOTOS} max total) — all auto-save into this RMA&apos;s Google Drive folder.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStep('choose')}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> Back
                  </button>
                </div>

                {/* Party Name * + Party Email To + CC(s) */}
                <div className={`p-4 rounded-xl border-2 space-y-3 ${
                  supplierMissing
                    ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-400 dark:border-amber-600'
                    : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'
                }`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
                      <Building2 className="w-4 h-4 text-amber-600" />
                      <span>
                        {isSupplierStream
                          ? 'Supplier & Claim Email Recipients'
                          : 'Customer / Store & Handover Email Recipients'}
                      </span>
                    </div>
                    {effectiveClaimNumber && (
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 font-mono text-[10px] font-black">
                        {isSupplierStream ? `Claim ID Kept: ${effectiveClaimNumber}` : `Ref Kept: ${effectiveClaimNumber}`}
                      </span>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {isSupplierStream ? 'Supplier Company Name *' : 'Customer / Store Branch Name *'}
                    </label>
                    <input
                      type="text"
                      list="supplier-rtv-company-list-step2"
                      value={supplierName}
                      onChange={(e) => setSupplierName(e.target.value)}
                      placeholder={
                        isSupplierStream
                          ? 'Type or pick the Supplier Company Name...'
                          : 'Type or pick Customer / Store Branch Name...'
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs sm:text-sm font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none"
                    />
                    <datalist id="supplier-rtv-company-list-step2">
                      {activePartySuggestions.map((sup) => (
                        <option key={sup} value={sup} />
                      ))}
                    </datalist>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        <Mail className="w-3.5 h-3.5 text-slate-400" />
                        <span>
                          {isSupplierStream
                            ? 'Supplier Email — Main Recipient (To)'
                            : 'Customer / Store Email — Main Recipient (To)'}
                        </span>
                      </label>
                      <input
                        type="email"
                        value={supplierEmailTo}
                        onChange={(e) => setSupplierEmailTo(e.target.value)}
                        placeholder={isSupplierStream ? 'e.g. claims@supplier.com' : 'e.g. branch.manager@customer.com'}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        <Mail className="w-3.5 h-3.5 text-slate-400" />
                        <span>{isSupplierStream ? 'Supplier Email — CC(s)' : 'Customer / Store Email — CC(s)'}</span>
                      </label>
                      <input
                        type="text"
                        value={supplierEmailCc}
                        onChange={(e) => setSupplierEmailCc(e.target.value)}
                        placeholder={
                          isSupplierStream
                            ? 'comma-separated (e.g. rep@supplier.com, billing@supplier.com)'
                            : 'comma-separated (e.g. accounting@customer.com)'
                        }
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none"
                      />
                    </div>
                  </div>

                  {/* Base Internal / Finance Recipients for Pickup Email */}
                  <div className="pt-1">
                    <EmailRecipientsEditor
                      emailType={(selectedOption === 'supplier_exchange' || selectedOption === 'customer_exchange') ? 'pickup_replacement' : 'pickup_debit_claim'}
                      value={wizardCustomRecipients}
                      onChange={setWizardCustomRecipients}
                      compact={true}
                      defaultExpanded={false}
                      isTestMode={isTest}
                      title="Base Internal / Finance Email Recipients"
                      extraHint={
                        isSupplierStream
                          ? 'Any Supplier Email To / CC entered above merges cleanly with these base recipients.'
                          : 'Any Customer / Store Email To / CC entered above merges cleanly with these base recipients.'
                      }
                    />
                  </div>
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
                    {(isScanningId || isScanningPlate) ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : <Sparkles className="w-4 h-4 shrink-0" />}
                    <span>{ocrNotice.text}</span>
                  </div>
                )}

                {/* 5 Photo Checklist Grid (Max 10 photos per category / 50 total) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {PICKUP_PHOTO_SLOTS.map((slot) => {
                    const slotPhotos = Array.isArray(photoSlots[slot.key]) ? photoSlots[slot.key] : [];
                    const hasImage = slotPhotos.length > 0;
                    const atSlotLimit = slotPhotos.length >= MAX_PHOTOS_PER_SLOT || totalPhotoCount >= MAX_TOTAL_PICKUP_PHOTOS;
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
                            <div className="flex items-center gap-1.5 flex-wrap">
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
                          <div className="flex items-center gap-1 shrink-0">
                            <span className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-black ${
                              hasImage
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                            }`}>
                              ({slotPhotos.length}/{MAX_PHOTOS_PER_SLOT})
                            </span>
                            {hasImage && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                          </div>
                        </div>

                        {hasImage && (
                          <div className="grid grid-cols-3 gap-1.5">
                            {slotPhotos.map((entry, idx) => (
                              <div
                                key={entry.id || `${slot.key}-${idx}`}
                                className="relative h-20 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 group"
                              >
                                <img
                                  src={entry.previewUrl}
                                  alt={`${slot.title} #${idx + 1}`}
                                  className="w-full h-full object-cover"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleRemovePhoto(slot.key, entry.id)}
                                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-slate-950/85 hover:bg-rose-600 text-white flex items-center justify-center shadow transition-colors cursor-pointer"
                                  aria-label={`Remove photo ${idx + 1} from ${slot.title}`}
                                  title="Remove photo"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                                {entry.existingUrl && !entry.file && (
                                  <span className="absolute bottom-0.5 left-0.5 px-1 py-0.5 rounded bg-slate-900/80 text-white text-[8px] font-bold">
                                    Drive
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 mt-auto">
                          <label className={`px-2.5 py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors ${
                            atSlotLimit
                              ? 'cursor-not-allowed bg-slate-300 dark:bg-slate-800 text-slate-500 opacity-60'
                              : 'cursor-pointer bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white'
                          }`}>
                            <Camera className="w-3.5 h-3.5" />
                            <span>Take Photo</span>
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="hidden"
                              onChange={(e) => {
                                handleSelectPhotos(slot.key, e.target.files);
                                e.target.value = '';
                              }}
                            />
                          </label>

                          <label className={`px-2.5 py-2 rounded-lg border text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors ${
                            atSlotLimit
                              ? 'cursor-not-allowed bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-400 opacity-60'
                              : 'cursor-pointer bg-white hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200'
                          }`}>
                            <Upload className="w-3.5 h-3.5" />
                            <span>Choose Files</span>
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              className="hidden"
                              onChange={(e) => {
                                handleSelectPhotos(slot.key, e.target.files);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Auto-filled Driver Info, Valid Gov't ID, Truck Plate & Manual Processed By */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
                      <UserCheck className="w-4 h-4 text-emerald-600" />
                      <span>Driver / Representative, Truck &amp; Staff Details (Printed on Letter Form)</span>
                    </div>
                    <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                      Accepts ANY Valid PH Gov’t or Legal ID
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                        Driver / Rep Full Name *
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
                        Valid Gov’t / Legal ID Type
                      </label>
                      <select
                        value={driverIdType}
                        onChange={(e) => setDriverIdType(e.target.value)}
                        className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-white"
                      >
                        {!PH_LEGAL_ID_TYPES.includes(driverIdType) && driverIdType && (
                          <option value={driverIdType}>{driverIdType}</option>
                        )}
                        {PH_LEGAL_ID_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                        Valid ID Number
                      </label>
                      <input
                        type="text"
                        value={driverLicenseNo}
                        onChange={(e) => setDriverLicenseNo(e.target.value)}
                        placeholder="ID # / License # from photo"
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

                  <div className={`p-3 rounded-xl border ${
                    processedByMissing
                      ? 'bg-amber-50/70 dark:bg-amber-950/20 border-amber-300 dark:border-amber-700'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'
                  }`}>
                    <label
                      htmlFor="wizard-processed-by-step2"
                      className="flex items-center gap-1.5 text-[11px] font-black text-slate-700 dark:text-slate-200 mb-1"
                    >
                      <span>Processed By (Staff Full Name) *</span>
                      {processedByMissing && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 text-[9px]">
                          Required
                        </span>
                      )}
                    </label>
                    <input
                      id="wizard-processed-by-step2"
                      type="text"
                      value={processedBy}
                      onChange={(e) => {
                        setProcessedBy(e.target.value);
                        if (errorMsg) setErrorMsg('');
                      }}
                      placeholder="Type staff full name preparing & releasing this pickup"
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none"
                    />
                  </div>

                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Note: Pickup Date &amp; Time, Driver Contact #, Driver Signature, and Releasing Staff&apos;s Signature stay blank on the printed Letter sheet so both parties can sign &amp; fill physically at handover.
                  </p>
                </div>

                {/* Final Confirm Button */}
                <button
                  type="button"
                  disabled={isSaving || isScanningId || isScanningPlate}
                  onClick={handleCompletePickupAndGenerateForm}
                  className="w-full px-5 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black flex items-center justify-center gap-2 shadow-md transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileCheck2 className="w-5 h-5" />}
                  <span>
                    {isSaving
                      ? (uploadProgress || 'Saving & uploading photos...')
                      : isAlreadyPickedUp
                        ? (newPendingPhotoCount > 0
                          ? `Upload ${newPendingPhotoCount} New Photo${newPendingPhotoCount === 1 ? '' : 's'}, Save Updates & Open Letter Form`
                          : 'Save Updates & Open Letter Form (No Duplicate Claim ID)')
                        : `Upload ${totalPhotoCount} Photo${totalPhotoCount === 1 ? '' : 's'} to RMA Drive, Mark PICKED UP & Print Letter Form`}
                  </span>
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
                    {currentOutcome.label}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1">
                    {isAlreadyPickedUp
                      ? 'Print the Letter-size validation sheet (compact 2-copy cut sheet for 1–4 items, or full page per copy for 5+ items), and have both driver & staff sign.'
                      : 'The RMA record has been updated and is ready for warehouse tracking or driver pickup anytime.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
                  {isAlreadyPickedUp && (
                    <button
                      type="button"
                      onClick={() => setShowA4Form(true)}
                      className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-black flex items-center gap-2 cursor-pointer"
                    >
                      <FileCheck2 className="w-4 h-4" />
                      <span>Open Letter {existingFormLabel}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setStep('choose')}
                    className="px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 text-xs sm:text-sm font-bold cursor-pointer"
                  >
                    Edit Choice / Details
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-black flex items-center gap-1 cursor-pointer"
                  >
                    <span>Done</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Dual-Copy Letter Printable Form Modal */}
      <SupplierPickupFormModal
        isOpen={showA4Form}
        onClose={() => setShowA4Form(false)}
        report={activeReport}
        reports={activeBatchReports}
        allReports={allReports}
        catalogProducts={catalogProducts}
      />
    </>
  );
}
