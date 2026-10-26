-- ==============================================================================
-- INITIAL SEED SCRIPT: API KEYS FOR JARMEN, JELO, ARLITO & PRIMARY SYSTEM
-- Run this script in Supabase: Dashboard > SQL Editor > New query > Run
-- ==============================================================================
--
--  CORRESPONDING PLAIN-TEXT KEYS (Copy and securely provide to each client):
--  -------------------------------------------------------------------------
--  1. Primary System (Mine):
--     sk_live_rma_31cbd381bef1941ee7a34471ba3582194d1e538c6b41ebe8
--
--  2. Jarmen:
--     sk_live_rma_b68541b70325e2d858fbf11a4adbb6fcc79709c075cee6c6
--
--  3. Jelo:
--     sk_live_rma_574476c1afcf114ccbae34a19a6e4d8c26fce0765a768698
--
--  4. Arlito:
--     sk_live_rma_7602959976377c494c5081f98b8556492f725dc0f9be3738
--
-- ==============================================================================

-- Remove any old test keys for these systems to prevent duplicate unique key_hash
DELETE FROM public.api_keys WHERE name IN ('Primary System (Mine)', 'Jarmen', 'Jelo', 'Arlito');

-- Insert Initial Active Keys with Pre-Computed SHA-256 Hashes
INSERT INTO public.api_keys (name, key_hash, masked_key, is_active, rate_limit)
VALUES
  (
    'Primary System (Mine)',
    '193fd3625aa8d92cada37559077d505835788bc7857782bc7638e40f9f80b25d',
    'sk_live_...ebe8',
    true,
    120
  ),
  (
    'Jarmen',
    '482b643d99ee07125a4744481f5ffd1978212c75b3359e96fb025e8fb0bafbf5',
    'sk_live_...e6c6',
    true,
    60
  ),
  (
    'Jelo',
    '56d39f1668d4bb4b5faf4a67759e75c16706f7f1ccfb35bd119ba1f3f8d73924',
    'sk_live_...8698',
    true,
    60
  ),
  (
    'Arlito',
    '23073ef83400383b29f122c29ec9bce8ff7fc93f963ece4ac092ff4f4827e3ef',
    'sk_live_...3738',
    true,
    60
  );

-- Verify Seeded Keys
SELECT id, name, masked_key, is_active, rate_limit, created_at FROM public.api_keys;
