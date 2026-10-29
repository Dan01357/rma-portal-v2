-- ======================================================================
-- SUPABASE SQL MIGRATION: PIN REQUESTS AUDIT TABLE
-- Table: public.pin_requests
-- Track, review, and audit 6-digit PIN access requests for QR profiles
-- ======================================================================

CREATE TABLE IF NOT EXISTS public.pin_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_key_id uuid REFERENCES public.portal_access_keys(id) ON DELETE CASCADE,
  access_slug text NOT NULL,
  requester_email text NOT NULL,
  requester_name text NOT NULL,
  organization_name text,
  notes text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by text,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Optimized Indexes for Real-Time Queue & Admin Filtering
CREATE INDEX IF NOT EXISTS idx_pin_requests_status ON public.pin_requests(status);
CREATE INDEX IF NOT EXISTS idx_pin_requests_access_slug ON public.pin_requests(access_slug);
CREATE INDEX IF NOT EXISTS idx_pin_requests_created_at ON public.pin_requests(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.pin_requests ENABLE ROW LEVEL SECURITY;

-- Allow public anonymous reporters to submit PIN requests
DROP POLICY IF EXISTS "Allow public insert to pin_requests" ON public.pin_requests;
CREATE POLICY "Allow public insert to pin_requests" 
ON public.pin_requests FOR INSERT 
TO public 
WITH CHECK (true);

-- Allow reading PIN requests (for admin management queue and status lookups)
DROP POLICY IF EXISTS "Allow select on pin_requests" ON public.pin_requests;
CREATE POLICY "Allow select on pin_requests" 
ON public.pin_requests FOR SELECT 
TO public 
USING (true);

-- Allow updating PIN requests (for admin approvals, rejections, and review timestamps)
DROP POLICY IF EXISTS "Allow update on pin_requests" ON public.pin_requests;
CREATE POLICY "Allow update on pin_requests" 
ON public.pin_requests FOR UPDATE 
TO public 
USING (true);

-- Allow deleting old or invalid PIN requests
DROP POLICY IF EXISTS "Allow delete on pin_requests" ON public.pin_requests;
CREATE POLICY "Allow delete on pin_requests" 
ON public.pin_requests FOR DELETE 
TO public 
USING (true);

-- Optional: Comments for PostgREST schema introspection
COMMENT ON TABLE public.pin_requests IS 'Log of 6-digit PIN requests submitted by external stores and warehouse personnel';

