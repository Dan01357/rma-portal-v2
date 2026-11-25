import { supabase } from './supabase.js';
import { sendJson, setCorsHeaders } from './auth.js';
import { INITIAL_PRODUCTS } from './mockProducts.js';

const DEFAULT_KNOWN_GPS_LOCATIONS = [
  {
    name: 'Pingcon Warehouse',
    street: '64 Mendez Rd',
    barangay: 'Baesa',
    city: 'Quezon City',
    region: 'Metro Manila',
    zip: '1106',
    formatted: '64 Mendez Rd, Baesa, Quezon City, Metro Manila 1106',
    lat: 14.6683,
    lon: 121.0114,
    radiusMeters: 250
  }
];

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every((v) => Number.isFinite(Number(v)))) {
    return Infinity;
  }
  const R = 6371000;
  const dLat = toRadians(Number(lat2) - Number(lat1));
  const dLon = toRadians(Number(lon2) - Number(lon1));
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(Number(lat1))) * Math.cos(toRadians(Number(lat2))) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatStructuredAddress({ street = '', barangay = '', city = '', region = '', zip = '' }) {
  const cleanStreet = String(street || '').trim();
  const cleanBarangay = String(barangay || '').trim();
  const cleanCity = String(city || '').trim();
  const cleanRegion = String(region || '').trim();
  const cleanZip = String(zip || '').trim();

  const regionZip = [
    cleanRegion && cleanRegion.toLowerCase() !== cleanCity.toLowerCase() ? cleanRegion : '',
    cleanZip
  ].filter(Boolean).join(' ').trim();

  const uniqueParts = [];
  for (const part of [
    cleanStreet,
    cleanBarangay && cleanBarangay.toLowerCase() !== cleanCity.toLowerCase() ? cleanBarangay : '',
    cleanCity,
    regionZip
  ]) {
    const clean = String(part || '').trim();
    if (!clean) continue;
    if (!uniqueParts.some((existing) => existing.toLowerCase() === clean.toLowerCase())) {
      uniqueParts.push(clean);
    }
  }

  const formatted = uniqueParts.join(', ');
  const line1 = [
    cleanStreet,
    cleanBarangay && cleanBarangay.toLowerCase() !== cleanStreet.toLowerCase() ? cleanBarangay : ''
  ].filter(Boolean).join(', ') || cleanCity || formatted;

  const line2Parts = [];
  if (cleanCity && cleanCity.toLowerCase() !== line1.toLowerCase()) {
    line2Parts.push(cleanCity);
  }
  if (regionZip && regionZip.toLowerCase() !== line1.toLowerCase()) {
    line2Parts.push(regionZip);
  }
  const line2 = line2Parts.join(', ');
  const lines = [line1, line2].filter(Boolean);

  return { formatted, lines };
}

async function loadKnownGpsAnchors() {
  try {
    const { data, error } = await supabase
      .from('rma_settings')
      .select('value')
      .eq('key', 'known_gps_locations')
      .maybeSingle();

    if (!error && data && data.value != null) {
      let parsed = data.value;
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          parsed = null;
        }
      }
      if (Array.isArray(parsed) && parsed.length > 0) {
        const valid = parsed.filter((a) => a && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lon ?? a.lng)));
        if (valid.length > 0) return valid;
      }
    }
  } catch {
    // Quiet fallback to default warehouse anchor
  }
  return DEFAULT_KNOWN_GPS_LOCATIONS;
}

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

  const actionParam = String(req.query?.action || '').trim().toLowerCase();
  if (actionParam === 'reverse-geocode') {
    const rawLat = Number(req.query?.lat ?? req.query?.latitude);
    const rawLon = Number(req.query?.lon ?? req.query?.lng ?? req.query?.longitude);

    if (!Number.isFinite(rawLat) || !Number.isFinite(rawLon) || rawLat < -90 || rawLat > 90 || rawLon < -180 || rawLon > 180) {
      return sendJson(res, 400, {
        success: false,
        error: 'INVALID_COORDINATES',
        message: 'Provide valid numeric lat (-90..90) and lon (-180..180) parameters.'
      });
    }

    const fallbackFormatted = `${rawLat.toFixed(5)}, ${rawLon.toFixed(5)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5500);

    try {
      // Priority 1: Known Warehouse / Dock Geofence Anchors (exact warehouse street & ZIP)
      const anchors = await loadKnownGpsAnchors();
      let matchedAnchor = null;
      let matchedDist = Infinity;
      for (const anchor of anchors) {
        const anchorLat = Number(anchor.lat);
        const anchorLon = Number(anchor.lon ?? anchor.lng);
        const radius = Number(anchor.radiusMeters) > 0 ? Number(anchor.radiusMeters) : 250;
        const dist = haversineMeters(rawLat, rawLon, anchorLat, anchorLon);
        if (dist <= radius && dist < matchedDist) {
          matchedAnchor = anchor;
          matchedDist = dist;
        }
      }

      if (matchedAnchor) {
        const street = String(matchedAnchor.street || '').trim();
        const barangay = String(matchedAnchor.barangay || '').trim();
        const city = String(matchedAnchor.city || '').trim();
        const region = String(matchedAnchor.region || '').trim();
        const zip = String(matchedAnchor.zip || '').trim();
        const { formatted: builtFormatted, lines: builtLines } = formatStructuredAddress({
          street,
          barangay,
          city,
          region,
          zip
        });
        const formatted = String(matchedAnchor.formatted || '').trim() || builtFormatted || fallbackFormatted;
        const lines = builtLines.length > 0 ? builtLines : [formatted];

        return sendJson(res, 200, {
          success: true,
          source: 'known_gps_anchor',
          anchorName: String(matchedAnchor.name || '').trim(),
          distanceMeters: Math.round(matchedDist),
          latitude: rawLat,
          longitude: rawLon,
          street,
          barangay,
          city,
          region,
          zip,
          country: 'Philippines',
          formatted,
          lines,
          display_name: formatted
        });
      }

      // Priority 2: Google Maps Geocoding API (if configured in env)
      const googleMapsKey = String(
        process.env.GOOGLE_MAPS_API_KEY ||
        process.env.GOOGLE_GEOCODING_API_KEY ||
        ''
      ).trim();

      if (googleMapsKey) {
        try {
          const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(rawLat)},${encodeURIComponent(rawLon)}&key=${encodeURIComponent(googleMapsKey)}`;
          const gRes = await fetch(gUrl, { signal: controller.signal });
          if (gRes.ok) {
            const gData = await gRes.json();
            if (gData?.status === 'OK' && Array.isArray(gData.results) && gData.results.length > 0) {
              const preferred =
                gData.results.find((r) => Array.isArray(r.types) && r.types.includes('street_address')) ||
                gData.results.find((r) => Array.isArray(r.types) && r.types.includes('premise')) ||
                gData.results[0];
              const comps = Array.isArray(preferred?.address_components) ? preferred.address_components : [];
              const getComp = (...types) => {
                for (const t of types) {
                  const found = comps.find((c) => Array.isArray(c.types) && c.types.includes(t));
                  if (found?.long_name) return String(found.long_name).trim();
                }
                return '';
              };
              const streetNum = getComp('street_number');
              const route = getComp('route');
              const street = [streetNum, route].filter(Boolean).join(' ').trim();
              const barangay = getComp('sublocality_level_2', 'sublocality_level_1', 'sublocality', 'neighborhood');
              const city = getComp('locality', 'administrative_area_level_2');
              const rawRegion = getComp('administrative_area_level_1');
              const region = /^national capital region$/i.test(rawRegion) ? 'Metro Manila' : rawRegion;
              const zip = getComp('postal_code');
              const country = getComp('country');
              const { formatted: builtFormatted, lines: builtLines } = formatStructuredAddress({
                street,
                barangay,
                city,
                region,
                zip
              });
              const formatted = builtFormatted || String(preferred?.formatted_address || '').trim() || fallbackFormatted;
              if (street || city || zip) {
                return sendJson(res, 200, {
                  success: true,
                  source: 'google_maps',
                  latitude: rawLat,
                  longitude: rawLon,
                  street,
                  barangay,
                  city,
                  region,
                  zip,
                  country,
                  formatted,
                  lines: builtLines.length > 0 ? builtLines : [formatted],
                  display_name: preferred?.formatted_address || formatted
                });
              }
            }
          }
        } catch {
          // Fall through cleanly to Priority 3 (Nominatim)
        }
      }

      // Priority 3: Nominatim Zoom-18 fallback prioritizing house_number + road -> barangay -> city -> region -> ZIP
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(rawLat)}&lon=${encodeURIComponent(rawLon)}&addressdetails=1&zoom=18`;
      const geoRes = await fetch(url, {
        headers: {
          'User-Agent': 'Wholesale-RMA-Portal/2.0 (finance2@keysysincorporated.com)',
          Accept: 'application/json',
          'Accept-Language': 'en'
        },
        signal: controller.signal
      });

      if (!geoRes.ok) {
        throw new Error(`Nominatim responded HTTP ${geoRes.status}`);
      }

      const data = await geoRes.json();
      const addr = data?.address || {};
      const primaryRoad = String(
        addr.road ||
        addr.pedestrian ||
        addr.residential ||
        addr.footway ||
        addr.path ||
        addr.building ||
        ''
      ).trim();
      const street = [addr.house_number, primaryRoad].filter(Boolean).join(' ').trim();
      const barangay = String(
        addr.suburb ||
        addr.quarter ||
        addr.city_district ||
        addr.neighbourhood ||
        addr.village ||
        addr.hamlet ||
        ''
      ).trim();
      const city = String(addr.city || addr.town || addr.municipality || addr.county || '').trim();
      const rawRegion = String(addr.state || addr.region || '').trim();
      const isNcrCity = /^(quezon city|manila|makati|pasig|taguig|mandaluyong|caloocan|paranaque|para\u00f1aque|las pinas|las pi\u00f1as|marikina|pasay|valenzuela|malabon|navotas|san juan|muntinlupa|pateros)$/i.test(city);
      const region = rawRegion || (isNcrCity ? 'Metro Manila' : '');
      const zip = String(addr.postcode || '').trim();
      const country = String(addr.country || '').trim();

      const { formatted: builtFormatted, lines } = formatStructuredAddress({
        street,
        barangay,
        city,
        region,
        zip
      });
      const formatted = builtFormatted || String(data?.display_name || '').trim() || fallbackFormatted;

      return sendJson(res, 200, {
        success: true,
        source: 'nominatim',
        latitude: rawLat,
        longitude: rawLon,
        street,
        barangay,
        city,
        region,
        zip,
        country,
        formatted,
        lines: lines.length > 0 ? lines : [formatted],
        display_name: data?.display_name || formatted
      });
    } catch (err) {
      return sendJson(res, 200, {
        success: false,
        fallback: true,
        error: err?.message || 'Reverse geocode unavailable',
        latitude: rawLat,
        longitude: rawLon,
        street: '',
        barangay: '',
        city: '',
        region: '',
        zip: '',
        formatted: fallbackFormatted,
        lines: [fallbackFormatted]
      });
    } finally {
      clearTimeout(timer);
    }
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
