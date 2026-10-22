import React, { useState, useMemo, useEffect } from 'react';
import { 
  X, 
  CheckCircle, 
  Clock, 
  Barcode, 
  FileText, 
  Package, 
  MapPin, 
  Image as ImageIcon, 
  ExternalLink, 
  User, 
  Phone, 
  Mail, 
  List, 
  LayoutGrid,
  Search,
  Filter,
  RotateCcw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Trash2,
  Receipt,
  QrCode
} from 'lucide-react';
import ImageLightboxModal from './ImageLightboxModal';
import TablePagination from './TablePagination';

export default function RMAReportsModal({ 
  isOpen, 
  onClose, 
  reports = [], 
  currentUser, 
  onDeleteReport,
  onBulkDeleteReport,
  creditMemosList = [],
  savedProductsList = [],
  onOpenCreditMemo,
  onViewCreditMemoVoucher,
  onEditProductFromReport,
  onViewReportQR
}) {
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('rma_reports_modal_view_mode') || 'table';
  });

  const canAdmin = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';
  const canDeleteReports = canAdmin;

  // Filtering & Sorting State
  const [searchQuery, setSearchQuery] = useState('');
  const [reasonFilter, setReasonFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortField, setSortField] = useState('id');
  const [sortDirection, setSortDirection] = useState('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedReportIds, setSelectedReportIds] = useState(new Set());

  // Automatically prune orphan report selection IDs whenever reports update
  useEffect(() => {
    setSelectedReportIds(prev => {
      if (prev.size === 0) return prev;
      const valid = new Set(reports.flatMap(r => [r.id, r.rma_number].filter(Boolean)));
      const next = new Set([...prev].filter(id => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [reports]);

  // Reset selection when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedReportIds(new Set());
    }
  }, [isOpen]);

  const handleSetViewMode = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('rma_reports_modal_view_mode', mode);
    } catch (e) {}
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  };

  const resetFilters = () => {
    setSearchQuery('');
    setReasonFilter('all');
    setStatusFilter('all');
    setCurrentPage(1);
    setSelectedReportIds(new Set());
  };


  // Distinct reasons present in reports
  const distinctReasons = useMemo(() => {
    const set = new Set();
    reports.forEach(r => {
      if (r.reason) set.add(r.reason);
    });
    return Array.from(set).sort();
  }, [reports]);

  // Filtered and sorted report items
  const processedReports = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    let list = reports.filter(item => {
      if (q) {
        const matches = (
          String(item.id || '').includes(q) ||
          (item.rma_number || '').toLowerCase().includes(q) ||
          (item.barcode || '').toLowerCase().includes(q) ||
          (item.name || '').toLowerCase().includes(q) ||
          (item.reporter_name || item.reported_by || '').toLowerCase().includes(q) ||
          (item.reporter_contact || '').toLowerCase().includes(q) ||
          (item.reason || '').toLowerCase().includes(q)
        );
        if (!matches) return false;
      }

      if (reasonFilter !== 'all' && (item.reason || '') !== reasonFilter) {
        return false;
      }

      if (statusFilter === 'logged' && item.status === 'pending_admin_details') return false;
      if (statusFilter === 'unknown' && item.status !== 'pending_admin_details') return false;

      return true;
    });

    list.sort((a, b) => {
      let valA, valB;
      switch (sortField) {
        case 'id':
          valA = Number(a.id) || 0;
          valB = Number(b.id) || 0;
          break;
        case 'rma_number':
          valA = String(a.rma_number || '').toLowerCase();
          valB = String(b.rma_number || '').toLowerCase();
          break;
        case 'barcode':
          valA = String(a.barcode || '').toLowerCase();
          valB = String(b.barcode || '').toLowerCase();
          break;
        case 'name':
          valA = String(a.name || '').toLowerCase();
          valB = String(b.name || '').toLowerCase();
          break;
        case 'reason':
          valA = String(a.reason || '').toLowerCase();
          valB = String(b.reason || '').toLowerCase();
          break;
        case 'reporter':
          valA = String(a.reporter_name || a.reported_by || '').toLowerCase();
          valB = String(b.reporter_name || b.reported_by || '').toLowerCase();
          break;
        case 'status':
          valA = a.status === 'pending_admin_details' ? 0 : 1;
          valB = b.status === 'pending_admin_details' ? 0 : 1;
          break;
        case 'created_at':
          valA = new Date(a.created_at || 0).getTime();
          valB = new Date(b.created_at || 0).getTime();
          break;
        default:
          valA = a.id;
          valB = b.id;
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [reports, searchQuery, reasonFilter, statusFilter, sortField, sortDirection]);

  // Paginated slice
  const paginatedReports = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return processedReports.slice(start, start + pageSize);
  }, [processedReports, currentPage, pageSize]);

  // Bulk Selection Helpers (Strictly defined AFTER paginatedReports)
  const isAllPageSelected = useMemo(() => {
    if (paginatedReports.length === 0) return false;
    return paginatedReports.every(r => selectedReportIds.has(r.id || r.rma_number));
  }, [paginatedReports, selectedReportIds]);

  const toggleSelectReport = (id) => {
    setSelectedReportIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllPage = () => {
    setSelectedReportIds(prev => {
      const next = new Set(prev);
      if (isAllPageSelected) {
        paginatedReports.forEach(r => next.delete(r.id || r.rma_number));
      } else {
        paginatedReports.forEach(r => next.add(r.id || r.rma_number));
      }
      return next;
    });
  };

  const selectAllFiltered = () => {
    const next = new Set();
    processedReports.forEach(r => next.add(r.id || r.rma_number));
    setSelectedReportIds(next);
  };

  const clearSelection = () => {
    setSelectedReportIds(new Set());
  };

  const selectedReportsList = useMemo(() => {
    return reports.filter(r => selectedReportIds.has(r.id || r.rma_number));
  }, [reports, selectedReportIds]);

  const renderSortIndicator = (field) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-500 ml-1 inline" />;
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-3 h-3 text-blue-600 ml-1 inline font-bold" />
      : <ArrowDown className="w-3 h-3 text-blue-600 ml-1 inline font-bold" />;
  };

  const hasActiveFilters = searchQuery.trim() !== '' || reasonFilter !== 'all' || statusFilter !== 'all';

  // IMPORTANT: All hooks are declared above. Early return strictly placed AFTER hooks to prevent error #310
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-5xl w-full p-5 sm:p-6 space-y-4 max-h-[92vh] overflow-y-auto">
        
        {/* Header & Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 rounded-2xl shadow-inner">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                  Logged RMA Return Reports
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300">
                  {processedReports.length} Reports
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Incoming return reports with clickable proof photos, reporter contact info, and GPS coordinates.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            {/* View Type Switcher */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl border border-slate-200/80 dark:border-slate-700">
              <button
                type="button"
                onClick={() => handleSetViewMode('table')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all ${
                  viewMode === 'table'
                    ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
                }`}
                title="Rows / Table View (with SN column)"
              >
                <List className="w-3.5 h-3.5" />
                <span>Rows List</span>
              </button>
              <button
                type="button"
                onClick={() => handleSetViewMode('grid')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all ${
                  viewMode === 'grid'
                    ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
                }`}
                title="Grid / Cards View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Cards View</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter & Sort Toolbar */}
        <div className="bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl p-3 space-y-2.5">
          <div className="flex flex-col md:flex-row md:items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Filter by SN (#), RMA #, barcode, item name, reporter, or defect..."
                className="w-full pl-9 pr-8 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500 shadow-xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setCurrentPage(1);
                  }}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <select
                value={reasonFilter}
                onChange={(e) => {
                  setReasonFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-2.5 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500 shadow-xs cursor-pointer"
              >
                <option value="all">All Return Reasons</option>
                {distinctReasons.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-2.5 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500 shadow-xs cursor-pointer"
              >
                <option value="all">All Statuses</option>
                <option value="logged">Logged in System</option>
                <option value="unknown">Unknown Barcode</option>
              </select>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="px-2.5 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors shrink-0"
                  title="Reset all filters"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        {processedReports.length === 0 ? (
          <div className="text-center py-12 space-y-2">
            <Package className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto" />
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">No Return Reports Found</h3>
            <p className="text-xs text-slate-400 dark:text-slate-500 max-w-sm mx-auto">
              {hasActiveFilters 
                ? 'No reports match your active filters. Click "Reset" to clear filters.' 
                : 'Scan any item barcode in Reporter Mode and submit to record returns with proof photos.'}
            </p>
          </div>
        ) : viewMode === 'table' ? (
          /* ============================================================ */
          /* TABLE VIEW: WITH INTERACTIVE SORT HEADERS & LIGHTBOX PHOTOS  */
          /* ============================================================ */
          <div className="bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-700 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 select-none">
                    {/* Select All Checkbox Header */}
                    <th className="py-3 px-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={isAllPageSelected}
                        onChange={toggleSelectAllPage}
                        className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 cursor-pointer"
                        title={isAllPageSelected ? "Deselect all on this page" : "Select all on this page"}
                      />
                    </th>
                    <th 
                      onClick={() => handleSort('id')}
                      className="py-3 px-3.5 font-black text-slate-900 dark:text-white w-16 cursor-pointer hover:bg-slate-100/80 dark:hover:bg-slate-800/80 group"
                    >
                      <div className="flex items-center">
                        <span>SN</span>
                        {renderSortIndicator('id')}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('rma_number')}
                      className="py-3 px-3.5 font-bold cursor-pointer hover:bg-slate-100/80 dark:hover:bg-slate-800/80 group"
                    >
                      <div className="flex items-center">
                        <span>RMA #</span>
                        {renderSortIndicator('rma_number')}
                      </div>
                    </th>
                    <th className="py-3 px-3 w-14 text-center">Photo</th>
                    <th 
                      onClick={() => handleSort('barcode')}
                      className="py-3 px-3.5 font-bold cursor-pointer hover:bg-slate-100/80 dark:hover:bg-slate-800/80 group"
                    >
                      <div className="flex items-center">
                        <span>Barcode</span>
                        {renderSortIndicator('barcode')}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('name')}
                      className="py-3 px-3.5 font-bold cursor-pointer hover:bg-slate-100/80 dark:hover:bg-slate-800/80 group"
                    >
                      <div className="flex items-center">
                        <span>Item Name</span>
                        {renderSortIndicator('name')}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('reason')}
                      className="py-3 px-3.5 font-bold cursor-pointer hover:bg-slate-100/80 dark:hover:bg-slate-800/80 group"
                    >
                      <div className="flex items-center">
                        <span>Reason</span>
                        {renderSortIndicator('reason')}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('reporter')}
                      className="py-3 px-3.5 font-bold cursor-pointer hover:bg-slate-100/80 dark:hover:bg-slate-800/80 group"
                    >
                      <div className="flex items-center">
                        <span>Reported By</span>
                        {renderSortIndicator('reporter')}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('status')}
                      className="py-3 px-3 text-center font-bold cursor-pointer hover:bg-slate-100/80 dark:hover:bg-slate-800/80 group"
                    >
                      <div className="flex items-center justify-center">
                        <span>Status</span>
                        {renderSortIndicator('status')}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('created_at')}
                      className="py-3 px-3.5 text-right font-bold cursor-pointer hover:bg-slate-100/80 dark:hover:bg-slate-800/80 group"
                    >
                      <div className="flex items-center justify-end">
                        <span>Date & GPS</span>
                        {renderSortIndicator('created_at')}
                      </div>
                    </th>
                    <th className="py-3 px-3.5 text-center font-bold select-none text-slate-500 dark:text-slate-400">
                      Finance & Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60 font-medium">
                  {paginatedReports.map((item) => {
                    const photoList = Array.isArray(item.photos) 
                      ? item.photos 
                      : (typeof item.photos === 'string' ? JSON.parse(item.photos || '[]') : []);

                    const reporterName = item.reporter_name || (item.reported_by && !item.reported_by.includes('(') ? item.reported_by : '') || 'Reporter';
                    const reporterContact = item.reporter_contact || (item.reported_by && item.reported_by.includes('(') ? item.reported_by.replace(/.*\((.*)\).*/, '$1') : '');
                    const isSelected = selectedReportIds.has(item.id || item.rma_number);
                    const matchedProduct = savedProductsList.find(p => p.barcode && String(p.barcode) === String(item.barcode));
                    const resolvedName = (item.name && !item.name.toLowerCase().startsWith('unidentified')) 
                      ? item.name 
                      : (matchedProduct?.name || item.name || `Unidentified (${item.barcode})`);
                    const isPendingUnknown = !matchedProduct && item.status === 'pending_admin_details';

                    return (
                      <tr 
                        key={item.id || item.rma_number} 
                        className={`transition-colors ${
                          isSelected 
                            ? 'bg-blue-50/80 dark:bg-blue-950/50' 
                            : 'hover:bg-blue-50/30 dark:hover:bg-slate-700/40'
                        }`}
                      >
                        {/* Row Selection Checkbox */}
                        <td className="py-3 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectReport(item.id || item.rma_number)}
                            className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 cursor-pointer"
                          />
                        </td>

                        {/* 1. SN COLUMN AT FAR LEFT */}
                        <td className="py-3 px-3.5 font-mono">
                          <span className="font-black text-blue-900 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200/80 dark:border-blue-800 px-2 py-0.5 rounded-lg text-xs">
                            #{item.id}
                          </span>
                        </td>

                        {/* 2. RMA Number + QR Code Sticker */}
                        <td className="py-3 px-3.5 font-mono font-bold text-blue-700 dark:text-blue-400">
                          <div className="flex items-center gap-1.5">
                            <span>{item.rma_number}</span>
                            {onViewReportQR && (
                              <button
                                type="button"
                                onClick={() => onViewReportQR({ ...item, name: resolvedName })}
                                className="p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/60 rounded-md transition-colors cursor-pointer"
                                title={`View & Print Box QR Sticker for ${item.rma_number}`}
                              >
                                <QrCode className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>

                        {/* 3. Photo with Click-to-Zoom Lightbox */}
                        <td className="py-2.5 px-3 text-center">
                          {photoList.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => setLightboxPhoto({
                                images: photoList,
                                initialIndex: 0,
                                url: photoList[0],
                                title: resolvedName || `Return ${item.rma_number}`,
                                subtitle: `RMA #${item.rma_number} • Reported by ${reporterName} • ${item.reason || 'Damaged'}`
                              })}
                              className="w-10 h-10 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 inline-block hover:opacity-85 hover:scale-105 transition-all shadow-xs cursor-zoom-in"
                              title="Click to view full-size proof photo"
                            >
                              <img src={photoList[0]} alt="Proof" className="w-full h-full object-cover" />
                            </button>
                          ) : (
                            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 flex items-center justify-center mx-auto border border-slate-200 dark:border-slate-700">
                              <ImageIcon className="w-4 h-4" />
                            </div>
                          )}
                        </td>

                        {/* 4. Barcode & SKU */}
                        <td className="py-3 px-3.5 font-mono">
                          <div className="font-bold text-slate-800 dark:text-slate-200">{item.barcode}</div>
                          {(item.code || matchedProduct?.code) && (
                            <div className="text-[10px] text-slate-400 dark:text-slate-500">{item.code || matchedProduct?.code}</div>
                          )}
                        </td>

                        {/* 5. Item Name */}
                        <td className="py-3 px-3.5 font-bold text-slate-900 dark:text-white max-w-[200px] truncate" title={resolvedName}>
                          {resolvedName}
                        </td>

                        {/* 6. Reason */}
                        <td className="py-3 px-3.5">
                          <span className="px-2 py-0.5 rounded-lg bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 font-bold text-[10px] inline-block">
                            {item.reason || 'Damaged'}
                          </span>
                        </td>

                        {/* 7. Reported By */}
                        <td className="py-3 px-3.5">
                          <div className="font-bold text-slate-900 dark:text-slate-200 text-[11px]">
                            {reporterName}
                          </div>
                          {reporterContact && (
                            <div className="font-mono text-slate-500 dark:text-slate-400 text-[10px]">
                              {reporterContact}
                            </div>
                          )}
                        </td>

                        {/* 8. Status */}
                        <td className="py-3 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                            isPendingUnknown
                              ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                              : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                          }`}>
                            {isPendingUnknown ? 'Unknown' : 'Logged'}
                          </span>
                        </td>

                        {/* 9. Date & GPS */}
                        <td className="py-3 px-3.5 text-right font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          <div>{new Date(item.created_at).toLocaleDateString()}</div>
                          {item.gps_latitude && item.gps_longitude ? (
                            <a
                              href={`https://www.google.com/maps?q=${item.gps_latitude},${item.gps_longitude}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5 text-[10px] font-bold"
                            >
                              <MapPin className="w-3 h-3 text-rose-500" />
                              <span>Map</span>
                            </a>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600 text-[10px]">No GPS</span>
                          )}
                        </td>

                        {/* 10. Actions: Assign SKU / Save Product, Credit Memo & Delete */}
                        <td className="py-2.5 px-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {canAdmin && onEditProductFromReport && !savedProductsList.some(p => p.barcode && String(p.barcode) === String(item.barcode)) && (
                              <button
                                type="button"
                                onClick={() => onEditProductFromReport(item)}
                                className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/70 dark:hover:bg-blue-900/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                                title={`Assign official SKU and save "${item.name || item.barcode}" to Products catalog`}
                              >
                                <Package className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                <span>Assign SKU</span>
                              </button>
                            )}

                            {(() => {
                              const existingMemo = creditMemosList.find(m => m.rma_number === item.rma_number || m.report_id === item.id);
                              if (existingMemo) {
                                return (
                                  <button
                                    type="button"
                                    onClick={() => onViewCreditMemoVoucher && onViewCreditMemoVoucher(existingMemo)}
                                    className="px-2.5 py-1 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/70 dark:hover:bg-emerald-900/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded-lg text-[10px] font-black flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                                    title={`View Official Credit Memo Voucher: ${existingMemo.credit_memo_number}`}
                                  >
                                    <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                    <span>CM Voucher</span>
                                  </button>
                                );
                              }
                              if (canAdmin) {
                                return (
                                  <button
                                    type="button"
                                    onClick={() => onOpenCreditMemo && onOpenCreditMemo(item)}
                                    className="px-2.5 py-1 bg-slate-100 hover:bg-emerald-50 dark:bg-slate-800 dark:hover:bg-emerald-950/50 text-slate-700 hover:text-emerald-700 dark:text-slate-300 dark:hover:text-emerald-300 border border-slate-300 dark:border-slate-700 hover:border-emerald-400 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                                    title="Issue Finance Credit Memo for this Return"
                                  >
                                    <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                    <span>+ Credit Memo</span>
                                  </button>
                                );
                              }
                              return null;
                            })()}

                            {canDeleteReports && (
                              <button
                                type="button"
                                onClick={() => onDeleteReport && onDeleteReport(item.id, item.rma_number)}
                                className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-xl transition-colors cursor-pointer"
                                title={`Delete RMA #${item.rma_number}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Floating Bulk Action Bar for Table */}
            {selectedReportIds.size > 0 && (
              <div className="p-3 sm:px-4 bg-slate-900/95 dark:bg-slate-950/95 text-white border-t border-slate-700 flex flex-wrap items-center justify-between gap-3 animate-in fade-in">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-black">
                    {selectedReportIds.size}
                  </span>
                  <span className="text-xs font-bold text-slate-200">
                    {selectedReportIds.size} report{selectedReportIds.size > 1 ? 's' : ''} selected
                  </span>
                  {selectedReportIds.size < processedReports.length && (
                    <button
                      type="button"
                      onClick={selectAllFiltered}
                      className="text-xs text-blue-300 hover:text-white underline font-semibold ml-1 cursor-pointer"
                    >
                      Select all {processedReports.length} filtered
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="px-3 py-1.5 text-xs font-bold text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                  >
                    Deselect
                  </button>
                  {canDeleteReports && (
                    <button
                      type="button"
                      onClick={() => onBulkDeleteReport && onBulkDeleteReport(selectedReportsList)}
                      className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Selected ({selectedReportIds.size})</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Table Pagination */}
            <TablePagination
              currentPage={currentPage}
              totalItems={processedReports.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              pageSizeOptions={[10, 25, 50, 100]}
              itemLabel="return reports"
            />
          </div>
        ) : (
          /* ============================================================ */
          /* GRID VIEW: WITH SN BADGE AND CLICKABLE PHOTOS                */
          /* ============================================================ */
          <div className="space-y-3.5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {paginatedReports.map((item) => {
                const photoList = Array.isArray(item.photos) 
                  ? item.photos 
                  : (typeof item.photos === 'string' ? JSON.parse(item.photos || '[]') : []);

                const reporterName = item.reporter_name || (item.reported_by && !item.reported_by.includes('(') ? item.reported_by : '') || 'Reporter';
                const reporterContact = item.reporter_contact || (item.reported_by && item.reported_by.includes('(') ? item.reported_by.replace(/.*\((.*)\).*/, '$1') : '');
                const isSelected = selectedReportIds.has(item.id || item.rma_number);
                const matchedProduct = savedProductsList.find(p => p.barcode && String(p.barcode) === String(item.barcode));
                const resolvedName = (item.name && !item.name.toLowerCase().startsWith('unidentified')) 
                  ? item.name 
                  : (matchedProduct?.name || item.name || `Unidentified (${item.barcode})`);
                const isPendingUnknown = !matchedProduct && item.status === 'pending_admin_details';

                return (
                  <div 
                    key={item.id || item.rma_number}
                    className={`p-4 border rounded-2xl space-y-3 transition-all shadow-xs ${
                      isSelected
                        ? 'bg-blue-50/90 dark:bg-blue-950/60 border-blue-500'
                        : 'bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100/70 dark:hover:bg-slate-700/60 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectReport(item.id || item.rma_number)}
                            className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 cursor-pointer"
                          />
                          <span className="font-mono font-black text-xs text-blue-900 dark:text-blue-300 bg-blue-100/80 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 px-2 py-0.5 rounded-lg">
                            SN #{item.id}
                          </span>
                          <span className="font-mono font-black text-blue-700 dark:text-blue-400 text-sm">
                            {item.rma_number}
                          </span>
                          {onViewReportQR && (
                            <button
                              type="button"
                              onClick={() => onViewReportQR({ ...item, name: resolvedName })}
                              className="p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/60 rounded-md transition-colors cursor-pointer"
                              title={`View & Print Box QR Sticker for ${item.rma_number}`}
                            >
                              <QrCode className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <h4 className="font-bold text-slate-900 dark:text-white text-sm truncate" title={resolvedName}>
                          {resolvedName}
                        </h4>
                        <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
                          Barcode: <strong className="text-slate-800 dark:text-slate-200">{item.barcode}</strong>
                          {(item.code || matchedProduct?.code) && <span> • SKU: {item.code || matchedProduct?.code}</span>}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                        {canAdmin && onEditProductFromReport && !savedProductsList.some(p => p.barcode && String(p.barcode) === String(item.barcode)) && (
                          <button
                            type="button"
                            onClick={() => onEditProductFromReport(item)}
                            className="px-2 py-0.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                            title="Assign official SKU and save to Products catalog"
                          >
                            <Package className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                            <span>Assign SKU</span>
                          </button>
                        )}
                        {(() => {
                          const existingMemo = creditMemosList.find(m => m.rma_number === item.rma_number || m.report_id === item.id);
                          if (existingMemo) {
                            return (
                              <button
                                type="button"
                                onClick={() => onViewCreditMemoVoucher && onViewCreditMemoVoucher(existingMemo)}
                                className="px-2 py-0.5 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded-lg text-[10px] font-black flex items-center gap-1 cursor-pointer"
                                title={`View Voucher: ${existingMemo.credit_memo_number}`}
                              >
                                <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                <span>Voucher</span>
                              </button>
                            );
                          }
                          if (canAdmin) {
                            return (
                              <button
                                type="button"
                                onClick={() => onOpenCreditMemo && onOpenCreditMemo(item)}
                                className="px-2 py-0.5 bg-slate-100 hover:bg-emerald-50 dark:bg-slate-800 dark:hover:bg-emerald-950/50 text-slate-700 hover:text-emerald-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                                title="Issue Credit Memo"
                              >
                                <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                <span>+ CM</span>
                              </button>
                            );
                          }
                          return null;
                        })()}
                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                          isPendingUnknown
                            ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                            : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                        }`}>
                          {isPendingUnknown ? 'Unknown' : 'Logged'}
                        </span>
                        <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 shrink-0">
                          {item.reason || 'Damaged'}
                        </span>
                        {canDeleteReports && (
                          <button
                            type="button"
                            onClick={() => onDeleteReport && onDeleteReport(item.id, item.rma_number)}
                            className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-100 dark:hover:bg-rose-900/50 rounded-xl transition-colors"
                            title={`Delete RMA #${item.rma_number}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Reporter and Date */}
                    <div className="text-xs text-slate-600 dark:text-slate-300 pt-2 border-t border-slate-200/80 dark:border-slate-700/80 flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                          <span className="font-bold text-slate-800 dark:text-slate-200">{reporterName}</span>
                        </div>
                        {reporterContact && (
                          <span className="font-mono text-slate-500 dark:text-slate-400 text-[11px]">{reporterContact}</span>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                        <span>{new Date(item.created_at).toLocaleString()}</span>
                        {item.gps_latitude && item.gps_longitude ? (
                          <a
                            href={`https://www.google.com/maps?q=${item.gps_latitude},${item.gps_longitude}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5 font-bold"
                          >
                            <MapPin className="w-3 h-3 text-rose-500" />
                            <span>View GPS Location</span>
                          </a>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">GPS: Blank</span>
                        )}
                      </div>

                      {/* Proof Photos with Click-to-Zoom Lightbox */}
                      {photoList.length > 0 && (
                        <div className="flex items-center gap-2 pt-1.5">
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold">Proof Photos:</span>
                          <div className="flex items-center gap-1.5">
                            {photoList.map((url, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => setLightboxPhoto({
                                  images: photoList,
                                  initialIndex: idx,
                                  url,
                                  title: item.name || `Return ${item.rma_number}`,
                                  subtitle: `Photo ${idx + 1} of ${photoList.length} • RMA #${item.rma_number} • Reported by ${reporterName}`
                                })}
                                className="w-10 h-10 rounded-xl overflow-hidden border border-slate-300 dark:border-slate-600 hover:scale-105 shadow-xs transition-transform cursor-zoom-in"
                                title="Click to zoom proof photo"
                              >
                                <img src={url} alt="Proof" className="w-full h-full object-cover" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                  </div>
                );
              })}
            </div>

            {/* Floating Bulk Action Bar for Grid Cards */}
            {selectedReportIds.size > 0 && (
              <div className="p-3 sm:px-4 bg-slate-900/95 dark:bg-slate-950/95 text-white rounded-2xl border border-slate-700 flex flex-wrap items-center justify-between gap-3 animate-in fade-in">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-black">
                    {selectedReportIds.size}
                  </span>
                  <span className="text-xs font-bold text-slate-200">
                    {selectedReportIds.size} report{selectedReportIds.size > 1 ? 's' : ''} selected
                  </span>
                  {selectedReportIds.size < processedReports.length && (
                    <button
                      type="button"
                      onClick={selectAllFiltered}
                      className="text-xs text-blue-300 hover:text-white underline font-semibold ml-1 cursor-pointer"
                    >
                      Select all {processedReports.length} filtered
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="px-3 py-1.5 text-xs font-bold text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                  >
                    Deselect
                  </button>
                  {canDeleteReports && (
                    <button
                      type="button"
                      onClick={() => onBulkDeleteReport && onBulkDeleteReport(selectedReportsList)}
                      className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Selected ({selectedReportIds.size})</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Grid Pagination */}
            <TablePagination
              currentPage={currentPage}
              totalItems={processedReports.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              pageSizeOptions={[10, 25, 50, 100]}
              itemLabel="return reports"
            />
          </div>
        )}

      </div>

      {/* Fullscreen Image Lightbox Modal */}
      <ImageLightboxModal
        isOpen={Boolean(lightboxPhoto)}
        imageUrl={lightboxPhoto?.url}
        images={lightboxPhoto?.images || (lightboxPhoto?.url ? [lightboxPhoto.url] : [])}
        initialIndex={lightboxPhoto?.initialIndex || 0}
        title={lightboxPhoto?.title}
        subtitle={lightboxPhoto?.subtitle}
        onClose={() => setLightboxPhoto(null)}
      />

    </div>
  );
}
