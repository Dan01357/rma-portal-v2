import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  Lock, 
  LogIn, 
  RefreshCw, 
  AlertTriangle,
  Building2,
  Clock,
  Mail,
  UserCheck,
  CheckCircle,
  ArrowRight
} from 'lucide-react';
import { inviteService, maskEmail, formatRemainingCountdown } from '../services/inviteService';

export default function GatekeeperPinModal({
  isOpen,
  currentSlug,
  onUnlock,
  onOpenAdminLogin,
  isTestMode = false
}) {
  const [token, setToken] = useState(null);
  const [isValidating, setIsValidating] = useState(true);
  const [validationResult, setValidationResult] = useState(null); // { valid, invite, error }
  const [inputEmail, setInputEmail] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [accessDeniedEmail, setAccessDeniedEmail] = useState(null);
  const [countdownStr, setCountdownStr] = useState('');
  const [validationError, setValidationError] = useState(null);

  // 1. Resolve token from URL on mount or change
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const urlParams = new URLSearchParams(window.location.search);
    let t = urlParams.get('token');

    if (!t && window.location.hash.includes('token=')) {
      const match = window.location.hash.match(/token=([^&]+)/);
      if (match && match[1]) t = decodeURIComponent(match[1]);
    }

    setToken(t || null);
  }, [isOpen]);

  // 2. Validate token when token is present
  useEffect(() => {
    let isMounted = true;
    if (!token) {
      setIsValidating(false);
      setValidationResult(null);
      return;
    }

    setIsValidating(true);
    inviteService.validateInviteToken(token).then(res => {
      if (!isMounted) return;
      setValidationResult(res);
      setIsValidating(false);

      if (res?.valid && res?.invite) {
        // Pre-fill email if previously verified or saved on this browser
        try {
          const savedEmail = localStorage.getItem('rma_portal_verified_email') || localStorage.getItem('rma_reporter_contact') || '';
          if (savedEmail && savedEmail.toLowerCase().trim() === res.invite.authorized_email.toLowerCase().trim()) {
            setInputEmail(res.invite.authorized_email);
          } else if (!inputEmail) {
            setInputEmail(res.invite.authorized_email);
          }
        } catch {
          setInputEmail(res.invite.authorized_email);
        }
      }
    });

    return () => { isMounted = false; };
  }, [token]);

  // 3. Countdown timer for valid invite
  useEffect(() => {
    if (!validationResult?.invite?.expires_at) return;

    const updateTimer = () => {
      const countdown = formatRemainingCountdown(validationResult.invite.expires_at, validationResult.invite.status);
      setCountdownStr(countdown.text);
      if (countdown.isExpired) {
        setValidationResult(prev => prev ? { ...prev, valid: false, error: 'EXPIRED' } : null);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 15000);
    return () => clearInterval(interval);
  }, [validationResult?.invite?.expires_at]);

  // 4. Handle Identity Verification Submit
  const handleVerifyIdentity = (e) => {
    if (e) e.preventDefault();
    if (!validationResult?.invite) return;

    const cleanInput = inputEmail.trim().toLowerCase();
    const authEmail = validationResult.invite.authorized_email.trim().toLowerCase();

    if (!cleanInput) {
      setValidationError('Please enter your authorized email address.');
      return;
    }

    setIsVerifying(true);
    setValidationError(null);

    // Verify input against invite's authorized email (Strict case-insensitive check)
    if (cleanInput === authEmail) {
      // SUCCESS: Google/Authorized email matches invite!
      setAccessDeniedEmail(null);
      const unlockedSession = {
        type: 'external_customer',
        token: validationResult.invite.token,
        authorized_email: validationResult.invite.authorized_email,
        store_branch: validationResult.invite.store_branch || '',
        user_email: validationResult.invite.authorized_email,
        expires_at: validationResult.invite.expires_at,
        profileName: validationResult.invite.store_branch || validationResult.invite.authorized_email,
        unlockedAt: new Date().toISOString()
      };

      try {
        localStorage.setItem('rma_portal_gate_session', JSON.stringify(unlockedSession));
        localStorage.setItem('rma_reporter_contact', validationResult.invite.authorized_email);
        localStorage.setItem('rma_portal_verified_email', validationResult.invite.authorized_email);
      } catch {}

      if (onUnlock) {
        onUnlock(unlockedSession);
      }
    } else {
      // MISMATCH: User entered a different email address (Anti-forwarding block)
      setAccessDeniedEmail(cleanInput);
    }
    setIsVerifying(false);
  };

  // 5. QA Sandbox Test Mode Bypass
  const handleTestModeBypass = () => {
    if (!validationResult?.invite) return;
    const inv = validationResult.invite;
    const bypassSession = {
      type: 'external_customer',
      token: inv.token,
      authorized_email: inv.authorized_email,
      store_branch: inv.store_branch || '',
      user_email: inv.authorized_email,
      expires_at: inv.expires_at,
      profileName: inv.store_branch || inv.authorized_email,
      isTestBypass: true,
      unlockedAt: new Date().toISOString()
    };
    try {
      localStorage.setItem('rma_portal_gate_session', JSON.stringify(bypassSession));
      localStorage.setItem('rma_reporter_contact', inv.authorized_email);
      localStorage.setItem('rma_portal_verified_email', inv.authorized_email);
    } catch {}
    if (onUnlock) onUnlock(bypassSession);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden p-6 sm:p-8 space-y-6 text-center">

        {/* 1. Loading State */}
        {isValidating ? (
          <div className="py-12 space-y-4">
            <RefreshCw className="w-10 h-10 text-blue-600 animate-spin mx-auto" />
            <div className="text-sm font-bold text-slate-700 dark:text-slate-300">
              Validating Pingcon Return Authorization...
            </div>
            <p className="text-xs text-slate-400">Verifying secure token integrity</p>
          </div>
        ) : accessDeniedEmail && validationResult?.invite ? (
          /* 2. Anti-Forwarding 403 Forbidden Screen */
          <div className="space-y-5 animate-in zoom-in-95">
            <div className="w-16 h-16 rounded-3xl bg-rose-100 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto shadow-inner">
              <ShieldAlert className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                403 Forbidden
              </span>
              <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                Access Denied
              </h2>
            </div>

            <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-2xl text-xs text-left space-y-2.5 text-slate-800 dark:text-slate-200">
              <div className="text-[11px] font-bold text-rose-800 dark:text-rose-300">
                🚨 Identity Mismatch Detected:
              </div>
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                You entered:
                <strong className="block text-slate-900 dark:text-white font-mono mt-0.5">{accessDeniedEmail}</strong>
              </p>
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                This private return portal is strictly authorized for:
                <strong className="block text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">{validationResult.invite.authorized_email}</strong>
              </p>
              <div className="text-[11px] text-slate-500 italic pt-1 border-t border-rose-200 dark:border-rose-900/40">
                Forwarding personalized return links is strictly prohibited to protect account and credit memo integrity.
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setAccessDeniedEmail(null);
                  setInputEmail('');
                }}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider rounded-2xl flex items-center justify-center gap-2 shadow-md shadow-blue-600/25 transition-all cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Try Again with Authorized Email</span>
              </button>

              <button
                type="button"
                onClick={onOpenAdminLogin}
                className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                <span>Admin & Staff Login</span>
              </button>
            </div>
          </div>
        ) : !token ? (
          /* 3. Visited Without a Token */
          <div className="space-y-5 animate-in zoom-in-95">
            <div className="w-16 h-16 rounded-3xl bg-blue-100 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto shadow-inner">
              <Lock className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                Protected Portal
              </span>
              <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                Pingcon RMA Portal
              </h2>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs text-slate-600 dark:text-slate-300 space-y-2 text-left">
              <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span>Authorization Required</span>
              </div>
              <p className="leading-relaxed text-[11px] text-slate-500 dark:text-slate-400">
                Please contact your assigned Pingcon representative or Account Executive to receive your store's personalized return authorization link.
              </p>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={onOpenAdminLogin}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider rounded-2xl flex items-center justify-center gap-2 shadow-md shadow-blue-600/25 transition-all cursor-pointer"
              >
                <LogIn className="w-4 h-4" />
                <span>Admin & Staff Login</span>
              </button>
            </div>
          </div>
        ) : !validationResult?.valid ? (
          /* 4. Token Invalid / Expired / Revoked */
          <div className="space-y-5 animate-in zoom-in-95">
            <div className="w-16 h-16 rounded-3xl bg-amber-100 dark:bg-amber-950/70 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto shadow-inner">
              <Clock className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                {validationResult?.error === 'REVOKED' ? 'Authorization Revoked' : 'Link Expired'}
              </span>
              <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                Authorization Unavailable
              </h2>
            </div>

            <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-2xl text-xs text-left space-y-2 text-slate-700 dark:text-slate-300">
              <p className="leading-relaxed text-[11px] text-slate-600 dark:text-slate-400">
                {validationResult?.error === 'REVOKED'
                  ? 'This customer return authorization was revoked by Pingcon Operations.'
                  : 'This personalized return link has exceeded its validity period and expired.'}
              </p>
              <p className="leading-relaxed text-[11px] text-slate-600 dark:text-slate-400 font-bold">
                Please contact your Pingcon representative to generate a fresh return authorization link for your store.
              </p>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={onOpenAdminLogin}
                className="w-full py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                <span>Admin & Staff Login</span>
              </button>
            </div>
          </div>
        ) : (
          /* 5. Valid Token -> Email Identity Lock Verification Screen */
          <div className="space-y-5 animate-in zoom-in-95">
            <div className="w-16 h-16 rounded-3xl bg-blue-100 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto shadow-inner">
              <ShieldCheck className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                Verified Return Authorization
              </span>
              <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                Pingcon RMA Portal
              </h2>
            </div>

            {/* Recipient Card */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs text-left space-y-2 text-slate-800 dark:text-slate-200">
              <div className="text-[10px] uppercase font-bold text-slate-400">
                Private Return Link Issued Exclusively To:
              </div>
              <div className="font-mono font-black text-blue-600 dark:text-blue-400 text-sm flex items-center gap-1.5 break-all">
                <Mail className="w-4 h-4 shrink-0 text-blue-600" />
                <span>{validationResult.invite.authorized_email}</span>
              </div>
              {validationResult.invite.store_branch && (
                <div className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center gap-1 pt-0.5 font-bold">
                  <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>{validationResult.invite.store_branch}</span>
                </div>
              )}
              {countdownStr && (
                <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1 pt-0.5">
                  <Clock className="w-3 h-3 shrink-0" />
                  <span>Valid for: {countdownStr}</span>
                </div>
              )}
            </div>

            {/* Identity Verification Form */}
            <form onSubmit={handleVerifyIdentity} className="space-y-3 text-left">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  Confirm Authorized Email Address *
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
                  <input
                    type="email"
                    required
                    value={inputEmail}
                    onChange={(e) => {
                      setInputEmail(e.target.value);
                      setValidationError(null);
                    }}
                    placeholder="Enter authorized customer email..."
                    className="w-full pl-9 pr-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 shadow-2xs"
                  />
                </div>
                {validationError && (
                  <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400 mt-1">
                    {validationError}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={isVerifying || !inputEmail.trim()}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-black text-xs uppercase tracking-wider rounded-2xl flex items-center justify-center gap-2 shadow-md shadow-blue-600/25 transition-all active:scale-[0.99] cursor-pointer"
              >
                {isVerifying ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Verifying Identity...</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    <span>Unlock & Access Return Portal</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800">
              {/* QA Sandbox Test Mode Quick Bypass */}
              {isTestMode && (
                <button
                  type="button"
                  onClick={handleTestModeBypass}
                  className="w-full py-2 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <UserCheck className="w-3 h-3 text-amber-600" />
                  <span>🧪 Test Mode Sandbox Bypass (QA Only)</span>
                </button>
              )}

              <button
                type="button"
                onClick={onOpenAdminLogin}
                className="w-full py-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-bold text-xs transition-colors cursor-pointer"
              >
                <span>Admin & Staff Login</span>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
