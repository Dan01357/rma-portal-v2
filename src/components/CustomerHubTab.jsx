import React, { useState, useEffect } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Lock,
  MapPin,
  Package,
  Printer,
  QrCode,
  Receipt,
  RotateCcw,
  Search,
  Trash2,
  Truck,
  Unlock,
  X
} from 'lucide-react';
import TablePagination from './TablePagination';
import { exportCustomerInboundRMAsToCSV } from '../utils/exportCsv';
import {
  DEFECT_REASONS,
  cleanExplanationText,
  formatLifecycleStage,
  formatManifestBreakdown,
  formatQuantityWithPackSize,
  getDocumentNumbers,
  getRealPhotos,
  getReportManifestItems,
  hasAssignedSku,
  isBatchManifest,
  isItemRejected,
  isItemReorderNeeded,
  isItemScrappedNoReorder,
  isManifestSubItem,
  isSplitChildTicket,
  isSplitParentTicket,
  isUnlabeledBarcode,
  normalizeWarehouseLocation,
  resolveBatchManifestLifecycle
} from '../utils/rmaHelpers';

export default function CustomerHubTab({
  reportsList = [],
  creditMemosList = [],
  savedProductsList = [],
  currentUser,
  coworkerQueueFilter = 'all',
  onClearCoworkerQueueFilter,
  updatingQueueId = null,
  isTestMode = false,
  onOpenReportsModal,
  onOpenMatrixExport,
  onInspectTriage,
  onViewQR,
  onViewPhoto,
  onViewExplanation,
  onPrintLabel,
  onEditProductFromReport,
  onOpenCreditMemo,
  onViewCreditMemoVoucher,
  onConfirmCoworkerAction,
  onResetToPending,
  onArchiveReport,
  onBulkArchiveReports,
  onRequestDeleteReport,
  onRequestBulkDeleteReports,
  selectionResetTick = 0,
  externalStatusFilter = null
}) {
  const canEditProducts = currentUser?.role === 'super_admin' || currentUser?.role === 'admin' || currentUser?.role === 'staff';
  const canDeleteReports = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';

  const [reportsViewMode, setReportsViewMode] = useState(() => {
    return localStorage.getItem('rma_admin_reports_view_mode') || 'table';
  });

  // Return Reports Filtering, Sorting & Pagination State
  const [reportsSearchQuery, setReportsSearchQuery] = useState('');
  const [reportsReasonFilter, setReportsReasonFilter] = useState('all');
  const [reportsStatusFilter, setReportsStatusFilter] = useState('all');
  const [reportsDispositionFilter, setReportsDispositionFilter] = useState('all');
  const [reportsConditionGradeFilter, setReportsConditionGradeFilter] = useState('all');
  const [reportsDateFrom, setReportsDateFrom] = useState('');
  const [reportsDateTo, setReportsDateTo] = useState('');
  const [reportsSortField, setReportsSortField] = useState('id');
  const [reportsSortDirection, setReportsSortDirection] = useState('desc');
  const [reportsCurrentPage, setReportsCurrentPage] = useState(1);
  const [reportsPageSize, setReportsPageSize] = useState(10);
  const [selectedReportIds, setSelectedReportIds] = useState(new Set());
  const [expandedManifestIds, setExpandedManifestIds] = useState(new Set());
  const toggleManifestExpand = (id) => {
    setExpandedManifestIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };


  useEffect(() => {
    setSelectedReportIds(prev => {
      if (prev.size === 0) return prev;
      const valid = new Set(reportsList.flatMap(r => [r.id, r.rma_number].filter(Boolean)));
      const next = new Set([...prev].filter(id => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [reportsList]);


  // Clear selections when switching between Live Mode and Sandbox Test Mode
  useEffect(() => {
    setSelectedReportIds(new Set());
    setReportsCurrentPage(1);
  }, [isTestMode, selectionResetTick]);

  // Reset to page 1 when coworker queue filter changes
  useEffect(() => {
    setReportsCurrentPage(1);
  }, [coworkerQueueFilter]);

  // Honor external status filter navigation (e.g. from notification bell)
  useEffect(() => {
    if (externalStatusFilter && externalStatusFilter.value) {
      setReportsStatusFilter(externalStatusFilter.value);
      setReportsCurrentPage(1);
    }
  }, [externalStatusFilter]);

  const handleSetReportsViewMode = (mode) => {
    setReportsViewMode(mode);
    try {
      localStorage.setItem('rma_admin_reports_view_mode', mode);
    } catch (e) { }
  };

  const handleReportsSort = (field) => {
    setReportsCurrentPage(1);
    if (reportsSortField === field) {
      setReportsSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setReportsSortField(field);
      setReportsSortDirection('asc');
    }
  };


  const resetReportsFilters = () => {
    setReportsSearchQuery('');
    setReportsReasonFilter('all');
    setReportsStatusFilter('all');
    setReportsDispositionFilter('all');
    setReportsConditionGradeFilter('all');
    if (onClearCoworkerQueueFilter) onClearCoworkerQueueFilter();
    setReportsDateFrom('');
    setReportsDateTo('');
    setReportsCurrentPage(1);
    setSelectedReportIds(new Set());
  };

  const customerScopedTotal = React.useMemo(() => {
    return reportsList.filter(item => item.rma_type !== 'supplier_outbound' && !isManifestSubItem(item, reportsList)).length;
  }, [reportsList]);

  const isItemReadyToRestock = React.useCallback((item, allReports = reportsList) => {
    if (!item) return false;
    const isManifestRow = !item.is_unpacked_manifest_item && isBatchManifest(item, allReports);
    if (isManifestRow) {
      const children = getReportManifestItems(item, allReports);
      return children.some(c => {
        const d = String(c?.disposition || '').toLowerCase();
        const st = String(c?.status || '').toLowerCase();
        return d.includes('restock') && !['restocked', 'closed', 'resolved', 'scrapped', 'disposed'].includes(st);
      });
    }
    const disp = String(item.disposition || '').toLowerCase();
    const st = String(item.status || '').toLowerCase();
    return disp.includes('restock') && !['restocked', 'closed', 'resolved', 'scrapped', 'disposed'].includes(st);
  }, [reportsList]);

  const isItemReadyForSupplierReorder = React.useCallback((item, allReports = reportsList) => {
    if (!item) return false;
    const isManifestRow = !item.is_unpacked_manifest_item && isBatchManifest(item, allReports);
    if (isManifestRow) {
      const children = getReportManifestItems(item, allReports);
      return children.some(c => {
        const d = String(c?.disposition || '').toLowerCase();
        const st = String(c?.status || '').toLowerCase();
        return (d.includes('scrap') || d.includes('dispose') || d.includes('reorder')) && !['scrapped', 'disposed', 'closed', 'resolved', 'restocked'].includes(st);
      });
    }
    const disp = String(item.disposition || '').toLowerCase();
    const st = String(item.status || '').toLowerCase();
    return (disp.includes('scrap') || disp.includes('dispose') || disp.includes('reorder')) && !['scrapped', 'disposed', 'closed', 'resolved', 'restocked'].includes(st);
  }, [reportsList]);

  const isItemOnHold = React.useCallback((item, allReports = reportsList) => {
    if (!item) return false;
    const isManifestRow = !item.is_unpacked_manifest_item && isBatchManifest(item, allReports);
    if (isManifestRow) {
      const children = getReportManifestItems(item, allReports);
      return children.some(c => {
        const d = String(c?.disposition || '').toLowerCase();
        const st = String(c?.status || '').toLowerCase();
        return (d.includes('quarantine') || d.includes('hold') || st === 'quarantine' || st === 'hold') && !['closed', 'resolved', 'rejected', 'deleted'].includes(st);
      });
    }
    const disp = String(item.disposition || '').toLowerCase();
    const st = String(item.status || '').toLowerCase();
    return (disp.includes('quarantine') || disp.includes('hold') || st === 'quarantine' || st === 'hold') && !['closed', 'resolved', 'rejected', 'deleted'].includes(st);
  }, [reportsList]);

  const processedReports = React.useMemo(() => {
    const q = reportsSearchQuery.toLowerCase().trim();
    let list = reportsList.filter(item => {
      // Customer RMA Hub strictly isolates to Customer Inbound Returns at ALL times
      if (item.rma_type === 'supplier_outbound') {
        return false;
      }
      // Omit child rows of manifest returns (which share identical rma_number with parent)
      // BUT keep Split tickets (which have their own unique rma_number like -B, -C)
      if (isManifestSubItem(item, reportsList)) {
        return false;
      }

      if (q) {
        const matchesChild = Array.isArray(item.items) && item.items.some(child => (
          (child.barcode || '').toLowerCase().includes(q) ||
          (child.name || '').toLowerCase().includes(q) ||
          (child.sku || child.code || '').toLowerCase().includes(q)
        ));

        const matches = (
          matchesChild ||
          String(item.id || '').includes(q) ||
          (item.rma_number || '').toLowerCase().includes(q) ||
          (item.barcode || '').toLowerCase().includes(q) ||
          (item.name || '').toLowerCase().includes(q) ||
          (item.reporter_name || item.reported_by || '').toLowerCase().includes(q) ||
          (item.reporter_contact || '').toLowerCase().includes(q) ||
          (item.reason || '').toLowerCase().includes(q) ||
          (item.warehouse_location || '').toLowerCase().includes(q) ||
          (item.store_branch || '').toLowerCase().includes(q) ||
          (item.invoice_dr_number || '').toLowerCase().includes(q) ||
          (item.si_number || '').toLowerCase().includes(q) ||
          (item.dr_number || '').toLowerCase().includes(q) ||
          (item.po_number || '').toLowerCase().includes(q) ||
          (item.batch_lot_number || '').toLowerCase().includes(q)
        );
        if (!matches) return false;
      }

      if (reportsReasonFilter !== 'all') {
        const itemReasonNorm = (item.reason || '').replace(/^\d+-\s*/, '').toLowerCase().trim();
        const filterReasonNorm = reportsReasonFilter.replace(/^\d+-\s*/, '').toLowerCase().trim();
        if (itemReasonNorm !== filterReasonNorm) return false;
      }

      if (reportsStatusFilter !== 'all') {
        const s = String(item.status || 'received_at_dock').toLowerCase();
        if (reportsStatusFilter === 'pending_admin_details') {
          const isManifestRow = isBatchManifest(item, reportsList);
          if (isManifestRow) {
            const children = getReportManifestItems(item, reportsList);
            const hasUnmappedChild = children.some(child => !hasAssignedSku(child, savedProductsList));
            if (!hasUnmappedChild) return false;
          } else {
            const isUnmappedStandalone = !hasAssignedSku(item, savedProductsList) || s === 'pending_admin_details';
            if (!isUnmappedStandalone) return false;
          }
        } else if (reportsStatusFilter === 'received_at_dock') {
          if (s !== 'pending' && s !== 'received_at_dock') return false;
        } else if (reportsStatusFilter === 'draft') {
          if (s !== 'draft') return false;
        } else if (reportsStatusFilter === 'restocked') {
          if (s !== 'restocked' && s !== 'closed' && s !== 'resolved') return false;
        } else if (reportsStatusFilter === 'scrapped') {
          if (s !== 'scrapped' && s !== 'disposed') return false;
        } else if (s !== reportsStatusFilter.toLowerCase()) {
          return false;
        }
      }

      // Disposition filter (supports numbered prefix e.g. "1- Pending Triage")
      if (reportsDispositionFilter !== 'all') {
        const itemDispNorm = (item.disposition || 'Pending Triage').replace(/^\d+-\s*/, '').toLowerCase().trim();
        const filterDispNorm = reportsDispositionFilter.replace(/^\d+-\s*/, '').toLowerCase().trim();
        if (itemDispNorm !== filterDispNorm) return false;
      }

      // Condition Grade filter
      if (reportsConditionGradeFilter !== 'all') {
        const itemGrade = item.condition_grade || 'Unassessed';
        if (!itemGrade.toLowerCase().startsWith(reportsConditionGradeFilter.toLowerCase().charAt(0))) return false;
      }

      // Date Range filters
      // Unified Coworker Workstation Queue Filters
      if (coworkerQueueFilter === 'restock') {
        if (!isItemReadyToRestock(item, reportsList)) return false;
      } else if (coworkerQueueFilter === 'reorder' || coworkerQueueFilter === 'scrap') {
        if (!isItemReorderNeeded(item, reportsList)) return false;
      } else if (coworkerQueueFilter === 'scrap_no_reorder') {
        if (!isItemScrappedNoReorder(item, reportsList)) return false;
      } else if (coworkerQueueFilter === 'hold' || coworkerQueueFilter === 'quarantine') {
        if (!isItemOnHold(item, reportsList)) return false;
      } else if (coworkerQueueFilter === 'rejected') {
        if (!isItemRejected(item, reportsList)) return false;
      }

      if (reportsDateFrom) {
        const itemDate = new Date(item.created_at || 0).toISOString().slice(0, 10);
        if (itemDate < reportsDateFrom) return false;
      }

      if (reportsDateTo) {
        const itemDate = new Date(item.created_at || 0).toISOString().slice(0, 10);
        if (itemDate > reportsDateTo) return false;
      }

      return true;
    });

    list.sort((a, b) => {
      let valA, valB;
      switch (reportsSortField) {
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
        case 'quantity':
          valA = Number(a.quantity) || 1;
          valB = Number(b.quantity) || 1;
          break;
        case 'reason':
          valA = String(a.reason || '').toLowerCase();
          valB = String(b.reason || '').toLowerCase();
          break;
        case 'reporter':
          valA = String(a.reporter_name || a.reported_by || '').toLowerCase();
          valB = String(b.reporter_name || b.reported_by || '').toLowerCase();
          break;
        case 'store_branch':
          valA = String(a.store_branch || '').toLowerCase();
          valB = String(b.store_branch || '').toLowerCase();
          break;
        case 'invoice_dr_number':
          valA = String(a.invoice_dr_number || a.dr_number || a.si_number || a.po_number || '').toLowerCase();
          valB = String(b.invoice_dr_number || b.dr_number || b.si_number || b.po_number || '').toLowerCase();
          break;
        case 'status':
        case 'lifecycle_stage':
          valA = String(a.status || 'received_at_dock').toLowerCase();
          valB = String(b.status || 'received_at_dock').toLowerCase();
          break;
        case 'disposition':
          valA = String(a.disposition || 'Pending Triage').toLowerCase();
          valB = String(b.disposition || 'Pending Triage').toLowerCase();
          break;
        case 'warehouse_location':
          valA = String(a.warehouse_location || '').toLowerCase();
          valB = String(b.warehouse_location || '').toLowerCase();
          break;
        case 'created_at':
          valA = new Date(a.created_at || 0).getTime();
          valB = new Date(b.created_at || 0).getTime();
          break;
        default:
          valA = a.id;
          valB = b.id;
      }

      if (valA < valB) return reportsSortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return reportsSortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [
    reportsList,
    reportsSearchQuery,
    reportsReasonFilter,
    reportsStatusFilter,
    reportsDispositionFilter,
    reportsConditionGradeFilter,
    coworkerQueueFilter,
    isItemReadyToRestock,
    isItemReadyForSupplierReorder,
    reportsDateFrom,
    reportsDateTo,
    reportsSortField,
    reportsSortDirection
  ]);

  // Paginated Return Reports Slice
  const paginatedReports = React.useMemo(() => {
    const start = (reportsCurrentPage - 1) * reportsPageSize;
    return processedReports.slice(start, start + reportsPageSize);
  }, [processedReports, reportsCurrentPage, reportsPageSize]);

  // Bulk Selection Helpers for Reports (Strictly defined AFTER paginatedReports)
  const isAllReportsPageSelected = React.useMemo(() => {
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

  const toggleSelectAllReportsPage = () => {
    setSelectedReportIds(prev => {
      const next = new Set(prev);
      if (isAllReportsPageSelected) {
        paginatedReports.forEach(r => next.delete(r.id || r.rma_number));
      } else {
        paginatedReports.forEach(r => next.add(r.id || r.rma_number));
      }
      return next;
    });
  };

  const selectAllFilteredReports = () => {
    const next = new Set();
    processedReports.forEach(r => next.add(r.id || r.rma_number));
    setSelectedReportIds(next);
  };

  const clearReportsSelection = () => {
    setSelectedReportIds(new Set());
  };

  const selectedReportsList = React.useMemo(() => {
    return reportsList.filter(r => selectedReportIds.has(r.id || r.rma_number));
  }, [reportsList, selectedReportIds]);

  return (
  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-6 shadow-sm space-y-4 w-full min-w-0 box-border">
    {/* Header & Responsive Action Toolbar */}
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 w-full min-w-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-base font-black text-slate-900 dark:text-white tracking-tight">
            Customer RMA Hub (Inbound Logistics)
          </h3>
          {isTestMode && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-500 text-slate-950 shrink-0">
              🧪 Sandbox Test Mode
            </span>
          )}
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800 shrink-0">
            {processedReports.length} Returns Active
          </span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
          Store & branch merchandise returns, billing document matching, and customer credit memo vouchers.
        </p>
      </div>

      {/* Responsive Action Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 w-full lg:w-auto min-w-0">
        {/* View Switcher: Rows vs Cards */}
        <div className="flex items-center self-start sm:self-auto bg-slate-100 dark:bg-slate-800 p-0.5 sm:p-1 rounded-xl sm:rounded-2xl border border-slate-200/80 dark:border-slate-700 shrink-0">
          <button
            type="button"
            onClick={() => handleSetReportsViewMode('table')}
            className={`px-3 py-1.5 rounded-lg sm:rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer ${reportsViewMode === 'table'
              ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            title="Rows / Table View"
          >
            <List className="w-3.5 h-3.5 shrink-0" />
            <span>Rows List</span>
          </button>
          <button
            type="button"
            onClick={() => handleSetReportsViewMode('grid')}
            className={`px-3 py-1.5 rounded-lg sm:rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer ${reportsViewMode === 'grid'
              ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            title="Grid / Cards View"
          >
            <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
            <span>Cards</span>
          </button>
        </div>

        {/* Action Buttons: 2-column grid on mobile (< sm), flex on sm+ */}
        <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto min-w-0">
          <button
            type="button"
            onClick={() => onOpenReportsModal && onOpenReportsModal()}
            className="w-full sm:w-auto justify-center px-3 py-2 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
            title="Open Full Audit Log"
          >
            <FileText className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Full Audit Log</span>
            <ChevronRight className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
          </button>

          <button
            type="button"
            onClick={() => onOpenMatrixExport && onOpenMatrixExport('customer_inbound')}
            className="w-full sm:w-auto justify-center px-3 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-extrabold rounded-xl text-xs flex items-center gap-1.5 transition-colors shrink-0 shadow-2xs cursor-pointer"
            title="Download Customer Hub Daily Pieces Matrix (.xlsx) matching template"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">{isTestMode ? 'Sandbox Customer Matrix (.xlsx)' : 'Customer Matrix (.xlsx)'}</span>
          </button>

          <button
            type="button"
            onClick={() => exportCustomerInboundRMAsToCSV(processedReports, null, savedProductsList)}
            className="w-full sm:w-auto justify-center px-3 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-extrabold rounded-xl text-xs flex items-center gap-1.5 transition-colors shrink-0 shadow-2xs cursor-pointer"
            title="Export Customer Inbound RMAs to CSV with Store Branch, Customer Name, DR#, AE Name, and Credit Memo #"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Export Inbound CSV</span>
          </button>
        </div>
      </div>
    </div>

    {/* Filter / Search & Sort Controls Toolbar */}
    <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-3 sm:p-3.5 space-y-2.5 w-full min-w-0 box-border">

      {/* Search Input: Full width row */}
      <div className="relative w-full min-w-0">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 shrink-0" />
        <input
          type="text"
          value={reportsSearchQuery}
          onChange={(e) => {
            setReportsSearchQuery(e.target.value);
            setReportsCurrentPage(1);
          }}
          placeholder="Search by SN (#), RMA #, barcode, item name, reporter, or bin location..."
          className="w-full min-w-0 pl-10 pr-9 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-blue-600 transition-all box-border"
        />
        {reportsSearchQuery && (
          <button
            type="button"
            onClick={() => {
              setReportsSearchQuery('');
              setReportsCurrentPage(1);
            }}
            className="absolute right-3 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Dropdown Filters & Date Pickers in responsive grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2 w-full min-w-0">
        {/* Reason Filter Dropdown */}
        <select
          value={reportsReasonFilter}
          onChange={(e) => {
            setReportsReasonFilter(e.target.value);
            setReportsCurrentPage(1);
          }}
          className="w-full min-w-0 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-600 cursor-pointer truncate box-border"
        >
          <option value="all">All Reasons</option>
          {DEFECT_REASONS.map(r => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>

        {/* Condition Grade Filter Dropdown */}
        <select
          value={reportsConditionGradeFilter}
          onChange={(e) => {
            setReportsConditionGradeFilter(e.target.value);
            setReportsCurrentPage(1);
          }}
          className="w-full min-w-0 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-600 cursor-pointer truncate box-border"
        >
          <option value="all">All Grades</option>
          <option value="A">Grade A - Like New</option>
          <option value="B">Grade B - Damaged Pkg</option>
          <option value="C">Grade C - Defective / Parts</option>
          <option value="D">Grade D - Total Loss / Scrap</option>
        </select>

        {/* Status Filter Dropdown */}
        <select
          value={reportsStatusFilter}
          onChange={(e) => {
            setReportsStatusFilter(e.target.value);
            setReportsCurrentPage(1);
          }}
          className="w-full min-w-0 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-600 cursor-pointer truncate box-border"
        >
          <option value="all">All Status &amp; Stages</option>
          <option value="pending_admin_details">Awaiting SKU</option>
          <option value="draft">1- Draft / Intake</option>
          <option value="received_at_dock">2- Received at Dock</option>
          <option value="under_inspection">3- Under Inspection</option>
          <option value="pending_finance_approval">4- Pending Finance Approval</option>
          <option value="credit_memo_issued">5- Credit Memo Issued</option>
          <option value="restocked">6- Restocked</option>
          <option value="scrapped">7- Scrapped / Disposed</option>
          <option value="buffer_replacement_dispatched">🚚 Buffer Replacement Dispatched</option>
          <option value="rejected">8- Rejected / Invalid Claim</option>
        </select>

        {/* Date Range Picker: Neatly split in 2 columns */}
        <div className="grid grid-cols-2 gap-1.5 w-full min-w-0 col-span-1 sm:col-span-2 md:col-span-1 lg:col-span-1">
          <div className="flex items-center gap-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-2 py-1.5 rounded-xl text-xs min-w-0 box-border">
            <span className="text-[9px] font-bold text-slate-400 uppercase shrink-0">From</span>
            <input
              type="date"
              value={reportsDateFrom}
              onChange={(e) => {
                setReportsDateFrom(e.target.value);
                setReportsCurrentPage(1);
              }}
              className="bg-transparent text-slate-900 dark:text-white font-mono text-[11px] focus:outline-none cursor-pointer w-full min-w-0"
              title="Filter records from date"
            />
          </div>
          <div className="flex items-center gap-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-2 py-1.5 rounded-xl text-xs min-w-0 box-border">
            <span className="text-[9px] font-bold text-slate-400 uppercase shrink-0">To</span>
            <input
              type="date"
              value={reportsDateTo}
              onChange={(e) => {
                setReportsDateTo(e.target.value);
                setReportsCurrentPage(1);
              }}
              className="bg-transparent text-slate-900 dark:text-white font-mono text-[11px] focus:outline-none cursor-pointer w-full min-w-0"
              title="Filter records to date"
            />
          </div>
        </div>

        {/* Reset Filters */}
        {(reportsSearchQuery || reportsReasonFilter !== 'all' || reportsStatusFilter !== 'all' || reportsDispositionFilter !== 'all' || reportsConditionGradeFilter !== 'all' || coworkerQueueFilter !== 'all' || reportsDateFrom || reportsDateTo) && (
          <button
            type="button"
            onClick={resetReportsFilters}
            className="w-full sm:w-auto px-3 py-2 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-colors shrink-0 cursor-pointer box-border"
          >
            <RotateCcw className="w-3.5 h-3.5 shrink-0" />
            <span>Reset</span>
          </button>
        )}
      </div>



      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 px-1 font-medium">
        <span>
          Showing <strong className="text-slate-900 dark:text-white font-bold">{processedReports.length}</strong> of {customerScopedTotal} reports
          {(reportsSearchQuery || reportsReasonFilter !== 'all' || reportsStatusFilter !== 'all' || reportsDispositionFilter !== 'all' || reportsConditionGradeFilter !== 'all' || coworkerQueueFilter !== 'all' || reportsDateFrom || reportsDateTo) && (
            <span className="text-blue-600 dark:text-blue-400 font-bold ml-1.5">• Filters active</span>
          )}
        </span>
        <span className="text-slate-400 dark:text-slate-500">
          Click column headers to sort (<strong className="text-slate-700 dark:text-slate-300 capitalize">{reportsSortField}</strong> {reportsSortDirection === 'asc' ? '▲' : '▼'})
        </span>
      </div>
    </div>

    {customerScopedTotal === 0 ? (
      <p className="text-xs text-slate-400 py-8 text-center">No return reports filed yet.</p>
    ) : processedReports.length === 0 ? (
      <div className="text-center py-10 space-y-2 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700">
        <p className="text-xs font-bold text-slate-700 dark:text-slate-200">No return reports match the selected filters.</p>
        <button
          type="button"
          onClick={resetReportsFilters}
          className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline"
        >
          Clear filters
        </button>
      </div>
    ) : reportsViewMode === 'table' ? (
      /* ============================================================ */
      /* ROWS / TABLE VIEW: WITH SORTABLE COLUMNS & LIGHTBOX PHOTOS   */
      /* ============================================================ */
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50/90 dark:bg-slate-800/90 border-b border-slate-200 dark:border-slate-700 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {/* Select All Checkbox Header */}
                <th className="py-3 px-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={isAllReportsPageSelected}
                    onChange={toggleSelectAllReportsPage}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 cursor-pointer"
                    title={isAllReportsPageSelected ? "Deselect all on this page" : "Select all on this page"}
                  />
                </th>
                <th
                  onClick={() => handleReportsSort('id')}
                  className="py-3 px-3.5 font-black text-slate-900 dark:text-white w-16 cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors group"
                  title="Click to sort by Serial Number"
                >
                  <div className="flex items-center">
                    <span>SN</span>
                    {reportsSortField === 'id' ? (
                      reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                    ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                  </div>
                </th>
                <th
                  onClick={() => handleReportsSort('rma_number')}
                  className="py-3 px-3.5 font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                  title="Click to sort by RMA #"
                >
                  <div className="flex items-center">
                    <span>RMA #</span>
                    {reportsSortField === 'rma_number' ? (
                      reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                    ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                  </div>
                </th>
                <th className="py-3 px-3 w-14 text-center select-none">Photo</th>
                <th
                  onClick={() => handleReportsSort('barcode')}
                  className="py-3 px-3.5 font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                  title="Click to sort by Barcode"
                >
                  <div className="flex items-center">
                    <span>Barcode</span>
                    {reportsSortField === 'barcode' ? (
                      reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                    ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                  </div>
                </th>
                <th
                  onClick={() => handleReportsSort('name')}
                  className="py-3 px-3.5 font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                  title="Click to sort by Item Name"
                >
                  <div className="flex items-center">
                    <span>Item Name</span>
                    {reportsSortField === 'name' ? (
                      reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                    ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                  </div>
                </th>
                {/* Quantity & Unit Header */}
                <th
                  onClick={() => handleReportsSort('quantity')}
                  className="py-3 px-3 text-center font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                  title="Click to sort by Quantity & Unit"
                >
                  <div className="flex items-center justify-center">
                    <span>Qty & Unit</span>
                    {reportsSortField === 'quantity' ? (
                      reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                    ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                  </div>
                </th>
                <th
                  onClick={() => handleReportsSort('reason')}
                  className="py-3 px-3.5 font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                  title="Click to sort by Reason"
                >
                  <div className="flex items-center">
                    <span>Reason</span>
                    {reportsSortField === 'reason' ? (
                      reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                    ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                  </div>
                </th>
                {/* 7. Customer Branch Header */}
                <th
                  onClick={() => handleReportsSort('store_branch')}
                  className="py-3 px-3.5 font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                  title="Click to sort by Customer Branch"
                >
                  <div className="flex items-center">
                    <span>Customer Branch</span>
                    {reportsSortField === 'store_branch' ? (
                      reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                    ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                  </div>
                </th>

                {/* 8. Commercial Documents (SI / DR / PO #) Header */}
                <th
                  onClick={() => handleReportsSort('invoice_dr_number')}
                  className="py-3 px-3.5 font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                  title="Click to sort by Commercial Documents (Sales Invoice, Delivery Receipt, Purchase Order)"
                >
                  <div className="flex items-center">
                    <span>Commercial Docs (SI, DR, PO)</span>
                    {reportsSortField === 'invoice_dr_number' ? (
                      reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                    ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                  </div>
                </th>

                {/* 8. Lifecycle Stage Header */}
                <th
                  onClick={() => handleReportsSort('lifecycle_stage')}
                  className="py-3 px-3 text-center font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                  title="Click to sort by Lifecycle Stage"
                >
                  <div className="flex items-center justify-center">
                    <span>Lifecycle Stage</span>
                    {reportsSortField === 'lifecycle_stage' || reportsSortField === 'status' ? (
                      reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                    ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                  </div>
                </th>

                {/* 10. Disposition Header */}
                <th
                  onClick={() => handleReportsSort('disposition')}
                  className="py-3 px-3.5 text-center font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                  title="Click to sort by Disposition"
                >
                  <div className="flex items-center justify-center">
                    <span>Disposition</span>
                    {reportsSortField === 'disposition' ? (
                      reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                    ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                  </div>
                </th>

                {/* 11. Warehouse Location Header */}
                <th
                  onClick={() => handleReportsSort('warehouse_location')}
                  className="py-3 px-3 text-center font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                  title="Click to sort by Warehouse Rack/Bin Location"
                >
                  <div className="flex items-center justify-center">
                    <span>Location</span>
                    {reportsSortField === 'warehouse_location' ? (
                      reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                    ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                  </div>
                </th>
                <th
                  onClick={() => handleReportsSort('created_at')}
                  className="py-3 px-3.5 text-right font-bold cursor-pointer select-none hover:text-blue-600 transition-colors group"
                  title="Click to sort by Date"
                >
                  <div className="flex items-center justify-end">
                    <span>Date & GPS</span>
                    {reportsSortField === 'created_at' ? (
                      reportsSortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" /> : <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
                    ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />}
                  </div>
                </th>
                <th className="py-3 px-3.5 text-center font-bold select-none text-slate-500 dark:text-slate-400">
                  Finance & Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
              {paginatedReports.map((item, index) => {
                const photoList = getRealPhotos(item.photos);
                const isSelected = selectedReportIds.has(item.id || item.rma_number);
                const matchedProduct = savedProductsList.find(p => p.barcode && String(p.barcode) === String(item.barcode));
                const resolvedName = (item.name && !item.name.toLowerCase().startsWith('unidentified'))
                  ? item.name
                  : (matchedProduct?.name || item.name || `Unidentified (${item.barcode})`);
                const isPendingUnknown = !matchedProduct && item.status === 'pending_admin_details';

                const isManifest = isBatchManifest(item, reportsList);
                const manifestChildren = isManifest ? getReportManifestItems(item, reportsList) : [];
                const manifestKey = item.id || item.rma_number;
                const isManifestExpanded = expandedManifestIds.has(manifestKey);

                return (
                  <React.Fragment key={manifestKey}>
                    <tr
                      onClick={(e) => {
                        if (e.target.closest('input, button, a')) return;
                        onInspectTriage(item);
                      }}
                      className={`transition-colors cursor-pointer ${isSelected
                        ? 'bg-blue-50/80 dark:bg-blue-950/50'
                        : 'hover:bg-blue-50/50 dark:hover:bg-slate-800/60'
                        }`}
                      title={`Click row to inspect & triage RMA #${item.rma_number}`}
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
                          #{(reportsCurrentPage - 1) * reportsPageSize + index + 1}
                        </span>
                      </td>

                      {/* 2. RMA # + QR Sticker Button */}
                      <td className="py-3 px-3.5 font-mono font-bold text-blue-700 dark:text-blue-400">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onInspectTriage(item)}
                            className="font-mono font-bold text-blue-700 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-200 hover:underline text-left cursor-pointer"
                            title={`Inspect, triage, and process RMA #${item.rma_number}`}
                          >
                            {item.rma_number}
                          </button>
                          <button
                            type="button"
                            onClick={() => onViewQR && onViewQR({ ...item, name: resolvedName })}
                            className="p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/60 rounded-md transition-colors cursor-pointer"
                            title={`View & Print Box QR Sticker for ${item.rma_number}`}
                          >
                            <QrCode className="w-3.5 h-3.5" />
                          </button>
                          {item.ai_document_metadata?.delivery_handover && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 inline-flex items-center gap-1 shadow-2xs">
                              <Truck className="w-2.5 h-2.5" />
                              <span>Delivered ({item.ai_document_metadata.delivery_handover.driver_name || 'Driver'})</span>
                            </span>
                          )}
                        </div>
                        {/* Split, Buffer, and Manifest Quick Badges */}
                        <div className="flex items-center gap-1 flex-wrap mt-0.5">
                          {isManifest && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleManifestExpand(manifestKey);
                              }}
                              className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider inline-flex items-center gap-1 shadow-2xs transition-colors cursor-pointer ${isManifestExpanded
                                  ? 'bg-purple-600 text-white border border-purple-700'
                                  : 'bg-purple-100 hover:bg-purple-200 dark:bg-purple-950/70 dark:hover:bg-purple-900/80 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-800'
                                }`}
                              title={isManifestExpanded ? "Collapse Manifest Items" : "Expand Manifest Items"}
                            >
                              <span>📦 Manifest ({manifestChildren.length})</span>
                              <ChevronDown className={`w-2.5 h-2.5 transform transition-transform ${isManifestExpanded ? 'rotate-180' : ''}`} />
                            </button>
                          )}
                          {isSplitChildTicket(item) ? (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 inline-flex items-center gap-0.5 shadow-2xs" title="Split Child Ticket (Part 2)">
                              <span>✂️ Part 2</span>
                            </span>
                          ) : isSplitParentTicket(item, reportsList) ? (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-800 inline-flex items-center gap-0.5 shadow-2xs" title="Split Parent Ticket (Part 1)">
                              <span>✂️ Part 1</span>
                            </span>
                          ) : null}

                          {(item.status === 'buffer_replacement_dispatched' || (item.disposition && item.disposition.includes('Buffer'))) && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800 inline-flex items-center gap-0.5 shadow-2xs" title="1-to-1 Buffer Stock Replacement Dispatched">
                              <span>🚚 Buffer</span>
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 3. Photo Thumbnail with Lightbox */}
                      <td className="py-2.5 px-3 text-center">
                        {photoList.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => onViewPhoto && onViewPhoto({
                              images: photoList,
                              initialIndex: 0,
                              url: photoList[0],
                              title: resolvedName || `Return ${item.rma_number}`,
                              subtitle: `RMA #${item.rma_number} • Reported by ${item.reporter_name || item.reported_by || 'Staff'} • ${item.reason || 'Damaged'}`
                            })}
                            className="w-10 h-10 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 inline-block hover:opacity-85 hover:scale-105 transition-all shadow-xs cursor-zoom-in"
                            title="Click to view full-size proof photo"
                          >
                            <img
                              src={photoList[0]}
                              alt="Proof"
                              className="w-full h-full object-cover"
                            />
                          </button>
                        ) : (
                          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto border border-slate-200 dark:border-slate-700">
                            <ImageIcon className="w-4 h-4" />
                          </div>
                        )}
                      </td>

                      {/* 4. Barcode */}
                      <td className="py-3 px-3.5 font-mono">
                        {isManifest ? (
                          <span className="px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 font-bold text-[10px] border border-purple-200 dark:border-purple-800">
                            📦 Manifest Items
                          </span>
                        ) : (
                          <>
                            <div className="font-bold text-slate-800 dark:text-slate-200">{item.barcode}</div>
                            {(item.code || matchedProduct?.code) && (
                              <div className="text-[10px] text-slate-400 dark:text-slate-500">{item.code || matchedProduct?.code}</div>
                            )}
                            {(isUnlabeledBarcode(item.barcode) || item.ai_document_metadata?.is_unlabeled) && (
                              <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                                🏷️ Missing Barcode
                              </span>
                            )}
                          </>
                        )}
                      </td>

                      {/* 5. Item Name */}
                      <td className="py-3 px-3.5 font-bold text-slate-900 dark:text-white max-w-[200px]" title={resolvedName}>
                        <div className="flex items-center gap-1.5">
                          <div className="truncate">{resolvedName}</div>
                          {isManifest && manifestChildren.length > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleManifestExpand(manifestKey);
                              }}
                              className="p-0.5 text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-300 rounded hover:bg-purple-50 dark:hover:bg-purple-950/60 transition-colors shrink-0"
                              title={isManifestExpanded ? "Collapse Manifest Items" : "Expand Manifest Items"}
                            >
                              <ChevronDown className={`w-3.5 h-3.5 transform transition-transform ${isManifestExpanded ? 'rotate-180' : ''}`} />
                            </button>
                          )}
                        </div>
                        {((item.supplier_name && item.supplier_name !== 'Pending Assignment') || (matchedProduct?.supplier_name && matchedProduct.supplier_name !== 'Pending Assignment')) && (
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium truncate mt-0.5">
                            Vendor: <span className="font-semibold text-slate-700 dark:text-slate-300">{item.supplier_name || matchedProduct?.supplier_name}</span>
                          </div>
                        )}
                        {(item.batch_lot_number || item.expiry_date) && (
                          <div className="flex items-center gap-1.5 flex-wrap mt-0.5 font-normal">
                            {item.batch_lot_number && (
                              <span className="text-[10px] font-mono text-amber-700 dark:text-amber-300 font-semibold bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.2 rounded border border-amber-200/80 dark:border-amber-800">
                                Lot: {item.batch_lot_number}
                              </span>
                            )}
                            {item.expiry_date && (
                              <span className="text-[10px] font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 px-1.5 py-0.2 rounded border border-rose-200/80 dark:border-rose-800">
                                Exp: {item.expiry_date}
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Quantity & Unit Column */}
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        <span className="font-mono font-black text-xs text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 shadow-2xs inline-flex items-center gap-1">
                          <span>
                            {isManifest
                              ? formatManifestBreakdown(manifestChildren, false)
                              : formatQuantityWithPackSize(item.quantity, item.unit_name, item.pieces_per_case || matchedProduct?.pieces_per_case)}
                          </span>
                        </span>
                      </td>

                      {/* 6. Reason & Truncated Reporter Explanation */}
                      <td className="py-3 px-3.5 max-w-[180px]">
                        <div className="space-y-1">
                          <span className="px-2 py-0.5 rounded-lg bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 font-bold text-[10px] inline-block">
                            {item.reason || 'Damaged'}
                          </span>
                          {(() => {
                            const rawNote = String(
                              item.explanation ||
                              item.notes ||
                              (!isManifest && item.items?.[0]?.explanation ? item.items[0].explanation : '') ||
                              ''
                            ).trim();
                            const cleanNote = cleanExplanationText(rawNote);
                            if (!cleanNote) return null;
                            return (
                              <div className="flex items-center gap-1 max-w-[165px]">
                                <button
                                  type="button"
                                  onClick={() => onViewExplanation && onViewExplanation({
                                    rmaNumber: item.rma_number,
                                    productName: resolvedName,
                                    reason: item.reason || 'Damaged',
                                    explanation: cleanNote,
                                    reporter: item.reporter_name || item.reported_by || 'Staff'
                                  })}
                                  className="group text-left flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100/90 hover:bg-blue-50 dark:bg-slate-800/80 dark:hover:bg-blue-950/60 border border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 transition-colors cursor-pointer max-w-full"
                                  title="Click to read full reporter explanation"
                                >
                                  <span className="text-[10px] text-slate-600 dark:text-slate-300 italic truncate max-w-[110px]">
                                    "{cleanNote}"
                                  </span>
                                  <span className="text-[9px] font-black text-blue-600 dark:text-blue-400 shrink-0 group-hover:underline">
                                    Read
                                  </span>
                                </button>
                              </div>
                            );
                          })()}
                        </div>
                      </td>

                      {/* 7. Customer Branch & Reporter */}
                      <td className="py-3 px-3.5">
                        <div className="font-bold text-slate-900 dark:text-slate-200 text-[11px] flex items-center gap-1" title={item.store_branch || 'Direct Return'}>
                          <span className="text-blue-600 dark:text-blue-400">📍</span>
                          <span className="truncate max-w-[130px] font-extrabold text-blue-900 dark:text-blue-300">
                            {item.store_branch || 'Direct Return'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium mt-0.5 truncate max-w-[130px]">
                          {item.reporter_name || item.reported_by || 'Staff'}
                          {item.reporter_contact ? ` • ${item.reporter_contact}` : ''}
                        </div>
                      </td>

                      {/* 8. Commercial Document (SI / DR / PO) */}
                      <td className="py-3 px-3.5 font-mono">
                        {(() => {
                          const docs = getDocumentNumbers(item);
                          return (
                            <div className="space-y-0.5 text-[9px] font-mono leading-tight">
                              <span className={`px-1.5 py-0.5 rounded block truncate max-w-[125px] ${docs.si !== 'N/A'
                                  ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-bold'
                                  : 'bg-slate-50 dark:bg-slate-800/40 text-slate-400 dark:text-slate-500 border border-slate-200/50 dark:border-slate-700/50 font-medium'
                                }`}>
                                SI: {docs.si}
                              </span>
                              <span className={`px-1.5 py-0.5 rounded block truncate max-w-[125px] ${docs.dr !== 'N/A'
                                  ? 'bg-violet-50 dark:bg-violet-950/70 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 font-bold'
                                  : 'bg-slate-50 dark:bg-slate-800/40 text-slate-400 dark:text-slate-500 border border-slate-200/50 dark:border-slate-700/50 font-medium'
                                }`}>
                                DR: {docs.dr}
                              </span>
                              <span className={`px-1.5 py-0.5 rounded block truncate max-w-[125px] ${docs.po !== 'N/A'
                                  ? 'bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-bold'
                                  : 'bg-slate-50 dark:bg-slate-800/40 text-slate-400 dark:text-slate-500 border border-slate-200/50 dark:border-slate-700/50 font-medium'
                                }`}>
                                PO: {docs.po}
                              </span>
                            </div>
                          );
                        })()}
                      </td>

                      {/* 8. Lifecycle Stage */}
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        {isManifest ? (() => {
                          const dynStage = resolveBatchManifestLifecycle(item, reportsList);
                          return (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleManifestExpand(manifestKey);
                              }}
                              className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border inline-flex items-center gap-1 hover:opacity-90 cursor-pointer shadow-2xs ${dynStage.color}`}
                              title="Dynamically resolved from child item dispositions (click to open drawer)"
                            >
                              <span>{dynStage.label}</span>
                            </button>
                          );
                        })() : (() => {
                          const stageInfo = formatLifecycleStage(item.status, item);
                          return (
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border uppercase tracking-wider inline-block shadow-2xs ${stageInfo.color}`}>
                              {stageInfo.label}
                            </span>
                          );
                        })()}
                      </td>

                      {/* 10. Disposition (Full text without truncation) */}
                      <td className="py-3 px-3.5 text-center whitespace-nowrap">
                        {isManifest ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleManifestExpand(manifestKey);
                            }}
                            className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border border-purple-300 dark:border-purple-800 inline-flex items-center gap-1 hover:bg-purple-200 cursor-pointer shadow-2xs"
                            title="Click to view child line items in drawer"
                          >
                            <span>📦 Multi-Item Status (See Drawer)</span>
                          </button>
                        ) : (() => {
                          const disp = item.disposition || 'Pending Triage';
                          let color = 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
                          if (disp === 'Restock to Inventory') color = 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/70 dark:text-blue-300 dark:border-blue-800';
                          else if (disp === 'Return to Vendor (RTV)') color = 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/70 dark:text-purple-300 dark:border-purple-800';
                          else if (disp === 'Quarantine') color = 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800';
                          else if (disp === 'Scrap / Dispose') color = 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-800';
                          else if (disp.includes('Buffer')) color = 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/70 dark:text-indigo-300 dark:border-indigo-800';
                          return (
                            <span className={`px-2.5 py-0.5 rounded-lg text-[10px] font-extrabold border inline-block whitespace-nowrap shadow-2xs ${color}`}>
                              {disp}
                            </span>
                          );
                        })()}
                      </td>

                      {/* 11. Warehouse Rack/Bin Location */}
                      <td className="py-3 px-3.5 text-center font-mono whitespace-nowrap">
                        {item.warehouse_location ? (
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 text-[11px] font-extrabold inline-block shadow-2xs">
                            {normalizeWarehouseLocation(item.warehouse_location, item)}
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600 text-xs font-bold">—</span>
                        )}
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

                      {/* 10. Actions: Assign SKU / Save Product, Credit Memo, Thermal Print & Delete */}
                      <td className="py-2.5 px-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Print 4x6 Thermal Box Label */}
                          <button
                            type="button"
                            onClick={() => onPrintLabel && onPrintLabel(item)}
                            className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                            title="Print 4x6 inch Thermal Box Label"
                          >
                            <Printer className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                          </button>

                          {/* Inspect & Triage Physical Return */}
                          <button
                            type="button"
                            onClick={() => onInspectTriage(item)}
                            className="px-2 py-1 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/70 dark:hover:bg-amber-900/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                            title={`Inspect, triage condition grade, and assign rack/bin location for ${item.rma_number}`}
                          >
                            <ClipboardCheck className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                            <span>Inspect / Triage</span>
                          </button>

                          {/* 1-Click Coworker WMS Restock Action */}
                          {isItemReadyToRestock(item, reportsList) && (
                            <button
                              type="button"
                              disabled={updatingQueueId === (item.id || item.rma_number)}
                              onClick={() => onConfirmCoworkerAction(item, 'restocked')}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-500 rounded-lg text-[10px] font-black flex items-center gap-1 transition-all cursor-pointer shadow-2xs whitespace-nowrap disabled:opacity-50"
                              title="1-click confirm that this item has been stocked in WMS (updates status to 6- Restocked)"
                            >
                              <span>✓ Restocked in WMS</span>
                            </button>
                          )}

                          {/* 1-Click Coworker Supplier Re-Order Action */}
                          {isItemReadyForSupplierReorder(item, reportsList) && (
                            <button
                              type="button"
                              disabled={updatingQueueId === (item.id || item.rma_number)}
                              onClick={() => onConfirmCoworkerAction(item, 'scrapped')}
                              className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white border border-rose-500 rounded-lg text-[10px] font-black flex items-center gap-1 transition-all cursor-pointer shadow-2xs whitespace-nowrap disabled:opacity-50"
                              title="1-click confirm that a replacement order has been placed with supplier (updates status to 7- Scrapped / Disposed)"
                            >
                              <span>✓ PO Placed</span>
                            </button>
                          )}

                          {/* Re-open / Reset to Pending Action for Testing Coworker Actions */}
                          {Boolean(item.ai_document_metadata?.workflow_resolution || item.status === 'resolved' || item.status === 'closed') && (
                            <button
                              type="button"
                              disabled={updatingQueueId === (item.id || item.rma_number)}
                              onClick={() => onResetToPending && onResetToPending(item)}
                              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-2xs whitespace-nowrap"
                              title="Re-open item and reset to pending so coworker queues can test restocking/reordering again"
                            >
                              <RotateCcw className="w-3 h-3 text-slate-500" />
                              <span>↩️ Reset to Pending</span>
                            </button>
                          )}

                          {/* Release Hold Action */}
                          {isItemOnHold(item, reportsList) && (
                            <button
                              type="button"
                              onClick={() => onInspectTriage(item)}
                              className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white border border-amber-600 rounded-lg text-[10px] font-black flex items-center gap-1 transition-all cursor-pointer shadow-2xs whitespace-nowrap"
                              title="Release hold and re-triage to Restock, RTV, or Scrap"
                            >
                              <Unlock className="w-3 h-3" />
                              <span>🔓 Release Hold</span>
                            </button>
                          )}

                          {/* Do NOT render Assign SKU on parent row if batch manifest */}
                          {!isManifest && canEditProducts && !savedProductsList.some(p => p.barcode && String(p.barcode) === String(item.barcode)) && (
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
                            if (isManifest) {
                              const linkedMemos = creditMemosList.filter(m => m.rma_number === item.rma_number || m.report_id === item.id);
                              if (linkedMemos.length > 0) {
                                return (
                                  <button
                                    type="button"
                                    onClick={() => onViewCreditMemoVoucher(linkedMemos.length === 1 ? linkedMemos[0] : linkedMemos)}
                                    className="px-2.5 py-1 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/70 dark:hover:bg-emerald-900/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded-lg text-[10px] font-black flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                                    title={`View ${linkedMemos.length} Credit Memo Voucher(s) for this batch`}
                                  >
                                    <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                    <span>CM Voucher{linkedMemos.length > 1 ? ` (${linkedMemos.length})` : ''}</span>
                                  </button>
                                );
                              }
                              return (
                                <button
                                  type="button"
                                  onClick={() => toggleManifestExpand(manifestKey)}
                                  className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/70 dark:hover:bg-purple-900/70 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                                  title="View manifest line items to issue individual Credit Memos"
                                >
                                  <Receipt className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                                  <span>CM in Drawer</span>
                                </button>
                              );
                            }

                            const existingMemo = creditMemosList.find(m => m.rma_number === item.rma_number || m.report_id === item.id);
                            if (existingMemo) {
                              return (
                                <button
                                  type="button"
                                  onClick={() => onViewCreditMemoVoucher(existingMemo)}
                                  className="px-2.5 py-1 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/70 dark:hover:bg-emerald-900/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded-lg text-[10px] font-black flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                                  title={`View Official Credit Memo Voucher: ${existingMemo.credit_memo_number}`}
                                >
                                  <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                  <span>CM Voucher</span>
                                </button>
                              );
                            }
                            if (item.status === 'buffer_replacement_dispatched' || (item.disposition && item.disposition.includes('Buffer'))) {
                              return (
                                <span
                                  className="px-2 py-1 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 shadow-2xs whitespace-nowrap"
                                  title="This return was resolved via 1-to-1 Buffer Stock Replacement. No Credit Memo refund is due."
                                >
                                  <Truck className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                                  <span>Buffer Swapped</span>
                                </span>
                              );
                            }
                            const isReportOnHold = isItemOnHold(item, reportsList);
                            const isReportRejected = isItemRejected(item, reportsList);
                            if (canEditProducts) {
                              return (
                                <button
                                  type="button"
                                  disabled={isReportOnHold || isReportRejected}
                                  onClick={() => {
                                    if (isReportOnHold) {
                                      alert("Item is on Hold / Quarantine. Resolve hold before issuing financial claims.");
                                      return;
                                    }
                                    onOpenCreditMemo(item);
                                  }}
                                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all shadow-2xs ${
                                    isReportOnHold
                                      ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-300 dark:border-slate-700 opacity-70'
                                      : 'bg-slate-100 hover:bg-emerald-50 dark:bg-slate-800 dark:hover:bg-emerald-950/50 text-slate-700 hover:text-emerald-700 dark:text-slate-300 dark:hover:text-emerald-300 border border-slate-300 dark:border-slate-700 hover:border-emerald-400 cursor-pointer'
                                  }`}
                                  title={isReportOnHold ? "Item is on Hold / Quarantine. Resolve hold before issuing financial claims." : "Issue Finance Credit Memo for this Return"}
                                >
                                  {isReportOnHold ? <Lock className="w-3 h-3 text-amber-500" /> : <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />}
                                  <span>{isReportOnHold ? 'On Hold' : '+ Credit Memo'}</span>
                                </button>
                              );
                            }
                            return null;
                          })()}

                          {/* Archive to Vault */}
                          <button
                            type="button"
                            onClick={() => onArchiveReport(item.id, item.rma_number, item)}
                            className="p-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                            title={`Archive RMA #${item.rma_number} to Enterprise Vault`}
                          >
                            <Archive className="w-4 h-4 text-slate-500 hover:text-slate-700" />
                          </button>

                          {canDeleteReports && (
                            <button
                              type="button"
                              onClick={() => onRequestDeleteReport(item.id, item.rma_number, item)}
                              className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-xl transition-colors cursor-pointer"
                              title={`Move RMA #${item.rma_number} to 30-Day Trash Bin`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Expandable Multi-Item Manifest Sub-Table Drawer */}
                    {isManifest && isManifestExpanded && (
                      <tr className="bg-purple-50/40 dark:bg-slate-900/90 border-y-2 border-purple-200 dark:border-purple-900/60">
                        <td colSpan={15} className="p-3 sm:p-4">
                          <div className="bg-white dark:bg-slate-800/90 rounded-xl border border-purple-200 dark:border-purple-800/60 shadow-sm overflow-hidden">
                            {/* Manifest Header */}
                            <div className="p-3 bg-purple-50/70 dark:bg-purple-950/40 border-b border-purple-200/80 dark:border-purple-900/50 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="p-1 rounded-md bg-purple-600 text-white">
                                  <Package className="w-3.5 h-3.5" />
                                </span>
                                <span className="font-extrabold text-xs text-purple-900 dark:text-purple-200 uppercase tracking-wider">
                                  Batch Return Manifest Items ({manifestChildren.length})
                                </span>
                                <span className="text-[11px] text-purple-700 dark:text-purple-300 font-mono">
                                  RMA: {item.rma_number}
                                </span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                  Total manifest breakdown: <strong className="text-slate-900 dark:text-white font-bold">{formatManifestBreakdown(manifestChildren, true)}</strong>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => toggleManifestExpand(manifestKey)}
                                  className="text-xs text-purple-700 dark:text-purple-300 hover:text-purple-900 font-bold px-2 py-0.5 rounded hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors"
                                >
                                  Collapse ▲
                                </button>
                              </div>
                            </div>

                            {/* Child Items Table */}
                            <div className="overflow-x-auto lg:overflow-x-visible">
                              <table className="table-fixed w-full text-left text-xs border-collapse">
                                <thead>
                                  <tr className="bg-slate-50/80 dark:bg-slate-800/50 text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                    <th className="py-2 px-1 text-center w-[50px]">Item</th>
                                    <th className="py-2 px-3 min-w-[200px]">Product Description / Name</th>
                                    <th className="py-2 px-3 font-mono w-[140px]">Barcode</th>
                                    <th className="py-2 px-3 font-mono w-[120px]">Assigned SKU</th>
                                    <th className="py-2 px-3 text-center w-[80px]">Qty &amp; Unit</th>
                                    <th className="py-2 px-3 w-[170px]">Triage &amp; Reason</th>
                                    <th className="py-2 px-2 text-center w-[170px]">Actions</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                                  {manifestChildren.length === 0 ? (
                                    <tr>
                                      <td colSpan={7} className="py-4 text-center text-slate-400 italic">
                                        No line item breakdown records found for this batch manifest.
                                      </td>
                                    </tr>
                                  ) : (
                                    manifestChildren.map((child, cIdx) => {
                                      const childName = (child.name || child.item_name || child.productName || `Item #${cIdx + 1}`).trim();
                                      const childBarcode = (child.barcode || child.item_barcode || '').trim();
                                      const childSku = (child.sku || child.code || '').trim();
                                      const childQty = Number(child.quantity || child.qty) || 1;
                                      const childUnit = child.unit_name || child.unit || item.unit_name || 'pc';
                                      const childReason = child.reason || child.defect_reason || item.reason || 'Damaged';
                                      const childLocation = (child.warehouse_location || child.location || '').trim();
                                      const childDisposition = child.disposition || '1- Pending Triage';
                                      const matchedChild = savedProductsList.find(p => p.barcode && String(p.barcode) === String(childBarcode));
                                      const isSkuAssigned = Boolean(
                                        (matchedChild?.code && String(matchedChild.code) !== String(childBarcode) && !matchedChild.code.toLowerCase().includes('awaiting')) ||
                                        (childSku && String(childSku) !== String(childBarcode) && !childSku.toLowerCase().includes('awaiting'))
                                      );
                                      const effectiveSku = (matchedChild?.code && String(matchedChild.code) !== String(childBarcode))
                                        ? matchedChild.code
                                        : (childSku && String(childSku) !== String(childBarcode) && !childSku.toLowerCase().includes('awaiting') ? childSku : '—');

                                      // Extract child photos
                                      const cPhotos = Array.isArray(child.photos)
                                        ? child.photos
                                        : (Array.isArray(child.photoFiles) ? child.photoFiles : (child.photo_url ? [child.photo_url] : []));
                                      const cPhotoUrl = cPhotos[0] || (photoList[cIdx] || null);

                                      const childExistingMemo = creditMemosList.find(m =>
                                      (m.rma_number === item.rma_number && (
                                        (childBarcode && String(m.barcode).trim() === childBarcode) ||
                                        (child.id && String(m.report_id) === String(child.id)) ||
                                        (m.product_name && m.product_name === childName)
                                      ))
                                      );

                                      const childReportObject = {
                                        id: child.id || `${item.id || item.rma_number}_${childBarcode}`,
                                        rma_number: item.rma_number,
                                        barcode: childBarcode,
                                        code: effectiveSku !== '—' ? effectiveSku : (childSku || ''),
                                        sku: effectiveSku !== '—' ? effectiveSku : (childSku || ''),
                                        name: childName,
                                        product_name: childName,
                                        quantity: childQty,
                                        unit_name: childUnit,
                                        price: Number(child.price || matchedChild?.price || 0),
                                        price_with_vat: Number(child.price_with_vat || child.price || matchedChild?.price_with_vat || matchedChild?.price || 0),
                                        supplier_name: child.supplier_name || matchedChild?.supplier_name || item.supplier_name || 'Savemore',
                                        store_branch: item.store_branch,
                                        customer_branch: item.store_branch,
                                        ae_name: item.ae_name,
                                        ae_email: item.ae_email,
                                        child_id: child.id,
                                        is_manifest_child: true,
                                        parent_rma_id: item.id
                                      };

                                      return (
                                        <tr key={child.id || `child_${cIdx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                          {/* Line # / Photo: 50px */}
                                          <td className="py-2 px-1 text-center w-[50px]">
                                            <div className="flex flex-col items-center justify-center gap-1">
                                              <span className="text-[10px] text-slate-400 font-mono font-bold leading-none">#{cIdx + 1}</span>
                                              {cPhotoUrl ? (
                                                <button
                                                  type="button"
                                                  onClick={() => onViewPhoto && onViewPhoto({
                                                    images: [cPhotoUrl],
                                                    initialIndex: 0,
                                                    url: cPhotoUrl,
                                                    title: childName,
                                                    subtitle: `Manifest item #${cIdx + 1} of ${item.rma_number} • ${childReason}`
                                                  })}
                                                  className="w-7 h-7 rounded-md overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 inline-block hover:scale-105 transition-transform cursor-zoom-in"
                                                  title="Click to zoom image"
                                                >
                                                  <img src={cPhotoUrl} alt={childName} className="w-full h-full object-cover" />
                                                </button>
                                              ) : (
                                                <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto border border-slate-200 dark:border-slate-700">
                                                  <ImageIcon className="w-3 h-3" />
                                                </div>
                                              )}
                                            </div>
                                          </td>
                                          {/* Product Description: min-w-[200px] with truncate and title={it.name} */}
                                          <td className="py-2 px-3 font-bold text-slate-900 dark:text-white min-w-[200px] truncate" title={childName}>
                                            <div className="truncate">{childName}</div>
                                            {child.defect_details && (
                                              <div className="text-[10px] text-slate-400 font-normal italic truncate" title={child.defect_details}>{child.defect_details}</div>
                                            )}
                                          </td>
                                          {/* Barcode: 140px font-mono */}
                                          <td className="py-2 px-3 font-mono font-bold text-slate-700 dark:text-slate-300 w-[140px] truncate" title={childBarcode || '—'}>
                                            {childBarcode || '—'}
                                          </td>
                                          {/* Assigned SKU: 120px */}
                                          <td className="py-2 px-3 font-mono text-slate-600 dark:text-slate-400 w-[120px] truncate">
                                            {isSkuAssigned ? (
                                              <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800 text-[11px]">
                                                {effectiveSku}
                                              </span>
                                            ) : (
                                              <span className="text-amber-600 dark:text-amber-400 font-semibold text-[10px]">
                                                Awaiting SKU
                                              </span>
                                            )}
                                          </td>
                                          {/* Qty & Unit: 80px */}
                                          <td className="py-2 px-3 text-center font-mono w-[80px]">
                                            <div className="flex flex-col items-center gap-0.5">
                                              <span className="font-bold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-700/60 px-1.5 py-0.5 rounded-md text-[11px] truncate" title={formatQuantityWithPackSize(childQty, childUnit, child.pieces_per_case || matchedChild?.pieces_per_case)}>
                                                {formatQuantityWithPackSize(childQty, childUnit, child.pieces_per_case || matchedChild?.pieces_per_case)}
                                              </span>
                                              {childLocation && (
                                                <span className="text-[9px] text-indigo-600 dark:text-indigo-400 font-bold truncate max-w-[75px]" title={childLocation}>
                                                  📍 {childLocation}
                                                </span>
                                              )}
                                            </div>
                                          </td>
                                          {/* Triage & Reason: 170px */}
                                          <td className="py-2 px-3 w-[170px]">
                                            <div className="space-y-1">
                                              <div className="truncate" title={childReason}>
                                                <span className="px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 font-semibold text-[10px] inline-block truncate max-w-[160px]">
                                                  {childReason}
                                                </span>
                                              </div>
                                              <div className="truncate" title={childDisposition}>
                                                <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 font-medium text-[10px] inline-block truncate max-w-[160px]">
                                                  {childDisposition}
                                                </span>
                                              </div>
                                              {(() => {
                                                const childNote = String(child.explanation || child.notes || '').trim();
                                                if (!childNote) return null;
                                                return (
                                                  <button
                                                    type="button"
                                                    onClick={() => onViewExplanation && onViewExplanation({
                                                      rmaNumber: item.rma_number,
                                                      productName: childName,
                                                      reason: childReason,
                                                      explanation: childNote,
                                                      reporter: item.reporter_name || item.reported_by || 'Staff'
                                                    })}
                                                    className="group text-left flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 hover:bg-blue-50 dark:bg-slate-800 dark:hover:bg-blue-950/60 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer max-w-[160px]"
                                                    title="Click to read full explanation"
                                                  >
                                                    <span className="text-[9.5px] text-slate-600 dark:text-slate-300 italic truncate max-w-[110px]">
                                                      "{childNote}"
                                                    </span>
                                                    <span className="text-[9px] font-black text-blue-600 dark:text-blue-400 shrink-0 group-hover:underline">
                                                      Read
                                                    </span>
                                                  </button>
                                                );
                                              })()}
                                            </div>
                                          </td>
                                          {/* Actions: 170px */}
                                          <td className="py-2 px-2 text-center w-[170px]">
                                            <div className="flex items-center justify-center gap-1 flex-wrap">
                                              {String(childDisposition || '').toLowerCase().includes('restock') && !['restocked', 'closed', 'resolved', 'scrapped', 'disposed'].includes(String(child.status || '').toLowerCase()) && (
                                                <button
                                                  type="button"
                                                  disabled={updatingQueueId === (childReportObject.id || item.rma_number)}
                                                  onClick={() => onConfirmCoworkerAction({ ...childReportObject, is_unpacked_manifest_item: true, warehouse_location: childLocation || item.warehouse_location }, 'restocked')}
                                                  className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-500 rounded-lg text-[10px] font-black inline-flex items-center gap-1 transition-all cursor-pointer shadow-2xs whitespace-nowrap disabled:opacity-50"
                                                  title="1-click confirm stocked in WMS (updates status to 6- Restocked)"
                                                >
                                                  <span>✓ Restocked in WMS</span>
                                                </button>
                                              )}
                                              {(String(childDisposition || '').toLowerCase().includes('scrap') || String(childDisposition || '').toLowerCase().includes('dispose')) && !['scrapped', 'disposed', 'closed', 'resolved', 'restocked'].includes(String(child.status || '').toLowerCase()) && (
                                                <button
                                                  type="button"
                                                  disabled={updatingQueueId === (childReportObject.id || item.rma_number)}
                                                  onClick={() => onConfirmCoworkerAction({ ...childReportObject, is_unpacked_manifest_item: true, warehouse_location: childLocation || item.warehouse_location }, 'scrapped')}
                                                  className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white border border-rose-500 rounded-lg text-[10px] font-black inline-flex items-center gap-1 transition-all cursor-pointer shadow-2xs whitespace-nowrap disabled:opacity-50"
                                                  title="1-click confirm replacement order placed with supplier (updates status to 7- Scrapped / Disposed)"
                                                >
                                                  <span>✓ PO Placed</span>
                                                </button>
                                              )}
                                              {(String(childDisposition || '').toLowerCase().includes('quarantine') || String(childDisposition || '').toLowerCase().includes('hold') || String(child.status || '').toLowerCase() === 'quarantine') && (
                                                <button
                                                  type="button"
                                                  onClick={() => onInspectTriage(item)}
                                                  className="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white border border-amber-600 rounded-lg text-[10px] font-black inline-flex items-center gap-1 transition-all cursor-pointer shadow-2xs whitespace-nowrap"
                                                  title="Release hold and re-triage to Restock, RTV, or Scrap"
                                                >
                                                  <Unlock className="w-3 h-3" />
                                                  <span>🔓 Release Hold</span>
                                                </button>
                                              )}
                                              {canEditProducts && (
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    onEditProductFromReport({
                                                      id: child.id,
                                                      child_id: child.id,
                                                      name: childName,
                                                      barcode: childBarcode,
                                                      code: (childSku && String(childSku) !== String(childBarcode)) ? childSku : '',
                                                      sku: (childSku && String(childSku) !== String(childBarcode)) ? childSku : '',
                                                      price: child.price || 0,
                                                      price_with_vat: child.price_with_vat || child.price || 0,
                                                      unit_name: childUnit,
                                                      supplier_name: child.supplier_name || item.supplier_name || 'Savemore',
                                                      rma_number: item.rma_number,
                                                      is_manifest_child: true,
                                                      parent_rma_id: item.id
                                                    });
                                                  }}
                                                  className={`px-2 py-1 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 transition-all cursor-pointer shadow-2xs border ${isSkuAssigned
                                                      ? 'bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                                                      : 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                                                    }`}
                                                  title={`Assign or edit official catalog SKU for "${childName}"`}
                                                >
                                                  <Package className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                                  <span>{isSkuAssigned ? 'Edit SKU' : 'Assign SKU'}</span>
                                                </button>
                                              )}
                                              {childExistingMemo ? (
                                                <button
                                                  type="button"
                                                  onClick={() => onViewCreditMemoVoucher(childExistingMemo)}
                                                  className="px-2 py-1 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/70 dark:hover:bg-emerald-900/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded-lg text-[10px] font-black inline-flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                                                  title={`View Official Credit Memo Voucher: ${childExistingMemo.credit_memo_number}`}
                                                >
                                                  <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                                  <span>CM Voucher</span>
                                                </button>
                                              ) : (
                                                canEditProducts && (() => {
                                                  const isChildOnHold = Boolean(String(childDisposition || '').toLowerCase().includes('quarantine') || String(childDisposition || '').toLowerCase().includes('hold') || String(child.status || '').toLowerCase() === 'quarantine');
                                                  return (
                                                    <button
                                                      type="button"
                                                      disabled={isChildOnHold}
                                                      onClick={() => {
                                                        if (isChildOnHold) {
                                                          alert("Item is on Hold / Quarantine. Resolve hold before issuing financial claims.");
                                                          return;
                                                        }
                                                        onOpenCreditMemo(childReportObject);
                                                      }}
                                                      className={`px-2 py-1 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 transition-all shadow-2xs ${
                                                        isChildOnHold
                                                          ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-300 dark:border-slate-700 opacity-70'
                                                          : 'bg-slate-100 hover:bg-emerald-50 dark:bg-slate-800 dark:hover:bg-emerald-950/50 text-slate-700 hover:text-emerald-700 dark:text-slate-300 dark:hover:text-emerald-300 border border-slate-300 dark:border-slate-700 hover:border-emerald-400 cursor-pointer'
                                                      }`}
                                                      title={isChildOnHold ? "Item is on Hold / Quarantine. Resolve hold before issuing financial claims." : `Issue Finance Credit Memo for ${childName} (${childQty} ${childUnit})`}
                                                    >
                                                      {isChildOnHold ? <Lock className="w-3 h-3 text-amber-500" /> : <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />}
                                                      <span>{isChildOnHold ? 'On Hold' : '+ Credit Memo'}</span>
                                                    </button>
                                                  );
                                                })()
                                              )}
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Floating Bulk Action Bar for Return Reports Table */}
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
                  onClick={selectAllFilteredReports}
                  className="text-xs text-blue-300 hover:text-white underline font-semibold ml-1 cursor-pointer"
                >
                  Select all {processedReports.length} filtered
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={clearReportsSelection}
                className="px-3 py-1.5 text-xs font-bold text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                Deselect
              </button>
              <button
                type="button"
                onClick={() => onBulkArchiveReports(selectedReportsList)}
                className="px-3.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
              >
                <Archive className="w-3.5 h-3.5 text-slate-300" />
                <span>Archive Selected ({selectedReportIds.size})</span>
              </button>
              {canDeleteReports && (
                <button
                  type="button"
                  onClick={() => onRequestBulkDeleteReports(selectedReportsList)}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Move to Trash ({selectedReportIds.size})</span>
                </button>
              )}
            </div>
          </div>
        )}

        <TablePagination
          currentPage={reportsCurrentPage}
          pageSize={reportsPageSize}
          totalItems={processedReports.length}
          onPageChange={setReportsCurrentPage}
          onPageSizeChange={(newSize) => {
            setReportsPageSize(newSize);
            setReportsCurrentPage(1);
          }}
        />
      </div>
    ) : (
      /* ============================================================ */
      /* GRID / CARDS VIEW (With SN badge and clickable photos)       */
      /* ============================================================ */
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {paginatedReports.map((item, index) => {
            const photoList = getRealPhotos(item.photos);
            const isSelected = selectedReportIds.has(item.id || item.rma_number);
            const matchedProduct = savedProductsList.find(p => p.barcode && String(p.barcode) === String(item.barcode));
            const resolvedName = (item.name && !item.name.toLowerCase().startsWith('unidentified'))
              ? item.name
              : (matchedProduct?.name || item.name || `Unidentified (${item.barcode})`);
            const isPendingUnknown = !matchedProduct && item.status === 'pending_admin_details';

            const isManifest = isBatchManifest(item, reportsList);
            const manifestChildren = isManifest ? getReportManifestItems(item, reportsList) : [];
            const manifestKey = item.id || item.rma_number;
            const isManifestExpanded = expandedManifestIds.has(manifestKey);

            return (
              <div
                key={item.id || item.rma_number}
                className={`p-4 border rounded-2xl space-y-2 transition-all shadow-sm ${isSelected
                  ? 'bg-blue-50/90 dark:bg-blue-950/60 border-blue-500'
                  : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectReport(item.id || item.rma_number)}
                        className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 cursor-pointer"
                      />
                      <span className="font-mono font-black text-xs text-blue-900 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200/80 dark:border-blue-800 px-2 py-0.5 rounded-lg">
                        SN #{(reportsCurrentPage - 1) * reportsPageSize + index + 1}
                      </span>
                      <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                        📥 Inbound
                      </span>
                      <span className="font-mono font-black text-xs text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 px-2 py-0.5 rounded-md shadow-2xs">
                        Qty: <strong className="text-blue-600 dark:text-blue-400 font-black">
                          {isManifest
                            ? formatManifestBreakdown(manifestChildren, false)
                            : formatQuantityWithPackSize(item.quantity, item.unit_name, item.pieces_per_case || matchedProduct?.pieces_per_case)}
                        </strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => onInspectTriage(item)}
                        className="font-mono font-black text-blue-700 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-200 hover:underline text-sm cursor-pointer"
                        title={`Inspect & Triage RMA #${item.rma_number}`}
                      >
                        {item.rma_number}
                      </button>
                      <button
                        type="button"
                        onClick={() => onViewQR && onViewQR({ ...item, name: resolvedName })}
                        className="p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/60 rounded-md transition-colors cursor-pointer"
                        title={`View & Print Box QR Sticker for ${item.rma_number}`}
                      >
                        <QrCode className="w-3.5 h-3.5" />
                      </button>
                      {isManifest ? (
                        <>
                          <button
                            type="button"
                            onClick={() => toggleManifestExpand(manifestKey)}
                            className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider inline-flex items-center gap-1 shadow-2xs cursor-pointer ${isManifestExpanded
                                ? 'bg-purple-600 text-white border border-purple-700'
                                : 'bg-purple-100 hover:bg-purple-200 dark:bg-purple-950/70 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-800'
                              }`}
                            title={isManifestExpanded ? "Collapse Manifest Items" : "Expand Manifest Items"}
                          >
                            <span>📦 Manifest ({manifestChildren.length})</span>
                            <ChevronDown className={`w-2.5 h-2.5 transform transition-transform ${isManifestExpanded ? 'rotate-180' : ''}`} />
                          </button>
                          {(() => {
                            const dynStage = resolveBatchManifestLifecycle(item, reportsList);
                            return (
                              <span className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider border inline-flex items-center gap-0.5 shadow-2xs ${dynStage.color}`}>
                                {dynStage.label}
                              </span>
                            );
                          })()}
                        </>
                      ) : (() => {
                        const stageInfo = formatLifecycleStage(item.status, item);
                        return (
                          <span className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider border inline-flex items-center gap-0.5 shadow-2xs ${stageInfo.color}`}>
                            {stageInfo.label}
                          </span>
                        );
                      })()}
                      {isSplitChildTicket(item) ? (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 inline-flex items-center gap-0.5 shadow-2xs" title="Split Child Ticket (Part 2)">
                          <span>✂️ Part 2</span>
                        </span>
                      ) : isSplitParentTicket(item, reportsList) ? (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-800 inline-flex items-center gap-0.5 shadow-2xs" title="Split Parent Ticket (Part 1)">
                          <span>✂️ Part 1</span>
                        </span>
                      ) : null}
                    </div>
                    <h4 className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm mt-0.5 truncate" title={resolvedName}>
                      {resolvedName}
                    </h4>
                    <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {isManifest ? (
                        <span className="inline-flex items-center gap-1.5 flex-wrap">
                          <span className="px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 font-bold text-[10px] border border-purple-200 dark:border-purple-800">
                            📦 Manifest Items
                          </span>
                          <span className="text-slate-600 dark:text-slate-300 font-bold">
                            {formatManifestBreakdown(manifestChildren, true)}
                          </span>
                        </span>
                      ) : (
                        <>
                          Qty: <strong className="text-slate-900 dark:text-white font-bold">{formatQuantityWithPackSize(item.quantity, item.unit_name, item.pieces_per_case || matchedProduct?.pieces_per_case)}</strong> • Barcode: <strong className="text-slate-800 dark:text-slate-200">{item.barcode}</strong>
                          {(item.code || matchedProduct?.code) && <span> • SKU: {item.code || matchedProduct?.code}</span>}
                          {(isUnlabeledBarcode(item.barcode) || item.ai_document_metadata?.is_unlabeled) && (
                            <span className="inline-flex items-center gap-1 ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                              🏷️ Missing Barcode
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Print 4x6 Thermal Box Label */}
                    <button
                      type="button"
                      onClick={() => onPrintLabel && onPrintLabel(item)}
                      className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                      title="Print 4x6 inch Thermal Box Label"
                    >
                      <Printer className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                    </button>

                    {/* Inspect & Triage Physical Return */}
                    <button
                      type="button"
                      onClick={() => onInspectTriage(item)}
                      className="px-2 py-0.5 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                      title={`Inspect condition and set warehouse disposition for ${item.rma_number}`}
                    >
                      <ClipboardCheck className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                      <span>Triage</span>
                    </button>

                    {/* 1-Click Coworker WMS Restock Action */}
                    {isItemReadyToRestock(item, reportsList) && (
                      <button
                        type="button"
                        disabled={updatingQueueId === (item.id || item.rma_number)}
                        onClick={() => onConfirmCoworkerAction(item, 'restocked')}
                        className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-500 rounded-lg text-[10px] font-black flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-50"
                        title="1-click confirm that this item has been stocked in WMS (updates status to 6- Restocked)"
                      >
                        <span>✓ Restocked in WMS</span>
                      </button>
                    )}

                    {/* 1-Click Coworker Supplier Re-Order Action */}
                    {isItemReadyForSupplierReorder(item, reportsList) && (
                      <button
                        type="button"
                        disabled={updatingQueueId === (item.id || item.rma_number)}
                        onClick={() => onConfirmCoworkerAction(item, 'scrapped')}
                        className="px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white border border-rose-500 rounded-lg text-[10px] font-black flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-50"
                        title="1-click confirm that a replacement order has been placed with supplier (updates status to 7- Scrapped / Disposed)"
                      >
                        <span>✓ PO Placed</span>
                      </button>
                    )}

                    {/* Re-open / Reset to Pending Action for Testing Coworker Actions */}
                    {Boolean(item.ai_document_metadata?.workflow_resolution || item.status === 'resolved' || item.status === 'closed') && (
                      <button
                        type="button"
                        disabled={updatingQueueId === (item.id || item.rma_number)}
                        onClick={() => onResetToPending && onResetToPending(item)}
                        className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap shadow-2xs"
                        title="Re-open item and reset to pending so coworker queues can test restocking/reordering again"
                      >
                        <RotateCcw className="w-3 h-3 text-slate-500" />
                        <span>↩️ Reset to Pending</span>
                      </button>
                    )}

                    {/* Release Hold Action */}
                    {isItemOnHold(item, reportsList) && (
                      <button
                        type="button"
                        onClick={() => onInspectTriage(item)}
                        className="px-2 py-0.5 bg-amber-500 hover:bg-amber-600 text-white border border-amber-600 rounded-lg text-[10px] font-black flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        title="Release hold and re-triage to Restock, RTV, or Scrap"
                      >
                        <Unlock className="w-3 h-3" />
                        <span>🔓 Release Hold</span>
                      </button>
                    )}

                    {canEditProducts && !isManifest && !savedProductsList.some(p => p.barcode && String(p.barcode) === String(item.barcode)) && (
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
                      if (isManifest) {
                        const linkedMemos = creditMemosList.filter(m => m.rma_number === item.rma_number || m.report_id === item.id);
                        if (linkedMemos.length > 0) {
                          return (
                            <button
                              type="button"
                              onClick={() => onViewCreditMemoVoucher(linkedMemos.length === 1 ? linkedMemos[0] : linkedMemos)}
                              className="px-2 py-0.5 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded-lg text-[10px] font-black flex items-center gap-1 cursor-pointer"
                              title={`View ${linkedMemos.length} Credit Memo Voucher(s) for this batch`}
                            >
                              <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                              <span>Vouchers ({linkedMemos.length})</span>
                            </button>
                          );
                        }
                        return (
                          <button
                            type="button"
                            onClick={() => toggleManifestExpand(manifestKey)}
                            className="px-2 py-0.5 bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                            title="View manifest line items in drawer"
                          >
                            <Receipt className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                            <span>CM Drawer</span>
                          </button>
                        );
                      }

                      const existingMemo = creditMemosList.find(m => m.rma_number === item.rma_number || m.report_id === item.id);
                      if (existingMemo) {
                        return (
                          <button
                            type="button"
                            onClick={() => onViewCreditMemoVoucher(existingMemo)}
                            className="px-2 py-0.5 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded-lg text-[10px] font-black flex items-center gap-1 cursor-pointer"
                            title={`View Voucher: ${existingMemo.credit_memo_number}`}
                          >
                            <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                            <span>Voucher</span>
                          </button>
                        );
                      }
                      const isCardOnHold = isItemOnHold(item, reportsList);
                      if (canEditProducts) {
                        return (
                          <button
                            type="button"
                            disabled={isCardOnHold}
                            onClick={() => {
                              if (isCardOnHold) {
                                alert("Item is on Hold / Quarantine. Resolve hold before issuing financial claims.");
                                return;
                              }
                              onOpenCreditMemo(item);
                            }}
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-bold flex items-center gap-1 ${
                              isCardOnHold
                                ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-300 dark:border-slate-700 opacity-70'
                                : 'bg-slate-100 hover:bg-emerald-50 dark:bg-slate-800 dark:hover:bg-emerald-950/50 text-slate-700 hover:text-emerald-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 cursor-pointer'
                            }`}
                            title={isCardOnHold ? "Item is on Hold / Quarantine. Resolve hold before issuing financial claims." : "Issue Credit Memo"}
                          >
                            {isCardOnHold ? <Lock className="w-3 h-3 text-amber-500" /> : <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />}
                            <span>{isCardOnHold ? 'On Hold' : '+ CM'}</span>
                          </button>
                        );
                      }
                      return null;
                    })()}
                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300">
                      {item.reason || 'Damaged'}
                    </span>
                    <button
                      type="button"
                      onClick={() => onArchiveReport(item.id, item.rma_number, item)}
                      className="p-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
                      title={`Archive RMA #${item.rma_number} to Enterprise Vault`}
                    >
                      <Archive className="w-3.5 h-3.5 text-slate-500 hover:text-slate-700" />
                    </button>
                    {canDeleteReports && (
                      <button
                        type="button"
                        onClick={() => onRequestDeleteReport(item.id, item.rma_number, item)}
                        className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-100 dark:hover:bg-rose-900/50 rounded-xl transition-colors cursor-pointer"
                        title={`Move RMA #${item.rma_number} to 30-Day Trash Bin`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Reporter Details & Truncated Explanation */}
                <div className="text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200/60 dark:border-slate-700/60 space-y-1">
                  <div className="flex items-center justify-between">
                    <span>Reported by: <strong className="text-slate-800 dark:text-slate-200">{item.reporter_name || item.reported_by}</strong></span>
                    <span className="font-mono text-slate-600 dark:text-slate-400">{item.reporter_contact || ''}</span>
                  </div>
                  {(() => {
                    const rawNote = String(
                      item.explanation ||
                      item.notes ||
                      (!isManifest && item.items?.[0]?.explanation ? item.items[0].explanation : '') ||
                      ''
                    ).trim();
                    const cleanNote = cleanExplanationText(rawNote);
                    if (!cleanNote) return null;
                    return (
                      <div className="flex items-center justify-between gap-2 bg-white/80 dark:bg-slate-900/60 px-2.5 py-1 rounded-lg border border-slate-200/80 dark:border-slate-700/80">
                        <span className="text-[10px] text-slate-600 dark:text-slate-300 italic truncate">
                          Note: "{cleanNote}"
                        </span>
                        <button
                          type="button"
                          onClick={() => onViewExplanation && onViewExplanation({
                            rmaNumber: item.rma_number,
                            productName: resolvedName,
                            reason: item.reason || 'Damaged',
                            explanation: cleanNote,
                            reporter: item.reporter_name || item.reported_by || 'Staff'
                          })}
                          className="text-[10px] font-black text-blue-600 dark:text-blue-400 hover:underline shrink-0 cursor-pointer"
                        >
                          Read Full
                        </button>
                      </div>
                    );
                  })()}
                </div>

                {/* Enterprise Logistics Badges (Store Branch, DR#, Batch/Lot, Expiry) */}
                {(item.store_branch || item.invoice_dr_number || item.batch_lot_number || item.expiry_date) && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[10px]">
                    {item.store_branch && (
                      <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 font-semibold flex items-center gap-1">
                        📍 {item.store_branch}
                      </span>
                    )}
                    {(() => {
                      const docs = getDocumentNumbers(item);
                      return (
                        <>
                          {docs.si !== 'N/A' && (
                            <span className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-mono font-bold">
                              SI: {docs.si}
                            </span>
                          )}
                          {docs.dr !== 'N/A' && (
                            <span className="px-2 py-0.5 rounded-md bg-violet-50 dark:bg-violet-950/70 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 font-mono font-bold">
                              DR: {docs.dr}
                            </span>
                          )}
                          {docs.po !== 'N/A' && (
                            <span className="px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-mono font-bold">
                              PO: {docs.po}
                            </span>
                          )}
                        </>
                      );
                    })()}
                    {item.batch_lot_number && (
                      <span className="px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-mono font-semibold">
                        Lot: {item.batch_lot_number}
                      </span>
                    )}
                    {item.expiry_date && (
                      <span className="px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 font-medium">
                        Exp: {item.expiry_date}
                      </span>
                    )}
                  </div>
                )}

                {/* Photos preview with click-to-zoom multi-image */}
                {photoList.length > 0 && (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold">
                      {photoList.length} Photo{photoList.length > 1 ? 's' : ''}:
                    </span>
                    <div className="flex gap-1.5 overflow-x-auto py-0.5">
                      {photoList.map((url, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => onViewPhoto && onViewPhoto({
                            images: photoList,
                            initialIndex: i,
                            url,
                            title: item.name || `Return ${item.rma_number}`,
                            subtitle: `Photo ${i + 1} of ${photoList.length} • RMA #${item.rma_number}`
                          })}
                          className="w-10 h-10 rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 cursor-zoom-in hover:opacity-85 transition-opacity shrink-0"
                          title="Click to zoom proof photo"
                        >
                          <img
                            src={url}
                            alt="Proof"
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Expandable Multi-Item Manifest Line Items for Cards View */}
                {isManifest && isManifestExpanded && (
                  <div className="mt-3 pt-3 border-t border-purple-200 dark:border-purple-900/50 space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-bold text-purple-900 dark:text-purple-200">
                      <span>📦 Manifest Items Breakdown ({manifestChildren.length})</span>
                      <span className="text-slate-500 font-normal">Line-Item SKU & Credit Memo</span>
                    </div>
                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {manifestChildren.map((child, cIdx) => {
                        const childName = (child.name || child.item_name || child.productName || `Item #${cIdx + 1}`).trim();
                        const childBarcode = (child.barcode || child.item_barcode || '').trim();
                        const childSku = (child.sku || child.code || '').trim();
                        const childQty = Number(child.quantity || child.qty) || 1;
                        const childUnit = child.unit_name || child.unit || item.unit_name || 'pc';
                        const childReason = child.reason || child.defect_reason || item.reason || 'Damaged';
                        const childLocation = (child.warehouse_location || child.location || '').trim();
                        const childDisposition = child.disposition || '1- Pending Triage';
                        const matchedChild = savedProductsList.find(p => p.barcode && String(p.barcode) === String(childBarcode));
                        const isSkuAssigned = Boolean(
                          (matchedChild?.code && String(matchedChild.code) !== String(childBarcode) && !matchedChild.code.toLowerCase().includes('awaiting')) ||
                          (childSku && String(childSku) !== String(childBarcode) && !childSku.toLowerCase().includes('awaiting'))
                        );
                        const effectiveSku = (matchedChild?.code && String(matchedChild.code) !== String(childBarcode))
                          ? matchedChild.code
                          : (childSku && String(childSku) !== String(childBarcode) && !childSku.toLowerCase().includes('awaiting') ? childSku : '—');

                        const childExistingMemo = creditMemosList.find(m =>
                        (m.rma_number === item.rma_number && (
                          (childBarcode && String(m.barcode).trim() === childBarcode) ||
                          (child.id && String(m.report_id) === String(child.id)) ||
                          (m.product_name && m.product_name === childName)
                        ))
                        );

                        const childReportObject = {
                          id: child.id || `${item.id || item.rma_number}_${childBarcode}`,
                          rma_number: item.rma_number,
                          barcode: childBarcode,
                          code: effectiveSku !== '—' ? effectiveSku : (childSku || ''),
                          sku: effectiveSku !== '—' ? effectiveSku : (childSku || ''),
                          name: childName,
                          product_name: childName,
                          quantity: childQty,
                          unit_name: childUnit,
                          price: Number(child.price || matchedChild?.price || 0),
                          price_with_vat: Number(child.price_with_vat || child.price || matchedChild?.price_with_vat || matchedChild?.price || 0),
                          supplier_name: child.supplier_name || matchedChild?.supplier_name || item.supplier_name || 'Savemore',
                          store_branch: item.store_branch,
                          customer_branch: item.store_branch,
                          ae_name: item.ae_name,
                          ae_email: item.ae_email,
                          child_id: child.id,
                          is_manifest_child: true,
                          parent_rma_id: item.id
                        };

                        return (
                          <div key={child.id || `card_child_${cIdx}`} className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-1.5 shadow-2xs">
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-bold text-xs text-slate-900 dark:text-white truncate">
                                #{cIdx + 1} {childName}
                              </div>
                              <span className="font-mono font-bold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-700/60 px-1.5 py-0.5 rounded text-[10px]">
                                {formatQuantityWithPackSize(childQty, childUnit, child.pieces_per_case || matchedChild?.pieces_per_case)}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500 font-mono">
                              <span>BC: {childBarcode || '—'}</span>
                              <span>•</span>
                              <span>SKU: <span className={isSkuAssigned ? "font-bold text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400 font-semibold"}>{effectiveSku}</span></span>
                              {childLocation && (
                                <>
                                  <span>•</span>
                                  <span className="text-indigo-600 dark:text-indigo-400 font-bold">📍 {childLocation}</span>
                                </>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-700/50">
                              <div className="flex items-center gap-1 text-[10px]">
                                <span className="text-rose-600 dark:text-rose-400 font-medium">{childReason}</span>
                                <span className="text-slate-400">•</span>
                                <span className="text-blue-600 dark:text-blue-400 font-semibold">{childDisposition}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                {canEditProducts && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onEditProductFromReport({
                                        id: child.id,
                                        child_id: child.id,
                                        name: childName,
                                        barcode: childBarcode,
                                        code: (childSku && String(childSku) !== String(childBarcode)) ? childSku : '',
                                        sku: (childSku && String(childSku) !== String(childBarcode)) ? childSku : '',
                                        price: child.price || 0,
                                        price_with_vat: child.price_with_vat || child.price || 0,
                                        unit_name: childUnit,
                                        supplier_name: child.supplier_name || item.supplier_name || 'Savemore',
                                        rma_number: item.rma_number,
                                        is_manifest_child: true,
                                        parent_rma_id: item.id
                                      });
                                    }}
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold border inline-flex items-center gap-1 cursor-pointer transition-all ${isSkuAssigned
                                        ? 'bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                                        : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300'
                                      }`}
                                    title={`Assign or edit official catalog SKU for "${childName}"`}
                                  >
                                    <Package className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                    <span>{isSkuAssigned ? 'Edit SKU' : 'Assign SKU'}</span>
                                  </button>
                                )}
                                {childExistingMemo ? (
                                  <button
                                    type="button"
                                    onClick={() => onViewCreditMemoVoucher(childExistingMemo)}
                                    className="px-2 py-0.5 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded text-[10px] font-black inline-flex items-center gap-1 cursor-pointer shadow-2xs"
                                    title={`View Voucher: ${childExistingMemo.credit_memo_number}`}
                                  >
                                    <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                    <span>Voucher</span>
                                  </button>
                                ) : (
                                  canEditProducts && (
                                    <button
                                      type="button"
                                      onClick={() => onOpenCreditMemo(childReportObject)}
                                      className="px-2 py-0.5 bg-slate-100 hover:bg-emerald-50 dark:bg-slate-800 dark:hover:bg-emerald-950/50 text-slate-700 hover:text-emerald-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer shadow-2xs"
                                      title={`Issue Credit Memo for ${childName}`}
                                    >
                                      <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                      <span>+ CM</span>
                                    </button>
                                  )
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
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
                  onClick={selectAllFilteredReports}
                  className="text-xs text-blue-300 hover:text-white underline font-semibold ml-1 cursor-pointer"
                >
                  Select all {processedReports.length} filtered
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={clearReportsSelection}
                className="px-3 py-1.5 text-xs font-bold text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                Deselect
              </button>
              <button
                type="button"
                onClick={() => onBulkArchiveReports(selectedReportsList)}
                className="px-3.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
              >
                <Archive className="w-3.5 h-3.5 text-slate-300" />
                <span>Archive Selected ({selectedReportIds.size})</span>
              </button>
              {canDeleteReports && (
                <button
                  type="button"
                  onClick={() => onRequestBulkDeleteReports(selectedReportsList)}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Move to Trash ({selectedReportIds.size})</span>
                </button>
              )}
            </div>
          </div>
        )}

        <TablePagination
          currentPage={reportsCurrentPage}
          pageSize={reportsPageSize}
          totalItems={processedReports.length}
          onPageChange={setReportsCurrentPage}
          onPageSizeChange={(newSize) => {
            setReportsPageSize(newSize);
            setReportsCurrentPage(1);
          }}
        />
      </div>
    )}
  </div>
  );
}
