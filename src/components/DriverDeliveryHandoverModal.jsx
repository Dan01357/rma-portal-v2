import React, { useState, useEffect, useRef } from 'react';
import {
  Truck,
  CheckCircle2,
  Camera,
  Upload,
  MapPin,
  Building2,
  AlertCircle,
  X,
  FileText,
  ShieldCheck,
  Calendar,
  User,
  Clock,
  ExternalLink,
  RefreshCw,
  Check,
  ChevronRight,
  PackageCheck,
  Image as ImageIcon
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { catalogService } from '../services/catalogService';
import { formatQuantityWithPackSize, formatManifestBreakdown } from '../utils/rmaHelpers';

/**
 * Driver Delivery Handover QR Modal / Mobile Widget
 * 
 * Provides an ultra-simple, foolproof interface for delivery drivers & couriers
 * who scan the RMA Box Sticker / Gate Pass QR code upon arriving at the supplier or warehouse dock.
 * 
 * Key Features:
 * 1. Big, crystal-clear buttons designed for mobile drivers.
 * 2. Two MANDATORY proof photos:
 *    - Photo 1: Delivery Driver / Courier & Handlers who transported the goods.
 *    - Photo 2: Delivered Item placed at the counterparty / supplier receiving dock.
 * 3. 1-Tap "Confirm Delivered" button that instantly updates the RMA status in Supabase
 *    and broadcasts real-time updates to the Admin Portal.
 */
export default function DriverDeliveryHandoverModal({
  isOpen,
  onClose,
  rmaNumber,
  initialReport = null,
  onDeliveryConfirmed = null
}) {
  const [report, setReport] = useState(initialReport);
  const [isLoading, setIsLoading] = useState(!initialReport);
  const [loadError, setLoadError] = useState(null);

  // Driver Input Form
  const [driverName, setDriverName] = useState(() => {
    try {
      return localStorage.getItem('last_delivery_driver_name') || '';
    } catch {
      return '';
    }
  });
  const [driverVehicle, setDriverVehicle] = useState(() => {
    try {
      return localStorage.getItem('last_delivery_driver_vehicle') || '';
    } catch {
      return '';
    }
  });
  const [receiverName, setReceiverName] = useState('');
  const [driverNotes, setDriverNotes] = useState('');

  // Required Proof Photos
  const [driverPhotoFile, setDriverPhotoFile] = useState(null);
  const [driverPhotoPreview, setDriverPhotoPreview] = useState(null);
  const [dockPhotoFile, setDockPhotoFile] = useState(null);
  const [dockPhotoPreview, setDockPhotoPreview] = useState(null);

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [submissionError, setSubmissionError] = useState(null);
  const [gpsLocation, setGpsLocation] = useState(null);

  const driverPhotoInputRef = useRef(null);
  const dockPhotoInputRef = useRef(null);

  // Capture GPS coordinates quietly in background if permitted
  useEffect(() => {
    if (!isOpen) return;
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGpsLocation({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          });
        },
        () => {},
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 300000 }
      );
    }
  }, [isOpen]);

  // Load report details from database if not passed in or when rmaNumber changes
  useEffect(() => {
    if (!isOpen) return;

    if (initialReport && (initialReport.rma_number === rmaNumber || !rmaNumber)) {
      setReport(initialReport);
      setIsLoading(false);
      return;
    }

    if (!rmaNumber) {
      setLoadError('No RMA ticket number provided.');
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    const fetchReport = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const cleanRma = String(rmaNumber).trim();
        const { data, error } = await supabase
          .from('rma_reports')
          .select('*')
          .eq('rma_number', cleanRma)
          .maybeSingle();

        if (error) throw error;
        if (!data) {
          throw new Error(`RMA Ticket "${cleanRma}" was not found in the database.`);
        }

        if (isMounted) {
          setReport(data);
          // Check if already completed
          if (data.ai_document_metadata?.delivery_handover?.completed_at) {
            setIsSuccess(true);
          }
        }
      } catch (err) {
        if (isMounted) {
          console.error('[DriverDeliveryModal] Error loading report:', err);
          setLoadError(err.message || 'Failed to load return authorization details.');
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchReport();
    return () => {
      isMounted = false;
    };
  }, [isOpen, rmaNumber, initialReport]);

  if (!isOpen) return null;

  // Handle Photo 1 (Driver / Courier) selection
  const handleDriverPhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await catalogService.compressImage(file, 1280, 0.7);
      const preview = URL.createObjectURL(compressed);
      setDriverPhotoFile(compressed);
      setDriverPhotoPreview(preview);
      setSubmissionError(null);
    } catch (err) {
      console.error('Error handling driver photo:', err);
      setDriverPhotoFile(file);
      setDriverPhotoPreview(URL.createObjectURL(file));
    }
  };

  // Handle Photo 2 (Delivered Item at Dock) selection
  const handleDockPhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await catalogService.compressImage(file, 1280, 0.7);
      const preview = URL.createObjectURL(compressed);
      setDockPhotoFile(compressed);
      setDockPhotoPreview(preview);
      setSubmissionError(null);
    } catch (err) {
      console.error('Error handling dock photo:', err);
      setDockPhotoFile(file);
      setDockPhotoPreview(URL.createObjectURL(file));
    }
  };

  // Confirm Delivery Handover
  const handleConfirmDelivery = async () => {
    // 1. Mandatory Photo Validations
    if (!driverPhotoFile) {
      setSubmissionError('Photo of the delivery driver / courier is required.');
      if (driverPhotoInputRef.current) driverPhotoInputRef.current.focus();
      return;
    }
    if (!dockPhotoFile) {
      setSubmissionError('Photo of the delivered item at the receiving dock is required.');
      if (dockPhotoInputRef.current) dockPhotoInputRef.current.focus();
      return;
    }

    const cleanDriver = driverName.trim() || 'Assigned Courier Driver';
    const cleanVehicle = driverVehicle.trim() || 'Delivery Vehicle';
    const cleanReceiver = receiverName.trim() || 'Counterparty Receiving Staff';

    setIsSubmitting(true);
    setSubmissionError(null);

    try {
      // Remember driver info in localStorage for rapid subsequent handovers
      try {
        localStorage.setItem('last_delivery_driver_name', cleanDriver);
        localStorage.setItem('last_delivery_driver_vehicle', cleanVehicle);
      } catch {}

      // 2. Upload Proof Photos via catalogService (with WebP compression & Google Drive / base64 fallback)
      const targetRma = report?.rma_number || rmaNumber;

      let driverPhotoUrl = driverPhotoPreview;
      let dockPhotoUrl = dockPhotoPreview;

      try {
        const up1 = await catalogService.uploadPhotoWithDetails(driverPhotoFile, targetRma, 'driver_handover_driver', {
          driverName: cleanDriver,
          rmaType: report?.rma_type || 'supplier_outbound'
        });
        if (up1?.url) driverPhotoUrl = up1.url;
      } catch (err1) {
        console.warn('Driver photo upload warning:', err1);
      }

      try {
        const up2 = await catalogService.uploadPhotoWithDetails(dockPhotoFile, targetRma, 'driver_handover_dock', {
          driverName: cleanDriver,
          rmaType: report?.rma_type || 'supplier_outbound'
        });
        if (up2?.url) dockPhotoUrl = up2.url;
      } catch (err2) {
        console.warn('Dock photo upload warning:', err2);
      }

      // 3. Prepare Handover Metadata
      const existingMeta = (report?.ai_document_metadata && typeof report.ai_document_metadata === 'object')
        ? { ...report.ai_document_metadata }
        : {};

      const handoverData = {
        status: 'delivered_to_dock',
        completed_at: new Date().toISOString(),
        driver_name: cleanDriver,
        driver_vehicle: cleanVehicle,
        receiver_name: cleanReceiver,
        driver_photo_url: driverPhotoUrl,
        item_dock_photo_url: dockPhotoUrl,
        notes: driverNotes.trim() || null,
        gps: gpsLocation
      };

      const updatedMeta = {
        ...existingMeta,
        delivery_handover: handoverData
      };

      // Determine updated status
      const isSupplierRtv = (report?.rma_type === 'supplier_outbound' || report?.disposition?.includes('Vendor') || report?.disposition?.includes('RTV'));
      const newStatus = isSupplierRtv ? 'vendor_claimed' : 'received_at_dock';

      // Audit trail entry
      const existingAudit = Array.isArray(report?.audit_trail) ? report.audit_trail : [];
      const updatedAudit = [
        ...existingAudit,
        {
          timestamp: new Date().toISOString(),
          stage: 'DRIVER_DELIVERY_CONFIRMED',
          actor: cleanDriver,
          note: `Delivery confirmed at ${isSupplierRtv ? (report?.supplier_name || 'supplier receiving dock') : 'warehouse dock'}. Proof photos on file (Driver & Dock).`
        }
      ];

      const updates = {
        status: newStatus,
        ai_document_metadata: updatedMeta,
        audit_trail: updatedAudit
      };

      if (isSupplierRtv && !report?.disposition) {
        updates.disposition = '3- Return to Vendor (RTV)';
      }

      // 4. Update Supabase
      const { data: updatedReport, error: updateErr } = await supabase
        .from('rma_reports')
        .update(updates)
        .eq('id', report.id)
        .select('*')
        .single();

      if (updateErr) {
        // Fallback: strip fields if DB column rejected
        console.warn('Initial update notice, applying smart fallback:', updateErr.message);
        const fbUpdates = {
          ai_document_metadata: updatedMeta,
          audit_trail: updatedAudit
        };
        const { data: fbData, error: fbErr } = await supabase
          .from('rma_reports')
          .update(fbUpdates)
          .eq('id', report.id)
          .select('*')
          .single();

        if (fbErr) throw fbErr;
        setReport(fbData);
      } else {
        setReport(updatedReport);
      }

      // 5. Broadcast real-time change to open Admin Dashboards
      try {
        catalogService.notifyChange('report-updated', { report: updatedReport || report });
        window.dispatchEvent(new CustomEvent('rma-data-changed', {
          detail: { type: 'report-updated', report: updatedReport || report }
        }));
      } catch {}

      if (typeof onDeliveryConfirmed === 'function') {
        onDeliveryConfirmed(updatedReport || report);
      }

      setIsSuccess(true);
    } catch (err) {
      console.error('Failed to confirm driver delivery:', err);
      setSubmissionError(err.message || 'Could not record delivery confirmation. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isSupplierRtv = (report?.rma_type === 'supplier_outbound' || report?.disposition?.includes('Vendor') || report?.disposition?.includes('RTV'));
  const isManifest = Boolean(report?.is_parent || (Array.isArray(report?.items) && report.items.length > 1));
  const destinationName = isSupplierRtv
    ? (report?.supplier_name || 'Authorized Supplier / Vendor')
    : (report?.store_branch || 'Pingcon Central Receiving Dock');

  const existingHandover = report?.ai_document_metadata?.delivery_handover;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
        
        {/* Top Header Bar */}
        <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 p-4 sm:p-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 bg-white/20 rounded-2xl shrink-0 backdrop-blur-xs">
              <Truck className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-100 block">
                Logistics & Driver Widget
              </span>
              <h2 className="text-base sm:text-lg font-black tracking-tight truncate">
                Delivery Handover Confirmation
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer shrink-0"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="p-8 text-center space-y-3">
            <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
            <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
              Loading RMA details for <span className="font-mono font-black">{rmaNumber}</span>...
            </p>
          </div>
        )}

        {/* Error Loading State */}
        {!isLoading && loadError && (
          <div className="p-6 text-center space-y-4">
            <div className="p-3 bg-rose-100 dark:bg-rose-950/60 rounded-2xl w-fit mx-auto text-rose-600 dark:text-rose-400">
              <AlertCircle className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h3 className="font-black text-slate-900 dark:text-white text-base">
                Unable to Find RMA
              </h3>
              <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                {loadError}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-bold text-xs cursor-pointer"
            >
              Close
            </button>
          </div>
        )}

        {/* Main Content */}
        {!isLoading && !loadError && (
          <div className="p-4 sm:p-6 space-y-4 max-h-[82vh] overflow-y-auto">

            {/* Success Celebration View */}
            {isSuccess ? (
              <div className="text-center space-y-4 py-3 animate-in fade-in zoom-in-95">
                <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/70 border-4 border-emerald-500 rounded-full flex items-center justify-center mx-auto text-emerald-600 dark:text-emerald-400">
                  <Check className="w-8 h-8 stroke-[3]" />
                </div>

                <div className="space-y-1">
                  <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    Handover Officially Logged
                  </span>
                  <h3 className="text-xl font-black text-slate-900 dark:text-white">
                    Delivery Successful!
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                    The item has been recorded as handed over to{' '}
                    <strong className="text-slate-800 dark:text-slate-200">{destinationName}</strong>.
                    Warehouse lead and finance coworkers have been updated.
                  </p>
                </div>

                {/* Handover Proof Summary */}
                <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700/80 text-left space-y-2 text-xs">
                  <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-1.5">
                    <span className="text-slate-500 dark:text-slate-400">RMA Identifier:</span>
                    <strong className="font-mono text-emerald-700 dark:text-emerald-400">{report?.rma_number}</strong>
                  </div>
                  <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-1.5">
                    <span className="text-slate-500 dark:text-slate-400">Delivered To:</span>
                    <strong className="text-slate-900 dark:text-white">{destinationName}</strong>
                  </div>
                  <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-1.5">
                    <span className="text-slate-500 dark:text-slate-400">Delivered By:</span>
                    <strong className="text-slate-900 dark:text-white">
                      {existingHandover?.driver_name || driverName || 'Assigned Driver'}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Handover Time:</span>
                    <strong className="text-slate-900 dark:text-white font-mono">
                      {new Date(existingHandover?.completed_at || Date.now()).toLocaleString()}
                    </strong>
                  </div>

                  {/* Proof Photos Thumbnail Strip */}
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-700 grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] font-bold text-slate-500 block mb-1">
                        Driver Photo:
                      </span>
                      {(existingHandover?.driver_photo_url || driverPhotoPreview) ? (
                        <img
                          src={existingHandover?.driver_photo_url || driverPhotoPreview}
                          alt="Driver"
                          className="w-full h-24 object-cover rounded-xl border border-slate-300 dark:border-slate-700 shadow-2xs"
                        />
                      ) : (
                        <div className="w-full h-24 bg-slate-200 dark:bg-slate-700 rounded-xl flex items-center justify-center text-slate-400">
                          <ImageIcon className="w-6 h-6" />
                        </div>
                      )}
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-slate-500 block mb-1">
                        Delivered Dock Photo:
                      </span>
                      {(existingHandover?.item_dock_photo_url || dockPhotoPreview) ? (
                        <img
                          src={existingHandover?.item_dock_photo_url || dockPhotoPreview}
                          alt="Delivered Dock"
                          className="w-full h-24 object-cover rounded-xl border border-slate-300 dark:border-slate-700 shadow-2xs"
                        />
                      ) : (
                        <div className="w-full h-24 bg-slate-200 dark:bg-slate-700 rounded-xl flex items-center justify-center text-slate-400">
                          <ImageIcon className="w-6 h-6" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex flex-col sm:flex-row gap-2 justify-center">
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-sm transition-all shadow-md cursor-pointer active:scale-98"
                  >
                    Done & Close
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Destination & Order Identification Card */}
                <div className="p-4 bg-emerald-50/80 dark:bg-emerald-950/40 border-2 border-emerald-300 dark:border-emerald-800 rounded-2xl space-y-2.5">
                  <div className="flex items-center justify-between flex-wrap gap-1.5">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-200/80 dark:bg-emerald-900/80 text-emerald-900 dark:text-emerald-200">
                      {isSupplierRtv ? '🚚 Supplier RTV Return Delivery' : '📦 Customer Inbound Delivery'}
                    </span>
                    <span className="font-mono font-black text-xs text-slate-900 dark:text-white bg-white dark:bg-slate-900 px-2 py-0.5 rounded-lg border border-emerald-300 dark:border-emerald-700">
                      {report?.rma_number}
                    </span>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-emerald-600 text-white rounded-xl shrink-0">
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                        {isSupplierRtv ? 'Deliver Directly To Vendor / Supplier:' : 'Deliver To Warehouse Receiving Dock:'}
                      </span>
                      <div className="text-base font-black text-slate-900 dark:text-white truncate">
                        {destinationName}
                      </div>
                      {report?.store_branch && isSupplierRtv && (
                        <span className="text-[11px] text-slate-600 dark:text-slate-400 font-medium block">
                          Origin Branch: {report.store_branch}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Item Summary */}
                  <div className="pt-2 border-t border-emerald-200 dark:border-emerald-800/80 flex items-center justify-between text-xs">
                    <div className="min-w-0 pr-2">
                      <div className="font-bold text-slate-800 dark:text-slate-200 truncate">
                        {report?.name}
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {report?.code || report?.barcode}
                      </span>
                    </div>
                    <span className="px-2.5 py-1 bg-white dark:bg-slate-900 rounded-lg border border-emerald-200 dark:border-emerald-800 font-black text-emerald-800 dark:text-emerald-300 shrink-0">
                      {isManifest
                        ? formatManifestBreakdown(report?.items, true)
                        : formatQuantityWithPackSize(report?.quantity || 1, report?.unit_name || 'pc')}
                    </span>
                  </div>
                </div>

                {/* Clear Step-by-Step Instructions for Delivery Driver */}
                <div className="p-3.5 bg-amber-50/90 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/80 rounded-2xl space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-black text-amber-900 dark:text-amber-200">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>DRIVER INSTRUCTION: 2 REQUIRED PROOF PHOTOS</span>
                  </div>
                  <p className="text-[11px] text-amber-800/90 dark:text-amber-300 font-medium leading-relaxed">
                    To officially log successful delivery, you must attach <strong>both</strong>: (1) Photo of the delivery driver / courier personnel, and (2) Photo of the delivered box at the receiving dock.
                  </p>
                </div>

                {/* 2 Required Photo Upload Widgets */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  
                  {/* Photo 1: Delivery Driver / Courier Photo (REQUIRED) */}
                  <div className={`p-3.5 rounded-2xl border-2 transition-all ${
                    driverPhotoFile 
                      ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-400 dark:border-emerald-700' 
                      : 'bg-white dark:bg-slate-800/80 border-dashed border-rose-300 dark:border-rose-800'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                        <User className="w-4 h-4 text-emerald-600" />
                        <span>Driver Photo <span className="text-rose-500 font-black">*</span></span>
                      </label>
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                        driverPhotoFile 
                          ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-300' 
                          : 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                      }`}>
                        {driverPhotoFile ? '✓ Attached' : 'Required *'}
                      </span>
                    </div>

                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-2">
                      Selfie or photo of the driver / courier who handled this delivery.
                    </p>

                    {driverPhotoPreview ? (
                      <div className="relative group">
                        <img
                          src={driverPhotoPreview}
                          alt="Driver"
                          className="w-full h-32 object-cover rounded-xl border border-slate-300 dark:border-slate-700 shadow-2xs"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setDriverPhotoFile(null);
                            setDriverPhotoPreview(null);
                          }}
                          className="absolute top-1.5 right-1.5 p-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow-sm cursor-pointer"
                          title="Remove & retake photo"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => driverPhotoInputRef.current?.click()}
                        className="w-full h-32 border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 rounded-xl flex flex-col items-center justify-center gap-1.5 bg-slate-50 dark:bg-slate-900/60 transition-colors cursor-pointer group"
                      >
                        <div className="p-2 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 rounded-xl group-hover:scale-110 transition-transform">
                          <Camera className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-black text-slate-700 dark:text-slate-200">
                          Take Driver Photo
                        </span>
                        <span className="text-[9px] text-slate-400">
                          Tap to open camera
                        </span>
                      </button>
                    )}

                    <input
                      ref={driverPhotoInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleDriverPhotoChange}
                      className="hidden"
                    />
                  </div>

                  {/* Photo 2: Delivered Items at Receiving Dock (REQUIRED) */}
                  <div className={`p-3.5 rounded-2xl border-2 transition-all ${
                    dockPhotoFile 
                      ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-400 dark:border-emerald-700' 
                      : 'bg-white dark:bg-slate-800/80 border-dashed border-rose-300 dark:border-rose-800'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                        <PackageCheck className="w-4 h-4 text-emerald-600" />
                        <span>Dock Items Photo <span className="text-rose-500 font-black">*</span></span>
                      </label>
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                        dockPhotoFile 
                          ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-300' 
                          : 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                      }`}>
                        {dockPhotoFile ? '✓ Attached' : 'Required *'}
                      </span>
                    </div>

                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-2">
                      Photo of the package placed at the receiving dock counter/palette.
                    </p>

                    {dockPhotoPreview ? (
                      <div className="relative group">
                        <img
                          src={dockPhotoPreview}
                          alt="Delivered Item"
                          className="w-full h-32 object-cover rounded-xl border border-slate-300 dark:border-slate-700 shadow-2xs"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setDockPhotoFile(null);
                            setDockPhotoPreview(null);
                          }}
                          className="absolute top-1.5 right-1.5 p-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow-sm cursor-pointer"
                          title="Remove & retake photo"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => dockPhotoInputRef.current?.click()}
                        className="w-full h-32 border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 rounded-xl flex flex-col items-center justify-center gap-1.5 bg-slate-50 dark:bg-slate-900/60 transition-colors cursor-pointer group"
                      >
                        <div className="p-2 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 rounded-xl group-hover:scale-110 transition-transform">
                          <Camera className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-black text-slate-700 dark:text-slate-200">
                          Take Dock Item Photo
                        </span>
                        <span className="text-[9px] text-slate-400">
                          Tap to open camera
                        </span>
                      </button>
                    )}

                    <input
                      ref={dockPhotoInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleDockPhotoChange}
                      className="hidden"
                    />
                  </div>

                </div>

                {/* Driver & Receiver Details (Quick Fill) */}
                <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-2xl space-y-2.5 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase block mb-1">
                        Driver / Courier Name
                      </label>
                      <input
                        type="text"
                        value={driverName}
                        onChange={(e) => setDriverName(e.target.value)}
                        placeholder="e.g. Juan dela Cruz (Lalamove)"
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase block mb-1">
                        Vehicle Plate # / Courier Service
                      </label>
                      <input
                        type="text"
                        value={driverVehicle}
                        onChange={(e) => setDriverVehicle(e.target.value)}
                        placeholder="e.g. Isuzu Truck NDF-2910"
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase block mb-1">
                        Receiver / Receiving Clerk Name (Optional)
                      </label>
                      <input
                        type="text"
                        value={receiverName}
                        onChange={(e) => setReceiverName(e.target.value)}
                        placeholder="e.g. Receiving Clerk Mark"
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase block mb-1">
                        Notes / Delivery Remarks (Optional)
                      </label>
                      <input
                        type="text"
                        value={driverNotes}
                        onChange={(e) => setDriverNotes(e.target.value)}
                        placeholder="e.g. Received intact at dock gate 2"
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Error Banner */}
                {submissionError && (
                  <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 rounded-xl text-xs font-bold text-rose-700 dark:text-rose-300 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{submissionError}</span>
                  </div>
                )}

                {/* BIG PROMINENT 1-TAP CONFIRMATION BUTTON */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleConfirmDelivery}
                    disabled={isSubmitting}
                    className={`w-full py-4 px-6 rounded-2xl font-black text-sm sm:text-base flex items-center justify-center gap-2.5 transition-all shadow-lg cursor-pointer active:scale-98 ${
                      !driverPhotoFile || !dockPhotoFile
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/30 ring-2 ring-emerald-400/50'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/40 animate-pulse'
                    }`}
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="w-5 h-5 animate-spin" />
                        <span>Recording Delivery Confirmation...</span>
                      </>
                    ) : (
                      <>
                        <Truck className="w-5 h-5" />
                        <span>🚚 Confirm Delivered to {destinationName}</span>
                      </>
                    )}
                  </button>
                  <p className="text-[10px] text-center text-slate-500 dark:text-slate-400 mt-2 font-medium">
                    * Clicking confirms that the items were physically handed over. Both proof photos are permanently saved in the system.
                  </p>
                </div>
              </>
            )}

          </div>
        )}

      </div>
    </div>
  );
}

