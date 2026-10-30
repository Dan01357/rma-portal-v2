-- ==============================================================================
-- WHOLESALE RMA PORTAL - AI PAPERWORK INSPECTION & GOOGLE DRIVE STORAGE COLUMNS
-- Run in Supabase SQL Editor:
-- ==============================================================================

ALTER TABLE public.rma_reports
  ADD COLUMN IF NOT EXISTS paperwork_photos jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS invoice_dr_number text,
  ADD COLUMN IF NOT EXISTS store_branch text,
  ADD COLUMN IF NOT EXISTS ai_document_metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS google_drive_folder_url text,
  ADD COLUMN IF NOT EXISTS google_drive_folder_id text;

-- Fast search indexes for invoice DR numbers and branch names
CREATE INDEX IF NOT EXISTS idx_rma_reports_invoice_dr ON public.rma_reports(invoice_dr_number);
CREATE INDEX IF NOT EXISTS idx_rma_reports_store_branch ON public.rma_reports(store_branch);
