-- ==============================================================================
-- WHOLESALE RMA PORTAL V2 - FREE-TIER DATABASE INDEXING & OPTIMIZATION SCRIPT
-- Target: Supabase Free-Tier (PostgreSQL 15+)
-- Purpose: Eliminate sequential table scans, minimize CPU/RAM utilization,
--          and prevent compute/connection spikes under free-tier caps.
-- Execution: Copy & run in Supabase Dashboard > SQL Editor > New query > Run
-- ==============================================================================

-- 1. INDEXES ON public.rma_reports (Most frequently queried & sorted table)
-- Accelerates fast barcode lookup, RMA search, status filtering, and date ordering.
CREATE INDEX IF NOT EXISTS idx_rma_reports_rma_number 
  ON public.rma_reports(rma_number);

CREATE INDEX IF NOT EXISTS idx_rma_reports_barcode 
  ON public.rma_reports(barcode);

CREATE INDEX IF NOT EXISTS idx_rma_reports_supplier_name 
  ON public.rma_reports(supplier_name);

CREATE INDEX IF NOT EXISTS idx_rma_reports_status 
  ON public.rma_reports(status);

CREATE INDEX IF NOT EXISTS idx_rma_reports_created_at 
  ON public.rma_reports(created_at DESC);

-- Composite index for the main Admin Return Reports tab: filters by status and sorts by created_at
CREATE INDEX IF NOT EXISTS idx_rma_reports_status_created 
  ON public.rma_reports(status, created_at DESC);

-- Logistics & Triage lookup indexes
CREATE INDEX IF NOT EXISTS idx_rma_reports_disposition 
  ON public.rma_reports(disposition);

CREATE INDEX IF NOT EXISTS idx_rma_reports_condition_grade 
  ON public.rma_reports(condition_grade);

CREATE INDEX IF NOT EXISTS idx_rma_reports_warehouse_location 
  ON public.rma_reports(warehouse_location);


-- 2. INDEXES ON public.products (Master Catalog & Dock Auto-Suggest)
-- Prevents full table scan on every barcode intake or product search.
CREATE INDEX IF NOT EXISTS idx_products_barcode 
  ON public.products(barcode);

CREATE INDEX IF NOT EXISTS idx_products_code 
  ON public.products(code);

CREATE INDEX IF NOT EXISTS idx_products_supplier_name 
  ON public.products(supplier_name);

CREATE INDEX IF NOT EXISTS idx_products_is_verified 
  ON public.products(is_verified);

CREATE INDEX IF NOT EXISTS idx_products_updated_at 
  ON public.products(updated_at DESC);


-- 3. INDEXES ON public.credit_memos (Finance Claims & BIR Vouchers)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'credit_memos') THEN
    CREATE INDEX IF NOT EXISTS idx_credit_memos_rma_number 
      ON public.credit_memos(rma_number);
    CREATE INDEX IF NOT EXISTS idx_credit_memos_cm_number 
      ON public.credit_memos(credit_memo_number);
    CREATE INDEX IF NOT EXISTS idx_credit_memos_status 
      ON public.credit_memos(status);
    CREATE INDEX IF NOT EXISTS idx_credit_memos_created_at 
      ON public.credit_memos(created_at DESC);
  END IF;
END $$;


-- 4. INDEXES ON public.api_keys (REST API Partner SHA-256 Auth Vault)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'api_keys') THEN
    CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash 
      ON public.api_keys(key_hash);
    CREATE INDEX IF NOT EXISTS idx_api_keys_is_active 
      ON public.api_keys(is_active);
  END IF;
END $$;


-- 5. INDEXES ON public.rma_settings (System Config & Recipients)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'rma_settings') THEN
    CREATE INDEX IF NOT EXISTS idx_rma_settings_key 
      ON public.rma_settings(key);
  END IF;
END $$;


-- ==============================================================================
-- 6. VERIFICATION: DISPLAY CREATED FREE-TIER OPTIMIZATION INDEXES
-- ==============================================================================
SELECT 
    tablename, 
    indexname, 
    indexdef 
FROM pg_indexes 
WHERE schemaname = 'public' 
  AND tablename IN ('rma_reports', 'products', 'credit_memos', 'api_keys', 'rma_settings')
ORDER BY tablename, indexname;
