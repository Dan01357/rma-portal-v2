import { supabase } from '../../_lib/supabase.js';
import { generateApiKeyPair } from '../../_lib/keyUtils.js';
import { sendJson, setCorsHeaders } from '../../_lib/auth.js';

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { id } = req.query;

  if (!id) {
    return sendJson(res, 400, {
      success: false,
      error: 'BAD_REQUEST',
      message: 'API Key ID is required in URL path.'
    });
  }

  // DELETE: Revoke / Delete API key
  if (req.method === 'DELETE') {
    try {
      const { data, error } = await supabase
        .from('api_keys')
        .delete()
        .eq('id', id)
        .select('id, name, masked_key')
        .maybeSingle();

      if (error) {
        console.error('[API Key DELETE] Database error:', error);
        return sendJson(res, 500, {
          success: false,
          error: 'DELETE_ERROR',
          message: error.message
        });
      }

      if (!data) {
        return sendJson(res, 404, {
          success: false,
          error: 'NOT_FOUND',
          message: `API Key with ID ${id} was not found.`
        });
      }

      return sendJson(res, 200, {
        success: true,
        message: `API Key for ${data.name} (${data.masked_key}) has been permanently deleted/revoked.`,
        deletedKey: data
      });
    } catch (err) {
      console.error('[API Key DELETE] Server error:', err);
      return sendJson(res, 500, {
        success: false,
        error: 'SERVER_ERROR',
        message: err.message
      });
    }
  }

  // PATCH: Rotate / Renew API Key (Revokes current, generates new replacement key)
  if (req.method === 'PATCH') {
    try {
      // 1. Fetch current key
      const { data: existing, error: fetchErr } = await supabase
        .from('api_keys')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !existing) {
        return sendJson(res, 404, {
          success: false,
          error: 'NOT_FOUND',
          message: `API Key with ID ${id} was not found.`
        });
      }

      // 2. Generate new key pair
      const { rawKey, keyHash, maskedKey } = generateApiKeyPair();

      // 3. Update record with new hash and mask
      const { data: updated, error: updateErr } = await supabase
        .from('api_keys')
        .update({
          key_hash: keyHash,
          masked_key: maskedKey,
          is_active: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select('id, name, masked_key, is_active, rate_limit, updated_at')
        .single();

      if (updateErr) {
        console.error('[API Key ROTATE] Update error:', updateErr);
        return sendJson(res, 500, {
          success: false,
          error: 'UPDATE_ERROR',
          message: updateErr.message
        });
      }

      // Return the new raw secret key ONCE
      return sendJson(res, 200, {
        success: true,
        message: `API Key for ${updated.name} has been rotated successfully. Old key is revoked. Please copy and store the new secret key now.`,
        apiKey: rawKey,
        keyRecord: updated
      });
    } catch (err) {
      console.error('[API Key ROTATE] Server error:', err);
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
