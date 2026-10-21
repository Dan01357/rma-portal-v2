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
  Sparkles
} from 'lucide-react';
import { catalogService } from './services/catalogService';
import { purchaseOrdersApi } from './services/purchaseOrdersApi';
import ScannerModal from './components/ScannerModal';
import PendingBarcodesModal from './components/PendingBarcodesModal';
import RMAReportsModal from './components/RMAReportsModal';

export default function App() {
  // 1. Connection Health States
  const [poApiStatus, setPoApiStatus] = useState({ checking: true, connected: false });
  const [supaStatus, setSupaStatus] = useState({ checking: true, connected: false });

  // 2. Search & Scanned Product State
  const [searchInput, setSearchInput] = useState('');
  const [scannedProduct, setScannedProduct] = useState(null);
  const [unidentifiedBarcode, setUnidentifiedBarcode] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [locationInput, setLocationInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  // 3. Modals
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isPendingModalOpen, setIsPendingModalOpen] = useState(false);
  const [isReportsModalOpen, setIsReportsModalOpen] = useState(false);

  // 4. Queues & Data
  const [pendingBarcodesList, setPendingBarcodesList] = useState([]);
  const [recentReportsList, setRecentReportsList] = useState([]);

  // Check connections and load pending barcodes on mount
  useEffect(() => {
    refreshAllData();
  }, []);

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
      setSupaStatus({ checking: false, connected: supaRes.connected });
    } catch {
      setSupaStatus({ checking: false, connected: false });
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
      const reports = await catalogService.getRecentReports(10);
      setRecentReportsList(reports);
    } catch (e) {
      console.warn('Reports load error:', e);
    }
  };

  const showNotice = (text, type = 'success') => {
    setStatusMessage({ text, type });
    setTimeout(() => setStatusMessage(null), 5000);
  };

  // LOOKUP FUNCTION: Searches Supabase first, then Coworker's API
  const handleLookup = async (codeToSearch) => {
    const query = (codeToSearch || searchInput).trim();
    if (!query) return;

    setIsLoading(true);
    setScannedProduct(null);
    setUnidentifiedBarcode(null);

    try {
      const found = await catalogService.findProduct(query);
      if (found) {
        setScannedProduct(found);
        setQuantity(1);
        showNotice(`Found: "${found.name}" (${found.source})`, 'success');
      } else {
        // Not found in either database
        setUnidentifiedBarcode(query);
        setQuantity(1);
        showNotice(`Barcode "${query}" is unknown. You can report it below for admin to update.`, 'warning');
      }
    } catch (err) {
      console.error('Lookup Error:', err);
      showNotice('Lookup error: ' + err.message, 'warning');
    } finally {
      setIsLoading(false);
    }
  };

  // SUBMIT RMA REPORT (Works for both known and unknown items!)
  const handleSubmitReport = async () => {
    const barcode = scannedProduct ? (scannedProduct.barcode || scannedProduct.code) : unidentifiedBarcode;
    if (!barcode) return;

    setIsSubmittingReport(true);
    try {
      const res = await catalogService.submitReport({
        barcode,
        product: scannedProduct,
        quantity,
        location: locationInput,
        reportedBy: 'Warehouse Staff'
      });

      if (res.isKnown) {
        showNotice(`RMA Report ${res.rmaNumber} recorded successfully!`, 'success');
      } else {
        showNotice(`Return recorded (${res.rmaNumber})! Barcode "${barcode}" logged for admin details.`, 'success');
      }

      // Reset active form
      setScannedProduct(null);
      setUnidentifiedBarcode(null);
      setSearchInput('');
      setQuantity(1);
      setLocationInput('');

      // Refresh queues
      refreshAllData();
    } catch (err) {
      console.error('Submit error:', err);
      showNotice('Failed to submit report: ' + err.message, 'warning');
    } finally {
      setIsSubmittingReport(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans p-4 sm:p-8">
      <div className="max-w-2xl mx-auto space-y-5">

        {/* 1. TOP HEADER & CONNECTION STATUS BAR */}
        <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                Wholesale RMA Return Intake
              </h1>
              <p className="text-xs text-slate-500">
                Step 1: Barcode Scanning, Auto-Lookup & Unknown Code Logging
              </p>
            </div>

            {/* Quick Action Navigation */}
            <div className="flex items-center gap-2">
              {/* Pending Unknown Barcodes Button */}
              <button
                type="button"
                onClick={() => setIsPendingModalOpen(true)}
                className={`relative px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all ${
                  pendingBarcodesList.length > 0 
                    ? 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <AlertTriangle className={`w-3.5 h-3.5 ${pendingBarcodesList.length > 0 ? 'text-amber-600' : 'text-slate-400'}`} />
                <span>Pending Barcodes</span>
                {pendingBarcodesList.length > 0 && (
                  <span className="w-5 h-5 bg-amber-500 text-white rounded-full flex items-center justify-center text-[10px] font-black">
                    {pendingBarcodesList.length}
                  </span>
                )}
              </button>

              {/* View Reports Button */}
              <button
                type="button"
                onClick={() => setIsReportsModalOpen(true)}
                className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all"
              >
                <FileText className="w-3.5 h-3.5 text-slate-400" />
                <span>RMA Reports ({recentReportsList.length})</span>
              </button>
            </div>
          </div>

          {/* Database Connections */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {/* Coworker's API Status */}
            <div className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-2xl">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-slate-400" />
                <div>
                  <span className="font-bold text-slate-700 block text-[11px]">Coworker's PO API</span>
                  <span className="text-[10px] text-slate-400">5,793 Products</span>
                </div>
              </div>
              {poApiStatus.checking ? (
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Pinging
                </span>
              ) : poApiStatus.connected ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  ONLINE
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                  OFFLINE
                </span>
              )}
            </div>

            {/* Supabase Status */}
            <div className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-2xl">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-slate-400" />
                <div>
                  <span className="font-bold text-slate-700 block text-[11px]">Your Supabase DB</span>
                  <span className="text-[10px] text-slate-400">rma-system-v2</span>
                </div>
              </div>
              {supaStatus.checking ? (
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Pinging
                </span>
              ) : supaStatus.connected ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  ONLINE
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                  NEED SCHEMA
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 2. TOAST NOTICE */}
        {statusMessage && (
          <div className={`p-3.5 rounded-2xl border text-xs sm:text-sm flex items-center gap-2 shadow-sm animate-in fade-in ${
            statusMessage.type === 'success' 
              ? 'bg-emerald-50 border-emerald-300 text-emerald-800' 
              : 'bg-amber-50 border-amber-300 text-amber-800'
          }`}>
            {statusMessage.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            )}
            <span className="font-semibold">{statusMessage.text}</span>
          </div>
        )}

        {/* 3. SCAN & SEARCH INPUT CARD */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
          
          {/* Phone Camera Scanner Button */}
          <button
            type="button"
            onClick={() => setIsScannerOpen(true)}
            className="w-full py-4 px-5 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-extrabold text-base rounded-2xl flex items-center justify-center gap-3 shadow-lg shadow-emerald-600/25 transition-all"
          >
            <Camera className="w-6 h-6" />
            <span>Launch Phone Camera Barcode Scanner</span>
          </button>

          <div className="flex items-center gap-3 py-0.5">
            <div className="h-px bg-slate-200 flex-1"></div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">or enter barcode manually</span>
            <div className="h-px bg-slate-200 flex-1"></div>
          </div>

          <form 
            onSubmit={(e) => {
              e.preventDefault();
              handleLookup();
            }} 
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Barcode className="w-5 h-5 text-slate-400 absolute left-3.5 top-3.5" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Scan or type barcode (e.g. 2310943156 or 012341453514)..."
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-300 rounded-2xl text-sm font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 focus:bg-white transition-colors"
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || !searchInput.trim()}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-sm rounded-2xl transition-all shadow-md shadow-blue-600/20 flex items-center gap-2 shrink-0"
            >
              {isLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              <span>Lookup</span>
            </button>
          </form>

          {/* Quick test buttons to click */}
          <div className="space-y-1.5 pt-1 border-t border-slate-100">
            <span className="text-[11px] font-semibold text-slate-400 block">
              Quick test barcodes:
            </span>
            <div className="flex flex-wrap gap-2">
              {[
                { label: '2310943156 (Oreo in Supabase)', code: '2310943156' },
                { label: '4800016551857 (Nissin)', code: '4800016551857' },
                { label: 'P2478P (Coworker API)', code: 'P2478P' },
                { label: '012341453514 (Unknown Barcode)', code: '012341453514' }
              ].map(btn => (
                <button
                  key={btn.code}
                  type="button"
                  onClick={() => {
                    setSearchInput(btn.code);
                    handleLookup(btn.code);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 border border-slate-200 text-xs font-mono font-semibold text-slate-700 transition-all"
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 4A. KNOWN PRODUCT RESULT CARD (Item Found in Supabase or Coworker's API) */}
        {scannedProduct && (
          <div className="bg-white border-2 border-emerald-500 rounded-3xl p-6 shadow-md space-y-4 animate-in fade-in duration-200">
            <div className="flex items-start justify-between">
              <div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
                  {scannedProduct.source}
                </span>
                <h2 className="text-lg font-bold text-slate-900 mt-1">
                  {scannedProduct.name}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setScannedProduct(null)}
                className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Product Info Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-slate-50 p-4 rounded-2xl border border-slate-200 font-mono">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-sans font-bold">SKU / Code</span>
                <span className="font-bold text-slate-900 text-sm">{scannedProduct.code || 'N/A'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-sans font-bold">Barcode</span>
                <span className="font-bold text-slate-900 text-sm">{scannedProduct.barcode || 'N/A'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-sans font-bold">Supplier</span>
                <span className="font-bold text-slate-900 text-sm">{scannedProduct.supplierName || 'Savemore'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-sans font-bold">Contract Price (VAT)</span>
                <span className="font-black text-emerald-600 text-base">₱{Number(scannedProduct.priceWithVat).toFixed(2)}</span>
              </div>
            </div>

            {/* Reporting Action Form */}
            <div className="pt-2 border-t border-slate-100 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Quantity Adjustment */}
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Return Quantity ({scannedProduct.unitName || 'pc'})
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={quantity}
                      onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-20 text-center py-2 bg-slate-50 border border-slate-300 rounded-xl text-base font-black text-slate-900 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setQuantity(quantity + 1)}
                      className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                    <span className="text-xs text-slate-400 pl-1">
                      (Total: ₱{(Number(scannedProduct.priceWithVat) * quantity).toFixed(2)})
                    </span>
                  </div>
                </div>

                {/* Optional Location Input */}
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Location Number / Rack (Optional)
                  </label>
                  <div className="relative">
                    <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      value={locationInput}
                      onChange={(e) => setLocationInput(e.target.value)}
                      placeholder="e.g. Rack A-12, Bin 4"
                      className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </div>
              </div>

              {/* Submit Return Button */}
              <button
                type="button"
                disabled={isSubmittingReport}
                onClick={handleSubmitReport}
                className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold text-sm rounded-2xl flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 transition-all"
              >
                {isSubmittingReport ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                <span>Report Item for Return ({quantity} {scannedProduct.unitName || 'pc'})</span>
              </button>
            </div>
          </div>
        )}

        {/* 4B. UNIDENTIFIED BARCODE CARD (Item Not Found in Any Database) */}
        {unidentifiedBarcode && (
          <div className="bg-white border-2 border-amber-500 rounded-3xl p-6 shadow-md space-y-4 animate-in fade-in duration-200">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-100 text-amber-700 rounded-xl">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200">
                    Unknown / Unrecorded Barcode
                  </span>
                  <div className="font-mono text-base font-black text-slate-900 mt-0.5">
                    Barcode: {unidentifiedBarcode}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setUnidentifiedBarcode(null)}
                className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Explanation Note for Reporter */}
            <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-2xl text-xs text-amber-900 space-y-1">
              <p className="font-bold">
                This barcode is not yet registered in Coworker's database or your catalog.
              </p>
              <p className="text-[11px] text-amber-700">
                You do NOT need to enter product details now. Simply submit the return below. The system will record your return, and log this barcode into your database so an admin will be notified to update the item name, supplier, and price.
              </p>
            </div>

            {/* Quantity Selector for Reporter */}
            <div className="pt-2 border-t border-slate-100 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Return Quantity (Pieces)
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={quantity}
                      onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-20 text-center py-2 bg-slate-50 border border-slate-300 rounded-xl text-base font-black text-slate-900 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setQuantity(quantity + 1)}
                      className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Location Number / Rack (Optional)
                  </label>
                  <div className="relative">
                    <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      value={locationInput}
                      onChange={(e) => setLocationInput(e.target.value)}
                      placeholder="e.g. Pull-out area A"
                      className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </div>
              </div>

              {/* Submit Unknown Item Button */}
              <button
                type="button"
                disabled={isSubmittingReport}
                onClick={handleSubmitReport}
                className="w-full py-3.5 px-4 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-extrabold text-sm rounded-2xl flex items-center justify-center gap-2 shadow-md shadow-amber-600/20 transition-all"
              >
                {isSubmittingReport ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                <span>Report Return Anyway & Log Barcode for Admin ({quantity} pcs)</span>
              </button>
            </div>
          </div>
        )}

      </div>

      {/* 5. CAMERA SCANNER MODAL */}
      <ScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={(code) => {
          setIsScannerOpen(false);
          setSearchInput(code);
          handleLookup(code);
        }}
      />

      {/* 6. ADMIN PENDING BARCODES MODAL */}
      <PendingBarcodesModal
        isOpen={isPendingModalOpen}
        onClose={() => setIsPendingModalOpen(false)}
        pendingList={pendingBarcodesList}
        onUpdated={() => {
          refreshAllData();
          showNotice('Barcode details updated! System will now recognize this item.', 'success');
        }}
      />

      {/* 7. RMA REPORTS MODAL */}
      <RMAReportsModal
        isOpen={isReportsModalOpen}
        onClose={() => setIsReportsModalOpen(false)}
        reports={recentReportsList}
      />

    </div>
  );
}
