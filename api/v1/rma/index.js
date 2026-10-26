import { supabase } from '../../_lib/supabase.js';
import { requireApiKey, sendJson, setCorsHeaders } from '../../_lib/auth.js';

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. Authenticate API Key
  const client = await requireApiKey(req, res);
  if (!client) return; // Response already sent by middleware

  // 2. GET: List RMA Reports with query filters
  if (req.method === 'GET') {
    try {
      const { status, barcode, search, limit = '50', offset = '0' } = req.query;

      const numLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
      const numOffset = Math.max(parseInt(offset, 10) || 0, 0);

      let query = supabase
        .from('rma_reports')
        .select('*', { count: 'exact' });

      if (status) {
        query = query.eq('status', status);
      }
      if (barcode) {
        query = query.eq('barcode', barcode.trim());
      }
      if (search) {
        query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%,rma_number.ilike.%${search}%,reporter_name.ilike.%${search}%`);
      }

      query = query
        .order('created_at', { ascending: false })
        .range(numOffset, numOffset + numLimit - 1);

      const { data, count, error } = await query;

      if (error) {
        console.error('[API v1 RMA GET] Query error:', error);
        return sendJson(res, 500, {
          success: false,
          error: 'DATABASE_ERROR',
          message: error.message
        });
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
        code,
        quantity = 1,
        supplier_name,
        price = 0,
        price_with_vat = 0,
        unit_name = 'pc',
        reason = 'Damaged Box / Crushed Packaging',
        explanation,
        photos = [],
        reporter_name,
        reporter_contact,
        ae_name,
        ae_email,
        notes
      } = body || {};

      if (!barcode || !name) {
        return sendJson(res, 400, {
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Both "barcode" and "name" are required fields.'
        });
      }

      // Generate unique RMA Number: RMA-YYYYMMDD-XXXX
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      const rmaNumber = `RMA-${dateStr}-${randomSuffix}`;

      const reportPayload = {
        rma_number: rmaNumber,
        barcode: String(barcode).trim(),
        code: code ? String(code).trim() : null,
        name: String(name).trim(),
        quantity: parseInt(quantity, 10) || 1,
        supplier_name: supplier_name ? String(supplier_name).trim() : 'Savemore',
        price: parseFloat(price) || 0,
        price_with_vat: parseFloat(price_with_vat) || 0,
        unit_name: unit_name || 'pc',
        status: 'pending',
        reason: reason || 'Damaged Box / Crushed Packaging',
        explanation: explanation || null,
        photos: Array.isArray(photos) ? photos : [],
        reporter_name: reporter_name ? String(reporter_name).trim() : client.name,
        reporter_contact: reporter_contact ? String(reporter_contact).trim() : null,
        reported_by: `${client.name} (API)`,
        ae_name: ae_name || null,
        ae_email: ae_email || null,
        notes: notes ? String(notes).trim() : `Reported via REST API by ${client.name}`,
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
