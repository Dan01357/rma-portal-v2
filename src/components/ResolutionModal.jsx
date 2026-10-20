import React, { useState } from 'react';
import { RMA_STATUSES } from '../data/mockCatalog';
import StatusBadge from './StatusBadge';
import { 
  X, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  FileText, 
  Send,
  Building2,
  Calendar,
  User,
  Package,
  Hash
} from 'lucide-react';

export default function ResolutionModal({ ticket, isOpen, onClose, onSave }) {
  if (!isOpen || !ticket) return null;

  const [selectedStatus, setSelectedStatus] = useState(ticket.status || 'Pending Inspection');
  const [resolutionNotes, setResolutionNotes] = useState(ticket.resolution_notes || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave(ticket.id, {
        status: selectedStatus,
        resolution_notes: resolutionNotes.trim()
      });
      onClose();
    } catch (err) {
      console.error('Failed to update resolution:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div 
        className="relative w-full max-w-xl bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl overflow-hidden animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-indigo-400 bg-indigo-500/10 px-2.5 py-0.5 rounded border border-indigo-500/20">
                {ticket.rma_id}
              </span>
              <span className="text-xs text-slate-400">{ticket.company}</span>
            </div>
            <h3 className="text-lg font-bold text-white mt-1">
              Supervisor Ticket Resolution
            </h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Ticket Context Summary */}
          <div className="bg-slate-950/70 rounded-2xl p-4 border border-slate-800 text-xs space-y-2">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-mono">Customer & Item</span>
                <p className="font-bold text-sm text-white">{ticket.customer_name}</p>
                <p className="text-slate-300 mt-0.5">{ticket.product_name} <span className="font-mono text-slate-400">({ticket.sku})</span></p>
              </div>
              <div className="text-right">
                <span className="text-slate-500 block text-[10px] uppercase font-mono">Ref DR #</span>
                <span className="font-mono text-xs font-bold text-slate-200">{ticket.delivery_reference}</span>
                <span className="text-indigo-400 block text-[11px] font-semibold mt-1">
                  AE: {ticket.assigned_ae || 'Rodrigo Galvez'}
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/80">
              <span className="text-slate-500 block text-[10px] uppercase font-mono">Customer Defect Report</span>
              <p className="font-semibold text-rose-300">{ticket.defect_category}</p>
              <p className="text-slate-400 mt-0.5 italic">"{ticket.defect_description}"</p>
            </div>
          </div>

          {/* Status Selection */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
              Authorization Status
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {RMA_STATUSES.map((st) => {
                const isSelected = selectedStatus === st.id;
                return (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setSelectedStatus(st.id)}
                    className={`p-3 rounded-xl border text-left transition-all flex items-center justify-between ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-600/20 text-white font-semibold ring-1 ring-indigo-500'
                        : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <span className="text-xs">{st.label}</span>
                    {isSelected && <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Resolution Notes Textarea */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5 flex items-center justify-between">
              <span>Resolution & Accounting Notes</span>
              <span className="text-[10px] text-slate-500 lowercase">saved to Supabase vault</span>
            </label>
            <textarea
              rows={4}
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              placeholder="e.g. Inspected physical unit. Screen replacement approved under warranty dispatch. Credit Memo #CM-9011 issued to customer account..."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none leading-relaxed"
            />
          </div>

          {/* Modal Footer Actions */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all active:scale-95 disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Saving Updates...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Save Resolution</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
