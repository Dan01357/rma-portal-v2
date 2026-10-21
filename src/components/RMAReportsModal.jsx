import React, { useState, useMemo } from 'react';
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
  Trash2
} from 'lucide-react';
import ImageLightboxModal from './ImageLightboxModal';
import TablePagination from './TablePagination';

export default function RMAReportsModal({ 
  isOpen, 
  onClose, 
  reports = [], 
  currentUser, 
  onDeleteReport 
}) {
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('rma_reports_modal_view_mode') || 'table';
  });

  const canDeleteReports = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';

  // Filtering & Sorting State
  const [searchQuery, setSearchQuery] = useState('');
  const [reasonFilter, setReasonFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortField, setSortField] = useState('id');
  const [sortDirection, setSortDirection] = useState('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-5xl w-full p-5 sm:p-6 space-y-4 max-h-[92vh] overflow-y-auto">
        
        {/* Header & Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-blue-100 text-blue-700 rounded-2xl shadow-inner">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-slate-900">
                  Logged RMA Return Reports
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-blue-100 text-blue-800">
                  {processedReports.length} Reports
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Incoming return reports with clickable proof photos, reporter contact info, and GPS coordinates.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            {/* View Type Switcher */}
            <div className="flex items-center bg-slate-100 p-1 rounded-2xl border border-slate-200/80">
              <button
                type="button"
                onClick={() => handleSetViewMode('table')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all ${
                  viewMode === 'table'
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
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
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Grid / Cards View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Cards View</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter & Sort Toolbar */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-2.5">
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
                className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 shadow-xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setCurrentPage(1);
                  }}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 p-0.5 rounded-full"
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
                className="px-2.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-blue-500 shadow-xs"
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
                className="px-2.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-blue-500 shadow-xs"
              >
                <option value="all">All Statuses</option>
                <option value="logged">Logged in System</option>
                <option value="unknown">Unknown Barcode</option>
              </select>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="px-2.5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors shrink-0"
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
            <Package className="w-10 h-10 text-slate-300 mx-auto" />
            <h3 className="text-sm font-bold text-slate-700">No Return Reports Found</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {hasActiveFilters 
                ? 'No reports match your active filters. Click "Reset" to clear filters.' 
                : 'Scan any item barcode in Reporter Mode and submit to record returns with proof photos.'}
            </p>
          </div>
        ) : viewMode === 'table' ? (
          /* ============================================================ */
          /* TABLE VIEW: WITH INTERACTIVE SORT HEADERS & LIGHTBOX PHOTOS  */
          /* ============================================================ */
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-black uppercase tracking-wider text-slate-500 select-none">
                    <th 
                      onClick={() => handleSort('id')}
                      className="py-3 px-3.5 font-black text-slate-900 w-16 cursor-pointer hover:bg-slate-100/80 group"
                    >
                      <div className="flex items-center">
                        <span>SN</span>
                        {renderSortIndicator('id')}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('rma_number')}
                      className="py-3 px-3.5 font-bold cursor-pointer hover:bg-slate-100/80 group"
                    >
                      <div className="flex items-center">
                        <span>RMA #</span>
                        {renderSortIndicator('rma_number')}
                      </div>
                    </th>
                    <th className="py-3 px-3 w-14 text-center">Photo</th>
                    <th 
                      onClick={() => handleSort('barcode')}
                      className="py-3 px-3.5 font-bold cursor-pointer hover:bg-slate-100/80 group"
                    >
                      <div className="flex items-center">
                        <span>Barcode</span>
                        {renderSortIndicator('barcode')}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('name')}
                      className="py-3 px-3.5 font-bold cursor-pointer hover:bg-slate-100/80 group"
                    >
                      <div className="flex items-center">
                        <span>Item Name</span>
                        {renderSortIndicator('name')}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('reason')}
                      className="py-3 px-3.5 font-bold cursor-pointer hover:bg-slate-100/80 group"
                    >
                      <div className="flex items-center">
                        <span>Reason</span>
                        {renderSortIndicator('reason')}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('reporter')}
                      className="py-3 px-3.5 font-bold cursor-pointer hover:bg-slate-100/80 group"
                    >
                      <div className="flex items-center">
                        <span>Reported By</span>
                        {renderSortIndicator('reporter')}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('status')}
                      className="py-3 px-3 text-center font-bold cursor-pointer hover:bg-slate-100/80 group"
                    >
                      <div className="flex items-center justify-center">
                        <span>Status</span>
                        {renderSortIndicator('status')}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('created_at')}
                      className="py-3 px-3.5 text-right font-bold cursor-pointer hover:bg-slate-100/80 group"
                    >
                      <div className="flex items-center justify-end">
                        <span>Date & GPS</span>
                        {renderSortIndicator('created_at')}
                      </div>
                    </th>
                    {canDeleteReports && (
                      <th className="py-3 px-3.5 text-center font-bold select-none text-slate-500 w-16">
                        Action
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {paginatedReports.map((item) => {
                    const photoList = Array.isArray(item.photos) 
                      ? item.photos 
                      : (typeof item.photos === 'string' ? JSON.parse(item.photos || '[]') : []);

                    const reporterName = item.reporter_name || (item.reported_by && !item.reported_by.includes('(') ? item.reported_by : '') || 'Reporter';
                    const reporterContact = item.reporter_contact || (item.reported_by && item.reported_by.includes('(') ? item.reported_by.replace(/.*\((.*)\).*/, '$1') : '');

                    return (
                      <tr key={item.id || item.rma_number} className="hover:bg-blue-50/30 transition-colors">
                        {/* 1. SN COLUMN AT FAR LEFT */}
                        <td className="py-3 px-3.5 font-mono">
                          <span className="font-black text-blue-900 bg-blue-50 border border-blue-200/80 px-2 py-0.5 rounded-lg text-xs">
                            #{item.id}
                          </span>
                        </td>

                        {/* 2. RMA Number */}
                        <td className="py-3 px-3.5 font-mono font-bold text-blue-700">
                          {item.rma_number}
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
                                title: item.name || `Return ${item.rma_number}`,
                                subtitle: `RMA #${item.rma_number} • Reported by ${reporterName} • ${item.reason || 'Damaged'}`
                              })}
                              className="w-10 h-10 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 inline-block hover:opacity-85 hover:scale-105 transition-all shadow-xs cursor-zoom-in"
                              title="Click to view full-size proof photo"
                            >
                              <img src={photoList[0]} alt="Proof" className="w-full h-full object-cover" />
                            </button>
                          ) : (
                            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto border border-slate-200">
                              <ImageIcon className="w-4 h-4" />
                            </div>
                          )}
                        </td>

                        {/* 4. Barcode & SKU */}
                        <td className="py-3 px-3.5 font-mono">
                          <div className="font-bold text-slate-800">{item.barcode}</div>
                          {item.code && <div className="text-[10px] text-slate-400">{item.code}</div>}
                        </td>

                        {/* 5. Item Name */}
                        <td className="py-3 px-3.5 font-bold text-slate-900 max-w-[200px] truncate" title={item.name}>
                          {item.name || `Unidentified (${item.barcode})`}
                        </td>

                        {/* 6. Reason */}
                        <td className="py-3 px-3.5">
                          <span className="px-2 py-0.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 font-bold text-[10px] inline-block">
                            {item.reason || 'Damaged'}
                          </span>
                        </td>

                        {/* 7. Reported By */}
                        <td className="py-3 px-3.5">
                          <div className="font-bold text-slate-900 text-[11px]">
                            {reporterName}
                          </div>
                          {reporterContact && (
                            <div className="font-mono text-slate-500 text-[10px]">
                              {reporterContact}
                            </div>
                          )}
                        </td>

                        {/* 8. Status */}
                        <td className="py-3 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                            item.status === 'pending_admin_details'
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          }`}>
                            {item.status === 'pending_admin_details' ? 'Unknown' : 'Logged'}
                          </span>
                        </td>

                        {/* 9. Date & GPS */}
                        <td className="py-3 px-3.5 text-right font-mono text-[11px] text-slate-500">
                          <div>{new Date(item.created_at).toLocaleDateString()}</div>
                          {item.gps_latitude && item.gps_longitude ? (
                            <a
                              href={`https://www.google.com/maps?q=${item.gps_latitude},${item.gps_longitude}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline inline-flex items-center gap-0.5 text-[10px] font-bold"
                            >
                              <MapPin className="w-3 h-3 text-rose-500" />
                              <span>Map</span>
                            </a>
                          ) : (
                            <span className="text-slate-300 text-[10px]">No GPS</span>
                          )}
                        </td>

                        {/* 10. Action: Delete RMA */}
                        {canDeleteReports && (
                          <td className="py-2.5 px-3.5 text-center">
                            <button
                              type="button"
                              onClick={() => onDeleteReport && onDeleteReport(item.id, item.rma_number)}
                              className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-xl transition-colors"
                              title={`Delete RMA #${item.rma_number}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

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

                return (
                  <div 
                    key={item.id || item.rma_number}
                    className="p-4 bg-slate-50 hover:bg-slate-100/70 border border-slate-200 hover:border-slate-300 rounded-2xl space-y-3 transition-all shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono font-black text-xs text-blue-900 bg-blue-100/80 border border-blue-200 px-2 py-0.5 rounded-lg">
                            SN #{item.id}
                          </span>
                          <span className="font-mono font-black text-blue-700 text-sm">
                            {item.rma_number}
                          </span>
                        </div>
                        <h4 className="font-bold text-slate-900 text-sm truncate" title={item.name}>
                          {item.name || `Unidentified (${item.barcode})`}
                        </h4>
                        <div className="font-mono text-xs text-slate-500">
                          Barcode: <strong className="text-slate-800">{item.barcode}</strong>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 shrink-0">
                          {item.reason || 'Damaged'}
                        </span>
                        {canDeleteReports && (
                          <button
                            type="button"
                            onClick={() => onDeleteReport && onDeleteReport(item.id, item.rma_number)}
                            className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-100 rounded-xl transition-colors"
                            title={`Delete RMA #${item.rma_number}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Reporter and Date */}
                    <div className="text-xs text-slate-600 pt-2 border-t border-slate-200/80 flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          <span className="font-bold text-slate-800">{reporterName}</span>
                        </div>
                        {reporterContact && (
                          <span className="font-mono text-slate-500 text-[11px]">{reporterContact}</span>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>{new Date(item.created_at).toLocaleString()}</span>
                        {item.gps_latitude && item.gps_longitude ? (
                          <a
                            href={`https://www.google.com/maps?q=${item.gps_latitude},${item.gps_longitude}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline inline-flex items-center gap-0.5 font-bold"
                          >
                            <MapPin className="w-3 h-3 text-rose-500" />
                            <span>View GPS Location</span>
                          </a>
                        ) : (
                          <span className="text-slate-400">GPS: Blank</span>
                        )}
                      </div>

                      {/* Proof Photos with Click-to-Zoom Lightbox */}
                      {photoList.length > 0 && (
                        <div className="flex items-center gap-2 pt-1.5">
                          <span className="text-[11px] text-slate-500 font-semibold">Proof Photos:</span>
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
                                className="w-10 h-10 rounded-xl overflow-hidden border border-slate-300 hover:scale-105 shadow-xs transition-transform cursor-zoom-in"
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
