import { supabase } from './supabase.js';
import { sendJson, setCorsHeaders } from './auth.js';
import { INITIAL_PRODUCTS } from './mockProducts.js';

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

function extractPcsPerCase(item) {
  const rawBrand = item?.brand_name || item?.brandName || '';
  const pcsMatch = String(rawBrand).match(/\[Pcs\/Cs:(\d+)\]/);
  const parsedBrandPcs = pcsMatch ? parseInt(pcsMatch[1], 10) : null;
  const rawPcs = item?.pieces_per_case ?? item?.piecesPerCase ?? parsedBrandPcs ?? null;
  const numPcs = Number(rawPcs);
  return Number.isFinite(numPcs) && numPcs > 0 ? numPcs : null;
}

function normalizeLookupItem(raw, source, fallbackBarcode = null) {
  if (!raw) return null;
  const isErply = source === 'erply_api';
  const isMock = source === 'verified_catalog';
  const barcodeVal = isErply
    ? (raw.ean_code || raw.code2 || raw.barcode || fallbackBarcode || null)
    : (raw.barcode || fallbackBarcode || null);
  const rawSku = raw.code || raw.sku || null;
  const cleanSku = (rawSku && rawSku !== barcodeVal) ? rawSku : null;
  const rawBrand = raw.brand_name || raw.brandName || raw.brand || '';
  const cleanBrand = String(rawBrand).replace(/\s*\[Pcs\/Cs:\d+\]/g, '').trim() || null;
  const parsedPcs = extractPcsPerCase(raw);

  const rawPrice = Number(isMock ? (raw.unit_price || 0) : (raw.price || 0));
  const priceWithVat = isMock
    ? rawPrice * 1.12
    : (parseFloat(raw.priceWithVat) || parseFloat(raw.price_with_vat) || parseFloat(raw.price) || 0);
  const netPrice = isMock
    ? rawPrice
    : (parseFloat(raw.price) || (priceWithVat > 0 ? priceWithVat / 1.12 : 0));

  const supplierVal = raw.supplierName || raw.supplier_name || raw.supplier || 'Savemore';
  const unitVal = raw.unitName || raw.unit_name || 'pc';

  return {
    id: String(raw.id || cleanSku || barcodeVal || ''),
    barcode: barcodeVal || cleanSku || null,
    code: cleanSku,
    sku: cleanSku,
    ean_code: raw.ean_code || (!isErply && !isMock ? raw.barcode : null) || null,
    name: raw.name || '',
    price: netPrice,
    price_with_vat: priceWithVat,
    priceWithVat: priceWithVat,
    supplier_name: supplierVal,
    supplierName: supplierVal,
    supplier: supplierVal,
    brand_name: cleanBrand,
    brandName: cleanBrand,
    brand: cleanBrand,
    unit_name: unitVal,
    unitName: unitVal,
    pieces_per_case: parsedPcs,
    piecesPerCase: parsedPcs,
    has_serial_numbers: Boolean(raw.hasSerialNumbers || raw.has_serial_numbers || raw.requires_serial),
    hasSerialNumbers: Boolean(raw.hasSerialNumbers || raw.has_serial_numbers || raw.requires_serial),
    image_url: raw.image_url || raw.imageUrl || null,
    imageUrl: raw.imageUrl || raw.image_url || null,
    ae_name: raw.ae_name || null,
    ae_email: raw.ae_email || null,
    company: raw.company || null,
    is_verified: isErply || isMock ? true : (raw.is_verified !== false),
    isVerified: isErply || isMock ? true : (raw.is_verified !== false),
    source
  };
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
            product: normalizeLookupItem(item, 'database')
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
        const normalized = normalizeLookupItem(matchedItem, 'erply_api', cleanBarcode);

        // Cache into Supabase so subsequent scans find it directly in Supabase
        try {
          await supabase.from('products').upsert({
            barcode: normalized.barcode,
            code: normalized.code,
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
          product: normalizeLookupItem(mock, 'verified_catalog')
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
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            results.push(normalizeLookupItem(item, 'database'));
          }
        }
      }

      // 2. Search Laravel Cloud API (test case variations + direct ?code= if term has no spaces)
      const key = await getCatalogApiKey();
      const baseUrl = process.env.PO_API_URL || process.env.VITE_PO_API_URL || 'https://purchase-order-db-production-ff1oho.laravel.cloud/api/v1';
      const cols = 'id,code,code2,ean_code,name,priceWithVat,price,supplierName,brandName,unitName,hasSerialNumbers';
      const capitalized = cleanSearch.charAt(0).toUpperCase() + cleanSearch.slice(1);
      const uppercase = cleanSearch.toUpperCase();
      const lowercase = cleanSearch.toLowerCase();
      const searchVariations = Array.from(new Set([cleanSearch, capitalized, uppercase, lowercase]));
      const erplyUrls = searchVariations.map(
        (term) => `${baseUrl}/data/erply_products?search=${encodeURIComponent(term)}&per_page=25&columns=${cols}`
      );
      if (!/\s/.test(cleanSearch)) {
        const codeVariations = Array.from(new Set([cleanSearch, uppercase, lowercase]));
        codeVariations.forEach((codeTerm) => {
          erplyUrls.push(`${baseUrl}/data/erply_products?code=${encodeURIComponent(codeTerm)}&per_page=25&columns=${cols}`);
        });
      }

      try {
        const responses = await Promise.all(
          erplyUrls.map(async (url) => {
            try {
              const r = await fetch(url, {
                headers: { 'X-API-Key': key, 'Accept': 'application/json' },
                signal: AbortSignal.timeout(5000)
              });
              if (!r.ok) return [];
              const j = await r.json();
              return Array.isArray(j?.data) ? j.data : [];
            } catch {
              return [];
            }
          })
        );
        for (const batch of responses) {
          for (const item of batch) {
            const normalized = normalizeLookupItem(item, 'erply_api');
            const prodKey = String(normalized.barcode || normalized.code || normalized.id).trim().toLowerCase();
            if (!seenKeys.has(prodKey)) {
              seenKeys.add(prodKey);
              results.push(normalized);
            }
          }
        }
      } catch (err) {}

      // 3. Search Mock Catalog
      for (const mock of INITIAL_PRODUCTS) {
        const matchText = `${mock.name} ${mock.brand || ''} ${mock.category || ''} ${mock.sku || ''} ${mock.barcode || ''}`.toLowerCase();
        if (matchText.includes(cleanSearch.toLowerCase())) {
          const mockKey = String(mock.barcode || mock.sku || mock.id).trim().toLowerCase();
          if (!seenKeys.has(mockKey)) {
            seenKeys.add(mockKey);
            results.push(normalizeLookupItem(mock, 'verified_catalog'));
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
