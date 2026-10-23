import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  X, 
  Receipt, 
  DollarSign, 
  Package, 
  User, 
  Calendar, 
  CheckCircle, 
  AlertCircle, 
  RefreshCw, 
  Printer, 
  Plus,
  Minus,
  FileText, 
  Building2,
  Percent
} from 'lucide-react';
import { creditMemoService } from '../services/creditMemoService';

export default function CreditMemoModal({
  isOpen,
  onClose,
  report,
  creditMemo,
  onSaved,
  onViewVoucher,
  currentUser,
  reportsList = [],
  creditMemosCount = 0
}) {
  const isEditing = Boolean(creditMemo && creditMemo.credit_memo_number);

  const prevIsOpenRef = useRef(false);
  const currentEditingRef = useRef(null);

  const [selectedReportId, setSelectedReportId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState('0.00');
  const [amount, setAmount] = useState('0.00');
  const [pullOutRef, setPullOutRef] = useState('');
  const [pullOutDate, setPullOutDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [creditAmount, setCreditAmount] = useState('0.00');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Active report resolution: prioritize user-selected report from dropdown, then passed report, then first report
  const activeReport = useMemo(() => {
    if (selectedReportId && reportsList.length > 0) {
      const match = reportsList.find(r => String(r.id) === String(selectedReportId) || r.rma_number === selectedReportId);
      if (match) return match;
    }
    if (report) return report;
    if (!isEditing && reportsList.length > 0) {
      return reportsList[0];
    }
    return null;
  }, [report, selectedReportId, reportsList, isEditing]);

  // Synchronize all form data when an RMA return ticket is selected
  const applyReportToForm = (rep) => {
    if (!rep) return;
    const qty = Math.max(1, Number(rep.quantity) || 1);
    const price = Number((Number(rep.price_with_vat ?? rep.price ?? 0)).toFixed(2));
    const gross = Number((qty * price).toFixed(2));

    setQuantity(qty);
    setUnitPrice(price.toFixed(2));
    setAmount(gross.toFixed(2));
    setCreditAmount(gross.toFixed(2));

    // Standardized POR: POR-2026-0001-1A4D
    const por = creditMemoService.generatePullOutReference(creditMemosCount);
    setPullOutRef(por);
    setPullOutDate(new Date().toISOString().split('T')[0]);
    setNotes('');
  };

  // Immediate handler when user picks an item from the dropdown: ALL data updates immediately
  const handleReportDropdownChange = (newVal) => {
    setSelectedReportId(newVal);
    const found = reportsList.find(r => String(r.id) === String(newVal) || r.rma_number === newVal);
    if (found) {
      applyReportToForm(found);
    }
  };

  // Sync state ONLY when modal opens or target memo explicitly switches (Prevents 3.5s background polling resets!)
  useEffect(() => {
    const isOpening = isOpen && !prevIsOpenRef.current;
    const memoChanged = isEditing && creditMemo?.credit_memo_number !== currentEditingRef.current;

    if (isOpening || memoChanged) {
      prevIsOpenRef.current = isOpen;
      currentEditingRef.current = creditMemo?.credit_memo_number || null;
      setErrorMessage(null);
      setIsLoading(false);

      if (isEditing && creditMemo) {
        setSelectedReportId(creditMemo.report_id || creditMemo.rma_number || '');
        setQuantity(creditMemo.quantity || 1);
        setUnitPrice(Number(creditMemo.unit_price || 0).toFixed(2));
        setAmount(Number(creditMemo.amount || 0).toFixed(2));
        setPullOutRef(creditMemo.pull_out_ref || creditMemoService.generatePullOutReference(creditMemosCount));
        setPullOutDate(creditMemo.pull_out_date || new Date().toISOString().split('T')[0]);
        setCreditAmount(Number(creditMemo.credit_amount || creditMemo.amount || 0).toFixed(2));
        setNotes(creditMemo.notes || '');
      } else {
        const initialReport = report || (reportsList.length > 0 ? reportsList[0] : null);
        if (initialReport) {
          setSelectedReportId(initialReport.id || initialReport.rma_number || '');
          applyReportToForm(initialReport);
        }
      }
    } else if (!isOpen) {
      prevIsOpenRef.current = false;
      currentEditingRef.current = null;
    }
  }, [isOpen, creditMemo, isEditing, report, reportsList, creditMemosCount]);

  const updateCalculations = (newQty, newPrice) => {
    const q = Number(newQty) || 0;
    const p = parseFloat(newPrice) || 0;
    const gross = Number((q * p).toFixed(2));
    setAmount(gross.toFixed(2));
    setCreditAmount(gross.toFixed(2));
  };

  // Quantity handlers (smooth typing, backspace deletes properly, stepper buttons)
  const handleQuantityChange = (val) => {
    if (val === '') {
      setQuantity('');
      return;
    }
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      setQuantity(parsed);
      updateCalculations(parsed, unitPrice);
    }
  };

  const handleQuantityBlur = () => {
    const q = Math.max(1, parseInt(quantity, 10) || 1);
    setQuantity(q);
    updateCalculations(q, unitPrice);
  };

  const stepQuantity = (delta) => {
    const current = parseInt(quantity, 10) || 1;
    const next = Math.max(1, current + delta);
    setQuantity(next);
    updateCalculations(next, unitPrice);
  };

  // Price handlers with strict 2-decimal limit
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

  const handleSubmit = async (e, thenPrint = false) => {
    e.preventDefault();
    const finalQty = parseInt(quantity, 10) || 1;
    if (finalQty <= 0) {
      setErrorMessage('Quantity must be at least 1 unit.');
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
      const target = activeReport || creditMemo || report || {};
      const payload = {
        credit_memo_number: creditMemo?.credit_memo_number,
        rma_number: target?.rma_number,
        report_id: target?.id || target?.report_id,
        barcode: target?.barcode,
        product_name: target?.name || target?.product_name,
        sku: target?.code || target?.sku,
        supplier_name: target?.supplier_name || 'Savemore',
        company: 'Wholesale Distribution',
        customer_ae_name: target?.ae_name || target?.customer_ae_name || 'N/A',
        customer_ae_email: target?.ae_email || target?.customer_ae_email || '',
        quantity: finalQty,
        unit_name: target?.unit_name || 'pc',
        unit_price: Number(Number(unitPrice || 0).toFixed(2)),
        amount: Number(Number(amount || 0).toFixed(2)),
        pull_out_ref: pullOutRef.trim() || 'Warehouse Pull-Out',
        pull_out_date: pullOutDate,
        credit_amount: Number(finalCredit.toFixed(2)),
        credit_issued_by: 'Analiza B. Benoza (Finance Head)',
        credit_issued_by_email: 'finance@a2z2go.net',
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

      if (thenPrint && onViewVoucher) {
        onViewVoucher(resultMemo);
      }
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


  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-xl w-full flex flex-col max-h-[92dvh] sm:max-h-[92vh] overflow-hidden my-0 sm:my-auto">
        {/* Mobile Drag Indicator */}
        <div className="bottom-sheet-handle sm:hidden" />
        
        {/* Header */}
        <div className="p-4 sm:p-6 pb-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 rounded-2xl shadow-inner">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  {isEditing ? 'Edit Finance Credit Memo' : 'Issue Finance Credit Memo'}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                  {isEditing ? creditMemo.credit_memo_number : 'New Voucher'}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Generate official credit deduction linked to return ticket {targetReport.rma_number || ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
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

          {/* Ticket Picker (Always available when creating so user can switch tickets and sync all data) */}
          {!isEditing && reportsList.length > 0 && (
            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Select Linked RMA Return Ticket *
              </label>
              <select
                value={selectedReportId || activeReport?.id || activeReport?.rma_number || ''}
                onChange={(e) => handleReportDropdownChange(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-600 focus:bg-white dark:focus:bg-slate-800"
              >
                {reportsList.map(r => (
                  <option key={r.id || r.rma_number} value={r.id || r.rma_number}>
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

          <form id="credit-memo-form" onSubmit={(e) => handleSubmit(e, false)} className="space-y-3.5 text-xs">
            
            {/* ROW 1: Quantity, Unit Price, Amount */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                      type="number"
                      min="1"
                      required
                      value={quantity}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => handleQuantityChange(e.target.value)}
                      onBlur={handleQuantityBlur}
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
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-600 focus:bg-white dark:focus:bg-slate-800"
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
                  className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-600"
                />
              </div>
            </div>

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
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Pull Out Date *
                </label>
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
                    Credit Amount (₱) *
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
                    className="px-2 py-1 bg-white dark:bg-slate-800 hover:bg-emerald-100 dark:hover:bg-slate-700 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 rounded-lg text-[10px] font-black transition-colors"
                    title="Grant 100% full credit"
                  >
                    100% Full
                  </button>
                  <button
                    type="button"
                    onClick={() => applyCreditPercentage(0.9)}
                    className="px-2 py-1 bg-white dark:bg-slate-800 hover:bg-emerald-100 dark:hover:bg-slate-700 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 rounded-lg text-[10px] font-black transition-colors"
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

            {/* ROW 4: Credit Issued By & Issuer Role */}
            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-2 bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 rounded-xl shrink-0">
                  <User className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-slate-900 dark:text-white truncate">
                    Authorized Finance Head: <strong className="text-purple-700 dark:text-purple-300">Analiza B. Benoza</strong>
                  </div>
                  <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    finance@a2z2go.net • Finance Head
                  </div>
                </div>
              </div>
              <span className="text-[10px] font-black px-2 py-1 bg-purple-50 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 rounded-lg shrink-0 uppercase">
                Authorized Finance
              </span>
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
            className="touch-target px-4 py-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white text-xs font-bold"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <button
              type="button"
              onClick={(e) => handleSubmit(e, true)}
              disabled={isLoading}
              className="touch-target px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-95"
              title="Save Credit Memo and open printable official voucher"
            >
              <Printer className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 shrink-0" />
              <span className="truncate">Save & View Voucher</span>
            </button>

            <button
              type="submit"
              form="credit-memo-form"
              disabled={isLoading}
              className="touch-target px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold flex items-center gap-1.5 shadow-md shadow-emerald-600/20 transition-all cursor-pointer active:scale-95"
            >
              {isLoading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle className="w-3.5 h-3.5" />
              )}
              <span className="truncate">{isEditing ? 'Update Credit Memo' : 'Issue Credit Memo'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
