import React from 'react';
import { Clock, CheckCircle2, FileText, XCircle } from 'lucide-react';

export default function StatusBadge({ status, size = 'md' }) {
  const sizeClasses = size === 'sm' 
    ? 'text-xs px-2.5 py-0.5' 
    : 'text-xs md:text-sm px-3 py-1';

  switch (status) {
    case 'Approved for Replacement':
      return (
        <span className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30 ${sizeClasses}`}>
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>Approved for Replacement</span>
        </span>
      );

    case 'Credit Memo Issued':
      return (
        <span className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 ${sizeClasses}`}>
          <FileText className="w-3.5 h-3.5 shrink-0" />
          <span>Credit Memo Issued</span>
        </span>
      );

    case 'Rejected':
      return (
        <span className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30 ${sizeClasses}`}>
          <XCircle className="w-3.5 h-3.5 shrink-0" />
          <span>Rejected</span>
        </span>
      );

    case 'Pending Inspection':
    default:
      return (
        <span className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 ${sizeClasses}`}>
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span>Pending Inspection</span>
        </span>
      );
  }
}
