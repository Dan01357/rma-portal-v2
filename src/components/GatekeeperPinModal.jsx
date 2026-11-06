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
  ExternalLink,
  Mail,
  UserCheck
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { inviteService } from '../services/inviteService';

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
  const [googleUser, setGoogleUser] = useState(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [accessDeniedEmail, setAccessDeniedEmail] = useState(null);
  const [countdownStr, setCountdownStr] = useState('');

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
      if (isMounted) {
        setValidationResult(res);
        setIsValidating(false);
      }
    });

    return () => { isMounted = false; };
  }, [token]);

  // 3. Countdown timer for valid invite
  useEffect(() => {
    if (!validationResult?.invite?.expires_at) return;

    const updateTimer = () => {
      const diff = new Date(validationResult.invite.expires_at).getTime() - Date.now();
      if (diff <= 0) {
        setCountdownStr('Expired');
        setValidationResult(prev => prev ? { ...prev, valid: false, error: 'EXPIRED' } : null);
      } else {
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        setCountdownStr(`${hours}h ${mins}m remaining`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 30000);
    return () => clearInterval(interval);
  }, [validationResult?.invite?.expires_at]);

  // 4. Check for signed-in Google Auth session and verify against authorized email
  useEffect(() => {
    let isMounted = true;

    const verifySession = async (session) => {
      if (!session?.user) {
        setGoogleUser(null);
        setAccessDeniedEmail(null);
        return;
      }

      const signedInEmail = session.user.email?.toLowerCase().trim();
      setGoogleUser(session.user);

      if (validationResult?.valid && validationResult?.invite) {
        const authEmail = validationResult.invite.authorized_email.toLowerCase().trim();

        if (signedInEmail === authEmail) {
          // Success: Google email matches authorized invite email!
          setAccessDeniedEmail(null);
          const unlockedSession = {
            type: 'external_customer',
            token: validationResult.invite.token,
            authorized_email: validationResult.invite.authorized_email,
            store_branch: validationResult.invite.store_branch || '',
            user_email: signedInEmail,
            expires_at: validationResult.invite.expires_at,
            profileName: validationResult.invite.store_branch || validationResult.invite.authorized_email,
            unlockedAt: new Date().toISOString()
          };

          try {
            localStorage.setItem('rma_portal_gate_session', JSON.stringify(unlockedSession));
          } catch {}

          if (onUnlock) {
            onUnlock(unlockedSession);
          }
        } else {
          // Failure: Logged into different Google Account! (Anti-forwarding block)
          setAccessDeniedEmail(signedInEmail);
        }
      }
    };

    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (isMounted) verifySession(session);
    });

    // Listen to OAuth redirect completion
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) verifySession(session);
    });

    return () => {
      isMounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, [validationResult, onUnlock]);

  // 5. Google Sign In Action
  const handleContinueWithGoogle = async () => {
    setIsSigningIn(true);
    try {
      const redirectUrl = typeof window !== 'undefined' ? window.location.href : undefined;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            access_type: 'offline',
            prompt: 'select_account'
          }
        }
      });
      if (error) throw error;
    } catch (err) {
      console.error('Google Sign In Error:', err);
      alert(`Google sign in failed: ${err.message}`);
      setIsSigningIn(false);
    }
  };

  // 6. Sign Out to switch account
  const handleSignOutGoogle = async () => {
    try {
      await supabase.auth.signOut();
      setGoogleUser(null);
      setAccessDeniedEmail(null);
    } catch (err) {
      console.warn('Sign out error:', err);
    }
  };

  // 7. QA Sandbox Test Mode Bypass
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
                🚨 Security Mismatch Detected:
              </div>
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                You are currently signed in as:
                <strong className="block text-slate-900 dark:text-white font-mono mt-0.5">{accessDeniedEmail}</strong>
              </p>
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                This private return portal is strictly authorized for:
                <strong className="block text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">{validationResult.invite.authorized_email}</strong>
              </p>
              <div className="text-[11px] text-slate-500 italic pt-1 border-t border-rose-200 dark:border-rose-900/40">
                Forwarding personalized return links is strictly prohibited to protect account security.
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={handleSignOutGoogle}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider rounded-2xl flex items-center justify-center gap-2 shadow-md shadow-blue-600/25 transition-all cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Switch to Authorized Account</span>
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
                Please contact your assigned Pingcon representative or Account Executive to receive your store's personalized return link.
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
          /* 5. Valid Token -> Google Identity Lock Screen */
          <div className="space-y-5 animate-in zoom-in-95">
            <div className="w-16 h-16 rounded-3xl bg-blue-100 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto shadow-inner">
              <ShieldCheck className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                Verified Authorization
              </span>
              <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                Pingcon RMA Portal
              </h2>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs text-left space-y-2 text-slate-800 dark:text-slate-200">
              <div className="text-[10px] uppercase font-bold text-slate-400">
                Private Return Authorization Issued Exclusively To:
              </div>
              <div className="font-mono font-black text-blue-600 dark:text-blue-400 text-sm flex items-center gap-1.5 break-all">
                <Mail className="w-4 h-4 shrink-0 text-blue-600" />
                <span>{validationResult.invite.authorized_email}</span>
              </div>
              {validationResult.invite.store_branch && (
                <div className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center gap-1 pt-1 font-bold">
                  <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>{validationResult.invite.store_branch}</span>
                </div>
              )}
              {countdownStr && (
                <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1 pt-1">
                  <Clock className="w-3 h-3 shrink-0" />
                  <span>Valid for: {countdownStr}</span>
                </div>
              )}
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              To verify your identity and prevent fraudulent claims, click below to confirm with your authorized Google Account.
            </p>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={handleContinueWithGoogle}
                disabled={isSigningIn}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider rounded-2xl flex items-center justify-center gap-2 shadow-md shadow-blue-600/25 transition-all active:scale-[0.99] cursor-pointer"
              >
                {isSigningIn ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Connecting to Google...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                      <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                    </svg>
                    <span>Continue with Google</span>
                  </>
                )}
              </button>

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
