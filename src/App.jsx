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
  Moon
} from 'lucide-react';
import { catalogService } from './services/catalogService';
import TablePagination from './components/TablePagination';
import { authService } from './services/authService';
import { supabase } from './supabaseClient';
import ScannerModal from './components/ScannerModal';
import PendingBarcodesModal from './components/PendingBarcodesModal';
import RMAReportsModal from './components/RMAReportsModal';
import AdminLoginModal from './components/AdminLoginModal';
import EmployeeManagementModal from './components/EmployeeManagementModal';
import SavedProductsTab from './components/SavedProductsTab';
import ProductEditModal from './components/ProductEditModal';
import ImageLightboxModal from './components/ImageLightboxModal';

const DEFECT_REASONS = [
  'Damaged Box / Crushed Packaging',
  'Expired / Near Expiry Date',
  'Spoiled / Broken Seal / Leaking',
  'Wrong Item / Incorrect Shipment',
  'Customer Pull-out / Unsold',
  'Other Defect'
];

export default function App() {
  // ROUTE DETECTION: '/' (Public Reporter) vs '/admin' (Staff Admin Portal)
  const [isAdminView, setIsAdminView] = useState(() => {
    const path = window.location.pathname.toLowerCase();
    const hash = window.location.hash.toLowerCase();
    return path === '/admin' || path.startsWith('/admin/') || hash === '#/admin' || window.location.search.includes('admin=true');
  });

  // Authenticated Admin User
  const [currentUser, setCurrentUser] = useState(() => authService.getCurrentUser());
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);

  // Admin Dashboard Active Tab: 'products' | 'reports' | 'search'
  const [adminActiveTab, setAdminActiveTab] = useState('products');

  // Saved Products State
  const [savedProductsList, setSavedProductsList] = useState([]);
  const [isSavedProductsLoading, setIsSavedProductsLoading] = useState(false);
  const [isProductEditOpen, setIsProductEditOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [staffList, setStaffList] = useState([]);

  // Listen to browser navigation
  useEffect(() => {
    const handleLocationChange = () => {
      const path = window.location.pathname.toLowerCase();
      const hash = window.location.hash.toLowerCase();
      const onAdmin = path === '/admin' || path.startsWith('/admin/') || hash === '#/admin' || window.location.search.includes('admin=true');
      setIsAdminView(onAdmin);
      
      // If entering /admin without an active session, open login gate
      if (onAdmin && !authService.getCurrentUser()) {
        setIsLoginModalOpen(true);
      }
    };

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
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.email) {
          const email = session.user.email.toLowerCase().trim();
          const employees = await authService.getEmployees();
          const emp = employees.find(e => e.email.toLowerCase() === email) || {
            name: email.split('@')[0],
            email: email,
            role: email === 'finance2@keysysincorporated.com' ? 'super_admin' : 'inventory_staff',
            is_active: true
          };

          if (emp.is_active === false) {
            authService.logout();
            setCurrentUser(null);
            return;
          }

          const sessionUser = {
            id: emp.id || 1,
            name: emp.name,
            email: emp.email,
            role: emp.role || 'inventory_staff',
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
  }, []);

  const navigateTo = (path) => {
    window.history.pushState({}, '', path);
    const onAdmin = path === '/admin' || path === '#/admin';
    setIsAdminView(onAdmin);
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
    navigateTo('/');
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

  // Role Permissions
  const canManageRoles = currentUser?.role === 'super_admin';
  const canEditProducts = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';
  const canDeleteProducts = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';
  const canDeleteReports = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';
  const canVerifyBarcodes = currentUser?.role !== 'viewer';

  // Delete RMA Return Report Handler
  const handleDeleteReport = async (id, rmaNumber) => {
    if (!canDeleteReports) {
      showToast('You do not have permission to delete RMA reports.', 'error');
      return;
    }
    const confirmed = window.confirm(`Are you sure you want to permanently delete RMA #${rmaNumber}? This action cannot be undone.`);
    if (!confirmed) return;

    try {
      // Optimistically remove from UI immediately
      setRecentReportsList(prev => prev.filter(r => (id ? r.id !== id : r.rma_number !== rmaNumber)));
      await catalogService.deleteReport(id, rmaNumber);
      showToast(`Deleted return report RMA #${rmaNumber}.`, 'success');
      refreshAllData();
    } catch (e) {
      showToast(e.message || 'Failed to delete report', 'error');
      refreshAllData();
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
  const [reportsSortField, setReportsSortField] = useState('id');
  const [reportsSortDirection, setReportsSortDirection] = useState('desc');
  const [reportsCurrentPage, setReportsCurrentPage] = useState(1);
  const [reportsPageSize, setReportsPageSize] = useState(10);

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
    setReportsCurrentPage(1);
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
          (item.reason || '').toLowerCase().includes(q)
        );
        if (!matches) return false;
      }

      if (reportsReasonFilter !== 'all') {
        if ((item.reason || '') !== reportsReasonFilter) return false;
      }

      if (reportsStatusFilter === 'logged' && item.status === 'pending_admin_details') return false;
      if (reportsStatusFilter === 'unknown' && item.status !== 'pending_admin_details') return false;

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
        case 'status':
          valA = a.status === 'pending_admin_details' ? 0 : 1;
          valB = b.status === 'pending_admin_details' ? 0 : 1;
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
  }, [recentReportsList, reportsSearchQuery, reportsReasonFilter, reportsStatusFilter, reportsSortField, reportsSortDirection]);

  // Paginated Return Reports Slice
  const paginatedReports = React.useMemo(() => {
    const start = (reportsCurrentPage - 1) * reportsPageSize;
    return processedReports.slice(start, start + reportsPageSize);
  }, [processedReports, reportsCurrentPage, reportsPageSize]);

  // Real-time synchronization & initial load
  useEffect(() => {
    refreshAllData();
    checkApiConnections();
    captureAccurateGps();

    // 1. Cross-tab & local event bus listener
    const unsubscribeBus = catalogService.onDataChange((evt) => {
      console.log('[Realtime Event Bus] Event:', evt.type);
      refreshAllData();
    });

    // 2. Supabase Realtime channel for instant multi-device / database updates
    const realtimeChannel = supabase
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
      .subscribe();

    // 3. Supabase Auth listener for email signup & magic link verification
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user?.email) {
        const cleanEmail = session.user.email.toLowerCase();
        try {
          const staff = await authService.getEmployees();
          const matched = staff.find(e => e.email?.toLowerCase() === cleanEmail);
          if (matched && matched.is_active !== false) {
            const user = {
              name: matched.name,
              email: matched.email,
              role: matched.role || 'inventory_staff',
              department: matched.department || 'Operations'
            };
            localStorage.setItem('rma_admin_session_v2', JSON.stringify(user));
            setCurrentUser(user);
            setIsAdminView(true);
            setIsLoginModalOpen(false);
            showToast(`Welcome ${matched.name}! Authenticated via email confirmation.`, 'success');
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

    // 5. Fast 3.5-second heartbeat polling so background tabs and mobile stay 100% in sync
    const pollInterval = setInterval(() => {
      refreshAllData();
    }, 3500);

    return () => {
      unsubscribeBus();
      supabase.removeChannel(realtimeChannel);
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
        authService.getEmployees().then(staff => setStaffList(staff || []))
      ]);
    } catch (e) {
      console.warn('Sync notice:', e);
    }
  };

  const showToast = (text, type = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 5000);
  };

  // Add photos selected by user
  const handlePhotoSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const newPhotos = files.map(file => ({
      file,
      previewUrl: URL.createObjectURL(file)
    }));

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

  // Submit RMA Report Handler
  const handleSubmitReport = async (e) => {
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

    setIsSubmitting(true);

    try {
      // 1. Upload photos to Supabase Storage
      const uploadedUrls = [];
      for (const item of photoFiles) {
        if (item.file) {
          const url = await catalogService.uploadPhoto(item.file);
          if (url) uploadedUrls.push(url);
        }
      }

      // 2. Submit report to Supabase
      const res = await catalogService.submitReport({
        barcode: cleanBarcode,
        product: detectedProduct,
        quantity,
        reporterName,
        reporterContact,
        reason: selectedReason,
        explanation,
        photos: uploadedUrls,
        gps: gpsLocation.isAccurate ? gpsLocation : null
      });

      // Show success screen
      setSubmitSuccessReport({
        rmaNumber: res.rmaNumber,
        barcode: cleanBarcode,
        productName: detectedProduct?.name || `Barcode ${cleanBarcode}`,
        quantity,
        reason: selectedReason,
        photoCount: uploadedUrls.length,
        hasGps: gpsLocation.isAccurate
      });

      // Reset form
      setBarcodeInput('');
      setDetectedProduct(null);
      setQuantity(1);
      setSelectedReason(DEFECT_REASONS[0]);
      setExplanation('');
      setPhotoFiles([]);

      // Refresh data
      refreshAllData();
    } catch (err) {
      console.error('Report submission error:', err);
      showToast(err.message, 'warning');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 font-sans p-3 sm:p-6 transition-colors duration-200">
      {/* Dynamic container width: clean mobile intake for public reporter, spacious SaaS for admin */}
      <div className={`${isAdminView ? 'max-w-6xl' : 'max-w-xl'} mx-auto space-y-4 transition-all duration-300`}>

        {/* TOAST ALERT */}
        {toastMessage && (
          <div className={`p-3.5 rounded-2xl border text-xs sm:text-sm flex items-center gap-2 shadow-sm animate-in fade-in ${
            toastMessage.type === 'success' 
              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200' 
              : 'bg-rose-50 dark:bg-rose-950/60 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200'
          }`}>
            {toastMessage.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            )}
            <span className="font-semibold">{toastMessage.text}</span>
          </div>
        )}

        {/* ================================================================= */}
        {/* 1. PUBLIC REPORTER PORTAL (Accessible at '/' or default)          */}
        {/* ================================================================= */}
        {!isAdminView && (
          <div className="space-y-4 animate-in fade-in duration-200">
            
            {/* Header with Theme Toggle */}
            <div className="relative text-center space-y-1.5 py-2">
              <div className="absolute right-0 top-0">
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="p-2.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white shadow-xs transition-colors"
                  title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                  aria-label="Toggle Theme"
                >
                  {isDarkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
                </button>
              </div>

              <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-300 inline-block">
                Customer & Warehouse Returns
              </span>
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                Report Item for Return
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Scan code, attach proof photo, and submit return report.
              </p>
            </div>

            {/* Submission Success Screen */}
            {submitSuccessReport ? (
              <div className="bg-white border border-emerald-200 rounded-3xl p-6 sm:p-8 shadow-sm text-center space-y-4 animate-in zoom-in-95">
                <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
                  <CheckCircle className="w-8 h-8" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900">Return Report Filed!</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Your report has been logged and the inventory team has been notified.
                  </p>
                </div>

                <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-2xl text-left text-xs space-y-2">
                  <div className="flex justify-between border-b border-emerald-200/80 pb-1.5">
                    <span className="text-slate-500">RMA Number:</span>
                    <strong className="font-mono text-emerald-800 text-sm">{submitSuccessReport.rmaNumber}</strong>
                  </div>
                  <div className="flex justify-between border-b border-emerald-200/80 pb-1.5">
                    <span className="text-slate-500">Barcode:</span>
                    <strong className="font-mono text-slate-800">{submitSuccessReport.barcode}</strong>
                  </div>
                  <div className="flex justify-between border-b border-emerald-200/80 pb-1.5">
                    <span className="text-slate-500">Item:</span>
                    <strong className="text-slate-800 text-right">{submitSuccessReport.productName}</strong>
                  </div>
                  <div className="flex justify-between border-b border-emerald-200/80 pb-1.5">
                    <span className="text-slate-500">Reason:</span>
                    <strong className="text-slate-800">{submitSuccessReport.reason}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Photos Attached:</span>
                    <strong className="text-emerald-700">{submitSuccessReport.photoCount} Image(s)</strong>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSubmitSuccessReport(null)}
                  className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-2xl shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>Report Another Item</span>
                </button>
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

                    <div className="flex items-center border border-slate-300 dark:border-slate-700 rounded-2xl bg-slate-50 dark:bg-slate-800 px-2 py-1">
                      <button
                        type="button"
                        onClick={() => setQuantity(Math.max(1, quantity - 1))}
                        className="p-1 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-6 text-center text-xs font-black text-slate-800 dark:text-slate-200">{quantity}</span>
                      <button
                        type="button"
                        onClick={() => setQuantity(quantity + 1)}
                        className="p-1 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
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
                    {currentUser.role === 'super_admin' ? '👑 Super Admin' : currentUser.role}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Logged in as <strong className="text-slate-800 dark:text-slate-200">{currentUser.name}</strong> • {currentUser.email}
                </p>
              </div>

              <div className="flex items-center gap-2 self-start md:self-auto">
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

            {/* SaaS KPI Overview Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Metric 1: Saved Products */}
              <div 
                onClick={() => setAdminActiveTab('products')}
                className={`bg-white dark:bg-slate-900 border rounded-3xl p-4 sm:p-5 shadow-sm cursor-pointer transition-all hover:shadow-md ${
                  adminActiveTab === 'products' ? 'border-indigo-500 ring-2 ring-indigo-100 dark:ring-indigo-900/40' : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between text-indigo-600 dark:text-indigo-400 mb-2">
                  <Package className="w-5 h-5" />
                  <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">Database</span>
                </div>
                <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white font-mono">
                  {savedProductsList.length}
                </div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">Saved Products</div>
                <div className="text-[11px] text-slate-400 dark:text-slate-500">Custom items in catalog</div>
              </div>

              {/* Metric 2: Return Reports */}
              <div 
                onClick={() => setAdminActiveTab('reports')}
                className={`bg-white dark:bg-slate-900 border rounded-3xl p-4 sm:p-5 shadow-sm cursor-pointer transition-all hover:shadow-md ${
                  adminActiveTab === 'reports' ? 'border-blue-500 ring-2 ring-blue-100 dark:ring-blue-900/40' : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between text-blue-600 dark:text-blue-400 mb-2">
                  <FileText className="w-5 h-5" />
                  <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300">Reports</span>
                </div>
                <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white font-mono">
                  {recentReportsList.length}
                </div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">RMA Returns</div>
                <div className="text-[11px] text-slate-400 dark:text-slate-500">Total filed returns</div>
              </div>

              {/* Metric 3: Pending Barcodes */}
              <div 
                onClick={() => setIsPendingModalOpen(true)}
                className={`bg-white dark:bg-slate-900 border rounded-3xl p-4 sm:p-5 shadow-sm cursor-pointer transition-all hover:shadow-md ${
                  pendingBarcodesList.length > 0 ? 'border-amber-400 bg-amber-50/20 dark:bg-amber-950/20' : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between text-amber-600 dark:text-amber-400 mb-2">
                  <AlertTriangle className="w-5 h-5" />
                  <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">Action Req.</span>
                </div>
                <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white font-mono">
                  {pendingBarcodesList.length}
                </div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">Pending Barcodes</div>
                <div className="text-[11px] text-slate-400 dark:text-slate-500">Awaiting admin verification</div>
              </div>

              {/* Metric 4: Staff Directory */}
              <div 
                onClick={() => {
                  if (currentUser.role === 'super_admin') setIsEmployeeModalOpen(true);
                }}
                className={`bg-white dark:bg-slate-900 border rounded-3xl p-4 sm:p-5 shadow-sm ${
                  currentUser.role === 'super_admin' ? 'cursor-pointer hover:shadow-md hover:border-purple-300 dark:hover:border-purple-700' : ''
                } border-slate-200 dark:border-slate-800`}
              >
                <div className="flex items-center justify-between text-purple-600 dark:text-purple-400 mb-2">
                  <Users className="w-5 h-5" />
                  <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">Team</span>
                </div>
                <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white font-mono">
                  {staffList.length || 25}
                </div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">Staff Directory</div>
                <div className="text-[11px] text-slate-400 dark:text-slate-500">Authorized company staff</div>
              </div>
            </div>

            {/* Production-Level Tab Segmented Switcher */}
            <div className="flex flex-wrap items-center gap-2 bg-slate-200/70 dark:bg-slate-800/80 p-1.5 rounded-2xl">
              <button
                type="button"
                onClick={() => setAdminActiveTab('products')}
                className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-all ${
                  adminActiveTab === 'products'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Package className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>Saved Products ({savedProductsList.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setAdminActiveTab('reports')}
                className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-all ${
                  adminActiveTab === 'reports'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Return Reports ({recentReportsList.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setIsPendingModalOpen(true)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-amber-800 dark:text-amber-400 hover:bg-amber-100/60 dark:hover:bg-amber-950/40 flex items-center gap-1.5 ml-auto transition-colors"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>Pending Queue ({pendingBarcodesList.length})</span>
              </button>

              {currentUser.role === 'super_admin' && (
                <button
                  type="button"
                  onClick={() => setIsEmployeeModalOpen(true)}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold text-purple-800 dark:text-purple-400 hover:bg-purple-100/60 dark:hover:bg-purple-950/40 flex items-center gap-1.5 transition-colors"
                >
                  <Users className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
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
                onDeleteProduct={async (prod) => {
                  try {
                    await catalogService.deleteProduct(prod.id, prod.barcode);
                    showToast(`Deleted "${prod.name}" from catalog.`, 'success');
                    refreshAllData();
                  } catch (e) {
                    showToast(e.message, 'warning');
                  }
                }}
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
                      className="px-3.5 py-2 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-bold rounded-xl text-xs flex items-center gap-1 transition-colors shrink-0"
                    >
                      <span>Full Audit Log</span>
                      <ChevronRight className="w-3.5 h-3.5" />
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
                        placeholder="Search by SN (#), RMA #, barcode, item name, reporter, or reason..."
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

                    {/* Status Filter Dropdown */}
                    <select
                      value={reportsStatusFilter}
                      onChange={(e) => {
                        setReportsStatusFilter(e.target.value);
                        setReportsCurrentPage(1);
                      }}
                      className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-600 cursor-pointer"
                    >
                      <option value="all">All Status</option>
                      <option value="logged">Logged / Recognized</option>
                      <option value="unknown">Unknown Barcode</option>
                    </select>

                    {/* Reset Filters */}
                    {(reportsSearchQuery || reportsReasonFilter !== 'all' || reportsStatusFilter !== 'all') && (
                      <button
                        type="button"
                        onClick={resetReportsFilters}
                        className="px-3 py-2 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors shrink-0"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Reset</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 px-1 font-medium">
                    <span>
                      Showing <strong className="text-slate-900 dark:text-white font-bold">{processedReports.length}</strong> of {recentReportsList.length} reports
                      {(reportsSearchQuery || reportsReasonFilter !== 'all' || reportsStatusFilter !== 'all') && (
                        <span className="text-blue-600 dark:text-blue-400 font-bold ml-1.5">• Filter active</span>
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
                            <th 
                              onClick={() => handleReportsSort('status')}
                              className="py-3 px-3 text-center font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                              title="Click to sort by Status"
                            >
                              <div className="flex items-center justify-center">
                                <span>Status</span>
                                {reportsSortField === 'status' ? (
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
                            {canDeleteReports && (
                              <th className="py-3 px-3.5 text-center font-bold select-none text-slate-500 dark:text-slate-400 w-16">
                                Action
                              </th>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                          {paginatedReports.map(item => {
                            const photoList = Array.isArray(item.photos) 
                              ? item.photos 
                              : (typeof item.photos === 'string' ? JSON.parse(item.photos || '[]') : []);

                            return (
                              <tr key={item.id || item.rma_number} className="hover:bg-blue-50/30 dark:hover:bg-slate-800/50 transition-colors">
                                {/* 1. SN COLUMN AT FAR LEFT */}
                                <td className="py-3 px-3.5 font-mono">
                                  <span className="font-black text-blue-900 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200/80 dark:border-blue-800 px-2 py-0.5 rounded-lg text-xs">
                                    #{item.id}
                                  </span>
                                </td>

                                {/* 2. RMA # */}
                                <td className="py-3 px-3.5 font-mono font-bold text-blue-700 dark:text-blue-400">
                                  {item.rma_number}
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
                                        title: item.name || `Return ${item.rma_number}`,
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
                                  {item.code && <div className="text-[10px] text-slate-400 dark:text-slate-500">{item.code}</div>}
                                </td>

                                {/* 5. Item Name */}
                                <td className="py-3 px-3.5 font-bold text-slate-900 dark:text-white max-w-[200px] truncate" title={item.name}>
                                  {item.name || `Unidentified (${item.barcode})`}
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

                                {/* 8. Status */}
                                <td className="py-3 px-3 text-center">
                                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                                    item.status === 'pending_admin_details'
                                      ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                                      : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                  }`}>
                                    {item.status === 'pending_admin_details' ? 'Unknown' : 'Logged'}
                                  </span>
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

                                {/* 10. Action: Delete RMA */}
                                {canDeleteReports && (
                                  <td className="py-2.5 px-3.5 text-center">
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteReport(item.id, item.rma_number)}
                                      className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-xl transition-colors"
                                      title={`Delete RMA #${item.rma_number}`}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
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

                        return (
                          <div 
                            key={item.id || item.rma_number}
                            className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 rounded-2xl space-y-2 transition-all shadow-sm"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-mono font-black text-xs text-blue-900 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200/80 dark:border-blue-800 px-2 py-0.5 rounded-lg">
                                    SN #{item.id}
                                  </span>
                                  <span className="font-mono font-black text-blue-700 dark:text-blue-400 text-sm">
                                    {item.rma_number}
                                  </span>
                                </div>
                                <h4 className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm mt-0.5">
                                  {item.name || `Unidentified (${item.barcode})`}
                                </h4>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300">
                                  {item.reason || 'Damaged'}
                                </span>
                                {canDeleteReports && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteReport(item.id, item.rma_number)}
                                    className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-100 dark:hover:bg-rose-900/50 rounded-xl transition-colors"
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
          setBarcodeInput(code);
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
        onDeleteReport={handleDeleteReport}
      />

      {/* Product Edit / Add Modal */}
      <ProductEditModal
        isOpen={isProductEditOpen}
        onClose={() => {
          setIsProductEditOpen(false);
          setEditingProduct(null);
        }}
        product={editingProduct}
        currentUser={currentUser}
        onSaved={() => {
          refreshAllData();
          showToast('Product saved to catalog!', 'success');
        }}
        onDeleted={(prod) => {
          refreshAllData();
          showToast(`Product "${prod.name}" deleted from catalog.`, 'success');
        }}
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

    </div>
  );
}
