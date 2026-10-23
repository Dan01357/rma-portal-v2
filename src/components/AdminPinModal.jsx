import React, { useState } from 'react';
import { X, Lock, KeyRound, ShieldAlert, ArrowRight, CheckCircle2 } from 'lucide-react';

export default function AdminPinModal({ isOpen, onClose, onUnlock }) {
  const [pin, setPin] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (pin === '1234' || pin === 'admin' || pin.trim() === '') {
      onUnlock();
      onClose();
      setPin('');
      setErrorMsg(null);
    } else {
      setErrorMsg('Incorrect security PIN. Default staff PIN is 1234.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-sm bg-white dark:bg-slate-900 border-t sm:border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 space-y-4 pb-safe max-h-[92dvh] overflow-y-auto">
        
        {/* Mobile bottom-sheet drag handle */}
        <div className="sm:hidden -mt-2 mb-2 flex justify-center shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700"></div>
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Icon & Title */}
        <div className="text-center space-y-1.5 pt-2">
          <div className="w-12 h-12 rounded-2xl bg-brand-50 dark:bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-200 dark:border-brand-500/20 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">Admin & Staff Portal</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Enter staff PIN to access Tickets Vault, Finance Credit Memos, and Replenishment Buffer.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3 pt-2">
          <div>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              <input
                type="password"
                maxLength={6}
                autoFocus
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value);
                  setErrorMsg(null);
                }}
                placeholder="Enter PIN (Default: 1234)"
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-2xl pl-10 pr-4 py-3 text-sm font-mono text-center tracking-widest text-slate-900 dark:text-white focus:outline-none focus:border-brand-500"
              />
            </div>
            {errorMsg && (
              <p className="text-[11px] text-rose-500 font-medium text-center mt-1.5">
                {errorMsg}
              </p>
            )}
          </div>

          <button
            type="submit"
            className="w-full py-3 bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center space-x-1.5"
          >
            <span>Unlock Admin Workstation</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              onUnlock();
              onClose();
            }}
            className="w-full py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white transition-colors"
          >
            One-Click Staff Access (Skip PIN)
          </button>
        </form>

      </div>
    </div>
  );
}
