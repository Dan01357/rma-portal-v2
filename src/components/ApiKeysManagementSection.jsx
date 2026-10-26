import React, { useState, useEffect } from 'react';
import { 
  Key, 
  ShieldCheck, 
  Copy, 
  Check, 
  RefreshCw, 
  AlertTriangle, 
  Trash2, 
  ExternalLink, 
  Plus, 
  Clock, 
  CheckCircle2, 
  Lock,
  Layers
} from 'lucide-react';
import { supabase } from '../supabaseClient';

const TARGET_SYSTEMS = [
  { id: 'primary', name: 'Primary System (Mine)', role: 'Internal Central System', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  { id: 'jarmen', name: 'Jarmen', role: 'Partner Wholesale System', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  { id: 'jelo', name: 'Jelo', role: 'Partner Operations System', badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
  { id: 'arlito', name: 'Arlito', role: 'Partner Inventory System', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' }
];

export default function ApiKeysManagementSection() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [feedback, setFeedback] = useState(null);

  // New Key Generation / Reveal State
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [selectedSystem, setSelectedSystem] = useState(TARGET_SYSTEMS[0].name);
  const [rateLimit, setRateLimit] = useState(60);
  
  // One-time revealed key
  const [revealedKey, setRevealedKey] = useState(null);
  const [hasCopied, setHasCopied] = useState(false);

  // Load existing API keys
  const loadKeys = async () => {
    setLoading(true);
    try {
      // Fetch via Supabase table public.api_keys
      const { data, error } = await supabase
        .from('api_keys')
        .select('id, name, masked_key, is_active, rate_limit, expires_at, last_used_at, created_at')
        .order('created_at', { ascending: false });

      if (error) {
        // Table might not exist yet if user hasn't run the SQL migration
        if (error.code === '42P01') {
          setFeedback({
            type: 'warning',
            message: 'Database table "api_keys" not found. Please run the SQL migration script in your Supabase SQL Editor.'
          });
          setKeys([]);
          return;
        }
        throw error;
      }

      setKeys(data || []);
      setFeedback(null);
    } catch (err) {
      console.error('Error fetching API keys:', err);
      setFeedback({ type: 'error', message: err.message || 'Failed to load API keys' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, []);

  // Generate a key via the API endpoint
  const handleGenerateKey = async () => {
    setActionLoading('generate');
    try {
      const res = await fetch('/api/v1/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: selectedSystem,
          rateLimit: parseInt(rateLimit, 10) || 60
        })
      });

      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch (e) {}

      if (!res.ok || !json?.success) {
        throw new Error(json?.message || `Failed to generate key (Status ${res.status}): ${text.slice(0, 100)}`);
      }

      // Store revealed key to show user once
      setRevealedKey({
        rawKey: json.apiKey,
        name: selectedSystem,
        maskedKey: json.keyRecord?.masked_key
      });
      setShowGenerateModal(false);
      setHasCopied(false);
      await loadKeys();
    } catch (err) {
      console.error('Error generating key:', err);
      alert('Failed to generate key: ' + err.message);
    } finally {
      setActionLoading(null);
    }
  };

  // Rotate a key
  const handleRotateKey = async (keyItem) => {
    const confirmRotate = window.confirm(
      `Are you sure you want to rotate the API key for "${keyItem.name}"?\n\nThe current key (${keyItem.masked_key}) will be immediately revoked and a new secret key will be generated.`
    );
    if (!confirmRotate) return;

    setActionLoading(`rotate-${keyItem.id}`);
    try {
      // Use query parameter which routes cleanly to both index.js and [id].js
      const res = await fetch(`/api/v1/api-keys?id=${encodeURIComponent(keyItem.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: keyItem.id })
      });
      
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch (e) {}

      if (!res.ok || !json?.success) {
        throw new Error(json?.message || `Failed to rotate key (Status ${res.status}): ${text.slice(0, 100)}`);
      }

      setRevealedKey({
        rawKey: json.apiKey,
        name: keyItem.name,
        maskedKey: json.keyRecord?.masked_key,
        isRotated: true
      });
      setHasCopied(false);
      await loadKeys();
    } catch (err) {
      console.error('Rotate key error:', err);
      alert('Failed to rotate key: ' + err.message);
    } finally {
      setActionLoading(null);
    }
  };

  // Revoke / Delete a key
  const handleRevokeKey = async (keyItem) => {
    const confirmRevoke = window.confirm(
      `Are you sure you want to permanently revoke and delete the API key for "${keyItem.name}"? Any system currently using this key will immediately receive 401 Unauthorized.`
    );
    if (!confirmRevoke) return;

    setActionLoading(`revoke-${keyItem.id}`);
    try {
      const res = await fetch(`/api/v1/api-keys?id=${encodeURIComponent(keyItem.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: keyItem.id })
      });

      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch (e) {}

      if (!res.ok || (json && !json.success)) {
        // Direct Supabase fallback in case of serverless routing error
        const { error: dbErr } = await supabase
          .from('api_keys')
          .delete()
          .eq('id', keyItem.id);

        if (dbErr) {
          throw new Error(json?.message || dbErr.message || `Status ${res.status}`);
        }
      }

      await loadKeys();
      setFeedback({ type: 'success', message: `API Key for ${keyItem.name} revoked successfully.` });
      setTimeout(() => setFeedback(null), 4000);
    } catch (err) {
      console.error('Revoke key error:', err);
      alert('Failed to revoke key: ' + err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCopySecret = () => {
    if (!revealedKey?.rawKey) return;
    navigator.clipboard.writeText(revealedKey.rawKey);
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 3000);
  };

  return (
    <div className="p-4 sm:p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                Multi-System REST API Keys & Integration
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  SHA-256 Hashed
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Manage secure API keys for <strong>Primary System</strong>, <strong>Jarmen</strong>, <strong>Jelo</strong>, and <strong>Arlito</strong>.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Interactive Docs (/docs)</span>
          </a>

          <button
            type="button"
            onClick={() => setShowGenerateModal(true)}
            className="px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm shadow-purple-600/20 transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Generate New Key</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 ${
          feedback.type === 'warning' ? 'bg-amber-50 border border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300' :
          feedback.type === 'error' ? 'bg-rose-50 border border-rose-200 text-rose-900 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300' :
          'bg-emerald-50 border border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300'
        }`}>
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{feedback.message}</span>
        </div>
      )}

      {/* 4 Client Systems Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {TARGET_SYSTEMS.map((sys) => {
          const matchingKeys = keys.filter(k => k.name.toLowerCase().includes(sys.id) || k.name.toLowerCase().includes(sys.name.toLowerCase().split(' ')[0]));
          const activeKey = matchingKeys.find(k => k.is_active);

          return (
            <div
              key={sys.id}
              className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${sys.badge}`}>
                  {sys.name}
                </span>
                {activeKey ? (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" /> Active
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-slate-400">
                    No Active Key
                  </span>
                )}
              </div>

              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                {sys.role}
              </div>

              {activeKey ? (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200">
                    {activeKey.masked_key}
                  </div>
                  <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3" />
                    Last used: {activeKey.last_used_at ? new Date(activeKey.last_used_at).toLocaleDateString() : 'Never'}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSystem(sys.name);
                    setShowGenerateModal(true);
                  }}
                  className="w-full mt-2 py-1.5 px-2 text-[11px] font-bold text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/40 rounded-lg transition-colors border border-dashed border-purple-300 dark:border-purple-800 cursor-pointer"
                >
                  + Issue Key for {sys.name.split(' ')[0]}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Active Keys Table */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-extrabold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
            All Registered API Keys ({keys.length})
          </h4>
          <button
            type="button"
            onClick={loadKeys}
            disabled={loading}
            className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white flex items-center gap-1"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {keys.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-400">
            No API keys issued yet. Click <strong>Generate New Key</strong> above to issue a key for Primary System, Jarmen, Jelo, or Arlito.
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-3">Client System</th>
                  <th className="p-3">Masked Key</th>
                  <th className="p-3">Rate Limit</th>
                  <th className="p-3">Last Used</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {keys.map((k) => (
                  <tr key={k.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="p-3 font-bold text-slate-900 dark:text-white">
                      {k.name}
                    </td>
                    <td className="p-3 font-mono text-slate-700 dark:text-slate-300">
                      {k.masked_key}
                    </td>
                    <td className="p-3 text-slate-600 dark:text-slate-400">
                      {k.rate_limit || 60} req/min
                    </td>
                    <td className="p-3 text-slate-500 dark:text-slate-400">
                      {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'Never'}
                    </td>
                    <td className="p-3">
                      {k.is_active ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          Active
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                          Revoked
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleRotateKey(k)}
                          disabled={actionLoading === `rotate-${k.id}`}
                          title="Rotate API Key (Invalidate current and create new)"
                          className="p-1.5 text-slate-500 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/40 rounded-lg transition-colors cursor-pointer"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${actionLoading === `rotate-${k.id}` ? 'animate-spin' : ''}`} />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleRevokeKey(k)}
                          disabled={actionLoading === `revoke-${k.id}`}
                          title="Revoke and Delete API Key"
                          className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL 1: Generate Key Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-purple-600" />
                Issue New API Key
              </h3>
              <button
                type="button"
                onClick={() => setShowGenerateModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Target Client System
                </label>
                <select
                  value={selectedSystem}
                  onChange={(e) => setSelectedSystem(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-purple-600"
                >
                  {TARGET_SYSTEMS.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name} ({s.role})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Rate Limit (Requests per minute)
                </label>
                <input
                  type="number"
                  min="10"
                  max="300"
                  value={rateLimit}
                  onChange={(e) => setRateLimit(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-purple-600"
                />
              </div>

              <div className="p-3 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900 rounded-xl text-[11px] text-purple-900 dark:text-purple-300">
                <p className="font-bold flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Security Notice
                </p>
                <p className="mt-1">
                  The secret API key will be hashed using SHA-256 before being stored in the database. You will only be shown the raw key <strong>once</strong>.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowGenerateModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerateKey}
                disabled={actionLoading === 'generate'}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shadow-sm shadow-purple-600/20 transition-all cursor-pointer disabled:opacity-50"
              >
                {actionLoading === 'generate' ? 'Generating...' : 'Generate Key'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: One-Time Key Reveal Modal */}
      {revealedKey && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-emerald-500/30 rounded-2xl p-5 max-w-lg w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                  {revealedKey.isRotated ? 'API Key Rotated Successfully' : 'API Key Generated Successfully'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Client: <strong>{revealedKey.name}</strong>
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl space-y-1">
              <div className="text-xs font-extrabold text-rose-800 dark:text-rose-300 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                Copy this secret key now. It cannot be shown again!
              </div>
              <p className="text-[11px] text-rose-700 dark:text-rose-400">
                For security reasons, only the SHA-256 hash is kept in the database. If you lose this key, you will need to rotate or generate a replacement.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Raw Secret Key
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 p-2.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl font-mono text-xs font-bold text-slate-900 dark:text-emerald-400 select-all break-all">
                  {revealedKey.rawKey}
                </div>
                <button
                  type="button"
                  onClick={handleCopySecret}
                  className={`px-4 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-all cursor-pointer ${
                    hasCopied
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100'
                  }`}
                >
                  {hasCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{hasCopied ? 'Copied!' : 'Copy'}</span>
                </button>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <span className="text-[11px] text-slate-400">
                Masked representation: <code className="font-mono">{revealedKey.maskedKey}</code>
              </span>
              <button
                type="button"
                onClick={() => setRevealedKey(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                I have saved this key safely
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
