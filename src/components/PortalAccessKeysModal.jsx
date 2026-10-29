import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { 
  X, 
  QrCode, 
  Plus, 
  Building2, 
  Package, 
  Clock, 
  KeyRound, 
  Printer, 
  Download, 
  Copy, 
  Check, 
  Trash2, 
  Edit3, 
  Eye, 
  EyeOff, 
  Sparkles, 
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Power,
  Mail
} from 'lucide-react';
import { accessKeyService, DEFAULT_ACCESS_PROFILES } from '../services/accessKeyService';
import { downloadPortalPosterPng, downloadQrCodePng, printPortalPoster } from '../utils/qrDownload';

export function formatDurationLabel(hours) {
  const h = Number(hours || 0);
  if (h <= 0) return 'Permanent (0h)';
  const totalMins = Math.round(h * 60);
  if (totalMins < 60) return `${totalMins} Minutes`;
  if (totalMins % 60 === 0) {
    const hoursNum = totalMins / 60;
    return `${hoursNum} Hour${hoursNum === 1 ? '' : 's'}`;
  }
  return `${h.toFixed(1)} Hours (${totalMins}m)`;
}

export default function PortalAccessKeysModal({ isOpen, onClose, currentUser, onOpenPinRequests }) {
  const [profiles, setProfiles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedSlug, setCopiedSlug] = useState(null);
  const [visiblePins, setVisiblePins] = useState(new Set());

  // Modal Sub-States: 'list' | 'create' | 'edit' | 'print'
  const [modalMode, setModalMode] = useState('list');
  const [selectedProfile, setSelectedProfile] = useState(null);

  // Form State for Create / Edit
  const [formData, setFormData] = useState({
    name: '',
    type: 'internal_warehouse',
    accessSlug: '',
    pinCode: '123456',
    sessionDurationHours: 0
  });
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Dynamic Session Duration Mode: 'permanent' | 'custom'
  const [durationMode, setDurationMode] = useState('permanent');
  const [customDurationVal, setCustomDurationVal] = useState(2);
  const [customDurationUnit, setCustomDurationUnit] = useState('hrs');

  // Dynamic Print Sizes: 'a4' | '4x6' | '3x3' | '2x2'
  const [printSize, setPrintSize] = useState('a4');

  // Print Poster Options
  const [showPinOnPoster, setShowPinOnPoster] = useState(true);
  const [isDownloadingPoster, setIsDownloadingPoster] = useState(false);

  // Load profiles on open
  useEffect(() => {
    if (isOpen) {
      loadProfiles();
      setModalMode('list');
      setFormError('');
    }
  }, [isOpen]);

  const loadProfiles = async () => {
    setIsLoading(true);
    try {
      const list = await accessKeyService.getProfiles();
      setProfiles(list || []);
    } catch (e) {
      console.warn('Failed to load profiles:', e);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const isAuthorized = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';
  if (!isAuthorized) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 rounded-3xl p-6 sm:p-8 max-w-md w-full text-center space-y-4 shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-lg font-black text-slate-900 dark:text-white">Admin Access Restricted</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              QR Access Keys & 6-Digit PIN management is restricted strictly to <strong>Super Admin</strong> and <strong>Admin</strong> roles.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            Close Window
          </button>
        </div>
      </div>
    );
  }

  const originUrl = typeof window !== 'undefined' ? window.location.origin : 'https://rma-portal-v2.vercel.app';

  const togglePinVisibility = (id) => {
    setVisiblePins(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopyLink = (slug) => {
    const fullUrl = `${originUrl}/intake/${slug}`;
    try {
      navigator.clipboard.writeText(fullUrl);
      setCopiedSlug(slug);
      setTimeout(() => setCopiedSlug(null), 2000);
    } catch (e) {
      console.warn('Copy failed:', e);
    }
  };

  const generateRandomPin = () => {
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    setFormData(prev => ({ ...prev, pinCode: pin }));
  };

  // Open Create Modal
  const handleOpenCreate = () => {
    setFormData({
      name: '',
      type: 'internal_warehouse',
      accessSlug: '',
      pinCode: Math.floor(100000 + Math.random() * 900000).toString(),
      sessionDurationHours: 0
    });
    setDurationMode('permanent');
    setCustomDurationVal(2);
    setCustomDurationUnit('hrs');
    setFormError('');
    setModalMode('create');
  };

  // Open Edit Modal
  const handleOpenEdit = (prof) => {
    setSelectedProfile(prof);
    const h = Number(prof.session_duration_hours || 0);
    if (h <= 0) {
      setDurationMode('permanent');
      setCustomDurationVal(2);
      setCustomDurationUnit('hrs');
    } else if (h * 60 < 60) {
      setDurationMode('custom');
      setCustomDurationVal(Math.round(h * 60));
      setCustomDurationUnit('mins');
    } else {
      setDurationMode('custom');
      setCustomDurationVal(h);
      setCustomDurationUnit('hrs');
    }
    setFormData({
      name: prof.name,
      type: prof.type,
      accessSlug: prof.access_slug,
      pinCode: prof.pin_code,
      sessionDurationHours: h
    });
    setFormError('');
    setModalMode('edit');
  };

  // Open Print Poster Modal
  const handleOpenPrint = (prof) => {
    setSelectedProfile(prof);
    setShowPinOnPoster(prof.type === 'internal_warehouse');
    setModalMode('print');
  };

  // Toggle Active/Inactive Status
  const handleToggleActive = async (prof) => {
    try {
      await accessKeyService.updateProfile(prof.access_slug, { is_active: !prof.is_active });
      loadProfiles();
    } catch (err) {
      alert(err.message || 'Failed to update status');
    }
  };

  // Submit Create or Edit Form
  const handleSubmitForm = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!formData.name.trim()) {
      setFormError('Please enter a profile name');
      return;
    }

    if (!/^\d{6}$/.test(String(formData.pinCode).trim())) {
      setFormError('PIN code must be exactly 6 numeric digits (0-9)');
      return;
    }

    setIsSaving(true);
    let finalDurationHours = 0;
    if (durationMode === 'custom') {
      const numVal = Math.max(0.1, parseFloat(customDurationVal) || 1);
      finalDurationHours = customDurationUnit === 'mins' ? numVal / 60 : numVal;
    }

    try {
      if (modalMode === 'create') {
        await accessKeyService.createProfile({
          name: formData.name,
          type: formData.type,
          accessSlug: formData.accessSlug,
          pinCode: formData.pinCode,
          sessionDurationHours: finalDurationHours,
          createdBy: currentUser?.name || 'Admin'
        });
      } else if (modalMode === 'edit' && selectedProfile) {
        await accessKeyService.updateProfile(selectedProfile.access_slug, {
          name: formData.name,
          type: formData.type,
          pin_code: formData.pinCode,
          session_duration_hours: finalDurationHours
        });
      }

      await loadProfiles();
      setModalMode('list');
    } catch (err) {
      setFormError(err.message || 'Failed to save profile');
    } finally {
      setIsSaving(false);
    }
  };

  // Delete profile
  const handleDeleteProfile = async (prof) => {
    if (!window.confirm(`Permanently delete QR Access Profile "${prof.name}" (/${prof.access_slug})?\n\nDevices scanning this QR code will no longer be granted intake access.`)) return;

    try {
      await accessKeyService.deleteProfile(prof.access_slug);
      await loadProfiles();
    } catch (err) {
      alert(err.message || 'Failed to delete');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-4xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >

        {/* Modal Header */}
        <div className="px-6 py-4.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/70 dark:bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center shadow-md shadow-blue-600/20">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                QR Access Keys & 6-Digit PIN Manager
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                  Gatekeeper
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Authorize warehouse docks and customer delivery cartons with role-based QR stations and expiring PINs.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {modalMode === 'list' && (
              <>
                {onOpenPinRequests && (
                  <button
                    type="button"
                    onClick={onOpenPinRequests}
                    className="px-3 py-2 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
                    title="View & Approve Pending Return Authorization PIN Requests"
                  >
                    <Mail className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    <span>PIN Requests</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleOpenCreate}
                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-md shadow-blue-600/20 transition-all cursor-pointer active:scale-95"
                >
                  <Plus className="w-4 h-4" />
                  <span>New QR Access Code</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* =================================================================== */}
        {/* VIEW 1: PROFILE LIST VIEW                                           */}
        {/* =================================================================== */}
        {modalMode === 'list' && (
          <div className="p-6 overflow-y-auto space-y-4 flex-1">
            {isLoading ? (
              <div className="text-center py-12 space-y-2">
                <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs font-bold text-slate-500">Loading Access Profiles...</p>
              </div>
            ) : profiles.length === 0 ? (
              <div className="text-center py-12 space-y-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700">
                <QrCode className="w-10 h-10 text-slate-400 mx-auto" />
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">No custom QR Access Profiles yet.</p>
                <button
                  type="button"
                  onClick={handleOpenCreate}
                  className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold"
                >
                  Create First QR Profile
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {profiles.map(prof => {
                  const isPinShown = visiblePins.has(prof.id || prof.access_slug);
                  const isCopied = copiedSlug === prof.access_slug;
                  const fullUrl = `${originUrl}/intake/${prof.access_slug}`;

                  return (
                    <div 
                      key={prof.id || prof.access_slug}
                      className={`relative p-5 rounded-2xl border transition-all ${
                        prof.is_active 
                          ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm hover:border-blue-400 dark:hover:border-blue-700' 
                          : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 opacity-60'
                      }`}
                    >
                      {/* Top Badges */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          prof.type === 'internal_warehouse'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-900'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900'
                        }`}>
                          {prof.type === 'internal_warehouse' ? 'Internal Warehouse' : 'External Customer'}
                        </span>

                        <div className="flex items-center gap-1.5">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            prof.is_active 
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}>
                            {prof.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                      </div>

                      {/* Station Title */}
                      <div className="flex items-start gap-3 mb-4">
                        <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 p-1 border border-slate-200 dark:border-slate-700 shrink-0 flex items-center justify-center">
                          <QRCodeSVG 
                            value={fullUrl}
                            size={40}
                            level="M"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                            {prof.name}
                          </h3>
                          <div className="flex items-center gap-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                            <span className="truncate">/intake/{prof.access_slug}</span>
                            <button
                              type="button"
                              onClick={() => handleCopyLink(prof.access_slug)}
                              className="text-blue-600 hover:text-blue-700 dark:text-blue-400 p-0.5"
                              title="Copy full scan URL"
                            >
                              {isCopied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Detail Metrics: 6-Digit PIN & Session Expiry */}
                      <div className="grid grid-cols-2 gap-2 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-800 text-xs mb-4">
                        <div>
                          <div className="text-[10px] font-black uppercase text-slate-400">6-Digit PIN</div>
                          <div className="flex items-center gap-1.5 font-mono font-black text-slate-900 dark:text-white mt-0.5">
                            <span>{isPinShown ? prof.pin_code : '••••••'}</span>
                            <button
                              type="button"
                              onClick={() => togglePinVisibility(prof.id || prof.access_slug)}
                              className="text-slate-400 hover:text-slate-600 p-0.5"
                            >
                              {isPinShown ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            </button>
                          </div>
                        </div>

                        <div>
                          <div className="text-[10px] font-black uppercase text-slate-400">Session Window</div>
                          <div className="flex items-center gap-1 font-bold text-slate-700 dark:text-slate-300 mt-0.5">
                            <Clock className="w-3 h-3 text-slate-400" />
                            <span>{formatDurationLabel(prof.session_duration_hours)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Card Action Buttons */}
                      <div className="flex items-center justify-between gap-1 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs font-bold">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenPrint(prof)}
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg flex items-center gap-1 transition-colors cursor-pointer text-xs font-bold"
                            title="Print official wall poster or delivery carton sticker"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>Poster / Sticker</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenEdit(prof)}
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg flex items-center gap-1 transition-colors cursor-pointer text-xs font-bold"
                            title="Change PIN or Session Expiry"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Edit PIN</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteProfile(prof)}
                            className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900 rounded-lg flex items-center gap-1 transition-colors cursor-pointer text-xs font-bold"
                            title="Permanently Delete QR Profile"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleToggleActive(prof)}
                            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                              prof.is_active
                                ? 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950 border-amber-200 dark:border-amber-900'
                                : 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 border-emerald-200 dark:border-emerald-900'
                            }`}
                            title={prof.is_active ? 'Deactivate QR Profile' : 'Reactivate QR Profile'}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* VIEW 2: CREATE / EDIT PROFILE FORM                                  */}
        {/* =================================================================== */}
        {(modalMode === 'create' || modalMode === 'edit') && (
          <form onSubmit={handleSubmitForm} className="p-6 overflow-y-auto space-y-5 flex-1">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-black text-slate-900 dark:text-white">
                {modalMode === 'create' ? 'Generate New QR Access Profile' : `Edit Profile: ${selectedProfile?.name}`}
              </h3>
              <button
                type="button"
                onClick={() => setModalMode('list')}
                className="text-xs font-bold text-slate-500 hover:text-slate-800"
              >
                Back to List
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-xl text-xs font-bold text-rose-700 dark:text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {/* Profile Name */}
            <div className="space-y-1.5">
              <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Station / Profile Name *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => {
                  const val = e.target.value;
                  setFormData(prev => ({
                    ...prev,
                    name: val,
                    accessSlug: modalMode === 'create' && !prev.accessSlug 
                      ? val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') 
                      : prev.accessSlug
                  }));
                }}
                placeholder="e.g. North Receiving Dock Wall"
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600"
              />
            </div>

            {/* Profile Type: Internal vs External */}
            <div className="space-y-1.5">
              <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Station Role / User Type *
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, type: 'internal_warehouse', sessionDurationHours: 0 }))}
                  className={`p-3.5 rounded-2xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                    formData.type === 'internal_warehouse'
                      ? 'bg-blue-50/70 border-blue-500 ring-2 ring-blue-500/20 dark:bg-blue-950/40'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-400'
                  }`}
                >
                  <Building2 className={`w-5 h-5 shrink-0 ${formData.type === 'internal_warehouse' ? 'text-blue-600' : 'text-slate-400'}`} />
                  <div>
                    <div className="text-xs font-black text-slate-900 dark:text-white">Internal Warehouse</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Warehouse dock scanners. Permanent unlock (no expiry).</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, type: 'external_customer', sessionDurationHours: 2 }))}
                  className={`p-3.5 rounded-2xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                    formData.type === 'external_customer'
                      ? 'bg-emerald-50/70 border-emerald-500 ring-2 ring-emerald-500/20 dark:bg-emerald-950/40'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-400'
                  }`}
                >
                  <Package className={`w-5 h-5 shrink-0 ${formData.type === 'external_customer' ? 'text-emerald-600' : 'text-slate-400'}`} />
                  <div>
                    <div className="text-xs font-black text-slate-900 dark:text-white">External Customer</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Delivery carton stickers. Expires after selected hours.</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Access Slug (URL) */}
            <div className="space-y-1.5">
              <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Access Slug (QR URL) *
              </label>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 shrink-0">
                  {originUrl}/intake/
                </span>
                <input
                  type="text"
                  required
                  disabled={modalMode === 'edit'}
                  value={formData.accessSlug}
                  onChange={(e) => setFormData(prev => ({ ...prev, accessSlug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '') }))}
                  placeholder="e.g. wh-dock-north"
                  className="flex-1 px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold font-mono text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 disabled:opacity-50"
                />
              </div>
            </div>

            {/* 6-Digit PIN Code & Randomizer */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  6-Digit Gatekeeper PIN *
                </label>
                <button
                  type="button"
                  onClick={generateRandomPin}
                  className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Generate Random PIN</span>
                </button>
              </div>
              <input
                type="text"
                required
                maxLength={6}
                inputMode="numeric"
                pattern="[0-9]*"
                value={formData.pinCode}
                onChange={(e) => setFormData(prev => ({ ...prev, pinCode: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                placeholder="e.g. 123456"
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-lg font-black font-mono tracking-widest text-slate-900 dark:text-white focus:outline-none focus:border-blue-600"
              />
            </div>

            {/* Customizable Session Expiration (Hours or Minutes) */}
            <div className="space-y-2">
              <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Session Expiration (Duration) *
              </label>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDurationMode('permanent')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    durationMode === 'permanent'
                      ? 'bg-blue-50 border-blue-500 ring-2 ring-blue-500/20 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="text-xs font-black">Permanent (No Expiry)</div>
                  <div className="text-[10px] opacity-75 mt-0.5">Stays unlocked indefinitely (Docks)</div>
                </button>

                <button
                  type="button"
                  onClick={() => setDurationMode('custom')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    durationMode === 'custom'
                      ? 'bg-emerald-50 border-emerald-500 ring-2 ring-emerald-500/20 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="text-xs font-black">Custom Expiration</div>
                  <div className="text-[10px] opacity-75 mt-0.5">Expires in minutes or hours</div>
                </button>
              </div>

              {durationMode === 'custom' && (
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2.5 animate-in fade-in">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="10000"
                      value={customDurationVal}
                      onChange={(e) => setCustomDurationVal(e.target.value)}
                      placeholder="Duration value"
                      className="w-28 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-black text-slate-900 dark:text-white focus:outline-none focus:border-blue-600"
                    />

                    <select
                      value={customDurationUnit}
                      onChange={(e) => setCustomDurationUnit(e.target.value)}
                      className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 cursor-pointer"
                    >
                      <option value="mins">Minutes</option>
                      <option value="hrs">Hours</option>
                    </select>

                    <span className="text-[11px] text-slate-500 dark:text-slate-400 font-bold ml-1 truncate">
                      = {customDurationUnit === 'mins' 
                          ? `${customDurationVal} min${customDurationVal === '1' ? '' : 's'}` 
                          : `${customDurationVal} hour${customDurationVal === '1' ? '' : 's'} (${(parseFloat(customDurationVal) || 0) * 60}m)`}
                    </span>
                  </div>

                  {/* Quick Preset Pills */}
                  <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-200 dark:border-slate-700">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Presets:</span>
                    {[
                      { label: '15m', val: 15, unit: 'mins' },
                      { label: '30m', val: 30, unit: 'mins' },
                      { label: '1h', val: 1, unit: 'hrs' },
                      { label: '2h', val: 2, unit: 'hrs' },
                      { label: '4h', val: 4, unit: 'hrs' },
                      { label: '12h', val: 12, unit: 'hrs' },
                      { label: '24h', val: 24, unit: 'hrs' }
                    ].map(p => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => {
                          setCustomDurationVal(p.val);
                          setCustomDurationUnit(p.unit);
                        }}
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer ${
                          String(customDurationVal) === String(p.val) && customDurationUnit === p.unit
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:border-slate-500'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Form Action Buttons */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalMode('list')}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-black transition-all shadow-md shadow-blue-600/20 cursor-pointer"
              >
                {isSaving ? 'Saving...' : modalMode === 'create' ? 'Create QR Profile' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}

        {/* =================================================================== */}
        {/* VIEW 3: PRINT POSTER / STICKER VIEW (DYNAMIC SIZES & ISOLATED PRINT)*/}
        {/* =================================================================== */}
        {modalMode === 'print' && selectedProfile && (
          <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                  Station QR Poster & Label: {selectedProfile.name}
                </h3>
                <p className="text-xs text-slate-500">
                  Select print size for workplace dock walls, cartons, or loose/unboxed items.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalMode('list')}
                className="text-xs font-bold text-slate-500 hover:text-slate-800 self-start sm:self-auto cursor-pointer"
              >
                Back to List
              </button>
            </div>

            {/* Dynamic Print Size Selector Bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Select Output Print Size:
                </label>
                <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400">
                  {printSize === 'a4' && 'Full Sheet Wall Poster (A4 / Letter)'}
                  {printSize === '4x6' && 'Standard 4" x 6" Carton Sticker'}
                  {printSize === '3x3' && 'Medium 3" x 3" Parcel Label'}
                  {printSize === '2x2' && 'Small 2" x 2" Tag (Unboxed / Loose Items)'}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'a4', label: 'Wall Poster', sub: 'A4 / Letter Sheet', badge: 'Dock Wall' },
                  { id: '4x6', label: 'Carton Sticker', sub: '4" x 6" Thermal', badge: 'Box/Crate' },
                  { id: '3x3', label: 'Medium Label', sub: '3" x 3" Thermal', badge: 'Polybag' },
                  { id: '2x2', label: 'Small Item Tag', sub: '2" x 2" Mini Tag', badge: 'Unboxed / Loose' }
                ].map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setPrintSize(s.id)}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      printSize === s.id
                        ? 'bg-blue-50 border-blue-600 ring-2 ring-blue-500/20 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-400'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-black">{s.label}</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                        {s.badge}
                      </span>
                    </div>
                    <div className="text-[10px] opacity-75 mt-0.5">{s.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Poster Sheet Preview Mount (Strict Target for Print) */}
            <div className="flex justify-center p-2 sm:p-4 bg-slate-100 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
              <div 
                id="portal-poster-print-mount"
                className={`bg-white text-black p-4 sm:p-6 rounded-2xl border-2 border-black shadow-lg text-center font-sans space-y-3 transition-all ${
                  printSize === '2x2' 
                    ? 'w-[200px] text-[10px] space-y-2 p-2.5' 
                    : printSize === '3x3' 
                    ? 'w-[280px] text-xs space-y-2.5 p-3.5' 
                    : printSize === '4x6' 
                    ? 'w-[340px] text-xs space-y-3 p-4' 
                    : 'w-full max-w-[420px] text-xs space-y-4 p-6'
                }`}
              >
                {/* Header */}
                <div className="border-b-2 border-black pb-2 space-y-0.5">
                  <div className="text-[9px] font-black uppercase tracking-widest text-black">
                    {selectedProfile.type === 'internal_warehouse' ? 'WHOLESALE WAREHOUSE DOCK' : 'CUSTOMER RETURN INTAKE'}
                  </div>
                  <h2 className={`font-black text-black uppercase leading-tight ${
                    printSize === '2x2' ? 'text-xs' : printSize === '3x3' ? 'text-sm' : 'text-base sm:text-lg'
                  }`}>
                    {selectedProfile.name}
                  </h2>
                  <p className="text-[10px] text-black font-medium">
                    Scan with <strong>Google Lens</strong> or QR scanner app
                  </p>
                </div>

                {/* QR Code */}
                <div className="inline-block p-2 bg-white border-2 border-black rounded-xl">
                  <QRCodeSVG
                    id="station-qr-svg"
                    value={`${originUrl}/intake/${selectedProfile.access_slug}`}
                    size={printSize === '2x2' ? 90 : printSize === '3x3' ? 120 : printSize === '4x6' ? 150 : 180}
                    level="H"
                    includeMargin={false}
                  />
                </div>

                {/* Slug Pill */}
                <div className="bg-black text-white font-mono text-[10px] font-bold py-1 px-2.5 rounded-lg inline-block max-w-full truncate">
                  {originUrl.replace(/^https?:\/\//, '')}/intake/{selectedProfile.access_slug}
                </div>

                {/* Optional 6-Digit PIN on Poster */}
                {showPinOnPoster && (
                  <div className="p-2 border-2 border-black rounded-xl bg-slate-50 space-y-0.5">
                    <div className="text-[9px] font-black uppercase tracking-wider text-black">
                      Station 6-Digit Gatekeeper PIN
                    </div>
                    <div className={`font-black font-mono tracking-widest text-black ${
                      printSize === '2x2' ? 'text-base' : 'text-xl'
                    }`}>
                      {selectedProfile.pin_code}
                    </div>
                  </div>
                )}

                {/* Numbered Google Lens Instructions (Compact on small tags) */}
                {printSize !== '2x2' ? (
                  <div className="text-left text-[10px] space-y-1 text-black pt-2 border-t-2 border-black">
                    <div><strong>1.</strong> Open <strong>Google Lens</strong> (or QR scanner) on phone.</div>
                    <div><strong>2.</strong> Point at QR code above & tap link to launch portal.</div>
                    <div><strong>3.</strong> Enter 6-digit station PIN when prompted.</div>
                  </div>
                ) : (
                  <div className="text-[9px] font-bold text-black border-t border-black pt-1">
                    Open Google Lens & Scan QR to Return
                  </div>
                )}
              </div>
            </div>

            {/* Poster Controls Bar */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showPinOnPoster}
                  onChange={(e) => setShowPinOnPoster(e.target.checked)}
                  className="rounded text-blue-600 w-4 h-4 cursor-pointer"
                />
                <span>Include 6-Digit PIN on Printed Sheet</span>
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-md shadow-blue-600/20 cursor-pointer active:scale-95 transition-all"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print {printSize === 'a4' ? 'Wall Poster' : printSize === '4x6' ? '4x6" Sticker' : printSize === '3x3' ? '3x3" Label' : '2x2" Tag'}</span>
                </button>
              </div>
            </div>

            {/* Embedded Print Stylesheet specifically for isolating the poster sheet */}
            <style>{`
              @media print {
                body * {
                  visibility: hidden !important;
                }
                #portal-poster-print-mount, #portal-poster-print-mount * {
                  visibility: visible !important;
                }
                #portal-poster-print-mount {
                  position: fixed !important;
                  left: 0 !important;
                  top: 0 !important;
                  margin: 0 !important;
                  background: #fff !important;
                  color: #000 !important;
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                  box-shadow: none !important;
                  border: 2px solid #000 !important;
                  padding: ${printSize === '2x2' ? '0.08in' : printSize === '3x3' ? '0.12in' : printSize === '4x6' ? '0.2in' : '0.4in'} !important;
                  width: ${printSize === 'a4' ? '100%' : printSize === '4x6' ? '4in' : printSize === '3x3' ? '3in' : '2in'} !important;
                  max-width: ${printSize === 'a4' ? '100%' : printSize === '4x6' ? '4in' : printSize === '3x3' ? '3in' : '2in'} !important;
                  height: ${printSize === 'a4' ? 'auto' : printSize === '4x6' ? '6in' : printSize === '3x3' ? '3in' : '2in'} !important;
                }
                @page {
                  size: ${printSize === 'a4' ? 'portrait' : printSize === '4x6' ? '4in 6in' : printSize === '3x3' ? '3in 3in' : '2in 2in'};
                  margin: 0;
                }
              }
            `}</style>

          </div>
        )}

      </div>
    </div>
  );
}
