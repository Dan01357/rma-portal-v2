import { supabase } from '../supabaseClient';
import { INITIAL_PRODUCTS } from '../data/mockData';
import { notificationService } from './notificationService';

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
   * PRIORITY 2: Look in Enterprise live API (erply_products)
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
          ae_name: supaItem.ae_name || null,
          ae_email: supaItem.ae_email || null,
          company: supaItem.company || null,
          isVerified: supaItem.is_verified !== false,
          source: 'Supabase Database (Yours)'
        };
      }
    } catch (e) {
      console.warn('Supabase lookup exception:', e.message);
    }

    // 2. Wholesale Verified Catalog Fallback (Group 1 & 2 Products)
    const mockItem = INITIAL_PRODUCTS.find(p => 
      p.barcode === clean || 
      (p.sku && p.sku.toLowerCase() === clean.toLowerCase())
    );
    if (mockItem) {
      const isBonitaOrPingcon = (
        (mockItem.brand && mockItem.brand.toLowerCase().includes('bonita')) ||
        (mockItem.group && mockItem.group.toLowerCase().includes('pingcon'))
      );
      return {
        id: mockItem.id,
        barcode: mockItem.barcode,
        code: mockItem.sku,
        name: mockItem.name,
        price: Number(mockItem.unit_price || 0),
        priceWithVat: Number(mockItem.unit_price || 0) * 1.12,
        supplierName: mockItem.supplier || 'Savemore',
        brandName: mockItem.brand || null,
        unitName: 'pc',
        hasSerialNumbers: mockItem.requires_serial || false,
        imageUrl: mockItem.image_url || null,
        ae_name: null,
        ae_email: null,
        company: isBonitaOrPingcon ? 'Pingcon / Bonita' : 'A2Z2GO / Keysys',
        isVerified: true,
        source: 'Wholesale Verified Catalog'
      };
    }

    return null;
  },

  /**
   * COMPREHENSIVE MULTI-PRODUCT SEARCH:
   * Searches BOTH:
   * 1. Supabase 'products' table (Priority 1)
   * 2. Live Product Catalog API & Enterprise Wholesale Catalog (Priority 2)
   * Returns ALL matching products (e.g. chocolates, biscuits, coffee, etc.) up to limit.
   */
  async searchAllProducts(query, limit = 50) {
    const clean = String(query || '').trim();
    if (!clean) return [];

    const results = [];
    const seenKeys = new Set();
    const cleanLower = clean.toLowerCase();

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

    // 2. Wholesale Verified Catalog Fallback (INITIAL_PRODUCTS)
    for (const mock of INITIAL_PRODUCTS) {
      const matchText = `${mock.name} ${mock.brand || ''} ${mock.category || ''} ${mock.sku || ''} ${mock.barcode || ''}`.toLowerCase();
      if (matchText.includes(cleanLower)) {
        const key = String(mock.barcode || mock.sku || mock.id).trim().toLowerCase();
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          results.push({
            id: mock.id,
            barcode: mock.barcode,
            code: mock.sku,
            name: mock.name,
            price: Number(mock.unit_price || 0),
            priceWithVat: Number(mock.unit_price || 0) * 1.12,
            supplierName: mock.supplier || 'Savemore',
            brandName: mock.brand || null,
            unitName: 'pc',
            hasSerialNumbers: mock.requires_serial || false,
            imageUrl: mock.image_url || null,
            isVerified: true,
            source: 'Wholesale Verified Catalog'
          });
        }
      }
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

  async getProducts() {
    return this.getSavedProducts();
  },

  /**
   * Check if an SKU / Item Code already exists in products database (Deduplication removed: 1 SKU can have multiple barcodes)
   */
  async checkSkuUnique(code, excludeId = null, excludeBarcode = null) {
    return { isUnique: true };
  },

  /**
   * Check if a Product Name already exists in products database (Deduplication removed)
   */
  async checkNameUnique(name, excludeId = null, excludeBarcode = null) {
    return { isUnique: true };
  },

  /**
   * ADMIN ACTION: Add a brand new product to the saved catalog
   */
  async createProduct({ barcode, code, name, supplierName, price, priceWithVat, brandName, unitName, imageUrl, aeName, aeEmail, company }) {
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
      ae_name: aeName ? aeName.trim() : null,
      ae_email: aeEmail ? aeEmail.trim() : null,
      company: company ? company.trim() : null,
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
  async updateProduct(id, { barcode, code, name, supplierName, price, priceWithVat, brandName, unitName, imageUrl, aeName, aeEmail, company }) {
    if (!id && !barcode) throw new Error('Product identifier required for update.');

    // Deduplication removed: 1 SKU from company can have more than one barcode assignation
    const updates = {
      name: name ? name.trim() : undefined,
      code: code !== undefined ? (code ? code.trim() : null) : undefined,
      supplier_name: supplierName ? supplierName.trim() : undefined,
      price: price !== undefined ? Number(price || 0) : undefined,
      price_with_vat: priceWithVat !== undefined ? Number(priceWithVat || price || 0) : undefined,
      brand_name: brandName !== undefined ? (brandName ? brandName.trim() : null) : undefined,
      unit_name: unitName ? unitName.trim() : undefined,
      image_url: imageUrl !== undefined ? (imageUrl ? imageUrl.trim() : null) : undefined,
      ae_name: aeName !== undefined ? (aeName ? aeName.trim() : null) : undefined,
      ae_email: aeEmail !== undefined ? (aeEmail ? aeEmail.trim() : null) : undefined,
      company: company !== undefined ? (company ? company.trim() : null) : undefined,
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
   * ADMIN ACTION: Permanently delete a product record from database
   */
  async deleteProduct(idOrProduct, fallbackBarcode) {
    let id = null;
    let barcode = null;
    let name = '';

    if (typeof idOrProduct === 'object' && idOrProduct !== null) {
      id = idOrProduct.id || null;
      barcode = idOrProduct.barcode || null;
      name = idOrProduct.name || '';
    } else {
      id = idOrProduct || null;
      barcode = fallbackBarcode || null;
    }

    // If numeric or string passed without object
    if (!id && !barcode && idOrProduct) {
      barcode = String(idOrProduct);
    }

    if (!id && !barcode) {
      console.warn('Delete called without id or barcode:', idOrProduct);
      return { success: true };
    }

    let deleteError = null;

    if (id) {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) deleteError = error;
    }
    if (barcode) {
      const { error } = await supabase.from('products').delete().eq('barcode', barcode);
      if (error && !deleteError) deleteError = error;
    }

    if (deleteError) {
      console.error('Hard delete error from Supabase:', deleteError);
      throw new Error(`Database error deleting product: ${deleteError.message}`);
    }

    this.notifyChange('product-deleted', { id, barcode, name });
    return { success: true, id, barcode };
  },

  /**
   * ADMIN ACTION: Permanently delete multiple products from catalog in bulk
   */
  async deleteMultipleProducts(productsList) {
    if (!Array.isArray(productsList) || productsList.length === 0) return { success: true, count: 0 };
    
    const ids = productsList.map(p => p.id).filter(id => id !== undefined && id !== null);
    const barcodes = productsList.map(p => p.barcode).filter(Boolean);

    let deleteError = null;
    if (ids.length > 0) {
      const { error } = await supabase.from('products').delete().in('id', ids);
      if (error) deleteError = error;
    }
    if (barcodes.length > 0) {
      const { error } = await supabase.from('products').delete().in('barcode', barcodes);
      if (error && !deleteError) deleteError = error;
    }

    if (deleteError) {
      console.error('Error in deleteMultipleProducts:', deleteError);
      throw new Error(`Database error deleting products: ${deleteError.message}`);
    }

    this.notifyChange('products-bulk-deleted', { count: productsList.length });
    return { success: true, count: productsList.length };
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

    // Format: "RMA-YYYY-XXXX-RAND" (e.g. RMA-2026-0001-A14R)
    // RMA + Current Year + Serial Number of this RMA - Random unique alphanumeric
    let nextSeq = 1;
    try {
      const { data: latestRows } = await supabase
        .from('rma_reports')
        .select('id, rma_number')
        .order('id', { ascending: false })
        .limit(10);

      let maxNum = 0;
      if (latestRows && latestRows.length > 0) {
        for (const row of latestRows) {
          if (row.id && !isNaN(Number(row.id))) {
            maxNum = Math.max(maxNum, Number(row.id));
          }
          if (row.rma_number) {
            const m = String(row.rma_number).match(/RMA-\d{4}-(\d+)-/i);
            if (m && m[1]) {
              maxNum = Math.max(maxNum, parseInt(m[1], 10));
            }
          }
        }
      }
      if (maxNum > 0) {
        nextSeq = maxNum + 1;
      } else {
        const { count } = await supabase.from('rma_reports').select('id', { count: 'exact', head: true });
        nextSeq = (count || 0) + 1;
      }
    } catch (e) {
      nextSeq = 1;
    }

    const currentYear = new Date().getFullYear();
    const seqStr = String(nextSeq).padStart(4, '0');
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let randomSuffix = '';
    for (let i = 0; i < 4; i++) {
      randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const rmaNumber = `RMA-${currentYear}-${seqStr}-${randomSuffix}`;

    // Auto-resolve product from database if not passed in or still pending client-side detection
    let resolvedProduct = product;
    if (!resolvedProduct || !resolvedProduct.name || resolvedProduct.name.startsWith('Unidentified Item')) {
      try {
        const found = await this.findProduct(cleanBarcode);
        if (found) {
          resolvedProduct = found;
        }
      } catch (e) {
        console.warn('Could not auto-resolve product during submitReport:', e);
      }
    }

    const isKnown = Boolean(
      resolvedProduct && 
      resolvedProduct.isVerified !== false && 
      resolvedProduct.is_verified !== false &&
      !resolvedProduct.name?.startsWith('Unidentified Item')
    );

    // Filter GPS: Only save if accuracy is <= 150 meters
    const isAccurateGps = gps && gps.latitude && gps.accuracy && Number(gps.accuracy) <= 150;

    const reportRow = {
      rma_number: rmaNumber,
      barcode: cleanBarcode,
      code: isKnown ? (resolvedProduct.code || resolvedProduct.barcode) : null,
      name: isKnown ? resolvedProduct.name : `Unidentified Item (${cleanBarcode})`,
      quantity: Number(quantity) || 1,
      supplier_name: isKnown ? (resolvedProduct.supplier_name || resolvedProduct.supplierName || 'Savemore') : 'Pending Assignment',
      price: isKnown ? Number(resolvedProduct.price || 0) : 0,
      price_with_vat: isKnown ? Number(resolvedProduct.price_with_vat || resolvedProduct.priceWithVat || resolvedProduct.price || 0) : 0,
      unit_name: isKnown ? (resolvedProduct.unit_name || resolvedProduct.unitName || 'pc') : 'pc',
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
      reported_by: `${reporterName.trim()} (${reporterContact.trim()})`,
      ae_name: isKnown ? (resolvedProduct.ae_name || resolvedProduct.aeName || null) : null,
      ae_email: isKnown ? (resolvedProduct.ae_email || resolvedProduct.aeEmail || null) : null,
      company: isKnown ? (resolvedProduct.company || null) : null
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

    const finalReport = insertedReport || reportRow;

    // 2. Dispatch automated notification email ONLY if product already exists in database (isKnown)
    // If it's an unknown barcode reported for the first time, email will be sent after admin verifies and assigns AE!
    if (isKnown) {
      const isTestActive = typeof window !== 'undefined' && localStorage.getItem('rma_portal_test_mode') === 'true';
      notificationService.sendRMANotification(finalReport, isTestActive).catch(err => {
        console.warn('Background RMA report notification notice:', err.message);
      });
    }

    // 3. If item is unknown, insert/upsert into Supabase products table as is_verified = false
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
    this.notifyChange('report-submitted', { report: finalReport });

    return {
      success: true,
      rmaNumber,
      isKnown,
      status: reportRow.status,
      report: finalReport
    };
  },

  /**
   * Fetch all unverified barcodes awaiting admin details
   */
  async getPendingBarcodes() {
    try {
      // 1. Fetch active (non-deleted) RMA reports to know which barcodes are actually in play
      const { data: activeReports, error: rError } = await supabase
        .from('rma_reports')
        .select('id, rma_number, barcode, code, name, supplier_name, price, price_with_vat, status, created_at')
        .not('status', 'eq', 'deleted')
        .order('created_at', { ascending: false });

      if (rError) {
        console.warn('Error fetching active reports for pending cross-check:', rError.message);
      }

      const activeBarcodesWithReports = new Set(
        (activeReports || []).map(r => r.barcode).filter(Boolean)
      );

      // 2. Fetch unverified items from products table
      const { data: unverifiedProds, error: pError } = await supabase
        .from('products')
        .select('*')
        .eq('is_verified', false)
        .not('name', 'like', '[DELETED]%')
        .order('created_at', { ascending: false });

      if (pError) {
        console.warn('Error fetching unverified products:', pError.message);
      }

      const pendingMap = new Map();

      // Only add to pending if there is an active report referencing this unverified barcode!
      (unverifiedProds || []).forEach(p => {
        if (p.barcode && activeBarcodesWithReports.has(p.barcode)) {
          pendingMap.set(p.barcode, {
            ...p,
            id: p.id,
            barcode: p.barcode,
            name: p.name,
            code: p.code,
            supplier_name: p.supplier_name,
            price: p.price,
            price_with_vat: p.price_with_vat,
            created_at: p.created_at
          });
        }
      });

      // 3. Include any active rma_reports marked as 'pending_admin_details'
      (activeReports || [])
        .filter(r => r.status === 'pending_admin_details')
        .forEach(r => {
          if (r.barcode && !pendingMap.has(r.barcode)) {
            pendingMap.set(r.barcode, {
              id: r.id,
              barcode: r.barcode,
              code: r.code || null,
              name: r.name || `Unidentified Item (${r.barcode})`,
              supplier_name: r.supplier_name || 'Pending Assignment',
              price: r.price || 0,
              price_with_vat: r.price_with_vat || 0,
              is_verified: false,
              created_at: r.created_at
            });
          }
        });

      return Array.from(pendingMap.values());
    } catch (e) {
      console.warn('Error fetching pending barcodes:', e.message);
      return [];
    }
  },

  /**
   * ADMIN ACTION: Permanently dismiss or delete an unverified barcode from pending queue
   */
  async deletePendingBarcode(barcode, productId) {
    if (!barcode && !productId) return false;
    try {
      if (productId) {
        await supabase.from('products').delete().eq('id', productId);
      }
      if (barcode) {
        await supabase.from('products').delete().eq('barcode', barcode).eq('is_verified', false);
      }
      this.notifyChange('pending-barcode-deleted', { barcode, productId });
      return true;
    } catch (e) {
      console.warn('Failed to delete pending barcode:', e);
      return false;
    }
  },

  /**
   * ADMIN ACTION: Fill in details for an unknown barcode, including optional product reference image.
   */
  async updateBarcodeDetails({ barcode, code, name, supplierName, price, priceWithVat, brandName, unitName, imageUrl, aeName, aeEmail, company }) {
    const updates = {
      code: code ? code.trim() : null,
      name: name ? name.trim() : 'Unknown Item',
      supplier_name: supplierName ? supplierName.trim() : 'Savemore',
      price: Number(price || 0),
      price_with_vat: Number(priceWithVat || price || 0),
      brand_name: brandName ? brandName.trim() : null,
      unit_name: unitName ? unitName.trim() : 'pc',
      image_url: imageUrl ? imageUrl.trim() : null,
      ae_name: aeName ? aeName.trim() : null,
      ae_email: aeEmail ? aeEmail.trim() : null,
      company: company ? company.trim() : null,
      is_verified: true,
      updated_at: new Date().toISOString()
    };

    // 1. Upsert or update product catalog
    try {
      const { error: prodErr } = await supabase
        .from('products')
        .upsert({
          barcode: cleanBarcode,
          ...updates
        }, { onConflict: 'barcode' });

      if (prodErr) {
        // Fallback to update if upsert had a constraint mismatch
        await supabase
          .from('products')
          .update(updates)
          .eq('barcode', cleanBarcode);
      }
    } catch (err) {
      console.warn('Product catalog update notice:', err.message);
    }

    // 2. Fetch all pending reports matching this barcode so we can dispatch the official RMA notification email
    let pendingReportsToNotify = [];
    try {
      const { data: matchedReports } = await supabase
        .from('rma_reports')
        .select('*')
        .eq('barcode', cleanBarcode)
        .or('status.eq.pending_admin_details,name.ilike.%unidentified%');
      if (matchedReports && matchedReports.length > 0) {
        pendingReportsToNotify = matchedReports;
      }
    } catch (e) {
      console.warn('Notice querying pending rma_reports:', e.message);
    }

    // 3. Update all pending RMA reports that referenced this barcode
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
          ae_name: updates.ae_name,
          ae_email: updates.ae_email,
          company: updates.company,
          status: 'pending'
        })
        .eq('barcode', cleanBarcode)
        .eq('status', 'pending_admin_details');
    } catch (e) {
      console.warn('Failed to backfill rma_reports:', e.message);
    }

    this.notifyChange('barcode-verified', { barcode: cleanBarcode, updates });

    // 4. Automated RMA Alert dispatch: alert AE & configured TO/CC recipients for the newly verified RMA report(s)
    if (pendingReportsToNotify.length > 0) {
      try {
        const isTestActive = typeof window !== 'undefined' && localStorage.getItem('rma_portal_test_mode') === 'true';
        for (const rep of pendingReportsToNotify) {
          const enrichedReport = {
            ...rep,
            code: updates.code,
            name: updates.name,
            supplier_name: updates.supplier_name,
            price: updates.price,
            price_with_vat: updates.price_with_vat,
            unit_name: updates.unit_name,
            ae_name: updates.ae_name,
            ae_email: updates.ae_email,
            company: updates.company,
            status: 'pending'
          };
          notificationService.sendRMANotification(enrichedReport, isTestActive).catch(err => {
            console.warn('Background RMA report notification notice on SKU assignment:', err.message);
          });
        }
      } catch (e) {
        console.warn('Failed to dispatch RMA alert email on barcode verification:', e);
      }
    }

    return { success: true };
  },

  /**
   * Get all RMA reports (excluding deleted ones)
   */
  async getRecentReports(limit = 100) {
    try {
      const { data, error } = await supabase
        .from('rma_reports')
        .select('*')
        .not('status', 'eq', 'deleted')
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
  },

  /**
   * Delete an RMA report (with robust hard-delete and soft-delete fallback)
   */
  async deleteReport(id, rmaNumber) {
    if (!id && !rmaNumber) return false;
    try {
      // First find barcode of report to check for orphan cleanup
      let barcodeToCheck = null;
      try {
        let findQ = supabase.from('rma_reports').select('barcode').limit(1);
        if (id) findQ = findQ.eq('id', id);
        else findQ = findQ.eq('rma_number', rmaNumber);
        const { data: found } = await findQ;
        if (found && found.length > 0) barcodeToCheck = found[0].barcode;
      } catch (e) {}

      let query = supabase.from('rma_reports').delete();
      if (id) {
        query = query.eq('id', id);
      } else {
        query = query.eq('rma_number', rmaNumber);
      }
      const { data, error } = await query.select();

      // If hard delete was blocked by missing RLS policy or affected 0 rows, fallback to soft delete
      if (error || !data || data.length === 0) {
        console.warn('Direct delete matched 0 rows or was blocked by RLS, executing status update fallback:', error?.message);
        let softQuery = supabase.from('rma_reports').update({
          status: 'deleted'
        });
        if (id) softQuery = softQuery.eq('id', id);
        else softQuery = softQuery.eq('rma_number', rmaNumber);
        const { error: softErr } = await softQuery;
        if (softErr) {
          console.error('Soft delete error:', softErr);
          throw softErr;
        }
      }

      // Check if unverified product should be cleaned up
      if (barcodeToCheck) {
        try {
          const { data: otherReports } = await supabase
            .from('rma_reports')
            .select('id')
            .eq('barcode', barcodeToCheck)
            .not('status', 'eq', 'deleted');
          if (!otherReports || otherReports.length === 0) {
            // Delete orphan unverified product
            await supabase.from('products').delete().eq('barcode', barcodeToCheck).eq('is_verified', false);
          }
        } catch (e) {}
      }

      this.notifyChange('report-deleted', { id, rmaNumber });
      return true;
    } catch (e) {
      console.error('Delete RMA report error:', e);
      throw e;
    }
  },

  /**
   * ADMIN ACTION: Permanently delete multiple RMA reports in bulk
   */
  async deleteMultipleReports(reportsList) {
    if (!Array.isArray(reportsList) || reportsList.length === 0) return { success: true, count: 0 };
    
    const ids = reportsList.map(r => r.id).filter(id => id !== undefined && id !== null);
    const rmaNumbers = reportsList.map(r => r.rma_number).filter(Boolean);

    try {
      let deleteError = null;
      if (ids.length > 0) {
        const { error } = await supabase.from('rma_reports').delete().in('id', ids);
        if (error) deleteError = error;
      }
      if (rmaNumbers.length > 0) {
        const { error } = await supabase.from('rma_reports').delete().in('rma_number', rmaNumbers);
        if (error && !deleteError) deleteError = error;
      }

      // Soft delete fallback if hard delete blocked by RLS
      if (deleteError) {
        console.warn('Hard delete blocked or failed, executing soft-delete fallback in bulk:', deleteError.message);
        if (ids.length > 0) {
          await supabase.from('rma_reports').update({ status: 'deleted' }).in('id', ids);
        }
      }

      this.notifyChange('reports-bulk-deleted', { count: reportsList.length });
      return { success: true, count: reportsList.length };
    } catch (e) {
      console.error('Bulk delete RMA reports error:', e);
      throw e;
    }
  },

  /**
   * Get unique list of verified and recorded suppliers across catalog and returns
   */
  async getUniqueSuppliers() {
    const defaultSuppliers = [
      'Savemore',
      'Walter Mart',
      'SM Supermarket',
      'Puregold',
      'Robinsons Supermarket',
      'Mondelez',
      'Universal Robina Corporation (URC)',
      'Bonita',
      'Keysys',
      'A2Z2GO',
      'Pingcon Marketing'
    ];

    const supplierSet = new Set(defaultSuppliers);

    try {
      // 1. Fetch from Supabase products
      const { data: prodData } = await supabase
        .from('products')
        .select('supplier_name')
        .limit(200);

      if (prodData && Array.isArray(prodData)) {
        prodData.forEach(p => {
          if (p.supplier_name && p.supplier_name.trim() && p.supplier_name !== 'Pending Assignment') {
            supplierSet.add(p.supplier_name.trim());
          }
        });
      }

      // 2. Fetch from Supabase rma_reports
      const { data: reportData } = await supabase
        .from('rma_reports')
        .select('supplier_name')
        .limit(200);

      if (reportData && Array.isArray(reportData)) {
        reportData.forEach(r => {
          if (r.supplier_name && r.supplier_name.trim() && r.supplier_name !== 'Pending Assignment') {
            supplierSet.add(r.supplier_name.trim());
          }
        });
      }
    } catch (e) {
      console.warn('Notice loading unique suppliers:', e);
    }

    return Array.from(supplierSet).sort((a, b) => a.localeCompare(b));
  }
};

