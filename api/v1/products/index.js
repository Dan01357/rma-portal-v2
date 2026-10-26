import { supabase } from '../../_lib/supabase.js';
import { requireApiKey, sendJson, setCorsHeaders } from '../../_lib/auth.js';

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const client = await requireApiKey(req, res);
  if (!client) return;

  // 1. GET: Search / list products
  if (req.method === 'GET') {
    try {
      const { barcode, code, search, limit = '50', offset = '0' } = req.query;

      const numLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
      const numOffset = Math.max(parseInt(offset, 10) || 0, 0);

      let query = supabase
        .from('products')
        .select('*', { count: 'exact' });

      if (barcode) {
        query = query.eq('barcode', barcode.trim());
      }
      if (code) {
        query = query.eq('code', code.trim());
      }
      if (search) {
        query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%,barcode.ilike.%${search}%`);
      }

      query = query
        .order('name', { ascending: true })
        .range(numOffset, numOffset + numLimit - 1);

      const { data, count, error } = await query;

      if (error) {
        return sendJson(res, 500, { success: false, error: 'DATABASE_ERROR', message: error.message });
      }

      return sendJson(res, 200, {
        success: true,
        client: client.name,
        total: count || 0,
        limit: numLimit,
        offset: numOffset,
        data: data || []
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: 'SERVER_ERROR', message: err.message });
    }
  }

  // 2. POST: Create or upsert product
  if (req.method === 'POST') {
    try {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) {}
      }

      const {
        barcode,
        name,
        code,
        price = 0,
        price_with_vat = 0,
        supplier_name = 'Savemore',
        brand_name,
        unit_name = 'pc',
        image_url
      } = body || {};

      if (!barcode || !name) {
        return sendJson(res, 400, {
          success: false,
          error: 'VALIDATION_ERROR',
          message: '"barcode" and "name" are required.'
        });
      }

      const payload = {
        barcode: String(barcode).trim(),
        name: String(name).trim(),
        code: code ? String(code).trim() : null,
        price: parseFloat(price) || 0,
        price_with_vat: parseFloat(price_with_vat) || 0,
        supplier_name: supplier_name ? String(supplier_name).trim() : 'Savemore',
        brand_name: brand_name ? String(brand_name).trim() : null,
        unit_name: unit_name || 'pc',
        image_url: image_url || null,
        is_verified: true,
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('products')
        .upsert(payload, { onConflict: 'barcode' })
        .select('*')
        .single();

      if (error) {
        return sendJson(res, 500, { success: false, error: 'UPSERT_ERROR', message: error.message });
      }

      return sendJson(res, 201, {
        success: true,
        message: `Product ${data.name} (${data.barcode}) upserted successfully by ${client.name}.`,
        data
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: 'SERVER_ERROR', message: err.message });
    }
  }

  return sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: `Method ${req.method} not allowed.` });
}
