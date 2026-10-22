import React from 'react';
import { X, Printer, Receipt, CheckCircle2, Building2, UserCheck } from 'lucide-react';

export default function CreditMemoVoucherModal({ isOpen, onClose, creditMemo, creditMemos = [] }) {
  if (!isOpen) return null;

  // Resolve memos array: either passed array or single creditMemo
  const memosToRender = (creditMemos && creditMemos.length > 0)
    ? creditMemos
    : (creditMemo ? [creditMemo] : []);

  if (memosToRender.length === 0) return null;

  const handlePrint = () => {
    const originalTitle = document.title;
    if (memosToRender.length === 1 && memosToRender[0]?.credit_memo_number) {
      document.title = `Credit-Memo-${memosToRender[0].credit_memo_number}`;
    } else if (memosToRender.length > 1) {
      document.title = `Batch-Credit-Memos-${memosToRender.length}-Vouchers`;
    }
    window.print();
    setTimeout(() => {
      document.title = originalTitle;
    }, 1200);
  };

  const isBulk = memosToRender.length > 1;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-6 bg-slate-900/70 backdrop-blur-sm animate-in fade-in overflow-y-auto">
      
      {/* Print Specific Stylesheet Injection */}
      <style>{`
        @media print {
          @page {
            size: portrait;
            margin: 10mm 14mm;
          }
          html, body {
            background: #ffffff !important;
            color: #0f172a !important;
            font-size: 11pt !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          #app-main-view-container,
          .print-hidden, .print\\:hidden {
            display: none !important;
          }
          #credit-memo-voucher-print-root {
            position: static !important;
            display: block !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            overflow: visible !important;
          }
          .voucher-sheet {
            page-break-after: always;
            break-after: page;
            page-break-inside: avoid;
            break-inside: avoid;
            margin: 0 0 10mm 0;
            padding: 12px 16px !important;
            box-sizing: border-box;
            background: #ffffff !important;
          }
          .voucher-sheet:last-child {
            page-break-after: auto;
            break-after: auto;
          }
        }
      `}</style>

      <div 
        id="credit-memo-voucher-print-root"
        className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-2xl w-full flex flex-col max-h-[95vh] overflow-hidden text-slate-900"
      >
        {/* Top Control Bar (Hidden when printing) */}
        <div className="p-4 sm:px-6 bg-slate-100 border-b border-slate-200 flex items-center justify-between shrink-0 print:hidden">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-emerald-600" />
            <span className="font-extrabold text-xs text-slate-800">
              {isBulk ? `Batch Credit Vouchers (${memosToRender.length})` : 'Official Credit Memorandum Voucher'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>{isBulk ? `Print All ${memosToRender.length} Vouchers` : 'Print Voucher / Save PDF'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Document Container (Contains 1 or multiple vouchers) */}
        <div className="flex-1 overflow-y-auto divide-y-4 divide-slate-200 print:divide-y-0 print:overflow-visible">
          {memosToRender.map((memo, idx) => (
            <div 
              key={memo.credit_memo_number || idx}
              className="voucher-sheet p-6 sm:p-8 space-y-4 sm:space-y-5 print:p-2 print:space-y-3.5"
            >
              
              {/* Header with Unified Corporate Identity (Divisions Removed) */}
              <div className="border-b-2 border-slate-900 pb-3 sm:pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="pl-1">
                    <div className="text-[11px] font-black tracking-wider uppercase text-slate-500">
                      WHOLESALE DISTRIBUTION & RETURNS
                    </div>
                    <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 mt-0.5">
                      FINANCE CREDIT MEMORANDUM
                    </h1>
                    <p className="text-xs text-slate-600 font-medium mt-0.5">
                      Finance & Accounting Department • Official Accounting Voucher
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-lg text-xs font-black uppercase tracking-wider inline-block">
                      CREDIT MEMO
                    </span>
                    <div className="font-mono font-black text-sm text-slate-900 mt-1">
                      {memo.credit_memo_number}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Date: {memo.credit_issued_at ? new Date(memo.credit_issued_at).toLocaleDateString() : new Date().toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Reference Overview Grid */}
              <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Customer / Supplier</span>
                  <div className="font-black text-slate-900 text-sm mt-0.5">
                    {memo.supplier_name || 'Savemore'}
                  </div>
                  <div className="text-[11px] text-slate-600 mt-1 font-mono">
                    Assigned AE: <strong>{memo.customer_ae_name || 'N/A'}</strong>
                    {memo.customer_ae_email ? ` (${memo.customer_ae_email})` : ''}
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Linked RMA Return Ticket</span>
                  <div className="font-mono font-black text-blue-700 text-sm mt-0.5">
                    {memo.rma_number || 'N/A'}
                  </div>
                  <div className="text-[11px] text-slate-600 mt-1">
                    Pull Out Ref: <strong className="font-semibold">{memo.pull_out_ref || 'N/A'}</strong>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Pull Out Date: {memo.pull_out_date || 'N/A'}
                  </div>
                </div>
              </div>

              {/* Line Items Table */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-black uppercase text-[10px]">
                      <th className="py-2 px-3">Item Description</th>
                      <th className="py-2 px-3 font-mono">Barcode / SKU</th>
                      <th className="py-2 px-3 text-center">Qty</th>
                      <th className="py-2 px-3 text-right">Unit Price</th>
                      <th className="py-2 px-3 text-right">Gross Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    <tr>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900 text-xs">{memo.product_name}</div>
                        <div className="text-[10px] text-slate-500">Wholesale Return Pull-Out</div>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700">
                        <div>{memo.barcode}</div>
                        {memo.sku && <div className="text-slate-400">SKU: {memo.sku}</div>}
                      </td>
                      <td className="py-2.5 px-3 text-center font-bold font-mono">
                        {memo.quantity} {memo.unit_name || 'pc'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        ₱{Number(memo.unit_price || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold font-mono text-slate-900">
                        ₱{Number(memo.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Financial Summary & Total Credit Box (Strict 2 decimals) */}
              <div className="flex justify-end">
                <div className="w-full sm:w-72 bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-3.5 text-right space-y-1">
                  <div className="text-xs text-slate-600 flex justify-between">
                    <span>Gross Returned Value:</span>
                    <span className="font-mono font-bold">
                      ₱{Number(memo.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="pt-1.5 border-t border-emerald-200 flex justify-between items-baseline">
                    <span className="text-xs font-black uppercase text-emerald-950">Total Credit Granted:</span>
                    <span className="font-mono text-lg sm:text-xl font-black text-emerald-800">
                      ₱{Number(memo.credit_amount || memo.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="text-[10px] text-emerald-700 font-semibold pt-0.5">
                    Approved for account deduction / statement credit
                  </div>
                </div>
              </div>

              {/* Accounting Remarks */}
              {memo.notes && (
                <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700">
                  <span className="font-bold block text-[10px] uppercase text-slate-400 mb-0.5">Finance Notes / Audit Remarks:</span>
                  <span>{memo.notes}</span>
                </div>
              )}

              {/* Signatures & Certification Grid */}
              <div className="pt-6 sm:pt-7 border-t border-slate-200 grid grid-cols-3 gap-3 text-center text-xs">
                <div className="space-y-1">
                  <div className="border-b border-slate-400 pb-1 font-bold text-slate-900 text-xs">
                    {memo.credit_issued_by && !memo.credit_issued_by.includes('Danilo')
                      ? memo.credit_issued_by
                      : 'Analiza B. Benoza'}
                  </div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Finance Head
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono block">
                    {memo.credit_issued_at ? new Date(memo.credit_issued_at).toLocaleString() : ''}
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="border-b border-slate-400 pb-1 font-bold text-slate-900 text-xs">
                    {memo.customer_ae_name || 'Customer AE'}
                  </div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Account Executive
                  </span>
                  <span className="text-[10px] text-slate-500 block">
                    Customer Coordination
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="border-b border-slate-400 pb-1 font-bold text-slate-400 text-xs italic">
                    (Customer Signature)
                  </div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Received & Acknowledged
                  </span>
                  <span className="text-[10px] text-slate-500 block">
                    Customer Authorized Rep
                  </span>
                </div>
              </div>

              {/* Document Footer Notice */}
              <div className="text-[10px] text-center text-slate-400 pt-2 border-t border-slate-100">
                This Credit Memorandum is an official accounting instrument. Authorized adjustments are directly applied to company ledger accounts.
              </div>

            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

