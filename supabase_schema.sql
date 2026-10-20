-- ==============================================================================
-- WHOLESALE RETURN MERCHANDISE AUTHORIZATION (RMA) SYSTEM
-- SUPABASE DATABASE SETUP & SCHEMA
-- Table Target: 'rma_tickets_vault'
-- ==============================================================================

-- 1. Drop old table if existing with mismatched columns, then recreate cleanly
DROP TABLE IF EXISTS public.rma_tickets_vault CASCADE;

CREATE TABLE public.rma_tickets_vault (
    id BIGSERIAL PRIMARY KEY,
    rma_id VARCHAR(50) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    company VARCHAR(100) NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    sku VARCHAR(100) NOT NULL,
    packaging_unit VARCHAR(50) NOT NULL,
    delivery_reference VARCHAR(100),
    defect_category VARCHAR(100) NOT NULL,
    defect_description TEXT NOT NULL,
    photo_url TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'Pending Inspection' NOT NULL,
    resolution_notes TEXT,
    contact_person VARCHAR(255),
    contact_phone VARCHAR(100),
    contact_email VARCHAR(255),
    assigned_ae VARCHAR(150),
    dispatch_email_status VARCHAR(100) DEFAULT 'Ready for Dispatch'
);

-- If table already exists in existing projects, add new columns cleanly:
ALTER TABLE public.rma_tickets_vault ADD COLUMN IF NOT EXISTS assigned_ae VARCHAR(150);
ALTER TABLE public.rma_tickets_vault ADD COLUMN IF NOT EXISTS dispatch_email_status VARCHAR(100) DEFAULT 'Ready for Dispatch';

-- 2. Indexes for high performance lookup & filtering
CREATE INDEX IF NOT EXISTS idx_rma_tickets_rma_id ON public.rma_tickets_vault (rma_id);
CREATE INDEX IF NOT EXISTS idx_rma_tickets_company ON public.rma_tickets_vault (company);
CREATE INDEX IF NOT EXISTS idx_rma_tickets_status ON public.rma_tickets_vault (status);
CREATE INDEX IF NOT EXISTS idx_rma_tickets_created_at ON public.rma_tickets_vault (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rma_tickets_assigned_ae ON public.rma_tickets_vault (assigned_ae);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.rma_tickets_vault ENABLE ROW LEVEL SECURITY;

-- 4. Open Policies for Public Zero-Login Submissions and Supervisor Management
DROP POLICY IF EXISTS "Allow public inserts" ON public.rma_tickets_vault;
DROP POLICY IF EXISTS "Allow public anon inserts into rma_tickets_vault" ON public.rma_tickets_vault;
CREATE POLICY "Allow public inserts" 
ON public.rma_tickets_vault 
FOR INSERT 
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow read access to rma_tickets_vault" ON public.rma_tickets_vault;
CREATE POLICY "Allow read access to rma_tickets_vault"
ON public.rma_tickets_vault
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Allow updates to rma_tickets_vault" ON public.rma_tickets_vault;
CREATE POLICY "Allow updates to rma_tickets_vault"
ON public.rma_tickets_vault
FOR UPDATE
USING (true)
WITH CHECK (true);

-- 5. Supabase Storage Bucket for RMA Defect Photos ('rma-defect-photos')
INSERT INTO storage.buckets (id, name, public) 
VALUES ('rma-defect-photos', 'rma-defect-photos', true) 
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Allow public uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow public anon uploads to rma-defect-photos" ON storage.objects;
CREATE POLICY "Allow public uploads" 
ON storage.objects 
FOR INSERT 
WITH CHECK (bucket_id = 'rma-defect-photos');

DROP POLICY IF EXISTS "Allow public read of rma-defect-photos" ON storage.objects;
CREATE POLICY "Allow public read of rma-defect-photos"
ON storage.objects 
FOR SELECT 
USING (bucket_id = 'rma-defect-photos');
