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

      const { data, error } = await matchRma(
        supabase.from('rma_reports').update(updateData).select('*')
      );

      if (error) {
        return sendJson(res, 500, { success: false, error: 'UPDATE_ERROR', message: error.message });
      }

      if (!data || data.length === 0) {
        return sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: `RMA report ${cleanId} not found.` });
      }

      const result = data.length === 1 ? data[0] : data;
      const rmaNum = Array.isArray(data) ? data[0]?.rma_number : data?.rma_number;

      return sendJson(res, 200, {
        success: true,
        message: `RMA report ${rmaNum || cleanId} updated by ${client.name} (${data.length} item${data.length > 1 ? 's' : ''} updated).`,
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
