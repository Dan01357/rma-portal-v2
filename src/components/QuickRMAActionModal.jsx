import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Mail,
  Package,
  Receipt,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Printer,
  Edit3,
  Building2,
  Sparkles,
  RefreshCw,
  Tag,
  Shield,
  KeyRound,
  ArrowLeft,
  Folder,
  Copy,
  Scissors,
  Truck,
  Plus,
  Minus,
  ArrowRightLeft,
  Info,
  FileText,
  FileCheck2,
  Zap
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { authService } from '../services/authService';
import { catalogService } from '../services/catalogService';
import {
  isSplitChildTicket,
  isSplitParentTicket,
  hasAssignedSku,
  cleanExplanationText,
  mapReasonToConditionGrade,
  normalizeWarehouseLocation,
  getRealPhotos,
  isUnlabeledBarcode,
  isTestRecord,
  formatFourChoiceOutcome,
  getItemNeedsReorder,
  formatDateYmd,
  doesCreditMemoLinkReport
} from '../utils/rmaHelpers';
import { copyTextSafe } from '../utils/clipboard';
import RMATimelineAudit from './RMATimelineAudit';
import ProductAutoSuggest from './ProductAutoSuggest';

const QUICK_AUTH_STORAGE_KEY = 'rma_quick_auth_admin';

function resolveSplitMetadata(choiceValue, timestamp, actorName, isTest) {
  const val = String(choiceValue || '').trim();
  const baseMeta = isTest ? { is_test: true, test_mode: true } : {};
  if (val === 'restock_good') {
    return {
      ...baseMeta,
      simple_rtv_disposition: 'restock_good',
      simple_rtv_label: 'Put Back on Good Shelf (Restock)',
      simple_rtv_updated_at: timestamp,
      simple_rtv_updated_by: actorName,
      needs_reorder: false
    };
  }
  if (val === 'scrap') {
    return {
      ...baseMeta,
      simple_rtv_disposition: 'scrap',
      simple_rtv_label: 'Throw Away / Dispose (Scrap)',
      simple_rtv_updated_at: timestamp,
      simple_rtv_updated_by: actorName,
      needs_reorder: true
    };
  }
  if (val === 'supplier_credit' || val === 'customer_credit') {
    return {
      ...baseMeta,
      simple_rtv_disposition: val,
      simple_rtv_updated_at: timestamp,
      simple_rtv_updated_by: actorName,
      needs_reorder: false
    };
  }
  if (val === 'supplier_exchange' || val === 'customer_exchange') {
    return {
      ...baseMeta,
      simple_rtv_disposition: val,
      simple_rtv_updated_at: timestamp,
      simple_rtv_updated_by: actorName,
      needs_reorder: false
    };
  }
  return baseMeta;
}

function resolveSplitLocation(choiceValue, report) {
  if (choiceValue === 'restock_good') return 'Good Stock Area';
  if (choiceValue === 'scrap') return 'Disposal / Scrap Area';
  if (choiceValue === 'supplier_credit' || choiceValue === 'supplier_exchange') return 'Supplier Return Area (RTV)';
  if (choiceValue === 'customer_credit' || choiceValue === 'customer_exchange') return 'Customer Return Area';
  return normalizeWarehouseLocation(report?.warehouse_location, report);
}

function resolveSplitDbStatus(choiceValue, isSupplier) {
  if (isSupplier && (choiceValue === 'supplier_credit' || choiceValue === 'supplier_exchange')) {
    return 'vendor_claimed';
  }
  return 'under_inspection';
}

export default function QuickRMAActionModal({
  isOpen,
  onClose,
  rmaNumber,
  currentUser,
  onAdminVerified,
  savedProductsList = [],
  creditMemosList = [],
  recentReportsList = [],
  onAssignSku,
  onOpenCreditMemo,
  onViewCreditMemoVoucher,
  onViewReportQR,
  onOpenLightbox,
  onReportUpdated,
  onRefresh,
  gateSession = null,
  onOpenSimpleSupplierWizard,
  onOpenSupplierPickupForm
}) {
  const [report, setReport] = useState(null);
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  const [reportError, setReportError] = useState(null);
  const [syncAttempt, setSyncAttempt] = useState(1);
  const [retryTrigger, setRetryTrigger] = useState(0);

  const [isUpdatingType, setIsUpdatingType] = useState(false);
  const [typeFeedback, setTypeFeedback] = useState(null);

  // Multi-Item Manifest Line-Item Count Check
  const [manifestItems, setManifestItems] = useState([]);

  // Partial Triage & Line Item Split State
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitPart1Qty, setSplitPart1Qty] = useState(1);
  const [splitPart1Choice, setSplitPart1Choice] = useState('restock_good');
  const [splitPart2Choice, setSplitPart2Choice] = useState('scrap');
  const [splitPart2Reason, setSplitPart2Reason] = useState('Damaged packaging / Defective units');
  const [isExecutingSplit, setIsExecutingSplit] = useState(false);
  const [splitSuccessMessage, setSplitSuccessMessage] = useState('');

  // Official Logistics Paperwork (SI / DR / PO), Supplier & Metadata Overrides
  const [adminSiNumber, setAdminSiNumber] = useState('');
  const [adminDrNumber, setAdminDrNumber] = useState('');
  const [adminPoNumber, setAdminPoNumber] = useState('');
  const [adminSupplierName, setAdminSupplierName] = useState('');
  const [adminExpiryDate, setAdminExpiryDate] = useState('');

  // Super Admin Silent Restitution & Product Details Hooks
  const [adminRmaNumber, setAdminRmaNumber] = useState('');
  const [adminCreatedAt, setAdminCreatedAt] = useState('');
  const [adminIsTest, setAdminIsTest] = useState(false);
  const [adminProductName, setAdminProductName] = useState('');
  const [adminBarcode, setAdminBarcode] = useState('');
  const [adminSku, setAdminSku] = useState('');
  const [adminQuantity, setAdminQuantity] = useState(1);
  const [adminUnitName, setAdminUnitName] = useState('pc');
  const [adminPrice, setAdminPrice] = useState(0);
  const [adminPriceWithVat, setAdminPriceWithVat] = useState(0);
  const [adminPiecesPerCase, setAdminPiecesPerCase] = useState(null);

  const [isEditingAiDetails, setIsEditingAiDetails] = useState(false);
  const isEditingAiDetailsRef = useRef(false);
  isEditingAiDetailsRef.current = isEditingAiDetails;
  const [isSavingAiDetails, setIsSavingAiDetails] = useState(false);
  const [copyDrSuccess, setCopyDrSuccess] = useState(false);

  // Authentication & Verification State
  const [verifiedAdmin, setVerifiedAdmin] = useState(null);
  const [authStep, setAuthStep] = useState('email'); // 'email' | 'otp'
  const [emailInput, setEmailInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [isVerifying, setIsVerifying] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authSuccessMsg, setAuthSuccessMsg] = useState(null);

  // Reclassify RMA Type between customer_inbound and supplier_outbound
  const handleToggleRmaType = async (newType) => {
    if (!report || isUpdatingType) return;
    const currentType = report.rma_type || 'customer_inbound';
    if (currentType === newType) return;

    setIsUpdatingType(true);
    setTypeFeedback(null);
    try {
      const curDisp = String(report.ai_document_metadata?.simple_rtv_disposition || report.disposition || '').toLowerCase();
      let targetDisposition;
      let targetStatus = 'under_inspection';

      if (newType === 'customer_inbound') {
        if (curDisp === 'supplier_credit') targetDisposition = 'customer_credit';
        else if (curDisp === 'supplier_exchange') targetDisposition = 'customer_exchange';
        else if (curDisp === 'scrap' || curDisp === 'restock_good') targetDisposition = curDisp;
        else targetDisposition = 'Pending Triage';
      } else {
        if (curDisp === 'customer_credit') {
          targetDisposition = 'supplier_credit';
          targetStatus = 'vendor_claimed';
        } else if (curDisp === 'customer_exchange') {
          targetDisposition = 'supplier_exchange';
          targetStatus = 'vendor_claimed';
        } else if (curDisp === 'scrap' || curDisp === 'restock_good') {
          targetDisposition = curDisp;
        } else {
          targetDisposition = '3- Return to Vendor (RTV)';
        }
      }

      const updatedMeta = { ...(report.ai_document_metadata || {}) };
      if (['supplier_credit', 'customer_credit', 'supplier_exchange', 'customer_exchange', 'scrap', 'restock_good'].includes(targetDisposition)) {
        updatedMeta.simple_rtv_disposition = targetDisposition;
      }

      const updatedReport = {
        ...report,
        rma_type: newType,
        disposition: targetDisposition,
        status: targetStatus,
        ai_document_metadata: updatedMeta
      };
      setReport(updatedReport);

      if (onReportUpdated) {
        onReportUpdated(updatedReport);
      }

      const cleanId = report.id || report.rma_number;
      const savedData = await catalogService.updateRMAType(cleanId, newType, targetDisposition, targetStatus);
      const finalReport = { ...updatedReport, ...(savedData || {}), ai_document_metadata: updatedMeta };
      setReport(finalReport);

      setTypeFeedback(newType === 'customer_inbound' ? 'Moved to Customer Hub (Inbound)' : 'Moved to Supplier RTV Hub (Outbound)');
      setTimeout(() => setTypeFeedback(null), 3000);

      if (onRefresh) {
        onRefresh(finalReport);
      }
      try {
        window.dispatchEvent(new CustomEvent('rma-data-changed', {
          detail: { type: 'report-updated', report: finalReport }
        }));
      } catch {}
    } catch (err) {
      console.error('Failed to update RMA type:', err);
      const revertedReport = { ...report, rma_type: currentType };
      setReport(revertedReport);
      if (onReportUpdated) {
        onReportUpdated(revertedReport);
      }
      alert(`Could not switch return type: ${err.message}`);
    } finally {
      setIsUpdatingType(false);
    }
  };

  // Synchronize split and manifest items when report updates
  useEffect(() => {
    if (!report) {
      setManifestItems([]);
      return;
    }

    const qty = Number(report.quantity) || 1;
    if (qty > 1) {
      setSplitPart1Qty(Math.max(1, qty - 1));
      setSplitPart2Reason(report.reason || 'Damaged packaging / Defective units');
    }

    const directItems = Array.isArray(report.items) && report.items.length > 0
      ? report.items
      : (typeof report.items === 'string' && report.items.trim()
          ? (() => { try { const p = JSON.parse(report.items); return Array.isArray(p) ? p : []; } catch { return []; } })()
          : []);

    if (directItems.length > 0) {
      setManifestItems(directItems);
    } else if (report.id) {
      supabase.from('rma_items')
        .select('*')
        .eq('rma_report_id', report.id)
        .then(({ data, error }) => {
          if (!error && Array.isArray(data) && data.length > 1) {
            setManifestItems(data);
          } else {
            setManifestItems([]);
          }
        })
        .catch(() => setManifestItems([]));
    } else {
      setManifestItems([]);
    }
  }, [report]);

  const totalSplitQty = Number(report?.quantity) || 0;
  const maxSplitVal = Math.max(1, totalSplitQty - 1);
  const derivedPart2Qty = Math.max(1, totalSplitQty - (parseInt(splitPart1Qty, 10) || 1));

  const handleSplitPart1Change = (val) => {
    if (val === '') {
      setSplitPart1Qty('');
      return;
    }
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed)) {
      if (parsed > maxSplitVal) setSplitPart1Qty(maxSplitVal);
      else if (parsed < 1) setSplitPart1Qty(1);
      else setSplitPart1Qty(parsed);
    }
  };

  const handleSplitPart2Change = (val) => {
    if (val === '') {
      setSplitPart1Qty(maxSplitVal);
      return;
    }
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed)) {
      const clampedP2 = Math.max(1, Math.min(maxSplitVal, parsed));
      setSplitPart1Qty(totalSplitQty - clampedP2);
    }
  };

  const handleSplitPart1Blur = () => {
    const parsed = parseInt(splitPart1Qty, 10);
    if (isNaN(parsed) || parsed < 1) setSplitPart1Qty(1);
    else if (parsed > maxSplitVal) setSplitPart1Qty(maxSplitVal);
    else setSplitPart1Qty(parsed);
  };

  const stepSplitPart1 = (delta) => {
    const current = parseInt(splitPart1Qty, 10) || 1;
    const next = Math.max(1, Math.min(maxSplitVal, current + delta));
    setSplitPart1Qty(next);
  };

  const stepSplitPart2 = (delta) => {
    stepSplitPart1(-delta);
  };

  const handleSwapSplit = () => {
    const p1 = parseInt(splitPart1Qty, 10) || 1;
    const p2 = totalSplitQty - p1;
    if (p2 >= 1 && p2 <= maxSplitVal) {
      setSplitPart1Qty(p2);
    }
  };

  const handleExecuteSplit = async () => {
    if (!report || isExecutingSplit) return;
    const totalQty = Number(report.quantity) || 0;
    const p1Qty = parseInt(splitPart1Qty, 10);
    const p2Qty = totalQty - p1Qty;

    if (isNaN(p1Qty) || p1Qty < 1 || p2Qty < 1 || p1Qty + p2Qty !== totalQty) {
      alert(`Invalid split quantities. Part 1 must be between 1 and ${Math.max(1, totalQty - 1)}.`);
      return;
    }

    setIsExecutingSplit(true);
    try {
      const inspectorName = verifiedAdmin?.name || currentUser?.name || 'Warehouse Staff';
      const reportIsTest = isTestRecord(report);
      const isSupplier = report.rma_type === 'supplier_outbound';

      let childRmaNumber = `${report.rma_number}-B`;
      const { data: existingChild } = await supabase
        .from('rma_reports')
        .select('rma_number')
        .eq('rma_number', childRmaNumber)
        .maybeSingle();

      if (existingChild) {
        childRmaNumber = `${report.rma_number}-C`;
        const { data: existingChildC } = await supabase
          .from('rma_reports')
          .select('rma_number')
          .eq('rma_number', childRmaNumber)
          .maybeSingle();
        if (existingChildC) {
          childRmaNumber = `${report.rma_number}-D`;
        }
      }

      const timestamp = new Date().toISOString();
      const autoGrade = mapReasonToConditionGrade(report.reason);
      const p1Disp = splitPart1Choice === 'pending'
        ? (isSupplier ? '3- Return to Vendor (RTV)' : 'Pending Triage')
        : splitPart1Choice;
      const p2Disp = splitPart2Choice === 'pending'
        ? (isSupplier ? '3- Return to Vendor (RTV)' : 'Pending Triage')
        : splitPart2Choice;

      const p1Meta = {
        ...(report.ai_document_metadata && typeof report.ai_document_metadata === 'object' ? report.ai_document_metadata : {}),
        ...resolveSplitMetadata(splitPart1Choice, timestamp, inspectorName, reportIsTest)
      };
      const p2Meta = resolveSplitMetadata(splitPart2Choice, timestamp, inspectorName, reportIsTest);

      const childBaseNotes = `Split from parent ticket ${report.rma_number} (${p2Qty} of ${totalQty} units).`;
      const childNotes = reportIsTest ? `[TEST_MODE] ${childBaseNotes}` : childBaseNotes;

      const childPayload = {
        rma_number: childRmaNumber,
        barcode: report.barcode,
        code: report.code,
        name: report.name,
        supplier_name: report.supplier_name || 'Pending Assignment',
        price: report.price || 0,
        price_with_vat: report.price_with_vat || 0,
        unit_name: report.unit_name || 'pc',
        quantity: p2Qty,
        total_quantity: p2Qty,
        condition_grade: autoGrade,
        disposition: p2Disp,
        warehouse_location: resolveSplitLocation(splitPart2Choice, report),
        status: resolveSplitDbStatus(splitPart2Choice, isSupplier),
        reason: splitPart2Reason || report.reason || 'Damaged packaging / Defective units',
        explanation: `Split from ${report.rma_number} (${p2Qty} of ${totalQty} units).`,
        parent_rma_id: report.id,
        items: Array.isArray(report.items) && report.items.length > 0
          ? [{ ...report.items[0], quantity: p2Qty, reason: splitPart2Reason || report.reason }]
          : [],
        photos: getRealPhotos(report.photos),
        paperwork_photos: report.paperwork_photos || [],
        store_branch: report.store_branch,
        si_number: report.si_number,
        dr_number: report.dr_number,
        po_number: report.po_number,
        invoice_dr_number: report.invoice_dr_number,
        reporter_name: report.reporter_name,
        reporter_contact: report.reporter_contact,
        reported_by: report.reported_by,
        ae_name: report.ae_name,
        ae_email: report.ae_email,
        company: report.company,
        rma_type: report.rma_type || 'customer_inbound',
        inspected_by: inspectorName,
        inspected_at: timestamp,
        ai_document_metadata: p2Meta,
        notes: childNotes,
        audit_trail: [
          {
            timestamp,
            stage: 'SPLIT_CREATED',
            actor: inspectorName,
            disposition: p2Disp,
            note: `Created via partial split from ${report.rma_number} (${p2Qty} ${report.unit_name || 'pcs'})`
          }
        ]
      };

      const { data: newChild, error: childError } = await supabase
        .from('rma_reports')
        .insert([childPayload])
        .select('*')
        .single();

      if (childError) throw childError;

      const existingAudit = Array.isArray(report.audit_trail) ? [...report.audit_trail] : [];
      const parentUpdates = {
        quantity: p1Qty,
        total_quantity: p1Qty,
        status: resolveSplitDbStatus(splitPart1Choice, isSupplier),
        disposition: p1Disp,
        warehouse_location: resolveSplitLocation(splitPart1Choice, report),
        inspected_by: inspectorName,
        inspected_at: timestamp,
        ai_document_metadata: p1Meta,
        items: Array.isArray(report.items) && report.items.length > 0
          ? report.items.map((it, idx) => idx === 0 ? { ...it, quantity: p1Qty } : it)
          : report.items,
        notes: `${report.notes ? report.notes + ' | ' : ''}Split: Kept ${p1Qty} units, split ${p2Qty} units to ${childRmaNumber}`,
        audit_trail: [
          ...existingAudit,
          {
            timestamp,
            stage: 'SPLIT_EXECUTED',
            actor: inspectorName,
            disposition: p1Disp,
            note: `Split ticket: Kept ${p1Qty} units on ${report.rma_number}, created ${childRmaNumber} with ${p2Qty} units`
          }
        ]
      };

      const { data: updatedParent, error: parentError } = await supabase
        .from('rma_reports')
        .update(parentUpdates)
        .eq('id', report.id)
        .select('*')
        .single();

      if (parentError) throw parentError;

      const finalParent = updatedParent || { ...report, ...parentUpdates };
      setReport(finalParent);
      setIsSplitting(false);
      setSplitSuccessMessage(`Successfully split: Kept ${p1Qty} ${report.unit_name || 'pcs'} on this ticket, and created new ticket ${childRmaNumber} with ${p2Qty} ${report.unit_name || 'pcs'}!`);
      setTimeout(() => setSplitSuccessMessage(''), 10000);

      if (onRefresh) {
        onRefresh(finalParent, newChild);
      }
      window.dispatchEvent(new CustomEvent('rma-data-changed', { detail: { type: 'item-split', parentId: report.id, childId: newChild?.id } }));
    } catch (err) {
      console.error('Failed to execute split:', err);
      alert(`Split failed: ${err.message}`);
    } finally {
      setIsExecutingSplit(false);
    }
  };

  // Check if current logged-in user is already admin/super admin OR has an active verified portal session
  useEffect(() => {
    if (!isOpen) return;

    if (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'admin')) {
      setVerifiedAdmin(currentUser);
      return;
    }

    let resolvedGate = gateSession;
    if (!resolvedGate) {
      try {
        const raw = localStorage.getItem('rma_portal_gate_session');
        if (raw) resolvedGate = JSON.parse(raw);
      } catch {}
    }

    if (resolvedGate && (resolvedGate.authorized_email || resolvedGate.stream_type === 'supplier_outbound')) {
      const notExpired = !resolvedGate.expires_at || new Date(resolvedGate.expires_at) > new Date();
      if (notExpired) {
        setVerifiedAdmin({
          name: resolvedGate.user_name || resolvedGate.profileName || resolvedGate.authorized_email || 'Authorized Staff',
          email: resolvedGate.user_email || resolvedGate.authorized_email || '',
          role: 'staff',
          isGateAuthorized: true,
          stream_type: resolvedGate.stream_type,
          is_test: Boolean(resolvedGate.is_test)
        });
        return;
      }
    }

    try {
      const cached = sessionStorage.getItem(QUICK_AUTH_STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && (parsed.role === 'super_admin' || parsed.role === 'admin')) {
          setVerifiedAdmin(parsed);
          return;
        }
      }
    } catch {}

    setVerifiedAdmin(null);
    setAuthStep('email');
    setOtpInput('');
  }, [isOpen, currentUser, gateSession]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // 1. Primary fetch when modal opens, rmaNumber changes, or manual retry requested
  useEffect(() => {
    if (!isOpen || !rmaNumber) {
      setReport(null);
      setReportError(null);
      setIsLoadingReport(false);
      setSyncAttempt(1);
      return;
    }

    let isMounted = true;
    const cleanRma = String(rmaNumber).trim();

    if (report && (
      String(report.rma_number || '').toUpperCase() === cleanRma.toUpperCase() ||
      String(report.id) === cleanRma
    )) {
      setIsLoadingReport(false);
      setReportError(null);
      return;
    }

    const findInReports = (list) => {
      if (!Array.isArray(list) || !cleanRma) return null;
      const target = cleanRma.toUpperCase();
      return list.find(r => (String(r.rma_number || '').toUpperCase() === target && !r.parent_rma_id) || String(r.id) === cleanRma)
          || list.find(r => String(r.rma_number || '').toUpperCase() === target);
    };

    const immediateMatch = findInReports(recentReportsList);
    if (immediateMatch) {
      setReport(immediateMatch);
      setIsLoadingReport(false);
      setReportError(null);
      return;
    }

    setIsLoadingReport(true);
    setReportError(null);
    setSyncAttempt(1);

    (async () => {
      const maxAttempts = 12;
      let foundRecord = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (!isMounted) return;
        setSyncAttempt(attempt);

        const tickMatch = findInReports(recentReportsList);
        if (tickMatch) {
          foundRecord = tickMatch;
          break;
        }

        try {
          let query = supabase.from('rma_reports').select('*');
          if (/^\d+$/.test(cleanRma)) {
            query = query.or(`rma_number.ilike.${cleanRma},id.eq.${cleanRma}`);
          } else {
            query = query.ilike('rma_number', cleanRma);
          }

          const { data, error } = await query;
          if (!error && Array.isArray(data) && data.length > 0) {
            foundRecord = data.find(d => !d.parent_rma_id) || data[0];
            break;
          }
        } catch (e) {
          console.warn(`RMA sync attempt ${attempt} notice:`, e?.message);
        }

        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      if (!isMounted) return;

      if (foundRecord) {
        setReport(foundRecord);
        setIsLoadingReport(false);
        setReportError(null);
      } else {
        setIsLoadingReport(false);
        setReportError(`No return report found matching "${cleanRma}". The record may still be syncing to the cloud or the QR code may be invalid.`);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [isOpen, rmaNumber, retryTrigger]);

  // 2. Silent background sync when recentReportsList updates
  useEffect(() => {
    if (!isOpen || !rmaNumber || !recentReportsList.length) return;
    const cleanRma = String(rmaNumber).trim().toUpperCase();
    const match = recentReportsList.find(
      r => (String(r.rma_number || '').toUpperCase() === cleanRma && !r.parent_rma_id) ||
           String(r.id) === cleanRma
    ) || recentReportsList.find(
      r => String(r.rma_number || '').toUpperCase() === cleanRma
    );
    if (match) {
      setReport(prev => {
        if (!prev) return match;
        if (!prev.parent_rma_id && match.parent_rma_id) return prev;
        if (prev.rma_type && match.rma_type && prev.rma_type !== match.rma_type) return prev;
        if (
          prev.status !== match.status ||
          prev.disposition !== match.disposition ||
          prev.warehouse_location !== match.warehouse_location ||
          prev.supplier_name !== match.supplier_name ||
          prev.code !== match.code ||
          prev.name !== match.name ||
          prev.notes !== match.notes ||
          prev.updated_at !== match.updated_at ||
          JSON.stringify(prev.ai_document_metadata) !== JSON.stringify(match.ai_document_metadata)
        ) {
          return match;
        }
        return prev;
      });
    }
  }, [isOpen, rmaNumber, recentReportsList]);

  // Extract unique known suppliers for suggestion autocomplete
  const knownSuppliers = useMemo(() => {
    const set = new Set();
    (savedProductsList || []).forEach(p => {
      const s = (p.supplier_name || p.supplierName || '').trim();
      if (s && s !== 'Pending Assignment' && s !== 'Unassigned' && s !== 'Warehouse') {
        set.add(s);
      }
    });
    (recentReportsList || []).forEach(r => {
      const s = (r.supplier_name || '').trim();
      if (s && s !== 'Pending Assignment' && s !== 'Unassigned' && s !== 'Warehouse') {
        set.add(s);
      }
    });
    return Array.from(set).sort();
  }, [savedProductsList, recentReportsList]);

  // Reset edit mode only when opening modal or switching to a different RMA ticket
  useEffect(() => {
    setIsEditingAiDetails(false);
  }, [isOpen, report?.id, report?.rma_number]);

  // Synchronize AI-extracted or existing paperwork document details whenever report changes (unless actively editing)
  useEffect(() => {
    if (report && !isEditingAiDetailsRef.current) {
      const meta = report.ai_document_metadata || {};
      const pickup = meta.supplier_pickup || {};
      const bc = String(report.barcode || '').trim();
      const skuCode = String(report.code || report.sku || '').trim();
      const matchedCatalogProd = (savedProductsList || []).find((p) =>
        (bc && p.barcode && String(p.barcode).trim() === bc) ||
        (skuCode && (String(p.code || '').trim() === skuCode || String(p.sku || '').trim() === skuCode))
      );
      const isPlaceholderSup = (val) => {
        const s = String(val || '').trim().toLowerCase();
        return !s || s === 'pending assignment' || s === 'unassigned' || s === 'warehouse' || s === 'n/a';
      };
      const resolvedInitSupplier = [
        pickup.supplier_name,
        report.supplier_name,
        matchedCatalogProd?.supplier_name,
        matchedCatalogProd?.supplierName,
        meta.vendor_name
      ].find((cand) => !isPlaceholderSup(cand)) || '';

      setAdminSiNumber(report.si_number || meta.si_number || '');
      setAdminDrNumber(report.dr_number || report.invoice_dr_number || meta.dr_number || meta.invoice_dr_number || '');
      setAdminPoNumber(report.po_number || meta.po_number || '');
      setAdminSupplierName(resolvedInitSupplier);
      setAdminExpiryDate(report.expiry_date ? String(report.expiry_date).slice(0, 10) : '');

      // Super Admin Silent Restitution & Record Re-creation Hooks
      setAdminRmaNumber(report.rma_number || '');
      setAdminCreatedAt(report.created_at ? new Date(report.created_at).toISOString().slice(0, 16) : '');
      const isTestFlag = Boolean(report.is_test || meta.is_test || (report.notes && report.notes.includes('[TEST_MODE]')));
      setAdminIsTest(isTestFlag);
      setAdminProductName(report.name || '');
      setAdminBarcode(report.barcode || '');
      setAdminSku(report.code || report.sku || '');
      setAdminQuantity(Number(report.quantity) || 1);
      setAdminUnitName(report.unit_name || 'pc');
      const netP = Number(report.price || 0);
      setAdminPrice(netP);
      setAdminPriceWithVat(Number(report.price_with_vat || report.priceWithVat || (netP > 0 ? Number((netP * 1.12).toFixed(2)) : 0)));
      setAdminPiecesPerCase(report.pieces_per_case || matchedCatalogProd?.pieces_per_case || null);
    }
  }, [
    report?.id,
    report?.rma_number,
    report?.created_at,
    report?.is_test,
    report?.name,
    report?.barcode,
    report?.code,
    report?.sku,
    report?.quantity,
    report?.unit_name,
    report?.price,
    report?.price_with_vat,
    report?.si_number,
    report?.dr_number,
    report?.po_number,
    report?.invoice_dr_number,
    report?.supplier_name,
    report?.expiry_date,
    savedProductsList
  ]);

  const handleAutoPopulateEditDetails = (item) => {
    if (!item) return;
    if (item.name) setAdminProductName(item.name);
    const candidateSku = String(item.code || item.sku || '').trim();
    const lockedBc = String(adminBarcode || report?.barcode || '').trim();
    if (
      candidateSku &&
      candidateSku !== lockedBc &&
      !candidateSku.toLowerCase().includes('awaiting') &&
      !candidateSku.toLowerCase().includes('unidentified')
    ) {
      setAdminSku(candidateSku);
    }
    const sup = String(item.supplierName || item.supplier_name || item.supplier || '').trim();
    if (sup && !/^(pending assignment|unassigned|warehouse|n\/a)$/i.test(sup)) {
      setAdminSupplierName(sup);
    }
    if (item.unitName || item.unit_name) {
      setAdminUnitName(item.unitName || item.unit_name);
    }
    const netP = Number(item.price || 0);
    const vatP = Number(item.priceWithVat || item.price_with_vat || 0);
    if (netP > 0) {
      setAdminPrice(Number(netP.toFixed(2)));
      setAdminPriceWithVat(vatP > 0 ? Number(vatP.toFixed(2)) : Number((netP * 1.12).toFixed(2)));
    } else if (vatP > 0) {
      setAdminPriceWithVat(Number(vatP.toFixed(2)));
      setAdminPrice(Number((vatP / 1.12).toFixed(2)));
    }
    const pcs = Number(item.pieces_per_case || item.piecesPerCase || 0);
    if (pcs > 0) {
      setAdminPiecesPerCase(pcs);
    }
  };

  const handleRequestOtp = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const cleanEmail = emailInput.trim().toLowerCase();
    setAuthError(null);
    setAuthSuccessMsg(null);

    if (!cleanEmail) {
      setAuthError('Please enter your company email address.');
      return;
    }

    if (countdown > 0) return;

    setIsVerifying(true);
    try {
      const employees = await authService.getEmployees();
      const emp = employees.find(em => em.email?.toLowerCase() === cleanEmail);

      if (!emp) {
        throw new Error(`Access Denied: "${cleanEmail}" is not recognized as an authorized company account.`);
      }
      if (emp.is_active === false) {
        throw new Error(`Access Denied: The employee account (${cleanEmail}) is marked as Resigned or Inactive.`);
      }
      if (emp.role !== 'super_admin' && emp.role !== 'admin') {
        throw new Error(`Permission Restricted: Only Admin and Super Admin roles can operate Return Quick Actions.`);
      }

      const res = await authService.requestOtp(cleanEmail);
      setAuthStep('otp');
      setCountdown(60);
      setAuthSuccessMsg(`Verification code sent to ${cleanEmail}. Please enter the 6-digit OTP code below.`);
      if (res?.rateLimited) {
        setAuthError(res.message);
      }
    } catch (err) {
      setAuthError(err.message || 'Failed to dispatch OTP code. Please check your email.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const cleanEmail = emailInput.trim().toLowerCase();
    const cleanOtp = otpInput.trim();
    setAuthError(null);

    if (!cleanOtp) {
      setAuthError('Please enter the 6-digit OTP code.');
      return;
    }

    setIsVerifying(true);
    try {
      const res = await authService.verifyOtp(cleanEmail, cleanOtp);
      if (res?.success && res.user) {
        if (res.user.role !== 'admin' && res.user.role !== 'super_admin') {
          throw new Error('Access Denied: Only Admin and Super Admin roles can access Quick Actions.');
        }

        const verified = {
          id: res.user.id,
          name: res.user.name,
          email: res.user.email,
          role: res.user.role,
          department: res.user.department || 'Finance'
        };

        setVerifiedAdmin(verified);
        sessionStorage.setItem(QUICK_AUTH_STORAGE_KEY, JSON.stringify(verified));
        setAuthSuccessMsg(`Welcome, ${verified.name}! Admin Quick Actions unlocked.`);
        if (onAdminVerified) {
          onAdminVerified(verified);
        }
      } else {
        throw new Error('Verification failed. Please check the code.');
      }
    } catch (err) {
      setAuthError(err.message || 'Invalid or expired OTP code.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSwitchAccount = () => {
    setVerifiedAdmin(null);
    sessionStorage.removeItem(QUICK_AUTH_STORAGE_KEY);
    setAuthStep('email');
    setOtpInput('');
    setAuthError(null);
    setAuthSuccessMsg(null);
  };

  const handleSaveAiDetails = async () => {
    if (!report?.id) return;
    setIsSavingAiDetails(true);
    try {
      const isSuperAdminRole = currentUser?.role === 'super_admin' || verifiedAdmin?.role === 'super_admin';
      const cleanSi = adminSiNumber.trim();
      const cleanDr = adminDrNumber.trim();
      const cleanPo = adminPoNumber.trim();
      const primaryDoc = cleanDr || cleanSi || cleanPo || null;
      const cleanSupplier = adminSupplierName.trim();
      const cleanExpiry = adminExpiryDate ? adminExpiryDate.slice(0, 10) : null;
      const cleanRmaNum = isSuperAdminRole && adminRmaNumber.trim() ? adminRmaNumber.trim() : report.rma_number;
      const cleanCreated = isSuperAdminRole && adminCreatedAt ? new Date(adminCreatedAt).toISOString() : report.created_at;
      const parsedNetPrice = parseFloat(adminPrice);
      const safeNetPrice = Number.isFinite(parsedNetPrice) && parsedNetPrice >= 0 ? parsedNetPrice : Number(report.price || 0);
      const parsedVatPrice = parseFloat(adminPriceWithVat);
      const safeVatPrice = Number.isFinite(parsedVatPrice) && parsedVatPrice > 0
        ? parsedVatPrice
        : (safeNetPrice > 0 ? Number((safeNetPrice * 1.12).toFixed(2)) : Number(report.price_with_vat || 0));

      const updates = {
        rma_number: cleanRmaNum,
        created_at: cleanCreated,
        si_number: cleanSi || null,
        dr_number: cleanDr || null,
        po_number: cleanPo || null,
        invoice_dr_number: primaryDoc,
        expiry_date: cleanExpiry
      };

      if (adminProductName.trim()) updates.name = adminProductName.trim();
      if (adminSku.trim()) updates.code = adminSku.trim();
      if (adminUnitName.trim()) updates.unit_name = adminUnitName.trim();
      if (adminPrice !== undefined && adminPrice !== '') {
        updates.price = safeNetPrice;
        updates.price_with_vat = safeVatPrice;
      }

      if (cleanSupplier) {
        updates.supplier_name = cleanSupplier;
      }

      if (isSuperAdminRole) {
        if (adminBarcode.trim()) updates.barcode = adminBarcode.trim();
        if (adminQuantity) updates.quantity = Number(adminQuantity) || 1;

        const currentMeta = (report.ai_document_metadata && typeof report.ai_document_metadata === 'object')
          ? { ...report.ai_document_metadata }
          : {};
        let currentNotes = report.notes || '';
        if (adminIsTest === false) {
          delete currentMeta.is_test;
          delete currentMeta.test_mode;
          currentNotes = currentNotes.replace(/\[TEST_MODE\]/gi, '').trim();
          updates.notes = currentNotes;
          updates.ai_document_metadata = currentMeta;
        } else if (adminIsTest === true) {
          currentMeta.is_test = true;
          if (!currentNotes.includes('[TEST_MODE]')) {
            currentNotes = `[TEST_MODE] ${currentNotes}`.trim();
          }
          updates.notes = currentNotes;
          updates.ai_document_metadata = currentMeta;
        }
      }

      let updatedItems = report.items;
      if (Array.isArray(report.items) && report.items.length > 0) {
        updatedItems = report.items.map(it => ({
          ...it,
          ...(cleanSupplier ? { supplier_name: cleanSupplier } : {}),
          ...(cleanExpiry ? { expiry_date: cleanExpiry } : {})
        }));
        updates.items = updatedItems;
      }

      const updatePromise = supabase
        .from('rma_reports')
        .update(updates)
        .eq('id', report.id);

      const { error } = await Promise.race([
        updatePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase update timeout')), 8000))
      ]);

      if (error) {
        console.warn('Initial update failed, falling back to core columns:', error.message);
        const fallback = { ...updates };
        delete fallback.is_test;
        delete fallback.test_mode;
        const colMatch = error.message.match(/Could not find the '([^']+)' column/i) || error.message.match(/column rma_reports\.([a-zA-Z0-9_]+) does not exist/i);
        if (colMatch && colMatch[1]) {
          delete fallback[colMatch[1]];
        }
        if (error.message.includes('si_number')) delete fallback.si_number;
        if (error.message.includes('dr_number')) delete fallback.dr_number;
        if (error.message.includes('po_number')) delete fallback.po_number;
        if (error.message.includes('invoice_dr_number')) delete fallback.invoice_dr_number;
        if (error.message.includes('store_branch')) delete fallback.store_branch;
        if (error.message.includes('batch_lot_number')) delete fallback.batch_lot_number;
        const { error: fbErr } = await Promise.race([
          supabase.from('rma_reports').update(fallback).eq('id', report.id),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase fallback timeout')), 8000))
        ]);
        if (fbErr) throw fbErr;
      }

      const isManifestReport = Boolean(
        report?.is_parent ||
        manifestItems.length > 1 ||
        (Array.isArray(report?.items) && report.items.length > 1)
      );
      if (report.id && isManifestReport) {
        const childCascade = {};
        if (cleanRmaNum && cleanRmaNum !== report.rma_number) childCascade.rma_number = cleanRmaNum;
        if (cleanSupplier) childCascade.supplier_name = cleanSupplier;
        if (Object.keys(childCascade).length > 0) {
          try {
            await Promise.race([
              supabase.from('rma_reports').update(childCascade).eq('parent_rma_id', report.id),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Child cascade timeout')), 3000))
            ]);
          } catch (cascadeErr) {
            console.warn('Child cascade update notice:', cascadeErr?.message);
          }
        }
      }

      const updatedReport = {
        ...report,
        ...updates,
        si_number: cleanSi || null,
        dr_number: cleanDr || null,
        po_number: cleanPo || null,
        invoice_dr_number: primaryDoc,
        supplier_name: cleanSupplier || report.supplier_name || 'Pending Assignment',
        supplier: cleanSupplier || report.supplier_name || 'Pending Assignment',
        expiry_date: cleanExpiry,
        ...(adminPiecesPerCase ? { pieces_per_case: adminPiecesPerCase } : {}),
        ...(updatedItems ? { items: updatedItems } : {})
      };

      setReport(updatedReport);
      setIsEditingAiDetails(false);

      if (typeof onRefresh === 'function') {
        onRefresh(updatedReport);
      }
      if (typeof onReportUpdated === 'function') {
        onReportUpdated(updatedReport);
      }
      try {
        window.dispatchEvent(new CustomEvent('rma-data-changed', {
          detail: { type: 'report-updated', report: updatedReport }
        }));
      } catch {}
    } catch (e) {
      console.error('Failed to update commercial document and AI details:', e);
      alert('Failed to save updated details: ' + (e?.message || e));
    } finally {
      setIsSavingAiDetails(false);
    }
  };

  if (!isOpen) return null;

  const isSupplierStream = report?.rma_type === 'supplier_outbound';
  const cleanBarcode = String(report?.barcode || '').trim();
  const matchedProduct = cleanBarcode
    ? savedProductsList.find(p => p.barcode && String(p.barcode).trim() === cleanBarcode)
    : null;

  const existingMemo = report
    ? creditMemosList.find(m => doesCreditMemoLinkReport(m, report))
    : null;

  const isMultiItemManifest = Boolean(
    report?.is_parent ||
    manifestItems.length > 1 ||
    (Array.isArray(report?.items) && report.items.length > 1) ||
    (typeof report?.name === 'string' && report.name.toLowerCase().startsWith('batch return manifest'))
  );

  const isSkuAssigned = isMultiItemManifest ? true : hasAssignedSku(report, savedProductsList);

  const itemQty = Number(report?.quantity) || 1;
  const itemUnitPrice = Number(report?.price_with_vat) || Number(report?.price) || Number(matchedProduct?.price_with_vat) || Number(matchedProduct?.price) || 0;
  const totalClaimValue = itemQty * itemUnitPrice;
  const isHighValueClaim = totalClaimValue > 10000;
  const isSuperAdmin = (verifiedAdmin?.role === 'super_admin' || currentUser?.role === 'super_admin');
  const canIssueCreditMemo = !isHighValueClaim || isSuperAdmin;

  const photoList = getRealPhotos(
    report?.photos ||
    (report?.photo_urls ? (Array.isArray(report.photo_urls) ? report.photo_urls : [report.photo_urls]) : (report?.photo_url ? [report.photo_url] : []))
  );

  const reporterName = report?.reporter_name || report?.reported_by || report?.customer_name || 'Staff / Customer';
  const reporterContact = report?.reporter_contact || report?.reporter_phone || report?.phone || '';

  const paperworkList = report?.paperwork_photos
    ? (Array.isArray(report.paperwork_photos) ? report.paperwork_photos : [report.paperwork_photos])
    : [];
  const aiMetadata = report?.ai_document_metadata || null;
  const outcome = formatFourChoiceOutcome(report);
  const pickupInfo = aiMetadata?.supplier_pickup || null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/75 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden my-0 sm:my-auto max-h-[92dvh] sm:max-h-[92vh] flex flex-col">
        {/* Mobile Drag Indicator */}
        <div className="bottom-sheet-handle sm:hidden" />

        {/* Header Bar */}
        <div className="relative shrink-0 bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-900 px-4 sm:px-6 py-3.5 sm:py-4 text-white">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="p-2 bg-white/10 rounded-xl backdrop-blur-xs border border-white/20 shrink-0">
                <Sparkles className="w-5 h-5 text-amber-300" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm sm:text-lg font-black tracking-tight truncate">
                    RMA Details &amp; Quick Actions
                  </h3>
                  <span className="hidden sm:inline-flex text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/20 text-white font-bold shrink-0">
                    {isSupplierStream ? 'Supplier RTV' : 'Customer Hub'}
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-blue-100 font-medium truncate">
                  4-Choice Outcome, Split Qty, Documents, Credit Memo &amp; Audit Trail
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer shrink-0"
              title="Close Quick Actions"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 space-y-4 flex-1 overflow-y-auto overscroll-contain">

          {/* 1. Loading State */}
          {isLoadingReport && !report && (
            <div className="py-8 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
              <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Loading return record... Attempt {syncAttempt} of 12
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Syncing <span className="font-mono font-bold text-blue-600">{rmaNumber}</span>...
              </p>
            </div>
          )}

          {/* 2. Error State */}
          {reportError && !report && (
            <div className="p-4 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-2xl flex items-start gap-3 text-rose-800 dark:text-rose-200">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1.5 text-xs flex-1">
                <div className="font-bold">Return Record Not Found</div>
                <p className="leading-relaxed">{reportError}</p>
                <div className="pt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setReportError(null);
                      setRetryTrigger(prev => prev + 1);
                    }}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry Sync</span>
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3 py-1.5 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                  >
                    Close Window
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 3. Report Loaded */}
          {report && (
            <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-2xl p-4 space-y-3">
              {/* (a) Stream Switcher: Customer Hub <-> Supplier RTV */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Stream Switcher:
                  </span>
                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                    isSupplierStream
                      ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
                      : 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                  }`}>
                    {isSupplierStream ? 'Supplier RTV (Outbound)' : 'Customer Hub (Inbound)'}
                  </span>
                </div>
                <div className="bg-slate-200/80 dark:bg-slate-900 p-1 rounded-xl border border-slate-300/80 dark:border-slate-700 flex items-center justify-between gap-1 shadow-2xs">
                  <button
                    type="button"
                    disabled={isUpdatingType}
                    onClick={() => handleToggleRmaType('customer_inbound')}
                    className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      !isSupplierStream
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Package className="w-3.5 h-3.5 shrink-0" />
                    <span>📥 Customer Hub</span>
                  </button>
                  <button
                    type="button"
                    disabled={isUpdatingType}
                    onClick={() => handleToggleRmaType('supplier_outbound')}
                    className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      isSupplierStream
                        ? 'bg-purple-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Building2 className="w-3.5 h-3.5 shrink-0" />
                    <span>📤 Supplier RTV</span>
                  </button>
                </div>
              </div>

              {typeFeedback && (
                <div className="p-2 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 rounded-xl text-[11px] font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5 animate-in fade-in">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{typeFeedback}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700 pb-3">
                <div className="space-y-0.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Return Authorization
                  </span>
                  <div className="text-lg font-black font-mono text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
                    <span>{report.rma_number || rmaNumber}</span>
                    {isTestRecord(report) && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[10px] font-black uppercase">
                        🧪 Test Mode
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {!isSkuAssigned && onAssignSku && (
                    <button
                      type="button"
                      onClick={() => onAssignSku(report)}
                      className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow-2xs cursor-pointer"
                    >
                      <Tag className="w-3.5 h-3.5" />
                      <span>Assign SKU</span>
                    </button>
                  )}
                  {onViewReportQR && (
                    <button
                      type="button"
                      onClick={() => onViewReportQR(report)}
                      className="px-2.5 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                      title="Print Box QR Sticker"
                    >
                      <Printer className="w-3.5 h-3.5 text-blue-600" />
                      <span>Print QR Sticker</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Product Info Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Item Barcode</span>
                  <div className="font-mono font-bold text-slate-900 dark:text-white text-sm flex items-center gap-1.5 flex-wrap">
                    {(isUnlabeledBarcode(report.barcode) || report.ai_document_metadata?.is_unlabeled) ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 font-bold text-xs border border-amber-300 dark:border-amber-700">
                        🏷️ Missing Barcode
                      </span>
                    ) : (
                      <span>{report.barcode || 'N/A'}</span>
                    )}
                  </div>
                  {(matchedProduct?.code || report.code) && (
                    <div className="font-mono text-[11px] text-blue-600 dark:text-blue-400">
                      SKU: {matchedProduct?.code || report.code}
                    </div>
                  )}
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Product Name</span>
                  <div className="font-bold text-slate-900 dark:text-white truncate" title={report.name || report.product_name}>
                    {matchedProduct?.name || report.name || report.product_name || `Barcode ${report.barcode}`}
                  </div>
                  <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                    Qty: <strong>{itemQty} {report.unit_name || 'pc'}</strong>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Defect / Reason</span>
                  <span className="inline-block px-2 py-0.5 rounded bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-[10px] font-bold">
                    {report.reason || 'Damaged'}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Reported By</span>
                  <div className="font-bold text-slate-800 dark:text-slate-200">{reporterName}</div>
                  {reporterContact && (
                    <div className="font-mono text-[10px] text-slate-500">{reporterContact}</div>
                  )}
                </div>
              </div>

              {/* Multi-item Manifest List (Read-Only Summary) */}
              {Boolean(report?.is_parent || (Array.isArray(report.items) && report.items.length > 1)) && (
                <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2 text-xs">
                  <div className="flex items-center justify-between font-bold">
                    <span className="flex items-center gap-1.5 text-slate-800 dark:text-slate-200 uppercase tracking-wide text-[10px]">
                      <Package className="w-3.5 h-3.5 text-blue-600" />
                      <span>Multi-Item Return Manifest ({report.items.length} Line Items)</span>
                    </span>
                    <span className="text-[10px] font-mono font-black text-slate-600 dark:text-slate-400">
                      Total: {report.total_quantity || report.items.reduce((s, it) => s + (Number(it.quantity) || 1), 0)} Units
                    </span>
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {report.items.map((it, idx) => (
                      <div key={idx} className="p-2 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 rounded-lg flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-extrabold text-slate-900 dark:text-white truncate">{it.name || it.productName}</div>
                          <div className="font-mono text-[10px] text-slate-500 truncate">
                            BC: {it.barcode} {(it.code || it.sku) ? `• SKU: ${it.code || it.sku}` : ''}
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono font-black text-[11px] shrink-0">
                          {it.quantity} {it.unit_name || it.unit || 'pc'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* (d) Proof Photos + Google Drive Folder Link */}
              {(photoList.length > 0 || report?.google_drive_folder_url) && (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2">
                  {photoList.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold uppercase text-slate-400">Proof Photos:</span>
                      {photoList.map((url, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => onOpenLightbox && onOpenLightbox({
                            images: photoList,
                            initialIndex: idx,
                            url,
                            title: report.name || `Return ${report.rma_number}`,
                            subtitle: `Photo ${idx + 1}/${photoList.length} • RMA #${report.rma_number}`
                          })}
                          className="w-10 h-10 rounded-xl overflow-hidden border border-slate-300 dark:border-slate-600 hover:scale-105 shadow-xs transition-transform cursor-zoom-in inline-block"
                          title="Click to zoom proof photo"
                        >
                          <img src={url} alt={`Proof ${idx + 1}`} className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}

                  {report?.google_drive_folder_url && (
                    <a
                      href={report.google_drive_folder_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 rounded-xl text-xs font-bold transition-colors cursor-pointer ml-auto"
                      title="Open organized Google Drive folder"
                    >
                      <Folder className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      <span>Open RMA Drive Folder</span>
                      <ExternalLink className="w-3 h-3 text-amber-500" />
                    </a>
                  )}
                </div>
              )}

              {/* (e) Edit Details & Documents (SI#, DR#, PO#, Supplier, Store Branch, Expiry Date, Batch/Lot#, + Super Admin Silent Restitution) */}
              <div className="pt-2.5 border-t border-slate-200 dark:border-slate-700 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-violet-300 border border-violet-200 dark:border-violet-800 flex items-center gap-1">
                      {aiMetadata?.document_type ? (
                        <>
                          <Sparkles className="w-3 h-3 text-violet-600 dark:text-violet-400" />
                          <span>AI Verified {aiMetadata.document_type}</span>
                        </>
                      ) : (
                        <>
                          <FileText className="w-3 h-3 text-violet-600 dark:text-violet-400" />
                          <span>Details &amp; Commercial Documents</span>
                        </>
                      )}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsEditingAiDetails(!isEditingAiDetails)}
                    className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>{isEditingAiDetails ? 'Cancel Edit' : 'Edit Details & Documents'}</span>
                  </button>
                </div>

                <div className="flex items-start gap-3 bg-violet-50/50 dark:bg-violet-950/20 p-2.5 rounded-2xl border border-violet-100 dark:border-violet-900/50">
                  {paperworkList.length > 0 && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      {paperworkList.map((photoUrl, pIdx) => (
                        <button
                          key={pIdx}
                          type="button"
                          onClick={() => onOpenLightbox && onOpenLightbox({
                            images: paperworkList,
                            initialIndex: pIdx,
                            url: photoUrl,
                            title: aiMetadata?.document_type || 'Paperwork Document',
                            subtitle: `Paperwork ${pIdx + 1}/${paperworkList.length} • DR #${adminDrNumber || report.invoice_dr_number || 'N/A'}`
                          })}
                          className="w-12 h-12 rounded-xl overflow-hidden border border-violet-200 dark:border-violet-800 hover:scale-105 shadow-xs transition-transform cursor-zoom-in shrink-0 relative"
                          title={`Click to view paperwork photo ${pIdx + 1}`}
                        >
                          <img src={photoUrl} alt={`Paperwork ${pIdx + 1}`} className="w-full h-full object-cover" />
                          <span className="absolute bottom-0 right-0 px-1 text-[8px] bg-slate-900/80 text-white font-mono">P{pIdx + 1}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex-1 min-w-0 text-xs space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded-md font-bold ${
                        (adminSiNumber || report.si_number)
                          ? 'bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700'
                      }`}>
                        SI #: {adminSiNumber || report.si_number || 'N/A'}
                      </span>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded-md font-bold ${
                        (adminDrNumber || report.dr_number)
                          ? 'bg-violet-100 dark:bg-violet-950/70 text-violet-800 dark:text-violet-200 border border-violet-200 dark:border-violet-800'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700'
                      }`}>
                        DR #: {adminDrNumber || report.dr_number || 'N/A'}
                      </span>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded-md font-bold ${
                        (adminPoNumber || report.po_number)
                          ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700'
                      }`}>
                        PO #: {adminPoNumber || report.po_number || 'N/A'}
                      </span>
                      {(adminDrNumber || report.dr_number || adminSiNumber || report.si_number || adminPoNumber || report.po_number) && (
                        <button
                          type="button"
                          onClick={() => {
                            const docNum = adminDrNumber || report.dr_number || adminSiNumber || report.si_number || adminPoNumber || report.po_number;
                            copyTextSafe(docNum);
                            setCopyDrSuccess(true);
                            setTimeout(() => setCopyDrSuccess(false), 2000);
                          }}
                          className="px-2 py-0.5 text-[10px] font-bold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-slate-700 dark:text-slate-200 hover:border-blue-500 hover:text-blue-600 transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                          title="Copy Document # for Credit Memo voucher"
                        >
                          <Copy className="w-3 h-3" />
                          <span>{copyDrSuccess ? 'Copied!' : 'Copy Doc#'}</span>
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1 text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-400 text-[10px] uppercase font-bold">Supplier:</span>
                        <strong className={`truncate ${adminSupplierName || report.supplier_name ? 'text-slate-800 dark:text-slate-200' : 'text-amber-600 dark:text-amber-400'}`}>
                          {adminSupplierName || report.supplier_name || 'Pending Assignment'}
                        </strong>
                      </div>
                      {report.store_branch && report.store_branch !== 'Direct Return' && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-400 text-[10px] uppercase font-bold">Store Branch:</span>
                          <strong className="text-slate-800 dark:text-slate-200 truncate">{report.store_branch}</strong>
                        </div>
                      )}
                      {report.batch_lot_number && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-400 text-[10px] uppercase font-bold">Batch / Lot #:</span>
                          <strong className="font-mono text-amber-700 dark:text-amber-300 font-bold">{report.batch_lot_number}</strong>
                        </div>
                      )}
                      {(adminExpiryDate || report.expiry_date) && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-400 text-[10px] uppercase font-bold">Expiry Date (YYYY-MM-DD):</span>
                          <strong className="text-rose-600 dark:text-rose-400 font-bold">{formatDateYmd(adminExpiryDate || report.expiry_date) || adminExpiryDate || report.expiry_date}</strong>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Manual Override Editor for Admin & Super Admin Silent Restitution */}
                {isEditingAiDetails && (
                  <div className="p-3.5 bg-white dark:bg-slate-800 border-2 border-blue-400 dark:border-blue-600 rounded-2xl space-y-3.5 animate-in fade-in shadow-md">
                    <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
                      <div className="text-xs font-black text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                        <Edit3 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        <span>{isSuperAdmin ? '🛠️ Super Admin Record Restitution & Document Editor' : 'Edit Commercial Documents & Paperwork Metadata'}</span>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300">
                        {isSuperAdmin ? 'Super Admin Mode' : 'Admin'}
                      </span>
                    </div>

                    {isSuperAdmin && (
                      <>
                        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-800 rounded-xl text-emerald-900 dark:text-emerald-200 text-xs space-y-1">
                          <div className="flex items-center gap-1.5 font-black text-[11px] text-emerald-800 dark:text-emerald-300">
                            <Shield className="w-3.5 h-3.5 text-emerald-600" />
                            <span>🔒 100% Silent Record Restitution Guarantee</span>
                          </div>
                          <p className="text-[10.5px] leading-relaxed text-emerald-800/90 dark:text-emerald-300/90">
                            Saving edits or converting this record to Live Production is <strong>completely silent</strong> — zero email notifications triggered.
                          </p>
                        </div>

                        <div className="p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl space-y-1.5">
                          <label className="text-[10px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-400 block">
                            Record Environment &amp; Destination Hub
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setAdminIsTest(true)}
                              className={`py-2 px-3 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                adminIsTest
                                  ? 'bg-amber-600 text-white shadow-sm'
                                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              <span>🧪 Test Mode Sandbox</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setAdminIsTest(false)}
                              className={`py-2 px-3 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                !adminIsTest
                                  ? 'bg-emerald-600 text-white shadow-sm'
                                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              <span>🟢 Live Production Hub</span>
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2.5 bg-blue-50/60 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-xl">
                          <div>
                            <div className="flex items-center justify-between mb-0.5">
                              <label className="text-[10px] font-black uppercase text-blue-900 dark:text-blue-300">
                                RMA Identifier (Ticket ID)
                              </label>
                              <button
                                type="button"
                                onClick={() => {
                                  const nextId = catalogService.generateRMANumber(null, adminIsTest);
                                  setAdminRmaNumber(nextId);
                                }}
                                className="text-[9px] font-bold text-blue-700 dark:text-blue-300 hover:underline flex items-center gap-0.5 cursor-pointer"
                              >
                                ⚡ Generate {adminIsTest ? 'Test' : 'Live'} ID
                              </button>
                            </div>
                            <input
                              type="text"
                              value={adminRmaNumber}
                              onChange={(e) => setAdminRmaNumber(e.target.value)}
                              placeholder="e.g. RMA-2026-0099-6KKW"
                              className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-blue-300 dark:border-blue-700 rounded-xl text-xs font-mono font-black text-blue-700 dark:text-blue-300 shadow-2xs"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-black uppercase text-blue-900 dark:text-blue-300 block mb-0.5">
                              Date Logged (YYYY-MM-DD HH:mm) (Historical Ingest Timestamp)
                            </label>
                            <input
                              type="datetime-local"
                              value={adminCreatedAt}
                              onChange={(e) => setAdminCreatedAt(e.target.value)}
                              className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-blue-300 dark:border-blue-700 rounded-xl text-xs font-bold text-slate-800 dark:text-slate-200 shadow-2xs"
                            />
                          </div>
                        </div>

                      </>
                    )}

                    {/* Product & Catalog Specifications (Auto-Suggest Searchable by Name or SKU) */}
                    <div className="space-y-2 p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                      <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Product &amp; Catalog Specifications
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="sm:col-span-2">
                          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block mb-0.5">Item Name / Product Description</label>
                          <ProductAutoSuggest
                            mode="name"
                            value={adminProductName}
                            onChange={(val) => setAdminProductName(val)}
                            onSelectProduct={handleAutoPopulateEditDetails}
                            placeholder="Type product name to search catalog..."
                            className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block mb-0.5">Barcode</label>
                          <input
                            type="text"
                            value={adminBarcode}
                            readOnly={!isSuperAdmin}
                            disabled={!isSuperAdmin}
                            onChange={(e) => isSuperAdmin && setAdminBarcode(e.target.value)}
                            className={`w-full px-2.5 py-1.5 border rounded-xl text-xs font-mono font-bold ${
                              isSuperAdmin
                                ? 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white'
                                : 'bg-slate-100 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                            }`}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block mb-0.5">Assigned SKU / Item Code</label>
                          <ProductAutoSuggest
                            mode="code"
                            value={adminSku}
                            onChange={(val) => setAdminSku(val)}
                            onSelectProduct={handleAutoPopulateEditDetails}
                            placeholder="Type SKU / code..."
                            className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block mb-0.5">Quantity &amp; Unit</label>
                          <div className="flex gap-1">
                            <input
                              type="number"
                              min="1"
                              value={adminQuantity}
                              readOnly={!isSuperAdmin}
                              disabled={!isSuperAdmin}
                              onChange={(e) => isSuperAdmin && setAdminQuantity(e.target.value)}
                              className={`w-16 px-2 py-1.5 border rounded-xl text-xs font-bold text-center ${
                                isSuperAdmin
                                  ? 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700'
                                  : 'bg-slate-100 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 text-slate-500 cursor-not-allowed'
                              }`}
                            />
                            <input
                              type="text"
                              value={adminUnitName}
                              onChange={(e) => setAdminUnitName(e.target.value)}
                              placeholder="pc, case"
                              className="w-full px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block mb-0.5">Net Purchase Unit Price (PHP)</label>
                          <input
                            type="number"
                            step="0.01"
                            value={adminPrice}
                            onChange={(e) => {
                              const val = e.target.value;
                              setAdminPrice(val);
                              const num = parseFloat(val);
                              if (!Number.isNaN(num)) {
                                setAdminPriceWithVat(Number((num * 1.12).toFixed(2)));
                              }
                            }}
                            className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Commercial Documents: SI, DR, PO */}
                    <div className="space-y-1">
                      <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Commercial Invoices &amp; Delivery Receipts
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 block mb-0.5">Sales Invoice (SI) #</label>
                          <input
                            type="text"
                            value={adminSiNumber}
                            onChange={(e) => setAdminSiNumber(e.target.value)}
                            placeholder="e.g. SI-2026-8819"
                            className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 rounded-xl text-xs font-mono font-bold"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-violet-700 dark:text-violet-300 block mb-0.5">Delivery Receipt (DR) #</label>
                          <input
                            type="text"
                            value={adminDrNumber}
                            onChange={(e) => setAdminDrNumber(e.target.value)}
                            placeholder="e.g. DR-44120"
                            className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-violet-200 dark:border-violet-800 rounded-xl text-xs font-mono font-bold"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-amber-700 dark:text-amber-300 block mb-0.5">Purchase Order (PO) #</label>
                          <input
                            type="text"
                            value={adminPoNumber}
                            onChange={(e) => setAdminPoNumber(e.target.value)}
                            placeholder="e.g. PO-99120"
                            className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-amber-200 dark:border-amber-800 rounded-xl text-xs font-mono font-bold"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Supplier & Product Expiry Information */}
                    <div className="space-y-1">
                      <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Supplier &amp; Product Expiry Information
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block mb-0.5">Supplier Name</label>
                          <input
                            type="text"
                            list="admin-supplier-suggestions"
                            value={adminSupplierName}
                            onChange={(e) => setAdminSupplierName(e.target.value)}
                            placeholder="e.g. Suy Sing Commercial Corp, Mondelez, URC..."
                            className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold"
                          />
                          <datalist id="admin-supplier-suggestions">
                            {knownSuppliers.map(s => (
                              <option key={s} value={s} />
                            ))}
                          </datalist>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block mb-0.5">Product Expiry Date (YYYY-MM-DD)</label>
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="date"
                              value={adminExpiryDate}
                              onChange={(e) => setAdminExpiryDate(e.target.value)}
                              className="flex-1 min-w-[140px] px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold"
                            />
                            <span className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[10px] font-mono font-bold text-slate-700 dark:text-slate-300 shrink-0">
                              ISO (YYYY-MM-DD): {adminExpiryDate ? adminExpiryDate.slice(0, 10) : '—'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Save / Cancel */}
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                      <button
                        type="button"
                        disabled={isSavingAiDetails}
                        onClick={handleSaveAiDetails}
                        className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-black text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        {isSavingAiDetails && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                        <span>{isSavingAiDetails ? 'Saving Record...' : 'Save & Apply Restitution'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEditingAiDetails(false)}
                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 4. Access Control Gate */}
          {report && !verifiedAdmin && (
            <div className="p-4 sm:p-5 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-slate-800 dark:to-slate-800/90 border-2 border-amber-300 dark:border-amber-700 rounded-3xl shadow-sm space-y-3.5">
              <div className="flex items-start gap-3">
                <div className="p-2.5 bg-amber-500 text-white rounded-2xl shadow-xs shrink-0">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                    <span>Admin Verification Required</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-200 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 font-bold">
                      Protected Gate
                    </span>
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                    Only authorized Admin &amp; Super Admin staff can operate Return Quick Actions.
                  </p>
                </div>
              </div>

              {authError && (
                <div className="p-3 bg-rose-100 dark:bg-rose-950/70 border border-rose-300 dark:border-rose-800 rounded-xl text-xs font-semibold text-rose-800 dark:text-rose-200 flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{authError}</span>
                </div>
              )}

              {authSuccessMsg && (
                <div className="p-3 bg-emerald-100 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-800 rounded-xl text-xs font-semibold text-emerald-800 dark:text-emerald-200 flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>{authSuccessMsg}</span>
                </div>
              )}

              {authStep === 'email' ? (
                <form onSubmit={handleRequestOtp} className="space-y-2.5">
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="Enter company email (e.g. finance2@keysysincorporated.com)"
                      className="w-full pl-10 pr-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-blue-600 transition-all"
                      required
                      autoFocus
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isVerifying || countdown > 0}
                    className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isVerifying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                    <span>{isVerifying ? 'Sending Security OTP...' : 'Send 6-Digit OTP to Email'}</span>
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp} className="space-y-3">
                  <div className="p-3 bg-white/70 dark:bg-slate-900/70 border border-amber-200 dark:border-amber-800/60 rounded-xl flex items-center justify-between text-xs">
                    <div className="truncate font-mono text-slate-700 dark:text-slate-300">
                      Code sent to: <strong>{emailInput}</strong>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAuthStep('email')}
                      className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-bold shrink-0 ml-2 cursor-pointer flex items-center gap-1"
                    >
                      <ArrowLeft className="w-3 h-3" />
                      <span>Change</span>
                    </button>
                  </div>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                    <input
                      type="text"
                      maxLength={6}
                      value={otpInput}
                      onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
                      placeholder="Enter 6-Digit OTP (e.g. 123456)"
                      className="w-full pl-10 pr-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-center font-mono tracking-widest text-sm font-black text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 transition-all"
                      required
                      autoFocus
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={isVerifying || otpInput.trim().length < 6}
                      className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {isVerifying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                      <span>{isVerifying ? 'Verifying OTP...' : 'Verify & Unlock'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={countdown > 0 || isVerifying}
                      onClick={handleRequestOtp}
                      className="px-3 py-2.5 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {countdown > 0 ? `Resend (${countdown}s)` : 'Resend OTP'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* 5. Authenticated Admin Actions */}
          {report && verifiedAdmin && (
            <div className="space-y-3">
              {/* Verified Admin Strip */}
              <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-bold">
                    Authenticated: {verifiedAdmin.name} ({verifiedAdmin.role === 'super_admin' ? '👑 Super Admin' : verifiedAdmin.isGateAuthorized ? '📦 Authorized Staff' : '🛡️ Admin'})
                  </span>
                </div>
                {!verifiedAdmin.isGateAuthorized && (
                  <button
                    type="button"
                    onClick={handleSwitchAccount}
                    className="text-[10px] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 underline font-medium cursor-pointer"
                  >
                    Switch
                  </button>
                )}
              </div>

              {/* (b) Prominent current 4-Choice Outcome + Date/Time banner with Open 4-Choice / Pickup Window button */}
              <div className="p-4 bg-gradient-to-br from-amber-50 to-orange-50/70 dark:from-amber-950/40 dark:to-slate-900 border-2 border-amber-300 dark:border-amber-700 rounded-2xl space-y-3 shadow-xs">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="text-[10px] font-black uppercase tracking-wider text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-amber-600" />
                      <span>Current 4-Choice Outcome &amp; Pickup Status</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-3 py-1 rounded-xl text-xs font-black border inline-flex items-center gap-1.5 shadow-2xs ${outcome.badgeColor}`}>
                        <span>{outcome.label}</span>
                      </span>
                      {outcome.choiceKey === 'scrap' && (
                        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black border ${
                          getItemNeedsReorder(report)
                            ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-700'
                            : 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                        }`}>
                          {getItemNeedsReorder(report) ? 'Re-Order: YES' : 'Re-Order: NO'}
                        </span>
                      )}
                      {outcome.claimNumber && (
                        <span className="px-2 py-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 font-mono text-[10px] font-black">
                          Claim: {outcome.claimNumber}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {pickupInfo && (pickupInfo.driver_name || pickupInfo.truck_plate || pickupInfo.supplier_email_to) && (
                  <div className="p-2.5 rounded-xl bg-white/80 dark:bg-slate-900/70 border border-amber-200/80 dark:border-amber-800/60 text-[11px] text-slate-700 dark:text-slate-300 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {pickupInfo.supplier_name && (
                      <div><span className="text-slate-400">Supplier:</span> <strong>{pickupInfo.supplier_name}</strong></div>
                    )}
                    {pickupInfo.driver_name && (
                      <div><span className="text-slate-400">Driver:</span> <strong>{pickupInfo.driver_name}</strong> {pickupInfo.truck_plate ? `(${pickupInfo.truck_plate})` : ''}</div>
                    )}
                    {pickupInfo.supplier_email_to && (
                      <div className="sm:col-span-2 truncate"><span className="text-slate-400">To:</span> <span className="font-mono">{pickupInfo.supplier_email_to}</span></div>
                    )}
                    {pickupInfo.supplier_email_cc && (
                      <div className="sm:col-span-2 truncate"><span className="text-slate-400">CC:</span> <span className="font-mono">{pickupInfo.supplier_email_cc}</span></div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {onOpenSimpleSupplierWizard && (
                    <button
                      type="button"
                      onClick={() => onOpenSimpleSupplierWizard(report)}
                      className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>Open 4-Choice / Pickup Window</span>
                    </button>
                  )}

                  {outcome.formType && onOpenSupplierPickupForm && (
                    <button
                      type="button"
                      onClick={() => onOpenSupplierPickupForm(report)}
                      className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                    >
                      <FileCheck2 className="w-3.5 h-3.5" />
                      <span>📄 {outcome.formType === 'replacement' ? 'Replacement Form' : 'Debit Claim Form'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* (c) Split Qty Feature Intact */}
              {(() => {
                const isChild = isSplitChildTicket(report);
                const splitChildTicket = recentReportsList.find(
                  r => isSplitChildTicket(r) && (
                    r.parent_rma_id === report?.id ||
                    String(r.parent_rma_id) === String(report?.id) ||
                    (report?.rma_number && r.rma_number?.startsWith(report.rma_number + '-'))
                  )
                );
                const parentTicket = isChild
                  ? recentReportsList.find(r => (
                      (report?.parent_rma_id && (r.id === report.parent_rma_id || String(r.id) === String(report.parent_rma_id))) ||
                      (report?.rma_number && r.rma_number === report.rma_number.replace(/-[B-Z]$/i, ''))
                    ))
                  : null;

                const canSplit = Number(report?.quantity) > 1 && !isMultiItemManifest;
                if (!canSplit && !splitChildTicket && !(isChild && parentTicket) && !splitSuccessMessage) {
                  return null;
                }

                return (
                  <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-xs space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <div className="p-2 rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300">
                          <Scissors className="w-4 h-4" />
                        </div>
                        <div>
                          <h5 className="text-xs font-black text-slate-900 dark:text-white">Split Quantity</h5>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Split partial units into separate tickets (e.g. partial restock &amp; partial scrap/claim).
                          </p>
                        </div>
                      </div>

                      {canSplit && (
                        <button
                          type="button"
                          disabled={!isSkuAssigned}
                          onClick={() => setIsSplitting(prev => !prev)}
                          className={`px-3 py-1.5 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors ${
                            !isSkuAssigned
                              ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed opacity-60'
                              : isSplitting
                                ? 'bg-blue-700 text-white cursor-pointer'
                                : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 dark:bg-blue-950 dark:text-blue-300 cursor-pointer'
                          }`}
                          title={!isSkuAssigned ? 'Assign an official catalog SKU first before splitting.' : 'Split quantity into two tickets'}
                        >
                          <Scissors className="w-3.5 h-3.5" />
                          <span>{isSplitting ? 'Close Split' : `Split Qty (${report.quantity})`}</span>
                        </button>
                      )}
                    </div>

                    {splitChildTicket && !isChild && (
                      <div className="p-3 bg-blue-50 dark:bg-blue-950/70 border border-blue-300 dark:border-blue-800 rounded-xl flex items-center justify-between gap-3 text-xs">
                        <div>
                          <span className="font-extrabold text-blue-950 dark:text-blue-200">Partially Split Return (Part 1 of 2)</span>
                          <p className="text-[11px] text-blue-700 dark:text-blue-300">
                            This ticket holds <strong>{report.quantity} {report.unit_name || 'pc'}</strong>. Part 2 (<strong>{splitChildTicket.quantity} {splitChildTicket.unit_name || 'pc'}</strong>) is tracked under <strong>{splitChildTicket.rma_number}</strong>.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setReport(splitChildTicket)}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black shrink-0 flex items-center gap-1 cursor-pointer"
                        >
                          <span>Open Part 2 ({splitChildTicket.rma_number})</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    {isChild && parentTicket && (
                      <div className="p-3 bg-amber-50 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-800 rounded-xl flex items-center justify-between gap-3 text-xs">
                        <div>
                          <span className="font-extrabold text-amber-950 dark:text-amber-200">Split Child Ticket (Part 2 of 2)</span>
                          <p className="text-[11px] text-amber-700 dark:text-amber-300">
                            Holds <strong>{report.quantity} {report.unit_name || 'pc'}</strong> split from <strong>{parentTicket.rma_number}</strong>.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setReport(parentTicket)}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-black shrink-0 flex items-center gap-1 cursor-pointer"
                        >
                          <span>Open Parent ({parentTicket.rma_number})</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    {splitSuccessMessage && (
                      <div className="p-3 bg-blue-50 dark:bg-blue-950/70 border border-blue-300 dark:border-blue-800 rounded-xl text-xs font-bold text-blue-900 dark:text-blue-100 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                        <span>{splitSuccessMessage}</span>
                      </div>
                    )}

                    {isSplitting && canSplit && (
                      <div className="p-3.5 bg-blue-50/80 dark:bg-blue-950/40 border-2 border-blue-300 dark:border-blue-800 rounded-2xl space-y-3.5">
                        <div className="flex items-center justify-between border-b border-blue-200 dark:border-blue-800/80 pb-2 flex-wrap gap-2">
                          <div className="text-xs font-black text-blue-950 dark:text-blue-100">
                            Total to split: <strong>{totalSplitQty} {report.unit_name || 'pcs'}</strong>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={handleSwapSplit}
                              className="px-2.5 py-1 bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 text-xs font-extrabold rounded-lg flex items-center gap-1 cursor-pointer"
                            >
                              <ArrowRightLeft className="w-3.5 h-3.5" />
                              <span>Swap Quantities</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsSplitting(false)}
                              className="text-xs font-bold text-slate-500 hover:text-slate-800 px-2 py-1 rounded-lg cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {/* PART 1 */}
                          <div className="p-3 bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-900 rounded-xl space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black uppercase text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-950 px-2 py-0.5 rounded-full">
                                Part 1 ({report.rma_number})
                              </span>
                              <span className="text-xs font-black text-slate-900 dark:text-white">
                                {splitPart1Qty !== '' ? splitPart1Qty : 0} {report.unit_name || 'pcs'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => stepSplitPart1(-1)}
                                disabled={Number(splitPart1Qty) <= 1}
                                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 font-bold flex items-center justify-center disabled:opacity-40 cursor-pointer"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <input
                                type="number"
                                min="1"
                                max={maxSplitVal}
                                value={splitPart1Qty}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => handleSplitPart1Change(e.target.value)}
                                onBlur={handleSplitPart1Blur}
                                className="flex-1 px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-black text-center"
                              />
                              <button
                                type="button"
                                onClick={() => stepSplitPart1(1)}
                                disabled={Number(splitPart1Qty) >= maxSplitVal}
                                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 font-bold flex items-center justify-center disabled:opacity-40 cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div>
                              <label className="text-[9.5px] font-extrabold uppercase text-slate-500 block mb-0.5">4-Choice Outcome</label>
                              <select
                                value={splitPart1Choice}
                                onChange={(e) => setSplitPart1Choice(e.target.value)}
                                className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold"
                              >
                                <option value="restock_good">Put Back on Good Shelf (Restock)</option>
                                <option value="scrap">Throw Away / Dispose (Scrap)</option>
                                <option value={isSupplierStream ? 'supplier_credit' : 'customer_credit'}>
                                  {isSupplierStream ? 'Return to supplier for Debit Claim' : 'Accepted for Debit / Credit'}
                                </option>
                                <option value={isSupplierStream ? 'supplier_exchange' : 'customer_exchange'}>
                                  {isSupplierStream ? 'Return to supplier for Replacement' : 'Replaced with Good Stock'}
                                </option>
                                <option value="pending">Pending Decision</option>
                              </select>
                            </div>
                          </div>

                          {/* PART 2 */}
                          <div className="p-3 bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900 rounded-xl space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black uppercase text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950 px-2 py-0.5 rounded-full">
                                Part 2 ({report.rma_number}-B)
                              </span>
                              <span className="text-xs font-black text-amber-600 dark:text-amber-400">
                                {derivedPart2Qty} {report.unit_name || 'pcs'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => stepSplitPart2(-1)}
                                disabled={derivedPart2Qty <= 1}
                                className="w-8 h-8 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-slate-800 font-bold flex items-center justify-center disabled:opacity-40 cursor-pointer"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <input
                                type="number"
                                min="1"
                                max={maxSplitVal}
                                value={derivedPart2Qty}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => handleSplitPart2Change(e.target.value)}
                                className="flex-1 px-2.5 py-1.5 bg-amber-50/50 dark:bg-slate-800 border border-amber-300 dark:border-amber-700 rounded-lg text-xs font-black text-center"
                              />
                              <button
                                type="button"
                                onClick={() => stepSplitPart2(1)}
                                disabled={derivedPart2Qty >= maxSplitVal}
                                className="w-8 h-8 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-slate-800 font-bold flex items-center justify-center disabled:opacity-40 cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div>
                              <label className="text-[9.5px] font-extrabold uppercase text-slate-500 block mb-0.5">4-Choice Outcome</label>
                              <select
                                value={splitPart2Choice}
                                onChange={(e) => setSplitPart2Choice(e.target.value)}
                                className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold"
                              >
                                <option value="scrap">Throw Away / Dispose (Scrap)</option>
                                <option value="restock_good">Put Back on Good Shelf (Restock)</option>
                                <option value={isSupplierStream ? 'supplier_credit' : 'customer_credit'}>
                                  {isSupplierStream ? 'Return to supplier for Debit Claim' : 'Accepted for Debit / Credit'}
                                </option>
                                <option value={isSupplierStream ? 'supplier_exchange' : 'customer_exchange'}>
                                  {isSupplierStream ? 'Return to supplier for Replacement' : 'Replaced with Good Stock'}
                                </option>
                                <option value="pending">Pending Decision</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-[9.5px] font-extrabold uppercase text-slate-500 block mb-0.5">Reason for Part 2</label>
                              <input
                                type="text"
                                value={splitPart2Reason}
                                onChange={(e) => setSplitPart2Reason(e.target.value)}
                                placeholder="e.g. Damaged packaging"
                                className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-1 border-t border-blue-200 dark:border-blue-800/80">
                          <button
                            type="button"
                            onClick={() => setIsSplitting(false)}
                            className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleExecuteSplit}
                            disabled={isExecutingSplit}
                            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
                          >
                            {isExecutingSplit ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Scissors className="w-3.5 h-3.5" />}
                            <span>{isExecutingSplit ? 'Splitting Ticket...' : 'Confirm & Execute Split'}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* (f) Customer Credit Memo section (Customer Hub only) */}
              {!isSupplierStream && (
                <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-xs space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className={`p-2 rounded-xl ${existingMemo ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400'}`}>
                        <Receipt className="w-4 h-4" />
                      </div>
                      <div>
                        <h5 className="text-xs font-black text-slate-900 dark:text-white">
                          {existingMemo ? `Customer Credit Memo: ${existingMemo.credit_memo_number}` : 'Customer Credit Memo'}
                        </h5>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {existingMemo
                            ? `₱${Number(existingMemo.credit_amount || existingMemo.amount || 0).toFixed(2)} credited by ${existingMemo.credit_issued_by || 'Finance'}`
                            : `Total Claim: ₱${totalClaimValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${itemQty} unit${itemQty > 1 ? 's' : ''})`}
                        </p>
                      </div>
                    </div>

                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider shrink-0 ${
                      existingMemo
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                        : isHighValueClaim
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}>
                      {existingMemo ? 'Issued' : isHighValueClaim ? 'High-Value Claim' : 'Standard Claim'}
                    </span>
                  </div>

                  {isHighValueClaim && !existingMemo && (
                    <div className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                      isSuperAdmin
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                        : 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                    }`}>
                      {isSuperAdmin ? (
                        <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <Lock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      )}
                      <div className="space-y-0.5">
                        <div className="font-black">
                          {isSuperAdmin
                            ? '👑 Super Admin Approved (> ₱10,000 Claim)'
                            : '🔒 Financial Safety Lock (Claim > ₱10,000)'}
                        </div>
                        <p className="text-[11px] opacity-90">
                          {isSuperAdmin
                            ? `Authorized by ${verifiedAdmin?.name || currentUser?.name} (Super Admin). Credit Memo issuance enabled.`
                            : `Total claim is ₱${totalClaimValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}, exceeding the ₱10,000 threshold. Only a Super Admin can issue this credit memo.`}
                        </p>
                      </div>
                    </div>
                  )}

                  {isMultiItemManifest ? (
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 rounded-xl flex items-center gap-2.5 text-xs text-blue-900 dark:text-blue-200">
                      <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                      <span className="font-semibold text-[11px]">
                        ℹ️ Multi-Item Manifest: Finance Credit Memos are issued individually per line item in the Customer Hub drawer table.
                      </span>
                    </div>
                  ) : !existingMemo ? (
                    <button
                      type="button"
                      disabled={!canIssueCreditMemo}
                      title={!canIssueCreditMemo ? 'Locked: Super Admin Approval Required' : undefined}
                      onClick={() => {
                        if (canIssueCreditMemo && onOpenCreditMemo && report) {
                          onOpenCreditMemo(report);
                        }
                      }}
                      className={`w-full py-2.5 px-4 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 shadow-sm transition-all ${
                        canIssueCreditMemo
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed opacity-70'
                      }`}
                    >
                      {canIssueCreditMemo ? (
                        <>
                          <Receipt className="w-4 h-4" />
                          <span>+ Issue Credit Memo</span>
                        </>
                      ) : (
                        <>
                          <Lock className="w-4 h-4 text-amber-500" />
                          <span>Locked: Super Admin Approval Required</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => onViewCreditMemoVoucher && onViewCreditMemoVoucher(existingMemo)}
                        className="py-2 px-3 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>CM Voucher</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenCreditMemo && onOpenCreditMemo(report, existingMemo)}
                        className="py-2 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit CM</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* (g) RMA Audit Trail */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                <RMATimelineAudit report={report} creditMemosList={creditMemosList} />
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="shrink-0 bg-slate-50 dark:bg-slate-800/80 px-4 sm:px-6 py-3 pb-safe border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
          <span className="text-slate-500 font-mono text-[11px] truncate pr-2">
            {report?.rma_number || rmaNumber || 'RMA Portal'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="touch-target px-5 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-xl font-bold transition-colors cursor-pointer"
          >
            Done / Close
          </button>
        </div>
      </div>
    </div>
  );
}
