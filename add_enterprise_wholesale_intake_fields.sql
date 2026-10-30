-- ==============================================================================
-- WHOLESALE RMA PORTAL - ENTERPRISE WHOLESALE INTAKE FIELDS
-- Standard FMCG & Wholesale Distribution Columns (SAP / Oracle SCM aligned)
-- Run in Supabase SQL Editor:
-- ==============================================================================

ALTER TABLE public.rma_reports
  ADD COLUMN IF NOT EXISTS store_branch text,
  ADD COLUMN IF NOT EXISTS invoice_dr_number text,
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS batch_lot_number text;

-- Fast search indexes
CREATE INDEX IF NOT EXISTS idx_rma_reports_store_branch ON public.rma_reports(store_branch);
CREATE INDEX IF NOT EXISTS idx_rma_reports_invoice_dr ON public.rma_reports(invoice_dr_number);
CREATE INDEX IF NOT EXISTS idx_rma_reports_expiry_date ON public.rma_reports(expiry_date);
CREATE INDEX IF NOT EXISTS idx_rma_reports_batch_lot ON public.rma_reports(batch_lot_number);
