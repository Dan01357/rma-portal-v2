-- ==============================================================================
-- 1. ADD REASON, PHOTOS & GPS COLUMNS TO rma_reports
-- ==============================================================================
ALTER TABLE public.rma_reports 
  ADD COLUMN IF NOT EXISTS reason text DEFAULT 'Damaged in Transit / Crushed',
  ADD COLUMN IF NOT EXISTS explanation text,
  ADD COLUMN IF NOT EXISTS photos jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS gps_latitude numeric(10,7),
  ADD COLUMN IF NOT EXISTS gps_longitude numeric(10,7),
  ADD COLUMN IF NOT EXISTS gps_accuracy numeric(8,2),
  ADD COLUMN IF NOT EXISTS gps_timestamp timestamptz;

-- ==============================================================================
-- 2. CREATE SUPABASE STORAGE BUCKET FOR PROOF PHOTOS ('rma-photos')
-- ==============================================================================
INSERT INTO storage.buckets (id, name, public) 
VALUES ('rma-photos', 'rma-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Allow public uploads to 'rma-photos'
DROP POLICY IF EXISTS "Allow public uploads to rma-photos" ON storage.objects;
CREATE POLICY "Allow public uploads to rma-photos" ON storage.objects
  FOR INSERT TO anon, authenticated, service_role
  WITH CHECK (bucket_id = 'rma-photos');

-- Allow public reads from 'rma-photos'
DROP POLICY IF EXISTS "Allow public reads from rma-photos" ON storage.objects;
CREATE POLICY "Allow public reads from rma-photos" ON storage.objects
  FOR SELECT TO anon, authenticated, service_role
  USING (bucket_id = 'rma-photos');
