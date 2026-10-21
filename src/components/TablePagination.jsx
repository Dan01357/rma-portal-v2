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
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-600 font-semibold select-none rounded-b-2xl">
      {/* Left: Rows Per Page & Item Range */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-500">Rows per page:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              if (onPageSizeChange) onPageSizeChange(Number(e.target.value));
              if (onPageChange) onPageChange(1);
            }}
            className="px-2 py-1 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-600 cursor-pointer shadow-xs"
          >
            {pageSizeOptions.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>

        <span className="text-slate-300">|</span>

        <span className="text-[11px] text-slate-500">
          Showing <strong className="text-slate-800">{startIndex} - {endIndex}</strong> of <strong className="text-slate-800">{totalItems}</strong> {itemLabel}
        </span>
      </div>

      {/* Right: Page Navigation */}
      <div className="flex items-center gap-1.5 self-end sm:self-auto">
        <span className="text-[11px] text-slate-500 mr-1.5">
          Page <strong className="text-slate-800">{currentPage}</strong> of <strong className="text-slate-800">{totalPages}</strong>
        </span>

        <button
          type="button"
          onClick={() => onPageChange && onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="p-1.5 px-2.5 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white text-slate-700 border border-slate-300 rounded-lg text-xs font-bold flex items-center gap-1 transition-all shadow-xs cursor-pointer disabled:cursor-not-allowed"
          title="Previous Page"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span>Prev</span>
        </button>

        <button
          type="button"
          onClick={() => onPageChange && onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
          className="p-1.5 px-2.5 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white text-slate-700 border border-slate-300 rounded-lg text-xs font-bold flex items-center gap-1 transition-all shadow-xs cursor-pointer disabled:cursor-not-allowed"
          title="Next Page"
        >
          <span>Next</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
