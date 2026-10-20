import React, { useState, useEffect } from 'react';
import { 
  Settings, 
  ToggleLeft, 
  ToggleRight, 
  Database, 
  Mail, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  ShieldCheck, 
  RotateCcw,
  Server,
  Zap
} from 'lucide-react';
import { rmaApi, isSupabaseConfigured } from '../supabaseClient';
import { AE_ROSTERS, INITIAL_TICKETS, INITIAL_PRODUCTS } from '../data/mockData';
import { applyEmailTestMode } from '../utils/rmaHelpers';

export default function SettingsTab({ 
  isTestMode, 
  onToggleTestMode, 
  onResetData 
}) {
  const [connectionStatus, setConnectionStatus] = useState({
    loading: false,
    checked: false,
    connected: false,
    message: ''
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

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex items-center space-x-2">
          <span className="px-2.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-brand-500/20 text-brand-300 border border-brand-500/40">
            System Administration
          </span>
        </div>
        <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-1 flex items-center gap-2">
          <Settings className="w-6 h-6 text-brand-400" />
          Settings & Environment Control
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Configure email dispatch simulations, Supabase live database connection, and routing inspection.
        </p>
      </div>

      {/* Test Mode Switch Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <h2 className="text-base font-bold text-white">Simulation / Test Mode Toggle</h2>
              {isTestMode ? (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  ACTIVE
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-800 text-slate-400 border border-slate-700">
                  OFF
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 max-w-xl">
              When ON, all outbound email dispatch addresses will have <strong>.test</strong> appended (e.g. <code className="text-amber-300 font-mono">azgodev@gmail.com.test</code>). This guarantees zero live emails hit real client inboxes during demos or warehouse tests.
            </p>
          </div>

          <button
            type="button"
            onClick={onToggleTestMode}
            className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl font-bold text-xs transition-all shadow-md ${
              isTestMode 
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/30' 
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
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
        <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs font-mono space-y-1">
          <span className="text-[11px] font-sans font-semibold text-slate-400 block mb-1">
            Example Recipient Output with current setting:
          </span>
          <div className="text-slate-300">
            To: <span className={isTestMode ? 'text-amber-400 font-bold' : 'text-emerald-400'}>{applyEmailTestMode('azgodev@gmail.com', isTestMode)}</span>
          </div>
          <div className="text-slate-300 truncate">
            CC: <span className={isTestMode ? 'text-amber-400 font-bold' : 'text-emerald-400'}>{applyEmailTestMode('mgan@pingconmarketing.com', isTestMode)}</span>, <span className={isTestMode ? 'text-amber-400 font-bold' : 'text-emerald-400'}>{applyEmailTestMode('jaezelle.benito@pingconmarketing.com', isTestMode)}</span>
          </div>
        </div>
      </div>

      {/* Supabase Connection Status Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2.5">
            <Database className="w-5 h-5 text-brand-400" />
            <h2 className="text-base font-bold text-white">Supabase Backend Connection</h2>
          </div>

          <button
            onClick={handleCheckConnection}
            disabled={connectionStatus.loading}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg border border-slate-700 flex items-center space-x-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${connectionStatus.loading ? 'animate-spin' : ''}`} />
            <span>{connectionStatus.loading ? 'Testing...' : 'Test Connection'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-500 text-[10px] block font-sans">ENDPOINT (VITE_SUPABASE_URL)</span>
            <span className="text-slate-200 truncate block mt-0.5">{supabaseUrl}</span>
          </div>

          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-500 text-[10px] block font-sans">ANON KEY (VITE_SUPABASE_ANON_KEY)</span>
            <span className="text-slate-200 truncate block mt-0.5">
              {supabaseKey.slice(0, 14)}...{supabaseKey.slice(-6)}
            </span>
          </div>
        </div>

        {/* Connection Result Badge */}
        <div className={`p-4 rounded-xl border flex items-center space-x-3 text-xs ${
          connectionStatus.connected 
            ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300' 
            : 'bg-amber-950/60 border-amber-500/40 text-amber-300'
        }`}>
          {connectionStatus.connected ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
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

        <p className="text-[11px] text-slate-400 leading-relaxed">
          <strong>Auto-Fallback Guarantee:</strong> The RMA portal automatically caches tickets and catalog data locally in browser storage. If network drops or database tables are provisioning, repackers can continue scanning and filing returns with zero downtime.
        </p>
      </div>

      {/* AE Routing Matrix Inspector */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex items-center space-x-2.5 border-b border-slate-800 pb-3">
          <Mail className="w-5 h-5 text-brand-400" />
          <h2 className="text-base font-bold text-white">Outbound Email Routing Matrix Inspector</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          
          {/* Group 2 */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
            <span className="font-bold text-brand-400 block border-b border-slate-800/80 pb-1.5 font-sans">
              Group 2 (PINGCON & BONITA TISSUE)
            </span>
            <div className="font-mono text-[11px] space-y-1 text-slate-300">
              <div><span className="text-slate-500">Sender:</span> finance@pingconmarketing.com</div>
              <div><span className="text-slate-500">To:</span> azgodev@gmail.com</div>
              <div className="text-slate-400 text-[10px]">
                <span className="text-slate-500">CC:</span> mgan@pingconmarketing.com, AZGan@pingconmarketing.com, marketing@pingconmarketing.com, jaezelle.benito@pingconmarketing.com + Selected AE + Supervisor
              </div>
            </div>
          </div>

          {/* Group 1 */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
            <span className="font-bold text-brand-400 block border-b border-slate-800/80 pb-1.5 font-sans">
              Group 1 (KEYSYS & A2Z2GO)
            </span>
            <div className="font-mono text-[11px] space-y-1 text-slate-300">
              <div><span className="text-slate-500">Sender:</span> finance2@a2z2go.net</div>
              <div><span className="text-slate-500">To:</span> azgodev@gmail.com</div>
              <div className="text-slate-400 text-[10px]">
                <span className="text-slate-500">CC:</span> mgan@a2z2go.net, AZGan@a2z2go.net, marketing@a2z2go.net, jaezelle.benito@pingconmarketing.com + Selected AE + Supervisor
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Local Data Reset */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-200 text-sm">Demo Data & Storage Reset</h3>
          <p className="text-xs text-slate-400">Restore factory sample tickets and default wholesale product catalog.</p>
        </div>

        <button
          type="button"
          onClick={onResetData}
          className="px-4 py-2 bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 hover:border-rose-500/50 text-slate-300 text-xs font-semibold rounded-xl border border-slate-700 flex items-center space-x-1.5 transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Reset Sample Data</span>
        </button>
      </div>

    </div>
  );
}
