-- ==============================================================================
-- UNIFIED "ROLE-BASED QR CODE & 6-DIGIT PIN GATEKEEPER ENGINE"
-- Table: public.portal_access_keys
-- Description: Stores customizable QR Access Profiles for Warehouse & Customer Intake.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.portal_access_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,                                       -- e.g. "Main Warehouse Floor", "Customer Delivery Boxes"
  type text NOT NULL CHECK (type IN ('internal_warehouse', 'external_customer')),
  access_slug text UNIQUE NOT NULL,                         -- e.g. "dock", "returns"
  pin_code varchar(6) NOT NULL,                             -- 6-digit numeric PIN, e.g. "123456"
  session_duration_hours integer DEFAULT 0,                 -- 0 = No Expiry (internal); >0 e.g. 2, 4, 24 for customer devices
  is_active boolean DEFAULT true,
  created_by text DEFAULT 'System Admin',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Optimize slug lookups during gatekeeping
CREATE INDEX IF NOT EXISTS idx_portal_access_keys_slug ON public.portal_access_keys(access_slug);
CREATE INDEX IF NOT EXISTS idx_portal_access_keys_active ON public.portal_access_keys(is_active);

-- Enable Row Level Security (RLS) and grant permissions
ALTER TABLE public.portal_access_keys ENABLE ROW LEVEL SECURITY;
GRANT ALL PRIVILEGES ON TABLE public.portal_access_keys TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Allow anon full access portal_access_keys" ON public.portal_access_keys;
CREATE POLICY "Allow anon full access portal_access_keys" ON public.portal_access_keys
  FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

-- Seed two default profiles if empty:
-- 1. Main Warehouse Floor: internal_warehouse, slug 'dock', PIN '123456', Duration 0 (No Expiry)
-- 2. Customer Delivery Boxes: external_customer, slug 'returns', PIN '654321', Duration 2 (2 Hours per device)
INSERT INTO public.portal_access_keys (name, type, access_slug, pin_code, session_duration_hours, is_active, created_by)
VALUES 
  ('Main Warehouse Floor', 'internal_warehouse', 'dock', '123456', 0, true, 'System Default'),
  ('Customer Delivery Boxes', 'external_customer', 'returns', '654321', 2, true, 'System Default')
ON CONFLICT (access_slug) DO NOTHING;

