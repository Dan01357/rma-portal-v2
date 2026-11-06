-- ==============================================================================
-- IDEMPOTENT MIGRATION: Dedicated public.rma_invites Table & Schema Synchronization
-- File: fix_invites_and_schema.sql
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/lschluviltzsknptwgrz/sql
-- Description:
--   1. Creates public.rma_invites table to eliminate 404 schema cache errors.
--   2. Enables Row Level Security (RLS) with full anon and authenticated access policies.
--   3. Synchronizes stream types (customer_inbound vs. supplier_outbound) and entity names.
--   4. Backfills existing active customer invites from rma_settings.
--   5. Adds rma_invites to supabase_realtime publication for live UI updates.
-- ==============================================================================

-- 1. CREATE DEDICATED RMA INVITES TABLE
CREATE TABLE IF NOT EXISTS public.rma_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL,
  stream_type text NOT NULL CHECK (stream_type IN ('customer_inbound', 'supplier_outbound')) DEFAULT 'customer_inbound',
  authorized_email text NOT NULL,
  entity_name text NOT NULL DEFAULT 'Pingcon Wholesale Client', -- Store Branch or Master Supplier
  store_branch text,                                         -- Backwards-compatibility alias
  duration_value integer DEFAULT 24,
  duration_unit text DEFAULT 'hours',
  duration_display text DEFAULT '24 hours',
  expires_at timestamptz NOT NULL,
  created_by text DEFAULT 'Admin',
  status text DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Ensure backwards-compatibility columns exist if table was partially created
ALTER TABLE public.rma_invites ADD COLUMN IF NOT EXISTS store_branch text;
ALTER TABLE public.rma_invites ALTER COLUMN entity_name SET DEFAULT 'Pingcon Wholesale Client';

-- 2. CREATE INDEXES FOR FAST QUERYING
CREATE INDEX IF NOT EXISTS idx_rma_invites_token ON public.rma_invites(token);
CREATE INDEX IF NOT EXISTS idx_rma_invites_email ON public.rma_invites(authorized_email);
CREATE INDEX IF NOT EXISTS idx_rma_invites_stream ON public.rma_invites(stream_type);
CREATE INDEX IF NOT EXISTS idx_rma_invites_status ON public.rma_invites(status);
CREATE INDEX IF NOT EXISTS idx_rma_invites_expires ON public.rma_invites(expires_at);

-- 3. ENABLE ROW LEVEL SECURITY & FULL ACCESS POLICIES
ALTER TABLE public.rma_invites ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.rma_invites TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Allow full access to rma_invites" ON public.rma_invites;
CREATE POLICY "Allow full access to rma_invites" 
  ON public.rma_invites 
  FOR ALL 
  TO anon, authenticated, service_role 
  USING (true) 
  WITH CHECK (true);

-- 4. AUTOMATIC SYNCHRONIZATION TRIGGER (entity_name <-> store_branch)
CREATE OR REPLACE FUNCTION sync_rma_invites_entity_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.entity_name IS NULL OR NEW.entity_name = '' THEN
    NEW.entity_name := COALESCE(NULLIF(NEW.store_branch, ''), 'Pingcon Wholesale Client');
  END IF;
  IF NEW.store_branch IS NULL OR NEW.store_branch = '' THEN
    NEW.store_branch := NEW.entity_name;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_rma_invites_entity_fields ON public.rma_invites;
CREATE TRIGGER trg_sync_rma_invites_entity_fields
  BEFORE INSERT OR UPDATE ON public.rma_invites
  FOR EACH ROW
  EXECUTE FUNCTION sync_rma_invites_entity_fields();

-- 5. BACKFILL EXISTING INVITES FROM rma_settings (IF PRESENT)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.rma_settings WHERE key = 'customer_rma_invites_store') THEN
    INSERT INTO public.rma_invites (
      token,
      stream_type,
      authorized_email,
      entity_name,
      store_branch,
      duration_value,
      duration_unit,
      duration_display,
      expires_at,
      created_by,
      status,
      created_at,
      updated_at
    )
    SELECT
      elem->>'token' AS token,
      COALESCE(elem->>'stream_type', 'customer_inbound') AS stream_type,
      COALESCE(elem->>'authorized_email', 'unknown@pingconmarketing.com') AS authorized_email,
      COALESCE(NULLIF(elem->>'entity_name', ''), NULLIF(elem->>'store_branch', ''), 'Pingcon Wholesale Client') AS entity_name,
      COALESCE(NULLIF(elem->>'store_branch', ''), NULLIF(elem->>'entity_name', ''), 'Pingcon Wholesale Client') AS store_branch,
      COALESCE((elem->>'duration_value')::integer, 24) AS duration_value,
      COALESCE(elem->>'duration_unit', 'hours') AS duration_unit,
      COALESCE(elem->>'duration_display', '24 hours') AS duration_display,
      (elem->>'expires_at')::timestamptz AS expires_at,
      COALESCE(elem->>'created_by', 'Admin') AS created_by,
      COALESCE(elem->>'status', 'active') AS status,
      COALESCE((elem->>'created_at')::timestamptz, now()) AS created_at,
      now() AS updated_at
    FROM public.rma_settings,
         jsonb_array_elements(value) AS elem
    WHERE key = 'customer_rma_invites_store'
      AND elem->>'token' IS NOT NULL
    ON CONFLICT (token) DO UPDATE SET
      status = EXCLUDED.status,
      expires_at = EXCLUDED.expires_at,
      updated_at = now();
  END IF;
END $$;

-- 6. ENABLE REALTIME PUBLICATION FOR LIVE SYNCHRONIZATION ACROSS ADMIN SESSIONS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'rma_invites'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rma_invites;
  END IF;
END $$;

