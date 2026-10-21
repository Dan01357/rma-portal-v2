import { supabase } from '../supabaseClient';
import { purchaseOrdersApi } from './purchaseOrdersApi';

/**
 * UNIFIED CATALOG & RMA REPORTING SERVICE
 * 
 * 1. Checks Your Supabase Database ('products' table)
 * 2. Checks Coworker's Live Purchase Orders API (5,793 items)
 * 3. Handles Unknown Barcodes:
 *    - Allows reporting even if barcode does not exist
 *    - Records unknown barcode in Supabase with is_verified = false
 *    - Provides admin update function so once verified, next scan recognizes it!
 */
export const catalogService = {
  /**
   * Test connection to Supabase database
   */
  async testSupabase() {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id')
        .limit(1);

      if (error) {
        return { connected: false, error: error.message };
      }
      return { connected: true };
    } catch (err) {
      return { connected: false, error: err.message };
    }
  },

  /**
   * Fast Barcode / SKU Lookup:
   * Tier 1: Look in our custom Supabase 'products' table
   * Tier 2: Look in Coworker's live API (erply_products)
   */
  async findProduct(barcodeOrQuery) {
    const clean = String(barcodeOrQuery || '').trim();
    if (!clean) return null;

    // 1. Check our own Supabase database first
    try {
      const { data: supaProducts, error } = await supabase
        .from('products')
        .select('*')
        .or(`barcode.eq.${clean},code.ilike.${clean}`)
        .limit(1);

      if (!error && supaProducts && supaProducts.length > 0) {
        const item = supaProducts[0];
        return {
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
          isVerified: item.is_verified !== false,
          source: 'Supabase Database (Yours)'
        };
      }
    } catch (e) {
      console.warn('Supabase lookup check warning:', e.message);
    }

    // 2. Check Coworker's Live Purchase Orders API
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

    // 3. Fallback: search coworker's API by keyword
    try {
      const searchResults = await purchaseOrdersApi.searchProducts(clean, 5);
      if (searchResults && searchResults.length > 0) {
        const first = searchResults[0];
        return {
          id: first.id,
          barcode: first.barcode || clean,
          code: first.sku || first.code,
          name: first.name,
          price: Number(first.unit_price || 0),
          priceWithVat: Number(first.unit_price || 0),
          supplierName: first.supplier || 'Savemore',
          brandName: null,
          unitName: 'pc',
          hasSerialNumbers: false,
          isVerified: true,
          source: "Coworker's API (Search Match)"
        };
      }
    } catch (e) {
      console.warn('Coworker API search fallback error:', e.message);
    }

    return null;
  },

  /**
   * SUBMIT RMA RETURN REPORT
   * Works for both:
   * A) Known item (records return immediately)
   * B) Unknown item (records return + logs barcode into Supabase for admin review)
   */
  async submitReport({ barcode, product, quantity = 1, location = '', notes = '', reportedBy = 'Warehouse Staff' }) {
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
      reported_by: reportedBy,
      notes: notes || null
    };

    // 1. Insert into rma_reports
    let reportSaved = false;
    try {
      const { data, error } = await supabase
        .from('rma_reports')
        .insert([reportRow])
        .select()
        .single();

      if (!error) {
        reportSaved = true;
      } else {
        console.warn('Failed to insert rma_report to Supabase:', error.message);
      }
    } catch (e) {
      console.warn('rma_reports insert exception:', e.message);
    }

    // 2. If item is unknown, insert/upsert into Supabase products table as is_verified = false
    let barcodeLogged = false;
    if (!isKnown) {
      try {
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

        if (!prodError) {
          barcodeLogged = true;
        } else {
          console.warn('Failed to log unknown barcode into products:', prodError.message);
        }
      } catch (e) {
        console.warn('Unknown barcode upsert exception:', e.message);
      }
    }

    return {
      success: true,
      rmaNumber,
      isKnown,
      reportSaved,
      barcodeLogged,
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

      if (error) throw error;
      return data || [];
    } catch (e) {
      console.warn('Error fetching pending barcodes:', e.message);
      return [];
    }
  },

  /**
   * ADMIN ACTION: Fill in details for an unknown barcode.
   * Once saved, this item is permanently recognized!
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

    if (prodErr) throw prodErr;

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
  async getRecentReports(limit = 20) {
    try {
      const { data, error } = await supabase
        .from('rma_reports')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (e) {
      console.warn('Error fetching reports:', e.message);
      return [];
    }
  }
};
