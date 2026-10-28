import React, { useState, useEffect } from 'react';
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
  User,
  Phone,
  Mail,
  Lock,
  LogOut,
  Users,
  ShieldAlert,
  Package,
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
  ClipboardCheck
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
import { exportRMAReportsToCSV } from './utils/exportCsv';
import CreditMemoModal from './components/CreditMemoModal';
import CreditMemoVoucherModal from './components/CreditMemoVoucherModal';
import ProductEditModal from './components/ProductEditModal';
import ImageLightboxModal from './components/ImageLightboxModal';
import NotificationBell from './components/NotificationBell';
import DeleteConfirmationModal from './components/DeleteConfirmationModal';
import ReturnQRModal from './components/ReturnQRModal';
import QuickRMAActionModal from './components/QuickRMAActionModal';
import PortalAccessQRModal from './components/PortalAccessQRModal';
import { QRCodeSVG } from 'qrcode.react';

const DEFECT_REASONS = [
  'Damaged Box / Crushed Packaging',
  'Expired / Near Expiry Date',
  'Spoiled / Broken Seal / Leaking',
  'Wrong Item / Incorrect Shipment',
  'Customer Pull-out / Unsold',
  'Other Defect'
];

/**
 * Universal Lifecycle Stage Formatter & Color Resolver
 */
function formatLifecycleStage(status) {
  if (!status) return { label: 'Received at Dock', color: 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300 border-blue-200 dark:border-blue-800' };
  const s = String(status).toLowerCase();
  switch (s) {
    case 'draft':
      return { label: 'Draft / Intake', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700' };
    case 'pending':
    case 'received_at_dock':
      return { label: 'Received at Dock', color: 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300 border-blue-200 dark:border-blue-800' };
    case 'under_inspection':
      return { label: 'Under Inspection', color: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border-amber-200 dark:border-amber-800' };
    case 'pending_finance_approval':
      return { label: 'Pending Finance', color: 'bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border-purple-200 dark:border-purple-800' };
    case 'credit_memo_issued':
      return { label: 'Credit Memo Issued', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' };
    case 'closed':
    case 'restocked':
      return { label: 'Closed / Restocked', color: 'bg-teal-100 text-teal-800 dark:bg-teal-950/70 dark:text-teal-300 border-teal-200 dark:border-teal-800' };
    case 'rejected':
      return { label: 'Rejected / Invalid', color: 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border-rose-200 dark:border-rose-800' };
    case 'pending_admin_details':
      return { label: 'Awaiting SKU', color: 'bg-orange-100 text-orange-800 dark:bg-orange-950/70 dark:text-orange-300 border-orange-200 dark:border-orange-800' };
    default:
      return { label: s.replace(/_/g, ' '), color: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-300' };
  }
}

export default function App() {
  // ROUTE DETECTION: '/' (Public Reporter) vs '/admin' (Staff Admin Portal)
  const [isAdminView, setIsAdminView] = useState(() => {
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
  const [voucherModalMemo, setVoucherModalMemo] = useState(null);
  const [voucherModalMemos, setVoucherModalMemos] = useState([]);
  const [isVoucherModalOpen, setIsVoucherModalOpen] = useState(false);
  const [qrModalReport, setQrModalReport] = useState(null);

  // Quick RMA Action Modal State (triggered by Box QR scan or ?rma= URL parameter)
  const [isQuickRmaModalOpen, setIsQuickRmaModalOpen] = useState(false);
  const [quickRmaNumber, setQuickRmaNumber] = useState(null);
  const [pendingQuickRmaNumber, setPendingQuickRmaNumber] = useState(null);
  const [isPortalAccessQrOpen, setIsPortalAccessQrOpen] = useState(false);

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
      } catch {}
    }
    if (str.startsWith('{') && str.endsWith('}')) {
      try {
        const parsed = JSON.parse(str);
        if (parsed.rma) return parsed.rma;
      } catch {}
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

        // If user is not logged in locally and not clicking a magic link in URL, ensure Supabase local session is cleared
        if (!localUser && !hasAuthHash) {
          await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
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
            window.history.replaceState(null, '', window.location.pathname);
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
    if (onAdmin && !currentUser) {
      setIsLoginModalOpen(true);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLogout = async () => {
    try {
      await authService.logout();
    } catch (e) {}
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
    } catch (e) {}
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
      } catch (e) {}
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
      } catch (e) {}
    };
    window.addEventListener('storage', handleSyncTestMode);
    window.addEventListener('rma-data-changed', handleSyncTestMode);
    return () => {
      window.removeEventListener('storage', handleSyncTestMode);
      window.removeEventListener('rma-data-changed', handleSyncTestMode);
    };
  }, [currentUser]);

  const toggleTestMode = () => {
    if (currentUser?.role !== 'super_admin') {
      showToast('Simulation / Test Mode is strictly restricted to Super Admin.', 'error');
      setIsTestMode(false);
      try {
        localStorage.setItem('rma_portal_test_mode', 'false');
      } catch (e) {}
      return;
    }

    setIsTestMode(prev => {
      const next = !prev;
      try {
        localStorage.setItem('rma_portal_test_mode', String(next));
        window.dispatchEvent(new Event('storage'));
        window.dispatchEvent(new CustomEvent('rma-data-changed', { detail: { type: 'test-mode-toggled', isTestMode: next } }));
      } catch (e) {}
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
    } catch (e) {}
    return [
      {
        id: 'seed-notif-1',
        type: 'rma',
        title: 'Wholesale RMA Portal Active',
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
    } catch (e) {}
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
        setAdminActiveTab('reports');
      } else {
        setIsReportsModalOpen(true);
      }
    } else if (notif.type === 'unknown') {
      setIsPendingModalOpen(true);
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
    setSelectedCreditMemoReport(report);
    setEditingCreditMemo(null);
    setIsCreditMemoModalOpen(true);
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
  const handleEditProductFromReport = (report) => {
    if (!report) return;
    const existing = savedProductsList.find(p => p.barcode && String(p.barcode) === String(report.barcode));
    if (existing && existing.is_verified) {
      setEditingProduct(existing);
    } else {
      const cleanName = report.name && !report.name.toLowerCase().includes('unidentified') 
        ? report.name 
        : '';

      // Unassigned barcode: MUST start with NO default product image (empty placeholder state)
      // Never preload damage / defect report photos as product catalog images!
      setEditingProduct({
        name: cleanName,
        barcode: report.barcode || '',
        code: report.code || report.sku || (existing?.code || ''),
        supplier_name: report.supplier_name || existing?.supplier_name || 'Savemore',
        price: report.price || existing?.price || 0,
        price_with_vat: report.price_with_vat || existing?.price_with_vat || report.price || 0,
        unit_name: report.unit_name || existing?.unit_name || 'pc',
        image_url: '', // Strictly empty state / placeholder
        ae_name: report.ae_name || existing?.ae_name || '',
        ae_email: report.ae_email || existing?.ae_email || '',
        company: 'Wholesale Distribution',
        is_verified: false
      });
    }
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
        const photos = item?.photos || [];
        await catalogService.deleteReport(id, rmaNumber, photos);
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
  const [barcodeInput, setBarcodeInput] = useState('');
  const [detectedProduct, setDetectedProduct] = useState(null);
  const [isCheckingBarcode, setIsCheckingBarcode] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [unitName, setUnitName] = useState('pc');
  const [selectedReason, setSelectedReason] = useState(DEFECT_REASONS[0]);
  const [explanation, setExplanation] = useState('');
  const [reporterName, setReporterName] = useState('');
  const [reporterContact, setReporterContact] = useState('');
  const [photoFiles, setPhotoFiles] = useState([]); // Array of { file, previewUrl }
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccessReport, setSubmitSuccessReport] = useState(null);

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

  // Automatically prune orphan report selection IDs whenever recentReportsList updates
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
    } catch (e) {}
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

  const resetReportsFilters = () => {
    setReportsSearchQuery('');
    setReportsReasonFilter('all');
    setReportsStatusFilter('all');
    setReportsDispositionFilter('all');
    setReportsConditionGradeFilter('all');
    setReportsDateFrom('');
    setReportsDateTo('');
    setReportsCurrentPage(1);
    setSelectedReportIds(new Set());
  };

  // Filter and sort return reports
  const processedReports = React.useMemo(() => {
    const q = reportsSearchQuery.toLowerCase().trim();
    let list = recentReportsList.filter(item => {
      if (q) {
        const matches = (
          String(item.id || '').includes(q) ||
          (item.rma_number || '').toLowerCase().includes(q) ||
          (item.barcode || '').toLowerCase().includes(q) ||
          (item.name || '').toLowerCase().includes(q) ||
          (item.reporter_name || item.reported_by || '').toLowerCase().includes(q) ||
          (item.reporter_contact || '').toLowerCase().includes(q) ||
          (item.reason || '').toLowerCase().includes(q) ||
          (item.warehouse_location || '').toLowerCase().includes(q)
        );
        if (!matches) return false;
      }

      if (reportsReasonFilter !== 'all') {
        if ((item.reason || '') !== reportsReasonFilter) return false;
      }

      if (reportsStatusFilter !== 'all') {
        if (reportsStatusFilter === 'logged') {
          if (item.status === 'pending_admin_details') return false;
        } else if (reportsStatusFilter === 'unknown') {
          if (item.status !== 'pending_admin_details') return false;
        } else {
          const s = String(item.status || 'received_at_dock').toLowerCase();
          if (reportsStatusFilter === 'received_at_dock') {
            if (s !== 'pending' && s !== 'received_at_dock') return false;
          } else if (s !== reportsStatusFilter.toLowerCase()) {
            return false;
          }
        }
      }

      // Disposition filter
      if (reportsDispositionFilter !== 'all') {
        const itemDisp = item.disposition || 'Pending Triage';
        if (itemDisp.toLowerCase() !== reportsDispositionFilter.toLowerCase()) return false;
      }

      // Condition Grade filter
      if (reportsConditionGradeFilter !== 'all') {
        const itemGrade = item.condition_grade || 'Unassessed';
        if (!itemGrade.toLowerCase().startsWith(reportsConditionGradeFilter.toLowerCase().charAt(0))) return false;
      }

      // Date Range filters
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
        case 'reason':
          valA = String(a.reason || '').toLowerCase();
          valB = String(b.reason || '').toLowerCase();
          break;
        case 'reporter':
          valA = String(a.reporter_name || a.reported_by || '').toLowerCase();
          valB = String(b.reporter_name || b.reported_by || '').toLowerCase();
          break;
        case 'catalog_status':
          valA = a.status === 'pending_admin_details' ? 0 : 1;
          valB = b.status === 'pending_admin_details' ? 0 : 1;
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

    // 1. Cross-tab & local event bus listener
    const unsubscribeBus = catalogService.onDataChange((evt) => {
      console.log('[Realtime Event Bus] Event:', evt.type);
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
          const staff = await authService.getEmployees();
          const matched = staff.find(e => e.email?.toLowerCase() === cleanEmail) || {
            name: cleanEmail.split('@')[0],
            email: cleanEmail,
            role: cleanEmail === 'finance2@keysysincorporated.com' ? 'super_admin' : 'inventory_staff',
            is_active: true
          };

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
            setIsAdminView(true);
            setIsLoginModalOpen(false);
          }
        } catch (e) {}
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
        } catch (e) {}
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
      return;
    }

    const timer = setTimeout(async () => {
      setIsCheckingBarcode(true);
      try {
        const found = await catalogService.findProduct(clean);
        setDetectedProduct(found);
        if (found?.unit_name || found?.unitName) {
          const u = (found.unit_name || found.unitName).toLowerCase();
          setUnitName(u.includes('case') ? 'case' : 'pc');
        }
      } catch (e) {
        setDetectedProduct(null);
      } finally {
        setIsCheckingBarcode(false);
      }
    }, 400);

    return () => clearTimeout(timer);
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
    } catch (e) {}
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

    const currentBarcode = barcodeInput.trim() || 'DOCK';
    const newPhotos = files.map(file => {
      // Start background upload immediately so it's completed by the time user clicks submit!
      const uploadPromise = catalogService.uploadPhoto(file, currentBarcode).catch(err => {
        console.warn('Background photo upload warning:', err);
        return null;
      });
      return {
        file,
        previewUrl: URL.createObjectURL(file),
        uploadPromise
      };
    });

    setPhotoFiles(prev => [...prev, ...newPhotos]);
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

  // Submit RMA Report Handler - INSTANT response (<0.15s) with background sync
  const handleSubmitReport = (e) => {
    e.preventDefault();
    const cleanBarcode = barcodeInput.trim();
    if (!cleanBarcode) {
      showToast('Please scan or enter a product barcode.', 'warning');
      return;
    }

    if (photoFiles.length === 0) {
      showToast('Proof photo is required. Please attach at least 1 image.', 'warning');
      return;
    }

    if (!reporterName.trim() || !reporterContact.trim()) {
      showToast('Please provide your name and contact information.', 'warning');
      return;
    }

    // 1. Generate unique RMA Number synchronously for instant sticker/QR display
    const rmaNumber = catalogService.generateRMANumber();
    const submitQty = Math.max(1, parseInt(quantity, 10) || 1);
    const finalUnit = unitName || detectedProduct?.unit_name || 'pc';

    // 2. Show success screen with full report details for QR sticker generation INSTANTLY!
    setSubmitSuccessReport({
      rma_number: rmaNumber,
      rmaNumber: rmaNumber,
      barcode: cleanBarcode,
      name: detectedProduct?.name || `Barcode ${cleanBarcode}`,
      productName: detectedProduct?.name || `Barcode ${cleanBarcode}`,
      code: detectedProduct?.code || '',
      sku: detectedProduct?.code || '',
      quantity: submitQty,
      unit_name: finalUnit,
      unit: finalUnit,
      supplier_name: detectedProduct?.supplier_name || 'Warehouse',
      supplier: detectedProduct?.supplier_name || 'Warehouse',
      reason: selectedReason,
      reporter_name: reporterName || 'Staff',
      photoCount: photoFiles.length,
      hasGps: gpsLocation.isAccurate,
      created_at: new Date().toISOString()
    });

    // 3. Reset form fields immediately so UI is completely responsive
    const capturedPhotos = [...photoFiles];
    const capturedProduct = detectedProduct ? { ...detectedProduct, unit_name: finalUnit } : null;
    const capturedReason = selectedReason;
    const capturedExplanation = explanation;
    const capturedReporterName = reporterName;
    const capturedReporterContact = reporterContact;
    const capturedGps = gpsLocation.isAccurate ? gpsLocation : null;

    setBarcodeInput('');
    setDetectedProduct(null);
    setQuantity(1);
    setUnitName('pc');
    setSelectedReason(DEFECT_REASONS[0]);
    setExplanation('');
    setPhotoFiles([]);
    setSelectedReportIds(new Set());
    setIsSubmitting(false);

    // 4. Background execution: wait for uploads, insert to Supabase, send email, refresh
    (async () => {
      try {
        const uploadPromises = capturedPhotos.map(item => {
          if (item.uploadPromise) return item.uploadPromise;
          if (item.file) return catalogService.uploadPhoto(item.file, cleanBarcode);
          return null;
        }).filter(Boolean);

        const uploadedUrls = (await Promise.all(uploadPromises)).filter(Boolean);

        const res = await catalogService.submitReport({
          rmaNumber,
          barcode: cleanBarcode,
          product: capturedProduct,
          quantity: submitQty,
          reporterName: capturedReporterName,
          reporterContact: capturedReporterContact,
          reason: capturedReason,
          explanation: capturedExplanation,
          photos: uploadedUrls.length > 0 ? uploadedUrls : ['https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=800&auto=format&fit=crop&q=80'],
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
      }
    })();
  };

  return (
    <div className="min-h-dvh bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 font-sans p-3 sm:p-6 lg:p-8 pt-safe pb-safe transition-colors duration-200 overflow-x-clip">
      {/* Dynamic container width: clean mobile intake for public reporter, spacious SaaS for admin */}
      <div id="app-main-view-container" className={`${isAdminView ? 'w-full max-w-7xl' : 'w-full max-w-xl'} mx-auto space-y-4 sm:space-y-6 transition-all duration-300`}>

        {/* ================================================================= */}
        {/* 1. PUBLIC REPORTER PORTAL (Accessible at '/' or default)          */}
        {/* ================================================================= */}
        {!isAdminView && (
          <div className="space-y-4 animate-in fade-in duration-200">
            
            {/* Responsive Top Bar with Badge, QR Poster Access & Theme Toggle */}
            <div className="flex items-center justify-between gap-3 pt-1 pb-1">
              <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-300 inline-block shadow-2xs">
                Customer & Warehouse Returns
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsPortalAccessQrOpen(true)}
                  className="touch-target px-3 py-1.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 shadow-xs transition-colors flex items-center gap-1.5 text-xs font-bold cursor-pointer"
                  title="Open Shareable QR Code & Warehouse Poster"
                >
                  <QrCode className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span className="hidden sm:inline">Portal QR & Poster</span>
                </button>
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="touch-target p-2 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white shadow-xs transition-colors cursor-pointer shrink-0"
                  title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                  aria-label="Toggle Theme"
                >
                  {isDarkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
                </button>
              </div>
            </div>

            {/* Super Admin Status & Sandbox Control Banner on Public Portal:
                Only displayed if the active user is an authenticated Super Admin.
                If not logged in as Super Admin, this banner is invisible and submissions are permanently Live. */}
            {currentUser?.role === 'super_admin' && (
              <div className={`p-3 sm:p-3.5 rounded-2xl border transition-all text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                isTestMode
                  ? 'bg-amber-500/10 dark:bg-amber-950/40 border-amber-500/40 text-amber-900 dark:text-amber-200'
                  : 'bg-emerald-500/10 dark:bg-emerald-950/40 border-emerald-500/40 text-emerald-900 dark:text-emerald-200'
              }`}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`p-2 rounded-xl shrink-0 shadow-xs ${
                    isTestMode ? 'bg-amber-500 text-slate-950 font-black' : 'bg-emerald-600 text-white'
                  }`}>
                    {isTestMode ? <FlaskConical className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <strong className="font-black text-xs">
                        {isTestMode ? '🧪 Super Admin Sandbox Active' : '🟢 Live Delivery Mode Active'}
                      </strong>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/70 dark:bg-slate-900/70 border border-current/20 font-bold">
                        {currentUser.name || 'Danilo Alvaro (Super Admin)'}
                      </span>
                    </div>
                    <p className="text-[11px] opacity-85 leading-snug">
                      {isTestMode 
                        ? 'Test emails routed safely to finance2@keysysincorporated.com' 
                        : 'Official return reports will be sent directly to supplier & Assigned AEs'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-stretch sm:self-center justify-end shrink-0 pt-1 sm:pt-0 border-t sm:border-t-0 border-current/10">
                  <button
                    type="button"
                    onClick={toggleTestMode}
                    className={`touch-target px-3 py-1.5 rounded-xl font-black text-xs transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 ${
                      isTestMode
                        ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/20'
                        : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700'
                    }`}
                    title="Toggle Test / Sandbox Mode"
                  >
                    {isTestMode ? <ToggleRight className="w-4 h-4 text-slate-950" /> : <ToggleLeft className="w-4 h-4 text-slate-400" />}
                    <span>{isTestMode ? 'Test Mode: ON' : 'Test Mode: OFF'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => navigateTo('/admin')}
                    className="touch-target px-3 py-1.5 rounded-xl text-xs font-bold bg-white/80 hover:bg-white dark:bg-slate-800/90 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-2xs transition-all cursor-pointer active:scale-95 flex items-center gap-1"
                    title="Return to Admin Dashboard"
                  >
                    <span>Admin Portal</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
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
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Photos Attached:</span>
                    <strong className="text-emerald-700 dark:text-emerald-400">{submitSuccessReport.photoCount} Image(s)</strong>
                  </div>
                </div>

                {/* Generated RMA QR Code Box Sticker Card */}
                <div className="p-3.5 sm:p-4 bg-white dark:bg-slate-950 border-2 border-dashed border-emerald-300 dark:border-emerald-800 rounded-2xl flex flex-col sm:flex-row items-center gap-3.5 sm:gap-4 text-left shadow-xs">
                  <div className="p-2.5 bg-white rounded-xl border border-slate-300 dark:border-slate-700 shadow-xs shrink-0 text-center">
                    <QRCodeSVG
                      id="filed-report-qr-svg"
                      value={typeof window !== 'undefined' ? `${window.location.origin}/?rma=${encodeURIComponent(submitSuccessReport.rmaNumber)}` : submitSuccessReport.rmaNumber}
                      size={110}
                      level="H"
                      includeMargin={false}
                    />
                    <span className="text-[8px] font-mono font-black text-slate-700 block mt-1 tracking-wider">
                      SCAN FOR RMA
                    </span>
                  </div>

                  <div className="space-y-1 min-w-0 flex-1 text-center sm:text-left">
                    <div className="flex items-center justify-center sm:justify-start gap-1.5">
                      <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300">
                        Box Sticker Ready
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {submitSuccessReport.quantity || 1} unit(s)
                      </span>
                    </div>
                    <div className="font-mono font-black text-slate-900 dark:text-white text-base truncate">
                      {submitSuccessReport.rmaNumber}
                    </div>
                    <div className="font-bold text-slate-800 dark:text-slate-200 text-xs truncate">
                      {submitSuccessReport.productName}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
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
                        await downloadBoxStickerPng({
                          svgElementOrId: 'filed-report-qr-svg',
                          rmaNumber: submitSuccessReport.rmaNumber,
                          supplier: submitSuccessReport.supplier || submitSuccessReport.supplier_name || 'Warehouse',
                          itemName: submitSuccessReport.productName || submitSuccessReport.name || 'Returned Merchandise',
                          barcode: submitSuccessReport.barcode,
                          sku: submitSuccessReport.sku || submitSuccessReport.code || '',
                          quantity: submitSuccessReport.quantity || 1,
                          unit: submitSuccessReport.unit_name || submitSuccessReport.unit || 'pc',
                          reason: submitSuccessReport.reason || 'Defective / Return',
                          reporter: submitSuccessReport.reporter_name || submitSuccessReport.reporter || 'Staff',
                          dateFormatted: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
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
                
                {/* 1. BARCODE SCAN / INPUT */}
                <div className="space-y-2">
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    1. Product Barcode / QR Code *
                  </label>
                  
                  <button
                    type="button"
                    onClick={() => setIsScannerOpen(true)}
                    className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm rounded-2xl flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 transition-all active:scale-[0.99]"
                  >
                    <Camera className="w-5 h-5" />
                    <span>Scan with Phone Camera</span>
                  </button>

                  <div className="flex items-center gap-2 pt-1">
                    <div className="relative flex-1">
                      <Barcode className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type="text"
                        required
                        value={barcodeInput}
                        onChange={(e) => setBarcodeInput(e.target.value)}
                        placeholder="Or type barcode here..."
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-2xl text-xs font-bold font-mono text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 focus:bg-white dark:focus:bg-slate-800"
                      />
                    </div>

                    <div className="flex items-center border border-slate-300 dark:border-slate-700 rounded-2xl bg-slate-50 dark:bg-slate-800 px-1.5 py-1 focus-within:border-blue-600 focus-within:ring-1 focus-within:ring-blue-600 shadow-2xs">
                      <button
                        type="button"
                        onClick={() => setQuantity(Math.max(1, (parseInt(quantity, 10) || 1) - 1))}
                        className="p-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white cursor-pointer active:scale-95 transition-transform"
                        title="Decrease quantity (-1)"
                      >
                        <Minus className="w-3.5 h-3.5" />
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
                        className="w-12 text-center text-xs font-black text-slate-800 dark:text-slate-200 bg-transparent border-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        title="Directly enter return quantity"
                      />
                      <button
                        type="button"
                        onClick={() => setQuantity(Math.max(1, (parseInt(quantity, 10) || 0) + 1))}
                        className="p-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white cursor-pointer active:scale-95 transition-transform"
                        title="Increase quantity (+1)"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Unit Dropdown Selector: "pc" or "case" */}
                    <select
                      value={unitName}
                      onChange={(e) => setUnitName(e.target.value)}
                      className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 focus:bg-white dark:focus:bg-slate-800 cursor-pointer shadow-2xs h-[42px]"
                      title="Select return unit (pc or case)"
                    >
                      <option value="pc">pc</option>
                      <option value="case">case</option>
                    </select>
                  </div>

                  {/* Recognized Product Banner (Shows name & reference image) */}
                  {isCheckingBarcode ? (
                    <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 text-xs flex items-center gap-2 text-slate-500 dark:text-slate-400">
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
                          SKU: {detectedProduct.code} • ₱{Number(detectedProduct.priceWithVat || 0).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  ) : barcodeInput.trim() ? (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-2xl text-xs flex items-center gap-2 text-amber-800 dark:text-amber-200 animate-in fade-in">
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span>
                        Barcode not yet registered. You can still submit! Admin staff will be notified to record the item details.
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* 2. PHOTO UPLOADER (REQUIRED) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                      2. Proof Photos (Required) *
                    </label>
                    <span className="text-[10px] font-bold text-rose-500">At least 1 photo required</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {photoFiles.map((item, idx) => (
                      <div key={idx} className="relative aspect-square rounded-2xl overflow-hidden border-2 border-slate-300 dark:border-slate-700 group shadow-sm bg-slate-100 dark:bg-slate-800">
                        <button
                          type="button"
                          onClick={() => setLightboxPhoto({
                            images: photoFiles.map(p => p.previewUrl),
                            initialIndex: idx,
                            url: item.previewUrl,
                            title: 'Proof Photo',
                            subtitle: `Photo ${idx + 1} of ${photoFiles.length}`
                          })}
                          className="w-full h-full block cursor-zoom-in"
                          title="Click to preview enlarged photo"
                        >
                          <img src={item.previewUrl} alt="Preview" className="w-full h-full object-cover" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removePhoto(idx); }}
                          className="absolute top-1 right-1 p-1 bg-rose-600 text-white rounded-full opacity-80 hover:opacity-100 transition-opacity z-10"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}

                    <label className="aspect-square border-2 border-dashed border-rose-300 dark:border-rose-800/80 hover:border-blue-500 dark:hover:border-blue-400 bg-rose-50/40 dark:bg-rose-950/20 hover:bg-blue-50/50 dark:hover:bg-blue-950/30 rounded-2xl flex flex-col items-center justify-center p-2 text-center cursor-pointer transition-all">
                      <Upload className="w-6 h-6 text-rose-500 mb-1" />
                      <span className="text-[11px] font-extrabold text-slate-700 dark:text-slate-200 leading-tight">
                        Tap to Take Photo with Camera or Upload
                      </span>
                      <span className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">Shows damaged part, box, or defect (single or multiple)</span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        multiple
                        onChange={handlePhotoSelect}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                {/* 3. REASON FOR RETURN */}
                <div className="space-y-2">
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    3. Why are you returning this item? *
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {DEFECT_REASONS.map(reason => (
                      <button
                        key={reason}
                        type="button"
                        onClick={() => setSelectedReason(reason)}
                        className={`p-2.5 rounded-2xl border text-xs font-bold text-left transition-all flex items-center justify-between ${
                          selectedReason === reason
                            ? 'bg-rose-50 dark:bg-rose-950/60 border-rose-400 dark:border-rose-700 text-rose-900 dark:text-rose-200 shadow-sm'
                            : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span>{reason}</span>
                        {selectedReason === reason && <CheckCircle className="w-4 h-4 text-rose-600 shrink-0" />}
                      </button>
                    ))}
                  </div>

                  <input
                    type="text"
                    value={explanation}
                    onChange={(e) => setExplanation(e.target.value)}
                    placeholder="Optional details / explanation..."
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-2xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 focus:bg-white dark:focus:bg-slate-800"
                  />
                </div>

                {/* 4. REPORTER CONTACT INFORMATION */}
                <div className="space-y-2">
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    4. Reporter Information (Required) *
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="relative">
                      <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type="text"
                        required
                        value={reporterName}
                        onChange={(e) => setReporterName(e.target.value)}
                        placeholder="Your Full Name *"
                        className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 focus:bg-white dark:focus:bg-slate-800"
                      />
                    </div>
                    <div className="relative">
                      <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type="text"
                        required
                        value={reporterContact}
                        onChange={(e) => setReporterContact(e.target.value)}
                        placeholder="Phone No. or Email *"
                        className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 focus:bg-white dark:focus:bg-slate-800"
                      />
                    </div>
                  </div>
                </div>

                {/* Submit Action Button */}
                <button
                  type="submit"
                  disabled={isSubmitting || photoFiles.length === 0}
                  className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-black text-sm rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 transition-all active:scale-[0.99]"
                >
                  {isSubmitting ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                  <span>{isSubmitting ? 'Uploading Proof & Saving...' : 'Submit Return Report'}</span>
                </button>

                {/* Footer Switch to Admin */}
                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => navigateTo('/admin')}
                    className="text-xs font-bold text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline"
                  >
                    Warehouse Staff & Admin Portal Access →
                  </button>
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
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                    <span>🏢 Wholesale RMA Operations</span>
                  </h1>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Live Auto-Sync
                  </span>
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                    {currentUser?.role === 'super_admin' ? '👑 Super Admin' : (currentUser?.role || 'Staff')}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Logged in as <strong className="text-slate-800 dark:text-slate-200">{currentUser?.name || 'Authorized Staff'}</strong> • {currentUser?.email || 'Portal Access'}
                </p>
              </div>

              <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
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
                  onClick={() => setIsPortalAccessQrOpen(true)}
                  className="px-3.5 py-2 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
                  title="Generate QR code and poster for users to report returns"
                >
                  <QrCode className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Scan to Report QR</span>
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

            {/* SaaS KPI Overview Strip: Fluid grid tracks for all viewports */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3.5">
              {/* Metric 1: Saved Products */}
              <div 
                onClick={() => setAdminActiveTab('products')}
                className={`bg-white dark:bg-slate-900 border rounded-3xl p-3.5 sm:p-5 shadow-sm cursor-pointer transition-all hover:shadow-md ${
                  adminActiveTab === 'products' ? 'border-indigo-500 ring-2 ring-indigo-100 dark:ring-indigo-900/40' : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between text-indigo-600 dark:text-indigo-400 mb-1.5 sm:mb-2">
                  <Package className="w-5 h-5 shrink-0" />
                  <span className="text-[9px] sm:text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">Database</span>
                </div>
                <div className="text-xl sm:text-3xl font-black text-slate-900 dark:text-white font-mono">
                  {savedProductsList.length}
                </div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">Saved Products</div>
                <div className="text-[10px] sm:text-[11px] text-slate-400 dark:text-slate-500 truncate">Catalog items</div>
              </div>

              {/* Metric 2: Return Reports */}
              <div 
                onClick={() => setAdminActiveTab('reports')}
                className={`bg-white dark:bg-slate-900 border rounded-3xl p-3.5 sm:p-5 shadow-sm cursor-pointer transition-all hover:shadow-md ${
                  adminActiveTab === 'reports' ? 'border-blue-500 ring-2 ring-blue-100 dark:ring-blue-900/40' : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between text-blue-600 dark:text-blue-400 mb-1.5 sm:mb-2">
                  <FileText className="w-5 h-5 shrink-0" />
                  <span className="text-[9px] sm:text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300">Reports</span>
                </div>
                <div className="text-xl sm:text-3xl font-black text-slate-900 dark:text-white font-mono">
                  {recentReportsList.length}
                </div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">RMA Returns</div>
                <div className="text-[10px] sm:text-[11px] text-slate-400 dark:text-slate-500 truncate">Total filed returns</div>
              </div>

              {/* Metric 3: Credit Memos (Finance Section) */}
              <div 
                onClick={() => setAdminActiveTab('credit_memos')}
                className={`bg-white dark:bg-slate-900 border rounded-3xl p-3.5 sm:p-5 shadow-sm cursor-pointer transition-all hover:shadow-md ${
                  adminActiveTab === 'credit_memos' ? 'border-emerald-500 ring-2 ring-emerald-100 dark:ring-emerald-900/40' : 'border-slate-200 dark:border-slate-800'
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

              {/* Metric 4: Pending Barcodes */}
              <div 
                onClick={() => setIsPendingModalOpen(true)}
                className={`bg-white dark:bg-slate-900 border rounded-3xl p-3.5 sm:p-5 shadow-sm cursor-pointer transition-all hover:shadow-md ${
                  pendingBarcodesList.length > 0 ? 'border-amber-400 bg-amber-50/20 dark:bg-amber-950/20' : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between text-amber-600 dark:text-amber-400 mb-1.5 sm:mb-2">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  <span className="text-[9px] sm:text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">Action</span>
                </div>
                <div className="text-xl sm:text-3xl font-black text-slate-900 dark:text-white font-mono">
                  {pendingBarcodesList.length}
                </div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">Pending Barcodes</div>
                <div className="text-[10px] sm:text-[11px] text-slate-400 dark:text-slate-500 truncate">Needs verification</div>
              </div>

              {/* Metric 5: Staff Directory */}
              <div 
                onClick={() => {
                  if (currentUser?.role === 'super_admin') setIsEmployeeModalOpen(true);
                }}
                className={`col-span-2 sm:col-span-1 bg-white dark:bg-slate-900 border rounded-3xl p-3.5 sm:p-5 shadow-sm ${
                  currentUser?.role === 'super_admin' ? 'cursor-pointer hover:shadow-md hover:border-purple-300 dark:hover:border-purple-700' : ''
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
              <button
                type="button"
                onClick={() => setAdminActiveTab('products')}
                className={`touch-target px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  adminActiveTab === 'products'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Package className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <span>Saved Products ({savedProductsList.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setAdminActiveTab('reports')}
                className={`touch-target px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  adminActiveTab === 'reports'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                <span>Return Reports ({recentReportsList.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setAdminActiveTab('credit_memos')}
                className={`touch-target px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  adminActiveTab === 'credit_memos'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Receipt className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Credit Memos ({creditMemosList.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setAdminActiveTab('supplier_claims')}
                className={`touch-target px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  adminActiveTab === 'supplier_claims'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Building2 className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
                <span>Supplier Claims (RTV)</span>
              </button>

              {currentUser?.role === 'super_admin' && (
                <button
                  type="button"
                  onClick={() => setAdminActiveTab('settings')}
                  className={`touch-target px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                    adminActiveTab === 'settings'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Settings className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>Settings & SMTP</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsPendingModalOpen(true)}
                className="touch-target px-3.5 py-2 rounded-xl text-xs font-bold text-amber-800 dark:text-amber-400 hover:bg-amber-100/60 dark:hover:bg-amber-950/40 flex items-center gap-1.5 sm:ml-auto transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>Pending Queue ({pendingBarcodesList.length})</span>
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

            {/* TAB 2: INCOMING RETURN REPORTS */}
            {adminActiveTab === 'reports' && (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-black text-slate-900 dark:text-white tracking-tight">
                        Incoming Return Reports
                      </h3>
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                        {recentReportsList.length} Total
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Recent RMA submissions from warehouse & customer returns.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    {/* View Switcher: Rows vs Cards */}
                    <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl border border-slate-200/80 dark:border-slate-700">
                      <button
                        type="button"
                        onClick={() => handleSetReportsViewMode('table')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all ${
                          reportsViewMode === 'table'
                            ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                        title="Rows / Table View (with SN column)"
                      >
                        <List className="w-3.5 h-3.5" />
                        <span>Rows List</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetReportsViewMode('grid')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all ${
                          reportsViewMode === 'grid'
                            ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                        title="Grid / Cards View"
                      >
                        <LayoutGrid className="w-3.5 h-3.5" />
                        <span>Cards</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsReportsModalOpen(true)}
                      className="px-3.5 py-2 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-bold rounded-xl text-xs flex items-center gap-1 transition-colors shrink-0 cursor-pointer"
                    >
                      <span>Full Audit Log</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => exportRMAReportsToCSV(processedReports)}
                      className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-extrabold rounded-xl text-xs flex items-center gap-1.5 transition-colors shrink-0 shadow-2xs cursor-pointer"
                      title="Export filtered reports to CSV with financial & triage data"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export CSV</span>
                    </button>
                  </div>
                </div>

                {/* Filter / Search & Sort Controls Toolbar */}
                <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-3.5 space-y-2.5">
                  <div className="flex flex-col md:flex-row md:items-center gap-2.5">
                    {/* Search Input */}
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type="text"
                        value={reportsSearchQuery}
                        onChange={(e) => {
                          setReportsSearchQuery(e.target.value);
                          setReportsCurrentPage(1);
                        }}
                        placeholder="Search by SN (#), RMA #, barcode, item name, reporter, or bin location..."
                        className="w-full pl-10 pr-9 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-blue-600 transition-all"
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

                    {/* Reason Filter Dropdown */}
                    <select
                      value={reportsReasonFilter}
                      onChange={(e) => {
                        setReportsReasonFilter(e.target.value);
                        setReportsCurrentPage(1);
                      }}
                      className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-600 cursor-pointer"
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
                      className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-600 cursor-pointer"
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
                      className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-600 cursor-pointer"
                    >
                      <option value="all">All Status & Stages</option>
                      <option value="received_at_dock">Received at Dock</option>
                      <option value="under_inspection">Under Inspection</option>
                      <option value="pending_finance_approval">Pending Finance Approval</option>
                      <option value="credit_memo_issued">Credit Memo Issued</option>
                      <option value="closed">Closed / Restocked</option>
                      <option value="rejected">Rejected / Invalid Claim</option>
                      <option value="logged">Catalog: Logged</option>
                      <option value="unknown">Catalog: Unknown Barcode</option>
                    </select>

                    {/* Date Range Picker */}
                    <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-2.5 py-1 rounded-xl text-xs">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">From:</span>
                      <input
                        type="date"
                        value={reportsDateFrom}
                        onChange={(e) => {
                          setReportsDateFrom(e.target.value);
                          setReportsCurrentPage(1);
                        }}
                        className="bg-transparent text-slate-900 dark:text-white font-mono text-xs focus:outline-none cursor-pointer"
                        title="Filter records from date"
                      />
                      <span className="text-[10px] font-bold text-slate-400 uppercase ml-1">To:</span>
                      <input
                        type="date"
                        value={reportsDateTo}
                        onChange={(e) => {
                          setReportsDateTo(e.target.value);
                          setReportsCurrentPage(1);
                        }}
                        className="bg-transparent text-slate-900 dark:text-white font-mono text-xs focus:outline-none cursor-pointer"
                        title="Filter records to date"
                      />
                    </div>

                    {/* Reset Filters */}
                    {(reportsSearchQuery || reportsReasonFilter !== 'all' || reportsStatusFilter !== 'all' || reportsDispositionFilter !== 'all' || reportsConditionGradeFilter !== 'all' || reportsDateFrom || reportsDateTo) && (
                      <button
                        type="button"
                        onClick={resetReportsFilters}
                        className="px-3 py-2 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors shrink-0 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Reset</span>
                      </button>
                    )}
                  </div>

                  {/* Quick-Filter Chips for Warehouse Disposition */}
                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-2 border-t border-slate-200 dark:border-slate-700/80">
                    <span className="text-[10px] uppercase font-black text-slate-400 shrink-0 mr-1 flex items-center gap-1">
                      <Layers className="w-3 h-3 text-blue-500" />
                      Disposition:
                    </span>
                    {[
                      { id: 'all', label: 'All Dispositions' },
                      { id: 'Pending Triage', label: 'Pending Triage' },
                      { id: 'Restock to Inventory', label: 'Restock' },
                      { id: 'Return to Vendor (RTV)', label: 'Return to Vendor (RTV)' },
                      { id: 'Quarantine', label: 'Quarantine' },
                      { id: 'Scrap / Dispose', label: 'Scrap / Dispose' }
                    ].map(chip => {
                      const isActive = reportsDispositionFilter.toLowerCase() === chip.id.toLowerCase();
                      return (
                        <button
                          key={chip.id}
                          type="button"
                          onClick={() => {
                            setReportsDispositionFilter(chip.id);
                            setReportsCurrentPage(1);
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold shrink-0 transition-all cursor-pointer ${
                            isActive
                              ? 'bg-blue-600 text-white shadow-2xs font-black'
                              : 'bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          {chip.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 px-1 font-medium">
                    <span>
                      Showing <strong className="text-slate-900 dark:text-white font-bold">{processedReports.length}</strong> of {recentReportsList.length} reports
                      {(reportsSearchQuery || reportsReasonFilter !== 'all' || reportsStatusFilter !== 'all' || reportsDispositionFilter !== 'all' || reportsConditionGradeFilter !== 'all' || reportsDateFrom || reportsDateTo) && (
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
                            <th 
                              onClick={() => handleReportsSort('reporter')}
                              className="py-3 px-3.5 font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                              title="Click to sort by Reporter"
                            >
                              <div className="flex items-center">
                                <span>Reported By</span>
                                {reportsSortField === 'reporter' ? (
                                  reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                                ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                              </div>
                            </th>
                            {/* 8. Catalog Status Header */}
                            <th 
                              onClick={() => handleReportsSort('catalog_status')}
                              className="py-3 px-3 text-center font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                              title="Click to sort by Catalog Status"
                            >
                              <div className="flex items-center justify-center">
                                <span>Catalog Status</span>
                                {reportsSortField === 'catalog_status' ? (
                                  reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                                ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                              </div>
                            </th>

                            {/* 9. Lifecycle Stage Header */}
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
                          {paginatedReports.map(item => {
                            const photoList = Array.isArray(item.photos) 
                              ? item.photos 
                              : (typeof item.photos === 'string' ? JSON.parse(item.photos || '[]') : []);
                            const isSelected = selectedReportIds.has(item.id || item.rma_number);
                            const matchedProduct = savedProductsList.find(p => p.barcode && String(p.barcode) === String(item.barcode));
                            const resolvedName = (item.name && !item.name.toLowerCase().startsWith('unidentified')) 
                              ? item.name 
                              : (matchedProduct?.name || item.name || `Unidentified (${item.barcode})`);
                            const isPendingUnknown = !matchedProduct && item.status === 'pending_admin_details';

                            return (
                              <tr 
                                key={item.id || item.rma_number} 
                                onClick={(e) => {
                                  if (e.target.closest('input, button, a')) return;
                                  setQuickRmaNumber(item.rma_number);
                                  setIsQuickRmaModalOpen(true);
                                }}
                                className={`transition-colors cursor-pointer ${
                                  isSelected 
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
                                    #{item.id}
                                  </span>
                                </td>

                                {/* 2. RMA # + QR Sticker Button */}
                                <td className="py-3 px-3.5 font-mono font-bold text-blue-700 dark:text-blue-400">
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setQuickRmaNumber(item.rma_number);
                                        setIsQuickRmaModalOpen(true);
                                      }}
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
                                  <div className="font-bold text-slate-800 dark:text-slate-200">{item.barcode}</div>
                                  {(item.code || matchedProduct?.code) && (
                                    <div className="text-[10px] text-slate-400 dark:text-slate-500">{item.code || matchedProduct?.code}</div>
                                  )}
                                </td>

                                {/* 5. Item Name */}
                                <td className="py-3 px-3.5 font-bold text-slate-900 dark:text-white max-w-[200px] truncate" title={resolvedName}>
                                  {resolvedName}
                                </td>

                                {/* 6. Reason */}
                                <td className="py-3 px-3.5">
                                  <span className="px-2 py-0.5 rounded-lg bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 font-bold text-[10px] inline-block">
                                    {item.reason || 'Damaged'}
                                  </span>
                                </td>

                                {/* 7. Reported By */}
                                <td className="py-3 px-3.5">
                                  <div className="font-bold text-slate-900 dark:text-slate-200 text-[11px]">
                                    {item.reporter_name || item.reported_by || 'Reporter'}
                                  </div>
                                  {item.reporter_contact && (
                                    <div className="font-mono text-slate-500 dark:text-slate-400 text-[10px]">
                                      {item.reporter_contact}
                                    </div>
                                  )}
                                </td>

                                {/* 8. Catalog Status */}
                                <td className="py-3 px-3 text-center whitespace-nowrap">
                                  <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider inline-block ${
                                    isPendingUnknown
                                      ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                                      : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                  }`}>
                                    {isPendingUnknown ? 'Pending SKU' : 'Logged'}
                                  </span>
                                </td>

                                {/* 9. Lifecycle Stage */}
                                <td className="py-3 px-3 text-center whitespace-nowrap">
                                  {(() => {
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
                                  {(() => {
                                    const disp = item.disposition || 'Pending Triage';
                                    let color = 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
                                    if (disp === 'Restock to Inventory') color = 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/70 dark:text-blue-300 dark:border-blue-800';
                                    else if (disp === 'Return to Vendor (RTV)') color = 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/70 dark:text-purple-300 dark:border-purple-800';
                                    else if (disp === 'Quarantine') color = 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800';
                                    else if (disp === 'Scrap / Dispose') color = 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-800';
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
                                      onClick={() => {
                                        setQuickRmaNumber(item.rma_number);
                                        setIsQuickRmaModalOpen(true);
                                      }}
                                      className="px-2 py-1 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/70 dark:hover:bg-amber-900/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                                      title={`Inspect, triage condition grade, and assign rack/bin location for ${item.rma_number}`}
                                    >
                                      <ClipboardCheck className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                      <span>Inspect / Triage</span>
                                    </button>

                                    {canEditProducts && !savedProductsList.some(p => p.barcode && String(p.barcode) === String(item.barcode)) && (
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
                                      if (canEditProducts) {
                                        return (
                                          <button
                                            type="button"
                                            onClick={() => handleOpenCreditMemoForReport(item)}
                                            className="px-2.5 py-1 bg-slate-100 hover:bg-emerald-50 dark:bg-slate-800 dark:hover:bg-emerald-950/50 text-slate-700 hover:text-emerald-700 dark:text-slate-300 dark:hover:text-emerald-300 border border-slate-300 dark:border-slate-700 hover:border-emerald-400 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                                            title="Issue Finance Credit Memo for this Return"
                                          >
                                            <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                            <span>+ Credit Memo</span>
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
                      {paginatedReports.map(item => {
                        const photoList = Array.isArray(item.photos) 
                          ? item.photos 
                          : (typeof item.photos === 'string' ? JSON.parse(item.photos || '[]') : []);
                        const isSelected = selectedReportIds.has(item.id || item.rma_number);
                        const matchedProduct = savedProductsList.find(p => p.barcode && String(p.barcode) === String(item.barcode));
                        const resolvedName = (item.name && !item.name.toLowerCase().startsWith('unidentified')) 
                          ? item.name 
                          : (matchedProduct?.name || item.name || `Unidentified (${item.barcode})`);
                        const isPendingUnknown = !matchedProduct && item.status === 'pending_admin_details';

                        return (
                          <div 
                            key={item.id || item.rma_number}
                            className={`p-4 border rounded-2xl space-y-2 transition-all shadow-sm ${
                              isSelected
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
                                    SN #{item.id}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setQuickRmaNumber(item.rma_number);
                                      setIsQuickRmaModalOpen(true);
                                    }}
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
                                </div>
                                <h4 className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm mt-0.5 truncate" title={resolvedName}>
                                  {resolvedName}
                                </h4>
                                <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                  Barcode: <strong className="text-slate-800 dark:text-slate-200">{item.barcode}</strong>
                                  {(item.code || matchedProduct?.code) && <span> • SKU: {item.code || matchedProduct?.code}</span>}
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
                                  onClick={() => {
                                    setQuickRmaNumber(item.rma_number);
                                    setIsQuickRmaModalOpen(true);
                                  }}
                                  className="px-2 py-0.5 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                                  title={`Inspect condition and set warehouse disposition for ${item.rma_number}`}
                                >
                                  <ClipboardCheck className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                  <span>Triage</span>
                                </button>

                                {canEditProducts && !savedProductsList.some(p => p.barcode && String(p.barcode) === String(item.barcode)) && (
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
                                  if (canEditProducts) {
                                    return (
                                      <button
                                        type="button"
                                        onClick={() => handleOpenCreditMemoForReport(item)}
                                        className="px-2 py-0.5 bg-slate-100 hover:bg-emerald-50 dark:bg-slate-800 dark:hover:bg-emerald-950/50 text-slate-700 hover:text-emerald-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                                        title="Issue Credit Memo"
                                      >
                                        <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                        <span>+ CM</span>
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

                            {/* Reporter Details */}
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                              <span>Reported by: <strong className="text-slate-800 dark:text-slate-200">{item.reporter_name || item.reported_by}</strong></span>
                              <span className="font-mono text-slate-600 dark:text-slate-400">{item.reporter_contact || ''}</span>
                            </div>

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
              />
            )}

            {/* TAB 5: SETTINGS & GOOGLE SMTP NOTIFICATION SERVICE (Super Admin Only) */}
            {adminActiveTab === 'settings' && currentUser?.role === 'super_admin' && (
              <SettingsTab
                isTestMode={isTestMode}
                onToggleTestMode={toggleTestMode}
                onOpenPortalQr={() => setIsPortalAccessQrOpen(true)}
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
          const aeName = prod?.ae_name || prod?.aeName || null;
          const aeEmail = prod?.ae_email || prod?.aeEmail || null;

          if (barcode) {
            // Optimistically update in-memory reports state so UI shows Logged immediately
            setRecentReportsList(prev => prev.map(rep => {
              if (rep.barcode && String(rep.barcode).trim() === barcode) {
                return {
                  ...rep,
                  name: name || rep.name,
                  code: code || rep.code,
                  status: 'logged',
                  supplier_name: supplierName,
                  price: price,
                  price_with_vat: priceWithVat,
                  unit_name: unitName
                };
              }
              return rep;
            }));

            // Persist to Supabase rma_reports table and alert on newly verified pending reports
            try {
              const { data: matchedPending } = await supabase
                .from('rma_reports')
                .select('*')
                .eq('barcode', barcode)
                .or('status.eq.pending_admin_details,name.ilike.%unidentified%');

              await supabase
                .from('rma_reports')
                .update({
                  name: name,
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
        reportsList={recentReportsList}
        creditMemosCount={creditMemosList?.length || 0}
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
        onRefresh={(updated) => {
          if (updated && (updated.id || updated.rma_number)) {
            setRecentReportsList(prev => prev.map(r => 
              (r.id === updated.id || (r.rma_number && r.rma_number === updated.rma_number)) 
                ? { ...r, ...updated } 
                : r
            ));
          }
          refreshAllData();
        }}
      />

      {/* Toast Alert Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-3">
          <div className={`px-4 py-3 rounded-2xl shadow-xl border text-xs font-bold flex items-center gap-2 ${
            toastMessage.type === 'error'
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

      {/* Public Portal Access & Reporting Instructions QR Modal */}
      <PortalAccessQRModal
        isOpen={isPortalAccessQrOpen}
        onClose={() => setIsPortalAccessQrOpen(false)}
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

    </div>
  );
}
