import { supabase } from '../../_lib/supabase.js';
import { requireApiKey, sendJson, setCorsHeaders } from '../../_lib/auth.js';

function normalizeWarehouseLocation(loc, rmaType = 'customer_inbound') {
  const raw = String(loc || '').trim();
  const isSupplier = rmaType === 'supplier_outbound';
  if (!raw || raw === '—' || raw === 'N/A' || raw.toLowerCase() === 'dock' || raw.toLowerCase() === 'dock-intake' || raw.toLowerCase() === 'rtv-dock') {
    return isSupplier ? 'Supplier Return Area (RTV)' : 'Receiving Area';
  }
  const upper = raw.toUpperCase();
  if (upper.includes('SCRAP') || upper.includes('DISPOS')) return 'Disposal / Scrap Area';
  if (upper.includes('QUARANTINE') || upper.includes('HOLD') || upper.includes('INSPECT')) return 'Hold / Inspection Area';
  if (upper.includes('OUTBOUND') || upper.includes('CUSTOMER RETURN') || upper.includes('RETURN-TO-STORE')) return 'Customer Return Area';
  if (upper.includes('RTV') || upper.includes('SUPPLIER') || upper.includes('VENDOR')) return 'Supplier Return Area (RTV)';
  if (upper.includes('RESTOCK') || upper.includes('GOOD STOCK') || upper.includes('SHELF') || upper.includes('RACK') || upper.includes('BIN')) return 'Good Stock Area';
  return raw;
}

function mapReasonToConditionGrade(reason) {
  if (!reason) return 'B - Damaged Packaging Only';
  const r = String(reason).toLowerCase();
  if (r.includes('wrong item') || r.includes('pull-out') || r.includes('unsold') || r.includes('resellable') || r.includes('like new') || r.includes('incorrect shipment')) {
    return 'A - Like New / Resellable';
  }
  if (r.includes('expired') || r.includes('expiry') || r.includes('spoiled') || r.includes('leaking') || r.includes('broken seal') || r.includes('total loss') || r.includes('scrap')) {
    return 'D - Total Loss / Scrap';
  }
  if (r.includes('factory defect') || r.includes('not working') || r.includes('parts only') || r.includes('other defect') || r.includes('defective')) {
    return 'C - Defective / Parts Only';
  }
  if (r.includes('box') || r.includes('packaging') || r.includes('crushed') || r.includes('dent') || r.includes('damaged box')) {
    return 'B - Damaged Packaging Only';
  }
  return 'B - Damaged Packaging Only';
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const client = await requireApiKey(req, res);
  if (!client) return;

  const { id } = req.query;
  if (!id) {
    return sendJson(res, 400, {
      success: false,
      error: 'BAD_REQUEST',
      message: 'RMA ID or RMA Number is required in URL.'
    });
  }

  const cleanId = String(id).trim();
  const isNumeric = /^\d+$/.test(cleanId);

  // Helper query builder for ID or rma_number
  const matchRma = (query) => {
    return isNumeric ? query.eq('id', parseInt(cleanId, 10)) : query.eq('rma_number', cleanId);
  };

  // 1. GET: Fetch single or manifest RMA
  if (req.method === 'GET') {
    try {
      const { data, error } = await matchRma(supabase.from('rma_reports').select('*'));

      if (error) {
        return sendJson(res, 500, { success: false, error: 'DATABASE_ERROR', message: error.message });
      }

      if (!data || data.length === 0) {
        return sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: `RMA report ${cleanId} not found.` });
      }

      const result = data.length === 1 ? data[0] : data;
      return sendJson(res, 200, { success: true, data: result });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: 'SERVER_ERROR', message: err.message });
    }
  }

  // 2. PATCH / PUT: Update RMA status or fields
  if (req.method === 'PATCH' || req.method === 'PUT') {
    try {
      // Support both JSON request body and query parameters (for Scalar & URL parameter testing)
      let body = { ...req.query, ...(typeof req.body === 'object' && req.body !== null ? req.body : {}) };
      if (typeof req.body === 'string') {
        try { body = { ...body, ...JSON.parse(req.body) }; } catch (e) {}
      }
      delete body.id;

      const allowedFields = [
        'rma_type', 'status', 'notes', 'explanation', 'price', 'price_with_vat',
        'code', 'name', 'supplier_name', 'unit_name', 'quantity', 'ae_name', 'ae_email',
        'condition_grade', 'disposition', 'warehouse_location', 'inspected_by', 'inspected_at',
        'store_branch', 'invoice_dr_number', 'si_number', 'dr_number', 'po_number', 'expiry_date', 'batch_lot_number'
      ];

      const updateData = {};
      for (const field of allowedFields) {
        if (body && body[field] !== undefined) {
          updateData[field] = body[field];
        }
      }

      // Check lifecycle action (archive, trash, restore)
      const lifecycleAction = body?.lifecycle || body?.action || null;

      if (Object.keys(updateData).length === 0 && !lifecycleAction) {
        return sendJson(res, 400, {
          success: false,
          error: 'BAD_REQUEST',
          message: 'No valid fields provided to update.'
        });
      }

      // Normalize status and disposition for coworker restock, scrap/re-order, RTV & hold sync
      let requestedWorkflowResolution = null;
      if (updateData.status) {
        const s = String(updateData.status).toLowerCase().trim();
        if (s === 'restocked' || s === '6- restocked') {
          updateData.status = 'resolved';
          requestedWorkflowResolution = 'restocked';
        } else if (s === 'scrapped' || s === 'disposed' || s === '7- scrapped / disposed' || s === 'reordered') {
          updateData.status = 'resolved';
          const explicitNoReorder = body?.needs_reorder === false;
          requestedWorkflowResolution = explicitNoReorder ? 'scrapped_no_reorder' : 'reordered';
        } else if (s === 'pending' || s === 'under_inspection' || s === 'received_at_dock' || s === 'reopen' || s === 'reset') {
          updateData.status = (s === 'received_at_dock' || s === 'pending') ? 'pending' : 'under_inspection';
          requestedWorkflowResolution = null; // Clear resolution to reopen
        } else if (s === 'vendor_claimed' || s === '3- vendor claimed' || s === 'vendor_claim') {
          updateData.status = 'vendor_claimed';
          if (!updateData.disposition) updateData.disposition = '3- Return to Vendor (RTV)';
        } else if (s === 'quarantine' || s === 'hold' || s === '4- quarantine') {
          updateData.status = 'under_inspection';
          if (!updateData.disposition) updateData.disposition = '4- Quarantine';
        } else if (s === 'rejected' || s === '8- rejected' || s === 'claim_rejected') {
          updateData.status = 'rejected';
        } else if (s === 'resolved' || s === 'closed') {
          updateData.status = 'resolved';
          const d = String(updateData.disposition || '').toLowerCase();
          const explicitNoReorder = body?.needs_reorder === false;
          if (d.includes('scrap') || d.includes('dispose')) {
            requestedWorkflowResolution = explicitNoReorder ? 'scrapped_no_reorder' : 'reordered';
          } else {
            requestedWorkflowResolution = 'restocked';
          }
        }
      }

      if (updateData.reason && !updateData.condition_grade) {
        updateData.condition_grade = mapReasonToConditionGrade(updateData.reason);
      }

      if (updateData.warehouse_location) {
        updateData.warehouse_location = normalizeWarehouseLocation(updateData.warehouse_location);
      }

      if (updateData.disposition) {
        const d = String(updateData.disposition).trim();
        if (d === 'Restock to Inventory' || d === '2- Restock to Inventory' || /restock/i.test(d)) {
          updateData.disposition = '2- Restock to Inventory';
          if (!updateData.warehouse_location) updateData.warehouse_location = 'Good Stock Area';
        } else if (d === 'Scrap / Dispose' || d === '5- Scrap / Dispose' || /scrap|dispose/i.test(d)) {
          updateData.disposition = '5- Scrap / Dispose';
          if (!updateData.warehouse_location) updateData.warehouse_location = 'Disposal / Scrap Area';
        } else if (d === 'Return to Vendor (RTV)' || d === '3- Return to Vendor (RTV)' || /rtv|vendor/i.test(d)) {
          updateData.disposition = '3- Return to Vendor (RTV)';
          if (!updateData.status) updateData.status = 'vendor_claimed';
          if (!updateData.warehouse_location) updateData.warehouse_location = 'Supplier Return Area (RTV)';
        } else if (d === 'Quarantine' || d === '4- Quarantine' || /quarantine|hold/i.test(d)) {
          updateData.disposition = '4- Quarantine';
          if (!updateData.status) updateData.status = 'under_inspection';
          if (!updateData.warehouse_location) updateData.warehouse_location = 'Hold / Inspection Area';
        }
      }

      // First, retrieve the matching record(s) so we can update audit trails & parent manifest items
      const { data: existingRows, error: findError } = await matchRma(
        supabase.from('rma_reports').select('*')
      );

      if (findError) {
        return sendJson(res, 500, { success: false, error: 'DATABASE_ERROR', message: findError.message });
      }

      if (!existingRows || existingRows.length === 0) {
        return sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: `RMA report ${cleanId} not found.` });
      }

      const actorName = String(body?.actor || body?.user || body?.updated_by || client.name || 'Coworker').trim();
      const targetBarcode = body?.barcode ? String(body.barcode).trim() : null;

      // Standardized Audit Trail Note for 4 Operational Actions
      let auditNote = `RMA status updated to ${updateData.status || 'updated'} by ${actorName}`;
      if (requestedWorkflowResolution === 'restocked') {
        auditNote = `ERP Restock confirmed by ${actorName}`;
      } else if (requestedWorkflowResolution === 'reordered') {
        auditNote = `Supplier Re-order confirmed by ${actorName}`;
      } else if (requestedWorkflowResolution === 'scrapped_no_reorder') {
        auditNote = `Scrap written off by ${actorName}`;
      } else if (updateData.status === 'vendor_claimed') {
        auditNote = `Vendor RTV claim confirmed by ${actorName}`;
      } else if (updateData.status === 'quarantine' || (updateData.disposition && updateData.disposition.includes('Quarantine'))) {
        auditNote = `Item placed on Hold / Quarantine by ${actorName}${body?.hold_reason ? `: ${body.hold_reason}` : ''}`;
      } else if (existingRows.some(r => r.disposition?.includes('Quarantine') || r.status === 'quarantine')) {
        auditNote = `Hold released by ${actorName}`;
      }

      const lifecycleStageLabel = requestedWorkflowResolution === 'restocked'
        ? '6- Restocked'
        : requestedWorkflowResolution === 'reordered'
        ? '7- Re-Ordered (PO Placed)'
        : requestedWorkflowResolution === 'scrapped_no_reorder'
        ? '7- Scrapped / Written Off'
        : updateData.status === 'vendor_claimed'
        ? '3- Vendor Claimed'
        : (updateData.status === 'quarantine' || updateData.disposition?.includes('Quarantine'))
        ? '4- Quarantine'
        : undefined;

      const auditEntry = {
        timestamp: new Date().toISOString(),
        stage: requestedWorkflowResolution === 'restocked' ? 'ERP_RESTOCK' : (requestedWorkflowResolution === 'reordered' ? 'SUPPLIER_REORDER' : (requestedWorkflowResolution === 'scrapped_no_reorder' ? 'SCRAP_DISPOSAL' : (updateData.status === 'vendor_claimed' ? 'VENDOR_RTV' : ((updateData.status === 'quarantine' || updateData.disposition?.includes('Quarantine')) ? 'HOLD_QUARANTINE' : 'API_PATCH')))),
        actor: actorName,
        status: updateData.status,
        lifecycle_stage: lifecycleStageLabel,
        warehouse_location: updateData.warehouse_location || undefined,
        hold_reason: body?.hold_reason || undefined,
        note: auditNote
      };

      const updatedRows = [];

      const explicitNeedsReorder = body?.needs_reorder !== undefined ? Boolean(body.needs_reorder) : undefined;
      const explicitHoldReason = body?.hold_reason ? String(body.hold_reason).trim() : undefined;
      const explicitRejectionReason = body?.rejection_reason ? String(body.rejection_reason).trim() : undefined;

      for (const row of existingRows) {
        const currentAudit = Array.isArray(row.audit_trail) ? [...row.audit_trail] : [];
        currentAudit.push(auditEntry);

        // Merge operational metadata safely into JSONB ai_document_metadata
        const currentMeta = (row.ai_document_metadata && typeof row.ai_document_metadata === 'object') ? row.ai_document_metadata : {};
        const updatedMeta = {
          ...currentMeta,
          ...(explicitNeedsReorder !== undefined ? { needs_reorder: explicitNeedsReorder } : {}),
          ...(explicitHoldReason ? { hold_reason: explicitHoldReason } : {}),
          ...(explicitRejectionReason ? { rejection_reason: explicitRejectionReason } : {}),
          ...(requestedWorkflowResolution ? {
            workflow_resolution: requestedWorkflowResolution,
            resolved_at: new Date().toISOString(),
            resolved_by: actorName
          } : {})
        };
        if (!requestedWorkflowResolution) {
          delete updatedMeta.workflow_resolution;
          delete updatedMeta.resolved_at;
          delete updatedMeta.resolved_by;
        }

        if (lifecycleAction === 'archive' || lifecycleAction === 'archived') {
          updatedMeta.is_archived = true;
          updatedMeta.is_trashed = false;
          updatedMeta.archived_at = new Date().toISOString();
          updatedMeta.archived_by = actorName;
        } else if (lifecycleAction === 'trash' || lifecycleAction === 'trashed') {
          updatedMeta.is_trashed = true;
          updatedMeta.is_archived = false;
          updatedMeta.trashed_at = new Date().toISOString();
          updatedMeta.trashed_by = actorName;
          updatedMeta.purge_after = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        } else if (lifecycleAction === 'restore' || lifecycleAction === 'active') {
          delete updatedMeta.is_trashed;
          delete updatedMeta.trashed_at;
          delete updatedMeta.trashed_by;
          delete updatedMeta.purge_after;
          delete updatedMeta.is_archived;
          delete updatedMeta.archived_at;
          delete updatedMeta.archived_by;
        }

        // Clean operational tags from notes (avoid raw internal tags showing to customers)
        let updatedNotes = row.notes || '';
        updatedNotes = updatedNotes
          .replace(/\[REORDER:\s*(YES|NO)\]/gi, '')
          .replace(/\[HOLD REASON:\s*[^\]]+\]/gi, '')
          .replace(/\[REJECTED:\s*[^\]]+\]/gi, '')
          .trim();

        let rowPayload = {
          ...updateData,
          audit_trail: currentAudit,
          ai_document_metadata: updatedMeta,
          notes: updatedNotes
        };

        // Ensure non-existent columns are never sent to Supabase
        delete rowPayload.needs_reorder;
        delete rowPayload.hold_reason;
        delete rowPayload.rejection_reason;
        delete rowPayload.actor;
        delete rowPayload.user;
        delete rowPayload.updated_by;
        delete rowPayload.barcode;
        delete rowPayload.lifecycle;
        delete rowPayload.action;

        // If this row is a parent batch manifest, also update its child items inside row.items
        let parsedRowItems = [];
        if (Array.isArray(row.items) && row.items.length > 0) {
          parsedRowItems = [...row.items];
        } else if (typeof row.items === 'string' && row.items.trim()) {
          try {
            const p = JSON.parse(row.items);
            if (Array.isArray(p)) parsedRowItems = p;
          } catch (e) {}
        }

        if (parsedRowItems.length > 0) {
          parsedRowItems = parsedRowItems.map(it => {
            const itBarcode = String(it.barcode || '').trim();
            const itDisp = String(it.disposition || '').toLowerCase();
            const matchesSpecificBarcode = targetBarcode && itBarcode === targetBarcode;
            const matchesQueueDisposition = !targetBarcode && (
              (requestedWorkflowResolution === 'restocked' && itDisp.includes('restock')) ||
              (requestedWorkflowResolution && (itDisp.includes('scrap') || itDisp.includes('dispose'))) ||
              (updateData.status === 'vendor_claimed' && (itDisp.includes('rtv') || itDisp.includes('vendor'))) ||
              (updateData.status === 'quarantine' && (itDisp.includes('quarantine') || itDisp.includes('hold'))) ||
              (!updateData.status)
            );

            if (matchesSpecificBarcode || matchesQueueDisposition) {
              return {
                ...it,
                status: updateData.status !== undefined ? updateData.status : it.status,
                workflow_resolution: requestedWorkflowResolution || it.workflow_resolution,
                warehouse_location: updateData.warehouse_location !== undefined ? updateData.warehouse_location : it.warehouse_location,
                disposition: updateData.disposition !== undefined ? updateData.disposition : it.disposition
              };
            }
            return it;
          });

          // Recompute parent manifest lifecycle status dynamically
          let restockCnt = 0;
          let scrapCnt = 0;
          let pendingCnt = 0;
          parsedRowItems.forEach(it => {
            const d = String(it.disposition || '').toLowerCase();
            const st = String(it.status || '').toLowerCase();
            const res = it.workflow_resolution;
            if (st === 'resolved' && res === 'restocked') restockCnt += 1;
            else if (st === 'resolved' && (res === 'reordered' || res === 'scrapped_no_reorder')) scrapCnt += 1;
            else if (st === 'restocked' || d.includes('restock')) restockCnt += 1;
            else if (st === 'scrapped' || d.includes('scrap') || d.includes('dispose')) scrapCnt += 1;
            else if (!d || d.includes('pending')) pendingCnt += 1;
          });
          if (restockCnt === parsedRowItems.length) {
            rowPayload.status = 'resolved';
            updatedMeta.workflow_resolution = 'restocked';
          } else if (scrapCnt === parsedRowItems.length) {
            rowPayload.status = 'resolved';
            updatedMeta.workflow_resolution = explicitNeedsReorder === false ? 'scrapped_no_reorder' : 'reordered';
          } else if (pendingCnt === parsedRowItems.length) {
            rowPayload.status = 'under_inspection';
          } else {
            rowPayload.status = 'partially_completed';
          }
          rowPayload.items = parsedRowItems;
        }

        const { data: updatedRow, error: updateErr } = await supabase
          .from('rma_reports')
          .update(rowPayload)
          .eq('id', row.id)
          .select('*')
          .single();

        if (updateErr) {
          console.error(`[API v1 RMA PATCH] Error updating row ${row.id}:`, updateErr);
        } else if (updatedRow) {
          const res = updatedRow.ai_document_metadata?.workflow_resolution || requestedWorkflowResolution;
          let calculatedStage = updatedRow.status;
          if (res === 'restocked') calculatedStage = '6- Restocked';
          else if (res === 'reordered') calculatedStage = '7- Re-Ordered (PO Placed)';
          else if (res === 'scrapped_no_reorder') calculatedStage = '7- Scrapped / Written Off';
          else if (updatedRow.status === 'vendor_claimed') calculatedStage = '3- Vendor Claimed';
          else if (updatedRow.status === 'under_inspection') calculatedStage = '3- Under Inspection';
          else if (updatedRow.status === 'pending' || updatedRow.status === 'received_at_dock') calculatedStage = '2- Received at Dock';
          else if (updatedRow.status === 'partially_completed') calculatedStage = 'Partially Completed';

          updatedRows.push({
            ...updatedRow,
            lifecycle_stage: calculatedStage
          });
        }

        // If this row is a child item inside a parent manifest (has parent_rma_id):
        if (row.parent_rma_id) {
          try {
            const { data: parentRecord } = await supabase
              .from('rma_reports')
              .select('id, items, audit_trail')
              .eq('id', row.parent_rma_id)
              .maybeSingle();

            if (parentRecord) {
              let parentItems = Array.isArray(parentRecord.items)
                ? parentRecord.items
                : (typeof parentRecord.items === 'string' ? JSON.parse(parentRecord.items || '[]') : []);

              let itemModified = false;
              parentItems = parentItems.map(it => {
                const matchBarcode = it.barcode && String(it.barcode).trim() === String(row.barcode).trim();
                const matchId = it.id && (String(it.id) === String(row.id) || String(it.id) === String(row.barcode));
                const matchName = it.name && it.name === row.name;

                if (matchBarcode || matchId || matchName) {
                  itemModified = true;
                  return {
                    ...it,
                    status: updateData.status !== undefined ? updateData.status : it.status,
                    warehouse_location: updateData.warehouse_location !== undefined ? updateData.warehouse_location : it.warehouse_location,
                    disposition: updateData.disposition !== undefined ? updateData.disposition : it.disposition,
                    condition_grade: updateData.condition_grade !== undefined ? updateData.condition_grade : it.condition_grade
                  };
                }
                return it;
              });

              if (itemModified) {
                const parentAudit = Array.isArray(parentRecord.audit_trail) ? [...parentRecord.audit_trail] : [];
                parentAudit.push({
                  timestamp: new Date().toISOString(),
                  stage: 'CHILD_ERP_SYNC',
                  actor: `${client.name} (API)`,
                  note: `${auditNote} for item "${row.name}"`
                });

                await supabase
                  .from('rma_reports')
                  .update({
                    items: parentItems,
                    audit_trail: parentAudit
                  })
                  .eq('id', parentRecord.id);
              }
            }
          } catch (parentErr) {
            console.warn('[API v1 RMA PATCH] Notice syncing parent manifest items:', parentErr.message);
          }

          // Also synchronize child row in rma_items if present
          try {
            await supabase
              .from('rma_items')
              .update({
                status: updateData.status,
                warehouse_location: updateData.warehouse_location,
                disposition: updateData.disposition
              })
              .or(`id.eq.${row.id},barcode.eq.${row.barcode}`);
          } catch (childErr) {
            // non-blocking
          }
        }
      }

      if (updatedRows.length === 0) {
        return sendJson(res, 500, { success: false, error: 'UPDATE_FAILED', message: `Failed to update RMA record ${cleanId}.` });
      }

      const result = updatedRows.length === 1 ? updatedRows[0] : updatedRows;
      const rmaNum = updatedRows[0]?.rma_number;

      return sendJson(res, 200, {
        success: true,
        message: `RMA report ${rmaNum || cleanId} updated by ${client.name} (${updatedRows.length} item${updatedRows.length > 1 ? 's' : ''} updated).`,
        data: result
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: 'SERVER_ERROR', message: err.message });
    }
  }

  // 3. DELETE: Remove RMA
  if (req.method === 'DELETE') {
    try {
      const { data, error } = await matchRma(
        supabase.from('rma_reports').delete().select('id, rma_number, name')
      );

      if (error) {
        return sendJson(res, 500, { success: false, error: 'DELETE_ERROR', message: error.message });
      }

      if (!data || data.length === 0) {
        return sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: `RMA report ${cleanId} not found.` });
      }

      const result = data.length === 1 ? data[0] : data;
      const rmaNum = Array.isArray(data) ? data[0]?.rma_number : data?.rma_number;

      return sendJson(res, 200, {
        success: true,
        message: `RMA report ${rmaNum || cleanId} deleted by ${client.name} (${data.length} item${data.length > 1 ? 's' : ''} removed).`,
        deleted: result
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: 'SERVER_ERROR', message: err.message });
    }
  }

  return sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: `Method ${req.method} not allowed.` });
}
