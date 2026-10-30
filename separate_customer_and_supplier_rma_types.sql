-- ==============================================================================
-- WHOLESALE RMA PORTAL V2: SEPARATE CUSTOMER INBOUND & SUPPLIER OUTBOUND RETURNS
-- ==============================================================================
-- Cleanly separates:
-- 1. Customer Returns (Inbound Logistics): Branch/store returns pending inspection and Credit Memos
-- 2. Supplier Returns (Outbound Logistics / RTV): Warehouse defective stock pending vendor debit claims
-- ==============================================================================

-- 1. Add rma_type column to public.rma_reports with strict CHECK constraint and default
ALTER TABLE public.rma_reports
ADD COLUMN IF NOT EXISTS rma_type text 
  CHECK (rma_type IN ('customer_inbound', 'supplier_outbound')) 
  DEFAULT 'customer_inbound';

-- 2. Backfill existing records to ensure backward compatibility
-- Historical records with 'Return to Vendor (RTV)' disposition or from internal warehouse dock are supplier outbound;
-- all others default safely to 'customer_inbound'.
UPDATE public.rma_reports
SET rma_type = CASE 
  WHEN disposition ILIKE '%Return to Vendor%' OR disposition ILIKE '%RTV%' THEN 'supplier_outbound'
  ELSE 'customer_inbound'
END
WHERE rma_type IS NULL;

-- 3. Performance Indexes for Instant Tab Isolation in Admin Dashboard
CREATE INDEX IF NOT EXISTS idx_rma_reports_rma_type 
  ON public.rma_reports (rma_type);

CREATE INDEX IF NOT EXISTS idx_rma_reports_type_status 
  ON public.rma_reports (rma_type, status);

CREATE INDEX IF NOT EXISTS idx_rma_reports_type_created 
  ON public.rma_reports (rma_type, created_at DESC);

-- 4. Verify Schema Mutation
COMMENT ON COLUMN public.rma_reports.rma_type IS 
  'Logistics classification: customer_inbound (customer/store return) or supplier_outbound (warehouse vendor return/RTV claim)';
