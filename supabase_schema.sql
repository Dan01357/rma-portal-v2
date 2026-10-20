-- ==============================================================================
-- WHOLESALE RETURN MERCHANDISE AUTHORIZATION (RMA) SYSTEM
-- SUPABASE DATABASE SETUP & SCHEMA
-- Table Target: 'rma_tickets_vault'
-- ==============================================================================

-- 1. Create the rma_tickets_vault table
CREATE TABLE IF NOT EXISTS public.rma_tickets_vault (
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
    contact_email VARCHAR(255)
);

-- 2. Indexes for high performance lookup & filtering
CREATE INDEX IF NOT EXISTS idx_rma_tickets_rma_id ON public.rma_tickets_vault (rma_id);
CREATE INDEX IF NOT EXISTS idx_rma_tickets_company ON public.rma_tickets_vault (company);
CREATE INDEX IF NOT EXISTS idx_rma_tickets_status ON public.rma_tickets_vault (status);
CREATE INDEX IF NOT EXISTS idx_rma_tickets_created_at ON public.rma_tickets_vault (created_at DESC);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.rma_tickets_vault ENABLE ROW LEVEL SECURITY;

-- 4. Set Policies for Public Zero-Login Submissions and Supervisor Management
-- Allow anyone (public/anon) to insert new tickets from the QR portal
CREATE POLICY "Allow public anon inserts into rma_tickets_vault"
ON public.rma_tickets_vault
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Allow public/authenticated to read tickets
CREATE POLICY "Allow read access to rma_tickets_vault"
ON public.rma_tickets_vault
FOR SELECT
TO anon, authenticated
USING (true);

-- Allow updates (for supervisor updates to status and resolution notes)
CREATE POLICY "Allow updates to rma_tickets_vault"
ON public.rma_tickets_vault
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- 5. Supabase Storage Bucket for RMA Defect Photos ('rma-defect-photos')
-- Run in Storage settings or execute below SQL to auto-create public bucket:
INSERT INTO storage.buckets (id, name, public) 
VALUES ('rma-defect-photos', 'rma-defect-photos', true) 
ON CONFLICT (id) DO NOTHING;

-- Policy to allow anonymous uploads to rma-defect-photos
CREATE POLICY "Allow public anon uploads to rma-defect-photos"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (bucket_id = 'rma-defect-photos');

-- Policy to allow public viewing of defect photos
CREATE POLICY "Allow public read of rma-defect-photos"
ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id = 'rma-defect-photos');
