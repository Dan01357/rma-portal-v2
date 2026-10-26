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
    return sendJson(res, 400, { success: false, error: 'BAD_REQUEST', message: 'Credit Memo ID or CM Number is required in URL.' });
  }

  const cleanId = String(id).trim();
  const isNumeric = /^\d+$/.test(cleanId);

  const matchCM = (query) => {
    return isNumeric ? query.eq('id', parseInt(cleanId, 10)) : query.eq('credit_memo_number', cleanId);
  };

  // 1. GET: Fetch Credit Memo
  if (req.method === 'GET') {
    try {
      const { data, error } = await matchCM(supabase.from('credit_memos').select('*')).maybeSingle();

      if (error) {
        return sendJson(res, 500, { success: false, error: 'DATABASE_ERROR', message: error.message });
      }

      if (!data) {
        return sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: `Credit Memo ${cleanId} not found.` });
      }

      return sendJson(res, 200, { success: true, data });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: 'SERVER_ERROR', message: err.message });
    }
  }

  // 2. DELETE: Remove Credit Memo
  if (req.method === 'DELETE') {
    try {
      const { data, error } = await matchCM(
        supabase.from('credit_memos').delete().select('id, credit_memo_number, product_name')
      ).maybeSingle();

      if (error) {
        return sendJson(res, 500, { success: false, error: 'DELETE_ERROR', message: error.message });
      }

      if (!data) {
        return sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: `Credit Memo ${cleanId} not found.` });
      }

      return sendJson(res, 200, {
        success: true,
        message: `Credit Memo ${data.credit_memo_number} deleted by ${client.name}.`,
        deleted: data
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: 'SERVER_ERROR', message: err.message });
    }
  }

  return sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: `Method ${req.method} not allowed.` });
}
