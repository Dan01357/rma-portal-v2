-- ==============================================================================
-- ENABLE PUBLIC / ANONYMOUS ACCESS FOR WHOLESALE RMA PORTAL (DOCK SCANNERS & CUSTOMERS)
--
-- Instructions:
-- 1. Open your Supabase Dashboard: https://supabase.com/dashboard/project/lschluviltzsknptwgrz
-- 2. Click "SQL Editor" in the left sidebar
-- 3. Click "New query", paste this entire script, and click "Run" (or Ctrl + Enter)
-- ==============================================================================

-- 1. Ensure core tables have Row Level Security enabled
ALTER TABLE IF EXISTS public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.rma_reports ENABLE ROW LEVEL SECURITY;

-- 2. Grant table permissions to anon, authenticated, and service_role
GRANT ALL PRIVILEGES ON TABLE public.products TO anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON TABLE public.rma_reports TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- 3. Public Read-Only Policy for products (Allows anonymous dock workers & phones to look up barcodes)
DROP POLICY IF EXISTS "Allow public read-only access to products" ON public.products;
DROP POLICY IF EXISTS "Allow anon read all products" ON public.products;
CREATE POLICY "Allow public read-only access to products" ON public.products
  FOR SELECT TO anon, authenticated, service_role USING (true);

-- 4. Public Insert & Read Policy for rma_reports (Allows anonymous dock workers & phones to file returns)
DROP POLICY IF EXISTS "Allow public insert to rma_reports" ON public.rma_reports;
DROP POLICY IF EXISTS "Allow anon insert rma_reports" ON public.rma_reports;
CREATE POLICY "Allow public insert to rma_reports" ON public.rma_reports
  FOR INSERT TO anon, authenticated, service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public read-only access to rma_reports" ON public.rma_reports;
DROP POLICY IF EXISTS "Allow anon read all rma_reports" ON public.rma_reports;
CREATE POLICY "Allow public read-only access to rma_reports" ON public.rma_reports
  FOR SELECT TO anon, authenticated, service_role USING (true);

-- 5. Public Upload Policy for Proof Photos (Storage bucket: rma-photos)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('rma-photos', 'rma-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Allow public uploads to rma-photos" ON storage.objects;
CREATE POLICY "Allow public uploads to rma-photos" ON storage.objects
  FOR INSERT TO anon, authenticated, service_role
  WITH CHECK (bucket_id = 'rma-photos');

DROP POLICY IF EXISTS "Allow public reads from rma-photos" ON storage.objects;
CREATE POLICY "Allow public reads from rma-photos" ON storage.objects
  FOR SELECT TO anon, authenticated, service_role
  USING (bucket_id = 'rma-photos');

-- 6. Verification confirmation
SELECT 
  'Public Anon Access Configured Successfully' AS status,
  NOW() AS executed_at;
