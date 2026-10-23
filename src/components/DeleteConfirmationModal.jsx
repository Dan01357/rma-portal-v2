import React from 'react';
import { Trash2, AlertTriangle, X, RefreshCw } from 'lucide-react';

export default function DeleteConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm Deletion',
  itemName = '',
  itemType = 'item', // 'product' | 'report' | 'item'
  itemDetails = '',
  isDeleting = false
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/65 backdrop-blur-sm animate-in fade-in">
      <div 
        className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border-t sm:border border-slate-200 dark:border-slate-800 max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150 pb-safe"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile bottom-sheet drag handle */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700"></div>
        </div>

        {/* Header with Hazard Icon */}
        <div className="p-5 sm:p-6 pb-4 flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0 shadow-inner">
            <Trash2 className="w-6 h-6" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                {title}
              </h3>
              <button
                type="button"
                onClick={onClose}
                disabled={isDeleting}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Please confirm if you want to permanently remove this {itemType}.
            </p>
          </div>
        </div>

        {/* Item Info Callout */}
        <div className="px-6 pb-2">
          <div className="p-4 bg-rose-50/70 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-2xl space-y-1.5">
            <div className="text-xs font-black text-rose-950 dark:text-rose-200 break-words">
              {itemName || `Selected ${itemType}`}
            </div>
            {itemDetails && (
              <div className="text-[11px] font-mono text-rose-800/80 dark:text-rose-300/80">
                {itemDetails}
              </div>
            )}
            <div className="text-[11px] text-rose-700 dark:text-rose-400 pt-1 font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>This record will be permanently deleted from the database.</span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:px-6 bg-slate-50 dark:bg-slate-900/80 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-end gap-2.5 mt-2">
          <button
            type="button"
            disabled={isDeleting}
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={isDeleting}
            onClick={onConfirm}
            className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl shadow-md shadow-rose-600/25 flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
          >
            {isDeleting ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            <span>{isDeleting ? 'Deleting...' : 'Yes, Delete Permanently'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
