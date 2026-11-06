import React, { useState, useEffect } from 'react';
import { 
  X, 
  Mail, 
  Send, 
  Copy, 
  Check, 
  Clock, 
  Building2, 
  Trash2, 
  ShieldCheck, 
  AlertCircle, 
  RefreshCw, 
  ExternalLink,
  Plus,
  Ticket
} from 'lucide-react';
import { inviteService } from '../services/inviteService';
import { formatMilitaryDateTime } from '../utils/exportCsv';

export default function CustomerRMAInvitesModal({ isOpen, onClose, currentUser }) {
  const [invites, setInvites] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [authorizedEmail, setAuthorizedEmail] = useState('');
  const [storeBranch, setStoreBranch] = useState('');
  const [durationHours, setDurationHours] = useState('24');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedInvite, setGeneratedInvite] = useState(null);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [copiedToken, setCopiedToken] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    if (isOpen) {
      loadInvites();
      setGeneratedInvite(null);
      setErrorMessage(null);
    }
  }, [isOpen]);

  const loadInvites = async () => {
    setIsLoading(true);
    try {
      const data = await inviteService.getInvites();
      setInvites(data || []);
    } catch (err) {
      console.warn('Error loading invites:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!authorizedEmail.trim()) {
      setErrorMessage('Please enter the customer / reporter email.');
      return;
    }

    setIsGenerating(true);
    setErrorMessage(null);
    try {
      const createdBy = currentUser?.name || 'Pingcon Staff';
      const newInv = await inviteService.createInvite({
        authorizedEmail: authorizedEmail.trim(),
        storeBranch: storeBranch.trim(),
        durationHours: Number(durationHours),
        createdBy
      });
      setGeneratedInvite(newInv);
      setAuthorizedEmail('');
      setStoreBranch('');
      showToast('Customer RMA Invite generated successfully!');
      loadInvites();
    } catch (err) {
      setErrorMessage(err.message || 'Failed to generate invite.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyLink = (token) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://rma-portal-pingconmarketing.vercel.app';
    const link = `${origin}/intake?token=${encodeURIComponent(token)}`;
    navigator.clipboard.writeText(link);
    setCopiedToken(token);
    showToast('Link copied to clipboard!');
    setTimeout(() => setCopiedToken(null), 2500);
  };

  const handleSendEmail = async (inv) => {
    setIsSendingEmail(true);
    try {
      await inviteService.sendInviteEmail(inv);
      showToast(`Invite emailed to ${inv.authorized_email}!`);
    } catch (err) {
      alert(`Could not send email: ${err.message}`);
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleRevoke = async (token) => {
    if (!window.confirm('Are you sure you want to revoke this customer return link? Access will be blocked immediately.')) {
      return;
    }
    try {
      await inviteService.revokeInvite(token);
      showToast('Invite link revoked.');
      loadInvites();
      if (generatedInvite?.token === token) {
        setGeneratedInvite(null);
      }
    } catch (err) {
      alert(`Failed to revoke invite: ${err.message}`);
    }
  };

  const formatCountdown = (expiresAt, status) => {
    if (status === 'revoked') return { text: 'Revoked', isExpired: true, isRevoked: true };
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return { text: 'Expired', isExpired: true, isRevoked: false };
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return { text: `${days}d ${hours % 24}h remaining`, isExpired: false };
    }
    return { text: `${hours}h ${mins}m remaining`, isExpired: false };
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 rounded-2xl shadow-inner">
              <Ticket className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  Customer RMA Invites
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300">
                  Google Identity Lock
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Generate private 1-click return links tied strictly to authorized customer Google accounts.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scroll Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">

          {/* Toast Notification */}
          {toastMessage && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded-2xl text-xs font-bold flex items-center gap-2 animate-in fade-in">
              <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{toastMessage}</span>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 rounded-2xl text-xs font-bold flex items-center gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Invite Generator Form Card */}
          <form onSubmit={handleGenerate} className="p-4 sm:p-5 bg-slate-50/80 dark:bg-slate-800/40 border-2 border-slate-200 dark:border-slate-800 rounded-3xl space-y-4 shadow-xs">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <Plus className="w-4 h-4 text-blue-600" />
                <span>Create New Customer Return Invite</span>
              </span>
              <span className="text-[10px] text-slate-500 font-bold">
                Anti-Hacker: Forwarding to unauthorized accounts is strictly blocked
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Customer Email */}
              <div className="sm:col-span-1 space-y-1">
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Customer Google Email *
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    required
                    value={authorizedEmail}
                    onChange={(e) => setAuthorizedEmail(e.target.value)}
                    placeholder="e.g. store.taguig@gmail.com"
                    className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              {/* Store / Branch Name */}
              <div className="sm:col-span-1 space-y-1">
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Store / Branch Name (Optional)
                </label>
                <div className="relative">
                  <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={storeBranch}
                    onChange={(e) => setStoreBranch(e.target.value)}
                    placeholder="e.g. Savemore Market Taguig"
                    className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              {/* Expiry Duration Dropdown */}
              <div className="sm:col-span-1 space-y-1">
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Link Expiry Duration *
                </label>
                <div className="relative">
                  <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                  <select
                    value={durationHours}
                    onChange={(e) => setDurationHours(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 cursor-pointer"
                  >
                    <option value="2">2 Hours (Quick Session)</option>
                    <option value="12">12 Hours (Same-Day Delivery)</option>
                    <option value="24">24 Hours (1 Day Default)</option>
                    <option value="48">2 Days (48 Hours)</option>
                    <option value="168">7 Days (1 Week)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={isGenerating || !authorizedEmail.trim()}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-blue-600/20 transition-all cursor-pointer"
              >
                {isGenerating ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Generating Invite...</span>
                  </>
                ) : (
                  <>
                    <Ticket className="w-3.5 h-3.5" />
                    <span>Generate Customer Invite</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Generated Invite Link Banner */}
          {generatedInvite && (
            <div className="p-4 sm:p-5 bg-emerald-50 dark:bg-emerald-950/40 border-2 border-emerald-300 dark:border-emerald-800 rounded-3xl space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-emerald-950 dark:text-emerald-200">
                    Ready: Personalized Return Link Generated!
                  </h3>
                </div>
                <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-200/60 dark:bg-emerald-900/60 px-2.5 py-0.5 rounded-full">
                  Expires: {new Date(generatedInvite.expires_at).toLocaleString()}
                </span>
              </div>

              <div className="p-3 bg-white dark:bg-slate-900 rounded-2xl border border-emerald-200 dark:border-emerald-800 font-mono text-xs text-slate-800 dark:text-slate-200 break-all select-all flex items-center justify-between gap-2">
                <span>{typeof window !== 'undefined' ? `${window.location.origin}/intake?token=${generatedInvite.token}` : generatedInvite.token}</span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleCopyLink(generatedInvite.token)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  {copiedToken === generatedInvite.token ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Copy Link</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleSendEmail(generatedInvite)}
                  disabled={isSendingEmail}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  {isSendingEmail ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Sending Email...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Send Invite Email</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Active / Past Invites Management Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Authorized Customer Invites ({invites.length})
              </h3>
              <button
                type="button"
                onClick={loadInvites}
                className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {invites.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs text-slate-400 font-semibold">
                No customer RMA invites generated yet. Use the form above to generate your first secure return link.
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-2xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-bold uppercase text-[10px]">
                    <tr>
                      <th className="p-3">Customer Email</th>
                      <th className="p-3">Store / Branch</th>
                      <th className="p-3">Created</th>
                      <th className="p-3">Expires / Remaining</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {invites.map((inv) => {
                      const countdown = formatCountdown(inv.expires_at, inv.status);
                      const isRevoked = inv.status === 'revoked';
                      const isExpired = countdown.isExpired;

                      return (
                        <tr key={inv.token || inv.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="p-3 font-mono font-bold text-slate-900 dark:text-white">
                            {inv.authorized_email}
                          </td>
                          <td className="p-3 text-slate-700 dark:text-slate-300 font-semibold">
                            {inv.store_branch || <span className="text-slate-400 italic">Unassigned</span>}
                          </td>
                          <td className="p-3 text-slate-500 font-mono text-[11px]">
                            {formatMilitaryDateTime(inv.created_at)}
                          </td>
                          <td className="p-3 font-mono text-[11px]">
                            <span className={isExpired ? 'text-slate-400' : 'text-blue-600 dark:text-blue-400 font-bold'}>
                              {countdown.text}
                            </span>
                          </td>
                          <td className="p-3">
                            {isRevoked ? (
                              <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                                Revoked
                              </span>
                            ) : isExpired ? (
                              <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
                                Expired
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                                Active
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {!isRevoked && !isExpired && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleCopyLink(inv.token)}
                                    className="p-1.5 text-blue-600 hover:text-blue-800 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-lg transition-colors cursor-pointer"
                                    title="Copy Invite Link"
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleSendEmail(inv)}
                                    className="p-1.5 text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 rounded-lg transition-colors cursor-pointer"
                                    title="Send Link via Email"
                                  >
                                    <Send className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRevoke(inv.token)}
                                    className="p-1.5 text-rose-600 hover:text-rose-800 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors cursor-pointer"
                                    title="Revoke Invite Link"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex items-center justify-between text-xs text-slate-500">
          <span>Pingcon RMA Operations • Customer Return Governance</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold cursor-pointer transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

