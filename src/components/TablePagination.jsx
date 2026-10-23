import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function TablePagination({
  currentPage = 1,
  totalItems = 0,
  pageSize = 10,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  itemLabel = 'items'
}) {
  if (totalItems === 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const startIndex = (currentPage - 1) * pageSize + 1;
  const endIndex = Math.min(totalItems, currentPage * pageSize);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 font-semibold select-none rounded-b-2xl">
      {/* Left: Rows Per Page & Item Range */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">Rows per page:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              if (onPageSizeChange) onPageSizeChange(Number(e.target.value));
              if (onPageChange) onPageChange(1);
            }}
            className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-blue-600 cursor-pointer shadow-xs"
          >
            {pageSizeOptions.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>

        <span className="text-slate-300 dark:text-slate-700">|</span>

        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          Showing <strong className="text-slate-800 dark:text-slate-100">{startIndex} - {endIndex}</strong> of <strong className="text-slate-800 dark:text-slate-100">{totalItems}</strong> {itemLabel}
        </span>
      </div>

      {/* Right: Page Navigation */}
      <div className="flex items-center gap-1.5 self-end sm:self-auto">
        <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1.5">
          Page <strong className="text-slate-800 dark:text-slate-100">{currentPage}</strong> of <strong className="text-slate-800 dark:text-slate-100">{totalPages}</strong>
        </span>

        <button
          type="button"
          onClick={() => onPageChange && onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="min-h-[44px] px-3 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold flex items-center gap-1 transition-all shadow-xs cursor-pointer disabled:cursor-not-allowed"
          title="Previous Page"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Prev</span>
        </button>

        <button
          type="button"
          onClick={() => onPageChange && onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
          className="min-h-[44px] px-3 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold flex items-center gap-1 transition-all shadow-xs cursor-pointer disabled:cursor-not-allowed"
          title="Next Page"
        >
          <span>Next</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
