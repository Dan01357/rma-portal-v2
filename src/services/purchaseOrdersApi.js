/**
 * Antigravity Finance & Purchase Orders API v1 Service
 * 
 * Direct integration with Laravel Cloud database containing:
 * - erply_products: 5,793+ live SKU catalog with names, prices, VAT & suppliers
 * - auto_po_supplier_contacts: 610+ supplier directory with terms, emails & contacts
 * - proof_of_delivery_items: 554,000+ line items history
 */

import { supabase } from '../supabaseClient';

const BASE_URL = import.meta.env.VITE_PO_API_URL || 'https://purchase-order-db-production-ff1oho.laravel.cloud/api/v1';
const getApiKey = () => {
  if (typeof window !== 'undefined') {
    const storedDanilo = localStorage.getItem('EXTERNAL_API_KEY_DANILO');
    if (storedDanilo && storedDanilo.trim()) return storedDanilo.trim();
    const stored = localStorage.getItem('rma_po_api_key');
    if (stored && stored.trim()) return stored.trim();
  }
  return import.meta.env.VITE_EXTERNAL_API_KEY_DANILO || import.meta.env.VITE_PO_API_KEY || 'pk_live_po_cloud_db_2026_dev_key';
};

let isApiUnauthorized = (() => {
  try {
    return sessionStorage.getItem('rma_po_api_disabled') === 'true';
  } catch (e) {
    return false;
  }
})();

const markUnauthorized = () => {
  isApiUnauthorized = true;
  try {
    sessionStorage.setItem('rma_po_api_disabled', 'true');
  } catch (e) {}
};

const clearUnauthorized = () => {
  isApiUnauthorized = false;
  try {
    sessionStorage.removeItem('rma_po_api_disabled');
  } catch (e) {}
};

let lastCheckTime = 0;

// Routing Group inference
const inferGroup = (name = '', brand = '') => {
  const text = `${name} ${brand}`.toLowerCase();
  if (text.includes('keysys') || text.includes('a2z2go') || text.includes('terminal') || text.includes('pos')) {
    return 'Group 1 (KEYSYS & A2Z2GO)';
  }
  return 'Group 2 (PINGCON & BONITA TISSUE)';
};

// Normalize API item to app standard format
export const normalizeProduct = (item) => {
  if (!item) return null;
  const sku = item.code || item.sku || `SKU-${item.id}`;
  // In coworker's API, ean_code stores the barcode values from the items, and code stores our SKU
  const barcode = item.ean_code || item.code2 || item.barcode || sku;
  const priceWithVat = parseFloat(item.priceWithVat) || parseFloat(item.price) || 0;
  const netPrice = parseFloat(item.price) || (priceWithVat / 1.12);

  return {
    id: String(item.id || sku),
    sku: sku,
    code: sku,
    barcode: barcode,
    ean_code: item.ean_code || null,
    name: item.name || '',
    brand: item.brandName || '',
    brand_name: item.brandName || '',
    supplier: item.supplierName || 'Savemore',
    supplier_name: item.supplierName || 'Savemore',
    unit_price: netPrice,
    price: netPrice,
    price_with_vat: priceWithVat,
    priceWithVat: priceWithVat,
    case_pack: item.unitName ? `Per ${item.unitName}` : '1 pc',
    unit_name: item.unitName || 'pc',
    image_url: item.imageUrl || item.image_url || null, // Strictly real images only, no fake/stock photos
    group: inferGroup(item.name || '', item.brandName || ''),
    requires_serial: Boolean(item.hasSerialNumbers),
    has_serial_numbers: Boolean(item.hasSerialNumbers),
    ae_name: null,
    ae_email: null,
    is_verified: true,
    source: 'erply_api',
    raw_data: item
  };
};

export const purchaseOrdersApi = {
  /**
   * Healthcheck & table access check
  /**
   * Load API key from Supabase cloud so mobile devices automatically get the key without manual re-entry
   */
  async loadApiKeyFromCloud() {
    if (typeof window === 'undefined') return null;
    const stored = localStorage.getItem('EXTERNAL_API_KEY_DANILO') || localStorage.getItem('rma_po_api_key');
    if (stored && stored.trim() && stored.trim() !== 'pk_live_po_cloud_db_2026_dev_key') {
      return stored.trim();
    }

    try {
      const { data } = await supabase
        .from('products')
        .select('code')
        .eq('barcode', '__CONFIG_PO_API_KEY__')
        .maybeSingle();

      if (data?.code && data.code.trim() && data.code.trim() !== 'pk_live_po_cloud_db_2026_dev_key') {
        const cloudKey = data.code.trim();
        localStorage.setItem('EXTERNAL_API_KEY_DANILO', cloudKey);
        localStorage.setItem('rma_po_api_key', cloudKey);
        clearUnauthorized();
        return cloudKey;
      }
    } catch (e) {
      console.warn('Notice loading cloud API key:', e?.message || e);
    }
    return null;
  },

  /**
   * Set API key and sync to Supabase for all devices (PC, mobile, tablet)
   */
  async setApiKey(key) {
    if (typeof window !== 'undefined') {
      if (key && key.trim()) {
        const clean = key.trim();
        localStorage.setItem('EXTERNAL_API_KEY_DANILO', clean);
        localStorage.setItem('rma_po_api_key', clean);
        clearUnauthorized();

        // Sync to cloud so mobile devices have instant access
        try {
          await supabase.from('products').upsert({
            barcode: '__CONFIG_PO_API_KEY__',
            name: 'System Config PO API Key',
            code: clean,
            is_verified: false,
            updated_at: new Date().toISOString()
          }, { onConflict: 'barcode' });

          await supabase.from('rma_settings').upsert({
            key: 'EXTERNAL_API_KEY_DANILO',
            value: clean,
            updated_at: new Date().toISOString()
          }, { onConflict: 'key' });
        } catch (e) {
          console.warn('Cloud API key sync notice:', e);
        }
      } else {
        localStorage.removeItem('EXTERNAL_API_KEY_DANILO');
        localStorage.removeItem('rma_po_api_key');
        clearUnauthorized();
        try {
          await supabase.from('products').delete().eq('barcode', '__CONFIG_PO_API_KEY__');
        } catch (e) {}
      }
    }
  },

  getApiKey() {
    return getApiKey();
  },

  isUnauthorized() {
    return isApiUnauthorized;
  },

  /**
   * Healthcheck & table access check
   */
  async testConnection(force = false) {
    let key = getApiKey();
    if (!key || key === 'pk_live_po_cloud_db_2026_dev_key') {
      const cloudKey = await this.loadApiKeyFromCloud();
      if (cloudKey) key = cloudKey;
    }

    if (isApiUnauthorized && !force) {
      const cloudKey = await this.loadApiKeyFromCloud();
      if (cloudKey) {
        key = cloudKey;
      } else {
        return { connected: false, error: 'Product Catalog API Key is unauthorized (HTTP 401). Update key in Settings.' };
      }
    }

    lastCheckTime = Date.now();

    try {
      const res = await fetch(`${BASE_URL}/tables`, {
        headers: {
          'X-API-Key': key,
          'Accept': 'application/json'
        }
      });
      if (!res.ok) {
        if (res.status === 401) markUnauthorized();
        return { connected: false, error: `HTTP ${res.status}: ${res.statusText}` };
      }
      clearUnauthorized();
      const data = await res.json();
      return { 
        connected: true, 
        tableCount: data.total_tables || 24,
        message: 'Connected to Live Purchase Orders API v1 (Laravel Cloud)'
      };
    } catch (err) {
      return { connected: false, error: err.message };
    }
  },

  /**
   * Fast lookup of a single product by Barcode or SKU code
   * Checks erply_products table (5,793 items)
   */
  async findProductByBarcode(barcodeOrCode) {
    if (!barcodeOrCode) return null;
    const clean = String(barcodeOrCode).trim();
    if (!clean) return null;

    let key = getApiKey();
    if (!key || key === 'pk_live_po_cloud_db_2026_dev_key' || isApiUnauthorized) {
      const cloudKey = await this.loadApiKeyFromCloud();
      if (cloudKey) {
        key = cloudKey;
      } else if (isApiUnauthorized) {
        return null;
      }
    }
    // Backend SQL is case-sensitive. Try exact code variations:
    const codeCandidates = Array.from(new Set([clean, clean.toUpperCase(), clean.toLowerCase()]));

    for (const code of codeCandidates) {
      try {
        // 1. FIRST PRIORITY: Direct equality lookup on ean_code (Manufacturer / Retail Barcode!): ?ean_code=...
        const eanUrl = `${BASE_URL}/data/erply_products?ean_code=${encodeURIComponent(code)}&columns=id,code,code2,ean_code,name,priceWithVat,price,supplierName,brandName,unitName,hasSerialNumbers`;
        const resEan = await fetch(eanUrl, {
          headers: {
            'X-API-Key': key,
            'Accept': 'application/json'
          }
        });

        if (resEan.status === 401) {
          markUnauthorized();
          return null;
        }

        if (resEan.ok) {
          const jsonEan = await resEan.json();
          if (jsonEan.data && jsonEan.data.length > 0) {
            return normalizeProduct(jsonEan.data[0]);
          }
        }

        // 2. SECOND PRIORITY: Direct equality lookup on code2 (Secondary Barcode / UPC): ?code2=...
        const code2Url = `${BASE_URL}/data/erply_products?code2=${encodeURIComponent(code)}&columns=id,code,code2,ean_code,name,priceWithVat,price,supplierName,brandName,unitName,hasSerialNumbers`;
        const res2 = await fetch(code2Url, {
          headers: {
            'X-API-Key': key,
            'Accept': 'application/json'
          }
        });

        if (res2.status === 401) {
          markUnauthorized();
          return null;
        }

        if (res2.ok) {
          const json2 = await res2.json();
          if (json2.data && json2.data.length > 0) {
            return normalizeProduct(json2.data[0]);
          }
        }

        // 3. THIRD PRIORITY: Direct equality lookup on code (Internal SKU): ?code=...
        const directUrl = `${BASE_URL}/data/erply_products?code=${encodeURIComponent(code)}&columns=id,code,code2,ean_code,name,priceWithVat,price,supplierName,brandName,unitName,hasSerialNumbers`;
        const res = await fetch(directUrl, {
          headers: {
            'X-API-Key': key,
            'Accept': 'application/json'
          }
        });

        if (res.status === 401) {
          markUnauthorized();
          return null;
        }

        if (res.ok) {
          const json = await res.json();
          if (json.data && json.data.length > 0) {
            return normalizeProduct(json.data[0]);
          }
        }
      } catch (err) {
        // Quiet catch
      }
    }

    // If not found by direct ean_code, code2, or code equality, it is not in the live database.
    return null;
  },

  /**
   * Real-time search across live products in erply_products
   * Overcomes backend case-sensitivity by testing capitalized and uppercase terms
   */
  async searchProducts(query, limit = 250) {
    if (!query || query.trim().length === 0) return [];
    const trimmed = query.trim();

    let key = getApiKey();
    if (!key || key === 'pk_live_po_cloud_db_2026_dev_key' || isApiUnauthorized) {
      const cloudKey = await this.loadApiKeyFromCloud();
      if (cloudKey) {
        key = cloudKey;
      } else if (isApiUnauthorized) {
        return [];
      }
    }

    // Build variations to handle case-sensitive SQL (e.g., 'tissue' -> 'Tissue', 'TISSUE', 'tissue')
    const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    const uppercase = trimmed.toUpperCase();
    const lowercase = trimmed.toLowerCase();
    const variations = Array.from(new Set([capitalized, trimmed, uppercase, lowercase]));

    for (const term of variations) {
      try {
        const url = `${BASE_URL}/data/erply_products?search=${encodeURIComponent(term)}&per_page=${limit}&columns=id,code,code2,ean_code,name,priceWithVat,price,supplierName,brandName,unitName,hasSerialNumbers`;
        const res = await fetch(url, {
          headers: {
            'X-API-Key': key,
            'Accept': 'application/json'
          }
        });

        if (res.status === 401) {
          markUnauthorized();
          break; // Stop immediately to avoid 401 spam
        }

        if (res.ok) {
          const json = await res.json();
          if (json.data && Array.isArray(json.data) && json.data.length > 0) {
            const items = json.data.map(normalizeProduct);
            items.totalRecords = json.pagination?.total_records || items.length;
            items.totalPages = json.pagination?.total_pages || 1;
            return items;
          }
        }
      } catch (err) {
        // Quiet catch
      }
    }

    return [];
  },

  /**
   * Fetch supplier directory from auto_po_supplier_contacts (610 records)
   */
  async getSuppliers(limit = 100) {
    try {
      const url = `${BASE_URL}/data/auto_po_supplier_contacts?per_page=${limit}&sort_by=full_company_name&sort_dir=asc`;
      const res = await fetch(url, {
        headers: {
          'X-API-Key': API_KEY,
          'Accept': 'application/json'
        }
      });

      if (res.ok) {
        const json = await res.json();
        if (json.data && Array.isArray(json.data)) {
          return json.data;
        }
      }
    } catch (err) {
      console.warn('[PurchaseOrdersAPI] Fetch suppliers error:', err);
    }
    return [];
  }
};
