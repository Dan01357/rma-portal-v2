import { createClient } from '@supabase/supabase-js';

// ─── Credential Resolution ─────────────────────────────────────────────────
// Default client credentials for project eijdtkbbyxkyxusxzemr
const DEFAULT_SUPABASE_URL = 'https://eijdtkbbyxkyxusxzemr.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_im4vs1Ulfd6kT5K_BlOA1w_ROSH0CrO';

const PLACEHOLDER_PATTERNS = [
  'your-project-id', 'your-project', 'your_project',
  'your-anon-key-here', 'your_anon_key', 'placeholder', 'xxxx'
];

function isPlaceholder(val) {
  if (!val) return true;
  return PLACEHOLDER_PATTERNS.some(p => val.toLowerCase().includes(p));
}

function isValidKey(key) {
  if (!key) return false;
  return (
    key.length > 20 &&
    (
      key.startsWith('sb_publishable_') ||   // new publishable format
      key.startsWith('sbp_')             ||   // service-role publishable
      key.startsWith('eyJ')              ||   // legacy JWT
      key.startsWith('sb_secret_')            // secret format
    )
  );
}

// Read from env or fall back to verified project credentials
let envUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
let envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

// Auto-correct any spelling typos in Vercel environment variables:
if (envUrl.includes('ejdtkbbyxkyxuszxemr') || !envUrl || isPlaceholder(envUrl)) {
  envUrl = DEFAULT_SUPABASE_URL;
}

// If key is missing, a placeholder, invalid, or is the disabled legacy JWT key ('eyJ...'):
if (!envKey || isPlaceholder(envKey) || !isValidKey(envKey) || envKey.startsWith('eyJ')) {
  envKey = DEFAULT_SUPABASE_ANON_KEY;
}

const rawUrl = envUrl;
const rawKey = envKey;

export const isConfigured = Boolean(
  rawUrl &&
  rawKey &&
  rawUrl.startsWith('https://') &&
  !isPlaceholder(rawUrl) &&
  !isPlaceholder(rawKey) &&
  isValidKey(rawKey)
);

// ─── Supabase Client ───────────────────────────────────────────────────────
export const supabase = isConfigured
  ? createClient(rawUrl, rawKey, {
      auth: {
        persistSession:   false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    })
  : null;

if (isConfigured) {
  console.info('✅ Supabase client initialised →', rawUrl);
} else {
  console.info(
    'ℹ️ Supabase not configured – operating in Local Vault fallback mode.\n' +
    '   Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.'
  );
}

// ─── Local Fallback Vault ──────────────────────────────────────────────────
const LOCAL_STORAGE_KEY = 'wholesale_rma_tickets_vault_v1';

const SEED_DATA = [
  {
    id: 101,
    rma_id: 'RMA-2026-0001-A9K4',
    created_at:  new Date(Date.now() - 3_600_000 * 24 * 2).toISOString(),
    updated_at:  new Date(Date.now() - 3_600_000 * 12).toISOString(),
    company: 'PINGCON',
    customer_name: 'Metro Commercial Supplies Co.',
    product_name:  'PINGCON 32" HD Commercial Display Panel',
    sku: 'PNG-LED-32F',
    packaging_unit: 'PC',
    delivery_reference: 'DR-88902',
    defect_category:    'Cracked Screen / Casing',
    defect_description: 'Outer corner of panel casing cracked during transit; LCD panel shows vertical color lines.',
    photo_url: 'https://images.unsplash.com/photo-1593305841991-05c297ba4575?auto=format&fit=crop&w=600&q=80',
    status: 'Pending Inspection',
    resolution_notes: '',
    contact_person: 'Eduardo Santos (Warehouse Receiving)',
    contact_phone:  '+63 917 555 4321',
    contact_email:  'esantos@metrocommercial.ph',
    assigned_ae: 'Rodrigo Galvez',
    dispatch_email_status: 'Dispatched to AE & Operations'
  },
  {
    id: 102,
    rma_id: 'RMA-2026-0002-M7W2',
    created_at:  new Date(Date.now() - 3_600_000 * 48).toISOString(),
    updated_at:  new Date(Date.now() - 3_600_000 * 8).toISOString(),
    company: 'BONITA TISSUE',
    customer_name: 'Apex Hypermarket Quezon Ave',
    product_name:  'BONITA Jumbo Roll Bath Tissue 200M (12 Rolls)',
    sku: 'BON-JRT-200',
    packaging_unit: 'CS',
    delivery_reference: 'SI-44210',
    defect_category:    'Leaked Packaging / Moisture Damage',
    defect_description: 'Three master cartons arrived water-soaked on pallet lower deck. Rolls deformed and mildewed.',
    photo_url: 'https://images.unsplash.com/photo-1584556812952-905ffd0c611a?auto=format&fit=crop&w=600&q=80',
    status: 'Approved for Replacement',
    resolution_notes: 'Inspected by QA. Replacement 3 cases scheduled under DR-89011.',
    contact_person: 'Marissa Lim (Logistics Lead)',
    contact_phone:  '+63 920 888 1234',
    contact_email:  'returns@apexhypermarket.com',
    assigned_ae: 'Allan Valmeo',
    dispatch_email_status: 'Dispatched to AE & Operations'
  },
  {
    id: 103,
    rma_id: 'RMA-2026-0003-H4P9',
    created_at:  new Date(Date.now() - 3_600_000 * 72).toISOString(),
    updated_at:  new Date(Date.now() - 3_600_000 * 24).toISOString(),
    company: 'KEYSYS',
    customer_name: 'MegaMart Wholesale Hub',
    product_name:  'KEYSYS 24-Port Gigabit Managed PoE+ Switch',
    sku: 'KEY-SW-24POE',
    packaging_unit: 'PC',
    delivery_reference: 'DR-77312',
    defect_category:    'Factory Defect / Non-functional',
    defect_description: 'PoE power bank fails to provide wattage to ports 9-16. Fan runs at max RPM.',
    photo_url: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?auto=format&fit=crop&w=600&q=80',
    status: 'Credit Memo Issued',
    resolution_notes: 'Credit Memo #CM-2026-104 issued to customer ledger.',
    contact_person: 'Dave Concepcion',
    contact_phone:  '+63 918 222 9988',
    contact_email:  'dave@megamart.com.ph',
    assigned_ae: 'Dennis Morta',
    dispatch_email_status: 'Dispatched to AE & Operations'
  }
];

function getLocalVault() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(SEED_DATA));
      return SEED_DATA;
    }
    return JSON.parse(raw);
  } catch (err) {
    console.error('Local vault read error:', err);
    return SEED_DATA;
  }
}

function saveLocalVault(data) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('Local vault write error:', err);
  }
}

// ─── Network Error Classifier ──────────────────────────────────────────────
/**
 * Returns a user-friendly message string for network/fetch errors.
 */
function classifyNetworkError(err) {
  const msg = (err?.message || '').toLowerCase();
  if (
    err instanceof TypeError ||
    msg.includes('failed to fetch') ||
    msg.includes('network request failed') ||
    msg.includes('networkerror') ||
    msg.includes('load failed') ||
    msg.includes('fetch')
  ) {
    return (
      'Network error — could not reach Supabase. ' +
      'Check your internet connection or Supabase project status. ' +
      'Your submission has been saved to the local fallback vault and will sync when reconnected.'
    );
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'Request timed out. Supabase may be temporarily unreachable. Data saved to local fallback vault.';
  }
  if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('jwt')) {
    return 'Authentication error — your Supabase API key may be invalid or expired. Check VITE_SUPABASE_ANON_KEY in .env';
  }
  return `Supabase error: ${err?.message || 'Unknown error'}. Data saved to local fallback vault.`;
}

// ─── fetchRMATickets ───────────────────────────────────────────────────────
/**
 * Fetch all tickets from Supabase 'rma_tickets_vault' or local fallback.
 * Returns: { data: [], source: 'supabase'|'local', error: string|null }
 */
export async function fetchRMATickets() {
  if (isConfigured && supabase) {
    try {
      const { data, error } = await supabase
        .from('rma_tickets_vault')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('❌ Supabase SELECT rma_tickets_vault failed:', error);
        // Graceful fallback to local for reads
        const local = getLocalVault();
        return {
          data:   local,
          source: 'local_fallback',
          error:  `Supabase read error (showing cached data): ${error.message}`
        };
      }

      return { data: data || [], source: 'supabase', error: null };
    } catch (err) {
      const friendly = classifyNetworkError(err);
      console.error('❌ Supabase SELECT network exception:', err);
      const local = getLocalVault();
      return { data: local, source: 'local_fallback', error: friendly };
    }
  }

  return { data: getLocalVault(), source: 'local', error: null };
}

// ─── createRMATicket ───────────────────────────────────────────────────────
/**
 * Insert a new RMA ticket.
 * When Supabase is configured → strict cloud write.
 * On TypeError/fetch failure → saves to local fallback vault with friendly UI message.
 */
export async function createRMATicket(ticketData) {
  const newTicket = {
    ...ticketData,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status:               ticketData.status              || 'Pending Inspection',
    assigned_ae:          ticketData.assigned_ae         || 'Rodrigo Galvez',
    dispatch_email_status: ticketData.dispatch_email_status || 'Ready for Dispatch'
  };

  if (isConfigured && supabase) {
    try {
      console.log('📡 Inserting to Supabase [rma_tickets_vault]...', {
        rma_id:   newTicket.rma_id,
        company:  newTicket.company,
        customer: newTicket.customer_name
      });

      const { data, error } = await supabase
        .from('rma_tickets_vault')
        .insert([newTicket])
        .select()
        .single();

      if (error) {
        console.error('❌ Supabase INSERT rma_tickets_vault failed:', error);

        // Persist locally on Supabase-level error too
        const local = getLocalVault();
        const fallback = { ...newTicket, id: Date.now(), _syncPending: true };
        saveLocalVault([fallback, ...local]);

        return {
          data:    fallback,
          error:   `Database error: ${error.message}. Saved to local fallback vault.`,
          source:  'local_fallback'
        };
      }

      console.log('✅ Supabase INSERT success:', data?.rma_id);
      return { data, error: null, source: 'supabase' };

    } catch (err) {
      // TypeError: Failed to fetch → save locally and surface friendly message
      const friendly = classifyNetworkError(err);
      console.error('❌ Supabase INSERT network exception (TypeError / fetch):', err);
      console.error('   URL attempted:', rawUrl);
      console.error('   Key prefix:', rawKey.substring(0, 20) + '…');

      const local = getLocalVault();
      const fallback = { ...newTicket, id: Date.now(), _syncPending: true };
      saveLocalVault([fallback, ...local]);

      return { data: fallback, error: friendly, source: 'local_fallback' };
    }
  }

  // ── Unconfigured → local vault only ──
  console.info('ℹ️ Local Vault mode — saving ticket locally.');
  const local = getLocalVault();
  const ticketWithId = { ...newTicket, id: Date.now() };
  saveLocalVault([ticketWithId, ...local]);
  return { data: ticketWithId, error: null, source: 'local' };
}

// ─── updateRMATicket ───────────────────────────────────────────────────────
export async function updateRMATicket(id, updates) {
  const payload = { ...updates, updated_at: new Date().toISOString() };

  if (isConfigured && supabase) {
    try {
      const { data, error } = await supabase
        .from('rma_tickets_vault')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('❌ Supabase UPDATE rma_tickets_vault failed:', error);
        return { data: null, error: error.message };
      }
      return { data, error: null };
    } catch (err) {
      const friendly = classifyNetworkError(err);
      console.error('❌ Supabase UPDATE network exception:', err);
      return { data: null, error: friendly };
    }
  }

  // Local fallback
  const local = getLocalVault();
  let updated = null;
  const list = local.map(t => {
    if (t.id === id || t.rma_id === id) {
      updated = { ...t, ...payload };
      return updated;
    }
    return t;
  });
  saveLocalVault(list);
  return { data: updated, error: null };
}

// ─── uploadDefectPhoto ─────────────────────────────────────────────────────
/**
 * Upload compressed photo to Supabase Storage bucket 'rma-defect-photos'.
 * Falls back to base64 DataURL on any network failure.
 */
export async function uploadDefectPhoto(file, rmaId) {
  if (!file) return null;

  if (isConfigured && supabase) {
    const bucketsToTry = ['rma-defect-photos', 'rma_photos'];

    for (const bucketName of bucketsToTry) {
      try {
        const fileExt  = (file.name || 'photo.jpg').split('.').pop().toLowerCase();
        const fileName = `${rmaId || 'RMA'}_${Date.now()}.${fileExt}`;
        const filePath = `defects/${fileName}`;

        const { data, error } = await supabase.storage
          .from(bucketName)
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert:       true,
            contentType:  file.type || 'image/jpeg'
          });

        if (!error && data) {
          const { data: pub } = supabase.storage
            .from(bucketName)
            .getPublicUrl(filePath);

          if (pub?.publicUrl) {
            console.log(`✅ Photo uploaded → ${bucketName}:`, pub.publicUrl);
            return pub.publicUrl;
          }
        } else if (error) {
          console.warn(`⚠️ Storage bucket '${bucketName}' upload note:`, error.message);
        }
      } catch (e) {
        // TypeError: Failed to fetch from storage → fall through to base64
        console.warn(
          `⚠️ Storage upload to '${bucketName}' failed (${e?.message || e}). ` +
          'Falling back to base64 DataURL.'
        );
      }
    }
  }

  // ── Base64 DataURL fallback ──
  console.info('📎 Photo stored as base64 DataURL (Supabase Storage not available).');
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result);
    reader.onerror = ()  => resolve(null);
    reader.readAsDataURL(file);
  });
}

// ─── Diagnostics Helper ─────────────────────────────────────────────────────
export function getSupabaseDiagnostics() {
  return {
    isConfigured,
    url: rawUrl || '(not set)',
    maskedKey: rawKey ? `${rawKey.substring(0, 10)}...${rawKey.substring(rawKey.length - 4)}` : '(not set)',
    hasValidKey: isValidKey(rawKey)
  };
}

// ─── Sync Pending Local Tickets to Supabase ─────────────────────────────────
/**
 * Takes any return tickets created during local fallback mode (e.g. RMA-2026-0004-HYUT)
 * and uploads them to the live Supabase 'rma_tickets_vault' table.
 */
export async function syncPendingLocalTickets() {
  if (!isConfigured || !supabase) {
    return {
      success: false,
      synced: 0,
      pending: 0,
      error: 'Supabase credentials not configured. Please ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set and redeployed.'
    };
  }

  const local = getLocalVault();
  // Pending tickets have _syncPending flag or a numeric timestamp id (e.g. Date.now() > 10000)
  const pending = local.filter(t => t._syncPending || (typeof t.id === 'number' && t.id > 1000));
  
  if (pending.length === 0) {
    return { success: true, synced: 0, pending: 0, message: 'All tickets are already synced.' };
  }

  let successCount = 0;
  let lastError = null;
  const updatedLocal = [...local];

  for (const item of pending) {
    try {
      const { id, _syncPending, ...payload } = item;
      const { data, error } = await supabase
        .from('rma_tickets_vault')
        .insert([payload])
        .select()
        .single();

      if (!error && data) {
        successCount++;
        const idx = updatedLocal.findIndex(t => t.rma_id === item.rma_id);
        if (idx !== -1) {
          updatedLocal[idx] = data;
        }
      } else if (error) {
        lastError = error.message;
        console.error('Failed to sync ticket to Supabase:', item.rma_id, error);
      }
    } catch (e) {
      lastError = e.message;
      console.error('Exception syncing ticket:', item.rma_id, e);
    }
  }

  saveLocalVault(updatedLocal);
  return {
    success: successCount > 0,
    synced: successCount,
    pending: pending.length - successCount,
    error: lastError
  };
}
