import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Receipt,
  Package,
  User,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Printer,
  Plus,
  Minus,
  CheckCircle,
  Layers,
  Search
} from 'lucide-react';
import { creditMemoService } from '../services/creditMemoService';
import {
  hasAssignedSku,
  isTestRecord,
  formatDateYmd,
  formatPeso,
  computeItemPiecesAndValue,
  stripCreditMemoMetaTag,
  getCreditMemoConsolidatedItems,
  getCreditMemoRmaNumbers
} from '../utils/rmaHelpers';

const getReportKey = (r) => {
  if (!r) return '';
  if (r.id !== undefined && r.id !== null && String(r.id) !== '') return String(r.id);
  if (r.rma_number && r.barcode) return `${r.rma_number}_${r.barcode}`;
  return String(r.rma_number || '');
};

export default function CreditMemoModal({
  isOpen,
  onClose,
  report = null,
  reports = [],
  creditMemo = null,
  onSaved,
  onViewVoucher,
  currentUser,
  reportsList = [],
  savedProductsList = [],
  creditMemosCount = 0,
  onAssignSku,
  isTestMode = false
}) {
  const isEditing = Boolean(creditMemo && creditMemo.credit_memo_number);

  const prevIsOpenRef = useRef(false);
  const currentEditingRef = useRef(null);
  const prevTargetSignatureRef = useRef(null);

  const [selectionMode, setSelectionMode] = useState('single'); // 'single' | 'consolidated'
  const [selectedReportId, setSelectedReportId] = useState('');
  const [selectedConsolidatedKeys, setSelectedConsolidatedKeys] = useState([]);
  const [consolidatedSearch, setConsolidatedSearch] = useState('');

  const [quantity, setQuantity] = useState(1);
  const [unitName, setUnitName] = useState('pc');
  const [unitPrice, setUnitPrice] = useState('0.00');
  const [amount, setAmount] = useState('0.00');
  const [pullOutRef, setPullOutRef] = useState('');
  const [pullOutDate, setPullOutDate] = useState(() => formatDateYmd(new Date()));
  const [creditAmount, setCreditAmount] = useState('0.00');
  const [financeHead, setFinanceHead] = useState(creditMemo?.credit_issued_by || 'Analiza B. Benoza');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const preselectedBatch = useMemo(() => {
    const raw = Array.isArray(reports) && reports.length > 0 ? reports : [];
    const seen = new Set();
    return raw.filter((r) => {
      if (!r) return false;
      const k = getReportKey(r);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [reports]);

  // Clean customer inbound return reports list (filtering out manifest sub-items to avoid duplicates)
  const availableReports = useMemo(() => {
    if (!Array.isArray(reportsList)) return [];
    return reportsList.filter(r => {
      if (r.rma_type && r.rma_type !== 'customer_inbound') return false;
      if (r.parent_rma_id && reportsList.some(p => p.id === r.parent_rma_id && p.rma_number === r.rma_number)) {
        return false;
      }
      return true;
    });
  }, [reportsList]);

  // Fast map combining preselected + available reports for key resolution
  const reportByKeyMap = useMemo(() => {
    const map = new Map();
    [...availableReports, ...preselectedBatch, ...(report ? [report] : [])].forEach((r) => {
      if (!r) return;
      const k = getReportKey(r);
      if (k && !map.has(k)) map.set(k, r);
      if (r.rma_number && !map.has(`rma:${r.rma_number}`)) {
        map.set(`rma:${r.rma_number}`, r);
      }
    });
    return map;
  }, [availableReports, preselectedBatch, report]);

  // Active single report resolution
  const activeReport = useMemo(() => {
    if (selectedReportId) {
      if (report && getReportKey(report) === String(selectedReportId)) {
        return report;
      }
      const match = reportByKeyMap.get(String(selectedReportId)) || availableReports.find(
        r => String(r.id) === String(selectedReportId) || r.rma_number === selectedReportId
      );
      if (match) return match;
    }
    if (report) return report;
    if (preselectedBatch.length === 1) return preselectedBatch[0];
    if (!isEditing && availableReports.length > 0) {
      return availableReports[0];
    }
    return null;
  }, [report, preselectedBatch, selectedReportId, reportByKeyMap, availableReports, isEditing]);

  // Consolidated reports list selected by user
  const selectedConsolidatedReports = useMemo(() => {
    return selectedConsolidatedKeys
      .map((k) => reportByKeyMap.get(String(k)))
      .filter(Boolean);
  }, [selectedConsolidatedKeys, reportByKeyMap]);

  // Normalized line items for Consolidated Multi-RMA mode
  const consolidatedLineItems = useMemo(() => {
    const list = isEditing && creditMemo
      ? getCreditMemoConsolidatedItems(creditMemo)
      : [];
    if (isEditing && list.length > 1) {
      return list;
    }

    return selectedConsolidatedReports.map((rep) => {
      const bc = String(rep.barcode || '').trim();
      const matched = bc ? savedProductsList.find((p) => p.barcode && String(p.barcode).trim() === bc) : null;
      const qty = Math.max(1, Number(rep.quantity) || 1);
      const unitPr = Number(
        (Number(rep.price_with_vat ?? rep.price ?? matched?.price_with_vat ?? matched?.price ?? 0)).toFixed(2)
      );
      const lineAmt = Number((qty * unitPr).toFixed(2));
      const { totalPieces } = computeItemPiecesAndValue(rep, savedProductsList);
      return {
        key: getReportKey(rep),
        report: rep,
        report_id: rep.id || rep.report_id || null,
        rma_number: rep.rma_number || '',
        barcode: rep.barcode || 'N/A',
        sku: (rep.code && rep.code !== rep.barcode ? rep.code : (rep.sku && rep.sku !== rep.barcode ? rep.sku : (matched?.code || matched?.sku || ''))) || '',
        product_name: rep.name || rep.product_name || matched?.name || 'Item',
        supplier_name: rep.supplier_name || rep.supplierName || matched?.supplier_name || 'Savemore',
        ae_name: rep.ae_name || '',
        ae_email: rep.ae_email || '',
        quantity: qty,
        unit_name: rep.unit_name || rep.unit || 'pc',
        total_pieces: totalPieces,
        unit_price: unitPr,
        amount: lineAmt,
        hasSku: hasAssignedSku(rep, savedProductsList)
      };
    });
  }, [isEditing, creditMemo, selectedConsolidatedReports, savedProductsList]);

  const missingSkuConsolidatedItems = useMemo(() => {
    if (isEditing || selectionMode !== 'consolidated') return [];
    return consolidatedLineItems.filter((it) => !it.hasSku);
  }, [isEditing, selectionMode, consolidatedLineItems]);

  const isMissingSkuSingle = useMemo(() => {
    if (isEditing || selectionMode !== 'single') return false;
    const target = activeReport || report;
    if (!target) return false;
    return !hasAssignedSku(target, savedProductsList);
  }, [isEditing, selectionMode, activeReport, report, savedProductsList]);

  const hasValidationBlocker =
    selectionMode === 'consolidated'
      ? (selectedConsolidatedReports.length === 0 || missingSkuConsolidatedItems.length > 0)
      : isMissingSkuSingle;

  const filteredConsolidatedOptions = useMemo(() => {
    const q = consolidatedSearch.trim().toLowerCase();
    if (!q) return availableReports;
    return availableReports.filter((r) => (
      String(r.rma_number || '').toLowerCase().includes(q) ||
      String(r.name || r.product_name || '').toLowerCase().includes(q) ||
      String(r.barcode || '').toLowerCase().includes(q) ||
      String(r.code || r.sku || '').toLowerCase().includes(q) ||
      String(r.supplier_name || '').toLowerCase().includes(q) ||
      String(r.store_branch || '').toLowerCase().includes(q)
    ));
  }, [availableReports, consolidatedSearch]);

  // Synchronize all form data when a single RMA return ticket is selected
  const applyReportToForm = (rep) => {
    if (!rep) return;
    const qty = Math.max(1, Number(rep.quantity) || 1);
    const price = Number((Number(rep.price_with_vat ?? rep.price ?? 0)).toFixed(2));
    const gross = Number((qty * price).toFixed(2));

    setSelectedReportId(getReportKey(rep));
    setQuantity(qty);
    setUnitName(rep.unit_name || rep.unit || 'pc');
    setUnitPrice(price.toFixed(2));
    setAmount(gross.toFixed(2));
    setCreditAmount(gross.toFixed(2));

    const por = creditMemoService.generatePullOutReference(creditMemosCount);
    setPullOutRef(por);
    setPullOutDate(formatDateYmd(new Date()));
    setNotes('');
  };

  // Recalculate totals from selected consolidated line items when not editing
  useEffect(() => {
    if (!isOpen || isEditing || selectionMode !== 'consolidated') return;
    const grossSum = consolidatedLineItems.reduce((s, it) => s + Number(it.amount || 0), 0);
    const totalQty = consolidatedLineItems.reduce((s, it) => s + (Number(it.quantity) || 1), 0);
    setQuantity(totalQty || 1);
    setAmount(grossSum.toFixed(2));
    setCreditAmount(grossSum.toFixed(2));
  }, [isOpen, isEditing, selectionMode, consolidatedLineItems]);

  const handleReportDropdownChange = (newVal) => {
    setSelectedReportId(newVal);
    if (report && getReportKey(report) === String(newVal)) {
      applyReportToForm(report);
      return;
    }
    const found = reportByKeyMap.get(String(newVal)) || availableReports.find(r => String(r.id) === String(newVal) || r.rma_number === newVal);
    if (found) {
      applyReportToForm(found);
    }
  };

  // Sync state ONLY when modal opens or target report/reports/memo explicitly switches
  useEffect(() => {
    const isOpening = isOpen && !prevIsOpenRef.current;
    const memoChanged = isEditing && creditMemo?.credit_memo_number !== currentEditingRef.current;
    const currentSignature = preselectedBatch.length > 0
      ? preselectedBatch.map(getReportKey).join('|')
      : (report ? getReportKey(report) : '');
    const reportChanged = !isEditing && isOpen && currentSignature && currentSignature !== prevTargetSignatureRef.current;

    if (isOpening || memoChanged || reportChanged) {
      prevIsOpenRef.current = isOpen;
      currentEditingRef.current = creditMemo?.credit_memo_number || null;
      prevTargetSignatureRef.current = currentSignature || null;
      setErrorMessage(null);
      setIsLoading(false);
      setConsolidatedSearch('');

      if (isEditing && creditMemo) {
        const cmItems = getCreditMemoConsolidatedItems(creditMemo);
        const isMultiCm = cmItems.length > 1 || getCreditMemoRmaNumbers(creditMemo).length > 1;
        setSelectionMode(isMultiCm ? 'consolidated' : 'single');
        setSelectedReportId(creditMemo.report_id || creditMemo.rma_number || '');
        setQuantity(creditMemo.quantity || 1);
        setUnitName(creditMemo.unit_name || 'pc');
        setUnitPrice(Number(creditMemo.unit_price || 0).toFixed(2));
        setAmount(Number(creditMemo.amount || 0).toFixed(2));
        setPullOutRef(creditMemo.pull_out_ref || creditMemoService.generatePullOutReference(creditMemosCount));
        setPullOutDate(formatDateYmd(creditMemo.pull_out_date || new Date()) || formatDateYmd(new Date()));
        setCreditAmount(Number(creditMemo.credit_amount || creditMemo.amount || 0).toFixed(2));
        setFinanceHead(creditMemo.credit_issued_by || 'Analiza B. Benoza');
        setNotes(stripCreditMemoMetaTag(creditMemo.clean_notes ?? creditMemo.notes ?? ''));
      } else if (preselectedBatch.length > 1) {
        setSelectionMode('consolidated');
        const keys = preselectedBatch.map(getReportKey).filter(Boolean);
        setSelectedConsolidatedKeys(keys);
        setFinanceHead('Analiza B. Benoza');
        setPullOutRef(creditMemoService.generatePullOutReference(creditMemosCount));
        setPullOutDate(formatDateYmd(new Date()));
        setNotes('');
      } else {
        setSelectionMode('single');
        const initialReport = preselectedBatch[0] || report || (availableReports.length > 0 ? availableReports[0] : null);
        if (initialReport) {
          setSelectedConsolidatedKeys([getReportKey(initialReport)].filter(Boolean));
          applyReportToForm(initialReport);
        } else {
          setSelectedConsolidatedKeys([]);
          setPullOutRef(creditMemoService.generatePullOutReference(creditMemosCount));
          setPullOutDate(formatDateYmd(new Date()));
        }
        setFinanceHead('Analiza B. Benoza');
      }
    } else if (!isOpen) {
      prevIsOpenRef.current = false;
      currentEditingRef.current = null;
      prevTargetSignatureRef.current = null;
      setSelectedReportId('');
      setSelectedConsolidatedKeys([]);
    }
  }, [isOpen, creditMemo, isEditing, report, preselectedBatch, availableReports, creditMemosCount]);

  const updateCalculations = (newQty, newPrice) => {
    const q = Number(newQty) || 0;
    const p = parseFloat(newPrice) || 0;
    const gross = Number((q * p).toFixed(2));
    setAmount(gross.toFixed(2));
    setCreditAmount(gross.toFixed(2));
  };

  const handleQuantityChange = (val) => {
    if (val === '') {
      setQuantity('');
      updateCalculations(0, unitPrice);
      return;
    }
    const clean = val.replace(/[^\d]/g, '');
    if (clean === '') {
      setQuantity('');
      updateCalculations(0, unitPrice);
      return;
    }
    const parsed = parseInt(clean, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      setQuantity(parsed);
      updateCalculations(parsed, unitPrice);
    }
  };

  const handleQuantityBlur = () => {
    const parsed = parseInt(quantity, 10);
    const target = activeReport || report;
    const defaultQty = Math.max(1, Number(target?.quantity) || 1);
    const finalQty = (!isNaN(parsed) && parsed > 0) ? parsed : defaultQty;
    setQuantity(finalQty);
    updateCalculations(finalQty, unitPrice);
  };

  const stepQuantity = (delta) => {
    const current = parseInt(quantity, 10) || 1;
    const next = Math.max(1, current + delta);
    setQuantity(next);
    updateCalculations(next, unitPrice);
  };

  const handleUnitPriceChange = (val) => {
    if (val === '' || /^\d*\.?\d{0,2}$/.test(val)) {
      setUnitPrice(val);
      const num = parseFloat(val) || 0;
      updateCalculations(quantity, num);
    }
  };

  const handleUnitPriceBlur = () => {
    const p = Number((parseFloat(unitPrice) || 0).toFixed(2));
    setUnitPrice(p.toFixed(2));
    updateCalculations(quantity, p);
  };

  const handleAmountChange = (val) => {
    if (val === '' || /^\d*\.?\d{0,2}$/.test(val)) {
      setAmount(val);
      setCreditAmount(val);
    }
  };

  const handleAmountBlur = () => {
    const a = Number((parseFloat(amount) || 0).toFixed(2));
    setAmount(a.toFixed(2));
    setCreditAmount(a.toFixed(2));
  };

  const handleCreditAmountChange = (val) => {
    if (val === '' || /^\d*\.?\d{0,2}$/.test(val)) {
      setCreditAmount(val);
    }
  };

  const handleCreditAmountBlur = () => {
    const ca = Number((parseFloat(creditAmount) || 0).toFixed(2));
    setCreditAmount(ca.toFixed(2));
  };

  const applyCreditPercentage = (pct) => {
    const gross = parseFloat(amount) || 0;
    const val = Number((gross * pct).toFixed(2));
    setCreditAmount(val.toFixed(2));
  };

  const toggleConsolidatedItem = (key) => {
    setSelectedConsolidatedKeys((prev) => (
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    ));
  };

  const handleSubmit = async (e, thenPrint = false) => {
    e.preventDefault();

    if (selectionMode === 'consolidated' && !isEditing) {
      if (selectedConsolidatedReports.length === 0) {
        setErrorMessage('Please select at least one Customer Hub RMA to issue a Credit Memo.');
        return;
      }
      if (missingSkuConsolidatedItems.length > 0) {
        const listStr = missingSkuConsolidatedItems.map((m) => m.rma_number || m.barcode).join(', ');
        setErrorMessage(`Assign SKU required before issuing Consolidated Credit Memo for: ${listStr}`);
        return;
      }
    } else if (isMissingSkuSingle) {
      setErrorMessage("Cannot issue Finance Credit Memo for ₱0.00 or unassigned SKU. Please click 'Assign SKU' first to register the official item code and verified price in the catalog.");
      return;
    }

    const finalCredit = parseFloat(creditAmount);
    if (isNaN(finalCredit) || finalCredit < 0) {
      setErrorMessage('Please enter a valid Credit Amount (up to 2 decimals).');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      if (selectionMode === 'consolidated' && !isEditing && selectedConsolidatedReports.length > 1) {
        const rmaNumbersList = Array.from(new Set(
          consolidatedLineItems.map((it) => it.rma_number).filter(Boolean)
        ));
        const reportIdsList = consolidatedLineItems
          .map((it) => it.report_id)
          .filter((id) => id !== null && id !== undefined && /^\d+$/.test(String(id)))
          .map((id) => Number(id));
        const totalQty = consolidatedLineItems.reduce((s, it) => s + (Number(it.quantity) || 1), 0);
        const grossSum = Number(consolidatedLineItems.reduce((s, it) => s + Number(it.amount || 0), 0).toFixed(2));
        const firstItem = consolidatedLineItems[0];
        const uniqueSuppliers = Array.from(new Set(consolidatedLineItems.map((it) => it.supplier_name).filter(Boolean)));
        const uniqueAes = Array.from(new Set(consolidatedLineItems.map((it) => it.ae_name).filter(Boolean)));
        const uniqueAeEmails = Array.from(new Set(consolidatedLineItems.map((it) => it.ae_email).filter(Boolean)));
        const effectiveIsTest = Boolean(isTestMode || selectedConsolidatedReports.some((r) => isTestRecord(r)));

        const cleanConsolidatedPayloadItems = consolidatedLineItems.map((it) => ({
          report_id: it.report_id,
          rma_number: it.rma_number,
          barcode: it.barcode,
          sku: it.sku,
          product_name: it.product_name,
          supplier_name: it.supplier_name,
          quantity: it.quantity,
          unit_name: it.unit_name,
          unit_price: it.unit_price,
          amount: it.amount
        }));

        const payload = {
          is_test: effectiveIsTest,
          rma_number: rmaNumbersList.join(', '),
          report_id: reportIdsList[0] ?? null,
          consolidated_rma_numbers: rmaNumbersList,
          consolidated_report_ids: reportIdsList,
          consolidated_items: cleanConsolidatedPayloadItems,
          barcode: 'CONSOLIDATED',
          product_name: `Consolidated Credit Memo (${rmaNumbersList.length} RMAs)`,
          sku: null,
          supplier_name: uniqueSuppliers.length === 1 ? uniqueSuppliers[0] : (firstItem?.supplier_name || 'Savemore'),
          company: 'Wholesale Distribution',
          customer_ae_name: uniqueAes.join(', ') || 'N/A',
          customer_ae_email: uniqueAeEmails[0] || '',
          quantity: totalQty,
          unit_name: 'pc',
          unit_price: totalQty > 0 ? Number((grossSum / totalQty).toFixed(2)) : 0,
          amount: grossSum,
          pull_out_ref: pullOutRef.trim() || 'Warehouse Pull-Out',
          pull_out_date: pullOutDate,
          credit_amount: Number(finalCredit.toFixed(2)),
          credit_issued_by: (financeHead || '').trim() || 'Analiza B. Benoza',
          credit_issued_by_email: 'analiza@savemore.com',
          notes: notes.trim()
        };

        const res = await creditMemoService.createCreditMemo(payload);
        const resultMemo = res.memo;
        if (onSaved) onSaved(resultMemo);
        if (thenPrint && onViewVoucher) onViewVoucher(resultMemo);
        onClose();
        return;
      }

      // Single RMA mode OR editing existing Credit Memo
      const finalQty = parseInt(quantity, 10) || 1;
      if (finalQty <= 0) {
        setErrorMessage('Quantity must be at least 1 unit.');
        setIsLoading(false);
        return;
      }

      const target = activeReport || creditMemo || report || {};
      const effectiveIsTest = Boolean(
        isTestMode ||
        isTestRecord(target) ||
        isTestRecord(creditMemo) ||
        isTestRecord(report)
      );
      const payload = {
        is_test: effectiveIsTest,
        credit_memo_number: creditMemo?.credit_memo_number,
        rma_number: target?.rma_number,
        report_id: target?.id || target?.report_id,
        barcode: target?.barcode,
        product_name: isEditing ? (creditMemo?.product_name || target?.name) : (target?.name || target?.product_name),
        sku: target?.code || target?.sku,
        supplier_name: target?.supplier_name || 'Savemore',
        company: 'Wholesale Distribution',
        customer_ae_name: target?.ae_name || target?.customer_ae_name || 'N/A',
        customer_ae_email: target?.ae_email || target?.customer_ae_email || '',
        quantity: finalQty,
        unit_name: unitName || target?.unit_name || 'pc',
        unit_price: Number(Number(unitPrice || 0).toFixed(2)),
        amount: Number(Number(amount || 0).toFixed(2)),
        pull_out_ref: pullOutRef.trim() || 'Warehouse Pull-Out',
        pull_out_date: pullOutDate,
        credit_amount: Number(finalCredit.toFixed(2)),
        credit_issued_by: (financeHead || '').trim() || 'Analiza B. Benoza',
        credit_issued_by_email: 'analiza@savemore.com',
        notes: notes.trim()
      };

      let resultMemo = null;
      if (isEditing) {
        const res = await creditMemoService.updateCreditMemo(creditMemo.credit_memo_number, payload);
        resultMemo = res.memo;
      } else {
        const res = await creditMemoService.createCreditMemo(payload);
        resultMemo = res.memo;
      }

      if (onSaved) onSaved(resultMemo);
      if (thenPrint && onViewVoucher) onViewVoucher(resultMemo);
      onClose();
    } catch (err) {
      console.error('Credit Memo save error:', err);
      setErrorMessage(err.message || 'Failed to save Credit Memo.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const targetReport = activeReport || creditMemo || report || {};
  const currentAeName = targetReport.ae_name || targetReport.customer_ae_name || 'Unassigned';
  const isConsolidatedActive = selectionMode === 'consolidated' && (consolidatedLineItems.length > 1 || selectedConsolidatedReports.length > 1);

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-2xl w-full flex flex-col max-h-[92dvh] sm:max-h-[92vh] overflow-hidden my-0 sm:my-auto">
        <div className="bottom-sheet-handle sm:hidden" />

        {/* Header */}
        <div className="p-4 sm:p-6 pb-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 rounded-2xl shadow-inner">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  {isEditing
                    ? 'Edit Finance Credit Memo'
                    : isConsolidatedActive
                      ? `Issue Consolidated Credit Memo (${selectedConsolidatedReports.length} RMAs)`
                      : 'Issue Finance Credit Memo'}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                  {isEditing ? creditMemo.credit_memo_number : 'New Voucher'}
                </span>
                {Boolean(isTestMode || isTestRecord(creditMemo) || isTestRecord(activeReport) || isTestRecord(report) || selectedConsolidatedReports.some((r) => isTestRecord(r))) && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                    🧪 Sandbox Test
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isConsolidatedActive
                  ? 'Bundle multiple Customer Inbound RMAs onto ONE official Credit Memorandum'
                  : `Generate official credit deduction linked to return ticket ${targetReport.rma_number || ''}`}
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

        {/* Scrollable Form Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">

          {errorMessage && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 rounded-2xl text-xs font-semibold flex items-center gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Mode Toggle when creating: Single RMA vs Consolidate Multiple RMAs */}
          {!isEditing && availableReports.length > 1 && (
            <div className="flex items-center justify-between gap-2 p-2.5 bg-slate-100 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
                <Layers className="w-4 h-4 text-emerald-600" />
                <span>Issuance Mode:</span>
              </div>
              <div className="inline-flex rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 p-0.5 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setSelectionMode('single')}
                  className={`px-3 py-1 rounded-lg text-xs font-black transition-colors cursor-pointer ${
                    selectionMode === 'single'
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  Single RMA Ticket
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectionMode('consolidated');
                    if (selectedConsolidatedKeys.length === 0 && activeReport) {
                      setSelectedConsolidatedKeys([getReportKey(activeReport)]);
                    }
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-black transition-colors cursor-pointer ${
                    selectionMode === 'consolidated'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  🔗 Consolidate Multiple RMAs ({selectedConsolidatedKeys.length})
                </button>
              </div>
            </div>
          )}

          {/* CONSOLIDATED MULTI-RMA SELECTOR & ITEMIZED TABLE */}
          {selectionMode === 'consolidated' ? (
            <div className="space-y-3">
              {!isEditing && (
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-black text-slate-800 dark:text-slate-200">
                      Select Customer Inbound RMAs to Bundle ({selectedConsolidatedReports.length} selected)
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const eligibleKeys = availableReports
                            .filter((r) => hasAssignedSku(r, savedProductsList))
                            .map(getReportKey);
                          setSelectedConsolidatedKeys(eligibleKeys);
                        }}
                        className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                      >
                        Select All With SKU
                      </button>
                      {selectedConsolidatedKeys.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setSelectedConsolidatedKeys([])}
                          className="text-[11px] font-bold text-slate-500 hover:text-rose-600 cursor-pointer"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      value={consolidatedSearch}
                      onChange={(e) => setConsolidatedSearch(e.target.value)}
                      placeholder="Filter RMAs by RMA#, item, SKU, or branch..."
                      className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs"
                    />
                  </div>

                  <div className="max-h-40 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900">
                    {filteredConsolidatedOptions.map((r) => {
                      const k = getReportKey(r);
                      const checked = selectedConsolidatedKeys.includes(k);
                      const validSku = hasAssignedSku(r, savedProductsList);
                      return (
                        <label
                          key={k}
                          className={`flex items-center justify-between gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                            checked ? 'bg-emerald-50/60 dark:bg-emerald-950/25' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleConsolidatedItem(k)}
                              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            <div className="min-w-0">
                              <div className="font-mono font-bold text-blue-700 dark:text-blue-300 truncate">
                                {r.rma_number} {!validSku && <span className="text-amber-600 text-[10px]">(Needs SKU)</span>}
                              </div>
                              <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                                {r.name || r.barcode} • Qty: {r.quantity || 1} {r.unit_name || 'pc'} • {r.store_branch || r.supplier_name || 'Customer'}
                              </div>
                            </div>
                          </div>
                          <span className="font-mono font-bold text-slate-700 dark:text-slate-200 shrink-0">
                            {formatPeso((Number(r.quantity) || 1) * Number(r.price_with_vat ?? r.price ?? 0))}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Validation Guard Listing Any Item Missing SKU */}
              {missingSkuConsolidatedItems.length > 0 && (
                <div className="p-3.5 bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 rounded-2xl space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <div className="font-black text-amber-900 dark:text-amber-200">
                        Financial Validation Guard: {missingSkuConsolidatedItems.length} Selected RMA(s) Missing SKU or Price
                      </div>
                      <p className="text-[11px] text-amber-800 dark:text-amber-300">
                        Every RMA included on a Credit Memo must have an assigned SKU and verified unit price. Click &apos;Assign SKU&apos; on each flagged item below:
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {missingSkuConsolidatedItems.map((mItem) => (
                      <div
                        key={mItem.key || mItem.rma_number}
                        className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 text-xs"
                      >
                        <div className="min-w-0 truncate">
                          <span className="font-mono font-bold text-amber-800 dark:text-amber-300">{mItem.rma_number}</span>
                          {' — '}
                          <span className="text-slate-700 dark:text-slate-300">{mItem.product_name} ({mItem.barcode})</span>
                        </div>
                        {onAssignSku && (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onAssignSku(mItem.report);
                            }}
                            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                          >
                            <Package className="w-3 h-3" />
                            <span>Assign SKU</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Itemized Breakdown Table of Bundled RMAs */}
              {consolidatedLineItems.length > 0 && (
                <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden bg-white dark:bg-slate-900">
                  <div className="px-3.5 py-2 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between text-[11px] font-black text-slate-700 dark:text-slate-200">
                    <span>Itemized Consolidated Breakdown ({consolidatedLineItems.length} RMA{consolidatedLineItems.length > 1 ? 's' : ''})</span>
                    <span className="font-mono text-emerald-700 dark:text-emerald-400">
                      Total Gross: {formatPeso(amount)}
                    </span>
                  </div>
                  <div className="overflow-x-auto max-h-48">
                    <table className="w-full text-left text-[11px] border-collapse">
                      <thead className="bg-slate-50 dark:bg-slate-800/70 text-[10px] font-black uppercase text-slate-500 border-b border-slate-200 dark:border-slate-700 sticky top-0">
                        <tr>
                          <th className="py-1.5 px-2.5">RMA #</th>
                          <th className="py-1.5 px-2.5">Product / Barcode / SKU</th>
                          <th className="py-1.5 px-2.5 text-center">Qty</th>
                          <th className="py-1.5 px-2.5 text-right">Unit Price</th>
                          <th className="py-1.5 px-2.5 text-right">Line Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {consolidatedLineItems.map((it, i) => (
                          <tr key={it.rma_number || i}>
                            <td className="py-1.5 px-2.5 font-mono font-bold text-blue-700 dark:text-blue-300 whitespace-nowrap">
                              {it.rma_number}
                            </td>
                            <td className="py-1.5 px-2.5">
                              <div className="font-bold text-slate-900 dark:text-white leading-tight">{it.product_name}</div>
                              <div className="font-mono text-[10px] text-slate-500">
                                {it.barcode}{it.sku ? ` • SKU: ${it.sku}` : ''}
                              </div>
                            </td>
                            <td className="py-1.5 px-2.5 text-center font-mono font-bold whitespace-nowrap">
                              {it.quantity} {it.unit_name}
                            </td>
                            <td className="py-1.5 px-2.5 text-right font-mono whitespace-nowrap">
                              {formatPeso(it.unit_price)}
                            </td>
                            <td className="py-1.5 px-2.5 text-right font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">
                              {formatPeso(it.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Single Ticket Picker */}
              {!isEditing && (availableReports.length > 0 || report) && (
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Select Linked RMA Return Ticket *
                  </label>
                  <select
                    value={selectedReportId || getReportKey(activeReport)}
                    onChange={(e) => handleReportDropdownChange(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-600 focus:bg-white dark:focus:bg-slate-800"
                  >
                    {report && (report.is_manifest_child || !availableReports.some(r => getReportKey(r) === getReportKey(report))) && (
                      <option value={getReportKey(report)}>
                        {report.rma_number} — {report.name || report.product_name || report.barcode} (Line Item: {report.quantity || 1} {report.unit_name || 'pc'} • {report.supplier_name || 'Savemore'})
                      </option>
                    )}
                    {availableReports.map(r => (
                      <option key={getReportKey(r)} value={getReportKey(r)}>
                        {r.rma_number} — {r.name || r.barcode} (Qty: {r.quantity || 1} • {r.supplier_name || 'Warehouse'})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Linked RMA Report Summary Strip */}
              <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono font-bold text-blue-700 dark:text-blue-400">
                    Ticket: {targetReport.rma_number || 'N/A'}
                  </span>
                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                    Supplier: {targetReport.supplier_name || 'Savemore'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-black text-slate-900 dark:text-white text-xs sm:text-sm">
                      {targetReport.name || targetReport.product_name || 'Item'}
                    </div>
                    <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      Barcode: {targetReport.barcode || 'N/A'} {targetReport.code || targetReport.sku ? `• SKU: ${targetReport.code || targetReport.sku}` : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 block uppercase font-bold">Assigned Customer AE</span>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      {currentAeName}
                    </span>
                  </div>
                </div>
              </div>

              {/* Financial Validation Guard for Single Ticket */}
              {isMissingSkuSingle && (
                <div className="p-3.5 bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 rounded-2xl flex items-start justify-between gap-3 animate-in fade-in">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-black text-amber-900 dark:text-amber-200">
                        Financial Validation &amp; Safety Guard
                      </div>
                      <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-0.5 leading-relaxed">
                        Cannot issue Finance Credit Memo for ₱0.00 or unassigned SKU. Please click &apos;Assign SKU&apos; first to set the official item code and verified price in the catalog.
                      </p>
                    </div>
                  </div>
                  {onAssignSku && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onAssignSku(targetReport);
                      }}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm shrink-0 cursor-pointer"
                    >
                      <Package className="w-3.5 h-3.5" />
                      <span>Assign SKU Now</span>
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          <form id="credit-memo-form" onSubmit={(e) => handleSubmit(e, false)} className="space-y-3.5 text-xs">

            {/* ROW 1: Quantity, Unit, Unit Price, Amount (shown in single mode; consolidated mode auto-sums from items) */}
            {selectionMode === 'single' && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Quantity *
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => stepQuantity(-1)}
                      className="w-8 h-9 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 transition-colors cursor-pointer"
                      title="Decrease Quantity"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>

                    <div className="relative flex-1">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        required
                        value={quantity}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => handleQuantityChange(e.target.value)}
                        onBlur={handleQuantityBlur}
                        placeholder="1"
                        className="w-full px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-black font-mono text-center text-slate-900 dark:text-white focus:outline-none focus:border-emerald-600 focus:bg-white dark:focus:bg-slate-800"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => stepQuantity(1)}
                      className="w-8 h-9 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 transition-colors cursor-pointer"
                      title="Increase Quantity"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Unit *
                  </label>
                  <select
                    value={unitName}
                    onChange={(e) => setUnitName(e.target.value)}
                    className="w-full px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-600 focus:bg-white dark:focus:bg-slate-800 cursor-pointer h-9"
                  >
                    <option value="pc">pc (piece)</option>
                    <option value="case">case</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Unit Price (₱ w/ VAT)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={unitPrice}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => handleUnitPriceChange(e.target.value)}
                    onBlur={handleUnitPriceBlur}
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-600 focus:bg-white dark:focus:bg-slate-800 h-9"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Gross Amount (₱)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => handleAmountChange(e.target.value)}
                    onBlur={handleAmountBlur}
                    className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-600 h-9"
                  />
                </div>
              </div>
            )}

            {/* ROW 2: Pull Out Reference & Pull Out Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Pull Out Reference / Receipt # *
                  </label>
                  <button
                    type="button"
                    onClick={() => setPullOutRef(creditMemoService.generatePullOutReference(creditMemosCount))}
                    className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 flex items-center gap-1 font-semibold cursor-pointer"
                    title="Generate a new POR reference code"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Regenerate POR</span>
                  </button>
                </div>
                <input
                  type="text"
                  required
                  value={pullOutRef}
                  onChange={(e) => setPullOutRef(e.target.value)}
                  placeholder="e.g. POR-2026-0001-1A4D"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-600 focus:bg-white dark:focus:bg-slate-800"
                />
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Pull Out Date (YYYY-MM-DD) *
                  </label>
                  {pullOutDate && (
                    <span className="text-[10px] font-mono font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                      ISO (YYYY-MM-DD): {formatDateYmd(pullOutDate) || pullOutDate}
                    </span>
                  )}
                </div>
                <input
                  type="date"
                  required
                  value={pullOutDate}
                  onChange={(e) => setPullOutDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-600 focus:bg-white dark:focus:bg-slate-800"
                />
              </div>
            </div>

            {/* ROW 3: FINAL APPROVED CREDIT AMOUNT (Highlighted Card) */}
            <div className="p-4 bg-emerald-50/80 dark:bg-emerald-950/40 border-2 border-emerald-300 dark:border-emerald-800/80 rounded-2xl space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-xs font-black uppercase text-emerald-950 dark:text-emerald-300 tracking-wider">
                    Total Credit Amount (₱) *
                  </label>
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                    Approved financial deduction credited to customer account
                  </p>
                </div>

                {/* Quick adjustment buttons */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => applyCreditPercentage(1.0)}
                    className="px-2 py-1 bg-white dark:bg-slate-800 hover:bg-emerald-100 dark:hover:bg-slate-700 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 rounded-lg text-[10px] font-black transition-colors cursor-pointer"
                    title="Grant 100% full credit"
                  >
                    100% Full
                  </button>
                  <button
                    type="button"
                    onClick={() => applyCreditPercentage(0.9)}
                    className="px-2 py-1 bg-white dark:bg-slate-800 hover:bg-emerald-100 dark:hover:bg-slate-700 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 rounded-lg text-[10px] font-black transition-colors cursor-pointer"
                    title="Apply 10% handling fee deduction"
                  >
                    90% (-10%)
                  </button>
                </div>
              </div>

              <div className="relative">
                <span className="absolute left-3.5 top-2.5 text-base font-black text-emerald-700 dark:text-emerald-400">
                  ₱
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  value={creditAmount}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => handleCreditAmountChange(e.target.value)}
                  onBlur={handleCreditAmountBlur}
                  placeholder="0.00"
                  className="w-full pl-8 pr-4 py-2.5 bg-white dark:bg-slate-900 border-2 border-emerald-400 dark:border-emerald-600 rounded-xl text-base font-black font-mono text-emerald-900 dark:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
            </div>

            {/* ROW 4: Authorized Finance Head */}
            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl space-y-1.5 text-xs">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Authorized Finance Head / Approved By *
              </label>
              <div className="flex items-center gap-2">
                <div className="p-2 bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 rounded-xl shrink-0">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  required
                  value={financeHead}
                  onChange={(e) => setFinanceHead(e.target.value)}
                  placeholder="e.g. Analiza B. Benoza"
                  className="flex-1 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-500"
                />
                <span className="text-[10px] font-black px-2 py-1 bg-purple-50 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 rounded-lg shrink-0 uppercase">
                  Finance Head
                </span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                Authorized financial signatory appearing on the credit memo voucher and official audit records.
              </p>
            </div>

            {/* Accounting Notes / Remarks */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Accounting Remarks / Audit Notes (Optional)
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Approved pull-out deduction against Invoice #INV-2026-9042..."
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-600 focus:bg-white dark:focus:bg-slate-800"
              />
            </div>

          </form>
        </div>

        {/* Pinned Footer with Actions */}
        <div className="p-4 sm:px-6 pb-safe bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0 flex-wrap sm:flex-nowrap">
          <button
            type="button"
            onClick={onClose}
            className="touch-target px-4 py-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white text-xs font-bold cursor-pointer"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <button
              type="button"
              onClick={(e) => handleSubmit(e, true)}
              disabled={isLoading || hasValidationBlocker}
              className="touch-target px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-95"
              title={hasValidationBlocker ? "Assign SKU to all selected RMAs first" : "Save Credit Memo and open printable official voucher"}
            >
              <Printer className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 shrink-0" />
              <span className="truncate">Save &amp; View Voucher</span>
            </button>

            <button
              type="submit"
              form="credit-memo-form"
              disabled={isLoading || hasValidationBlocker}
              className="touch-target px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold flex items-center gap-1.5 shadow-md shadow-emerald-600/20 transition-all cursor-pointer active:scale-95"
              title={hasValidationBlocker ? "Assign SKU to all selected RMAs first" : "Issue Credit Memo"}
            >
              {isLoading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle className="w-3.5 h-3.5" />
              )}
              <span className="truncate">
                {isEditing
                  ? 'Update Credit Memo'
                  : isConsolidatedActive
                    ? `Issue Consolidated CM (${selectedConsolidatedReports.length} RMAs)`
                    : 'Issue Credit Memo'}
              </span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
