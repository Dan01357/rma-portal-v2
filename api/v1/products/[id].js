import { supabase } from '../../_lib/supabase.js';
import { requireApiKey, sendJson, setCorsHeaders } from '../../_lib/auth.js';
import lookupHandler from '../../_lib/lookupHandler.js';

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Gracefully route /api/v1/products/lookup to lookupHandler if invoked by dynamic router
  if (req.query?.id === 'lookup' || req.url?.includes('/lookup')) {
    return lookupHandler(req, res);
  }

  const client = await requireApiKey(req, res);
  if (!client) return;

  const { id } = req.query;
  if (!id) {
    return sendJson(res, 400, { success: false, error: 'BAD_REQUEST', message: 'Product ID or Barcode is required in URL.' });
  }

  const cleanId = String(id).trim();
  const isNumeric = /^\d+$/.test(cleanId);

  const matchProduct = (query) => {
    return isNumeric ? query.or(`id.eq.${cleanId},barcode.eq.${cleanId}`) : query.eq('barcode', cleanId);
  };

  // 1. GET: Fetch product
  if (req.method === 'GET') {
    try {
      const { data, error } = await matchProduct(supabase.from('products').select('*')).maybeSingle();

      if (error) {
        return sendJson(res, 500, { success: false, error: 'DATABASE_ERROR', message: error.message });
      }

      if (!data) {
        return sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: `Product ${cleanId} not found.` });
      }

      return sendJson(res, 200, { success: true, data });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: 'SERVER_ERROR', message: err.message });
    }
  }

  // 2. PATCH: Update product
  if (req.method === 'PATCH' || req.method === 'PUT') {
    try {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) {}
      }

      const allowedFields = ['name', 'code', 'price', 'price_with_vat', 'supplier_name', 'brand_name', 'unit_name', 'image_url', 'is_verified'];
      const updateData = { updated_at: new Date().toISOString() };

      for (const field of allowedFields) {
        if (body && body[field] !== undefined) {
          updateData[field] = body[field];
        }
      }

      const { data, error } = await matchProduct(
        supabase.from('products').update(updateData).select('*')
      ).maybeSingle();

      if (error) {
        return sendJson(res, 500, { success: false, error: 'UPDATE_ERROR', message: error.message });
      }

      if (!data) {
        return sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: `Product ${cleanId} not found.` });
      }

      return sendJson(res, 200, {
        success: true,
        message: `Product ${data.name} updated by ${client.name}.`,
        data
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: 'SERVER_ERROR', message: err.message });
    }
  }

  // 3. DELETE: Remove product
  if (req.method === 'DELETE') {
    try {
      const { data, error } = await matchProduct(
        supabase.from('products').delete().select('id, barcode, name')
      ).maybeSingle();

      if (error) {
        return sendJson(res, 500, { success: false, error: 'DELETE_ERROR', message: error.message });
      }

      if (!data) {
        return sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: `Product ${cleanId} not found.` });
      }

      return sendJson(res, 200, {
        success: true,
        message: `Product ${data.name} (${data.barcode}) deleted by ${client.name}.`,
        deleted: data
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: 'SERVER_ERROR', message: err.message });
    }
  }

  return sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: `Method ${req.method} not allowed.` });
}
