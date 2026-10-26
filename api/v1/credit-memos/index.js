import { supabase } from '../../_lib/supabase.js';
import { requireApiKey, sendJson, setCorsHeaders } from '../../_lib/auth.js';

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const client = await requireApiKey(req, res);
  if (!client) return;

  // 1. GET: List credit memos
  if (req.method === 'GET') {
    try {
      const { search, rma_number, barcode, limit = '50', offset = '0' } = req.query;

      const numLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
      const numOffset = Math.max(parseInt(offset, 10) || 0, 0);

      let query = supabase
        .from('credit_memos')
        .select('*', { count: 'exact' });

      if (rma_number) {
        query = query.eq('rma_number', rma_number.trim());
      }
      if (barcode) {
        query = query.eq('barcode', barcode.trim());
      }
      if (search) {
        query = query.or(`credit_memo_number.ilike.%${search}%,pull_out_ref.ilike.%${search}%,product_name.ilike.%${search}%,customer_ae_name.ilike.%${search}%`);
      }

      query = query
        .order('created_at', { ascending: false })
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

  // 2. POST: Issue Credit Memo
  if (req.method === 'POST') {
    try {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) {}
      }

      const {
        rma_number,
        barcode,
        product_name,
        sku,
        supplier_name = 'Savemore',
        company = 'Wholesale Distribution',
        customer_ae_name,
        customer_ae_email,
        quantity = 1,
        unit_name = 'pc',
        unit_price = 0,
        pull_out_ref,
        pull_out_date,
        credit_amount,
        notes
      } = body || {};

      if (!rma_number || !barcode || !product_name || !pull_out_ref || credit_amount === undefined) {
        return sendJson(res, 400, {
          success: false,
          error: 'VALIDATION_ERROR',
          message: '"rma_number", "barcode", "product_name", "pull_out_ref", and "credit_amount" are required.'
        });
      }

      // Auto-generate CM Number: CM-YYYYMMDD-XXXX
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const rand = Math.floor(1000 + Math.random() * 9000);
      const cmNumber = `CM-${dateStr}-${rand}`;

      const numQty = parseFloat(quantity) || 1;
      const numUnitPrice = parseFloat(unit_price) || 0;
      const calculatedAmount = numQty * numUnitPrice;
      const finalCreditAmount = parseFloat(credit_amount) || calculatedAmount;

      const payload = {
        credit_memo_number: cmNumber,
        rma_number: String(rma_number).trim(),
        barcode: String(barcode).trim(),
        product_name: String(product_name).trim(),
        sku: sku ? String(sku).trim() : null,
        supplier_name: supplier_name || 'Savemore',
        company: company || 'Wholesale Distribution',
        customer_ae_name: customer_ae_name || null,
        customer_ae_email: customer_ae_email || null,
        quantity: numQty,
        unit_name: unit_name || 'pc',
        unit_price: numUnitPrice,
        amount: calculatedAmount,
        pull_out_ref: String(pull_out_ref).trim(),
        pull_out_date: pull_out_date || new Date().toISOString().slice(0, 10),
        credit_amount: finalCreditAmount,
        credit_issued_by: `${client.name} (API)`,
        credit_issued_at: new Date().toISOString(),
        notes: notes || `Issued via REST API by ${client.name}`,
        status: 'issued'
      };

      const { data, error } = await supabase
        .from('credit_memos')
        .insert(payload)
        .select('*')
        .single();

      if (error) {
        return sendJson(res, 500, { success: false, error: 'INSERT_ERROR', message: error.message });
      }

      return sendJson(res, 201, {
        success: true,
        message: `Credit Memo ${cmNumber} issued successfully by ${client.name}.`,
        data
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: 'SERVER_ERROR', message: err.message });
    }
  }

  return sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: `Method ${req.method} not allowed.` });
}
