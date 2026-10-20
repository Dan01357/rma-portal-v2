import { createClient } from '@supabase/supabase-js';
import { INITIAL_PRODUCTS, INITIAL_TICKETS } from './data/mockData';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://lschluviltzsknptwgrz.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_Jrv9ZNgGXJ4PZoNWCJSHxQ_7hZtQqd3';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl !== 'https://your-project.supabase.co'
);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false
  }
});

// Local Storage Fallback Helpers
const STORAGE_KEYS = {
  PRODUCTS: 'wholesale_rma_products_v2',
  TICKETS: 'wholesale_rma_tickets_v2',
  SETTINGS: 'wholesale_rma_settings_v2'
};

export const getLocalProducts = () => {
  try {
    const cached = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
    if (!cached) {
      localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(INITIAL_PRODUCTS));
      return INITIAL_PRODUCTS;
    }
    return JSON.parse(cached);
  } catch (err) {
    console.warn('Error reading local products fallback:', err);
    return INITIAL_PRODUCTS;
  }
};

export const getLocalTickets = () => {
  try {
    const cached = localStorage.getItem(STORAGE_KEYS.TICKETS);
    if (!cached) {
      localStorage.setItem(STORAGE_KEYS.TICKETS, JSON.stringify(INITIAL_TICKETS));
      return INITIAL_TICKETS;
    }
    return JSON.parse(cached);
  } catch (err) {
    console.warn('Error reading local tickets fallback:', err);
    return INITIAL_TICKETS;
  }
};

export const saveLocalTickets = (tickets) => {
  try {
    localStorage.setItem(STORAGE_KEYS.TICKETS, JSON.stringify(tickets));
  } catch (err) {
    console.error('Failed to save to local storage:', err);
  }
};

// Unified Data Access Layer (Supabase with Automatic Mock Fallbacks)

export const rmaApi = {
  async testConnection() {
    if (!isSupabaseConfigured) {
      return { connected: false, message: 'Supabase URL or Key missing. Running in Offline Mock Mode.' };
    }
    try {
      // Light ping to Supabase
      const { data, error } = await supabase.from('products').select('count', { count: 'exact', head: true });
      if (error) {
        // Table may not exist yet, but connection reached Supabase
        return {
          connected: true,
          mode: 'connected-with-local-fallback',
          message: `Connected to Supabase (${supabaseUrl.split('.')[0].replace('https://', '')}). Tables not yet migrated; offline local fallback active.`
        };
      }
      return {
        connected: true,
        mode: 'live',
        message: 'Connected to live Supabase backend database.'
      };
    } catch (err) {
      return {
        connected: false,
        mode: 'offline',
        message: `Offline mode active (${err.message || 'Network unreachable'}). Local mock storage fully operational.`
      };
    }
  },

  async getProducts() {
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.from('products').select('*');
        if (!error && data && data.length > 0) {
          return data;
        }
      } catch (e) {
        console.warn('Supabase products fetch failed, using local fallback:', e);
      }
    }
    return getLocalProducts();
  },

  async findProductByBarcode(barcode) {
    const cleanBarcode = String(barcode).trim();
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('barcode', cleanBarcode)
          .maybeSingle();

        if (!error && data) {
          return data;
        }
      } catch (e) {
        console.warn('Supabase barcode lookup failed, checking local catalog:', e);
      }
    }

    const localProds = getLocalProducts();
    return localProds.find(p => String(p.barcode).trim() === cleanBarcode) || null;
  },

  async getTickets() {
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('rma_tickets')
          .select('*')
          .order('created_at', { ascending: false });

        if (!error && data && data.length > 0) {
          return data;
        }
      } catch (e) {
        console.warn('Supabase tickets fetch failed, using local storage:', e);
      }
    }
    return getLocalTickets();
  },

  async createTicket(ticket) {
    // Attempt saving to Supabase
    let savedToSupabase = false;
    if (isSupabaseConfigured) {
      try {
        const { error } = await supabase.from('rma_tickets').insert([ticket]);
        if (!error) savedToSupabase = true;
      } catch (e) {
        console.warn('Supabase ticket insert failed, saving locally:', e);
      }
    }

    // Always update local storage for offline redundancy & instant UI reactivity
    const current = getLocalTickets();
    const updated = [ticket, ...current];
    saveLocalTickets(updated);

    return { ticket, savedToSupabase };
  },

  async updateTicket(id, updates) {
    if (isSupabaseConfigured) {
      try {
        await supabase.from('rma_tickets').update(updates).eq('id', id);
      } catch (e) {
        console.warn('Supabase ticket update failed, updating local storage:', e);
      }
    }

    const current = getLocalTickets();
    const updated = current.map(t => (t.id === id ? { ...t, ...updates } : t));
    saveLocalTickets(updated);
    return updated.find(t => t.id === id);
  },

  async uploadPhoto(file) {
    const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.storage
          .from('rma-defect-photos')
          .upload(filename, file, { cacheControl: '3600', upsert: true });

        if (!error) {
          const { data: publicData } = supabase.storage
            .from('rma-defect-photos')
            .getPublicUrl(filename);
          return publicData.publicUrl;
        }
      } catch (e) {
        console.warn('Supabase photo upload failed, converting to local preview:', e);
      }
    }

    // Base64 fallback for offline/local storage
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }
};
