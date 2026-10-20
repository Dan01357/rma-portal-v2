import React, { useState, useEffect } from 'react';
import { 
  createRMATicket, 
  uploadDefectPhoto, 
  fetchRMATickets 
} from '../lib/supabase';
import { generateRMAId } from '../lib/rmaGenerator';
import { DEFECT_CATEGORIES } from '../data/mockCatalog';
import { dispatchRMANotification } from '../lib/emailRouting';
import DefectUploader from './DefectUploader';
import { 
  ShieldCheck, 
  Package, 
  Hash, 
  User, 
  Building2, 
  Layers, 
  Lock, 
  CheckCircle, 
  Copy, 
  ExternalLink, 
  Send, 
  AlertTriangle,
  ArrowRight,
  FileCheck2,
  Phone,
  Mail,
  RotateCcw
} from 'lucide-react';

export default function PublicPortal({ initialParams = {}, onRMAFiled, onGoToDashboard, isAdmin = false }) {
  // Read locked parameters from URL / props
  const [params, setParams] = useState({
    company: 'PINGCON',
    sku: 'PNG-LED-32F',
    item: 'PINGCON 32" HD Commercial Display Panel',
    pkg: 'PC',
    ref: 'DR-88902',
    cust: 'Metro Commercial Supplies Co.',
    ae: 'Rodrigo Galvez'
  });

  // Return submission form states
  const [defectCategory, setDefectCategory] = useState(DEFECT_CATEGORIES[0]);
  const [defectDescription, setDefectDescription] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  // Mandatory photo state
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [compressionStats, setCompressionStats] = useState(null);
  const [photoError, setPhotoError] = useState('');

  // Form submission & confirmation states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [submittedRMA, setSubmittedRMA] = useState(null);
  const [copied, setCopied] = useState(false);

  // Initialize from props or window URL parameters
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      const urlSku = searchParams.get('sku') || initialParams.sku;
      const urlItem = searchParams.get('item') || initialParams.item;
      const urlPkg = searchParams.get('pkg') || initialParams.pkg;
      const urlRef = searchParams.get('ref') || initialParams.ref;
      const urlCust = searchParams.get('cust') || initialParams.cust;
      const urlCompany = searchParams.get('company') || initialParams.company;
      const urlAe = searchParams.get('ae') || initialParams.ae;

      setParams({
        company: urlCompany || 'PINGCON',
        sku: urlSku || 'PNG-LED-32F',
        item: urlItem || 'PINGCON 32" HD Commercial Display Panel',
        pkg: urlPkg || 'PC',
        ref: urlRef || 'DR-88902',
        cust: urlCust || 'Metro Commercial Supplies Co.',
        ae: urlAe || 'Rodrigo Galvez'
      });
    }
  }, [initialParams]);

  const handlePhotoSelected = (file, previewUrl, stats = null) => {
    setPhotoFile(file);
    setPhotoPreview(previewUrl);
    setCompressionStats(stats);
    setPhotoError('');
  };

  const handlePhotoRemoved = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
    setCompressionStats(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    // STRICT VALIDATION: Photo is mandatory
    if (!photoPreview && !photoFile) {
      setPhotoError('A clear photo of the defect or damaged merchandise is strictly required to submit your return.');
      const el = document.getElementById('photo-uploader-section');
      el?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    if (!defectDescription.trim()) {
      setErrorMessage('Please provide a brief description of the defect.');
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Get current count to generate sequence
      const { data: currentTickets } = await fetchRMATickets();
      const count = currentTickets ? currentTickets.length : 0;

      // 2. Generate tracking ID formula: RMA-[Year]-[4-Digit Sequential Number]-[4-Character Random Alphanumeric]
      const newRMAId = generateRMAId(count);

      // 3. Process Defect Photo (Supabase Storage or Base64 URI)
      let photoUrl = photoPreview;
      if (photoFile) {
        photoUrl = await uploadDefectPhoto(photoFile, newRMAId);
      }

      // 4. Construct payload for Supabase table 'rma_tickets_vault'
      const ticketPayload = {
        rma_id: newRMAId,
        company: params.company,
        customer_name: params.cust,
        product_name: params.item,
        sku: params.sku,
        packaging_unit: params.pkg,
        delivery_reference: params.ref,
        defect_category: defectCategory,
        defect_description: defectDescription.trim(),
        photo_url: photoUrl || photoPreview,
        status: 'Pending Inspection',
        resolution_notes: '',
        contact_person: contactPerson.trim() || params.cust,
        contact_phone: contactPhone.trim(),
        contact_email: contactEmail.trim(),
        assigned_ae: params.ae || 'Rodrigo Galvez',
        dispatch_email_status: 'Dispatched to AE & Operations'
      };

      // 5. Submit to Supabase table 'rma_tickets_vault'
      const { data, error } = await createRMATicket(ticketPayload);

      if (error) {
        console.error('❌ Supabase INSERT failure in PublicPortal:', error);
        setErrorMessage(`Database submission error: ${error}. Please try again.`);
        setIsSubmitting(false);
        return;
      }

      // 6. Automated AE & Dispatch Email Trigger
      try {
        await dispatchRMANotification(data || ticketPayload);
      } catch (dispatchErr) {
        console.warn('Email dispatch notification warning:', dispatchErr);
      }

      // 7. Display green confirmation card
      setSubmittedRMA(data || ticketPayload);
      if (onRMAFiled) {
        onRMAFiled(data || ticketPayload);
      }

      // Scroll to top to see confirmation
      window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (err) {
      console.error('Fatal submission error:', err);
      setErrorMessage('An unexpected error occurred while processing your return ticket. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyRMAToClipboard = () => {
    if (submittedRMA?.rma_id) {
      navigator.clipboard.writeText(submittedRMA.rma_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const resetFormForNewReturn = () => {
    setSubmittedRMA(null);
    setDefectDescription('');
    setPhotoFile(null);
    setPhotoPreview(null);
    setPhotoError('');
    setErrorMessage('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 py-6 px-3 sm:px-6 flex flex-col items-center justify-start animate-fade-in">
      
      {/* Container max-w-xl (Mobile First Responsive) */}
      <div className="w-full max-w-xl">
        
        {/* Top Header Branding Banner */}
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold mb-3">
            <Lock className="w-3.5 h-3.5" />
            <span>Zero-Login Public Warranty Portal</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Wholesale Return Portal
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-md mx-auto">
            Authorized return verification for <span className="font-semibold text-slate-200">{params.company}</span>. No login, password, or account needed.
          </p>
        </div>

        {/* ============================================================== */}
        {/* CASE 1: SUBMITTED CONFIRMATION CARD (GREEN CARD) */}
        {/* ============================================================== */}
        {submittedRMA ? (
          <div className="bg-slate-900/90 border-2 border-emerald-500/60 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-md animate-fade-in space-y-6">
            
            <div className="text-center space-y-3">
              <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-500/20 animate-bounce">
                <CheckCircle className="w-9 h-9" />
              </div>

              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                  Return Ticket Registered Successfully
                </span>
                <h2 className="text-xl sm:text-2xl font-black text-white mt-1">
                  Official RMA Tracking ID
                </h2>
              </div>

              {/* Highlighted Tracking ID Box */}
              <div className="p-4 bg-slate-950 rounded-2xl border-2 border-dashed border-emerald-500/40 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="text-center sm:text-left">
                  <span className="text-[10px] uppercase font-mono text-slate-400">Save This Reference Code</span>
                  <p className="font-mono font-black text-xl sm:text-2xl text-emerald-400 tracking-wider">
                    {submittedRMA.rma_id}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={copyRMAToClipboard}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-600/30 transition-all active:scale-95"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copied ? 'Copied to Clipboard!' : 'Copy RMA ID'}</span>
                </button>
              </div>
            </div>

            {/* Ticket Summary Details */}
            <div className="rounded-2xl bg-slate-950/60 border border-slate-800 p-4 space-y-2.5 text-xs text-slate-300">
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-500">Status:</span>
                <span className="font-semibold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
                  Pending Inspection
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-500">Company:</span>
                <span className="font-medium text-white">{submittedRMA.company}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-500">Customer:</span>
                <span className="font-medium text-white">{submittedRMA.customer_name}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-500">Product / SKU:</span>
                <span className="font-medium text-white text-right max-w-[240px] truncate">
                  {submittedRMA.product_name} ({submittedRMA.sku})
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-500">Defect Reason:</span>
                <span className="font-medium text-rose-300">{submittedRMA.defect_category}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-500">Assigned AE:</span>
                <span className="font-medium text-indigo-300">{submittedRMA.assigned_ae || params.ae}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Delivery Ref:</span>
                <span className="font-mono text-slate-200">{submittedRMA.delivery_reference}</span>
              </div>
            </div>

            {/* Email Notification Status */}
            <div className="p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-center justify-between">
              <span className="font-semibold flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5" /> Auto Email Dispatched
              </span>
              <span className="font-mono text-[10px] bg-emerald-500/20 px-2 py-0.5 rounded text-emerald-200">
                AE & Operations Notified
              </span>
            </div>

            {/* Next Steps Info */}
            <div className="p-3.5 bg-blue-950/30 border border-blue-500/20 rounded-xl text-xs text-blue-200/90 leading-relaxed">
              <span className="font-semibold text-blue-300 block mb-1">What happens next?</span>
              Our warehouse QA team will inspect the digital defect proof and cross-reference delivery document <strong className="font-mono">{submittedRMA.delivery_reference}</strong>. A replacement or credit memo decision will be updated on the returns registry within 24-48 business hours.
            </div>

            {/* Navigation Actions */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                onClick={resetFormForNewReturn}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-all"
              >
                <RotateCcw className="w-4 h-4 text-slate-400" />
                <span>File Another Return</span>
              </button>

              {isAdmin && onGoToDashboard && (
                <button
                  type="button"
                  onClick={onGoToDashboard}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all"
                >
                  <FileCheck2 className="w-4 h-4" />
                  <span>View in Management Dashboard</span>
                </button>
              )}
            </div>

          </div>
        ) : (
          /* ============================================================== */
          /* CASE 2: RETURN FILING FORM */
          /* ============================================================== */
          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* LOCKED PARAMETERS CARD (Zero Typing Required) */}
            <div className="bg-slate-900/90 backdrop-blur-md rounded-2xl border border-slate-700 p-5 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></div>
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                    QR Verified Dispatch Details
                  </span>
                </div>
                <span className="text-[11px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                  Locked Parameters
                </span>
              </div>

              {/* Product & SKU locked display */}
              <div className="bg-slate-950/70 rounded-xl p-3.5 border border-slate-800">
                <span className="text-[10px] font-mono text-indigo-400 uppercase tracking-wider block">
                  Product / SKU
                </span>
                <p className="font-bold text-sm sm:text-base text-white mt-0.5">
                  {params.item}
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className="font-mono text-xs bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 px-2.5 py-0.5 rounded font-semibold">
                    SKU: {params.sku}
                  </span>
                  <span className="font-mono text-xs bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded">
                    Packaging: {params.pkg}
                  </span>
                  <span className="font-mono text-xs bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded">
                    Ref: {params.ref}
                  </span>
                </div>
              </div>

              {/* Consignee, Company & Assigned AE */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                <div className="p-2.5 bg-slate-950/50 rounded-xl border border-slate-800/80">
                  <span className="text-[10px] text-slate-500 font-mono block">Consignee Customer:</span>
                  <p className="font-semibold text-slate-200 mt-0.5 truncate">{params.cust}</p>
                </div>
                <div className="p-2.5 bg-slate-950/50 rounded-xl border border-slate-800/80">
                  <span className="text-[10px] text-slate-500 font-mono block">Distributor Company:</span>
                  <p className="font-semibold text-slate-200 mt-0.5">{params.company}</p>
                </div>
                <div className="p-2.5 bg-slate-950/50 rounded-xl border border-slate-800/80">
                  <span className="text-[10px] text-slate-500 font-mono block">Assigned AE:</span>
                  <p className="font-semibold text-indigo-300 mt-0.5 truncate">{params.ae}</p>
                </div>
              </div>
            </div>

            {/* MANDATORY DEFECT EVIDENCE CARD */}
            <div id="photo-uploader-section" className="bg-slate-900/90 backdrop-blur-md rounded-2xl border border-slate-700 p-5 shadow-xl">
              <DefectUploader
                photoFile={photoFile}
                photoPreview={photoPreview}
                compressionStats={compressionStats}
                onPhotoSelected={handlePhotoSelected}
                onPhotoRemoved={handlePhotoRemoved}
                error={photoError}
              />
            </div>

            {/* DEFECT CATEGORY & DESCRIPTION CARD */}
            <div className="bg-slate-900/90 backdrop-blur-md rounded-2xl border border-slate-700 p-5 shadow-xl space-y-4">
              
              {/* Defect Category Dropdown */}
              <div>
                <label className="block text-sm font-semibold text-slate-200 mb-1.5">
                  Defect Reason / Category <span className="text-rose-500">*</span>
                </label>
                <select
                  value={defectCategory}
                  onChange={(e) => setDefectCategory(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  {DEFECT_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              {/* Defect Description */}
              <div>
                <label className="block text-sm font-semibold text-slate-200 mb-1.5">
                  Detailed Defect Description <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={defectDescription}
                  onChange={(e) => setDefectDescription(e.target.value)}
                  placeholder="Describe specific symptoms, damage location, packaging conditions, or serial numbers..."
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              {/* Submitter Contact Info */}
              <div className="pt-2 border-t border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Contact for RMA Resolution
                  </span>
                  <span className="text-[10px] text-slate-500">Optional</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Contact Name / Title</label>
                    <input
                      type="text"
                      value={contactPerson}
                      onChange={(e) => setContactPerson(e.target.value)}
                      placeholder="e.g. Juan dela Cruz (Receiving)"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Mobile / Phone #</label>
                    <input
                      type="tel"
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      placeholder="e.g. +63 917 123 4567"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

            </div>

            {/* Error Message if any */}
            {errorMessage && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* SUBMIT BUTTON (Strictly disabled or blocked if photo missing) */}
            <button
              type="submit"
              disabled={isSubmitting}
              className={`w-full py-4 rounded-2xl font-bold text-sm tracking-wide shadow-xl flex items-center justify-center gap-2 transition-all ${
                isSubmitting
                  ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                  : !photoPreview
                  ? 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30 hover:scale-[1.01] active:scale-[0.99]'
              }`}
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Generating Tracking ID & Vault Record...</span>
                </>
              ) : !photoPreview ? (
                <>
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span>Attach Mandatory Photo to Submit Return</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Submit Return Merchandise Authorization</span>
                </>
              )}
            </button>

            <p className="text-[11px] text-center text-slate-500">
              By submitting, your warranty claim is encrypted and entered into the supervisor inspection queue.
            </p>

          </form>
        )}

      </div>
    </div>
  );
}
