-- ==============================================================================
-- UPDATE SCHEMA V5: Products Delete Policy & Supabase Realtime Publication
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/lschluviltzsknptwgrz/sql
-- ==============================================================================

-- 1. ALLOW DELETE ON PRODUCTS TABLE
DROP POLICY IF EXISTS "Allow anon delete products" ON public.products;
CREATE POLICY "Allow anon delete products" ON public.products
  FOR DELETE TO anon, authenticated, service_role USING (true);

-- 2. ENABLE REALTIME PUBLICATION FOR REALTIME BROADCASTING
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'products'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'rma_reports'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rma_reports;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'admin_users'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_users;
  END IF;
END $$;
