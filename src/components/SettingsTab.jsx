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
  QrCode,
  Users,
  Plus,
  Trash2,
  Save,
  RotateCcw,
  Check,
  AtSign,
  Shield,
  KeyRound,
  ExternalLink
} from 'lucide-react';
import { rmaApi, supabase } from '../supabaseClient';
import { applyEmailTestMode } from '../utils/rmaHelpers';
import { notificationService } from '../services/notificationService';
import { purchaseOrdersApi } from '../services/purchaseOrdersApi';
import ApiKeysManagementSection from './ApiKeysManagementSection';

export default function SettingsTab({ 
  isTestMode, 
  onToggleTestMode,
  onOpenPortalQr,
  currentUser
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

  // Super Admin Configurable RMA Email Recipients State
  const [mainRecipient, setMainRecipient] = useState('azgodev@gmail.com');
  const [ccRecipients, setCcRecipients] = useState([
    'mgan@pingconmarketing.com',
    'marketing@pingconmarketing.com',
    'azgan@pingconmarketing.com',
    'jaezelle.benito@pingconmarketing.com'
  ]);
  const [newCcInput, setNewCcInput] = useState('');
  const [isSavingRecipients, setIsSavingRecipients] = useState(false);
  const [recipientFeedback, setRecipientFeedback] = useState(null);

  // Live Product Catalog API State
  const [poApiKey, setPoApiKey] = useState(() => purchaseOrdersApi.getApiKey() || '');
  const [poApiStatus, setPoApiStatus] = useState({
    loading: false,
    checked: false,
    connected: false,
    message: ''
  });
  const [isSavingPoKey, setIsSavingPoKey] = useState(false);
  const [poKeyFeedback, setPoKeyFeedback] = useState(null);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://lschluviltzsknptwgrz.supabase.co';
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_Jrv9ZNgGXJ4PZoNWCJSHxQ_7hZtQqd3';

  useEffect(() => {
    handleCheckConnection();
    handleCheckPoApi();

    // Auto-sync Catalog API key from/to Supabase cloud for seamless mobile/desktop sharing
    purchaseOrdersApi.loadApiKeyFromCloud().then(cloudKey => {
      if (cloudKey) {
        setPoApiKey(cloudKey);
        handleCheckPoApi();
      } else {
        const localKey = purchaseOrdersApi.getApiKey();
        if (localKey && localKey !== 'pk_live_po_cloud_db_2026_dev_key') {
          purchaseOrdersApi.setApiKey(localKey);
        }
      }
    });

    // 1. Load active email recipient settings
    const active = notificationService.getEmailSettings();
    if (active?.toEmail) setMainRecipient(active.toEmail);
    if (Array.isArray(active?.baseCcList)) setCcRecipients(active.baseCcList);

    // 2. Load from Supabase rma_settings if available
    notificationService.loadEmailSettingsFromDb().then(dbSettings => {
      if (dbSettings?.toEmail) setMainRecipient(dbSettings.toEmail);
      if (Array.isArray(dbSettings?.baseCcList)) setCcRecipients(dbSettings.baseCcList);
    });

    const handleSyncRecipients = () => {
      const updated = notificationService.getEmailSettings();
      if (updated?.toEmail) setMainRecipient(updated.toEmail);
      if (Array.isArray(updated?.baseCcList)) setCcRecipients(updated.baseCcList);
    };

    window.addEventListener('rma-settings-changed', handleSyncRecipients);
    window.addEventListener('storage', handleSyncRecipients);
    return () => {
      window.removeEventListener('rma-settings-changed', handleSyncRecipients);
      window.removeEventListener('storage', handleSyncRecipients);
    };
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

  const handleCheckPoApi = async () => {
    setPoApiStatus({ loading: true, checked: false, connected: false, message: 'Testing Product Catalog API...' });
    const result = await purchaseOrdersApi.testConnection(true);
    setPoApiStatus({
      loading: false,
      checked: true,
      connected: result.connected,
      message: result.connected 
        ? `Connected! Access verified to 5,793+ live SKUs in erply_products.` 
        : (result.error || 'Connection failed.')
    });
  };

  const handleSavePoKey = async () => {
    setIsSavingPoKey(true);
    setPoKeyFeedback(null);
    try {
      await purchaseOrdersApi.setApiKey(poApiKey);
      setPoKeyFeedback({ type: 'success', message: 'Catalog API Key saved and synced across all devices!' });
      handleCheckPoApi();
    } catch (err) {
      setPoKeyFeedback({ type: 'error', message: err.message });
    } finally {
      setIsSavingPoKey(false);
      setTimeout(() => setPoKeyFeedback(null), 4000);
    }
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

  // Add CC email to list
  const handleAddCcEmail = (e) => {
    if (e) e.preventDefault();
    const clean = newCcInput.trim().toLowerCase();
    if (!clean) return;

    if (!clean.includes('@') || !clean.includes('.')) {
      setRecipientFeedback({ type: 'error', message: 'Please enter a valid email address.' });
      return;
    }

    if (ccRecipients.map(c => c.toLowerCase()).includes(clean)) {
      setRecipientFeedback({ type: 'error', message: 'This email is already in the CC list.' });
      return;
    }

    setCcRecipients(prev => [...prev, clean]);
    setNewCcInput('');
    setRecipientFeedback(null);
  };

  // Remove CC email from list
  const handleRemoveCcEmail = (emailToRemove) => {
    setCcRecipients(prev => prev.filter(email => email.toLowerCase() !== emailToRemove.toLowerCase()));
    setRecipientFeedback(null);
  };

  // Restore Default Corporate Recipients
  const handleResetDefaults = () => {
    const defaults = {
      toEmail: 'azgodev@gmail.com',
      baseCcList: [
        'mgan@pingconmarketing.com',
        'marketing@pingconmarketing.com',
        'azgan@pingconmarketing.com',
        'jaezelle.benito@pingconmarketing.com'
      ]
    };
    setMainRecipient(defaults.toEmail);
    setCcRecipients(defaults.baseCcList);
    setRecipientFeedback({ type: 'success', message: 'Corporate defaults restored! Click "Save Changes" to apply.' });
  };

  // Save Recipient Settings
  const handleSaveRecipients = async () => {
    const cleanTo = mainRecipient.trim().toLowerCase();
    if (!cleanTo || !cleanTo.includes('@') || !cleanTo.includes('.')) {
      setRecipientFeedback({ type: 'error', message: 'Please enter a valid Primary TO recipient email address.' });
      return;
    }

    setIsSavingRecipients(true);
    setRecipientFeedback(null);

    try {
      await notificationService.saveEmailSettings({
        toEmail: cleanTo,
        baseCcList: ccRecipients
      });
      setRecipientFeedback({ 
        type: 'success', 
        message: 'RMA email recipients successfully updated and active for all notifications!' 
      });
      setTimeout(() => setRecipientFeedback(null), 4000);
    } catch (err) {
      setRecipientFeedback({ type: 'error', message: err.message || 'Failed to save recipients.' });
    } finally {
      setIsSavingRecipients(false);
    }
  };

  const isSuperAdmin = currentUser?.role === 'super_admin';

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

      {/* CARD 1: SUPER ADMIN RMA EMAIL RECIPIENTS CONFIGURATION */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-7 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                  RMA Email Notification Recipients
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                  Super Admin
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Configure Main TO recipient and Corporate CC distribution list for all official RMA return reports.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              type="button"
              onClick={handleResetDefaults}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Reset to corporate standard recipients"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Defaults</span>
            </button>

            <button
              type="button"
              onClick={handleSaveRecipients}
              disabled={isSavingRecipients}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black rounded-xl flex items-center gap-1.5 transition-all shadow-sm cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSavingRecipients ? 'Saving...' : 'Save Recipients'}</span>
            </button>
          </div>
        </div>

        {/* Feedback message */}
        {recipientFeedback && (
          <div className={`p-3.5 rounded-2xl text-xs font-bold border flex items-center gap-2 animate-in fade-in ${
            recipientFeedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
          }`}>
            {recipientFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            )}
            <span>{recipientFeedback.message}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6">
          {/* Main Primary Recipient (TO) */}
          <div className="space-y-2">
            <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center justify-between">
              <span>Primary Main Recipient (TO Address)</span>
              <span className="text-[11px] font-normal text-slate-400 lowercase">Single Primary Target</span>
            </label>
            <div className="relative">
              <AtSign className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="email"
                value={mainRecipient}
                onChange={(e) => setMainRecipient(e.target.value)}
                placeholder="e.g. azgodev@gmail.com or finance@company.com"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs font-mono text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              The primary destination mailbox for automated RMA alerts. In Live Mode, emails are dispatched directly to this address.
            </p>
          </div>

          {/* CC Distribution List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Carbon Copy Distribution List (CC Addresses)
              </label>
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                {ccRecipients.length} Recipient{ccRecipients.length === 1 ? '' : 's'}
              </span>
            </div>

            {/* CC Chips / Badges Container */}
            <div className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl min-h-[58px] flex flex-wrap gap-2 items-center">
              {ccRecipients.length === 0 ? (
                <span className="text-xs text-slate-400 italic">No CC recipients configured. Add one below.</span>
              ) : (
                ccRecipients.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono shadow-2xs group"
                  >
                    <span>{email}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCcEmail(email)}
                      className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer p-0.5 rounded-md"
                      title={`Remove ${email}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))
              )}
            </div>

            {/* Add new CC form */}
            <form onSubmit={handleAddCcEmail} className="flex gap-2">
              <div className="relative flex-1">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  value={newCcInput}
                  onChange={(e) => setNewCcInput(e.target.value)}
                  placeholder="Enter email to add to CC (e.g. manager@pingconmarketing.com)"
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-mono text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="submit"
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add CC</span>
              </button>
            </form>

            <div className="p-3 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-900/40 rounded-xl text-[11px] text-blue-900 dark:text-blue-200 leading-relaxed flex items-start gap-2">
              <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <span>
                <strong>Smart Dynamic AE Addition:</strong> The Customer Account Executive (AE) assigned to the product (e.g. <code>alleli.almaida@ph.keysys.com</code>) is <strong>automatically appended</strong> to this CC list upon report dispatch.
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* CARD 2: TEST MODE SWITCH CARD */}
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
        <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs font-mono space-y-1.5">
          <span className="text-[11px] font-sans font-semibold text-slate-500 dark:text-slate-400 block mb-1">
            Live Recipient Output with Current Configuration:
          </span>
          <div className="text-slate-700 dark:text-slate-300">
            <strong>Target TO:</strong> <span className={isTestMode ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-emerald-600 dark:text-emerald-400 font-bold'}>
              {isTestMode ? `finance2@keysysincorporated.com (Live target "${mainRecipient}" safely bypassed)` : mainRecipient}
            </span>
          </div>
          <div className="text-slate-700 dark:text-slate-300">
            <strong>Target CC:</strong> <span className={isTestMode ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-slate-700 dark:text-slate-300'}>
              {isTestMode 
                ? '[] (All CC recipients bypassed in Sandbox)' 
                : `${ccRecipients.join(', ') || 'None'} + [Customer AE email]`}
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

      {/* 3. Public Reporting Portal Access QR & Dock Posters */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-extrabold text-slate-900 dark:text-white text-base">Public Reporting Portal Access QR</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Generate high-res QR codes and printable posters for receiving docks & store repackers</p>
            </div>
          </div>

          {onOpenPortalQr && (
            <button
              type="button"
              onClick={onOpenPortalQr}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer self-start sm:self-auto"
            >
              <QrCode className="w-4 h-4" />
              <span>View & Download Poster</span>
            </button>
          )}
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          Users who report products do not need login credentials. They simply scan the QR code posted at your receiving docks or return desks to launch the portal, scan the retail barcode, attach photos of damaged items, and print box verification stickers.
        </p>
      </div>

      {/* 4. Live Product Catalog API Integration (EXTERNAL_API_KEY_DANILO) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-extrabold text-slate-900 dark:text-white text-base flex items-center gap-2">
                <span>Live Product Catalog API (SKU Auto-Suggestions)</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 font-mono font-bold">
                  EXTERNAL_API_KEY_DANILO
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Direct integration with Enterprise Laravel Cloud product catalog (5,793+ SKUs in erply_products)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCheckPoApi}
              disabled={poApiStatus.loading}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${poApiStatus.loading ? 'animate-spin text-blue-600' : ''}`} />
              <span>{poApiStatus.loading ? 'Testing...' : 'Test Connection'}</span>
            </button>
          </div>
        </div>

        {/* Status result strip */}
        {poApiStatus.checked && (
          <div className={`p-3.5 rounded-2xl border text-xs flex items-center gap-2.5 ${
            poApiStatus.connected
              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
          }`}>
            {poApiStatus.connected ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            )}
            <span className="font-semibold">{poApiStatus.message}</span>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              API Base URL
            </label>
            <div className="p-2.5 bg-slate-50 dark:bg-slate-950 rounded-xl font-mono text-xs text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800">
              https://purchase-order-db-production-ff1oho.laravel.cloud/api/v1
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Danilo's Private API Key (Header: <code className="font-mono">X-API-Key</code>)
              </label>
              {poKeyFeedback && (
                <span className={`text-[11px] font-bold ${poKeyFeedback.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {poKeyFeedback.message}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={poApiKey}
                onChange={(e) => setPoApiKey(e.target.value)}
                placeholder="Paste EXTERNAL_API_KEY_DANILO private key here..."
                className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-indigo-600"
              />
              <button
                type="button"
                onClick={handleSavePoKey}
                disabled={isSavingPoKey}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSavingPoKey ? 'Saving...' : 'Save Key'}</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              When assigning SKUs in Admin or Quick Process, typing into SKU or Product Name automatically suggests and auto-populates product details.
            </p>
          </div>
        </div>
      </div>

      {/* 5. MULTI-SYSTEM REST API KEYS & INTEGRATION (SHA-256 HASHED) */}
      <ApiKeysManagementSection />

    </div>
  );
}
