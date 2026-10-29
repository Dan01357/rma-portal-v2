-- ==============================================================================
-- UNBYPASSABLE ANTI-FRAUD COOLDOWN LOCKOUT SYSTEM
-- Tables: public.device_intake_sessions & updates to public.portal_access_keys
-- Description: Enforces hardware-level device & IP cooldown tracking to prevent
--              incognito, multi-browser, or cache-clearing bypasses.
-- ==============================================================================

-- 1. Add cooldown_duration_hours to public.portal_access_keys if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'portal_access_keys' 
      AND column_name = 'cooldown_duration_hours'
  ) THEN
    ALTER TABLE public.portal_access_keys 
    ADD COLUMN cooldown_duration_hours integer DEFAULT 6;
  END IF;
END $$;

-- Update Customer Delivery Boxes default profile with 6-hour cooldown
UPDATE public.portal_access_keys
SET cooldown_duration_hours = 6
WHERE access_slug = 'returns' AND (cooldown_duration_hours IS NULL OR cooldown_duration_hours = 0);

-- 2. Create public.device_intake_sessions tracking table
CREATE TABLE IF NOT EXISTS public.device_intake_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.portal_access_keys(id) ON DELETE CASCADE,
  access_slug text NOT NULL,
  device_fingerprint text NOT NULL,
  ip_address text NOT NULL,
  session_started_at timestamptz DEFAULT now(),
  session_expires_at timestamptz NOT NULL,
  cooldown_until timestamptz NOT NULL,
  status text CHECK (status IN ('active', 'in_cooldown', 'expired')) DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

-- 3. High-performance composite indexes for instant gatekeeper lookups
CREATE INDEX IF NOT EXISTS idx_device_sessions_lookup 
  ON public.device_intake_sessions (access_slug, device_fingerprint, ip_address);

CREATE INDEX IF NOT EXISTS idx_device_sessions_cooldown 
  ON public.device_intake_sessions (access_slug, cooldown_until);

CREATE INDEX IF NOT EXISTS idx_device_sessions_profile 
  ON public.device_intake_sessions (profile_id);

-- 4. Enable Row Level Security (RLS) & grant permissions
ALTER TABLE public.device_intake_sessions ENABLE ROW LEVEL SECURITY;
GRANT ALL PRIVILEGES ON TABLE public.device_intake_sessions TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Allow anon full access device_intake_sessions" ON public.device_intake_sessions;
CREATE POLICY "Allow anon full access device_intake_sessions" ON public.device_intake_sessions
  FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);
