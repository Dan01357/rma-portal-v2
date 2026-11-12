import React from 'react';
import { Trash2, AlertTriangle, X, RefreshCw } from 'lucide-react';

export default function DeleteConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title = '',
  itemName = '',
  itemType = 'item', // 'product' | 'report' | 'item' | 'reports' | 'bulk_reports'
  itemDetails = '',
  isDeleting = false,
  isPermanent = false
}) {
  if (!isOpen) return null;

  const isSoftTrash = (itemType === 'report' || itemType === 'reports' || itemType === 'bulk_reports' || itemType === 'rma') && !isPermanent;
  const resolvedTitle = title || (isSoftTrash ? 'Move to Trash (30-Day Recovery)?' : 'Confirm Deletion');

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
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-inner ${
            isSoftTrash 
              ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-400' 
              : 'bg-rose-100 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400'
          }`}>
            <Trash2 className="w-6 h-6" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                {resolvedTitle}
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
              {isSoftTrash 
                ? 'Item will be safely stored in the 30-Day Trash Bin before permanent purge.'
                : `Please confirm if you want to permanently remove this ${itemType}.`}
            </p>
          </div>
        </div>

        {/* Item Info Callout */}
        <div className="px-6 pb-2">
          <div className={`p-4 border rounded-2xl space-y-1.5 ${
            isSoftTrash
              ? 'bg-amber-50/70 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/60'
              : 'bg-rose-50/70 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/60'
          }`}>
            <div className={`text-xs font-black break-words ${
              isSoftTrash ? 'text-amber-950 dark:text-amber-200' : 'text-rose-950 dark:text-rose-200'
            }`}>
              {itemName || `Selected ${itemType}`}
            </div>
            {itemDetails && (
              <div className={`text-[11px] font-mono ${
                isSoftTrash ? 'text-amber-800/80 dark:text-amber-300/80' : 'text-rose-800/80 dark:text-rose-300/80'
              }`}>
                {itemDetails}
              </div>
            )}
            <div className={`text-[11px] pt-1 font-semibold flex items-center gap-1.5 ${
              isSoftTrash ? 'text-amber-700 dark:text-amber-400' : 'text-rose-700 dark:text-rose-400'
            }`}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>
                {isSoftTrash 
                  ? '⏳ Can be fully restored from the Archive & Trash Vault within 30 days.' 
                  : 'This record will be permanently deleted from the database.'}
              </span>
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
            className={`px-5 py-2.5 text-white font-extrabold text-xs rounded-xl shadow-md flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50 ${
              isSoftTrash
                ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/25'
                : 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/25'
            }`}
          >
            {isDeleting ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            <span>
              {isDeleting 
                ? (isSoftTrash ? 'Moving to Trash...' : 'Deleting...') 
                : (isSoftTrash ? '🗑️ Move to Trash (30-Day Recovery)' : 'Yes, Delete Permanently')}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
