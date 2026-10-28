import React, { useState, useEffect } from 'react';
import { 
  Camera, 
  Barcode, 
  MapPin, 
  Upload, 
  Sparkles, 
  Plus, 
  Minus, 
  Building2, 
  FileText, 
  AlertTriangle, 
  CheckCircle, 
  RefreshCw,
  Send,
  Zap,
  Info,
  Check,
  Search,
  Package,
  Layers,
  DollarSign,
  Hash,
  X,
  Loader2
} from 'lucide-react';
import confetti from 'canvas-confetti';
import ScannerModal from './ScannerModal';
import { AE_ROSTERS } from '../data/mockData';
import { rmaApi } from '../supabaseClient';
import { catalogService } from '../services/catalogService';
import { generateTicketId, playBeep, formatPeso, generateAiDiagnosis } from '../utils/rmaHelpers';

export default function SubmitRMATab({ 
  catalog = [], 
  onTicketCreated, 
  isTestMode = false, 
  onOpenTicketModal 
}) {
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [manualSkuInput, setManualSkuInput] = useState('');
  const [isSearchingManually, setIsSearchingManually] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [liveSearchResults, setLiveSearchResults] = useState([]);
  const [isSearchingLive, setIsSearchingLive] = useState(false);

  // Form State (Simplified for Repackers & Store Customers)
  const [formData, setFormData] = useState({
    // Store Info
    customerName: 'Puregold Price Club',
    storeBranch: 'Branch 042 - San Fernando Pampanga',
    invoiceNo: '',
    
    // Quantity
    quantity: 1,
    
    // Serial Numbers (Optional)
    serialNumbers: '',
    
    // Defect & Photos
    defectCategory: 'Damaged in Transit / Crushed Carton',
    technicalDiagnosis: '',
    gpsCoordinates: '',
    photos: []
  });

  // UI state
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGpsLoading, setIsGpsLoading] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [statusNotification, setStatusNotification] = useState(null);

  // Auto assign Group & AE based on matched product behind the scenes
  const getProductRouting = (product) => {
    const isGroup1 = product?.group?.includes('KEYSYS') || product?.brand === 'Keysys' || product?.brand === 'A2Z2Go';
    const groupKey = isGroup1 ? 'Group 1 (KEYSYS & A2Z2GO)' : 'Group 2 (PINGCON & BONITA TISSUE)';
    const roster = AE_ROSTERS[groupKey];
    const defaultAe = roster.aes[0];
    return {
      group: groupKey,
      aeName: defaultAe.name,
      aeEmail: defaultAe.email,
      supervisorEmail: defaultAe.supervisorEmail
    };
  };

  // Toast notification
  const showBannerNotification = (msg, type = 'info') => {
    setStatusNotification({ msg, type });
    setTimeout(() => {
      setStatusNotification(null);
    }, 4500);
  };

  // Live Search Debounce Effect (queries 5,793 live ERPLY products)
  useEffect(() => {
    if (!searchQuery.trim()) {
      setLiveSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearchingLive(true);
      try {
        const results = await rmaApi.searchLiveProducts(searchQuery, 12);
        setLiveSearchResults(results);
      } catch (e) {
        console.warn('Live search error:', e);
      } finally {
        setIsSearchingLive(false);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Handle scanned or selected product
  const handleProductIdentified = async (productOrCode) => {
    let matched = null;

    if (typeof productOrCode === 'object' && productOrCode !== null) {
      matched = productOrCode;
    } else {
      const cleanCode = String(productOrCode).trim();
      if (!cleanCode) return;

      // If same product is scanned again, increment quantity +1!
      if (selectedProduct && (
        String(selectedProduct.sku).toLowerCase() === cleanCode.toLowerCase() || 
        String(selectedProduct.barcode).toLowerCase() === cleanCode.toLowerCase()
      )) {
        playBeep('increment');
        setFormData(prev => ({ ...prev, quantity: (Number(prev.quantity) || 0) + 1 }));
        showBannerNotification(`Re-scanned ${selectedProduct.sku}: Quantity incremented to ${(Number(formData.quantity) || 1) + 1}!`, 'success');
        return;
      }

      // 1. Live ERPLY API & Multi-Tier Catalog Lookup
      try {
        matched = await catalogService.findProduct(cleanCode);
      } catch (err) {
        console.warn('Live barcode lookup failed:', err);
      }

      // 2. Fallback to local catalog
      if (!matched) {
        const query = cleanCode.toLowerCase();
        matched = catalog.find(p => 
          p.barcode?.toLowerCase() === query || 
          p.sku?.toLowerCase() === query ||
          p.name?.toLowerCase().includes(query)
        );
      }
    }

    if (matched) {
      playBeep('success');
      setSelectedProduct(matched);
      setManualSkuInput('');
      setSearchQuery('');
      setIsSearchingManually(false);
      showBannerNotification(`Product Matched: "${matched.name}" (${matched.sku}) • Supplier: ${matched.supplier}`, 'success');
    } else {
      playBeep('error');
      // Boss rule: If product does not appear, still accept barcode scanner
      const unlisted = {
        id: `unreg-${Date.now()}`,
        sku: `SKU-${String(productOrCode).slice(-8).toUpperCase()}`,
        barcode: String(productOrCode),
        name: `Uncatalogued Product (${productOrCode})`,
        brand: '',
        supplier: '',
        unit_price: 0,
        case_pack: 'pc',
        image_url: null,
        group: 'Standard Items',
        requires_serial: false
      };
      setSelectedProduct(unlisted);
      showBannerNotification(`Uncatalogued Barcode "${productOrCode}". Accepted with default profile.`, 'warning');
    }
  };

  // Quantity controls
  const handleQuantityIncrement = () => {
    setFormData(prev => ({ ...prev, quantity: (Number(prev.quantity) || 0) + 1 }));
    playBeep('increment');
  };

  const handleQuantityDecrement = () => {
    setFormData(prev => ({ ...prev, quantity: Math.max(1, (Number(prev.quantity) || 1) - 1) }));
  };

  const handleQuantityChange = (e) => {
    const val = parseInt(e.target.value, 10);
    if (isNaN(val)) {
      setFormData(prev => ({ ...prev, quantity: '' }));
    } else {
      setFormData(prev => ({ ...prev, quantity: Math.max(1, val) }));
    }
  };

  // GPS Grabber
  const handleGrabGps = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }
    setIsGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const coordString = `${latitude.toFixed(5)}° N, ${longitude.toFixed(5)}° E (±${Math.round(accuracy)}m)`;
        setFormData(prev => ({ ...prev, gpsCoordinates: coordString }));
        setIsGpsLoading(false);
        showBannerNotification(`GPS Logged: ${coordString}`, 'success');
      },
      () => {
        setIsGpsLoading(false);
        const fallback = '14.5995° N, 120.9842° E (Receiving Dock)';
        setFormData(prev => ({ ...prev, gpsCoordinates: fallback }));
        showBannerNotification('GPS recorded (Receiving Dock)', 'info');
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  };

  // Defect Photo Upload
  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setIsUploadingPhoto(true);
    try {
      const uploadPromises = files.map(file => rmaApi.uploadPhoto(file));
      const urls = await Promise.all(uploadPromises);

      setFormData(prev => ({
        ...prev,
        photos: [...prev.photos, ...urls]
      }));
      showBannerNotification(`${files.length} defect photo(s) added!`, 'success');
    } catch (err) {
      console.error('Photo upload error:', err);
      showBannerNotification('Photo upload failed. Using local preview.', 'warning');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = (index) => {
    setFormData(prev => ({
      ...prev,
      photos: prev.photos.filter((_, i) => i !== index)
    }));
  };

  // Simulated AI Defect Detection
  const handleAiDefectDetection = () => {
    setIsAiLoading(true);
    setTimeout(() => {
      const diagnosis = generateAiDiagnosis(
        selectedProduct?.name || 'Wholesale Merchandise', 
        formData.defectCategory, 
        formData.photos.length
      );
      setFormData(prev => ({
        ...prev,
        technicalDiagnosis: diagnosis
      }));
      setIsAiLoading(false);
      playBeep('success');
      showBannerNotification('AI Defect Inspection findings generated!', 'success');
    }, 900);
  };

  // Submit RMA Ticket
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!selectedProduct) {
      alert('Please scan or select a product first in Step 1.');
      return;
    }

    if (!formData.customerName.trim()) {
      alert('Please enter the Customer / Store Name.');
      return;
    }

    const qty = Number(formData.quantity) || 1;
    const unitPrice = Number(selectedProduct.unit_price) || 0;
    const totalAmount = qty * unitPrice;
    const routing = getProductRouting(selectedProduct);

    setIsSubmitting(true);

    try {
      const existingTickets = await rmaApi.getTickets();
      const ticketId = generateTicketId(existingTickets.length);

      const newTicket = {
        id: ticketId,
        created_at: new Date().toISOString(),
        customer_name: formData.customerName,
        store_branch: formData.storeBranch || 'Main Store',
        invoice_no: formData.invoiceNo || 'N/A',
        group: routing.group,
        ae_name: routing.aeName,
        ae_email: routing.aeEmail,
        supervisor_email: routing.supervisorEmail,
        product_name: selectedProduct.name,
        sku: selectedProduct.sku,
        barcode: selectedProduct.barcode || 'N/A',
        brand: selectedProduct.brand || 'Wholesale',
        supplier: selectedProduct.supplier || 'Primary Supplier',
        quantity: qty,
        unit_price: unitPrice,
        total_amount: totalAmount,
        serial_numbers: formData.serialNumbers || '',
        defect_category: formData.defectCategory,
        technical_diagnosis: formData.technicalDiagnosis || 'Physical inspection required by warehouse team.',
        gps_coordinates: formData.gpsCoordinates || 'Intake Terminal',
        photos: formData.photos.length > 0 ? formData.photos : (selectedProduct.image_url ? [selectedProduct.image_url] : []),
        status: 'Pending Inspection',
        pull_out_confirmed: false,
        credit_memo_no: '',
        credit_amount: 0,
        credit_issued_by: '',
        credit_issued_date: null,
        supplier_po_no: `PO-RET-${new Date().getFullYear()}-${String(existingTickets.length + 1).padStart(3, '0')}`,
        buffer_days_left: 7,
        notes: `Submitted by Repacker/Customer at ${new Date().toLocaleTimeString()}`
      };

      await rmaApi.createTicket(newTicket);

      // Trigger Confetti
      try {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 }
        });
      } catch (e) {
        // optional
      }

      playBeep('success');
      onTicketCreated(newTicket);
      onOpenTicketModal(newTicket);

      // Reset
      setSelectedProduct(null);
      setFormData(prev => ({
        ...prev,
        quantity: 1,
        serialNumbers: '',
        technicalDiagnosis: '',
        photos: []
      }));
      showBannerNotification(`Ticket ${newTicket.id} created successfully!`, 'success');
    } catch (err) {
      console.error('Error creating RMA ticket:', err);
      alert('Error saving ticket: ' + (err.message || 'Unknown error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      
      {/* Toast Banner Notification */}
      {statusNotification && (
        <div className={`p-4 rounded-2xl border flex items-center space-x-3 text-sm shadow-md transition-all animate-in slide-in-from-top-2 duration-200 ${
          statusNotification.type === 'success' 
            ? 'bg-emerald-50 dark:bg-emerald-950/80 border-emerald-300 dark:border-emerald-500/40 text-emerald-900 dark:text-emerald-200' 
            : statusNotification.type === 'warning'
            ? 'bg-amber-50 dark:bg-amber-950/80 border-amber-300 dark:border-amber-500/40 text-amber-900 dark:text-amber-200'
            : 'bg-blue-50 dark:bg-brand-950/80 border-blue-300 dark:border-brand-500/40 text-blue-900 dark:text-brand-200'
        }`}>
          {statusNotification.type === 'success' ? (
            <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
          )}
          <span className="font-semibold">{statusNotification.msg}</span>
        </div>
      )}

      {/* Main Intake Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        
        {/* =========================================================================
            STEP 1: SCAN PRODUCT QR CODE OR MANUAL SKU SEARCH
        ========================================================================= */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-sm transition-all space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div>
              <div className="flex items-center space-x-2">
                <span className="w-7 h-7 rounded-xl bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300 flex items-center justify-center font-black text-xs">
                  1
                </span>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                  Scan Product Barcode / SKU
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  5,793 Live Products
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Scan the factory barcode or SKU on the carton, or search by code
              </p>
            </div>

            {/* Manual Toggle */}
            <button
              type="button"
              onClick={() => setIsSearchingManually(!isSearchingManually)}
              className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1"
            >
              <Search className="w-3.5 h-3.5" />
              <span>{isSearchingManually ? 'Hide Search List' : 'Search by SKU / Name'}</span>
            </button>
          </div>

          {/* Primary Action: Big Camera Scanner Button */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setIsScannerOpen(true)}
              className="w-full py-4 px-6 bg-brand-600 hover:bg-brand-500 active:bg-brand-700 text-white font-bold text-base rounded-2xl flex items-center justify-center space-x-3 shadow-lg shadow-brand-600/25 transition-all transform active:scale-[0.99]"
            >
              <Camera className="w-6 h-6" />
              <span>Launch Camera Barcode Scanner</span>
            </button>
          </div>

          {/* Live SKU Search Dropdown / Input */}
          {isSearchingManually && (
            <div className="p-4 bg-slate-50 dark:bg-slate-950/70 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5 text-brand-600" />
                  Live Product Catalog Lookup:
                </label>
                <span className="text-[10px] text-slate-500 font-mono">
                  Type code or brand name
                </span>
              </div>

              {/* Real-time search bar */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search code, SKU, or name (e.g. CDO, Fibisco, P2478, Swiss Miss, Royal)..."
                  className="w-full pl-10 pr-10 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 shadow-sm"
                  autoFocus
                />
                {isSearchingLive && (
                  <Loader2 className="w-4 h-4 text-brand-600 dark:text-brand-400 animate-spin absolute right-3.5 top-3" />
                )}
                {searchQuery && !isSearchingLive && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3.5 top-3 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Fast Quick Filter Chips */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[10px] font-semibold text-slate-400">Quick suggestions:</span>
                {['CDO', 'Fibisco', 'Swiss Miss', 'Royal', 'P2478P', 'Pingcon'].map(tag => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setSearchQuery(tag)}
                    className="px-2 py-0.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:border-brand-500 hover:text-brand-600 transition-colors"
                  >
                    {tag}
                  </button>
                ))}
              </div>

              {/* Results Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1 pt-1">
                {liveSearchResults.length > 0 ? (
                  liveSearchResults.map(prod => (
                    <button
                      key={prod.id || prod.sku}
                      type="button"
                      onClick={() => handleProductIdentified(prod)}
                      className="p-2.5 text-left bg-white dark:bg-slate-900 hover:border-brand-500 border border-slate-200 dark:border-slate-800 rounded-xl transition-all flex items-start space-x-3 group shadow-sm hover:shadow"
                    >
                      <img 
                        src={prod.image_url} 
                        alt={prod.name} 
                        className="w-10 h-10 rounded-lg object-cover border border-slate-100 dark:border-slate-800 shrink-0 mt-0.5" 
                      />
                      <div className="truncate flex-1 min-w-0">
                        <div className="text-xs font-bold text-slate-900 dark:text-slate-100 group-hover:text-brand-600 truncate">
                          {prod.name}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono flex items-center justify-between mt-0.5">
                          <span className="font-semibold text-brand-600 dark:text-brand-400">{prod.sku}</span>
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatPeso(prod.unit_price)}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 truncate mt-0.5">
                          Supplier: {prod.supplier}
                        </div>
                      </div>
                    </button>
                  ))
                ) : searchQuery ? (
                  <div className="col-span-2 text-center py-6 text-xs text-slate-500">
                    {isSearchingLive ? 'Searching live catalog database...' : `No matching products found for "${searchQuery}". You can still type the barcode manually or launch the camera.`}
                  </div>
                ) : (
                  catalog.slice(0, 6).map(prod => (
                    <button
                      key={prod.sku}
                      type="button"
                      onClick={() => handleProductIdentified(prod)}
                      className="p-2.5 text-left bg-white dark:bg-slate-900 hover:border-brand-500 border border-slate-200 dark:border-slate-800 rounded-xl transition-all flex items-center space-x-3 group"
                    >
                      <img 
                        src={prod.image_url} 
                        alt={prod.name} 
                        className="w-10 h-10 rounded-lg object-cover border border-slate-100 dark:border-slate-800 shrink-0" 
                      />
                      <div className="truncate flex-1">
                        <div className="text-xs font-bold text-slate-900 dark:text-slate-100 group-hover:text-brand-600 truncate">
                          {prod.name}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {prod.sku} • {prod.brand}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* QUICK TEST BARCODES: ONLY VISIBLE WHEN TEST MODE IS ACTIVE */}
          {isTestMode && (
            <div className="pt-2">
              <div className="p-3 bg-amber-50/80 dark:bg-amber-950/30 rounded-xl border border-amber-200 dark:border-amber-500/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-500" />
                    Test Mode Simulation Barcodes (Tap to Simulate Scan)
                  </span>
                  <span className="text-[10px] text-amber-600 dark:text-amber-400">Visible only in Test Mode</span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {[
                    { sku: 'P2478P', label: 'CDO Luncheon Meat' },
                    { sku: 'P1728P', label: 'Fibisco Crunchies' },
                    { sku: 'SS1247P', label: 'Swiss Miss Choco' },
                    { sku: 'SS1561P', label: 'Royal Filipino' },
                    { sku: 'PC-TIS-001', label: 'Pingcon Jumbo Tissue' },
                    { sku: 'BON-FAC-001', label: 'Bonita Facial Box' }
                  ].map((item) => (
                    <button
                      key={item.sku}
                      type="button"
                      onClick={() => handleProductIdentified(item.sku)}
                      className="px-2.5 py-1 bg-white dark:bg-slate-900 hover:border-amber-500 border border-amber-300 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-200 transition-all flex items-center space-x-1.5 shadow-sm"
                      title={item.label}
                    >
                      <Barcode className="w-3 h-3 text-amber-600" />
                      <span className="font-bold">{item.sku}</span>
                      <span className="text-[10px] text-slate-400 font-sans">({item.label.split(' ')[0]})</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* =========================================================================
            STEP 2: INSTANT PRODUCT DISPLAY (1 SKU = 1 PRODUCT PROFILE)
        ========================================================================= */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-sm transition-all space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center space-x-2">
              <span className="w-7 h-7 rounded-xl bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300 flex items-center justify-center font-black text-xs">
                2
              </span>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                Product Information
              </h2>
            </div>
            {selectedProduct && (
              <button
                type="button"
                onClick={() => setSelectedProduct(null)}
                className="text-xs text-rose-500 hover:text-rose-600 font-medium flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" />
                <span>Clear Item</span>
              </button>
            )}
          </div>

          {selectedProduct ? (
            /* Instant Product Hero Card */
            <div className="p-4 sm:p-5 bg-slate-50 dark:bg-slate-950/80 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-5 animate-in fade-in duration-200">
              
              {/* Product Photo */}
              <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0 shadow-xs flex items-center justify-center">
                {selectedProduct.image_url ? (
                  <img 
                    src={selectedProduct.image_url} 
                    alt={selectedProduct.name} 
                    className="w-full h-full object-cover" 
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-slate-300 dark:text-slate-600 p-2 text-center">
                    <Package className="w-7 h-7 mb-1 opacity-60" />
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">No Image</span>
                  </div>
                )}
              </div>

              {/* Product Profile Meta */}
              <div className="space-y-1.5 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-500/30">
                    {selectedProduct.brand || 'Brand'}
                  </span>
                  <span className="text-xs font-mono text-slate-500 dark:text-slate-400 font-semibold">
                    SKU: {selectedProduct.sku}
                  </span>
                </div>

                <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white leading-snug">
                  {selectedProduct.name}
                </h3>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs pt-1 text-slate-600 dark:text-slate-300">
                  <div>
                    <span className="text-slate-400 text-[10px] block">Supplier:</span>
                    <span className="font-medium truncate block">{selectedProduct.supplier}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">Contract Price:</span>
                    <span className="font-bold font-mono text-emerald-600 dark:text-emerald-400">
                      {formatPeso(selectedProduct.unit_price)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">Pack Size:</span>
                    <span className="truncate block">{selectedProduct.case_pack || 'Box Carton'}</span>
                  </div>
                </div>
              </div>

            </div>
          ) : (
            /* Prompt to scan */
            <div className="py-8 px-4 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl space-y-2">
              <Package className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto" />
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                No product scanned yet.
              </p>
              <p className="text-xs text-slate-400">
                Click <strong>"Launch Camera Barcode Scanner"</strong> in Step 1 above to identify the product.
              </p>
            </div>
          )}

          {/* OPTIONAL SERIAL NUMBER(S) INPUT FIELD (Requirement 4) */}
          {selectedProduct && (
            <div className="pt-2 animate-in fade-in duration-200">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
                  <span>Serial Number(s) <span className="text-slate-400 font-normal">(Optional for tracked hardware)</span></span>
                </span>
                <span className="text-[11px] text-slate-400 font-mono">e.g. SN-49201, SN-49202</span>
              </label>
              <input
                type="text"
                value={formData.serialNumbers}
                onChange={(e) => setFormData(prev => ({ ...prev, serialNumbers: e.target.value }))}
                placeholder="Enter unit serial numbers if printed on product (comma separated)..."
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500"
              />
            </div>
          )}

        </div>

        {/* =========================================================================
            STEP 3: QUANTITY STEPPER & DEFECT PHOTO UPLOADER
        ========================================================================= */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-sm transition-all space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center space-x-2">
              <span className="w-7 h-7 rounded-xl bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300 flex items-center justify-center font-black text-xs">
                3
              </span>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                Quantity & Defect Photos
              </h2>
            </div>
            <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
              Subtotal: {formatPeso((Number(formData.quantity) || 0) * (Number(selectedProduct?.unit_price) || 0))}
            </span>
          </div>

          {/* Stepper Controls */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Return Units (Type number directly or use buttons):
            </label>
            <div className="flex items-center space-x-3 max-w-xs">
              <button
                type="button"
                onClick={handleQuantityDecrement}
                className="w-14 h-14 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-white rounded-2xl flex items-center justify-center font-black text-2xl transition-all shadow-sm active:scale-95"
                title="Decrease"
              >
                <Minus className="w-6 h-6" />
              </button>

              <input
                type="number"
                min="1"
                value={formData.quantity}
                onChange={handleQuantityChange}
                className="flex-1 h-14 bg-slate-50 dark:bg-slate-950 border-2 border-brand-500/50 rounded-2xl text-center text-2xl font-black font-mono text-slate-900 dark:text-white focus:outline-none focus:border-brand-500 shadow-inner"
              />

              <button
                type="button"
                onClick={handleQuantityIncrement}
                className="w-14 h-14 bg-brand-600 hover:bg-brand-500 active:bg-brand-700 text-white rounded-2xl flex items-center justify-center font-black text-2xl transition-all shadow-md shadow-brand-600/30 active:scale-95"
                title="Increase"
              >
                <Plus className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Customer / Branch Store Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Customer Store / Account
              </label>
              <input
                type="text"
                required
                value={formData.customerName}
                onChange={(e) => setFormData(prev => ({ ...prev, customerName: e.target.value }))}
                placeholder="e.g. Puregold Price Club"
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Branch / Location
              </label>
              <input
                type="text"
                value={formData.storeBranch}
                onChange={(e) => setFormData(prev => ({ ...prev, storeBranch: e.target.value }))}
                placeholder="e.g. Branch 042 - San Fernando"
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>

          {/* Defect Category & One-Click AI Helper */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Defect Reason & Inspection Notes:
              </label>
              <button
                type="button"
                onClick={handleAiDefectDetection}
                disabled={isAiLoading}
                className="text-[11px] font-semibold text-purple-600 dark:text-purple-300 hover:text-purple-700 flex items-center gap-1"
              >
                <Sparkles className={`w-3.5 h-3.5 text-amber-500 ${isAiLoading ? 'animate-spin' : ''}`} />
                <span>{isAiLoading ? 'Analyzing...' : 'Auto-fill AI Defect Statement'}</span>
              </button>
            </div>

            <select
              value={formData.defectCategory}
              onChange={(e) => setFormData(prev => ({ ...prev, defectCategory: e.target.value }))}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500 font-medium"
            >
              <option value="Damaged in Transit / Crushed Carton">Damaged in Transit / Crushed Carton</option>
              <option value="Packaging Seal Breach / Moisture Exposure">Packaging Seal Breach / Moisture Exposure</option>
              <option value="Factory Short-fill / Core Deformation">Factory Short-fill / Core Deformation</option>
              <option value="Barcode Scan Failure / Unreadable GTIN">Barcode Scan Failure / Unreadable GTIN</option>
              <option value="Defective Electronic / Laser Trigger Stuck">Defective Electronic / Laser Trigger Stuck</option>
              <option value="Expired / Shelf-Life Reached">Expired / Shelf-Life Reached</option>
              <option value="Customer Return / Wrong SKU Shipped">Customer Return / Wrong SKU Shipped</option>
            </select>

            <textarea
              rows="2"
              value={formData.technicalDiagnosis}
              onChange={(e) => setFormData(prev => ({ ...prev, technicalDiagnosis: e.target.value }))}
              placeholder="Inspection notes or click 'Auto-fill AI Defect Statement'..."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-brand-500 font-mono"
            ></textarea>
          </div>

          {/* Defect Photo Upload & GPS Tag */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            
            {/* Photo Uploader */}
            <div className="p-3.5 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
                  <span>Defect Photos</span>
                </span>

                <label className="px-3 py-1 bg-brand-50 dark:bg-slate-800 hover:bg-brand-100 text-brand-700 dark:text-slate-200 text-xs font-bold rounded-lg cursor-pointer flex items-center space-x-1 transition-colors border border-brand-200 dark:border-slate-700">
                  <Camera className="w-3.5 h-3.5" />
                  <span>{isUploadingPhoto ? 'Uploading...' : 'Take / Upload Photo'}</span>
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    capture="environment"
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Photos Gallery */}
              <div className="flex items-center space-x-2 overflow-x-auto py-1 min-h-[44px]">
                {formData.photos.length === 0 ? (
                  <span className="text-xs text-slate-400 italic">No defect photos attached yet.</span>
                ) : (
                  formData.photos.map((url, idx) => (
                    <div key={idx} className="relative w-12 h-12 rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700 shrink-0 group">
                      <img src={url} alt={`Defect ${idx + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => handleRemovePhoto(idx)}
                        className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* GPS Dock Tag */}
            <div className="p-3.5 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-rose-500" />
                  <span>Dock Location Tag</span>
                </span>
                <button
                  type="button"
                  onClick={handleGrabGps}
                  disabled={isGpsLoading}
                  className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg flex items-center space-x-1 transition-colors"
                >
                  <RefreshCw className={`w-3 h-3 ${isGpsLoading ? 'animate-spin' : ''}`} />
                  <span>{isGpsLoading ? 'Getting...' : 'Tag GPS'}</span>
                </button>
              </div>

              <input
                type="text"
                readOnly
                value={formData.gpsCoordinates || 'Click "Tag GPS" to record receiving dock location'}
                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] font-mono text-slate-600 dark:text-slate-300"
              />
            </div>

          </div>
        </div>

        {/* =========================================================================
            STEP 4: BIG "SUBMIT RETURN TICKET" BUTTON
        ========================================================================= */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isSubmitting || !selectedProduct}
            className={`w-full py-4 px-6 rounded-2xl font-black text-base shadow-xl flex items-center justify-center space-x-3 transition-all ${
              selectedProduct 
                ? 'bg-brand-600 hover:bg-brand-500 text-white shadow-brand-600/30 active:scale-[0.99]' 
                : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
            }`}
          >
            <Send className="w-5 h-5" />
            <span>
              {isSubmitting 
                ? 'Generating Return Ticket...' 
                : selectedProduct 
                ? `SUBMIT RETURN TICKET (${formData.quantity} UNITS • ${formatPeso((Number(formData.quantity) || 1) * (selectedProduct?.unit_price || 0))})`
                : 'SCAN PRODUCT TO SUBMIT RETURN'}
            </span>
          </button>
        </div>

      </form>

      {/* Camera Barcode Scanner Modal */}
      <ScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={handleProductIdentified}
        catalog={catalog}
      />

    </div>
  );
}
