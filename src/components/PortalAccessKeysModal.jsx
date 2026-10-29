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
  Power
} from 'lucide-react';
import { accessKeyService, DEFAULT_ACCESS_PROFILES } from '../services/accessKeyService';
import { downloadPortalPosterPng, downloadQrCodePng, printPortalPoster } from '../utils/qrDownload';

export default function PortalAccessKeysModal({ isOpen, onClose, currentUser }) {
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
    setFormError('');
    setModalMode('create');
  };

  // Open Edit Modal
  const handleOpenEdit = (prof) => {
    setSelectedProfile(prof);
    setFormData({
      name: prof.name,
      type: prof.type,
      accessSlug: prof.access_slug,
      pinCode: prof.pin_code,
      sessionDurationHours: prof.session_duration_hours || 0
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
    try {
      if (modalMode === 'create') {
        await accessKeyService.createProfile({
          name: formData.name,
          type: formData.type,
          accessSlug: formData.accessSlug,
          pinCode: formData.pinCode,
          sessionDurationHours: formData.sessionDurationHours,
          createdBy: currentUser?.name || 'Admin'
        });
      } else if (modalMode === 'edit' && selectedProfile) {
        await accessKeyService.updateProfile(selectedProfile.access_slug, {
          name: formData.name,
          type: formData.type,
          pin_code: formData.pinCode,
          session_duration_hours: Number(formData.sessionDurationHours || 0)
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
    if (prof.access_slug === 'dock' || prof.access_slug === 'returns') {
      alert('Default system profiles cannot be deleted. You can deactivate them instead.');
      return;
    }
    if (!window.confirm(`Permanently delete QR Access Profile "${prof.name}"?`)) return;

    try {
      await accessKeyService.deleteProfile(prof.access_slug);
      loadProfiles();
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
            <div className="w-10 h-10 rounded-2xl bg-linear-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center shadow-md shadow-blue-600/20">
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
              <button
                type="button"
                onClick={handleOpenCreate}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-md shadow-blue-600/20 transition-all cursor-pointer active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span>New QR Access Code</span>
              </button>
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
                            <span>{prof.session_duration_hours === 0 ? 'Permanent (0h)' : `${prof.session_duration_hours} Hours`}</span>
                          </div>
                        </div>
                      </div>

                      {/* Card Action Buttons */}
                      <div className="flex items-center justify-between gap-1 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs font-bold">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenPrint(prof)}
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                            title="Print official wall poster or delivery carton sticker"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>Poster / Sticker</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenEdit(prof)}
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                            title="Change PIN or Session Expiry"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Edit PIN</span>
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

                          {prof.access_slug !== 'dock' && prof.access_slug !== 'returns' && (
                            <button
                              type="button"
                              onClick={() => handleDeleteProfile(prof)}
                              className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950 border border-rose-200 dark:border-rose-900 transition-colors cursor-pointer"
                              title="Delete QR Profile"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
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

            {/* Session Duration Selector */}
            <div className="space-y-1.5">
              <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Session Expiration (Duration) *
              </label>
              <select
                value={formData.sessionDurationHours}
                onChange={(e) => setFormData(prev => ({ ...prev, sessionDurationHours: parseInt(e.target.value, 10) }))}
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 cursor-pointer"
              >
                <option value={0}>0 Hours (Permanent / No Expiration - Warehouse Dock)</option>
                <option value={2}>2 Hours (Recommended for Customer Delivery Cartons)</option>
                <option value={4}>4 Hours</option>
                <option value={12}>12 Hours (Half-Day Shift)</option>
                <option value={24}>24 Hours (Full-Day Return Window)</option>
                <option value={48}>48 Hours (Weekend Intake)</option>
              </select>
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
        {/* VIEW 3: PRINT POSTER / STICKER VIEW                                 */}
        {/* =================================================================== */}
        {modalMode === 'print' && selectedProfile && (
          <div className="p-6 overflow-y-auto space-y-6 flex-1">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                  Workplace Poster & Box Sticker: {selectedProfile.name}
                </h3>
                <p className="text-xs text-slate-500">Ready for A4 workplace printing or adhesive carton label.</p>
              </div>
              <button
                type="button"
                onClick={() => setModalMode('list')}
                className="text-xs font-bold text-slate-500 hover:text-slate-800"
              >
                Back to List
              </button>
            </div>

            {/* Poster Sheet Preview Mount */}
            <div className="max-w-md mx-auto bg-white text-slate-950 p-6 rounded-3xl border-2 border-slate-900 shadow-xl space-y-5 text-center font-sans">
              
              <div className="space-y-1 border-b pb-3 border-slate-200">
                <div className="text-[10px] font-black uppercase tracking-widest text-blue-600">
                  {selectedProfile.type === 'internal_warehouse' ? 'WHOLESALE WAREHOUSE DOCK' : 'CUSTOMER RETURN INTAKE'}
                </div>
                <h2 className="text-xl font-black text-slate-900 uppercase">
                  {selectedProfile.name}
                </h2>
                <p className="text-[11px] text-slate-600">Scan with mobile phone camera to file return report</p>
              </div>

              {/* High-Resolution QR */}
              <div className="inline-block p-4 bg-slate-50 border-2 border-slate-900 rounded-2xl">
                <QRCodeSVG
                  id="station-qr-svg"
                  value={`${originUrl}/intake/${selectedProfile.access_slug}`}
                  size={200}
                  level="H"
                  includeMargin={true}
                />
              </div>

              {/* Station URL Pill */}
              <div className="bg-slate-900 text-white font-mono text-xs font-bold py-1.5 px-3 rounded-xl inline-block max-w-full truncate">
                {originUrl.replace(/^https?:\/\//, '')}/intake/{selectedProfile.access_slug}
              </div>

              {/* Optional 6-Digit PIN on Poster */}
              {showPinOnPoster && (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl space-y-1">
                  <div className="text-[10px] font-black uppercase tracking-wider text-amber-900">
                    Station 6-Digit Gatekeeper PIN
                  </div>
                  <div className="text-2xl font-black font-mono tracking-widest text-slate-900">
                    {selectedProfile.pin_code}
                  </div>
                </div>
              )}

              {/* Instructions */}
              <div className="text-left text-[11px] space-y-1 text-slate-600 pt-2 border-t border-slate-200">
                <div><strong>1.</strong> Point phone camera at QR code above.</div>
                <div><strong>2.</strong> Enter 6-digit gatekeeper PIN when prompted.</div>
                <div><strong>3.</strong> Scan damaged carton barcode and snap defect photos.</div>
              </div>
            </div>

            {/* Poster Controls Bar */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showPinOnPoster}
                  onChange={(e) => setShowPinOnPoster(e.target.checked)}
                  className="rounded text-blue-600 w-4 h-4"
                />
                <span>Include 6-Digit PIN on Printable Poster</span>
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-blue-600/20 cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Sheet</span>
                </button>
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
