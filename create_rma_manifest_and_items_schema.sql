-- ==============================================================================
-- MIGRATION: Multi-Item Batch Returns (Manifest Mode) and RMA Line Items Schema
-- ==============================================================================

-- 1. Add Manifest & Parent/Child linking columns to public.rma_reports
ALTER TABLE public.rma_reports
  ADD COLUMN IF NOT EXISTS parent_rma_id bigint REFERENCES public.rma_reports(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_parent boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS items jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS total_items integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS total_quantity integer DEFAULT 1;

-- 2. Create normalized public.rma_items table for line-item queries and reporting
CREATE TABLE IF NOT EXISTS public.rma_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rma_report_id bigint REFERENCES public.rma_reports(id) ON DELETE CASCADE,
  rma_number text NOT NULL,
  barcode text NOT NULL,
  sku text,
  name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_name text NOT NULL DEFAULT 'pc',
  price numeric(12, 2) NOT NULL DEFAULT 0.00,
  price_with_vat numeric(12, 2) NOT NULL DEFAULT 0.00,
  supplier_name text NOT NULL DEFAULT 'Savemore',
  reason text NOT NULL DEFAULT 'Damaged Box / Crushed Packaging',
  explanation text,
  expiry_date date,
  batch_lot_number text,
  photos jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 3. Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_rma_reports_parent_rma_id ON public.rma_reports(parent_rma_id);
CREATE INDEX IF NOT EXISTS idx_rma_reports_is_parent ON public.rma_reports(is_parent);
CREATE INDEX IF NOT EXISTS idx_rma_items_rma_report_id ON public.rma_items(rma_report_id);
CREATE INDEX IF NOT EXISTS idx_rma_items_rma_number ON public.rma_items(rma_number);
CREATE INDEX IF NOT EXISTS idx_rma_items_barcode ON public.rma_items(barcode);

-- 4. Enable RLS and Grant Permissions
ALTER TABLE public.rma_items ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.rma_items TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Allow anon read all rma_items" ON public.rma_items;
CREATE POLICY "Allow anon read all rma_items" ON public.rma_items FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow anon insert rma_items" ON public.rma_items;
CREATE POLICY "Allow anon insert rma_items" ON public.rma_items FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon update rma_items" ON public.rma_items;
CREATE POLICY "Allow anon update rma_items" ON public.rma_items FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow anon delete rma_items" ON public.rma_items;
CREATE POLICY "Allow anon delete rma_items" ON public.rma_items FOR DELETE USING (true);

-- 5. Realtime replication setup for rma_items
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = 'rma_items'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.rma_items;
    END IF;
  END IF;
END $$;

