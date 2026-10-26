import { supabase } from '../../_lib/supabase.js';
import { generateApiKeyPair, ALLOWED_SYSTEMS } from '../../_lib/keyUtils.js';
import { sendJson, setCorsHeaders } from '../../_lib/auth.js';

export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // GET: List all API Keys (Masked only, safe for admin dashboard)
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('api_keys')
        .select('id, name, masked_key, is_active, rate_limit, expires_at, last_used_at, created_at, updated_at')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[API Keys GET] Database error:', error);
        return sendJson(res, 500, {
          success: false,
          error: 'DATABASE_ERROR',
          message: error.message
        });
      }

      return sendJson(res, 200, {
        success: true,
        count: data ? data.length : 0,
        keys: data || []
      });
    } catch (err) {
      console.error('[API Keys GET] Server error:', err);
      return sendJson(res, 500, {
        success: false,
        error: 'SERVER_ERROR',
        message: err.message
      });
    }
  }

  // POST: Generate a new API Key for one of the 4 systems
  if (req.method === 'POST') {
    try {
      let body = req.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch (e) {}
      }

      const { name, rateLimit, expiresAt } = body || {};

      if (!name || typeof name !== 'string' || !name.trim()) {
        return sendJson(res, 400, {
          success: false,
          error: 'BAD_REQUEST',
          message: 'Client name is required. Must be one of: ' + ALLOWED_SYSTEMS.join(', ')
        });
      }

      const cleanName = name.trim();
      const limit = Number(rateLimit) > 0 ? Number(rateLimit) : 60;
      const expiry = expiresAt ? new Date(expiresAt).toISOString() : null;

      // Generate raw secret key and compute SHA-256 hash
      const { rawKey, keyHash, maskedKey } = generateApiKeyPair();

      const { data, error } = await supabase
        .from('api_keys')
        .insert({
          name: cleanName,
          key_hash: keyHash,
          masked_key: maskedKey,
          is_active: true,
          rate_limit: limit,
          expires_at: expiry
        })
        .select('id, name, masked_key, is_active, rate_limit, expires_at, created_at')
        .single();

      if (error) {
        console.error('[API Keys POST] Insert error:', error);
        return sendJson(res, 500, {
          success: false,
          error: 'INSERT_ERROR',
          message: error.message
        });
      }

      // CRITICAL: Raw secret key is returned ONCE here so user can copy it!
      return sendJson(res, 201, {
        success: true,
        message: `API Key successfully generated for ${cleanName}. Please copy and save the secret key now; it cannot be viewed again.`,
        apiKey: rawKey,
        keyRecord: data
      });
    } catch (err) {
      console.error('[API Keys POST] Server error:', err);
      return sendJson(res, 500, {
        success: false,
        error: 'SERVER_ERROR',
        message: err.message
      });
    }
  }

  // DELETE: Revoke / Delete API key via query (?id=...) or body ({ id })
  if (req.method === 'DELETE') {
    try {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) {}
      }
      const targetId = req.query.id || (body && body.id);

      if (!targetId) {
        return sendJson(res, 400, {
          success: false,
          error: 'BAD_REQUEST',
          message: 'API Key ID is required (e.g., ?id=<uuid> or body { id }).'
        });
      }

      const { data, error } = await supabase
        .from('api_keys')
        .delete()
        .eq('id', targetId)
        .select('id, name, masked_key')
        .maybeSingle();

      if (error) {
        return sendJson(res, 500, { success: false, error: 'DELETE_ERROR', message: error.message });
      }

      if (!data) {
        return sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: `API Key with ID ${targetId} was not found.` });
      }

      return sendJson(res, 200, {
        success: true,
        message: `API Key for ${data.name} (${data.masked_key}) has been permanently deleted/revoked.`,
        deletedKey: data
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: 'SERVER_ERROR', message: err.message });
    }
  }

  // PATCH: Rotate API key via query (?id=...) or body ({ id })
  if (req.method === 'PATCH') {
    try {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) {}
      }
      const targetId = req.query.id || (body && body.id);

      if (!targetId) {
        return sendJson(res, 400, {
          success: false,
          error: 'BAD_REQUEST',
          message: 'API Key ID is required (e.g., ?id=<uuid> or body { id }).'
        });
      }

      const { data: existing, error: fetchErr } = await supabase
        .from('api_keys')
        .select('*')
        .eq('id', targetId)
        .maybeSingle();

      if (fetchErr || !existing) {
        return sendJson(res, 404, { success: false, error: 'NOT_FOUND', message: `API Key with ID ${targetId} was not found.` });
      }

      const { rawKey, keyHash, maskedKey } = generateApiKeyPair();

      const { data: updated, error: updateErr } = await supabase
        .from('api_keys')
        .update({
          key_hash: keyHash,
          masked_key: maskedKey,
          is_active: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', targetId)
        .select('id, name, masked_key, is_active, rate_limit, updated_at')
        .single();

      if (updateErr) {
        return sendJson(res, 500, { success: false, error: 'UPDATE_ERROR', message: updateErr.message });
      }

      return sendJson(res, 200, {
        success: true,
        message: `API Key for ${updated.name} has been rotated successfully. Old key is revoked. Please copy and store the new secret key now.`,
        apiKey: rawKey,
        keyRecord: updated
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: 'SERVER_ERROR', message: err.message });
    }
  }

  return sendJson(res, 405, {
    success: false,
    error: 'METHOD_NOT_ALLOWED',
    message: `Method ${req.method} not allowed.`
  });
}
