import { supabase } from '../../_lib/supabase.js';
import { requireApiKey, sendJson, setCorsHeaders } from '../../_lib/auth.js';

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
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) {}
      }

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

      if (Object.keys(updateData).length === 0) {
        return sendJson(res, 400, {
          success: false,
          error: 'BAD_REQUEST',
          message: 'No valid fields provided to update.'
        });
      }

      // Normalize status and disposition for coworker restock & scrap/re-order sync
      if (updateData.status) {
        const s = String(updateData.status).toLowerCase().trim();
        if (s === 'restocked' || s === '6- restocked') {
          updateData.status = 'restocked';
        } else if (s === 'scrapped' || s === 'disposed' || s === '7- scrapped / disposed') {
          updateData.status = 'scrapped';
        } else if (s === 'resolved' || s === 'closed') {
          // If disposition indicates scrap, normalize to scrapped; otherwise restocked
          const d = String(updateData.disposition || '').toLowerCase();
          if (d.includes('scrap') || d.includes('dispose')) {
            updateData.status = 'scrapped';
          } else {
            updateData.status = 'restocked';
          }
        }
      }

      if (updateData.warehouse_location) {
        updateData.warehouse_location = String(updateData.warehouse_location).trim().toUpperCase();
      }

      if (updateData.disposition) {
        const d = String(updateData.disposition).trim();
        if (d === 'Restock to Inventory' || d === '2- Restock to Inventory' || /restock/i.test(d)) {
          updateData.disposition = '2- Restock to Inventory';
        } else if (d === 'Scrap / Dispose' || d === '5- Scrap / Dispose' || /scrap|dispose/i.test(d)) {
          updateData.disposition = '5- Scrap / Dispose';
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

      // Standardized Audit Trail Note (Subject 1)
      let auditNote = `RMA status updated to ${updateData.status || 'updated'} by ${actorName}`;
      if (updateData.status === 'restocked') {
        auditNote = `ERP Restock confirmed by ${actorName}`;
      } else if (updateData.status === 'scrapped') {
        auditNote = `Supplier Re-order confirmed by ${actorName}`;
      }

      const lifecycleStageLabel = updateData.status === 'restocked'
        ? '6- Restocked'
        : updateData.status === 'scrapped'
        ? '7- Scrapped / Disposed'
        : undefined;

      const auditEntry = {
        timestamp: new Date().toISOString(),
        stage: updateData.status === 'restocked' ? 'ERP_RESTOCK' : (updateData.status === 'scrapped' ? 'SUPPLIER_REORDER' : 'API_PATCH'),
        actor: actorName,
        status: updateData.status,
        lifecycle_stage: lifecycleStageLabel,
        warehouse_location: updateData.warehouse_location || undefined,
        note: auditNote
      };

      const updatedRows = [];

      for (const row of existingRows) {
        const currentAudit = Array.isArray(row.audit_trail) ? [...row.audit_trail] : [];
        currentAudit.push(auditEntry);

        let rowPayload = {
          ...updateData,
          audit_trail: currentAudit
        };

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
              (updateData.status === 'restocked' && itDisp.includes('restock')) ||
              (updateData.status === 'scrapped' && (itDisp.includes('scrap') || itDisp.includes('dispose'))) ||
              (!updateData.status)
            );

            if (matchesSpecificBarcode || matchesQueueDisposition) {
              return {
                ...it,
                status: updateData.status !== undefined ? updateData.status : it.status,
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
            if (st === 'restocked' || d.includes('restock')) restockCnt += 1;
            else if (st === 'scrapped' || d.includes('scrap') || d.includes('dispose')) scrapCnt += 1;
            else if (!d || d.includes('pending')) pendingCnt += 1;
          });
          if (restockCnt === parsedRowItems.length) {
            rowPayload.status = 'restocked';
          } else if (scrapCnt === parsedRowItems.length) {
            rowPayload.status = 'scrapped';
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
          updatedRows.push({
            ...updatedRow,
            lifecycle_stage: updatedRow.status === 'restocked'
              ? '6- Restocked'
              : updatedRow.status === 'scrapped'
              ? '7- Scrapped / Disposed'
              : updatedRow.status === 'partially_completed'
              ? 'Partially Completed'
              : updatedRow.status
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
