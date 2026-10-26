import { supabase } from './supabase.js';
import { hashApiKey } from './keyUtils.js';

/**
 * Applies standard RFC CORS headers to the response.
 * Dynamically reflects caller origin when present to support browser clients (fetch/axios) with credentials.
 */
export function setCorsHeaders(res, req = null) {
  const origin = req?.headers?.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-api-key, Authorization'
  );
  res.setHeader('Access-Control-Max-Age', '86400');
}

/**
 * Standardized JSON response helper.
 */
export function sendJson(res, statusCode, body, req = null) {
  setCorsHeaders(res, req);
  return res.status(statusCode).json(body);
}

/**
 * Validates request API key against SHA-256 hashed keys in Supabase database.
 * Supports:
 *  - Header: x-api-key: sk_live_...
 *  - Header: Authorization: Bearer sk_live_...
 * 
 * Returns client context { id, name, rateLimit, maskedKey } or throws/responds with 401/403.
 */
export async function requireApiKey(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return null;
  }

  // 1. Extract raw key
  let rawKey = req.headers['x-api-key'];

  if (!rawKey && req.headers['authorization']) {
    const authHeader = req.headers['authorization'];
    if (authHeader.startsWith('Bearer ')) {
      rawKey = authHeader.substring(7).trim();
    } else {
      rawKey = authHeader.trim();
    }
  }

  if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim()) {
    sendJson(res, 401, {
      success: false,
      error: 'Unauthorized',
      code: 'MISSING_API_KEY',
      message: "Missing API key. Provide via 'x-api-key' header or 'Authorization: Bearer <key>'."
    });
    return null;
  }

  // 2. Hash key using SHA-256
  const keyHash = hashApiKey(rawKey);

  // 3. Query Supabase
  try {
    const { data: keyRecord, error } = await supabase
      .from('api_keys')
      .select('*')
      .eq('key_hash', keyHash)
      .maybeSingle();

    if (error) {
      console.error('[API Auth] Database query error:', error);
      sendJson(res, 500, {
        success: false,
        error: 'Internal Server Error',
        code: 'AUTH_DB_ERROR',
        message: 'Failed to verify API key against database.'
      });
      return null;
    }

    if (!keyRecord) {
      sendJson(res, 401, {
        success: false,
        error: 'Unauthorized',
        code: 'INVALID_API_KEY',
        message: 'The provided API key does not exist or is invalid.'
      });
      return null;
    }

    // 4. Check active status
    if (!keyRecord.is_active) {
      sendJson(res, 403, {
        success: false,
        error: 'Forbidden',
        code: 'KEY_REVOKED',
        message: 'This API key has been revoked and is inactive.'
      });
      return null;
    }

    // 5. Check expiration if configured
    if (keyRecord.expires_at) {
      const expiry = new Date(keyRecord.expires_at);
      if (expiry < new Date()) {
        sendJson(res, 403, {
          success: false,
          error: 'Forbidden',
          code: 'KEY_EXPIRED',
          message: `This API key expired on ${expiry.toISOString()}.`
        });
        return null;
      }
    }

    // 6. Asynchronously update last_used_at timestamp (fire and forget)
    supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyRecord.id)
      .then(() => {})
      .catch((err) => console.warn('[API Auth] Update last_used_at notice:', err));

    // 7. Inject client context into request
    const client = {
      id: keyRecord.id,
      name: keyRecord.name,
      rateLimit: keyRecord.rate_limit || 60,
      maskedKey: keyRecord.masked_key
    };

    req.client = client;
    return client;
  } catch (err) {
    console.error('[API Auth] Unexpected exception:', err);
    sendJson(res, 500, {
      success: false,
      error: 'Internal Server Error',
      code: 'AUTH_EXCEPTION',
      message: 'Unexpected authentication error.'
    });
    return null;
  }
}
