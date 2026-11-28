import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  BookOpen,
  Plus,
  Search,
  Edit3,
  Trash2,
  Mail,
  User,
  Save,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Building2
} from 'lucide-react';
import {
  supplierDirectoryService,
  SUPPLIER_DIRECTORY_EVENT
} from '../services/supplierDirectoryService';
import { formatDateTimeYmdHm } from '../utils/rmaHelpers';
import { useIsDesktopMd } from '../hooks/useIsDesktopMd';

const EMPTY_FORM = {
  id: '',
  supplier_name: '',
  email_to: '',
  email_cc: '',
  contact_person: '',
  notes: ''
};

/**
 * Persistent Supplier Emails Directory Modal (Supabase rma_settings -> supplier_directory_store).
 * Allows Add, Edit, Search, and Delete of supplier contacts used to auto-fill To/CC fields
 * across 4-Choice Wizard, + Set Supplier & Email, Quick Actions, and automated follow-up cron.
 */
export default function SupplierDirectoryModal({
  isOpen,
  onClose,
  onShowToast = null,
  isEmbeddedPage = false,
  isTestMode = false
}) {
  // Always declare ALL React hooks unconditionally before any early returns
  const isDesktopMd = useIsDesktopMd();
  const modeIsTest = Boolean(isTestMode);
  const [contacts, setContacts] = useState(() => supplierDirectoryService.getCachedDirectory({ isTestMode: modeIsTest }));
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    const syncHandler = (e) => {
      const detail = e?.detail;
      if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
        if (Boolean(detail.isTestMode) !== modeIsTest) return;
        if (Array.isArray(detail.list)) {
          setContacts(detail.list);
          return;
        }
      } else if (Array.isArray(detail)) {
        setContacts(detail);
        return;
      }
      setContacts(supplierDirectoryService.getCachedDirectory({ isTestMode: modeIsTest }));
    };
    window.addEventListener(SUPPLIER_DIRECTORY_EVENT, syncHandler);
    return () => window.removeEventListener(SUPPLIER_DIRECTORY_EVENT, syncHandler);
  }, [modeIsTest]);

  useEffect(() => {
    if (!isOpen && !isEmbeddedPage) return;
    let active = true;
    setFeedback(null);
    setShowForm(false);
    setForm(EMPTY_FORM);
    setContacts(supplierDirectoryService.getCachedDirectory({ isTestMode: modeIsTest }));
    setIsLoading(true);
    supplierDirectoryService
      .loadDirectory({ isTestMode: modeIsTest })
      .then((list) => {
        if (active && Array.isArray(list)) {
          setContacts(list);
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen, isEmbeddedPage, modeIsTest]);

  const filteredContacts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => {
      return (
        String(c.supplier_name || '').toLowerCase().includes(q) ||
        String(c.email_to || '').toLowerCase().includes(q) ||
        String(c.email_cc || '').toLowerCase().includes(q) ||
        String(c.contact_person || '').toLowerCase().includes(q) ||
        String(c.notes || '').toLowerCase().includes(q)
      );
    });
  }, [contacts, searchTerm]);

  if (!isOpen) return null;

  const handleStartAdd = () => {
    setForm(EMPTY_FORM);
    setFeedback(null);
    setShowForm(true);
  };

  const handleStartEdit = (contact) => {
    setForm({
      id: contact.id || '',
      supplier_name: contact.supplier_name || '',
      email_to: contact.email_to || '',
      email_cc: contact.email_cc || '',
      contact_person: contact.contact_person || '',
      notes: contact.notes || ''
    });
    setFeedback(null);
    setShowForm(true);
  };

  const handleSaveForm = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const cleanName = form.supplier_name.trim();
    if (!cleanName) {
      setFeedback({ type: 'error', message: 'Supplier / Vendor Name is required.' });
      return;
    }
    if (!form.email_to.trim() && !form.email_cc.trim()) {
      setFeedback({ type: 'error', message: 'Enter at least one Email Address (To or CC).' });
      return;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      const { saved, directory } = await supplierDirectoryService.upsertContact(form, {
        explicitEdit: true,
        isTestMode: modeIsTest
      });
      setContacts(directory);
      setShowForm(false);
      setForm(EMPTY_FORM);
      const msg = `Saved contact "${saved.supplier_name}" to ${modeIsTest ? 'Sandbox' : 'Live'} Supplier Emails Directory.`;
      setFeedback({ type: 'success', message: msg });
      onShowToast?.(msg, 'success');
    } catch (err) {
      setFeedback({ type: 'error', message: err?.message || 'Failed saving supplier contact.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (contact) => {
    if (!window.confirm(`Delete "${contact.supplier_name}" from ${modeIsTest ? 'Sandbox ' : ''}Supplier Emails Directory?`)) return;
    setDeletingId(contact.id || contact.supplier_name);
    setFeedback(null);
    try {
      const updatedList = await supplierDirectoryService.deleteContact(contact.id || contact.supplier_name, { isTestMode: modeIsTest });
      setContacts(updatedList);
      const msg = `Removed "${contact.supplier_name}" from directory.`;
      setFeedback({ type: 'success', message: msg });
      onShowToast?.(msg, 'success');
    } catch (err) {
      setFeedback({ type: 'error', message: err?.message || 'Failed deleting supplier contact.' });
    } finally {
      setDeletingId(null);
    }
  };

  if (!isOpen && !isEmbeddedPage) return null;

  return (
    <div
      className={isEmbeddedPage
        ? 'w-full'
        : 'fixed inset-0 z-[95] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in'
      }
      onClick={isEmbeddedPage ? undefined : onClose}
    >
      <div
        className={isEmbeddedPage
          ? 'w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm flex flex-col overflow-hidden'
          : 'w-full max-w-5xl max-h-[92dvh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden'
        }
        onClick={isEmbeddedPage ? undefined : (e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={isEmbeddedPage
          ? 'px-5 py-4 bg-white dark:bg-slate-900 text-slate-900 dark:text-white flex items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 shrink-0'
          : 'px-5 py-4 bg-slate-900 text-white flex items-center justify-between gap-3 border-b border-slate-800 shrink-0'
        }>
          <div className="flex items-center gap-3 min-w-0">
            <div className={`p-2 rounded-xl border shrink-0 ${isEmbeddedPage
              ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800'
              : 'bg-amber-500/20 border-amber-400/40'
            }`}>
              <BookOpen className={`w-5 h-5 ${isEmbeddedPage ? 'text-amber-600 dark:text-amber-400' : 'text-amber-300'}`} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-black tracking-tight truncate">
                  Supplier Emails Directory
                </h2>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                  modeIsTest
                    ? 'bg-amber-200 dark:bg-amber-950 text-amber-900 dark:text-amber-300 border border-amber-400'
                    : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300'
                }`}>
                  {modeIsTest ? '🧪 Sandbox Isolated' : '🟢 Live Production'}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black font-mono">
                  {contacts.length} Saved Supplier{contacts.length === 1 ? '' : 's'}
                </span>
              </div>
              <p className={`text-[11px] leading-snug ${isEmbeddedPage ? 'text-slate-500 dark:text-slate-400' : 'text-slate-300'}`}>
                Auto-populates To / CC emails everywhere a Supplier Name is typed or selected, and feeds automated follow-ups.
              </p>
            </div>
          </div>

          {!isEmbeddedPage && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Supplier Emails Directory"
              className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Controls Bar */}
        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-950/70 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shrink-0">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search supplier name, To email, CC email, or contact person..."
              className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleStartAdd}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black flex items-center justify-center gap-1.5 shadow-sm cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Supplier Contact</span>
          </button>
        </div>

        {/* Body */}
        <div className={isEmbeddedPage ? 'p-5 space-y-4 text-xs' : 'p-5 flex-1 overflow-y-auto space-y-4 text-xs'}>
          {feedback && (
            <div className={`p-3 rounded-2xl border font-bold flex items-center gap-2 ${
              feedback.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200'
                : 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-700 text-rose-900 dark:text-rose-200'
            }`}>
              {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              <span>{feedback.message}</span>
            </div>
          )}

          {/* Add / Edit Contact Form */}
          {showForm && (
            <form
              onSubmit={handleSaveForm}
              className="p-4 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border-2 border-indigo-300 dark:border-indigo-700 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-black uppercase tracking-wider text-indigo-950 dark:text-indigo-200 flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-indigo-600" />
                  <span>{form.id ? 'Edit Supplier Contact' : 'New Supplier Contact'}</span>
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setForm(EMPTY_FORM);
                  }}
                  className="text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-black text-slate-700 dark:text-slate-200 mb-1">
                    Supplier / Vendor Name *
                  </label>
                  <input
                    type="text"
                    value={form.supplier_name}
                    onChange={(e) => setForm((p) => ({ ...p, supplier_name: e.target.value }))}
                    placeholder="e.g. Mondelez, Century Pacific Food"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-black text-slate-700 dark:text-slate-200 mb-1">
                    Contact Person (Optional)
                  </label>
                  <input
                    type="text"
                    value={form.contact_person}
                    onChange={(e) => setForm((p) => ({ ...p, contact_person: e.target.value }))}
                    placeholder="e.g. Juan Dela Cruz (RTV Coordinator)"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-black text-slate-700 dark:text-slate-200 mb-1">
                    Primary Email(s) — TO
                  </label>
                  <input
                    type="text"
                    value={form.email_to}
                    onChange={(e) => setForm((p) => ({ ...p, email_to: e.target.value }))}
                    placeholder="claims@supplier.com, rtv@supplier.com"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-black text-slate-700 dark:text-slate-200 mb-1">
                    CC Email(s) (Optional)
                  </label>
                  <input
                    type="text"
                    value={form.email_cc}
                    onChange={(e) => setForm((p) => ({ ...p, email_cc: e.target.value }))}
                    placeholder="billing@supplier.com, rep@supplier.com"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-black text-slate-700 dark:text-slate-200 mb-1">
                    Notes / Pickup Instructions (Optional)
                  </label>
                  <input
                    type="text"
                    value={form.notes}
                    onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                    placeholder="e.g. Consolidate weekly pickups every Tuesday"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>{isSaving ? 'Saving...' : 'Save to Directory'}</span>
                </button>
              </div>
            </form>
          )}

          {/* Directory List */}
          {isLoading && contacts.length === 0 ? (
            <div className="py-12 text-center text-slate-500 flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
              <span className="font-bold">Loading supplier contacts...</span>
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="py-12 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-slate-500 space-y-2">
              <BookOpen className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
              <div className="font-bold text-slate-700 dark:text-slate-300">
                {searchTerm ? `No suppliers matching "${searchTerm}"` : 'No supplier email contacts saved yet.'}
              </div>
              <p className="text-[11px]">
                Add contacts manually above, or enter any Supplier Email inside the 4-Choice Wizard / + Set Supplier &amp; Email to auto-save it here.
              </p>
            </div>
          ) : (
            isDesktopMd ? (
              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="py-2.5 px-3 min-w-[160px]">Supplier / Contact</th>
                      <th className="py-2.5 px-3 min-w-[200px]">Primary Email(s) (TO)</th>
                      <th className="py-2.5 px-3 min-w-[180px]">CC Email(s)</th>
                      <th className="py-2.5 px-3 whitespace-nowrap">Last Updated</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredContacts.map((c) => (
                      <tr key={c.id || c.supplier_name} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 align-top">
                          <div className="font-black text-slate-900 dark:text-white">{c.supplier_name}</div>
                          {c.contact_person && (
                            <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                              <User className="w-3 h-3" />
                              <span>{c.contact_person}</span>
                            </div>
                          )}
                          {c.notes && (
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 italic mt-0.5">{c.notes}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-indigo-700 dark:text-indigo-300 align-top break-words">
                          {c.email_to || <span className="text-slate-400 italic">None</span>}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-300 align-top break-words">
                          {c.email_cc || <span className="text-slate-400 italic">None</span>}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[10px] text-slate-500 align-top whitespace-nowrap">
                          {c.updated_at ? formatDateTimeYmdHm(c.updated_at) : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right align-top whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleStartEdit(c)}
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-indigo-100 dark:bg-slate-800 dark:hover:bg-indigo-900 text-slate-700 dark:text-slate-200 cursor-pointer"
                              title={`Edit ${c.supplier_name}`}
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={deletingId === (c.id || c.supplier_name)}
                              onClick={() => handleDelete(c)}
                              className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900 text-rose-700 dark:text-rose-300 cursor-pointer disabled:opacity-50"
                              title={`Delete ${c.supplier_name}`}
                            >
                              {deletingId === (c.id || c.supplier_name) ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredContacts.map((c) => (
                  <div
                    key={`mob-${c.id || c.supplier_name}`}
                    className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-black text-sm text-slate-900 dark:text-white break-words">{c.supplier_name}</div>
                        {c.contact_person && (
                          <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                            <User className="w-3 h-3 shrink-0" />
                            <span>{c.contact_person}</span>
                          </div>
                        )}
                      </div>
                      <div className="inline-flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(c)}
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-indigo-100 dark:bg-slate-800 dark:hover:bg-indigo-900 text-slate-700 dark:text-slate-200 cursor-pointer"
                          title={`Edit ${c.supplier_name}`}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={deletingId === (c.id || c.supplier_name)}
                          onClick={() => handleDelete(c)}
                          className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900 text-rose-700 dark:text-rose-300 cursor-pointer disabled:opacity-50"
                          title={`Delete ${c.supplier_name}`}
                        >
                          {deletingId === (c.id || c.supplier_name) ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1 text-[11px]">
                      <div>
                        <span className="text-[10px] font-black uppercase text-slate-400 mr-1.5">TO:</span>
                        <span className="font-mono text-indigo-700 dark:text-indigo-300 break-all">{c.email_to || 'None'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] font-black uppercase text-slate-400 mr-1.5">CC:</span>
                        <span className="font-mono text-slate-600 dark:text-slate-300 break-all">{c.email_cc || 'None'}</span>
                      </div>
                      {c.notes && (
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 italic">{c.notes}</div>
                      )}
                      <div className="text-[10px] font-mono text-slate-400 pt-0.5">
                        Updated: {c.updated_at ? formatDateTimeYmdHm(c.updated_at) : '—'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
