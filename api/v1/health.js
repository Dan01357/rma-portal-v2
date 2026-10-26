import { supabase } from '../_lib/supabase.js';
import { setCorsHeaders, sendJson } from '../_lib/auth.js';
import { hashApiKey } from '../_lib/keyUtils.js';

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const startTime = Date.now();
  let dbStatus = 'connected';
  let dbLatencyMs = 0;

  try {
    const { error } = await supabase.from('api_keys').select('id').limit(1);
    dbLatencyMs = Date.now() - startTime;
    if (error) {
      dbStatus = 'degraded';
    }
  } catch (e) {
    dbStatus = 'disconnected';
    dbLatencyMs = Date.now() - startTime;
  }

  // Optional client identity check
  let clientIdentity = 'public / unauthenticated';
  let rawKey = req.headers['x-api-key'];
  if (!rawKey && req.headers['authorization']) {
    const authHeader = req.headers['authorization'];
    rawKey = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();
  }

  if (rawKey) {
    const keyHash = hashApiKey(rawKey);
    const { data: keyRecord } = await supabase
      .from('api_keys')
      .select('name, masked_key, is_active')
      .eq('key_hash', keyHash)
      .maybeSingle();

    if (keyRecord && keyRecord.is_active) {
      clientIdentity = `${keyRecord.name} (${keyRecord.masked_key})`;
    } else {
      clientIdentity = 'invalid or revoked key';
    }
  }

  return sendJson(res, 200, {
    status: 'healthy',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: 'production',
    service: 'Wholesale RMA Multi-System REST API',
    database: {
      status: dbStatus,
      latency_ms: dbLatencyMs
    },
    authenticated_client: clientIdentity,
    documentation: '/docs'
  });
}
