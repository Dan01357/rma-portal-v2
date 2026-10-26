-- ==============================================================================
-- WHOLESALE RMA PORTAL V2 - API KEYS SCHEMA MIGRATION (SUPABASE POSTGRESQL)
-- Project: rma-system-v2
-- Purpose: Secure SHA-256 Hashed API Key Management for 4 Client Systems:
--   1. Primary System (Mine)
--   2. Jarmen
--   3. Jelo
--   4. Arlito
-- ==============================================================================

-- 1. CREATE TABLE public.api_keys
CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,                                -- "Primary System (Mine)", "Jarmen", "Jelo", "Arlito"
  key_hash text UNIQUE NOT NULL,                     -- SHA-256 hash of secret key (never plain text)
  masked_key text NOT NULL,                          -- e.g. "sk_live_...4a2b" (safe for UI display)
  is_active boolean DEFAULT true,                    -- Active status
  rate_limit integer DEFAULT 60,                     -- Max requests per minute
  expires_at timestamptz,                            -- Optional expiration timestamp
  last_used_at timestamptz,                          -- Updated automatically on valid API calls
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. CREATE FAST LOOKUP INDEXES
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON public.api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_name ON public.api_keys(name);
CREATE INDEX IF NOT EXISTS idx_api_keys_is_active ON public.api_keys(is_active);

-- 3. ENABLE ROW LEVEL SECURITY & PERMISSIONS
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.api_keys TO anon, authenticated, service_role;

-- Policies for public.api_keys
DROP POLICY IF EXISTS "Allow full access for API key operations" ON public.api_keys;
CREATE POLICY "Allow full access for API key operations" ON public.api_keys
  FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

-- 4. INITIAL SEED KEYS FOR 4 CLIENT SYSTEMS
-- Note: Raw keys to distribute:
--   Primary System (Mine) : sk_live_rma_31cbd381bef1941ee7a34471ba3582194d1e538c6b41ebe8
--   Jarmen                : sk_live_rma_b68541b70325e2d858fbf11a4adbb6fcc79709c075cee6c6
--   Jelo                  : sk_live_rma_574476c1afcf114ccbae34a19a6e4d8c26fce0765a768698
--   Arlito                : sk_live_rma_7602959976377c494c5081f98b8556492f725dc0f9be3738

INSERT INTO public.api_keys (name, key_hash, masked_key, is_active, rate_limit)
VALUES
  ('Primary System (Mine)', '193fd3625aa8d92cada37559077d505835788bc7857782bc7638e40f9f80b25d', 'sk_live_...ebe8', true, 120),
  ('Jarmen',                '482b643d99ee07125a4744481f5ffd1978212c75b3359e96fb025e8fb0bafbf5', 'sk_live_...e6c6', true, 60),
  ('Jelo',                  '56d39f1668d4bb4b5faf4a67759e75c16706f7f1ccfb35bd119ba1f3f8d73924', 'sk_live_...8698', true, 60),
  ('Arlito',                '23073ef83400383b29f122c29ec9bce8ff7fc93f963ece4ac092ff4f4827e3ef', 'sk_live_...3738', true, 60)
ON CONFLICT (key_hash) DO NOTHING;

-- 5. VERIFICATION QUERY
SELECT id, name, masked_key, is_active, rate_limit, last_used_at, created_at FROM public.api_keys;
