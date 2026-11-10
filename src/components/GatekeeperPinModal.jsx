import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  Lock, 
  RefreshCw, 
  AlertTriangle,
  Building2,
  Clock,
  Mail,
  Truck,
  Store
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { inviteService, formatRemainingCountdown, normalizeEntityName } from '../services/inviteService';

// Capture OAuth callback hash tokens synchronously at bundle evaluation time before any URL cleanup runs
let initialCapturedOAuthHash = null;
let initialPageLoadHadAuthCallback = false;

if (typeof window !== 'undefined') {
  try {
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    if (
      hash.includes('access_token=') ||
      hash.includes('id_token=') ||
      /[?&]code=/.test(search) ||
      /[?&]token_hash=/.test(search)
    ) {
      initialPageLoadHadAuthCallback = true;
    }
    if (hash.includes('access_token=')) {
      const params = new URLSearchParams(hash.replace(/^#/, ''));
      const access_token = params.get('access_token');
      const refresh_token = params.get('refresh_token');
      if (access_token) {
        initialCapturedOAuthHash = { access_token, refresh_token };
      }
    }
  } catch {}
}

function decodeJwtUserFallback(accessToken) {
  if (!accessToken) return null;
  try {
    const parts = accessToken.split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const payload = JSON.parse(jsonPayload);
    if (payload && payload.email) {
      return {
        id: payload.sub,
        email: payload.email,
        user_metadata: payload.user_metadata || {}
      };
    }
  } catch {}
  return null;
}

export default function GatekeeperPinModal({
  isOpen,
  currentSlug,
  onUnlock,
  onOpenAdminLogin
}) {
  const [token, setToken] = useState(null);
  const [isValidatingToken, setIsValidatingToken] = useState(true);
  const [validationResult, setValidationResult] = useState(null); // { valid, invite, error }
  const [isCheckingAuth, setIsCheckingAuth] = useState(() => initialPageLoadHadAuthCallback);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [identityMismatch, setIdentityMismatch] = useState(null); // { signedInEmail, authorizedEmail }
  const [oauthError, setOauthError] = useState(null);
  const [countdownStr, setCountdownStr] = useState('');
  const [isSendingMagicLink, setIsSendingMagicLink] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  const hasValidatedRef = useRef(false);
  const validatedTokenRef = useRef(null);
  const onUnlockRef = useRef(onUnlock);
  const isRedirectingToGoogleRef = useRef(false);

  useEffect(() => {
    onUnlockRef.current = onUnlock;
  }, [onUnlock]);

  // 1. Resolve token from URL query params, hash fragments, or pending OAuth storage
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const urlParams = new URLSearchParams(window.location.search);
    let t = urlParams.get('token');

    if (!t && window.location.hash.includes('token=')) {
      const match = window.location.hash.match(/token=([^&]+)/);
      if (match && match[1]) t = decodeURIComponent(match[1]);
    }

    if (!t) {
      try {
        const isOAuthReturn =
          initialPageLoadHadAuthCallback ||
          localStorage.getItem('rma_oauth_in_progress') === 'true' ||
          sessionStorage.getItem('rma_oauth_in_progress') === 'true';
        if (isOAuthReturn) {
          t =
            localStorage.getItem('rma_pending_oauth_token') ||
            sessionStorage.getItem('rma_pending_oauth_token') ||
            sessionStorage.getItem('rma_active_invite_token') ||
            localStorage.getItem('rma_active_invite_token');
        }
      } catch {}
    }

    if (t) {
      try {
        sessionStorage.setItem('rma_active_invite_token', t);
        localStorage.setItem('rma_active_invite_token', t);
      } catch {}
    }

    setToken(t || null);
  }, [isOpen]);

  // 2. Cryptographic Google OAuth Identity Verification
  const verifyIdentityWithSupabase = useCallback(async (invite, sessionUser = null) => {
    if (!invite?.authorized_email) return;
    // Never unlock while initiating outbound redirect to accounts.google.com
    if (isRedirectingToGoogleRef.current) return;

    setIsCheckingAuth(true);

    try {
      let user = sessionUser;

      // 1. If we captured an OAuth access_token in the URL hash on return from Google, verify it directly
      if (!user && initialCapturedOAuthHash?.access_token) {
        try {
          if (initialCapturedOAuthHash.refresh_token) {
            await supabase.auth.setSession({
              access_token: initialCapturedOAuthHash.access_token,
              refresh_token: initialCapturedOAuthHash.refresh_token
            }).catch(() => {});
          }
          const { data: { user: tokenUser } } = await supabase.auth.getUser(initialCapturedOAuthHash.access_token);
          if (tokenUser?.email) {
            user = tokenUser;
          }
        } catch {}

        if (!user) {
          user = decodeJwtUserFallback(initialCapturedOAuthHash.access_token);
        }
      }

      // 2. Otherwise check Supabase active session / getUser (with brief retry if hash exchange is in flight)
      if (!user) {
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user?.email) {
              user = session.user;
              break;
            }
            const { data: { user: currentUser } } = await supabase.auth.getUser();
            if (currentUser?.email) {
              user = currentUser;
              break;
            }
          } catch {}
          if (attempt < 3) {
            await new Promise(r => setTimeout(r, 250));
          }
        }
      }

      if (user && user.email) {
        // Consume the one-time OAuth return flags now that we have resolved the user
        initialPageLoadHadAuthCallback = false;
        initialCapturedOAuthHash = null;
        try {
          sessionStorage.removeItem('rma_oauth_in_progress');
          localStorage.removeItem('rma_oauth_in_progress');
          sessionStorage.removeItem('rma_pending_oauth_token');
          localStorage.removeItem('rma_pending_oauth_token');

          // Clean up OAuth tokens from URL hash and ensure /intake?token=... is preserved
          if (typeof window !== 'undefined') {
            const cleanUrl = new URL(window.location.href);
            cleanUrl.hash = '';
            if (cleanUrl.pathname.toLowerCase().startsWith('/admin')) {
              cleanUrl.pathname = '/intake';
            }
            if (!cleanUrl.searchParams.get('token') && invite.token) {
              cleanUrl.searchParams.set('token', invite.token);
            }
            window.history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search);
          }
        } catch {}

        const userEmail = user.email.toLowerCase().trim();
        const authorizedEmail = invite.authorized_email.toLowerCase().trim();

        if (userEmail === authorizedEmail) {
          // SUCCESS: Authenticated Google identity matches the authorized invite email!
          setIdentityMismatch(null);
          setOauthError(null);

          const resolvedEntity = normalizeEntityName(invite.entity_name || invite.store_branch);
          const resolvedStream = invite.stream_type || 'customer_inbound';

          const unlockedSession = {
            type: 'external_customer',
            token: invite.token,
            stream_type: resolvedStream,
            authorized_email: authorizedEmail,
            entity_name: resolvedEntity,
            store_branch: resolvedEntity,
            user_email: userEmail,
            user_name: user.user_metadata?.full_name || user.user_metadata?.name || '',
            expires_at: invite.expires_at,
            profileName: resolvedEntity || authorizedEmail,
            unlockedAt: new Date().toISOString()
          };

          try {
            localStorage.setItem('rma_portal_gate_session', JSON.stringify(unlockedSession));
            localStorage.setItem('rma_reporter_contact', authorizedEmail);
            localStorage.setItem('rma_portal_verified_email', userEmail);
          } catch {}

          if (onUnlockRef.current) {
            onUnlockRef.current(unlockedSession);
          }
          setIsCheckingAuth(false);
          return;
        } else {
          // CRITICAL SECURITY MISMATCH: Signed in with unauthorized Google account
          // Immediately sign out locally to prevent unauthorized session retention
          await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
          try {
            localStorage.removeItem('rma_portal_gate_session');
          } catch {}

          setIdentityMismatch({
            signedInEmail: user.email,
            authorizedEmail: invite.authorized_email
          });
          setIsCheckingAuth(false);
          setIsValidatingToken(false);
          return;
        }
      }
    } catch (err) {
      console.warn('Error during Google identity verification:', err);
    } finally {
      setIsCheckingAuth(false);
    }
  }, []);

  // Reset ref guard when isOpen changes to always revalidate cleanly
  useEffect(() => {
    if (isOpen) {
      hasValidatedRef.current = false;
      validatedTokenRef.current = null;
      isRedirectingToGoogleRef.current = false;
    }
  }, [isOpen]);

  // 3. Validate token from URL / database
  useEffect(() => {
    let isMounted = true;
    if (!token) {
      setIsValidatingToken(false);
      setValidationResult(null);
      return;
    }

    // Ref guard: only validate once per unique token to eliminate loading flicker loop
    if (hasValidatedRef.current && validatedTokenRef.current === token) {
      setIsValidatingToken(false);
      return;
    }

    const checkToken = async () => {
      try {
        let res = await inviteService.validateInviteToken(token);
        // Fix false "Link Expired / Authorization Unavailable":
        // If token was just generated or had a transient network error, re-fetch after 700ms
        if (!res?.valid && (res?.error === 'NOT_FOUND' || res?.error === 'NETWORK_ERROR')) {
          await new Promise(r => setTimeout(r, 700));
          if (!isMounted) return;
          res = await inviteService.validateInviteToken(token);
        }

        if (!isMounted) return;
        hasValidatedRef.current = true;
        validatedTokenRef.current = token;
        setValidationResult(res);
        setIsValidatingToken(false);

        if (res?.valid && res?.invite) {
          try {
            sessionStorage.setItem('rma_active_invite_token', token);
            localStorage.setItem('rma_active_invite_token', token);
          } catch {}

          // Strictly verify identity automatically ONLY when returning from an OAuth redirect / Magic Link callback
          const isReturningFromOAuthCallback =
            !isRedirectingToGoogleRef.current &&
            (initialPageLoadHadAuthCallback ||
              Boolean(initialCapturedOAuthHash?.access_token) ||
              (typeof window !== 'undefined' &&
                (window.location.hash.includes('access_token=') ||
                  window.location.hash.includes('id_token=') ||
                  new URLSearchParams(window.location.search).has('code'))));

          if (isReturningFromOAuthCallback) {
            await verifyIdentityWithSupabase(res.invite);
          } else {
            // Fresh visit to the invite link (not returning from Google OAuth yet):
            // Clear any stale OAuth-in-progress flags so the user must click "Continue with Google"
            try {
              sessionStorage.removeItem('rma_oauth_in_progress');
              localStorage.removeItem('rma_oauth_in_progress');
            } catch {}
            setIsCheckingAuth(false);
          }
        } else {
          setIsCheckingAuth(false);
        }
      } catch {
        if (isMounted) {
          setIsValidatingToken(false);
          setIsCheckingAuth(false);
        }
      }
    };

    setIsValidatingToken(true);
    checkToken();

    // Active polling every 4 seconds to catch real-time admin revocation while gatekeeper is open
    const pollInterval = setInterval(async () => {
      if (!isMounted || isRedirectingToGoogleRef.current) return;
      try {
        const fresh = await inviteService.validateInviteToken(token);
        // Never overwrite valid state on transient network hiccups
        if (fresh?.error === 'NETWORK_ERROR' || (!fresh?.valid && fresh?.transient)) {
          return;
        }
        if (isMounted && (!fresh.valid || fresh.invite?.status !== validationResult?.invite?.status)) {
          setValidationResult(fresh);
        }
      } catch {}
    }, 4000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [token, verifyIdentityWithSupabase, isOpen]);

  // 4. Subscribe to Supabase Auth state changes (triggers on OAuth redirect return)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (identityMismatch || isRedirectingToGoogleRef.current) return;

      const hasCallbackSignal =
        initialPageLoadHadAuthCallback ||
        Boolean(initialCapturedOAuthHash?.access_token) ||
        (typeof window !== 'undefined' &&
          (window.location.hash.includes('access_token=') ||
            window.location.hash.includes('id_token=') ||
            window.location.search.includes('code=')));

      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') && hasCallbackSignal && session?.user) {
        if (validationResult?.valid && validationResult?.invite) {
          await verifyIdentityWithSupabase(validationResult.invite, session.user);
        }
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [validationResult, verifyIdentityWithSupabase, identityMismatch]);

  // 5. Live ticking countdown timer for valid invite (updates every 1s)
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
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [validationResult?.invite?.expires_at, validationResult?.invite?.status]);

  // 6. Handle "Continue with Google" OAuth trigger
  const handleContinueWithGoogle = async () => {
    if (!validationResult?.invite) return;
    isRedirectingToGoogleRef.current = true;
    setIsSigningIn(true);
    setOauthError(null);

    try {
      // Clear any previous local Supabase session before starting fresh Google OAuth
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      try {
        localStorage.removeItem('rma_portal_gate_session');
      } catch {}

      const activeToken = token || validationResult.invite.token;
      if (activeToken) {
        try {
          sessionStorage.setItem('rma_active_invite_token', activeToken);
          sessionStorage.setItem('rma_pending_oauth_token', activeToken);
          sessionStorage.setItem('rma_oauth_in_progress', 'true');
          localStorage.setItem('rma_active_invite_token', activeToken);
          localStorage.setItem('rma_pending_oauth_token', activeToken);
          localStorage.setItem('rma_oauth_in_progress', 'true');
        } catch {}
      }

      const redirectUrl = activeToken
        ? `${window.location.origin}/intake?token=${encodeURIComponent(activeToken)}`
        : window.location.href;
      
      // Use skipBrowserRedirect: true first to safely get the authorization URL
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
          queryParams: {
            access_type: 'offline',
            prompt: 'select_account',
            login_hint: validationResult.invite.authorized_email
          }
        }
      });

      if (error) {
        console.error('Google OAuth sign-in error:', error);
        isRedirectingToGoogleRef.current = false;
        setOauthError('Google Sign-In is temporarily unavailable. Please click below to receive a secure one-time login link sent directly to your authorized email address.');
        setIsSigningIn(false);
        return;
      }

      if (data?.url) {
        // Safe to navigate to Google OAuth!
        window.location.assign(data.url);
      } else {
        isRedirectingToGoogleRef.current = false;
        setOauthError('Google Sign-In is temporarily unavailable. Please click below to receive a secure one-time login link sent directly to your authorized email address.');
        setIsSigningIn(false);
      }
    } catch (err) {
      console.error('Google OAuth invocation exception:', err);
      isRedirectingToGoogleRef.current = false;
      setOauthError('Google Sign-In is temporarily unavailable. Please click below to receive a secure one-time login link sent directly to your authorized email address.');
      setIsSigningIn(false);
    }
  };

  // 7. Send Magic Link Email (Passwordless OTP fallback strictly delivered to the authorized email)
  const handleSendMagicLink = async () => {
    if (!validationResult?.invite?.authorized_email) return;
    setIsSendingMagicLink(true);
    setOauthError(null);
    try {
      const activeToken = token || validationResult.invite.token;
      try {
        if (activeToken) {
          sessionStorage.setItem('rma_active_invite_token', activeToken);
          sessionStorage.setItem('rma_pending_oauth_token', activeToken);
          localStorage.setItem('rma_active_invite_token', activeToken);
          localStorage.setItem('rma_pending_oauth_token', activeToken);
        }
        sessionStorage.setItem('rma_oauth_in_progress', 'true');
        localStorage.setItem('rma_oauth_in_progress', 'true');
      } catch {}
      const redirectUrl = activeToken
        ? `${window.location.origin}/intake?token=${encodeURIComponent(activeToken)}`
        : window.location.href;
      const targetEmail = validationResult.invite.authorized_email.toLowerCase().trim();
      const { error } = await supabase.auth.signInWithOtp({
        email: targetEmail,
        options: {
          emailRedirectTo: redirectUrl
        }
      });
      if (error) {
        console.warn('Magic link error:', error);
        setOauthError('Google Sign-In is temporarily unavailable. Please click below to receive a secure one-time login link sent directly to your authorized email address.');
      } else {
        setMagicLinkSent(true);
      }
    } catch (e) {
      console.warn('Magic link exception:', e);
      setOauthError('Google Sign-In is temporarily unavailable. Please click below to receive a secure one-time login link sent directly to your authorized email address.');
    } finally {
      setIsSendingMagicLink(false);
    }
  };

  if (!isOpen) return null;

  const isSupplier = validationResult?.invite?.stream_type === 'supplier_outbound';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden p-6 sm:p-8 space-y-6 text-center">

        {/* 1. Loading State */}
        {isValidatingToken || isCheckingAuth ? (
          <div className="py-12 space-y-4">
            <RefreshCw className="w-10 h-10 text-blue-600 animate-spin mx-auto" />
            <div className="text-sm font-bold text-slate-700 dark:text-slate-300">
              {isCheckingAuth ? 'Verifying Google Identity...' : 'Validating Pingcon Return Authorization...'}
            </div>
            <p className="text-xs text-slate-400">
              {isCheckingAuth ? 'Cryptographically matching authenticated Google account' : 'Verifying secure token integrity'}
            </p>
          </div>
        ) : identityMismatch ? (
          /* 2. 403 Forbidden Screen — Identity Mismatch (Strict Google OAuth Block) */
          <div className="space-y-5 animate-in zoom-in-95">
            <div className="w-16 h-16 rounded-3xl bg-rose-100 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto shadow-inner">
              <ShieldAlert className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                403 Forbidden — Identity Mismatch
              </span>
              <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                Access Denied — Identity Mismatch
              </h2>
            </div>

            <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-2xl text-xs text-left space-y-2.5 text-slate-800 dark:text-slate-200">
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                You are currently signed in as:
                <strong className="block text-slate-900 dark:text-white font-mono mt-0.5 text-sm">{identityMismatch.signedInEmail}</strong>
              </p>
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                This private return link was issued strictly to:
                <strong className="block text-emerald-600 dark:text-emerald-400 font-mono mt-0.5 text-sm">{identityMismatch.authorizedEmail}</strong>
              </p>
              <div className="text-[11px] text-rose-700 dark:text-rose-300 font-bold pt-2 border-t border-rose-200 dark:border-rose-900/40">
                Forwarding return links is prohibited under Pingcon Wholesale Governance.
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  setIdentityMismatch(null);
                  handleContinueWithGoogle();
                }}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider rounded-2xl flex items-center justify-center gap-2 shadow-md shadow-blue-600/25 transition-all cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Switch Google Account</span>
              </button>
            </div>
          </div>
        ) : !token ? (
          /* 3. Visited Without a Token (Public Root / Lock Screen - Zero Admin Buttons) */
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
          </div>
        ) : !validationResult?.valid ? (
          /* 4. Token Invalid / Expired / Revoked / Deleted (Zero Admin Buttons) */
          validationResult?.error === 'REVOKED' ? (
            <div className="space-y-5 animate-in zoom-in-95">
              <div className="w-16 h-16 rounded-3xl bg-rose-100 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto shadow-inner">
                <ShieldAlert className="w-8 h-8" />
              </div>

              <div className="space-y-1">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                  403 Forbidden — Authorization Revoked
                </span>
                <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                  Authorization Revoked
                </h2>
              </div>

              <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-2xl text-xs text-left space-y-2 text-slate-800 dark:text-slate-200">
                <p className="leading-relaxed text-[11px] text-slate-600 dark:text-slate-400">
                  This return authorization link was revoked by Pingcon Operations. Submissions are no longer accepted under this link.
                </p>
                <p className="leading-relaxed text-[11px] text-slate-600 dark:text-slate-400 font-bold">
                  Please contact your assigned Pingcon representative or Account Executive if you require a new return authorization.
                </p>
              </div>
            </div>
          ) : validationResult?.error === 'NOT_FOUND' ? (
            <div className="space-y-5 animate-in zoom-in-95">
              <div className="w-16 h-16 rounded-3xl bg-rose-100 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto shadow-inner">
                <ShieldAlert className="w-8 h-8" />
              </div>

              <div className="space-y-1">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                  Authorization Link Deleted or Invalid
                </span>
                <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                  Authorization Unavailable
                </h2>
              </div>

              <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-2xl text-xs text-left space-y-2 text-slate-800 dark:text-slate-200">
                <p className="leading-relaxed text-[11px] text-slate-600 dark:text-slate-400">
                  This return authorization link has been deleted or does not exist in the Pingcon registry.
                </p>
                <p className="leading-relaxed text-[11px] text-slate-600 dark:text-slate-400 font-bold">
                  Please check the link provided by your Pingcon representative or request a fresh return invitation.
                </p>
              </div>
            </div>
          ) : validationResult?.error === 'NETWORK_ERROR' ? (
            <div className="space-y-5 animate-in zoom-in-95">
              <div className="w-16 h-16 rounded-3xl bg-blue-100 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto shadow-inner">
                <RefreshCw className="w-8 h-8" />
              </div>

              <div className="space-y-1">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
                  Connection Interrupted
                </span>
                <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                  Reconnecting to Server
                </h2>
              </div>

              <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs text-left space-y-2 text-slate-700 dark:text-slate-300">
                <p className="leading-relaxed text-[11px] text-slate-600 dark:text-slate-400">
                  A temporary network interruption occurred while verifying your return authorization link.
                </p>
              </div>

              <button
                type="button"
                onClick={async () => {
                  setIsValidatingToken(true);
                  const res = await inviteService.validateInviteToken(token);
                  setValidationResult(res);
                  setIsValidatingToken(false);
                }}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider rounded-2xl flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Retry Verification</span>
              </button>
            </div>
          ) : (
            <div className="space-y-5 animate-in zoom-in-95">
              <div className="w-16 h-16 rounded-3xl bg-amber-100 dark:bg-amber-950/70 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto shadow-inner">
                <Clock className="w-8 h-8" />
              </div>

              <div className="space-y-1">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                  Link Expired
                </span>
                <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                  Authorization Expired
                </h2>
              </div>

              <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-2xl text-xs text-left space-y-2 text-slate-700 dark:text-slate-300">
                <p className="leading-relaxed text-[11px] text-slate-600 dark:text-slate-400">
                  This personalized return link has exceeded its validity period and expired.
                </p>
                <p className="leading-relaxed text-[11px] text-slate-600 dark:text-slate-400 font-bold">
                  Please contact your Pingcon representative to generate a fresh return authorization link for your account.
                </p>
              </div>
            </div>
          )
        ) : (
          /* 5. Valid Token -> 1-Click Google Identity Lock OAuth Screen (Zero Admin Buttons) */
          <div className="space-y-5 animate-in zoom-in-95">
            <div className={`w-16 h-16 rounded-3xl flex items-center justify-center mx-auto shadow-inner ${
              isSupplier 
                ? 'bg-purple-100 dark:bg-purple-950/70 text-purple-600 dark:text-purple-400' 
                : 'bg-blue-100 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400'
            }`}>
              {isSupplier ? <Truck className="w-8 h-8" /> : <ShieldCheck className="w-8 h-8" />}
            </div>

            <div className="space-y-1">
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase border inline-flex items-center gap-1 ${
                isSupplier
                  ? 'bg-purple-100 dark:bg-purple-950/70 text-purple-800 dark:text-purple-300 border-purple-300 dark:border-purple-700'
                  : 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
              }`}>
                {isSupplier ? (
                  <>
                    <Truck className="w-3 h-3" />
                    <span>Supplier RTV Authorization</span>
                  </>
                ) : (
                  <>
                    <Store className="w-3 h-3" />
                    <span>Customer Return Authorization</span>
                  </>
                )}
              </span>
              <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                {isSupplier ? 'Pingcon Return to Vendor Portal' : 'Pingcon RMA Portal'}
              </h2>
            </div>

            {/* Recipient Card */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs text-left space-y-2 text-slate-800 dark:text-slate-200">
              <div className="text-[10px] uppercase font-bold text-slate-400">
                Private Return Link Issued Exclusively To:
              </div>
              <div className={`font-mono font-black text-sm flex items-center gap-1.5 break-all ${
                isSupplier ? 'text-purple-600 dark:text-purple-400' : 'text-blue-600 dark:text-blue-400'
              }`}>
                <Mail className={`w-4 h-4 shrink-0 ${isSupplier ? 'text-purple-600' : 'text-blue-600'}`} />
                <span>{validationResult.invite.authorized_email}</span>
              </div>
              
              {/* Entity Name (Store Branch or Supplier) */}
              {(validationResult.invite.entity_name || validationResult.invite.store_branch) && (
                <div className="text-[11px] text-slate-700 dark:text-slate-300 flex items-center gap-1 pt-0.5 font-bold">
                  {isSupplier ? (
                    <Truck className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                  ) : (
                    <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  )}
                  <span>
                    {isSupplier ? 'Master Supplier / Vendor: ' : 'Store / Branch: '}
                    <strong>{validationResult.invite.entity_name || validationResult.invite.store_branch}</strong>
                  </span>
                </div>
              )}

              {countdownStr && (
                <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1 pt-0.5">
                  <Clock className="w-3 h-3 shrink-0" />
                  <span>Valid for: {countdownStr}</span>
                </div>
              )}
            </div>

            {/* Security Explanation */}
            <div className="p-3 bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 rounded-2xl text-left text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
              <div className="font-bold text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span>Google Identity Lock</span>
              </div>
              <p className="leading-relaxed">
                To prevent unauthorized submissions, access is cryptographically locked to the authorized Google account above.
              </p>
            </div>

            {/* Google OAuth Error Alert */}
            {oauthError && (
              <div className="p-4 bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-900 rounded-2xl text-xs text-amber-900 dark:text-amber-200 text-left space-y-2.5 animate-in fade-in">
                <div className="font-bold flex items-center gap-2 text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Google Sign-In Notice</span>
                </div>
                <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300 font-medium">
                  Google Sign-In is temporarily unavailable. Please click below to receive a secure one-time login link sent directly to your authorized email address.
                </p>

                {/* Secure Magic Link Fallback strictly dispatched to authorized inbox */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={handleSendMagicLink}
                    disabled={isSendingMagicLink || magicLinkSent}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60 shadow-sm"
                  >
                    <Mail className="w-4 h-4" />
                    <span>{magicLinkSent ? '✓ One-Time Link Dispatched to Your Inbox' : isSendingMagicLink ? 'Dispatching Access Link...' : `Email One-Time Access Link to ${validationResult.invite.authorized_email}`}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Magic Link Sent Confirmation Banner */}
            {magicLinkSent && (
              <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded-2xl text-xs text-left space-y-1.5 animate-in fade-in">
                <div className="font-bold flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Secure Access Link Dispatched</span>
                </div>
                <p className="text-[11px] leading-relaxed text-emerald-800 dark:text-emerald-300">
                  A one-time secure login link has been dispatched to <strong className="font-mono">{validationResult.invite.authorized_email}</strong>. Please check your inbox and click the link to automatically access the return portal.
                </p>
              </div>
            )}

            {/* Prominent Google OAuth Button */}
            <div className="pt-1 space-y-2">
              <button
                type="button"
                onClick={handleContinueWithGoogle}
                disabled={isSigningIn}
                className="w-full py-3.5 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700/80 border-2 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white font-black text-xs uppercase tracking-wider rounded-2xl flex items-center justify-center gap-3 shadow-md hover:shadow-lg transition-all active:scale-[0.99] cursor-pointer"
              >
                {isSigningIn ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                    <span>Connecting to Google...</span>
                  </>
                ) : (
                  <>
                    {/* Official Google 'G' multicolored SVG */}
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                    </svg>
                    <span>Continue with Google</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleSendMagicLink}
                disabled={isSendingMagicLink || magicLinkSent}
                className="w-full py-2.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900/60 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60 shadow-2xs"
              >
                <Mail className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>{magicLinkSent ? '✓ One-Time Link Dispatched to Your Inbox' : isSendingMagicLink ? 'Dispatching Access Link...' : 'Email One-Time Access Link to ' + validationResult.invite.authorized_email}</span>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}