import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Mail,
  Plus,
  X,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  AtSign,
  FlaskConical
} from 'lucide-react';
import { notificationService, EMAIL_PROFILE_TYPES } from '../services/notificationService';

const isValidEmail = (raw) => {
  const s = String(raw || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
};

export default function EmailRecipientsEditor({
  emailType = 'new_rma',
  value = null,
  onChange = null,
  onSaved = null,
  title = '',
  description = '',
  compact = false,
  defaultExpanded,
  isTestMode = false,
  allowEmptyTo,
  extraHint = ''
}) {
  const [sandboxEmail, setSandboxEmail] = useState(() => notificationService.getTestSandboxEmail());
  useEffect(() => {
    const syncSandbox = () => setSandboxEmail(notificationService.getTestSandboxEmail());
    window.addEventListener('rma-settings-changed', syncSandbox);
    window.addEventListener('storage', syncSandbox);
    return () => {
      window.removeEventListener('rma-settings-changed', syncSandbox);
      window.removeEventListener('storage', syncSandbox);
    };
  }, []);

  const meta = useMemo(
    () => EMAIL_PROFILE_TYPES.find((t) => t.id === emailType) || EMAIL_PROFILE_TYPES[0],
    [emailType]
  );
  const canEmptyTo = allowEmptyTo !== undefined ? allowEmptyTo : emailType === 'invite_email';

  const [isExpanded, setIsExpanded] = useState(() => (
    defaultExpanded !== undefined ? Boolean(defaultExpanded) : !compact
  ));
  const [toList, setToList] = useState(() => {
    if (value?.toList) return [...value.toList];
    return notificationService.getEmailProfile(emailType, Boolean(isTestMode)).toList || [];
  });
  const [ccList, setCcList] = useState(() => {
    if (value?.ccList) return [...value.ccList];
    return notificationService.getEmailProfile(emailType, Boolean(isTestMode)).ccList || [];
  });
  const [newToInput, setNewToInput] = useState('');
  const [newCcInput, setNewCcInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const isDirtyRef = useRef(false);

  // Sync from controlled prop if provided, else keep synced when emailType, isTestMode, or storage changes
  useEffect(() => {
    isDirtyRef.current = false;
    if (value && (Array.isArray(value.toList) || Array.isArray(value.ccList))) {
      if (Array.isArray(value.toList)) setToList(value.toList);
      if (Array.isArray(value.ccList)) setCcList(value.ccList);
      return;
    }
    const loadSaved = (evt) => {
      if (evt?.detail?.loadedFromDb && isDirtyRef.current) {
        return;
      }
      const prof = notificationService.getEmailProfile(emailType, Boolean(isTestMode));
      setToList(prof.toList || []);
      setCcList(prof.ccList || []);
    };
    loadSaved();
    window.addEventListener('rma-settings-changed', loadSaved);
    window.addEventListener('storage', loadSaved);
    return () => {
      window.removeEventListener('rma-settings-changed', loadSaved);
      window.removeEventListener('storage', loadSaved);
    };
  }, [emailType, isTestMode, value?.toList, value?.ccList]); // eslint-disable-line react-hooks/exhaustive-deps

  const emitChange = (nextTo, nextCc) => {
    if (onChange) {
      onChange({ toList: nextTo, ccList: nextCc });
    }
  };

  const handleAddTo = () => {
    const candidates = newToInput
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (candidates.length === 0) return;

    const invalid = candidates.find((c) => !isValidEmail(c));
    if (invalid) {
      setFeedback({ type: 'error', message: `Invalid TO email address: "${invalid}"` });
      return;
    }

    const existing = new Set(toList.map((e) => e.toLowerCase()));
    const added = candidates.filter((c) => !existing.has(c));
    if (added.length === 0) {
      setFeedback({ type: 'error', message: 'Email is already in the TO list.' });
      return;
    }

    isDirtyRef.current = true;
    const nextTo = [...toList, ...added];
    const addedSet = new Set(added);
    const nextCc = ccList.filter((e) => !addedSet.has(e.toLowerCase()));
    setToList(nextTo);
    setCcList(nextCc);
    setNewToInput('');
    setFeedback(null);
    emitChange(nextTo, nextCc);
  };

  const handleRemoveTo = (emailToRemove) => {
    isDirtyRef.current = true;
    const nextTo = toList.filter((e) => e.toLowerCase() !== emailToRemove.toLowerCase());
    setToList(nextTo);
    setFeedback(null);
    emitChange(nextTo, ccList);
  };

  const handleAddCc = () => {
    const candidates = newCcInput
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (candidates.length === 0) return;

    const invalid = candidates.find((c) => !isValidEmail(c));
    if (invalid) {
      setFeedback({ type: 'error', message: `Invalid CC email address: "${invalid}"` });
      return;
    }

    const existingCc = new Set(ccList.map((e) => e.toLowerCase()));
    const dupes = candidates.filter((c) => !existingCc.has(c));
    if (dupes.length === 0) {
      setFeedback({ type: 'error', message: 'Email is already in the CC list.' });
      return;
    }

    isDirtyRef.current = true;
    const nextCc = [...ccList, ...dupes];
    setCcList(nextCc);
    setNewCcInput('');
    setFeedback(null);
    emitChange(toList, nextCc);
  };

  const handleRemoveCc = (emailToRemove) => {
    isDirtyRef.current = true;
    const nextCc = ccList.filter((e) => e.toLowerCase() !== emailToRemove.toLowerCase());
    setCcList(nextCc);
    setFeedback(null);
    emitChange(toList, nextCc);
  };

  const handleSave = async () => {
    if (!canEmptyTo && toList.length === 0) {
      setFeedback({ type: 'error', message: 'At least one valid Primary TO recipient is required.' });
      return;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      const saved = await notificationService.saveEmailProfile(emailType, { toList, ccList }, Boolean(isTestMode));
      isDirtyRef.current = false;
      setToList(saved.toList);
      setCcList(saved.ccList);
      emitChange(saved.toList, saved.ccList);
      setFeedback({
        type: 'success',
        message: isTestMode
          ? 'Test Mode recipients saved & synced to cloud!'
          : 'Recipients saved & synced to cloud!'
      });
      if (onSaved) onSaved(saved);
      setTimeout(() => setFeedback(null), 4000);
    } catch (err) {
      setFeedback({ type: 'error', message: err?.message || 'Could not save recipients.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetDefaults = async () => {
    setIsSaving(true);
    setFeedback(null);
    try {
      const restored = await notificationService.resetEmailProfileToDefaults(emailType, Boolean(isTestMode));
      isDirtyRef.current = false;
      setToList(restored.toList);
      setCcList(restored.ccList);
      emitChange(restored.toList, restored.ccList);
      setFeedback({
        type: 'success',
        message: isTestMode
          ? 'Reset to Test Mode Sandbox Defaults!'
          : 'Reset to Global Corporate Defaults!'
      });
      if (onSaved) onSaved(restored);
      setTimeout(() => setFeedback(null), 3500);
    } catch (err) {
      setFeedback({ type: 'error', message: err?.message || 'Could not reset defaults.' });
    } finally {
      setIsSaving(false);
    }
  };

  const displayTitle = title || meta.label;
  const displayDesc = description || meta.description;

  return (
    <div
      data-email-recipients-editor={emailType}
      className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shadow-2xs"
    >
      {/* Header / Compact Accordion Trigger */}
      <div
        className={`px-3.5 py-2.5 flex items-center justify-between gap-2 flex-wrap bg-slate-50 dark:bg-slate-800/70 ${
          compact ? 'cursor-pointer select-none hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors' : 'border-b border-slate-200 dark:border-slate-700'
        }`}
        onClick={compact ? () => setIsExpanded((v) => !v) : undefined}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Mail className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5 flex-wrap">
              <span>{displayTitle}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                TO: {toList.length} • CC: {ccList.length}
              </span>
            </div>
            {!compact && displayDesc && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{displayDesc}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => compact && e.stopPropagation()}>
          {isExpanded && (
            <>
              <button
                type="button"
                onClick={handleResetDefaults}
                disabled={isSaving}
                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 text-[11px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                title={isTestMode ? 'Reset Test Mode recipients to Sandbox Defaults' : 'Reset recipients to Global Corporate Defaults'}
              >
                <RotateCcw className="w-3 h-3" />
                <span>{isTestMode ? 'Reset Test Defaults' : 'Reset to Global Defaults'}</span>
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className={`px-2.5 py-1 rounded-lg text-white text-[11px] font-black flex items-center gap-1 cursor-pointer shadow-2xs disabled:opacity-50 ${
                  isTestMode ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                <Save className="w-3 h-3" />
                <span>{isSaving ? 'Saving...' : (isTestMode ? 'Save Test Recipients' : 'Save Recipients')}</span>
              </button>
            </>
          )}
          {compact && (
            <button
              type="button"
              onClick={() => setIsExpanded((v) => !v)}
              className="p-1 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              aria-label={isExpanded ? 'Collapse email recipients' : 'Expand email recipients'}
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Expandable Editor Body */}
      {isExpanded && (
        <div className="p-3.5 space-y-3 text-xs border-t border-slate-200/70 dark:border-slate-700/70">
          {isTestMode && (
            <div className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 text-[11px] font-bold flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                🧪 Editing Test Mode Recipients (isolated from Live) — When empty/reset, falls back exclusively to <code className="font-mono font-black">{sandboxEmail}</code>. Live stakeholders will never receive Test Mode emails.
              </span>
            </div>
          )}

          {feedback && (
            <div className={`px-3 py-2 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 ${
              feedback.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200'
                : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-700 text-rose-800 dark:text-rose-200'
            }`}>
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}

          {/* Primary TO Chips & Add Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                {(allowEmptyTo || emailType === 'invite_email' || emailType === 'supplier_followup') ? 'Extra TO Recipient(s) (Optional)' : 'Primary TO Recipient(s)'}
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {toList.length} address{toList.length === 1 ? '' : 'es'}
              </span>
            </div>

            <div className="p-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-wrap gap-1.5 items-center min-h-[38px]">
              {toList.length === 0 ? (
                <span className="text-[11px] text-slate-400 italic px-1">
                  {emailType === 'invite_email'
                    ? 'Uses invited user email automatically.'
                    : emailType === 'supplier_followup'
                      ? 'Uses each RMA record’s Supplier Email TO automatically.'
                      : 'No TO recipient added yet.'}
                </span>
              ) : (
                toList.map((email) => (
                  <span
                    key={`to-${email}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-900 dark:text-blue-200 border border-blue-200 dark:border-blue-800 font-mono text-[11px] font-bold max-w-full"
                  >
                    <span className="truncate max-w-[210px]">{email}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTo(email)}
                      title={`Remove TO ${email}`}
                      aria-label={`Remove ${email}`}
                      className="text-blue-500 hover:text-rose-600 dark:hover:text-rose-400 p-0.5 cursor-pointer shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-1.5">
              <div className="relative flex-1 min-w-0">
                <AtSign className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={newToInput}
                  onChange={(e) => setNewToInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      handleAddTo();
                    }
                  }}
                  placeholder="Add Primary TO email (e.g. finance@company.com)"
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-[11px] font-mono text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="button"
                onClick={handleAddTo}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-600 text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add TO</span>
              </button>
            </div>
          </div>

          {/* CC Chips & Add Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                CC Distribution List
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {ccList.length} address{ccList.length === 1 ? '' : 'es'}
              </span>
            </div>

            <div className="p-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-wrap gap-1.5 items-center min-h-[38px]">
              {ccList.length === 0 ? (
                <span className="text-[11px] text-slate-400 italic px-1">No CC recipients configured.</span>
              ) : (
                ccList.map((email) => (
                  <span
                    key={`cc-${email}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-mono text-[11px] shadow-2xs max-w-full"
                  >
                    <span className="truncate max-w-[210px]">{email}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCc(email)}
                      title={`Remove ${email}`}
                      aria-label={`Remove ${email}`}
                      className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 p-0.5 cursor-pointer shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-1.5">
              <div className="relative flex-1 min-w-0">
                <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={newCcInput}
                  onChange={(e) => setNewCcInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      handleAddCc();
                    }
                  }}
                  placeholder="Add CC email (e.g. manager@pingconmarketing.com)"
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-[11px] font-mono text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="button"
                onClick={handleAddCc}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-600 text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add CC</span>
              </button>
            </div>
          </div>

          {extraHint && (
            <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed pt-0.5">
              {extraHint}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
