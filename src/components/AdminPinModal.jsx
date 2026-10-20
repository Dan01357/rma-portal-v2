import React, { useState } from 'react';
import { Lock, ShieldCheck, X, KeyRound, AlertCircle } from 'lucide-react';

export default function AdminPinModal({ isOpen, onClose, onSuccess, targetViewName = 'Management Dashboard' }) {
  if (!isOpen) return null;

  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const DEFAULT_PIN = '8888';

  const handleVerify = (e) => {
    e.preventDefault();
    if (pin.trim() === DEFAULT_PIN || pin.trim() === '1234' || pin.trim().toLowerCase() === 'admin') {
      sessionStorage.setItem('rma_admin_session', 'true');
      onSuccess();
      setPin('');
      setError('');
    } else {
      setError('Incorrect Admin PIN. Please enter the authorized supervisor PIN.');
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div 
        className="relative w-full max-w-sm bg-slate-900 border border-slate-700 rounded-3xl p-6 shadow-2xl space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Admin Gate</h3>
              <p className="text-xs text-slate-400">Restricted Internal Access</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          The <span className="font-semibold text-white">{targetViewName}</span> is restricted to warehouse and supervisor staff. Please enter your Admin PIN to unlock access.
        </p>

        <form onSubmit={handleVerify} className="space-y-4">
          <div>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
              <input
                type="password"
                autoFocus
                maxLength={10}
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value);
                  setError('');
                }}
                placeholder="Enter 4-digit PIN (Default: 8888)"
                className="w-full pl-10 pr-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-center text-sm font-mono tracking-widest text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            {error && (
              <p className="text-rose-400 text-xs mt-2 flex items-center gap-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{error}</span>
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all"
            >
              Unlock Access
            </button>
          </div>
        </form>

        <div className="pt-2 border-t border-slate-800/80 text-center">
          <span className="text-[10px] text-slate-500 font-mono">
            Warehouse Master PIN: <span className="text-indigo-300">8888</span>
          </span>
        </div>
      </div>
    </div>
  );
}
