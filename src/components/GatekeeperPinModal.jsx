import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  Lock, 
  Unlock, 
  QrCode, 
  Building2, 
  Package, 
  Clock, 
  AlertTriangle, 
  CheckCircle2, 
  LogIn, 
  Sparkles,
  ArrowRight,
  RefreshCw,
  HelpCircle,
  Mail,
  User,
  Building,
  FileText,
  Send,
  X,
  KeyRound,
  Check
} from 'lucide-react';
import { accessKeyService } from '../services/accessKeyService';
import { pinRequestService } from '../services/pinRequestService';
import { formatCooldownLabel } from './PortalAccessKeysModal';

export default function GatekeeperPinModal({
  isOpen,
  currentSlug,
  onUnlock,
  onOpenAdminLogin,
  isTestMode = false
}) {
  const [profile, setProfile] = useState(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(Boolean(currentSlug));
  const [pinDigits, setPinDigits] = useState(['', '', '', '', '', '']);
  const [errorMessage, setErrorMessage] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isShake, setIsShake] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);

  // Anti-Fraud Cooldown State
  const [cooldownInfo, setCooldownInfo] = useState(null);
  const [countdownString, setCountdownString] = useState('');

  // Request PIN Modal & Form State
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [requestForm, setRequestForm] = useState({
    email: '',
    name: '',
    organization: '',
    notes: ''
  });
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [requestSuccess, setRequestSuccess] = useState(false);
  const [requestError, setRequestError] = useState('');

  const inputRefs = [
    useRef(null),
    useRef(null),
    useRef(null),
    useRef(null),
    useRef(null),
    useRef(null)
  ];

  // 1. Reset state whenever modal opens or closes
  useEffect(() => {
    if (isOpen) {
      setIsVerifying(false);
      setIsSuccess(false);
      setPinDigits(['', '', '', '', '', '']);
      setErrorMessage('');
      setLockoutSeconds(0);
      setCooldownInfo(null);
      setCountdownString('');
      setIsRequestModalOpen(false);
      setRequestSuccess(false);
      setRequestError('');
    }
  }, [isOpen]);

  // 2. Fetch profile & check device cooldown when slug changes or modal opens
  useEffect(() => {
    let isMounted = true;
    if (!isOpen || !currentSlug) {
      setProfile(null);
      setIsLoadingProfile(false);
      setCooldownInfo(null);
      return;
    }

    setIsLoadingProfile(true);
    setErrorMessage('');
    setPinDigits(['', '', '', '', '', '']);

    accessKeyService.getProfileBySlug(currentSlug)
      .then(prof => {
        if (!isMounted) return;
        setProfile(prof);
        setIsLoadingProfile(false);

        // Check if device is in cooldown for this profile
        if (prof?.type === 'external_customer') {
          accessKeyService.checkDeviceCooldown(currentSlug).then(cd => {
            if (!isMounted) return;
            if (cd && cd.isCooldownActive) {
              setCooldownInfo(cd);
            }
          });
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setProfile(null);
        setIsLoadingProfile(false);
      });

    return () => { isMounted = false; };
  }, [isOpen, currentSlug]);

  // Live ticking countdown for Cooldown Lockout Screen
  useEffect(() => {
    if (!cooldownInfo?.unlocksAt) return;

    const updateTimer = () => {
      const now = Date.now();
      const target = new Date(cooldownInfo.unlocksAt).getTime();
      const diffMs = target - now;

      if (diffMs <= 0) {
        setCooldownInfo(null);
        setCountdownString('');
        return;
      }

      const totalSec = Math.floor(diffMs / 1000);
      const hours = Math.floor(totalSec / 3600);
      const minutes = Math.floor((totalSec % 3600) / 60);
      const seconds = totalSec % 60;

      const pad = (n) => String(n).padStart(2, '0');
      setCountdownString(`${pad(hours)}:${pad(minutes)}:${pad(seconds)}`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [cooldownInfo]);

  // Auto-focus first PIN box on open
  useEffect(() => {
    if (isOpen && !isLoadingProfile && profile?.is_active && inputRefs[0].current) {
      setTimeout(() => {
        inputRefs[0].current?.focus();
      }, 150);
    }
  }, [isOpen, isLoadingProfile, profile]);

  // Lockout countdown timer
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const interval = setInterval(() => {
      setLockoutSeconds(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutSeconds]);

  if (!isOpen) return null;

  // Handle individual digit input
  const handleDigitChange = (index, value) => {
    if (lockoutSeconds > 0 || isVerifying || isSuccess) return;

    // Handle multi-character paste (e.g. pasting "123456")
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length > 1) {
      const digits = cleaned.slice(0, 6).split('');
      const newPin = [...pinDigits];
      digits.forEach((d, i) => {
        if (i < 6) newPin[i] = d;
      });
      setPinDigits(newPin);
      const nextIndex = Math.min(5, digits.length);
      inputRefs[nextIndex]?.current?.focus();

      if (digits.length === 6) {
        verifyPinCode(newPin.join(''));
      }
      return;
    }

    const singleDigit = cleaned.slice(-1);
    const newPin = [...pinDigits];
    newPin[index] = singleDigit;
    setPinDigits(newPin);
    setErrorMessage('');

    // Auto-advance to next box
    if (singleDigit && index < 5) {
      inputRefs[index + 1]?.current?.focus();
    }

    // Auto-verify when 6th digit entered
    if (index === 5 && singleDigit) {
      const completePin = newPin.join('');
      if (completePin.length === 6) {
        verifyPinCode(completePin);
      }
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace') {
      if (!pinDigits[index] && index > 0) {
        inputRefs[index - 1]?.current?.focus();
      } else {
        const newPin = [...pinDigits];
        newPin[index] = '';
        setPinDigits(newPin);
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs[index - 1]?.current?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs[index + 1]?.current?.focus();
    }
  };

  // Perform PIN verification against accessKeyService
  const verifyPinCode = async (pinString) => {
    if (!profile) return;
    setIsVerifying(true);
    setErrorMessage('');

    try {
      const res = await accessKeyService.verifyPin(profile.access_slug, pinString);

      if (res && res.success) {
        setIsSuccess(true);
        setTimeout(() => {
          setIsVerifying(false);
          setIsSuccess(false);
          onUnlock(res.session);
        }, 500);
      } else if (res && res.error === 'COOLDOWN_ACTIVE') {
        // Anti-Fraud Cooldown Lockout triggered
        setIsVerifying(false);
        setCooldownInfo(res);
      } else {
        setIsVerifying(false);
        setIsShake(true);
        setTimeout(() => setIsShake(false), 500);

        if (res && (res.error === 'LOCKED' || res.isLocked)) {
          setLockoutSeconds(res.secondsLeft || 30);
        }
        setErrorMessage(res?.message || 'Incorrect PIN code. Please retry.');
        setPinDigits(['', '', '', '', '', '']);
        setTimeout(() => inputRefs[0]?.current?.focus(), 100);
      }
    } catch (err) {
      console.error('PIN verification error:', err);
      setIsVerifying(false);
      setErrorMessage('Verification failed. Please retry.');
      setPinDigits(['', '', '', '', '', '']);
      setTimeout(() => inputRefs[0]?.current?.focus(), 100);
    }
  };

  // Refresh Cooldown Lockout state
  const handleRefreshCooldown = async () => {
    setIsVerifying(true);
    try {
      const cd = await accessKeyService.checkDeviceCooldown(profile?.access_slug || currentSlug);
      if (!cd || !cd.isCooldownActive) {
        setCooldownInfo(null);
        setCountdownString('');
      } else {
        setCooldownInfo(cd);
      }
    } finally {
      setIsVerifying(false);
    }
  };

  // Sandbox Quick Unlock for QA & Development
  const handleSandboxUnlock = (overrideSlug = null) => {
    const slugToUse = overrideSlug || profile?.access_slug || 'dock';
    accessKeyService.getProfileBySlug(slugToUse).then(prof => {
      const target = prof || {
        name: 'Sandbox Warehouse Station',
        type: 'internal_warehouse',
        access_slug: slugToUse,
        session_duration_hours: 0
      };
      const session = accessKeyService.createSession(target);
      setIsSuccess(true);
      setTimeout(() => {
        setIsVerifying(false);
        setIsSuccess(false);
        onUnlock(session);
      }, 400);
    });
  };

  // Submit PIN Authorization Request
  const handleRequestSubmit = async (e) => {
    e?.preventDefault();
    if (!profile) return;
    if (!requestForm.email || !requestForm.name || !requestForm.organization) {
      setRequestError('Please fill in your email, full name, and store/company location.');
      return;
    }
    setIsSubmittingRequest(true);
    setRequestError('');
    try {
      await pinRequestService.createPinRequest({
        accessSlug: profile.access_slug,
        accessKeyId: profile.id,
        requesterEmail: requestForm.email,
        requesterName: requestForm.name,
        organizationName: requestForm.organization,
        notes: requestForm.notes
      });
      setIsSubmittingRequest(false);
      setRequestSuccess(true);
    } catch (err) {
      console.error('Submit PIN request error:', err);
      setIsSubmittingRequest(false);
      setRequestError(err.message || 'Failed to submit PIN request. Please try again.');
    }
  };

  // Test mode auto-fill & unlock helper
  const handleAutoFillTestPin = () => {
    if (!profile?.pin_code) return;
    const digits = profile.pin_code.split('');
    setPinDigits(digits);
    setIsRequestModalOpen(false);
    setRequestSuccess(false);
    verifyPinCode(profile.pin_code);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-8 overflow-y-auto bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className={`relative w-full max-w-md my-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden p-7 sm:p-9 max-h-[90vh] overflow-y-auto ${
          isShake ? 'animate-shake' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glow ambient background element */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-24 bg-blue-500/10 blur-3xl rounded-full pointer-events-none" />

        {/* ================================================================= */}
        {/* STATE A: ROOT VISIT WITH NO ACTIVE SLUG & NO ACTIVE SESSION       */}
        {/* ================================================================= */}
        {!currentSlug ? (
          <div className="text-center space-y-6">
            <div className="w-16 h-16 rounded-3xl bg-blue-50 dark:bg-blue-950/70 border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto shadow-lg shadow-blue-500/10">
              <QrCode className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                <Lock className="w-3 h-3 text-slate-500" />
                <span>Station Scan Required</span>
              </div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white">
                Official RMA Gatekeeper
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-xs mx-auto">
                Please open <strong>Google Lens</strong> or your phone's QR scanner to scan the official code located at the <strong>warehouse dock wall</strong> or on your <strong>product delivery carton</strong>.
              </p>
            </div>

            {/* Visual Guide Box */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700/80 text-left space-y-2.5 text-xs">
              <div className="flex items-center gap-2.5 font-bold text-slate-800 dark:text-slate-200">
                <div className="w-6 h-6 rounded-lg bg-blue-600 text-white flex items-center justify-center text-[11px] font-black shrink-0">1</div>
                <span>Warehouse Staff: Open Google Lens & scan dock poster</span>
              </div>
              <div className="flex items-center gap-2.5 font-bold text-slate-800 dark:text-slate-200">
                <div className="w-6 h-6 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-[11px] font-black shrink-0">2</div>
                <span>Customer Repackers: Open Google Lens & scan carton sticker</span>
              </div>
            </div>

            {/* Sandbox QA bypass if Test Mode ON */}
            {isTestMode && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 rounded-2xl space-y-2 text-xs">
                <div className="flex items-center justify-between text-[11px] font-bold text-amber-800 dark:text-amber-300">
                  <span className="flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> Test Mode: Sandbox Bypass</span>
                  <span>QA Helper</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleSandboxUnlock('dock')}
                    className="py-1.5 px-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-[11px] rounded-xl shadow-xs transition-all cursor-pointer"
                  >
                    Dock Station (Perm)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSandboxUnlock('returns')}
                    className="py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-white font-extrabold text-[11px] rounded-xl shadow-xs transition-all cursor-pointer"
                  >
                    Customer Box (2h)
                  </button>
                </div>
              </div>
            )}

            {/* Bottom Actions */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-center gap-4 text-xs font-bold">
              <button
                type="button"
                onClick={onOpenAdminLogin}
                className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1.5 cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Admin & Staff Login</span>
              </button>
            </div>
          </div>
        ) : isLoadingProfile ? (
          /* Loading Profile State */
          <div className="text-center py-12 space-y-3">
            <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
            <p className="text-xs font-bold text-slate-500">Verifying QR Station Profile...</p>
          </div>
        ) : !profile || !profile.is_active ? (
          /* Inactive or Missing Profile State */
          <div className="text-center space-y-5">
            <div className="w-16 h-16 rounded-3xl bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto shadow-lg shadow-rose-500/10">
              <ShieldAlert className="w-8 h-8" />
            </div>

            <div className="space-y-1.5">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                Access Prohibited
              </span>
              <h2 className="text-lg font-black text-slate-900 dark:text-white">
                QR Station Inactive or Missing
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                The access code <code>"{currentSlug}"</code> has been deactivated or was not found. Please contact your warehouse supervisor or scan a current active QR poster.
              </p>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  window.location.href = window.location.origin;
                }}
                className="w-full py-2.5 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Return to Portal Home
              </button>
              <button
                type="button"
                onClick={onOpenAdminLogin}
                className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline pt-1"
              >
                Supervisor Login
              </button>
            </div>
          </div>
        ) : cooldownInfo?.unlocksAt ? (
          /* ================================================================= */
          /* STATE C: ENTERPRISE COOLDOWN LOCKOUT SCREEN                       */
          /* ================================================================= */
          <div className="space-y-6 text-center animate-in fade-in zoom-in-95">
            {/* Shield Alert Glow Icon */}
            <div className="relative mx-auto w-16 h-16 rounded-3xl bg-amber-50 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-700/80 text-amber-600 dark:text-amber-400 flex items-center justify-center shadow-lg shadow-amber-500/10">
              <ShieldAlert className="w-8 h-8 animate-pulse" />
              <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 border-2 border-white dark:border-slate-900" />
            </div>

            <div className="space-y-2">
              <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
                Security Lockout • Anti-Duplicate Shield
              </span>
              <h2 className="text-xl font-black text-slate-900 dark:text-white">
                Return Window Currently Locked
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed max-w-sm mx-auto">
                Your previous RMA intake session has concluded. To protect inventory records and prevent duplicate submissions, this portal will unlock again for this device once the cooldown period completes.
              </p>
            </div>

            {/* Live Ticking Countdown Box */}
            <div className="p-5 bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-800/80 dark:to-slate-850 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-inner space-y-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Device Unlocks In
              </div>
              <div className="text-3xl sm:text-4xl font-mono font-black tracking-widest text-slate-900 dark:text-white">
                {countdownString || 'Calculating...'}
              </div>
              <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200 dark:border-slate-700/80">
                Unlocks At: {new Date(cooldownInfo.unlocksAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, {new Date(cooldownInfo.unlocksAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            </div>

            {/* Profile Info Pill */}
            <div className="flex items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono">
              <span className="truncate">Station: <strong>{profile?.name || currentSlug}</strong></span>
              <span>•</span>
              <span>Cooldown: <strong>{formatCooldownLabel(cooldownInfo.cooldownDurationHours || profile?.cooldown_duration_hours || 6)}</strong></span>
            </div>

            {/* Actions: Refresh & Contact Support & Supervisor Override */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2 text-xs">
              <button
                type="button"
                onClick={handleRefreshCooldown}
                disabled={isVerifying}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-black transition-all shadow-md shadow-blue-600/20 flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
                <span>{isVerifying ? 'Checking Status...' : 'Refresh Lockout Status'}</span>
              </button>

              <div className="flex items-center justify-between pt-1 font-bold">
                <a
                  href="mailto:finance2@keysysincorporated.com?subject=Urgent%20RMA%20Portal%20Unlock%20Request"
                  className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1"
                >
                  <Mail className="w-3.5 h-3.5 text-slate-400" />
                  <span>Contact Support / AE</span>
                </a>

                <button
                  type="button"
                  onClick={onOpenAdminLogin}
                  className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Supervisor Override</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* ================================================================= */
          /* STATE B: VALID PROFILE -> 6-DIGIT PIN ENTRY SCREEN               */
          /* ================================================================= */
          <div className="space-y-6 text-center">
            
            {/* Header Icon & Badges */}
            <div className="space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center mx-auto shadow-lg shadow-blue-600/30">
                {isSuccess ? (
                  <CheckCircle2 className="w-7 h-7 text-white animate-in zoom-in" />
                ) : profile.type === 'internal_warehouse' ? (
                  <Building2 className="w-7 h-7 text-white" />
                ) : (
                  <Package className="w-7 h-7 text-white" />
                )}
              </div>

              <div>
                <div className="flex items-center justify-center gap-1.5 mb-1.5 flex-wrap">
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                    profile.type === 'internal_warehouse'
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-900'
                      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900'
                  }`}>
                    {profile.type === 'internal_warehouse' ? 'Internal Warehouse Dock' : 'Customer Delivery Box'}
                  </span>

                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    <Clock className="w-3 h-3" />
                    {profile.session_duration_hours === 0 ? 'Permanent Device Unlock' : `${profile.session_duration_hours}h Active Session`}
                  </span>
                </div>

                <h2 className="text-xl font-black text-slate-900 dark:text-white">
                  {profile.name}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Enter official 6-digit gatekeeper PIN to activate this device
                </p>
              </div>
            </div>

            {/* 6-Box Numeric PIN Inputs */}
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-2 sm:gap-2.5">
                {pinDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={inputRefs[idx]}
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={idx === 0 ? 6 : 1}
                    value={digit}
                    disabled={lockoutSeconds > 0 || isVerifying || isSuccess}
                    onChange={(e) => handleDigitChange(idx, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(idx, e)}
                    className={`w-11 h-13 sm:w-12 sm:h-14 text-center text-xl sm:text-2xl font-black font-mono rounded-2xl border transition-all duration-150 focus:outline-none ${
                      isSuccess
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                        : errorMessage
                        ? 'bg-rose-50 border-rose-400 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                        : digit
                        ? 'bg-blue-50/50 border-blue-500 text-blue-900 dark:bg-blue-950/50 dark:text-blue-100'
                        : 'bg-slate-50 dark:bg-slate-800/80 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20'
                    }`}
                  />
                ))}
              </div>

              {/* Status / Error Messages */}
              {isVerifying ? (
                <div className="flex items-center justify-center gap-2 text-xs font-bold text-blue-600 dark:text-blue-400 animate-pulse">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying PIN code...</span>
                </div>
              ) : isSuccess ? (
                <div className="flex items-center justify-center gap-1.5 text-xs font-black text-emerald-600 dark:text-emerald-400 animate-in zoom-in">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>PIN Verified! Unlocking Scanner...</span>
                </div>
              ) : errorMessage ? (
                <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-rose-600 dark:text-rose-400 animate-in fade-in">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              ) : (
                <div className="text-[11px] text-slate-400">
                  Numeric digits 0–9 • Auto-verifies on 6th digit
                </div>
              )}

              {/* Option: Request Authorization PIN */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setRequestSuccess(false);
                    setRequestError('');
                    setIsRequestModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50/80 hover:bg-blue-100 dark:bg-blue-950/50 dark:hover:bg-blue-900/60 border border-blue-200/80 dark:border-blue-800/80 transition-all cursor-pointer shadow-xs active:scale-95"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Don't have the 6-digit PIN? Request Access Here</span>
                </button>
              </div>
            </div>

            {/* Test Mode Quick Bypass (QA Helper) */}
            {isTestMode && (
              <div className="p-2.5 bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 rounded-2xl flex items-center justify-between text-xs">
                <span className="font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  Test Mode PIN: <code>{profile.pin_code}</code>
                </span>
                <button
                  type="button"
                  onClick={() => handleSandboxUnlock(profile.access_slug)}
                  className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-[11px] rounded-xl shadow-xs transition-all cursor-pointer"
                >
                  Quick Unlock
                </button>
              </div>
            )}

            {/* Footer Navigation */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs font-bold text-slate-500">
              <button
                type="button"
                onClick={() => {
                  window.location.href = window.location.origin;
                }}
                className="hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={onOpenAdminLogin}
                className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>Admin Login</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>

          </div>
        )}

        {/* ================================================================= */}
        {/* SUB-MODAL: REQUEST 6-DIGIT RETURN AUTHORIZATION PIN               */}
        {/* ================================================================= */}
        {isRequestModalOpen && (
          <div className="absolute inset-0 bg-white dark:bg-slate-900 z-30 p-6 sm:p-7 flex flex-col justify-between overflow-y-auto animate-in slide-in-from-bottom duration-200">
            <div>
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                    <KeyRound className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-900 dark:text-white leading-tight">
                      Request Authorization PIN
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Station: {profile?.name || currentSlug}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsRequestModalOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {!requestSuccess ? (
                <>
                  {/* Step-by-Step Guidance Banner */}
                  <div className="mt-4 p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 space-y-2 text-xs">
                    <div className="text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1">
                      📋 How It Works:
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                      <div className="flex items-start gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">1</span>
                        <span>Submit your store &amp; contact details</span>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">2</span>
                        <span>Admin reviews &amp; approves request</span>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">3</span>
                        <span>Receive 6-digit PIN directly via email</span>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">4</span>
                        <span>Reuse PIN anytime for future returns!</span>
                      </div>
                    </div>
                  </div>

                  {/* Submission Form */}
                  <form onSubmit={handleRequestSubmit} className="mt-4 space-y-3">
                    {/* Email */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Your Email Address <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="email"
                          required
                          value={requestForm.email}
                          onChange={(e) => setRequestForm({ ...requestForm, email: e.target.value })}
                          placeholder="reporter@supermarket.com"
                          className="w-full pl-9 pr-3 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                        />
                      </div>
                    </div>

                    {/* Full Name */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Your Full Name <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          required
                          value={requestForm.name}
                          onChange={(e) => setRequestForm({ ...requestForm, name: e.target.value })}
                          placeholder="Juan Dela Cruz"
                          className="w-full pl-9 pr-3 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                        />
                      </div>
                    </div>

                    {/* Organization / Location */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Company / Supermarket / Location <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative">
                        <Building className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          required
                          value={requestForm.organization}
                          onChange={(e) => setRequestForm({ ...requestForm, organization: e.target.value })}
                          placeholder="e.g. Savemore Market Branch 5"
                          className="w-full pl-9 pr-3 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                        />
                      </div>
                    </div>

                    {/* Optional Reason / Notes */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Brief Reason / Delivery Reference <span className="text-slate-400 text-[10px]">(Optional)</span>
                      </label>
                      <div className="relative">
                        <FileText className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                        <textarea
                          rows="2"
                          value={requestForm.notes}
                          onChange={(e) => setRequestForm({ ...requestForm, notes: e.target.value })}
                          placeholder="e.g. Received damaged box of canned goods from delivery #104"
                          className="w-full pl-9 pr-3 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                        />
                      </div>
                    </div>

                    {/* Error Notice */}
                    {requestError && (
                      <div className="p-2.5 bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 rounded-xl flex items-center gap-2 text-xs font-bold text-rose-700 dark:text-rose-300">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>{requestError}</span>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="pt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsRequestModalOpen(false)}
                        className="w-1/3 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
                      >
                        Back
                      </button>
                      <button
                        type="submit"
                        disabled={isSubmittingRequest}
                        className="w-2/3 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-black shadow-md shadow-blue-600/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        {isSubmittingRequest ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Submitting Request...</span>
                          </>
                        ) : (
                          <>
                            <Send className="w-3.5 h-3.5" />
                            <span>Submit PIN Request</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                /* Confirmation State */
                <div className="mt-6 text-center space-y-4 animate-in fade-in zoom-in-95 duration-200">
                  <div className="w-16 h-16 rounded-3xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/10">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>

                  <div className="space-y-1.5">
                    <h4 className="text-lg font-black text-slate-900 dark:text-white">
                      Request Submitted!
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-300 max-w-sm mx-auto leading-relaxed">
                      Our administrative team has been notified. Please check your inbox (and spam folder) at <strong className="text-blue-600 dark:text-blue-400">{requestForm.email}</strong> for the 6-digit access PIN.
                    </p>
                  </div>

                  {/* Test Mode Sandbox Bypass (QA Requirement 5) */}
                  {isTestMode && profile?.pin_code && (
                    <div className="p-3.5 bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 rounded-2xl text-left space-y-2">
                      <div className="flex items-center justify-between text-xs font-extrabold text-amber-800 dark:text-amber-300">
                        <span className="flex items-center gap-1">
                          <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                          Test Mode Sandbox Active
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-200/80 dark:bg-amber-900 text-amber-900 dark:text-amber-200 font-mono">
                          QA Bypass
                        </span>
                      </div>
                      <p className="text-[11px] text-amber-900/90 dark:text-amber-200 leading-snug">
                        Developers and testers do not need to wait for email delivery. The active PIN for this profile is:
                      </p>
                      <div className="p-2 bg-amber-100/70 dark:bg-amber-900/40 rounded-xl text-center font-mono font-black text-xl tracking-widest text-amber-950 dark:text-amber-100">
                        {profile.pin_code}
                      </div>
                      <button
                        type="button"
                        onClick={handleAutoFillTestPin}
                        className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-black shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Auto-Fill PIN &amp; Unlock Now</span>
                      </button>
                    </div>
                  )}

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsRequestModalOpen(false);
                        setRequestSuccess(false);
                        setTimeout(() => inputRefs[0]?.current?.focus(), 150);
                      }}
                      className="w-full py-2.5 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                    >
                      Return to 6-Digit PIN Screen
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 text-center border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400">
              Keysys &amp; Pingcon Automated Return Authorization Gatekeeper
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

