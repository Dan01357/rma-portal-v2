import { supabase } from '../supabaseClient';
import { purchaseOrdersApi } from './purchaseOrdersApi';

/**
 * UNIFIED CATALOG & RMA REPORTING SERVICE
 * 
 * PRIORITY RULES:
 * 1. Supabase 'products' table is ALWAYS PRIORITY #1.
 * 2. Coworker's Live API (5,793 items) is SECONDARY FALLBACK ONLY.
 * 3. If item is not in either, it is an UNKNOWN BARCODE.
 *    - Reporter can report return anyway.
 *    - Return is inserted into 'rma_reports' (status: pending_admin_details).
 *    - Barcode is inserted into 'products' (is_verified: false).
 *    - Admin updates it -> system immediately recognizes it next time!
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
   * Fast Barcode / SKU Lookup:
   * PRIORITY 1: Look in our custom Supabase 'products' table
   * PRIORITY 2: Look in Coworker's live API (erply_products)
   */
  async findProduct(barcodeOrQuery) {
    const clean = String(barcodeOrQuery || '').trim();
    if (!clean) return null;

    // ==============================================================
    // 1. SUPABASE LOOKUP (PRIORITY #1)
    // ==============================================================
    try {
      let supaItem = null;

      // 1a. Direct exact barcode match
      const { data: byBarcode, error: errBarcode } = await supabase
        .from('products')
        .select('*')
        .eq('barcode', clean)
        .limit(1);

      if (errBarcode) {
        console.warn('Supabase barcode lookup error:', errBarcode.message);
      } else if (byBarcode && byBarcode.length > 0) {
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

      // If found in Supabase -> RETURN IMMEDIATELY (Do NOT call Coworker API!)
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

    // ==============================================================
    // 2. COWORKER'S LIVE API (SECONDARY FALLBACK ONLY)
    // ==============================================================
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

    // 2b. Secondary search in Coworker API by product name / keyword
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
      console.warn('Coworker API search fallback warning:', e.message);
    }

    // 3. Not found in either database
    return null;
  },

  /**
   * SUBMIT RMA RETURN REPORT
   * - Saves to public.rma_reports table
   * - If unknown item, logs barcode into public.products with is_verified = false
   * - Throws explicit errors if Supabase RLS blocks the write!
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
    const { data: insertedReport, error: reportError } = await supabase
      .from('rma_reports')
      .insert([reportRow])
      .select()
      .single();

    if (reportError) {
      console.error('Failed to insert rma_report to Supabase:', reportError);
      throw new Error(`Database error saving return report: ${reportError.message} (Please ensure RLS policy is applied in Supabase)`);
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
        console.error('Failed to log unknown barcode into products:', prodError);
        throw new Error(`Report saved, but could not register barcode into catalog: ${prodError.message}`);
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
   * Get all RMA reports from public.rma_reports
   */
  async getRecentReports(limit = 20) {
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
