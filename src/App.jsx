import React, { useState, useEffect, useRef } from 'react';
import {
  Barcode,
  Search,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  X,
  Server,
  Database,
  Camera,
  Plus,
  Minus,
  Send,
  FileText,
  AlertTriangle,
  MapPin,
  Upload,
  Image as ImageIcon,
  ShieldCheck,
  ArrowRight,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  User,
  Phone,
  Mail,
  Lock,
  Unlock,
  LogOut,
  Users,
  ShieldAlert,
  Package,
  Tag,
  List,
  LayoutGrid,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Filter,
  Trash2,
  Sun,
  Moon,
  Settings,
  Receipt,
  Printer,
  QrCode,
  Download,
  Building2,
  Layers,
  FlaskConical,
  ToggleRight,
  ToggleLeft,
  ClipboardCheck,
  KeyRound,
  Sparkles,
  Calendar,
  Building,
  Truck,
  Ticket,
  Clock
} from 'lucide-react';
import { downloadQrCodePng, downloadBoxStickerPng } from './utils/qrDownload';
import { catalogService } from './services/catalogService';
import { creditMemoService } from './services/creditMemoService';
import TablePagination from './components/TablePagination';
import { authService } from './services/authService';
import { supabase } from './supabaseClient';
import ScannerModal from './components/ScannerModal';
import PendingBarcodesModal from './components/PendingBarcodesModal';
import RMAReportsModal from './components/RMAReportsModal';
import AdminLoginModal from './components/AdminLoginModal';
import EmployeeManagementModal from './components/EmployeeManagementModal';
import SavedProductsTab from './components/SavedProductsTab';
import SettingsTab from './components/SettingsTab';
import CreditMemosTab from './components/CreditMemosTab';
import SupplierClaimsTab from './components/SupplierClaimsTab';
import ThermalBoxLabelModal from './components/ThermalBoxLabelModal';
import { exportRMAReportsToCSV, exportCustomerInboundRMAsToCSV, exportSupplierOutboundClaimsToCSV } from './utils/exportCsv';
import CreditMemoModal from './components/CreditMemoModal';
import CreditMemoVoucherModal from './components/CreditMemoVoucherModal';
import ProductEditModal from './components/ProductEditModal';
import ImageLightboxModal from './components/ImageLightboxModal';
import NotificationBell from './components/NotificationBell';
import DeleteConfirmationModal from './components/DeleteConfirmationModal';
import ReturnQRModal from './components/ReturnQRModal';
import QuickRMAActionModal from './components/QuickRMAActionModal';
import GatekeeperPinModal from './components/GatekeeperPinModal';
import CustomerRMAInvitesModal from './components/CustomerRMAInvitesModal';
import { inviteService, formatRemainingCountdown } from './services/inviteService';
import { accessKeyService } from './services/accessKeyService';
import { notificationService } from './services/notificationService';
import { QRCodeSVG } from 'qrcode.react';
import { isSplitChildTicket, isSplitParentTicket, hasAssignedSku, getReportManifestItems, isBatchManifest, formatQuantityWithPackSize, formatManifestBreakdown, resolveBatchManifestLifecycle } from './utils/rmaHelpers';

const DEFECT_REASONS = [
  '1- Damaged Box / Crushed Packaging',
  '2- Expired / Near Expiry Date',
  '3- Spoiled / Broken Seal / Leaking',
  '4- Wrong Item / Incorrect Shipment',
  '5- Customer Pull-out / Unsold',
  '6- Other Defect'
];

/**
 * Helper to identify whether a row is a manifest line-item child row.
 * Manifest line-item children share the identical rma_number with their parent and should be collapsed into the parent ticket.
 * Split tickets (e.g. -B, -C) have their own distinct RMA number and are standalone tickets.
 */
export function isManifestSubItem(item, allReports = []) {
  if (!item) return false;
  // Standalone split tickets (e.g. -B, -C, -D) must ALWAYS be visible in the table
  if (/-(?:B|C|D|E)$/i.test(String(item.rma_number || ''))) {
    return false;
  }
  // Only collapse child items that share the EXACT same rma_number as an existing parent manifest container
  if (Array.isArray(allReports) && item.rma_number) {
    const parent = allReports.find(p => (
      p && p.rma_number === item.rma_number &&
      (p.is_parent === true || String(p.name || '').toLowerCase().startsWith('batch return manifest'))
    ));
    if (parent && String(parent.id) !== String(item.id)) {
      return true;
    }
  }
  return false;
}

/**
 * Universal Lifecycle Stage Formatter & Color Resolver
 */
function formatLifecycleStage(status) {
  if (!status) return { label: '2- Received at Dock', color: 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300 border-blue-200 dark:border-blue-800' };
  const s = String(status).toLowerCase();
  switch (s) {
    case 'draft':
      return { label: '1- Draft / Intake', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700' };
    case 'pending':
    case 'received_at_dock':
      return { label: '2- Received at Dock', color: 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300 border-blue-200 dark:border-blue-800' };
    case 'under_inspection':
      return { label: '3- Under Inspection', color: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border-amber-200 dark:border-amber-800' };
    case 'pending_finance_approval':
      return { label: '4- Pending Finance Approval', color: 'bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border-purple-200 dark:border-purple-800' };
    case 'credit_memo_issued':
      return { label: '5- Credit Memo Issued', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' };
    case 'restocked':
      return { label: '6- Restocked', color: 'bg-teal-100 text-teal-800 dark:bg-teal-950/70 dark:text-teal-300 border-teal-200 dark:border-teal-800' };
    case 'scrapped':
    case 'disposed':
      return { label: '7- Scrapped / Disposed', color: 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border-rose-200 dark:border-rose-800' };
    case 'partially_completed':
      return { label: 'Partially Completed', color: 'bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border-purple-300 dark:border-purple-800' };
    case 'closed':
    case 'resolved':
      return { label: 'Closed / Restocked', color: 'bg-teal-100 text-teal-800 dark:bg-teal-950/70 dark:text-teal-300 border-teal-200 dark:border-teal-800' };
    case 'buffer_replacement_dispatched':
    case 'buffer_dispatched':
      return { label: '🚚 Buffer Dispatched', color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800' };
    case 'rejected':
      return { label: '8- Rejected / Invalid Claim', color: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700' };
    case 'vendor_claimed':
      return { label: 'RTV Claimed', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700' };
    case 'pending_admin_details':
      return { label: 'Awaiting SKU', color: 'bg-orange-100 text-orange-800 dark:bg-orange-950/70 dark:text-orange-300 border-orange-200 dark:border-orange-800' };
    default:
      return { label: s.replace(/_/g, ' '), color: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-300' };
  }
}

/**
 * Resolves SI, DR, and PO numbers cleanly.
 * Strictly avoids mistaking an SI number for a DR number.
 */
export function getDocumentNumbers(item) {
  if (!item) return { si: 'N/A', dr: 'N/A', po: 'N/A' };

  let si = item.si_number ? String(item.si_number).trim() : null;
  let dr = item.dr_number ? String(item.dr_number).trim() : null;
  let po = item.po_number ? String(item.po_number).trim() : null;

  const legacy = item.invoice_dr_number ? String(item.invoice_dr_number).trim() : null;
  if (legacy) {
    if (!si && /^SI/i.test(legacy)) {
      si = legacy;
    } else if (!po && /^PO/i.test(legacy)) {
      po = legacy;
    } else if (!dr && !si && !po) {
      dr = legacy;
    }
  }

  return {
    si: si || 'N/A',
    dr: dr || 'N/A',
    po: po || 'N/A'
  };
}


/**
 * Resolves the QR Intake slug from pathname, hash, or query parameters.
 * Examples:
 * - /intake/dock -> "dock"
 * - /intake/returns -> "returns"
 * - #/intake/dock -> "dock"
 * - /?intake=dock -> "dock"
 * - /?slug=dock -> "dock"
 */
function getIntakeSlugFromUrl() {
  if (typeof window === 'undefined') return null;
  const path = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();

  const pathMatch = path.match(/^\/intake\/([^/?#]+)/i);
  if (pathMatch && pathMatch[1]) return decodeURIComponent(pathMatch[1]);

  const hashMatch = hash.match(/^#\/intake\/([^/?#]+)/i);
  if (hashMatch && hashMatch[1]) return decodeURIComponent(hashMatch[1]);

  try {
    const params = new URLSearchParams(window.location.search);
    const paramSlug = params.get('intake') || params.get('slug');
    if (paramSlug) return decodeURIComponent(paramSlug);
  } catch { }

  return null;
}

/**
 * Reconciles Google OAuth / Magic Link callback redirects for public invite tokens.
 * If Supabase's Site URL redirected an invite OAuth login to '/admin#access_token=...',
 * this immediately restores '/intake?token=...' while preserving the '#access_token' hash
 * so GatekeeperPinModal can verify the Google identity cleanly.
 */
function reconcileInviteOAuthRedirectOnLoad() {
  if (typeof window === 'undefined') return null;
  try {
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    const path = window.location.pathname.toLowerCase();

    const hasAuthCallback =
      hash.includes('access_token=') ||
      hash.includes('id_token=') ||
      /[?&]code=/.test(search) ||
      /[?&]token_hash=/.test(search);

    const isOAuthInProgress =
      localStorage.getItem('rma_oauth_in_progress') === 'true' ||
      sessionStorage.getItem('rma_oauth_in_progress') === 'true';

    const pendingToken =
      new URLSearchParams(search).get('token') ||
      localStorage.getItem('rma_pending_oauth_token') ||
      sessionStorage.getItem('rma_pending_oauth_token') ||
      localStorage.getItem('rma_active_invite_token') ||
      sessionStorage.getItem('rma_active_invite_token');

    if (hasAuthCallback && isOAuthInProgress && pendingToken) {
      sessionStorage.setItem('rma_active_invite_token', pendingToken);
      sessionStorage.setItem('rma_pending_oauth_token', pendingToken);
      sessionStorage.setItem('rma_oauth_in_progress', 'true');
      localStorage.setItem('rma_active_invite_token', pendingToken);
      localStorage.setItem('rma_pending_oauth_token', pendingToken);
      localStorage.setItem('rma_oauth_in_progress', 'true');

      const currentParams = new URLSearchParams(search);
      if (path.startsWith('/admin') || currentParams.get('token') !== pendingToken) {
        window.history.replaceState(
          null,
          '',
          `/intake?token=${encodeURIComponent(pendingToken)}${hash}`
        );
      }
      return pendingToken;
    }

    // If visiting /admin directly (not returning from an invite OAuth flow), clear leftover invite token flags
    if (path === '/admin' || path.startsWith('/admin/') || hash.toLowerCase() === '#/admin' || search.includes('admin=true')) {
      sessionStorage.removeItem('rma_active_invite_token');
      sessionStorage.removeItem('rma_pending_oauth_token');
      sessionStorage.removeItem('rma_oauth_in_progress');
      localStorage.removeItem('rma_pending_oauth_token');
      localStorage.removeItem('rma_oauth_in_progress');
    }
  } catch { }
  return null;
}

export default function App() {
  // ROUTE DETECTION: '/' (Public Reporter) vs '/admin' (Staff Admin Portal)
  const [isAdminView, setIsAdminView] = useState(() => {
    reconcileInviteOAuthRedirectOnLoad();
    const path = window.location.pathname.toLowerCase();
    const hash = window.location.hash.toLowerCase();
    return path === '/admin' || path.startsWith('/admin/') || hash === '#/admin' || window.location.search.includes('admin=true');
  });

  // Authenticated Admin User (Strictly from verified authService session)
  const [currentUser, setCurrentUser] = useState(() => {
    return authService.getCurrentUser();
  });
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);

  // Admin Dashboard Active Tab: 'products' | 'reports' | 'search'
  const [adminActiveTab, setAdminActiveTab] = useState('products');
  const [testModeStreamType, setTestModeStreamType] = useState('customer_inbound');

  // Strict role gate: Only Super Admin can view Settings & SMTP
  useEffect(() => {
    if (adminActiveTab === 'settings' && currentUser?.role !== 'super_admin') {
      setAdminActiveTab('products');
    }
  }, [adminActiveTab, currentUser]);

  // Saved Products State
  const [savedProductsList, setSavedProductsList] = useState([]);
  const [isSavedProductsLoading, setIsSavedProductsLoading] = useState(false);
  const [isProductEditOpen, setIsProductEditOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [staffList, setStaffList] = useState([]);

  // Credit Memos State
  const [creditMemosList, setCreditMemosList] = useState([]);
  const [isCreditMemoModalOpen, setIsCreditMemoModalOpen] = useState(false);
  const [selectedCreditMemoReport, setSelectedCreditMemoReport] = useState(null);
  const [editingCreditMemo, setEditingCreditMemo] = useState(null);
  const [creditMemoWarningTarget, setCreditMemoWarningTarget] = useState(null);
  const [voucherModalMemo, setVoucherModalMemo] = useState(null);
  const [voucherModalMemos, setVoucherModalMemos] = useState([]);
  const [isVoucherModalOpen, setIsVoucherModalOpen] = useState(false);
  const [qrModalReport, setQrModalReport] = useState(null);

  // Quick RMA Action Modal State (triggered by Box QR scan or ?rma= URL parameter)
  const [isQuickRmaModalOpen, setIsQuickRmaModalOpen] = useState(false);
  const [quickRmaNumber, setQuickRmaNumber] = useState(null);
  const [pendingQuickRmaNumber, setPendingQuickRmaNumber] = useState(null);
  const [isCustomerInvitesModalOpen, setIsCustomerInvitesModalOpen] = useState(false);
  const [viewingExplanationModal, setViewingExplanationModal] = useState(null);

  // 1-Click Google Identity Lock Gatekeeper Session
  const [intakeSlug, setIntakeSlug] = useState(() => getIntakeSlugFromUrl());
  const [gateSession, setGateSession] = useState(() => {
    // Never auto-unlock the public portal from stale localStorage sessions.
    // Visitors with ?token= must authenticate that token; visitors without ?token= must be logged in as super_admin.
    return null;
  });

  // Live ticking countdown state for public return session
  const [sessionCountdown, setSessionCountdown] = useState({ text: '', isExpired: false, totalSeconds: 0 });

  // Active Real-Time Watchdog for Gatekeeper Session Expiration (Unbypassable live enforcement)
  useEffect(() => {
    const expStr = gateSession?.expires_at || gateSession?.expiresAt;
    if (!expStr) {
      setSessionCountdown({ text: '', isExpired: false, totalSeconds: 0 });
      return;
    }

    const checkExpiration = () => {
      const expTime = new Date(expStr).getTime();
      const now = Date.now();
      const countdown = formatRemainingCountdown(expStr, gateSession?.status || 'active');
      setSessionCountdown(countdown);

      if (now >= expTime || countdown.isExpired) {
        // Session reached expiration!
        try {
          localStorage.removeItem('rma_portal_gate_session');
        } catch { }
        const slug = gateSession.slug;
        accessKeyService.clearSession(slug);
        setGateSession(null);
        showToast('Your authorized return session has expired. Portal locked.', 'warning');
      }
    };

    checkExpiration();
    const interval = setInterval(checkExpiration, 1000);
    return () => clearInterval(interval);
  }, [gateSession]);

  // Active background token verification: Detect revoked or deleted invite links in real-time
  useEffect(() => {
    if (!gateSession?.token) return;

    const verifyActiveToken = async () => {
      try {
        const res = await inviteService.validateInviteToken(gateSession.token);
        // Ignore transient network errors during background polling so active users are not falsely blocked
        if (res.error === 'NETWORK_ERROR' || (!res.valid && res.transient)) {
          return;
        }
        if (!res.valid) {
          try {
            localStorage.removeItem('rma_portal_gate_session');
          } catch { }
          const slug = gateSession.slug;
          accessKeyService.clearSession(slug);
          setGateSession(null);

          if (res.error === 'REVOKED') {
            showToast('Return authorization was revoked by Pingcon Operations. Portal locked.', 'error');
          } else if (res.error === 'EXPIRED') {
            showToast('Return authorization has expired. Portal locked.', 'warning');
          } else if (res.error === 'NOT_FOUND') {
            showToast('Return authorization link has been deleted or is invalid.', 'error');
          }
        }
      } catch (err) {
        console.warn('Background invite token verification notice:', err);
      }
    };

    // 1. Immediate validation on mount / session load
    verifyActiveToken();

    // 2. Poll every 4 seconds to catch dashboard revokes and deletes instantly
    const pollInterval = setInterval(verifyActiveToken, 4000);

    // 3. Re-verify on window focus and visibility change
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        verifyActiveToken();
      }
    };
    window.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', verifyActiveToken);

    // 4. Supabase Realtime channel on rma_invites table
    const inviteChannel = supabase.channel(`rma_inv_guard_${gateSession.token}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rma_invites' }, (payload) => {
        const token = gateSession.token;
        if (payload.eventType === 'DELETE') {
          if (payload.old?.token === token || payload.old?.id === gateSession.id) {
            try { localStorage.removeItem('rma_portal_gate_session'); } catch { }
            setGateSession(null);
            showToast('Return authorization has been deleted by Pingcon Operations.', 'error');
          }
        } else if (payload.eventType === 'UPDATE') {
          if (payload.new?.token === token || payload.new?.id === gateSession.id) {
            if (payload.new?.status === 'revoked') {
              try { localStorage.removeItem('rma_portal_gate_session'); } catch { }
              setGateSession(null);
              showToast('Return authorization was revoked by Pingcon Operations.', 'error');
            }
          }
        }
      })
      .subscribe();

    return () => {
      clearInterval(pollInterval);
      window.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', verifyActiveToken);
      supabase.removeChannel(inviteChannel);
    };
  }, [gateSession?.token, gateSession?.id, gateSession?.slug]);

  // Synchronize Google Identity authorized email and branch into intake form automatically
  useEffect(() => {
    if (gateSession?.authorized_email) {
      setReporterContact(gateSession.authorized_email);
    }
    const resolvedEntity = inviteService.normalizeEntityName(gateSession?.entity_name || gateSession?.store_branch);
    if (resolvedEntity) {
      setStoreBranch(resolvedEntity);
    }
  }, [gateSession]);

  const handleLockStation = () => {
    try {
      localStorage.removeItem('rma_portal_gate_session');
      localStorage.removeItem('rma_reporter_contact');
      localStorage.removeItem('rma_portal_verified_email');
    } catch { }
    supabase.auth.signOut({ scope: 'local' }).catch(() => { });
    const slug = gateSession?.slug || intakeSlug || 'dock';
    accessKeyService.clearSession(slug);
    setGateSession(null);
    showToast('Portal locked. Authorization required.', 'info');
  };

  const restoreQuickRmaIfPending = () => {
    if (pendingQuickRmaNumber) {
      setQuickRmaNumber(pendingQuickRmaNumber);
      setIsQuickRmaModalOpen(true);
      setPendingQuickRmaNumber(null);
    }
  };

  const parseRmaFromScan = (rawText) => {
    if (!rawText) return null;
    const str = String(rawText).trim();
    if (str.includes('rma=')) {
      try {
        const url = new URL(str.startsWith('http') ? str : `https://example.com/${str.replace(/^\/?/, '')}`);
        const val = url.searchParams.get('rma') || url.searchParams.get('rma_number');
        if (val) return val;
      } catch { }
    }
    if (str.startsWith('{') && str.endsWith('}')) {
      try {
        const parsed = JSON.parse(str);
        if (parsed.rma) return parsed.rma;
      } catch { }
    }
    if (/^RMA-\d{4}-\d+-[A-Z0-9]+/i.test(str) || /^RMA-/i.test(str)) {
      return str;
    }
    return null;
  };

  const handleCloseQuickRma = () => {
    setIsQuickRmaModalOpen(false);
    setQuickRmaNumber(null);
    setPendingQuickRmaNumber(null);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (url.searchParams.has('rma') || url.searchParams.has('rma_number')) {
        url.searchParams.delete('rma');
        url.searchParams.delete('rma_number');
        window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
      }
    }
  };

  // Listen to browser navigation & check ?rma= query parameter
  useEffect(() => {
    const checkRmaParam = () => {
      const params = new URLSearchParams(window.location.search);
      const rmaParam = params.get('rma') || params.get('rma_number');
      if (rmaParam) {
        setQuickRmaNumber(rmaParam);
        setIsQuickRmaModalOpen(true);
      }
    };

    const handleLocationChange = () => {
      const path = window.location.pathname.toLowerCase();
      const hash = window.location.hash.toLowerCase();
      const onAdmin = path === '/admin' || path.startsWith('/admin/') || hash === '#/admin' || window.location.search.includes('admin=true');
      setIsAdminView(onAdmin);

      if (onAdmin) {
        try {
          sessionStorage.removeItem('rma_active_invite_token');
          sessionStorage.removeItem('rma_pending_oauth_token');
          sessionStorage.removeItem('rma_oauth_in_progress');
          localStorage.removeItem('rma_pending_oauth_token');
          localStorage.removeItem('rma_oauth_in_progress');
        } catch {}
      }

      const newSlug = getIntakeSlugFromUrl();
      setIntakeSlug(newSlug);
      const urlParams = new URLSearchParams(window.location.search);
      let urlToken = urlParams.get('token');
      if (!urlToken && window.location.hash.includes('token=')) {
        const m = window.location.hash.match(/token=([^&]+)/);
        if (m && m[1]) urlToken = decodeURIComponent(m[1]);
      }
      if (!urlToken && typeof window !== 'undefined' && !onAdmin) {
        try {
          const isOAuthInProgress =
            localStorage.getItem('rma_oauth_in_progress') === 'true' ||
            sessionStorage.getItem('rma_oauth_in_progress') === 'true';
          if (isOAuthInProgress) {
            urlToken =
              localStorage.getItem('rma_pending_oauth_token') ||
              sessionStorage.getItem('rma_pending_oauth_token');
          }
        } catch {}
      }

      if (urlToken) {
        // Keep current unlocked gateSession if it is already unlocked for this exact token
        setGateSession(prev => (prev && prev.token === urlToken) ? prev : null);
      } else {
        setGateSession(accessKeyService.getActiveSession(newSlug));
      }

      // If entering /admin without an active session, open login gate
      if (onAdmin && !authService.getCurrentUser()) {
        setIsLoginModalOpen(true);
      }

      checkRmaParam();
    };

    checkRmaParam();

    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
    };
  }, []);

  // When visiting /admin initially, trigger login if not authenticated
  useEffect(() => {
    if (isAdminView && !currentUser) {
      setIsLoginModalOpen(true);
    }
  }, [isAdminView, currentUser]);

  // Handle Supabase Auth magic link redirect or session
  useEffect(() => {
    const checkSession = async () => {
      try {
        const hasAuthHash = window.location.hash.includes('access_token') ||
          window.location.hash.includes('type=recovery') ||
          window.location.search.includes('code=');

        const localUser = authService.getCurrentUser();
        const urlParams = new URLSearchParams(window.location.search);
        const isInviteOAuthReturn =
          (localStorage.getItem('rma_oauth_in_progress') === 'true' ||
            sessionStorage.getItem('rma_oauth_in_progress') === 'true') &&
          Boolean(
            localStorage.getItem('rma_pending_oauth_token') ||
              sessionStorage.getItem('rma_pending_oauth_token')
          );
        const hasInviteToken = urlParams.has('token') || isInviteOAuthReturn;

        // If visiting via an invite link or returning from invite Google OAuth, let GatekeeperPinModal handle verification and URL hash cleanup
        if (hasInviteToken) {
          setIsAdminView(false);
          setIsLoginModalOpen(false);
          return;
        }

        // If user is not logged in locally and not clicking a magic link in URL, ensure Supabase local session is cleared
        if (!localUser && !hasAuthHash) {
          await supabase.auth.signOut({ scope: 'local' }).catch(() => { });
          return;
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.email && (localUser || hasAuthHash)) {
          const email = session.user.email.toLowerCase().trim();
          const employees = await authService.getEmployees();
          const emp = employees.find(e => e.email.toLowerCase() === email) || {
            name: email.split('@')[0],
            email: email,
            role: email === 'finance2@keysysincorporated.com' ? 'super_admin' : 'inventory_staff',
            is_active: true
          };

          if (emp.is_active === false) {
            await authService.logout();
            setCurrentUser(null);
            return;
          }

          const sessionUser = {
            id: emp.id || 1,
            name: emp.name,
            email: emp.email,
            role: emp.role || (email === 'finance2@keysysincorporated.com' ? 'super_admin' : 'inventory_staff'),
            department: emp.department || 'General',
            loggedInAt: new Date().toISOString()
          };

          localStorage.setItem('rma_portal_admin_session', JSON.stringify(sessionUser));
          setCurrentUser(sessionUser);
          setIsLoginModalOpen(false);

          if (window.location.hash.includes('access_token')) {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
          }
        }
      } catch (err) {
        console.warn('Supabase session check notice:', err);
      }
    };
    checkSession();

    // Listen for cross-tab logout events
    const unsubscribeAuth = authService.onAuthChange((event) => {
      if (event?.type === 'LOGOUT') {
        setCurrentUser(null);
        setIsAdminView(false);
        setIsLoginModalOpen(false);
        setIsQuickRmaModalOpen(false);
        setQuickRmaNumber(null);
        if (typeof window !== 'undefined') {
          window.history.replaceState({}, '', '/');
        }
      }
    });

    return () => {
      unsubscribeAuth();
    };
  }, []);

  const navigateTo = (path) => {
    window.history.pushState({}, '', path);
    const onAdmin = path === '/admin' || path === '#/admin';
    setIsAdminView(onAdmin);
    setSelectedReportIds(new Set());
    const nextSlug = getIntakeSlugFromUrl();
    setIntakeSlug(nextSlug);
    setGateSession(accessKeyService.getActiveSession(nextSlug));
    if (onAdmin && !currentUser) {
      setIsLoginModalOpen(true);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLogout = async () => {
    try {
      await authService.logout();
    } catch (e) { }
    setCurrentUser(null);
    setIsAdminView(false);
    setIsLoginModalOpen(false);
    setIsQuickRmaModalOpen(false);
    setQuickRmaNumber(null);
    sessionStorage.removeItem('rma_login_pending_email');
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '/');
    }
    showToast('Logged out of admin dashboard.', 'success');
  };

  // Dark / Light Theme State (Persisted in localStorage)
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('rma_theme');
      if (saved) return saved === 'dark';
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (e) {
      return false;
    }
  });

  useEffect(() => {
    try {
      if (isDarkMode) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('rma_theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('rma_theme', 'light');
      }
    } catch (e) { }
  }, [isDarkMode]);

  const toggleTheme = () => setIsDarkMode(prev => !prev);

  // Test Mode State: Exclusively permitted for Super Admin. For all other roles it is ALWAYS false.
  const [isTestMode, setIsTestMode] = useState(() => {
    try {
      const fromAuth = authService.getCurrentUser();
      if (fromAuth?.role !== 'super_admin') return false;
      return localStorage.getItem('rma_portal_test_mode') === 'true';
    } catch (e) {
      return false;
    }
  });

  // Strict Role Enforcement: Only Super Admin can have Test Mode enabled.
  // For all other roles (inventory staff, warehouse, admin, viewer, public), Test Mode is ALWAYS FALSE.
  useEffect(() => {
    if (currentUser?.role !== 'super_admin') {
      if (isTestMode) {
        setIsTestMode(false);
      }
      try {
        localStorage.setItem('rma_portal_test_mode', 'false');
      } catch (e) { }
    }
  }, [currentUser, isTestMode]);

  useEffect(() => {
    const handleSyncTestMode = () => {
      try {
        if (currentUser?.role === 'super_admin') {
          setIsTestMode(localStorage.getItem('rma_portal_test_mode') === 'true');
        } else {
          setIsTestMode(false);
        }
      } catch (e) { }
    };
    const handleRmaDataEvent = (e) => {
      handleSyncTestMode();
      if (e?.detail?.type === 'item-split' || e?.detail?.type === 'triage-updated' || e?.detail?.type === 'buffer-closed') {
        refreshAllData();
      }
    };
    window.addEventListener('storage', handleSyncTestMode);
    window.addEventListener('rma-data-changed', handleRmaDataEvent);
    return () => {
      window.removeEventListener('storage', handleSyncTestMode);
      window.removeEventListener('rma-data-changed', handleRmaDataEvent);
    };
  }, [currentUser]);

  const toggleTestMode = () => {
    if (currentUser?.role !== 'super_admin') {
      showToast('Simulation / Test Mode is strictly restricted to Super Admin.', 'error');
      setIsTestMode(false);
      try {
        localStorage.setItem('rma_portal_test_mode', 'false');
      } catch (e) { }
      return;
    }

    setIsTestMode(prev => {
      const next = !prev;
      try {
        localStorage.setItem('rma_portal_test_mode', String(next));
        window.dispatchEvent(new Event('storage'));
        window.dispatchEvent(new CustomEvent('rma-data-changed', { detail: { type: 'test-mode-toggled', isTestMode: next } }));
      } catch (e) { }
      if (next) {
        showToast('🧪 Test Mode Enabled: Emails safely sent exclusively to finance2@keysysincorporated.com', 'success');
      } else {
        showToast('Live Mode Enabled: Real email delivery active.', 'success');
      }
      return next;
    });
  };

  // Facebook-Style Notifications System
  const [notifications, setNotifications] = useState(() => {
    try {
      const saved = localStorage.getItem('rma_portal_notifications_v2');
      if (saved) return JSON.parse(saved);
    } catch (e) { }
    return [
      {
        id: 'seed-notif-1',
        type: 'rma',
        title: 'Pingcon RMA Portal Active',
        message: 'Notification center ready. Intake events and return submissions will alert here.',
        subtext: 'System Notification',
        timestamp: new Date().toISOString(),
        read: false
      }
    ];
  });

  // Persist notifications to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('rma_portal_notifications_v2', JSON.stringify(notifications.slice(0, 60)));
    } catch (e) { }
  }, [notifications]);

  const addNotification = (notif) => {
    setNotifications(prev => [
      {
        id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        timestamp: new Date().toISOString(),
        read: false,
        ...notif
      },
      ...prev
    ]);
  };

  const handleMarkAsRead = (id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const handleMarkAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    showToast('All notifications marked as read.', 'success');
  };

  const handleClearAllNotifications = () => {
    setNotifications([]);
    showToast('All notifications cleared.', 'success');
  };

  const handleSelectNotification = (notif) => {
    if (notif.type === 'rma') {
      if (isAdminView) {
        setAdminActiveTab('customer_reports');
      } else {
        setIsReportsModalOpen(true);
      }
    } else if (notif.type === 'unknown') {
      if (isAdminView) {
        setAdminActiveTab('customer_reports');
        setReportsStatusFilter('pending_admin_details');
        setReportsCurrentPage(1);
      } else {
        navigateTo('/admin');
        setAdminActiveTab('customer_reports');
        setReportsStatusFilter('pending_admin_details');
        setReportsCurrentPage(1);
      }
    } else if (notif.type === 'product' || notif.type === 'delete') {
      if (isAdminView) {
        setAdminActiveTab('products');
      }
    }
  };

  // Role Permissions
  const canManageRoles = currentUser?.role === 'super_admin';
  const canEditProducts = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';
  const canDeleteProducts = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';
  const canDeleteReports = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';
  const canVerifyBarcodes = currentUser?.role !== 'viewer';

  // Dedicated Confirmation Modal State for Deletions
  const [deleteModalState, setDeleteModalState] = useState(null); // { type, item, id, rmaNumber, title, itemName, itemDetails, itemType }
  const [isDeleteModalLoading, setIsDeleteModalLoading] = useState(false);

  const requestDeleteProduct = (prod) => {
    if (!canDeleteProducts) {
      showToast('You do not have permission to delete catalog products.', 'error');
      return;
    }
    const name = prod?.name || `Barcode ${prod?.barcode || ''}`;
    setDeleteModalState({
      type: 'product',
      item: prod,
      title: 'Delete Product from Catalog?',
      itemName: name,
      itemType: 'product',
      itemDetails: `Barcode: ${prod?.barcode || 'N/A'}${prod?.code ? ` • SKU: ${prod.code}` : ''}`
    });
  };

  const requestDeleteReport = (id, rmaNumber, item) => {
    if (!canDeleteReports) {
      showToast('You do not have permission to delete RMA reports.', 'error');
      return;
    }
    const resolvedItem = item || recentReportsList.find(r => (id && r.id === id) || (rmaNumber && r.rma_number === rmaNumber));
    setDeleteModalState({
      type: 'report',
      id,
      rmaNumber,
      item: resolvedItem,
      title: 'Delete RMA Return Report?',
      itemName: `RMA #${rmaNumber}`,
      itemType: 'report',
      itemDetails: `ID: ${id || 'N/A'} • Return Ticket`
    });
  };

  const requestBulkDeleteProducts = (productsList) => {
    if (!canDeleteProducts) {
      showToast('You do not have permission to delete catalog products.', 'error');
      return;
    }
    if (!productsList || productsList.length === 0) return;

    setDeleteModalState({
      type: 'bulk_products',
      items: productsList,
      title: `Delete ${productsList.length} Selected Products?`,
      itemName: `${productsList.length} Products will be permanently removed from catalog`,
      itemType: 'products',
      itemDetails: productsList.slice(0, 3).map(p => p.name || p.barcode).join(', ') + (productsList.length > 3 ? '...' : '')
    });
  };

  const requestBulkDeleteReports = (reportsList) => {
    if (!canDeleteReports) {
      showToast('You do not have permission to delete RMA reports.', 'error');
      return;
    }
    if (!reportsList || reportsList.length === 0) return;

    setDeleteModalState({
      type: 'bulk_reports',
      items: reportsList,
      title: `Delete ${reportsList.length} Selected Return Reports?`,
      itemName: `${reportsList.length} Return reports will be permanently removed`,
      itemType: 'reports',
      itemDetails: reportsList.slice(0, 3).map(r => r.rma_number || `#${r.id}`).join(', ') + (reportsList.length > 3 ? '...' : '')
    });
  };

  // Credit Memo Handlers
  const handleOpenCreditMemoForReport = (report) => {
    if (!report) return;
    if (!hasAssignedSku(report, savedProductsList)) {
      setCreditMemoWarningTarget({
        item: report,
        title: "Financial Validation & Safety Guard",
        message: "Cannot issue Finance Credit Memo for ₱0.00 or unassigned SKU. Please click 'Assign SKU' first to register the official item code and verified price into the catalog."
      });
      return;
    }
    setSelectedCreditMemoReport(report);
    setEditingCreditMemo(null);
    setIsCreditMemoModalOpen(true);
  };

  // Physical Triage & Inspection Handler
  const handleInspectTriageForReport = (report) => {
    if (!report) return;
    setQuickRmaNumber(report.rma_number);
    setIsQuickRmaModalOpen(true);
  };

  const handleOpenCreateCreditMemo = () => {
    setSelectedCreditMemoReport(null);
    setEditingCreditMemo(null);
    setIsCreditMemoModalOpen(true);
  };

  const handleEditCreditMemo = (memo) => {
    setSelectedCreditMemoReport(null);
    setEditingCreditMemo(memo);
    setIsCreditMemoModalOpen(true);
  };

  // Edit item from Return Reports to save into Products catalog
  const handleEditProductFromReport = (reportOrChild) => {
    if (!reportOrChild) return;
    const isChild = Boolean(reportOrChild.is_manifest_child);
    const barcodeStr = String(reportOrChild.barcode || '').trim();
    const explicitName = String(reportOrChild.name || reportOrChild.item_name || reportOrChild.productName || '').trim();

    // Look up existing catalog entry strictly by this exact barcode
    const existing = barcodeStr ? savedProductsList.find(p => p.barcode && String(p.barcode).trim() === barcodeStr) : null;

    // Barcode and SKU are strictly different.
    // Filter out barcode values or unassigned placeholders from SKU
    const existingCode = (existing?.code && String(existing.code).trim() !== barcodeStr) ? existing.code : '';
    const reportCode = (reportOrChild.code && String(reportOrChild.code).trim() !== barcodeStr)
      ? reportOrChild.code
      : (reportOrChild.sku && String(reportOrChild.sku).trim() !== barcodeStr)
        ? reportOrChild.sku
        : existingCode;

    const cleanReportCode = (reportCode && !reportCode.toLowerCase().includes('awaiting') && !reportCode.toLowerCase().includes('unidentified'))
      ? reportCode
      : '';

    // If a child item is passed, strictly prioritize THAT child item's name and barcode.
    // Never fall back to another sibling or "Batch Return Manifest" title!
    const isBatchManifestTitle = explicitName.toLowerCase().startsWith('batch return manifest');
    const cleanItemName = (!isBatchManifestTitle && !explicitName.toLowerCase().includes('unidentified'))
      ? explicitName
      : (existing?.name && !existing.name.toLowerCase().startsWith('batch return manifest') ? existing.name : '');

    setEditingProduct({
      ...(existing && existing.is_verified ? existing : {}),
      id: existing?.id || undefined,
      child_id: reportOrChild.child_id || reportOrChild.id,
      name: cleanItemName,
      barcode: barcodeStr || existing?.barcode || '',
      code: cleanReportCode || existingCode,
      supplier_name: reportOrChild.supplier_name || existing?.supplier_name || 'Savemore',
      price: reportOrChild.price !== undefined ? reportOrChild.price : (existing?.price || 0),
      price_with_vat: reportOrChild.price_with_vat !== undefined ? reportOrChild.price_with_vat : (existing?.price_with_vat || reportOrChild.price || 0),
      unit_name: reportOrChild.unit_name || existing?.unit_name || 'pc',
      pieces_per_case: reportOrChild.pieces_per_case || existing?.pieces_per_case || existing?.piecesPerCase || null,
      image_url: existing?.is_verified ? (existing.image_url || '') : '',
      ae_name: reportOrChild.ae_name || existing?.ae_name || '',
      ae_email: reportOrChild.ae_email || existing?.ae_email || '',
      company: 'Wholesale Distribution',
      is_verified: Boolean(existing?.is_verified),
      is_manifest_child: isChild,
      parent_rma_id: reportOrChild.parent_rma_id,
      rma_number: reportOrChild.rma_number
    });
    setIsProductEditOpen(true);
  };

  const handleViewCreditMemoVoucher = (memoOrMemos) => {
    if (Array.isArray(memoOrMemos)) {
      setVoucherModalMemos(memoOrMemos);
      setVoucherModalMemo(memoOrMemos[0] || null);
    } else {
      setVoucherModalMemo(memoOrMemos);
      setVoucherModalMemos(memoOrMemos ? [memoOrMemos] : []);
    }
    setIsVoucherModalOpen(true);
  };

  const requestDeleteCreditMemo = (memo) => {
    if (!canDeleteReports) {
      showToast('You do not have permission to void credit memos.', 'error');
      return;
    }
    setDeleteModalState({
      type: 'credit_memo',
      item: memo,
      title: 'Void & Delete Credit Memo?',
      itemName: `${memo.credit_memo_number} (₱${Number(memo.credit_amount || 0).toLocaleString()})`,
      itemType: 'credit memo',
      itemDetails: `RMA: ${memo.rma_number || 'N/A'} • Product: ${memo.product_name || 'N/A'}`
    });
  };

  const requestBulkDeleteCreditMemos = (memos) => {
    if (!canDeleteReports) {
      showToast('You do not have permission to void credit memos.', 'error');
      return;
    }
    if (!memos || memos.length === 0) return;

    setDeleteModalState({
      type: 'bulk_credit_memos',
      items: memos,
      title: `Void & Delete ${memos.length} Selected Credit Memos?`,
      itemName: `${memos.length} Credit Memos will be permanently voided from database`,
      itemType: 'credit memos',
      itemDetails: memos.slice(0, 3).map(m => m.credit_memo_number).join(', ') + (memos.length > 3 ? '...' : '')
    });
  };

  const handleConfirmDelete = async () => {
    if (!deleteModalState) return;
    setIsDeleteModalLoading(true);
    try {
      if (deleteModalState.type === 'product') {
        const prod = deleteModalState.item;
        const id = prod?.id;
        const barcode = prod?.barcode;
        await catalogService.deleteProduct(prod);
        setSavedProductsList(prev => prev.filter(p => {
          if (id && p.id === id) return false;
          if (barcode && p.barcode === barcode) return false;
          return true;
        }));
        showToast(`Deleted "${deleteModalState.itemName}" from database.`, 'success');
        refreshAllData();
      } else if (deleteModalState.type === 'report') {
        const { id, rmaNumber, item } = deleteModalState;
        await catalogService.deleteReport(id, rmaNumber, item);
        setSelectedReportIds(prev => {
          const next = new Set(prev);
          if (id) next.delete(id);
          if (rmaNumber) next.delete(rmaNumber);
          return next;
        });
        setRecentReportsList(prev => prev.filter(r => (id ? r.id !== id : r.rma_number !== rmaNumber)));
        showToast(`Deleted return report RMA #${rmaNumber}.`, 'success');
        refreshAllData();
      } else if (deleteModalState.type === 'bulk_products') {
        const items = deleteModalState.items || [];
        await catalogService.deleteMultipleProducts(items);
        const deletedIds = new Set(items.map(p => p.id));
        const deletedBarcodes = new Set(items.map(p => p.barcode));
        setSavedProductsList(prev => prev.filter(p => !deletedIds.has(p.id) && !deletedBarcodes.has(p.barcode)));
        showToast(`Successfully deleted ${items.length} products from catalog.`, 'success');
        refreshAllData();
      } else if (deleteModalState.type === 'bulk_reports') {
        const items = deleteModalState.items || [];
        await catalogService.deleteMultipleReports(items);
        setSelectedReportIds(new Set());
        const deletedIds = new Set(items.map(r => r.id));
        const deletedRmas = new Set(items.map(r => r.rma_number));
        setRecentReportsList(prev => prev.filter(r => !deletedIds.has(r.id) && !deletedRmas.has(r.rma_number)));
        showToast(`Successfully deleted ${items.length} return reports.`, 'success');
        refreshAllData();
      } else if (deleteModalState.type === 'credit_memo') {
        const memo = deleteModalState.item;
        await creditMemoService.deleteCreditMemo(memo.credit_memo_number, memo.report_id);
        setCreditMemosList(prev => prev.filter(m => m.credit_memo_number !== memo.credit_memo_number));
        showToast(`Credit Memo ${memo.credit_memo_number} voided and removed.`, 'success');
        refreshAllData();
      } else if (deleteModalState.type === 'bulk_credit_memos') {
        const items = deleteModalState.items || [];
        const memoNumbers = items.map(m => m.credit_memo_number);
        await creditMemoService.deleteMultipleCreditMemos(memoNumbers);
        const numSet = new Set(memoNumbers);
        setCreditMemosList(prev => prev.filter(m => !numSet.has(m.credit_memo_number)));
        showToast(`Successfully voided and deleted ${items.length} credit memos from database.`, 'success');
        refreshAllData();
      }
      setDeleteModalState(null);
    } catch (e) {
      showToast(e.message || 'Failed to delete item from database', 'error');
      refreshAllData();
    } finally {
      setIsDeleteModalLoading(false);
    }
  };

  const handleResetDemoData = async () => {
    if (window.confirm('Reset all demo data and reload sample catalog?')) {
      try {
        localStorage.removeItem('rma_portal_notifications_v2');
        localStorage.removeItem('rma_portal_custom_products');
        await refreshAllData();
        showToast('Sample catalog refreshed.', 'success');
      } catch (e) {
        showToast('Failed to reset demo data.', 'error');
      }
    }
  };

  // Database Connection Health State
  const [supaStatus, setSupaStatus] = useState({ checking: true, connected: false, rowsFound: 0 });

  // Accurate GPS Coordinates State (Only saved if accuracy <= 150m)
  const [gpsLocation, setGpsLocation] = useState({ loading: true, latitude: null, longitude: null, accuracy: null, isAccurate: false });

  // Reporter Intake Form State
  const [manifestItems, setManifestItems] = useState([]); // Queued return line items for Multi-Item Batch Return
  const [barcodeInput, setBarcodeInput] = useState('');
  const [customItemName, setCustomItemName] = useState('');
  const [detectedProduct, setDetectedProduct] = useState(null);
  const [isCheckingBarcode, setIsCheckingBarcode] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [unitName, setUnitName] = useState('pc');
  const [selectedReason, setSelectedReason] = useState(DEFECT_REASONS[0]);
  const [explanation, setExplanation] = useState('');
  const [reporterName, setReporterName] = useState(() => {
    try { return localStorage.getItem('rma_reporter_name') || ''; } catch { return ''; }
  });
  const [reporterContact, setReporterContact] = useState(() => {
    try { return localStorage.getItem('rma_reporter_contact') || ''; } catch { return ''; }
  });
  const [customStoreBranch, setCustomStoreBranch] = useState('');
  const [photoFiles, setPhotoFiles] = useState([]); // Array of { file, previewUrl }
  const [photoCaptureMode, setPhotoCaptureMode] = useState('single'); // 'single' (Camera snap) | 'batch' (Multi-file select)
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccessReport, setSubmitSuccessReport] = useState(null);

  // Official Logistics Paperwork (DR / Invoice / PO) & Gemini Flash AI OCR (Multi-photo up to 3)
  const [paperworkPhotos, setPaperworkPhotos] = useState([]); // Array of { file, previewUrl, metadata } (max 3)
  const [paperworkCaptureMode, setPaperworkCaptureMode] = useState('single'); // 'single' (Camera snap) | 'batch' (Multi-file select)
  const [paperworkMetadata, setPaperworkMetadata] = useState(null);
  const [isInspectingPaperwork, setIsInspectingPaperwork] = useState(false);
  const [paperworkInspectionProgress, setPaperworkInspectionProgress] = useState(null); // { current: 1, total: 3 }
  const paperworkAbortControllerRef = useRef(null);
  const [paperworkShake, setPaperworkShake] = useState(false);
  const [paperworkError, setPaperworkError] = useState(null);
  const [siNumber, setSiNumber] = useState('');
  const [drNumber, setDrNumber] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [invoiceDrNumber, setInvoiceDrNumber] = useState('');
  const [storeBranch, setStoreBranch] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [batchLotNumber, setBatchLotNumber] = useState('');
  const [isEditingPaperworkDetails, setIsEditingPaperworkDetails] = useState(false);

  // Modals & Queues
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isPendingModalOpen, setIsPendingModalOpen] = useState(false);
  const [isReportsModalOpen, setIsReportsModalOpen] = useState(false);
  const [pendingBarcodesList, setPendingBarcodesList] = useState([]);
  const [recentReportsList, setRecentReportsList] = useState([]);
  const [toastMessage, setToastMessage] = useState(null);
  const [reportsViewMode, setReportsViewMode] = useState(() => {
    return localStorage.getItem('rma_admin_reports_view_mode') || 'table';
  });

  // Return Reports Filtering, Sorting & Pagination State
  const [reportsSearchQuery, setReportsSearchQuery] = useState('');
  const [reportsReasonFilter, setReportsReasonFilter] = useState('all');
  const [reportsStatusFilter, setReportsStatusFilter] = useState('all');
  const [reportsDispositionFilter, setReportsDispositionFilter] = useState('all');
  const [reportsConditionGradeFilter, setReportsConditionGradeFilter] = useState('all');
  const [reportsDateFrom, setReportsDateFrom] = useState('');
  const [reportsDateTo, setReportsDateTo] = useState('');
  const [thermalPrintReport, setThermalPrintReport] = useState(null);
  const [reportsSortField, setReportsSortField] = useState('id');
  const [reportsSortDirection, setReportsSortDirection] = useState('desc');
  const [reportsCurrentPage, setReportsCurrentPage] = useState(1);
  const [reportsPageSize, setReportsPageSize] = useState(10);
  const [selectedReportIds, setSelectedReportIds] = useState(new Set());
  const [expandedManifestIds, setExpandedManifestIds] = useState(new Set());
  const toggleManifestExpand = (id) => {
    setExpandedManifestIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Automatically prune orphan report selection IDs whenever recentReportsList updates
  useEffect(() => {
    if (reporterName) {
      try { localStorage.setItem('rma_reporter_name', reporterName); } catch { }
    }
  }, [reporterName]);

  useEffect(() => {
    if (reporterContact) {
      try { localStorage.setItem('rma_reporter_contact', reporterContact); } catch { }
    }
  }, [reporterContact]);

  useEffect(() => {
    setSelectedReportIds(prev => {
      if (prev.size === 0) return prev;
      const valid = new Set(recentReportsList.flatMap(r => [r.id, r.rma_number].filter(Boolean)));
      const next = new Set([...prev].filter(id => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [recentReportsList]);

  // Clear selections whenever the active tab changes (e.g. Products <-> Reports <-> Credit Memos)
  useEffect(() => {
    setSelectedReportIds(new Set());
  }, [adminActiveTab]);

  // Fullscreen Image Lightbox Modal State
  const [lightboxPhoto, setLightboxPhoto] = useState(null);

  const handleSetReportsViewMode = (mode) => {
    setReportsViewMode(mode);
    try {
      localStorage.setItem('rma_admin_reports_view_mode', mode);
    } catch (e) { }
  };

  const handleReportsSort = (field) => {
    setReportsCurrentPage(1);
    if (reportsSortField === field) {
      setReportsSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setReportsSortField(field);
      setReportsSortDirection('asc');
    }
  };

  const [coworkerQueueFilter, setCoworkerQueueFilter] = useState('all'); // 'all' | 'restock' | 'scrap'
  const [updatingQueueId, setUpdatingQueueId] = useState(null);

  const resetReportsFilters = () => {
    setReportsSearchQuery('');
    setReportsReasonFilter('all');
    setReportsStatusFilter('all');
    setReportsDispositionFilter('all');
    setReportsConditionGradeFilter('all');
    setCoworkerQueueFilter('all');
    setReportsDateFrom('');
    setReportsDateTo('');
    setReportsCurrentPage(1);
    setSelectedReportIds(new Set());
  };

  // Helpers to check whether an item (or batch manifest) is in the pending Ready to Restock or Supplier Re-Order queue
  const isItemReadyToRestock = React.useCallback((item, allReports = recentReportsList) => {
    if (!item) return false;
    const isManifestRow = !item.is_unpacked_manifest_item && isBatchManifest(item, allReports);
    if (isManifestRow) {
      const children = getReportManifestItems(item, allReports);
      return children.some(c => {
        const d = String(c?.disposition || '').toLowerCase();
        const st = String(c?.status || '').toLowerCase();
        return d.includes('restock') && !['restocked', 'closed', 'resolved', 'scrapped', 'disposed'].includes(st);
      });
    }
    const disp = String(item.disposition || '').toLowerCase();
    const st = String(item.status || '').toLowerCase();
    return disp.includes('restock') && !['restocked', 'closed', 'resolved', 'scrapped', 'disposed'].includes(st);
  }, [recentReportsList]);

  const isItemReadyForSupplierReorder = React.useCallback((item, allReports = recentReportsList) => {
    if (!item) return false;
    const isManifestRow = !item.is_unpacked_manifest_item && isBatchManifest(item, allReports);
    if (isManifestRow) {
      const children = getReportManifestItems(item, allReports);
      return children.some(c => {
        const d = String(c?.disposition || '').toLowerCase();
        const st = String(c?.status || '').toLowerCase();
        return (d.includes('scrap') || d.includes('dispose') || d.includes('reorder')) && !['scrapped', 'disposed', 'closed', 'resolved', 'restocked'].includes(st);
      });
    }
    const disp = String(item.disposition || '').toLowerCase();
    const st = String(item.status || '').toLowerCase();
    return (disp.includes('scrap') || disp.includes('dispose') || disp.includes('reorder')) && !['scrapped', 'disposed', 'closed', 'resolved', 'restocked'].includes(st);
  }, [recentReportsList]);

  const isItemVendorRtv = React.useCallback((item, allReports = recentReportsList) => {
    if (!item) return false;
    const isManifestRow = !item.is_unpacked_manifest_item && isBatchManifest(item, allReports);
    if (isManifestRow) {
      const children = getReportManifestItems(item, allReports);
      return children.some(c => {
        const d = String(c?.disposition || '').toLowerCase();
        const st = String(c?.status || '').toLowerCase();
        return (c?.rma_type === 'supplier_outbound' || d.includes('rtv') || d.includes('vendor')) && !['closed', 'resolved', 'rejected', 'deleted', 'restocked', 'scrapped', 'disposed'].includes(st);
      });
    }
    const disp = String(item.disposition || '').toLowerCase();
    const st = String(item.status || '').toLowerCase();
    return (item.rma_type === 'supplier_outbound' || disp.includes('rtv') || disp.includes('vendor')) && !['closed', 'resolved', 'rejected', 'deleted', 'restocked', 'scrapped', 'disposed'].includes(st);
  }, [recentReportsList]);

  const isItemOnHold = React.useCallback((item, allReports = recentReportsList) => {
    if (!item) return false;
    const isManifestRow = !item.is_unpacked_manifest_item && isBatchManifest(item, allReports);
    if (isManifestRow) {
      const children = getReportManifestItems(item, allReports);
      return children.some(c => {
        const d = String(c?.disposition || '').toLowerCase();
        const st = String(c?.status || '').toLowerCase();
        return (d.includes('quarantine') || d.includes('hold') || st === 'quarantine' || st === 'hold') && !['closed', 'resolved', 'rejected', 'deleted'].includes(st);
      });
    }
    const disp = String(item.disposition || '').toLowerCase();
    const st = String(item.status || '').toLowerCase();
    return (disp.includes('quarantine') || disp.includes('hold') || st === 'quarantine' || st === 'hold') && !['closed', 'resolved', 'rejected', 'deleted'].includes(st);
  }, [recentReportsList]);

  // 1-Click Coworker Action Handler: Mark as Stocked in WMS ('restocked') or Mark Re-ordered from Supplier ('scrapped')
  const handleConfirmCoworkerAction = async (item, targetStatus) => {
    if (!item || updatingQueueId) return;
    const rowKey = item.id || item.rma_number;
    setUpdatingQueueId(rowKey);
    const cleanStatus = targetStatus === 'scrapped' ? 'scrapped' : 'restocked';
    const actorName = currentUser?.name || (cleanStatus === 'restocked' ? 'Warehouse WMS Staff' : 'Purchasing Staff');

    // Optimistic state update so the row status updates to 6- Restocked / 7- Scrapped immediately and vanishes from pending queue filter
    setRecentReportsList(prev => prev.map(r => {
      const matchesRow = (r.id && item.id && String(r.id) === String(item.id)) ||
        (r.id && item.parent_rma_id && String(r.id) === String(item.parent_rma_id)) ||
        (r.rma_number && r.rma_number === item.rma_number);
      if (!matchesRow) return r;

      let updatedItems = r.items;
      if (Array.isArray(r.items) && r.items.length > 0) {
        const targetBc = item.is_unpacked_manifest_item && item.barcode ? String(item.barcode).trim() : null;
        updatedItems = r.items.map(c => {
          const cBc = String(c.barcode || '').trim();
          const cDisp = String(c.disposition || '').toLowerCase();
          if ((targetBc && cBc === targetBc) || (!targetBc && ((cleanStatus === 'restocked' && cDisp.includes('restock')) || (cleanStatus === 'scrapped' && (cDisp.includes('scrap') || cDisp.includes('dispose')))))) {
            return { ...c, status: cleanStatus };
          }
          return c;
        });
      }
      return {
        ...r,
        status: cleanStatus,
        items: updatedItems
      };
    }));

    try {
      await catalogService.confirmCoworkerQueueAction({
        item,
        targetStatus: cleanStatus,
        warehouseLocation: item.warehouse_location || null,
        actorName
      });
      showToast(
        cleanStatus === 'restocked'
          ? `✓ Marked ${item.rma_number} as 6- Restocked in WMS!`
          : `✓ Marked ${item.rma_number} as 7- Scrapped / Disposed (Supplier Re-Order Confirmed)!`,
        'success'
      );
      refreshAllData();
    } catch (err) {
      console.error('Failed to confirm coworker queue action:', err);
      showToast(`Could not update status: ${err.message}`, 'error');
      refreshAllData();
    } finally {
      setUpdatingQueueId(null);
    }
  };

  // Operational Segregation: Inbound Customer Returns vs Outbound Supplier Claims
  const customerInboundReports = React.useMemo(() => {
    return recentReportsList.filter(r => (r.rma_type === 'customer_inbound' || !r.rma_type) && !isManifestSubItem(r, recentReportsList));
  }, [recentReportsList]);

  const readyToRestockReports = React.useMemo(() => {
    return recentReportsList.filter(r => !isManifestSubItem(r, recentReportsList) && isItemReadyToRestock(r, recentReportsList));
  }, [recentReportsList, isItemReadyToRestock]);

  const supplierReorderReports = React.useMemo(() => {
    return recentReportsList.filter(r => !isManifestSubItem(r, recentReportsList) && isItemReadyForSupplierReorder(r, recentReportsList));
  }, [recentReportsList, isItemReadyForSupplierReorder]);

  const vendorRtvReports = React.useMemo(() => {
    return recentReportsList.filter(r => !isManifestSubItem(r, recentReportsList) && isItemVendorRtv(r, recentReportsList));
  }, [recentReportsList, isItemVendorRtv]);

  const onHoldReports = React.useMemo(() => {
    return recentReportsList.filter(r => !isManifestSubItem(r, recentReportsList) && isItemOnHold(r, recentReportsList));
  }, [recentReportsList, isItemOnHold]);

  const supplierOutboundReports = React.useMemo(() => {
    const unpacked = [];
    recentReportsList.forEach(r => {
      if (isManifestSubItem(r, recentReportsList)) return;
      const isExplicitSupplierOutbound = r.rma_type === 'supplier_outbound';
      const disp = String(r.disposition || '').toLowerCase();
      const isManifest = isBatchManifest(r, recentReportsList);
      const manifestChildren = isManifest ? getReportManifestItems(r, recentReportsList) : [];
      const hasRtvChild = manifestChildren.some(c => {
        const cDisp = String(c.disposition || '').toLowerCase();
        return c.rma_type === 'supplier_outbound' || cDisp.includes('rtv') || cDisp.includes('vendor');
      });

      if (!isExplicitSupplierOutbound && !hasRtvChild) {
        if (disp.includes('restock') || disp.includes('scrap') || disp.includes('quarantine') || disp.includes('buffer') || disp.includes('pending triage')) {
          return;
        }
        const isRtvDisposition = disp.includes('return to vendor') || disp.includes('rtv') || disp.includes('vendor');
        if (!isRtvDisposition) return;
      }

      if (isManifest && manifestChildren.length > 0) {
        manifestChildren.forEach((child, cIdx) => {
          const cDisp = String(child.disposition || '').toLowerCase();
          if (cDisp.includes('restock') || cDisp.includes('scrap') || cDisp.includes('quarantine') || cDisp.includes('buffer')) return;
          const isParentRtvOrSupplier = isExplicitSupplierOutbound || disp.includes('return to vendor') || disp.includes('rtv') || disp.includes('vendor');
          const isChildRtvOrSupplier = child.rma_type === 'supplier_outbound' || cDisp.includes('rtv') || cDisp.includes('vendor');
          if (!isParentRtvOrSupplier && !isChildRtvOrSupplier) return;
          unpacked.push({ ...r, ...child, id: child.id || `${r.id}_${cIdx}` });
        });
        return;
      }
      unpacked.push(r);
    });
    return unpacked;
  }, [recentReportsList]);

  // Filter and sort return reports - strictly isolated to Customer Inbound Returns
  const processedReports = React.useMemo(() => {
    const q = reportsSearchQuery.toLowerCase().trim();
    let list = recentReportsList.filter(item => {
      // Isolate to Customer Inbound Returns by default, unless a Coworker Inventory Queue ('restock' or 'scrap') is active
      if (coworkerQueueFilter === 'all' && item.rma_type && item.rma_type !== 'customer_inbound') {
        return false;
      }
      // Omit child rows of manifest returns (which share identical rma_number with parent)
      // BUT keep Split tickets (which have their own unique rma_number like -B, -C)
      if (isManifestSubItem(item, recentReportsList)) {
        return false;
      }

      if (q) {
        const matchesChild = Array.isArray(item.items) && item.items.some(child => (
          (child.barcode || '').toLowerCase().includes(q) ||
          (child.name || '').toLowerCase().includes(q) ||
          (child.sku || child.code || '').toLowerCase().includes(q)
        ));

        const matches = (
          matchesChild ||
          String(item.id || '').includes(q) ||
          (item.rma_number || '').toLowerCase().includes(q) ||
          (item.barcode || '').toLowerCase().includes(q) ||
          (item.name || '').toLowerCase().includes(q) ||
          (item.reporter_name || item.reported_by || '').toLowerCase().includes(q) ||
          (item.reporter_contact || '').toLowerCase().includes(q) ||
          (item.reason || '').toLowerCase().includes(q) ||
          (item.warehouse_location || '').toLowerCase().includes(q) ||
          (item.store_branch || '').toLowerCase().includes(q) ||
          (item.invoice_dr_number || '').toLowerCase().includes(q) ||
          (item.si_number || '').toLowerCase().includes(q) ||
          (item.dr_number || '').toLowerCase().includes(q) ||
          (item.po_number || '').toLowerCase().includes(q) ||
          (item.batch_lot_number || '').toLowerCase().includes(q)
        );
        if (!matches) return false;
      }

      if (reportsReasonFilter !== 'all') {
        const itemReasonNorm = (item.reason || '').replace(/^\d+-\s*/, '').toLowerCase().trim();
        const filterReasonNorm = reportsReasonFilter.replace(/^\d+-\s*/, '').toLowerCase().trim();
        if (itemReasonNorm !== filterReasonNorm) return false;
      }

      if (reportsStatusFilter !== 'all') {
        const s = String(item.status || 'received_at_dock').toLowerCase();
        if (reportsStatusFilter === 'pending_admin_details') {
          const isManifestRow = isBatchManifest(item, recentReportsList);
          if (isManifestRow) {
            const children = getReportManifestItems(item, recentReportsList);
            const hasUnmappedChild = children.some(child => !hasAssignedSku(child, savedProductsList));
            if (!hasUnmappedChild) return false;
          } else {
            const isUnmappedStandalone = !hasAssignedSku(item, savedProductsList) || s === 'pending_admin_details';
            if (!isUnmappedStandalone) return false;
          }
        } else if (reportsStatusFilter === 'received_at_dock') {
          if (s !== 'pending' && s !== 'received_at_dock') return false;
        } else if (reportsStatusFilter === 'draft') {
          if (s !== 'draft') return false;
        } else if (reportsStatusFilter === 'restocked') {
          if (s !== 'restocked' && s !== 'closed' && s !== 'resolved') return false;
        } else if (reportsStatusFilter === 'scrapped') {
          if (s !== 'scrapped' && s !== 'disposed') return false;
        } else if (s !== reportsStatusFilter.toLowerCase()) {
          return false;
        }
      }

      // Disposition filter (supports numbered prefix e.g. "1- Pending Triage")
      if (reportsDispositionFilter !== 'all') {
        const itemDispNorm = (item.disposition || 'Pending Triage').replace(/^\d+-\s*/, '').toLowerCase().trim();
        const filterDispNorm = reportsDispositionFilter.replace(/^\d+-\s*/, '').toLowerCase().trim();
        if (itemDispNorm !== filterDispNorm) return false;
      }

      // Condition Grade filter
      if (reportsConditionGradeFilter !== 'all') {
        const itemGrade = item.condition_grade || 'Unassessed';
        if (!itemGrade.toLowerCase().startsWith(reportsConditionGradeFilter.toLowerCase().charAt(0))) return false;
      }

      // Date Range filters
      // 4-Pillar Dedicated Queue Filters ('restock' | 'rtv' | 'reorder' | 'hold')
      if (coworkerQueueFilter === 'restock') {
        if (!isItemReadyToRestock(item, recentReportsList)) return false;
      } else if (coworkerQueueFilter === 'reorder' || coworkerQueueFilter === 'scrap') {
        if (!isItemReadyForSupplierReorder(item, recentReportsList)) return false;
      } else if (coworkerQueueFilter === 'rtv') {
        if (!isItemVendorRtv(item, recentReportsList)) return false;
      } else if (coworkerQueueFilter === 'hold') {
        if (!isItemOnHold(item, recentReportsList)) return false;
      }

      if (reportsDateFrom) {
        const itemDate = new Date(item.created_at || 0).toISOString().slice(0, 10);
        if (itemDate < reportsDateFrom) return false;
      }

      if (reportsDateTo) {
        const itemDate = new Date(item.created_at || 0).toISOString().slice(0, 10);
        if (itemDate > reportsDateTo) return false;
      }

      return true;
    });

    list.sort((a, b) => {
      let valA, valB;
      switch (reportsSortField) {
        case 'id':
          valA = Number(a.id) || 0;
          valB = Number(b.id) || 0;
          break;
        case 'rma_number':
          valA = String(a.rma_number || '').toLowerCase();
          valB = String(b.rma_number || '').toLowerCase();
          break;
        case 'barcode':
          valA = String(a.barcode || '').toLowerCase();
          valB = String(b.barcode || '').toLowerCase();
          break;
        case 'name':
          valA = String(a.name || '').toLowerCase();
          valB = String(b.name || '').toLowerCase();
          break;
        case 'quantity':
          valA = Number(a.quantity) || 1;
          valB = Number(b.quantity) || 1;
          break;
        case 'reason':
          valA = String(a.reason || '').toLowerCase();
          valB = String(b.reason || '').toLowerCase();
          break;
        case 'reporter':
          valA = String(a.reporter_name || a.reported_by || '').toLowerCase();
          valB = String(b.reporter_name || b.reported_by || '').toLowerCase();
          break;
        case 'store_branch':
          valA = String(a.store_branch || '').toLowerCase();
          valB = String(b.store_branch || '').toLowerCase();
          break;
        case 'invoice_dr_number':
          valA = String(a.invoice_dr_number || a.dr_number || a.si_number || a.po_number || '').toLowerCase();
          valB = String(b.invoice_dr_number || b.dr_number || b.si_number || b.po_number || '').toLowerCase();
          break;
        case 'status':
        case 'lifecycle_stage':
          valA = String(a.status || 'received_at_dock').toLowerCase();
          valB = String(b.status || 'received_at_dock').toLowerCase();
          break;
        case 'disposition':
          valA = String(a.disposition || 'Pending Triage').toLowerCase();
          valB = String(b.disposition || 'Pending Triage').toLowerCase();
          break;
        case 'warehouse_location':
          valA = String(a.warehouse_location || '').toLowerCase();
          valB = String(b.warehouse_location || '').toLowerCase();
          break;
        case 'created_at':
          valA = new Date(a.created_at || 0).getTime();
          valB = new Date(b.created_at || 0).getTime();
          break;
        default:
          valA = a.id;
          valB = b.id;
      }

      if (valA < valB) return reportsSortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return reportsSortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [
    recentReportsList,
    reportsSearchQuery,
    reportsReasonFilter,
    reportsStatusFilter,
    reportsDispositionFilter,
    reportsConditionGradeFilter,
    coworkerQueueFilter,
    isItemReadyToRestock,
    isItemReadyForSupplierReorder,
    reportsDateFrom,
    reportsDateTo,
    reportsSortField,
    reportsSortDirection
  ]);

  // Paginated Return Reports Slice
  const paginatedReports = React.useMemo(() => {
    const start = (reportsCurrentPage - 1) * reportsPageSize;
    return processedReports.slice(start, start + reportsPageSize);
  }, [processedReports, reportsCurrentPage, reportsPageSize]);

  // Bulk Selection Helpers for Reports (Strictly defined AFTER paginatedReports)
  const isAllReportsPageSelected = React.useMemo(() => {
    if (paginatedReports.length === 0) return false;
    return paginatedReports.every(r => selectedReportIds.has(r.id || r.rma_number));
  }, [paginatedReports, selectedReportIds]);

  const toggleSelectReport = (id) => {
    setSelectedReportIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllReportsPage = () => {
    setSelectedReportIds(prev => {
      const next = new Set(prev);
      if (isAllReportsPageSelected) {
        paginatedReports.forEach(r => next.delete(r.id || r.rma_number));
      } else {
        paginatedReports.forEach(r => next.add(r.id || r.rma_number));
      }
      return next;
    });
  };

  const selectAllFilteredReports = () => {
    const next = new Set();
    processedReports.forEach(r => next.add(r.id || r.rma_number));
    setSelectedReportIds(next);
  };

  const clearReportsSelection = () => {
    setSelectedReportIds(new Set());
  };

  const selectedReportsList = React.useMemo(() => {
    return recentReportsList.filter(r => selectedReportIds.has(r.id || r.rma_number));
  }, [recentReportsList, selectedReportIds]);

  // Real-time synchronization & initial load
  useEffect(() => {
    refreshAllData();
    checkApiConnections();
    captureAccurateGps();

    // 1. Cross-tab & local event bus listener (rma_portal_sync_bus)
    const unsubscribeBus = catalogService.onDataChange((evt) => {
      console.log('[Realtime Event Bus] Event:', evt.type);
      if (evt.payload?.report) {
        const incoming = evt.payload.report;
        setRecentReportsList(prev => prev.map(r => (
          (r.id && incoming.id && String(r.id) === String(incoming.id)) ||
          (r.rma_number && incoming.rma_number && r.rma_number === incoming.rma_number && !r.parent_rma_id)
            ? { ...r, ...incoming }
            : r
        )));
      }
      refreshAllData();

      if (evt.type === 'report-submitted') {
        const rep = evt.payload?.report;
        addNotification({
          type: 'rma',
          title: `New Return: ${rep?.rma_number || 'RMA Report'}`,
          message: `${rep?.name || rep?.barcode || 'Item'} (${rep?.quantity || 1} units) - Defect: ${rep?.reason || 'Damaged'}`,
          subtext: rep?.reporter_name ? `Reported by ${rep.reporter_name}` : null
        });
      } else if (evt.type === 'unknown-barcode') {
        addNotification({
          type: 'unknown',
          title: 'Unknown Barcode Scanned',
          message: `Barcode #${evt.payload?.barcode} needs catalog verification.`,
          subtext: 'Action Required'
        });
      } else if (evt.type === 'product-deleted') {
        addNotification({
          type: 'delete',
          title: 'Product Removed',
          message: `Product ${evt.payload?.name ? `"${evt.payload.name}"` : `#${evt.payload?.barcode || ''}`} was deleted from catalog.`
        });
      } else if (evt.type === 'barcode-verified') {
        addNotification({
          type: 'product',
          title: 'Barcode Verified',
          message: `Barcode #${evt.payload?.barcode} was verified and catalog details updated.`
        });
      }
    });

    // 2. Supabase Realtime channel with graceful error handling & HTTP polling fallback
    let realtimeChannel = null;
    try {
      realtimeChannel = supabase
        .channel('rma_realtime_stream')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rma_reports' }, () => {
          refreshAllData();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
          refreshAllData();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_users' }, () => {
          refreshAllData();
        })
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[Realtime] WebSocket connection unavailable on this device/network. Operating smoothly on HTTP/REST polling fallback.');
          }
        });
    } catch (wsErr) {
      console.warn('[Realtime] Subscription skipped (WebSocket unavailable):', wsErr?.message || wsErr);
    }

    // 3. Supabase Auth listener for email signup & magic link verification
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        setCurrentUser(null);
        return;
      }

      // STRICT PROTECTION: Only auto-login if the event was an explicit SIGNED_IN event (magic link or OTP verification)
      // Never auto-sign-in on background TOKEN_REFRESHED or tab focus if user is not already logged in
      if (event === 'SIGNED_IN' && session?.user?.email) {
        const cleanEmail = session.user.email.toLowerCase();
        try {
          const urlParams = new URLSearchParams(window.location.search);
          const hasInviteToken = urlParams.has('token') || Boolean(sessionStorage.getItem('rma_pending_oauth_token'));

          // When an invited user logs in via Google, keep them strictly on the public intake form
          if (hasInviteToken) {
            setIsAdminView(false);
            setIsLoginModalOpen(false);
            return;
          }

          const currentPath = (typeof window !== 'undefined' ? window.location.pathname.toLowerCase() : '');
          const currentHash = (typeof window !== 'undefined' ? window.location.hash.toLowerCase() : '');
          const isOnAdminRoute = currentPath === '/admin' || currentPath.startsWith('/admin/') || currentHash === '#/admin' || (typeof window !== 'undefined' && window.location.search.includes('admin=true'));

          if (!isOnAdminRoute) {
            setIsAdminView(false);
            setIsLoginModalOpen(false);
            return;
          }

          const staff = await authService.getEmployees();
          const matched = staff.find(e => e.email?.toLowerCase() === cleanEmail);

          if (matched && matched.is_active !== false) {
            const user = {
              id: matched.id || 1,
              name: matched.name,
              email: matched.email,
              role: matched.role || (cleanEmail === 'finance2@keysysincorporated.com' ? 'super_admin' : 'inventory_staff'),
              department: matched.department || 'Operations',
              loggedInAt: new Date().toISOString()
            };
            localStorage.setItem('rma_portal_admin_session', JSON.stringify(user));
            sessionStorage.removeItem('rma_login_pending_email');
            setCurrentUser(user);
            setIsLoginModalOpen(false);
            setIsAdminView(true);
          }
        } catch (e) { }
      }
    });

    // 4. Immediate instant update when returning to tab/window
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshAllData();
      }
    };
    const handleFocus = () => refreshAllData();
    window.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);

    // 5. Calm 20-second heartbeat backup polling (realtime Supabase handles instant live sync)
    const pollInterval = setInterval(() => {
      refreshAllData();
    }, 20000);

    return () => {
      unsubscribeBus();
      if (realtimeChannel) {
        try {
          supabase.removeChannel(realtimeChannel);
        } catch (e) { }
      }
      authListener?.subscription?.unsubscribe();
      window.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      clearInterval(pollInterval);
    };
  }, []);

  // Check barcode whenever user stops typing to show recognized product name + image
  useEffect(() => {
    const clean = barcodeInput.trim();
    if (!clean) {
      setDetectedProduct(null);
      setCustomItemName('');
      setIsCheckingBarcode(false);
      return;
    }

    let isCurrent = true;

    const timer = setTimeout(async () => {
      setIsCheckingBarcode(true);
      try {
        const found = await catalogService.findProduct(clean);
        // Guard against race conditions: only update if this request is still the active one
        if (!isCurrent) return;
        setDetectedProduct(found);
        if (found?.name) {
          setCustomItemName(found.name);
        }
        if (found?.unit_name || found?.unitName) {
          const u = (found.unit_name || found.unitName).toLowerCase();
          setUnitName(u.includes('case') ? 'case' : 'pc');
        }
      } catch (e) {
        if (!isCurrent) return;
        setDetectedProduct(null);
      } finally {
        if (isCurrent) {
          setIsCheckingBarcode(false);
        }
      }
    }, 300);

    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [barcodeInput]);

  // Accurate GPS Location capture (Filters out desktop IP geolocation with > 150m inaccuracies)
  const captureAccurateGps = () => {
    if (!navigator.geolocation) {
      setGpsLocation({ loading: false, latitude: null, longitude: null, accuracy: null, isAccurate: false });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const acc = pos.coords.accuracy;
        // Real hardware GPS is usually within 10-100 meters
        if (acc <= 150) {
          setGpsLocation({
            loading: false,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: Math.round(acc),
            isAccurate: true
          });
        } else {
          // Desktop Wi-Fi IP geolocation is too inaccurate -> DO NOT RECORD FALSE DATA
          setGpsLocation({ loading: false, latitude: null, longitude: null, accuracy: acc, isAccurate: false });
        }
      },
      () => {
        setGpsLocation({ loading: false, latitude: null, longitude: null, accuracy: null, isAccurate: false });
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  };

  const checkApiConnections = async () => {
    try {
      const supaRes = await catalogService.testSupabase();
      if (supaRes) {
        setSupaStatus({ checking: false, connected: supaRes.connected, rowsFound: supaRes.rowsFound });
      }
    } catch (e) { }
  };

  const refreshAllData = async () => {
    try {
      await Promise.allSettled([
        catalogService.getPendingBarcodes().then(pending => setPendingBarcodesList(pending || [])),
        catalogService.getRecentReports(50).then(reports => setRecentReportsList(reports || [])),
        catalogService.getSavedProducts().then(saved => setSavedProductsList(saved || [])),
        authService.getEmployees().then(staff => setStaffList(staff || [])),
        creditMemoService.getCreditMemos().then(memos => setCreditMemosList(memos || []))
      ]);
    } catch (e) {
      console.warn('Sync notice:', e);
    }
  };

  const fetchReports = refreshAllData;

  const showToast = (text, type = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 5000);
  };

  // Add photos selected by user - starts background photo upload immediately for zero-lag submit
  const handlePhotoSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    // Enforce Max 10 photos for Damaged Product
    const availableSlots = 10 - photoFiles.length;
    if (availableSlots <= 0) {
      showToast('Maximum of 10 damaged item photos allowed.', 'warning');
      if (e.target) e.target.value = '';
      return;
    }

    const filesToProcess = files.slice(0, availableSlots);
    if (files.length > availableSlots) {
      showToast(`Added ${availableSlots} photo(s). Maximum 10 photos allowed.`, 'info');
    }

    // Keep photos local in browser until final report submission (prevents orphan Google Drive uploads)
    const newPhotos = filesToProcess.map(file => ({
      file,
      previewUrl: URL.createObjectURL(file)
    }));

    setPhotoFiles(prev => [...prev, ...newPhotos]);
    if (e.target) e.target.value = ''; // Reset input value so subsequent snaps fire onChange reliably
  };

  const removePhoto = (index) => {
    setPhotoFiles(prev => {
      const updated = [...prev];
      if (updated[index]?.previewUrl) {
        URL.revokeObjectURL(updated[index].previewUrl);
      }
      updated.splice(index, 1);
      return updated;
    });
  };

  // Cancel long-running Gemini Flash Paperwork Inspection
  const cancelPaperworkInspection = () => {
    if (paperworkAbortControllerRef.current) {
      paperworkAbortControllerRef.current.abort();
      paperworkAbortControllerRef.current = null;
    }
    setIsInspectingPaperwork(false);
    setPaperworkInspectionProgress(null);
    showToast('Inspection cancelled. You can select another photo.', 'info');
  };

  // Official Logistics Paperwork (DR / Invoice / PO) Photo Handler with Gemini Flash AI OCR (Multi-photo up to 3)
  const handlePaperworkSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    // Enforce Max 3 photos for Official Paperwork
    const availableSlots = 3 - paperworkPhotos.length;
    if (availableSlots <= 0) {
      showToast('Maximum of 3 official paperwork photos allowed.', 'warning');
      if (e.target) e.target.value = '';
      return;
    }

    const filesToProcess = files.slice(0, availableSlots);
    if (files.length > availableSlots) {
      showToast(`Processing ${availableSlots} photo(s). Maximum 3 paperwork photos allowed.`, 'info');
    }

    setPaperworkError(null);
    setIsInspectingPaperwork(true);
    setPaperworkInspectionProgress({ current: 1, total: filesToProcess.length });

    const abortController = new AbortController();
    paperworkAbortControllerRef.current = abortController;

    try {
      const validNewPhotos = [];
      let latestValidResult = null;

      for (let i = 0; i < filesToProcess.length; i++) {
        if (abortController.signal.aborted) break;

        const file = filesToProcess[i];
        setPaperworkInspectionProgress({ current: i + 1, total: filesToProcess.length });

        // 1. Inspect paperwork with Gemini Flash via /api/v1/ai/inspect-paperwork
        const inspectionResult = await catalogService.inspectPaperwork(file, abortController.signal);

        if (abortController.signal.aborted) break;

        // 2. Strict Rejection Check
        if (!inspectionResult || !inspectionResult.is_valid_document) {
          setPaperworkShake(true);
          setTimeout(() => setPaperworkShake(false), 900);
          const reason = inspectionResult?.rejection_reason || 'Photo does not appear to be an authentic wholesale Sales Invoice, DR, or PO.';
          setPaperworkError(reason);
          showToast(`Invalid document photo: ${reason}`, 'warning');
          continue; // Strictly block and do NOT add invalid photo!
        }

        latestValidResult = inspectionResult;
        validNewPhotos.push({
          file,
          previewUrl: URL.createObjectURL(file),
          metadata: inspectionResult
        });
      }

      if (abortController.signal.aborted) return;

      if (validNewPhotos.length > 0) {
        setPaperworkPhotos(prev => [...prev, ...validNewPhotos]);
        setPaperworkMetadata(latestValidResult);

        // 3. Accepted Document: Auto-populate separate SI#, DR#, PO# and Store Branch fields!
        if (latestValidResult.si_number) setSiNumber(latestValidResult.si_number);
        if (latestValidResult.dr_number) setDrNumber(latestValidResult.dr_number);
        if (latestValidResult.po_number) setPoNumber(latestValidResult.po_number);
        if (latestValidResult.invoice_dr_number) setInvoiceDrNumber(latestValidResult.invoice_dr_number);
        if (latestValidResult.store_branch) setStoreBranch(latestValidResult.store_branch);

        const detectedNum = latestValidResult.si_number || latestValidResult.dr_number || latestValidResult.po_number || latestValidResult.invoice_dr_number || 'Detected';
        showToast(`✓ Verified ${latestValidResult.document_type || 'Paperwork'} (${detectedNum})`, 'success');
      }
    } catch (err) {
      if (err.name === 'AbortError' || abortController.signal.aborted) {
        console.log('Paperwork inspection cancelled by user.');
        return;
      }
      console.error('Paperwork inspection error:', err);
      setPaperworkShake(true);
      setTimeout(() => setPaperworkShake(false), 900);
      setPaperworkError('Could not verify paperwork photo. Please ensure document numbers are clear.');
      showToast('Paperwork inspection failed. Please ensure the document is flat and readable.', 'warning');
    } finally {
      setIsInspectingPaperwork(false);
      setPaperworkInspectionProgress(null);
      paperworkAbortControllerRef.current = null;
      if (e.target) e.target.value = '';
    }
  };

  const removePaperworkPhoto = (index) => {
    setPaperworkPhotos(prev => {
      const updated = [...prev];
      if (updated[index]?.previewUrl) {
        URL.revokeObjectURL(updated[index].previewUrl);
      }
      updated.splice(index, 1);
      if (updated.length === 0) {
        setPaperworkMetadata(null);
        setPaperworkError(null);
      }
      return updated;
    });
  };

  // Add current item to manifest queue
  const handleAddManifestItem = () => {
    const cleanBarcode = barcodeInput.trim();
    if (!cleanBarcode) {
      showToast('Please scan or enter a product barcode / SKU before adding.', 'warning');
      return;
    }

    if (selectedReason.toLowerCase().includes('expired') && !expiryDate) {
      showToast('Product expiry date is required when returning expired items.', 'warning');
      return;
    }

    const effectiveItemName = customItemName.trim() || detectedProduct?.name || (cleanBarcode ? `Unidentified Item (${cleanBarcode})` : 'General Return Item');
    const submitQty = Math.max(1, parseInt(quantity, 10) || 1);
    const finalUnit = unitName || detectedProduct?.unit_name || 'pc';

    const cleanSku = (detectedProduct?.code && detectedProduct.code !== cleanBarcode)
      ? detectedProduct.code
      : ((detectedProduct?.sku && detectedProduct.sku !== cleanBarcode) ? detectedProduct.sku : '');

    const newItem = {
      id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      barcode: cleanBarcode,
      code: cleanSku,
      sku: cleanSku,
      name: effectiveItemName,
      productName: effectiveItemName,
      quantity: submitQty,
      unit_name: finalUnit,
      unit: finalUnit,
      pieces_per_case: detectedProduct?.pieces_per_case || detectedProduct?.piecesPerCase || null,
      supplier_name: (detectedProduct?.supplier_name && detectedProduct.supplier_name !== 'Savemore') ? detectedProduct.supplier_name : (detectedProduct?.supplier_name || 'Pending Assignment'),
      supplier: (detectedProduct?.supplier_name && detectedProduct.supplier_name !== 'Savemore') ? detectedProduct.supplier_name : (detectedProduct?.supplier_name || 'Pending Assignment'),
      price: Number(detectedProduct?.price || 0),
      price_with_vat: Number(detectedProduct?.price_with_vat || detectedProduct?.priceWithVat || detectedProduct?.price || 0),
      reason: selectedReason,
      explanation: explanation || '',
      expiry_date: expiryDate || null,
      photoFiles: [...photoFiles],
      detectedProduct: detectedProduct || null,
      created_at: new Date().toISOString()
    };

    setManifestItems(prev => [...prev, newItem]);

    // Reset item-specific fields
    setBarcodeInput('');
    setCustomItemName('');
    setDetectedProduct(null);
    setQuantity(1);
    setUnitName('pc');
    setSelectedReason(DEFECT_REASONS[0]);
    setExplanation('');
    setExpiryDate('');
    setPhotoFiles([]);

    showToast(`Added "${newItem.name}" (${newItem.quantity} ${newItem.unit}) to manifest`, 'success');
  };

  // Remove an item from the manifest queue
  const handleRemoveManifestItem = (itemId) => {
    setManifestItems(prev => prev.filter(it => it.id !== itemId));
    showToast('Item removed from manifest.', 'info');
  };

  const handleSubmitReport = async (e) => {
    e.preventDefault();

    // 0. Gatekeeper Check: Block return unless user is an authenticated Super Admin OR has a verified Invite Token session
    if (!isAdminView && currentUser?.role !== 'super_admin') {
      if (!gateSession || !gateSession.token) {
        showToast('Access restricted. Only authorized invite links or Super Admins can submit from the public portal.', 'error');
        return;
      }
      const check = await inviteService.validateInviteToken(gateSession.token);
      if (!check.valid) {
        try {
          localStorage.removeItem('rma_portal_gate_session');
        } catch { }
        setGateSession(null);
        showToast(
          check.error === 'REVOKED'
            ? 'Submission blocked: Your return authorization has been revoked by Pingcon Operations.'
            : check.error === 'EXPIRED'
            ? 'Submission blocked: Your return authorization link has expired.'
            : 'Submission blocked: Your return authorization link is invalid or deleted.',
          'error'
        );
        return;
      }
    }

    // 1. Gather all line items: previously added manifest items + active item if user has typed a barcode
    let itemsToSubmit = [...manifestItems];
    const activeBarcode = barcodeInput.trim();
    if (activeBarcode) {
      if (selectedReason.toLowerCase().includes('expired') && !expiryDate) {
        showToast('Product expiry date is required when returning expired items.', 'warning');
        return;
      }
      const effectiveItemName = customItemName.trim() || detectedProduct?.name || (activeBarcode ? `Unidentified Item (${activeBarcode})` : 'General Return Item');
      const submitQty = Math.max(1, parseInt(quantity, 10) || 1);
      const finalUnit = unitName || detectedProduct?.unit_name || 'pc';

      const cleanActiveSku = (detectedProduct?.code && detectedProduct.code !== activeBarcode)
        ? detectedProduct.code
        : ((detectedProduct?.sku && detectedProduct.sku !== activeBarcode) ? detectedProduct.sku : '');

      itemsToSubmit.push({
        id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        barcode: activeBarcode,
        code: cleanActiveSku,
        sku: cleanActiveSku,
        name: effectiveItemName,
        productName: effectiveItemName,
        quantity: submitQty,
        unit_name: finalUnit,
        unit: finalUnit,
        pieces_per_case: detectedProduct?.pieces_per_case || detectedProduct?.piecesPerCase || null,
        supplier_name: (detectedProduct?.supplier_name && detectedProduct.supplier_name !== 'Savemore') ? detectedProduct.supplier_name : (detectedProduct?.supplier_name || 'Pending Assignment'),
        supplier: (detectedProduct?.supplier_name && detectedProduct.supplier_name !== 'Savemore') ? detectedProduct.supplier_name : (detectedProduct?.supplier_name || 'Pending Assignment'),
        price: Number(detectedProduct?.price || 0),
        price_with_vat: Number(detectedProduct?.price_with_vat || detectedProduct?.priceWithVat || detectedProduct?.price || 0),
        reason: selectedReason,
        explanation: explanation || '',
        expiry_date: expiryDate || null,
        photoFiles: [...photoFiles],
        detectedProduct: detectedProduct || null,
        created_at: new Date().toISOString()
      });
    }

    if (itemsToSubmit.length === 0) {
      showToast('Please enter a product barcode or add at least one item to the return manifest.', 'warning');
      return;
    }

    const cleanSi = siNumber.trim();
    const cleanDr = drNumber.trim();
    const cleanPo = poNumber.trim();
    const effectiveContact = (gateSession?.authorized_email || reporterContact || '').trim();

    if (!reporterName.trim() || !effectiveContact) {
      showToast('Please provide your name and contact information.', 'warning');
      return;
    }

    const inviteEntity = inviteService.normalizeEntityName(gateSession?.entity_name || gateSession?.store_branch);
    const resolvedBranch = storeBranch.trim() || inviteEntity || 'Direct Return';
    const isSuperAdminSupplierOutbound = Boolean(currentUser?.role === 'super_admin' && !gateSession && testModeStreamType === 'supplier_outbound');
    const resolvedSupplierFromPortal =
      (itemsToSubmit[0]?.supplier_name &&
        itemsToSubmit[0].supplier_name !== 'Warehouse' &&
        itemsToSubmit[0].supplier_name !== 'Savemore' &&
        itemsToSubmit[0].supplier_name !== 'Pending Assignment')
        ? itemsToSubmit[0].supplier_name
        : ((gateSession?.stream_type === 'supplier_outbound' || isSuperAdminSupplierOutbound) && (storeBranch.trim() || inviteEntity))
          ? (storeBranch.trim() || inviteEntity)
          : (itemsToSubmit[0]?.supplier_name || 'Pending Assignment');

    // Persist reporter contact info in localStorage for 1-tap zero-typing returns
    try {
      localStorage.setItem('rma_reporter_name', reporterName.trim());
      localStorage.setItem('rma_reporter_contact', effectiveContact);
    } catch { }

    // 2. Determine RMA Type based on station Gatekeeper profile or Super Admin stream selector (works whether Test Mode is ON or OFF)
    const determinedRmaType = (isSuperAdminSupplierOutbound || gateSession?.stream_type === 'supplier_outbound' || gateSession?.type === 'internal_warehouse')
      ? 'supplier_outbound'
      : 'customer_inbound';

    // 3. Generate ONE unique RMA Number for the batch ticket
    const rmaNumber = catalogService.generateRMANumber(recentReportsList);
    const totalItemsCount = itemsToSubmit.length;
    const totalQuantityCount = itemsToSubmit.reduce((acc, it) => acc + (Number(it.quantity) || 1), 0);
    const commonUnit = itemsToSubmit.every(it => it.unit_name === itemsToSubmit[0].unit_name) ? itemsToSubmit[0].unit_name : 'mixed';
    const isBatchManifestTicket = itemsToSubmit.length > 1;
    // For batch manifests, barcode is strictly rmaNumber to completely prevent child item barcode contamination
    const primaryBarcode = isBatchManifestTicket ? rmaNumber : (itemsToSubmit[0]?.barcode || rmaNumber);
    const primaryName = isBatchManifestTicket ? `Batch Return Manifest (${itemsToSubmit.length} items)` : itemsToSubmit[0].name;
    const primaryReason = isBatchManifestTicket ? `Multi-Item Defect (${itemsToSubmit.length} items)` : itemsToSubmit[0].reason;
    const primaryExplanation = isBatchManifestTicket
      ? (itemsToSubmit.map(it => (it.explanation || '').trim()).filter(Boolean).join(' | ') || null)
      : ((itemsToSubmit[0]?.explanation || '').trim() || null);
    const primaryDocNumber = cleanDr || cleanSi || cleanPo || invoiceDrNumber.trim() || null;

    // 4. Show success screen with full report details for QR sticker generation INSTANTLY!
    const optimisticReportPayload = {
      rma_number: rmaNumber,
      rmaNumber: rmaNumber,
      rma_type: determinedRmaType,
      barcode: primaryBarcode,
      name: primaryName,
      productName: primaryName,
      code: isBatchManifestTicket ? '' : ((itemsToSubmit[0]?.code && itemsToSubmit[0]?.code !== primaryBarcode) ? itemsToSubmit[0]?.code : ''),
      sku: isBatchManifestTicket ? '' : ((itemsToSubmit[0]?.sku && itemsToSubmit[0]?.sku !== primaryBarcode) ? itemsToSubmit[0]?.sku : ''),
      quantity: totalQuantityCount,
      unit_name: commonUnit,
      unit: commonUnit,
      total_items: totalItemsCount,
      total_quantity: totalQuantityCount,
      is_parent: isBatchManifestTicket,
      store_branch: resolvedBranch,
      store: resolvedBranch,
      supplier_name: resolvedSupplierFromPortal,
      supplier: resolvedSupplierFromPortal,
      reason: primaryReason,
      explanation: primaryExplanation,
      disposition: determinedRmaType === 'supplier_outbound' ? '3- Return to Vendor (RTV)' : 'Pending Triage',
      status: 'pending',
      reporter_name: reporterName || 'Staff',
      reporter_contact: effectiveContact,
      si_number: cleanSi || null,
      dr_number: cleanDr || null,
      po_number: cleanPo || null,
      invoice_dr_number: primaryDocNumber,
      items: itemsToSubmit,
      expiry_date: itemsToSubmit[0]?.expiry_date || null,
      batch_lot_number: batchLotNumber ? batchLotNumber.trim() : null,
      ai_document_metadata: paperworkMetadata || null,
      photoCount: itemsToSubmit.reduce((acc, it) => acc + (it.photoFiles?.length || 0), 0),
      paperworkCount: paperworkPhotos.length,
      hasGps: gpsLocation.isAccurate,
      created_at: new Date().toISOString()
    };

    setSubmitSuccessReport(optimisticReportPayload);
    setRecentReportsList(prev => [optimisticReportPayload, ...prev.filter(r => r.rma_number !== rmaNumber)]);

    // 5. Reset form fields immediately so UI is completely responsive
    const capturedItems = [...itemsToSubmit];
    const capturedPaperworkPhotos = [...paperworkPhotos];
    const capturedSiNumber = cleanSi || null;
    const capturedDrNumber = cleanDr || null;
    const capturedPoNumber = cleanPo || null;
    const capturedInvoiceDrNumber = primaryDocNumber;
    const capturedStoreBranch = resolvedBranch;
    const capturedBatchLotNumber = batchLotNumber ? batchLotNumber.trim() : null;
    const capturedPaperworkMetadata = paperworkMetadata;
    const capturedReporterName = reporterName;
    const capturedReporterContact = effectiveContact;
    const capturedGps = gpsLocation.isAccurate ? gpsLocation : null;

    setManifestItems([]);
    setBarcodeInput('');
    setCustomItemName('');
    setDetectedProduct(null);
    setQuantity(1);
    setUnitName('pc');
    setSelectedReason(DEFECT_REASONS[0]);
    setExplanation('');
    setPhotoFiles([]);
    setPaperworkPhotos([]);
    setPaperworkMetadata(null);
    setSiNumber('');
    setDrNumber('');
    setPoNumber('');
    setInvoiceDrNumber('');
    setCustomStoreBranch('');
    setExpiryDate('');
    setBatchLotNumber('');
    setPaperworkError(null);
    setSelectedReportIds(new Set());
    setIsSubmitting(false);

    // 6. Background execution: hierarchical Google Drive upload, Supabase insertion, email
    (async () => {
      try {
        const photoMeta = {
          rmaType: determinedRmaType,
          customerName: capturedStoreBranch,
          storeBranch: capturedStoreBranch,
          supplierName: capturedItems[0]?.supplier_name
        };

        // 1. Upload damaged item photos sequentially so the folder is created once and reused for all photos
        const uploadedPhotosByItem = {};
        const allUploadedDamagedUrls = [];
        let rmaDamagedFolderId = null;
        let rmaDamagedFolderUrl = null;

        for (const item of capturedItems) {
          uploadedPhotosByItem[item.id] = [];
          if (Array.isArray(item.photoFiles)) {
            for (const p of item.photoFiles) {
              if (!p?.file) continue;
              const meta = { ...photoMeta, targetFolderId: rmaDamagedFolderId };
              const res = await catalogService.uploadPhotoWithDetails(p.file, rmaNumber, 'damaged_items', meta);
              if (res) {
                if (res.url) {
                  uploadedPhotosByItem[item.id].push(res.url);
                  allUploadedDamagedUrls.push(res.url);
                }
                if (res.rmaFolderId && !rmaDamagedFolderId) {
                  rmaDamagedFolderId = res.rmaFolderId;
                  rmaDamagedFolderUrl = res.rmaFolderUrl;
                }
              }
            }
          }
        }

        // 2. Upload official paperwork photos sequentially so that the paperwork folder is created once
        const paperworkResults = [];
        let rmaPaperworkFolderId = null;
        let rmaPaperworkFolderUrl = null;

        for (const item of capturedPaperworkPhotos) {
          if (!item.file) continue;
          const meta = { ...photoMeta, targetFolderId: rmaPaperworkFolderId };
          const res = await catalogService.uploadPhotoWithDetails(item.file, rmaNumber, 'official_paperwork', meta);
          if (res) {
            paperworkResults.push(res);
            if (res.rmaFolderId && !rmaPaperworkFolderId) {
              rmaPaperworkFolderId = res.rmaFolderId;
              rmaPaperworkFolderUrl = res.rmaFolderUrl;
            }
          }
        }

        const uploadedPaperworkUrls = paperworkResults.map(r => r?.url).filter(Boolean);
        const gdriveFolderUrl = rmaDamagedFolderUrl || rmaPaperworkFolderUrl || paperworkResults[0]?.rmaFolderUrl || null;
        const gdriveFolderId = rmaDamagedFolderId || rmaPaperworkFolderId || paperworkResults[0]?.rmaFolderId || null;

        const res = await catalogService.submitReport({
          rmaNumber,
          barcode: primaryBarcode,
          name: primaryName,
          productName: primaryName,
          rma_type: determinedRmaType,
          is_parent: isBatchManifestTicket,
          product: isBatchManifestTicket ? null : (capturedItems[0]?.detectedProduct || null),
          quantity: totalQuantityCount,
          total_items: totalItemsCount,
          total_quantity: totalQuantityCount,
          items: capturedItems.map(it => ({
            barcode: it.barcode,
            code: (it.code && it.code !== it.barcode) ? it.code : ((it.sku && it.sku !== it.barcode) ? it.sku : null),
            sku: (it.sku && it.sku !== it.barcode) ? it.sku : ((it.code && it.code !== it.barcode) ? it.code : null),
            name: it.name,
            productName: it.name,
            quantity: it.quantity,
            unit_name: it.unit_name,
            unit: it.unit_name,
            price: it.price,
            price_with_vat: it.price_with_vat,
            supplier_name: it.supplier_name,
            reason: it.reason,
            explanation: it.explanation,
            expiry_date: it.expiry_date,
            photos: uploadedPhotosByItem[it.id] || []
          })),
          reporterName: capturedReporterName,
          reporterContact: capturedReporterContact,
          reason: primaryReason,
          explanation: primaryExplanation,
          photos: allUploadedDamagedUrls.length > 0 ? allUploadedDamagedUrls : ['https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=800&auto=format&fit=crop&q=80'],
          paperwork_photos: uploadedPaperworkUrls,
          si_number: capturedSiNumber,
          dr_number: capturedDrNumber,
          po_number: capturedPoNumber,
          invoice_dr_number: capturedInvoiceDrNumber,
          supplier_name: resolvedSupplierFromPortal,
          store_branch: capturedStoreBranch,
          expiry_date: capturedItems[0]?.expiry_date || null,
          batch_lot_number: capturedBatchLotNumber,
          ai_document_metadata: capturedPaperworkMetadata,
          google_drive_folder_url: gdriveFolderUrl,
          google_drive_folder_id: gdriveFolderId,
          gps: capturedGps
        });

        if (res?.report) {
          setRecentReportsList(prev => [res.report, ...prev.filter(r => r.rma_number !== rmaNumber)]);
        }
        setTimeout(() => {
          refreshAllData();
        }, 100);
      } catch (err) {
        console.error('Background report sync error:', err);
        showToast(`Database sync warning: ${err.message || 'Could not sync report to database'}`, 'error');
      }
    })();
  };

  return (
    <div className="min-h-dvh w-full max-w-full bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 font-sans p-3 sm:p-6 lg:p-8 pt-safe pb-safe transition-colors duration-200 overflow-x-hidden box-border">
      {/* Dynamic container width: spacious layout for public reporter (max-w-2xl) and SaaS dashboard for admin */}
      <div id="app-main-view-container" className={`${isAdminView ? 'w-full max-w-7xl' : 'w-full max-w-2xl'} mx-auto space-y-4 sm:space-y-6 transition-all duration-300 min-w-0 box-border`}>

        {/* ================================================================= */}
        {/* 1. PUBLIC REPORTER PORTAL (Accessible at '/' or default)          */}
        {/* ================================================================= */}
        {!isAdminView && (
          <div className="space-y-4 animate-in fade-in duration-200">

            {/* Top Navigation Bar: Station Branding, Device Lock & Theme Control */}
            <div className="flex items-center justify-between gap-3 p-3.5 sm:p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-2xl bg-blue-50 dark:bg-blue-950/70 border border-blue-200 dark:border-blue-900 text-blue-600 dark:text-blue-400 shrink-0">
                  {gateSession?.type === 'internal_warehouse' ? <Building2 className="w-4 h-4" /> : <Package className="w-4 h-4" />}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-extrabold text-xs text-slate-900 dark:text-white truncate">
                      {gateSession ? (gateSession.profileName || 'Station Active') : 'Customer & Warehouse Returns'}
                    </span>
                    {gateSession && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold shrink-0">
                        /{gateSession.slug}
                      </span>
                    )}
                  </div>
                  {sessionCountdown.text ? (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border transition-all ${
                        sessionCountdown.totalSeconds < 300
                          ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300 border-rose-300 dark:border-rose-800 animate-pulse'
                          : sessionCountdown.totalSeconds < 1800
                          ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                          : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                      }`}>
                        <Clock className="w-3 h-3 shrink-0" />
                        <span>Link expires in: <strong>{sessionCountdown.text}</strong></span>
                      </span>
                    </div>
                  ) : (
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                      {gateSession ? 'Authorized Return Intake Active' : 'Pingcon RMA Return Intake'}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {gateSession && (
                  <button
                    type="button"
                    onClick={handleLockStation}
                    className="touch-target px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-rose-50 dark:bg-slate-800 dark:hover:bg-rose-950/40 text-slate-700 dark:text-slate-200 hover:text-rose-600 dark:hover:text-rose-400 border border-slate-200 dark:border-slate-700 text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer active:scale-95"
                    title="Lock device and require 6-digit PIN"
                  >
                    <Lock className="w-3.5 h-3.5 text-slate-400" />
                    <span>Lock Device</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={toggleTheme}
                  className="touch-target p-2 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white shadow-2xs transition-colors cursor-pointer shrink-0"
                  title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                  aria-label="Toggle Theme"
                >
                  {isDarkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
                </button>
              </div>
            </div>


            {/* Super Admin Status, Test Mode & Destination Hub Control Banner on Public Portal:
                Only displayed if the active user is an authenticated Super Admin.
                Must NEVER render for users accessing via an invite token. */}
            {currentUser?.role === 'super_admin' && !(() => {
              if (typeof window === 'undefined') return false;
              const p = new URLSearchParams(window.location.search);
              return p.has('token') || Boolean(gateSession);
            })() && (
              <div className={`p-4 sm:p-5 rounded-3xl border transition-all text-xs space-y-3.5 shadow-xs ${isTestMode
                ? 'bg-amber-500/10 dark:bg-amber-950/40 border-amber-500/40 text-amber-900 dark:text-amber-200'
                : 'bg-emerald-500/10 dark:bg-emerald-950/40 border-emerald-500/40 text-emerald-900 dark:text-emerald-200'
                }`}>
                {/* Row 1: Identity & Mode Controls */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                    <div className={`p-2.5 rounded-2xl shrink-0 shadow-xs ${isTestMode ? 'bg-amber-500 text-slate-950 font-black' : 'bg-emerald-600 text-white'
                      }`}>
                      {isTestMode ? <FlaskConical className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <strong className="font-black text-xs sm:text-sm">
                          {isTestMode ? '🧪 Super Admin Sandbox Active' : '🟢 Live Delivery Mode Active'}
                        </strong>
                        <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-white/80 dark:bg-slate-900/80 border border-current/20 font-bold whitespace-nowrap">
                          {currentUser.name || 'Danilo Alvaro (Super Admin)'}
                        </span>
                      </div>
                      <p className="text-[11px] opacity-85 leading-relaxed">
                        {isTestMode
                          ? 'Test emails routed safely to finance2@keysysincorporated.com • Reports saved to database.'
                          : 'Official return reports saved to database & sent directly to supplier & Assigned AEs.'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-stretch sm:self-center justify-end">
                    <button
                      type="button"
                      onClick={toggleTestMode}
                      className={`touch-target px-3.5 py-2 rounded-xl font-black text-xs transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 whitespace-nowrap ${isTestMode
                        ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/20'
                        : 'bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700'
                        }`}
                      title="Toggle Test / Sandbox Mode"
                    >
                      {isTestMode ? <ToggleRight className="w-4 h-4 text-slate-950" /> : <ToggleLeft className="w-4 h-4 text-slate-400" />}
                      <span>{isTestMode ? 'Test Mode: ON' : 'Test Mode: OFF'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => navigateTo('/admin')}
                      className="touch-target px-3.5 py-2 rounded-xl text-xs font-bold bg-white/90 hover:bg-white dark:bg-slate-800/90 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-2xs transition-all cursor-pointer active:scale-95 flex items-center gap-1 whitespace-nowrap"
                      title="Return to Admin Dashboard"
                    >
                      <span>Admin Portal</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Row 2: Report Destination Hub Selector (Always available for Super Admin whether Test Mode is ON or OFF) */}
                <div className={`pt-3 border-t flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                  isTestMode ? 'border-amber-400/40 dark:border-amber-800/60' : 'border-emerald-400/40 dark:border-emerald-800/60'
                }`}>
                  <div className="space-y-0.5">
                    <span className="text-[11px] font-black uppercase tracking-wider block">
                      Report Destination Hub:
                    </span>
                    <span className="text-[10px] opacity-80 block">
                      Choose whether this return goes to Customer RMA Hub or Supplier RTV Hub
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-white/80 dark:bg-slate-900/90 border border-current/20 sm:w-auto w-full shrink-0">
                    <button
                      type="button"
                      onClick={() => setTestModeStreamType('customer_inbound')}
                      className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap ${
                        testModeStreamType === 'customer_inbound'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span>📥 Customer RMA Hub</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTestModeStreamType('supplier_outbound')}
                      className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap ${
                        testModeStreamType === 'supplier_outbound'
                          ? 'bg-purple-600 text-white shadow-sm'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span>📤 Supplier RTV Hub</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Fluid Header Typography */}
            <div className="text-center space-y-1.5 pb-1">
              <h1 className="text-fluid-title font-black text-slate-900 dark:text-white tracking-tight">
                Report Item for Return
              </h1>
              <p className="text-fluid-subtitle text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Scan code, attach proof photo, and submit return report.
              </p>
            </div>

            {/* Submission Success Screen with Full Dark Mode Support */}
            {submitSuccessReport ? (
              <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/80 rounded-3xl p-5 sm:p-8 shadow-sm text-center space-y-4 animate-in zoom-in-95">
                <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
                  <CheckCircle className="w-8 h-8" />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">Return Report Filed!</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Your report has been logged and the inventory team has been notified.
                  </p>
                </div>

                <div className="p-3.5 sm:p-4 bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-2xl text-left text-xs space-y-2">
                  <div className="flex justify-between border-b border-emerald-200/80 dark:border-emerald-900/60 pb-1.5">
                    <span className="text-slate-500 dark:text-slate-400">RMA Number:</span>
                    <strong className="font-mono text-emerald-800 dark:text-emerald-300 text-sm">{submitSuccessReport.rmaNumber}</strong>
                  </div>

                  {submitSuccessReport.total_items > 1 ? (
                    <>
                      <div className="flex justify-between border-b border-emerald-200/80 dark:border-emerald-900/60 pb-1.5">
                        <span className="text-slate-500 dark:text-slate-400">Manifest Summary:</span>
                        <strong className="font-mono text-blue-700 dark:text-blue-300">
                          {formatManifestBreakdown(submitSuccessReport.items, true)}
                        </strong>
                      </div>
                      <div className="flex justify-between border-b border-emerald-200/80 dark:border-emerald-900/60 pb-1.5">
                        <span className="text-slate-500 dark:text-slate-400">Store / Branch:</span>
                        <strong className="text-slate-800 dark:text-slate-200">{submitSuccessReport.store_branch || 'N/A'}</strong>
                      </div>
                      <div className="pt-1 space-y-1">
                        <span className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 block">
                          Included Manifest Items:
                        </span>
                        <div className="space-y-1 max-h-36 overflow-y-auto pr-0.5">
                          {submitSuccessReport.items.map((it, idx) => (
                            <div key={idx} className="flex justify-between items-center text-[11px] bg-white/80 dark:bg-slate-800/80 p-1.5 rounded-lg border border-emerald-200/70 dark:border-emerald-900/50">
                              <span className="truncate pr-2 font-bold text-slate-800 dark:text-slate-200">
                                • {it.name || it.productName} ({it.barcode})
                              </span>
                              <span className="font-mono font-black shrink-0 text-slate-900 dark:text-white">
                                {formatQuantityWithPackSize(it.quantity, it.unit_name || it.unit || 'pc', it.pieces_per_case || it.piecesPerCase)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between border-b border-emerald-200/80 dark:border-emerald-900/60 pb-1.5">
                        <span className="text-slate-500 dark:text-slate-400">Barcode:</span>
                        <strong className="font-mono text-slate-800 dark:text-slate-200">{submitSuccessReport.barcode}</strong>
                      </div>
                      <div className="flex justify-between border-b border-emerald-200/80 dark:border-emerald-900/60 pb-1.5">
                        <span className="text-slate-500 dark:text-slate-400">Item:</span>
                        <strong className="text-slate-800 dark:text-slate-200 text-right truncate ml-2">{submitSuccessReport.productName}</strong>
                      </div>
                      <div className="flex justify-between border-b border-emerald-200/80 dark:border-emerald-900/60 pb-1.5">
                        <span className="text-slate-500 dark:text-slate-400">Reason:</span>
                        <strong className="text-slate-800 dark:text-slate-200">{submitSuccessReport.reason}</strong>
                      </div>
                    </>
                  )}

                  <div className="flex justify-between pt-0.5">
                    <span className="text-slate-500 dark:text-slate-400">Photos Attached:</span>
                    <strong className="text-emerald-700 dark:text-emerald-400">{submitSuccessReport.photoCount} Image(s)</strong>
                  </div>
                </div>

                {/* Generated RMA QR Code Box Sticker Card */}
                <div className="p-3.5 sm:p-4 bg-white dark:bg-slate-950 border-2 border-dashed border-emerald-300 dark:border-emerald-800 rounded-2xl flex flex-col sm:flex-row items-center gap-3.5 sm:gap-4 text-left shadow-xs">
                  <div className="p-2.5 bg-white rounded-xl border border-slate-300 dark:border-slate-700 shadow-xs shrink-0 text-center">
                    <QRCodeSVG
                      id="filed-report-qr-svg"
                      value={typeof window !== 'undefined'
                        ? `${window.location.origin}/?rma=${encodeURIComponent(submitSuccessReport.rmaNumber)}&rep=${encodeURIComponent(submitSuccessReport.reporter_name || 'Staff')}&contact=${encodeURIComponent(submitSuccessReport.reporter_contact || '')}&dt=${encodeURIComponent(new Date(submitSuccessReport.created_at || Date.now()).toLocaleString())}`
                        : submitSuccessReport.rmaNumber}
                      size={110}
                      level="H"
                      includeMargin={false}
                    />
                    <span className="text-[8px] font-mono font-black text-slate-700 block mt-1 tracking-wider">
                      SCAN FOR RMA
                    </span>
                  </div>

                  <div className="space-y-1 min-w-0 flex-1 text-center sm:text-left">
                    <div className="flex items-center justify-center sm:justify-start gap-1.5 flex-wrap">
                      <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300">
                        Box Sticker Ready
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {submitSuccessReport.total_items > 1
                          ? formatManifestBreakdown(submitSuccessReport.items, true)
                          : formatQuantityWithPackSize(
                              submitSuccessReport.quantity || 1,
                              submitSuccessReport.unit_name || 'pc',
                              submitSuccessReport.items?.[0]?.pieces_per_case || submitSuccessReport.items?.[0]?.piecesPerCase
                            )}
                      </span>
                      {submitSuccessReport.store_branch && (
                        <span className="text-[10px] text-blue-700 dark:text-blue-300 font-bold truncate">
                          • {submitSuccessReport.store_branch}
                        </span>
                      )}
                    </div>
                    <div className="font-mono font-black text-slate-900 dark:text-white text-base truncate">
                      {submitSuccessReport.rmaNumber}
                    </div>
                    <div className="font-bold text-slate-800 dark:text-slate-200 text-xs truncate">
                      {submitSuccessReport.productName}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 space-y-0.5 pt-1 border-t border-slate-100 dark:border-slate-800">
                      <div>Reported by: <strong className="text-slate-700 dark:text-slate-300">{submitSuccessReport.reporter_name || 'Staff'}</strong></div>
                      {submitSuccessReport.reporter_contact && <div>Contact: <strong className="font-mono text-slate-700 dark:text-slate-300">{submitSuccessReport.reporter_contact}</strong></div>}
                      {submitSuccessReport.invoice_dr_number && (
                        <div>DR/Invoice #: <strong className="font-mono text-violet-700 dark:text-violet-300">{submitSuccessReport.invoice_dr_number}</strong> {submitSuccessReport.store_branch ? `(${submitSuccessReport.store_branch})` : ''}</div>
                      )}
                      <div>Date & Time: <span className="font-mono">{new Date(submitSuccessReport.created_at || Date.now()).toLocaleString()}</span></div>
                    </div>

                    {/* Reporter Signature Area */}
                    <div className="pt-2 border-t-2 border-dashed border-slate-300 dark:border-slate-700 text-[10px]">
                      <div className="flex items-center justify-between text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-4">
                        <span>Reporter Signature:</span>
                        <span>Date: ____________</span>
                      </div>
                      <div className="border-b-2 border-slate-800 dark:border-slate-300 w-full mb-1"></div>
                      <div className="text-[8px] text-slate-600 dark:text-slate-400 font-semibold text-center">
                        Signed by {submitSuccessReport.reporter_name || 'Staff'} • Physical Return Handover
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                      Download QR or print sticker to tape directly to the returned box for instant warehouse intake scanning.
                    </p>
                  </div>
                </div>

                {/* Action Buttons: Save Sticker (PNG), Print Sticker, Report Another */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const dateFormatted = new Date(submitSuccessReport.created_at || Date.now()).toLocaleString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        });
                        await downloadBoxStickerPng({
                          svgElementOrId: 'filed-report-qr-svg',
                          rmaNumber: submitSuccessReport.rmaNumber,
                          supplier: submitSuccessReport.supplier || submitSuccessReport.supplier_name || 'Pending Assignment',
                          itemName: submitSuccessReport.productName || submitSuccessReport.name || 'Returned Merchandise',
                          barcode: submitSuccessReport.barcode,
                          sku: submitSuccessReport.sku || submitSuccessReport.code || '',
                          quantity: submitSuccessReport.quantity || 1,
                          unit: submitSuccessReport.unit_name || submitSuccessReport.unit || 'pc',
                          reason: submitSuccessReport.reason || 'Defective / Return',
                          reporter: submitSuccessReport.reporter_name || submitSuccessReport.reporter || 'Staff',
                          reporterContact: submitSuccessReport.reporter_contact || '',
                          dateFormatted,
                          storeBranch: submitSuccessReport.store_branch,
                          totalItems: submitSuccessReport.total_items,
                          totalQuantity: submitSuccessReport.total_quantity,
                          items: submitSuccessReport.items
                        });
                        showToast(`Official Box Sticker for ${submitSuccessReport.rmaNumber} downloaded!`, 'success');
                      } catch (err) {
                        console.error('Failed to download sticker:', err);
                        showToast('Failed to download sticker image.', 'warning');
                      }
                    }}
                    className="touch-target w-full py-3 px-3 bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white font-extrabold text-xs rounded-2xl shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                    title="Download high-resolution official RMA Box Verification Sticker PNG"
                  >
                    <Download className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Save Sticker (PNG)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setQrModalReport(submitSuccessReport)}
                    className="touch-target w-full py-3 px-3 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-2xl shadow-md shadow-blue-600/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                    title="Open print preview and sticker formatting options"
                  >
                    <Printer className="w-4 h-4 shrink-0" />
                    <span>Print Box Sticker</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSubmitSuccessReport(null)}
                    className="touch-target w-full py-3 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-extrabold text-xs rounded-2xl transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                  >
                    <Plus className="w-4 h-4 shrink-0" />
                    <span>Report Another</span>
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmitReport} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-7 shadow-sm space-y-6">

                {/* Authorized Return Identity & Live Session Timer Banner */}
                {gateSession && (
                  <div className="p-3.5 sm:p-4 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-inner ${
                        gateSession.stream_type === 'supplier_outbound'
                          ? 'bg-purple-100 dark:bg-purple-900/60 text-purple-600 dark:text-purple-400'
                          : 'bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400'
                      }`}>
                        {gateSession.stream_type === 'supplier_outbound' ? <Truck className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5 flex-wrap">
                          <span>{gateSession.entity_name || gateSession.store_branch || 'Authorized Partner'}</span>
                          {gateSession.authorized_email && (
                            <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-100/70 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full font-bold">
                              ✓ {gateSession.authorized_email}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium truncate">
                          {gateSession.stream_type === 'supplier_outbound' ? 'Authorized Supplier Return to Vendor (RTV)' : 'Customer Return Authorization'}
                        </p>
                      </div>
                    </div>

                    {sessionCountdown.text && (
                      <div className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 shrink-0 self-start sm:self-auto border transition-all ${
                        sessionCountdown.totalSeconds < 300
                          ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300 border-rose-300 dark:border-rose-800 animate-pulse'
                          : sessionCountdown.totalSeconds < 1800
                          ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                          : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                      }`}>
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        <span>Link expires in: <strong>{sessionCountdown.text}</strong></span>
                      </div>
                    )}
                  </div>
                )}

                {/* 1. LINE ITEM DETAILS & MANIFEST BUILDER */}
                <div className="p-4 sm:p-5 rounded-3xl bg-slate-50/70 dark:bg-slate-800/40 border-2 border-slate-200 dark:border-slate-800 space-y-4 shadow-xs">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <label className="block text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                      <Package className="w-4 h-4 text-blue-600" />
                      <span>1. Return Item Details</span>
                    </label>
                    {manifestItems.length > 0 && (
                      <span className="text-[10px] font-bold text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/60 border border-blue-200 dark:border-blue-800 px-2.5 py-0.5 rounded-full">
                        {manifestItems.length} {manifestItems.length === 1 ? 'item' : 'items'} in manifest
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsScannerOpen(true)}
                    className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm rounded-2xl flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 transition-all active:scale-[0.99] cursor-pointer"
                  >
                    <Camera className="w-5 h-5" />
                    <span>Scan with Camera / Google Lens</span>
                  </button>

                  <div className="space-y-2.5 pt-1">
                    {/* Full-width Barcode Input Field */}
                    <div className="relative w-full">
                      <Barcode className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type="text"
                        required={manifestItems.length === 0}
                        value={barcodeInput}
                        onChange={(e) => setBarcodeInput(e.target.value.replace(/[\r\n]/g, ''))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                          }
                        }}
                        placeholder={manifestItems.length > 0 ? "Scan or type another product barcode / SKU..." : "Scan or type product barcode / SKU here..."}
                        className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-2xl text-xs font-bold font-mono text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 transition-colors shadow-2xs"
                      />
                    </div>

                    {/* Quantity Stepper & Unit Selector on a spacious secondary row */}
                    <div className="flex items-center justify-between gap-3 pt-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-600 dark:text-slate-400">Qty:</span>
                        <div className="flex items-center border-2 border-slate-300 dark:border-slate-700 rounded-2xl bg-white dark:bg-slate-800 p-1 focus-within:border-blue-600 shadow-2xs">
                          <button
                            type="button"
                            onClick={() => setQuantity(Math.max(1, (parseInt(quantity, 10) || 1) - 1))}
                            className="w-10 h-10 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 font-black text-lg flex items-center justify-center cursor-pointer shadow-xs active:scale-90 transition-all"
                            title="Decrease quantity (-1)"
                          >
                            <Minus className="w-5 h-5" />
                          </button>
                          <input
                            type="number"
                            min="1"
                            max="99999"
                            value={quantity}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '') {
                                setQuantity('');
                              } else {
                                const parsed = parseInt(val, 10);
                                if (!isNaN(parsed) && parsed >= 0) {
                                  setQuantity(parsed);
                                }
                              }
                            }}
                            onBlur={() => {
                              const q = Math.max(1, parseInt(quantity, 10) || 1);
                              setQuantity(q);
                            }}
                            className="w-14 text-center text-sm font-black text-slate-900 dark:text-white bg-transparent border-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            title="Directly enter return quantity"
                          />
                          <button
                            type="button"
                            onClick={() => setQuantity(Math.max(1, (parseInt(quantity, 10) || 0) + 1))}
                            className="w-10 h-10 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 font-black text-lg flex items-center justify-center cursor-pointer shadow-xs active:scale-90 transition-all"
                            title="Increase quantity (+1)"
                          >
                            <Plus className="w-5 h-5" />
                          </button>
                        </div>
                      </div>

                      {/* Unit Dropdown Selector: pc, box, carton, case */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-600 dark:text-slate-400">Unit:</span>
                        <select
                          value={unitName}
                          onChange={(e) => setUnitName(e.target.value)}
                          className="px-3 py-2 bg-white dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-700 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 cursor-pointer shadow-2xs h-[44px]"
                          title="Select unit: pc (piece) or case"
                        >
                          <option value="pc">pc (piece)</option>
                          <option value="case">case</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Item Description / Name Input (Auto-populated if recognized, user-customizable if uncatalogued) */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                        Item Description / Name
                      </label>
                      {detectedProduct ? (
                        <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <CheckCircle className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          Auto-populated
                        </span>
                      ) : barcodeInput.trim() ? (
                        <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded-full">
                          Custom name for label & triage
                        </span>
                      ) : null}
                    </div>

                    <div className="relative w-full">
                      <Tag className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type="text"
                        value={customItemName}
                        onChange={(e) => setCustomItemName(e.target.value)}
                        placeholder={detectedProduct?.name || "e.g. Oishi Prawn Crackers 60g, MSH12 Ballpen (helps warehouse identify unlisted items)"}
                        className={`w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 transition-colors shadow-2xs ${detectedProduct
                            ? 'border-emerald-300 dark:border-emerald-800/80 bg-emerald-50/20'
                            : 'border-slate-300 dark:border-slate-700'
                          }`}
                      />
                    </div>
                  </div>

                  {/* Recognized Product Banner */}
                  {isCheckingBarcode ? (
                    <div className="p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 text-xs flex items-center gap-2 text-slate-500 dark:text-slate-400">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
                      <span>Checking database for recognized item...</span>
                    </div>
                  ) : detectedProduct ? (
                    <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 rounded-2xl flex items-center gap-3 animate-in fade-in">
                      {detectedProduct.imageUrl ? (
                        <button
                          type="button"
                          onClick={() => setLightboxPhoto({
                            images: [detectedProduct.imageUrl],
                            initialIndex: 0,
                            url: detectedProduct.imageUrl,
                            title: detectedProduct.name,
                            subtitle: `SKU: ${detectedProduct.code} • ₱${Number(detectedProduct.priceWithVat || 0).toFixed(2)}`
                          })}
                          className="w-14 h-14 rounded-xl overflow-hidden border border-emerald-400 bg-white shrink-0 cursor-zoom-in hover:opacity-85 transition-opacity"
                          title="Click to zoom recognized product photo"
                        >
                          <img src={detectedProduct.imageUrl} alt={detectedProduct.name} className="w-full h-full object-cover" />
                        </button>
                      ) : (
                        <div className="w-12 h-12 rounded-xl bg-emerald-200/70 dark:bg-emerald-800 text-emerald-800 dark:text-emerald-200 flex items-center justify-center shrink-0 font-bold">
                          <CheckCircle className="w-6 h-6" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-300 bg-emerald-200/60 dark:bg-emerald-900/60 px-2 py-0.5 rounded-full inline-block mb-0.5">
                          Recognized Product
                        </span>
                        <div className="font-bold text-slate-900 dark:text-white text-xs truncate">
                          {detectedProduct.name}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                          SKU: {detectedProduct.code} • ₱${Number(detectedProduct.priceWithVat || 0).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  ) : barcodeInput.trim() ? (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-2xl text-xs flex items-center gap-2 text-amber-800 dark:text-amber-200 animate-in fade-in">
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span>
                        Barcode not yet registered. You can enter the product name above so it appears as the Returned Item on the box label and return voucher! Admin staff will be notified to record the item details.
                      </span>
                    </div>
                  ) : null}

                  {/* Defect Reason (Dropdown), Expiry Date & Explanation */}
                  <div className="space-y-2 pt-1">
                    <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                      Defect / Return Reason *
                    </label>
                    <select
                      value={selectedReason}
                      onChange={(e) => setSelectedReason(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 shadow-2xs cursor-pointer"
                    >
                      {DEFECT_REASONS.map(reason => (
                        <option key={reason} value={reason}>{reason}</option>
                      ))}
                    </select>

                    {/* Smart Conditional Expiry Date when Expired reason is selected */}
                    {selectedReason.toLowerCase().includes('expired') && (
                      <div className="p-3 bg-amber-50/90 dark:bg-amber-950/40 border-2 border-amber-300 dark:border-amber-700/80 rounded-2xl space-y-1.5 animate-in fade-in slide-in-from-top-1">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-black text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                            <Calendar className="w-4 h-4 text-amber-600" />
                            <span>Product Expiry Date *</span>
                          </label>
                          <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-200/60 dark:bg-amber-900/60 px-2 py-0.5 rounded-full">
                            Required for Expiry Claims
                          </span>
                        </div>
                        <input
                          type="date"
                          value={expiryDate}
                          onChange={(e) => setExpiryDate(e.target.value)}
                          className="w-full px-3.5 py-2 bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                    )}

                    <div className="space-y-1 pt-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="font-bold text-slate-600 dark:text-slate-400">
                          Optional Explanation / Notes
                        </span>
                        <span className={`font-mono font-bold ${
                          explanation.length >= 250
                            ? 'text-rose-600 dark:text-rose-400'
                            : explanation.length >= 200
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-slate-400 dark:text-slate-500'
                        }`}>
                          {explanation.length}/250 chars
                        </span>
                      </div>
                      <input
                        type="text"
                        maxLength={250}
                        value={explanation}
                        onChange={(e) => setExplanation(e.target.value.slice(0, 250))}
                        placeholder="Optional details / explanation for this item (max 250 chars)..."
                        className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-2xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 shadow-2xs"
                      />
                    </div>
                  </div>

                  {/* Optional Damaged Product Photo for this line item */}
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <Camera className="w-4 h-4 text-rose-500" />
                        <span>Optional Item Photo</span>
                        <span className="text-[9px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">
                          Optional
                        </span>
                      </span>
                      <span className="text-[10px] text-slate-400 font-bold">
                        {photoFiles.length}/10 photos
                      </span>
                    </div>

                    <div className="flex items-center justify-between py-1 px-2.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-700/60">
                      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                        Capture Mode:
                      </span>
                      <div className="inline-flex p-0.5 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 shadow-2xs">
                        <button
                          type="button"
                          onClick={() => setPhotoCaptureMode('single')}
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all ${photoCaptureMode === 'single'
                              ? 'bg-rose-600 text-white shadow-xs'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                          title="Direct camera snap (solo photo)"
                        >
                          <Camera className="w-3 h-3" />
                          <span>Camera</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPhotoCaptureMode('batch')}
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all ${photoCaptureMode === 'batch'
                              ? 'bg-rose-600 text-white shadow-xs'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                          title="Select multiple photos from gallery"
                        >
                          <Upload className="w-3 h-3" />
                          <span>Gallery (Batch)</span>
                        </button>
                      </div>
                    </div>

                    {photoFiles.length === 0 ? (
                      <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-rose-300 dark:border-rose-800 hover:border-rose-500 dark:hover:border-rose-600 rounded-2xl bg-white dark:bg-slate-850 hover:bg-rose-50/50 cursor-pointer transition-all active:scale-[0.99] text-center group min-h-[100px]">
                        <Camera className="w-5 h-5 text-rose-500 mb-1 group-hover:scale-110 transition-transform" />
                        <span className="text-xs font-black text-rose-950 dark:text-rose-200">
                          Snap Photo of Item / Damage
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {photoCaptureMode === 'single' ? 'Tap to open camera' : 'Tap to select photos from gallery'} (Optional)
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          multiple={photoCaptureMode === 'batch'}
                          capture={photoCaptureMode === 'single' ? 'environment' : undefined}
                          onChange={handlePhotoSelect}
                          className="hidden"
                        />
                      </label>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {photoFiles.map((item, idx) => (
                          <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border-2 border-rose-200 dark:border-rose-800 group shadow-2xs bg-slate-100 dark:bg-slate-800">
                            <button
                              type="button"
                              onClick={() => setLightboxPhoto({
                                images: photoFiles.map(p => p.previewUrl),
                                initialIndex: idx,
                                url: item.previewUrl,
                                title: 'Damaged Product Photo',
                                subtitle: `Photo ${idx + 1} of ${photoFiles.length}`
                              })}
                              className="w-full h-full block cursor-zoom-in"
                              title="Click to view enlarged photo"
                            >
                              <img src={item.previewUrl} alt="Damaged Item" className="w-full h-full object-cover" />
                            </button>
                            <span className="absolute bottom-1 left-1 px-1 py-0.2 rounded text-[8px] font-black bg-slate-900/80 text-white shadow-xs">
                              #{idx + 1}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); removePhoto(idx); }}
                              className="absolute top-1 right-1 p-1 bg-rose-600 text-white rounded-full opacity-90 hover:opacity-100 transition-opacity z-10 cursor-pointer shadow-xs"
                              title="Remove photo"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}

                        {photoFiles.length < 10 && (
                          <label className="relative aspect-square rounded-xl border-2 border-dashed border-rose-300 dark:border-rose-700 hover:border-rose-500 bg-white dark:bg-slate-850 hover:bg-rose-50/50 flex flex-col items-center justify-center cursor-pointer transition-all active:scale-95 text-center group">
                            <Camera className="w-4 h-4 text-rose-600 dark:text-rose-400 group-hover:scale-110 transition-transform" />
                            <span className="text-[10px] font-black text-rose-700 dark:text-rose-300 mt-1">
                              + Add ({photoFiles.length}/10)
                            </span>
                            <input
                              type="file"
                              accept="image/*"
                              multiple={photoCaptureMode === 'batch'}
                              capture={photoCaptureMode === 'single' ? 'environment' : undefined}
                              onChange={handlePhotoSelect}
                              className="hidden"
                            />
                          </label>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Add Another Item to Return Button */}
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleAddManifestItem}
                      className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-2xl flex items-center justify-center gap-2 shadow-md shadow-indigo-600/25 transition-all active:scale-[0.99] cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>+ Add Another Item to Return</span>
                    </button>
                  </div>
                </div>

                {/* QUEUED RETURN MANIFEST PREVIEW */}
                {manifestItems.length > 0 && (
                  <div className="p-4 sm:p-5 rounded-3xl bg-blue-50/60 dark:bg-blue-950/25 border-2 border-blue-200 dark:border-blue-900/60 space-y-3 animate-in fade-in shadow-xs">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-blue-600 text-white rounded-lg shadow-xs">
                          <FileText className="w-4 h-4" />
                        </div>
                        <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                          Queued Return Manifest ({manifestItems.length} {manifestItems.length === 1 ? 'Item' : 'Items'})
                        </h3>
                      </div>
                      <div className="text-xs font-black text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/60 px-2.5 py-1 rounded-full border border-blue-200 dark:border-blue-800">
                        {formatManifestBreakdown(manifestItems, true)}
                      </div>
                    </div>

                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {manifestItems.map((item, idx) => (
                        <div
                          key={item.id || idx}
                          className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between gap-3 shadow-2xs hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {item.photoFiles && item.photoFiles.length > 0 ? (
                              <img
                                src={item.photoFiles[0].previewUrl}
                                alt={item.name}
                                className="w-11 h-11 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                              />
                            ) : (
                              <div className="w-11 h-11 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 shrink-0">
                                <Package className="w-5 h-5" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="font-bold text-xs text-slate-900 dark:text-white truncate">
                                {item.name}
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap mt-0.5">
                                <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded font-bold">
                                  {item.code || item.barcode}
                                </span>
                                <span className="font-black text-blue-600 dark:text-blue-400">
                                  Qty: {formatQuantityWithPackSize(item.quantity, item.unit_name || item.unit, item.pieces_per_case || item.piecesPerCase)}
                                </span>
                                <span className="bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 px-1.5 py-0.2 rounded-full font-bold">
                                  {item.reason}
                                </span>
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleRemoveManifestItem(item.id)}
                            className="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-xl transition-colors cursor-pointer shrink-0"
                            title="Remove this item from return manifest"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                      💡 All queued items will be bundled under ONE RMA Box Label & tracking number.
                    </p>
                  </div>
                )}

                {/* 2. PROOF OF PAPERWORK & COMMERCIAL DOCUMENTS */}
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <div>
                      <label className="block text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2 flex-wrap">
                        <FileText className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                        <span>2. Paperwork Proof & Commercial Documents</span>
                        <span className="text-[9px] font-bold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/70 border border-violet-200 dark:border-violet-900/60 px-2 py-0.5 rounded-full">
                          AI Auto-Detect
                        </span>
                      </label>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Snap official paperwork to auto-fill document numbers and branch, or enter manually below.
                      </p>
                    </div>
                    <span className="text-[10px] text-slate-400 font-bold self-start sm:self-auto">
                      Up to 3 photos
                    </span>
                  </div>

                  {/* Paperwork Photo Box (Zone 2) */}
                  <div className={`p-4 rounded-2xl border-2 transition-all flex flex-col justify-between space-y-3 ${paperworkShake ? 'animate-shake border-rose-500 bg-rose-50 dark:bg-rose-950/40' :
                      paperworkPhotos.length > 0
                        ? 'bg-emerald-50/30 dark:bg-slate-900 border-emerald-400 dark:border-emerald-800/80 shadow-2xs'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-violet-400 dark:hover:border-violet-700 shadow-2xs'
                    }`}>
                    <div>
                      {/* Header Row */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="p-2 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-xs shrink-0">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-xs font-black text-slate-900 dark:text-white truncate">
                              DR / Invoice / PO Paperwork
                            </h4>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                              Auto-verified by Gemini Flash AI
                            </p>
                          </div>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${paperworkPhotos.length > 0
                            ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                            : 'bg-violet-100 dark:bg-violet-950/70 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800'
                          }`}>
                          {paperworkPhotos.length > 0 ? `✓ ${paperworkPhotos.length}/3 Verified` : 'Optional / Recommended'}
                        </span>
                      </div>

                      {/* Mode Toggle Bar */}
                      <div className="flex items-center justify-between py-1 px-2.5 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200/80 dark:border-slate-700/60 mb-2.5">
                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                          Capture Mode:
                        </span>
                        <div className="inline-flex p-0.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 shadow-2xs">
                          <button
                            type="button"
                            onClick={() => setPaperworkCaptureMode('single')}
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all ${paperworkCaptureMode === 'single'
                                ? 'bg-violet-600 text-white shadow-xs'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                              }`}
                            title="Direct camera snap (solo photo)"
                          >
                            <Camera className="w-3 h-3" />
                            <span>Camera</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setPaperworkCaptureMode('batch')}
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all ${paperworkCaptureMode === 'batch'
                                ? 'bg-violet-600 text-white shadow-xs'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                              }`}
                            title="Select multiple photos from gallery"
                          >
                            <Upload className="w-3 h-3" />
                            <span>Gallery (Batch)</span>
                          </button>
                        </div>
                      </div>

                      {/* Inspecting Radar State */}
                      {isInspectingPaperwork && (
                        <div className="py-5 px-3 border border-violet-300 dark:border-violet-700 bg-violet-50/90 dark:bg-violet-950/60 rounded-2xl flex flex-col items-center justify-center gap-2.5 text-center min-h-[140px] shadow-2xs">
                          <div className="flex items-center gap-2">
                            <RefreshCw className="w-5 h-5 animate-spin text-violet-600 dark:text-violet-400 shrink-0" />
                            <span className="text-xs font-black text-violet-950 dark:text-violet-200">
                              Inspecting paperwork {paperworkInspectionProgress?.current || 1} of {paperworkInspectionProgress?.total || 1}...
                            </span>
                          </div>
                          <div className="w-44 h-1.5 bg-violet-200 dark:bg-violet-900/60 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-violet-600 dark:bg-violet-400 transition-all duration-300"
                              style={{
                                width: `${Math.round(((paperworkInspectionProgress?.current || 1) / (paperworkInspectionProgress?.total || 1)) * 100)}%`
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-violet-700 dark:text-violet-300">
                            Verifying authentic DR / SI / PO and auto-detecting numbers
                          </span>
                          <button
                            type="button"
                            onClick={cancelPaperworkInspection}
                            className="mt-1 px-3 py-1 bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 border border-rose-300 dark:border-rose-700 hover:bg-rose-50 rounded-lg text-xs font-bold cursor-pointer transition-all shadow-xs flex items-center gap-1 active:scale-95"
                            title="Cancel paperwork inspection"
                          >
                            <X className="w-3.5 h-3.5" />
                            <span>Cancel Inspection</span>
                          </button>
                        </div>
                      )}

                      {/* Photos Grid & Upload Action (when not inspecting) */}
                      {!isInspectingPaperwork && (paperworkPhotos.length === 0 ? (
                        <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-violet-300 dark:border-violet-800 hover:border-violet-500 dark:hover:border-violet-600 rounded-2xl bg-violet-50/40 dark:bg-violet-950/30 hover:bg-violet-50/70 cursor-pointer transition-all active:scale-[0.99] text-center group min-h-[140px]">
                          <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-300 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform shadow-xs">
                            <FileText className="w-5 h-5" />
                          </div>
                          <span className="text-xs font-black text-violet-950 dark:text-violet-200">
                            Snap Photo of DR / Invoice / PO
                          </span>
                          <span className="text-[10px] text-violet-700/90 dark:text-violet-400 mt-0.5">
                            {paperworkCaptureMode === 'single' ? 'Tap to open camera' : 'Tap to select paperwork from gallery'}
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            multiple={paperworkCaptureMode === 'batch'}
                            capture={paperworkCaptureMode === 'single' ? 'environment' : undefined}
                            onChange={handlePaperworkSelect}
                            className="hidden"
                          />
                        </label>
                      ) : (
                        <div className="space-y-2">
                          <div className="grid grid-cols-3 gap-2">
                            {paperworkPhotos.map((item, idx) => (
                              <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border-2 border-emerald-400 dark:border-emerald-700 group shadow-2xs bg-slate-100 dark:bg-slate-800">
                                <button
                                  type="button"
                                  onClick={() => setLightboxPhoto({
                                    images: paperworkPhotos.map(p => p.previewUrl),
                                    initialIndex: idx,
                                    url: item.previewUrl,
                                    title: item.metadata?.document_type || 'Official Paperwork',
                                    subtitle: `Photo ${idx + 1} of ${paperworkPhotos.length} • ${item.metadata?.invoice_dr_number || ''}`
                                  })}
                                  className="w-full h-full block cursor-zoom-in"
                                  title="Click to view enlarged document"
                                >
                                  <img src={item.previewUrl} alt="Paperwork" className="w-full h-full object-cover" />
                                </button>
                                <span className="absolute bottom-1 left-1 px-1 py-0.2 rounded text-[8px] font-black bg-emerald-600 text-white shadow-xs">
                                  ✓ P{idx + 1}
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); removePaperworkPhoto(idx); }}
                                  className="absolute top-1 right-1 p-1 bg-rose-600 text-white rounded-full opacity-90 hover:opacity-100 transition-opacity z-10 cursor-pointer shadow-xs"
                                  title="Remove paperwork photo"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ))}

                            {paperworkPhotos.length < 3 && (
                              <label className="relative aspect-square rounded-xl border-2 border-dashed border-violet-300 dark:border-violet-700 hover:border-violet-500 bg-violet-50/50 dark:bg-violet-950/30 hover:bg-violet-100/60 flex flex-col items-center justify-center cursor-pointer transition-all active:scale-95 text-center group">
                                <FileText className="w-4 h-4 text-violet-600 dark:text-violet-400 group-hover:scale-110 transition-transform" />
                                <span className="text-[10px] font-black text-violet-700 dark:text-violet-300 mt-1">
                                  + Add ({paperworkPhotos.length}/3)
                                </span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  multiple={paperworkCaptureMode === 'batch'}
                                  capture={paperworkCaptureMode === 'single' ? 'environment' : undefined}
                                  onChange={handlePaperworkSelect}
                                  className="hidden"
                                />
                              </label>
                            )}
                          </div>

                          {paperworkMetadata && (
                            <div className="p-2 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700 rounded-xl text-xs flex items-center justify-between gap-2">
                              <span className="text-[10px] sm:text-[11px] font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5 truncate">
                                <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                <span>Verified {paperworkMetadata.document_type || 'Commercial Document'} ({paperworkPhotos.length}/3 attached)</span>
                              </span>
                            </div>
                          )}
                        </div>
                      ))}

                      {paperworkError && (
                        <div className="mt-2 p-2.5 bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 rounded-xl text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2 animate-in fade-in">
                          <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                          <div className="text-[11px] leading-tight">
                            <strong className="font-bold">Paperwork rejected:</strong> {paperworkError}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Commercial Document Numbers (SI#, DR#, PO#) */}
                  <div className="space-y-2 pt-1">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5 flex-wrap">
                        <span>Commercial Document Numbers</span>
                        <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-full lowercase first-letter:uppercase">
                          (Optional / Recommended)
                        </span>
                      </label>
                      {(siNumber || drNumber || poNumber) && (
                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          Auto-populated by AI OCR
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Snap official paperwork above to auto-detect, or enter manually below (Optional / Recommended).
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      {/* Sales Invoice (SI) # */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                            Sales Invoice (SI) #
                          </span>
                          {siNumber && <span className="text-[9px] text-emerald-600 font-bold">✓ Detected</span>}
                        </div>
                        <input
                          type="text"
                          value={siNumber}
                          onChange={(e) => setSiNumber(e.target.value)}
                          placeholder="e.g., SI-2026-9021"
                          className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500 shadow-2xs"
                        />
                      </div>

                      {/* Delivery Receipt (DR) # */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                            Delivery Receipt (DR) #
                          </span>
                          {drNumber && <span className="text-[9px] text-emerald-600 font-bold">✓ Detected</span>}
                        </div>
                        <input
                          type="text"
                          value={drNumber}
                          onChange={(e) => setDrNumber(e.target.value)}
                          placeholder="e.g., DR-2026-8812"
                          className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500 shadow-2xs"
                        />
                      </div>

                      {/* Purchase Order (PO) # */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                            Purchase Order (PO) #
                          </span>
                          {poNumber && <span className="text-[9px] text-emerald-600 font-bold">✓ Detected</span>}
                        </div>
                        <input
                          type="text"
                          value={poNumber}
                          onChange={(e) => setPoNumber(e.target.value)}
                          placeholder="e.g., PO-2026-4401"
                          className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500 shadow-2xs"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. STORE / BRANCH OR SUPPLIER LOCATION (OPTIONAL) */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <Building className="w-4 h-4 text-blue-600" />
                      <span>
                        {gateSession?.stream_type === 'supplier_outbound'
                          ? '3. Master Supplier / Vendor Name (Optional)'
                          : '3. Store / Branch / Supplier Location (Optional)'}
                      </span>
                    </label>
                    {inviteService.normalizeEntityName(gateSession?.entity_name || gateSession?.store_branch) ? (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${gateSession?.stream_type === 'supplier_outbound'
                          ? 'text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 border-purple-200 dark:border-purple-800'
                          : 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800'
                        }`}>
                        <CheckCircle className="w-3 h-3" />
                        <span>Auto-Populated via {gateSession?.stream_type === 'supplier_outbound' ? 'Supplier RTV' : 'Customer'} Invite</span>
                      </span>
                    ) : storeBranch && paperworkMetadata?.store_branch ? (
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        Auto-filled from Paperwork
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                        Optional
                      </span>
                    )}
                  </div>

                  <div className="relative">
                    <input
                      type="text"
                      value={storeBranch}
                      onChange={(e) => setStoreBranch(e.target.value)}
                      placeholder={
                        gateSession?.stream_type === 'supplier_outbound'
                          ? 'Optional: e.g., Walter Mart, Liwayway Marketing, Mondelez'
                          : 'Optional: e.g., Walter Mart, Savemore Taguig, Puregold Cubao (or auto-filled)'
                      }
                      className="w-full px-3.5 py-3 border-2 rounded-2xl text-xs font-bold text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none shadow-2xs transition-all bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20"
                    />
                    {storeBranch && (
                      <button
                        type="button"
                        onClick={() => setStoreBranch('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-full cursor-pointer"
                        title="Clear location / supplier"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    {gateSession?.stream_type === 'supplier_outbound'
                      ? 'Optional: Auto-populated from your invite link or catalog item if specified.'
                      : 'Optional: Auto-populated if specified in your invite link or detected from paperwork.'}
                  </p>
                </div>

                {/* 4. REPORTER CONTACT INFORMATION */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <User className="w-4 h-4 text-blue-600" />
                      <span>4. Reporter Information (Required) *</span>
                    </label>
                    {(reporterName || reporterContact) && (
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        Saved on this device
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="relative">
                      <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type="text"
                        required
                        value={reporterName}
                        onChange={(e) => setReporterName(e.target.value)}
                        placeholder="Your Full Name *"
                        className="w-full pl-10 pr-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 shadow-2xs"
                      />
                    </div>
                    <div className="relative">
                      <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type="text"
                        required
                        value={gateSession?.authorized_email || reporterContact}
                        onChange={(e) => {
                          if (!gateSession?.authorized_email) {
                            setReporterContact(e.target.value);
                          }
                        }}
                        readOnly={Boolean(gateSession?.authorized_email)}
                        placeholder="Phone No. or Email *"
                        className={`w-full pl-10 pr-3.5 py-2.5 border rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none shadow-2xs ${gateSession?.authorized_email
                            ? 'bg-emerald-50/50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 cursor-not-allowed text-emerald-950 dark:text-emerald-200'
                            : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 focus:border-blue-600'
                          }`}
                      />
                      {gateSession?.authorized_email && (
                        <div className="mt-1 flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                          <span>✓ Verified Google Identity ({gateSession.authorized_email})</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Submit Action Button */}
                <button
                  type="submit"
                  disabled={isSubmitting || (manifestItems.length === 0 && !barcodeInput.trim())}
                  className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-black text-sm rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 transition-all active:scale-[0.99] cursor-pointer"
                >
                  {isSubmitting ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                  <span>
                    {isSubmitting
                      ? 'Uploading Proof & Saving...'
                      : manifestItems.length > 0
                        ? `Submit Return Manifest (${manifestItems.length + (barcodeInput.trim() ? 1 : 0)} Items)`
                        : 'Submit Return Report'}
                  </span>
                </button>


                {/* Footer Switch to Admin */}
                <div className="text-center pt-2">

                </div>
              </form>
            )}

          </div>
        )}

        {/* ================================================================= */}
        {/* 2. STAFF ADMIN PORTAL (Accessible at '/admin' with OTP Auth)      */}
        {/* ================================================================= */}
        {isAdminView && currentUser && (
          <div className="space-y-5 animate-in fade-in duration-200">

            {/* Production-Level SaaS Header */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 w-full min-w-0 box-border">
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                    <span>🏢 Pingcon RMA Operations</span>
                  </h1>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Live Auto-Sync
                  </span>
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800 shrink-0">
                    {currentUser?.role === 'super_admin' ? '👑 Super Admin' : (currentUser?.role || 'Staff')}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  Logged in as <strong className="text-slate-800 dark:text-slate-200">{currentUser?.name || 'Authorized Staff'}</strong> • {currentUser?.email || 'Portal Access'}
                </p>
              </div>

              <div className="flex items-center gap-2 self-start md:self-auto flex-wrap w-full md:w-auto justify-start md:justify-end min-w-0">
                {/* NOTIFICATION BELL */}
                <NotificationBell
                  notifications={notifications}
                  onMarkAsRead={handleMarkAsRead}
                  onMarkAllAsRead={handleMarkAllAsRead}
                  onClearAll={handleClearAllNotifications}
                  onSelectNotification={handleSelectNotification}
                />

                <button
                  type="button"
                  onClick={toggleTheme}
                  className="p-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center justify-center transition-colors shadow-sm"
                  title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                  aria-label="Toggle Theme"
                >
                  {isDarkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
                </button>

                <button
                  type="button"
                  onClick={() => setIsCustomerInvitesModalOpen(true)}
                  className="px-3.5 py-2 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
                  title="Generate & Manage Google Identity Locked RMA Return Links (Warehouse or Customer)"
                >
                  <Ticket className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>🎫 Generate RMA Invites</span>
                </button>

                <button
                  type="button"
                  onClick={() => navigateTo('/')}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  <ArrowRight className="w-3.5 h-3.5 rotate-180" />
                  <span>Public Reporter</span>
                </button>

                <button
                  type="button"
                  onClick={handleLogout}
                  className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Logout</span>
                </button>
              </div>
            </div>

            {/* SaaS KPI Overview Strip: Enterprise Logistics 6-column Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3.5">
              {/* Metric 1: Saved Products */}
              <div
                onClick={() => setAdminActiveTab('products')}
                className={`bg-white dark:bg-slate-900 border rounded-3xl p-3.5 sm:p-5 shadow-sm cursor-pointer transition-all hover:shadow-md ${adminActiveTab === 'products' ? 'border-indigo-500 ring-2 ring-indigo-100 dark:ring-indigo-900/40' : 'border-slate-200 dark:border-slate-800'
                  }`}
              >
                <div className="flex items-center justify-between text-indigo-600 dark:text-indigo-400 mb-1.5 sm:mb-2">
                  <Package className="w-5 h-5 shrink-0" />
                  <span className="text-[9px] sm:text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">Catalog</span>
                </div>
                <div className="text-xl sm:text-3xl font-black text-slate-900 dark:text-white font-mono">
                  {savedProductsList.length}
                </div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">Saved Products</div>
                <div className="text-[10px] sm:text-[11px] text-slate-400 dark:text-slate-500 truncate">Catalog items</div>
              </div>

              {/* Metric 2: Customer Returns (Inbound Logistics) */}
              <div
                onClick={() => setAdminActiveTab('customer_reports')}
                className={`bg-white dark:bg-slate-900 border rounded-3xl p-3.5 sm:p-5 shadow-sm cursor-pointer transition-all hover:shadow-md ${(adminActiveTab === 'customer_reports' || adminActiveTab === 'reports') ? 'border-blue-500 ring-2 ring-blue-100 dark:ring-blue-900/40' : 'border-slate-200 dark:border-slate-800'
                  }`}
              >
                <div className="flex items-center justify-between text-blue-600 dark:text-blue-400 mb-1.5 sm:mb-2">
                  <FileText className="w-5 h-5 shrink-0" />
                  <span className="text-[9px] sm:text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300">Inbound</span>
                </div>
                <div className="text-xl sm:text-3xl font-black text-slate-900 dark:text-white font-mono">
                  {customerInboundReports.length}
                </div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">Customer Inbound</div>
                <div className="text-[10px] sm:text-[11px] text-slate-400 dark:text-slate-500 truncate">
                  {customerInboundReports.filter(r => !creditMemosList.some(m => m.rma_number === r.rma_number || m.report_id === r.id)).length} pending credit
                </div>
              </div>

              {/* Metric 3: Supplier RTVs (Outbound Logistics) */}
              <div
                onClick={() => setAdminActiveTab('supplier_claims')}
                className={`bg-white dark:bg-slate-900 border rounded-3xl p-3.5 sm:p-5 shadow-sm cursor-pointer transition-all hover:shadow-md ${adminActiveTab === 'supplier_claims' ? 'border-purple-500 ring-2 ring-purple-100 dark:ring-purple-900/40' : 'border-slate-200 dark:border-slate-800'
                  }`}
              >
                <div className="flex items-center justify-between text-purple-600 dark:text-purple-400 mb-1.5 sm:mb-2">
                  <Building2 className="w-5 h-5 shrink-0" />
                  <span className="text-[9px] sm:text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">Outbound</span>
                </div>
                <div className="text-xl sm:text-3xl font-black text-slate-900 dark:text-white font-mono">
                  {supplierOutboundReports.length}
                </div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">Supplier RTVs</div>
                <div className="text-[10px] sm:text-[11px] text-slate-400 dark:text-slate-500 truncate">Vendor claims queued</div>
              </div>

              {/* Metric 4: Credit Memos (Finance Section) */}
              <div
                onClick={() => setAdminActiveTab('credit_memos')}
                className={`bg-white dark:bg-slate-900 border rounded-3xl p-3.5 sm:p-5 shadow-sm cursor-pointer transition-all hover:shadow-md ${adminActiveTab === 'credit_memos' ? 'border-emerald-500 ring-2 ring-emerald-100 dark:ring-emerald-900/40' : 'border-slate-200 dark:border-slate-800'
                  }`}
              >
                <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400 mb-1.5 sm:mb-2">
                  <Receipt className="w-5 h-5 shrink-0" />
                  <span className="text-[9px] sm:text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">Finance</span>
                </div>
                <div className="text-xl sm:text-3xl font-black text-slate-900 dark:text-white font-mono">
                  {creditMemosList.length}
                </div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">Credit Memos</div>
                <div className="text-[10px] sm:text-[11px] text-slate-400 dark:text-slate-500 truncate">
                  {creditMemosList.length > 0
                    ? `₱${creditMemosList.reduce((acc, m) => acc + Number(m.credit_amount || m.amount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} credited`
                    : 'Customer deductions'}
                </div>
              </div>

              {/* Metric 5: Awaiting SKU */}
              <div
                onClick={() => {
                  setAdminActiveTab('customer_reports');
                  setReportsStatusFilter('pending_admin_details');
                  setReportsCurrentPage(1);
                }}
                className={`bg-white dark:bg-slate-900 border rounded-3xl p-3.5 sm:p-5 shadow-sm cursor-pointer transition-all hover:shadow-md ${pendingBarcodesList.length > 0 ? 'border-amber-400 bg-amber-50/20 dark:bg-amber-950/20' : 'border-slate-200 dark:border-slate-800'
                  }`}
              >
                <div className="flex items-center justify-between text-amber-600 dark:text-amber-400 mb-1.5 sm:mb-2">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  <span className="text-[9px] sm:text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">Action</span>
                </div>
                <div className="text-xl sm:text-3xl font-black text-slate-900 dark:text-white font-mono">
                  {pendingBarcodesList.length}
                </div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">Awaiting SKU</div>
                <div className="text-[10px] sm:text-[11px] text-slate-400 dark:text-slate-500 truncate">Needs SKU assignment</div>
              </div>

              {/* Metric 6: Staff Directory */}
              <div
                onClick={() => {
                  if (currentUser?.role === 'super_admin') setIsEmployeeModalOpen(true);
                }}
                className={`col-span-2 sm:col-span-1 bg-white dark:bg-slate-900 border rounded-3xl p-3.5 sm:p-5 shadow-sm ${currentUser?.role === 'super_admin' ? 'cursor-pointer hover:shadow-md hover:border-purple-300 dark:hover:border-purple-700' : ''
                  } border-slate-200 dark:border-slate-800`}
              >
                <div className="flex items-center justify-between text-purple-600 dark:text-purple-400 mb-1.5 sm:mb-2">
                  <Users className="w-5 h-5 shrink-0" />
                  <span className="text-[9px] sm:text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">Team</span>
                </div>
                <div className="text-xl sm:text-3xl font-black text-slate-900 dark:text-white font-mono">
                  {staffList.length || 25}
                </div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">Staff Directory</div>
                <div className="text-[10px] sm:text-[11px] text-slate-400 dark:text-slate-500 truncate">Company staff</div>
              </div>
            </div>

            {/* Production-Level Tab Segmented Switcher: Horizontally scrollable on mobile, wrapping on desktop */}
            <div className="flex items-center gap-1.5 sm:gap-2 bg-slate-200/70 dark:bg-slate-800/80 p-1.5 rounded-2xl overflow-x-auto no-scrollbar sm:flex-wrap">
              {/* Tab 1: Saved Products */}
              <button
                type="button"
                onClick={() => setAdminActiveTab('products')}
                className={`touch-target px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap shrink-0 ${adminActiveTab === 'products'
                  ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
              >
                <Package className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <span>Saved Products ({savedProductsList.length})</span>
              </button>

              {/* Tab 2: Customer RMA Hub (Inbound) */}
              <button
                type="button"
                onClick={() => setAdminActiveTab('customer_reports')}
                className={`touch-target px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap shrink-0 ${(adminActiveTab === 'customer_reports' || adminActiveTab === 'reports')
                  ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
              >
                <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                <span>Customer RMA Hub ({customerInboundReports.length})</span>
              </button>

              {/* Tab 3: Supplier Hub (RTV Claims) */}
              <button
                type="button"
                onClick={() => setAdminActiveTab('supplier_claims')}
                className={`touch-target px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap shrink-0 ${adminActiveTab === 'supplier_claims'
                  ? 'bg-white dark:bg-slate-900 text-purple-700 dark:text-purple-300 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
              >
                <Building2 className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
                <span>Supplier Hub (RTV Claims) ({supplierOutboundReports.length})</span>
              </button>

              {/* Tab 4: Credit Memos */}
              <button
                type="button"
                onClick={() => setAdminActiveTab('credit_memos')}
                className={`touch-target px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap shrink-0 ${adminActiveTab === 'credit_memos'
                  ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
              >
                <Receipt className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Credit Memos ({creditMemosList.length})</span>
              </button>

              {/* Tab 5: Settings & SMTP (Super Admin Only) */}
              {currentUser?.role === 'super_admin' && (
                <button
                  type="button"
                  onClick={() => setAdminActiveTab('settings')}
                  className={`touch-target px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap shrink-0 ${adminActiveTab === 'settings'
                    ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                >
                  <Settings className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>Settings & SMTP</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setAdminActiveTab('customer_reports');
                  setReportsStatusFilter('pending_admin_details');
                  setReportsCurrentPage(1);
                }}
                className="touch-target px-3.5 py-2 rounded-xl text-xs font-bold text-amber-800 dark:text-amber-400 hover:bg-amber-100/60 dark:hover:bg-amber-950/40 flex items-center gap-1.5 sm:ml-auto transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>Awaiting SKU ({pendingBarcodesList.length})</span>
              </button>

              {currentUser?.role === 'super_admin' && (
                <button
                  type="button"
                  onClick={() => setIsEmployeeModalOpen(true)}
                  className="touch-target px-3.5 py-2 rounded-xl text-xs font-bold text-purple-800 dark:text-purple-400 hover:bg-purple-100/60 dark:hover:bg-purple-950/40 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Users className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                  <span>Roles & Access</span>
                </button>
              )}
            </div>

            {/* TAB 1: SAVED PRODUCTS CATALOG DASHBOARD */}
            {adminActiveTab === 'products' && (
              <SavedProductsTab
                products={savedProductsList}
                isLoading={isSavedProductsLoading}
                onAddProduct={() => {
                  setEditingProduct(null);
                  setIsProductEditOpen(true);
                }}
                onEditProduct={(prod) => {
                  setEditingProduct(prod);
                  setIsProductEditOpen(true);
                }}
                onDeleteProduct={requestDeleteProduct}
                onBulkDeleteProduct={requestBulkDeleteProducts}
                currentUser={currentUser}
              />
            )}

            {/* COWORKER INVENTORY & PROCUREMENT WORKSTATION QUICK-ACTION VIEW FILTERS */}
            {(adminActiveTab === 'customer_reports' || adminActiveTab === 'reports' || adminActiveTab === 'supplier_claims') && (
              <div className="bg-slate-900 dark:bg-slate-950 border border-slate-800 rounded-2xl p-3 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-black uppercase tracking-wider shrink-0">
                    WMS / ERP Sync
                  </span>
                  <div className="min-w-0">
                    <h4 className="text-xs font-black text-white tracking-tight">
                      Coworker Inventory & Procurement Queues
                    </h4>
                    <p className="text-[11px] text-slate-400 truncate">
                      Live workstation queues for Warehouse WMS restocking and Purchasing supplier re-orders.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (coworkerQueueFilter === 'restock' && (adminActiveTab === 'customer_reports' || adminActiveTab === 'reports')) {
                        setCoworkerQueueFilter('all');
                      } else {
                        setCoworkerQueueFilter('restock');
                        setReportsDispositionFilter('all');
                        setReportsStatusFilter('all');
                        setReportsCurrentPage(1);
                        if (adminActiveTab === 'supplier_claims') {
                          setAdminActiveTab('customer_reports');
                        }
                      }
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer border ${
                      coworkerQueueFilter === 'restock' && (adminActiveTab === 'customer_reports' || adminActiveTab === 'reports')
                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm ring-2 ring-emerald-400/40'
                        : 'bg-slate-800 hover:bg-slate-700 text-emerald-300 border-emerald-500/40'
                    }`}
                    title="Filter table to items triaged as Restock to Inventory whose status is not yet restocked"
                  >
                    <span>📦 Ready to Restock ({readyToRestockReports.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (coworkerQueueFilter === 'scrap' && (adminActiveTab === 'customer_reports' || adminActiveTab === 'reports')) {
                        setCoworkerQueueFilter('all');
                      } else {
                        setCoworkerQueueFilter('scrap');
                        setReportsDispositionFilter('all');
                        setReportsStatusFilter('all');
                        setReportsCurrentPage(1);
                        if (adminActiveTab === 'supplier_claims') {
                          setAdminActiveTab('customer_reports');
                        }
                      }
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer border ${
                      coworkerQueueFilter === 'scrap' && (adminActiveTab === 'customer_reports' || adminActiveTab === 'reports')
                        ? 'bg-amber-600 text-white border-amber-500 shadow-sm ring-2 ring-amber-400/40'
                        : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-amber-500/40'
                    }`}
                    title="Filter table to items triaged as Scrap / Dispose whose status is not yet scrapped"
                  >
                    <span>🔄 Supplier Re-Order ({supplierReorderReports.length})</span>
                  </button>

                  {coworkerQueueFilter !== 'all' && (
                    <button
                      type="button"
                      onClick={() => setCoworkerQueueFilter('all')}
                      className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors cursor-pointer"
                    >
                      Clear Queue Filter
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: CUSTOMER RMA HUB (INBOUND LOGISTICS) */}
            {(adminActiveTab === 'customer_reports' || adminActiveTab === 'reports') && (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-6 shadow-sm space-y-4 w-full min-w-0 box-border">
                {/* Header & Responsive Action Toolbar */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 w-full min-w-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-black text-slate-900 dark:text-white tracking-tight">
                        Customer RMA Hub (Inbound Logistics)
                      </h3>
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800 shrink-0">
                        {processedReports.length} Returns Active
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      Store & branch merchandise returns, billing document matching, and customer credit memo vouchers.
                    </p>
                  </div>

                  {/* Responsive Action Toolbar */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 w-full lg:w-auto min-w-0">
                    {/* View Switcher: Rows vs Cards */}
                    <div className="flex items-center self-start sm:self-auto bg-slate-100 dark:bg-slate-800 p-0.5 sm:p-1 rounded-xl sm:rounded-2xl border border-slate-200/80 dark:border-slate-700 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleSetReportsViewMode('table')}
                        className={`px-3 py-1.5 rounded-lg sm:rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer ${reportsViewMode === 'table'
                          ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                          }`}
                        title="Rows / Table View"
                      >
                        <List className="w-3.5 h-3.5 shrink-0" />
                        <span>Rows List</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetReportsViewMode('grid')}
                        className={`px-3 py-1.5 rounded-lg sm:rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer ${reportsViewMode === 'grid'
                          ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                          }`}
                        title="Grid / Cards View"
                      >
                        <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
                        <span>Cards</span>
                      </button>
                    </div>

                    {/* Action Buttons: 2-column grid on mobile (< sm), flex on sm+ */}
                    <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto min-w-0">
                      <button
                        type="button"
                        onClick={() => setIsReportsModalOpen(true)}
                        className="w-full sm:w-auto justify-center px-3 py-2 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                        title="Open Full Audit Log"
                      >
                        <FileText className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">Full Audit Log</span>
                        <ChevronRight className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
                      </button>

                      <button
                        type="button"
                        onClick={() => exportCustomerInboundRMAsToCSV(processedReports)}
                        className="w-full sm:w-auto justify-center px-3 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-extrabold rounded-xl text-xs flex items-center gap-1.5 transition-colors shrink-0 shadow-2xs cursor-pointer"
                        title="Export Customer Inbound RMAs to CSV with Store Branch, Customer Name, DR#, AE Name, and Credit Memo #"
                      >
                        <Download className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">Export Inbound CSV</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Filter / Search & Sort Controls Toolbar */}
                <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-3 sm:p-3.5 space-y-2.5 w-full min-w-0 box-border">
                  {/* Top Queue Filter Strip (Subject 2.1) */}
                  <div className="flex flex-wrap items-center gap-1.5 pb-2.5 border-b border-slate-200 dark:border-slate-700/80">
                    <button
                      type="button"
                      onClick={() => {
                        setCoworkerQueueFilter('all');
                        setReportsCurrentPage(1);
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                        coworkerQueueFilter === 'all'
                          ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs'
                          : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      All ({customerInboundReports.length})
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setCoworkerQueueFilter(coworkerQueueFilter === 'restock' ? 'all' : 'restock');
                        setReportsCurrentPage(1);
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer border ${
                        coworkerQueueFilter === 'restock'
                          ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm ring-2 ring-emerald-400/40'
                          : 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-50'
                      }`}
                    >
                      <span>🟢 Ready to Restock ({readyToRestockReports.length})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setCoworkerQueueFilter(coworkerQueueFilter === 'rtv' ? 'all' : 'rtv');
                        setReportsCurrentPage(1);
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer border ${
                        coworkerQueueFilter === 'rtv'
                          ? 'bg-purple-600 text-white border-purple-500 shadow-sm ring-2 ring-purple-400/40'
                          : 'bg-white dark:bg-slate-900 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-800 hover:bg-purple-50'
                      }`}
                    >
                      <span>🟣 Vendor RTV ({vendorRtvReports.length})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setCoworkerQueueFilter((coworkerQueueFilter === 'reorder' || coworkerQueueFilter === 'scrap') ? 'all' : 'reorder');
                        setReportsCurrentPage(1);
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer border ${
                        coworkerQueueFilter === 'reorder' || coworkerQueueFilter === 'scrap'
                          ? 'bg-rose-600 text-white border-rose-500 shadow-sm ring-2 ring-rose-400/40'
                          : 'bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800 hover:bg-rose-50'
                      }`}
                    >
                      <span>🔴 Re-order Needed ({supplierReorderReports.length})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setCoworkerQueueFilter(coworkerQueueFilter === 'hold' ? 'all' : 'hold');
                        setReportsCurrentPage(1);
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer border ${
                        coworkerQueueFilter === 'hold'
                          ? 'bg-amber-500 text-white border-amber-500 shadow-sm ring-2 ring-amber-400/40'
                          : 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800 hover:bg-amber-50'
                      }`}
                    >
                      <span>🟡 On Hold ({onHoldReports.length})</span>
                    </button>

                    {coworkerQueueFilter !== 'all' && (
                      <button
                        type="button"
                        onClick={() => {
                          setCoworkerQueueFilter('all');
                          setReportsCurrentPage(1);
                        }}
                        className="px-2.5 py-1 text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline cursor-pointer"
                      >
                        Reset Queue
                      </button>
                    )}
                  </div>

                  {/* Search Input: Full width row */}
                  <div className="relative w-full min-w-0">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 shrink-0" />
                    <input
                      type="text"
                      value={reportsSearchQuery}
                      onChange={(e) => {
                        setReportsSearchQuery(e.target.value);
                        setReportsCurrentPage(1);
                      }}
                      placeholder="Search by SN (#), RMA #, barcode, item name, reporter, or bin location..."
                      className="w-full min-w-0 pl-10 pr-9 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-blue-600 transition-all box-border"
                    />
                    {reportsSearchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setReportsSearchQuery('');
                          setReportsCurrentPage(1);
                        }}
                        className="absolute right-3 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Dropdown Filters & Date Pickers in responsive grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2 w-full min-w-0">
                    {/* Reason Filter Dropdown */}
                    <select
                      value={reportsReasonFilter}
                      onChange={(e) => {
                        setReportsReasonFilter(e.target.value);
                        setReportsCurrentPage(1);
                      }}
                      className="w-full min-w-0 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-600 cursor-pointer truncate box-border"
                    >
                      <option value="all">All Reasons</option>
                      {DEFECT_REASONS.map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>

                    {/* Condition Grade Filter Dropdown */}
                    <select
                      value={reportsConditionGradeFilter}
                      onChange={(e) => {
                        setReportsConditionGradeFilter(e.target.value);
                        setReportsCurrentPage(1);
                      }}
                      className="w-full min-w-0 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-600 cursor-pointer truncate box-border"
                    >
                      <option value="all">All Grades</option>
                      <option value="A">Grade A - Like New</option>
                      <option value="B">Grade B - Damaged Pkg</option>
                      <option value="C">Grade C - Defective / Parts</option>
                      <option value="D">Grade D - Total Loss / Scrap</option>
                    </select>

                    {/* Status Filter Dropdown */}
                    <select
                      value={reportsStatusFilter}
                      onChange={(e) => {
                        setReportsStatusFilter(e.target.value);
                        setReportsCurrentPage(1);
                      }}
                      className="w-full min-w-0 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-600 cursor-pointer truncate box-border"
                    >
                      <option value="all">All Status &amp; Stages</option>
                      <option value="pending_admin_details">Awaiting SKU</option>
                      <option value="draft">1- Draft / Intake</option>
                      <option value="received_at_dock">2- Received at Dock</option>
                      <option value="under_inspection">3- Under Inspection</option>
                      <option value="pending_finance_approval">4- Pending Finance Approval</option>
                      <option value="credit_memo_issued">5- Credit Memo Issued</option>
                      <option value="restocked">6- Restocked</option>
                      <option value="scrapped">7- Scrapped / Disposed</option>
                      <option value="buffer_replacement_dispatched">🚚 Buffer Replacement Dispatched</option>
                      <option value="rejected">8- Rejected / Invalid Claim</option>
                    </select>

                    {/* Date Range Picker: Neatly split in 2 columns */}
                    <div className="grid grid-cols-2 gap-1.5 w-full min-w-0 col-span-1 sm:col-span-2 md:col-span-1 lg:col-span-1">
                      <div className="flex items-center gap-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-2 py-1.5 rounded-xl text-xs min-w-0 box-border">
                        <span className="text-[9px] font-bold text-slate-400 uppercase shrink-0">From</span>
                        <input
                          type="date"
                          value={reportsDateFrom}
                          onChange={(e) => {
                            setReportsDateFrom(e.target.value);
                            setReportsCurrentPage(1);
                          }}
                          className="bg-transparent text-slate-900 dark:text-white font-mono text-[11px] focus:outline-none cursor-pointer w-full min-w-0"
                          title="Filter records from date"
                        />
                      </div>
                      <div className="flex items-center gap-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-2 py-1.5 rounded-xl text-xs min-w-0 box-border">
                        <span className="text-[9px] font-bold text-slate-400 uppercase shrink-0">To</span>
                        <input
                          type="date"
                          value={reportsDateTo}
                          onChange={(e) => {
                            setReportsDateTo(e.target.value);
                            setReportsCurrentPage(1);
                          }}
                          className="bg-transparent text-slate-900 dark:text-white font-mono text-[11px] focus:outline-none cursor-pointer w-full min-w-0"
                          title="Filter records to date"
                        />
                      </div>
                    </div>

                    {/* Reset Filters */}
                    {(reportsSearchQuery || reportsReasonFilter !== 'all' || reportsStatusFilter !== 'all' || reportsDispositionFilter !== 'all' || reportsConditionGradeFilter !== 'all' || coworkerQueueFilter !== 'all' || reportsDateFrom || reportsDateTo) && (
                      <button
                        type="button"
                        onClick={resetReportsFilters}
                        className="w-full sm:w-auto px-3 py-2 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-colors shrink-0 cursor-pointer box-border"
                      >
                        <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                        <span>Reset</span>
                      </button>
                    )}
                  </div>

                  {/* Quick-Filter Chips for Warehouse Disposition: Swipeable with touch momentum */}
                  <div className="relative w-full min-w-0 pt-2 border-t border-slate-200 dark:border-slate-700/80">
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 px-0.5 w-full scroll-smooth min-w-0 -mx-0.5 sm:mx-0">
                      <span className="text-[10px] uppercase font-black text-slate-400 shrink-0 mr-1 flex items-center gap-1 whitespace-nowrap">
                        <Layers className="w-3 h-3 text-blue-500 shrink-0" />
                        Disposition:
                      </span>
                      {[
                        { id: 'all', label: 'All Dispositions' },
                        { id: 'Pending Triage', label: '1- Pending Triage' },
                        { id: 'Restock to Inventory', label: '2- Restock' },
                        { id: 'Return to Vendor (RTV)', label: '3- Return to Vendor (RTV)' },
                        { id: 'Quarantine', label: '4- Quarantine' },
                        { id: 'Scrap / Dispose', label: '5- Scrap / Dispose' },
                        { id: 'Buffer Stock Exchange', label: '6- Buffer Exchange' }
                      ].map(chip => {
                        const isActive = coworkerQueueFilter === 'all' && reportsDispositionFilter.toLowerCase() === chip.id.toLowerCase();
                        return (
                          <button
                            key={chip.id}
                            type="button"
                            onClick={() => {
                              setCoworkerQueueFilter('all');
                              setReportsDispositionFilter(chip.id);
                              setReportsCurrentPage(1);
                            }}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold shrink-0 whitespace-nowrap transition-all cursor-pointer ${isActive
                              ? 'bg-blue-600 text-white shadow-2xs font-black'
                              : 'bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                              }`}
                          >
                            {chip.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 px-1 font-medium">
                    <span>
                      Showing <strong className="text-slate-900 dark:text-white font-bold">{processedReports.length}</strong> of {recentReportsList.length} reports
                      {(reportsSearchQuery || reportsReasonFilter !== 'all' || reportsStatusFilter !== 'all' || reportsDispositionFilter !== 'all' || reportsConditionGradeFilter !== 'all' || coworkerQueueFilter !== 'all' || reportsDateFrom || reportsDateTo) && (
                        <span className="text-blue-600 dark:text-blue-400 font-bold ml-1.5">• Filters active</span>
                      )}
                    </span>
                    <span className="text-slate-400 dark:text-slate-500">
                      Click column headers to sort (<strong className="text-slate-700 dark:text-slate-300 capitalize">{reportsSortField}</strong> {reportsSortDirection === 'asc' ? '▲' : '▼'})
                    </span>
                  </div>
                </div>

                {recentReportsList.length === 0 ? (
                  <p className="text-xs text-slate-400 py-8 text-center">No return reports filed yet.</p>
                ) : processedReports.length === 0 ? (
                  <div className="text-center py-10 space-y-2 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700">
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200">No return reports match the selected filters.</p>
                    <button
                      type="button"
                      onClick={resetReportsFilters}
                      className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Clear filters
                    </button>
                  </div>
                ) : reportsViewMode === 'table' ? (
                  /* ============================================================ */
                  /* ROWS / TABLE VIEW: WITH SORTABLE COLUMNS & LIGHTBOX PHOTOS   */
                  /* ============================================================ */
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-xs">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50/90 dark:bg-slate-800/90 border-b border-slate-200 dark:border-slate-700 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {/* Select All Checkbox Header */}
                            <th className="py-3 px-3 w-10 text-center">
                              <input
                                type="checkbox"
                                checked={isAllReportsPageSelected}
                                onChange={toggleSelectAllReportsPage}
                                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 cursor-pointer"
                                title={isAllReportsPageSelected ? "Deselect all on this page" : "Select all on this page"}
                              />
                            </th>
                            <th
                              onClick={() => handleReportsSort('id')}
                              className="py-3 px-3.5 font-black text-slate-900 dark:text-white w-16 cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors group"
                              title="Click to sort by Serial Number"
                            >
                              <div className="flex items-center">
                                <span>SN</span>
                                {reportsSortField === 'id' ? (
                                  reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                                ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                              </div>
                            </th>
                            <th
                              onClick={() => handleReportsSort('rma_number')}
                              className="py-3 px-3.5 font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                              title="Click to sort by RMA #"
                            >
                              <div className="flex items-center">
                                <span>RMA #</span>
                                {reportsSortField === 'rma_number' ? (
                                  reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                                ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                              </div>
                            </th>
                            <th className="py-3 px-3 w-14 text-center select-none">Photo</th>
                            <th
                              onClick={() => handleReportsSort('barcode')}
                              className="py-3 px-3.5 font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                              title="Click to sort by Barcode"
                            >
                              <div className="flex items-center">
                                <span>Barcode</span>
                                {reportsSortField === 'barcode' ? (
                                  reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                                ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                              </div>
                            </th>
                            <th
                              onClick={() => handleReportsSort('name')}
                              className="py-3 px-3.5 font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                              title="Click to sort by Item Name"
                            >
                              <div className="flex items-center">
                                <span>Item Name</span>
                                {reportsSortField === 'name' ? (
                                  reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                                ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                              </div>
                            </th>
                            {/* Quantity & Unit Header */}
                            <th
                              onClick={() => handleReportsSort('quantity')}
                              className="py-3 px-3 text-center font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                              title="Click to sort by Quantity & Unit"
                            >
                              <div className="flex items-center justify-center">
                                <span>Qty & Unit</span>
                                {reportsSortField === 'quantity' ? (
                                  reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                                ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                              </div>
                            </th>
                            <th
                              onClick={() => handleReportsSort('reason')}
                              className="py-3 px-3.5 font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                              title="Click to sort by Reason"
                            >
                              <div className="flex items-center">
                                <span>Reason</span>
                                {reportsSortField === 'reason' ? (
                                  reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                                ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                              </div>
                            </th>
                            {/* 7. Customer Branch Header */}
                            <th
                              onClick={() => handleReportsSort('store_branch')}
                              className="py-3 px-3.5 font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                              title="Click to sort by Customer Branch"
                            >
                              <div className="flex items-center">
                                <span>Customer Branch</span>
                                {reportsSortField === 'store_branch' ? (
                                  reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                                ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                              </div>
                            </th>

                            {/* 8. Invoice / DR # Header */}
                            <th
                              onClick={() => handleReportsSort('invoice_dr_number')}
                              className="py-3 px-3.5 font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                              title="Click to sort by Invoice / DR #"
                            >
                              <div className="flex items-center">
                                <span>Invoice / DR #</span>
                                {reportsSortField === 'invoice_dr_number' ? (
                                  reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                                ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                              </div>
                            </th>

                            {/* 8. Lifecycle Stage Header */}
                            <th
                              onClick={() => handleReportsSort('lifecycle_stage')}
                              className="py-3 px-3 text-center font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                              title="Click to sort by Lifecycle Stage"
                            >
                              <div className="flex items-center justify-center">
                                <span>Lifecycle Stage</span>
                                {reportsSortField === 'lifecycle_stage' || reportsSortField === 'status' ? (
                                  reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                                ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                              </div>
                            </th>

                            {/* 10. Disposition Header */}
                            <th
                              onClick={() => handleReportsSort('disposition')}
                              className="py-3 px-3.5 text-center font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                              title="Click to sort by Disposition"
                            >
                              <div className="flex items-center justify-center">
                                <span>Disposition</span>
                                {reportsSortField === 'disposition' ? (
                                  reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                                ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                              </div>
                            </th>

                            {/* 11. Warehouse Location Header */}
                            <th
                              onClick={() => handleReportsSort('warehouse_location')}
                              className="py-3 px-3 text-center font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                              title="Click to sort by Warehouse Rack/Bin Location"
                            >
                              <div className="flex items-center justify-center">
                                <span>Location</span>
                                {reportsSortField === 'warehouse_location' ? (
                                  reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                                ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                              </div>
                            </th>
                            <th
                              onClick={() => handleReportsSort('created_at')}
                              className="py-3 px-3.5 text-right font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                              title="Click to sort by Date"
                            >
                              <div className="flex items-center justify-end">
                                <span>Date & GPS</span>
                                {reportsSortField === 'created_at' ? (
                                  reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                                ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                              </div>
                            </th>
                            <th className="py-3 px-3.5 text-center font-bold select-none text-slate-500 dark:text-slate-400">
                              Finance & Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                          {paginatedReports.map((item, index) => {
                            const photoList = Array.isArray(item.photos)
                              ? item.photos
                              : (typeof item.photos === 'string' ? JSON.parse(item.photos || '[]') : []);
                            const isSelected = selectedReportIds.has(item.id || item.rma_number);
                            const matchedProduct = savedProductsList.find(p => p.barcode && String(p.barcode) === String(item.barcode));
                            const resolvedName = (item.name && !item.name.toLowerCase().startsWith('unidentified'))
                              ? item.name
                              : (matchedProduct?.name || item.name || `Unidentified (${item.barcode})`);
                            const isPendingUnknown = !matchedProduct && item.status === 'pending_admin_details';

                            const isManifest = isBatchManifest(item, recentReportsList);
                            const manifestChildren = isManifest ? getReportManifestItems(item, recentReportsList) : [];
                            const manifestKey = item.id || item.rma_number;
                            const isManifestExpanded = expandedManifestIds.has(manifestKey);

                            return (
                              <React.Fragment key={manifestKey}>
                                <tr
                                  onClick={(e) => {
                                    if (e.target.closest('input, button, a')) return;
                                    handleInspectTriageForReport(item);
                                  }}
                                  className={`transition-colors cursor-pointer ${isSelected
                                    ? 'bg-blue-50/80 dark:bg-blue-950/50'
                                    : 'hover:bg-blue-50/50 dark:hover:bg-slate-800/60'
                                    }`}
                                  title={`Click row to inspect & triage RMA #${item.rma_number}`}
                                >
                                  {/* Row Selection Checkbox */}
                                  <td className="py-3 px-3 text-center">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => toggleSelectReport(item.id || item.rma_number)}
                                      className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 cursor-pointer"
                                    />
                                  </td>

                                  {/* 1. SN COLUMN AT FAR LEFT */}
                                  <td className="py-3 px-3.5 font-mono">
                                    <span className="font-black text-blue-900 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200/80 dark:border-blue-800 px-2 py-0.5 rounded-lg text-xs">
                                      #{(reportsCurrentPage - 1) * reportsPageSize + index + 1}
                                    </span>
                                  </td>

                                  {/* 2. RMA # + QR Sticker Button */}
                                  <td className="py-3 px-3.5 font-mono font-bold text-blue-700 dark:text-blue-400">
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => handleInspectTriageForReport(item)}
                                        className="font-mono font-bold text-blue-700 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-200 hover:underline text-left cursor-pointer"
                                        title={`Inspect, triage, and process RMA #${item.rma_number}`}
                                      >
                                        {item.rma_number}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setQrModalReport({ ...item, name: resolvedName })}
                                        className="p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/60 rounded-md transition-colors cursor-pointer"
                                        title={`View & Print Box QR Sticker for ${item.rma_number}`}
                                      >
                                        <QrCode className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                    {/* Split, Buffer, and Manifest Quick Badges */}
                                    <div className="flex items-center gap-1 flex-wrap mt-0.5">
                                      {isManifest && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggleManifestExpand(manifestKey);
                                          }}
                                          className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider inline-flex items-center gap-1 shadow-2xs transition-colors cursor-pointer ${isManifestExpanded
                                              ? 'bg-purple-600 text-white border border-purple-700'
                                              : 'bg-purple-100 hover:bg-purple-200 dark:bg-purple-950/70 dark:hover:bg-purple-900/80 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-800'
                                            }`}
                                          title={isManifestExpanded ? "Collapse Manifest Items" : "Expand Manifest Items"}
                                        >
                                          <span>📦 Manifest ({manifestChildren.length})</span>
                                          <ChevronDown className={`w-2.5 h-2.5 transform transition-transform ${isManifestExpanded ? 'rotate-180' : ''}`} />
                                        </button>
                                      )}
                                      {isSplitChildTicket(item) ? (
                                        <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 inline-flex items-center gap-0.5 shadow-2xs" title="Split Child Ticket (Part 2)">
                                          <span>✂️ Part 2</span>
                                        </span>
                                      ) : isSplitParentTicket(item, recentReportsList) ? (
                                        <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-800 inline-flex items-center gap-0.5 shadow-2xs" title="Split Parent Ticket (Part 1)">
                                          <span>✂️ Part 1</span>
                                        </span>
                                      ) : null}

                                      {(item.status === 'buffer_replacement_dispatched' || (item.disposition && item.disposition.includes('Buffer'))) && (
                                        <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800 inline-flex items-center gap-0.5 shadow-2xs" title="1-to-1 Buffer Stock Replacement Dispatched">
                                          <span>🚚 Buffer</span>
                                        </span>
                                      )}
                                    </div>
                                  </td>

                                  {/* 3. Photo Thumbnail with Lightbox */}
                                  <td className="py-2.5 px-3 text-center">
                                    {photoList.length > 0 ? (
                                      <button
                                        type="button"
                                        onClick={() => setLightboxPhoto({
                                          images: photoList,
                                          initialIndex: 0,
                                          url: photoList[0],
                                          title: resolvedName || `Return ${item.rma_number}`,
                                          subtitle: `RMA #${item.rma_number} • Reported by ${item.reporter_name || item.reported_by || 'Staff'} • ${item.reason || 'Damaged'}`
                                        })}
                                        className="w-10 h-10 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 inline-block hover:opacity-85 hover:scale-105 transition-all shadow-xs cursor-zoom-in"
                                        title="Click to view full-size proof photo"
                                      >
                                        <img
                                          src={photoList[0]}
                                          alt="Proof"
                                          className="w-full h-full object-cover"
                                        />
                                      </button>
                                    ) : (
                                      <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto border border-slate-200 dark:border-slate-700">
                                        <ImageIcon className="w-4 h-4" />
                                      </div>
                                    )}
                                  </td>

                                  {/* 4. Barcode */}
                                  <td className="py-3 px-3.5 font-mono">
                                    {isManifest ? (
                                      <span className="px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 font-bold text-[10px] border border-purple-200 dark:border-purple-800">
                                        📦 Manifest Items
                                      </span>
                                    ) : (
                                      <>
                                        <div className="font-bold text-slate-800 dark:text-slate-200">{item.barcode}</div>
                                        {(item.code || matchedProduct?.code) && (
                                          <div className="text-[10px] text-slate-400 dark:text-slate-500">{item.code || matchedProduct?.code}</div>
                                        )}
                                      </>
                                    )}
                                  </td>

                                  {/* 5. Item Name */}
                                  <td className="py-3 px-3.5 font-bold text-slate-900 dark:text-white max-w-[200px]" title={resolvedName}>
                                    <div className="flex items-center gap-1.5">
                                      <div className="truncate">{resolvedName}</div>
                                      {isManifest && manifestChildren.length > 0 && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggleManifestExpand(manifestKey);
                                          }}
                                          className="p-0.5 text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-300 rounded hover:bg-purple-50 dark:hover:bg-purple-950/60 transition-colors shrink-0"
                                          title={isManifestExpanded ? "Collapse Manifest Items" : "Expand Manifest Items"}
                                        >
                                          <ChevronDown className={`w-3.5 h-3.5 transform transition-transform ${isManifestExpanded ? 'rotate-180' : ''}`} />
                                        </button>
                                      )}
                                    </div>
                                    {((item.supplier_name && item.supplier_name !== 'Pending Assignment') || (matchedProduct?.supplier_name && matchedProduct.supplier_name !== 'Pending Assignment')) && (
                                      <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium truncate mt-0.5">
                                        Vendor: <span className="font-semibold text-slate-700 dark:text-slate-300">{item.supplier_name || matchedProduct?.supplier_name}</span>
                                      </div>
                                    )}
                                    {(item.batch_lot_number || item.expiry_date) && (
                                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5 font-normal">
                                        {item.batch_lot_number && (
                                          <span className="text-[10px] font-mono text-amber-700 dark:text-amber-300 font-semibold bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.2 rounded border border-amber-200/80 dark:border-amber-800">
                                            Lot: {item.batch_lot_number}
                                          </span>
                                        )}
                                        {item.expiry_date && (
                                          <span className="text-[10px] font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 px-1.5 py-0.2 rounded border border-rose-200/80 dark:border-rose-800">
                                            Exp: {item.expiry_date}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </td>

                                  {/* Quantity & Unit Column */}
                                  <td className="py-3 px-3 text-center whitespace-nowrap">
                                    <span className="font-mono font-black text-xs text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 shadow-2xs inline-flex items-center gap-1">
                                      <span>
                                        {isManifest
                                          ? formatManifestBreakdown(manifestChildren, false)
                                          : formatQuantityWithPackSize(item.quantity, item.unit_name, item.pieces_per_case || matchedProduct?.pieces_per_case)}
                                      </span>
                                    </span>
                                  </td>

                                  {/* 6. Reason & Truncated Reporter Explanation */}
                                  <td className="py-3 px-3.5 max-w-[180px]">
                                    <div className="space-y-1">
                                      <span className="px-2 py-0.5 rounded-lg bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 font-bold text-[10px] inline-block">
                                        {item.reason || 'Damaged'}
                                      </span>
                                      {(() => {
                                        const rawNote = String(
                                          item.explanation ||
                                          item.notes ||
                                          (!isManifest && item.items?.[0]?.explanation ? item.items[0].explanation : '') ||
                                          ''
                                        ).trim();
                                        if (!rawNote) return null;
                                        return (
                                          <div className="flex items-center gap-1 max-w-[165px]">
                                            <button
                                              type="button"
                                              onClick={() => setViewingExplanationModal({
                                                rmaNumber: item.rma_number,
                                                productName: resolvedName,
                                                reason: item.reason || 'Damaged',
                                                explanation: rawNote,
                                                reporter: item.reporter_name || item.reported_by || 'Staff'
                                              })}
                                              className="group text-left flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100/90 hover:bg-blue-50 dark:bg-slate-800/80 dark:hover:bg-blue-950/60 border border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 transition-colors cursor-pointer max-w-full"
                                              title="Click to read full reporter explanation"
                                            >
                                              <span className="text-[10px] text-slate-600 dark:text-slate-300 italic truncate max-w-[110px]">
                                                "{rawNote}"
                                              </span>
                                              <span className="text-[9px] font-black text-blue-600 dark:text-blue-400 shrink-0 group-hover:underline">
                                                Read
                                              </span>
                                            </button>
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  </td>

                                  {/* 7. Customer Branch & Reporter */}
                                  <td className="py-3 px-3.5">
                                    <div className="font-bold text-slate-900 dark:text-slate-200 text-[11px] flex items-center gap-1" title={item.store_branch || 'Direct Return'}>
                                      <span className="text-blue-600 dark:text-blue-400">📍</span>
                                      <span className="truncate max-w-[130px] font-extrabold text-blue-900 dark:text-blue-300">
                                        {item.store_branch || 'Direct Return'}
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium mt-0.5 truncate max-w-[130px]">
                                      {item.reporter_name || item.reported_by || 'Staff'}
                                      {item.reporter_contact ? ` • ${item.reporter_contact}` : ''}
                                    </div>
                                  </td>

                                  {/* 8. Commercial Document (SI / DR / PO) */}
                                  <td className="py-3 px-3.5 font-mono">
                                    {(() => {
                                      const docs = getDocumentNumbers(item);
                                      return (
                                        <div className="space-y-0.5 text-[9px] font-mono leading-tight">
                                          <span className={`px-1.5 py-0.5 rounded block truncate max-w-[125px] ${docs.si !== 'N/A'
                                              ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-bold'
                                              : 'bg-slate-50 dark:bg-slate-800/40 text-slate-400 dark:text-slate-500 border border-slate-200/50 dark:border-slate-700/50 font-medium'
                                            }`}>
                                            SI: {docs.si}
                                          </span>
                                          <span className={`px-1.5 py-0.5 rounded block truncate max-w-[125px] ${docs.dr !== 'N/A'
                                              ? 'bg-violet-50 dark:bg-violet-950/70 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 font-bold'
                                              : 'bg-slate-50 dark:bg-slate-800/40 text-slate-400 dark:text-slate-500 border border-slate-200/50 dark:border-slate-700/50 font-medium'
                                            }`}>
                                            DR: {docs.dr}
                                          </span>
                                          <span className={`px-1.5 py-0.5 rounded block truncate max-w-[125px] ${docs.po !== 'N/A'
                                              ? 'bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-bold'
                                              : 'bg-slate-50 dark:bg-slate-800/40 text-slate-400 dark:text-slate-500 border border-slate-200/50 dark:border-slate-700/50 font-medium'
                                            }`}>
                                            PO: {docs.po}
                                          </span>
                                        </div>
                                      );
                                    })()}
                                  </td>

                                  {/* 8. Lifecycle Stage */}
                                  <td className="py-3 px-3 text-center whitespace-nowrap">
                                    {isManifest ? (() => {
                                      const dynStage = resolveBatchManifestLifecycle(item, recentReportsList);
                                      return (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggleManifestExpand(manifestKey);
                                          }}
                                          className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border inline-flex items-center gap-1 hover:opacity-90 cursor-pointer shadow-2xs ${dynStage.color}`}
                                          title="Dynamically resolved from child item dispositions (click to open drawer)"
                                        >
                                          <span>{dynStage.label}</span>
                                        </button>
                                      );
                                    })() : (() => {
                                      const stageInfo = formatLifecycleStage(item.status);
                                      return (
                                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border uppercase tracking-wider inline-block shadow-2xs ${stageInfo.color}`}>
                                          {stageInfo.label}
                                        </span>
                                      );
                                    })()}
                                  </td>

                                  {/* 10. Disposition (Full text without truncation) */}
                                  <td className="py-3 px-3.5 text-center whitespace-nowrap">
                                    {isManifest ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleManifestExpand(manifestKey);
                                        }}
                                        className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border border-purple-300 dark:border-purple-800 inline-flex items-center gap-1 hover:bg-purple-200 cursor-pointer shadow-2xs"
                                        title="Click to view child line items in drawer"
                                      >
                                        <span>📦 Multi-Item Status (See Drawer)</span>
                                      </button>
                                    ) : (() => {
                                      const disp = item.disposition || 'Pending Triage';
                                      let color = 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
                                      if (disp === 'Restock to Inventory') color = 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/70 dark:text-blue-300 dark:border-blue-800';
                                      else if (disp === 'Return to Vendor (RTV)') color = 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/70 dark:text-purple-300 dark:border-purple-800';
                                      else if (disp === 'Quarantine') color = 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800';
                                      else if (disp === 'Scrap / Dispose') color = 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-800';
                                      else if (disp.includes('Buffer')) color = 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/70 dark:text-indigo-300 dark:border-indigo-800';
                                      return (
                                        <span className={`px-2.5 py-0.5 rounded-lg text-[10px] font-extrabold border inline-block whitespace-nowrap shadow-2xs ${color}`}>
                                          {disp}
                                        </span>
                                      );
                                    })()}
                                  </td>

                                  {/* 11. Warehouse Rack/Bin Location */}
                                  <td className="py-3 px-3.5 text-center font-mono whitespace-nowrap">
                                    {item.warehouse_location ? (
                                      <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 text-[11px] font-extrabold inline-block shadow-2xs">
                                        {item.warehouse_location}
                                      </span>
                                    ) : (
                                      <span className="text-slate-300 dark:text-slate-600 text-xs font-bold">—</span>
                                    )}
                                  </td>

                                  {/* 9. Date & GPS */}
                                  <td className="py-3 px-3.5 text-right font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                    <div>{new Date(item.created_at).toLocaleDateString()}</div>
                                    {item.gps_latitude && item.gps_longitude ? (
                                      <a
                                        href={`https://www.google.com/maps?q=${item.gps_latitude},${item.gps_longitude}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5 text-[10px] font-bold"
                                      >
                                        <MapPin className="w-3 h-3 text-rose-500" />
                                        <span>Map</span>
                                      </a>
                                    ) : (
                                      <span className="text-slate-300 dark:text-slate-600 text-[10px]">No GPS</span>
                                    )}
                                  </td>

                                  {/* 10. Actions: Assign SKU / Save Product, Credit Memo, Thermal Print & Delete */}
                                  <td className="py-2.5 px-3.5 text-center">
                                    <div className="flex items-center justify-center gap-1.5">
                                      {/* Print 4x6 Thermal Box Label */}
                                      <button
                                        type="button"
                                        onClick={() => setThermalPrintReport(item)}
                                        className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                        title="Print 4x6 inch Thermal Box Label"
                                      >
                                        <Printer className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                                      </button>

                                      {/* Inspect & Triage Physical Return */}
                                      <button
                                        type="button"
                                        onClick={() => handleInspectTriageForReport(item)}
                                        className="px-2 py-1 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/70 dark:hover:bg-amber-900/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                                        title={`Inspect, triage condition grade, and assign rack/bin location for ${item.rma_number}`}
                                      >
                                        <ClipboardCheck className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                        <span>Inspect / Triage</span>
                                      </button>

                                      {/* 1-Click Coworker WMS Restock Action */}
                                      {isItemReadyToRestock(item, recentReportsList) && (
                                        <button
                                          type="button"
                                          disabled={updatingQueueId === (item.id || item.rma_number)}
                                          onClick={() => handleConfirmCoworkerAction(item, 'restocked')}
                                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-500 rounded-lg text-[10px] font-black flex items-center gap-1 transition-all cursor-pointer shadow-2xs whitespace-nowrap disabled:opacity-50"
                                          title="1-click confirm that this item has been stocked in WMS (updates status to 6- Restocked)"
                                        >
                                          <span>✓ Restocked in WMS</span>
                                        </button>
                                      )}

                                      {/* 1-Click Coworker Supplier Re-Order Action */}
                                      {isItemReadyForSupplierReorder(item, recentReportsList) && (
                                        <button
                                          type="button"
                                          disabled={updatingQueueId === (item.id || item.rma_number)}
                                          onClick={() => handleConfirmCoworkerAction(item, 'scrapped')}
                                          className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white border border-rose-500 rounded-lg text-[10px] font-black flex items-center gap-1 transition-all cursor-pointer shadow-2xs whitespace-nowrap disabled:opacity-50"
                                          title="1-click confirm that a replacement order has been placed with supplier (updates status to 7- Scrapped / Disposed)"
                                        >
                                          <span>✓ PO Placed</span>
                                        </button>
                                      )}

                                      {/* Release Hold Action */}
                                      {isItemOnHold(item, recentReportsList) && (
                                        <button
                                          type="button"
                                          onClick={() => handleInspectTriageForReport(item)}
                                          className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white border border-amber-600 rounded-lg text-[10px] font-black flex items-center gap-1 transition-all cursor-pointer shadow-2xs whitespace-nowrap"
                                          title="Release hold and re-triage to Restock, RTV, or Scrap"
                                        >
                                          <Unlock className="w-3 h-3" />
                                          <span>🔓 Release Hold</span>
                                        </button>
                                      )}

                                      {/* Do NOT render Assign SKU on parent row if batch manifest */}
                                      {!isManifest && canEditProducts && !savedProductsList.some(p => p.barcode && String(p.barcode) === String(item.barcode)) && (
                                        <button
                                          type="button"
                                          onClick={() => handleEditProductFromReport(item)}
                                          className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/70 dark:hover:bg-blue-900/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                                          title={`Assign official SKU and save "${item.name || item.barcode}" to Products catalog`}
                                        >
                                          <Package className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                          <span>Assign SKU</span>
                                        </button>
                                      )}

                                      {(() => {
                                        if (isManifest) {
                                          const linkedMemos = creditMemosList.filter(m => m.rma_number === item.rma_number || m.report_id === item.id);
                                          if (linkedMemos.length > 0) {
                                            return (
                                              <button
                                                type="button"
                                                onClick={() => handleViewCreditMemoVoucher(linkedMemos.length === 1 ? linkedMemos[0] : linkedMemos)}
                                                className="px-2.5 py-1 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/70 dark:hover:bg-emerald-900/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded-lg text-[10px] font-black flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                                                title={`View ${linkedMemos.length} Credit Memo Voucher(s) for this batch`}
                                              >
                                                <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                                <span>CM Voucher{linkedMemos.length > 1 ? ` (${linkedMemos.length})` : ''}</span>
                                              </button>
                                            );
                                          }
                                          return (
                                            <button
                                              type="button"
                                              onClick={() => toggleManifestExpand(manifestKey)}
                                              className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/70 dark:hover:bg-purple-900/70 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                                              title="View manifest line items to issue individual Credit Memos"
                                            >
                                              <Receipt className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                                              <span>CM in Drawer</span>
                                            </button>
                                          );
                                        }

                                        const existingMemo = creditMemosList.find(m => m.rma_number === item.rma_number || m.report_id === item.id);
                                        if (existingMemo) {
                                          return (
                                            <button
                                              type="button"
                                              onClick={() => handleViewCreditMemoVoucher(existingMemo)}
                                              className="px-2.5 py-1 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/70 dark:hover:bg-emerald-900/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded-lg text-[10px] font-black flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                                              title={`View Official Credit Memo Voucher: ${existingMemo.credit_memo_number}`}
                                            >
                                              <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                              <span>CM Voucher</span>
                                            </button>
                                          );
                                        }
                                        if (item.status === 'buffer_replacement_dispatched' || (item.disposition && item.disposition.includes('Buffer'))) {
                                          return (
                                            <span
                                              className="px-2 py-1 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 shadow-2xs whitespace-nowrap"
                                              title="This return was resolved via 1-to-1 Buffer Stock Replacement. No Credit Memo refund is due."
                                            >
                                              <Truck className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                                              <span>Buffer Swapped</span>
                                            </span>
                                          );
                                        }
                                        const isReportOnHold = isItemOnHold(item, recentReportsList);
                                        if (canEditProducts) {
                                          return (
                                            <button
                                              type="button"
                                              disabled={isReportOnHold}
                                              onClick={() => {
                                                if (isReportOnHold) {
                                                  alert("Item is on Hold / Quarantine. Resolve hold before issuing financial claims.");
                                                  return;
                                                }
                                                handleOpenCreditMemoForReport(item);
                                              }}
                                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all shadow-2xs ${
                                                isReportOnHold
                                                  ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-300 dark:border-slate-700 opacity-70'
                                                  : 'bg-slate-100 hover:bg-emerald-50 dark:bg-slate-800 dark:hover:bg-emerald-950/50 text-slate-700 hover:text-emerald-700 dark:text-slate-300 dark:hover:text-emerald-300 border border-slate-300 dark:border-slate-700 hover:border-emerald-400 cursor-pointer'
                                              }`}
                                              title={isReportOnHold ? "Item is on Hold / Quarantine. Resolve hold before issuing financial claims." : "Issue Finance Credit Memo for this Return"}
                                            >
                                              {isReportOnHold ? <Lock className="w-3 h-3 text-amber-500" /> : <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />}
                                              <span>{isReportOnHold ? 'On Hold' : '+ Credit Memo'}</span>
                                            </button>
                                          );
                                        }
                                        return null;
                                      })()}

                                      {canDeleteReports && (
                                        <button
                                          type="button"
                                          onClick={() => requestDeleteReport(item.id, item.rma_number, item)}
                                          className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-xl transition-colors cursor-pointer"
                                          title={`Delete RMA #${item.rma_number}`}
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>

                                {/* Expandable Multi-Item Manifest Sub-Table Drawer */}
                                {isManifest && isManifestExpanded && (
                                  <tr className="bg-purple-50/40 dark:bg-slate-900/90 border-y-2 border-purple-200 dark:border-purple-900/60">
                                    <td colSpan={15} className="p-3 sm:p-4">
                                      <div className="bg-white dark:bg-slate-800/90 rounded-xl border border-purple-200 dark:border-purple-800/60 shadow-sm overflow-hidden">
                                        {/* Manifest Header */}
                                        <div className="p-3 bg-purple-50/70 dark:bg-purple-950/40 border-b border-purple-200/80 dark:border-purple-900/50 flex flex-wrap items-center justify-between gap-2">
                                          <div className="flex items-center gap-2">
                                            <span className="p-1 rounded-md bg-purple-600 text-white">
                                              <Package className="w-3.5 h-3.5" />
                                            </span>
                                            <span className="font-extrabold text-xs text-purple-900 dark:text-purple-200 uppercase tracking-wider">
                                              Batch Return Manifest Items ({manifestChildren.length})
                                            </span>
                                            <span className="text-[11px] text-purple-700 dark:text-purple-300 font-mono">
                                              RMA: {item.rma_number}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-3">
                                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                              Total manifest breakdown: <strong className="text-slate-900 dark:text-white font-bold">{formatManifestBreakdown(manifestChildren, true)}</strong>
                                            </span>
                                            <button
                                              type="button"
                                              onClick={() => toggleManifestExpand(manifestKey)}
                                              className="text-xs text-purple-700 dark:text-purple-300 hover:text-purple-900 font-bold px-2 py-0.5 rounded hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors"
                                            >
                                              Collapse ▲
                                            </button>
                                          </div>
                                        </div>

                                        {/* Child Items Table */}
                                        <div className="overflow-x-auto lg:overflow-x-visible">
                                          <table className="table-fixed w-full text-left text-xs border-collapse">
                                            <thead>
                                              <tr className="bg-slate-50/80 dark:bg-slate-800/50 text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                                <th className="py-2 px-1 text-center w-[50px]">Item</th>
                                                <th className="py-2 px-3 min-w-[200px]">Product Description / Name</th>
                                                <th className="py-2 px-3 font-mono w-[140px]">Barcode</th>
                                                <th className="py-2 px-3 font-mono w-[120px]">Assigned SKU</th>
                                                <th className="py-2 px-3 text-center w-[80px]">Qty &amp; Unit</th>
                                                <th className="py-2 px-3 w-[170px]">Triage &amp; Reason</th>
                                                <th className="py-2 px-2 text-center w-[170px]">Actions</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                                              {manifestChildren.length === 0 ? (
                                                <tr>
                                                  <td colSpan={7} className="py-4 text-center text-slate-400 italic">
                                                    No line item breakdown records found for this batch manifest.
                                                  </td>
                                                </tr>
                                              ) : (
                                                manifestChildren.map((child, cIdx) => {
                                                  const childName = (child.name || child.item_name || child.productName || `Item #${cIdx + 1}`).trim();
                                                  const childBarcode = (child.barcode || child.item_barcode || '').trim();
                                                  const childSku = (child.sku || child.code || '').trim();
                                                  const childQty = Number(child.quantity || child.qty) || 1;
                                                  const childUnit = child.unit_name || child.unit || item.unit_name || 'pc';
                                                  const childReason = child.reason || child.defect_reason || item.reason || 'Damaged';
                                                  const childLocation = (child.warehouse_location || child.location || '').trim();
                                                  const childDisposition = child.disposition || '1- Pending Triage';
                                                  const matchedChild = savedProductsList.find(p => p.barcode && String(p.barcode) === String(childBarcode));
                                                  const isSkuAssigned = Boolean(
                                                    (matchedChild?.code && String(matchedChild.code) !== String(childBarcode) && !matchedChild.code.toLowerCase().includes('awaiting')) ||
                                                    (childSku && String(childSku) !== String(childBarcode) && !childSku.toLowerCase().includes('awaiting'))
                                                  );
                                                  const effectiveSku = (matchedChild?.code && String(matchedChild.code) !== String(childBarcode))
                                                    ? matchedChild.code
                                                    : (childSku && String(childSku) !== String(childBarcode) && !childSku.toLowerCase().includes('awaiting') ? childSku : '—');

                                                  // Extract child photos
                                                  const cPhotos = Array.isArray(child.photos)
                                                    ? child.photos
                                                    : (Array.isArray(child.photoFiles) ? child.photoFiles : (child.photo_url ? [child.photo_url] : []));
                                                  const cPhotoUrl = cPhotos[0] || (photoList[cIdx] || null);

                                                  const childExistingMemo = creditMemosList.find(m =>
                                                  (m.rma_number === item.rma_number && (
                                                    (childBarcode && String(m.barcode).trim() === childBarcode) ||
                                                    (child.id && String(m.report_id) === String(child.id)) ||
                                                    (m.product_name && m.product_name === childName)
                                                  ))
                                                  );

                                                  const childReportObject = {
                                                    id: child.id || `${item.id || item.rma_number}_${childBarcode}`,
                                                    rma_number: item.rma_number,
                                                    barcode: childBarcode,
                                                    code: effectiveSku !== '—' ? effectiveSku : (childSku || ''),
                                                    sku: effectiveSku !== '—' ? effectiveSku : (childSku || ''),
                                                    name: childName,
                                                    product_name: childName,
                                                    quantity: childQty,
                                                    unit_name: childUnit,
                                                    price: Number(child.price || matchedChild?.price || 0),
                                                    price_with_vat: Number(child.price_with_vat || child.price || matchedChild?.price_with_vat || matchedChild?.price || 0),
                                                    supplier_name: child.supplier_name || matchedChild?.supplier_name || item.supplier_name || 'Savemore',
                                                    store_branch: item.store_branch,
                                                    customer_branch: item.store_branch,
                                                    ae_name: item.ae_name,
                                                    ae_email: item.ae_email,
                                                    child_id: child.id,
                                                    is_manifest_child: true,
                                                    parent_rma_id: item.id
                                                  };

                                                  return (
                                                    <tr key={child.id || `child_${cIdx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                                      {/* Line # / Photo: 50px */}
                                                      <td className="py-2 px-1 text-center w-[50px]">
                                                        <div className="flex flex-col items-center justify-center gap-1">
                                                          <span className="text-[10px] text-slate-400 font-mono font-bold leading-none">#{cIdx + 1}</span>
                                                          {cPhotoUrl ? (
                                                            <button
                                                              type="button"
                                                              onClick={() => setLightboxPhoto({
                                                                images: [cPhotoUrl],
                                                                initialIndex: 0,
                                                                url: cPhotoUrl,
                                                                title: childName,
                                                                subtitle: `Manifest item #${cIdx + 1} of ${item.rma_number} • ${childReason}`
                                                              })}
                                                              className="w-7 h-7 rounded-md overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 inline-block hover:scale-105 transition-transform cursor-zoom-in"
                                                              title="Click to zoom image"
                                                            >
                                                              <img src={cPhotoUrl} alt={childName} className="w-full h-full object-cover" />
                                                            </button>
                                                          ) : (
                                                            <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto border border-slate-200 dark:border-slate-700">
                                                              <ImageIcon className="w-3 h-3" />
                                                            </div>
                                                          )}
                                                        </div>
                                                      </td>
                                                      {/* Product Description: min-w-[200px] with truncate and title={it.name} */}
                                                      <td className="py-2 px-3 font-bold text-slate-900 dark:text-white min-w-[200px] truncate" title={childName}>
                                                        <div className="truncate">{childName}</div>
                                                        {child.defect_details && (
                                                          <div className="text-[10px] text-slate-400 font-normal italic truncate" title={child.defect_details}>{child.defect_details}</div>
                                                        )}
                                                      </td>
                                                      {/* Barcode: 140px font-mono */}
                                                      <td className="py-2 px-3 font-mono font-bold text-slate-700 dark:text-slate-300 w-[140px] truncate" title={childBarcode || '—'}>
                                                        {childBarcode || '—'}
                                                      </td>
                                                      {/* Assigned SKU: 120px */}
                                                      <td className="py-2 px-3 font-mono text-slate-600 dark:text-slate-400 w-[120px] truncate">
                                                        {isSkuAssigned ? (
                                                          <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800 text-[11px]">
                                                            {effectiveSku}
                                                          </span>
                                                        ) : (
                                                          <span className="text-amber-600 dark:text-amber-400 font-semibold text-[10px]">
                                                            Awaiting SKU
                                                          </span>
                                                        )}
                                                      </td>
                                                      {/* Qty & Unit: 80px */}
                                                      <td className="py-2 px-3 text-center font-mono w-[80px]">
                                                        <div className="flex flex-col items-center gap-0.5">
                                                          <span className="font-bold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-700/60 px-1.5 py-0.5 rounded-md text-[11px] truncate" title={formatQuantityWithPackSize(childQty, childUnit, child.pieces_per_case || matchedChild?.pieces_per_case)}>
                                                            {formatQuantityWithPackSize(childQty, childUnit, child.pieces_per_case || matchedChild?.pieces_per_case)}
                                                          </span>
                                                          {childLocation && (
                                                            <span className="text-[9px] text-indigo-600 dark:text-indigo-400 font-bold truncate max-w-[75px]" title={childLocation}>
                                                              📍 {childLocation}
                                                            </span>
                                                          )}
                                                        </div>
                                                      </td>
                                                      {/* Triage & Reason: 170px */}
                                                      <td className="py-2 px-3 w-[170px]">
                                                        <div className="space-y-1">
                                                          <div className="truncate" title={childReason}>
                                                            <span className="px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 font-semibold text-[10px] inline-block truncate max-w-[160px]">
                                                              {childReason}
                                                            </span>
                                                          </div>
                                                          <div className="truncate" title={childDisposition}>
                                                            <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 font-medium text-[10px] inline-block truncate max-w-[160px]">
                                                              {childDisposition}
                                                            </span>
                                                          </div>
                                                          {(() => {
                                                            const childNote = String(child.explanation || child.notes || '').trim();
                                                            if (!childNote) return null;
                                                            return (
                                                              <button
                                                                type="button"
                                                                onClick={() => setViewingExplanationModal({
                                                                  rmaNumber: item.rma_number,
                                                                  productName: childName,
                                                                  reason: childReason,
                                                                  explanation: childNote,
                                                                  reporter: item.reporter_name || item.reported_by || 'Staff'
                                                                })}
                                                                className="group text-left flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 hover:bg-blue-50 dark:bg-slate-800 dark:hover:bg-blue-950/60 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer max-w-[160px]"
                                                                title="Click to read full explanation"
                                                              >
                                                                <span className="text-[9.5px] text-slate-600 dark:text-slate-300 italic truncate max-w-[110px]">
                                                                  "{childNote}"
                                                                </span>
                                                                <span className="text-[9px] font-black text-blue-600 dark:text-blue-400 shrink-0 group-hover:underline">
                                                                  Read
                                                                </span>
                                                              </button>
                                                            );
                                                          })()}
                                                        </div>
                                                      </td>
                                                      {/* Actions: 170px */}
                                                      <td className="py-2 px-2 text-center w-[170px]">
                                                        <div className="flex items-center justify-center gap-1 flex-wrap">
                                                          {String(childDisposition || '').toLowerCase().includes('restock') && !['restocked', 'closed', 'resolved', 'scrapped', 'disposed'].includes(String(child.status || '').toLowerCase()) && (
                                                            <button
                                                              type="button"
                                                              disabled={updatingQueueId === (childReportObject.id || item.rma_number)}
                                                              onClick={() => handleConfirmCoworkerAction({ ...childReportObject, is_unpacked_manifest_item: true, warehouse_location: childLocation || item.warehouse_location }, 'restocked')}
                                                              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-500 rounded-lg text-[10px] font-black inline-flex items-center gap-1 transition-all cursor-pointer shadow-2xs whitespace-nowrap disabled:opacity-50"
                                                              title="1-click confirm stocked in WMS (updates status to 6- Restocked)"
                                                            >
                                                              <span>✓ Restocked in WMS</span>
                                                            </button>
                                                          )}
                                                          {(String(childDisposition || '').toLowerCase().includes('scrap') || String(childDisposition || '').toLowerCase().includes('dispose')) && !['scrapped', 'disposed', 'closed', 'resolved', 'restocked'].includes(String(child.status || '').toLowerCase()) && (
                                                            <button
                                                              type="button"
                                                              disabled={updatingQueueId === (childReportObject.id || item.rma_number)}
                                                              onClick={() => handleConfirmCoworkerAction({ ...childReportObject, is_unpacked_manifest_item: true, warehouse_location: childLocation || item.warehouse_location }, 'scrapped')}
                                                              className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white border border-rose-500 rounded-lg text-[10px] font-black inline-flex items-center gap-1 transition-all cursor-pointer shadow-2xs whitespace-nowrap disabled:opacity-50"
                                                              title="1-click confirm replacement order placed with supplier (updates status to 7- Scrapped / Disposed)"
                                                            >
                                                              <span>✓ PO Placed</span>
                                                            </button>
                                                          )}
                                                          {(String(childDisposition || '').toLowerCase().includes('quarantine') || String(childDisposition || '').toLowerCase().includes('hold') || String(child.status || '').toLowerCase() === 'quarantine') && (
                                                            <button
                                                              type="button"
                                                              onClick={() => handleInspectTriageForReport(item)}
                                                              className="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white border border-amber-600 rounded-lg text-[10px] font-black inline-flex items-center gap-1 transition-all cursor-pointer shadow-2xs whitespace-nowrap"
                                                              title="Release hold and re-triage to Restock, RTV, or Scrap"
                                                            >
                                                              <Unlock className="w-3 h-3" />
                                                              <span>🔓 Release Hold</span>
                                                            </button>
                                                          )}
                                                          {canEditProducts && (
                                                            <button
                                                              type="button"
                                                              onClick={() => {
                                                                handleEditProductFromReport({
                                                                  id: child.id,
                                                                  child_id: child.id,
                                                                  name: childName,
                                                                  barcode: childBarcode,
                                                                  code: (childSku && String(childSku) !== String(childBarcode)) ? childSku : '',
                                                                  sku: (childSku && String(childSku) !== String(childBarcode)) ? childSku : '',
                                                                  price: child.price || 0,
                                                                  price_with_vat: child.price_with_vat || child.price || 0,
                                                                  unit_name: childUnit,
                                                                  supplier_name: child.supplier_name || item.supplier_name || 'Savemore',
                                                                  rma_number: item.rma_number,
                                                                  is_manifest_child: true,
                                                                  parent_rma_id: item.id
                                                                });
                                                              }}
                                                              className={`px-2 py-1 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 transition-all cursor-pointer shadow-2xs border ${isSkuAssigned
                                                                  ? 'bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                                                                  : 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                                                                }`}
                                                              title={`Assign or edit official catalog SKU for "${childName}"`}
                                                            >
                                                              <Package className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                                              <span>{isSkuAssigned ? 'Edit SKU' : 'Assign SKU'}</span>
                                                            </button>
                                                          )}
                                                          {childExistingMemo ? (
                                                            <button
                                                              type="button"
                                                              onClick={() => handleViewCreditMemoVoucher(childExistingMemo)}
                                                              className="px-2 py-1 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/70 dark:hover:bg-emerald-900/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded-lg text-[10px] font-black inline-flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                                                              title={`View Official Credit Memo Voucher: ${childExistingMemo.credit_memo_number}`}
                                                            >
                                                              <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                                              <span>CM Voucher</span>
                                                            </button>
                                                          ) : (
                                                            canEditProducts && (() => {
                                                              const isChildOnHold = Boolean(String(childDisposition || '').toLowerCase().includes('quarantine') || String(childDisposition || '').toLowerCase().includes('hold') || String(child.status || '').toLowerCase() === 'quarantine');
                                                              return (
                                                                <button
                                                                  type="button"
                                                                  disabled={isChildOnHold}
                                                                  onClick={() => {
                                                                    if (isChildOnHold) {
                                                                      alert("Item is on Hold / Quarantine. Resolve hold before issuing financial claims.");
                                                                      return;
                                                                    }
                                                                    handleOpenCreditMemoForReport(childReportObject);
                                                                  }}
                                                                  className={`px-2 py-1 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 transition-all shadow-2xs ${
                                                                    isChildOnHold
                                                                      ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-300 dark:border-slate-700 opacity-70'
                                                                      : 'bg-slate-100 hover:bg-emerald-50 dark:bg-slate-800 dark:hover:bg-emerald-950/50 text-slate-700 hover:text-emerald-700 dark:text-slate-300 dark:hover:text-emerald-300 border border-slate-300 dark:border-slate-700 hover:border-emerald-400 cursor-pointer'
                                                                  }`}
                                                                  title={isChildOnHold ? "Item is on Hold / Quarantine. Resolve hold before issuing financial claims." : `Issue Finance Credit Memo for ${childName} (${childQty} ${childUnit})`}
                                                                >
                                                                  {isChildOnHold ? <Lock className="w-3 h-3 text-amber-500" /> : <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />}
                                                                  <span>{isChildOnHold ? 'On Hold' : '+ Credit Memo'}</span>
                                                                </button>
                                                              );
                                                            })()
                                                          )}
                                                        </div>
                                                      </td>
                                                    </tr>
                                                  );
                                                })
                                              )}
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Floating Bulk Action Bar for Return Reports Table */}
                    {selectedReportIds.size > 0 && (
                      <div className="p-3 sm:px-4 bg-slate-900/95 dark:bg-slate-950/95 text-white border-t border-slate-700 flex flex-wrap items-center justify-between gap-3 animate-in fade-in">
                        <div className="flex items-center gap-2.5">
                          <span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-black">
                            {selectedReportIds.size}
                          </span>
                          <span className="text-xs font-bold text-slate-200">
                            {selectedReportIds.size} report{selectedReportIds.size > 1 ? 's' : ''} selected
                          </span>
                          {selectedReportIds.size < processedReports.length && (
                            <button
                              type="button"
                              onClick={selectAllFilteredReports}
                              className="text-xs text-blue-300 hover:text-white underline font-semibold ml-1 cursor-pointer"
                            >
                              Select all {processedReports.length} filtered
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={clearReportsSelection}
                            className="px-3 py-1.5 text-xs font-bold text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                          >
                            Deselect
                          </button>
                          {canDeleteReports && (
                            <button
                              type="button"
                              onClick={() => requestBulkDeleteReports(selectedReportsList)}
                              className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Delete Selected ({selectedReportIds.size})</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    <TablePagination
                      currentPage={reportsCurrentPage}
                      pageSize={reportsPageSize}
                      totalItems={processedReports.length}
                      onPageChange={setReportsCurrentPage}
                      onPageSizeChange={(newSize) => {
                        setReportsPageSize(newSize);
                        setReportsCurrentPage(1);
                      }}
                    />
                  </div>
                ) : (
                  /* ============================================================ */
                  /* GRID / CARDS VIEW (With SN badge and clickable photos)       */
                  /* ============================================================ */
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {paginatedReports.map((item, index) => {
                        const photoList = Array.isArray(item.photos)
                          ? item.photos
                          : (typeof item.photos === 'string' ? JSON.parse(item.photos || '[]') : []);
                        const isSelected = selectedReportIds.has(item.id || item.rma_number);
                        const matchedProduct = savedProductsList.find(p => p.barcode && String(p.barcode) === String(item.barcode));
                        const resolvedName = (item.name && !item.name.toLowerCase().startsWith('unidentified'))
                          ? item.name
                          : (matchedProduct?.name || item.name || `Unidentified (${item.barcode})`);
                        const isPendingUnknown = !matchedProduct && item.status === 'pending_admin_details';

                        const isManifest = isBatchManifest(item, recentReportsList);
                        const manifestChildren = isManifest ? getReportManifestItems(item, recentReportsList) : [];
                        const manifestKey = item.id || item.rma_number;
                        const isManifestExpanded = expandedManifestIds.has(manifestKey);

                        return (
                          <div
                            key={item.id || item.rma_number}
                            className={`p-4 border rounded-2xl space-y-2 transition-all shadow-sm ${isSelected
                              ? 'bg-blue-50/90 dark:bg-blue-950/60 border-blue-500'
                              : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                              }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-2 mb-1">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleSelectReport(item.id || item.rma_number)}
                                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 cursor-pointer"
                                  />
                                  <span className="font-mono font-black text-xs text-blue-900 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200/80 dark:border-blue-800 px-2 py-0.5 rounded-lg">
                                    SN #{(reportsCurrentPage - 1) * reportsPageSize + index + 1}
                                  </span>
                                  <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                    📥 Inbound
                                  </span>
                                  <span className="font-mono font-black text-xs text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 px-2 py-0.5 rounded-md shadow-2xs">
                                    Qty: <strong className="text-blue-600 dark:text-blue-400 font-black">
                                      {isManifest
                                        ? formatManifestBreakdown(manifestChildren, false)
                                        : formatQuantityWithPackSize(item.quantity, item.unit_name, item.pieces_per_case || matchedProduct?.pieces_per_case)}
                                    </strong>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleInspectTriageForReport(item)}
                                    className="font-mono font-black text-blue-700 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-200 hover:underline text-sm cursor-pointer"
                                    title={`Inspect & Triage RMA #${item.rma_number}`}
                                  >
                                    {item.rma_number}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setQrModalReport({ ...item, name: resolvedName })}
                                    className="p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/60 rounded-md transition-colors cursor-pointer"
                                    title={`View & Print Box QR Sticker for ${item.rma_number}`}
                                  >
                                    <QrCode className="w-3.5 h-3.5" />
                                  </button>
                                  {isManifest ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => toggleManifestExpand(manifestKey)}
                                        className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider inline-flex items-center gap-1 shadow-2xs cursor-pointer ${isManifestExpanded
                                            ? 'bg-purple-600 text-white border border-purple-700'
                                            : 'bg-purple-100 hover:bg-purple-200 dark:bg-purple-950/70 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-800'
                                          }`}
                                        title={isManifestExpanded ? "Collapse Manifest Items" : "Expand Manifest Items"}
                                      >
                                        <span>📦 Manifest ({manifestChildren.length})</span>
                                        <ChevronDown className={`w-2.5 h-2.5 transform transition-transform ${isManifestExpanded ? 'rotate-180' : ''}`} />
                                      </button>
                                      {(() => {
                                        const dynStage = resolveBatchManifestLifecycle(item, recentReportsList);
                                        return (
                                          <span className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider border inline-flex items-center gap-0.5 shadow-2xs ${dynStage.color}`}>
                                            {dynStage.label}
                                          </span>
                                        );
                                      })()}
                                    </>
                                  ) : (() => {
                                    const stageInfo = formatLifecycleStage(item.status);
                                    return (
                                      <span className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider border inline-flex items-center gap-0.5 shadow-2xs ${stageInfo.color}`}>
                                        {stageInfo.label}
                                      </span>
                                    );
                                  })()}
                                  {isSplitChildTicket(item) ? (
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 inline-flex items-center gap-0.5 shadow-2xs" title="Split Child Ticket (Part 2)">
                                      <span>✂️ Part 2</span>
                                    </span>
                                  ) : isSplitParentTicket(item, recentReportsList) ? (
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-800 inline-flex items-center gap-0.5 shadow-2xs" title="Split Parent Ticket (Part 1)">
                                      <span>✂️ Part 1</span>
                                    </span>
                                  ) : null}
                                </div>
                                <h4 className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm mt-0.5 truncate" title={resolvedName}>
                                  {resolvedName}
                                </h4>
                                <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                  {isManifest ? (
                                    <span className="inline-flex items-center gap-1.5 flex-wrap">
                                      <span className="px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 font-bold text-[10px] border border-purple-200 dark:border-purple-800">
                                        📦 Manifest Items
                                      </span>
                                      <span className="text-slate-600 dark:text-slate-300 font-bold">
                                        {formatManifestBreakdown(manifestChildren, true)}
                                      </span>
                                    </span>
                                  ) : (
                                    <>
                                      Qty: <strong className="text-slate-900 dark:text-white font-bold">{formatQuantityWithPackSize(item.quantity, item.unit_name, item.pieces_per_case || matchedProduct?.pieces_per_case)}</strong> • Barcode: <strong className="text-slate-800 dark:text-slate-200">{item.barcode}</strong>
                                      {(item.code || matchedProduct?.code) && <span> • SKU: {item.code || matchedProduct?.code}</span>}
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {/* Print 4x6 Thermal Box Label */}
                                <button
                                  type="button"
                                  onClick={() => setThermalPrintReport(item)}
                                  className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                  title="Print 4x6 inch Thermal Box Label"
                                >
                                  <Printer className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                                </button>

                                {/* Inspect & Triage Physical Return */}
                                <button
                                  type="button"
                                  onClick={() => handleInspectTriageForReport(item)}
                                  className="px-2 py-0.5 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                                  title={`Inspect condition and set warehouse disposition for ${item.rma_number}`}
                                >
                                  <ClipboardCheck className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                  <span>Triage</span>
                                </button>

                                {/* 1-Click Coworker WMS Restock Action */}
                                {isItemReadyToRestock(item, recentReportsList) && (
                                  <button
                                    type="button"
                                    disabled={updatingQueueId === (item.id || item.rma_number)}
                                    onClick={() => handleConfirmCoworkerAction(item, 'restocked')}
                                    className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-500 rounded-lg text-[10px] font-black flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-50"
                                    title="1-click confirm that this item has been stocked in WMS (updates status to 6- Restocked)"
                                  >
                                    <span>✓ Restocked in WMS</span>
                                  </button>
                                )}

                                {/* 1-Click Coworker Supplier Re-Order Action */}
                                {isItemReadyForSupplierReorder(item, recentReportsList) && (
                                  <button
                                    type="button"
                                    disabled={updatingQueueId === (item.id || item.rma_number)}
                                    onClick={() => handleConfirmCoworkerAction(item, 'scrapped')}
                                    className="px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white border border-rose-500 rounded-lg text-[10px] font-black flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-50"
                                    title="1-click confirm that a replacement order has been placed with supplier (updates status to 7- Scrapped / Disposed)"
                                  >
                                    <span>✓ PO Placed</span>
                                  </button>
                                )}

                                {/* Release Hold Action */}
                                {isItemOnHold(item, recentReportsList) && (
                                  <button
                                    type="button"
                                    onClick={() => handleInspectTriageForReport(item)}
                                    className="px-2 py-0.5 bg-amber-500 hover:bg-amber-600 text-white border border-amber-600 rounded-lg text-[10px] font-black flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                    title="Release hold and re-triage to Restock, RTV, or Scrap"
                                  >
                                    <Unlock className="w-3 h-3" />
                                    <span>🔓 Release Hold</span>
                                  </button>
                                )}

                                {canEditProducts && !isManifest && !savedProductsList.some(p => p.barcode && String(p.barcode) === String(item.barcode)) && (
                                  <button
                                    type="button"
                                    onClick={() => handleEditProductFromReport(item)}
                                    className="px-2 py-0.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                                    title="Assign official SKU and save to Products catalog"
                                  >
                                    <Package className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                    <span>Assign SKU</span>
                                  </button>
                                )}
                                {(() => {
                                  if (isManifest) {
                                    const linkedMemos = creditMemosList.filter(m => m.rma_number === item.rma_number || m.report_id === item.id);
                                    if (linkedMemos.length > 0) {
                                      return (
                                        <button
                                          type="button"
                                          onClick={() => handleViewCreditMemoVoucher(linkedMemos.length === 1 ? linkedMemos[0] : linkedMemos)}
                                          className="px-2 py-0.5 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded-lg text-[10px] font-black flex items-center gap-1 cursor-pointer"
                                          title={`View ${linkedMemos.length} Credit Memo Voucher(s) for this batch`}
                                        >
                                          <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                          <span>Vouchers ({linkedMemos.length})</span>
                                        </button>
                                      );
                                    }
                                    return (
                                      <button
                                        type="button"
                                        onClick={() => toggleManifestExpand(manifestKey)}
                                        className="px-2 py-0.5 bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                                        title="View manifest line items in drawer"
                                      >
                                        <Receipt className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                                        <span>CM Drawer</span>
                                      </button>
                                    );
                                  }

                                  const existingMemo = creditMemosList.find(m => m.rma_number === item.rma_number || m.report_id === item.id);
                                  if (existingMemo) {
                                    return (
                                      <button
                                        type="button"
                                        onClick={() => handleViewCreditMemoVoucher(existingMemo)}
                                        className="px-2 py-0.5 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded-lg text-[10px] font-black flex items-center gap-1 cursor-pointer"
                                        title={`View Voucher: ${existingMemo.credit_memo_number}`}
                                      >
                                        <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                        <span>Voucher</span>
                                      </button>
                                    );
                                  }
                                  const isCardOnHold = isItemOnHold(item, recentReportsList);
                                  if (canEditProducts) {
                                    return (
                                      <button
                                        type="button"
                                        disabled={isCardOnHold}
                                        onClick={() => {
                                          if (isCardOnHold) {
                                            alert("Item is on Hold / Quarantine. Resolve hold before issuing financial claims.");
                                            return;
                                          }
                                          handleOpenCreditMemoForReport(item);
                                        }}
                                        className={`px-2 py-0.5 rounded-lg text-[10px] font-bold flex items-center gap-1 ${
                                          isCardOnHold
                                            ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-300 dark:border-slate-700 opacity-70'
                                            : 'bg-slate-100 hover:bg-emerald-50 dark:bg-slate-800 dark:hover:bg-emerald-950/50 text-slate-700 hover:text-emerald-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 cursor-pointer'
                                        }`}
                                        title={isCardOnHold ? "Item is on Hold / Quarantine. Resolve hold before issuing financial claims." : "Issue Credit Memo"}
                                      >
                                        {isCardOnHold ? <Lock className="w-3 h-3 text-amber-500" /> : <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />}
                                        <span>{isCardOnHold ? 'On Hold' : '+ CM'}</span>
                                      </button>
                                    );
                                  }
                                  return null;
                                })()}
                                <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300">
                                  {item.reason || 'Damaged'}
                                </span>
                                {canDeleteReports && (
                                  <button
                                    type="button"
                                    onClick={() => requestDeleteReport(item.id, item.rma_number, item)}
                                    className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-100 dark:hover:bg-rose-900/50 rounded-xl transition-colors cursor-pointer"
                                    title={`Delete RMA #${item.rma_number}`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Reporter Details & Truncated Explanation */}
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200/60 dark:border-slate-700/60 space-y-1">
                              <div className="flex items-center justify-between">
                                <span>Reported by: <strong className="text-slate-800 dark:text-slate-200">{item.reporter_name || item.reported_by}</strong></span>
                                <span className="font-mono text-slate-600 dark:text-slate-400">{item.reporter_contact || ''}</span>
                              </div>
                              {(() => {
                                const rawNote = String(
                                  item.explanation ||
                                  item.notes ||
                                  (!isManifest && item.items?.[0]?.explanation ? item.items[0].explanation : '') ||
                                  ''
                                ).trim();
                                if (!rawNote) return null;
                                return (
                                  <div className="flex items-center justify-between gap-2 bg-white/80 dark:bg-slate-900/60 px-2.5 py-1 rounded-lg border border-slate-200/80 dark:border-slate-700/80">
                                    <span className="text-[10px] text-slate-600 dark:text-slate-300 italic truncate">
                                      Note: "{rawNote}"
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => setViewingExplanationModal({
                                        rmaNumber: item.rma_number,
                                        productName: resolvedName,
                                        reason: item.reason || 'Damaged',
                                        explanation: rawNote,
                                        reporter: item.reporter_name || item.reported_by || 'Staff'
                                      })}
                                      className="text-[10px] font-black text-blue-600 dark:text-blue-400 hover:underline shrink-0 cursor-pointer"
                                    >
                                      Read Full
                                    </button>
                                  </div>
                                );
                              })()}
                            </div>

                            {/* Enterprise Logistics Badges (Store Branch, DR#, Batch/Lot, Expiry) */}
                            {(item.store_branch || item.invoice_dr_number || item.batch_lot_number || item.expiry_date) && (
                              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[10px]">
                                {item.store_branch && (
                                  <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 font-semibold flex items-center gap-1">
                                    📍 {item.store_branch}
                                  </span>
                                )}
                                {(() => {
                                  const docs = getDocumentNumbers(item);
                                  return (
                                    <>
                                      {docs.si !== 'N/A' && (
                                        <span className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-mono font-bold">
                                          SI: {docs.si}
                                        </span>
                                      )}
                                      {docs.dr !== 'N/A' && (
                                        <span className="px-2 py-0.5 rounded-md bg-violet-50 dark:bg-violet-950/70 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 font-mono font-bold">
                                          DR: {docs.dr}
                                        </span>
                                      )}
                                      {docs.po !== 'N/A' && (
                                        <span className="px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-mono font-bold">
                                          PO: {docs.po}
                                        </span>
                                      )}
                                    </>
                                  );
                                })()}
                                {item.batch_lot_number && (
                                  <span className="px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-mono font-semibold">
                                    Lot: {item.batch_lot_number}
                                  </span>
                                )}
                                {item.expiry_date && (
                                  <span className="px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 font-medium">
                                    Exp: {item.expiry_date}
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Photos preview with click-to-zoom multi-image */}
                            {photoList.length > 0 && (
                              <div className="flex items-center gap-2 pt-1">
                                <span className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold">
                                  {photoList.length} Photo{photoList.length > 1 ? 's' : ''}:
                                </span>
                                <div className="flex gap-1.5 overflow-x-auto py-0.5">
                                  {photoList.map((url, i) => (
                                    <button
                                      key={i}
                                      type="button"
                                      onClick={() => setLightboxPhoto({
                                        images: photoList,
                                        initialIndex: i,
                                        url,
                                        title: item.name || `Return ${item.rma_number}`,
                                        subtitle: `Photo ${i + 1} of ${photoList.length} • RMA #${item.rma_number}`
                                      })}
                                      className="w-10 h-10 rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 cursor-zoom-in hover:opacity-85 transition-opacity shrink-0"
                                      title="Click to zoom proof photo"
                                    >
                                      <img
                                        src={url}
                                        alt="Proof"
                                        className="w-full h-full object-cover"
                                      />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Expandable Multi-Item Manifest Line Items for Cards View */}
                            {isManifest && isManifestExpanded && (
                              <div className="mt-3 pt-3 border-t border-purple-200 dark:border-purple-900/50 space-y-2">
                                <div className="flex items-center justify-between text-[11px] font-bold text-purple-900 dark:text-purple-200">
                                  <span>📦 Manifest Items Breakdown ({manifestChildren.length})</span>
                                  <span className="text-slate-500 font-normal">Line-Item SKU & Credit Memo</span>
                                </div>
                                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                                  {manifestChildren.map((child, cIdx) => {
                                    const childName = (child.name || child.item_name || child.productName || `Item #${cIdx + 1}`).trim();
                                    const childBarcode = (child.barcode || child.item_barcode || '').trim();
                                    const childSku = (child.sku || child.code || '').trim();
                                    const childQty = Number(child.quantity || child.qty) || 1;
                                    const childUnit = child.unit_name || child.unit || item.unit_name || 'pc';
                                    const childReason = child.reason || child.defect_reason || item.reason || 'Damaged';
                                    const childLocation = (child.warehouse_location || child.location || '').trim();
                                    const childDisposition = child.disposition || '1- Pending Triage';
                                    const matchedChild = savedProductsList.find(p => p.barcode && String(p.barcode) === String(childBarcode));
                                    const isSkuAssigned = Boolean(
                                      (matchedChild?.code && String(matchedChild.code) !== String(childBarcode) && !matchedChild.code.toLowerCase().includes('awaiting')) ||
                                      (childSku && String(childSku) !== String(childBarcode) && !childSku.toLowerCase().includes('awaiting'))
                                    );
                                    const effectiveSku = (matchedChild?.code && String(matchedChild.code) !== String(childBarcode))
                                      ? matchedChild.code
                                      : (childSku && String(childSku) !== String(childBarcode) && !childSku.toLowerCase().includes('awaiting') ? childSku : '—');

                                    const childExistingMemo = creditMemosList.find(m =>
                                    (m.rma_number === item.rma_number && (
                                      (childBarcode && String(m.barcode).trim() === childBarcode) ||
                                      (child.id && String(m.report_id) === String(child.id)) ||
                                      (m.product_name && m.product_name === childName)
                                    ))
                                    );

                                    const childReportObject = {
                                      id: child.id || `${item.id || item.rma_number}_${childBarcode}`,
                                      rma_number: item.rma_number,
                                      barcode: childBarcode,
                                      code: effectiveSku !== '—' ? effectiveSku : (childSku || ''),
                                      sku: effectiveSku !== '—' ? effectiveSku : (childSku || ''),
                                      name: childName,
                                      product_name: childName,
                                      quantity: childQty,
                                      unit_name: childUnit,
                                      price: Number(child.price || matchedChild?.price || 0),
                                      price_with_vat: Number(child.price_with_vat || child.price || matchedChild?.price_with_vat || matchedChild?.price || 0),
                                      supplier_name: child.supplier_name || matchedChild?.supplier_name || item.supplier_name || 'Savemore',
                                      store_branch: item.store_branch,
                                      customer_branch: item.store_branch,
                                      ae_name: item.ae_name,
                                      ae_email: item.ae_email,
                                      child_id: child.id,
                                      is_manifest_child: true,
                                      parent_rma_id: item.id
                                    };

                                    return (
                                      <div key={child.id || `card_child_${cIdx}`} className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-1.5 shadow-2xs">
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="font-bold text-xs text-slate-900 dark:text-white truncate">
                                            #{cIdx + 1} {childName}
                                          </div>
                                          <span className="font-mono font-bold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-700/60 px-1.5 py-0.5 rounded text-[10px]">
                                            {formatQuantityWithPackSize(childQty, childUnit, child.pieces_per_case || matchedChild?.pieces_per_case)}
                                          </span>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500 font-mono">
                                          <span>BC: {childBarcode || '—'}</span>
                                          <span>•</span>
                                          <span>SKU: <span className={isSkuAssigned ? "font-bold text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400 font-semibold"}>{effectiveSku}</span></span>
                                          {childLocation && (
                                            <>
                                              <span>•</span>
                                              <span className="text-indigo-600 dark:text-indigo-400 font-bold">📍 {childLocation}</span>
                                            </>
                                          )}
                                        </div>
                                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-700/50">
                                          <div className="flex items-center gap-1 text-[10px]">
                                            <span className="text-rose-600 dark:text-rose-400 font-medium">{childReason}</span>
                                            <span className="text-slate-400">•</span>
                                            <span className="text-blue-600 dark:text-blue-400 font-semibold">{childDisposition}</span>
                                          </div>
                                          <div className="flex items-center gap-1.5">
                                            {canEditProducts && (
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  handleEditProductFromReport({
                                                    id: child.id,
                                                    child_id: child.id,
                                                    name: childName,
                                                    barcode: childBarcode,
                                                    code: (childSku && String(childSku) !== String(childBarcode)) ? childSku : '',
                                                    sku: (childSku && String(childSku) !== String(childBarcode)) ? childSku : '',
                                                    price: child.price || 0,
                                                    price_with_vat: child.price_with_vat || child.price || 0,
                                                    unit_name: childUnit,
                                                    supplier_name: child.supplier_name || item.supplier_name || 'Savemore',
                                                    rma_number: item.rma_number,
                                                    is_manifest_child: true,
                                                    parent_rma_id: item.id
                                                  });
                                                }}
                                                className={`px-2 py-0.5 rounded text-[10px] font-bold border inline-flex items-center gap-1 cursor-pointer transition-all ${isSkuAssigned
                                                    ? 'bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                                                    : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300'
                                                  }`}
                                                title={`Assign or edit official catalog SKU for "${childName}"`}
                                              >
                                                <Package className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                                <span>{isSkuAssigned ? 'Edit SKU' : 'Assign SKU'}</span>
                                              </button>
                                            )}
                                            {childExistingMemo ? (
                                              <button
                                                type="button"
                                                onClick={() => handleViewCreditMemoVoucher(childExistingMemo)}
                                                className="px-2 py-0.5 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded text-[10px] font-black inline-flex items-center gap-1 cursor-pointer shadow-2xs"
                                                title={`View Voucher: ${childExistingMemo.credit_memo_number}`}
                                              >
                                                <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                                <span>Voucher</span>
                                              </button>
                                            ) : (
                                              canEditProducts && (
                                                <button
                                                  type="button"
                                                  onClick={() => handleOpenCreditMemoForReport(childReportObject)}
                                                  className="px-2 py-0.5 bg-slate-100 hover:bg-emerald-50 dark:bg-slate-800 dark:hover:bg-emerald-950/50 text-slate-700 hover:text-emerald-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer shadow-2xs"
                                                  title={`Issue Credit Memo for ${childName}`}
                                                >
                                                  <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                                  <span>+ CM</span>
                                                </button>
                                              )
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Floating Bulk Action Bar for Grid Cards */}
                    {selectedReportIds.size > 0 && (
                      <div className="p-3 sm:px-4 bg-slate-900/95 dark:bg-slate-950/95 text-white rounded-2xl border border-slate-700 flex flex-wrap items-center justify-between gap-3 animate-in fade-in">
                        <div className="flex items-center gap-2.5">
                          <span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-black">
                            {selectedReportIds.size}
                          </span>
                          <span className="text-xs font-bold text-slate-200">
                            {selectedReportIds.size} report{selectedReportIds.size > 1 ? 's' : ''} selected
                          </span>
                          {selectedReportIds.size < processedReports.length && (
                            <button
                              type="button"
                              onClick={selectAllFilteredReports}
                              className="text-xs text-blue-300 hover:text-white underline font-semibold ml-1 cursor-pointer"
                            >
                              Select all {processedReports.length} filtered
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={clearReportsSelection}
                            className="px-3 py-1.5 text-xs font-bold text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                          >
                            Deselect
                          </button>
                          {canDeleteReports && (
                            <button
                              type="button"
                              onClick={() => requestBulkDeleteReports(selectedReportsList)}
                              className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Delete Selected ({selectedReportIds.size})</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    <TablePagination
                      currentPage={reportsCurrentPage}
                      pageSize={reportsPageSize}
                      totalItems={processedReports.length}
                      onPageChange={setReportsCurrentPage}
                      onPageSizeChange={(newSize) => {
                        setReportsPageSize(newSize);
                        setReportsCurrentPage(1);
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: FINANCE CREDIT MEMO SECTION */}
            {adminActiveTab === 'credit_memos' && (
              <CreditMemosTab
                creditMemosList={creditMemosList}
                recentReportsList={recentReportsList}
                currentUser={currentUser}
                onOpenCreateModal={handleOpenCreateCreditMemo}
                onEditCreditMemo={handleEditCreditMemo}
                onViewVoucher={handleViewCreditMemoVoucher}
                onPrintBulk={handleViewCreditMemoVoucher}
                onRequestDeleteCreditMemo={requestDeleteCreditMemo}
                onRequestBulkDeleteCreditMemo={requestBulkDeleteCreditMemos}
              />
            )}

            {/* TAB 4: SUPPLIER RECOVERY / CHARGEBACK BATCHING (RTV CLAIMS) */}
            {adminActiveTab === 'supplier_claims' && (
              <SupplierClaimsTab
                reportsList={recentReportsList}
                currentUser={currentUser}
                onRefresh={refreshAllData}
                onViewPhoto={(photoObj) => setLightboxPhoto(photoObj)}
                onRequestDeleteReport={requestDeleteReport}
                onRequestBulkDeleteReports={requestBulkDeleteReports}
                onAssignSku={(report) => handleEditProductFromReport(report)}
                onEditProductFromReport={handleEditProductFromReport}
                onOpenQuickAction={(rmaNumber) => {
                  setQuickRmaNumber(rmaNumber);
                  setIsQuickRmaModalOpen(true);
                }}
                onPrintLabel={(report) => setThermalPrintReport(report)}
                onViewExplanation={(info) => setViewingExplanationModal(info)}
                savedProductsList={savedProductsList}
              />
            )}

            {/* TAB 5: SETTINGS & GOOGLE SMTP NOTIFICATION SERVICE (Super Admin Only) */}
            {adminActiveTab === 'settings' && currentUser?.role === 'super_admin' && (
              <SettingsTab
                isTestMode={isTestMode}
                onToggleTestMode={toggleTestMode}
                onOpenPortalQr={() => setIsCustomerInvitesModalOpen(true)}
                currentUser={currentUser}
              />
            )}

          </div>
        )}

      </div>

      {/* Admin Login Modal (OTP Verification Gate) */}
      <AdminLoginModal
        key={isLoginModalOpen ? 'active-admin-login-modal' : 'inactive-admin-login-modal'}
        isOpen={isLoginModalOpen}
        onClose={() => {
          setIsLoginModalOpen(false);
          if (!currentUser) navigateTo('/');
        }}
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          setIsLoginModalOpen(false);
          showToast(`Welcome back, ${user.name}! Authenticated as ${user.role}.`, 'success');
        }}
      />

      {/* Super Admin Employee Access & Roles Management Modal */}
      <EmployeeManagementModal
        isOpen={isEmployeeModalOpen}
        onClose={() => setIsEmployeeModalOpen(false)}
        currentUser={currentUser}
      />

      {/* Camera Scanner Modal */}
      <ScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={(code) => {
          setIsScannerOpen(false);
          const rma = parseRmaFromScan(code);
          if (rma) {
            setQuickRmaNumber(rma);
            setIsQuickRmaModalOpen(true);
          } else {
            setBarcodeInput(code);
          }
        }}
      />

      {/* Admin Pending Barcodes Modal (With Photo Upload) */}
      <PendingBarcodesModal
        isOpen={isPendingModalOpen}
        onClose={() => setIsPendingModalOpen(false)}
        pendingList={pendingBarcodesList}
        currentUser={currentUser}
        onUpdated={() => {
          refreshAllData();
          showToast('Barcode details and reference photo updated!', 'success');
        }}
      />

      {/* Full Reports Modal */}
      <RMAReportsModal
        isOpen={isReportsModalOpen}
        onClose={() => setIsReportsModalOpen(false)}
        reports={recentReportsList}
        currentUser={currentUser}
        onDeleteReport={requestDeleteReport}
        onBulkDeleteReport={requestBulkDeleteReports}
        creditMemosList={creditMemosList}
        savedProductsList={savedProductsList}
        onEditProductFromReport={handleEditProductFromReport}
        onViewReportQR={(rep) => setQrModalReport(rep)}
        onOpenCreditMemo={(rep) => {
          setIsReportsModalOpen(false);
          handleOpenCreditMemoForReport(rep);
        }}
        onViewCreditMemoVoucher={(memo) => {
          setIsReportsModalOpen(false);
          handleViewCreditMemoVoucher(memo);
        }}
      />

      {/* Product Edit / Add Modal */}
      <ProductEditModal
        isOpen={isProductEditOpen}
        onClose={() => {
          setIsProductEditOpen(false);
          setEditingProduct(null);
          restoreQuickRmaIfPending();
        }}
        product={editingProduct}
        currentUser={currentUser}
        onSaved={async (prod) => {
          const barcode = prod?.barcode ? String(prod.barcode).trim() : '';
          const name = prod?.name || '';
          const code = prod?.code || prod?.sku || '';
          const supplierName = prod?.supplier_name || prod?.supplierName || 'Savemore';
          const price = Number(prod?.price || 0);
          const priceWithVat = Number(prod?.price_with_vat || prod?.priceWithVat || price || 0);
          const unitName = prod?.unit_name || prod?.unitName || 'pc';
          const piecesPerCase = prod?.pieces_per_case || prod?.piecesPerCase || null;
          const aeName = prod?.ae_name || prod?.aeName || null;
          const aeEmail = prod?.ae_email || prod?.aeEmail || null;
          const childIdToMatch = prod?.child_id || editingProduct?.child_id;

          if (barcode) {
            // Optimistically update in-memory reports state so UI shows Logged & SKU immediately
            setRecentReportsList(prev => prev.map(rep => {
              let updated = { ...rep };
              const isManifestParent = rep.is_parent || (String(rep.name || '').toLowerCase().startsWith('batch return manifest'));
              if (rep.barcode && String(rep.barcode).trim() === barcode) {
                updated = {
                  ...updated,
                  name: isManifestParent ? rep.name : (name || rep.name),
                  code: code || rep.code,
                  status: 'logged',
                  supplier_name: supplierName,
                  price: price,
                  price_with_vat: priceWithVat,
                  unit_name: unitName,
                  pieces_per_case: piecesPerCase
                };
              }
              // Also update child items inside rep.items JSON array
              let parsedItems = Array.isArray(updated.items)
                ? [...updated.items]
                : (typeof updated.items === 'string' ? JSON.parse(updated.items || '[]') : []);
              if (parsedItems.length > 0) {
                let itemsChanged = false;
                parsedItems = parsedItems.map(it => {
                  const matchesBarcode = barcode && it.barcode && String(it.barcode).trim() === barcode;
                  const matchesId = childIdToMatch && it.id && String(it.id) === String(childIdToMatch);
                  if (matchesBarcode || matchesId) {
                    itemsChanged = true;
                    return {
                      ...it,
                      code: code,
                      sku: code,
                      name: name || it.name,
                      productName: name || it.productName || it.name,
                      price: price,
                      price_with_vat: priceWithVat,
                      supplier_name: supplierName,
                      unit_name: unitName,
                      pieces_per_case: piecesPerCase
                    };
                  }
                  return it;
                });
                if (itemsChanged) {
                  updated.items = parsedItems;
                }
              }
              return updated;
            }));

            // Optimistically update savedProductsList so manifest drawer badge immediately turns green
            setSavedProductsList(prev => {
              const idx = prev.findIndex(p => p.barcode && String(p.barcode).trim() === barcode);
              const newEntry = {
                ...(idx >= 0 ? prev[idx] : {}),
                ...prod,
                barcode,
                code,
                sku: code,
                name: name || (idx >= 0 ? prev[idx].name : ''),
                price,
                price_with_vat: priceWithVat,
                unit_name: unitName,
                pieces_per_case: piecesPerCase,
                piecesPerCase: piecesPerCase,
                supplier_name: supplierName,
                is_verified: true
              };
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = newEntry;
                return next;
              }
              return [...prev, newEntry];
            });

            // Persist to Supabase rma_items, parent rma_reports items array, and report records
            try {
              // 1. Update rma_items child table by child id and barcode
              if (childIdToMatch) {
                await supabase
                  .from('rma_items')
                  .update({
                    sku: code,
                    code: code,
                    name: name,
                    price: price,
                    price_with_vat: priceWithVat,
                    supplier_name: supplierName,
                    unit_name: unitName
                  })
                  .eq('id', childIdToMatch);
              }
              await supabase
                .from('rma_items')
                .update({
                  sku: code,
                  code: code,
                  name: name,
                  price: price,
                  price_with_vat: priceWithVat,
                  supplier_name: supplierName,
                  unit_name: unitName
                })
                .eq('barcode', barcode);

              // 2. Update parent rma_reports JSON items array
              const { data: parentsWithItems } = await supabase
                .from('rma_reports')
                .select('id, items')
                .not('items', 'is', null);

              if (parentsWithItems && parentsWithItems.length > 0) {
                for (const pr of parentsWithItems) {
                  let pItems = Array.isArray(pr.items)
                    ? pr.items
                    : (typeof pr.items === 'string' ? JSON.parse(pr.items || '[]') : []);
                  let hasMatch = false;
                  pItems = pItems.map(it => {
                    const matchesBarcode = barcode && it.barcode && String(it.barcode).trim() === barcode;
                    const matchesId = childIdToMatch && it.id && String(it.id) === String(childIdToMatch);
                    if (matchesBarcode || matchesId) {
                      hasMatch = true;
                      return {
                        ...it,
                        code: code,
                        sku: code,
                        name: name || it.name,
                        productName: name || it.productName || it.name,
                        price: price,
                        price_with_vat: priceWithVat,
                        supplier_name: supplierName,
                        unit_name: unitName
                      };
                    }
                    return it;
                  });
                  if (hasMatch) {
                    await supabase
                      .from('rma_reports')
                      .update({ items: pItems })
                      .eq('id', pr.id);
                  }
                }
              }

              // 3. Update rma_reports matching barcode (strictly protect parent manifest names)
              const { data: matchedPending } = await supabase
                .from('rma_reports')
                .select('*')
                .eq('barcode', barcode)
                .or('status.eq.pending_admin_details,name.ilike.%unidentified%');

              await supabase
                .from('rma_reports')
                .update({
                  code: code,
                  price: price,
                  price_with_vat: priceWithVat,
                  supplier_name: supplierName,
                  unit_name: unitName,
                  ae_name: aeName,
                  ae_email: aeEmail,
                  status: 'logged'
                })
                .eq('barcode', barcode);

              // Update name only on non-parent records
              await supabase
                .from('rma_reports')
                .update({ name: name })
                .eq('barcode', barcode)
                .neq('is_parent', true)
                .not('name', 'ilike', 'Batch Return Manifest%');

              // If this return was waiting for SKU assignment, dispatch the official RMA report notification email!
              if (matchedPending && matchedPending.length > 0) {
                const isTestActive = typeof window !== 'undefined' && localStorage.getItem('rma_portal_test_mode') === 'true';
                for (const rep of matchedPending) {
                  const enrichedReport = {
                    ...rep,
                    name: name,
                    code: code,
                    price: price,
                    price_with_vat: priceWithVat,
                    supplier_name: supplierName,
                    unit_name: unitName,
                    ae_name: aeName,
                    ae_email: aeEmail,
                    status: 'logged'
                  };
                  notificationService.sendRMANotification(enrichedReport, isTestActive).catch(e => {
                    console.warn('Background RMA report notification notice on SKU assignment:', e);
                  });
                }
              }
            } catch (e) {
              console.warn('Sync rma_reports from product save notice:', e);
            }
          }
          await refreshAllData();
          showToast(`Product "${name || 'Item'}" saved to catalog and linked reports updated!`, 'success');
          restoreQuickRmaIfPending();
        }}
        onDeleted={(prod) => {
          refreshAllData();
          showToast(`Product "${prod.name}" deleted from catalog.`, 'success');
          restoreQuickRmaIfPending();
        }}
      />

      {/* Finance Credit Memo Issue / Edit Modal */}
      <CreditMemoModal
        isOpen={isCreditMemoModalOpen}
        onClose={() => {
          setIsCreditMemoModalOpen(false);
          setSelectedCreditMemoReport(null);
          setEditingCreditMemo(null);
          restoreQuickRmaIfPending();
        }}
        report={selectedCreditMemoReport}
        creditMemo={editingCreditMemo}
        currentUser={currentUser}
        reportsList={customerInboundReports}
        savedProductsList={savedProductsList}
        creditMemosCount={creditMemosList?.length || 0}
        onAssignSku={(targetRep) => {
          setIsCreditMemoModalOpen(false);
          handleEditProductFromReport(targetRep);
        }}
        onSaved={(memo) => {
          if (memo) {
            setRecentReportsList(prev => prev.map(r => {
              if (r.rma_number === memo.rma_number || String(r.id) === String(memo.report_id)) {
                return { ...r, status: 'credit_memo_issued' };
              }
              return r;
            }));
          }
          refreshAllData();
          showToast(`Credit Memo ${memo.credit_memo_number} saved!`, 'success');
          restoreQuickRmaIfPending();
        }}
        onViewVoucher={(memo) => {
          setVoucherModalMemo(memo);
          setIsVoucherModalOpen(true);
        }}
      />

      {/* FINANCIAL VALIDATION & SAFETY GUARD MODAL FOR CREDIT MEMO */}
      {creditMemoWarningTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-amber-500/30 max-w-md w-full p-6 shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-amber-100 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 shadow-inner">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="space-y-1.5 min-w-0">
                <h4 className="text-sm font-black text-slate-900 dark:text-white">
                  {creditMemoWarningTarget.title || "Financial Validation & Safety Guard"}
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {creditMemoWarningTarget.message || "Cannot issue Finance Credit Memo for ₱0.00 or unassigned SKU. Please click 'Assign SKU' first to register the official item code and verified price into the catalog."}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setCreditMemoWarningTarget(null)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
              >
                Dismiss
              </button>
              {creditMemoWarningTarget.item && (
                <button
                  type="button"
                  onClick={() => {
                    const target = creditMemoWarningTarget.item;
                    setCreditMemoWarningTarget(null);
                    handleEditProductFromReport(target);
                  }}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm shadow-blue-500/20 cursor-pointer"
                >
                  <Package className="w-3.5 h-3.5" />
                  <span>Assign SKU Now</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Official Printable Credit Memorandum Voucher Modal */}
      <CreditMemoVoucherModal
        isOpen={isVoucherModalOpen}
        onClose={() => {
          setIsVoucherModalOpen(false);
          setVoucherModalMemo(null);
          setVoucherModalMemos([]);
          restoreQuickRmaIfPending();
        }}
        creditMemo={voucherModalMemo}
        creditMemos={voucherModalMemos}
      />

      {/* Fullscreen Image Lightbox Modal */}
      <ImageLightboxModal
        isOpen={Boolean(lightboxPhoto)}
        imageUrl={lightboxPhoto?.url}
        images={lightboxPhoto?.images || (lightboxPhoto?.url ? [lightboxPhoto.url] : [])}
        initialIndex={lightboxPhoto?.initialIndex || 0}
        title={lightboxPhoto?.title}
        subtitle={lightboxPhoto?.subtitle}
        onClose={() => setLightboxPhoto(null)}
      />

      {/* Return Merchandise Authorization QR Sticker Modal */}
      <ReturnQRModal
        isOpen={Boolean(qrModalReport)}
        onClose={() => {
          setQrModalReport(null);
          restoreQuickRmaIfPending();
        }}
        report={qrModalReport}
        onOpenQuickAction={(rma) => {
          setPendingQuickRmaNumber(null);
          setQuickRmaNumber(rma);
          setIsQuickRmaModalOpen(true);
        }}
      />

      {/* RMA QR Code Quick Processing Modal */}
      <QuickRMAActionModal
        isOpen={isQuickRmaModalOpen}
        onClose={handleCloseQuickRma}
        rmaNumber={quickRmaNumber}
        currentUser={currentUser}
        onAdminVerified={(admin) => setCurrentUser(admin)}
        savedProductsList={savedProductsList}
        creditMemosList={creditMemosList}
        recentReportsList={recentReportsList}
        onAssignSku={(reportToEdit) => {
          const currentRma = quickRmaNumber || reportToEdit?.rma_number;
          setPendingQuickRmaNumber(currentRma);
          setIsQuickRmaModalOpen(false);
          handleEditProductFromReport(reportToEdit);
        }}
        onOpenCreditMemo={(rep, existing) => {
          const currentRma = quickRmaNumber || rep?.rma_number;
          setPendingQuickRmaNumber(currentRma);
          setIsQuickRmaModalOpen(false);
          if (existing) {
            setEditingCreditMemo(existing);
            setSelectedCreditMemoReport(rep);
            setIsCreditMemoModalOpen(true);
          } else {
            handleOpenCreditMemoForReport(rep);
          }
        }}
        onViewCreditMemoVoucher={(memo) => {
          const currentRma = quickRmaNumber || memo?.rma_number;
          setPendingQuickRmaNumber(currentRma);
          setIsQuickRmaModalOpen(false);
          setVoucherModalMemo(memo);
          setIsVoucherModalOpen(true);
        }}
        onViewReportQR={(rep) => {
          const currentRma = quickRmaNumber || rep?.rma_number;
          setPendingQuickRmaNumber(currentRma);
          setIsQuickRmaModalOpen(false);
          setQrModalReport(rep);
        }}
        onOpenLightbox={setLightboxPhoto}
        onRefresh={(updated, newChild) => {
          if (newChild) {
            setRecentReportsList(prev => {
              const filtered = prev.filter(r => r.id !== newChild.id && r.rma_number !== newChild.rma_number);
              const updatedList = filtered.map(r => {
                if (updated && (r.id === updated.id || (r.rma_number && r.rma_number === updated.rma_number))) {
                  return { ...r, ...updated };
                }
                return r;
              });
              return [newChild, ...updatedList];
            });
          } else if (updated && (updated.id || updated.rma_number)) {
            setRecentReportsList(prev => prev.map(r => {
              const idMatch = r && r.id && updated.id && String(r.id) === String(updated.id);
              const rmaMatch = r && r.rma_number && updated.rma_number && String(r.rma_number) === String(updated.rma_number) && !r.parent_rma_id;
              if (idMatch || rmaMatch) {
                return { ...r, ...updated };
              }
              // Also synchronize child sub-items if parent manifest's supplier was updated
              if (updated.id && r && r.parent_rma_id && String(r.parent_rma_id) === String(updated.id)) {
                return {
                  ...r,
                  supplier_name: updated.supplier_name || r.supplier_name,
                  supplier: updated.supplier || r.supplier
                };
              }
              return r;
            }));
          }
          refreshAllData();
        }}
      />

      {/* Toast Alert Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-3">
          <div className={`px-4 py-3 rounded-2xl shadow-xl border text-xs font-bold flex items-center gap-2 ${toastMessage.type === 'error'
            ? 'bg-rose-50 border-rose-300 text-rose-800'
            : 'bg-slate-900 border-slate-700 text-white'
            }`}>
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{toastMessage.text}</span>
          </div>
        </div>
      )}

      {/* Universal Delete Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={Boolean(deleteModalState)}
        onClose={() => setDeleteModalState(null)}
        onConfirm={handleConfirmDelete}
        title={deleteModalState?.title || 'Confirm Deletion'}
        itemName={deleteModalState?.itemName}
        itemType={deleteModalState?.itemType || 'item'}
        itemDetails={deleteModalState?.itemDetails}
        isDeleting={isDeleteModalLoading}
      />


      {/* 1-Click Google Identity Lock Gatekeeper Screen */}
      <GatekeeperPinModal
        isOpen={(() => {
          if (typeof window === 'undefined') return false;
          if (isAdminView) return false;

          const urlParams = new URLSearchParams(window.location.search);
          let urlToken = urlParams.get('token');
          if (!urlToken && window.location.hash.includes('token=')) {
            const m = window.location.hash.match(/token=([^&]+)/);
            if (m && m[1]) urlToken = decodeURIComponent(m[1]);
          }
          if (!urlToken) {
            try {
              const isOAuthInProgress =
                localStorage.getItem('rma_oauth_in_progress') === 'true' ||
                sessionStorage.getItem('rma_oauth_in_progress') === 'true';
              if (isOAuthInProgress) {
                urlToken =
                  localStorage.getItem('rma_pending_oauth_token') ||
                  sessionStorage.getItem('rma_pending_oauth_token') ||
                  sessionStorage.getItem('rma_active_invite_token') ||
                  localStorage.getItem('rma_active_invite_token');
              }
            } catch {}
          }

          // If visiting an invite link with a token, the Gatekeeper MUST be locked until this specific token is authenticated!
          if (urlToken) {
            return !gateSession || gateSession.token !== urlToken;
          }

          // Strictly allow direct public portal access without a "?token=" ONLY if authenticated as Super Admin
          if (currentUser?.role === 'super_admin') return false;

          // Lock public portal for everyone else (non-super-admins, regular staff, or unauthenticated visitors without a token)
          return true;
        })()}
        currentSlug={intakeSlug}
        onUnlock={(session) => {
          setGateSession(session);
          try {
            localStorage.setItem('rma_portal_gate_session', JSON.stringify(session));
          } catch { }
          if (session?.authorized_email) {
            setReporterContact(session.authorized_email);
          }
          const entity = inviteService.normalizeEntityName(session?.entity_name || session?.store_branch);
          if (entity) {
            setStoreBranch(entity);
          } else {
            setStoreBranch('');
          }
          showToast(`Portal Unlocked: ${session.profileName || session.authorized_email}`, 'success');
        }}
        onOpenAdminLogin={() => {
          setIsAdminView(true);
          setIsLoginModalOpen(true);
        }}
      />

      {/* Customer RMA Invites Modal (Google Identity Locked Return Links) */}
      <CustomerRMAInvitesModal
        isOpen={isCustomerInvitesModalOpen}
        onClose={() => setIsCustomerInvitesModalOpen(false)}
        currentUser={currentUser}
      />


      {/* 4x6" Thermal Box Label Generator Modal */}
      {thermalPrintReport && (
        <ThermalBoxLabelModal
          isOpen={Boolean(thermalPrintReport)}
          onClose={() => setThermalPrintReport(null)}
          report={thermalPrintReport}
          currentUser={currentUser}
        />
      )}

      {/* Full Reporter Explanation / Notes Viewer Modal */}
      {viewingExplanationModal && (
        <div
          className="fixed inset-0 z-[110] bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setViewingExplanationModal(null)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4 animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-300 font-mono font-black text-[11px] border border-blue-200 dark:border-blue-800">
                    {viewingExplanationModal.rmaNumber || 'RMA Report'}
                  </span>
                  {viewingExplanationModal.reason && (
                    <span className="px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 font-bold text-[10px] border border-rose-200 dark:border-rose-800">
                      {viewingExplanationModal.reason}
                    </span>
                  )}
                </div>
                <h4 className="text-sm font-black text-slate-900 dark:text-white leading-snug">
                  {viewingExplanationModal.productName || 'Returned Item'}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setViewingExplanationModal(null)}
                className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer shrink-0"
                title="Close explanation"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-1.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                Full Reporter Explanation / Notes:
              </span>
              <p className="text-xs text-slate-800 dark:text-slate-100 leading-relaxed whitespace-pre-wrap break-words font-medium">
                {viewingExplanationModal.explanation}
              </p>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
              <span>Reported by: <strong className="text-slate-700 dark:text-slate-300">{viewingExplanationModal.reporter || 'Staff'}</strong></span>
              <button
                type="button"
                onClick={() => setViewingExplanationModal(null)}
                className="px-4 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white font-bold text-xs transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
