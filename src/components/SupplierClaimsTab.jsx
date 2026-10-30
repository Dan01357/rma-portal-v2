import React, { useState, useMemo, useEffect } from 'react';
import { 
  Building2, 
  Receipt, 
  CheckCircle2, 
  AlertTriangle, 
  Printer, 
  Download, 
  Search, 
  RotateCcw, 
  Trash2, 
  Image as ImageIcon, 
  X, 
  MapPin,
  ArrowUp,
  ArrowDown,
  ArrowUpDown
} from 'lucide-react';
import { exportRMAReportsToCSV, exportSupplierOutboundClaimsToCSV } from '../utils/exportCsv';
import TablePagination from './TablePagination';
import ImageLightboxModal from './ImageLightboxModal';
import { supplierClaimService } from '../services/supplierClaimService';

export default function SupplierClaimsTab({
  reportsList = [],
  currentUser,
  onRefresh,
  onViewPhoto,
  onRequestDeleteReport,
  onRequestBulkDeleteReports
}) {
  const [selectedSupplier, setSelectedSupplier] = useState('All');
  const [dispositionFilter, setDispositionFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('created_at');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selectedRmaIds, setSelectedRmaIds] = useState(new Set());
  const [activeClaimBatch, setActiveClaimBatch] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [localLightboxPhoto, setLocalLightboxPhoto] = useState(null);
  const [savedClaims, setSavedClaims] = useState([]);
  const [isSavingClaim, setIsSavingClaim] = useState(false);

  // Role permissions
  const canDeleteReports = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';

  // Load saved supplier debit claims from database
  useEffect(() => {
    let isMounted = true;
    supplierClaimService.getClaims().then(claims => {
      if (isMounted && Array.isArray(claims)) {
        setSavedClaims(claims);
      }
    });
    return () => { isMounted = false; };
  }, [reportsList]);

  // Extract unique suppliers from reports
  const suppliers = useMemo(() => {
    const set = new Set();
    reportsList.forEach(r => {
      const sup = (r.supplier_name || 'Savemore').trim();
      if (sup) set.add(sup);
    });
    return ['All', ...Array.from(set).sort()];
  }, [reportsList]);

  // Reset pagination on filter or sort change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedSupplier, dispositionFilter, searchTerm, sortField, sortDirection]);

  // Handle column sorting
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Filter & sort reports suitable for Supplier Outbound / RTV
  const rtvCandidates = useMemo(() => {
    let list = reportsList.filter(r => {
      // Must be supplier outbound OR have an RTV disposition
      const isSupplierCandidate = (r.rma_type === 'supplier_outbound') ||
        (r.disposition && (r.disposition.toLowerCase().includes('return to vendor') || r.disposition.toLowerCase().includes('rtv')));

      if (!isSupplierCandidate) return false;

      const matchesSupplier = selectedSupplier === 'All' || 
        (r.supplier_name || 'Savemore').toLowerCase() === selectedSupplier.toLowerCase();

      const matchesDisposition = dispositionFilter === 'All' || 
        (r.disposition || 'Pending Triage').replace(/^\d+-\s*/, '').toLowerCase() === dispositionFilter.replace(/^\d+-\s*/, '').toLowerCase();

      const q = searchTerm.toLowerCase().trim();
      const matchesSearch = !q || 
        r.name?.toLowerCase().includes(q) ||
        r.barcode?.includes(q) ||
        r.rma_number?.toLowerCase().includes(q) ||
        r.code?.toLowerCase().includes(q) ||
        r.supplier_name?.toLowerCase().includes(q) ||
        r.warehouse_location?.toLowerCase().includes(q) ||
        r.batch_lot_number?.toLowerCase().includes(q);

      return matchesSupplier && matchesDisposition && matchesSearch;
    });

    list.sort((a, b) => {
      let valA, valB;
      switch (sortField) {
        case 'rma_number':
          valA = String(a.rma_number || '').toLowerCase();
          valB = String(b.rma_number || '').toLowerCase();
          break;
        case 'supplier_name':
          valA = String(a.supplier_name || 'Savemore').toLowerCase();
          valB = String(b.supplier_name || 'Savemore').toLowerCase();
          break;
        case 'name':
          valA = String(a.name || '').toLowerCase();
          valB = String(b.name || '').toLowerCase();
          break;
        case 'disposition':
          valA = String(a.disposition || 'Pending Triage').toLowerCase();
          valB = String(b.disposition || 'Pending Triage').toLowerCase();
          break;
        case 'quantity':
          valA = Number(a.quantity || 1);
          valB = Number(b.quantity || 1);
          break;
        case 'price':
          valA = Number(a.price_with_vat || a.price || 0);
          valB = Number(b.price_with_vat || b.price || 0);
          break;
        case 'total':
          valA = (Number(a.quantity || 1)) * (Number(a.price_with_vat || a.price || 0));
          valB = (Number(b.quantity || 1)) * (Number(b.price_with_vat || b.price || 0));
          break;
        case 'created_at':
        default:
          valA = new Date(a.created_at || 0).getTime();
          valB = new Date(b.created_at || 0).getTime();
          break;
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [reportsList, selectedSupplier, dispositionFilter, searchTerm, sortField, sortDirection]);

  // Paginated Slice
  const paginatedCandidates = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return rtvCandidates.slice(start, start + pageSize);
  }, [rtvCandidates, currentPage, pageSize]);

  // Calculate totals of selected items
  const selectedItems = useMemo(() => {
    return rtvCandidates.filter(r => selectedRmaIds.has(r.id || r.rma_number));
  }, [rtvCandidates, selectedRmaIds]);

  const totalClaimAmount = useMemo(() => {
    return selectedItems.reduce((sum, r) => {
      const qty = Number(r.quantity || 1);
      const price = Number(r.price_with_vat || r.price || 0);
      return sum + (qty * price);
    }, 0);
  }, [selectedItems]);

  const totalQuantity = useMemo(() => {
    return selectedItems.reduce((sum, r) => sum + Number(r.quantity || 1), 0);
  }, [selectedItems]);

  const handleToggleSelect = (id) => {
    setSelectedRmaIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isAllPageSelected = paginatedCandidates.length > 0 && paginatedCandidates.every(r => selectedRmaIds.has(r.id || r.rma_number));

  const handleSelectAll = () => {
    if (selectedRmaIds.size === rtvCandidates.length && rtvCandidates.length > 0) {
      setSelectedRmaIds(new Set());
    } else {
      setSelectedRmaIds(new Set(rtvCandidates.map(r => r.id || r.rma_number)));
    }
  };

  const handleClearSelection = () => {
    setSelectedRmaIds(new Set());
  };

  // Helper to extract user clean name (roles removed, Danilo Alvaro excluded as requested)
  const getCleanUserName = (user) => {
    const raw = user?.name || 'Warehouse Staff';
    let clean = raw.replace(/\s*\([^)]*\)/g, '').trim();
    if (!clean || clean.toLowerCase().includes('danilo alvaro')) {
      clean = 'Warehouse Staff';
    }
    return clean;
  };

  // Helper to safely extract photo URLs
  const getPhotos = (report) => {
    if (!report?.photos) return [];
    if (Array.isArray(report.photos)) return report.photos.filter(Boolean);
    if (typeof report.photos === 'string') {
      try {
        const parsed = JSON.parse(report.photos);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
      } catch (e) {
        return [report.photos];
      }
    }
    return [];
  };

  const handleOpenPhotoPreview = (report) => {
    const photos = getPhotos(report);
    if (!photos.length) return;
    const photoObj = {
      images: photos,
      initialIndex: 0,
      url: photos[0],
      title: report.name || `Return ${report.rma_number}`,
      subtitle: `RMA #${report.rma_number} • Supplier: ${report.supplier_name || 'Savemore'} • ${report.reason || 'Damaged'}`
    };
    if (onViewPhoto) {
      onViewPhoto(photoObj);
    } else {
      setLocalLightboxPhoto(photoObj);
    }
  };

  // Look up if a report already has a generated RTV Claim
  const getClaimForReport = (report) => {
    if (!report) return null;
    const rma = report.rma_number;
    
    // 1. Search in saved claims items
    const found = savedClaims.find(c => 
      Array.isArray(c.items) && c.items.some(i => i.rma_number === rma)
    );
    if (found) return found;

    // 2. Search in report's notes tag [RTV: RTV-YYYY-XXXX-RAND]
    const notes = String(report.notes || '');
    const m = notes.match(/\[RTV:\s*([^\]]+)\]/i);
    if (m && m[1]) {
      const claimNum = m[1].trim();
      return {
        claimNumber: claimNum,
        claim_number: claimNum,
        supplierName: report.supplier_name || 'Savemore',
        supplier_name: report.supplier_name || 'Savemore',
        generatedBy: 'Warehouse Staff',
        createdAt: report.created_at,
        items: [report],
        totalQuantity: Number(report.quantity) || 1,
        totalClaimAmount: (Number(report.quantity) || 1) * Number(report.price_with_vat || report.price || 0)
      };
    }

    // 3. Search in report's audit_trail
    const audit = Array.isArray(report.audit_trail) ? report.audit_trail : [];
    const rtvAudit = audit.find(a => a.rtv_number || a.action === 'RTV_CLAIM_GENERATED');
    if (rtvAudit && rtvAudit.rtv_number) {
      return {
        claimNumber: rtvAudit.rtv_number,
        claim_number: rtvAudit.rtv_number,
        supplierName: report.supplier_name || 'Savemore',
        supplier_name: report.supplier_name || 'Savemore',
        generatedBy: rtvAudit.generated_by || 'Warehouse Staff',
        createdAt: rtvAudit.timestamp || report.created_at,
        items: [report],
        totalQuantity: Number(report.quantity) || 1,
        totalClaimAmount: (Number(report.quantity) || 1) * Number(report.price_with_vat || report.price || 0)
      };
    }

    return null;
  };

  /**
   * INDIVIDUAL ACTION: GENERATE DEBIT CLAIM FOR SINGLE ITEM
   */
  const handleGenerateSingleClaim = async (item) => {
    if (!item) return;
    const supplierName = (item.supplier_name || 'Savemore').trim();
    const cleanGeneratedBy = getCleanUserName(currentUser);
    const claimNumber = supplierClaimService.generateRtvId(savedClaims);
    const qty = Number(item.quantity) || 1;
    const price = Number(item.price_with_vat || item.price || 0);

    const newClaim = {
      claimNumber,
      claim_number: claimNumber,
      supplierName,
      supplier_name: supplierName,
      createdAt: new Date().toISOString(),
      created_at: new Date().toISOString(),
      generatedBy: cleanGeneratedBy,
      generated_by: cleanGeneratedBy,
      items: [item],
      totalQuantity: qty,
      totalClaimAmount: qty * price
    };

    setIsSavingClaim(true);
    try {
      await supplierClaimService.saveClaim(newClaim);
      setSavedClaims(prev => [newClaim, ...prev.filter(c => (c.claim_number || c.claimNumber) !== claimNumber)]);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.warn('Error saving single claim to database:', err);
    } finally {
      setIsSavingClaim(false);
    }

    setActiveClaimBatch(newClaim);
  };

  /**
   * BATCH ACTION: GENERATE DEBIT CLAIM FOR MULTIPLE ITEMS FROM SAME SUPPLIER
   */
  const handleGenerateBatchClaim = async () => {
    if (selectedItems.length === 0) {
      alert('Please select at least 1 RMA item to bundle into a supplier claim.');
      return;
    }

    // Enforce that all bundled items belong strictly to the SAME supplier
    const suppliersInBatch = [...new Set(selectedItems.map(i => (i.supplier_name || 'Savemore').trim()))];
    if (suppliersInBatch.length > 1) {
      alert(`You have selected items across ${suppliersInBatch.length} different suppliers (${suppliersInBatch.join(', ')}).\n\nAn official Supplier Debit Claim (RTV) voucher must be issued to a SINGLE vendor.\n\nPlease select items from the same supplier, or filter by "${suppliersInBatch[0]}" to generate a consolidated claim.`);
      return;
    }

    const supplierName = suppliersInBatch[0] || (selectedSupplier !== 'All' ? selectedSupplier : 'Savemore');
    const cleanGeneratedBy = getCleanUserName(currentUser);
    const claimNumber = supplierClaimService.generateRtvId(savedClaims);

    const newClaim = {
      claimNumber,
      claim_number: claimNumber,
      supplierName,
      supplier_name: supplierName,
      createdAt: new Date().toISOString(),
      created_at: new Date().toISOString(),
      generatedBy: cleanGeneratedBy,
      generated_by: cleanGeneratedBy,
      items: selectedItems,
      totalQuantity,
      totalClaimAmount
    };

    setIsSavingClaim(true);
    try {
      await supplierClaimService.saveClaim(newClaim);
      setSavedClaims(prev => [newClaim, ...prev.filter(c => (c.claim_number || c.claimNumber) !== claimNumber)]);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.warn('Error saving batch claim to database:', err);
    } finally {
      setIsSavingClaim(false);
    }

    setActiveClaimBatch(newClaim);
  };

  /**
   * BATCH ACTION: PRINT VOUCHERS FOR SELECTED ITEMS
   */
  const handlePrintSelectedVouchers = () => {
    if (selectedItems.length === 0) return;

    const suppliersInBatch = [...new Set(selectedItems.map(i => (i.supplier_name || 'Savemore').trim()))];
    if (suppliersInBatch.length > 1) {
      alert(`You have selected items across ${suppliersInBatch.length} different suppliers (${suppliersInBatch.join(', ')}).\n\nTo print a consolidated RTV voucher, please select items from a single supplier.`);
      return;
    }

    const supplierName = suppliersInBatch[0];
    const cleanGeneratedBy = getCleanUserName(currentUser);
    
    // Look up if a claim was already created for these items, or create temporary print preview
    let existingClaim = savedClaims.find(c => 
      c.supplier_name === supplierName && Array.isArray(c.items) && selectedItems.some(si => c.items.some(ci => ci.rma_number === si.rma_number))
    );

    if (!existingClaim) {
      const claimNumber = supplierClaimService.generateRtvId(savedClaims);
      existingClaim = {
        claimNumber,
        claim_number: claimNumber,
        supplierName,
        createdAt: new Date().toISOString(),
        generatedBy: cleanGeneratedBy,
        items: selectedItems,
        totalQuantity,
        totalClaimAmount
      };
    }

    setActiveClaimBatch(existingClaim);
    setTimeout(() => {
      window.print();
    }, 400);
  };

  /**
   * BATCH ACTION: DELETE SELECTED REPORTS
   */
  const handleBulkDelete = () => {
    if (selectedItems.length === 0) return;
    if (onRequestBulkDeleteReports) {
      onRequestBulkDeleteReports(selectedItems);
    }
  };

  const handlePrintClaimVoucher = () => {
    window.print();
  };

  const hasActiveFilters = selectedSupplier !== 'All' || dispositionFilter !== 'All' || Boolean(searchTerm);

  return (
    <div className="space-y-5 animate-in fade-in duration-200 w-full min-w-0 box-border">
      
      {/* Top Banner */}
      <div className="p-4 sm:p-5 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/20 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full min-w-0 box-border">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center font-black shadow-md shadow-amber-500/20 shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
              <span>Supplier Claims & RTV Chargeback Batching</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 shrink-0">
                Vendor Recovery
              </span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              Bundle damaged/defective merchandise by vendor to issue consolidated <strong>Return to Vendor (RTV) Debit Claims</strong>. All claims are automatically synced to database.
            </p>
          </div>
        </div>
      </div>

      {/* Filter Controls Bar (Dropdowns + Search) */}
      <div className="p-3 sm:p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-3 shadow-xs w-full min-w-0 box-border">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 w-full min-w-0">
          
          <div className="grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-wrap md:items-center gap-2.5 w-full md:w-auto min-w-0">
            {/* Supplier Select Dropdown */}
            <div className="flex items-center gap-1.5 w-full md:w-auto min-w-0">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0">
                Supplier:
              </label>
              <select
                value={selectedSupplier}
                onChange={(e) => {
                  setSelectedSupplier(e.target.value);
                  setSelectedRmaIds(new Set());
                }}
                className="w-full md:w-auto px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-amber-600 cursor-pointer shadow-2xs md:max-w-[200px] truncate box-border"
                title="Filter by Supplier / Vendor"
              >
                {suppliers.map(sup => (
                  <option key={sup} value={sup}>
                    {sup === 'All' ? 'All Suppliers' : sup}
                  </option>
                ))}
              </select>
            </div>

            {/* Disposition Filter Dropdown */}
            <div className="flex items-center gap-1.5 w-full md:w-auto min-w-0">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0">
                Triage:
              </label>
              <select
                value={dispositionFilter}
                onChange={(e) => {
                  setDispositionFilter(e.target.value);
                  setSelectedRmaIds(new Set());
                }}
                className="w-full md:w-auto px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-amber-600 cursor-pointer shadow-2xs truncate box-border"
                title="Filter by Triage Disposition"
              >
                <option value="All">All Dispositions</option>
                <option value="1- Pending Triage">1- Pending Triage</option>
                <option value="2- Restock to Inventory">2- Restock to Inventory</option>
                <option value="3- Return to Vendor (RTV)">3- Return to Vendor (RTV)</option>
                <option value="4- Quarantine">4- Quarantine</option>
                <option value="5- Scrap / Dispose">5- Scrap / Dispose</option>
              </select>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setSelectedSupplier('All');
                  setDispositionFilter('All');
                  setSearchTerm('');
                  setSelectedRmaIds(new Set());
                }}
                className="w-full sm:w-auto px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer box-border"
                title="Reset all filters"
              >
                <RotateCcw className="w-3 h-3 shrink-0" />
                <span>Reset</span>
              </button>
            )}
          </div>

          {/* Search Bar with Clear Button */}
          <div className="relative w-full md:w-auto md:min-w-[240px] min-w-0">
            <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search RMA#, product, SKU..."
              className="w-full pl-8 pr-8 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-amber-600"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Selection & Multi-Select Toolbar (Printing or Deleting Only) */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-xs">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleSelectAll}
              className="font-bold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
            >
              {selectedRmaIds.size === rtvCandidates.length && rtvCandidates.length > 0 ? 'Deselect All' : `Select All (${rtvCandidates.length})`}
            </button>

            {selectedRmaIds.size > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-slate-700 dark:text-slate-300 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded-lg border border-amber-200 dark:border-amber-900">
                  {selectedRmaIds.size} selected • ₱{totalClaimAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>

                {/* 1. Print Vouchers for Selected Items */}
                <button
                  type="button"
                  onClick={handlePrintSelectedVouchers}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                  title="Print RTV claim vouchers for selected items"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Vouchers</span>
                </button>

                {/* 2. Delete Selected */}
                {canDeleteReports && onRequestBulkDeleteReports && (
                  <button
                    type="button"
                    onClick={handleBulkDelete}
                    className="px-3 py-1 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/70 dark:hover:bg-rose-900/70 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                    title="Permanently delete selected records and remove proof images"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Selected ({selectedRmaIds.size})</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-bold ml-1 cursor-pointer"
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => exportSupplierOutboundClaimsToCSV(selectedItems.length > 0 ? selectedItems : rtvCandidates)}
            className="text-xs text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 flex items-center gap-1.5 font-bold cursor-pointer ml-auto bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-1.5 rounded-xl shadow-2xs hover:shadow-xs transition-all"
            title="Download vendor chargeback CSV with bin location and batch numbers"
          >
            <Download className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span>Export Supplier Claims CSV</span>
          </button>
        </div>
      </div>

      {/* RTV Items Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
        {rtvCandidates.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400 space-y-2">
            <Building2 className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-700" />
            <p className="font-semibold text-slate-600 dark:text-slate-400">No return merchandise matching the selected filters.</p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setSelectedSupplier('All');
                  setDispositionFilter('All');
                  setSearchTerm('');
                  setSelectedRmaIds(new Set());
                }}
                className="text-amber-600 hover:underline font-bold text-xs"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800 select-none">
                <tr>
                  {/* Select All Checkbox */}
                  <th className="p-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={isAllPageSelected}
                      onChange={handleSelectAll}
                      className="rounded-md border-slate-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                      title="Select all on this page"
                    />
                  </th>

                  {/* SN Column */}
                  <th className="p-3 w-14 font-black text-slate-900 dark:text-white">
                    SN
                  </th>

                  {/* Photo Column */}
                  <th className="p-3 text-center w-12" title="Proof Photo">
                    <ImageIcon className="w-4 h-4 mx-auto text-slate-400" />
                  </th>

                  {/* RMA Identifier */}
                  <th 
                    onClick={() => handleSort('rma_number')}
                    className="p-3 cursor-pointer hover:text-amber-600 transition-colors group"
                  >
                    <div className="flex items-center gap-1">
                      <span>RMA Identifier</span>
                      {sortField === 'rma_number' || sortField === 'created_at' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />
                      ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" />}
                    </div>
                  </th>

                  {/* Vendor / Supplier */}
                  <th 
                    onClick={() => handleSort('supplier_name')}
                    className="p-3 cursor-pointer hover:text-amber-600 transition-colors group"
                  >
                    <div className="flex items-center gap-1">
                      <span>Vendor / Supplier</span>
                      {sortField === 'supplier_name' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />
                      ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" />}
                    </div>
                  </th>

                  {/* Product Description & SKU */}
                  <th 
                    onClick={() => handleSort('name')}
                    className="p-3 cursor-pointer hover:text-amber-600 transition-colors group"
                  >
                    <div className="flex items-center gap-1">
                      <span>Product Description & SKU</span>
                      {sortField === 'name' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />
                      ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" />}
                    </div>
                  </th>

                  {/* Triage Disposition */}
                  <th 
                    onClick={() => handleSort('disposition')}
                    className="p-3 cursor-pointer hover:text-amber-600 transition-colors group"
                  >
                    <div className="flex items-center gap-1">
                      <span>Triage Disposition</span>
                      {sortField === 'disposition' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />
                      ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" />}
                    </div>
                  </th>

                  {/* Qty */}
                  <th 
                    onClick={() => handleSort('quantity')}
                    className="p-3 text-right cursor-pointer hover:text-amber-600 transition-colors group"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Qty</span>
                      {sortField === 'quantity' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />
                      ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" />}
                    </div>
                  </th>

                  {/* Unit Price */}
                  <th 
                    onClick={() => handleSort('price')}
                    className="p-3 text-right cursor-pointer hover:text-amber-600 transition-colors group"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Unit Price</span>
                      {sortField === 'price' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />
                      ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" />}
                    </div>
                  </th>

                  {/* Total Claim */}
                  <th 
                    onClick={() => handleSort('total')}
                    className="p-3 text-right cursor-pointer hover:text-amber-600 transition-colors group"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Total Claim</span>
                      {sortField === 'total' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />
                      ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" />}
                    </div>
                  </th>

                  {/* Actions Column */}
                  <th className="p-3 text-center font-bold">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paginatedCandidates.map((r, idx) => {
                  const id = r.id || r.rma_number;
                  const isSelected = selectedRmaIds.has(id);
                  const qty = Number(r.quantity || 1);
                  const price = Number(r.price_with_vat || r.price || 0);
                  const total = qty * price;
                  const photos = getPhotos(r);
                  const existingClaim = getClaimForReport(r);

                  return (
                    <tr 
                      key={id}
                      onClick={() => handleToggleSelect(id)}
                      className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer ${
                        isSelected ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(id)}
                          className="rounded-md border-slate-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                        />
                      </td>

                      {/* SN Column */}
                      <td className="p-3 font-mono">
                        <span className="font-black text-amber-900 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded-lg text-xs">
                          #{(currentPage - 1) * pageSize + idx + 1}
                        </span>
                      </td>

                      {/* Photo Thumbnail */}
                      <td className="p-2 text-center" onClick={(e) => e.stopPropagation()}>
                        {photos.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => handleOpenPhotoPreview(r)}
                            className="relative w-9 h-9 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 inline-block hover:scale-105 transition-all shadow-2xs cursor-zoom-in"
                            title="Click to view full-size photo"
                          >
                            <img 
                              src={photos[0]} 
                              alt="Proof" 
                              className="w-full h-full object-cover" 
                            />
                            {photos.length > 1 && (
                              <span className="absolute bottom-0 right-0 bg-black/70 text-white text-[8px] font-black px-1 rounded-tl">
                                +{photos.length - 1}
                              </span>
                            )}
                          </button>
                        ) : (
                          <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-300 dark:text-slate-600 flex items-center justify-center mx-auto border border-slate-200 dark:border-slate-700">
                            <ImageIcon className="w-3.5 h-3.5" />
                          </div>
                        )}
                      </td>

                      {/* RMA Identifier */}
                      <td className="p-3">
                        <div className="font-mono font-black text-slate-900 dark:text-white">
                          {r.rma_number}
                        </div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-1.5 flex-wrap">
                          <span>{r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}</span>
                          {r.gps_latitude && r.gps_longitude && (
                            <a
                              href={`https://www.google.com/maps?q=${r.gps_latitude},${r.gps_longitude}`}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5 font-bold"
                              title="View GPS Location on Google Maps"
                            >
                              <MapPin className="w-2.5 h-2.5 text-rose-500" />
                              <span>Map</span>
                            </a>
                          )}
                        </div>
                      </td>

                      {/* Vendor / Supplier & Warehouse Bin */}
                      <td className="p-3">
                        <div className="font-bold text-slate-800 dark:text-slate-200">
                          {r.supplier_name || 'Savemore'}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          Bin: <strong className="text-slate-600 dark:text-slate-300">{r.warehouse_location || 'DOCK'}</strong>
                          {r.batch_lot_number && (
                            <span className="text-purple-600 dark:text-purple-400 font-bold ml-1.5">• Lot: {r.batch_lot_number}</span>
                          )}
                        </div>
                      </td>

                      {/* Product Description & SKU */}
                      <td className="p-3">
                        <div className="font-bold text-slate-900 dark:text-white truncate max-w-xs" title={r.name}>
                          {r.name}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400">
                          SKU: <strong className="text-slate-600 dark:text-slate-300">{r.code || r.sku || 'Unassigned'}</strong> • BC: {r.barcode}
                        </div>
                      </td>

                      {/* Triage Disposition */}
                      <td className="p-3">
                        <span className={`px-2.5 py-0.5 rounded-lg text-[10px] font-extrabold border inline-block whitespace-nowrap shadow-2xs ${
                          r.disposition === 'Return to Vendor (RTV)'
                            ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-800'
                            : r.disposition === 'Restock to Inventory'
                            ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/70 dark:text-blue-300 dark:border-blue-800'
                            : r.disposition === 'Quarantine'
                            ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800'
                            : r.disposition === 'Scrap / Dispose'
                            ? 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950 dark:text-rose-300'
                            : 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                        }`}>
                          {r.disposition || 'Pending Triage'}
                        </span>
                      </td>

                      {/* Qty */}
                      <td className="p-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {qty} {r.unit_name || 'pc'}
                      </td>

                      {/* Unit Price */}
                      <td className="p-3 text-right font-mono text-slate-600 dark:text-slate-400">
                        ₱{price.toFixed(2)}
                      </td>

                      {/* Total Claim */}
                      <td className="p-3 text-right font-mono font-black text-amber-700 dark:text-amber-400">
                        ₱{total.toFixed(2)}
                      </td>

                      {/* Actions Column: Individual Debit Claim & Delete Only */}
                      <td className="p-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          {/* Individual Action for Debit Claim Generation or Viewing */}
                          {existingClaim ? (
                            <button
                              type="button"
                              onClick={() => setActiveClaimBatch(existingClaim)}
                              className="px-2.5 py-1 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/70 dark:hover:bg-emerald-900/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded-lg text-[10px] font-black flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                              title={`View Official RTV Debit Claim Voucher: ${existingClaim.claimNumber || existingClaim.claim_number}`}
                            >
                              <Receipt className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                              <span>RTV Voucher</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleGenerateSingleClaim(r)}
                              disabled={isSavingClaim}
                              className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/70 dark:hover:bg-amber-900/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                              title={`Generate RTV Debit Claim Voucher for ${r.rma_number}`}
                            >
                              <Receipt className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                              <span>+ Debit Claim</span>
                            </button>
                          )}

                          {/* Delete Report */}
                          {canDeleteReports && onRequestDeleteReport && (
                            <button
                              type="button"
                              onClick={() => onRequestDeleteReport(r.id, r.rma_number, r)}
                              className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors cursor-pointer"
                              title={`Delete RMA #${r.rma_number} and remove stored proof photos`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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
        )}

        {/* Table Pagination Component */}
        <TablePagination
          currentPage={currentPage}
          totalItems={rtvCandidates.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            setCurrentPage(1);
          }}
          pageSizeOptions={[10, 25, 50, 100]}
          itemLabel="claim items"
        />
      </div>

      {/* Lightbox Modal (Fallback if onViewPhoto is not supplied) */}
      {localLightboxPhoto && (
        <ImageLightboxModal
          isOpen={Boolean(localLightboxPhoto)}
          imageUrl={localLightboxPhoto?.url}
          images={localLightboxPhoto?.images || [localLightboxPhoto.url]}
          initialIndex={localLightboxPhoto?.initialIndex || 0}
          title={localLightboxPhoto?.title}
          subtitle={localLightboxPhoto?.subtitle}
          onClose={() => setLocalLightboxPhoto(null)}
        />
      )}

      {/* FORMAL RTV DEBIT CLAIM VOUCHER MODAL */}
      {activeClaimBatch && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 max-w-3xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[95vh] animate-in zoom-in-95">
            
            {/* Header */}
            <div className="p-4 sm:px-6 bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-amber-600" />
                <h3 className="text-sm font-black text-slate-900 dark:text-white">
                  Supplier Debit Claim Voucher (RTV)
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  Synced to Database
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveClaimBatch(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-xs font-bold"
              >
                ✕
              </button>
            </div>

            {/* Printable Voucher Mount */}
            <div id="rtv-voucher-mount" className="p-6 overflow-y-auto space-y-6 text-xs bg-white text-black font-sans">
              
              {/* Header Grid */}
              <div className="border-b-2 border-black pb-4 flex items-start justify-between">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                    WHOLESALE REVERSE LOGISTICS & RECOVERY
                  </div>
                  <h2 className="text-xl font-black text-black">
                    SUPPLIER DEBIT CLAIM VOUCHER
                  </h2>
                  <div className="text-xs text-slate-600 mt-1">
                    Vendor / Counterparty: <strong>{activeClaimBatch.supplierName || activeClaimBatch.supplier_name}</strong>
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-mono text-sm font-black text-black bg-slate-100 px-2 py-1 border border-black inline-block">
                    {activeClaimBatch.claimNumber || activeClaimBatch.claim_number}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    Date: {new Date(activeClaimBatch.createdAt || activeClaimBatch.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>

              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 border border-black rounded-lg">
                <div>
                  <div className="text-[9px] font-black uppercase text-slate-500">TOTAL BUNDLED ITEMS</div>
                  <div className="text-base font-black text-black">{activeClaimBatch.items?.length || 1} Lines</div>
                </div>
                <div>
                  <div className="text-[9px] font-black uppercase text-slate-500">TOTAL RETURNED UNITS</div>
                  <div className="text-base font-black text-black">{activeClaimBatch.totalQuantity || activeClaimBatch.total_quantity} Units</div>
                </div>
                <div>
                  <div className="text-[9px] font-black uppercase text-slate-500">TOTAL CLAIM AMOUNT</div>
                  <div className="text-base font-black text-amber-600 font-mono">
                    ₱{Number(activeClaimBatch.totalClaimAmount || activeClaimBatch.total_claim_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div className="border border-black rounded-lg overflow-hidden">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-100 border-b border-black font-bold uppercase text-[10px]">
                    <tr>
                      <th className="p-2">RMA #</th>
                      <th className="p-2">Barcode / SKU</th>
                      <th className="p-2">Description</th>
                      <th className="p-2 text-center">Qty</th>
                      <th className="p-2 text-right">Price</th>
                      <th className="p-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(activeClaimBatch.items || []).map((item, idx) => {
                      const qty = Number(item.quantity) || 1;
                      const price = Number(item.price_with_vat || item.price || 0);
                      return (
                        <tr key={idx}>
                          <td className="p-2 font-mono font-bold">{item.rma_number}</td>
                          <td className="p-2 font-mono">{item.code || item.sku || item.barcode}</td>
                          <td className="p-2 font-semibold">{item.name}</td>
                          <td className="p-2 text-center font-mono">{qty} {item.unit_name || 'pc'}</td>
                          <td className="p-2 text-right font-mono">₱{price.toFixed(2)}</td>
                          <td className="p-2 text-right font-mono font-bold">₱{(qty * price).toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Signatures */}
              <div className="grid grid-cols-2 gap-8 pt-8 border-t border-black text-center text-[10px]">
                <div>
                  <div className="border-b border-black pb-8"></div>
                  <div className="font-bold pt-1 uppercase">Prepared By (Logistics / Warehouse)</div>
                  <input
                    type="text"
                    value={activeClaimBatch.generatedBy || activeClaimBatch.generated_by || ''}
                    onChange={(e) => setActiveClaimBatch(prev => ({ ...prev, generatedBy: e.target.value, generated_by: e.target.value }))}
                    className="text-center font-semibold text-slate-800 dark:text-slate-100 print:text-black w-full bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-brand-500 rounded text-[11px] px-1"
                    title="Click to edit name if needed"
                  />
                </div>
                <div>
                  <div className="border-b border-black pb-8"></div>
                  <div className="font-bold pt-1 uppercase">Supplier Acknowledgement / Driver Signature</div>
                  <div className="text-slate-500 print:text-black">Signature Over Printed Name & Date</div>
                </div>
              </div>

            </div>

            {/* Footer Actions */}
            <div className="p-4 sm:px-6 bg-slate-50 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <button
                type="button"
                onClick={() => setActiveClaimBatch(null)}
                className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400"
              >
                Close
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrintClaimVoucher}
                  className="px-4 py-2 bg-slate-900 hover:bg-black text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-md cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Voucher</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
