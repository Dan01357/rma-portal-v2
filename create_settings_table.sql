-- CREATE TABLE: public.rma_settings
-- System Configuration & Settings Table for Wholesale RMA Portal

CREATE TABLE IF NOT EXISTS public.rma_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.rma_settings ENABLE ROW LEVEL SECURITY;

-- Allow read access for all clients
CREATE POLICY "Allow read access to rma_settings"
  ON public.rma_settings
  FOR SELECT
  USING (true);

-- Allow write/upsert access to rma_settings
CREATE POLICY "Allow upsert to rma_settings"
  ON public.rma_settings
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Seed default email recipients
INSERT INTO public.rma_settings (key, value, updated_at)
VALUES (
  'email_recipients',
  '{
    "toEmail": "azgodev@gmail.com",
    "baseCcList": [
      "mgan@pingconmarketing.com",
      "marketing@pingconmarketing.com",
      "azgan@pingconmarketing.com",
      "jaezelle.benito@pingconmarketing.com"
    ]
  }'::jsonb,
  NOW()
)
ON CONFLICT (key) DO NOTHING;
