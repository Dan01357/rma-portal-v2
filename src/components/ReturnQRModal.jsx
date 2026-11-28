import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  X, Printer, QrCode, ShieldCheck, CheckCircle2, AlertTriangle,
  Download, Lock, Move, RotateCcw, ArrowRight, Maximize2, Layers, CopyCheck,
  Plus, Search
} from 'lucide-react';
import {
  PAPER_PRESETS,
  QR_SIZE_PRESETS,
  normalizeRmaQrCardData,
  packQrCardsIntoPages,
  autoFitGridCardSize,
  downloadCustomSizedStickerPng,
  downloadConsolidatedQrPagesPng
} from '../utils/customStickerCanvas';
import { printIsolatedElement } from '../utils/printIsolatedElement';
import {
  buildPortalQrPayload,
  formatSaveFileTimestamp,
  getReportManifestItems,
  resolveBatchManifestForQr,
  sumManifestQuantity,
  isRealSupplierName,
  isMixedSuppliersSummary,
  isTestRecord,
  isTrashedRecord
} from '../utils/rmaHelpers';
import { supabase } from '../supabaseClient';

const clampNum = (val, min, max, fallback) => {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

export default function ReturnQRModal({
  isOpen,
  onClose,
  report,
  reports = [],
  availableReports = [],
  lookupReports = [],
  sessionReports = [],
  onOpenQuickAction
}) {
  // Base initial entries passed into the modal (used for reset signature ONLY, excluding picker additions).
  // Deduplicates by RMA key while preferring richer parent/manifest objects over unpacked child shells.
  const baseEntries = useMemo(() => {
    const rawList = Array.isArray(reports) && reports.length > 0
      ? reports
      : report
        ? [report]
        : [];
    const indexByUpperKey = new Map();
    const deduped = [];
    rawList.forEach((item, idx) => {
      if (!item || typeof item !== 'object') return;
      const key = String(item.rma_number || item.rmaNumber || item.id || `row-${idx}`).trim();
      const upperKey = key.toUpperCase();
      if (!key) return;
      if (!indexByUpperKey.has(upperKey)) {
        indexByUpperKey.set(upperKey, deduped.length);
        deduped.push({ key, report: item });
        return;
      }
      const existingIdx = indexByUpperKey.get(upperKey);
      const prevRep = deduped[existingIdx].report;
      const prevScore = (prevRep?.is_parent ? 10 : 0) + (Array.isArray(prevRep?.items) ? prevRep.items.length : 0);
      const nextScore = (item?.is_parent ? 10 : 0) + (Array.isArray(item?.items) ? item.items.length : 0);
      if (nextScore > prevScore) {
        deduped[existingIdx] = {
          key: deduped[existingIdx].key,
          report: {
            ...item,
            ...(Array.isArray(prevRep?.manifest_items) && !item.manifest_items ? { manifest_items: prevRep.manifest_items } : {})
          }
        };
      }
    });
    return deduped;
  }, [reports, report]);

  const batchSignature = useMemo(
    () => baseEntries.map((entry) => entry.key).join('|'),
    [baseEntries]
  );

  // ALL state hooks strictly declared BEFORE any conditional return (prevents React Error #310)
  const [removedKeys, setRemovedKeys] = useState(() => new Set());
  const [extraReports, setExtraReports] = useState([]);
  const [hydratedPoolRows, setHydratedPoolRows] = useState([]);
  const [isAddPickerOpen, setIsAddPickerOpen] = useState(false);
  const [addSearchQuery, setAddSearchQuery] = useState('');
  const [paperPresetId, setPaperPresetId] = useState('letter');
  const [customPaperMm, setCustomPaperMm] = useState({ widthMm: 215.9, heightMm: 279.4 });
  const [orientation, setOrientation] = useState('portrait');
  const [marginMm, setMarginMm] = useState(8);
  const [layoutMode, setLayoutMode] = useState('one_page');
  const [qrSplitMode, setQrSplitMode] = useState('consolidated'); // 'consolidated' | 'per_item'
  const [sizesByKey, setSizesByKey] = useState({});
  const [activeKey, setActiveKey] = useState(null);

  const [downloadingType, setDownloadingType] = useState(null);
  const [downloadNotice, setDownloadNotice] = useState(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [canvasContainerWidth, setCanvasContainerWidth] = useState(() => (
    typeof window !== 'undefined' ? Math.min(820, window.innerWidth - 40) : 720
  ));

  const dragStateRef = useRef(null);
  const canvasAreaRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const measure = () => {
      const el = canvasAreaRef.current;
      if (el && el.clientWidth > 0) {
        setCanvasContainerWidth(el.clientWidth);
      } else if (typeof window !== 'undefined') {
        setCanvasContainerWidth(Math.min(820, window.innerWidth - 40));
      }
    };
    measure();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && canvasAreaRef.current) {
      ro = new ResizeObserver(measure);
      ro.observe(canvasAreaRef.current);
    }
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isOpen]);

  // Reset per-batch ephemeral state when opening or switching batch selection
  useEffect(() => {
    if (!isOpen) return;
    setRemovedKeys(new Set());
    setExtraReports([]);
    setHydratedPoolRows([]);
    setIsAddPickerOpen(false);
    setAddSearchQuery('');
    setSizesByKey({});
    setActiveKey(baseEntries[0]?.key || null);
    setDownloadNotice(null);
    setLayoutMode('one_page');
    setQrSplitMode('consolidated');
  }, [isOpen, batchSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const modalIsTestScope = useMemo(
    () => (baseEntries[0]?.report ? isTestRecord(baseEntries[0].report) : false),
    [baseEntries]
  );

  const inputReports = useMemo(() => {
    const merged = [...baseEntries];
    const seen = new Set(baseEntries.map((e) => e.key.toUpperCase()));
    extraReports.forEach((item, idx) => {
      if (!item || typeof item !== 'object') return;
      if (isTrashedRecord(item)) return;
      if (Boolean(isTestRecord(item)) !== Boolean(modalIsTestScope)) return;
      const key = String(item.rma_number || item.rmaNumber || item.id || `extra-${idx}`).trim();
      if (!key || seen.has(key.toUpperCase())) return;
      seen.add(key.toUpperCase());
      merged.push({ key, report: item });
    });
    return merged;
  }, [baseEntries, extraReports, modalIsTestScope]);

  const visibleEntries = useMemo(
    () => inputReports.filter((entry) => !removedKeys.has(entry.key)),
    [inputReports, removedKeys]
  );

  const visibleRmaKeysSet = useMemo(
    () => new Set(visibleEntries.map((e) => e.key.toUpperCase())),
    [visibleEntries]
  );

  const scopedSessionMissing = useMemo(() => {
    const list = Array.isArray(sessionReports) ? sessionReports : [];
    const seen = new Set();
    return list.filter((r) => {
      if (!r || isTrashedRecord(r)) return false;
      if (Boolean(isTestRecord(r)) !== Boolean(modalIsTestScope)) return false;
      const key = String(r.rma_number || r.rmaNumber || r.id || '').trim().toUpperCase();
      if (!key || visibleRmaKeysSet.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [sessionReports, modalIsTestScope, visibleRmaKeysSet]);

  const addableCandidates = useMemo(() => {
    const pool = [...(Array.isArray(sessionReports) ? sessionReports : []), ...(Array.isArray(availableReports) ? availableReports : [])];
    const seen = new Set();
    const q = addSearchQuery.trim().toLowerCase();
    const out = [];
    for (const r of pool) {
      if (!r || isTrashedRecord(r)) continue;
      if (Boolean(isTestRecord(r)) !== Boolean(modalIsTestScope)) continue;
      const key = String(r.rma_number || r.rmaNumber || r.id || '').trim();
      const upperKey = key.toUpperCase();
      if (!key || visibleRmaKeysSet.has(upperKey) || seen.has(upperKey)) continue;
      seen.add(upperKey);
      if (q) {
        const hay = `${key} ${r.name || r.productName || ''} ${r.code || r.sku || ''} ${r.barcode || ''} ${r.store_branch || ''} ${r.supplier_name || ''}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      out.push(r);
      if (out.length >= 25) break;
    }
    return out;
  }, [sessionReports, availableReports, modalIsTestScope, visibleRmaKeysSet, addSearchQuery]);

  const manifestLookupPool = useMemo(() => {
    const merged = [
      ...(Array.isArray(sessionReports) ? sessionReports : []),
      ...(Array.isArray(lookupReports) ? lookupReports : []),
      ...(Array.isArray(availableReports) ? availableReports : []),
      ...(Array.isArray(hydratedPoolRows) ? hydratedPoolRows : [])
    ];
    const seen = new Set();
    return merged.filter((r) => {
      if (!r || typeof r !== 'object') return false;
      const k = r.id != null
        ? `id:${String(r.id)}`
        : `row:${String(r.rma_number || '').toUpperCase()}::${String(r.barcode || '').toUpperCase()}::${r.is_parent ? 'P' : 'C'}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [sessionReports, lookupReports, availableReports, hydratedPoolRows]);

  // Hydrate missing parent/child/rma_items manifests when an Admin selects unpacked or child-only rows
  useEffect(() => {
    if (!isOpen || inputReports.length === 0) return;
    let isMounted = true;
    const neededRmas = [];

    inputReports.forEach((entry) => {
      const rep = entry.report;
      const resolved = resolveBatchManifestForQr(rep, manifestLookupPool);
      if (resolved.items.length > 1) return;
      const looksLikeBatch = Boolean(
        rep?.is_parent ||
        rep?.is_unpacked_manifest_item ||
        rep?.parent_rma_id != null ||
        Number(rep?.total_items || rep?.totalItems || rep?.manifest_total_lines || 0) > 1 ||
        String(rep?.name || '').toLowerCase().startsWith('batch return manifest')
      );
      if (looksLikeBatch && rep?.rma_number) {
        neededRmas.push(String(rep.rma_number).trim());
      }
    });

    const uniqueRmas = Array.from(new Set(neededRmas)).filter(Boolean);
    if (uniqueRmas.length === 0) return;

    (async () => {
      try {
        const [{ data: rmaRows }, { data: riRows }] = await Promise.all([
          supabase.from('rma_reports').select('*').in('rma_number', uniqueRmas),
          supabase.from('rma_items').select('*').in('rma_number', uniqueRmas).order('id', { ascending: true })
        ]);
        if (!isMounted) return;
        const additions = [];
        if (Array.isArray(rmaRows)) {
          additions.push(...rmaRows.filter((r) => Boolean(isTestRecord(r)) === Boolean(modalIsTestScope) && !isTrashedRecord(r)));
        }
        if (Array.isArray(riRows) && riRows.length > 0) {
          uniqueRmas.forEach((rmaNum) => {
            const matchedItems = riRows.filter((ri) => String(ri.rma_number || '').toUpperCase() === rmaNum.toUpperCase());
            if (matchedItems.length > 1) {
              additions.push({
                rma_number: rmaNum,
                is_parent: true,
                is_test: modalIsTestScope,
                items: matchedItems,
                total_items: matchedItems.length
              });
            }
          });
        }
        if (additions.length > 0) {
          setHydratedPoolRows(additions);
        }
      } catch {}
    })();

    return () => {
      isMounted = false;
    };
  }, [isOpen, batchSignature, inputReports.length, modalIsTestScope]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolvedEntriesByKey = useMemo(() => {
    const map = new Map();
    visibleEntries.forEach((entry) => {
      const rep = entry.report;
      const resolved = resolveBatchManifestForQr(rep, manifestLookupPool);
      const effectiveItems = resolved.items.length > 1
        ? resolved.items
        : (Array.isArray(rep?.items) && rep.items.length > 1 ? rep.items : null);
      const canonicalParent = resolved.parentReport && resolved.items.length > 1
        ? resolved.parentReport
        : rep;
      map.set(entry.key, { canonicalParent, effectiveItems });
    });
    return map;
  }, [visibleEntries, manifestLookupPool]);

  const hasMultiItemRma = useMemo(() => {
    return visibleEntries.some((entry) => {
      const rep = entry.report;
      const res = resolvedEntriesByKey.get(entry.key);
      return Boolean(
        (res?.effectiveItems && res.effectiveItems.length > 1) ||
        Number(rep?.total_items || rep?.totalItems || rep?.manifest_total_lines || 0) > 1
      );
    });
  }, [visibleEntries, resolvedEntriesByKey]);

  const expandedEntries = useMemo(() => {
    const out = [];
    visibleEntries.forEach((entry) => {
      const rep = entry.report;
      const res = resolvedEntriesByKey.get(entry.key);
      const canonicalRep = res?.canonicalParent || rep;
      const effectiveItems = res?.effectiveItems || null;

      if (qrSplitMode === 'per_item' && effectiveItems && effectiveItems.length > 1) {
        effectiveItems.forEach((it, itemIdx) => {
          const itemKey = `${entry.key}__item-${itemIdx + 1}`;
          if (removedKeys.has(itemKey)) return;
          const itemBarcode = String(it?.barcode || canonicalRep.barcode || '').trim();
          const itemSku = String(it?.code || it?.sku || '').trim();
          const itemName = String(it?.name || it?.productName || it?.product_name || canonicalRep.name || 'Returned Merchandise').trim();
          const itemQty = Math.max(1, Number(it?.quantity ?? it?.qty) || 1);
          const itemUnit = String(it?.unit_name || it?.unit || canonicalRep.unit_name || 'pc').trim() || 'pc';
          const itemSupplierCandidate = it?.supplier_name || it?.supplierName || it?.supplier || '';
          const itemSupplier = isRealSupplierName(itemSupplierCandidate)
            ? String(itemSupplierCandidate).trim()
            : (!isMixedSuppliersSummary(canonicalRep.supplier_name) ? (canonicalRep.supplier_name || '') : '');
          out.push({
            key: itemKey,
            parentKey: entry.key,
            itemIndex: itemIdx + 1,
            totalLines: effectiveItems.length,
            isPerItemSplit: true,
            report: {
              ...canonicalRep,
              items: [{ ...it }],
              total_items: 1,
              totalItems: 1,
              name: itemName,
              productName: itemName,
              barcode: itemBarcode || canonicalRep.barcode,
              code: itemSku,
              sku: itemSku,
              quantity: itemQty,
              total_quantity: itemQty,
              unit_name: itemUnit,
              unit: itemUnit,
              supplier_name: itemSupplier || canonicalRep.supplier_name,
              pieces_per_case: Number(it?.pieces_per_case ?? it?.piecesPerCase ?? canonicalRep.pieces_per_case) || 1,
              expiry_date: it?.expiry_date || canonicalRep.expiry_date || '',
              reason: it?.reason || canonicalRep.reason || '',
              explanation: it?.explanation || canonicalRep.explanation || '',
              _manifestLineIndex: itemIdx + 1,
              _manifestTotalLines: effectiveItems.length
            }
          });
        });
      } else {
        const consolidatedReport = effectiveItems && effectiveItems.length > 1
          ? {
              ...canonicalRep,
              is_parent: true,
              items: effectiveItems,
              total_items: effectiveItems.length,
              total_quantity: sumManifestQuantity(effectiveItems, canonicalRep.total_quantity || canonicalRep.quantity)
            }
          : canonicalRep;
        out.push({
          key: entry.key,
          parentKey: entry.key,
          itemIndex: null,
          totalLines: null,
          isPerItemSplit: false,
          report: consolidatedReport
        });
      }
    });
    return out;
  }, [visibleEntries, resolvedEntriesByKey, qrSplitMode, removedKeys]);

  // Default card size: Medium 90x105mm for single QR, balanced 62x74mm for multi-select consolidated or per-item QRs
  const defaultCardSize = useMemo(
    () => (expandedEntries.length <= 1 ? { widthMm: 90, heightMm: 105 } : { widthMm: 62, heightMm: 74 }),
    [expandedEntries.length]
  );

  // Compute physical page dimensions based on Paper Preset + Orientation + Margins
  const effectivePaper = useMemo(() => {
    const preset = PAPER_PRESETS.find((p) => p.id === paperPresetId) || PAPER_PRESETS[0];
    const baseW = paperPresetId === 'custom'
      ? clampNum(customPaperMm.widthMm, 50, 450, 215.9)
      : preset.widthMm;
    const baseH = paperPresetId === 'custom'
      ? clampNum(customPaperMm.heightMm, 50, 500, 279.4)
      : preset.heightMm;

    const widthMm = orientation === 'landscape' ? baseH : baseW;
    const heightMm = orientation === 'landscape' ? baseW : baseH;
    const safeMargin = clampNum(marginMm, 2, 30, 8);
    const printableW = Math.max(25, Number((widthMm - safeMargin * 2).toFixed(1)));
    const printableH = Math.max(25, Number((heightMm - safeMargin * 2).toFixed(1)));

    return {
      presetId: preset.id,
      label: preset.label,
      slug: preset.id.replace(/_/g, '-'),
      widthMm: Number(widthMm.toFixed(1)),
      heightMm: Number(heightMm.toFixed(1)),
      marginMm: safeMargin,
      printableW,
      printableH
    };
  }, [paperPresetId, customPaperMm, orientation, marginMm]);

  // Screen preview scale so any paper sheet fits neatly inside the modal without horizontal cropping
  const previewPxPerMm = useMemo(() => {
    const usableW = Math.max(240, Math.min(640, (canvasContainerWidth || 640) - 28));
    return Math.min(3.35, Math.max(0.85, usableW / Math.max(effectivePaper.widthMm, 1)));
  }, [effectivePaper.widthMm, canvasContainerWidth]);

  // Build normalized cards list with stable SVG DOM IDs and per-card mm dimensions
  const cards = useMemo(() => {
    return expandedEntries.map((entry, idx) => {
      const cardData = normalizeRmaQrCardData(entry.report);
      const custom = sizesByKey[entry.key] || defaultCardSize;
      const safeSvgSlug = entry.key.replace(/[^a-zA-Z0-9_-]/g, '_');
      return {
        key: entry.key,
        parentKey: entry.parentKey,
        itemIndex: entry.itemIndex,
        totalLines: entry.totalLines,
        isPerItemSplit: Boolean(entry.isPerItemSplit),
        index: idx,
        report: entry.report,
        cardData,
        qrPayload: buildPortalQrPayload(cardData.rmaNumber, cardData.isTest),
        svgId: `rma-qr-code-svg-${safeSvgSlug}`,
        widthMm: clampNum(custom.widthMm, 34, 220, defaultCardSize.widthMm),
        heightMm: clampNum(custom.heightMm, 40, 280, defaultCardSize.heightMm)
      };
    });
  }, [expandedEntries, sizesByKey, defaultCardSize]);

  const activeCard = useMemo(
    () => cards.find((c) => c.key === activeKey) || cards[0] || null,
    [cards, activeKey]
  );

  // Shelf-pack cards onto 1 or multiple physical sheets
  const packedLayout = useMemo(() => {
    return packQrCardsIntoPages({
      cards,
      printableW: effectivePaper.printableW,
      printableH: effectivePaper.printableH,
      gapMm: 4,
      layoutMode,
      centerSingleCard: cards.length === 1
    });
  }, [cards, effectivePaper.printableW, effectivePaper.printableH, layoutMode]);

  // Pointer drag resizing for individual cards
  useEffect(() => {
    const handlePointerMove = (e) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      e.preventDefault();
      const pxScale = drag.pxPerMm || 3.0;
      const dxMm = (e.clientX - drag.startX) / pxScale;
      const dyMm = (e.clientY - drag.startY) / pxScale;

      const nextW = drag.axis === 'y'
        ? drag.startW
        : Math.round(clampNum(drag.startW + dxMm, 34, 220, drag.startW));
      const nextH = drag.axis === 'x'
        ? drag.startH
        : Math.round(clampNum(drag.startH + dyMm, 40, 280, drag.startH));

      setSizesByKey((prev) => ({
        ...prev,
        [drag.key]: { widthMm: nextW, heightMm: nextH }
      }));
    };

    const handlePointerUp = () => {
      if (dragStateRef.current) {
        dragStateRef.current = null;
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, []);

  const startDrag = useCallback((cardKey, axis, startW, startH, pxPerMm, e) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.style.userSelect = 'none';
    setActiveKey(cardKey);
    dragStateRef.current = {
      key: cardKey,
      axis,
      startX: e.clientX,
      startY: e.clientY,
      startW,
      startH,
      pxPerMm
    };
  }, []);

  const isModalActiveForPrint = Boolean(isOpen && cards.length > 0);
  const pageWidthMmForStyle = effectivePaper.widthMm;
  const pageHeightMmForStyle = effectivePaper.heightMm;

  // Isolate browser/Chrome Ctrl+P (@media print) strictly to #rma-qr-print-portal while this modal is open
  useEffect(() => {
    if (!isModalActiveForPrint || typeof document === 'undefined') return undefined;
    document.body.classList.add('is-printing-qr-modal');

    const styleId = 'rma-qr-dynamic-page-style';
    let styleEl = document.getElementById(styleId);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `@media print { @page { size: ${pageWidthMmForStyle}mm ${pageHeightMmForStyle}mm; margin: 0; } }`;

    return () => {
      document.body.classList.remove('is-printing-qr-modal');
      const existing = document.getElementById(styleId);
      if (existing) existing.remove();
    };
  }, [isModalActiveForPrint, pageWidthMmForStyle, pageHeightMmForStyle]);

  // Safe conditional return AFTER all hooks
  if (!isOpen || cards.length === 0) return null;

  const isMulti = cards.length > 1;
  const activeWidthMm = activeCard?.widthMm || defaultCardSize.widthMm;
  const activeHeightMm = activeCard?.heightMm || defaultCardSize.heightMm;

  const updateActiveCardSize = (nextW, nextH) => {
    if (!activeCard) return;
    setSizesByKey((prev) => ({
      ...prev,
      [activeCard.key]: {
        widthMm: clampNum(nextW, 34, 220, activeCard.widthMm),
        heightMm: clampNum(nextH, 40, 280, activeCard.heightMm)
      }
    }));
  };

  const applyPresetToActive = (preset) => {
    updateActiveCardSize(preset.widthMm, preset.heightMm);
  };

  const handleApplyActiveSizeToAll = () => {
    const next = {};
    cards.forEach((c) => {
      next[c.key] = { widthMm: activeWidthMm, heightMm: activeHeightMm };
    });
    setSizesByKey(next);
    setDownloadNotice({
      type: 'success',
      msg: `Applied ${activeWidthMm}×${activeHeightMm}mm to all ${cards.length} QR cards.`
    });
    setTimeout(() => setDownloadNotice(null), 3000);
  };

  const handleResetAllSizes = () => {
    setSizesByKey({});
    setDownloadNotice({ type: 'success', msg: `Reset QR sizes to default (${defaultCardSize.widthMm}×${defaultCardSize.heightMm}mm).` });
    setTimeout(() => setDownloadNotice(null), 3000);
  };

  const handleAutoFitOnePage = () => {
    const fit = autoFitGridCardSize(
      cards.length,
      effectivePaper.printableW,
      effectivePaper.printableH,
      4,
      1.18
    );
    const next = {};
    cards.forEach((c) => {
      next[c.key] = { widthMm: fit.widthMm, heightMm: fit.heightMm };
    });
    setSizesByKey(next);
    setLayoutMode('one_page');
    setDownloadNotice({
      type: 'success',
      msg: `Auto-fit all ${cards.length} QRs to 1 ${effectivePaper.label} page (${fit.widthMm}×${fit.heightMm}mm each).`
    });
    setTimeout(() => setDownloadNotice(null), 3500);
  };

  const handleRemoveCard = (key) => {
    if (cards.length <= 1) return;
    setRemovedKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    if (activeKey === key) {
      const remaining = cards.find((c) => c.key !== key);
      if (remaining) setActiveKey(remaining.key);
    }
  };

  const handleAddReportToSheet = (rep) => {
    if (!rep || typeof rep !== 'object') return;
    const key = String(rep.rma_number || rep.rmaNumber || rep.id || '').trim();
    if (!key) return;
    setRemovedKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setExtraReports((prev) => {
      if (prev.some((x) => String(x?.rma_number || x?.rmaNumber || x?.id || '').trim().toUpperCase() === key.toUpperCase())) {
        return prev;
      }
      return [...prev, rep];
    });
    setActiveKey(key);
    setDownloadNotice({
      type: 'success',
      msg: `Added ${key} onto your consolidated QR print sheet.`
    });
    setTimeout(() => setDownloadNotice(null), 2500);
  };

  const handleAddSessionQrs = () => {
    if (scopedSessionMissing.length === 0) return;
    setRemovedKeys((prev) => {
      const next = new Set(prev);
      scopedSessionMissing.forEach((r) => {
        const k = String(r.rma_number || r.rmaNumber || r.id || '').trim();
        if (k) next.delete(k);
      });
      return next;
    });
    setExtraReports((prev) => {
      const seen = new Set(prev.map((x) => String(x?.rma_number || x?.rmaNumber || x?.id || '').trim().toUpperCase()));
      const additions = scopedSessionMissing.filter((r) => {
        const k = String(r.rma_number || r.rmaNumber || r.id || '').trim().toUpperCase();
        return k && !seen.has(k);
      });
      return [...prev, ...additions];
    });
    setDownloadNotice({
      type: 'success',
      msg: `Added ${scopedSessionMissing.length} session QR${scopedSessionMissing.length === 1 ? '' : 's'} onto consolidated sheet.`
    });
    setTimeout(() => setDownloadNotice(null), 3000);
  };

  const handleSaveQrPng = async () => {
    setDownloadingType('qr');
    setDownloadNotice(null);
    try {
      if (!isMulti && cards.length === 1) {
        const single = cards[0];
        const savedName = await downloadCustomSizedStickerPng({
          ...single.cardData,
          svgElementOrId: single.svgId,
          widthMm: single.widthMm,
          heightMm: single.heightMm,
          filename: `${single.cardData.rmaNumber}-QR ${formatSaveFileTimestamp(new Date())}.png`
        });
        setDownloadNotice({ type: 'success', msg: `Saved ${savedName}` });
      } else {
        const savedFiles = await downloadConsolidatedQrPagesPng({
          pages: packedLayout.pages,
          paperWidthMm: effectivePaper.widthMm,
          paperHeightMm: effectivePaper.heightMm,
          marginMm: effectivePaper.marginMm,
          paperSlug: effectivePaper.slug,
          totalQrCount: cards.length
        });
        setDownloadNotice({
          type: 'success',
          msg: `Saved ${savedFiles.length} consolidated sheet PNG(s): ${savedFiles[0]}${savedFiles.length > 1 ? ` (+${savedFiles.length - 1} more)` : ''}`
        });
      }
    } catch (err) {
      console.error('Failed to export QR PNG:', err);
      setDownloadNotice({ type: 'error', msg: 'Could not generate QR PNG.' });
    } finally {
      setDownloadingType(null);
      setTimeout(() => setDownloadNotice(null), 4500);
    }
  };

  const handleChangeSplitMode = (nextMode) => {
    const normalized = nextMode === 'per_item' ? 'per_item' : 'consolidated';
    if (normalized === qrSplitMode) return;
    setQrSplitMode(normalized);
    setSizesByKey({});
    setRemovedKeys((prev) => {
      const next = new Set();
      prev.forEach((k) => {
        if (!String(k).includes('__item-')) next.add(k);
      });
      return next;
    });
    setDownloadNotice(null);
  };

  const handlePrint = () => {
    setIsPrinting(true);
    try {
      const rootEl = document.getElementById('rma-qr-batch-sheet-root');
      if (!rootEl) {
        setDownloadNotice({ type: 'error', msg: 'QR print canvas not ready.' });
        return;
      }

      const pageSizeCss = `${effectivePaper.widthMm}mm ${effectivePaper.heightMm}mm`;
      const baseTitle = isMulti
        ? `${cards.length}-RMA-QRs-${effectivePaper.slug}`
        : `RMA-QR-${cards[0].cardData.rmaNumber}-${cards[0].widthMm}x${cards[0].heightMm}mm`;
      const docTitle = `${baseTitle} ${formatSaveFileTimestamp(new Date())}`;

      printIsolatedElement({
        elementId: 'rma-qr-batch-sheet-root',
        documentTitle: docTitle,
        pageSize: pageSizeCss,
        pageMargin: '0',
        allowMultiPage: layoutMode === 'multi_page' || packedLayout.pages.length > 1,
        customStyles: `
          :root, #rma-qr-batch-sheet-root {
            --u: 1mm !important;
          }
          .no-print-qr {
            display: none !important;
          }
          .rma-print-page {
            position: relative !important;
            width: ${effectivePaper.widthMm}mm !important;
            height: ${Math.max(10, Number((effectivePaper.heightMm - 0.5).toFixed(2)))}mm !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            border: none !important;
            box-shadow: none !important;
            overflow: hidden !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          .rma-print-page:not(:last-child) {
            page-break-after: always !important;
            break-after: page !important;
          }
          .rma-print-page:last-child {
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
          .rma-qr-card, .rma-qr-card * {
            color: #000000 !important;
            box-shadow: none !important;
          }
          .rma-qr-card {
            outline: none !important;
            ring: 0 !important;
            background: #ffffff !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        `
      });
    } catch (err) {
      console.error('Print QR failed:', err);
      setDownloadNotice({ type: 'error', msg: 'Could not open print dialog.' });
    } finally {
      setTimeout(() => setIsPrinting(false), 600);
    }
  };

  const modalContent = (
    <div id="rma-qr-print-portal" className="rma-qr-print-portal">
      <div className="rma-qr-modal-backdrop fixed inset-0 z-[130] flex items-center justify-center p-2 sm:p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200 print:static print:bg-white print:p-0 print:block">
        <div className="rma-qr-modal-shell bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[96dvh] sm:max-h-[96vh] print:max-h-none print:border-0 print:shadow-none print:block">

        {/* Modal Header */}
        <div className="shrink-0 bg-slate-900 text-white px-4 py-3 sm:px-5 sm:py-3.5 flex items-center justify-between gap-2 print:hidden no-print-qr">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center shrink-0">
              <QrCode className="w-4 h-4 text-blue-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-black tracking-tight flex items-center gap-1.5 flex-wrap">
                <span>
                  {isMulti ? `Consolidated QR Print Studio (${cards.length} QRs)` : 'Print RMA QR Code'}
                </span>
                {cards.some((c) => c.cardData.isTest) && (
                  <span className="px-1.5 py-0.5 rounded bg-violet-500/30 border border-violet-400 text-violet-200 text-[10px] font-black uppercase">
                    TEST SANDBOX
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-slate-300 leading-snug">
                {isMulti
                  ? `${packedLayout.pages.length} ${effectivePaper.label} Page${packedLayout.pages.length > 1 ? 's' : ''} (${effectivePaper.widthMm}×${effectivePaper.heightMm}mm) • Drag any QR corner to resize`
                  : `${cards[0].cardData.rmaNumber} • Unified B&W QR Card on ${effectivePaper.label}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!isMulti && onOpenQuickAction && (
              <button
                type="button"
                onClick={() => onOpenQuickAction(cards[0].report)}
                className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[11px] flex items-center gap-1 cursor-pointer transition-colors"
                title="Open Admin Quick Processing Actions"
              >
                <span>Process Item</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Private Portal Scan Security Notice */}
        <div className="shrink-0 bg-emerald-50 dark:bg-emerald-950/30 border-b border-emerald-200 dark:border-emerald-900/60 px-4 py-1.5 flex items-center justify-between gap-2 text-[11px] text-emerald-800 dark:text-emerald-300 print:hidden no-print-qr">
          <div className="flex items-center gap-1.5 font-semibold min-w-0">
            <Lock className="w-3.5 h-3.5 shrink-0" />
            <span>Private Portal QR: Standard cameras/Google Lens cannot open links — scan inside RMA Admin Scanner.</span>
          </div>
          <span className="font-mono font-black shrink-0 hidden sm:inline">B&amp;W Ink-Saver</span>
        </div>

        {/* Single Unified Scrollable Body (Toolbar + Paper Preview Canvas — prevents nested double scrollbars on mobile) */}
        <div className="rma-qr-modal-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col print:overflow-visible print:block">
        {/* Dynamic Paper Size, Page Packing & Per-QR Resize Toolbar */}
        <div className="shrink-0 px-3 sm:px-4 py-2.5 bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 space-y-2 print:hidden no-print-qr">

          {/* Row 1: Dynamic Paper Size + Orientation + Margins + Sheet Layout */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-200">
              <span>Paper:</span>
              <select
                aria-label="Paper Size"
                value={paperPresetId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setPaperPresetId(nextId);
                  const found = PAPER_PRESETS.find((p) => p.id === nextId);
                  if (found && nextId !== 'custom') {
                    setCustomPaperMm({ widthMm: found.widthMm, heightMm: found.heightMm });
                  }
                }}
                className="px-2 py-1 text-[11px] font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white cursor-pointer"
              >
                {PAPER_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.sub})
                  </option>
                ))}
              </select>
            </label>

            {paperPresetId === 'custom' && (
              <div className="flex items-center gap-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1 text-[11px] font-mono">
                <span className="text-slate-500 font-bold">Page W</span>
                <input
                  type="number"
                  aria-label="Custom Paper Width mm"
                  min={50}
                  max={450}
                  step="0.5"
                  value={customPaperMm.widthMm}
                  onChange={(e) => setCustomPaperMm((prev) => ({ ...prev, widthMm: e.target.value }))}
                  className="w-14 text-center font-black text-slate-900 dark:text-white bg-transparent border-b border-slate-300 dark:border-slate-600 outline-none"
                />
                <span className="text-slate-400">× H</span>
                <input
                  type="number"
                  aria-label="Custom Paper Height mm"
                  min={50}
                  max={500}
                  step="0.5"
                  value={customPaperMm.heightMm}
                  onChange={(e) => setCustomPaperMm((prev) => ({ ...prev, heightMm: e.target.value }))}
                  className="w-14 text-center font-black text-slate-900 dark:text-white bg-transparent border-b border-slate-300 dark:border-slate-600 outline-none"
                />
                <span className="text-slate-400">mm</span>
              </div>
            )}

            {/* Portrait / Landscape */}
            <div className="flex items-center rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-0.5 text-[11px] font-bold">
              {['portrait', 'landscape'].map((dir) => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => setOrientation(dir)}
                  className={`px-2 py-0.5 rounded-md capitalize transition-colors cursor-pointer ${
                    orientation === dir
                      ? 'bg-slate-900 text-white dark:bg-blue-600'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {dir}
                </button>
              ))}
            </div>

            {/* Adjustable Page Margin */}
            <label className="flex items-center gap-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1 text-[11px] font-mono">
              <span className="font-sans font-bold text-slate-500 dark:text-slate-400">Margin:</span>
              <input
                type="number"
                aria-label="Page Margin mm"
                min={2}
                max={30}
                value={marginMm}
                onChange={(e) => setMarginMm(clampNum(e.target.value, 2, 30, 8))}
                className="w-9 text-center font-black text-slate-900 dark:text-white bg-transparent border-b border-slate-300 dark:border-slate-600 outline-none"
              />
              <span className="text-slate-400">mm</span>
            </label>

            {/* Multi-Item Batch RMA QR Mode Toggle: Consolidated vs Single / Per-Item */}
            {hasMultiItemRma && (
              <div
                role="group"
                aria-label="Multi-Item QR Split Mode"
                className="grid grid-cols-1 sm:inline-flex items-stretch sm:items-center rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 p-0.5 text-[11px] font-bold shadow-2xs w-full sm:w-auto gap-0.5 sm:gap-0"
              >
                <button
                  type="button"
                  onClick={() => handleChangeSplitMode('consolidated')}
                  aria-pressed={qrSplitMode === 'consolidated'}
                  className={`px-2.5 py-1 sm:py-0.5 rounded-md transition-colors cursor-pointer text-center sm:whitespace-nowrap ${
                    qrSplitMode === 'consolidated'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title="Print or download 1 consolidated QR card per RMA ticket"
                >
                  📦 Consolidated (1 QR per RMA)
                </button>
                <button
                  type="button"
                  onClick={() => handleChangeSplitMode('per_item')}
                  aria-pressed={qrSplitMode === 'per_item'}
                  className={`px-2.5 py-1 sm:py-0.5 rounded-md transition-colors cursor-pointer text-center sm:whitespace-nowrap ${
                    qrSplitMode === 'per_item'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title="Expand multi-item RMAs into 1 separate QR card per individual line item"
                >
                  🏷️ Single / Per-Item QRs (1 QR per Item)
                </button>
              </div>
            )}

            {/* Sheet Packing Mode (1 Page Consolidated vs Multiple Pages Multi-Up) */}
            <div className="grid grid-cols-2 sm:inline-flex items-center rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-0.5 text-[11px] font-bold w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setLayoutMode('one_page')}
                className={`px-2.5 py-1 sm:py-0.5 rounded-md flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                  layoutMode === 'one_page'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Maximize2 className="w-3 h-3 shrink-0" />
                <span className="truncate">1 Page (Consolidated)</span>
              </button>
              <button
                type="button"
                onClick={() => setLayoutMode('multi_page')}
                className={`px-2.5 py-1 sm:py-0.5 rounded-md flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                  layoutMode === 'multi_page'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Layers className="w-3 h-3 shrink-0" />
                <span className="truncate">Multiple Pages ({packedLayout.pages.length})</span>
              </button>
            </div>

            {isMulti && (
              <button
                type="button"
                onClick={handleAutoFitOnePage}
                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-black shadow-2xs transition-colors cursor-pointer"
                title="Automatically resize all selected QR cards proportionally to fit cleanly onto 1 page"
              >
                ⚡ Auto-Fit All to 1 Page
              </button>
            )}

            {(availableReports.length > 0 || sessionReports.length > 0) && (
              <>
                <button
                  type="button"
                  onClick={() => setIsAddPickerOpen((v) => !v)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-black flex items-center gap-1 transition-colors cursor-pointer border ${
                    isAddPickerOpen
                      ? 'bg-indigo-700 text-white border-indigo-700'
                      : 'bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/70 dark:hover:bg-indigo-900/70 text-indigo-800 dark:text-indigo-200 border-indigo-300 dark:border-indigo-700'
                  }`}
                  title="Append additional RMA QRs to print or download on the same consolidated sheet"
                >
                  <Plus className="w-3 h-3 shrink-0" />
                  <span>Add More RMA QRs to Sheet</span>
                </button>

                {scopedSessionMissing.length > 0 && (
                  <button
                    type="button"
                    onClick={handleAddSessionQrs}
                    className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-black flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                    title="Add all other QRs submitted in this session onto this print sheet"
                  >
                    <QrCode className="w-3 h-3" />
                    <span>Add Recent Session QRs (+{scopedSessionMissing.length})</span>
                  </button>
                )}
              </>
            )}
          </div>

          {/* Searchable Multi-QR Picker Dropdown Panel */}
          {isAddPickerOpen && (
            <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 space-y-2 shadow-sm">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={addSearchQuery}
                    onChange={(e) => setAddSearchQuery(e.target.value)}
                    placeholder={`Search ${modalIsTestScope ? 'Test Sandbox' : 'Live'} RMAs by RMA #, item, SKU, barcode, store or supplier...`}
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-[11px] font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setIsAddPickerOpen(false)}
                  className="px-2 py-1 rounded-lg text-[11px] font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                >
                  Close
                </button>
              </div>
              <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {addableCandidates.length === 0 ? (
                  <div className="py-2 text-center text-[11px] text-slate-400 italic">
                    No additional {modalIsTestScope ? 'Test Mode' : 'Live'} RMAs available matching filter.
                  </div>
                ) : (
                  addableCandidates.map((cand) => {
                    const rmaNo = cand.rma_number || cand.rmaNumber || cand.id;
                    const itemName = cand.name || cand.productName || cand.barcode || 'Returned Merchandise';
                    const qty = cand.total_quantity ?? cand.quantity ?? 1;
                    const unit = cand.unit_name || cand.unit || 'pc';
                    return (
                      <button
                        key={rmaNo}
                        type="button"
                        onClick={() => handleAddReportToSheet(cand)}
                        className="w-full px-2.5 py-1.5 flex items-center justify-between gap-2 text-left hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors cursor-pointer rounded"
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <span className="font-mono font-black text-[11px] text-indigo-700 dark:text-indigo-300 shrink-0">
                            {rmaNo}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 truncate">
                            {itemName}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 text-[10px]">
                          <span className="font-mono font-bold text-slate-600 dark:text-slate-400">
                            {qty} {unit}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-indigo-600 text-white font-black">
                            + Add
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Row 2: Active QR Card Sizing Presets & Manual W × H mm Inputs */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-200/80 dark:border-slate-700/80">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-black uppercase tracking-wide text-slate-600 dark:text-slate-300 mr-0.5">
                {isMulti && activeCard ? `Selected (${activeCard.cardData.rmaNumber}):` : 'QR Card Size:'}
              </span>
              {QR_SIZE_PRESETS.map((preset) => {
                const isSelected = activeWidthMm === preset.widthMm && activeHeightMm === preset.heightMm;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPresetToActive(preset)}
                    className={`px-2 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900 dark:bg-blue-600 dark:border-blue-500 shadow-xs'
                        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600 hover:border-blue-400'
                    }`}
                  >
                    {preset.label} <span className="font-mono text-[10px] opacity-75">({preset.widthMm}×{preset.heightMm})</span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex items-center gap-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1 text-[11px] font-mono">
                <span className="text-slate-500 font-bold">W</span>
                <input
                  type="number"
                  aria-label="QR Card Width mm"
                  min={34}
                  max={220}
                  value={activeWidthMm}
                  onChange={(e) => updateActiveCardSize(e.target.value, activeHeightMm)}
                  className="w-11 text-center font-black text-slate-900 dark:text-white bg-transparent border-b border-slate-300 dark:border-slate-600 focus:border-blue-500 outline-none"
                />
                <span className="text-slate-400">× H</span>
                <input
                  type="number"
                  aria-label="QR Card Height mm"
                  min={40}
                  max={280}
                  value={activeHeightMm}
                  onChange={(e) => updateActiveCardSize(activeWidthMm, e.target.value)}
                  className="w-11 text-center font-black text-slate-900 dark:text-white bg-transparent border-b border-slate-300 dark:border-slate-600 focus:border-blue-500 outline-none"
                />
                <span className="text-slate-400">mm</span>
              </div>

              {isMulti && (
                <button
                  type="button"
                  onClick={handleApplyActiveSizeToAll}
                  className="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  title="Apply active card width & height to every QR card in this batch"
                >
                  <CopyCheck className="w-3 h-3" />
                  <span>Apply Active Size to All</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleResetAllSizes}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer flex items-center gap-1 text-[11px] font-bold"
                title="Reset sizes to default"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {isMulti && <span>Reset Sizes</span>}
              </button>
            </div>
          </div>

          {/* Overflow Warning Banner when 1-page mode exceeds printable page bounds */}
          {layoutMode === 'one_page' && packedLayout.hasOverflow && (
            <div className="px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 text-[11px] font-bold flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>
                  1-Page Overflow: {cards.length} QRs require {Math.ceil(packedLayout.neededHeightMm)}mm height (printable height is {effectivePaper.printableH}mm).
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleAutoFitOnePage}
                  className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-black cursor-pointer"
                >
                  Auto-Fit All to 1 Page
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutMode('multi_page')}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-black cursor-pointer"
                >
                  Switch to Multiple Pages
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Live WYSIWYG Consolidated Paper Sheet(s) Canvas Area */}
        <div
          ref={canvasAreaRef}
          className="rma-qr-modal-canvas-wrap flex-1 p-3 sm:p-6 bg-slate-200/80 dark:bg-slate-950/90 print:p-0 print:bg-white print:overflow-visible"
        >
          <div
            id="rma-qr-batch-sheet-root"
            style={{ '--u': `${previewPxPerMm}px` }}
            className="flex flex-col items-center gap-6 print:block print:gap-0"
          >
            {packedLayout.pages.map((pageCards, pageIndex) => {
              const displayPageHeightMm = layoutMode === 'one_page' && packedLayout.hasOverflow
                ? Math.max(effectivePaper.heightMm, packedLayout.neededHeightMm + effectivePaper.marginMm * 2 + 4)
                : effectivePaper.heightMm;

              return (
                <div
                  key={`qr-page-${pageIndex}`}
                  data-page-index={pageIndex + 1}
                  style={{
                    width: `calc(${effectivePaper.widthMm} * var(--u))`,
                    height: `calc(${displayPageHeightMm} * var(--u))`
                  }}
                  className="rma-print-page relative bg-white border border-slate-300 shadow-lg shrink-0 select-none print:border-0 print:shadow-none"
                >
                  {/* Screen-only page badge & printable margin frame */}
                  <div className="no-print-qr absolute top-1 left-2 text-[9px] font-mono font-bold text-slate-400 pointer-events-none">
                    Page {pageIndex + 1} / {packedLayout.pages.length} • {effectivePaper.label} ({effectivePaper.widthMm}×{effectivePaper.heightMm}mm)
                  </div>

                  {/* Screen-only dashed printable margin boundary */}
                  <div
                    className="no-print-qr absolute border border-dashed border-slate-200 pointer-events-none"
                    style={{
                      left: `calc(${effectivePaper.marginMm} * var(--u))`,
                      top: `calc(${effectivePaper.marginMm} * var(--u))`,
                      width: `calc(${effectivePaper.printableW} * var(--u))`,
                      height: `calc(${effectivePaper.printableH} * var(--u))`
                    }}
                  />

                  {/* Placed Printable QR Cards on this page */}
                  {pageCards.map((placed) => {
                    const { cardData, svgId, qrPayload, wMm, hMm, xMm, yMm, key, itemIndex } = placed;
                    const isSelectedCard = isMulti && activeCard?.key === key;
                    // Smooth proportional scaling relative to 90x105mm baseline
                    const s = Math.min(wMm / 90, hMm / 105);
                    const qrMm = Math.max(18, Math.min(wMm * 0.56, hMm * 0.36));

                    return (
                      <div
                        key={key}
                        data-rma-qr-card={cardData.rmaNumber}
                        data-rma-qr-key={key}
                        {...(itemIndex ? { 'data-rma-qr-item-index': String(itemIndex) } : {})}
                        onClick={() => isMulti && setActiveKey(key)}
                        style={{
                          left: `calc(${effectivePaper.marginMm + xMm} * var(--u))`,
                          top: `calc(${effectivePaper.marginMm + yMm} * var(--u))`,
                          width: `calc(${wMm} * var(--u))`,
                          height: `calc(${hMm} * var(--u))`,
                          padding: `calc(${Math.max(2, 3 * s)} * var(--u))`,
                          borderWidth: `calc(${Math.max(0.4, 0.55 * s)} * var(--u))`
                        }}
                        className={`rma-qr-card absolute bg-white text-black border border-black flex flex-col justify-between box-border overflow-hidden transition-shadow ${
                          isSelectedCard ? 'ring-2 ring-blue-500 ring-offset-1' : ''
                        }`}
                      >
                        {/* Screen-only Remove Item button when multiple QRs are open */}
                        {isMulti && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveCard(key);
                            }}
                            title={`Remove ${cardData.rmaNumber} from print sheet`}
                            aria-label={`Remove ${cardData.rmaNumber}`}
                            className="no-print-qr absolute top-0.5 right-0.5 z-10 w-4 h-4 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center shadow cursor-pointer print:hidden"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        )}

                        {/* 1. Unified Pure B&W Header Strip */}
                        <div
                          className="w-full border-b border-black flex items-center justify-between gap-1 shrink-0"
                          style={{ paddingBottom: `calc(${Math.max(1, 1.5 * s)} * var(--u))` }}
                        >
                          <span
                            className="font-black uppercase tracking-wide text-black truncate"
                            style={{ fontSize: `calc(${Math.max(1.8, 2.5 * s)} * var(--u))`, lineHeight: 1.1 }}
                          >
                            {cardData.headerTitle}
                          </span>
                          <span
                            className="font-mono font-bold text-black shrink-0 pr-3 sm:pr-0"
                            style={{ fontSize: `calc(${Math.max(1.6, 2.1 * s)} * var(--u))`, lineHeight: 1.1 }}
                          >
                            {Math.round(wMm)}×{Math.round(hMm)}mm
                          </span>
                        </div>

                        {/* 2. Centered Body: Private Portal QR + RMA # + Product + Qty & Unit + Metadata */}
                        <div className="flex-1 flex flex-col items-center justify-center text-center min-h-0 py-0.5">
                          {/* High-Contrast Private Portal QR */}
                          <div
                            className="bg-white border border-black flex items-center justify-center shrink-0"
                            style={{
                              width: `calc(${qrMm} * var(--u))`,
                              height: `calc(${qrMm} * var(--u))`,
                              padding: `calc(${Math.max(1, 1.5 * s)} * var(--u))`
                            }}
                          >
                            <QRCodeSVG
                              id={svgId}
                              value={qrPayload || cardData.rmaNumber}
                              size={256}
                              level="H"
                              includeMargin={false}
                              bgColor="#ffffff"
                              fgColor="#000000"
                              style={{ width: '100%', height: '100%', display: 'block' }}
                            />
                          </div>

                          <div
                            className="font-mono font-black uppercase tracking-wider text-black shrink-0"
                            style={{
                              fontSize: `calc(${Math.max(1.4, 1.8 * s)} * var(--u))`,
                              marginTop: `calc(${0.8 * s} * var(--u))`,
                              lineHeight: 1.05
                            }}
                          >
                            PORTAL SCAN ONLY
                          </div>

                          {/* Bold RMA Number */}
                          <div
                            className="font-mono font-black text-black tracking-tight w-full truncate shrink-0"
                            style={{
                              fontSize: `calc(${Math.max(2.6, 4.1 * s)} * var(--u))`,
                              marginTop: `calc(${0.8 * s} * var(--u))`,
                              lineHeight: 1.1
                            }}
                          >
                            {cardData.rmaNumber}
                          </div>

                          {/* Product Name or Batch Manifest */}
                          <div
                            className="font-extrabold text-black w-full line-clamp-2 shrink-0"
                            style={{
                              fontSize: `calc(${Math.max(1.9, 2.6 * s)} * var(--u))`,
                              marginTop: `calc(${0.6 * s} * var(--u))`,
                              lineHeight: 1.15
                            }}
                          >
                            {cardData.displayTitle}
                          </div>

                          {/* Quantity & Unit Badge (Always prominently visible) */}
                          <div
                            className="w-full border border-black font-black text-black shrink-0 truncate"
                            style={{
                              fontSize: `calc(${Math.max(1.85, 2.5 * s)} * var(--u))`,
                              marginTop: `calc(${1 * s} * var(--u))`,
                              padding: `calc(${0.6 * s} * var(--u)) calc(${1.2 * s} * var(--u))`,
                              lineHeight: 1.15
                            }}
                          >
                            Qty: {cardData.qtyFormatted}
                          </div>

                          {/* Structured Meta: Barcode/SKU, Optional Expiry (Supplier Name omitted by design) */}
                          <div
                            className="w-full font-mono font-bold text-black space-y-0.5 shrink-0"
                            style={{
                              fontSize: `calc(${Math.max(1.5, 2.0 * s)} * var(--u))`,
                              marginTop: `calc(${0.8 * s} * var(--u))`,
                              lineHeight: 1.15
                            }}
                          >
                            {!cardData.isManifest && (
                              <div className="truncate">
                                BC: {cardData.barcode}{cardData.sku ? ` • SKU: ${cardData.sku}` : ''}
                              </div>
                            )}
                            {cardData.expiryYmd && (
                              <div className="truncate">Exp (YYYY-MM-DD): {cardData.expiryYmd}</div>
                            )}
                          </div>
                        </div>

                        {/* 3. Pinned Footer: Reporter & Contact + Date/Time + Reporter Signature */}
                        <div className="w-full shrink-0 border-t border-black pt-0.5 space-y-0.5">
                          <div
                            className="flex items-center justify-between gap-1 text-black font-semibold truncate"
                            style={{ fontSize: `calc(${Math.max(1.45, 1.95 * s)} * var(--u))`, lineHeight: 1.15 }}
                          >
                            <span className="truncate">
                              By: <strong>{cardData.reporter || 'Staff'}</strong>
                              {cardData.reporterContact && cardData.reporterContact !== 'N/A' ? ` (${cardData.reporterContact})` : ''}
                            </span>
                            <span className="font-mono shrink-0">{cardData.dateTimeFormatted}</span>
                          </div>

                          <div
                            className="border border-black bg-white flex flex-col justify-end"
                            style={{
                              padding: `calc(${0.8 * s} * var(--u)) calc(${1.2 * s} * var(--u))`,
                              minHeight: `calc(${Math.max(5.5, 7.8 * s)} * var(--u))`
                            }}
                          >
                            <div
                              className="flex items-end justify-between gap-1 text-black font-bold"
                              style={{ fontSize: `calc(${Math.max(1.35, 1.75 * s)} * var(--u))`, lineHeight: 1 }}
                            >
                              <span className="shrink-0">Reporter Signature:</span>
                              <span className="flex-1 border-b border-black mx-1" />
                              <span className="shrink-0">Date: _____</span>
                            </div>
                          </div>
                        </div>

                        {/* Screen-only Right, Bottom & Corner Drag Resize Handles */}
                        <button
                          type="button"
                          onPointerDown={(e) => startDrag(key, 'x', wMm, hMm, previewPxPerMm, e)}
                          title={`Drag horizontally to resize ${cardData.rmaNumber} width`}
                          aria-label={`Resize ${cardData.rmaNumber} width`}
                          className="no-print-qr absolute top-2 bottom-4 right-0 w-2 cursor-ew-resize print:hidden opacity-0 hover:opacity-100 bg-amber-500/60 transition-opacity"
                        />
                        <button
                          type="button"
                          onPointerDown={(e) => startDrag(key, 'y', wMm, hMm, previewPxPerMm, e)}
                          title={`Drag vertically to resize ${cardData.rmaNumber} height`}
                          aria-label={`Resize ${cardData.rmaNumber} height`}
                          className="no-print-qr absolute left-2 right-4 bottom-0 h-2 cursor-ns-resize print:hidden opacity-0 hover:opacity-100 bg-amber-500/60 transition-opacity"
                        />
                        <button
                          type="button"
                          onPointerDown={(e) => startDrag(key, 'xy', wMm, hMm, previewPxPerMm, e)}
                          title={`Drag corner to resize ${cardData.rmaNumber} (${wMm}×${hMm}mm)`}
                          aria-label={`Drag corner to resize ${cardData.rmaNumber}`}
                          className="no-print-qr absolute bottom-0 right-0 w-4 h-4 bg-amber-500 hover:bg-amber-600 text-slate-950 flex items-center justify-center cursor-nwse-resize print:hidden rounded-tl"
                        >
                          <Move className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        </div>

        {/* Status Toast */}
        {downloadNotice && (
          <div className={`shrink-0 mx-4 sm:mx-6 mt-2 px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 print:hidden no-print-qr ${
            downloadNotice.type === 'success'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700'
              : 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-700'
          }`}>
            {downloadNotice.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            <span>{downloadNotice.msg}</span>
          </div>
        )}

        {/* Unified Action Footer: Strictly "Save QR (PNG)" and "Print QR" / "Print N QRs" */}
        <div className="shrink-0 p-3 sm:px-6 sm:py-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 grid grid-cols-2 sm:flex sm:items-center sm:justify-between gap-2 print:hidden no-print-qr">
          <div className="contents sm:flex sm:flex-wrap sm:items-center sm:gap-2">
            <button
              type="button"
              onClick={handleSaveQrPng}
              disabled={downloadingType !== null}
              className="px-3 sm:px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-50"
              title={isMulti ? 'Download consolidated multi-up QR sheet PNG(s)' : `Download ${cards[0].cardData.rmaNumber}-QR.png`}
            >
              <Download className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{downloadingType === 'qr' ? 'Generating...' : 'Save QR (PNG)'}</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              disabled={isPrinting}
              className="col-span-2 sm:col-span-1 order-first sm:order-none px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black shadow-md shadow-blue-600/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-50"
              title={`Print on ${effectivePaper.label} (${effectivePaper.widthMm}×${effectivePaper.heightMm}mm)`}
            >
              <Printer className="w-4 h-4 shrink-0" />
              <span className="truncate">
                {isPrinting
                  ? 'Printing...'
                  : isMulti
                    ? `Print ${cards.length} QRs (${packedLayout.pages.length} ${effectivePaper.label} Page${packedLayout.pages.length > 1 ? 's' : ''})`
                    : `Print QR (${activeWidthMm}×${activeHeightMm}mm • ${effectivePaper.label})`}
              </span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-3 sm:px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Done</span>
          </button>
        </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}
