import { supabase } from '../../_lib/supabase.js';
import { requireApiKey, sendJson, setCorsHeaders } from '../../_lib/auth.js';

const getItemNeedsReorder = (item) => {
  if (item?.needs_reorder !== undefined && item?.needs_reorder !== null) {
    return Boolean(item.needs_reorder);
  }
  if (item?.ai_document_metadata?.needs_reorder !== undefined && item?.ai_document_metadata?.needs_reorder !== null) {
    return Boolean(item.ai_document_metadata.needs_reorder);
  }
  const notes = String(item?.notes || '');
  if (notes.includes('[REORDER: NO]')) return false;
  if (notes.includes('[REORDER: YES]')) return true;
  return true;
};

const getRecoverySource = (item) => {
  const disp = String(item?.disposition || '').toLowerCase();
  if (disp.includes('buffer')) return 'buffer_swap';
  if (disp.includes('rtv') || disp.includes('vendor') || item?.rma_type === 'supplier_outbound') return 'vendor_rtv';
  return 'scrap';
};

function normalizeWarehouseLocation(loc, item = null) {
  const raw = String(loc || '').trim();
  const isSupplierOutbound = item?.rma_type === 'supplier_outbound' || 
    String(item?.disposition || '').toLowerCase().includes('rtv') || 
    String(item?.disposition || '').toLowerCase().includes('vendor');

  if (!raw || raw === '—' || raw === 'N/A' || raw.toLowerCase() === 'dock' || raw.toLowerCase() === 'dock-intake' || raw.toLowerCase() === 'rtv-dock') {
    return isSupplierOutbound ? 'Supplier Return Area (RTV)' : 'Receiving Area';
  }

  const upper = raw.toUpperCase();
  if (upper.includes('SCRAP') || upper.includes('DISPOS')) return 'Disposal / Scrap Area';
  if (upper.includes('QUARANTINE') || upper.includes('HOLD') || upper.includes('INSPECT')) return 'Hold / Inspection Area';
  if (upper.includes('OUTBOUND-RETURN') || upper.includes('CUSTOMER RETURN') || upper.includes('STORE')) return 'Customer Return Area';
  if (upper.includes('GOOD STOCK') || upper.includes('SHELF') || upper.includes('RESTOCK')) return 'Good Stock Area';
  if (upper.includes('SUPPLIER') || upper.includes('RTV') || upper.includes('VENDOR')) return 'Supplier Return Area (RTV)';
  if (upper.includes('RECEIV') || upper.includes('DOCK')) return 'Receiving Area';

  return raw;
}

function isTestRecord(item) {
  if (!item) return false;
  return Boolean(
    item.is_test === true ||
    item.ai_document_metadata?.is_test === true ||
    String(item.notes || '').includes('[TEST_MODE]')
  );
}

function isTrashedRecord(item) {
  if (!item) return false;
  return Boolean(
    item.is_trashed === true ||
    item.ai_document_metadata?.is_trashed === true ||
    String(item.notes || '').includes('[TRASHED]')
  );
}

function isArchivedRecord(item) {
  if (!item) return false;
  if (isTrashedRecord(item)) return false;
  return Boolean(
    item.is_archived === true ||
    item.ai_document_metadata?.is_archived === true ||
    String(item.notes || '').includes('[ARCHIVED]')
  );
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. Authenticate API Key
  const client = await requireApiKey(req, res);
  if (!client) return; // Response already sent by middleware

  // 2. GET: List RMA Reports with query filters & dedicated coworker queues
  if (req.method === 'GET') {
    try {
      const { 
        rma_type, 
        status, 
        barcode, 
        search, 
        disposition, 
        condition_grade, 
        warehouse_location, 
        queue, 
        is_parent, 
        test_mode,
        is_test,
        lifecycle = 'active',
        limit = '50', 
        offset = '0' 
      } = req.query;

      const isTestModeRequested = test_mode === 'true' || is_test === 'true' || req.headers['x-test-mode'] === 'true';

      const numLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
      const numOffset = Math.max(parseInt(offset, 10) || 0, 0);

      // Fetch reports and catalog products for accurate SKU/location enrichment and manifest unpacking
      const [{ data: rawReports, error }, { data: catalogProducts }] = await Promise.all([
        supabase.from('rma_reports').select('*').order('created_at', { ascending: false }),
        supabase.from('products').select('barcode, code, name, supplier_name, price, price_with_vat, pieces_per_case')
      ]);

      if (error) {
        console.error('[API v1 RMA GET] Query error:', error);
        return sendJson(res, 500, {
          success: false,
          error: 'DATABASE_ERROR',
          message: error.message
        });
      }

      const productByBarcode = new Map();
      (catalogProducts || []).forEach(p => {
        if (p && p.barcode) {
          productByBarcode.set(String(p.barcode).trim(), p);
        }
      });

      const allRows = Array.isArray(rawReports) ? rawReports : [];
      const unpackedList = [];
      const seenManifestLineKeys = new Set();

      // If caller explicitly requests is_parent=true, only return parent manifest container rows
      if (is_parent === 'true') {
        allRows.forEach(r => {
          if (r && r.is_parent === true) {
            unpackedList.push(r);
          }
        });
      } else {
        // First pass: unpack parent batch manifests into individual line items with real SKUs, names, quantities, and warehouse_location
        allRows.forEach(r => {
          if (!r) return;
          let parsedItems = [];
          if (Array.isArray(r.items) && r.items.length > 0) {
            parsedItems = r.items;
          } else if (typeof r.items === 'string' && r.items.trim()) {
            try {
              const p = JSON.parse(r.items);
              if (Array.isArray(p)) parsedItems = p;
            } catch (e) {}
          }

          const isManifestParent = Boolean(
            r.is_parent === true ||
            parsedItems.length > 1 ||
            String(r.name || '').toLowerCase().startsWith('batch return manifest')
          );

          if (isManifestParent) {
            parsedItems.forEach((child, idx) => {
              const cBarcode = String(child.barcode || '').trim();
              const matchedProd = cBarcode ? productByBarcode.get(cBarcode) : null;
              const rawSku = String(child.code || child.sku || matchedProd?.code || '').trim();
              const validSku = (rawSku && rawSku !== cBarcode && !rawSku.toLowerCase().includes('awaiting')) ? rawSku : null;
              const cName = (child.name || child.productName || matchedProd?.name || `Item #${idx + 1}`).trim();
              const lineKey = `${r.rma_number}::${cBarcode || idx}::${idx}`;
              seenManifestLineKeys.add(`${r.rma_number}::${cBarcode}`);

              // Look up if there is also a separate child row in rma_reports for this barcode to merge latest status/location
              const matchingChildRow = allRows.find(other => (
                other &&
                other.id !== r.id &&
                !other.is_parent &&
                other.rma_number === r.rma_number &&
                String(other.barcode || '').trim() === cBarcode
              ));

              const effectiveStatus = child.status || matchingChildRow?.status || (
                (r.status === 'restocked' || r.status === 'scrapped' || r.status === 'closed')
                  ? r.status
                  : 'under_inspection'
              );
              const effectiveDisposition = child.disposition || matchingChildRow?.disposition || r.disposition || '1- Pending Triage';
              const effectiveLocation = child.warehouse_location || matchingChildRow?.warehouse_location || r.warehouse_location || null;

              unpackedList.push({
                ...r,
                ...child,
                id: matchingChildRow?.id || r.id,
                manifest_item_id: child.id || lineKey,
                parent_rma_id: r.id,
                is_parent: false,
                is_unpacked_manifest_item: true,
                rma_number: r.rma_number,
                barcode: cBarcode || r.barcode,
                sku: validSku,
                code: validSku,
                name: cName,
                quantity: Number(child.quantity || child.qty) || 1,
                unit_name: child.unit_name || child.unit || r.unit_name || 'pc',
                pieces_per_case: child.pieces_per_case || child.piecesPerCase || matchedProd?.pieces_per_case || null,
                supplier_name: (child.supplier_name && child.supplier_name !== 'Pending Assignment')
                  ? child.supplier_name
                  : (matchedProd?.supplier_name || r.supplier_name || 'Pending Assignment'),
                price: Number(child.price_with_vat || child.price || matchedProd?.price_with_vat || matchedProd?.price || 0),
                condition_grade: child.condition_grade || matchingChildRow?.condition_grade || r.condition_grade || 'B - Damaged Packaging Only',
                disposition: effectiveDisposition,
                warehouse_location: effectiveLocation,
                status: effectiveStatus,
                items: undefined
              });
            });
          }
        });

        // Second pass: add standalone single-item tickets (and any child rows not already unpacked from a parent's items array)
        allRows.forEach(r => {
          if (!r) return;
          const isManifestParent = Boolean(
            r.is_parent === true ||
            (Array.isArray(r.items) && r.items.length > 1) ||
            String(r.name || '').toLowerCase().startsWith('batch return manifest')
          );
          if (isManifestParent) return; // Never push generic parent manifest container

          const rBarcode = String(r.barcode || '').trim();
          const dedupKey = `${r.rma_number}::${rBarcode}`;
          // Skip if already unpacked from parent manifest items array (prevents double-counting)
          if (seenManifestLineKeys.has(dedupKey) && !/-[B-Z]$/i.test(String(r.rma_number || ''))) {
            return;
          }

          const matchedProd = rBarcode ? productByBarcode.get(rBarcode) : null;
          const rawSku = String(r.code || r.sku || matchedProd?.code || '').trim();
          const validSku = (rawSku && rawSku !== rBarcode && !rawSku.toLowerCase().includes('awaiting')) ? rawSku : null;

          unpackedList.push({
            ...r,
            sku: validSku,
            code: validSku,
            name: (r.name && !String(r.name).toLowerCase().includes('unidentified'))
              ? r.name
              : (matchedProd?.name || r.name),
            supplier_name: (r.supplier_name && r.supplier_name !== 'Pending Assignment')
              ? r.supplier_name
              : (matchedProd?.supplier_name || r.supplier_name || 'Pending Assignment'),
            price: Number(r.price_with_vat || r.price || matchedProd?.price_with_vat || matchedProd?.price || 0),
            warehouse_location: r.warehouse_location || null,
            batch_lot_number: r.batch_lot_number || null
          });
        });
      }

      // Apply filters on unpacked items
      const FINALIZED_RESTOCK = new Set(['restocked', 'closed', 'resolved', 'scrapped', 'disposed', 'rejected', 'deleted']);
      const FINALIZED_SCRAP = new Set(['scrapped', 'disposed', 'closed', 'resolved', 'restocked', 'rejected', 'deleted']);

      const filtered = unpackedList.filter(item => {
        // Scope filter: Live Production vs Sandbox Test Mode
        const itemIsTest = isTestRecord(item);
        if (isTestModeRequested && !itemIsTest) return false;
        if (!isTestModeRequested && itemIsTest) return false;

        // Lifecycle filter: active vs archived vs trashed
        const itemIsTrashed = isTrashedRecord(item);
        const itemIsArchived = isArchivedRecord(item);
        if (lifecycle === 'trashed') {
          if (!itemIsTrashed) return false;
        } else if (lifecycle === 'archived') {
          if (!itemIsArchived) return false;
        } else {
          // default 'active'
          if (itemIsTrashed || itemIsArchived) return false;
        }

        if (rma_type && item.rma_type !== rma_type) return false;
        if (barcode && String(item.barcode || '').trim() !== String(barcode).trim()) return false;

        const itemDisp = String(item.disposition || '').toLowerCase();
        const itemStatus = String(item.status || 'received_at_dock').toLowerCase().trim();

        // Unified 5-Queue Filtering (restock, reorder, scrap_no_reorder, quarantine, rejected)
        if (queue) {
          const cleanQueue = String(queue).trim().toLowerCase();
          const needsReorderFlag = getItemNeedsReorder(item);

          if (cleanQueue === 'restock') {
            const isRestockDisp = itemDisp.includes('restock') || itemDisp.includes('replacement stock received');
            if (!isRestockDisp) return false;
            if (FINALIZED_RESTOCK.has(itemStatus) || item.ai_document_metadata?.workflow_resolution) return false;
          } else if (cleanQueue === 'reorder' || cleanQueue === 'scrap' || cleanQueue === 'scrapped') {
            const isLossDisp = itemDisp.includes('scrap') || itemDisp.includes('dispose') || itemDisp.includes('reorder') || itemDisp.includes('rtv') || itemDisp.includes('vendor') || itemDisp.includes('buffer') || itemDisp.includes('claim rejected by vendor') || itemDisp.includes('pending vendor pickup');
            const isExcluded = itemDisp.includes('restock') || itemDisp.includes('replacement stock received') || itemDisp.includes('quarantine') || itemDisp.includes('hold') || itemStatus === 'rejected' || itemDisp.includes('8- rejected');
            if (!isLossDisp || isExcluded) return false;
            if (needsReorderFlag === false) return false;
            if (FINALIZED_SCRAP.has(itemStatus) || item.ai_document_metadata?.workflow_resolution) return false;
          } else if (cleanQueue === 'scrap_no_reorder') {
            const isLossDisp = itemDisp.includes('scrap') || itemDisp.includes('dispose') || itemDisp.includes('reorder') || itemDisp.includes('rtv') || itemDisp.includes('vendor') || itemDisp.includes('buffer') || itemDisp.includes('claim rejected by vendor') || itemDisp.includes('pending vendor pickup');
            const isExcluded = itemDisp.includes('restock') || itemDisp.includes('replacement stock received') || itemDisp.includes('quarantine') || itemDisp.includes('hold') || itemStatus === 'rejected' || itemDisp.includes('8- rejected');
            if (!isLossDisp || isExcluded) return false;
            if (needsReorderFlag !== false) return false;
            if (FINALIZED_SCRAP.has(itemStatus) || item.ai_document_metadata?.workflow_resolution) return false;
          } else if (cleanQueue === 'rtv_debit' || cleanQueue === 'rtv') {
            const isRtv = itemDisp.includes('rtv') || itemDisp.includes('return to vendor') || itemDisp.includes('vendor') || item.rma_type === 'supplier_outbound';
            if (!isRtv) return false;
            if (['closed', 'resolved', 'rejected', 'deleted', 'restocked', 'scrapped', 'disposed'].includes(itemStatus)) return false;
          } else if (cleanQueue === 'quarantine' || cleanQueue === 'hold') {
            const isHold = itemDisp.includes('quarantine') || itemDisp.includes('hold') || itemStatus === 'quarantine' || itemStatus === 'hold';
            if (!isHold) return false;
            if (['closed', 'resolved', 'rejected', 'deleted'].includes(itemStatus)) return false;
          } else if (cleanQueue === 'rejected') {
            const isRejected = itemStatus === 'rejected' || itemDisp.includes('rejected') || itemDisp.includes('claim rejected by vendor');
            if (!isRejected) return false;
            if (['closed', 'resolved', 'deleted'].includes(itemStatus)) return false;
          }
        }

        // Status filter
        if (status) {
          const cleanStatus = String(status).trim().toLowerCase();
          if (cleanStatus === 'pending' || cleanStatus === 'open') {
            if (FINALIZED_RESTOCK.has(itemStatus)) return false;
          } else if (cleanStatus === 'restocked') {
            if (!['restocked', 'closed', 'resolved'].includes(itemStatus)) return false;
          } else if (cleanStatus === 'scrapped' || cleanStatus === 'disposed') {
            if (!['scrapped', 'disposed'].includes(itemStatus)) return false;
          } else if (itemStatus !== cleanStatus) {
            return false;
          }
        }

        // Disposition filter
        if (disposition) {
          const cleanDisp = String(disposition).trim().toLowerCase();
          if (cleanDisp.includes('restock')) {
            if (!itemDisp.includes('restock')) return false;
            if (!status && !queue && FINALIZED_RESTOCK.has(itemStatus)) return false;
          } else if (cleanDisp.includes('scrap') || cleanDisp.includes('dispose')) {
            if (!itemDisp.includes('scrap') && !itemDisp.includes('dispose')) return false;
            if (!status && !queue && FINALIZED_SCRAP.has(itemStatus)) return false;
          } else if (cleanDisp.includes('rtv') || cleanDisp.includes('return to vendor')) {
            if (!itemDisp.includes('rtv') && !itemDisp.includes('return to vendor') && !itemDisp.includes('vendor')) return false;
          } else if (!itemDisp.includes(cleanDisp)) {
            return false;
          }
        }

        if (condition_grade) {
          if (!String(item.condition_grade || '').toLowerCase().includes(String(condition_grade).trim().toLowerCase())) {
            return false;
          }
        }

        if (warehouse_location) {
          if (!String(item.warehouse_location || '').toLowerCase().includes(String(warehouse_location).trim().toLowerCase())) {
            return false;
          }
        }

        if (search) {
          const q = String(search).trim().toLowerCase();
          const matches = (
            String(item.name || '').toLowerCase().includes(q) ||
            String(item.code || item.sku || '').toLowerCase().includes(q) ||
            String(item.barcode || '').toLowerCase().includes(q) ||
            String(item.rma_number || '').toLowerCase().includes(q) ||
            String(item.reporter_name || '').toLowerCase().includes(q) ||
            String(item.warehouse_location || '').toLowerCase().includes(q)
          );
          if (!matches) return false;
        }

        return true;
      });

      const paginatedData = filtered.slice(numOffset, numOffset + numLimit);
      const enrichedData = paginatedData.map(item => {
        const needsReorder = getItemNeedsReorder(item);
        const itemObj = {
          ...item,
          needs_reorder: needsReorder
        };
        const cleanQueue = queue ? String(queue).trim().toLowerCase() : '';
        if (cleanQueue === 'reorder' || cleanQueue === 'scrap' || cleanQueue === 'scrapped') {
          itemObj.recovery_source = getRecoverySource(item);
        }
        return itemObj;
      });

      return sendJson(res, 200, {
        success: true,
        client: client.name,
        queue: queue || null,
        total: filtered.length,
        limit: numLimit,
        offset: numOffset,
        data: enrichedData
      });
    } catch (err) {
      console.error('[API v1 RMA GET] Server error:', err);
      return sendJson(res, 500, {
        success: false,
        error: 'SERVER_ERROR',
        message: err.message
      });
    }
  }

  // 3. POST: Create new RMA Report from client system
  if (req.method === 'POST') {
    try {
      let body = req.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch (e) {}
      }

      const {
        barcode,
        name,
        rma_type = 'customer_inbound',
        code,
        quantity = 1,
        supplier_name,
        price = 0,
        price_with_vat = 0,
        unit_name = 'pc',
        status = 'received_at_dock',
        condition_grade = 'B - Damaged Packaging Only',
        disposition = 'Pending Triage',
        warehouse_location,
        inspected_by,
        reason = 'Damaged Box / Crushed Packaging',
        explanation,
        photos = [],
        reporter_name,
        reporter_contact,
        ae_name,
        ae_email,
        store_branch,
        invoice_dr_number,
        si_number,
        dr_number,
        po_number,
        expiry_date,
        batch_lot_number,
        notes
      } = body || {};

      if (!barcode || !name) {
        return sendJson(res, 400, {
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Both "barcode" and "name" are required fields.'
        });
      }

      // Mandatory Expiration Date across Customer Hub & Supplier RTV
      if (!expiry_date || !String(expiry_date).trim()) {
        return sendJson(res, 400, {
          success: false,
          error: 'MISSING_EXPIRY_DATE',
          message: 'Product expiration date ("expiry_date") is mandatory for all RMA reports across Customer Hub and Supplier RTV.'
        });
      }

      const isTestMode = Boolean(body?.is_test === true || req.query.test_mode === 'true' || req.query.is_test === 'true' || req.headers['x-test-mode'] === 'true');

      // Standardized Unique RMA Number with Complete Sequence Isolation:
      // Live: RMA-[YEAR]-[4-DIGIT-ASCENDING]-[4-CHAR-ALPHANUMERIC] (e.g. RMA-2026-0001-6TYH)
      // Test: RMA-TEST-[YEAR]-[4-DIGIT-ASCENDING]-[4-CHAR-ALPHANUMERIC] (e.g. RMA-TEST-2026-0001-6TYH)
      const currentYear = new Date().getFullYear();
      let nextSeq = 1;
      try {
        let countQuery = supabase.from('rma_reports').select('*', { count: 'exact', head: true });
        if (isTestMode) {
          countQuery = countQuery.or('notes.ilike.%[TEST_MODE]%,rma_number.ilike.%TEST%');
        } else {
          countQuery = countQuery.not('notes', 'ilike', '%[TEST_MODE]%').not('rma_number', 'ilike', '%TEST%');
        }
        const { count } = await countQuery;
        if (typeof count === 'number' && count >= 0) {
          nextSeq = count + 1;
        }
      } catch (countErr) {
        console.warn('Count query notice for RMA sequence:', countErr.message);
      }

      const seqStr = String(nextSeq).padStart(4, '0');
      const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
      let randomSuffix = '';
      for (let i = 0; i < 4; i++) {
        randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      const rmaPrefix = isTestMode ? `RMA-TEST-${currentYear}` : `RMA-${currentYear}`;
      const rmaNumber = body.rma_number ? String(body.rma_number).trim() : `${rmaPrefix}-${seqStr}-${randomSuffix}`;

      if (!isTestMode && rmaNumber.includes('TEST')) {
        return sendJson(res, 400, {
          success: false,
          error: 'INVALID_LIVE_RMA_NUMBER',
          message: "Live mode RMA IDs cannot contain 'TEST' prefix. Please use standard RMA-[YEAR]-[SEQ]-[RAND] format."
        });
      }

      const reportPayload = {
        rma_number: rmaNumber,
        rma_type: rma_type === 'supplier_outbound' ? 'supplier_outbound' : 'customer_inbound',
        barcode: String(barcode).trim(),
        code: code ? String(code).trim() : null,
        name: String(name).trim(),
        quantity: parseInt(quantity, 10) || 1,
        supplier_name: supplier_name ? String(supplier_name).trim() : 'Savemore',
        price: parseFloat(price) || 0,
        price_with_vat: parseFloat(price_with_vat) || 0,
        unit_name: unit_name || 'pc',
        status: status || 'received_at_dock',
        condition_grade: condition_grade || 'B - Damaged Packaging Only',
        disposition: disposition || 'Pending Triage',
        warehouse_location: normalizeWarehouseLocation(warehouse_location, { rma_type }),
        inspected_by: inspected_by ? String(inspected_by).trim() : null,
        inspected_at: inspected_by ? new Date().toISOString() : null,
        reason: reason || 'Damaged Box / Crushed Packaging',
        explanation: explanation || null,
        photos: Array.isArray(photos) ? photos : [],
        reporter_name: reporter_name ? String(reporter_name).trim() : client.name,
        reporter_contact: reporter_contact ? String(reporter_contact).trim() : null,
        reported_by: `${client.name} (API)`,
        ae_name: ae_name || null,
        ae_email: ae_email || null,
        store_branch: store_branch ? String(store_branch).trim() : null,
        invoice_dr_number: invoice_dr_number ? String(invoice_dr_number).trim() : null,
        si_number: si_number ? String(si_number).trim() : null,
        dr_number: dr_number ? String(dr_number).trim() : null,
        po_number: po_number ? String(po_number).trim() : null,
        expiry_date: expiry_date || null,
        batch_lot_number: batch_lot_number ? String(batch_lot_number).trim() : null,
        ai_document_metadata: {
          ...(body.ai_document_metadata || {}),
          ...(isTestMode ? { is_test: true } : {})
        },
        notes: isTestMode ? `[TEST_MODE] ${notes || ''}`.trim() : (notes ? String(notes).trim() : `Reported via REST API by ${client.name}`),
        created_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('rma_reports')
        .insert(reportPayload)
        .select('*')
        .single();

      if (error) {
        console.error('[API v1 RMA POST] Insert error:', error);
        return sendJson(res, 500, {
          success: false,
          error: 'INSERT_ERROR',
          message: error.message
        });
      }

      return sendJson(res, 201, {
        success: true,
        message: `RMA report ${rmaNumber} created successfully.`,
        client: client.name,
        data
      });
    } catch (err) {
      console.error('[API v1 RMA POST] Server error:', err);
      return sendJson(res, 500, {
        success: false,
        error: 'SERVER_ERROR',
        message: err.message
      });
    }
  }

  return sendJson(res, 405, {
    success: false,
    error: 'METHOD_NOT_ALLOWED',
    message: `Method ${req.method} not allowed.`
  });
}
