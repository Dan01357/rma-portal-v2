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
  ArrowRight
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { authService } from '../services/authService';

const QUICK_AUTH_STORAGE_KEY = 'rma_quick_auth_admin';

export default function QuickRMAActionModal({
  isOpen,
  onClose,
  rmaNumber,
  currentUser,
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

  // Authentication & Verification State
  const [verifiedAdmin, setVerifiedAdmin] = useState(null);
  const [emailInput, setEmailInput] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authSuccessMsg, setAuthSuccessMsg] = useState(null);

  // Sandbox Test Mode State (mirrors admin website toggle)
  const [isTestMode, setIsTestMode] = useState(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem('rma_portal_test_mode') === 'true';
    } catch (e) {
      return false;
    }
  });

  useEffect(() => {
    const handleStorage = () => {
      try {
        setIsTestMode(localStorage.getItem('rma_portal_test_mode') === 'true');
      } catch (e) {}
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('rma-data-changed', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('rma-data-changed', handleStorage);
    };
  }, []);

  const toggleTestMode = () => {
    setIsTestMode(prev => {
      const next = !prev;
      try {
        localStorage.setItem('rma_portal_test_mode', String(next));
        window.dispatchEvent(new Event('storage'));
        window.dispatchEvent(new CustomEvent('rma-data-changed', { detail: { type: 'test-mode-toggled', isTestMode: next } }));
      } catch (e) {}
      return next;
    });
  };

  // Check if current logged-in user is already admin or super admin
  useEffect(() => {
    if (!isOpen) return;

    if (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'admin')) {
      setVerifiedAdmin(currentUser);
      return;
    }

    // Check session storage cache for verified admin
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
  }, [isOpen, currentUser]);

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

  // Verification Form Submit
  const handleVerifyEmail = async (e) => {
    e.preventDefault();
    const cleanEmail = emailInput.trim().toLowerCase();
    setAuthError(null);
    setAuthSuccessMsg(null);

    if (!cleanEmail) {
      setAuthError('Please enter your company email address.');
      return;
    }

    setIsVerifying(true);

    try {
      // 1. Check Supabase admin_users
      let emp = null;
      try {
        const { data, error } = await supabase
          .from('admin_users')
          .select('*')
          .ilike('email', cleanEmail)
          .limit(1);

        if (!error && data && data.length > 0) {
          emp = data[0];
        }
      } catch (dbErr) {
        console.warn('Supabase user lookup warning:', dbErr);
      }

      // 2. Check designated admins directory
      const defaultAdminList = [
        { name: 'Danilo Alvaro Jr. (Super Admin)', email: 'finance2@keysysincorporated.com', role: 'super_admin', is_active: true, department: 'Finance Systems / IT' },
        { name: 'Alleli F. Almaida', email: 'alleli.almaida@ph.keysys.com', role: 'admin', is_active: true, department: 'Finance' },
        { name: 'Analiza B. Benosa', email: 'finance@a2z2go.net', role: 'admin', is_active: true, department: 'Finance' },
        { name: 'Glencel O. Azogue', email: 'accountspayable@keysysincorporated.com', role: 'admin', is_active: true, department: 'Accounts Payable' },
        { name: 'Jarmen A. Cachero', email: 'finance4@keysysincorporated.com', role: 'admin', is_active: true, department: 'Finance Systems' },
        { name: 'Mark John A. Aquino', email: 'mark.aquino@a2z2go.net', role: 'admin', is_active: true, department: 'A2Z2GO Procurement' },
        { name: 'Ralph Raven A. Alido', email: 'ralph.alido@a2z2go.net', role: 'admin', is_active: true, department: 'A2Z2GO Operations' },
        { name: 'Mary T. Gan', email: 'mgan@pingconmarketing.com', role: 'admin', is_active: true, department: 'Executive Management' }
      ];

      const designatedAdmin = defaultAdminList.find(e => e.email.toLowerCase() === cleanEmail);
      if (designatedAdmin) {
        emp = {
          ...(emp || {}),
          ...designatedAdmin,
          role: designatedAdmin.role
        };
      }

      if (!emp) {
        setAuthError(`Access Denied: "${cleanEmail}" is not recognized as an authorized company account. Customer and public access is restricted.`);
        setIsVerifying(false);
        return;
      }

      if (emp.is_active === false) {
        setAuthError(`Access Denied: The employee account (${cleanEmail}) is marked as Resigned or Inactive.`);
        setIsVerifying(false);
        return;
      }

      if (emp.role !== 'super_admin' && emp.role !== 'admin') {
        setAuthError(`Permission Restricted: Account "${cleanEmail}" has role "${emp.role}". Only Admin and Super Admin roles can assign SKUs and issue Credit Memos.`);
        setIsVerifying(false);
        return;
      }

      // Successful verification!
      const verified = {
        name: emp.name || emp.full_name || 'Admin',
        email: cleanEmail,
        role: emp.role,
        department: emp.department || 'Finance'
      };

      setVerifiedAdmin(verified);
      sessionStorage.setItem(QUICK_AUTH_STORAGE_KEY, JSON.stringify(verified));
      setAuthSuccessMsg(`Welcome, ${verified.name}! Admin Quick Actions unlocked.`);
    } catch (err) {
      setAuthError(`Verification error: ${err.message}`);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSwitchAccount = () => {
    setVerifiedAdmin(null);
    sessionStorage.removeItem(QUICK_AUTH_STORAGE_KEY);
    setEmailInput('');
    setAuthError(null);
    setAuthSuccessMsg(null);
  };

  if (!isOpen) return null;

  // Derive catalog & memo status for this report
  const cleanBarcode = report?.barcode ? String(report.barcode).trim() : '';
  const matchedProduct = cleanBarcode 
    ? savedProductsList.find(p => p.barcode && String(p.barcode).trim() === cleanBarcode) 
    : null;
  const isSavedInProducts = Boolean(matchedProduct && matchedProduct.is_verified !== false);

  const existingMemo = report
    ? creditMemosList.find(m => m.rma_number === report.rma_number || m.report_id === report.id)
    : null;

  // Photos
  const photoList = report?.photo_urls 
    ? (Array.isArray(report.photo_urls) ? report.photo_urls : [report.photo_urls])
    : (report?.photo_url ? [report.photo_url] : []);

  const reporterName = report?.reporter_name || report?.reported_by || report?.customer_name || 'Staff / Customer';
  const reporterContact = report?.reporter_contact || report?.reporter_phone || report?.phone || '';

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

        {/* Test Mode Enabler Strip (Matches Admin Website) */}
        <div className={`px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 text-xs border-b transition-colors shrink-0 ${
          isTestMode 
            ? 'bg-amber-50 dark:bg-amber-950/70 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200' 
            : 'bg-slate-100 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
        }`}>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base shrink-0">🧪</span>
            <div className="min-w-0">
              <span className="font-extrabold truncate block text-[11px] sm:text-xs">
                {isTestMode ? 'TEST MODE ACTIVE (Safe Sandbox)' : 'Live Email Delivery Active'}
              </span>
              <span className="text-[10px] opacity-80 hidden sm:inline">
                {isTestMode ? 'Test emails routed exclusively to finance2@keysysincorporated.com' : 'Live notifications sent to staff & customer AE'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleTestMode}
            className={`px-3 py-1 rounded-xl text-[11px] font-black cursor-pointer shrink-0 transition-all ${
              isTestMode
                ? 'bg-amber-200 dark:bg-amber-900 hover:bg-amber-300 dark:hover:bg-amber-800 text-amber-950 dark:text-amber-100 shadow-xs'
                : 'bg-white dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-600 shadow-2xs'
            }`}
          >
            {isTestMode ? 'Disable Test Mode' : 'Enable Test Mode'}
          </button>
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
            </div>
          )}

          {/* 4. Access Control Gate: Email Verification for Admin / Super Admin */}
          {!verifiedAdmin ? (
            <div className="p-4 sm:p-5 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-slate-800 dark:to-slate-800/90 border-2 border-amber-300 dark:border-amber-700 rounded-3xl shadow-sm space-y-3.5">
              <div className="flex items-start gap-3">
                <div className="p-2.5 bg-amber-500 text-white rounded-2xl shadow-xs shrink-0">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                    <span>Admin Verification Required</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-200 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 font-bold">
                      Protected Action
                    </span>
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                    Customers cannot edit or issue credit memos. Enter your active company employee email to unlock Quick Actions for this return.
                  </p>
                </div>
              </div>

              {authError && (
                <div className="p-3 bg-rose-100 dark:bg-rose-950/70 border border-rose-300 dark:border-rose-800 rounded-xl text-xs font-semibold text-rose-800 dark:text-rose-200 flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{authError}</span>
                </div>
              )}

              <form onSubmit={handleVerifyEmail} className="space-y-2.5">
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
                  disabled={isVerifying}
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-extrabold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isVerifying ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Verifying Role Permissions...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>Verify Email & Unlock Quick Actions</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          ) : (
            /* 5. Authenticated Admin Actions Bar */
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

              {/* ACTION 1: ASSIGN SKU & SAVE TO CATALOG */}
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

              {/* ACTION 2: FINANCE CREDIT MEMO */}
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
                          : 'Issue an accounting credit memo to deduct this return from customer invoices.'}
                      </p>
                    </div>
                  </div>

                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider shrink-0 ${
                    existingMemo
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                      : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}>
                    {existingMemo ? 'Issued' : 'Unbilled'}
                  </span>
                </div>

                {!existingMemo ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (onOpenCreditMemo && report) {
                        onOpenCreditMemo(report);
                      }
                    }}
                    className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                  >
                    <Receipt className="w-4 h-4" />
                    <span>+ Issue Credit Memo</span>
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
