import React, { useState, useEffect, useMemo } from 'react';
import {
  KeyRound,
  Mail,
  CheckCircle2,
  XCircle,
  Clock,
  Send,
  CheckCheck,
  Search,
  Filter,
  RefreshCw,
  Building,
  User,
  FileText,
  AlertTriangle,
  Sparkles,
  Trash2,
  ExternalLink,
  ChevronDown,
  X
} from 'lucide-react';
import { pinRequestService } from '../services/pinRequestService';
import { accessKeyService } from '../services/accessKeyService';

export default function PinRequestsQueueModal({
  isOpen,
  onClose,
  currentUser,
  isTestMode = false,
  onQueueUpdated
}) {
  const [requests, setRequests] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('pending'); // 'pending' | 'approved' | 'rejected' | 'all'
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [processingId, setProcessingId] = useState(null);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);
  const [rejectPromptId, setRejectPromptId] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');

  // Fetch requests & profiles
  const loadData = async () => {
    setIsLoading(true);
    try {
      const [reqs, profs] = await Promise.all([
        pinRequestService.getRequests(),
        accessKeyService.getProfiles()
      ]);
      setRequests(reqs || []);
      setProfiles(profs || []);
      if (onQueueUpdated) {
        onQueueUpdated(reqs || []);
      }
    } catch (err) {
      console.error('Error loading PIN requests:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
      setSelectedIds([]);
      setStatusMessage(null);
      setRejectPromptId(null);
    }
  }, [isOpen]);

  // Listen for real-time changes
  useEffect(() => {
    const handleChanged = () => {
      if (isOpen) {
        loadData();
      }
    };
    window.addEventListener('rma-pin-requests-changed', handleChanged);
    return () => window.removeEventListener('rma-pin-requests-changed', handleChanged);
  }, [isOpen]);

  // Map slug to profile details
  const profileMap = useMemo(() => {
    const map = {};
    profiles.forEach(p => {
      if (p.access_slug) {
        map[p.access_slug.toLowerCase()] = p;
      }
    });
    return map;
  }, [profiles]);

  // Filtered requests
  const filteredRequests = useMemo(() => {
    return requests.filter(req => {
      // Tab filter
      if (activeTab === 'pending' && req.status !== 'pending') return false;
      if (activeTab === 'approved' && req.status !== 'approved') return false;
      if (activeTab === 'rejected' && req.status !== 'rejected') return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const nameMatch = req.requester_name?.toLowerCase().includes(q);
        const emailMatch = req.requester_email?.toLowerCase().includes(q);
        const orgMatch = req.organization_name?.toLowerCase().includes(q);
        const slugMatch = req.access_slug?.toLowerCase().includes(q);
        const notesMatch = req.notes?.toLowerCase().includes(q);
        if (!nameMatch && !emailMatch && !orgMatch && !slugMatch && !notesMatch) {
          return false;
        }
      }

      return true;
    });
  }, [requests, activeTab, searchQuery]);

  // Counts
  const counts = useMemo(() => {
    return {
      pending: requests.filter(r => r.status === 'pending').length,
      approved: requests.filter(r => r.status === 'approved').length,
      rejected: requests.filter(r => r.status === 'rejected').length,
      all: requests.length
    };
  }, [requests]);

  if (!isOpen) return null;

  // Single Request Approval Handler
  const handleApprove = async (request) => {
    setProcessingId(request.id);
    setStatusMessage(null);

    const targetProfile = profileMap[request.access_slug?.toLowerCase()] || {
      name: `Station /${request.access_slug}`,
      pin_code: '123456',
      access_slug: request.access_slug
    };

    const adminName = currentUser?.name || currentUser?.full_name || 'Admin';

    try {
      const res = await pinRequestService.approveRequest({
        requestId: request.id,
        approvedBy: adminName,
        pinCode: targetProfile.pin_code,
        profileName: targetProfile.name,
        accessSlug: request.access_slug,
        isTestMode
      });

      setStatusMessage({
        type: 'success',
        text: `PIN code (${targetProfile.pin_code}) successfully dispatched to ${request.requester_email}!`
      });

      await loadData();
    } catch (err) {
      console.error('Approve PIN request error:', err);
      setStatusMessage({
        type: 'error',
        text: `Failed to approve PIN request: ${err.message}`
      });
    } finally {
      setProcessingId(null);
    }
  };

  // Rejection Handler
  const handleConfirmReject = async (requestId) => {
    setProcessingId(requestId);
    setStatusMessage(null);
    const adminName = currentUser?.name || currentUser?.full_name || 'Admin';

    try {
      await pinRequestService.rejectRequest({
        requestId,
        rejectedBy: adminName,
        reason: rejectionReason
      });

      setStatusMessage({
        type: 'info',
        text: 'Request marked as rejected.'
      });

      setRejectPromptId(null);
      setRejectionReason('');
      await loadData();
    } catch (err) {
      console.error('Reject PIN request error:', err);
      setStatusMessage({
        type: 'error',
        text: `Failed to reject PIN request: ${err.message}`
      });
    } finally {
      setProcessingId(null);
    }
  };

  // Batch Approval Handler
  const handleBatchApprove = async () => {
    if (selectedIds.length === 0) return;
    setIsBatchProcessing(true);
    setStatusMessage(null);

    const adminName = currentUser?.name || currentUser?.full_name || 'Admin';

    try {
      await pinRequestService.approveBatch({
        requestIds: selectedIds,
        approvedBy: adminName,
        getProfilePinFn: async (id) => {
          const req = requests.find(r => r.id === id);
          const prof = profileMap[req?.access_slug?.toLowerCase()] || {
            name: `Station /${req?.access_slug}`,
            pin_code: '123456',
            access_slug: req?.access_slug || 'dock'
          };
          return {
            pinCode: prof.pin_code,
            profileName: prof.name,
            accessSlug: prof.access_slug
          };
        },
        isTestMode
      });

      setStatusMessage({
        type: 'success',
        text: `Successfully approved & dispatched PINs for ${selectedIds.length} request(s)!`
      });

      setSelectedIds([]);
      await loadData();
    } catch (err) {
      console.error('Batch approve error:', err);
      setStatusMessage({
        type: 'error',
        text: `Batch approval error: ${err.message}`
      });
    } finally {
      setIsBatchProcessing(false);
    }
  };

  // Delete Handler
  const handleDelete = async (requestId) => {
    if (!window.confirm('Delete this request from history?')) return;
    try {
      await pinRequestService.deleteRequest(requestId);
      await loadData();
    } catch (err) {
      console.error('Delete request error:', err);
    }
  };

  // Multi-select helpers
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      const pendingIds = filteredRequests.filter(r => r.status === 'pending').map(r => r.id);
      setSelectedIds(pendingIds);
    } else {
      setSelectedIds([]);
    }
  };

  const handleToggleSelect = (id) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(item => item !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-150">
      <div 
        className="relative w-full max-w-4xl max-h-[90vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white flex items-center justify-center shadow-md shadow-orange-500/20">
              <KeyRound className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">
                  Pending PIN Requests Queue
                </h2>
                {counts.pending > 0 ? (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800 animate-pulse">
                    {counts.pending} Pending
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    All Reviewed
                  </span>
                )}
                {isTestMode && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200 border border-amber-300 dark:border-amber-700 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-amber-600" />
                    Test Mode (Simulated SMTP)
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Review and approve 6-digit gatekeeper authorization requests for external stores and warehouse intake.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadData}
              disabled={isLoading}
              className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Refresh requests"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Global Feedback Banner */}
        {statusMessage && (
          <div className={`px-6 py-2.5 text-xs font-bold flex items-center justify-between border-b ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
              : statusMessage.type === 'error'
              ? 'bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300 border-rose-200 dark:border-rose-800'
              : 'bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300 border-blue-200 dark:border-blue-800'
          }`}>
            <div className="flex items-center gap-2">
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : statusMessage.type === 'error' ? (
                <AlertTriangle className="w-4 h-4 text-rose-600" />
              ) : (
                <Clock className="w-4 h-4 text-blue-600" />
              )}
              <span>{statusMessage.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Controls: Search, Filters & Batch Actions */}
        <div className="p-4 sm:px-6 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-200/80 dark:bg-slate-800 rounded-2xl shrink-0 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('pending')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'pending'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-black'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <span>Pending</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                counts.pending > 0 ? 'bg-amber-100 text-amber-800 font-black' : 'bg-slate-200 dark:bg-slate-700 text-slate-600'
              }`}>
                {counts.pending}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('approved')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'approved'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-black'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <span>Approved</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-600">
                {counts.approved}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('rejected')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'rejected'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-black'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <span>Rejected</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-600">
                {counts.rejected}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'all'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-black'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <span>All</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-600">
                {counts.all}
              </span>
            </button>
          </div>

          {/* Search Input & Batch Action */}
          <div className="flex items-center gap-2 grow max-w-md">
            <div className="relative grow">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, email, store, or slug..."
                className="w-full pl-8 pr-3 py-1.5 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/10"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Batch Approve Selected Button */}
            {selectedIds.length > 0 && (
              <button
                type="button"
                onClick={handleBatchApprove}
                disabled={isBatchProcessing}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold shadow-sm transition-all flex items-center gap-1.5 shrink-0 cursor-pointer animate-in fade-in"
              >
                {isBatchProcessing ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCheck className="w-3.5 h-3.5" />
                )}
                <span>Approve Selected ({selectedIds.length})</span>
              </button>
            )}
          </div>
        </div>

        {/* List of Requests */}
        <div className="overflow-y-auto flex-1 p-4 sm:p-6 space-y-3">
          {isLoading ? (
            <div className="py-16 text-center space-y-3">
              <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
              <p className="text-xs font-bold text-slate-500">Loading PIN authorization requests...</p>
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <div className="w-14 h-14 rounded-3xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7 text-emerald-500" />
              </div>
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                {activeTab === 'pending'
                  ? 'All caught up! No pending PIN requests.'
                  : `No requests found under "${activeTab}".`}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                When warehouse personnel or customer supermarkets scan a QR code without a PIN, their authorization requests will appear here for one-click approval.
              </p>
            </div>
          ) : (
            <>
              {/* Batch Select Bar for Pending */}
              {activeTab === 'pending' && filteredRequests.length > 0 && (
                <div className="px-2 pb-1 flex items-center justify-between text-xs text-slate-500 font-bold">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={
                        filteredRequests.filter(r => r.status === 'pending').length > 0 &&
                        selectedIds.length === filteredRequests.filter(r => r.status === 'pending').length
                      }
                      onChange={handleSelectAll}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>Select All Pending ({filteredRequests.filter(r => r.status === 'pending').length})</span>
                  </label>

                  <span>Showing {filteredRequests.length} record(s)</span>
                </div>
              )}

              {/* Request Cards */}
              <div className="space-y-3">
                {filteredRequests.map(req => {
                  const targetProfile = profileMap[req.access_slug?.toLowerCase()] || {
                    name: `Station /${req.access_slug}`,
                    pin_code: '123456',
                    session_duration_hours: 0
                  };
                  const isPending = req.status === 'pending';
                  const isApproved = req.status === 'approved';
                  const isRejected = req.status === 'rejected';
                  const isSelected = selectedIds.includes(req.id);
                  const isProcessing = processingId === req.id;
                  const isPromptingReject = rejectPromptId === req.id;

                  return (
                    <div
                      key={req.id}
                      className={`p-4 rounded-2xl border transition-all ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50/30 dark:bg-blue-950/20'
                          : isPending
                          ? 'border-amber-200 dark:border-amber-900/50 bg-white dark:bg-slate-900 shadow-xs hover:border-amber-400'
                          : isApproved
                          ? 'border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/20 dark:bg-emerald-950/10'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        {/* Left column: Checkbox + User & Org Info */}
                        <div className="flex items-start gap-3">
                          {isPending && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleSelect(req.id)}
                              className="mt-1 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                            />
                          )}

                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                                <User className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                                {req.requester_name}
                              </span>

                              {/* Status Badge */}
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                                isPending
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                                  : isApproved
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 dark:border-rose-800'
                              }`}>
                                {req.status}
                              </span>

                              {/* Target Station Badge */}
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                Target: <strong>{targetProfile.name}</strong> (<code>/{req.access_slug}</code>)
                              </span>
                            </div>

                            {/* Organization & Email */}
                            <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-400 flex-wrap">
                              {req.organization_name && (
                                <span className="flex items-center gap-1 font-semibold text-slate-800 dark:text-slate-200">
                                  <Building className="w-3.5 h-3.5 text-slate-400" />
                                  {req.organization_name}
                                </span>
                              )}
                              <a
                                href={`mailto:${req.requester_email}`}
                                className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline font-mono"
                              >
                                <Mail className="w-3 h-3" />
                                {req.requester_email}
                              </a>
                            </div>

                            {/* Reason / Notes */}
                            {req.notes && (
                              <div className="pt-1 text-xs text-slate-600 dark:text-slate-300 flex items-start gap-1.5 italic">
                                <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                                <span>"{req.notes}"</span>
                              </div>
                            )}

                            {/* Audit Trail for Approved / Rejected */}
                            {(isApproved || isRejected) && (
                              <div className="pt-1 text-[11px] text-slate-400 flex items-center gap-2">
                                <span>Reviewed by: <strong>{req.approved_by || 'Admin'}</strong></span>
                                {req.reviewed_at && (
                                  <span>&bull; {new Date(req.reviewed_at).toLocaleString()}</span>
                                )}
                              </div>
                            )}

                            <div className="text-[10px] text-slate-400">
                              Requested: {new Date(req.created_at).toLocaleString()}
                            </div>
                          </div>
                        </div>

                        {/* Right column: Action Buttons */}
                        <div className="flex sm:flex-col items-end justify-between sm:justify-start gap-2 shrink-0 pt-2 sm:pt-0">
                          {isPending ? (
                            <>
                              <button
                                type="button"
                                disabled={isProcessing}
                                onClick={() => handleApprove(req)}
                                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-black shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                                title={`Approve and email PIN ${targetProfile.pin_code} to ${req.requester_email}`}
                              >
                                {isProcessing ? (
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Send className="w-3.5 h-3.5" />
                                )}
                                <span>Approve &amp; Dispatch PIN</span>
                              </button>

                              {!isPromptingReject ? (
                                <button
                                  type="button"
                                  disabled={isProcessing}
                                  onClick={() => {
                                    setRejectPromptId(req.id);
                                    setRejectionReason('');
                                  }}
                                  className="px-3 py-1 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 rounded-xl text-xs font-bold transition-all cursor-pointer"
                                >
                                  Reject
                                </button>
                              ) : null}
                            </>
                          ) : (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleDelete(req.id)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                title="Delete record"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Rejection Note Prompt Inline */}
                      {isPromptingReject && (
                        <div className="mt-3 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl space-y-2 animate-in fade-in">
                          <label className="block text-xs font-bold text-rose-900 dark:text-rose-200">
                            Rejection Reason / Note <span className="text-[10px] font-normal text-rose-700 dark:text-rose-400">(Optional)</span>
                          </label>
                          <input
                            type="text"
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            placeholder="e.g. Unrecognized vendor or missing store branch..."
                            className="w-full px-3 py-1.5 text-xs rounded-lg border border-rose-300 dark:border-rose-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none"
                          />
                          <div className="flex items-center justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setRejectPromptId(null)}
                              className="px-2.5 py-1 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleConfirmReject(req.id)}
                              className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold cursor-pointer"
                            >
                              Confirm Rejection
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:px-6 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
          <div>
            Total: <strong>{requests.length}</strong> authorization requests recorded
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            Close Queue
          </button>
        </div>

      </div>
    </div>
  );
}
