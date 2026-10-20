import React, { useState, useEffect } from 'react';
import { 
  X, 
  Mail, 
  Save, 
  RotateCcw, 
  Send, 
  CheckCircle2, 
  Users, 
  Building2, 
  AlertCircle,
  Copy,
  ExternalLink
} from 'lucide-react';
import { 
  ACCOUNT_EXECUTIVES, 
  DEFAULT_EMAIL_ROUTING, 
  getEmailRoutingConfig, 
  saveEmailRoutingConfig,
  buildDispatchEmailPayload
} from '../lib/emailRouting';

export default function EmailDispatchSettingsModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  const [config, setConfig] = useState(DEFAULT_EMAIL_ROUTING);
  const [a2zCcText, setA2zCcText] = useState('');
  const [pingconCcText, setPingconCcText] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [testPayload, setTestPayload] = useState(null);

  useEffect(() => {
    const loaded = getEmailRoutingConfig();
    setConfig(loaded);
    setA2zCcText((loaded.a2zGroup?.ccRecipients || []).join('\n'));
    setPingconCcText((loaded.pingconGroup?.ccRecipients || []).join('\n'));
  }, [isOpen]);

  const handleSave = (e) => {
    e.preventDefault();
    const cleanA2zCc = a2zCcText
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0 && s.includes('@'));

    const cleanPingconCc = pingconCcText
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0 && s.includes('@'));

    const newConfig = {
      a2zGroup: {
        mainRecipient: config.a2zGroup.mainRecipient.trim(),
        ccRecipients: cleanA2zCc
      },
      pingconGroup: {
        mainRecipient: config.pingconGroup.mainRecipient.trim(),
        ccRecipients: cleanPingconCc
      }
    };

    saveEmailRoutingConfig(newConfig);
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
      rma_id: 'RMA-2026-TEST-ROUT',
      company: 'A2Z2GO',
      customer_name: 'Metro Commercial Supplies Co.',
      delivery_reference: 'DR-88990',
      product_name: 'A2Z Industrial Heavy-Duty Stretch Film 500m',
      sku: 'A2Z-STR-500M',
      packaging_unit: 'CS',
      defect_category: 'Damaged on Arrival (DOA)',
      defect_description: 'Outer carton crushed during delivery.',
      photo_url: 'https://images.unsplash.com/photo-1584556812952-905ffd0c611a',
      assigned_ae: 'Rodrigo Galvez'
    };
    const payload = buildDispatchEmailPayload(mockTicket);
    setTestPayload(payload);
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
              <h3 className="font-bold text-white text-base">
                Smart AE & Email Dispatch Settings
              </h3>
              <p className="text-xs text-slate-400">
                Automated recipient routing triggered upon return ticket submission.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-6 text-xs flex-1">
          
          {saveSuccess && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Email dispatch routing settings updated and saved successfully!</span>
            </div>
          )}

          {/* Group 1: A2Z2GO / KEYSYS Products */}
          <div className="bg-slate-950/70 rounded-2xl p-4 border border-purple-500/30 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-400"></span>
                <h4 className="font-bold text-white text-sm">
                  Group 1: A2Z2GO & KEYSYS Products
                </h4>
              </div>
              <span className="text-[10px] font-mono text-purple-300 bg-purple-950/80 px-2 py-0.5 rounded border border-purple-500/30">
                Logistics & IT Brands
              </span>
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">Primary Recipient</label>
              <input
                type="email"
                value={config.a2zGroup?.mainRecipient || ''}
                onChange={(e) => setConfig({
                  ...config,
                  a2zGroup: { ...config.a2zGroup, mainRecipient: e.target.value }
                })}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">
                CC Recipients (One per line — Assigned AE will automatically be appended)
              </label>
              <textarea
                rows={4}
                value={a2zCcText}
                onChange={(e) => setA2zCcText(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white font-mono text-xs focus:outline-none focus:border-indigo-500 resize-none leading-relaxed"
              />
            </div>
          </div>

          {/* Group 2: PINGCON / BONITA TISSUE Products */}
          <div className="bg-slate-950/70 rounded-2xl p-4 border border-blue-500/30 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-400"></span>
                <h4 className="font-bold text-white text-sm">
                  Group 2: PINGCON & BONITA TISSUE Products
                </h4>
              </div>
              <span className="text-[10px] font-mono text-blue-300 bg-blue-950/80 px-2 py-0.5 rounded border border-blue-500/30">
                Electronics & Paper Brands
              </span>
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">Primary Recipient</label>
              <input
                type="email"
                value={config.pingconGroup?.mainRecipient || ''}
                onChange={(e) => setConfig({
                  ...config,
                  pingconGroup: { ...config.pingconGroup, mainRecipient: e.target.value }
                })}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">
                CC Recipients (One per line — Assigned AE will automatically be appended)
              </label>
              <textarea
                rows={4}
                value={pingconCcText}
                onChange={(e) => setPingconCcText(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white font-mono text-xs focus:outline-none focus:border-indigo-500 resize-none leading-relaxed"
              />
            </div>
          </div>

          {/* AE Roster Reference */}
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

          {/* Test Payload Simulator */}
          <div className="pt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={handleGenerateTest}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
            >
              <Send className="w-3.5 h-3.5 text-indigo-400" />
              <span>Preview Live Dispatch Payload</span>
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
            <div className="p-3 bg-slate-950 rounded-2xl border border-indigo-500/40 space-y-2">
              <span className="font-bold text-indigo-300 block">Previewed Notification Payload:</span>
              <div className="font-mono text-[11px] space-y-1 text-slate-300">
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

          {/* Footer Save Button */}
          <div className="pt-3 border-t border-slate-800 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 font-semibold"
            >
              Close
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-md shadow-indigo-600/30"
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
