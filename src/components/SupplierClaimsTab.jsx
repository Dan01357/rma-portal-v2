import React, { useState, useMemo, useEffect } from 'react';
import { 
  Building2, 
  CheckCircle2, 
  Download, 
  Search, 
  RotateCcw, 
  Trash2, 
  Image as ImageIcon, 
  X, 
  MapPin,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Package,
  ChevronDown,
  Unlock,
  FileSpreadsheet,
  QrCode,
  Send,
  Clock,
  ShieldCheck,
  BookOpen
} from 'lucide-react';
import { exportSupplierOutboundClaimsToXlsx } from '../utils/exportCsv';
import { catalogService } from '../services/catalogService';
import { notificationService, SETTINGS_SYNC_EVENT } from '../services/notificationService';
import TablePagination from './TablePagination';
import ImageLightboxModal from './ImageLightboxModal';
import SupplierFollowUpModal from './SupplierFollowUpModal';
import SupplierDirectoryModal from './SupplierDirectoryModal';
import { supplierClaimService } from '../services/supplierClaimService';
import {
  getCleanHumanWorkflowStatus,
  isPlaceholderSupplier
} from '../utils/followUpWorkflow';
import { 
  isBatchManifest, 
  getReportManifestItems, 
  isManifestSubItem, 
  formatQuantityWithPackSize, 
  formatManifestBreakdown,
  hasAssignedSku,
  getRealPhotos,
  normalizeWarehouseLocation,
  isUnlabeledBarcode,
  isTestRecord,
  getItemNeedsReorder,
  isItemReadyToRestock,
  isItemReorderNeeded,
  isItemScrappedNoReorder,
  isItemOnHold,
  isItemRejected,
  cleanExplanationText,
  formatFourChoiceOutcome,
  formatDateYmd,
  findConsolidatedRtvBatchReports,
  getGpsAddressDisplay,
  getGpsMapUrl,
  summarizeBatchSuppliers,
  isRealSupplierName,
  isMixedSuppliersSummary,
  resolveReorderStatus
} from '../utils/rmaHelpers';
import { useIsDesktopMd } from '../hooks/useIsDesktopMd';

export default function SupplierClaimsTab({
  reportsList = [],
  currentUser,
  onRefresh,
  onViewPhoto,
  onRequestDeleteReport,
  onRequestBulkDeleteReports,
  onRequestArchiveReport,
  onRequestBulkArchiveReports,
  onArchiveReport,
  onBulkArchiveReports,
  onAssignSku,
  onEditProductFromReport,
  onOpenQuickAction,
  onViewQR,
  onViewExplanation,
  onOpenSimpleWizard,
  onOpenPickupForm,
  onOpenMatrixExport,
  onResetToPending = null,
  savedProductsList = [],
  coworkerQueueFilter = 'all',
  isTestMode = false
}) {
  const isDesktopMd = useIsDesktopMd();
  const effectiveArchiveReport = onRequestArchiveReport || onArchiveReport;
  const effectiveBulkArchiveReports = onRequestBulkArchiveReports || onBulkArchiveReports;
  const [selectedSupplier, setSelectedSupplier] = useState('All');
  const [dispositionFilter, setDispositionFilter] = useState('All');
  const [reorderFilter, setReorderFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('created_at');
  const [updatingQueueId, setUpdatingQueueId] = useState(null);
  const [followUpModalReport, setFollowUpModalReport] = useState(null);
  const [isDirectoryOpen, setIsDirectoryOpen] = useState(false);
  const [followUpBanner, setFollowUpBanner] = useState(null);
  const [followUpConfig, setFollowUpConfig] = useState(() => notificationService.getDailyFollowUpConfig());

  useEffect(() => {
    const syncCfg = () => setFollowUpConfig(notificationService.getDailyFollowUpConfig());
    window.addEventListener(SETTINGS_SYNC_EVENT, syncCfg);
    window.addEventListener('storage', syncCfg);
    return () => {
      window.removeEventListener(SETTINGS_SYNC_EVENT, syncCfg);
      window.removeEventListener('storage', syncCfg);
    };
  }, []);

  const handleMarkReordered = async (report, nextStatus = 'reordered') => {
    if (!report || updatingQueueId) return;
    const rowKey = report.id || report.rma_number;
    setUpdatingQueueId(rowKey);
    setFollowUpBanner(null);
    try {
      await catalogService.markAsReordered({
        item: report,
        reorderStatus: nextStatus,
        actorName: currentUser?.name || currentUser?.email || 'Admin'
      });
      setFollowUpBanner({
        type: 'success',
        text: nextStatus === 'reordered'
          ? `${report.rma_number} marked Reordered (4-Choice Outcome & 10-Day SLA unchanged).`
          : `${report.rma_number} reorder status reset to Pending.`
      });
      if (onRefresh) onRefresh();
    } catch (err) {
      setFollowUpBanner({ type: 'error', text: err?.message || 'Failed updating Reorder status.' });
    } finally {
      setUpdatingQueueId(null);
    }
  };

  const handleRowCloseCase = async (report) => {
    const rowKey = report.id || report.rma_number;
    setUpdatingQueueId(rowKey);
    setFollowUpBanner(null);
    try {
      await catalogService.closeFollowUpCase(report, {
        markPickedUp: true,
        reason: 'Picked Up — Case Closed',
        actorName: currentUser?.name || currentUser?.email || 'Admin'
      });
      setFollowUpBanner({
        type: 'success',
        text: `${report.rma_number} marked Picked Up — Case Closed (countdown stopped).`
      });
      if (onRefresh) onRefresh();
      window.dispatchEvent(new CustomEvent('rma-data-changed', { detail: { type: 'followup-closed', rmaNumber: report.rma_number } }));
    } catch (err) {
      setFollowUpBanner({ type: 'error', text: err?.message || 'Failed closing case.' });
    } finally {
      setUpdatingQueueId(null);
    }
  };

  const handleConfirmCoworkerAction = async (item, targetStatus) => {
    if (!item || updatingQueueId) return;
    const rowKey = item.id || item.rma_number;
    setUpdatingQueueId(rowKey);
    const cleanStatus = targetStatus === 'scrapped' ? 'scrapped' : 'restocked';
    const actorName = currentUser?.name || (cleanStatus === 'restocked' ? 'Warehouse Staff' : 'Purchasing Staff');

    try {
      await catalogService.confirmCoworkerQueueAction({
        item,
        targetStatus: cleanStatus,
        warehouseLocation: cleanStatus === 'scrapped' ? 'SCRAP-BIN' : (item.warehouse_location || null),
        actorName
      });
      try {
        await notificationService.sendRmaLifecycleNotification({
          eventType: cleanStatus === 'scrapped' ? 'scrapped' : 'restocked',
          report: {
            ...item,
            status: 'resolved',
            ai_document_metadata: {
              ...((item.ai_document_metadata && typeof item.ai_document_metadata === 'object') ? item.ai_document_metadata : {}),
              workflow_resolution: cleanStatus === 'scrapped' ? 'scrapped_no_reorder' : 'restocked',
              resolved_at: new Date().toISOString(),
              resolved_by: actorName
            }
          },
          allReports: reportsList,
          catalogProducts: savedProductsList,
          actorName,
          isTestMode: isTestRecord(item) || isTestMode
        });
      } catch (mailErr) {
        console.warn('Non-blocking error sending coworker action email in SupplierHub:', mailErr);
      }
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Failed to confirm coworker queue action in SupplierHub:', err);
      alert(`Could not update status: ${err.message}`);
    } finally {
      setUpdatingQueueId(null);
    }
  };
  const [sortDirection, setSortDirection] = useState('desc');
  const [selectedRmaIds, setSelectedRmaIds] = useState(new Set());
  const [expandedManifestIds, setExpandedManifestIds] = useState(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [localLightboxPhoto, setLocalLightboxPhoto] = useState(null);
  const [savedClaims, setSavedClaims] = useState([]);

  const toggleManifestExpand = (id) => {
    setExpandedManifestIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Role permissions
  const canDeleteReports = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';

  // Helper to resolve product information (SKU, Name, Supplier, Price) with fallback to savedProductsList
  const resolveReportProduct = (r) => {
    if (!r) {
      return {
        name: '',
        code: '',
        supplier: 'Savemore',
        price: 0,
        qty: 1,
        total: 0,
        isUnassigned: true,
        matchedProduct: null,
        isManifest: false,
        manifestChildren: []
      };
    }

    const isManifest = !r.is_unpacked_manifest_item && isBatchManifest(r, reportsList);
    if (isManifest) {
      const children = getReportManifestItems(r, reportsList);
      const totalUnits = children.reduce((sum, c) => sum + (Number(c.quantity || c.qty) || 1), 0) || Number(r.quantity) || 1;
      const totalSum = children.reduce((sum, c) => {
        const cMatched = c.barcode ? savedProductsList.find(p => p.barcode && String(p.barcode).trim() === String(c.barcode).trim()) : null;
        const cPrice = Number(c.price_with_vat || c.price || cMatched?.price_with_vat || cMatched?.price || 0);
        const cQty = Number(c.quantity || c.qty) || 1;
        return sum + (cPrice * cQty);
      }, 0);
      const avgPrice = totalUnits > 0 ? (totalSum / totalUnits) : 0;
      const supplier = summarizeBatchSuppliers(
        children,
        !isMixedSuppliersSummary(r.supplier_name) && r.supplier_name !== 'Warehouse' ? r.supplier_name : 'Savemore'
      );

      return {
        name: `Batch Return Manifest (${children.length} Line Items)`,
        code: 'MANIFEST-BATCH',
        supplier,
        price: avgPrice,
        qty: totalUnits,
        total: totalSum,
        isUnassigned: false,
        matchedProduct: null,
        isManifest: true,
        manifestChildren: children
      };
    }

    const barcodeStr = r.barcode ? String(r.barcode).trim() : '';
    const matched = barcodeStr ? savedProductsList.find(p => p.barcode && String(p.barcode).trim() === barcodeStr) : null;

    const rawName = r.name || '';
    const isUnidentified = !rawName || rawName.toLowerCase().includes('unidentified');
    const name = isUnidentified
      ? (matched?.name || rawName || `Unidentified Item (${barcodeStr})`)
      : rawName;

    const code = r.code || r.sku || matched?.code || matched?.sku || '';

    const rawSupplier = r.supplier_name || '';
    const isPendingVendor = !rawSupplier || rawSupplier.toLowerCase().includes('pending') || rawSupplier.toLowerCase().includes('unassigned') || rawSupplier.toLowerCase() === 'warehouse';
    const supplier = isPendingVendor
      ? (matched?.supplier_name || (rawSupplier && rawSupplier.toLowerCase() !== 'warehouse' ? rawSupplier : 'Pending Assignment'))
      : (rawSupplier === 'Warehouse' && matched?.supplier_name ? matched.supplier_name : rawSupplier);

    const qty = Number(r.quantity || 1);
    const price = Number(r.price_with_vat || r.price || matched?.price_with_vat || matched?.price || 0);
    const total = qty * price;

    const isUnassigned = !code || isUnidentified || price <= 0 || (supplier.toLowerCase().includes('pending') || supplier.toLowerCase().includes('unassigned'));

    return {
      name,
      code,
      supplier,
      price,
      qty,
      total,
      isUnassigned,
      matchedProduct: matched,
      isManifest: false,
      manifestChildren: []
    };
  };

  // Load saved supplier debit claims from database
  useEffect(() => {
    let isMounted = true;
    supplierClaimService.getClaims().then(claims => {
      if (isMounted && Array.isArray(claims)) {
        setSavedClaims(claims.filter(c => isTestRecord(c) === Boolean(isTestMode)));
      }
    });
    return () => { isMounted = false; };
  }, [reportsList, isTestMode]);

  // Filter & dedup all reports suitable for Supplier Outbound / RTV
  const allRtvItems = useMemo(() => {
    const rawItems = [];

    reportsList.forEach(r => {
      // 1. Omit child sub-items from appearing as top-level rows (they are rendered in the manifest drawer)
      if (isManifestSubItem(r, reportsList)) {
        return;
      }

      const isExplicitSupplierOutbound = r.rma_type === 'supplier_outbound';
      const disp = String(r.disposition || '').toLowerCase();

      // Check if parent batch manifest contains any supplier outbound or RTV line items
      const isManifest = isBatchManifest(r, reportsList);
      const manifestChildren = isManifest ? getReportManifestItems(r, reportsList) : [];
      const hasRtvChild = manifestChildren.some(c => {
        const cDisp = String(c.disposition || '').toLowerCase();
        return c.rma_type === 'supplier_outbound' || cDisp.includes('rtv') || cDisp.includes('vendor') || cDisp.includes('supplier_credit') || cDisp.includes('supplier_exchange');
      });

      if (!isExplicitSupplierOutbound && !hasRtvChild) {
        // Exclude items triaged to Restock to Inventory, Scrap / Dispose, Quarantine, Buffer Exchange, or Pending Triage
        if (disp.includes('restock') || disp.includes('scrap') || disp.includes('quarantine') || disp.includes('buffer') || disp.includes('pending triage')) {
          return;
        }

        // Must strictly have an RTV disposition
        const isRtvDisposition = disp.includes('return to vendor') || disp.includes('rtv') || disp.includes('vendor') || disp.includes('supplier_credit') || disp.includes('supplier_exchange');
        if (!isRtvDisposition) {
          return;
        }
      }

      // Subject 1: When a report is a batch manifest (is_parent === true or items.length > 1):
      // DO NOT push the parent manifest container row with ₱0.00 into the table.
      // Instead, unpack each manifest child line item into its own individual table row.
      if (isManifest && manifestChildren.length > 0) {
        manifestChildren.forEach((child, cIdx) => {
          const cDisp = String(child.disposition || '').toLowerCase();
          // Exclude non-supplier child items explicitly triaged to non-RTV outcomes
          if (!isExplicitSupplierOutbound && child.rma_type !== 'supplier_outbound' && (cDisp.includes('restock') || cDisp.includes('scrap') || cDisp.includes('quarantine') || cDisp.includes('buffer'))) {
            return;
          }
          // If the parent manifest wasn't explicitly supplier_outbound or RTV, require the child itself to be RTV
          const isParentRtvOrSupplier = isExplicitSupplierOutbound || disp.includes('return to vendor') || disp.includes('rtv') || disp.includes('vendor') || disp.includes('supplier_credit') || disp.includes('supplier_exchange');
          const isChildRtvOrSupplier = child.rma_type === 'supplier_outbound' || cDisp.includes('rtv') || cDisp.includes('vendor') || cDisp.includes('supplier_credit') || cDisp.includes('supplier_exchange');
          if (!isParentRtvOrSupplier && !isChildRtvOrSupplier) {
            return;
          }

          const childBarcode = String(child.barcode || '').trim();
          const matchedChild = childBarcode
            ? (savedProductsList || []).find(p => p.barcode && String(p.barcode).trim() === childBarcode)
            : null;
          const childRawSku = String(child.code || child.sku || matchedChild?.code || matchedChild?.sku || '').trim();
          const isChildSkuValid = Boolean(
            childRawSku &&
            childRawSku !== childBarcode &&
            !childRawSku.toLowerCase().includes('awaiting') &&
            !childRawSku.toLowerCase().includes('unidentified')
          );
          const childName = (child.name || child.productName || matchedChild?.name || `Item #${cIdx + 1}`).trim();
          const childQty = Number(child.quantity || child.qty) || 1;
          const childUnit = child.unit_name || child.unit || r.unit_name || 'pc';
          const childPrice = Number(child.price_with_vat || child.price || matchedChild?.price_with_vat || matchedChild?.price || 0);
          const rawChildSupplier = String(child.supplier_name || child.supplierName || child.supplier || '').trim();
          const resolvedChildSupplier = isRealSupplierName(rawChildSupplier)
            ? rawChildSupplier
            : (matchedChild?.supplier_name || (isRealSupplierName(r.supplier_name) ? r.supplier_name : 'Pending Assignment'));
          const childPhotos = (Array.isArray(child.photos) && child.photos.length > 0)
            ? child.photos
            : (Array.isArray(r.photos) ? r.photos : []);

          rawItems.push({
            ...r,
            ...child,
            id: child.id || `${r.id || r.rma_number}_item_${cIdx}_${childBarcode || cIdx}`,
            parent_rma_id: r.id,
            is_parent: false,
            is_unpacked_manifest_item: true,
            manifest_line_index: cIdx,
            manifest_total_lines: manifestChildren.length,
            manifest_items: manifestChildren,
            items: [],
            total_items: 1,
            rma_number: r.rma_number,
            barcode: childBarcode,
            code: isChildSkuValid ? childRawSku : '',
            sku: isChildSkuValid ? childRawSku : '',
            name: childName,
            quantity: childQty,
            unit_name: childUnit,
            pieces_per_case: child.pieces_per_case || child.piecesPerCase || matchedChild?.pieces_per_case || null,
            price: childPrice,
            price_with_vat: childPrice,
            supplier_name: resolvedChildSupplier,
            warehouse_location: child.warehouse_location || r.warehouse_location || 'DOCK',
            disposition: child.disposition || r.disposition || 'Pending',
            reason: child.reason || r.reason || 'Damaged',
            explanation: child.explanation || child.notes || r.explanation || null,
            photos: childPhotos
          });
        });
        return;
      }

      rawItems.push(r);
    });

    // Eliminate duplicate rows: ensure each unique RMA ticket / unpacked line item appears exactly once
    const dedupedItems = [];
    const seenKeys = new Set();
    rawItems.forEach(item => {
      const uniqueKey = item.id ? String(item.id) : String(item.rma_number);
      if (!seenKeys.has(uniqueKey)) {
        seenKeys.add(uniqueKey);
        dedupedItems.push(item);
      }
    });

    return dedupedItems;
  }, [reportsList, savedProductsList]);

  // Count candidate items for each supplier in real-time
  const supplierCounts = useMemo(() => {
    const counts = { All: allRtvItems.length };
    allRtvItems.forEach(r => {
      const res = resolveReportProduct(r);
      const sup = res.supplier?.trim();
      if (sup) {
        counts[sup] = (counts[sup] || 0) + 1;
      }
    });
    return counts;
  }, [allRtvItems]);

  // Extract unique suppliers from RTV candidate reports & catalog
  const suppliers = useMemo(() => {
    const set = new Set();
    allRtvItems.forEach(r => {
      const res = resolveReportProduct(r);
      const sup = res.supplier?.trim();
      if (sup && sup !== 'Pending Assignment' && sup !== 'Unassigned' && sup !== 'Warehouse') {
        set.add(sup);
      }
    });

    (savedProductsList || []).forEach(p => {
      const sup = (p.supplier_name || p.supplierName || '').trim();
      if (sup && sup !== 'Pending Assignment' && sup !== 'Unassigned' && sup !== 'Warehouse') {
        set.add(sup);
      }
    });

    return ['All', ...Array.from(set).sort()];
  }, [allRtvItems, savedProductsList]);

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
    // Filter by Supplier, Disposition, and Search
    let list = allRtvItems.filter(r => {
      const res = resolveReportProduct(r);

      const matchesSupplier = selectedSupplier === 'All' || 
        res.supplier.toLowerCase() === selectedSupplier.toLowerCase() ||
        (r.supplier_name && r.supplier_name.toLowerCase() === selectedSupplier.toLowerCase());

      const outcome = formatFourChoiceOutcome(r);
      const rDisp = String(r.disposition || '').toLowerCase();
      const matchesDisposition = (() => {
        if (dispositionFilter === 'All') return true;
        if (dispositionFilter === 'pending_decision') return outcome.choiceKey === 'pending';
        if (dispositionFilter === 'waiting_debit') return outcome.choiceKey === 'debit' && !outcome.isPickedUp;
        if (dispositionFilter === 'picked_up_debit') return outcome.choiceKey === 'debit' && outcome.isPickedUp;
        if (dispositionFilter === 'waiting_replacement') return outcome.choiceKey === 'replacement' && !outcome.isPickedUp;
        if (dispositionFilter === 'picked_up_replacement') return outcome.choiceKey === 'replacement' && outcome.isPickedUp;
        if (dispositionFilter === 'scrap') return outcome.choiceKey === 'scrap';
        if (dispositionFilter === 'restock_good') return outcome.choiceKey === 'restock';
        const cleanFilter = dispositionFilter.toLowerCase().replace(/^\d+\s*-\s*/, '').trim();
        return rDisp === dispositionFilter.toLowerCase() ||
          rDisp.replace(/^\d+\s*-\s*/, '').trim() === cleanFilter ||
          outcome.label.toLowerCase().includes(cleanFilter);
      })();

      // Unified Coworker Workstation Queue Filter (Controlled by top dark navy bar)
      const activeQueue = coworkerQueueFilter || 'all';
      if (activeQueue === 'restock') {
        if (!isItemReadyToRestock(r)) return false;
      } else if (activeQueue === 'reorder' || activeQueue === 'scrap') {
        if (!isItemReorderNeeded(r)) return false;
      } else if (activeQueue === 'scrap_no_reorder') {
        if (!isItemScrappedNoReorder(r)) return false;
      } else if (activeQueue === 'hold' || activeQueue === 'quarantine') {
        if (!isItemOnHold(r)) return false;
      } else if (activeQueue === 'rejected') {
        if (!isItemRejected(r)) return false;
      }

      const q = searchTerm.toLowerCase().trim();
      const matchesSearch = !q || 
        res.name?.toLowerCase().includes(q) ||
        r.barcode?.includes(q) ||
        r.rma_number?.toLowerCase().includes(q) ||
        res.code?.toLowerCase().includes(q) ||
        res.supplier?.toLowerCase().includes(q) ||
        r.warehouse_location?.toLowerCase().includes(q) ||
        r.batch_lot_number?.toLowerCase().includes(q) ||
        r.si_number?.toLowerCase().includes(q) ||
        r.dr_number?.toLowerCase().includes(q) ||
        r.po_number?.toLowerCase().includes(q) ||
        r.invoice_dr_number?.toLowerCase().includes(q);

      const reorderInfo = resolveReorderStatus(r);
      const matchesReorder =
        reorderFilter === 'all' ||
        (reorderFilter === 'reordered' ? reorderInfo.isReordered : !reorderInfo.isReordered);

      return matchesSupplier && matchesDisposition && matchesReorder && matchesSearch;
    });

    list.sort((a, b) => {
      let valA, valB;
      const resA = resolveReportProduct(a);
      const resB = resolveReportProduct(b);

      switch (sortField) {
        case 'rma_number':
          valA = String(a.rma_number || '').toLowerCase();
          valB = String(b.rma_number || '').toLowerCase();
          break;
        case 'supplier_name':
          valA = resA.supplier.toLowerCase();
          valB = resB.supplier.toLowerCase();
          break;
        case 'name':
          valA = resA.name.toLowerCase();
          valB = resB.name.toLowerCase();
          break;
        case 'disposition':
          valA = String(a.disposition || 'Pending Triage').toLowerCase();
          valB = String(b.disposition || 'Pending Triage').toLowerCase();
          break;
        case 'quantity':
          valA = resA.qty;
          valB = resB.qty;
          break;
        case 'price':
          valA = resA.price;
          valB = resB.price;
          break;
        case 'total':
          valA = resA.total;
          valB = resB.total;
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
  }, [allRtvItems, selectedSupplier, dispositionFilter, reorderFilter, searchTerm, coworkerQueueFilter, sortField, sortDirection, savedProductsList]);


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
      const res = resolveReportProduct(r);
      return sum + res.total;
    }, 0);
  }, [selectedItems, savedProductsList]);

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

  // Map claim numbers to all RMA numbers sharing that consolidated claim
  const claimBatchMap = useMemo(() => {
    const map = new Map();
    const addLink = (claimNo, rmaNo) => {
      const c = String(claimNo || '').trim();
      const rma = String(rmaNo || '').trim();
      if (!c || !rma) return;
      if (!map.has(c)) map.set(c, new Set());
      map.get(c).add(rma);
    };
    (savedClaims || []).forEach((cl) => {
      const cNo = cl.claimNumber || cl.claim_number;
      (Array.isArray(cl.items) ? cl.items : []).forEach((it) => addLink(cNo, it.rma_number));
    });
    (reportsList || []).forEach((rep) => {
      if (!rep || (rep.rma_type === 'supplier_outbound') === false) return;
      if (isTestRecord(rep) !== Boolean(isTestMode)) return;
      const p = rep.ai_document_metadata?.supplier_pickup || {};
      const cNo = p.claim_number || String(rep.notes || '').match(/\[RTV:\s*([^\]]+)\]/i)?.[1];
      if (cNo) {
        addLink(cNo, rep.rma_number);
        (Array.isArray(p.consolidated_rma_numbers) ? p.consolidated_rma_numbers : []).forEach((n) => addLink(cNo, n));
      }
    });
    return map;
  }, [savedClaims, reportsList, isTestMode]);

  const activeSupplierForQuickSelect = useMemo(() => {
    if (selectedSupplier !== 'All') return selectedSupplier;
    if (selectedItems.length > 0) {
      const sup = resolveReportProduct(selectedItems[0]).supplier;
      if (sup && !sup.toLowerCase().includes('pending') && !sup.toLowerCase().includes('unassigned')) {
        return sup;
      }
    }
    return '';
  }, [selectedSupplier, selectedItems, savedProductsList]);

  const unclaimedForSupplier = useMemo(() => {
    if (!activeSupplierForQuickSelect) return [];
    const target = activeSupplierForQuickSelect.trim().toLowerCase();
    return rtvCandidates.filter((r) => {
      const sup = String(resolveReportProduct(r).supplier || '').trim().toLowerCase();
      if (sup !== target) return false;
      const out = formatFourChoiceOutcome(r);
      return !out.isPickedUp && String(r.status || '').toLowerCase() !== 'picked_up';
    });
  }, [activeSupplierForQuickSelect, rtvCandidates, savedProductsList]);

  const handleSelectAllUnclaimedSupplier = () => {
    if (unclaimedForSupplier.length === 0) return;
    setSelectedRmaIds(new Set(unclaimedForSupplier.map((r) => r.id || r.rma_number)));
  };

  const handleClearSelection = () => {
    setSelectedRmaIds(new Set());
  };

  // Helper to safely extract photo URLs (ignoring fake Unsplash stock photos)
  const getPhotos = (report) => {
    return getRealPhotos(report?.photos);
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
    
    // 1. Search in saved claims items (match barcode too for unpacked manifest items)
    const found = savedClaims.find(c => 
      Array.isArray(c.items) && c.items.some(i => {
        if (i.rma_number !== rma) return false;
        if (report.is_unpacked_manifest_item && report.barcode && i.barcode) {
          return String(i.barcode).trim() === String(report.barcode).trim();
        }
        return true;
      })
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
   * BATCH ACTION: DELETE SELECTED REPORTS
   */
  const handleBulkDelete = () => {
    if (selectedItems.length === 0) return;
    if (onRequestBulkDeleteReports) {
      onRequestBulkDeleteReports(selectedItems);
    }
  };

  const hasActiveFilters = selectedSupplier !== 'All' || dispositionFilter !== 'All' || reorderFilter !== 'all' || Boolean(searchTerm);

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
              {isTestMode && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-500 text-slate-950 shrink-0">
                  🧪 Sandbox Test Mode
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Bundle damaged/defective merchandise by vendor to issue consolidated <strong>Return to Vendor (RTV) Debit Claims</strong>. All claims are automatically synced to database.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsDirectoryOpen(true)}
          className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white border border-slate-700 text-xs font-black flex items-center gap-1.5 shadow-sm cursor-pointer shrink-0 self-start sm:self-auto"
          title="Open Persistent Supplier Emails Directory (Add, Edit, Search, Delete contacts)"
        >
          <BookOpen className="w-3.5 h-3.5 text-amber-400" />
          <span>Supplier Emails Directory</span>
        </button>
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
                {suppliers.map(sup => {
                  const count = supplierCounts[sup] || 0;
                  return (
                    <option key={sup} value={sup}>
                      {sup === 'All' ? `All Suppliers (${allRtvItems.length})` : `${sup} (${count})`}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* 4-Choice Status Filter Dropdown */}
            <div className="flex items-center gap-1.5 w-full md:w-auto min-w-0">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0">
                Status:
              </label>
              <select
                value={dispositionFilter}
                onChange={(e) => {
                  setDispositionFilter(e.target.value);
                  setSelectedRmaIds(new Set());
                }}
                className="w-full md:w-auto px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-amber-600 cursor-pointer shadow-2xs truncate box-border"
                title="Filter by 4-Choice Outcome"
              >
                <option value="All">All 4-Choice Statuses</option>
                <option value="pending_decision">Pending Decision</option>
                <option value="waiting_debit">Waiting Driver (Debit Claim)</option>
                <option value="picked_up_debit">Picked Up for Debit Claim</option>
                <option value="waiting_replacement">Waiting Driver (Replacement)</option>
                <option value="picked_up_replacement">Picked Up for Replacement</option>
                <option value="scrap">Scrapped / Disposed</option>
                <option value="restock_good">Restocked to Good Shelf</option>
              </select>
            </div>

            {/* Reorder Status Filter Dropdown */}
            <div className="flex items-center gap-1.5 w-full md:w-auto min-w-0">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0">
                Reorder:
              </label>
              <select
                aria-label="Reorder Status Filter"
                value={reorderFilter}
                onChange={(e) => {
                  setReorderFilter(e.target.value);
                  setSelectedRmaIds(new Set());
                }}
                className="w-full md:w-auto px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-emerald-600 cursor-pointer shadow-2xs truncate box-border"
                title="Filter by Reorder Status (independent of 4-Choice Outcome)"
              >
                <option value="all">All Reorder Statuses</option>
                <option value="pending">Reorder: Pending</option>
                <option value="reordered">✓ Reordered</option>
              </select>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setSelectedSupplier('All');
                  setDispositionFilter('All');
                  setReorderFilter('all');
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

            {activeSupplierForQuickSelect && unclaimedForSupplier.length > 0 && (
              <button
                type="button"
                onClick={handleSelectAllUnclaimedSupplier}
                className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 font-bold text-[11px] cursor-pointer transition-colors"
                title={`Select all unclaimed RMAs for ${activeSupplierForQuickSelect} in one click`}
              >
                Select All Unclaimed for {activeSupplierForQuickSelect} ({unclaimedForSupplier.length})
              </button>
            )}

            {selectedRmaIds.size > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-slate-700 dark:text-slate-300 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded-lg border border-amber-200 dark:border-amber-900">
                  {selectedRmaIds.size} selected • ₱{totalClaimAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>

                {/* Process Consolidated Batch */}
                {onOpenSimpleWizard && (
                  <button
                    type="button"
                    onClick={() => onOpenSimpleWizard(selectedItems.length > 1 ? selectedItems : selectedItems[0])}
                    className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-black flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                    title="Open 4-Choice Outcome & Driver Pickup Wizard for all selected RMAs in one consolidated batch"
                  >
                    <span>⚡ Process Consolidated Batch ({selectedRmaIds.size} RMA{selectedRmaIds.size > 1 ? 's' : ''})</span>
                  </button>
                )}

                {/* Archive Selected */}
                {effectiveBulkArchiveReports && (
                  <button
                    type="button"
                    onClick={() => effectiveBulkArchiveReports(selectedItems)}
                    className="px-3 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                    title="Archive selected records to Archive Vault"
                  >
                    <span>🗄️ Archive Selected ({selectedRmaIds.size})</span>
                  </button>
                )}

                {/* Consolidated Multi-Select QR Print / Save */}
                {onViewQR && (
                  <button
                    type="button"
                    onClick={() => onViewQR(selectedItems.length === 1 ? selectedItems[0] : selectedItems)}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-black flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                    title="Open Consolidated QR Print & PNG Studio for all selected Supplier RTVs"
                  >
                    <QrCode className="w-3.5 h-3.5 shrink-0" />
                    <span>🖨️ Print / Save QRs ({selectedRmaIds.size})</span>
                  </button>
                )}

                {/* 3. Delete Selected */}
                {canDeleteReports && onRequestBulkDeleteReports && (
                  <button
                    type="button"
                    onClick={handleBulkDelete}
                    className="px-3 py-1 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/70 dark:hover:bg-rose-900/70 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                    title="Move selected records to 30-day trash bin"
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

          <div className="flex items-center gap-2 ml-auto flex-wrap">
            {onOpenMatrixExport && (
              <button
                type="button"
                onClick={() => onOpenMatrixExport('overall')}
                className="text-xs text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-100 flex items-center gap-1.5 font-black cursor-pointer bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-700 px-3 py-1.5 rounded-xl shadow-2xs hover:shadow-xs transition-all"
                title="Download Overall RMA Matrix (.xlsx) combining Customer Hub & Supplier RTV"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>{isTestMode ? 'Sandbox Overall Matrix (.xlsx)' : 'Overall RMA Matrix (.xlsx)'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => exportSupplierOutboundClaimsToXlsx(selectedItems.length > 0 ? selectedItems : rtvCandidates, null, savedProductsList, isTestMode)}
              className="text-xs text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 flex items-center gap-1.5 font-bold cursor-pointer bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-1.5 rounded-xl shadow-2xs hover:shadow-xs transition-all"
              title="Download vendor chargeback Excel (.xlsx) with bin location and batch numbers"
            >
              <Download className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span>Export Supplier Claims (.xlsx)</span>
            </button>
          </div>
        </div>
      </div>

      {followUpBanner && (
        <div className={`px-4 py-2.5 rounded-2xl border text-xs font-bold flex items-center justify-between gap-2 ${
          followUpBanner.type === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200'
            : 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-700 text-rose-900 dark:text-rose-200'
        }`}>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>{followUpBanner.text}</span>
          </div>
          <button type="button" onClick={() => setFollowUpBanner(null)} className="opacity-70 hover:opacity-100 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

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
                  setReorderFilter('all');
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
          isDesktopMd ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800 select-none text-[11px]">
                <tr>
                  {/* Select All Checkbox */}
                  <th className="py-2 px-1 w-7 text-center">
                    <input
                      type="checkbox"
                      checked={isAllPageSelected}
                      onChange={handleSelectAll}
                      className="rounded-md border-slate-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                      title="Select all on this page"
                    />
                  </th>

                  {/* SN Column */}
                  <th className="py-2 px-1 w-9 font-black text-slate-900 dark:text-white">
                    SN
                  </th>

                  {/* Photo Column */}
                  <th className="py-2 px-0.5 text-center w-10" title="Proof Photo">
                    <ImageIcon className="w-4 h-4 mx-auto text-slate-400" />
                  </th>

                  {/* RMA Identifier & Quick QR */}
                  <th 
                    onClick={() => handleSort('rma_number')}
                    className="py-2 px-1 w-[130px] cursor-pointer hover:text-amber-600 transition-colors group whitespace-nowrap"
                  >
                    <div className="flex items-center gap-0.5">
                      <span>RMA # &amp; Date</span>
                      {sortField === 'rma_number' || sortField === 'created_at' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />
                      ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" />}
                    </div>
                  </th>

                  {/* Vendor / Supplier */}
                  <th 
                    onClick={() => handleSort('supplier_name')}
                    className="py-2 px-1 cursor-pointer hover:text-amber-600 transition-colors group"
                  >
                    <div className="flex items-center gap-0.5">
                      <span>Vendor &amp; Bin</span>
                      {sortField === 'supplier_name' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />
                      ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" />}
                    </div>
                  </th>

                  {/* Product Description & SKU */}
                  <th 
                    onClick={() => handleSort('name')}
                    className="py-2 px-1 cursor-pointer hover:text-amber-600 transition-colors group"
                  >
                    <div className="flex items-center gap-0.5">
                      <span>Product &amp; SKU</span>
                      {sortField === 'name' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />
                      ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" />}
                    </div>
                  </th>

                  {/* Disposition & 10-Day SLA */}
                  <th 
                    onClick={() => handleSort('disposition')}
                    className="py-2 px-1 w-[124px] cursor-pointer hover:text-amber-600 transition-colors group"
                  >
                    <div className="flex items-center gap-0.5">
                      <span>Disposition &amp; SLA</span>
                      {sortField === 'disposition' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />
                      ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" />}
                    </div>
                  </th>

                  {/* Defect Reason & Reporter Notes */}
                  <th className="py-2 px-1 font-bold">
                    Defect &amp; Notes
                  </th>

                  {/* Qty & Unit */}
                  <th 
                    onClick={() => handleSort('quantity')}
                    className="py-2 px-1 text-right cursor-pointer hover:text-amber-600 transition-colors group whitespace-nowrap"
                    title="Click to sort by Quantity and Unit"
                  >
                    <div className="flex items-center justify-end gap-0.5">
                      <span>Qty</span>
                      {sortField === 'quantity' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />
                      ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" />}
                    </div>
                  </th>

                  {/* Total Claim & Unit Price */}
                  <th 
                    onClick={() => handleSort('total')}
                    className="py-2 px-1 text-right cursor-pointer hover:text-amber-600 transition-colors group whitespace-nowrap"
                  >
                    <div className="flex items-center justify-end gap-0.5">
                      <span>Total Claim</span>
                      {sortField === 'total' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-amber-600" /> : <ArrowDown className="w-3 h-3 text-amber-600" />
                      ) : <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" />}
                    </div>
                  </th>

                  {/* Actions Column */}
                  <th className="py-2 px-1 w-[124px] text-center font-bold whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paginatedCandidates.map((r, idx) => {
                  const id = r.id || r.rma_number;
                  const isSelected = selectedRmaIds.has(id);
                  const res = resolveReportProduct(r);
                  const photos = getPhotos(r);
                  const existingClaim = getClaimForReport(r);
                  const outcome = formatFourChoiceOutcome(r);
                  const statusInfo = getCleanHumanWorkflowStatus(r, savedProductsList, {
                    customerFollowUpDefaultEnabled: followUpConfig.customerFollowUpDefaultEnabled,
                    testStepIntervalSeconds: isTestMode ? followUpConfig.testStepIntervalSeconds : 0
                  });
                  const wf = statusInfo.workflow;
                  const isManifest = !r.is_unpacked_manifest_item && isBatchManifest(r, reportsList);
                  const manifestChildren = isManifest ? getReportManifestItems(r, reportsList) : [];
                  const manifestKey = r.id || r.rma_number;
                  const isManifestExpanded = expandedManifestIds.has(manifestKey);

                  return (
                    <React.Fragment key={manifestKey}>
                      <tr 
                        onClick={(e) => {
                          if (e.target.closest('input, button, a')) return;
                          if (onOpenQuickAction) {
                            onOpenQuickAction(r.rma_number);
                          }
                        }}
                        className={`hover:bg-amber-50/50 dark:hover:bg-slate-800/60 transition-colors cursor-pointer ${
                          isSelected ? 'bg-amber-50/80 dark:bg-amber-950/40' : ''
                        }`}
                      >
                        {/* Checkbox */}
                        <td className="py-2 px-1 text-center w-7" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelect(id)}
                            className="rounded-md border-slate-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                          />
                        </td>

                        {/* SN Column */}
                        <td className="py-2 px-1 font-mono whitespace-nowrap w-9">
                          <span className="font-black text-amber-900 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-1 py-0.5 rounded-lg text-[10.5px]">
                            #{(currentPage - 1) * pageSize + idx + 1}
                          </span>
                        </td>

                        {/* Photo Thumbnail */}
                        <td className="py-2 px-0.5 text-center w-10" onClick={(e) => e.stopPropagation()}>
                          {photos.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => handleOpenPhotoPreview(r)}
                              className="relative w-8 h-8 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 inline-block hover:scale-105 transition-all shadow-2xs cursor-zoom-in"
                              title="Click to view full-size photo"
                            >
                              <img 
                                src={photos[0]} 
                                alt="Proof" 
                                onError={(e) => {
                                  if (!e.currentTarget.dataset.err) {
                                    e.currentTarget.dataset.err = '1';
                                    e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='1.75'%3E%3Crect width='18' height='18' x='3' y='3' rx='2'/%3E%3Ccircle cx='9' cy='9' r='2'/%3E%3Cpath d='m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21'/%3E%3C/svg%3E";
                                  }
                                }}
                                className="w-full h-full object-cover" 
                              />
                              {photos.length > 1 && (
                                <span className="absolute bottom-0 right-0 bg-black/70 text-white text-[8px] font-black px-1 rounded-tl">
                                  +{photos.length - 1}
                                </span>
                              )}
                            </button>
                          ) : (
                            <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-300 dark:text-slate-600 flex items-center justify-center mx-auto border border-slate-200 dark:border-slate-700">
                              <ImageIcon className="w-3.5 h-3.5" />
                            </div>
                          )}
                        </td>

                        {/* RMA Identifier & Inline Quick QR Button */}
                        <td className="py-2 px-1 w-[130px]">
                          <div className="flex items-center gap-0.5 whitespace-nowrap text-[10.5px]">
                            <span className="font-mono font-black text-slate-900 dark:text-white hover:text-amber-600 hover:underline">
                              {r.rma_number}
                            </span>
                            {onViewQR && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onViewQR({
                                    ...r,
                                    name: res.name,
                                    supplier_name: res.supplier,
                                    code: res.code || r.code,
                                    price: res.price || r.price
                                  });
                                }}
                                className="p-1 text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/60 rounded-md transition-colors cursor-pointer shrink-0"
                                title={`Quick-View & Print Box QR Sticker for ${r.rma_number}`}
                              >
                                <QrCode className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 flex items-center gap-1.5 flex-wrap">
                            <span className="whitespace-nowrap">{r.created_at ? formatDateYmd(r.created_at) : ''}</span>
                            {(() => {
                              const mapUrl = getGpsMapUrl(r);
                              const gpsAddr = getGpsAddressDisplay(r);
                              return mapUrl ? (
                                <a
                                  href={mapUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5 font-bold max-w-[125px]"
                                  title={gpsAddr || 'View GPS Location on Google Maps'}
                                >
                                  <MapPin className="w-2.5 h-2.5 text-rose-500 shrink-0" />
                                  <span className="truncate">{gpsAddr || 'Map'}</span>
                                </a>
                              ) : null;
                            })()}
                          </div>
                          {(r.si_number || r.dr_number || r.po_number || r.invoice_dr_number) && (
                            <div className="flex items-center gap-1 flex-wrap mt-1 text-[9px] font-mono leading-tight">
                              {r.si_number && (
                                <span className="px-1.5 py-0.2 rounded bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-bold">
                                  SI: {r.si_number}
                                </span>
                              )}
                              {r.dr_number && (
                                <span className="px-1.5 py-0.2 rounded bg-violet-50 dark:bg-violet-950/70 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 font-bold">
                                  DR: {r.dr_number}
                                </span>
                              )}
                              {r.po_number && (
                                <span className="px-1.5 py-0.2 rounded bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-bold">
                                  PO: {r.po_number}
                                </span>
                              )}
                              {!r.si_number && !r.dr_number && !r.po_number && r.invoice_dr_number && (
                                <span className="px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-bold">
                                  Doc: {r.invoice_dr_number}
                                </span>
                              )}
                            </div>
                          )}
                          {r.is_unpacked_manifest_item && (
                            <div className="mt-1">
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border border-purple-300 dark:border-purple-800 inline-flex items-center gap-0.5 shadow-2xs whitespace-nowrap">
                                <span>📦 Manifest Line #{(r.manifest_line_index || 0) + 1}{r.manifest_total_lines ? ` of ${r.manifest_total_lines}` : ''}</span>
                              </span>
                            </div>
                          )}
                          {isManifest && (
                            <div className="mt-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleManifestExpand(manifestKey);
                                }}
                                className={`px-2 py-0.5 rounded text-[9.5px] font-black uppercase tracking-wider inline-flex items-center gap-1 shadow-2xs cursor-pointer whitespace-nowrap ${
                                  isManifestExpanded
                                    ? 'bg-purple-600 text-white border border-purple-700'
                                    : 'bg-purple-100 hover:bg-purple-200 dark:bg-purple-950/70 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-800'
                                }`}
                                title={isManifestExpanded ? "Collapse Manifest Items" : "Expand Manifest Items"}
                              >
                                <span>📦 Manifest ({manifestChildren.length})</span>
                                <ChevronDown className={`w-3 h-3 transform transition-transform ${isManifestExpanded ? 'rotate-180' : ''}`} />
                              </button>
                            </div>
                          )}
                          {(() => {
                            const claimId = outcome.claimNumber || existingClaim?.claimNumber || existingClaim?.claim_number;
                            const batchReports = findConsolidatedRtvBatchReports(r, reportsList);
                            const pickupListedCount = Array.isArray(r.ai_document_metadata?.supplier_pickup?.consolidated_rma_numbers)
                              ? r.ai_document_metadata.supplier_pickup.consolidated_rma_numbers.length
                              : 0;
                            const mapCount = claimId && claimBatchMap.has(claimId) ? claimBatchMap.get(claimId).size : 0;
                            const batchCount = Math.max(batchReports.length, pickupListedCount, mapCount);
                            if (!claimId && batchCount <= 1) return null;
                            return (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {batchCount > 1 ? (
                                  <span
                                    className="px-1.5 py-0.5 rounded text-[9px] font-mono font-black bg-indigo-100 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-200 border border-indigo-300 dark:border-indigo-700 inline-flex items-center gap-0.5 shadow-2xs"
                                    title={`Consolidated Batch Claim${claimId ? ` ${claimId}` : ''} (${batchCount} RMAs)`}
                                  >
                                    <span>🔗 Batch Claim: {claimId || 'Consolidated'} ({batchCount} RMAs)</span>
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 inline-flex items-center gap-0.5 shadow-2xs" title={`Claim Reference: ${claimId}`}>
                                    <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" />
                                    <span>{claimId}</span>
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </td>

                        {/* Vendor / Supplier & Warehouse Bin */}
                        <td className="py-2 px-1 max-w-[112px]" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className={`font-bold truncate max-w-[106px] ${isPlaceholderSupplier(res.supplier) ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-slate-200'}`} title={res.supplier}>
                              {res.supplier}
                            </span>
                            {(isPlaceholderSupplier(res.supplier) || wf.party.toEmails.length === 0) ? (
                              <button
                                type="button"
                                onClick={() => setFollowUpModalReport(r)}
                                className="px-1.5 py-0.5 rounded-lg bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/70 dark:hover:bg-amber-900 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700 text-[9px] font-black cursor-pointer text-left leading-tight"
                                title="Set Supplier Name and Follow-Up Emails (TO/CC)"
                              >
                                + Set Supplier &amp; Email
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setFollowUpModalReport(r)}
                                className="px-1.5 py-0.2 rounded-md bg-slate-100 hover:bg-indigo-50 dark:bg-slate-800 dark:hover:bg-indigo-950/60 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-[9px] font-mono cursor-pointer truncate max-w-[106px]"
                                title={`Edit Supplier Email (${wf.party.toEmails[0]})`}
                              >
                                📧 {wf.party.toEmails[0]}
                              </button>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate" title={normalizeWarehouseLocation(r.warehouse_location, r)}>
                            <span className="text-slate-600 dark:text-slate-300 font-semibold">{normalizeWarehouseLocation(r.warehouse_location, r)}</span>
                            {r.batch_lot_number && (
                              <span className="text-purple-600 dark:text-purple-400 font-bold ml-1.5">• Lot: {r.batch_lot_number}</span>
                            )}
                          </div>
                        </td>

                        {/* Product Description & SKU (Clean: No duplicate Qty info) */}
                        <td className="py-2 px-1 max-w-[122px]">
                          <div className="font-bold text-slate-900 dark:text-white truncate" title={res.name}>
                            {res.name}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                            {isManifest ? (
                              <span className="inline-flex items-center gap-1 flex-wrap">
                                <span className="px-1.5 py-0.2 rounded bg-purple-50 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 font-bold text-[9.5px] border border-purple-200 dark:border-purple-800">
                                  📦 Manifest ({manifestChildren.length})
                                </span>
                              </span>
                            ) : (
                              <div className="flex flex-col gap-0.5">
                                <span>
                                  SKU: <strong className={res.code ? 'text-slate-600 dark:text-slate-300' : 'text-amber-600 dark:text-amber-400'}>{res.code || 'Unassigned'}</strong>
                                </span>
                                {(isUnlabeledBarcode(r.barcode) || r.ai_document_metadata?.is_unlabeled) ? (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 font-bold text-[9px] border border-amber-300 dark:border-amber-700 w-fit">
                                    🏷️ Missing Barcode
                                  </span>
                                ) : (
                                  <span className="truncate">BC: {r.barcode}</span>
                                )}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Disposition, Reorder Status & SLA Countdown */}
                        <td className="py-2 px-1 w-[124px] max-w-[124px]">
                          <div className="space-y-1">
                            <span className={`px-1.5 py-0.5 rounded-lg text-[9.5px] font-extrabold border inline-block leading-tight shadow-2xs ${outcome.badgeColor}`}>
                              {outcome.label}
                            </span>
                            {(() => {
                              const reorderInfo = resolveReorderStatus(r);
                              return (
                                <div>
                                  <span
                                    className={`px-1.5 py-0.5 rounded-md text-[9.5px] font-extrabold border inline-flex flex-wrap items-center gap-0.5 leading-tight ${reorderInfo.badgeColor}`}
                                    title={reorderInfo.isReordered
                                      ? `Reordered${reorderInfo.formattedTime ? ` on ${reorderInfo.formattedTime}` : ''}${reorderInfo.poNumber ? ` • PO #${reorderInfo.poNumber}` : ''}${reorderInfo.reorderedBy ? ` by ${reorderInfo.reorderedBy}` : ''}`
                                      : 'Replacement PO not yet ordered'}
                                  >
                                    <span>{reorderInfo.isReordered ? '✓ Reordered' : 'Reorder: Pending'}</span>
                                    {reorderInfo.poNumber && <span className="font-mono">({reorderInfo.poNumber})</span>}
                                  </span>
                                </div>
                              );
                            })()}
                            {wf.isCountdownActive && !wf.isClosed && (
                              <div className="text-[10px] font-mono font-bold text-amber-700 dark:text-amber-300">
                                {wf.step2.text}
                              </div>
                            )}
                            {outcome.choiceKey === 'scrap' && (
                              <div className="text-[9.5px] font-bold text-slate-600 dark:text-slate-300">
                                {getItemNeedsReorder(r) ? '🛒 Re-Order: YES' : '❌ No Re-Order'}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Dedicated Defect Reason & Reporter Note Column */}
                        <td className="py-2 px-1 max-w-[100px]">
                          <div className="space-y-1">
                            {r.reason && (
                              <span
                                className="px-1.5 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-[9.5px] font-bold inline-block truncate max-w-[94px]"
                                title={r.reason}
                              >
                                {r.reason}
                              </span>
                            )}
                            {(() => {
                              const rawNote = String(
                                r.explanation ||
                                r.notes ||
                                (!isManifest && r.items?.[0]?.explanation ? r.items[0].explanation : '') ||
                                ''
                              ).trim();
                              const cleanNote = cleanExplanationText(rawNote);
                              if (!cleanNote) return null;
                              return (
                                <div className="flex items-center gap-1 max-w-[94px]" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={() => onViewExplanation && onViewExplanation({
                                      rmaNumber: r.rma_number,
                                      productName: res.name,
                                      reason: r.reason || 'Damaged',
                                      explanation: cleanNote,
                                      reporter: r.reporter_name || r.reported_by || 'Staff'
                                    })}
                                    className="group text-left flex items-center gap-1 px-1 py-0.5 rounded-md bg-slate-100/90 hover:bg-amber-50 dark:bg-slate-800/80 dark:hover:bg-amber-950/60 border border-slate-200 dark:border-slate-700 hover:border-amber-300 dark:hover:border-amber-700 transition-colors cursor-pointer max-w-full"
                                    title="Click to read full reporter explanation"
                                  >
                                    <span className="text-[10px] text-slate-600 dark:text-slate-300 italic truncate max-w-[54px]">
                                      &ldquo;{cleanNote}&rdquo;
                                    </span>
                                    <span className="text-[9px] font-black text-amber-600 dark:text-amber-400 shrink-0 group-hover:underline">
                                      Read
                                    </span>
                                  </button>
                                </div>
                              );
                            })()}
                          </div>
                        </td>

                        {/* Qty & Unit */}
                        <td className="py-2 px-1 text-right whitespace-nowrap font-mono">
                          <span className="px-1.5 py-0.5 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200/80 dark:border-amber-800 font-black text-amber-900 dark:text-amber-200 text-[11px] inline-flex items-center gap-1 shadow-2xs">
                            <span>
                              {isManifest
                                ? formatManifestBreakdown(manifestChildren, false)
                                : formatQuantityWithPackSize(res.qty, r.unit_name, r.pieces_per_case || res.matchedProduct?.pieces_per_case)}
                            </span>
                          </span>
                        </td>

                        {/* Total Claim + Subtle Unit Price */}
                        <td className="py-2 px-1 text-right whitespace-nowrap font-mono text-[11px]">
                          <div className={`font-black text-amber-700 dark:text-amber-400 ${res.total <= 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                            ₱{res.total.toFixed(2)}
                          </div>
                          {!isManifest && (
                            <div className={`text-[9.5px] ${res.price <= 0 ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-slate-400'}`}>
                              @ ₱{res.price.toFixed(2)}
                            </div>
                          )}
                        </td>

                        {/* Actions Column: 4-Choice / Pickup, Form, Split Qty / Details, Assign SKU, Coworker Queue, Archive, Delete */}
                        <td className="py-2 px-1 text-center w-[124px]" onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-col items-stretch gap-1 w-[116px] mx-auto">

                            {/* 1. Simple 4-Choice Supplier RTV & Pickup Verification Wizard */}
                            {onOpenSimpleWizard && (
                              <button
                                type="button"
                                onClick={() => {
                                  const batchGroup = findConsolidatedRtvBatchReports(r, reportsList);
                                  onOpenSimpleWizard(batchGroup.length > 1 ? batchGroup : r);
                                }}
                                className={`w-full px-1.5 py-1 rounded-lg text-[9.5px] font-black leading-tight text-center transition-colors cursor-pointer border ${
                                  outcome.hasDecision
                                    ? 'bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/70 text-indigo-800 dark:text-indigo-200 border-indigo-200 dark:border-indigo-700'
                                    : 'bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 shadow-2xs'
                                }`}
                                title={outcome.hasDecision ? 'Edit saved 4-Choice decision, claim details, or driver pickup photos' : 'Open 4-Choice / Driver Pickup Verification Wizard'}
                              >
                                {outcome.hasDecision ? '✏️ Edit Claim / 4-Choice' : '⚡ 4-Choice / Pickup'}
                              </button>
                            )}

                            {/* 1B. Daily 10-Day Pickup Follow-Up Case Close Control */}
                            {!wf.isClosed && (
                              <button
                                type="button"
                                disabled={updatingQueueId === (r.id || r.rma_number)}
                                onClick={() => handleRowCloseCase(r)}
                                className="w-full px-1.5 py-1 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/70 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700 rounded-lg text-[9.5px] font-black leading-tight flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                                title="Mark Picked Up & Close 4-Step Workflow Case (stops 10-day countdown)"
                              >
                                <span>✓ Case Close</span>
                              </button>
                            )}

                            {/* 2. View / Print Debit Claim or Replacement Form when generated */}
                            {onOpenPickupForm && (outcome.formType || r.status === 'picked_up' || r.ai_document_metadata?.supplier_pickup?.picked_up_at) && (
                              <button
                                type="button"
                                onClick={() => {
                                  const batchGroup = findConsolidatedRtvBatchReports(r, reportsList);
                                  onOpenPickupForm(batchGroup.length > 1 ? batchGroup : r);
                                }}
                                className="w-full px-1.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[9.5px] font-black leading-tight flex items-center justify-center gap-1 transition-colors cursor-pointer text-center shadow-2xs"
                                title={outcome.formType === 'replacement' ? 'View / Re-print Dual-Copy Replacement Form' : 'View / Re-print Dual-Copy Debit Claim Form'}
                              >
                                <span>{outcome.formType === 'replacement' ? '📄 Replacement Form' : '📄 Debit Claim Form'}</span>
                              </button>
                            )}

                            {/* 3. Split Qty / Details (Opens streamlined QuickRMAActionModal) */}
                            {onOpenQuickAction && (
                              <button
                                type="button"
                                onClick={() => onOpenQuickAction(r.rma_number)}
                                className="w-full px-1.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-lg text-[9.5px] font-bold leading-tight flex items-center justify-center gap-1 transition-all cursor-pointer shadow-2xs"
                                title={!isManifest && Number(res.qty) > 1 ? `Split Qty or edit details for ${r.rma_number}` : `View details, documents, or audit trail for ${r.rma_number}`}
                              >
                                <span>{!isManifest && Number(res.qty) > 1 ? '✂️ Split Qty' : '📋 Details'}</span>
                              </button>
                            )}

                            {/* 4. Assign SKU (for single items if unassigned) */}
                            {!isManifest && res.isUnassigned && (onAssignSku || onEditProductFromReport) && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (onAssignSku) onAssignSku(r);
                                  else if (onEditProductFromReport) onEditProductFromReport(r);
                                }}
                                className="w-full px-1.5 py-1 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/70 dark:hover:bg-blue-900/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg text-[9.5px] font-bold leading-tight flex items-center justify-center gap-1 transition-all cursor-pointer shadow-2xs"
                                title={`Assign official SKU, pricing, and master vendor for "${res.name || r.barcode}"`}
                              >
                                <Package className="w-3 h-3 text-blue-600 dark:text-blue-400 shrink-0" />
                                <span>Assign SKU</span>
                              </button>
                            )}

                            {/* 1-Click Ready to Restock Action */}
                            {isItemReadyToRestock(r) && (
                              <button
                                type="button"
                                disabled={updatingQueueId === (r.id || r.rma_number)}
                                onClick={() => handleConfirmCoworkerAction(r, 'restocked')}
                                className="w-full px-1.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-500 rounded-lg text-[9.5px] font-black leading-tight flex items-center justify-center gap-1 transition-all cursor-pointer shadow-2xs disabled:opacity-50"
                                title="1-click confirm that this item has been stocked in WMS (updates status to 6- Restocked)"
                              >
                                <span>✓ Confirm Restocked in WMS</span>
                              </button>
                            )}

                            {/* 1-Click Mark Reordered Action (Independent of 4-Choice Outcome & 10-Day SLA) */}
                            {!resolveReorderStatus(r).isReordered && !['rejected', 'deleted', 'trashed'].includes(String(r.status || '').toLowerCase()) && (
                              <button
                                type="button"
                                disabled={updatingQueueId === (r.id || r.rma_number)}
                                onClick={() => handleMarkReordered(r, 'reordered')}
                                className="w-full px-1.5 py-1 bg-amber-600 hover:bg-amber-700 text-white border border-amber-500 rounded-lg text-[9.5px] font-black leading-tight flex items-center justify-center gap-1 transition-all cursor-pointer shadow-2xs disabled:opacity-50"
                                title="Mark replacement PO as Reordered (keeps 4-Choice Outcome & 10-Day SLA unchanged)"
                              >
                                <span>🔄 Mark Reordered</span>
                              </button>
                            )}

                            {/* 1-Click Scrapped — No Re-Order Action */}
                            {isItemScrappedNoReorder(r) && (
                              <button
                                type="button"
                                disabled={updatingQueueId === (r.id || r.rma_number)}
                                onClick={() => handleConfirmCoworkerAction(r, 'scrapped')}
                                className="w-full px-1.5 py-1 bg-rose-600 hover:bg-rose-700 text-white border border-rose-500 rounded-lg text-[9.5px] font-black leading-tight flex items-center justify-center gap-1 transition-all cursor-pointer shadow-2xs disabled:opacity-50"
                                title="1-click confirm that this total loss is written off without re-ordering"
                              >
                                <span>✓ Confirm Written Off</span>
                              </button>
                            )}

                            {/* Release Hold Action */}
                            {isItemOnHold(r) && (
                              <button
                                type="button"
                                onClick={() => onOpenQuickAction && onOpenQuickAction(r.rma_number)}
                                className="w-full px-1.5 py-1 bg-amber-500 hover:bg-amber-600 text-white border border-amber-600 rounded-lg text-[9.5px] font-black leading-tight flex items-center justify-center gap-1 transition-all cursor-pointer shadow-2xs"
                                title="Release hold and re-triage to Restock, RTV, or Scrap"
                              >
                                <Unlock className="w-3 h-3 shrink-0" />
                                <span>Release Hold</span>
                              </button>
                            )}

                            {/* Rejected Badge */}
                            {isItemRejected(r) && (
                              <span className="px-1.5 py-0.5 rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-extrabold text-[9.5px] border border-slate-300 dark:border-slate-700 text-center">
                                🚫 Claim Rejected
                              </span>
                            )}

                            {/* Re-open / Reset to Pending Action */}
                            {Boolean(outcome.hasDecision || String(r.status || 'pending').toLowerCase() !== 'pending' || r.ai_document_metadata?.follow_up?.case_closed_at) && (
                              <button
                                type="button"
                                disabled={updatingQueueId === (r.id || r.rma_number)}
                                onClick={async () => {
                                  if (onResetToPending) {
                                    await onResetToPending(r);
                                    return;
                                  }
                                  try {
                                    setUpdatingQueueId(r.id || r.rma_number);
                                    await catalogService.resetReportToPending(r.id, r.rma_number, currentUser?.name || 'Staff');
                                    if (onRefresh) onRefresh();
                                  } catch (e) {
                                    alert('Could not reset report: ' + e.message);
                                  } finally {
                                    setUpdatingQueueId(null);
                                  }
                                }}
                                className="w-full px-1.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg text-[9.5px] font-bold leading-tight flex items-center justify-center gap-1 transition-all cursor-pointer shadow-2xs"
                                title="Re-open this item and reset to pending so coworker queues can test restocking/reordering again"
                              >
                                <RotateCcw className="w-3 h-3 text-slate-500 shrink-0" />
                                <span>Reset to Pending</span>
                              </button>
                            )}

                            {/* 5. Archive & 6. Delete Icon Row */}
                            {(effectiveArchiveReport || (canDeleteReports && onRequestDeleteReport)) && (
                              <div className="flex items-center justify-center gap-1 pt-0.5">
                                {effectiveArchiveReport && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const targetArchiveId = r.is_unpacked_manifest_item ? (r.parent_rma_id || r.id) : r.id;
                                      effectiveArchiveReport(targetArchiveId, r.rma_number, r);
                                    }}
                                    className="p-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                    title={`Archive RMA #${r.rma_number} to Archive Vault`}
                                  >
                                    <span className="text-xs">🗄️</span>
                                  </button>
                                )}

                                {canDeleteReports && onRequestDeleteReport && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const targetDeleteId = r.is_unpacked_manifest_item ? (r.parent_rma_id || r.id) : r.id;
                                      onRequestDeleteReport(targetDeleteId, r.rma_number, r);
                                    }}
                                    className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors cursor-pointer"
                                    title={`Delete RMA #${r.rma_number} and remove stored proof photos`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expandable Multi-Item Manifest Sub-Table Drawer */}
                      {isManifest && isManifestExpanded && (
                        <tr className="bg-amber-50/40 dark:bg-slate-900/90 border-y-2 border-amber-200 dark:border-amber-900/60">
                          <td colSpan={11} className="p-3 sm:p-4">
                            <div className="bg-white dark:bg-slate-800/90 rounded-xl border border-amber-200 dark:border-amber-800/60 shadow-sm overflow-hidden">
                              {/* Manifest Header */}
                              <div className="p-3 bg-amber-50/70 dark:bg-amber-950/40 border-b border-amber-200/80 dark:border-amber-900/50 flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="p-1 rounded-md bg-amber-600 text-white">
                                    <Package className="w-3.5 h-3.5" />
                                  </span>
                                  <span className="font-extrabold text-xs text-amber-900 dark:text-amber-200 uppercase tracking-wider">
                                    Supplier RTV Manifest Items ({manifestChildren.length})
                                  </span>
                                  <span className="text-[11px] text-amber-700 dark:text-amber-300 font-mono">
                                    RMA: {r.rma_number}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                    Total manifest breakdown: <strong className="text-slate-900 dark:text-white font-bold">{formatManifestBreakdown(manifestChildren, true)}</strong>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => toggleManifestExpand(manifestKey)}
                                    className="text-xs text-amber-700 dark:text-amber-300 hover:text-amber-900 font-bold px-2 py-0.5 rounded hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors cursor-pointer"
                                  >
                                    Collapse ▲
                                  </button>
                                </div>
                              </div>

                              {/* Child Items Table */}
                              <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs border-collapse">
                                  <thead>
                                    <tr className="bg-slate-50/80 dark:bg-slate-800/50 text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                      <th className="py-2 px-2 text-center w-12">#</th>
                                      <th className="py-2 px-3">Product Description / Name</th>
                                      <th className="py-2 px-3 font-mono">Barcode</th>
                                      <th className="py-2 px-3 font-mono">Assigned SKU</th>
                                      <th className="py-2 px-3 text-right">Qty &amp; Unit</th>
                                      <th className="py-2 px-3 text-right">Unit Price</th>
                                      <th className="py-2 px-3 text-right">Total Claim</th>
                                      <th className="py-2 px-3">Triage &amp; Reason</th>
                                      <th className="py-2 px-2 text-center">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                                    {manifestChildren.map((child, cIdx) => {
                                      const childBarcode = String(child.barcode || '').trim();
                                      const matchedChild = childBarcode ? savedProductsList.find(p => p.barcode && String(p.barcode).trim() === childBarcode) : null;
                                      const childName = (child.name || child.productName || matchedChild?.name || `Item #${cIdx + 1}`).trim();
                                      const childRawSku = String(child.code || child.sku || matchedChild?.code || matchedChild?.sku || '').trim();
                                      const isChildSkuValid = Boolean(childRawSku && childRawSku !== childBarcode && !childRawSku.toLowerCase().includes('awaiting'));
                                      const childQty = Number(child.quantity || child.qty) || 1;
                                      const childUnit = child.unit_name || child.unit || r.unit_name || 'pc';
                                      const childPrice = Number(child.price_with_vat || child.price || matchedChild?.price_with_vat || matchedChild?.price || 0);
                                      const childTotal = childQty * childPrice;
                                      const childDisp = child.disposition || r.disposition || '1 - Pending Vendor Pickup';

                                      const childReportItem = {
                                        ...child,
                                        id: child.id || `${r.id || r.rma_number}_item_${childBarcode || cIdx}`,
                                        rma_number: r.rma_number,
                                        barcode: childBarcode,
                                        code: isChildSkuValid ? childRawSku : null,
                                        sku: isChildSkuValid ? childRawSku : null,
                                        name: childName,
                                        quantity: childQty,
                                        unit_name: childUnit,
                                        price: childPrice,
                                        price_with_vat: childPrice,
                                        supplier_name: child.supplier_name || r.supplier_name || 'Savemore',
                                        parent_rma_id: r.id
                                      };

                                      return (
                                        <tr key={childReportItem.id || cIdx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                          <td className="py-2 px-2 text-center font-mono font-bold text-slate-400">
                                            #{cIdx + 1}
                                          </td>
                                          <td className="py-2 px-3 font-bold text-slate-900 dark:text-white truncate max-w-xs" title={childName}>
                                            <div className="truncate">{childName}</div>
                                            {child.supplier_name && (
                                              <div className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold truncate" title={`Supplier: ${child.supplier_name}`}>
                                                Supplier: {child.supplier_name}
                                              </div>
                                            )}
                                          </td>
                                          <td className="py-2 px-3 font-mono text-slate-700 dark:text-slate-300 font-bold">
                                            {childBarcode || '—'}
                                          </td>
                                          <td className="py-2 px-3 font-mono">
                                            {isChildSkuValid ? (
                                              <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800 text-[11px]">
                                                {childRawSku}
                                              </span>
                                            ) : (
                                              <span className="text-amber-600 dark:text-amber-400 font-semibold text-[10px]">
                                                Awaiting SKU
                                              </span>
                                            )}
                                          </td>
                                          <td className="py-2 px-3 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                                            {formatQuantityWithPackSize(childQty, childUnit, child.pieces_per_case || matchedChild?.pieces_per_case)}
                                          </td>
                                          <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                                            ₱{childPrice.toFixed(2)}
                                          </td>
                                          <td className="py-2 px-3 text-right font-mono font-bold text-amber-700 dark:text-amber-400">
                                            ₱{childTotal.toFixed(2)}
                                          </td>
                                          <td className="py-2 px-3">
                                            {(() => {
                                              const childOutcome = formatFourChoiceOutcome(child);
                                              return (
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border inline-block ${childOutcome.badgeColor}`}>
                                                  {childOutcome.label}
                                                </span>
                                              );
                                            })()}
                                          </td>
                                          <td className="py-2 px-2 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                              {!isChildSkuValid && onAssignSku && (
                                                <button
                                                  type="button"
                                                  onClick={() => onAssignSku(childReportItem)}
                                                  className="px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300 rounded text-[10px] font-bold border border-blue-200 dark:border-blue-800 cursor-pointer"
                                                  title="Assign SKU"
                                                >
                                                  Assign SKU
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
          ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {paginatedCandidates.map((r, idx) => {
              const id = r.id || r.rma_number;
              const isSelected = selectedRmaIds.has(id);
              const res = resolveReportProduct(r);
              const photos = getPhotos(r);
              const existingClaim = getClaimForReport(r);
              const outcome = formatFourChoiceOutcome(r);
              const statusInfo = getCleanHumanWorkflowStatus(r, savedProductsList, {
                customerFollowUpDefaultEnabled: followUpConfig.customerFollowUpDefaultEnabled,
                testStepIntervalSeconds: isTestMode ? followUpConfig.testStepIntervalSeconds : 0
              });
              const wf = statusInfo.workflow;
              const isManifest = !r.is_unpacked_manifest_item && isBatchManifest(r, reportsList);
              const manifestChildren = isManifest ? getReportManifestItems(r, reportsList) : [];
              const manifestKey = r.id || r.rma_number;
              const isManifestExpanded = expandedManifestIds.has(manifestKey);
              const reorderInfo = resolveReorderStatus(r);
              const mapUrl = getGpsMapUrl(r);
              const gpsAddr = getGpsAddressDisplay(r);

              return (
                <div
                  key={`mob-${manifestKey}`}
                  onClick={(e) => {
                    if (e.target.closest('input, button, a')) return;
                    if (onOpenQuickAction) onOpenQuickAction(r.rma_number);
                  }}
                  className={`p-3.5 space-y-2.5 transition-colors cursor-pointer ${isSelected ? 'bg-amber-50/80 dark:bg-amber-950/40' : ''}`}
                >
                  {/* Card Top Row: Checkbox + SN + RMA# + QR + Claim Total */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center flex-wrap gap-1.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelect(id)}
                        className="rounded-md border-slate-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                      />
                      <span className="font-mono font-black text-amber-900 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded-lg text-[10.5px]">
                        #{(currentPage - 1) * pageSize + idx + 1}
                      </span>
                      <span className="font-mono font-black text-xs text-slate-900 dark:text-white">
                        {r.rma_number}
                      </span>
                      {onViewQR && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onViewQR({
                              ...r,
                              name: res.name,
                              supplier_name: res.supplier,
                              code: res.code || r.code,
                              price: res.price || r.price
                            });
                          }}
                          className="p-1 text-slate-400 hover:text-amber-600 rounded-md"
                          title={`Print Box QR for ${r.rma_number}`}
                        >
                          <QrCode className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="text-right font-mono shrink-0">
                      <div className="text-xs font-black text-amber-700 dark:text-amber-400">₱{res.total.toFixed(2)}</div>
                      <div className="text-[10px] text-slate-500 font-bold">
                        {isManifest ? formatManifestBreakdown(manifestChildren, false) : formatQuantityWithPackSize(res.qty, r.unit_name, r.pieces_per_case || res.matchedProduct?.pieces_per_case)}
                      </div>
                    </div>
                  </div>

                  {/* Product + Thumbnail + Supplier */}
                  <div className="flex items-start gap-2.5 min-w-0">
                    {photos.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => handleOpenPhotoPreview(r)}
                        className="relative w-11 h-11 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 shrink-0"
                      >
                        <img
                          src={photos[0]}
                          alt="Proof"
                          onError={(e) => {
                            if (!e.currentTarget.dataset.err) {
                              e.currentTarget.dataset.err = '1';
                              e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='1.75'%3E%3Crect width='18' height='18' x='3' y='3' rx='2'/%3E%3Ccircle cx='9' cy='9' r='2'/%3E%3Cpath d='m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21'/%3E%3C/svg%3E";
                            }
                          }}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ) : (
                      <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center border border-slate-200 dark:border-slate-700 shrink-0">
                        <ImageIcon className="w-4 h-4" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="font-bold text-xs text-slate-900 dark:text-white break-words">{res.name}</div>
                      <div className="flex items-center flex-wrap gap-1.5 text-[10px]">
                        <span className={`font-bold ${isPlaceholderSupplier(res.supplier) ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}`}>
                          {res.supplier}
                        </span>
                        <span className="text-slate-400 font-mono">
                          SKU: <strong className={res.code ? 'text-slate-600 dark:text-slate-300' : 'text-amber-600'}>{res.code || 'Unassigned'}</strong>
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 flex items-center flex-wrap gap-x-2 gap-y-0.5">
                        <span>{r.created_at ? formatDateYmd(r.created_at) : ''}</span>
                        <span>{normalizeWarehouseLocation(r.warehouse_location, r)}</span>
                        {mapUrl && (
                          <a href={mapUrl} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5">
                            <MapPin className="w-2.5 h-2.5 text-rose-500" />
                            <span>{gpsAddr || 'Map'}</span>
                          </a>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Badges & Status */}
                  <div className="flex items-center flex-wrap gap-1.5">
                    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold border leading-tight ${outcome.badgeColor}`}>
                      {outcome.label}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded-md text-[9.5px] font-extrabold border ${reorderInfo.badgeColor}`}>
                      {reorderInfo.isReordered ? '✓ Reordered' : 'Reorder: Pending'}
                      {reorderInfo.poNumber ? ` (${reorderInfo.poNumber})` : ''}
                    </span>
                    {wf.isCountdownActive && !wf.isClosed && (
                      <span className="text-[10px] font-mono font-bold text-amber-700 dark:text-amber-300">{wf.step2.text}</span>
                    )}
                    {r.reason && (
                      <span className="px-1.5 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-[9.5px] font-bold">
                        {r.reason}
                      </span>
                    )}
                    {isManifest && (
                      <button
                        type="button"
                        onClick={() => toggleManifestExpand(manifestKey)}
                        className="px-2 py-0.5 rounded text-[9.5px] font-black uppercase bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border border-purple-300 dark:border-purple-800 inline-flex items-center gap-1"
                      >
                        <span>📦 Manifest ({manifestChildren.length})</span>
                        <ChevronDown className={`w-3 h-3 transform transition-transform ${isManifestExpanded ? 'rotate-180' : ''}`} />
                      </button>
                    )}
                  </div>

                  {/* Mobile Actions */}
                  <div className="flex items-center flex-wrap gap-1.5 pt-1" onClick={(e) => e.stopPropagation()}>
                    {onOpenSimpleWizard && (
                      <button
                        type="button"
                        onClick={() => {
                          const batchGroup = findConsolidatedRtvBatchReports(r, reportsList);
                          onOpenSimpleWizard(batchGroup.length > 1 ? batchGroup : r);
                        }}
                        className={`px-2 py-1 rounded-lg text-[10px] font-black border ${
                          outcome.hasDecision
                            ? 'bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200 border-indigo-200 dark:border-indigo-700'
                            : 'bg-indigo-600 text-white border-indigo-600'
                        }`}
                      >
                        {outcome.hasDecision ? '✏️ Edit Claim / 4-Choice' : '⚡ 4-Choice / Pickup'}
                      </button>
                    )}
                    {!wf.isClosed && (
                      <button
                        type="button"
                        disabled={updatingQueueId === (r.id || r.rma_number)}
                        onClick={() => handleRowCloseCase(r)}
                        className="px-2 py-1 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700 rounded-lg text-[10px] font-black disabled:opacity-50"
                      >
                        ✓ Case Close
                      </button>
                    )}
                    {onOpenPickupForm && (outcome.formType || r.status === 'picked_up' || r.ai_document_metadata?.supplier_pickup?.picked_up_at) && (
                      <button
                        type="button"
                        onClick={() => {
                          const batchGroup = findConsolidatedRtvBatchReports(r, reportsList);
                          onOpenPickupForm(batchGroup.length > 1 ? batchGroup : r);
                        }}
                        className="px-2 py-1 bg-emerald-600 text-white rounded-lg text-[10px] font-black"
                      >
                        {outcome.formType === 'replacement' ? '📄 Replacement Form' : '📄 Debit Claim Form'}
                      </button>
                    )}
                    {onOpenQuickAction && (
                      <button
                        type="button"
                        onClick={() => onOpenQuickAction(r.rma_number)}
                        className="px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-lg text-[10px] font-bold"
                      >
                        {!isManifest && Number(res.qty) > 1 ? '✂️ Split Qty' : '📋 Details'}
                      </button>
                    )}
                    {!resolveReorderStatus(r).isReordered && !['rejected', 'deleted', 'trashed'].includes(String(r.status || '').toLowerCase()) && (
                      <button
                        type="button"
                        disabled={updatingQueueId === (r.id || r.rma_number)}
                        onClick={() => handleMarkReordered(r, 'reordered')}
                        className="px-2 py-1 bg-amber-600 text-white border border-amber-500 rounded-lg text-[10px] font-black disabled:opacity-50"
                      >
                        🔄 Mark Reordered
                      </button>
                    )}
                    {Boolean(outcome.hasDecision || String(r.status || 'pending').toLowerCase() !== 'pending' || r.ai_document_metadata?.follow_up?.case_closed_at) && (
                      <button
                        type="button"
                        disabled={updatingQueueId === (r.id || r.rma_number)}
                        onClick={async () => {
                          if (onResetToPending) {
                            await onResetToPending(r);
                            return;
                          }
                          try {
                            setUpdatingQueueId(r.id || r.rma_number);
                            await catalogService.resetReportToPending(r.id, r.rma_number, currentUser?.name || 'Staff');
                            if (onRefresh) onRefresh();
                          } catch (e) {
                            alert('Could not reset report: ' + e.message);
                          } finally {
                            setUpdatingQueueId(null);
                          }
                        }}
                        className="px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg text-[10px] font-bold flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3 text-slate-500" />
                        <span>Reset to Pending</span>
                      </button>
                    )}
                    {effectiveArchiveReport && (
                      <button
                        type="button"
                        onClick={() => {
                          const targetArchiveId = r.is_unpacked_manifest_item ? (r.parent_rma_id || r.id) : r.id;
                          effectiveArchiveReport(targetArchiveId, r.rma_number, r);
                        }}
                        className="p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                        title={`Archive RMA #${r.rma_number}`}
                      >
                        <span className="text-xs">🗄️</span>
                      </button>
                    )}
                    {canDeleteReports && onRequestDeleteReport && (
                      <button
                        type="button"
                        onClick={() => {
                          const targetDeleteId = r.is_unpacked_manifest_item ? (r.parent_rma_id || r.id) : r.id;
                          onRequestDeleteReport(targetDeleteId, r.rma_number, r);
                        }}
                        className="p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg"
                        title={`Delete RMA #${r.rma_number}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Mobile Expandable Manifest Items */}
                  {isManifest && isManifestExpanded && (
                    <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-900/50 space-y-1.5">
                      {manifestChildren.map((child, cIdx) => {
                        const childName = (child.name || child.productName || `Item #${cIdx + 1}`).trim();
                        const childQty = Number(child.quantity || child.qty) || 1;
                        const childUnit = child.unit_name || child.unit || r.unit_name || 'pc';
                        const childOutcome = formatFourChoiceOutcome(child);
                        return (
                          <div key={`mob-child-${cIdx}`} className="p-2 rounded-xl bg-amber-50/60 dark:bg-slate-800/70 border border-amber-200/70 dark:border-slate-700 text-[11px] space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-slate-900 dark:text-white break-words">#{cIdx + 1} {childName}</span>
                              <span className="font-mono font-bold text-amber-800 dark:text-amber-300 shrink-0">{childQty} {childUnit}</span>
                            </div>
                            <span className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold border inline-block ${childOutcome.badgeColor}`}>
                              {childOutcome.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          )
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

      {/* Supplier & Email Details Modal */}
      <SupplierFollowUpModal
        isOpen={Boolean(followUpModalReport)}
        onClose={() => setFollowUpModalReport(null)}
        report={followUpModalReport}
        catalogProducts={savedProductsList}
        isTestMode={isTestMode}
        currentUser={currentUser}
        onUpdated={() => {
          if (onRefresh) onRefresh();
          window.dispatchEvent(new CustomEvent('rma-data-changed', { detail: { type: 'followup-updated' } }));
        }}
      />

      {/* Persistent Supplier Emails Directory Modal */}
      <SupplierDirectoryModal
        isOpen={isDirectoryOpen}
        onClose={() => setIsDirectoryOpen(false)}
      />

    </div>
  );
}
