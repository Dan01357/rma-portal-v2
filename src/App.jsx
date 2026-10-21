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
  ShieldAlert
} from 'lucide-react';
import { catalogService } from './services/catalogService';
import { purchaseOrdersApi } from './services/purchaseOrdersApi';
import { authService } from './services/authService';
import { supabase } from './supabaseClient';
import ScannerModal from './components/ScannerModal';
import PendingBarcodesModal from './components/PendingBarcodesModal';
import RMAReportsModal from './components/RMAReportsModal';
import AdminLoginModal from './components/AdminLoginModal';
import EmployeeManagementModal from './components/EmployeeManagementModal';

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

  const handleLogout = () => {
    authService.logout();
    setCurrentUser(null);
    navigateTo('/');
    showToast('Logged out of admin dashboard.', 'success');
  };

  // Database Connection Health States
  const [poApiStatus, setPoApiStatus] = useState({ checking: true, connected: false });
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

  // Admin Lookup State
  const [adminSearchInput, setAdminSearchInput] = useState('');
  const [adminProductResult, setAdminProductResult] = useState(null);
  const [isAdminSearching, setIsAdminSearching] = useState(false);

  // Modals & Queues
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isPendingModalOpen, setIsPendingModalOpen] = useState(false);
  const [isReportsModalOpen, setIsReportsModalOpen] = useState(false);
  const [pendingBarcodesList, setPendingBarcodesList] = useState([]);
  const [recentReportsList, setRecentReportsList] = useState([]);
  const [toastMessage, setToastMessage] = useState(null);

  useEffect(() => {
    refreshAllData();
    captureAccurateGps();
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
        const acc = pos.coords.accuracy || 9999;
        // ONLY accept if accuracy is within 150 meters (real hardware GPS on mobile, not fake desktop IP)
        if (acc <= 150) {
          setGpsLocation({
            loading: false,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: acc,
            isAccurate: true
          });
        } else {
          // Desktop Wi-Fi IP geolocation is too inaccurate (e.g. ±1500m) -> DO NOT RECORD FALSE DATA
          setGpsLocation({ loading: false, latitude: null, longitude: null, accuracy: acc, isAccurate: false });
        }
      },
      () => {
        setGpsLocation({ loading: false, latitude: null, longitude: null, accuracy: null, isAccurate: false });
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  };

  const refreshAllData = async () => {
    // 1. Check Coworker API
    try {
      const poRes = await purchaseOrdersApi.testConnection();
      setPoApiStatus({ checking: false, connected: poRes.connected });
    } catch {
      setPoApiStatus({ checking: false, connected: false });
    }

    // 2. Check Supabase
    try {
      const supaRes = await catalogService.testSupabase();
      setSupaStatus({ checking: false, connected: supaRes.connected, rowsFound: supaRes.rowsFound });
    } catch {
      setSupaStatus({ checking: false, connected: false, rowsFound: 0 });
    }

    // 3. Load pending barcodes
    try {
      const pending = await catalogService.getPendingBarcodes();
      setPendingBarcodesList(pending);
    } catch (e) {
      console.warn('Pending load error:', e);
    }

    // 4. Load recent reports
    try {
      const reports = await catalogService.getRecentReports(30);
      setRecentReportsList(reports);
    } catch (e) {
      console.warn('Reports load error:', e);
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
      const copy = [...prev];
      URL.revokeObjectURL(copy[index].previewUrl);
      copy.splice(index, 1);
      return copy;
    });
  };

  // SUBMIT RMA RETURN REPORT
  const handleReportSubmit = async (e) => {
    e.preventDefault();
    const cleanBarcode = barcodeInput.trim();
    if (!cleanBarcode) {
      showToast('Please scan or enter a barcode first.', 'warning');
      return;
    }
    if (photoFiles.length === 0) {
      showToast('Proof photo is required. Please take or upload at least 1 photo.', 'warning');
      return;
    }
    if (!reporterName.trim()) {
      showToast('Please enter your full name.', 'warning');
      return;
    }
    if (!reporterContact.trim()) {
      showToast('Please enter your contact number or email address.', 'warning');
      return;
    }

    setIsSubmitting(true);
    setToastMessage(null);

    try {
      // 1. Upload photos to Supabase Storage ('rma-photos')
      const uploadedUrls = [];
      for (const item of photoFiles) {
        const url = await catalogService.uploadPhoto(item.file);
        if (url) uploadedUrls.push(url);
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

  // Admin Lookup handler
  const handleAdminLookup = async (code) => {
    const q = (code || adminSearchInput).trim();
    if (!q) return;

    setIsAdminSearching(true);
    setAdminProductResult(null);

    try {
      const found = await catalogService.findProduct(q);
      if (found) {
        setAdminProductResult(found);
      } else {
        showToast(`Item "${q}" not found in catalog or coworker API.`, 'warning');
      }
    } catch (err) {
      showToast(err.message, 'warning');
    } finally {
      setIsAdminSearching(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans p-3 sm:p-6">
      <div className="max-w-xl mx-auto space-y-4">

        {/* TOAST ALERT */}
        {toastMessage && (
          <div className={`p-3.5 rounded-2xl border text-xs sm:text-sm flex items-center gap-2 shadow-sm animate-in fade-in ${
            toastMessage.type === 'success' 
              ? 'bg-emerald-50 border-emerald-300 text-emerald-800' 
              : 'bg-rose-50 border-rose-300 text-rose-800'
          }`}>
            {toastMessage.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span className="font-semibold">{toastMessage.text}</span>
          </div>
        )}

        {/* ================================================================= */}
        {/* 1. PUBLIC REPORTER PORTAL (Accessible at '/' or default)          */}
        {/* ================================================================= */}
        {!isAdminView && (
          <div className="space-y-4 animate-in fade-in duration-200">
            
            {/* Header */}
            <div className="text-center space-y-1">
              <span className="px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-blue-100 text-blue-800 inline-block">
                Customer & Warehouse Returns
              </span>
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                Report Item for Return
              </h1>
              <p className="text-xs text-slate-500">
                Scan code, attach proof photo, and submit return report.
              </p>
            </div>

            {/* Success Confirmation Card */}
            {submitSuccessReport ? (
              <div className="bg-white border-2 border-emerald-500 rounded-3xl p-6 shadow-md text-center space-y-4">
                <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle className="w-8 h-8" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900">
                    Return Report Submitted!
                  </h2>
                  <p className="text-xs font-mono font-bold text-blue-600 mt-0.5">
                    RMA Reference: {submitSuccessReport.rmaNumber}
                  </p>
                </div>

                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-left space-y-1.5 font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Item:</span>
                    <span className="font-bold text-slate-900 truncate max-w-[200px]">{submitSuccessReport.productName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Barcode:</span>
                    <span className="font-bold text-slate-900">{submitSuccessReport.barcode}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Quantity:</span>
                    <span className="font-bold text-slate-900">{submitSuccessReport.quantity} pcs</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Reason:</span>
                    <span className="font-bold text-rose-600">{submitSuccessReport.reason}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Proof Photos:</span>
                    <span className="font-bold text-emerald-600">{submitSuccessReport.photoCount} attached</span>
                  </div>
                  {submitSuccessReport.hasGps && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">GPS:</span>
                      <span className="font-bold text-slate-900">Verified 📍</span>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setSubmitSuccessReport(null)}
                  className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm rounded-2xl shadow-md transition-all"
                >
                  Report Another Item
                </button>
              </div>
            ) : (
              /* Reporter Form */
              <form onSubmit={handleReportSubmit} className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-sm space-y-5">
                
                {/* 1. Barcode Scanner Button & Input */}
                <div className="space-y-2">
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-500">
                    1. Product Barcode / QR Code *
                  </label>
                  
                  {/* Phone Camera Scanner Launch */}
                  <button
                    type="button"
                    onClick={() => setIsScannerOpen(true)}
                    className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-extrabold text-sm rounded-2xl flex items-center justify-center gap-2.5 shadow-md shadow-emerald-600/20 transition-all"
                  >
                    <Camera className="w-5 h-5" />
                    <span>Scan with Phone Camera</span>
                  </button>

                  <div className="flex items-center gap-2 pt-1">
                    <div className="relative flex-1">
                      <Barcode className="w-5 h-5 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type="text"
                        required
                        value={barcodeInput}
                        onChange={(e) => setBarcodeInput(e.target.value)}
                        placeholder="Or type barcode here..."
                        className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono font-bold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
                      />
                    </div>

                    {/* Quantity Selector */}
                    <div className="flex items-center border border-slate-300 rounded-xl overflow-hidden bg-slate-50 shrink-0">
                      <button
                        type="button"
                        onClick={() => setQuantity(Math.max(1, quantity - 1))}
                        className="px-2.5 py-2.5 hover:bg-slate-200 text-slate-700"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="px-2.5 font-mono font-black text-sm text-slate-900">
                        {quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => setQuantity(quantity + 1)}
                        className="px-2.5 py-2.5 hover:bg-slate-200 text-slate-700"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* LIVE PRODUCT PREVIEW: Shows Name & Reference Image if already in database! */}
                  {detectedProduct && (
                    <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-2xl flex items-center gap-3 animate-in fade-in">
                      {detectedProduct.imageUrl ? (
                        <div className="w-14 h-14 rounded-xl overflow-hidden border border-emerald-300 bg-white shrink-0">
                          <img src={detectedProduct.imageUrl} alt={detectedProduct.name} className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                          <CheckCircle className="w-6 h-6" />
                        </div>
                      )}
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 block">
                          Verified in Database
                        </span>
                        <div className="font-bold text-slate-900 text-sm">
                          {detectedProduct.name}
                        </div>
                        {detectedProduct.code && (
                          <span className="text-[11px] font-mono text-slate-500">
                            SKU: {detectedProduct.code}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {barcodeInput.trim() && !detectedProduct && !isCheckingBarcode && (
                    <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 p-2 rounded-xl">
                      ℹ️ Unrecorded barcode. You can submit now, and office staff will verify product details.
                    </div>
                  )}
                </div>

                {/* 2. Photo Upload Section (REQUIRED) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-black uppercase tracking-wider text-slate-500">
                      2. Proof Photos (Required) *
                    </label>
                    <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                      At least 1 photo required
                    </span>
                  </div>

                  <label className={`border-2 border-dashed rounded-2xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors ${
                    photoFiles.length === 0 
                      ? 'border-rose-300 bg-rose-50/30 hover:border-rose-400' 
                      : 'border-slate-300 bg-slate-50 hover:border-blue-500'
                  }`}>
                    <div className="p-2.5 bg-white text-blue-600 rounded-xl shadow-sm border border-slate-200">
                      <Upload className="w-5 h-5" />
                    </div>
                    <div className="text-center">
                      <span className="text-xs font-bold text-slate-700 block">
                        Tap to Take Photo with Camera or Upload
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Shows damaged part, box, or defect (single or multiple)
                      </span>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      capture="environment"
                      onChange={handlePhotoSelect}
                      className="hidden"
                    />
                  </label>

                  {/* Thumbnail Previews */}
                  {photoFiles.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      {photoFiles.map((item, idx) => (
                        <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border border-slate-300 group">
                          <img src={item.previewUrl} alt="Proof" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => removePhoto(idx)}
                            className="absolute top-1 right-1 p-1 bg-black/70 hover:bg-rose-600 text-white rounded-full transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 3. Reason for Return */}
                <div className="space-y-2">
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-500">
                    3. Why Are You Returning This Item? *
                  </label>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {DEFECT_REASONS.map(reason => (
                      <button
                        key={reason}
                        type="button"
                        onClick={() => setSelectedReason(reason)}
                        className={`p-2.5 rounded-xl border text-left text-xs font-bold transition-all flex items-center justify-between ${
                          selectedReason === reason
                            ? 'bg-rose-50 border-rose-500 text-rose-900 shadow-sm'
                            : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                        }`}
                      >
                        <span>{reason}</span>
                        {selectedReason === reason && <CheckCircle className="w-4 h-4 text-rose-600 shrink-0" />}
                      </button>
                    ))}
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mt-2 mb-1">
                      Explanation (Optional)
                    </label>
                    <textarea
                      rows="2"
                      value={explanation}
                      onChange={(e) => setExplanation(e.target.value)}
                      placeholder="Optional: Describe what happened..."
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </div>

                {/* 4. Reporter Identity & Contact (REQUIRED) */}
                <div className="space-y-2.5 pt-2 border-t border-slate-100">
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-500">
                    4. Reported By (Contact Info) *
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="relative">
                      <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                      <input
                        type="text"
                        required
                        value={reporterName}
                        onChange={(e) => setReporterName(e.target.value)}
                        placeholder="Your Full Name *"
                        className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-blue-600"
                      />
                    </div>

                    <div className="relative">
                      <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                      <input
                        type="text"
                        required
                        value={reporterContact}
                        onChange={(e) => setReporterContact(e.target.value)}
                        placeholder="Phone Number or Email *"
                        className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-blue-600"
                      />
                    </div>
                  </div>
                </div>

                {/* GPS Status Indicator (Accurate GPS only) */}
                {gpsLocation.isAccurate && (
                  <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl flex items-center gap-1.5 font-mono">
                    <MapPin className="w-3.5 h-3.5" />
                    <span>GPS Auto-Captured (Accurate to ±{Math.round(gpsLocation.accuracy)}m)</span>
                  </div>
                )}

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isSubmitting || !barcodeInput.trim() || photoFiles.length === 0 || !reporterName.trim() || !reporterContact.trim()}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black text-base rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 transition-all"
                >
                  {isSubmitting ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                  <span>Submit Return Report ({quantity} pcs)</span>
                </button>

              </form>
            )}

            {/* Footer with link to Staff Admin Portal */}
            <div className="text-center pt-4">
              <button
                type="button"
                onClick={() => navigateTo('/admin')}
                className="text-xs text-slate-400 hover:text-slate-700 font-semibold flex items-center justify-center gap-1 mx-auto"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Office Staff / Admin Dashboard</span>
              </button>
            </div>

          </div>
        )}

        {/* ================================================================= */}
        {/* 2. STAFF ADMIN PORTAL (Accessible at '/admin' with OTP Auth)      */}
        {/* ================================================================= */}
        {isAdminView && currentUser && (
          <div className="space-y-4 animate-in fade-in duration-200">
            
            {/* Admin Header with Current User Badge & Logout */}
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-lg font-black text-slate-900">
                      🏢 Staff Admin Portal
                    </h1>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-100 text-purple-800 border border-purple-200">
                      {currentUser.role === 'super_admin' ? '👑 Super Admin' : currentUser.role}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Signed in as <strong className="text-slate-800">{currentUser.name}</strong> ({currentUser.email})
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigateTo('/')}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5"
                  >
                    <ArrowRight className="w-3.5 h-3.5 rotate-180" />
                    <span>Public Form</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleLogout}
                    className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold flex items-center gap-1.5"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Logout</span>
                  </button>
                </div>
              </div>

              {/* Action Toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsReportsModalOpen(true)}
                  className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>All RMA Reports ({recentReportsList.length})</span>
                </button>

                {currentUser.role !== 'viewer' && (
                  <button
                    type="button"
                    onClick={() => setIsPendingModalOpen(true)}
                    className={`flex-1 py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 ${
                      pendingBarcodesList.length > 0 
                        ? 'bg-amber-100 border-amber-300 text-amber-900 hover:bg-amber-200' 
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    <span>Pending Barcodes ({pendingBarcodesList.length})</span>
                  </button>
                )}

                {/* SUPER ADMIN ONLY: Employee Access & Role Management */}
                {currentUser.role === 'super_admin' && (
                  <button
                    type="button"
                    onClick={() => setIsEmployeeModalOpen(true)}
                    className="py-2 px-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm"
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>👥 Employee Access & Roles</span>
                  </button>
                )}
              </div>

              {/* Status indicators */}
              <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                <div className="p-2.5 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between">
                  <span className="font-bold text-slate-700">Supabase DB</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                    {supaStatus.connected ? 'ONLINE' : 'CHECK'}
                  </span>
                </div>
                <div className="p-2.5 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between">
                  <span className="font-bold text-slate-700">Coworker API</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                    {poApiStatus.connected ? 'ONLINE' : 'OFFLINE'}
                  </span>
                </div>
              </div>
            </div>

            {/* Catalog Inspector Search */}
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3">
              <span className="text-xs font-black uppercase tracking-wider text-slate-500 block">
                Catalog & Reference Photo Inspector
              </span>

              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAdminLookup();
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={adminSearchInput}
                  onChange={(e) => setAdminSearchInput(e.target.value)}
                  placeholder="Enter barcode or SKU to inspect details..."
                  className="flex-1 px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600"
                />
                <button
                  type="submit"
                  disabled={isAdminSearching}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
                >
                  {isAdminSearching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  <span>Inspect</span>
                </button>
              </form>

              {/* Product Result with Reference Image */}
              {adminProductResult && (
                <div className="p-4 bg-blue-50/60 border border-blue-200 rounded-2xl space-y-2 text-xs">
                  <div className="flex items-center gap-3">
                    {adminProductResult.imageUrl ? (
                      <div className="w-16 h-16 rounded-xl overflow-hidden border border-blue-300 bg-white shrink-0">
                        <img src={adminProductResult.imageUrl} alt={adminProductResult.name} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                        <ImageIcon className="w-6 h-6" />
                      </div>
                    )}
                    <div className="flex-1">
                      <span className="font-bold text-slate-900 text-sm block">
                        {adminProductResult.name}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                        {adminProductResult.source}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 font-mono text-[11px] pt-1">
                    <div>
                      <span className="text-slate-400 block text-[10px]">SKU</span>
                      <span className="font-bold text-slate-800">{adminProductResult.code}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Supplier</span>
                      <span className="font-bold text-slate-800">{adminProductResult.supplierName}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Price (VAT)</span>
                      <span className="font-bold text-emerald-600">₱{Number(adminProductResult.priceWithVat).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Recent Reports List with Photos Preview & Reporter Info */}
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-slate-500">
                  Incoming Return Reports ({recentReportsList.length})
                </span>
                <button
                  type="button"
                  onClick={() => setIsReportsModalOpen(true)}
                  className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1"
                >
                  <span>View All</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {recentReportsList.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">No returns reported yet.</p>
              ) : (
                <div className="space-y-2">
                  {recentReportsList.slice(0, 6).map(item => (
                    <div 
                      key={item.id || item.rma_number}
                      className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-blue-700">{item.rma_number}</span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-800">
                            {item.reason}
                          </span>
                        </div>
                        <div className="font-semibold text-slate-900 mt-0.5">{item.name}</div>
                        <div className="text-[11px] text-slate-500">
                          Reported by: <span className="font-bold text-slate-700">{item.reporter_name || item.reported_by}</span>
                          {item.reporter_contact && <span className="font-mono"> • {item.reporter_contact}</span>}
                        </div>
                      </div>

                      {item.gps_latitude && (
                        <a
                          href={`https://www.google.com/maps?q=${item.gps_latitude},${item.gps_longitude}`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-2 bg-white hover:bg-slate-100 rounded-xl border border-slate-200 text-slate-600 shrink-0"
                          title="Open GPS in Google Maps"
                        >
                          <MapPin className="w-4 h-4 text-rose-500" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

      </div>

      {/* Admin Login Modal (OTP Verification Gate) */}
      <AdminLoginModal
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
