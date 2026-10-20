import { createClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.VITE_SUPABASE_URL || '';
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const supabaseUrl = rawUrl.trim();
const supabaseAnonKey = rawKey.trim();

// Check if credentials are valid and not default placeholders
// Explicitly supports new publishable keys (sb_publishable_...), sbp_..., legacy JWT (eyJ...), etc.
export const isConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  !supabaseUrl.includes('your-project-id') &&
  !supabaseAnonKey.includes('your-anon-key-here') &&
  (supabaseUrl.startsWith('https://') || supabaseUrl.startsWith('http://')) &&
  (supabaseAnonKey.startsWith('sb_publishable_') ||
   supabaseAnonKey.startsWith('sbp_') ||
   supabaseAnonKey.startsWith('eyJ') ||
   supabaseAnonKey.length > 20)
);

export const supabase = isConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })
  : null;

const LOCAL_STORAGE_KEY = 'wholesale_rma_tickets_vault_v1';

// Seed sample records for immediate demo/fallback usage
const SEED_DATA = [
  {
    id: 101,
    rma_id: 'RMA-2026-0001-A9K4',
    created_at: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 12).toISOString(),
    company: 'PINGCON',
    customer_name: 'Metro Commercial Supplies Co.',
    product_name: 'PINGCON 32" HD Commercial Display Panel',
    sku: 'PNG-LED-32F',
    packaging_unit: 'PC',
    delivery_reference: 'DR-88902',
    defect_category: 'Cracked Screen / Casing',
    defect_description: 'Outer corner of panel casing cracked during transit; LCD panel shows vertical color lines upon power test.',
    photo_url: 'https://images.unsplash.com/photo-1593305841991-05c297ba4575?auto=format&fit=crop&w=600&q=80',
    status: 'Pending Inspection',
    resolution_notes: '',
    contact_person: 'Eduardo Santos (Warehouse Receiving)',
    contact_phone: '+63 917 555 4321',
    contact_email: 'esantos@metrocommercial.ph',
    assigned_ae: 'Rodrigo Galvez',
    dispatch_email_status: 'Dispatched to AE & Operations'
  },
  {
    id: 102,
    rma_id: 'RMA-2026-0002-M7W2',
    created_at: new Date(Date.now() - 3600000 * 48).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 8).toISOString(),
    company: 'BONITA TISSUE',
    customer_name: 'Apex Hypermarket Quezon Ave',
    product_name: 'BONITA Jumbo Roll Bath Tissue 200M (12 Rolls)',
    sku: 'BON-JRT-200',
    packaging_unit: 'CS',
    delivery_reference: 'SI-44210',
    defect_category: 'Leaked Packaging / Moisture Damage',
    defect_description: 'Three master cartons arrived water-soaked on pallet lower deck. Rolls inside deformed and mildewed.',
    photo_url: 'https://images.unsplash.com/photo-1584556812952-905ffd0c611a?auto=format&fit=crop&w=600&q=80',
    status: 'Approved for Replacement',
    resolution_notes: 'Inspected by QA. Carrier delivery truck had roof leak during heavy rain. Replacement 3 cases scheduled under DR-89011.',
    contact_person: 'Marissa Lim (Logistics Lead)',
    contact_phone: '+63 920 888 1234',
    contact_email: 'returns@apexhypermarket.com',
    assigned_ae: 'Allan Valmeo',
    dispatch_email_status: 'Dispatched to AE & Operations'
  },
  {
    id: 103,
    rma_id: 'RMA-2026-0003-H4P9',
    created_at: new Date(Date.now() - 3600000 * 72).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 24).toISOString(),
    company: 'KEYSYS',
    customer_name: 'MegaMart Wholesale Hub',
    product_name: 'KEYSYS 24-Port Gigabit Managed PoE+ Switch',
    sku: 'KEY-SW-24POE',
    packaging_unit: 'PC',
    delivery_reference: 'DR-77312',
    defect_category: 'Factory Defect / Non-functional',
    defect_description: 'PoE power bank fails to provide wattage to ports 9-16. Device fan runs constantly at max RPM.',
    photo_url: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?auto=format&fit=crop&w=600&q=80',
    status: 'Credit Memo Issued',
    resolution_notes: 'Hardware internal diagnostic confirmed failure on secondary capacitor. Credit Memo #CM-2026-104 issued to customer ledger.',
    contact_person: 'Dave Concepcion',
    contact_phone: '+63 918 222 9988',
    contact_email: 'dave@megamart.com.ph',
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

/**
 * Fetch all tickets from Supabase table 'rma_tickets_vault' or fallback
 */
export async function fetchRMATickets() {
  if (isConfigured && supabase) {
    try {
      const { data, error } = await supabase
        .from('rma_tickets_vault')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('❌ Supabase SELECT from rma_tickets_vault failed:', error);
        return { data: [], source: 'supabase', error: error.message };
      }
      return { data: data || [], source: 'supabase', error: null };
    } catch (err) {
      console.error('❌ Supabase network exception on SELECT:', err);
      return { data: [], source: 'supabase', error: err.message };
    }
  }

  return { data: getLocalVault(), source: 'local', error: null };
}

/**
 * Insert a new RMA ticket into 'rma_tickets_vault'
 * Strict cloud mode: when Supabase is configured, writes directly to PostgreSQL table.
 */
export async function createRMATicket(ticketData) {
  const newTicket = {
    ...ticketData,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: ticketData.status || 'Pending Inspection',
    assigned_ae: ticketData.assigned_ae || 'Rodrigo Galvez',
    dispatch_email_status: ticketData.dispatch_email_status || 'Ready for Dispatch'
  };

  if (isConfigured && supabase) {
    try {
      console.log('📡 Submitting directly to Supabase PostgreSQL table [rma_tickets_vault]...', newTicket);
      
      const { data, error } = await supabase
        .from('rma_tickets_vault')
        .insert([newTicket])
        .select()
        .single();

      if (error) {
        console.error('❌ Supabase INSERT to rma_tickets_vault failed:', error);
        return { data: null, error: error.message };
      }

      console.log('✅ Supabase INSERT successful:', data);
      return { data, error: null };
    } catch (err) {
      console.error('❌ Supabase INSERT exception:', err);
      return { data: null, error: err.message };
    }
  }

  // Local Storage fallback ONLY when live cloud is unconfigured
  console.info('ℹ️ Operating in Local Vault mode (no live Supabase credentials detected).');
  const local = getLocalVault();
  const ticketWithId = {
    ...newTicket,
    id: Date.now()
  };
  const updated = [ticketWithId, ...local];
  saveLocalVault(updated);
  return { data: ticketWithId, error: null };
}

/**
 * Update an existing RMA ticket (e.g. status & supervisor resolution notes)
 */
export async function updateRMATicket(id, updates) {
  const payload = {
    ...updates,
    updated_at: new Date().toISOString()
  };

  if (isConfigured && supabase) {
    try {
      const { data, error } = await supabase
        .from('rma_tickets_vault')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('❌ Supabase UPDATE to rma_tickets_vault failed:', error);
        return { data: null, error: error.message };
      }

      return { data, error: null };
    } catch (err) {
      console.error('❌ Supabase UPDATE exception:', err);
      return { data: null, error: err.message };
    }
  }

  // Local fallback
  const local = getLocalVault();
  let updatedRecord = null;
  const updatedList = local.map((ticket) => {
    if (ticket.id === id || ticket.rma_id === id) {
      updatedRecord = { ...ticket, ...payload };
      return updatedRecord;
    }
    return ticket;
  });
  saveLocalVault(updatedList);
  return { data: updatedRecord, error: null };
}

/**
 * Helper to upload photo to Supabase Storage or convert to data URL
 * Targets bucket 'rma-defect-photos'
 */
export async function uploadDefectPhoto(file, rmaId) {
  if (!file) return null;

  // If Supabase Storage is configured and accessible
  if (isConfigured && supabase) {
    const bucketsToTry = ['rma-defect-photos', 'rma_photos'];

    for (const bucketName of bucketsToTry) {
      try {
        const fileExt = file.name ? file.name.split('.').pop() : 'jpg';
        const fileName = `${rmaId || 'RMA'}_${Date.now()}.${fileExt}`;
        const filePath = `defects/${fileName}`;

        const { data, error } = await supabase.storage
          .from(bucketName)
          .upload(filePath, file, { 
            cacheControl: '3600', 
            upsert: true,
            contentType: file.type || 'image/jpeg'
          });

        if (!error && data) {
          const { data: publicData } = supabase.storage
            .from(bucketName)
            .getPublicUrl(filePath);

          if (publicData?.publicUrl) {
            console.log(`✅ Uploaded photo to Supabase storage bucket '${bucketName}':`, publicData.publicUrl);
            return publicData.publicUrl;
          }
        } else if (error) {
          console.warn(`Supabase storage bucket '${bucketName}' upload note:`, error.message);
        }
      } catch (e) {
        console.warn(`Storage bucket '${bucketName}' attempt notice:`, e.message);
      }
    }
  }

  // Fallback: Convert to base64 Data URL
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      resolve(e.target.result);
    };
    reader.onerror = () => {
      resolve(null);
    };
    reader.readAsDataURL(file);
  });
}
