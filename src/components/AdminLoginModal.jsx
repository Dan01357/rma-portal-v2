import React, { useState } from 'react';
import { Lock, Mail, ShieldCheck, KeyRound, AlertCircle, RefreshCw, CheckCircle, ArrowRight, X } from 'lucide-react';
import { authService } from '../services/authService';

export default function AdminLoginModal({ isOpen, onClose, onLoginSuccess }) {
  const [step, setStep] = useState('email'); // 'email' | 'otp'
  const [emailInput, setEmailInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Always reset to Step 1 (enter email) whenever modal is opened fresh
  React.useEffect(() => {
    if (isOpen) {
      setStep('email');
      setEmailInput('');
      setOtpInput('');
      setIsLoading(false);
      setErrorMessage(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Step 1: Request OTP
  const handleRequestOtp = async (e) => {
    e.preventDefault();
    const email = emailInput.trim().toLowerCase();
    if (!email) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      await authService.requestOtp(email);
      setStep('otp');
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
        onLoginSuccess(res.user);
      }
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-md animate-in fade-in">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full p-6 sm:p-7 space-y-5">
        
        {/* Top Icon & Title */}
        <div className="text-center space-y-1.5">
          <div className="w-12 h-12 bg-blue-100 text-blue-700 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight">
            Company Staff Verification
          </h2>
          <p className="text-xs text-slate-500">
            One-Time Password (OTP) security gate for RMA admin access.
          </p>
        </div>

        {/* Error Notice */}
        {errorMessage && (
          <div className="p-3 bg-rose-50 border border-rose-300 text-rose-800 rounded-2xl text-xs font-semibold flex items-start gap-2 animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* STEP 1: Enter Company Email */}
        {step === 'email' && (
          <form onSubmit={handleRequestOtp} className="space-y-4">
            <div>
              <label className="block text-xs font-black uppercase tracking-wider text-slate-500 mb-1.5">
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
                  className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-300 rounded-2xl text-xs font-bold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
                />
              </div>
              <span className="block text-[11px] text-slate-400 mt-1">
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
                className="w-full py-2 text-xs font-bold text-slate-500 hover:text-slate-800 text-center"
              >
                Cancel & Return to Public Portal
              </button>
            )}
          </form>
        )}

        {/* STEP 2: Enter 6-digit OTP */}
        {step === 'otp' && (
          <form onSubmit={handleVerifyOtp} className="space-y-4 animate-in fade-in">
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900 space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Verification code dispatched!</span>
              </div>
              <p className="text-[11px] text-emerald-800">
                Please check your inbox at <strong>{emailInput}</strong> for your OTP access code.
              </p>
            </div>

            <div>
              <label className="block text-xs font-black uppercase tracking-wider text-slate-500 mb-1.5 text-center">
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
                className={`w-full py-3.5 text-center font-black font-mono bg-slate-50 border-2 border-blue-500 rounded-2xl text-slate-900 focus:outline-none focus:bg-white transition-all ${
                  otpInput.length <= 8 ? 'tracking-[0.35em] text-2xl' : 'text-xs tracking-normal px-3'
                }`}
              />
              <span className="block text-[10px] text-slate-400 text-center mt-1">
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
                onClick={() => setStep('email')}
                className="text-slate-500 hover:text-slate-800 underline"
              >
                Change Email
              </button>
              <button
                type="button"
                onClick={handleRequestOtp}
                className="text-blue-600 hover:text-blue-800 underline"
              >
                Resend Code
              </button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
}
