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
  ChevronRight
} from 'lucide-react';
import { catalogService } from './services/catalogService';
import { purchaseOrdersApi } from './services/purchaseOrdersApi';
import ScannerModal from './components/ScannerModal';
import PendingBarcodesModal from './components/PendingBarcodesModal';
import RMAReportsModal from './components/RMAReportsModal';

const DEFECT_REASONS = [
  'Damaged Box / Crushed Packaging',
  'Expired / Near Expiry Date',
  'Spoiled / Broken Seal / Leaking',
  'Wrong Item / Incorrect Shipment',
  'Customer Pull-out / Unsold',
  'Other Defect'
];

export default function App() {
  // Navigation: 'reporter' (simple intake) vs 'admin' (review & catalog)
  const [activePortal, setActivePortal] = useState('reporter');

  // Database Connection Health States
  const [poApiStatus, setPoApiStatus] = useState({ checking: true, connected: false });
  const [supaStatus, setSupaStatus] = useState({ checking: true, connected: false, rowsFound: 0 });

  // Auto GPS Coordinates State
  const [gpsLocation, setGpsLocation] = useState({ loading: true, latitude: null, longitude: null, accuracy: null, error: null });

  // Reporter Intake Form State
  const [barcodeInput, setBarcodeInput] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [selectedReason, setSelectedReason] = useState(DEFECT_REASONS[0]);
  const [explanation, setExplanation] = useState('');
  const [locationSlot, setLocationSlot] = useState('');
  const [photoFiles, setPhotoFiles] = useState([]); // Array of { file, previewUrl }
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccessReport, setSubmitSuccessReport] = useState(null);

  // Admin Lookup & Search State
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
    captureGps();
  }, []);

  // Automatic GPS Location capture
  const captureGps = () => {
    if (!navigator.geolocation) {
      setGpsLocation({ loading: false, error: 'GPS not supported on this browser' });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLocation({
          loading: false,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          error: null
        });
      },
      (err) => {
        console.warn('GPS capture error:', err.message);
        setGpsLocation({ loading: false, error: 'GPS permission denied or unavailable' });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
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
      const reports = await catalogService.getRecentReports(25);
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

    setIsSubmitting(true);
    setToastMessage(null);

    try {
      // 1. Upload photos to Supabase Storage ('rma-photos')
      const uploadedUrls = [];
      for (const item of photoFiles) {
        const url = await catalogService.uploadPhoto(item.file);
        if (url) uploadedUrls.push(url);
      }

      // 2. Fast background check to see if known in Supabase / Coworker catalog
      const knownProduct = await catalogService.findProduct(cleanBarcode);

      // 3. Submit report to Supabase
      const res = await catalogService.submitReport({
        barcode: cleanBarcode,
        product: knownProduct,
        quantity,
        location: locationSlot,
        reason: selectedReason,
        explanation,
        photos: uploadedUrls,
        gps: gpsLocation.latitude ? gpsLocation : null,
        reportedBy: 'Warehouse Staff'
      });

      // Show success screen
      setSubmitSuccessReport({
        rmaNumber: res.rmaNumber,
        barcode: cleanBarcode,
        quantity,
        reason: selectedReason,
        isKnown: res.isKnown,
        photoCount: uploadedUrls.length,
        hasGps: Boolean(gpsLocation.latitude)
      });

      // Reset form
      setBarcodeInput('');
      setQuantity(1);
      setSelectedReason(DEFECT_REASONS[0]);
      setExplanation('');
      setLocationSlot('');
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

  // Admin Lookup test handler
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

        {/* ============================================================== */}
        {/* PORTAL NAVIGATION TOGGLE BAR                                   */}
        {/* ============================================================== */}
        <div className="bg-white border border-slate-200 rounded-2xl p-2 shadow-sm flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl flex-1">
            <button
              type="button"
              onClick={() => setActivePortal('reporter')}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
                activePortal === 'reporter'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Camera className="w-4 h-4" />
              <span>📱 Reporter Mode</span>
            </button>
            <button
              type="button"
              onClick={() => setActivePortal('admin')}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
                activePortal === 'admin'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Database className="w-4 h-4" />
              <span>🏢 Admin / Review</span>
            </button>
          </div>

          {/* Quick Pending badge */}
          {pendingBarcodesList.length > 0 && (
            <button
              type="button"
              onClick={() => setIsPendingModalOpen(true)}
              className="px-2.5 py-2 bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-900 rounded-xl text-xs font-bold flex items-center gap-1 shrink-0"
              title="Barcodes waiting for product details"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
              <span>{pendingBarcodesList.length}</span>
            </button>
          )}
        </div>

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

        {/* ============================================================== */}
        {/* VIEW 1: DEDICATED REPORTER MODE (Clean, Fast Mobile Intake)    */}
        {/* ============================================================== */}
        {activePortal === 'reporter' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            
            {/* Success Card after submitting */}
            {submitSuccessReport ? (
              <div className="bg-white border-2 border-emerald-500 rounded-3xl p-6 shadow-md text-center space-y-4">
                <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle className="w-8 h-8" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900">
                    Return Report Recorded!
                  </h2>
                  <p className="text-xs font-mono font-bold text-blue-600 mt-0.5">
                    {submitSuccessReport.rmaNumber}
                  </p>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-left space-y-1 font-mono">
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
                      <span className="font-bold text-slate-900">Captured 📍</span>
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
              /* Main Reporter Form */
              <form onSubmit={handleReportSubmit} className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-sm space-y-5">
                
                {/* Header & Auto-GPS Pill */}
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h1 className="text-lg font-black text-slate-900">
                      Report Return Item
                    </h1>
                    <p className="text-xs text-slate-400">
                      Scan code, take photo, and select reason.
                    </p>
                  </div>

                  {/* Auto GPS Pill */}
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[10px] font-mono font-bold bg-slate-50 border border-slate-200 text-slate-600">
                    <MapPin className={`w-3 h-3 ${gpsLocation.latitude ? 'text-emerald-500' : 'text-amber-500'}`} />
                    {gpsLocation.loading ? (
                      <span>GPS...</span>
                    ) : gpsLocation.latitude ? (
                      <span>GPS Active (±{Math.round(gpsLocation.accuracy || 0)}m)</span>
                    ) : (
                      <span className="text-slate-400">No GPS</span>
                    )}
                  </div>
                </div>

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
                        placeholder="Or type barcode (e.g. 2310943156)..."
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
                </div>

                {/* 2. Photo Upload Section */}
                <div className="space-y-2">
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-500">
                    2. Proof Photos (Damaged Part / Expiry / Defect)
                  </label>

                  {/* Photo picker zone */}
                  <label className="border-2 border-dashed border-slate-300 hover:border-blue-500 bg-slate-50 hover:bg-blue-50/40 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors">
                    <div className="p-2.5 bg-white text-blue-600 rounded-xl shadow-sm border border-slate-200">
                      <Upload className="w-5 h-5" />
                    </div>
                    <div className="text-center">
                      <span className="text-xs font-bold text-slate-700 block">
                        Take Photo with Camera or Upload
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Select one or more photos of damage
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
                </div>

                {/* 4. Optional Explanation & Location */}
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">
                      Explanation / Notes (Optional)
                    </label>
                    <textarea
                      rows="2"
                      value={explanation}
                      onChange={(e) => setExplanation(e.target.value)}
                      placeholder="Describe what is wrong (e.g. Crushed corner on bottom pallet, expired last month)..."
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">
                      Warehouse Location / Rack (Optional)
                    </label>
                    <input
                      type="text"
                      value={locationSlot}
                      onChange={(e) => setLocationSlot(e.target.value)}
                      placeholder="e.g. Pull-out area A, Rack 3"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isSubmitting || !barcodeInput.trim()}
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

          </div>
        )}

        {/* ============================================================== */}
        {/* VIEW 2: ADMIN & REVIEW PORTAL (Reports, Details & Catalog)      */}
        {/* ============================================================== */}
        {activePortal === 'admin' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            
            {/* Database Connections Bar */}
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-base font-black text-slate-900">
                    Admin / Staff Portal
                  </h2>
                  <p className="text-xs text-slate-400">
                    Review logged returns, verify unknown barcodes & inspect database.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsReportsModalOpen(true)}
                    className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 rounded-xl text-xs font-bold flex items-center gap-1.5"
                  >
                    <FileText className="w-3.5 h-3.5 text-blue-600" />
                    <span>Reports ({recentReportsList.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsPendingModalOpen(true)}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 ${
                      pendingBarcodesList.length > 0 
                        ? 'bg-amber-100 border-amber-300 text-amber-900' 
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    <span>Pending Barcodes ({pendingBarcodesList.length})</span>
                  </button>
                </div>
              </div>

              {/* Status indicators */}
              <div className="grid grid-cols-2 gap-2 text-xs">
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
                Catalog & Barcode Inspector
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

              {/* Quick test buttons */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[
                  { label: '2310943156 (Oreo)', code: '2310943156' },
                  { label: '4800016551857 (Nissin)', code: '4800016551857' },
                  { label: 'P2478P (Coworker API)', code: 'P2478P' }
                ].map(btn => (
                  <button
                    key={btn.code}
                    type="button"
                    onClick={() => {
                      setAdminSearchInput(btn.code);
                      handleAdminLookup(btn.code);
                    }}
                    className="px-2.5 py-1 bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 rounded-lg text-[11px] font-mono font-semibold"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>

              {/* Product Inspector Result */}
              {adminProductResult && (
                <div className="p-4 bg-blue-50/60 border border-blue-200 rounded-2xl space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 text-sm">
                      {adminProductResult.name}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                      {adminProductResult.source}
                    </span>
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

            {/* Recent Reports List with Photos Preview */}
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-slate-500">
                  Recent Returns Intake Feed ({recentReportsList.length})
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
                  {recentReportsList.slice(0, 5).map(item => (
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
                        <div className="text-[11px] text-slate-400 font-mono">Barcode: {item.barcode} • Qty: {item.quantity}</div>
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

      {/* Camera Scanner Modal */}
      <ScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={(code) => {
          setIsScannerOpen(false);
          setBarcodeInput(code);
        }}
      />

      {/* Admin Pending Barcodes Modal */}
      <PendingBarcodesModal
        isOpen={isPendingModalOpen}
        onClose={() => setIsPendingModalOpen(false)}
        pendingList={pendingBarcodesList}
        onUpdated={() => {
          refreshAllData();
          showToast('Barcode details updated! System will now recognize this item.', 'success');
        }}
      />

      {/* Full Reports Modal */}
      <RMAReportsModal
        isOpen={isReportsModalOpen}
        onClose={() => setIsReportsModalOpen(false)}
        reports={recentReportsList}
      />

    </div>
  );
}
