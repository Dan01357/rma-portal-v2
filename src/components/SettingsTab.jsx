import React, { useState, useEffect } from 'react';
import { 
  Settings, 
  ToggleLeft, 
  ToggleRight, 
  Database, 
  Mail, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle
} from 'lucide-react';
import { rmaApi } from '../supabaseClient';
import { applyEmailTestMode } from '../utils/rmaHelpers';
import { notificationService } from '../services/notificationService';

export default function SettingsTab({ 
  isTestMode, 
  onToggleTestMode
}) {
  const [connectionStatus, setConnectionStatus] = useState({
    loading: false,
    checked: false,
    connected: false,
    message: ''
  });

  const [smtpStatus, setSmtpStatus] = useState({
    loading: false,
    checked: false,
    success: false,
    message: '',
    diagnostic: '',
    passLength: null,
    hadSpaces: false
  });

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://lschluviltzsknptwgrz.supabase.co';
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_Jrv9ZNgGXJ4PZoNWCJSHxQ_7hZtQqd3';

  useEffect(() => {
    handleCheckConnection();
  }, []);

  const handleCheckConnection = async () => {
    setConnectionStatus({ loading: true, checked: false, connected: false, message: 'Pinging Supabase...' });
    const result = await rmaApi.testConnection();
    setConnectionStatus({
      loading: false,
      checked: true,
      connected: result.connected,
      message: result.message
    });
  };

  const handleTestSmtp = async () => {
    setSmtpStatus({ loading: true, checked: false, success: false, message: 'Authenticating with Google SMTP...', diagnostic: '', passLength: null, hadSpaces: false });
    const res = await notificationService.testSmtpConnection();
    setSmtpStatus({
      loading: false,
      checked: true,
      success: Boolean(res.success || res.verified),
      message: res.message || res.error || 'Connection failed',
      diagnostic: res.diagnostic || '',
      passLength: res.passLength || null,
      hadSpaces: Boolean(res.hadSpaces)
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm">
        <div className="flex items-center space-x-2">
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-brand-50 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-500/40">
            System Administration
          </span>
        </div>
        <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-1 flex items-center gap-2">
          <Settings className="w-6 h-6 text-brand-600 dark:text-brand-400" />
          Settings & Environment Control
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Configure email dispatch simulations, Supabase live database connection, and routing inspection.
        </p>
      </div>

      {/* Test Mode Switch Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Simulation / Test Mode Toggle</h2>
              {isTestMode ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40">
                  ACTIVE
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                  OFF
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl">
              When ON, all test emails will be safely dispatched exclusively to <code className="text-amber-600 dark:text-amber-300 font-mono">finance2@keysysincorporated.com</code> with <code className="text-amber-600 dark:text-amber-300 font-mono">Test - </code> in the subject so you can inspect Sent and Inbox without notifying live recipients.
            </p>
          </div>

          <button
            type="button"
            onClick={onToggleTestMode}
            className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl font-bold text-xs transition-all shadow-sm ${
              isTestMode 
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/20' 
                : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
            }`}
          >
            {isTestMode ? (
              <>
                <ToggleRight className="w-5 h-5 text-slate-950" />
                <span>Test Mode: ON</span>
              </>
            ) : (
              <>
                <ToggleLeft className="w-5 h-5 text-slate-400" />
                <span>Test Mode: OFF</span>
              </>
            )}
          </button>
        </div>

        {/* Live email preview example */}
        <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs font-mono space-y-1">
          <span className="text-[11px] font-sans font-semibold text-slate-500 dark:text-slate-400 block mb-1">
            Example Recipient Output with current setting:
          </span>
          <div className="text-slate-700 dark:text-slate-300">
            To: <span className={isTestMode ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-emerald-600 dark:text-emerald-400'}>
              {isTestMode ? 'finance2@keysysincorporated.com (Live target azgodev@gmail.com safely bypassed)' : 'azgodev@gmail.com'}
            </span>
          </div>
        </div>
      </div>

      {/* Supabase Connection Status Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center space-x-2.5">
            <Database className="w-5 h-5 text-brand-600 dark:text-brand-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Supabase Backend Connection</h2>
          </div>

          <button
            onClick={handleCheckConnection}
            disabled={connectionStatus.loading}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 flex items-center space-x-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${connectionStatus.loading ? 'animate-spin' : ''}`} />
            <span>{connectionStatus.loading ? 'Testing...' : 'Test Connection'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
          <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
            <span className="text-slate-400 text-[10px] block font-sans">ENDPOINT (VITE_SUPABASE_URL)</span>
            <span className="text-slate-800 dark:text-slate-200 truncate block mt-0.5">{supabaseUrl}</span>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
            <span className="text-slate-400 text-[10px] block font-sans">ANON KEY (VITE_SUPABASE_ANON_KEY)</span>
            <span className="text-slate-800 dark:text-slate-200 truncate block mt-0.5">
              {supabaseKey.slice(0, 14)}...{supabaseKey.slice(-6)}
            </span>
          </div>
        </div>

        {/* Connection Result Badge */}
        <div className={`p-4 rounded-2xl border flex items-center space-x-3 text-xs ${
          connectionStatus.connected 
            ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-500/40 text-emerald-800 dark:text-emerald-300' 
            : 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-500/40 text-amber-800 dark:text-amber-300'
        }`}>
          {connectionStatus.connected ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
          )}
          <div>
            <div className="font-bold text-sm">
              {connectionStatus.connected ? 'Supabase Backend Connected' : 'Offline / Mock Redundancy Mode'}
            </div>
            <div className="text-[11px] opacity-90 mt-0.5">
              {connectionStatus.message || 'Ready'}
            </div>
          </div>
        </div>
      </div>

      {/* Google SMTP Email Dispatch Service Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center space-x-2.5">
            <Mail className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Google SMTP Notification Service</h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">Automated intake & catalog updates dispatcher</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleTestSmtp}
            disabled={smtpStatus.loading}
            className="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/70 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-xs font-bold rounded-xl border border-indigo-200 dark:border-indigo-800 flex items-center space-x-1.5 transition-colors cursor-pointer shadow-2xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${smtpStatus.loading ? 'animate-spin' : ''}`} />
            <span>{smtpStatus.loading ? 'Authenticating...' : 'Test SMTP Credentials'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
          <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
            <span className="text-slate-400 text-[10px] block font-sans font-semibold">SENDER ACCOUNT (GMAIL_USER)</span>
            <span className="text-slate-800 dark:text-slate-200 truncate block mt-0.5 font-bold">finance2@keysysincorporated.com</span>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
            <span className="text-slate-400 text-[10px] block font-sans font-semibold">GMAIL APP PASSWORD STATUS</span>
            <span className="text-slate-800 dark:text-slate-200 truncate block mt-0.5 font-bold">
              {smtpStatus.checked ? (smtpStatus.success ? '✓ 16-character key authenticated' : `Detected: ${smtpStatus.passLength || 0} chars`) : 'Configured in Vercel'}
            </span>
          </div>
        </div>

        {/* SMTP Status Result Banner */}
        {smtpStatus.checked && (
          <div className={`p-4 rounded-2xl border space-y-2 text-xs animate-in fade-in ${
            smtpStatus.success
              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-500/40 text-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-500/40 text-rose-800 dark:text-rose-300'
          }`}>
            <div className="flex items-center space-x-2.5">
              {smtpStatus.success ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
              )}
              <div className="font-bold text-sm">
                {smtpStatus.success ? 'Google SMTP Verified & Operational' : 'SMTP Authentication Error (Bad Credentials)'}
              </div>
            </div>
            <div className="text-[11px] leading-relaxed font-mono">
              {smtpStatus.message}
            </div>
            {smtpStatus.diagnostic && (
              <div className="mt-2 p-2.5 bg-rose-100/80 dark:bg-rose-900/40 rounded-xl text-[11px] font-sans text-rose-900 dark:text-rose-200 border border-rose-200 dark:border-rose-800/60">
                <strong>💡 Troubleshooting Guide:</strong> {smtpStatus.diagnostic}
              </div>
            )}
            {smtpStatus.hadSpaces && (
              <div className="text-[11px] text-amber-700 dark:text-amber-300 font-sans font-semibold">
                ℹ️ Note: Your App Password in Vercel contained spaces. The system has automatically stripped them for pure 16-character authentication.
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
