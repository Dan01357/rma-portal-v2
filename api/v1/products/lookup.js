import { supabase } from '../../_lib/supabase.js';
import { sendJson, setCorsHeaders } from '../../_lib/auth.js';
import { INITIAL_PRODUCTS } from '../../_lib/mockProducts.js';

/**
 * Retrieve the Laravel Cloud API Key:
 * 1. Checks server environment variables (EXTERNAL_CATALOG_API_KEY, etc.)
 * 2. Fallback to Supabase products table (__CONFIG_PO_API_KEY__) saved by Admin in Settings
 */
async function getCatalogApiKey() {
  const envKey = process.env.EXTERNAL_CATALOG_API_KEY || 
                 process.env.EXTERNAL_API_KEY_DANILO || 
                 process.env.VITE_EXTERNAL_API_KEY_DANILO || 
                 process.env.PO_API_KEY || 
                 process.env.VITE_PO_API_KEY;

  if (envKey && envKey.trim() && envKey.trim() !== 'pk_live_po_cloud_db_2026_dev_key') {
    return envKey.trim();
  }

  try {
    const { data } = await supabase
      .from('products')
      .select('code')
      .eq('barcode', '__CONFIG_PO_API_KEY__')
      .maybeSingle();

    if (data?.code && data.code.trim() && data.code.trim() !== 'pk_live_po_cloud_db_2026_dev_key') {
      return data.code.trim();
    }
  } catch (e) {
    // Quiet catch
  }

  try {
    const { data: settingData } = await supabase
      .from('rma_settings')
      .select('value')
      .eq('key', 'EXTERNAL_API_KEY_DANILO')
      .maybeSingle();

    if (settingData?.value && typeof settingData.value === 'string' && settingData.value.trim() !== 'pk_live_po_cloud_db_2026_dev_key') {
      return settingData.value.trim();
    }
  } catch (e) {
    // Quiet catch
  }

  return envKey || 'pk_live_po_cloud_db_2026_dev_key';
}

/**
 * Public Secure Product Lookup Endpoint:
 * GET /api/v1/products/lookup?barcode=[barcode]&search=[search]
 * 
 * Securely proxies external Laravel Cloud catalog calls on the server
 * so anonymous dock workers, mobile phones, and incognito sessions
 * never need client-side credentials.
 */
export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED', message: `Method ${req.method} not allowed.` });
  }

  const barcodeParam = req.query.barcode || req.query.code || req.query.ean_code;
  const searchParam = req.query.search || req.query.q;
  const limitParam = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);

  // --------------------------------------------------------------------------
  // MODE 1: SINGLE BARCODE / SKU LOOKUP
  // --------------------------------------------------------------------------
  if (barcodeParam) {
    const cleanBarcode = String(barcodeParam).trim();
    if (!cleanBarcode) {
      return sendJson(res, 400, { success: false, error: 'BAD_REQUEST', message: 'Barcode is required.' });
    }

    try {
      // 1. Check Supabase 'products' table first (Priority 1)
      const { data: supaProds, error: supaErr } = await supabase
        .from('products')
        .select('*')
        .or(`barcode.eq.${cleanBarcode},code.ilike.${cleanBarcode}`)
        .limit(1);

      if (!supaErr && supaProds && supaProds.length > 0) {
        const item = supaProds[0];
        if (!item.name?.startsWith('[DELETED]')) {
          return sendJson(res, 200, {
            success: true,
            found: true,
            source: 'database',
            product: {
              id: item.id,
              barcode: item.barcode,
              code: item.code || item.barcode,
              sku: item.code || item.barcode,
              ean_code: item.ean_code || item.barcode,
              name: item.name,
              price: Number(item.price || 0),
              price_with_vat: Number(item.price_with_vat || item.price || 0),
              priceWithVat: Number(item.price_with_vat || item.price || 0),
              supplier_name: item.supplier_name || 'Savemore',
              supplier: item.supplier_name || 'Savemore',
              brand_name: item.brand_name || null,
              brand: item.brand_name || null,
              unit_name: item.unit_name || 'pc',
              has_serial_numbers: Boolean(item.has_serial_numbers),
              image_url: item.image_url || null,
              imageUrl: item.image_url || null,
              ae_name: item.ae_name || null,
              ae_email: item.ae_email || null,
              company: item.company || null,
              is_verified: item.is_verified !== false,
              isVerified: item.is_verified !== false
            }
          });
        }
      }

      // 2. Query Coworker's Live Catalog API (erply_products) securely from server
      const key = await getCatalogApiKey();
      const baseUrl = process.env.PO_API_URL || process.env.VITE_PO_API_URL || 'https://purchase-order-db-production-ff1oho.laravel.cloud/api/v1';
      const codeCandidates = Array.from(new Set([cleanBarcode, cleanBarcode.toUpperCase(), cleanBarcode.toLowerCase()]));
      let matchedItem = null;

      for (const code of codeCandidates) {
        // Priority A: Direct equality on ean_code (Manufacturer / Retail Barcode)
        try {
          const eanUrl = `${baseUrl}/data/erply_products?ean_code=${encodeURIComponent(code)}&columns=id,code,code2,ean_code,name,priceWithVat,price,supplierName,brandName,unitName,hasSerialNumbers`;
          const rEan = await fetch(eanUrl, { headers: { 'X-API-Key': key, 'Accept': 'application/json' } });
          if (rEan.ok) {
            const jEan = await rEan.json();
            if (jEan.data && jEan.data.length > 0) {
              matchedItem = jEan.data[0];
              break;
            }
          }
        } catch (e) {}

        // Priority B: Direct equality on code2 (Secondary Barcode / UPC)
        try {
          const code2Url = `${baseUrl}/data/erply_products?code2=${encodeURIComponent(code)}&columns=id,code,code2,ean_code,name,priceWithVat,price,supplierName,brandName,unitName,hasSerialNumbers`;
          const r2 = await fetch(code2Url, { headers: { 'X-API-Key': key, 'Accept': 'application/json' } });
          if (r2.ok) {
            const j2 = await r2.json();
            if (j2.data && j2.data.length > 0) {
              matchedItem = j2.data[0];
              break;
            }
          }
        } catch (e) {}

        // Priority C: Direct equality on code (Internal SKU)
        try {
          const skuUrl = `${baseUrl}/data/erply_products?code=${encodeURIComponent(code)}&columns=id,code,code2,ean_code,name,priceWithVat,price,supplierName,brandName,unitName,hasSerialNumbers`;
          const rSku = await fetch(skuUrl, { headers: { 'X-API-Key': key, 'Accept': 'application/json' } });
          if (rSku.ok) {
            const jSku = await rSku.json();
            if (jSku.data && jSku.data.length > 0) {
              matchedItem = jSku.data[0];
              break;
            }
          }
        } catch (e) {}
      }

      if (matchedItem) {
        const sku = matchedItem.code || matchedItem.sku || `SKU-${matchedItem.id}`;
        const barcodeVal = matchedItem.ean_code || matchedItem.code2 || cleanBarcode;
        const priceWithVat = parseFloat(matchedItem.priceWithVat) || parseFloat(matchedItem.price) || 0;
        const netPrice = parseFloat(matchedItem.price) || (priceWithVat / 1.12);

        const normalized = {
          id: String(matchedItem.id || sku),
          barcode: barcodeVal,
          code: sku,
          sku: sku,
          ean_code: matchedItem.ean_code || null,
          name: matchedItem.name || '',
          price: netPrice,
          price_with_vat: priceWithVat,
          priceWithVat: priceWithVat,
          supplier_name: matchedItem.supplierName || 'Savemore',
          supplier: matchedItem.supplierName || 'Savemore',
          brand_name: matchedItem.brandName || null,
          brand: matchedItem.brandName || null,
          unit_name: matchedItem.unitName || 'pc',
          has_serial_numbers: Boolean(matchedItem.hasSerialNumbers),
          image_url: null,
          imageUrl: null,
          ae_name: null,
          ae_email: null,
          company: null,
          is_verified: true,
          isVerified: true,
          source: 'erply_api'
        };

        // Cache into Supabase so subsequent scans find it directly in Supabase
        try {
          await supabase.from('products').upsert({
            barcode: barcodeVal,
            code: sku,
            name: normalized.name,
            supplier_name: normalized.supplier_name,
            price: normalized.price,
            price_with_vat: normalized.price_with_vat,
            brand_name: normalized.brand_name,
            unit_name: normalized.unit_name,
            is_verified: true,
            updated_at: new Date().toISOString()
          }, { onConflict: 'barcode' });
        } catch (err) {}

        return sendJson(res, 200, {
          success: true,
          found: true,
          source: 'erply_api',
          product: normalized
        });
      }

      // 3. Wholesale Verified Catalog Fallback (INITIAL_PRODUCTS)
      const mock = INITIAL_PRODUCTS.find(p => 
        p.barcode === cleanBarcode || 
        (p.sku && p.sku.toLowerCase() === cleanBarcode.toLowerCase())
      );

      if (mock) {
        return sendJson(res, 200, {
          success: true,
          found: true,
          source: 'verified_catalog',
          product: {
            id: mock.id,
            barcode: mock.barcode,
            code: mock.sku,
            sku: mock.sku,
            name: mock.name,
            price: Number(mock.unit_price || 0),
            price_with_vat: Number(mock.unit_price || 0) * 1.12,
            priceWithVat: Number(mock.unit_price || 0) * 1.12,
            supplier_name: mock.supplier || 'Savemore',
            supplier: mock.supplier || 'Savemore',
            brand_name: mock.brand || null,
            brand: mock.brand || null,
            unit_name: 'pc',
            image_url: mock.image_url || null,
            imageUrl: mock.image_url || null,
            ae_name: null,
            ae_email: null,
            is_verified: true,
            isVerified: true
          }
        });
      }

      // 4. Not registered anywhere
      return sendJson(res, 200, {
        success: true,
        found: false,
        product: null,
        message: `Barcode "${cleanBarcode}" is not registered in the catalog.`
      });
    } catch (err) {
      console.error('Error during product lookup proxy:', err);
      return sendJson(res, 500, { success: false, error: 'SERVER_ERROR', message: err.message });
    }
  }

  // --------------------------------------------------------------------------
  // MODE 2: MULTI-PRODUCT KEYWORD SEARCH
  // --------------------------------------------------------------------------
  if (searchParam) {
    const cleanSearch = String(searchParam).trim();
    if (!cleanSearch) {
      return sendJson(res, 200, { success: true, count: 0, products: [] });
    }

    try {
      const results = [];
      const seenKeys = new Set();

      // 1. Search Supabase
      const { data: supaItems } = await supabase
        .from('products')
        .select('*')
        .or(`name.ilike.%${cleanSearch}%,barcode.ilike.%${cleanSearch}%,code.ilike.%${cleanSearch}%`)
        .order('is_verified', { ascending: false })
        .limit(limitParam);

      if (supaItems && Array.isArray(supaItems)) {
        for (const item of supaItems) {
          if (item.name?.startsWith('[DELETED]') || item.barcode?.startsWith('__CONFIG_')) continue;
          const key = String(item.barcode || item.code || item.id).trim().toLowerCase();
          seenKeys.add(key);
          results.push({
            id: item.id,
            barcode: item.barcode,
            code: item.code || item.barcode,
            name: item.name,
            price: Number(item.price || 0),
            price_with_vat: Number(item.price_with_vat || item.price || 0),
            priceWithVat: Number(item.price_with_vat || item.price || 0),
            supplier_name: item.supplier_name || 'Savemore',
            supplier: item.supplier_name || 'Savemore',
            brand_name: item.brand_name || null,
            brand: item.brand_name || null,
            unit_name: item.unit_name || 'pc',
            image_url: item.image_url || null,
            imageUrl: item.image_url || null,
            is_verified: item.is_verified !== false,
            isVerified: item.is_verified !== false,
            source: 'database'
          });
        }
      }

      // 2. Search Laravel Cloud API
      const key = await getCatalogApiKey();
      const baseUrl = process.env.PO_API_URL || process.env.VITE_PO_API_URL || 'https://purchase-order-db-production-ff1oho.laravel.cloud/api/v1';

      try {
        const searchUrl = `${baseUrl}/data/erply_products?search=${encodeURIComponent(cleanSearch)}&per_page=25&columns=id,code,code2,ean_code,name,priceWithVat,price,supplierName,brandName,unitName,hasSerialNumbers`;
        const resSearch = await fetch(searchUrl, { headers: { 'X-API-Key': key, 'Accept': 'application/json' } });
        if (resSearch.ok) {
          const jsonSearch = await resSearch.json();
          if (jsonSearch.data && Array.isArray(jsonSearch.data)) {
            for (const item of jsonSearch.data) {
              const sku = item.code || item.sku || `SKU-${item.id}`;
              const barcodeVal = item.ean_code || item.code2 || sku;
              const prodKey = String(barcodeVal || sku || item.id).trim().toLowerCase();
              if (!seenKeys.has(prodKey)) {
                seenKeys.add(prodKey);
                const priceWithVat = parseFloat(item.priceWithVat) || parseFloat(item.price) || 0;
                const netPrice = parseFloat(item.price) || (priceWithVat / 1.12);
                results.push({
                  id: String(item.id || sku),
                  barcode: barcodeVal,
                  code: sku,
                  name: item.name || '',
                  price: netPrice,
                  price_with_vat: priceWithVat,
                  priceWithVat: priceWithVat,
                  supplier_name: item.supplierName || 'Savemore',
                  supplier: item.supplierName || 'Savemore',
                  brand_name: item.brandName || null,
                  brand: item.brandName || null,
                  unit_name: item.unitName || 'pc',
                  image_url: null,
                  imageUrl: null,
                  is_verified: true,
                  isVerified: true,
                  source: 'erply_api'
                });
              }
            }
          }
        }
      } catch (err) {}

      // 3. Search Mock Catalog
      for (const mock of INITIAL_PRODUCTS) {
        const matchText = `${mock.name} ${mock.brand || ''} ${mock.category || ''} ${mock.sku || ''} ${mock.barcode || ''}`.toLowerCase();
        if (matchText.includes(cleanSearch.toLowerCase())) {
          const key = String(mock.barcode || mock.sku || mock.id).trim().toLowerCase();
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            results.push({
              id: mock.id,
              barcode: mock.barcode,
              code: mock.sku,
              name: mock.name,
              price: Number(mock.unit_price || 0),
              price_with_vat: Number(mock.unit_price || 0) * 1.12,
              priceWithVat: Number(mock.unit_price || 0) * 1.12,
              supplier_name: mock.supplier || 'Savemore',
              brand_name: mock.brand || null,
              unit_name: 'pc',
              image_url: mock.image_url || null,
              imageUrl: mock.image_url || null,
              is_verified: true,
              isVerified: true,
              source: 'verified_catalog'
            });
          }
        }
      }

      return sendJson(res, 200, {
        success: true,
        count: results.length,
        products: results.slice(0, limitParam)
      });
    } catch (err) {
      console.error('Error during product search proxy:', err);
      return sendJson(res, 500, { success: false, error: 'SERVER_ERROR', message: err.message });
    }
  }

  return sendJson(res, 400, {
    success: false,
    error: 'BAD_REQUEST',
    message: 'Provide either ?barcode=[code] or ?search=[term].'
  });
}
