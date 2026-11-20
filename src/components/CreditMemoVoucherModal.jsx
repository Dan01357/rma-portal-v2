import React from 'react';
import { X, Printer, Receipt } from 'lucide-react';
import { printIsolatedElement } from '../utils/printIsolatedElement';
import {
  formatDateYmd,
  formatDateTimeYmdHm,
  stripCreditMemoMetaTag,
  getCreditMemoConsolidatedItems,
  getCreditMemoRmaNumbers
} from '../utils/rmaHelpers';

/**
 * Plain B&W Letter-Size (8.5" x 11") Official Credit Memorandum Voucher.
 * Supports both single-RMA and Multi-RMA Consolidated Credit Memos with repeating table headers.
 */
export default function CreditMemoVoucherModal({ isOpen, onClose, creditMemo, creditMemos = [] }) {
  if (!isOpen) return null;

  const memosToRender = (creditMemos && creditMemos.length > 0)
    ? creditMemos
    : (creditMemo ? [creditMemo] : []);

  if (memosToRender.length === 0) return null;

  const isBulk = memosToRender.length > 1;

  const handlePrint = () => {
    const docTitle = (memosToRender.length === 1 && memosToRender[0]?.credit_memo_number)
      ? `Credit-Memo-${memosToRender[0].credit_memo_number}`
      : `Batch-Credit-Memos-${memosToRender.length}-Vouchers`;

    printIsolatedElement({
      elementId: 'credit-memo-voucher-print-root',
      documentTitle: docTitle,
      pageSize: 'letter portrait',
      pageMargin: '0.4in',
      allowMultiPage: true,
      customStyles: `
        #credit-memo-voucher-print-root, #credit-memo-voucher-print-root * {
          color: #000000 !important;
          box-shadow: none !important;
        }
        #credit-memo-voucher-print-root {
          width: 100% !important;
          max-width: 7.7in !important;
          margin: 0 auto !important;
          padding: 0 !important;
          border: none !important;
          background: #ffffff !important;
          max-height: none !important;
          height: auto !important;
          overflow: visible !important;
          box-sizing: border-box !important;
        }
        #credit-memo-voucher-print-root > div {
          max-height: none !important;
          height: auto !important;
          overflow: visible !important;
        }
        .voucher-sheet {
          page-break-after: always !important;
          break-after: page !important;
          page-break-inside: auto !important;
          break-inside: auto !important;
          padding: 0.2in !important;
          background: #ffffff !important;
          border: 1.5px solid #000000 !important;
          box-sizing: border-box !important;
        }
        .voucher-sheet:last-child {
          page-break-after: avoid !important;
          break-after: avoid !important;
        }
        .voucher-sheet table {
          width: 100% !important;
          border-collapse: collapse !important;
        }
        .voucher-sheet thead {
          display: table-header-group !important;
        }
        .voucher-sheet tr, .voucher-signatures {
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }
        .print-hidden, .print\\:hidden, .bottom-sheet-handle,
        #credit-memo-voucher-print-root .print\\:hidden,
        #credit-memo-voucher-print-root .bottom-sheet-handle {
          display: none !important;
        }
        input {
          border: none !important;
          outline: none !important;
          background: transparent !important;
        }
      `
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-6 md:p-8 bg-slate-900/70 backdrop-blur-md animate-in fade-in overflow-y-auto">
      <div
        id="credit-memo-voucher-print-root"
        className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 max-w-3xl w-full flex flex-col max-h-[92dvh] sm:max-h-[95vh] overflow-hidden text-black my-0 sm:my-auto pb-safe"
      >
        <div className="bottom-sheet-handle sm:hidden print:hidden" />

        {/* Top Control Bar (Hidden when printing) */}
        <div className="p-4 sm:px-6 bg-slate-100 border-b border-slate-200 flex items-center justify-between shrink-0 print:hidden">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-slate-800" />
            <span className="font-extrabold text-xs text-slate-800">
              {isBulk
                ? `Batch Credit Vouchers (${memosToRender.length}) — US Letter B&W`
                : 'Official Credit Memorandum Voucher (8.5" × 11" Letter • Plain B&W)'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>{isBulk ? `Print All ${memosToRender.length} Vouchers` : 'Print Letter Voucher / PDF'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-200 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Document Container */}
        <div className="flex-1 overflow-y-auto divide-y-4 divide-slate-200 print:divide-y-0 print:overflow-visible">
          {memosToRender.map((memo, idx) => {
            const consolidatedItems = getCreditMemoConsolidatedItems(memo);
            const rmaNumbers = getCreditMemoRmaNumbers(memo);
            const isConsolidated = consolidatedItems.length > 1 || rmaNumbers.length > 1;
            const rowsToRender = consolidatedItems.length > 0
              ? consolidatedItems
              : [
                  {
                    rma_number: memo.rma_number || 'N/A',
                    product_name: memo.product_name || 'Item',
                    barcode: memo.barcode || 'N/A',
                    sku: memo.sku || '',
                    quantity: memo.quantity || 1,
                    unit_name: memo.unit_name || 'pc',
                    unit_price: Number(memo.unit_price || 0),
                    amount: Number(memo.amount || 0)
                  }
                ];
            const cleanNotes = stripCreditMemoMetaTag(memo.clean_notes ?? memo.notes ?? '');

            return (
              <div
                key={memo.credit_memo_number || idx}
                className="voucher-sheet p-6 sm:p-8 space-y-4 sm:space-y-5 print:p-2 print:space-y-3.5 bg-white text-black"
              >
                {/* Header */}
                <div className="border-b-2 border-black pb-3 sm:pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="pl-1">
                      <div className="text-[11px] font-black tracking-wider uppercase text-black">
                        WHOLESALE DISTRIBUTION &amp; RETURNS
                      </div>
                      <h1 className="text-xl sm:text-2xl font-black tracking-tight text-black mt-0.5">
                        FINANCE CREDIT MEMORANDUM
                      </h1>
                      <p className="text-xs text-black font-medium mt-0.5">
                        Finance &amp; Accounting Department • Official Accounting Voucher
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        {isConsolidated && (
                          <span className="px-2.5 py-0.5 border border-black bg-white text-black text-[10px] font-black uppercase tracking-wider inline-block">
                            CONSOLIDATED ({rmaNumbers.length} RMAs)
                          </span>
                        )}
                        <span className="px-3 py-1 border-[1.5px] border-black bg-white text-black text-xs font-black uppercase tracking-wider inline-block">
                          CREDIT MEMO
                        </span>
                      </div>
                      <div className="font-mono font-black text-sm text-black mt-1">
                        {memo.credit_memo_number}
                      </div>
                      <div className="text-[11px] text-black font-mono">
                        Date (YYYY-MM-DD): {formatDateYmd(memo.credit_issued_at || new Date())}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Reference Overview Grid */}
                <div className="grid grid-cols-2 gap-3 text-xs bg-white p-3.5 border border-black">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-black block">Customer / Supplier</span>
                    <div className="font-black text-black text-sm mt-0.5">
                      {memo.supplier_name || 'Savemore'}
                    </div>
                    <div className="text-[11px] text-black mt-1 font-mono">
                      Assigned AE: <strong>{memo.customer_ae_name || 'N/A'}</strong>
                      {memo.customer_ae_email ? ` (${memo.customer_ae_email})` : ''}
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] uppercase font-bold text-black block">
                      {isConsolidated ? `Linked RMA Tickets (${rmaNumbers.length})` : 'Linked RMA Return Ticket'}
                    </span>
                    <div className="font-mono font-black text-black text-xs sm:text-sm mt-0.5 break-words">
                      {rmaNumbers.length > 0 ? rmaNumbers.join(', ') : (memo.rma_number || 'N/A')}
                    </div>
                    <div className="text-[11px] text-black mt-1">
                      Pull Out Ref: <strong className="font-semibold">{memo.pull_out_ref || 'N/A'}</strong>
                    </div>
                    <div className="text-[11px] text-black">
                      Pull Out Date (YYYY-MM-DD): {memo.pull_out_date ? (formatDateYmd(memo.pull_out_date) || memo.pull_out_date) : 'N/A'}
                    </div>
                  </div>
                </div>

                {/* Line Items Table (Repeating thead across pages) */}
                <div className="border border-black bg-white">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-white border-b-[1.5px] border-black text-black font-black uppercase text-[10px]">
                        {isConsolidated && <th className="py-2 px-2.5 border-r border-black">RMA #</th>}
                        <th className="py-2 px-3 border-r border-black">Item Description</th>
                        <th className="py-2 px-3 border-r border-black font-mono">Barcode / SKU</th>
                        <th className="py-2 px-3 border-r border-black text-center">Qty</th>
                        <th className="py-2 px-3 border-r border-black text-right">Unit Price</th>
                        <th className="py-2 px-3 text-right">Gross Amount</th>
                      </tr>
                    </thead>
                    <tbody className="font-medium">
                      {rowsToRender.map((item, rowIdx) => (
                        <tr key={`${item.rma_number || 'row'}-${rowIdx}`} className="border-b border-black last:border-b-0">
                          {isConsolidated && (
                            <td className="py-2 px-2.5 border-r border-black font-mono text-[10.5px] font-bold whitespace-nowrap">
                              {item.rma_number || 'N/A'}
                            </td>
                          )}
                          <td className="py-2 px-3 border-r border-black">
                            <div className="font-bold text-black text-xs">{item.product_name}</div>
                            <div className="text-[10px] text-black">Wholesale Return Pull-Out</div>
                          </td>
                          <td className="py-2 px-3 border-r border-black font-mono text-[11px] text-black">
                            <div>{item.barcode || 'N/A'}</div>
                            {item.sku && <div className="text-black">SKU: {item.sku}</div>}
                          </td>
                          <td className="py-2 px-3 border-r border-black text-center font-bold font-mono whitespace-nowrap">
                            {item.quantity} {item.unit_name || 'pc'}
                          </td>
                          <td className="py-2 px-3 border-r border-black text-right font-mono whitespace-nowrap">
                            ₱{Number(item.unit_price || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-2 px-3 text-right font-bold font-mono text-black whitespace-nowrap">
                            ₱{Number(item.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Financial Summary & Total Credit Box (Plain B&W Outline) */}
                <div className="flex justify-end">
                  <div className="w-full sm:w-80 bg-white border-[1.5px] border-black p-3.5 text-right space-y-1">
                    <div className="text-xs text-black flex justify-between">
                      <span>Gross Returned Value ({rowsToRender.length} item{rowsToRender.length > 1 ? 's' : ''}):</span>
                      <span className="font-mono font-bold">
                        ₱{Number(memo.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="pt-1.5 border-t border-black flex justify-between items-baseline">
                      <span className="text-xs font-black uppercase text-black">Total Credit Granted:</span>
                      <span className="font-mono text-lg sm:text-xl font-black text-black">
                        ₱{Number(memo.credit_amount || memo.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="text-[10px] text-black font-semibold pt-0.5">
                      Approved for account deduction / statement credit
                    </div>
                  </div>
                </div>

                {/* Accounting Remarks (stripped of hidden [CM_META:...] JSON) */}
                {cleanNotes && (
                  <div className="p-2.5 bg-white border border-black text-xs text-black">
                    <span className="font-bold block text-[10px] uppercase text-black mb-0.5">Finance Notes / Audit Remarks:</span>
                    <span>{cleanNotes}</span>
                  </div>
                )}

                {/* Signatures & Certification Grid */}
                <div className="voucher-signatures pt-6 sm:pt-7 border-t border-black grid grid-cols-3 gap-3 text-center text-xs">
                  <div className="space-y-1">
                    <input
                      type="text"
                      defaultValue={memo.credit_issued_by || 'Analiza B. Benoza'}
                      className="border-b border-black pb-1 font-bold text-black text-xs text-center w-full bg-transparent border-t-0 border-l-0 border-r-0 focus:outline-none print:border-b print:border-black"
                      title="Click to edit Finance Head name if needed"
                    />
                    <span className="text-[10px] uppercase font-bold text-black block">
                      Finance Head
                    </span>
                    <span className="text-[10px] text-black font-mono block">
                      {memo.credit_issued_at ? `${formatDateTimeYmdHm(memo.credit_issued_at)} (YYYY-MM-DD HH:mm)` : ''}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="border-b border-black pb-1 font-bold text-black text-xs">
                      {memo.customer_ae_name || 'Customer AE'}
                    </div>
                    <span className="text-[10px] uppercase font-bold text-black block">
                      Account Executive
                    </span>
                    <span className="text-[10px] text-black block">
                      Customer Coordination
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="border-b border-black pb-1 font-bold text-black text-xs italic">
                      (Customer Signature)
                    </div>
                    <span className="text-[10px] uppercase font-bold text-black block">
                      Received &amp; Acknowledged
                    </span>
                    <span className="text-[10px] text-black block">
                      Customer Authorized Rep
                    </span>
                  </div>
                </div>

                {/* Document Footer Notice */}
                <div className="text-[10px] text-center text-black pt-2 border-t border-black">
                  This Credit Memorandum is an official accounting instrument. Authorized adjustments are directly applied to company ledger accounts.
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
