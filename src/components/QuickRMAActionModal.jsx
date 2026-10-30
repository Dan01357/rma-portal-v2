import React, { useState, useEffect, useMemo } from 'react';
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
  Calendar,
  User,
  Phone,
  Image as ImageIcon,
  Check,
  Building2,
  Sparkles,
  RefreshCw,
  Clock,
  ArrowRight,
  Layers,
  MapPin,
  Tag,
  Shield,
  KeyRound,
  ArrowLeft,
  Folder
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { authService } from '../services/authService';
import ThermalBoxLabelModal from './ThermalBoxLabelModal';
import RMATimelineAudit from './RMATimelineAudit';

const QUICK_AUTH_STORAGE_KEY = 'rma_quick_auth_admin';

const DISPOSITION_OPTIONS = [
  '1- Pending Triage',
  '2- Restock to Inventory',
  '3- Return to Vendor (RTV)',
  '4- Quarantine',
  '5- Scrap / Dispose'
];

function normalizeDispositionOption(disp) {
  if (!disp) return '1- Pending Triage';
  const found = DISPOSITION_OPTIONS.find(opt => 
    opt.toLowerCase() === disp.toLowerCase() || 
    opt.replace(/^\d+-\s*/, '').toLowerCase() === disp.replace(/^\d+-\s*/, '').toLowerCase()
  );
  return found || disp;
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
  onRefresh
}) {
  const [report, setReport] = useState(null);
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  const [reportError, setReportError] = useState(null);

  // Enterprise Warehouse Triage & Disposition State
  const [conditionGrade, setConditionGrade] = useState('B - Damaged Packaging Only');
  const [disposition, setDisposition] = useState('1- Pending Triage');
  const [warehouseLocation, setWarehouseLocation] = useState('');
  const [rmaStatus, setRmaStatus] = useState('received_at_dock');
  const [isSavingTriage, setIsSavingTriage] = useState(false);
  const [triageSavedSuccess, setTriageSavedSuccess] = useState(false);
  const [isThermalLabelOpen, setIsThermalLabelOpen] = useState(false);

  // Synchronize triage inputs when report loads or updates
  useEffect(() => {
    if (report) {
      setConditionGrade(report.condition_grade || 'B - Damaged Packaging Only');
      setDisposition(normalizeDispositionOption(report.disposition));
      setWarehouseLocation(report.warehouse_location || '');
      setRmaStatus(report.status || 'received_at_dock');
    }
  }, [report]);

  const handleSaveTriage = async () => {
    if (!report) return;
    setIsSavingTriage(true);
    try {
      const inspectorName = verifiedAdmin?.name || currentUser?.name || 'Warehouse Staff';
      const existingAudit = Array.isArray(report.audit_trail) ? [...report.audit_trail] : [];
      const newAuditEvent = {
        timestamp: new Date().toISOString(),
        stage: 'TRIAGE',
        actor: inspectorName,
        condition_grade: conditionGrade,
        disposition: disposition,
        warehouse_location: warehouseLocation.trim().toUpperCase() || null,
        note: `Physical triage completed by ${inspectorName}`
      };

      const updates = {
        condition_grade: conditionGrade,
        disposition: disposition,
        warehouse_location: warehouseLocation.trim().toUpperCase() || null,
        status: rmaStatus,
        inspected_by: inspectorName,
        inspected_at: new Date().toISOString(),
        audit_trail: [...existingAudit, newAuditEvent]
      };

      const { data, error } = await supabase
        .from('rma_reports')
        .update(updates)
        .eq('id', report.id)
        .select('*')
        .single();

      if (error) {
        alert(`Failed to save warehouse triage: ${error.message}`);
      } else {
        const updatedReport = data || { ...report, ...updates };
        setReport(updatedReport);
        setTriageSavedSuccess(true);
        setTimeout(() => setTriageSavedSuccess(false), 3000);
        if (onRefresh) onRefresh(updatedReport);
        window.dispatchEvent(new CustomEvent('rma-data-changed', { detail: { type: 'triage-updated', reportId: report.id, report: updatedReport } }));
      }
    } catch (err) {
      alert(`Error updating triage: ${err.message}`);
    } finally {
      setIsSavingTriage(false);
    }
  };

  // Authentication & Verification State
  const [verifiedAdmin, setVerifiedAdmin] = useState(null);
  const [authStep, setAuthStep] = useState('email'); // 'email' | 'otp'
  const [emailInput, setEmailInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [isVerifying, setIsVerifying] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authSuccessMsg, setAuthSuccessMsg] = useState(null);

  // Sandbox Test Mode State: Strictly restricted to Super Admin
  const [isTestMode, setIsTestMode] = useState(() => {
    try {
      const user = authService.getCurrentUser();
      if (user?.role !== 'super_admin') return false;
      return typeof window !== 'undefined' && localStorage.getItem('rma_portal_test_mode') === 'true';
    } catch (e) {
      return false;
    }
  });

  useEffect(() => {
    const handleStorage = () => {
      try {
        const user = authService.getCurrentUser();
        if (user?.role === 'super_admin') {
          setIsTestMode(localStorage.getItem('rma_portal_test_mode') === 'true');
        } else {
          setIsTestMode(false);
        }
      } catch (e) {}
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('rma-data-changed', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('rma-data-changed', handleStorage);
    };
  }, []);

  // Check if current logged-in user is already admin or super admin
  useEffect(() => {
    if (!isOpen) return;

    if (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'admin')) {
      setVerifiedAdmin(currentUser);
      return;
    }

    // Check session storage cache for verified admin in THIS tab only (never localStorage)
    try {
      const cached = sessionStorage.getItem(QUICK_AUTH_STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && (parsed.role === 'super_admin' || parsed.role === 'admin')) {
          setVerifiedAdmin(parsed);
          return;
        }
      }
    } catch (e) {}

    setVerifiedAdmin(null);
    setAuthStep('email');
    setOtpInput('');
  }, [isOpen, currentUser]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // 1. Primary fetch when modal opens or rmaNumber changes
  useEffect(() => {
    if (!isOpen || !rmaNumber) {
      setReport(null);
      setReportError(null);
      setIsLoadingReport(false);
      return;
    }

    let isMounted = true;
    const cleanRma = String(rmaNumber).trim();

    // Try local list first for instant responsiveness
    const localMatch = recentReportsList.find(
      r => String(r.rma_number || '').toUpperCase() === cleanRma.toUpperCase() ||
           String(r.id) === cleanRma
    );

    if (localMatch) {
      setReport(localMatch);
      setIsLoadingReport(false);
    } else {
      setIsLoadingReport(true);
    }
    setReportError(null);

    // Fetch fresh record from Supabase
    (async () => {
      try {
        let query = supabase.from('rma_reports').select('*');
        if (/^\d+$/.test(cleanRma)) {
          query = query.or(`rma_number.ilike.${cleanRma},id.eq.${cleanRma}`);
        } else {
          query = query.ilike('rma_number', cleanRma);
        }

        const { data, error } = await query.limit(1);

        if (!isMounted) return;

        if (error) {
          console.warn('Supabase fetch RMA notice:', error);
          if (!localMatch) {
            setReportError(`Failed to load RMA record: ${error.message}`);
          }
        } else if (data && data.length > 0) {
          setReport(data[0]);
        } else if (!localMatch) {
          setReportError(`No return report found matching "${cleanRma}". Please check the QR code or serial number.`);
        }
      } catch (err) {
        if (isMounted && !localMatch) {
          setReportError(`Error looking up RMA: ${err.message}`);
        }
      } finally {
        if (isMounted) setIsLoadingReport(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [isOpen, rmaNumber]);

  // 2. Silent background sync when recentReportsList updates (WITHOUT triggering loading spinners or unmounting UI)
  useEffect(() => {
    if (!isOpen || !rmaNumber || !recentReportsList.length) return;
    const cleanRma = String(rmaNumber).trim().toUpperCase();
    const match = recentReportsList.find(
      r => String(r.rma_number || '').toUpperCase() === cleanRma || String(r.id) === cleanRma
    );
    if (match) {
      setReport(prev => {
        if (!prev) return match;
        // Only trigger state update if meaningful fields actually changed
        if (prev.status !== match.status || prev.code !== match.code || prev.name !== match.name || prev.notes !== match.notes) {
          return match;
        }
        return prev;
      });
    }
  }, [isOpen, rmaNumber, recentReportsList]);

  // Step 1: Request OTP for authorized company admin
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
      // 1. Verify that email belongs to an active employee
      const employees = await authService.getEmployees();
      const emp = employees.find(e => e.email?.toLowerCase() === cleanEmail);

      if (!emp) {
        throw new Error(`Access Denied: "${cleanEmail}" is not recognized as an authorized company account. Public customers and unverified users cannot access Quick Actions.`);
      }

      if (emp.is_active === false) {
        throw new Error(`Access Denied: The employee account (${cleanEmail}) is marked as Resigned or Inactive.`);
      }

      if (emp.role !== 'super_admin' && emp.role !== 'admin') {
        throw new Error(`Permission Restricted: Account "${cleanEmail}" has role "${emp.role}". Only Admin and Super Admin roles can operate Return Quick Actions.`);
      }

      // 2. Request OTP via authService
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

  // Step 2: Verify 6-digit OTP Code
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

  if (!isOpen) return null;

  // Derive catalog & memo status for this report
  const cleanBarcode = String(report?.barcode || '').trim();
  const matchedProduct = cleanBarcode 
    ? savedProductsList.find(p => p.barcode && String(p.barcode).trim() === cleanBarcode) 
    : null;
  const isSavedInProducts = Boolean(matchedProduct && matchedProduct.is_verified !== false);

  const existingMemo = report
    ? creditMemosList.find(m => m.rma_number === report?.rma_number || String(m.report_id) === String(report?.id))
    : null;

  // Enterprise Multi-Tier Financial Threshold Rule:
  // If total claim exceeds ₱10,000, Super Admin authorization is required to activate Credit Memo button
  const itemQty = Number(report?.quantity) || 1;
  const itemUnitPrice = Number(report?.price_with_vat) || Number(report?.price) || Number(matchedProduct?.price_with_vat) || Number(matchedProduct?.price) || 0;
  const totalClaimValue = itemQty * itemUnitPrice;
  const isHighValueClaim = totalClaimValue > 10000;
  const isSuperAdmin = (verifiedAdmin?.role === 'super_admin' || currentUser?.role === 'super_admin');
  const canIssueCreditMemo = !isHighValueClaim || isSuperAdmin;

  // Photos
  const photoList = report?.photo_urls 
    ? (Array.isArray(report.photo_urls) ? report.photo_urls : [report.photo_urls])
    : (report?.photo_url ? [report.photo_url] : []);

  const reporterName = report?.reporter_name || report?.reported_by || report?.customer_name || 'Staff / Customer';
  const reporterContact = report?.reporter_contact || report?.reporter_phone || report?.phone || '';

  // Paperwork & AI Verification Details
  const paperworkList = report?.paperwork_photos
    ? (Array.isArray(report.paperwork_photos) ? report.paperwork_photos : [report.paperwork_photos])
    : [];
  const aiMetadata = report?.ai_document_metadata || null;
  const [adminDrNumber, setAdminDrNumber] = useState(report?.invoice_dr_number || aiMetadata?.invoice_dr_number || '');
  const [adminStoreBranch, setAdminStoreBranch] = useState(report?.store_branch || aiMetadata?.store_branch || '');
  const [isEditingAiDetails, setIsEditingAiDetails] = useState(false);
  const [isSavingAiDetails, setIsSavingAiDetails] = useState(false);

  useEffect(() => {
    setAdminDrNumber(report?.invoice_dr_number || report?.ai_document_metadata?.invoice_dr_number || '');
    setAdminStoreBranch(report?.store_branch || report?.ai_document_metadata?.store_branch || '');
    setIsEditingAiDetails(false);
  }, [report?.id, report?.invoice_dr_number, report?.store_branch]);

  const handleSaveAiDetails = async () => {
    if (!report?.id) return;
    setIsSavingAiDetails(true);
    try {
      const { error } = await supabase
        .from('rma_reports')
        .update({
          invoice_dr_number: adminDrNumber.trim() || null,
          store_branch: adminStoreBranch.trim() || null
        })
        .eq('id', report.id);

      if (error) throw error;
      report.invoice_dr_number = adminDrNumber.trim();
      report.store_branch = adminStoreBranch.trim();
      setIsEditingAiDetails(false);
      onReportUpdated && onReportUpdated({
        ...report,
        invoice_dr_number: adminDrNumber.trim(),
        store_branch: adminStoreBranch.trim()
      });
    } catch (e) {
      console.error('Failed to update AI details:', e);
      alert('Failed to save updated DR/Branch details.');
    } finally {
      setIsSavingAiDetails(false);
    }
  };

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
                    RMA Quick Processing
                  </h3>
                  <span className="hidden sm:inline-flex text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/20 text-white font-bold shrink-0">
                    Box QR Action
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-blue-100 font-medium truncate">
                  Instant intake, SKU assignment & Credit Memo
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

          {/* 1. Loading State (Only if not yet loaded) */}
          {isLoadingReport && !report && (
            <div className="py-8 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
              <p className="text-xs font-bold text-slate-600 dark:text-slate-400">
                Retrieving Return Authorization details for <span className="font-mono">{rmaNumber}</span>...
              </p>
            </div>
          )}

          {/* 2. Error Loading Report */}
          {reportError && !report && (
            <div className="p-4 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-2xl flex items-start gap-3 text-rose-800 dark:text-rose-200">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs">
                <div className="font-bold">Return Record Not Found</div>
                <p>{reportError}</p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3 py-1.5 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700 transition-colors"
                  >
                    Close Window
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 3. Report Loaded: Display Summary Card */}
          {report && (
            <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-2xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700 pb-3">
                <div className="space-y-0.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Scanned Return Authorization
                  </span>
                  <div className="text-lg font-black font-mono text-slate-900 dark:text-white flex items-center gap-2">
                    <span>{report.rma_number || rmaNumber}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                      report.status === 'logged' || isSavedInProducts
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                    }`}>
                      {report.status === 'logged' || isSavedInProducts ? 'LOGGED' : 'UNKNOWN'}
                    </span>
                  </div>
                </div>

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

              {/* Product Info Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Item Barcode</span>
                  <div className="font-mono font-bold text-slate-900 dark:text-white text-sm">
                    {report.barcode || 'N/A'}
                  </div>
                  {matchedProduct?.code && (
                    <div className="font-mono text-[11px] text-blue-600 dark:text-blue-400">
                      SKU: {matchedProduct.code}
                    </div>
                  )}
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Product Name</span>
                  <div className="font-bold text-slate-900 dark:text-white truncate" title={report.name || report.product_name}>
                    {matchedProduct?.name || report.name || report.product_name || `Barcode ${report.barcode}`}
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
                  <div className="font-bold text-slate-800 dark:text-slate-200">
                    {reporterName}
                  </div>
                  {reporterContact && (
                    <div className="font-mono text-[10px] text-slate-500">
                      {reporterContact}
                    </div>
                  )}
                </div>
              </div>

              {/* Proof Photos Thumbnail */}
              {photoList.length > 0 && (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase text-slate-400">Proof Photo:</span>
                  <button
                    type="button"
                    onClick={() => onOpenLightbox && onOpenLightbox({
                      images: photoList,
                      initialIndex: 0,
                      url: photoList[0],
                      title: report.name || `Return ${report.rma_number}`,
                      subtitle: `RMA #${report.rma_number} • Reported by ${reporterName}`
                    })}
                    className="w-10 h-10 rounded-xl overflow-hidden border border-slate-300 dark:border-slate-600 hover:scale-105 shadow-xs transition-transform cursor-zoom-in inline-block"
                    title="Click to zoom proof photo"
                  >
                    <img src={photoList[0]} alt="Proof" className="w-full h-full object-cover" />
                  </button>
                </div>
              )}

              {/* Direct Google Drive Folder Link */}
              {report?.google_drive_folder_url && (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase text-slate-400">Drive Storage:</span>
                  <a
                    href={report.google_drive_folder_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                    title="Open organized Google Drive folder with Damaged Items & Paperwork subfolders"
                  >
                    <Folder className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    <span>Open RMA Drive Folder</span>
                    <ExternalLink className="w-3 h-3 text-amber-500" />
                  </a>
                </div>
              )}

              {/* Official Logistics Paperwork & AI Verification Details */}
              {(paperworkList.length > 0 || report.invoice_dr_number || report.store_branch || aiMetadata) && (
                <div className="pt-2.5 border-t border-slate-200 dark:border-slate-700 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-violet-300 border border-violet-200 dark:border-violet-800 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        AI Verified {aiMetadata?.document_type || 'Paperwork'}
                      </span>
                      {aiMetadata?.confidence && (
                        <span className="text-[10px] font-mono font-bold text-slate-400">
                          {Math.round(aiMetadata.confidence * 100)}%
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsEditingAiDetails(!isEditingAiDetails)}
                      className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      {isEditingAiDetails ? 'Cancel Edit' : 'Edit DR# / Branch'}
                    </button>
                  </div>

                  <div className="flex items-start gap-3 bg-violet-50/50 dark:bg-violet-950/20 p-2.5 rounded-2xl border border-violet-100 dark:border-violet-900/50">
                    {paperworkList.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onOpenLightbox && onOpenLightbox({
                          images: paperworkList,
                          initialIndex: 0,
                          url: paperworkList[0],
                          title: aiMetadata?.document_type || 'Paperwork Document',
                          subtitle: `DR #${adminDrNumber || report.invoice_dr_number || 'N/A'} • ${adminStoreBranch || report.store_branch || ''}`
                        })}
                        className="w-12 h-12 rounded-xl overflow-hidden border border-violet-200 dark:border-violet-800 hover:scale-105 shadow-xs transition-transform cursor-zoom-in shrink-0"
                        title="Click to view paperwork photo"
                      >
                        <img src={paperworkList[0]} alt="Paperwork" className="w-full h-full object-cover" />
                      </button>
                    )}

                    <div className="flex-1 min-w-0 text-xs space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 text-[10px] uppercase font-bold">DR / Invoice:</span>
                        <strong className="font-mono text-slate-900 dark:text-white font-black">{adminDrNumber || report.invoice_dr_number || 'None assigned'}</strong>
                      </div>
                      {(adminStoreBranch || report.store_branch) && (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 text-[10px] uppercase font-bold">Store Branch:</span>
                          <strong className="text-slate-800 dark:text-slate-200 truncate">{adminStoreBranch || report.store_branch}</strong>
                        </div>
                      )}
                      {aiMetadata?.vendor_name && (
                        <div className="text-[10px] text-slate-500 truncate">
                          Vendor: <span className="font-semibold text-slate-700 dark:text-slate-300">{aiMetadata.vendor_name}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Manual Override Editor for Admin */}
                  {isEditingAiDetails && (
                    <div className="p-3 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-2xl space-y-2 animate-in fade-in">
                      <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                        Manual Override (Edit handwritten or OCR misread values):
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-0.5">DR / Invoice #</label>
                          <input
                            type="text"
                            value={adminDrNumber}
                            onChange={(e) => setAdminDrNumber(e.target.value)}
                            className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-bold"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-0.5">Store Branch</label>
                          <input
                            type="text"
                            value={adminStoreBranch}
                            onChange={(e) => setAdminStoreBranch(e.target.value)}
                            className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={isSavingAiDetails}
                        onClick={handleSaveAiDetails}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
                      >
                        {isSavingAiDetails ? 'Saving...' : 'Save Updated Details'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 4. Access Control Gate: Email OTP Verification for Admin / Super Admin */}
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
                    Only authorized Admin & Super Admin staff can operate Return Quick Actions. Enter your company email to receive a 6-digit OTP verification code.
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
                    className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-extrabold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isVerifying ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Sending Security OTP...</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        <span>Send 6-Digit OTP to Email</span>
                      </>
                    )}
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
                      className="w-full pl-10 pr-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-center font-mono tracking-widest text-sm font-black text-slate-900 dark:text-white placeholder:tracking-normal placeholder:font-normal placeholder:text-xs focus:outline-none focus:border-blue-600 transition-all"
                      required
                      autoFocus
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={isVerifying || otpInput.trim().length < 6}
                      className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-extrabold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {isVerifying ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Verifying OTP...</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-4 h-4" />
                          <span>Verify & Unlock</span>
                        </>
                      )}
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

          {/* 5. Authenticated Admin Actions Bar (Strictly requires verifiedAdmin AND loaded report) */}
          {report && verifiedAdmin && (
            <div className="space-y-3">
              {/* Verified Admin Strip */}
              <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-bold">
                    Authenticated: {verifiedAdmin.name} ({verifiedAdmin.role === 'super_admin' ? '👑 Super Admin' : '🛡️ Admin'})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleSwitchAccount}
                  className="text-[10px] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 underline font-medium cursor-pointer"
                >
                  Switch
                </button>
              </div>

              {/* ENTERPRISE ACTION 1: PHYSICAL DISPOSITION & WAREHOUSE TRIAGE MODULE */}
              <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-xs space-y-3">
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300">
                      <Layers className="w-4 h-4" />
                    </div>
                    <div>
                      <h5 className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                        <span>Warehouse Triage & Physical Disposition</span>
                      </h5>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Assign condition grade, quarantine status, and physical rack/bin location.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsThermalLabelOpen(true)}
                    className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer shrink-0"
                    title="Print 4x6 inch thermal sticker label"
                  >
                    <Printer className="w-3.5 h-3.5 text-amber-400" />
                    <span>Print 4x6" Label</span>
                  </button>
                </div>

                {triageSavedSuccess && (
                  <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-800 rounded-xl text-xs font-bold text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Warehouse triage & location saved successfully!</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                  {/* Condition Grade */}
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block mb-1">
                      Condition Grade
                    </label>
                    <select
                      value={conditionGrade}
                      onChange={(e) => setConditionGrade(e.target.value)}
                      className="w-full px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-bold text-slate-900 dark:text-white text-xs focus:outline-none focus:border-blue-600"
                    >
                      <option value="A - Like New / Resellable">A - Like New / Resellable</option>
                      <option value="B - Damaged Packaging Only">B - Damaged Packaging Only</option>
                      <option value="C - Defective / Parts Only">C - Defective / Parts Only</option>
                      <option value="D - Total Loss / Scrap">D - Total Loss / Scrap</option>
                    </select>
                  </div>

                  {/* Disposition */}
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block mb-1">
                      Warehouse Disposition
                    </label>
                    <select
                      value={normalizeDispositionOption(disposition)}
                      onChange={(e) => setDisposition(e.target.value)}
                      className="w-full px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-bold text-slate-900 dark:text-white text-xs focus:outline-none focus:border-blue-600"
                    >
                      <option value="1- Pending Triage">1- Pending Triage</option>
                      <option value="2- Restock to Inventory">2- Restock to Inventory</option>
                      <option value="3- Return to Vendor (RTV)">3- Return to Vendor (RTV)</option>
                      <option value="4- Quarantine">4- Quarantine</option>
                      <option value="5- Scrap / Dispose">5- Scrap / Dispose</option>
                    </select>
                  </div>

                  {/* Warehouse Location (Bin / Rack) */}
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block mb-1">
                      Warehouse Rack / Bin Location
                    </label>
                    <div className="relative">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                      <input
                        type="text"
                        value={warehouseLocation}
                        onChange={(e) => setWarehouseLocation(e.target.value)}
                        placeholder="e.g. RACK-03-BIN-A"
                        className="w-full pl-8 pr-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-mono text-xs font-bold text-slate-900 dark:text-white uppercase placeholder:normal-case placeholder-slate-400 focus:outline-none focus:border-blue-600"
                      />
                    </div>
                  </div>

                  {/* RMA Lifecycle Status */}
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block mb-1">
                      Lifecycle Stage
                    </label>
                    <select
                      value={rmaStatus}
                      onChange={(e) => setRmaStatus(e.target.value)}
                      className="w-full px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-bold text-slate-900 dark:text-white text-xs focus:outline-none focus:border-blue-600"
                    >
                      <option value="draft">1- Draft / Intake</option>
                      <option value="received_at_dock">2- Received at Dock</option>
                      <option value="under_inspection">3- Under Inspection</option>
                      <option value="pending_finance_approval">4- Pending Finance Approval</option>
                      <option value="credit_memo_issued">5- Credit Memo Issued</option>
                      <option value="closed">6- Closed / Restocked</option>
                      <option value="rejected">7- Rejected / Invalid Claim</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] text-slate-400">
                    Inspected by: <strong className="text-slate-700 dark:text-slate-300">{report?.inspected_by || verifiedAdmin?.name || 'Staff'}</strong>
                  </span>

                  <button
                    type="button"
                    onClick={handleSaveTriage}
                    disabled={isSavingTriage}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isSavingTriage ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Save Physical Triage</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* ENTERPRISE ACTION 2: ASSIGN SKU & SAVE TO CATALOG */}
              <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-xs space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-xl ${isSavedInProducts ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300'}`}>
                      <Package className="w-4 h-4" />
                    </div>
                    <div>
                      <h5 className="text-xs font-black text-slate-900 dark:text-white">
                        {isSavedInProducts ? 'Catalog Status: Saved & Verified' : 'Catalog Status: Not Saved in Products'}
                      </h5>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {isSavedInProducts
                          ? `Registered under Pingcon SKU "${matchedProduct?.code || 'Assigned'}" • ${matchedProduct?.name || ''}`
                          : 'Assign an official SKU and register this barcode in master products catalog.'}
                      </p>
                    </div>
                  </div>

                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider shrink-0 ${
                    isSavedInProducts
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                  }`}>
                    {isSavedInProducts ? 'Verified SKU' : 'Action Needed'}
                  </span>
                </div>

                {!isSavedInProducts ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (onAssignSku && report) {
                        onAssignSku(report);
                      }
                    }}
                    className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                  >
                    <Package className="w-4 h-4" />
                    <span>Assign SKU & Save to Products</span>
                  </button>
                ) : (
                  <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
                    <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                      SKU: <strong className="text-slate-900 dark:text-white">{matchedProduct.code}</strong> • ₱{Number(matchedProduct.price || 0).toFixed(2)}
                    </div>
                    <button
                      type="button"
                      onClick={() => onAssignSku && onAssignSku(report)}
                      className="text-xs text-blue-600 dark:text-blue-400 font-bold hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>Update SKU Details</span>
                    </button>
                  </div>
                )}
              </div>

              {/* ENTERPRISE ACTION 3: FINANCE CREDIT MEMO WITH FINANCIAL SAFEGUARD */}
              <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-xs space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-xl ${existingMemo ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400'}`}>
                      <Receipt className="w-4 h-4" />
                    </div>
                    <div>
                      <h5 className="text-xs font-black text-slate-900 dark:text-white">
                        {existingMemo ? `Credit Memo: ${existingMemo.credit_memo_number}` : 'Finance Credit Memorandum'}
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

                {/* Financial Safety Rule Notice (> ₱10,000) */}
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
                          ? `👑 Super Admin Approved (> ₱10,000 Claim)`
                          : `🔒 Financial Safety Lock (Claim > ₱10,000)`}
                      </div>
                      <p className="text-[11px] opacity-90">
                        {isSuperAdmin
                          ? `Authorized by ${verifiedAdmin?.name || currentUser?.name} (Super Admin). Credit Memo issuance enabled.`
                          : `Total claim is ₱${totalClaimValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}, exceeding the ₱10,000 threshold. Only a Super Admin can issue this credit memo.`}
                      </p>
                    </div>
                  </div>
                )}

                {!existingMemo ? (
                  <button
                    type="button"
                    disabled={!canIssueCreditMemo}
                    onClick={() => {
                      if (canIssueCreditMemo && onOpenCreditMemo && report) {
                        onOpenCreditMemo(report);
                      }
                    }}
                    className={`w-full py-2.5 px-4 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 shadow-sm transition-all ${
                      canIssueCreditMemo
                        ? 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white cursor-pointer'
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
                      className="py-2 px-3 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/70 dark:hover:bg-emerald-900/70 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Print CM Voucher</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenCreditMemo && onOpenCreditMemo(report, existingMemo)}
                      className="py-2 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit CM</span>
                    </button>
                  </div>
                )}
              </div>

              {/* ENTERPRISE AUDIT TRAIL & LIFECYCLE TIMELINE */}
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

      {/* 4x6" Thermal Box Label Modal */}
      {isThermalLabelOpen && report && (
        <ThermalBoxLabelModal
          isOpen={isThermalLabelOpen}
          onClose={() => setIsThermalLabelOpen(false)}
          report={report}
          currentUser={verifiedAdmin || currentUser}
        />
      )}
    </div>
  );
}
