/**
 * Antigravity Finance & Purchase Orders API v1 Service
 * 
 * Direct integration with Laravel Cloud database containing:
 * - erply_products: 5,793+ live SKU catalog with names, prices, VAT & suppliers
 * - auto_po_supplier_contacts: 610+ supplier directory with terms, emails & contacts
 * - proof_of_delivery_items: 554,000+ line items history
 */

const BASE_URL = import.meta.env.VITE_PO_API_URL || 'https://purchase-order-db-production-ff1oho.laravel.cloud/api/v1';
const API_KEY = import.meta.env.VITE_PO_API_KEY || 'pk_live_po_cloud_db_2026_dev_key';

// Image matching helper for realistic product preview visuals
const inferProductImage = (name = '') => {
  const lower = name.toLowerCase();
  if (lower.includes('tissue') || lower.includes('bonita') || lower.includes('towel') || lower.includes('table napkin') || lower.includes('interfolded')) {
    return 'https://images.unsplash.com/photo-1584556812952-905ffd0c611a?w=500&auto=format&fit=crop&q=80';
  }
  if (lower.includes('cdo') || lower.includes('meat') || lower.includes('sausage') || lower.includes('corned beef') || lower.includes('luncheon')) {
    return 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=500&auto=format&fit=crop&q=80';
  }
  if (lower.includes('chocolate') || lower.includes('choco') || lower.includes('swiss miss') || lower.includes('cadbury') || lower.includes('fibisco') || lower.includes('cookie')) {
    return 'https://images.unsplash.com/photo-1548907040-4baa42d10919?w=500&auto=format&fit=crop&q=80';
  }
  if (lower.includes('pasta') || lower.includes('spaghetti') || lower.includes('sauce') || lower.includes('royal')) {
    return 'https://images.unsplash.com/photo-1621996346565-e3d5d628169e?w=500&auto=format&fit=crop&q=80';
  }
  if (lower.includes('pos') || lower.includes('terminal') || lower.includes('scanner') || lower.includes('keysys') || lower.includes('printer')) {
    return 'https://images.unsplash.com/photo-1556742049-0a67c5574f73?w=500&auto=format&fit=crop&q=80';
  }
  // Default wholesale carton
  return 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=500&auto=format&fit=crop&q=80';
};

// Brand inference
const inferBrand = (name = '', rawBrand = null) => {
  if (rawBrand && rawBrand.trim()) return rawBrand;
  const lower = name.toLowerCase();
  if (lower.includes('cdo')) return 'CDO Foodsphere';
  if (lower.includes('fibisco')) return 'Fibisco';
  if (lower.includes('swiss miss')) return 'Swiss Miss';
  if (lower.includes('cadbury')) return 'Cadbury';
  if (lower.includes('royal')) return 'Royal';
  if (lower.includes('bonita')) return 'Bonita Tissue';
  if (lower.includes('pingcon')) return 'Pingcon Commercial';
  if (lower.includes('keysys')) return 'Keysys POS';
  if (lower.includes('a2z2go')) return 'A2Z2Go';
  return 'Wholesale Distribution';
};

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
  const code = item.code || item.sku || `SKU-${item.id}`;
  const price = parseFloat(item.priceWithVat) || parseFloat(item.price) || 0;
  const brand = inferBrand(item.name, item.brandName);

  return {
    id: String(item.id || code),
    sku: code,
    barcode: code,
    name: item.name || 'Unnamed Product',
    brand: brand,
    supplier: item.supplierName || 'Primary Wholesale Supplier',
    unit_price: price,
    case_pack: item.unitName ? `Per ${item.unitName}` : '1 pc',
    image_url: inferProductImage(item.name),
    group: inferGroup(item.name, brand),
    requires_serial: Boolean(item.hasSerialNumbers),
    source: 'erply_api',
    raw_data: item
  };
};

export const purchaseOrdersApi = {
  /**
   * Healthcheck & table access check
   */
  async testConnection() {
    try {
      const res = await fetch(`${BASE_URL}/tables`, {
        headers: {
          'X-API-Key': API_KEY,
          'Accept': 'application/json'
        }
      });
      if (!res.ok) {
        return { connected: false, error: `HTTP ${res.status}: ${res.statusText}` };
      }
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

    try {
      // 1. Direct equality lookup: ?code=...
      const directUrl = `${BASE_URL}/data/erply_products?code=${encodeURIComponent(clean)}&columns=id,code,name,priceWithVat,price,supplierName,brandName,unitName,hasSerialNumbers`;
      const res = await fetch(directUrl, {
        headers: {
          'X-API-Key': API_KEY,
          'Accept': 'application/json'
        }
      });

      if (res.ok) {
        const json = await res.json();
        if (json.data && json.data.length > 0) {
          return normalizeProduct(json.data[0]);
        }
      }

      // 2. Search fallback: ?search=...
      const searchUrl = `${BASE_URL}/data/erply_products?search=${encodeURIComponent(clean)}&per_page=1&columns=id,code,name,priceWithVat,price,supplierName,brandName,unitName,hasSerialNumbers`;
      const searchRes = await fetch(searchUrl, {
        headers: {
          'X-API-Key': API_KEY,
          'Accept': 'application/json'
        }
      });

      if (searchRes.ok) {
        const json = await searchRes.json();
        if (json.data && json.data.length > 0) {
          return normalizeProduct(json.data[0]);
        }
      }
    } catch (err) {
      console.warn('[PurchaseOrdersAPI] Live barcode lookup failed, falling back:', err);
    }

    return null;
  },

  /**
   * Real-time search across 5,793 live products in erply_products
   */
  async searchProducts(query, limit = 15) {
    if (!query || query.trim().length === 0) return [];

    try {
      const url = `${BASE_URL}/data/erply_products?search=${encodeURIComponent(query.trim())}&per_page=${limit}&columns=id,code,name,priceWithVat,price,supplierName,brandName,unitName,hasSerialNumbers`;
      const res = await fetch(url, {
        headers: {
          'X-API-Key': API_KEY,
          'Accept': 'application/json'
        }
      });

      if (res.ok) {
        const json = await res.json();
        if (json.data && Array.isArray(json.data)) {
          return json.data.map(normalizeProduct);
        }
      }
    } catch (err) {
      console.warn('[PurchaseOrdersAPI] Live product search error:', err);
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
