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

// Unified Data Access Layer (Supabase + Local Fallback)

export const rmaApi = {
  async testConnection() {
    if (!isSupabaseConfigured) {
      return { 
        connected: false, 
        message: 'Offline Mock Mode active.'
      };
    }
    try {
      const { data, error } = await supabase.from('products').select('count', { count: 'exact', head: true });
      if (error) throw error;
      return {
        connected: true,
        mode: 'live',
        message: 'Connected to Supabase Database.'
      };
    } catch (err) {
      return {
        connected: false,
        mode: 'offline',
        message: `Supabase unreachable (${err.message || 'Network notice'}). Local storage active.`
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

  /**
   * Fast Barcode / SKU Lookup:
   * 1. Check Supabase products table
   * 2. If not found, check local verified catalog
   */
  async findProductByBarcode(barcode) {
    const cleanBarcode = String(barcode).trim();
    if (!cleanBarcode) return null;

    // 1. Secure Serverless Proxy (/api/v1/products/lookup)
    try {
      const res = await fetch(`/api/v1/products/lookup?barcode=${encodeURIComponent(cleanBarcode)}`, {
        headers: { 'Accept': 'application/json' }
      });
      if (res && res.ok) {
        const json = await res.json();
        if (json.success && json.found && json.product) {
          return json.product;
        }
      }
    } catch (e) {}

    // 2. Direct Supabase lookup fallback
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

    // 3. Local catalog fallback
    const localProds = getLocalProducts();
    return localProds.find(p => 
      String(p.barcode).trim().toLowerCase() === cleanBarcode.toLowerCase() ||
      String(p.sku || p.code || '').trim().toLowerCase() === cleanBarcode.toLowerCase()
    ) || null;
  },

  async searchLiveProducts(query, limit = 15) {
    if (!query) return [];
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .or(`name.ilike.%${query}%,barcode.ilike.%${query}%`)
          .limit(limit);
        if (!error && data) return data;
      } catch (e) {}
    }
    return getLocalProducts().filter(p => 
      (p.name && p.name.toLowerCase().includes(query.toLowerCase())) ||
      (p.barcode && p.barcode.includes(query))
    ).slice(0, limit);
  },

  async getLiveSuppliers(limit = 100) {
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.from('products').select('supplier_name').limit(limit);
        if (!error && data) {
          const list = Array.from(new Set(data.map(d => d.supplier_name).filter(Boolean)));
          return list.map((name, i) => ({ id: i + 1, name }));
        }
      } catch (e) {}
    }
    return [{ id: 1, name: 'Savemore' }];
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

  async uploadPhoto(file, rmaNumber = 'GENERAL') {
    if (!file) return null;

    // Helper: Client-side WebP compression (1280px max, 0.7 quality)
    const compress = (imgFile) => {
      if (!imgFile || !imgFile.type?.startsWith('image/') || imgFile.type === 'image/svg+xml') {
        return Promise.resolve(imgFile);
      }
      return new Promise((resolve) => {
        try {
          const img = new Image();
          const url = URL.createObjectURL(imgFile);
          img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            const maxDimension = 1280;
            if (width > maxDimension || height > maxDimension) {
              if (width > height) {
                height = Math.round((height * maxDimension) / width);
                width = maxDimension;
              } else {
                width = Math.round((width * maxDimension) / height);
                height = maxDimension;
              }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
              (blob) => {
                if (blob) {
                  const cleanBase = imgFile.name ? imgFile.name.replace(/\.[^.]+$/, '') : 'photo';
                  resolve(new File([blob], `${cleanBase}.webp`, { type: 'image/webp', lastModified: Date.now() }));
                } else {
                  resolve(imgFile);
                }
              },
              'image/webp',
              0.7
            );
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(imgFile);
          };
          img.src = url;
        } catch (e) {
          resolve(imgFile);
        }
      });
    };

    const toBase64 = (f) => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve('');
      reader.readAsDataURL(f);
    });

    try {
      const compressed = await compress(file);
      const base64Data = await toBase64(compressed);

      // 1. Primary: Google Drive serverless upload
      try {
        const gdriveRes = await fetch('/api/upload-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileData: base64Data,
            fileName: compressed.name || `photo_${Date.now()}.webp`,
            mimeType: compressed.type || 'image/webp',
            rmaNumber
          })
        });
        if (gdriveRes.ok) {
          const json = await gdriveRes.json();
          if (json.success && (json.url || json.previewUrl)) {
            return json.url || json.previewUrl;
          }
        }
      } catch (gdriveErr) {
        console.warn('Google Drive notice, falling back to Supabase:', gdriveErr.message);
      }

      // 2. Secondary: Supabase Storage
      if (isSupabaseConfigured) {
        try {
          const filename = `reports/${Date.now()}-${compressed.name ? compressed.name.replace(/[^a-zA-Z0-9.-]/g, '_') : 'photo.webp'}`;
          const { data, error } = await supabase.storage
            .from('rma-photos')
            .upload(filename, compressed, { cacheControl: '3600', upsert: true, contentType: compressed.type || 'image/webp' });

          if (!error) {
            const { data: publicData } = supabase.storage.from('rma-photos').getPublicUrl(filename);
            return publicData.publicUrl;
          }
        } catch (e) {
          console.warn('Supabase photo upload notice:', e.message);
        }
      }

      // 3. Tertiary: Base64 data URL
      return base64Data;
    } catch (err) {
      return toBase64(file);
    }
  }
};
