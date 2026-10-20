import React, { useState } from 'react';
import { 
  DollarSign, 
  CheckSquare, 
  Square, 
  FileCheck2, 
  Receipt, 
  AlertCircle, 
  Clock, 
  Building2, 
  CheckCircle2,
  Calendar,
  UserCheck
} from 'lucide-react';
import { formatPeso } from '../utils/rmaHelpers';

export default function FinanceCreditMemoTab({ tickets = [], onUpdateTicket }) {
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [creditMemoNo, setCreditMemoNo] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [issuedBy, setIssuedBy] = useState('Danilo Alvaro (Finance Lead)');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Financial Stats
  const totalRmaValue = tickets.reduce((acc, t) => acc + (Number(t.total_amount) || 0), 0);
  const totalCreditIssued = tickets
    .filter(t => t.status === 'Credit Memo Issued')
    .reduce((acc, t) => acc + (Number(t.credit_amount) || Number(t.total_amount) || 0), 0);
  const pendingCreditValue = tickets
    .filter(t => t.status !== 'Credit Memo Issued' && t.status !== 'Rejected')
    .reduce((acc, t) => acc + (Number(t.total_amount) || 0), 0);
  const totalPullOuts = tickets.filter(t => t.pull_out_confirmed).length;

  // Select ticket to issue memo
  const handleSelectTicketForMemo = (ticket) => {
    setSelectedTicketId(ticket.id);
    const year = new Date().getFullYear();
    const randomSeq = String(Math.floor(1000 + Math.random() * 9000));
    setCreditMemoNo(`CM-${year}-${randomSeq}`);
    setCreditAmount(ticket.total_amount);
  };

  // Toggle Pull-Out confirmation checkbox
  const handleTogglePullOut = async (ticket) => {
    const updatedStatus = !ticket.pull_out_confirmed;
    await onUpdateTicket(ticket.id, {
      pull_out_confirmed: updatedStatus,
      status: updatedStatus && ticket.status === 'Pending Inspection' ? 'In Transit' : ticket.status
    });
    showToast(`Physical pull-out ${updatedStatus ? 'CONFIRMED' : 'UNCHECKED'} for ${ticket.id}`);
  };

  // Issue Credit Memo submission
  const handleIssueCreditMemo = async (e) => {
    e.preventDefault();
    if (!selectedTicketId) return;

    if (!creditMemoNo.trim()) {
      alert('Please enter a Credit Memo number.');
      return;
    }

    const amt = Number(creditAmount);
    if (isNaN(amt) || amt <= 0) {
      alert('Please enter a valid credit amount in ₱.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onUpdateTicket(selectedTicketId, {
        credit_memo_no: creditMemoNo.trim(),
        credit_amount: amt,
        credit_issued_by: issuedBy,
        credit_issued_date: new Date().toISOString(),
        status: 'Credit Memo Issued',
        pull_out_confirmed: true
      });

      showToast(`Credit Memo ${creditMemoNo} successfully issued for ${formatPeso(amt)}!`);
      setSelectedTicketId(null);
      setCreditMemoNo('');
      setCreditAmount('');
    } catch (err) {
      alert('Error issuing credit memo: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  return (
    <div className="space-y-6">
      
      {/* Toast Alert */}
      {toastMessage && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950 border border-emerald-300 dark:border-emerald-500/40 text-emerald-900 dark:text-emerald-200 rounded-2xl flex items-center space-x-3 text-xs sm:text-sm animate-in slide-in-from-top-2 shadow-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs mb-1">
            <span>Total Returns Value</span>
            <DollarSign className="w-4 h-4 text-brand-600 dark:text-brand-400" />
          </div>
          <div className="text-xl sm:text-2xl font-black font-mono text-slate-900 dark:text-white">
            {formatPeso(totalRmaValue)}
          </div>
          <span className="text-[10px] text-slate-400">Gross claimed merchandise</span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs mb-1">
            <span>Credit Memos Issued</span>
            <Receipt className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="text-xl sm:text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">
            {formatPeso(totalCreditIssued)}
          </div>
          <span className="text-[10px] text-slate-400">Credited to customer accounts</span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs mb-1">
            <span>Pending Credit Balance</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-xl sm:text-2xl font-black font-mono text-amber-600 dark:text-amber-400">
            {formatPeso(pendingCreditValue)}
          </div>
          <span className="text-[10px] text-slate-400">Awaiting finance reconciliation</span>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs mb-1">
            <span>Pull-Out Verified</span>
            <CheckSquare className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          </div>
          <div className="text-xl sm:text-2xl font-black font-mono text-purple-600 dark:text-purple-400">
            {totalPullOuts} of {tickets.length} Units
          </div>
          <span className="text-[10px] text-slate-400">Physical receipt at warehouse</span>
        </div>
      </div>

      {/* Main Finance Workstation Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: RMA Pull-out & Returns Table (2 Cols) */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <FileCheck2 className="w-5 h-5 text-brand-600 dark:text-brand-400" />
                <span>Warehouse Pull-Out & Finance Clearance</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Confirm physical pull-out checkbox, then select ticket to authorize Credit Memo.
              </p>
            </div>
          </div>

          <div className="space-y-3 max-h-[620px] overflow-y-auto pr-1">
            {tickets.map((ticket) => {
              const isSelected = selectedTicketId === ticket.id;
              const isCredited = ticket.status === 'Credit Memo Issued';

              return (
                <div
                  key={ticket.id}
                  className={`p-4 rounded-2xl border transition-all ${
                    isSelected 
                      ? 'bg-brand-50/50 dark:bg-brand-950/40 border-brand-500 ring-1 ring-brand-500/40' 
                      : isCredited
                      ? 'bg-slate-50/60 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800/80'
                      : 'bg-white dark:bg-slate-950/70 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    
                    {/* Pull-out checkbox */}
                    <div className="flex items-start space-x-3">
                      <button
                        type="button"
                        onClick={() => handleTogglePullOut(ticket)}
                        className="mt-0.5 text-slate-400 hover:text-brand-600 transition-colors"
                        title="Toggle Physical Pull-Out Confirmation"
                      >
                        {ticket.pull_out_confirmed ? (
                          <CheckSquare className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <Square className="w-5 h-5 text-slate-400 dark:text-slate-600" />
                        )}
                      </button>

                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-bold text-slate-900 dark:text-white text-sm">{ticket.id}</span>
                          <span className="text-xs px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono">
                            {ticket.sku}
                          </span>
                          {ticket.pull_out_confirmed ? (
                            <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 px-1.5 py-0.5 rounded">
                              PULL-OUT CONFIRMED
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-1.5 py-0.5 rounded">
                              Awaiting Logistics Pull-Out
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-slate-800 dark:text-slate-200 font-medium">
                          {ticket.product_name} ({ticket.quantity} units)
                        </div>

                        <div className="text-[11px] text-slate-500 flex items-center space-x-2">
                          <span>{ticket.customer_name}</span>
                          <span>•</span>
                          <span>AE: {ticket.ae_name}</span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Value & Issue Action */}
                    <div className="text-right space-y-1.5 shrink-0">
                      <div className="text-sm font-bold font-mono text-emerald-600 dark:text-emerald-400">
                        {formatPeso(ticket.total_amount)}
                      </div>

                      {isCredited ? (
                        <div className="text-[11px] font-mono text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-500/40 px-2 py-1 rounded-lg">
                          CM #{ticket.credit_memo_no}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSelectTicketForMemo(ticket)}
                          className="px-3 py-1 bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
                        >
                          {isSelected ? 'Editing Memo...' : 'Issue Credit Memo'}
                        </button>
                      )}
                    </div>

                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Issue Credit Memo Form (1 Col) */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4 self-start">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Receipt className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <span>Credit Memo Generator</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {selectedTicketId 
                ? `Authorizing Credit Memo for ${selectedTicketId}` 
                : 'Select an RMA ticket from the list to issue credit memo'}
            </p>
          </div>

          {selectedTicketId ? (
            <form onSubmit={handleIssueCreditMemo} className="space-y-4 text-xs">
              
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Credit Memo #
                </label>
                <input
                  type="text"
                  required
                  value={creditMemoNo}
                  onChange={(e) => setCreditMemoNo(e.target.value)}
                  placeholder="e.g. CM-2026-089"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-brand-500"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Credit Amount (₱)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400 font-mono">₱</span>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={creditAmount}
                    onChange={(e) => setCreditAmount(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl pl-7 pr-3 py-2 text-sm text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-brand-500 font-bold text-emerald-600 dark:text-emerald-400"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Issued By (Finance Officer)
                </label>
                <select
                  value={issuedBy}
                  onChange={(e) => setIssuedBy(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500"
                >
                  <option value="Danilo Alvaro (Finance Lead)">Danilo Alvaro (Finance Lead)</option>
                  <option value="Finance Accounting Lead (A2Z2Go)">Finance Accounting Lead (A2Z2Go)</option>
                  <option value="Billing Specialist (Pingcon Marketing)">Billing Specialist (Pingcon Marketing)</option>
                </select>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1 text-[11px] text-slate-600 dark:text-slate-300 font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-400">Date:</span>
                  <span>{new Date().toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">General Ledger:</span>
                  <span className="text-brand-600 dark:text-brand-300">GL-4010 (Sales Returns)</span>
                </div>
              </div>

              <div className="pt-2 flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setSelectedTicketId(null)}
                  className="w-1/3 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center space-x-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{isSubmitting ? 'Posting...' : 'AUTHORIZE CREDIT'}</span>
                </button>
              </div>

            </form>
          ) : (
            <div className="py-12 px-4 text-center text-slate-400 space-y-2">
              <Receipt className="w-12 h-12 text-slate-300 dark:text-slate-700 mx-auto" />
              <p className="text-xs">
                No ticket selected. Click <strong>"Issue Credit Memo"</strong> on any verified return to post credit.
              </p>
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
