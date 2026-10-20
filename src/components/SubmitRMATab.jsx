import React, { useState } from 'react';
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
  Mail,
  Send,
  Zap,
  Info,
  Check,
  HelpCircle,
  Package,
  Layers,
  DollarSign
} from 'lucide-react';
import confetti from 'canvas-confetti';
import ScannerModal from './ScannerModal';
import { AE_ROSTERS } from '../data/mockData';
import { rmaApi } from '../supabaseClient';
import { generateTicketId, playBeep, formatPeso, generateAiDiagnosis, applyEmailTestMode } from '../utils/rmaHelpers';

export default function SubmitRMATab({ 
  catalog = [], 
  onTicketCreated, 
  isTestMode = false, 
  onOpenTicketModal 
}) {
  // Scanner state
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [lastScannedBarcode, setLastScannedBarcode] = useState('');
  const [isNotFoundInCatalog, setIsNotFoundInCatalog] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    // Group & AE Routing
    group: 'Group 2 (PINGCON & BONITA TISSUE)',
    aeName: 'Jerome Santos',
    aeEmail: 'jerome.santos@pingconmarketing.com',
    supervisorEmail: 'jaezelle.benito@pingconmarketing.com',

    // Product Details
    barcode: '',
    sku: '',
    productName: '',
    supplier: 'Bonita Mills Inc.',
    unitPrice: 68.50,
    quantity: 1,

    // Store & Return info
    customerName: 'Puregold Price Club',
    storeBranch: 'Branch 042 - San Fernando Pampanga',
    invoiceNo: 'INV-2026-9901',
    defectCategory: 'Damaged in Transit / Crushed Carton',
    technicalDiagnosis: '',

    // Media & Location
    gpsCoordinates: '',
    photos: []
  });

  // UI feedback states
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGpsLoading, setIsGpsLoading] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [statusNotification, setStatusNotification] = useState(null);

  // Current active AE roster
  const currentRoster = AE_ROSTERS[formData.group] || AE_ROSTERS['Group 2 (PINGCON & BONITA TISSUE)'];

  // Handle Group change
  const handleGroupChange = (newGroup) => {
    const roster = AE_ROSTERS[newGroup];
    const defaultAe = roster.aes[0];
    setFormData(prev => ({
      ...prev,
      group: newGroup,
      aeName: defaultAe.name,
      aeEmail: defaultAe.email,
      supervisorEmail: defaultAe.supervisorEmail,
      supplier: newGroup.includes('KEYSYS') ? 'Keysys Tech Corp' : 'Bonita Mills Inc.'
    }));
  };

  // Handle AE Selection
  const handleAeSelect = (aeName) => {
    const selected = currentRoster.aes.find(a => a.name === aeName);
    if (selected) {
      setFormData(prev => ({
        ...prev,
        aeName: selected.name,
        aeEmail: selected.email,
        supervisorEmail: selected.supervisorEmail
      }));
    }
  };

  // Handle Scanned Barcode (from camera or quick test bar)
  const handleBarcodeScanned = (scannedCode) => {
    const cleanCode = String(scannedCode).trim();
    setLastScannedBarcode(cleanCode);

    // If scanning the same barcode that is already active in the form, re-scanning increments +1!
    if (formData.barcode && formData.barcode === cleanCode) {
      playBeep('increment');
      setFormData(prev => ({
        ...prev,
        quantity: prev.quantity + 1
      }));
      showBannerNotification(`Re-scanned ${cleanCode}: Quantity incremented to ${formData.quantity + 1}!`, 'success');
      return;
    }

    // Lookup in catalog
    const foundProduct = catalog.find(p => String(p.barcode).trim() === cleanCode);

    if (foundProduct) {
      playBeep('success');
      setIsNotFoundInCatalog(false);

      // Auto assign matching group if detected
      let matchingGroup = formData.group;
      if (foundProduct.group) {
        matchingGroup = foundProduct.group;
      }

      const roster = AE_ROSTERS[matchingGroup] || currentRoster;
      const defaultAe = roster.aes[0];

      setFormData(prev => ({
        ...prev,
        barcode: foundProduct.barcode,
        sku: foundProduct.sku || '',
        productName: foundProduct.name,
        supplier: foundProduct.supplier || prev.supplier,
        unitPrice: foundProduct.unit_price || 0,
        group: matchingGroup,
        aeName: defaultAe.name,
        aeEmail: defaultAe.email,
        supervisorEmail: defaultAe.supervisorEmail,
        quantity: 1
      }));

      showBannerNotification(`Product Matched: "${foundProduct.name}" (SKU: ${foundProduct.sku})`, 'success');
    } else {
      // Product NOT found in catalog: prompt user to type manually
      playBeep('error');
      setIsNotFoundInCatalog(true);
      setFormData(prev => ({
        ...prev,
        barcode: cleanCode,
        sku: `SKU-UNREG-${cleanCode.slice(-4)}`,
        productName: '',
        quantity: 1
      }));
      showBannerNotification(`Barcode ${cleanCode} not in catalog. Please enter product name manually.`, 'warning');
    }
  };

  // Banner notification toast
  const showBannerNotification = (msg, type = 'info') => {
    setStatusNotification({ msg, type });
    setTimeout(() => {
      setStatusNotification(null);
    }, 4500);
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

  // GPS Grabber using navigator.geolocation
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
        showBannerNotification(`GPS Grabbed: ${coordString}`, 'success');
      },
      (err) => {
        setIsGpsLoading(false);
        // Fallback simulated warehouse dock GPS
        const fallback = '14.5995° N, 120.9842° E (Warehouse Hub Dock 2)';
        setFormData(prev => ({ ...prev, gpsCoordinates: fallback }));
        showBannerNotification('GPS fallback applied (Warehouse Receiving Dock)', 'info');
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  // Defect Photo Upload to Supabase bucket 'rma-defect-photos'
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
      showBannerNotification(`${files.length} defect photo(s) uploaded successfully!`, 'success');
    } catch (err) {
      console.error('Photo upload error:', err);
      showBannerNotification('Photo upload failed. Using local preview.', 'warning');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  // Simulated AI Defect Detection
  const handleAiDefectDetection = () => {
    setIsAiLoading(true);
    setTimeout(() => {
      const diagnosis = generateAiDiagnosis(formData.productName, formData.defectCategory, formData.photos.length);
      setFormData(prev => ({
        ...prev,
        technicalDiagnosis: diagnosis
      }));
      setIsAiLoading(false);
      playBeep('success');
      showBannerNotification('AI Defect Analysis Generated & Applied!', 'success');
    }, 1000);
  };

  // Submit RMA Ticket
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.productName.trim()) {
      alert('Please specify the Product Name.');
      return;
    }

    const qty = Number(formData.quantity) || 1;
    const totalAmount = qty * (Number(formData.unitPrice) || 0);

    setIsSubmitting(true);

    try {
      const existingTickets = await rmaApi.getTickets();
      const ticketId = generateTicketId(existingTickets.length);

      const newTicket = {
        id: ticketId,
        created_at: new Date().toISOString(),
        customer_name: formData.customerName,
        store_branch: formData.storeBranch,
        invoice_no: formData.invoiceNo,
        group: formData.group,
        ae_name: formData.aeName,
        ae_email: formData.aeEmail,
        supervisor_email: formData.supervisorEmail,
        product_name: formData.productName,
        sku: formData.sku || 'SKU-CUSTOM',
        barcode: formData.barcode || 'N/A',
        supplier: formData.supplier,
        quantity: qty,
        unit_price: Number(formData.unitPrice) || 0,
        total_amount: totalAmount,
        defect_category: formData.defectCategory,
        technical_diagnosis: formData.technicalDiagnosis || 'Physical inspection required by repacker.',
        gps_coordinates: formData.gpsCoordinates || 'Warehouse Terminal Intake',
        photos: formData.photos.length > 0 ? formData.photos : ['https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=400&auto=format&fit=crop&q=80'],
        status: 'Pending Inspection',
        pull_out_confirmed: false,
        credit_memo_no: '',
        credit_amount: 0,
        credit_issued_by: '',
        credit_issued_date: null,
        supplier_po_no: `PO-RET-${new Date().getFullYear()}-${String(existingTickets.length + 1).padStart(3, '0')}`,
        buffer_days_left: 7,
        notes: `RMA filed by ${formData.aeName}. Awaiting logistics pull-out authorization.`
      };

      await rmaApi.createTicket(newTicket);

      // Trigger Confetti Celebration!
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

      // Reset item inputs
      setFormData(prev => ({
        ...prev,
        barcode: '',
        sku: '',
        productName: '',
        quantity: 1,
        technicalDiagnosis: '',
        photos: []
      }));
      setIsNotFoundInCatalog(false);
      showBannerNotification(`Ticket ${newTicket.id} created and dispatched!`, 'success');
    } catch (err) {
      console.error('Error creating RMA ticket:', err);
      alert('Error saving ticket: ' + (err.message || 'Unknown error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      {/* Toast Banner Notification */}
      {statusNotification && (
        <div className={`p-4 rounded-xl border flex items-center space-x-3 text-sm animate-in slide-in-from-top-2 duration-200 ${
          statusNotification.type === 'success' 
            ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-200' 
            : statusNotification.type === 'warning'
            ? 'bg-amber-950/80 border-amber-500/40 text-amber-200'
            : 'bg-brand-950/80 border-brand-500/40 text-brand-200'
        }`}>
          {statusNotification.type === 'success' ? (
            <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          )}
          <span className="font-medium">{statusNotification.msg}</span>
        </div>
      )}

      {/* Main Intake Form */}
      <form onSubmit={handleSubmit} className="space-y-5">
        
        {/* =========================================================================
            CARD 1: SCAN OR TYPE BARCODE
        ========================================================================= */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <div className="flex items-center space-x-2">
                <span className="w-6 h-6 rounded-lg bg-brand-500/20 text-brand-300 border border-brand-500/30 flex items-center justify-center font-bold text-xs">
                  1
                </span>
                <h2 className="text-base font-bold text-white tracking-tight">
                  Scan or Type Barcode
                </h2>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Scan physical retail carton or GTIN barcode to auto-populate description and SKU
              </p>
            </div>

            {/* Launch Camera Button */}
            <button
              type="button"
              onClick={() => setIsScannerOpen(true)}
              className="w-full sm:w-auto px-4 py-2.5 bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs rounded-xl flex items-center justify-center space-x-2 shadow-md shadow-brand-600/30 transition-all active:scale-95"
            >
              <Camera className="w-4 h-4" />
              <span>Launch Phone Camera Scanner</span>
            </button>
          </div>

          {/* Quick Simulation Barcode Buttons */}
          <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                Quick Test Barcodes (Tap to Simulate Scan)
              </span>
              <span className="text-[10px] text-slate-500 hidden sm:inline">Tap again to test re-scan +1 increment</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {catalog.slice(0, 5).map((item) => (
                <button
                  key={item.barcode}
                  type="button"
                  onClick={() => handleBarcodeScanned(item.barcode)}
                  className="px-2.5 py-1.5 bg-slate-900 hover:bg-brand-900/40 hover:border-brand-500/60 border border-slate-700/80 rounded-lg text-xs font-mono text-slate-300 hover:text-white transition-all flex items-center space-x-1.5"
                  title={`${item.name} (${item.sku})`}
                >
                  <Barcode className="w-3.5 h-3.5 text-brand-400" />
                  <span className="font-semibold">{item.sku}</span>
                  <span className="text-[10px] text-slate-400 font-normal">({item.barcode.slice(-4)})</span>
                </button>
              ))}
            </div>
          </div>

          {/* Barcode & SKU Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center justify-between">
                <span>Box Barcode / GTIN Number</span>
                <span className="text-[10px] text-slate-500 flex items-center gap-1">
                  <Info className="w-3 h-3" /> Auto-lookup on entry
                </span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={formData.barcode}
                  onChange={(e) => {
                    const code = e.target.value;
                    setFormData(prev => ({ ...prev, barcode: code }));
                    if (code.length >= 8) {
                      handleBarcodeScanned(code);
                    }
                  }}
                  placeholder="Scan or type barcode (e.g. 4806518330012)..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-brand-500 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setIsScannerOpen(true)}
                  className="absolute right-2 top-2 p-1.5 text-brand-400 hover:text-white bg-brand-500/20 hover:bg-brand-500/40 rounded-lg transition-colors"
                  title="Open Camera"
                >
                  <Camera className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Product SKU Code
              </label>
              <input
                type="text"
                value={formData.sku}
                onChange={(e) => setFormData(prev => ({ ...prev, sku: e.target.value }))}
                placeholder="e.g. BON-FT-200"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-brand-500 font-mono"
              />
            </div>
          </div>

          {/* Product Name (Manual override permitted) */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center justify-between">
              <span>Product Description {isNotFoundInCatalog && <span className="text-amber-400 font-bold">(Uncatalogued Item — type description manually)</span>}</span>
              <span className="text-[10px] text-slate-500">Retail item name</span>
            </label>
            <input
              type="text"
              required
              value={formData.productName}
              onChange={(e) => setFormData(prev => ({ ...prev, productName: e.target.value }))}
              placeholder="e.g. Bonita Soft Facial Tissue 2-Ply 200 pulls"
              className={`w-full bg-slate-950 border rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none ${
                isNotFoundInCatalog 
                  ? 'border-amber-500 focus:border-amber-400 ring-1 ring-amber-500/50' 
                  : 'border-slate-700 focus:border-brand-500'
              }`}
            />
          </div>

          {/* Unit Price & Supplier Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Manufacturer / Supplier</label>
              <input
                type="text"
                value={formData.supplier}
                onChange={(e) => setFormData(prev => ({ ...prev, supplier: e.target.value }))}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-brand-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Contract Unit Price (₱)</label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-slate-500 font-mono">₱</span>
                <input
                  type="number"
                  step="0.01"
                  value={formData.unitPrice}
                  onChange={(e) => setFormData(prev => ({ ...prev, unitPrice: parseFloat(e.target.value) || 0 }))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-7 pr-3 py-2 font-mono text-slate-200 focus:outline-none focus:border-brand-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* =========================================================================
            CARD 2: QUANTITY WITH BIG [+] AND [-] BUTTONS & DIRECT NUMERIC INPUT
        ========================================================================= */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              <span className="w-6 h-6 rounded-lg bg-brand-500/20 text-brand-300 border border-brand-500/30 flex items-center justify-center font-bold text-xs">
                2
              </span>
              <h2 className="text-base font-bold text-white tracking-tight">
                Quantity & Value Calculation
              </h2>
            </div>
            <span className="text-[11px] text-brand-400 font-medium hidden sm:inline">
              Re-scanning item increments +1
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
            
            {/* Direct Number Input + Big Touch Buttons */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-2 flex items-center justify-between">
                <span>Return Units (Direct Numeric Input)</span>
                <span className="text-[10px] text-slate-500">Click box to type volume directly</span>
              </label>

              <div className="flex items-center space-x-2">
                {/* Decrement Button */}
                <button
                  type="button"
                  onClick={handleQuantityDecrement}
                  className="w-14 h-12 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 rounded-xl text-slate-200 font-bold text-xl flex items-center justify-center transition-colors shadow-sm select-none"
                  title="Minus 1 Unit"
                >
                  <Minus className="w-6 h-6" />
                </button>

                {/* Direct Editable Quantity Box */}
                <input
                  type="number"
                  min="1"
                  value={formData.quantity}
                  onChange={handleQuantityChange}
                  className="flex-1 h-12 bg-slate-950 border-2 border-brand-500/70 focus:border-brand-400 rounded-xl text-center text-2xl font-black font-mono text-white focus:outline-none shadow-inner"
                  title="Type quantity directly (e.g. 20)"
                />

                {/* Increment Button */}
                <button
                  type="button"
                  onClick={handleQuantityIncrement}
                  className="w-14 h-12 bg-brand-600 hover:bg-brand-500 active:bg-brand-400 border border-brand-500 rounded-xl text-white font-bold text-xl flex items-center justify-center transition-colors shadow-md shadow-brand-600/30 select-none"
                  title="Plus 1 Unit"
                >
                  <Plus className="w-6 h-6" />
                </button>
              </div>

              <p className="text-[11px] text-slate-400 mt-1.5 flex items-center gap-1">
                <HelpCircle className="w-3.5 h-3.5 text-slate-500" />
                Warehouse repackers can type large batches (e.g. "25" or "100") instantly into the box.
              </p>
            </div>

            {/* Total Claim Value Preview */}
            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-400 block">Total Claim Value</span>
                <span className="text-2xl font-black text-emerald-400 font-mono mt-0.5 block">
                  {formatPeso((Number(formData.quantity) || 0) * (Number(formData.unitPrice) || 0))}
                </span>
                <span className="text-[10px] text-slate-500">
                  {formData.quantity || 0} units @ {formatPeso(formData.unitPrice)} each
                </span>
              </div>
              <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <DollarSign className="w-6 h-6" />
              </div>
            </div>

          </div>
        </div>

        {/* =========================================================================
            CARD 3: DEFECT PHOTOS & ONE-CLICK AI DIAGNOSIS
        ========================================================================= */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              <span className="w-6 h-6 rounded-lg bg-brand-500/20 text-brand-300 border border-brand-500/30 flex items-center justify-center font-bold text-xs">
                3
              </span>
              <h2 className="text-base font-bold text-white tracking-tight">
                Defect Photos & One-Click AI Diagnosis
              </h2>
            </div>
            
            {/* One-Click AI Defect Diagnosis Button */}
            <button
              type="button"
              onClick={handleAiDefectDetection}
              disabled={isAiLoading}
              className="px-3.5 py-1.5 bg-gradient-to-r from-purple-900/70 to-brand-900/70 hover:from-purple-800 hover:to-brand-800 border border-purple-500/40 text-purple-200 hover:text-white font-semibold text-xs rounded-xl flex items-center space-x-1.5 shadow-sm transition-all"
            >
              <Sparkles className={`w-3.5 h-3.5 text-amber-300 ${isAiLoading ? 'animate-spin' : ''}`} />
              <span>{isAiLoading ? 'Analyzing...' : 'One-Click AI Diagnosis'}</span>
            </button>
          </div>

          {/* Customer & Branch */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Customer Account
              </label>
              <input
                type="text"
                required
                value={formData.customerName}
                onChange={(e) => setFormData(prev => ({ ...prev, customerName: e.target.value }))}
                placeholder="e.g. Puregold Price Club"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-brand-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Store Branch / Location
              </label>
              <input
                type="text"
                required
                value={formData.storeBranch}
                onChange={(e) => setFormData(prev => ({ ...prev, storeBranch: e.target.value }))}
                placeholder="e.g. Branch 042 - San Fernando"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-brand-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Invoice / DR #
              </label>
              <input
                type="text"
                value={formData.invoiceNo}
                onChange={(e) => setFormData(prev => ({ ...prev, invoiceNo: e.target.value }))}
                placeholder="e.g. INV-2026-9901"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-brand-500 font-mono"
              />
            </div>
          </div>

          {/* Primary Defect Classification */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Primary Defect Category
            </label>
            <select
              value={formData.defectCategory}
              onChange={(e) => setFormData(prev => ({ ...prev, defectCategory: e.target.value }))}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-brand-500 font-medium"
            >
              <option value="Damaged in Transit / Crushed Carton">Damaged in Transit / Crushed Carton</option>
              <option value="Packaging Seal Breach / Moisture Exposure">Packaging Seal Breach / Moisture Exposure</option>
              <option value="Factory Short-fill / Core Deformation">Factory Short-fill / Core Deformation</option>
              <option value="Barcode Scan Failure / Unreadable GTIN">Barcode Scan Failure / Unreadable GTIN</option>
              <option value="Defective Electronic / Laser Trigger Stuck">Defective Electronic / Laser Trigger Stuck</option>
              <option value="Expired / Shelf-Life Reached">Expired / Shelf-Life Reached</option>
              <option value="Customer Return / Wrong SKU Shipped">Customer Return / Wrong SKU Shipped</option>
            </select>
          </div>

          {/* Technical Diagnosis Textarea */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center justify-between">
              <span>Technical Diagnosis & Defect Statement</span>
              <span className="text-[10px] text-slate-500">Auto-filled by AI Diagnosis or type notes</span>
            </label>
            <textarea
              rows="3"
              value={formData.technicalDiagnosis}
              onChange={(e) => setFormData(prev => ({ ...prev, technicalDiagnosis: e.target.value }))}
              placeholder="Click 'One-Click AI Diagnosis' above to generate technical inspection findings, or type warehouse notes..."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-brand-500 font-mono leading-relaxed"
            ></textarea>
          </div>

          {/* GPS Grabber & Photo Upload Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            
            {/* GPS Grabber */}
            <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-rose-400" />
                  <span>Dock GPS Verification</span>
                </span>
                <button
                  type="button"
                  onClick={handleGrabGps}
                  disabled={isGpsLoading}
                  className="px-2.5 py-1 bg-brand-600 hover:bg-brand-500 text-white text-[11px] font-medium rounded-lg flex items-center space-x-1 transition-colors"
                >
                  <RefreshCw className={`w-3 h-3 ${isGpsLoading ? 'animate-spin' : ''}`} />
                  <span>{isGpsLoading ? 'Acquiring...' : 'Grab GPS'}</span>
                </button>
              </div>

              <input
                type="text"
                readOnly
                value={formData.gpsCoordinates || 'Coordinates not yet acquired. Click "Grab GPS"'}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-slate-300"
              />
            </div>

            {/* Photo Uploader */}
            <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5 text-brand-400" />
                  <span>Defect Photos</span>
                </span>
                <label className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium rounded-lg cursor-pointer flex items-center space-x-1 transition-colors border border-slate-700">
                  <Camera className="w-3 h-3 text-brand-400" />
                  <span>{isUploadingPhoto ? 'Uploading...' : 'Take / Upload'}</span>
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

              <div className="flex items-center space-x-2 overflow-x-auto py-0.5 min-h-[38px]">
                {formData.photos.length === 0 ? (
                  <span className="text-[11px] text-slate-500 italic">No defect photos attached yet.</span>
                ) : (
                  formData.photos.map((url, idx) => (
                    <div key={idx} className="relative w-9 h-9 rounded-lg overflow-hidden border border-slate-700 shrink-0">
                      <img src={url} alt={`Defect ${idx + 1}`} className="w-full h-full object-cover" />
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        </div>

        {/* =========================================================================
            CARD 4: SELECT ASSIGNED ACCOUNT EXECUTIVE (AE)
        ========================================================================= */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              <span className="w-6 h-6 rounded-lg bg-brand-500/20 text-brand-300 border border-brand-500/30 flex items-center justify-center font-bold text-xs">
                4
              </span>
              <h2 className="text-base font-bold text-white tracking-tight">
                Select Assigned Account Executive (AE)
              </h2>
            </div>
            {isTestMode ? (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40">
                Test Mode: .test appended
              </span>
            ) : (
              <span className="text-xs text-emerald-400 font-medium">Production Dispatch Active</span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Business Distribution Channel
              </label>
              <select
                value={formData.group}
                onChange={(e) => handleGroupChange(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-brand-500 font-medium"
              >
                <option value="Group 2 (PINGCON & BONITA TISSUE)">
                  Group 2 (PINGCON & BONITA TISSUE)
                </option>
                <option value="Group 1 (KEYSYS & A2Z2GO)">
                  Group 1 (KEYSYS & A2Z2GO)
                </option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Account Executive (AE)
              </label>
              <select
                value={formData.aeName}
                onChange={(e) => handleAeSelect(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-brand-500 font-medium"
              >
                {currentRoster.aes.map(ae => (
                  <option key={ae.email} value={ae.name}>
                    {ae.name} (Supervisor: {ae.supervisor})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Email Preview Strip */}
          <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl text-xs font-mono space-y-1 text-slate-300">
            <div className="flex items-center justify-between text-slate-400 text-[11px] pb-1 border-b border-slate-800/60 font-sans">
              <span className="flex items-center gap-1 font-semibold text-slate-300">
                <Mail className="w-3.5 h-3.5 text-brand-400" />
                Auto-Dispatched Outbound Recipients:
              </span>
              <span>{isTestMode ? 'Test Safe (.test)' : 'Production'}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px]">
              <div>
                <span className="text-slate-500">From: </span>
                <span className="text-brand-300">{currentRoster.sender}</span>
              </div>
              <div>
                <span className="text-slate-500">To: </span>
                <span className="text-slate-200">{applyEmailTestMode(currentRoster.to, isTestMode)}</span>
              </div>
              <div className="truncate" title={`AE: ${formData.aeEmail}, Sup: ${formData.supervisorEmail}`}>
                <span className="text-slate-500">AE & Sup CC: </span>
                <span className="text-slate-300">{applyEmailTestMode(formData.aeEmail, isTestMode)}</span>
              </div>
            </div>
          </div>

        </div>

        {/* Submit Button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 bg-gradient-to-r from-brand-600 via-brand-500 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-white font-black text-base rounded-2xl shadow-xl shadow-brand-600/30 flex items-center justify-center space-x-2.5 transition-all active:scale-[0.99] disabled:opacity-50"
          >
            <Send className="w-5 h-5" />
            <span>
              {isSubmitting ? 'Submitting & Dispatching Email...' : 'SUBMIT RMA & GENERATE RETURN QR TICKET'}
            </span>
          </button>
        </div>

      </form>

      {/* Camera Barcode Scanner Modal */}
      <ScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={handleBarcodeScanned}
        catalog={catalog}
      />

    </div>
  );
}
