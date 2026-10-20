import React, { useState, useEffect } from 'react';
import {
  X,
  Mail,
  Save,
  RotateCcw,
  Send,
  CheckCircle2,
  Users,
  AlertCircle,
  ExternalLink,
  FlaskConical,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  Code2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Sparkles
} from 'lucide-react';
import {
  ACCOUNT_EXECUTIVES,
  BRAND_SENDERS,
  MASTER_SENDER_EMAIL,
  DEFAULT_EMAIL_ROUTING,
  getEmailRoutingConfig,
  saveEmailRoutingConfig,
  buildDispatchEmailPayload,
  isSandboxMode,
  setSandboxMode,
  getWebhookUrl,
  saveWebhookUrl,
  sendEmailViaWebhook
} from '../lib/emailRouting';

export default function EmailDispatchSettingsModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  const [config,         setConfig]         = useState(DEFAULT_EMAIL_ROUTING);
  const [a2zCcText,      setA2zCcText]      = useState('');
  const [pingconCcText,  setPingconCcText]  = useState('');
  const [saveSuccess,    setSaveSuccess]    = useState(false);
  const [testPayload,    setTestPayload]    = useState(null);
  const [sandboxEnabled, setSandboxEnabled] = useState(false);
  const [webhookUrl,     setWebhookUrl]     = useState('');
  const [showScriptGuide, setShowScriptGuide] = useState(false);
  const [copiedCode,     setCopiedCode]     = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState(null);

  useEffect(() => {
    const loaded = getEmailRoutingConfig();
    setConfig(loaded);
    setA2zCcText((loaded.a2zGroup?.ccRecipients  || []).join('\n'));
    setPingconCcText((loaded.pingconGroup?.ccRecipients || []).join('\n'));
    setSandboxEnabled(isSandboxMode());
    setWebhookUrl(getWebhookUrl());
  }, [isOpen]);

  const handleSandboxToggle = () => {
    const next = !sandboxEnabled;
    setSandboxMode(next);
    setSandboxEnabled(next);
    setTestPayload(null);
  };

  const handleSave = (e) => {
    e.preventDefault();
    const cleanA2z = a2zCcText.split('\n').map(s => s.trim()).filter(s => s.length > 0 && s.includes('@'));
    const cleanPingcon = pingconCcText.split('\n').map(s => s.trim()).filter(s => s.length > 0 && s.includes('@'));

    const newConfig = {
      a2zGroup:     { mainRecipient: config.a2zGroup.mainRecipient.trim(),     ccRecipients: cleanA2z },
      pingconGroup: { mainRecipient: config.pingconGroup.mainRecipient.trim(), ccRecipients: cleanPingcon }
    };
    saveEmailRoutingConfig(newConfig);
    saveWebhookUrl(webhookUrl);
    setConfig(newConfig);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const handleResetDefaults = () => {
    if (confirm('Reset all routing rules and recipient emails back to factory defaults?')) {
      saveEmailRoutingConfig(DEFAULT_EMAIL_ROUTING);
      setConfig(DEFAULT_EMAIL_ROUTING);
      setA2zCcText(DEFAULT_EMAIL_ROUTING.a2zGroup.ccRecipients.join('\n'));
      setPingconCcText(DEFAULT_EMAIL_ROUTING.pingconGroup.ccRecipients.join('\n'));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    }
  };

  const handleGenerateTest = () => {
    const mockTicket = {
      rma_id:             'RMA-2026-TEST-ROUT',
      company:            'A2Z2GO',
      customer_name:      'Metro Commercial Supplies Co.',
      delivery_reference: 'DR-88990',
      product_name:       'A2Z Industrial Heavy-Duty Stretch Film 500m',
      sku:                'A2Z-STR-500M',
      packaging_unit:     'CS',
      defect_category:    'Damaged on Arrival (DOA)',
      defect_description: 'Outer carton crushed during delivery.',
      photo_url:          'https://images.unsplash.com/photo-1584556812952-905ffd0c611a',
      assigned_ae:        'Rodrigo Galvez',
      created_at:         new Date().toISOString()
    };
    setTestPayload(buildDispatchEmailPayload(mockTicket));
  };

  const handleTestWebhookLive = async () => {
    if (!webhookUrl) {
      alert('Please enter your Google Apps Script Webhook URL first.');
      return;
    }
    setTestingWebhook(true);
    setWebhookTestResult(null);
    try {
      const mockTicket = {
        rma_id:             'RMA-2026-TEST-LIVE',
        company:            'PINGCON',
        customer_name:      'Test Customer Verification',
        delivery_reference: 'DR-TEST-001',
        product_name:       'PINGCON Commercial Display Panel 32"',
        sku:                'PNG-LED-32F',
        packaging_unit:     'PC',
        defect_category:    'Damaged on Arrival (DOA)',
        defect_description: 'Live test email dispatched from Wholesale RMA settings modal.',
        photo_url:          'https://images.unsplash.com/photo-1593305841991-05c297ba4575',
        assigned_ae:        'Rodrigo Galvez',
        created_at:         new Date().toISOString()
      };
      const payload = buildDispatchEmailPayload(mockTicket);
      const res = await sendEmailViaWebhook(payload);
      setWebhookTestResult(res);
    } catch (err) {
      setWebhookTestResult({ success: false, message: err.message });
    } finally {
      setTestingWebhook(false);
    }
  };

  const gasScriptCode = `function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    GmailApp.sendEmail(
      data.to,
      data.subject,
      data.body,
      {
        cc: data.cc,
        replyTo: data.replyTo || "finance2@keysysincorporated.com",
        name: data.fromName || "Wholesale RMA System"
      }
    );
    return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Email sent" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}`;

  const copyScript = () => {
    navigator.clipboard.writeText(gasScriptCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2500);
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Smart AE & Email Dispatch Settings</h3>
              <p className="text-xs text-slate-400">Automated recipient routing triggered on return ticket submission.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Sandbox Test Mode Banner ─────────────────────────────── */}
        <div
          className={`mx-5 mt-5 rounded-2xl border px-4 py-3 flex items-center justify-between gap-3 transition-all ${
            sandboxEnabled
              ? 'bg-amber-500/10 border-amber-500/40'
              : 'bg-slate-800/60 border-slate-700'
          }`}
        >
          <div className="flex items-center gap-3">
            <FlaskConical className={`w-5 h-5 shrink-0 ${sandboxEnabled ? 'text-amber-400' : 'text-slate-500'}`} />
            <div>
              <p className={`text-sm font-bold ${sandboxEnabled ? 'text-amber-300' : 'text-slate-300'}`}>
                🧪 Simulation / Sandbox Test Mode
              </p>
              <p className="text-[11px] text-slate-400 leading-tight mt-0.5">
                {sandboxEnabled
                  ? 'ACTIVE — All emails routed to .test sink. Subject prefixed with [TEST]. External delivery blocked.'
                  : 'OFF — Live production mode. Real emails will be dispatched to actual recipients.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSandboxToggle}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all shrink-0 ${
              sandboxEnabled
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 hover:bg-amber-500/30'
                : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {sandboxEnabled
              ? <><ToggleRight className="w-4 h-4" />  ON</>
              : <><ToggleLeft  className="w-4 h-4" />  OFF</>
            }
          </button>
        </div>

        {sandboxEnabled && (
          <div className="mx-5 mt-2 px-4 py-2 bg-amber-950/50 border border-amber-500/30 rounded-xl text-[11px] font-mono text-amber-300 leading-relaxed">
            📬 Example: <span className="opacity-70">azgodev@gmail.com</span>{' '}
            → <span className="font-bold">azgodev@gmail.com.test</span>
            <span className="mx-2 text-amber-600">|</span>
            Subject: <span className="font-bold">[TEST] [RMA FILED] …</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-5 overflow-y-auto space-y-5 text-xs flex-1">

          {saveSuccess && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Email dispatch routing settings updated and saved successfully!</span>
            </div>
          )}

          {/* ── Brand Sender Identities ──────────────────────────── */}
          <div className="bg-slate-950/60 rounded-2xl p-4 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <h4 className="font-bold text-white text-sm">Unified Master Sender Account</h4>
              </div>
              <span className="text-[10px] font-mono text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/30">
                Active Mail Hub
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-900 border border-slate-700/80 flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">Primary Gmail / Google Workspace Account</p>
                <p className="font-mono text-emerald-400 font-bold text-xs mt-0.5">{MASTER_SENDER_EMAIL}</p>
                <p className="text-slate-500 text-[10px] mt-0.5">
                  Sends on behalf of and receives responses for both brand groups.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* A2Z Sender */}
              <div className="p-3 rounded-xl bg-purple-950/40 border border-purple-500/30">
                <p className="font-bold text-purple-300 text-[11px] mb-1">A2Z2GO / KEYSYS Brand</p>
                <p className="font-mono text-white text-[11px]">{BRAND_SENDERS.a2zGroup.fromEmail}</p>
                <p className="text-slate-400 text-[10px] mt-0.5">Alias: <span className="font-mono text-purple-200">{BRAND_SENDERS.a2zGroup.aliasEmail}</span></p>
                <p className="text-slate-500 text-[10px] mt-0.5">{BRAND_SENDERS.a2zGroup.fromName}</p>
              </div>
              {/* Pingcon Sender */}
              <div className="p-3 rounded-xl bg-blue-950/40 border border-blue-500/30">
                <p className="font-bold text-blue-300 text-[11px] mb-1">PINGCON / BONITA TISSUE Brand</p>
                <p className="font-mono text-white text-[11px]">{BRAND_SENDERS.pingconGroup.fromEmail}</p>
                <p className="text-slate-400 text-[10px] mt-0.5">Alias: <span className="font-mono text-blue-200">{BRAND_SENDERS.pingconGroup.aliasEmail}</span></p>
                <p className="text-slate-500 text-[10px] mt-0.5">{BRAND_SENDERS.pingconGroup.fromName}</p>
              </div>
            </div>
          </div>

          {/* ── Automated Email Sending Engine (Google Apps Script / Webhook) ─── */}
          <div className="bg-slate-950/80 rounded-2xl p-4 border border-indigo-500/30 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <h4 className="font-bold text-white text-sm">Automated Sending Webhook (Google Apps Script)</h4>
              </div>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                webhookUrl ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}>
                {webhookUrl ? 'Webhook Configured' : 'No Webhook (Gmail Compose Mode)'}
              </span>
            </div>

            <p className="text-slate-400 text-[11px] leading-relaxed">
              Connect a Google Apps Script deployed under <code className="text-indigo-300">{MASTER_SENDER_EMAIL}</code> to send emails automatically. Sent emails will show up directly in your <strong>Gmail &quot;Sent Mail&quot;</strong> folder!
            </p>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">
                Google Apps Script Web App URL:
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={handleTestWebhookLive}
                  disabled={testingWebhook || !webhookUrl}
                  className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold text-xs transition-colors shrink-0 flex items-center gap-1.5"
                >
                  <Send className={`w-3.5 h-3.5 ${testingWebhook ? 'animate-spin' : ''}`} />
                  <span>{testingWebhook ? 'Sending Test...' : 'Test Send'}</span>
                </button>
              </div>
            </div>

            {webhookTestResult && (
              <div className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                webhookTestResult.success
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}>
                {webhookTestResult.success ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                )}
                <div>
                  <p className="font-bold">{webhookTestResult.success ? 'Test Email Sent Successfully!' : 'Webhook Send Failed'}</p>
                  <p className="text-[11px] opacity-90 mt-0.5">{webhookTestResult.message || webhookTestResult.status}</p>
                  {webhookTestResult.success && (
                    <p className="text-[10px] text-emerald-400 mt-1 font-mono">
                      Check your Gmail &quot;Sent Mail&quot; tab now to verify!
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Expandable Setup Instructions */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowScriptGuide(!showScriptGuide)}
                className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
              >
                <Code2 className="w-3.5 h-3.5" />
                <span>{showScriptGuide ? 'Hide Setup Instructions' : 'How to set up Google Apps Script in 2 minutes (Click to expand)'}</span>
                {showScriptGuide ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {showScriptGuide && (
                <div className="mt-3 p-4 bg-slate-900/90 rounded-2xl border border-slate-700/80 space-y-3 animate-fade-in">
                  <ol className="list-decimal list-inside space-y-2 text-slate-300 text-[11px] leading-relaxed">
                    <li>
                      Log in to your <strong>{MASTER_SENDER_EMAIL}</strong> Google account and open{' '}
                      <a href="https://script.google.com/home/start" target="_blank" rel="noreferrer" className="text-indigo-400 underline font-semibold">
                        script.google.com
                      </a>.
                    </li>
                    <li>Click <strong>&quot;New project&quot;</strong> and name it <em>&quot;RMA Email Dispatcher&quot;</em>.</li>
                    <li>
                      Replace all code in <code>Code.gs</code> with the snippet below:
                      <div className="relative mt-2">
                        <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[10px] text-emerald-300 overflow-x-auto whitespace-pre">
                          {gasScriptCode}
                        </pre>
                        <button
                          type="button"
                          onClick={copyScript}
                          className="absolute top-2 right-2 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[10px] font-semibold flex items-center gap-1 shadow-sm"
                        >
                          {copiedCode ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedCode ? 'Copied!' : 'Copy Code'}</span>
                        </button>
                      </div>
                    </li>
                    <li>
                      Click <strong>Deploy &rarr; New deployment</strong>.
                    </li>
                    <li>
                      Select type: <strong>Web app</strong> (gear icon).
                    </li>
                    <li>
                      Set <strong>Execute as:</strong> <em>Me ({MASTER_SENDER_EMAIL})</em>.
                    </li>
                    <li>
                      Set <strong>Who has access:</strong> <em>Anyone</em>.
                    </li>
                    <li>
                      Click <strong>Deploy</strong>, authorize the permissions, and copy the <strong>Web app URL</strong>.
                    </li>
                    <li>Paste the URL into the input field above and click <strong>Test Send</strong>!</li>
                  </ol>
                </div>
              )}
            </div>
          </div>

          {/* ── Group 1: A2Z2GO / KEYSYS ─────────────────────────── */}
          <div className="bg-slate-950/70 rounded-2xl p-4 border border-purple-500/30 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-400"></span>
                <h4 className="font-bold text-white text-sm">Group 1: A2Z2GO &amp; KEYSYS Products</h4>
              </div>
              <span className="text-[10px] font-mono text-purple-300 bg-purple-950/80 px-2 py-0.5 rounded border border-purple-500/30">
                Logistics &amp; IT Brands
              </span>
            </div>
            <div>
              <label className="block text-slate-400 mb-1 font-semibold">Primary Recipient (To:)</label>
              <input
                type="email"
                value={config.a2zGroup?.mainRecipient || ''}
                onChange={(e) => setConfig({ ...config, a2zGroup: { ...config.a2zGroup, mainRecipient: e.target.value } })}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1 font-semibold">
                CC Recipients <span className="text-slate-500">(one per line — Assigned AE auto-appended)</span>
              </label>
              <textarea
                rows={4}
                value={a2zCcText}
                onChange={(e) => setA2zCcText(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white font-mono text-xs focus:outline-none focus:border-indigo-500 resize-none leading-relaxed"
              />
            </div>
          </div>

          {/* ── Group 2: PINGCON / BONITA ─────────────────────────── */}
          <div className="bg-slate-950/70 rounded-2xl p-4 border border-blue-500/30 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-400"></span>
                <h4 className="font-bold text-white text-sm">Group 2: PINGCON &amp; BONITA TISSUE Products</h4>
              </div>
              <span className="text-[10px] font-mono text-blue-300 bg-blue-950/80 px-2 py-0.5 rounded border border-blue-500/30">
                Electronics &amp; Paper Brands
              </span>
            </div>
            <div>
              <label className="block text-slate-400 mb-1 font-semibold">Primary Recipient (To:)</label>
              <input
                type="email"
                value={config.pingconGroup?.mainRecipient || ''}
                onChange={(e) => setConfig({ ...config, pingconGroup: { ...config.pingconGroup, mainRecipient: e.target.value } })}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1 font-semibold">
                CC Recipients <span className="text-slate-500">(one per line — Assigned AE auto-appended)</span>
              </label>
              <textarea
                rows={4}
                value={pingconCcText}
                onChange={(e) => setPingconCcText(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white font-mono text-xs focus:outline-none focus:border-indigo-500 resize-none leading-relaxed"
              />
            </div>
          </div>

          {/* ── AE Roster Reference ───────────────────────────────── */}
          <div className="bg-slate-950/70 rounded-2xl p-4 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-300 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-indigo-400" /> Account Executive (AE) Roster
              </span>
              <span className="text-[10px] text-slate-500">{ACCOUNT_EXECUTIVES.length} Registered AEs</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
              {ACCOUNT_EXECUTIVES.map(ae => (
                <div key={ae.id} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-[11px]">
                  <p className="font-bold text-slate-200 truncate">{ae.name}</p>
                  <p className="text-[10px] text-slate-500 font-mono truncate">{ae.pingconEmail}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Test Payload Simulator ────────────────────────────── */}
          <div className="pt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={handleGenerateTest}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
            >
              <Send className="w-3.5 h-3.5 text-indigo-400" />
              <span>Preview Live Dispatch Payload</span>
              {sandboxEnabled && (
                <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold border border-amber-500/30">SANDBOX</span>
              )}
            </button>
            <button
              type="button"
              onClick={handleResetDefaults}
              className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-400 text-xs"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Defaults</span>
            </button>
          </div>

          {testPayload && (
            <div className={`p-3 rounded-2xl border space-y-2 ${testPayload.isSandbox ? 'bg-amber-950/30 border-amber-500/40' : 'bg-slate-950 border-indigo-500/40'}`}>
              {testPayload.isSandbox && (
                <div className="flex items-center gap-2 text-amber-300 text-[11px] font-bold mb-1">
                  <FlaskConical className="w-3.5 h-3.5" />
                  SANDBOX MODE ACTIVE — Emails routed to .test sink
                </div>
              )}
              <span className="font-bold text-indigo-300 block text-[11px]">Previewed Notification Payload:</span>
              <div className="font-mono text-[11px] space-y-1 text-slate-300">
                <p><strong>From:</strong> {testPayload.fromName} &lt;{testPayload.from}&gt;</p>
                <p><strong>To:</strong> {testPayload.mainRecipient}</p>
                <p><strong>CC:</strong> {testPayload.ccList.join(', ')}</p>
                <p><strong>Subject:</strong> {testPayload.subject}</p>
              </div>
              <a
                href={testPayload.mailtoUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 mt-2 text-indigo-400 hover:text-indigo-300 text-xs font-semibold underline"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Test Launch Email Client</span>
              </a>
            </div>
          )}

          {/* Footer */}
          <div className="pt-3 border-t border-slate-800 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 font-semibold text-sm"
            >
              Close
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-md shadow-indigo-600/30 text-sm"
            >
              <Save className="w-4 h-4" />
              <span>Save Dispatch Rules</span>
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
