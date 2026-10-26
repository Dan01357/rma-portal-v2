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

-- ==============================================================================
-- VERIFICATION QUERY
-- SELECT id, name, masked_key, is_active, rate_limit, last_used_at, created_at FROM public.api_keys;
-- ==============================================================================
