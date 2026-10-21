import { supabase } from '../supabaseClient';
import { purchaseOrdersApi } from './purchaseOrdersApi';

// Cross-tab broadcast channel for instant multi-device / multi-tab reactivity
const syncChannel = typeof window !== 'undefined' && window.BroadcastChannel 
  ? new BroadcastChannel('rma_portal_sync_bus') 
  : null;

/**
 * UNIFIED CATALOG & RMA REPORTING SERVICE
 */
export const catalogService = {
  /**
   * Broadcast real-time change to all listeners and open tabs
   */
  notifyChange(type = 'data-updated', payload = {}) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('rma-data-changed', { detail: { type, payload } }));
      try {
        syncChannel?.postMessage({ type, payload, timestamp: Date.now() });
      } catch (e) {
        // BroadcastChannel notice
      }
    }
  },

  /**
   * Subscribe to real-time events across windows / tabs
   */
  onDataChange(callback) {
    if (typeof window === 'undefined') return () => {};

    const handleCustom = (e) => callback(e.detail);
    const handleBroadcast = (e) => callback(e.data);

    window.addEventListener('rma-data-changed', handleCustom);
    syncChannel?.addEventListener('message', handleBroadcast);

    return () => {
      window.removeEventListener('rma-data-changed', handleCustom);
      syncChannel?.removeEventListener('message', handleBroadcast);
    };
  },

  /**
   * Test connection to Supabase database
   */
  async testSupabase() {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, barcode, name')
        .limit(5);

      if (error) {
        return { connected: false, error: error.message };
      }
      return { connected: true, rowsFound: data ? data.length : 0 };
    } catch (err) {
      return { connected: false, error: err.message };
    }
  },

  /**
   * Upload photo to Supabase Storage ('rma-photos' bucket)
   * With automatic Base64 fallback if storage bucket is not configured
   */
  async uploadPhoto(file) {
    if (!file) return null;
    try {
      const cleanName = file.name ? file.name.replace(/[^a-zA-Z0-9._-]/g, '_') : 'photo.jpg';
      const filePath = `reports/${Date.now()}-${Math.floor(Math.random() * 1000)}_${cleanName}`;
      
      const { data, error } = await supabase.storage
        .from('rma-photos')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true,
          contentType: file.type || 'image/jpeg'
        });

      if (error) {
        console.warn('Storage upload notice (falling back to data URL):', error.message);
        return await this.fileToBase64(file);
      }

      const { data: publicUrlData } = supabase.storage
        .from('rma-photos')
        .getPublicUrl(filePath);

      return publicUrlData.publicUrl;
    } catch (err) {
      console.warn('Storage exception (falling back to data URL):', err.message);
      return await this.fileToBase64(file);
    }
  },

  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = error => reject(error);
      reader.readAsDataURL(file);
    });
  },

  /**
   * Fast Barcode / SKU Lookup:
   * PRIORITY 1: Look in our custom Supabase 'products' table (returns product name and reference image)
   * PRIORITY 2: Look in Coworker's live API (erply_products)
   */
  async findProduct(barcodeOrQuery) {
    const clean = String(barcodeOrQuery || '').trim();
    if (!clean) return null;

    // 1. SUPABASE LOOKUP (PRIORITY #1)
    try {
      let supaItem = null;

      // 1a. Direct exact barcode match
      const { data: byBarcode, error: errBarcode } = await supabase
        .from('products')
        .select('*')
        .eq('barcode', clean)
        .limit(1);

      if (!errBarcode && byBarcode && byBarcode.length > 0) {
        if (!byBarcode[0].name?.startsWith('[DELETED]')) {
          supaItem = byBarcode[0];
        }
      }

      // 1b. Exact SKU/Code match if not found by barcode
      if (!supaItem) {
        const { data: byCode, error: errCode } = await supabase
          .from('products')
          .select('*')
          .ilike('code', clean)
          .limit(1);

        if (!errCode && byCode && byCode.length > 0) {
          if (!byCode[0].name?.startsWith('[DELETED]')) {
            supaItem = byCode[0];
          }
        }
      }

      if (supaItem) {
        return {
          id: supaItem.id,
          barcode: supaItem.barcode,
          code: supaItem.code || supaItem.barcode,
          name: supaItem.name,
          price: Number(supaItem.price || 0),
          priceWithVat: Number(supaItem.price_with_vat || supaItem.price || 0),
          supplierName: supaItem.supplier_name || 'Savemore',
          brandName: supaItem.brand_name || null,
          unitName: supaItem.unit_name || 'pc',
          hasSerialNumbers: supaItem.has_serial_numbers || false,
          imageUrl: supaItem.image_url || null, // Reference photo from admin
          isVerified: supaItem.is_verified !== false,
          source: 'Supabase Database (Yours)'
        };
      }
    } catch (e) {
      console.warn('Supabase lookup exception:', e.message);
    }

    // 2. COWORKER'S LIVE API (SECONDARY FALLBACK ONLY)
    try {
      const liveItem = await purchaseOrdersApi.findProductByBarcode(clean);
      if (liveItem) {
        return {
          id: liveItem.id,
          barcode: liveItem.code2 || liveItem.barcode || clean,
          code: liveItem.code || liveItem.sku,
          name: liveItem.name,
          price: Number(liveItem.price || liveItem.unit_price || 0),
          priceWithVat: Number(liveItem.priceWithVat || liveItem.unit_price || 0),
          supplierName: liveItem.supplierName || liveItem.supplier || 'Savemore',
          brandName: liveItem.brandName || null,
          unitName: liveItem.unitName || 'pc',
          hasSerialNumbers: liveItem.hasSerialNumbers || false,
          imageUrl: null,
          isVerified: true,
          source: "Coworker's API (5,793 Items)"
        };
      }
    } catch (e) {
      console.warn('Coworker API lookup warning:', e.message);
    }

    return null;
  },

  /**
   * COMPREHENSIVE MULTI-PRODUCT SEARCH:
   * Searches BOTH:
   * 1. Supabase 'products' table (Priority 1)
   * 2. Coworker's live API (5,793 items - Priority 2)
   * Returns ALL matching products (e.g. all 660 chocolates, Oreo, etc.) up to limit.
   */
  async searchAllProducts(query, limit = 40) {
    const clean = String(query || '').trim();
    if (!clean) return [];

    const results = [];
    const seenKeys = new Set();

    // 1. Search Supabase products table
    try {
      const { data: supaItems, error } = await supabase
        .from('products')
        .select('*')
        .or(`name.ilike.%${clean}%,barcode.ilike.%${clean}%,code.ilike.%${clean}%`)
        .order('is_verified', { ascending: false })
        .limit(limit);

      if (!error && supaItems && Array.isArray(supaItems)) {
        for (const item of supaItems) {
          if (item.name?.startsWith('[DELETED]')) continue;
          const key = String(item.barcode || item.code || item.id).trim().toLowerCase();
          seenKeys.add(key);

          results.push({
            id: item.id,
            barcode: item.barcode,
            code: item.code || item.barcode,
            name: item.name,
            price: Number(item.price || 0),
            priceWithVat: Number(item.price_with_vat || item.price || 0),
            supplierName: item.supplier_name || 'Savemore',
            brandName: item.brand_name || null,
            unitName: item.unit_name || 'pc',
            hasSerialNumbers: item.has_serial_numbers || false,
            imageUrl: item.image_url || null,
            isVerified: item.is_verified !== false,
            source: 'Supabase Database (Custom)'
          });
        }
      }
    } catch (e) {
      console.warn('Supabase product search warning:', e);
    }

    // 2. Search Coworker's live API (5,793 items)
    try {
      const liveItems = await purchaseOrdersApi.searchProducts(clean, limit);
      if (liveItems && Array.isArray(liveItems)) {
        for (const live of liveItems) {
          const key = String(live.code2 || live.barcode || live.code || live.sku).trim().toLowerCase();
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            results.push({
              id: live.id,
              barcode: live.code2 || live.barcode || live.code,
              code: live.code || live.sku,
              name: live.name,
              price: Number(live.price || live.unit_price || 0),
              priceWithVat: Number(live.priceWithVat || live.unit_price || 0),
              supplierName: live.supplierName || live.supplier || 'Savemore',
              brandName: live.brandName || null,
              unitName: live.unitName || 'pc',
              hasSerialNumbers: live.hasSerialNumbers || false,
              imageUrl: null,
              isVerified: true,
              source: "Coworker's Catalog (5,793 Items)"
            });
          }
        }
      }
    } catch (e) {
      console.warn('Coworker product search error:', e);
    }

    return results;
  },

  /**
   * FETCH ALL VERIFIED SAVED PRODUCTS FROM SUPABASE DATABASE
   */
  async getSavedProducts() {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('is_verified', true)
        .not('name', 'like', '[DELETED]%')
        .order('updated_at', { ascending: false });

      if (error) {
        console.warn('Error fetching saved products from Supabase:', error.message);
        return [];
      }
      return data || [];
    } catch (e) {
      console.warn('Saved products fetch exception:', e);
      return [];
    }
  },

  /**
   * ADMIN ACTION: Add a brand new product to the saved catalog
   */
  async createProduct({ barcode, code, name, supplierName, price, priceWithVat, brandName, unitName, imageUrl }) {
    const cleanBarcode = String(barcode || '').trim();
    if (!cleanBarcode) throw new Error('Product Barcode is required.');
    if (!name || !name.trim()) throw new Error('Product Name is required.');

    const newProd = {
      barcode: cleanBarcode,
      code: code ? code.trim() : null,
      name: name.trim(),
      supplier_name: supplierName ? supplierName.trim() : 'Savemore',
      price: Number(price || 0),
      price_with_vat: Number(priceWithVat || price || 0),
      brand_name: brandName ? brandName.trim() : null,
      unit_name: unitName ? unitName.trim() : 'pc',
      image_url: imageUrl ? imageUrl.trim() : null,
      is_verified: true,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('products')
      .upsert([newProd], { onConflict: 'barcode' })
      .select()
      .single();

    if (error) throw new Error(`Failed to save product: ${error.message}`);

    this.notifyChange('product-created', { barcode: cleanBarcode, product: data });
    return { success: true, product: data };
  },

  /**
   * ADMIN ACTION: Edit an existing product record
   */
  async updateProduct(id, { barcode, code, name, supplierName, price, priceWithVat, brandName, unitName, imageUrl }) {
    if (!id && !barcode) throw new Error('Product identifier required for update.');

    const updates = {
      name: name ? name.trim() : undefined,
      code: code !== undefined ? (code ? code.trim() : null) : undefined,
      supplier_name: supplierName ? supplierName.trim() : undefined,
      price: price !== undefined ? Number(price || 0) : undefined,
      price_with_vat: priceWithVat !== undefined ? Number(priceWithVat || price || 0) : undefined,
      brand_name: brandName !== undefined ? (brandName ? brandName.trim() : null) : undefined,
      unit_name: unitName ? unitName.trim() : undefined,
      image_url: imageUrl !== undefined ? (imageUrl ? imageUrl.trim() : null) : undefined,
      is_verified: true,
      updated_at: new Date().toISOString()
    };

    // Remove undefined values
    Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key]);

    let query = supabase.from('products').update(updates);
    if (id) query = query.eq('id', id);
    else query = query.eq('barcode', barcode);

    const { data, error } = await query.select();

    if (error) throw new Error(`Failed to update product: ${error.message}`);

    this.notifyChange('product-updated', { id, barcode, updates });
    return { success: true, product: data?.[0] };
  },

  /**
   * ADMIN ACTION: Delete a product record from database
   */
  async deleteProduct(id, barcode) {
    if (!id && !barcode) throw new Error('Product identifier required for deletion.');

    let query = supabase.from('products').delete();
    if (id) query = query.eq('id', id);
    else query = query.eq('barcode', barcode);

    const { error } = await query;

    // Fallback if DELETE policy is restricted: soft-delete
    if (error) {
      console.warn('Hard delete restricted, executing soft-delete:', error.message);
      let softQuery = supabase.from('products').update({
        is_verified: false,
        name: `[DELETED] ${id || barcode}`,
        updated_at: new Date().toISOString()
      });
      if (id) softQuery = softQuery.eq('id', id);
      else softQuery = softQuery.eq('barcode', barcode);
      await softQuery;
    }

    this.notifyChange('product-deleted', { id, barcode });
    return { success: true };
  },

  /**
   * SUBMIT RMA RETURN REPORT
   * - Photo is REQUIRED (at least 1)
   * - Reporter Name & Contact are REQUIRED
   * - Accurate GPS ONLY: Filters out inaccurate desktop IP geolocation (> 150m accuracy is left blank)
   */
  async submitReport({ 
    barcode, 
    product, 
    quantity = 1, 
    reporterName,
    reporterContact,
    reason = 'Damaged Box / Crushed Packaging',
    explanation = '',
    photos = [],
    gps = null 
  }) {
    const cleanBarcode = String(barcode || '').trim();
    if (!cleanBarcode) throw new Error('A barcode is required to report a return.');
    if (!photos || photos.length === 0) {
      throw new Error('Proof photo is required. Please attach at least 1 image.');
    }
    if (!reporterName || !reporterName.trim()) {
      throw new Error('Your name is required.');
    }
    if (!reporterContact || !reporterContact.trim()) {
      throw new Error('Your contact info (phone number or email) is required.');
    }

    // Generate readable RMA Number: RMA-YYYYMMDD-XXXX
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const rmaNumber = `RMA-${today}-${randomSuffix}`;

    const isKnown = Boolean(product && product.isVerified !== false);

    // Filter GPS: Only save if accuracy is <= 150 meters
    const isAccurateGps = gps && gps.latitude && gps.accuracy && Number(gps.accuracy) <= 150;

    const reportRow = {
      rma_number: rmaNumber,
      barcode: cleanBarcode,
      code: isKnown ? product.code : null,
      name: isKnown ? product.name : `Unidentified Item (${cleanBarcode})`,
      quantity: Number(quantity) || 1,
      supplier_name: isKnown ? product.supplierName : 'Pending Assignment',
      price: isKnown ? Number(product.price || 0) : 0,
      price_with_vat: isKnown ? Number(product.priceWithVat || 0) : 0,
      unit_name: isKnown ? (product.unitName || 'pc') : 'pc',
      status: isKnown ? 'pending' : 'pending_admin_details',
      reason: reason || 'Damaged Box / Crushed Packaging',
      explanation: explanation || null,
      photos: Array.isArray(photos) ? photos : [photos],
      gps_latitude: isAccurateGps ? Number(gps.latitude) : null,
      gps_longitude: isAccurateGps ? Number(gps.longitude) : null,
      gps_accuracy: isAccurateGps ? Number(gps.accuracy) : null,
      gps_timestamp: isAccurateGps ? new Date().toISOString() : null,
      reporter_name: reporterName.trim(),
      reporter_contact: reporterContact.trim(),
      reported_by: `${reporterName.trim()} (${reporterContact.trim()})`
    };

    // 1. Insert into rma_reports
    const { data: insertedReport, error: reportError } = await supabase
      .from('rma_reports')
      .insert([reportRow])
      .select()
      .single();

    if (reportError) {
      console.error('Failed to insert rma_report to Supabase:', reportError);
      throw new Error(`Database error saving return report: ${reportError.message}`);
    }

    // 2. If item is unknown, insert/upsert into Supabase products table as is_verified = false
    if (!isKnown) {
      const { error: prodError } = await supabase
        .from('products')
        .upsert([
          {
            barcode: cleanBarcode,
            code: null,
            name: `Unidentified Item (${cleanBarcode})`,
            supplier_name: 'Pending Assignment',
            price: 0,
            price_with_vat: 0,
            unit_name: 'pc',
            is_verified: false,
            updated_at: new Date().toISOString()
          }
        ], { onConflict: 'barcode' });

      if (prodError) {
        console.warn('Unknown barcode catalog upsert notice:', prodError.message);
      }
    }

    // Trigger instant real-time notification
    this.notifyChange('report-submitted', { report: insertedReport || reportRow });

    return {
      success: true,
      rmaNumber,
      isKnown,
      status: reportRow.status,
      report: insertedReport || reportRow
    };
  },

  /**
   * Fetch all unverified barcodes awaiting admin details
   */
  async getPendingBarcodes() {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('is_verified', false)
        .not('name', 'like', '[DELETED]%')
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Error fetching pending barcodes:', error.message);
        return [];
      }
      return data || [];
    } catch (e) {
      console.warn('Error fetching pending barcodes:', e.message);
      return [];
    }
  },

  /**
   * ADMIN ACTION: Fill in details for an unknown barcode, including optional product reference image.
   */
  async updateBarcodeDetails({ barcode, code, name, supplierName, price, priceWithVat, brandName, unitName, imageUrl }) {
    const cleanBarcode = String(barcode || '').trim();
    if (!cleanBarcode) throw new Error('Barcode is required.');

    const updates = {
      code: code ? code.trim() : null,
      name: name ? name.trim() : 'Unknown Item',
      supplier_name: supplierName ? supplierName.trim() : 'Savemore',
      price: Number(price || 0),
      price_with_vat: Number(priceWithVat || price || 0),
      brand_name: brandName ? brandName.trim() : null,
      unit_name: unitName ? unitName.trim() : 'pc',
      image_url: imageUrl ? imageUrl.trim() : null,
      is_verified: true,
      updated_at: new Date().toISOString()
    };

    // 1. Update product catalog
    const { error: prodErr } = await supabase
      .from('products')
      .update(updates)
      .eq('barcode', cleanBarcode);

    if (prodErr) throw new Error(`Failed to update product in database: ${prodErr.message}`);

    // 2. Update all pending RMA reports that referenced this barcode
    try {
      await supabase
        .from('rma_reports')
        .update({
          code: updates.code,
          name: updates.name,
          supplier_name: updates.supplier_name,
          price: updates.price,
          price_with_vat: updates.price_with_vat,
          unit_name: updates.unit_name,
          status: 'pending'
        })
        .eq('barcode', cleanBarcode)
        .eq('status', 'pending_admin_details');
    } catch (e) {
      console.warn('Failed to backfill rma_reports:', e.message);
    }

    this.notifyChange('barcode-verified', { barcode: cleanBarcode, updates });

    return { success: true };
  },

  /**
   * Get all RMA reports
   */
  async getRecentReports(limit = 50) {
    try {
      const { data, error } = await supabase
        .from('rma_reports')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.warn('Error fetching reports from Supabase:', error.message);
        return [];
      }
      return data || [];
    } catch (e) {
      console.warn('Error fetching reports:', e.message);
      return [];
    }
  }
};
