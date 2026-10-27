import React from 'react';
import { 
  CheckCircle2, 
  Clock, 
  Tag, 
  Receipt, 
  MapPin, 
  ShieldCheck, 
  AlertTriangle,
  User,
  Truck,
  Box,
  Layers
} from 'lucide-react';

export default function RMATimelineAudit({ 
  report, 
  creditMemosList = [] 
}) {
  if (!report) return null;

  // Find linked credit memo if any
  const linkedCM = creditMemosList.find(cm => 
    cm.rma_number === report.rma_number || String(cm.report_id) === String(report.id)
  );

  // Synthesize chronological milestones
  const events = [];

  // Milestone 1: Dock Receiving / Scan
  events.push({
    id: 'intake',
    title: 'Received & Logged at Dock',
    timestamp: report.created_at,
    actor: report.reported_by || report.reporter_name || 'Reporter',
    icon: Box,
    color: 'bg-blue-500 text-white',
    details: `Product: ${report.name} • Barcode: ${report.barcode} • Qty: ${report.quantity || 1} ${report.unit_name || 'pc'}`,
    badge: 'STAGE 1: INTAKE'
  });

  // Milestone 2: SKU Catalog Assignment
  if (report.code || report.sku) {
    events.push({
      id: 'sku',
      title: `SKU Assigned: ${report.code || report.sku}`,
      timestamp: report.updated_at || report.created_at,
      actor: report.inspected_by || 'Admin / Quick Process',
      icon: Tag,
      color: 'bg-indigo-500 text-white',
      details: `Matched to catalog • Supplier: ${report.supplier_name || 'Savemore'} • Unit Price: ₱${Number(report.price || 0).toFixed(2)}`,
      badge: 'STAGE 2: CATALOG'
    });
  }

  // Milestone 3: Warehouse Triage & Inspection
  if (report.condition_grade || report.disposition || report.warehouse_location) {
    events.push({
      id: 'triage',
      title: `Physical Triage: ${report.disposition || 'Triaged'}`,
      timestamp: report.inspected_at || report.updated_at || report.created_at,
      actor: report.inspected_by || 'Warehouse Supervisor',
      icon: Layers,
      color: 'bg-amber-500 text-white',
      details: `Condition: ${report.condition_grade || 'Graded'} • Bin: ${report.warehouse_location || 'Pending Assignment'}`,
      badge: 'STAGE 3: TRIAGE'
    });
  }

  // Milestone 4: Finance Credit Memo Issuance
  if (linkedCM) {
    events.push({
      id: 'credit_memo',
      title: `Credit Memo Issued: #${linkedCM.credit_memo_number}`,
      timestamp: linkedCM.credit_issued_at || linkedCM.created_at,
      actor: linkedCM.credit_issued_by || 'Finance Lead',
      icon: Receipt,
      color: 'bg-emerald-500 text-white',
      details: `Approved Credit Amount: ₱${Number(linkedCM.credit_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} • Pull-Out Ref: ${linkedCM.pull_out_ref}`,
      badge: 'STAGE 4: FINANCE'
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pb-1">
        <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-blue-600" />
          RMA Audit Trail & Lifecycle Timeline
        </h4>
        <span className="text-[10px] font-bold text-slate-500">
          {events.length} Milestones Recorded
        </span>
      </div>

      <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
        {events.map((evt, idx) => {
          const IconComp = evt.icon;
          const formattedDate = evt.timestamp 
            ? new Date(evt.timestamp).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })
            : 'Recent';

          return (
            <div key={evt.id || idx} className="relative group">
              {/* Dot Icon */}
              <div className={`absolute -left-6 top-0.5 w-5 h-5 rounded-full flex items-center justify-center text-xs font-black shadow-xs ${evt.color}`}>
                <IconComp className="w-2.5 h-2.5" />
              </div>

              {/* Event Content */}
              <div className="p-3 bg-slate-50 dark:bg-slate-850 border border-slate-200/80 dark:border-slate-800 rounded-xl space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded-md bg-slate-200/60 dark:bg-slate-700/60 text-slate-700 dark:text-slate-300">
                    {evt.badge}
                  </span>
                  <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                    {formattedDate}
                  </span>
                </div>

                <div className="text-xs font-black text-slate-900 dark:text-white">
                  {evt.title}
                </div>

                <div className="text-[11px] text-slate-600 dark:text-slate-400">
                  {evt.details}
                </div>

                <div className="text-[10px] text-slate-500 dark:text-slate-400 pt-0.5 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center gap-1 font-medium">
                  <User className="w-3 h-3" />
                  <span>Actor: <strong>{evt.actor}</strong></span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
