import { supabase } from '../supabaseClient';
import { purchaseOrdersApi } from './purchaseOrdersApi';

/**
 * UNIFIED CATALOG & RMA REPORTING SERVICE
 * 
 * Supports:
 * - Supabase Priority #1 Catalog
 * - Coworker PO API Secondary Fallback
 * - Photo uploads to Supabase Storage ('rma-photos') with Base64 fallback
 * - Auto GPS Coordinates
 * - Defect reasons & explanations
 */
export const catalogService = {
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
   * Upload proof photo to Supabase Storage ('rma-photos' bucket)
   * With automatic Base64 fallback if storage bucket is not configured yet
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
        console.warn('Supabase storage upload notice (using data URL fallback):', error.message);
        return await this.fileToBase64(file);
      }

      const { data: publicUrlData } = supabase.storage
        .from('rma-photos')
        .getPublicUrl(filePath);

      return publicUrlData.publicUrl;
    } catch (err) {
      console.warn('Storage exception (using data URL fallback):', err.message);
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
   * PRIORITY 1: Look in our custom Supabase 'products' table
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
        supaItem = byBarcode[0];
      }

      // 1b. Exact SKU/Code match if not found by barcode
      if (!supaItem) {
        const { data: byCode, error: errCode } = await supabase
          .from('products')
          .select('*')
          .ilike('code', clean)
          .limit(1);

        if (!errCode && byCode && byCode.length > 0) {
          supaItem = byCode[0];
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
   * SUBMIT RMA RETURN REPORT
   * Records return with proof photos, defect reason, explanation, and GPS coordinates
   */
  async submitReport({ 
    barcode, 
    product, 
    quantity = 1, 
    location = '', 
    reason = 'Damaged in Transit / Crushed',
    explanation = '',
    photos = [],
    gps = null,
    reportedBy = 'Warehouse Staff' 
  }) {
    const cleanBarcode = String(barcode || '').trim();
    if (!cleanBarcode) throw new Error('A barcode is required to report a return.');

    // Generate readable RMA Number: RMA-YYYYMMDD-XXXX
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const rmaNumber = `RMA-${today}-${randomSuffix}`;

    const isKnown = Boolean(product && product.isVerified !== false);

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
      location: location || null,
      reason: reason || 'Damaged in Transit / Crushed',
      explanation: explanation || null,
      photos: Array.isArray(photos) ? photos : (photos ? [photos] : []),
      gps_latitude: gps?.latitude ? Number(gps.latitude) : null,
      gps_longitude: gps?.longitude ? Number(gps.longitude) : null,
      gps_accuracy: gps?.accuracy ? Number(gps.accuracy) : null,
      gps_timestamp: gps?.latitude ? new Date().toISOString() : null,
      reported_by: reportedBy
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
        console.warn('Unknown barcode upsert notice:', prodError.message);
      }
    }

    return {
      success: true,
      rmaNumber,
      isKnown,
      status: reportRow.status
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
   * ADMIN ACTION: Fill in details for an unknown barcode.
   */
  async updateBarcodeDetails({ barcode, code, name, supplierName, price, priceWithVat, brandName, unitName }) {
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

    return { success: true };
  },

  /**
   * Get all RMA reports
   */
  async getRecentReports(limit = 30) {
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
