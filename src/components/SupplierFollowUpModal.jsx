import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Building2,
  Mail,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Save,
  FlaskConical,
  Loader2,
  ShieldCheck,
  Package
} from 'lucide-react';
import SupplierInput from './SupplierInput';
import FollowUpTimelineCard from './FollowUpTimelineCard';
import { catalogService } from '../services/catalogService';
import { notificationService } from '../services/notificationService';
import { supplierDirectoryService } from '../services/supplierDirectoryService';
import {
  formatQuantityWithPackSize,
  getReportManifestItems,
  isMixedSuppliersSummary,
  isTestRecord
} from '../utils/rmaHelpers';
import {
  computeFourStepWorkflow,
  groupReportItemsBySupplierForFollowUp,
  normalizeSupplierGroupKey,
  resolveReportPartyAndEmails,
  isPlaceholderSupplier
} from '../utils/followUpWorkflow';

export default function SupplierFollowUpModal({
  isOpen,
  onClose,
  report,
  allReports = [],
  catalogProducts = [],
  isTestMode = false,
  currentUser = null,
  onUpdated = null,
  onShowToast = null
}) {
  const [supplierName, setSupplierName] = useState('');
  const [supplierEmailTo, setSupplierEmailTo] = useState('');
  const [supplierEmailCc, setSupplierEmailCc] = useState('');
  const [batchItemRows, setBatchItemRows] = useState([]);
  const [directoryList, setDirectoryList] = useState([]);
  const [followUpEnabled, setFollowUpEnabled] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [closingSupKey, setClosingSupKey] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const userEditedEmailRef = useRef(false);

  const recordIsTest = useMemo(
    () => Boolean(isTestMode || (report && isTestRecord(report))),
    [isTestMode, report]
  );

  const isUnpackedLineMode = Boolean(report?.is_unpacked_manifest_item);
  const parentManifestList = useMemo(() => {
    if (!report || isUnpackedLineMode) return [];
    const items = getReportManifestItems(report, allReports);
    return items.length > 1 ? items : [];
  }, [report, allReports, isUnpackedLineMode]);
  const isMultiItemBatchMode = !isUnpackedLineMode && parentManifestList.length > 1;

  useEffect(() => {
    if (!isOpen || !report) return;
    let active = true;
    userEditedEmailRef.current = false;
    const modeIsTest = Boolean(isTestMode || isTestRecord(report));
    const cachedDir = supplierDirectoryService.getCachedDirectory({ isTestMode: modeIsTest });
    setDirectoryList(Array.isArray(cachedDir) ? cachedDir : []);

    const defaultCfg = notificationService.getDailyFollowUpConfig();
    const party = resolveReportPartyAndEmails(report, catalogProducts, {
      directory: cachedDir,
      itemKey: report._itemKey || report.id,
      parentLineRef: report.manifest_line_index !== undefined ? report.manifest_line_index + 1 : undefined
    });
    const wf = computeFourStepWorkflow(report, catalogProducts, {
      directory: cachedDir,
      customerFollowUpDefaultEnabled: defaultCfg.customerFollowUpDefaultEnabled,
      testStepIntervalSeconds: modeIsTest ? defaultCfg.testStepIntervalSeconds : 0
    });
    const cleanSup = isPlaceholderSupplier(party.supplierName) ? '' : party.supplierName;
    const dirMatch = cleanSup ? supplierDirectoryService.findBySupplierName(cleanSup, { isTestMode: modeIsTest }) : null;

    setSupplierName(cleanSup);
    setSupplierEmailTo(party.supplierEmailTo || dirMatch?.email_to || '');
    setSupplierEmailCc(party.supplierEmailCc || dirMatch?.email_cc || '');
    setFollowUpEnabled(Boolean(wf.followUpEnabled));
    setFeedback(null);

    if (parentManifestList.length > 1 && !report.is_unpacked_manifest_item) {
      const metaFu = report.ai_document_metadata?.follow_up || {};
      const itemEmailsMap = metaFu.item_emails || {};
      const bySupMap = metaFu.by_supplier || {};
      setBatchItemRows(parentManifestList.map((it, idx) => {
        const iSupRaw = String(it.supplier_name || it.supplierName || it.supplier || '').trim();
        const iSupClean = (isPlaceholderSupplier(iSupRaw) || isMixedSuppliersSummary(iSupRaw)) ? '' : iSupRaw;
        const iKey = String(it.id || it.item_id || `line_${idx + 1}`).trim();
        const sKey = normalizeSupplierGroupKey(iSupClean);
        const dir = iSupClean ? supplierDirectoryService.findBySupplierName(iSupClean, { isTestMode: modeIsTest }) : null;
        const ov = itemEmailsMap[iKey] || itemEmailsMap[`line_${idx + 1}`] || {};
        const supEnt = sKey !== '__unassigned__' ? (bySupMap[sKey] || {}) : {};
        return {
          itemIndex: idx,
          itemKey: iKey,
          name: it.name || it.productName || `Item #${idx + 1}`,
          barcode: it.barcode || '',
          code: it.code || it.sku || '',
          quantity: Math.max(1, Number(it.quantity ?? it.qty) || 1),
          unit_name: it.unit_name || it.unit || 'pc',
          supplier_name: iSupClean,
          supplier_email_to: String(it.supplier_email_to || ov.supplier_email_to || supEnt.supplier_email_to || dir?.email_to || '').trim(),
          supplier_email_cc: String(it.supplier_email_cc || ov.supplier_email_cc || supEnt.supplier_email_cc || dir?.email_cc || '').trim(),
          emailManuallyEdited: false
        };
      }));
    } else {
      setBatchItemRows([]);
    }

    supplierDirectoryService.loadDirectory({ isTestMode: modeIsTest }).then((loadedDir) => {
      if (!active) return;
      if (Array.isArray(loadedDir)) setDirectoryList(loadedDir);
      if (cleanSup && !isMultiItemBatchMode && !userEditedEmailRef.current) {
        const freshMatch = supplierDirectoryService.findBySupplierName(cleanSup, { isTestMode: modeIsTest });
        if (freshMatch) {
          setSupplierEmailTo((prev) => prev.trim() ? prev : (freshMatch.email_to || ''));
          setSupplierEmailCc((prev) => prev.trim() ? prev : (freshMatch.email_cc || ''));
        }
      }
      if (isMultiItemBatchMode) {
        setBatchItemRows((prev) => prev.map((row) => {
          if (!row.supplier_name || row.emailManuallyEdited) return row;
          const freshMatch = supplierDirectoryService.findBySupplierName(row.supplier_name, { isTestMode: modeIsTest });
          if (!freshMatch) return row;
          return {
            ...row,
            supplier_email_to: row.supplier_email_to || freshMatch.email_to || '',
            supplier_email_cc: row.supplier_email_cc || freshMatch.email_cc || ''
          };
        }));
      }
    }).catch(() => { });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, report?.id, report?.rma_number, report?.manifest_line_index, isTestMode]);

  const batchPreviewReport = useMemo(() => {
    if (!report || !isMultiItemBatchMode) return report;
    const nextItems = parentManifestList.map((orig, idx) => {
      const row = batchItemRows[idx];
      if (!row) return orig;
      return {
        ...orig,
        supplier_name: row.supplier_name || 'Pending Assignment',
        supplier_email_to: row.supplier_email_to,
        supplier_email_cc: row.supplier_email_cc
      };
    });
    return {
      ...report,
      items: nextItems,
      ai_document_metadata: {
        ...(report.ai_document_metadata || {}),
        follow_up: {
          ...(report.ai_document_metadata?.follow_up || {}),
          enabled: followUpEnabled
        }
      }
    };
  }, [report, isMultiItemBatchMode, parentManifestList, batchItemRows, followUpEnabled]);

  const batchSupplierGroups = useMemo(() => {
    if (!isMultiItemBatchMode || !batchPreviewReport) return [];
    const defaultCfg = notificationService.getDailyFollowUpConfig();
    return groupReportItemsBySupplierForFollowUp(batchPreviewReport, allReports, catalogProducts, {
      directory: directoryList,
      customerFollowUpDefaultEnabled: defaultCfg.customerFollowUpDefaultEnabled,
      testStepIntervalSeconds: recordIsTest ? defaultCfg.testStepIntervalSeconds : 0
    });
  }, [isMultiItemBatchMode, batchPreviewReport, allReports, catalogProducts, directoryList, recordIsTest]);

  const wfPreview = useMemo(() => {
    if (!report) return null;
    const defaultCfg = notificationService.getDailyFollowUpConfig();
    if (isMultiItemBatchMode) {
      return computeFourStepWorkflow(batchPreviewReport, catalogProducts, {
        directory: directoryList,
        customerFollowUpDefaultEnabled: defaultCfg.customerFollowUpDefaultEnabled,
        testStepIntervalSeconds: recordIsTest ? defaultCfg.testStepIntervalSeconds : 0
      });
    }
    return computeFourStepWorkflow(
      {
        ...report,
        supplier_name: supplierName.trim() || report.supplier_name,
        supplier_email_to: supplierEmailTo,
        supplier_email_cc: supplierEmailCc,
        ai_document_metadata: {
          ...(report.ai_document_metadata || {}),
          follow_up: {
            ...(report.ai_document_metadata?.follow_up || {}),
            supplier_email_to: supplierEmailTo,
            supplier_email_cc: supplierEmailCc,
            enabled: followUpEnabled
          }
        }
      },
      catalogProducts,
      {
        directory: directoryList,
        supplierName: supplierName.trim(),
        supplierEmailTo: supplierEmailTo.trim(),
        supplierEmailCc: supplierEmailCc.trim(),
        emailCleared: !supplierEmailTo.trim(),
        customerFollowUpDefaultEnabled: defaultCfg.customerFollowUpDefaultEnabled,
        testStepIntervalSeconds: recordIsTest ? defaultCfg.testStepIntervalSeconds : 0
      }
    );
  }, [report, isMultiItemBatchMode, batchPreviewReport, supplierName, supplierEmailTo, supplierEmailCc, followUpEnabled, catalogProducts, directoryList, recordIsTest]);

  if (!isOpen || !report || !wfPreview) return null;

  const actorName = currentUser?.full_name || currentUser?.email || 'Admin';
  const sandboxEmail = notificationService.getTestSandboxEmail();

  const handleSupplierNameChange = (nextVal) => {
    const prevKey = normalizeSupplierGroupKey(supplierName);
    const nextKey = normalizeSupplierGroupKey(nextVal);
    setSupplierName(nextVal);
    const dirMatch = supplierDirectoryService.findBySupplierName(nextVal, { isTestMode: recordIsTest });
    if (dirMatch) {
      if (!userEditedEmailRef.current || prevKey !== nextKey) {
        setSupplierEmailTo(dirMatch.email_to || '');
        setSupplierEmailCc(dirMatch.email_cc || '');
      }
    } else if (prevKey !== nextKey && !userEditedEmailRef.current) {
      setSupplierEmailTo('');
      setSupplierEmailCc('');
    }
  };

  const handleBatchItemUpdate = (itemIndex, patch) => {
    setBatchItemRows((prev) => prev.map((row) => {
      if (row.itemIndex !== itemIndex) return row;
      if (patch.supplier_name !== undefined) {
        const nextSup = patch.supplier_name;
        const prevKey = normalizeSupplierGroupKey(row.supplier_name);
        const nextKey = normalizeSupplierGroupKey(nextSup);
        const dirMatch = nextSup ? supplierDirectoryService.findBySupplierName(nextSup, { isTestMode: recordIsTest }) : null;
        let nextTo = row.supplier_email_to;
        let nextCc = row.supplier_email_cc;
        if (!row.emailManuallyEdited || prevKey !== nextKey) {
          nextTo = dirMatch?.email_to || (prevKey !== nextKey ? '' : row.supplier_email_to);
          nextCc = dirMatch?.email_cc || (prevKey !== nextKey ? '' : row.supplier_email_cc);
        }
        return {
          ...row,
          supplier_name: nextSup,
          supplier_email_to: nextTo,
          supplier_email_cc: nextCc
        };
      }
      return { ...row, ...patch };
    }));
  };

  const handleSave = async () => {
    if (isMultiItemBatchMode) {
      setIsSaving(true);
      setFeedback(null);
      try {
        const itemUpdates = batchItemRows.map((row) => ({
          itemIndex: row.itemIndex,
          itemKey: row.itemKey,
          supplier_name: row.supplier_name.trim() || 'Pending Assignment',
          supplier_email_to: row.supplier_email_to.trim(),
          supplier_email_cc: row.supplier_email_cc.trim(),
          email_cleared: !row.supplier_email_to.trim()
        }));
        const saved = await catalogService.saveSupplierAndFollowUpSettings(report, {
          itemUpdates,
          followUpEnabled,
          actorName
        });
        setFeedback({
          type: 'success',
          message: `Saved ${batchSupplierGroups.length} supplier split lane(s) for ${report.rma_number}${followUpEnabled ? ' — separate per-supplier follow-ups & .xlsx attachments active.' : ' — Auto daily follow-up paused.'}`
        });
        onShowToast?.(`Updated per-supplier follow-up config for ${report.rma_number}`, 'success');
        onUpdated?.(saved);
        return saved;
      } catch (err) {
        setFeedback({ type: 'error', message: err?.message || 'Failed saving batch supplier follow-up details.' });
        return null;
      } finally {
        setIsSaving(false);
      }
    }

    const cleanSup = supplierName.trim();
    if (!cleanSup) {
      setFeedback({ type: 'error', message: 'Please enter a valid Supplier / Vendor Name.' });
      return null;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      const saved = await catalogService.saveSupplierAndFollowUpSettings(report, {
        supplier_name: cleanSup,
        supplier_email_to: supplierEmailTo.trim(),
        supplier_email_cc: supplierEmailCc.trim(),
        followUpEnabled,
        actorName,
        ...(isUnpackedLineMode ? {
          targetItemIndex: report.manifest_line_index,
          targetItemKey: report.id || report._itemKey,
          targetSupplierKey: normalizeSupplierGroupKey(report.supplier_name),
          applyToSupplierGroup: true
        } : {})
      });
      if (supplierEmailTo.trim() || supplierEmailCc.trim()) {
        await supplierDirectoryService.upsertFromSubmission(
          {
            supplier_name: cleanSup,
            supplier_email_to: supplierEmailTo.trim(),
            supplier_email_cc: supplierEmailCc.trim()
          },
          { isTestMode: recordIsTest }
        ).catch(() => { });
      }
      setFeedback({
        type: 'success',
        message: supplierEmailTo.trim()
          ? `Saved supplier "${cleanSup}" (${supplierEmailTo.trim()})${followUpEnabled ? ' — follow-up emails will route to supplier + internal team.' : ''}`
          : `Saved supplier "${cleanSup}" (no supplier email yet — internal reminder follow-ups active).`
      });
      onShowToast?.(`Updated supplier & email details for ${report.rma_number}`, 'success');
      onUpdated?.(saved);
      return saved;
    } catch (err) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to save supplier & email details.' });
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  const handleCloseCase = async (scopedSupplierKey = null, scopedSupplierLabel = null) => {
    setIsClosing(true);
    setClosingSupKey(scopedSupplierKey);
    setFeedback(null);
    try {
      const saved = await catalogService.closeFollowUpCase(report, {
        markPickedUp: true,
        reason: wfPreview.isSupplierStream ? 'Picked Up — Case Closed' : 'Handover Completed — Case Closed',
        actorName,
        targetSupplierKey: scopedSupplierKey
      });
      setFeedback({
        type: 'success',
        message: scopedSupplierLabel
          ? `Closed follow-up SLA for ${scopedSupplierLabel} (${report.rma_number}).`
          : `${report.rma_number} marked Picked Up / Case Closed. Countdown stopped.`
      });
      onShowToast?.(`${report.rma_number}${scopedSupplierLabel ? ` (${scopedSupplierLabel})` : ''} Case Closed.`, 'success');
      onUpdated?.(saved);
    } catch (err) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to close case.' });
    } finally {
      setIsClosing(false);
      setClosingSupKey(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-3xl ${isMultiItemBatchMode ? 'max-w-3xl' : 'max-w-2xl'} w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh]`}>
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-950/60 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-black px-2 py-0.5 rounded-lg bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-200">
                {report.rma_number}
              </span>
              {isUnpackedLineMode && (
                <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-200 border border-purple-300 dark:border-purple-700">
                  Line #{(report.manifest_line_index || 0) + 1} of {report.manifest_total_lines}
                </span>
              )}
              {isMultiItemBatchMode && (
                <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-200 border border-indigo-300 dark:border-indigo-700">
                  Split Into {batchSupplierGroups.length} Supplier Lane{batchSupplierGroups.length === 1 ? '' : 's'}
                </span>
              )}
              {recordIsTest && (
                <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                  <FlaskConical className="w-3 h-3" /> TEST ({sandboxEmail})
                </span>
              )}
            </div>
            <h3 className="text-base font-black text-slate-900 dark:text-white mt-1 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span>{isMultiItemBatchMode ? 'Batch Per-Supplier Follow-Up & Emails' : 'Set Supplier & Email Details'}</span>
            </h3>
            {!isMultiItemBatchMode && (
              <p className="text-xs text-slate-500 dark:text-slate-400 break-words">
                {report.name || report.barcode} • {formatQuantityWithPackSize(report.quantity || 1, report.unit_name || 'pc', report.pieces_per_case)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close supplier follow-up modal"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 text-xs">
          {isMultiItemBatchMode ? (
            <div className="space-y-3">
              <div className="p-3 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-[11px] text-indigo-950 dark:text-indigo-200 leading-relaxed">
                <strong>Mixed-Supplier Isolation Active:</strong> Daily follow-ups &amp; attached <code>.xlsx</code> workbooks automatically split per supplier below so no vendor ever sees sibling supplier items or pricing. Items without a supplier email yet still notify your internal team.
              </div>

              {/* Grouped Supplier Dispatch Preview Pills */}
              <div className="flex flex-wrap gap-1.5">
                {batchSupplierGroups.map((g) => (
                  <div
                    key={g.supplierKey}
                    className={`w-full sm:w-auto px-2.5 py-1.5 rounded-xl border text-[11px] flex items-center justify-between gap-2 ${
                      g.workflow.isClosed
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                        : g.internalOnly
                          ? 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800 text-sky-900 dark:text-sky-200'
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100'
                    }`}
                  >
                    <div className="min-w-0 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span className="font-black break-words">{g.supplierName}</span>
                      <span className="font-mono text-[10px] opacity-80 break-words">
                        ({g.items.length} item{g.items.length > 1 ? 's' : ''}) • {g.internalOnly ? 'Internal Only (No Email)' : g.toEmails[0]}
                      </span>
                    </div>
                    {!g.workflow.isClosed && batchSupplierGroups.length > 1 && (
                      <button
                        type="button"
                        disabled={isClosing || isSaving}
                        onClick={() => handleCloseCase(g.supplierKey, g.supplierName)}
                        className="px-2 py-0.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        {closingSupKey === g.supplierKey ? '...' : 'Close SLA'}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Per-Item Editable Rows */}
              <div className="space-y-2.5">
                {batchItemRows.map((row) => {
                  const hasEmail = Boolean(row.supplier_email_to.trim());
                  return (
                    <div
                      key={row.itemKey}
                      className="p-3 rounded-2xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Package className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          <span className="font-black text-slate-900 dark:text-white break-words">
                            #{row.itemIndex + 1}: {row.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px]">
                          <span className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-bold">
                            {row.quantity} {row.unit_name}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full font-bold border ${
                            hasEmail
                              ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800'
                              : 'bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-200 border-sky-200 dark:border-sky-800'
                          }`}>
                            {hasEmail ? 'Supplier + Internal' : 'Internal Only (Email Pending)'}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <div className="min-w-0">
                          <label className="block text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 mb-1">
                            Item #{row.itemIndex + 1} Supplier
                          </label>
                          <SupplierInput
                            name={`batchSup_${row.itemIndex}`}
                            value={row.supplier_name}
                            onChange={(val) => handleBatchItemUpdate(row.itemIndex, { supplier_name: val })}
                            placeholder="Supplier / Vendor Name..."
                            className="w-full"
                          />
                        </div>
                        <div className="min-w-0">
                          <label className="block text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 mb-1">
                            Supplier Email (To)
                          </label>
                          <input
                            type="text"
                            aria-label={`Item ${row.itemIndex + 1} Supplier Primary Email(s) (TO)`}
                            value={row.supplier_email_to}
                            onChange={(e) => handleBatchItemUpdate(row.itemIndex, { supplier_email_to: e.target.value, emailManuallyEdited: true })}
                            placeholder="claims@supplier.com (auto-fills)"
                            className="w-full px-2.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-xs font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                        <div className="min-w-0">
                          <label className="block text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 mb-1">
                            Supplier Email (CC)
                          </label>
                          <input
                            type="text"
                            aria-label={`Item ${row.itemIndex + 1} Supplier CC Email(s)`}
                            value={row.supplier_email_cc}
                            onChange={(e) => handleBatchItemUpdate(row.itemIndex, { supplier_email_cc: e.target.value, emailManuallyEdited: true })}
                            placeholder="Optional CC emails"
                            className="w-full px-2.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-xs font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              {/* Single-Item / Unpacked Focused Batch Item Form */}
              <div>
                <label className="block text-[11px] font-black uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-1.5">
                  Supplier / Vendor Name *
                </label>
                <SupplierInput
                  id="followup-modal-supplier-input"
                  name="followUpSupplierName"
                  value={supplierName}
                  onChange={handleSupplierNameChange}
                  placeholder="Search or type vendor / manufacturer (e.g. Mondelez, URC)..."
                  className="w-full"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-black uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-1.5">
                    Supplier Email (To)
                  </label>
                  <input
                    type="text"
                    aria-label="Supplier Primary Email(s) (TO)"
                    value={supplierEmailTo}
                    onChange={(e) => {
                      userEditedEmailRef.current = true;
                      setSupplierEmailTo(e.target.value);
                    }}
                    placeholder="claims@supplier.com, rtv@supplier.com"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-xs font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-black uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-1.5">
                    Supplier Email (CC) (Optional)
                  </label>
                  <input
                    type="text"
                    aria-label="Supplier CC Email(s) (Optional)"
                    value={supplierEmailCc}
                    onChange={(e) => {
                      userEditedEmailRef.current = true;
                      setSupplierEmailCc(e.target.value);
                    }}
                    placeholder="coordinator@supplier.com"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-xs font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {!supplierEmailTo.trim() && (
                <div className="p-2.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-[11px] text-sky-900 dark:text-sky-200 flex items-start gap-2">
                  <Mail className="w-4 h-4 shrink-0 text-sky-600 mt-0.5" />
                  <span>
                    <strong>Internal Employees Only (Supplier Email Pending):</strong> Daily follow-ups will still send reminders to your internal team until a Supplier Email (To) is added here or via <code>.xlsx</code> reply.
                  </span>
                </div>
              )}

              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                {isUnpackedLineMode
                  ? 'Edits update this item & matching supplier lane inside the parent batch without affecting sibling suppliers.'
                  : 'Saved values automatically populate future follow-ups alongside your saved internal recipients, and sync to the Supplier Emails Directory.'}
              </p>
            </>
          )}

          {/* 10-Calendar-Day SLA Toggle */}
          <label className="flex items-start gap-3 p-3.5 rounded-2xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/30 cursor-pointer">
            <input
              type="checkbox"
              aria-label="Auto Daily Follow-Up (10-Day SLA)"
              checked={followUpEnabled}
              onChange={(e) => setFollowUpEnabled(e.target.checked)}
              className="mt-0.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
            />
            <div className="space-y-0.5">
              <div className="font-black text-amber-950 dark:text-amber-200 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-600" />
                <span>Auto Daily Follow-Up (10-Day SLA): {followUpEnabled ? 'ON' : 'OFF'}</span>
              </div>
              <p className="text-[11px] text-amber-900/80 dark:text-amber-300/80 leading-relaxed">
                Starts a <strong>10-calendar-day pickup countdown</strong> (Asia/Manila). Sends daily pickup reminders with scoped <code>.xlsx</code> mirror &amp; proof photos, stops immediately when Picked Up / Closed, and marks overdue items <strong>Scrapped / Disposed</strong> after Day 10 (notifying internal employees only).
              </p>
            </div>
          </label>

          {/* Full 4-Step & 10-Day Timeline */}
          <FollowUpTimelineCard
            report={isMultiItemBatchMode ? batchPreviewReport : report}
            allReports={allReports}
            catalogProducts={catalogProducts}
            directory={directoryList}
            workflow={isMultiItemBatchMode ? null : wfPreview}
            focusedSupplierKey={isUnpackedLineMode ? normalizeSupplierGroupKey(supplierName) : null}
            compact={true}
          />

          {wfPreview.isExpiredAfter10Days && !wfPreview.isClosed && (
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-700 text-rose-900 dark:text-rose-200 flex items-start gap-2 font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <span>
                Overdue ({wfPreview.calendarDay} calendar days elapsed). Running Follow-Up Check will auto-dispose this RMA and notify internal employees only.
              </span>
            </div>
          )}

          {feedback && (
            <div className={`p-3 rounded-2xl border font-bold flex items-center gap-2 ${feedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200'
              : 'bg-rose-50 dark:bg-rose-950/50 border-rose-300 dark:border-rose-700 text-rose-900 dark:text-rose-200'
              }`}>
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>{feedback.message}</span>
            </div>
          )}
        </div>

        <div className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
          >
            Cancel
          </button>

          <div className="flex flex-wrap items-center gap-2">
            {!wfPreview.isClosed && (
              <button
                type="button"
                onClick={() => handleCloseCase(
                  isUnpackedLineMode ? normalizeSupplierGroupKey(supplierName || report.supplier_name) : null,
                  isUnpackedLineMode ? (supplierName || report.supplier_name) : null
                )}
                disabled={isClosing || isSaving}
                className="px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                {isClosing && !closingSupKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                <span>✓ Case Close</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || isClosing}
              className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>{isMultiItemBatchMode ? 'Save All Suppliers & Emails' : 'Save Supplier & Email'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
