-- ==============================================================================
-- WHOLESALE RMA PORTAL V2 - ENTERPRISE TRIAGE & DISPOSITION SCHEMA (V7)
-- Run this script in Supabase: Dashboard > SQL Editor > New query > Run
-- ==============================================================================

-- 1. ADD ENTERPRISE TRIAGE & LOGISTICS COLUMNS TO public.rma_reports
ALTER TABLE public.rma_reports 
  ADD COLUMN IF NOT EXISTS condition_grade text DEFAULT 'B - Damaged Packaging Only',
  ADD COLUMN IF NOT EXISTS disposition text DEFAULT 'Pending Triage',
  ADD COLUMN IF NOT EXISTS warehouse_location text,
  ADD COLUMN IF NOT EXISTS inspected_by text,
  ADD COLUMN IF NOT EXISTS inspected_at timestamptz,
  ADD COLUMN IF NOT EXISTS audit_trail jsonb DEFAULT '[]'::jsonb;

-- 2. CREATE FAST LOOKUP INDEXES FOR WAREHOUSE TRIAGE & DISPOSITION
CREATE INDEX IF NOT EXISTS idx_rma_reports_disposition ON public.rma_reports(disposition);
CREATE INDEX IF NOT EXISTS idx_rma_reports_condition_grade ON public.rma_reports(condition_grade);
CREATE INDEX IF NOT EXISTS idx_rma_reports_warehouse_location ON public.rma_reports(warehouse_location);

-- 3. VERIFY
SELECT id, rma_number, condition_grade, disposition, warehouse_location, inspected_by, inspected_at 
FROM public.rma_reports 
LIMIT 5;
