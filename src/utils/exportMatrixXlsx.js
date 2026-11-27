/**
 * Genuine OOXML (.xlsx) Overall RMA Matrix Exporter.
 * Mirrors Pingcon's Quantity_Balance_Report template with frozen A..E columns & rows 1..5:
 *   - Row 1 Title, Row 2 Yellow Metadata Strip, Rows 3-4 Section & Alternating Week Banners
 *   - Row 5 Columns A..E: Serial No. | Category (blank) | Supplier Name | SKU (blank if unassigned) | Description
 *   - Collapsible Daily YYYY-MM-DD columns (outlineLevel="1") + Week total (pcs) =SUM(...) + Total pcs returned =SUM(...)
 *   - Return Bad Stock (pcs) & Return Good Stock (pcs) under Danilo RMA / RMA banners
 *   - 17 RMA Item Details & Workflow Status columns (No Basket/PO/Buffer columns)
 *   - Combines Customer Hub + Supplier RTV in Overall mode while preserving strict Live vs Test isolation
 */

import {
  computeItemPiecesAndValue,
  formatDateTimeYmdHm,
  formatDateYmd,
  formatFourChoiceOutcome,
  formatSaveFileTimestamp,
  getCleanSku,
  getCreditMemoRmaNumbers,
  getItemNeedsReorder,
  getReportManifestItems,
  isBatchManifest,
  isManifestSubItem,
  isTestRecord,
  isTrashedRecord,
  parseCreditMemoMeta
} from './rmaHelpers.js';
import { buildStoredZip, colToLetter, escapeXml } from './exportXlsx.js';

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const isPlaceholderSupplier = (val) => {
  const s = String(val || '').trim().toLowerCase();
  return !s || s === 'pending assignment' || s === 'pending' || s === 'unassigned' || s === 'warehouse' || s === 'n/a';
};

/** Format an ISO timestamp or YYYY-MM-DD string into Asia/Manila YYYY-MM-DD */
export function toManilaDateKey(dateInput) {
  return formatDateYmd(dateInput);
}

/** Unambiguous YYYY-MM-DD HH:mm (Asia/Manila) timestamp display */
export function formatManilaTimestampDisplay(date = new Date()) {
  return `${formatDateTimeYmdHm(date)} (Asia/Manila)`;
}

/** Format HHMM in Asia/Manila timezone for spreadsheet filename suffix */
export function formatManilaHhmm(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '0000';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Manila',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(d);
    const map = {};
    parts.forEach((p) => {
      if (p.type !== 'literal') map[p.type] = p.value;
    });
    const hh = map.hour === '24' ? '00' : (map.hour || '00');
    const mm = map.minute || '00';
    return `${hh}${mm}`;
  } catch {
    return `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

function enumerateDateRange(startYmd, endYmd, maxDays = 370) {
  if (!startYmd || !endYmd || !/^\d{4}-\d{2}-\d{2}$/.test(startYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) {
    return [];
  }
  const [sy, sm, sd] = startYmd.split('-').map(Number);
  const [ey, em, ed] = endYmd.split('-').map(Number);
  const start = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(ey, em - 1, ed));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }
  const dates = [];
  const cur = new Date(start.getTime());
  let guard = 0;
  while (cur <= end && guard < maxDays) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
    guard += 1;
  }
  return dates;
}

function formatShortMonDay(utcDate) {
  const mon = SHORT_MONTHS[utcDate.getUTCMonth()];
  const day = String(utcDate.getUTCDate()).padStart(2, '0');
  return `${mon} ${day}`;
}

/**
 * Group consecutive YYYY-MM-DD dates into Monday..Sunday week buckets.
 */
function buildWeekBlocks(dateStrings) {
  const blocks = [];
  let current = null;

  dateStrings.forEach((ymd) => {
    const [y, m, d] = ymd.split('-').map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d));
    const dow = utc.getUTCDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(utc.getTime());
    monday.setUTCDate(monday.getUTCDate() + mondayOffset);
    const sunday = new Date(monday.getTime());
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    const weekKey = monday.toISOString().slice(0, 10);

    if (!current || current.weekKey !== weekKey) {
      current = {
        weekKey,
        label: `${formatShortMonDay(monday)} - ${formatShortMonDay(sunday)}`,
        dates: []
      };
      blocks.push(current);
    }
    current.dates.push(ymd);
  });

  return blocks;
}

/**
 * Prepare Overall RMA Matrix dataset combining Customer Hub + Supplier RTV (or single hub when filtered),
 * strictly isolating Live Production vs Test Mode Sandbox records.
 */
export function buildRmaMatrixDataset({
  reports = [],
  catalogProducts = [],
  creditMemos = [],
  stream = 'overall', // 'overall' | 'supplier_outbound' | 'customer_inbound'
  isTestMode = false,
  startDate = '',
  endDate = '',
  includeAllRecords = false,
  includeZeroCatalogSkus = false
}) {
  const normalizedStream = (stream === 'supplier_outbound' || stream === 'customer_inbound')
    ? stream
    : 'overall';

  const scopedDateCandidates = (Array.isArray(reports) ? reports : [])
    .filter((r) => {
      if (!r || isTrashedRecord(r)) return false;
      if (Boolean(isTestMode) !== isTestRecord(r)) return false;
      if (normalizedStream !== 'overall') {
        const rStream = r.rma_type === 'supplier_outbound' ? 'supplier_outbound' : 'customer_inbound';
        if (rStream !== normalizedStream) return false;
      }
      if (isManifestSubItem(r, reports)) return false;
      return true;
    })
    .map((r) => toManilaDateKey(r.created_at || r.updated_at))
    .filter((ymd) => /^\d{4}-\d{2}-\d{2}$/.test(ymd))
    .sort();

  const todayManila = toManilaDateKey(new Date());
  let safeEnd = endDate || todayManila;
  let safeStart = startDate;
  if (includeAllRecords && !startDate && !endDate) {
    safeStart = scopedDateCandidates[0] || todayManila;
    const latestCandidate = scopedDateCandidates[scopedDateCandidates.length - 1] || todayManila;
    safeEnd = latestCandidate > todayManila ? latestCandidate : todayManila;
  } else if (!safeStart) {
    const d = new Date(`${safeEnd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 13);
    safeStart = d.toISOString().slice(0, 10);
  }

  const allDates = enumerateDateRange(safeStart, safeEnd, includeAllRecords ? 3660 : 370);
  const weekBlocks = buildWeekBlocks(allDates);
  const dateSet = new Set(allDates);

  const creditMemoByRma = new Map();
  (Array.isArray(creditMemos) ? creditMemos : []).forEach((cm) => {
    if (!cm || !cm.credit_memo_number) return;
    if (Boolean(isTestMode) !== isTestRecord(cm)) return;
    const cmNo = String(cm.credit_memo_number).trim();
    getCreditMemoRmaNumbers(cm).forEach((rmaNum) => {
      if (rmaNum) creditMemoByRma.set(rmaNum, cmNo);
    });
    if (cm.report_id) {
      creditMemoByRma.set(`id:${cm.report_id}`, cmNo);
    }
    const meta = parseCreditMemoMeta(cm.notes);
    (Array.isArray(cm.consolidated_report_ids) ? cm.consolidated_report_ids : (meta?.report_ids || [])).forEach((rid) => {
      if (rid != null) creditMemoByRma.set(`id:${rid}`, cmNo);
    });
    (Array.isArray(cm.consolidated_items) ? cm.consolidated_items : (meta?.consolidated_items || [])).forEach((it) => {
      if (it?.report_id != null) creditMemoByRma.set(`id:${it.report_id}`, cmNo);
    });
  });

  // Index consolidated pickup metadata by RMA # so every sibling RMA row inherits shared claim_number/pickup_at cleanly
  const consolidatedPickupByRma = new Map();
  (Array.isArray(reports) ? reports : []).forEach((r) => {
    if (!r || isTrashedRecord(r)) return;
    if (Boolean(isTestMode) !== isTestRecord(r)) return;
    const p = r.ai_document_metadata?.supplier_pickup;
    if (p && typeof p === 'object' && Array.isArray(p.consolidated_rma_numbers)) {
      p.consolidated_rma_numbers.forEach((rmaNum) => {
        const clean = String(rmaNum || '').trim();
        if (clean && !consolidatedPickupByRma.has(clean)) {
          consolidatedPickupByRma.set(clean, {
            pickup: p,
            simpleDisp: r.ai_document_metadata?.simple_rtv_disposition,
            simpleLabel: r.ai_document_metadata?.simple_rtv_label,
            updatedAt: r.ai_document_metadata?.simple_rtv_updated_at
          });
        }
      });
    }
  });

  // Strict Live vs Test filtering (+ optional stream filter when not 'overall')
  const filteredTopReports = (Array.isArray(reports) ? reports : []).filter((r) => {
    if (!r || isTrashedRecord(r)) return false;
    const recordIsTest = isTestRecord(r);
    if (Boolean(isTestMode) !== recordIsTest) return false;
    if (normalizedStream !== 'overall') {
      const rStream = r.rma_type === 'supplier_outbound' ? 'supplier_outbound' : 'customer_inbound';
      if (rStream !== normalizedStream) return false;
    }
    if (isManifestSubItem(r, reports)) return false;
    return true;
  });

  const rows = [];
  const seenSkuKeys = new Set();
  const distinctSkuSet = new Set();

  filteredTopReports.forEach((report) => {
    const reportDate = toManilaDateKey(report.created_at || report.updated_at);
    if (!reportDate || !dateSet.has(reportDate)) return;

    const lines = isBatchManifest(report, reports)
      ? getReportManifestItems(report, reports)
      : [report];
    const effectiveLines = lines.length > 0 ? lines : [report];

    const rStream = report.rma_type === 'supplier_outbound' ? 'supplier_outbound' : 'customer_inbound';
    const hubLabel = rStream === 'supplier_outbound' ? 'Supplier RTV' : 'Customer Hub';
    const rmaNumber = report.rma_number || report.rmaNumber || String(report.id || '');
    const meta = (report.ai_document_metadata && typeof report.ai_document_metadata === 'object')
      ? report.ai_document_metadata
      : {};
    const batchFallback = consolidatedPickupByRma.get(String(rmaNumber).trim()) || null;
    const pickup = (meta.supplier_pickup && typeof meta.supplier_pickup === 'object')
      ? meta.supplier_pickup
      : (batchFallback?.pickup || {});
    const dateReported = formatDateTimeYmdHm(report.created_at || report.updated_at);
    let noteCmNumber = '';
    if (typeof report.notes === 'string' && report.notes.includes('credit_memo_number')) {
      try {
        noteCmNumber = JSON.parse(report.notes)?.credit_memo_number || '';
      } catch {}
    }
    const linkedMemo =
      creditMemoByRma.get(String(rmaNumber).trim()) ||
      creditMemoByRma.get(`id:${report.id}`) ||
      report.credit_memo_no ||
      report.credit_memo_number ||
      noteCmNumber ||
      '';

    effectiveLines.forEach((line) => {
      const { totalPieces, lineTotal } = computeItemPiecesAndValue(line, catalogProducts);
      if (totalPieces <= 0) return;

      const bc = String(line.barcode || report.barcode || '').trim();
      const candidateCode = String(line.code || line.sku || report.code || report.sku || '').trim();
      const matchedCatalog = Array.isArray(catalogProducts)
        ? catalogProducts.find((p) => (
            (bc && p.barcode && String(p.barcode).trim() === bc) ||
            (candidateCode && (String(p.code || '').trim() === candidateCode || String(p.sku || '').trim() === candidateCode))
          ))
        : null;

      // Strictly "" if SKU is unassigned or matches barcode/placeholder
      const cleanSku = getCleanSku(
        line.code || line.sku || report.code || report.sku || matchedCatalog?.code || matchedCatalog?.sku,
        bc
      );

      // Resolve real synced supplier, strictly blank "" if placeholder or none
      const supplierName = [
        line.supplier_name,
        line.supplierName,
        pickup.supplier_name,
        report.supplier_name,
        report.supplierName,
        report.supplier,
        matchedCatalog?.supplier_name,
        matchedCatalog?.supplierName
      ].find((cand) => !isPlaceholderSupplier(cand)) || '';

      const desc =
        line.name ||
        line.product_name ||
        line.productName ||
        report.name ||
        matchedCatalog?.name ||
        (bc ? `Barcode ${bc}` : 'Returned Item');

      if (cleanSku) {
        seenSkuKeys.add(cleanSku.toUpperCase());
        distinctSkuSet.add(cleanSku.toUpperCase());
      } else if (bc) {
        seenSkuKeys.add(bc.toUpperCase());
        distinctSkuSet.add(bc.toUpperCase());
      }

      // Per-line outcome resolution (supports split/child/consolidated metadata cleanly)
      const lineWithParentMeta = {
        ...report,
        ...line,
        ai_document_metadata: {
          ...(batchFallback?.simpleDisp ? { simple_rtv_disposition: batchFallback.simpleDisp, simple_rtv_label: batchFallback.simpleLabel, simple_rtv_updated_at: batchFallback.updatedAt } : {}),
          ...meta,
          ...(pickup && Object.keys(pickup).length > 0 ? { supplier_pickup: pickup } : {}),
          ...((line.ai_document_metadata && typeof line.ai_document_metadata === 'object') ? line.ai_document_metadata : {})
        }
      };
      const outcome = formatFourChoiceOutcome(lineWithParentMeta);
      const lineMeta = lineWithParentMeta.ai_document_metadata || {};
      const workflowRes = String(lineMeta.workflow_resolution || '').toLowerCase().trim();
      const dispLower = String(lineMeta.simple_rtv_disposition || pickup.disposition || line.disposition || report.disposition || '').toLowerCase().trim();
      const statusLower = String(line.status || report.status || '').toLowerCase().trim();

      const isRestocked =
        outcome.choiceKey === 'restock' ||
        workflowRes === 'restocked' ||
        statusLower === 'restocked';
      const isScrapped =
        outcome.choiceKey === 'scrap' ||
        workflowRes === 'reordered' ||
        workflowRes === 'scrapped_no_reorder' ||
        statusLower === 'scrapped' ||
        statusLower === 'disposed';
      const isReplaced =
        outcome.choiceKey === 'replacement' ||
        dispLower === 'supplier_exchange' ||
        dispLower === 'customer_exchange';
      const isReordered =
        workflowRes === 'reordered' ||
        getItemNeedsReorder(lineWithParentMeta) ||
        String(report.notes || '').includes('[REORDER: YES]');
      const isPickedUp = outcome.isPickedUp;

      const goodStockPcs = isRestocked ? totalPieces : 0;
      const badStockPcs = isRestocked ? 0 : totalPieces;

      const rawExp = line.expiry_date || line.ai_document_metadata?.expiry_date || report.expiry_date || meta.expiry_date || '';
      const expiryDate = formatDateYmd(rawExp);
      const pickupDateTime = isPickedUp && pickup.picked_up_at ? formatDateTimeYmdHm(pickup.picked_up_at) : '';
      const driverName = String(pickup.driver_name || '').trim();
      const driverIdStr = [pickup.driver_id_type, pickup.driver_license_no].filter(Boolean).join(': ');
      const truckPlate = String(pickup.truck_plate || '').trim();
      const driverAndPlate = [driverName, driverIdStr ? `[${driverIdStr}]` : '', truckPlate ? `(${truckPlate})` : ''].filter(Boolean).join(' ');
      const claimOrMemoNo = outcome.claimNumber || pickup.claim_number || linkedMemo || '';

      rows.push({
        serialNo: 0,
        category: '', // Always blank as required
        supplierName: supplierName ? String(supplierName).trim() : '',
        sku: cleanSku,
        description: desc,
        dailyPcs: { [reportDate]: totalPieces },
        totalInPeriod: totalPieces,
        badStockPcs,
        goodStockPcs,
        hubLabel,
        rmaId: rmaNumber,
        barcode: bc,
        dateReported,
        expiryDate,
        storeBranch: report.rma_type === 'supplier_outbound' ? '' : (report.store_branch || ''),
        reason: line.reason || report.reason || '',
        workflowOutcome: outcome.hasDecision ? outcome.label : 'Pending Decision',
        reordered: isReordered ? 'Yes' : 'No',
        restocked: isRestocked ? 'Yes' : 'No',
        scrapped: isScrapped ? 'Yes' : 'No',
        replaced: isReplaced ? 'Yes' : 'No',
        pickedUp: isPickedUp ? 'Yes' : 'No',
        pickupDateTime,
        driverAndPlate,
        claimOrMemoNo,
        totalValue: Number(lineTotal.toFixed(2)),
        _sortTs: new Date(report.created_at || report.updated_at || 0).getTime() || 0
      });
    });
  });

  // Sort chronological ascending (oldest -> newest) so Excel table reads naturally
  rows.sort((a, b) => a._sortTs - b._sortTs || a.rmaId.localeCompare(b.rmaId));

  if (includeZeroCatalogSkus && Array.isArray(catalogProducts)) {
    catalogProducts.forEach((p) => {
      const bc = String(p.barcode || '').trim();
      const cleanSku = getCleanSku(p.code || p.sku, bc);
      const key = (cleanSku || bc).toUpperCase();
      if (!key || seenSkuKeys.has(key)) return;
      seenSkuKeys.add(key);
      if (cleanSku) distinctSkuSet.add(cleanSku.toUpperCase());

      const supplierName = [p.supplier_name, p.supplierName].find((c) => !isPlaceholderSupplier(c)) || '';
      rows.push({
        serialNo: 0,
        category: '',
        supplierName: supplierName ? String(supplierName).trim() : '',
        sku: cleanSku,
        description: p.name || (bc ? `Barcode ${bc}` : 'Catalog Product'),
        dailyPcs: Object.create(null),
        totalInPeriod: 0,
        badStockPcs: 0,
        goodStockPcs: 0,
        hubLabel: '',
        rmaId: '',
        barcode: bc,
        dateReported: '',
        expiryDate: '',
        storeBranch: '',
        reason: '',
        workflowOutcome: '',
        reordered: '',
        restocked: '',
        scrapped: '',
        replaced: '',
        pickedUp: '',
        pickupDateTime: '',
        driverAndPlate: '',
        claimOrMemoNo: '',
        totalValue: 0,
        _sortTs: Number.MAX_SAFE_INTEGER
      });
    });
  }

  rows.forEach((r, idx) => {
    r.serialNo = idx + 1;
  });

  const grandTotalPcs = rows.reduce((sum, r) => sum + r.totalInPeriod, 0);
  const totalBadStockPcs = rows.reduce((sum, r) => sum + r.badStockPcs, 0);
  const totalGoodStockPcs = rows.reduce((sum, r) => sum + r.goodStockPcs, 0);
  const grandTotalValue = Number(rows.reduce((sum, r) => sum + r.totalValue, 0).toFixed(2));

  return {
    stream: normalizedStream,
    startDate: safeStart,
    endDate: safeEnd,
    allDates,
    weekBlocks,
    rows,
    lineCount: rows.length,
    monitoredSkuCount: distinctSkuSet.size || rows.length,
    grandTotalPcs,
    totalBadStockPcs,
    totalGoodStockPcs,
    grandTotalValue
  };
}

// ==========================================
// OOXML Styles & Sheet XML Builders
// ==========================================
function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="#,##0"/>
    <numFmt numFmtId="165" formatCode="#,##0.00"/>
  </numFmts>
  <fonts count="7">
    <font><sz val="10"/><color rgb="FF0F172A"/><name val="Arial"/></font>
    <font><b/><sz val="14"/><color rgb="FF0F172A"/><name val="Arial"/></font>
    <font><i/><sz val="10"/><color rgb="FF334155"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF14532D"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF1E3A5F"/><name val="Arial"/></font>
  </fonts>
  <fills count="10">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF9C3"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0284C7"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF14532D"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF312E81"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF334155"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FF94A3B8"/></left>
      <right style="thin"><color rgb="FF94A3B8"/></right>
      <top style="medium"><color rgb="FF1E3A5F"/></top>
      <bottom style="medium"><color rgb="FF1E3A5F"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="22">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="4" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="4" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="6" fillId="7" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="7" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="9" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="165" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="6" fillId="7" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  </cellXfs>
</styleSheet>`;
}

function inlineStrCell(ref, styleIdx, value) {
  return `<c r="${ref}" s="${styleIdx}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function numCell(ref, styleIdx, value) {
  return `<c r="${ref}" s="${styleIdx}"><v>${Number(value) || 0}</v></c>`;
}

function formulaNumCell(ref, styleIdx, formula, cachedVal) {
  return `<c r="${ref}" s="${styleIdx}"><f>${escapeXml(formula)}</f><v>${Number(cachedVal) || 0}</v></c>`;
}

/**
 * Generates the raw Uint8Array bytes of the Overall RMA Matrix .xlsx file.
 * Exported directly so automated verification can inspect ZIP + XML + formulas + totals.
 */
export function buildRmaMatrixXlsxBytes({
  reports = [],
  catalogProducts = [],
  creditMemos = [],
  stream = 'overall',
  isTestMode = false,
  startDate = '',
  endDate = '',
  includeAllRecords = false,
  includeZeroCatalogSkus = false
}) {
  const dataset = buildRmaMatrixDataset({
    reports,
    catalogProducts,
    creditMemos,
    stream,
    isTestMode,
    startDate,
    endDate,
    includeAllRecords,
    includeZeroCatalogSkus
  });

  const {
    stream: activeStream,
    startDate: sDate,
    endDate: eDate,
    weekBlocks,
    rows,
    lineCount,
    monitoredSkuCount,
    grandTotalPcs,
    grandTotalValue
  } = dataset;

  // Frozen Columns A..E (indices 0..4)
  const columns = [
    { kind: 'serial', header: 'Serial No.', width: 11, align: 'center' },
    { kind: 'category', header: 'Category', width: 14, align: 'left' },
    { kind: 'supplier', header: 'Supplier Name', width: 28, align: 'left' },
    { kind: 'sku', header: 'SKU', width: 16, align: 'left' },
    { kind: 'desc', header: 'Description', width: 40, align: 'left' }
  ];

  const firstDailySectionCol = columns.length; // Col F (idx 5)
  const weekMeta = [];
  const weekTotalCols = [];

  weekBlocks.forEach((wb, wIdx) => {
    const startCol = columns.length;
    wb.dates.forEach((ymd) => {
      columns.push({ kind: 'date', ymd, header: ymd, width: 13, outlineLevel: 1 });
    });
    const lastDateCol = columns.length - 1;
    const weekTotalCol = columns.length;
    columns.push({
      kind: 'weekTotal',
      header: 'Week total (pcs)',
      width: 16,
      startDateCol: startCol,
      endDateCol: lastDateCol
    });
    weekTotalCols.push(weekTotalCol);
    weekMeta.push({
      label: wb.label,
      startCol,
      endCol: weekTotalCol,
      bannerStyle: wIdx % 2 === 0 ? 3 : 4
    });
  });

  const lastDailySectionCol = columns.length - 1;
  const grandTotalCol = columns.length;
  columns.push({ kind: 'grandTotal', header: 'Total pcs returned', width: 19 });

  const badStockCol = columns.length;
  columns.push({ kind: 'badStock', header: 'Return Bad Stock (pcs)', width: 21 });
  const goodStockCol = columns.length;
  columns.push({ kind: 'goodStock', header: 'Return Good Stock (pcs)', width: 21 });

  const detailStartCol = columns.length;
  const detailCols = [
    { kind: 'detail', field: 'hubLabel', header: 'Source / Hub', width: 16, align: 'center' },
    { kind: 'detail', field: 'rmaId', header: 'RMA ID', width: 22, align: 'left' },
    { kind: 'detail', field: 'barcode', header: 'Barcode', width: 18, align: 'left' },
    { kind: 'detail', field: 'dateReported', header: 'Date Reported (YYYY-MM-DD HH:mm)', width: 24, align: 'left' },
    { kind: 'detail', field: 'expiryDate', header: 'Expiry Date (YYYY-MM-DD)', width: 21, align: 'center' },
    { kind: 'detail', field: 'storeBranch', header: 'Store / Branch', width: 24, align: 'left' },
    { kind: 'detail', field: 'reason', header: 'Defect / Return Reason', width: 28, align: 'left' },
    { kind: 'detail', field: 'workflowOutcome', header: 'Workflow Outcome', width: 32, align: 'left' },
    { kind: 'detail', field: 'reordered', header: 'Re-Ordered?', width: 13, align: 'center' },
    { kind: 'detail', field: 'restocked', header: 'Restocked?', width: 13, align: 'center' },
    { kind: 'detail', field: 'scrapped', header: 'Scrapped?', width: 13, align: 'center' },
    { kind: 'detail', field: 'replaced', header: 'Replaced?', width: 13, align: 'center' },
    { kind: 'detail', field: 'pickedUp', header: 'Picked Up by Driver?', width: 19, align: 'center' },
    { kind: 'detail', field: 'pickupDateTime', header: 'Driver Pickup Date & Time (YYYY-MM-DD HH:mm)', width: 28, align: 'left' },
    { kind: 'detail', field: 'driverAndPlate', header: 'Driver Name & Truck Plate #', width: 28, align: 'left' },
    { kind: 'detail', field: 'claimOrMemoNo', header: 'Debit Claim / Credit Memo #', width: 24, align: 'left' },
    { kind: 'totalValue', field: 'totalValue', header: 'Total Value (PHP)', width: 18, align: 'right' }
  ];
  columns.push(...detailCols);

  const lastColIdx = columns.length - 1;
  const lastColLetter = colToLetter(lastColIdx);
  const grandTotalLetter = colToLetter(grandTotalCol);

  const scopeLabel = activeStream === 'supplier_outbound'
    ? 'SUPPLIER RTV'
    : activeStream === 'customer_inbound'
      ? 'CUSTOMER HUB'
      : 'OVERALL RMA (CUSTOMER HUB + SUPPLIER RTV)';
  const modePrefix = isTestMode ? 'TEST MODE SANDBOX — ' : '';
  const row1Title = `${modePrefix}${scopeLabel} MATRIX REPORT`;
  const row2Meta = `Generated: ${formatManilaTimestampDisplay()} | Period (YYYY-MM-DD): ${sDate} to ${eDate} | Line Items: ${lineCount} | SKUs: ${monitoredSkuCount} | Total Returned: ${grandTotalPcs.toLocaleString()} pcs | Total Value: PHP ${grandTotalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const sheetRows = [];
  const merges = [];

  // Row 1: Title
  sheetRows.push(`<row r="1" ht="24" customHeight="1">${inlineStrCell('A1', 1, row1Title)}</row>`);

  // Row 2: Yellow Metadata Strip A2..lastCol2
  const r2Cells = [inlineStrCell('A2', 2, row2Meta)];
  for (let c = 1; c <= lastColIdx; c++) {
    r2Cells.push(`<c r="${colToLetter(c)}2" s="2"/>`);
  }
  sheetRows.push(`<row r="2" ht="18" customHeight="1">${r2Cells.join('')}</row>`);
  if (lastColIdx > 0) merges.push(`A2:${lastColLetter}2`);

  // Row 3 & Row 4: Banners
  const r3Map = new Map();
  const r4Map = new Map();

  // Frozen A..E banner (A3:E4)
  r3Map.set(0, inlineStrCell('A3', 3, 'FROZEN PRODUCT MASTER (A..E)'));
  for (let c = 1; c <= 4; c++) r3Map.set(c, `<c r="${colToLetter(c)}3" s="3"/>`);
  for (let c = 0; c <= 4; c++) r4Map.set(c, `<c r="${colToLetter(c)}4" s="3"/>`);
  merges.push('A3:E4');

  // Daily section banner row 3 + Alternating Navy/Sky Blue week blocks row 4
  if (lastDailySectionCol >= firstDailySectionCol) {
    r3Map.set(firstDailySectionCol, inlineStrCell(`${colToLetter(firstDailySectionCol)}3`, 16, 'DAILY RETURNED PIECES (YYYY-MM-DD)'));
    for (let c = firstDailySectionCol + 1; c <= lastDailySectionCol; c++) {
      r3Map.set(c, `<c r="${colToLetter(c)}3" s="16"/>`);
    }
    if (lastDailySectionCol > firstDailySectionCol) {
      merges.push(`${colToLetter(firstDailySectionCol)}3:${colToLetter(lastDailySectionCol)}3`);
    }

    weekMeta.forEach((wm) => {
      const sRef = `${colToLetter(wm.startCol)}4`;
      const eRef = `${colToLetter(wm.endCol)}4`;
      r4Map.set(wm.startCol, inlineStrCell(sRef, wm.bannerStyle, wm.label));
      for (let c = wm.startCol + 1; c <= wm.endCol; c++) {
        r4Map.set(c, `<c r="${colToLetter(c)}4" s="${wm.bannerStyle}"/>`);
      }
      if (wm.endCol > wm.startCol) {
        merges.push(`${sRef}:${eRef}`);
      }
    });
  }

  // Green TOTAL banner across row 3-4 above Total pcs returned
  r3Map.set(grandTotalCol, inlineStrCell(`${grandTotalLetter}3`, 5, 'TOTAL'));
  r4Map.set(grandTotalCol, `<c r="${grandTotalLetter}4" s="5"/>`);
  merges.push(`${grandTotalLetter}3:${grandTotalLetter}4`);

  // Danilo RMA / RMA banner above Return Bad Stock (pcs) & Return Good Stock (pcs)
  r3Map.set(badStockCol, inlineStrCell(`${colToLetter(badStockCol)}3`, 15, 'Danilo RMA'));
  r3Map.set(goodStockCol, `<c r="${colToLetter(goodStockCol)}3" s="15"/>`);
  merges.push(`${colToLetter(badStockCol)}3:${colToLetter(goodStockCol)}3`);
  r4Map.set(badStockCol, inlineStrCell(`${colToLetter(badStockCol)}4`, 4, 'RMA'));
  r4Map.set(goodStockCol, `<c r="${colToLetter(goodStockCol)}4" s="4"/>`);
  merges.push(`${colToLetter(badStockCol)}4:${colToLetter(goodStockCol)}4`);

  // Right-side 17 columns banner row 3-4: RMA ITEM DETAILS & WORKFLOW STATUS
  r3Map.set(detailStartCol, inlineStrCell(`${colToLetter(detailStartCol)}3`, 16, 'RMA ITEM DETAILS & WORKFLOW STATUS'));
  for (let c = detailStartCol + 1; c <= lastColIdx; c++) {
    r3Map.set(c, `<c r="${colToLetter(c)}3" s="16"/>`);
  }
  for (let c = detailStartCol; c <= lastColIdx; c++) {
    r4Map.set(c, `<c r="${colToLetter(c)}4" s="16"/>`);
  }
  if (lastColIdx > detailStartCol) {
    merges.push(`${colToLetter(detailStartCol)}3:${lastColLetter}4`);
  }

  const r3Cells = [];
  const r4Cells = [];
  for (let c = 0; c <= lastColIdx; c++) {
    r3Cells.push(r3Map.get(c) || `<c r="${colToLetter(c)}3" s="3"/>`);
    r4Cells.push(r4Map.get(c) || `<c r="${colToLetter(c)}4" s="3"/>`);
  }
  sheetRows.push(`<row r="3" ht="20" customHeight="1">${r3Cells.join('')}</row>`);
  sheetRows.push(`<row r="4" ht="20" customHeight="1">${r4Cells.join('')}</row>`);

  // Row 5: Column Headers
  const r5Cells = columns.map((col, cIdx) => {
    const style = (col.kind === 'date' || col.kind === 'weekTotal' || col.kind === 'grandTotal' || col.kind === 'badStock' || col.kind === 'goodStock' || col.kind === 'totalValue')
      ? 21
      : (col.align === 'center' ? 21 : 6);
    return inlineStrCell(`${colToLetter(cIdx)}5`, style, col.header);
  });
  sheetRows.push(`<row r="5" ht="26" customHeight="1">${r5Cells.join('')}</row>`);

  // Data Rows starting at Row 6
  const firstDataRow = 6;
  rows.forEach((entry, rIdx) => {
    const rowNum = firstDataRow + rIdx;
    const cells = [];

    columns.forEach((col, cIdx) => {
      const ref = `${colToLetter(cIdx)}${rowNum}`;
      if (col.kind === 'serial') {
        cells.push(numCell(ref, 17, entry.serialNo));
      } else if (col.kind === 'category') {
        cells.push(inlineStrCell(ref, 8, '')); // Strictly blank
      } else if (col.kind === 'supplier') {
        cells.push(inlineStrCell(ref, 8, entry.supplierName));
      } else if (col.kind === 'sku') {
        cells.push(inlineStrCell(ref, 8, entry.sku)); // Strictly "" when unassigned
      } else if (col.kind === 'desc') {
        cells.push(inlineStrCell(ref, 8, entry.description));
      } else if (col.kind === 'date') {
        const val = entry.dailyPcs[col.ymd] || 0;
        cells.push(numCell(ref, val > 0 ? 10 : 9, val));
      } else if (col.kind === 'weekTotal') {
        const weekDates = weekBlocks.find((_, wIdx) => weekTotalCols[wIdx] === cIdx)?.dates || [];
        const cachedWeekSum = weekDates.reduce((s, d) => s + (entry.dailyPcs[d] || 0), 0);
        const startL = colToLetter(col.startDateCol);
        const endL = colToLetter(col.endDateCol);
        const formula = startL === endL
          ? `${startL}${rowNum}`
          : `SUM(${startL}${rowNum}:${endL}${rowNum})`;
        cells.push(formulaNumCell(ref, 11, formula, cachedWeekSum));
      } else if (col.kind === 'grandTotal') {
        const refs = weekTotalCols.map((wtIdx) => `${colToLetter(wtIdx)}${rowNum}`);
        const formula = refs.length > 0 ? `SUM(${refs.join(',')})` : '0';
        cells.push(formulaNumCell(ref, 12, formula, entry.totalInPeriod));
      } else if (col.kind === 'badStock') {
        cells.push(numCell(ref, entry.badStockPcs > 0 ? 10 : 9, entry.badStockPcs));
      } else if (col.kind === 'goodStock') {
        cells.push(numCell(ref, entry.goodStockPcs > 0 ? 10 : 9, entry.goodStockPcs));
      } else if (col.kind === 'totalValue') {
        cells.push(numCell(ref, 19, entry.totalValue));
      } else if (col.kind === 'detail') {
        const styleIdx = col.align === 'center' ? 18 : 8;
        cells.push(inlineStrCell(ref, styleIdx, entry[col.field] ?? ''));
      }
    });

    sheetRows.push(`<row r="${rowNum}" ht="19" customHeight="1">${cells.join('')}</row>`);
  });

  // Grand Totals Footer Row with Excel =SUM(...) formulas
  const footerRowNum = firstDataRow + rows.length;
  const lastDataRow = Math.max(firstDataRow, footerRowNum - 1);
  const footerCells = columns.map((col, cIdx) => {
    const L = colToLetter(cIdx);
    const ref = `${L}${footerRowNum}`;
    if (col.kind === 'serial') return inlineStrCell(ref, 14, 'TOTAL');
    if (col.kind === 'desc') {
      return inlineStrCell(ref, 14, `${lineCount} Line Item(s) • ${monitoredSkuCount} SKU(s) (${sDate} to ${eDate})`);
    }
    if (col.kind === 'category' || col.kind === 'supplier' || col.kind === 'sku' || col.kind === 'detail') {
      return `<c r="${ref}" s="14"/>`;
    }

    let cachedColSum = 0;
    if (col.kind === 'date') {
      cachedColSum = rows.reduce((s, r) => s + (r.dailyPcs[col.ymd] || 0), 0);
    } else if (col.kind === 'weekTotal') {
      const weekDates = weekBlocks.find((_, wIdx) => weekTotalCols[wIdx] === cIdx)?.dates || [];
      cachedColSum = rows.reduce(
        (s, r) => s + weekDates.reduce((ws, d) => ws + (r.dailyPcs[d] || 0), 0),
        0
      );
    } else if (col.kind === 'grandTotal') {
      cachedColSum = grandTotalPcs;
    } else if (col.kind === 'badStock') {
      cachedColSum = dataset.totalBadStockPcs;
    } else if (col.kind === 'goodStock') {
      cachedColSum = dataset.totalGoodStockPcs;
    } else if (col.kind === 'totalValue') {
      cachedColSum = grandTotalValue;
    }

    const formula = rows.length > 0 ? `SUM(${L}${firstDataRow}:${L}${lastDataRow})` : '0';
    return formulaNumCell(ref, col.kind === 'totalValue' ? 20 : 13, formula, cachedColSum);
  });
  sheetRows.push(`<row r="${footerRowNum}" ht="22" customHeight="1">${footerCells.join('')}</row>`);

  const colsXml = `<cols>${columns.map((col, idx) => {
    const n = idx + 1;
    const outlineAttr = col.outlineLevel ? ` outlineLevel="${col.outlineLevel}"` : '';
    return `<col min="${n}" max="${n}" width="${col.width}" customWidth="1"${outlineAttr}/>`;
  }).join('')}</cols>`;

  const mergeXml = merges.length > 0
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
    : '';

  // frozenRows=5, frozenColumns=5 (A..E + rows 1..5 frozen -> topLeftCell="F6")
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView tabSelected="1" workbookViewId="0">
      <pane xSplit="5" ySplit="5" topLeftCell="F6" activePane="bottomRight" state="frozen"/>
      <selection pane="bottomRight" activeCell="F6" sqref="F6"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="19" outlineLevelCol="1"/>
  ${colsXml}
  <sheetData>
    ${sheetRows.join('\n    ')}
  </sheetData>
  ${mergeXml}
</worksheet>`;

  const rawSheetTabName = activeStream === 'supplier_outbound'
    ? (isTestMode ? 'Test Supplier RTV Matrix' : 'Supplier RTV Matrix')
    : activeStream === 'customer_inbound'
      ? (isTestMode ? 'Test Customer Hub Matrix' : 'Customer Hub Matrix')
      : (isTestMode ? 'Test Overall RMA Matrix' : 'Overall RMA Matrix');
  const sheetTabName = rawSheetTabName.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Matrix';

  // Keep OPC package/relationship XML compact (zero inter-element newlines/indentation inside
  // <Types> or <Relationships>) so desktop Microsoft Excel's strict OPC parser opens it cleanly.
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetTabName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const wbRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  const bytes = buildStoredZip([
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: rootRelsXml },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', content: wbRelsXml },
    { name: 'xl/styles.xml', content: buildStylesXml() },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml }
  ]);

  return { bytes, dataset };
}

/**
 * Generates and downloads the real Overall RMA Matrix .xlsx file in the browser.
 */
export function downloadRmaMatrixXlsx(options) {
  const { bytes, dataset } = buildRmaMatrixXlsxBytes(options);
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  const prefix = options.isTestMode ? 'TEST_' : '';
  const ts = formatSaveFileTimestamp(new Date());
  const streamTag = dataset.stream === 'supplier_outbound'
    ? 'Supplier_RTV_Matrix_Report'
    : dataset.stream === 'customer_inbound'
      ? 'Customer_Hub_Matrix_Report'
      : 'Overall_RMA_Matrix_Report';
  const filename = `${prefix}${streamTag}_${dataset.startDate}_to_${dataset.endDate} ${ts}.xlsx`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return { filename, dataset };
}
