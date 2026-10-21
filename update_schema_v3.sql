-- ==============================================================================
-- UPDATE SCHEMA V3: Product Reference Image + Reporter Name & Contact
-- ==============================================================================

-- 1. Add image_url to products (stores optional product reference photo from admin)
ALTER TABLE public.products 
  ADD COLUMN IF NOT EXISTS image_url text;

-- 2. Add reporter_name and reporter_contact to rma_reports
ALTER TABLE public.rma_reports 
  ADD COLUMN IF NOT EXISTS reporter_name text,
  ADD COLUMN IF NOT EXISTS reporter_contact text;
