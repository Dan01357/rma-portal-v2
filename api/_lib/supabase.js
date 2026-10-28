import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://lschluviltzsknptwgrz.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_Jrv9ZNgGXJ4PZoNWCJSHxQ_7hZtQqd3';

// Dummy WebSocket class to avoid Node.js Realtime WebSocket instantiation error in serverless environments
class NoopWebSocketTransport {}

/**
 * Free-Tier Connection Optimization:
 * Serverless lambdas run over HTTPS/PostgREST.
 * Caching on globalThis reuses TCP/TLS connections and HTTP keep-alive agents across warm Vercel invocations,
 * preventing connection spikes against Supabase's free-tier pool.
 * Note: If using direct PostgreSQL connections (e.g. pg / prisma), use Supavisor Transaction Pooler port 6543.
 */
function getSupabaseClient() {
  if (globalThis._supabaseServerlessClient) {
    return globalThis._supabaseServerlessClient;
  }

  const client = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      transport: NoopWebSocketTransport,
    },
  });

  globalThis._supabaseServerlessClient = client;
  return client;
}

export const supabase = getSupabaseClient();

