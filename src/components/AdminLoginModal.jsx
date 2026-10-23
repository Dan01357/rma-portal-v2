import React, { useState } from 'react';
import { Lock, Mail, ShieldCheck, KeyRound, AlertCircle, RefreshCw, CheckCircle, ArrowRight, X } from 'lucide-react';
import { authService } from '../services/authService';

export default function AdminLoginModal({ isOpen, onClose, onLoginSuccess }) {
  const [step, setStep] = useState(() => {
    return sessionStorage.getItem('rma_login_pending_email') ? 'otp' : 'email';
  });
  const [emailInput, setEmailInput] = useState(() => {
    return sessionStorage.getItem('rma_login_pending_email') || '';
  });
  const [otpInput, setOtpInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [countdown, setCountdown] = useState(0);

  // Countdown timer for resend OTP cooldown (prevents 429 errors)
  React.useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // Sync state when modal is opened fresh
  React.useEffect(() => {
    if (isOpen) {
      const savedEmail = sessionStorage.getItem('rma_login_pending_email');
      if (savedEmail) {
        setStep('otp');
        setEmailInput(savedEmail);
      } else {
        setStep('email');
      }
      setIsLoading(false);
      setErrorMessage(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Step 1: Request OTP
  const handleRequestOtp = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const email = emailInput.trim().toLowerCase();
    if (!email) return;

    if (countdown > 0) {
      return; // Under cooldown
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await authService.requestOtp(email);
      sessionStorage.setItem('rma_login_pending_email', email);
      setStep('otp');
      setCountdown(60); // 60 seconds cooldown to protect from rate limits
      if (res.rateLimited) {
        setErrorMessage(res.message);
      }
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: Verify OTP
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    const code = otpInput.trim();
    if (!code) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await authService.verifyOtp(emailInput, code);
      if (res.success && onLoginSuccess) {
        sessionStorage.removeItem('rma_login_pending_email');
        onLoginSuccess(res.user);
      }
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/70 backdrop-blur-md animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border-t sm:border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 sm:p-7 space-y-5 pb-safe max-h-[92dvh] overflow-y-auto">
        
        {/* Mobile bottom-sheet drag handle */}
        <div className="sm:hidden -mt-2 mb-2 flex justify-center shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700"></div>
        </div>
        
        {/* Top Icon & Title */}
        <div className="text-center space-y-1.5">
          <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
            Company Staff Verification
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            One-Time Password (OTP) security gate for RMA admin access.
          </p>
        </div>

        {/* Error Notice */}
        {errorMessage && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 rounded-2xl text-xs font-semibold flex items-start gap-2 animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* STEP 1: Enter Company Email */}
        {step === 'email' && (
          <form onSubmit={handleRequestOtp} className="space-y-4">
            <div>
              <label className="block text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                Official Company Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                <input
                  type="email"
                  required
                  autoFocus
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 focus:bg-white dark:focus:bg-slate-800"
                />
              </div>
              <span className="block text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                Must be an active employee in company directory. Personal emails (@gmail) are not accepted.
              </span>
            </div>

            <button
              type="submit"
              disabled={isLoading || !emailInput.trim()}
              className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-extrabold text-sm rounded-2xl flex items-center justify-center gap-2 shadow-md shadow-blue-600/20 transition-all"
            >
              {isLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <KeyRound className="w-4 h-4" />
              )}
              <span>Send OTP Verification Code</span>
            </button>

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2 text-xs font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 text-center"
              >
                Cancel & Return to Public Portal
              </button>
            )}
          </form>
        )}

        {/* STEP 2: Enter 6-digit OTP */}
        {step === 'otp' && (
          <form onSubmit={handleVerifyOtp} className="space-y-4 animate-in fade-in">
            <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl text-xs text-emerald-900 dark:text-emerald-200 space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Verification code dispatched!</span>
              </div>
              <p className="text-[11px] text-emerald-800 dark:text-emerald-300">
                Please check your inbox at <strong>{emailInput}</strong> for your OTP access code.
              </p>
            </div>

            <div>
              <label className="block text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 text-center">
                Enter Verification Code or Token
              </label>
              <input
                type="text"
                required
                autoFocus
                maxLength={64}
                value={otpInput}
                onChange={(e) => setOtpInput(e.target.value.trim())}
                placeholder="e.g. 123456"
                className={`w-full py-3.5 text-center font-black font-mono bg-slate-50 dark:bg-slate-800 border-2 border-blue-500 rounded-2xl text-slate-900 dark:text-white focus:outline-none focus:bg-white dark:focus:bg-slate-800 transition-all ${
                  otpInput.length <= 8 ? 'tracking-[0.35em] text-2xl' : 'text-xs tracking-normal px-3'
                }`}
              />
              <span className="block text-[10px] text-slate-400 dark:text-slate-500 text-center mt-1">
                Enter the 6-digit OTP code sent to your email
              </span>
            </div>

            <button
              type="submit"
              disabled={isLoading || otpInput.length < 6}
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold text-sm rounded-2xl flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 transition-all"
            >
              {isLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
              <span>Verify & Access Dashboard</span>
            </button>

            <div className="flex items-center justify-between text-xs font-semibold pt-1">
              <button
                type="button"
                onClick={() => {
                  sessionStorage.removeItem('rma_login_pending_email');
                  setStep('email');
                  setOtpInput('');
                  setErrorMessage(null);
                }}
                className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 underline cursor-pointer"
              >
                Change Email
              </button>
              {countdown > 0 ? (
                <span className="text-slate-400 dark:text-slate-500 text-xs font-mono">
                  Resend Code ({countdown}s)
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleRequestOtp}
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline cursor-pointer"
                >
                  Resend Code
                </button>
              )}
            </div>
          </form>
        )}

      </div>
    </div>
  );
}
