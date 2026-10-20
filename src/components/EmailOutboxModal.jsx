import React, { useState, useEffect } from 'react';
import {
  X,
  Mail,
  Send,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  FlaskConical,
  Clock,
  Trash2,
  RefreshCw,
  Copy,
  Check,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import {
  getDispatchLogs,
  clearDispatchLogs,
  getWebhookUrl,
  MASTER_SENDER_EMAIL
} from '../lib/emailRouting';

export default function EmailOutboxModal({ isOpen, onClose, onOpenSettings }) {
  if (!isOpen) return null;

  const [logs, setLogs] = useState([]);
  const [selectedLog, setSelectedLog] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [webhookConfigured, setWebhookConfigured] = useState(false);

  const reloadLogs = () => {
    setLogs(getDispatchLogs());
    setWebhookConfigured(Boolean(getWebhookUrl()));
  };

  useEffect(() => {
    reloadLogs();
  }, [isOpen]);

  const handleClear = () => {
    if (confirm('Clear the local email dispatch history?')) {
      clearDispatchLogs();
      setLogs([]);
      setSelectedLog(null);
    }
  };

  const copyText = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/90 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-base">Email Dispatch Outbox &amp; Audit Trail</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                  {logs.length} logged
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Sender Account: <code className="text-indigo-300 font-mono">{MASTER_SENDER_EMAIL}</code>
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={reloadLogs}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800"
              title="Refresh outbox logs"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            {logs.length > 0 && (
              <button
                type="button"
                onClick={handleClear}
                className="p-2 rounded-xl text-rose-400 hover:text-rose-300 hover:bg-rose-950/40"
                title="Clear outbox history"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Webhook Status Bar */}
        <div className="px-6 py-2.5 bg-slate-950/50 border-b border-slate-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${webhookConfigured ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
            <span className="text-slate-300">
              {webhookConfigured ? (
                <>Automated Webhook Active &mdash; Direct delivery enabled via Google Apps Script</>
              ) : (
                <>Manual Gmail Mode &mdash; Click &quot;Send with Gmail&quot; below to launch pre-filled draft</>
              )}
            </span>
          </div>
          {onOpenSettings && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenSettings();
              }}
              className="text-indigo-400 hover:text-indigo-300 underline font-semibold text-[11px]"
            >
              Configure Webhook &amp; Routing &rarr;
            </button>
          )}
        </div>

        {/* Outbox Content */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {logs.length === 0 ? (
            <div className="text-center py-12 px-4 bg-slate-950/40 rounded-2xl border border-slate-800">
              <Mail className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="font-bold text-slate-300 text-sm">No Email Dispatch Records Found</p>
              <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                Whenever a return ticket is submitted on the Customer Portal, the generated email payload and delivery confirmation will appear here.
              </p>
            </div>
          ) : (
            logs.map((log) => {
              const isSelected = selectedLog?.id === log.id;
              const isDelivered = log.status?.includes('Delivered');
              const isSandbox = log.isSandbox || log.status?.includes('Sandbox');

              return (
                <div
                  key={log.id}
                  className={`rounded-2xl border transition-all ${
                    isSelected
                      ? 'bg-slate-950 border-indigo-500/70 shadow-lg'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {/* Header Row */}
                  <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-indigo-400 text-xs">
                          {log.rma_id || 'RMA'}
                        </span>
                        
                        {/* Status Badge */}
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            isDelivered
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                              : isSandbox
                              ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                              : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'
                          }`}
                        >
                          {log.status || 'Ready to Send'}
                        </span>

                        <span className="text-[11px] text-slate-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(log.timestamp).toLocaleString()}
                        </span>
                      </div>

                      <p className="font-semibold text-slate-200 text-xs truncate max-w-xl">
                        {log.subject}
                      </p>

                      <div className="text-[11px] text-slate-400 flex flex-wrap gap-x-3 gap-y-0.5">
                        <span><strong>To:</strong> <code className="text-slate-300 font-mono">{log.recipients?.to}</code></span>
                        <span><strong>AE:</strong> <span className="text-slate-300">{log.ae}</span></span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 shrink-0">
                      {log.gmailUrl && (
                        <a
                          href={log.gmailUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-red-600/20 hover:bg-red-600/30 border border-red-500/40 text-red-300 hover:text-white font-semibold text-xs transition-all shadow-sm"
                          title="Open pre-filled draft in Gmail web app"
                        >
                          <Send className="w-3 h-3 text-red-400" />
                          <span>Send with Gmail</span>
                          <ExternalLink className="w-3 h-3 opacity-60" />
                        </a>
                      )}

                      <button
                        type="button"
                        onClick={() => setSelectedLog(isSelected ? null : log)}
                        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors"
                      >
                        {isSelected ? 'Hide Text' : 'View Text'}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Body Preview */}
                  {isSelected && (
                    <div className="px-4 pb-4 pt-1 border-t border-slate-800/80 bg-slate-900/60 rounded-b-2xl animate-fade-in">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold text-slate-400">
                          Raw Notification Text Payload:
                        </span>
                        <button
                          type="button"
                          onClick={() => copyText(log.body, log.id)}
                          className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300"
                        >
                          {copiedId === log.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedId === log.id ? 'Copied' : 'Copy Text'}</span>
                        </button>
                      </div>

                      <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                        {log.body}
                      </pre>

                      {log.recipients?.cc?.length > 0 && (
                        <div className="mt-2 text-[11px] text-slate-400 font-mono">
                          <strong>CC List:</strong> {log.recipients.cc.join(', ')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between text-xs text-slate-400 shrink-0">
          <span>Emails sent from <strong className="text-white">{MASTER_SENDER_EMAIL}</strong> will arrive in your Gmail Sent folder.</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs"
          >
            Close Outbox
          </button>
        </div>
      </div>
    </div>
  );
}
