-- ==============================================================================
-- WHOLESALE RMA PORTAL V2 - DATABASE MIGRATION SCRIPT V6
-- 1. Adds Customer AE & Company division columns to products and rma_reports
-- 2. Grants explicit DELETE permissions & RLS DELETE policies
-- ==============================================================================

-- Step 1: Add AE and Company columns to products
ALTER TABLE public.products 
  ADD COLUMN IF NOT EXISTS ae_name text,
  ADD COLUMN IF NOT EXISTS ae_email text,
  ADD COLUMN IF NOT EXISTS company text;

-- Step 2: Add AE and Company columns to rma_reports
ALTER TABLE public.rma_reports 
  ADD COLUMN IF NOT EXISTS ae_name text,
  ADD COLUMN IF NOT EXISTS ae_email text,
  ADD COLUMN IF NOT EXISTS company text;

-- Step 3: Grant explicit DELETE privileges to database roles
GRANT ALL PRIVILEGES ON TABLE public.rma_reports TO anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON TABLE public.products TO anon, authenticated, service_role;

-- Step 4: Add explicit FOR DELETE RLS Policy for rma_reports
DROP POLICY IF EXISTS "Allow anon delete rma_reports" ON public.rma_reports;
CREATE POLICY "Allow anon delete rma_reports" ON public.rma_reports
  FOR DELETE TO anon, authenticated, service_role USING (true);

-- Step 5: Add explicit FOR DELETE RLS Policy for products
DROP POLICY IF EXISTS "Allow anon delete products" ON public.products;
CREATE POLICY "Allow anon delete products" ON public.products
  FOR DELETE TO anon, authenticated, service_role USING (true);

-- Verify policies are active
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename IN ('rma_reports', 'products');
