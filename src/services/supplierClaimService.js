import { supabase } from '../supabaseClient';

const CLAIMS_STORAGE_KEY = 'rma_portal_supplier_claims_v2';
const SETTINGS_KEY = 'supplier_claims_store';

export const supplierClaimService = {
  /**
   * GENERATE UNIQUE RTV ID
   * Format: RTV-YYYY-XXXX-RAND (e.g. RTV-2026-0001-HY67)
   * RTV + Current Year + 4-digit increasing sequence + 4-char alphanumeric
   */
  generateRtvId(existingClaims = []) {
    const currentYear = new Date().getFullYear();
    let maxSeq = 0;

    if (Array.isArray(existingClaims)) {
      existingClaims.forEach(c => {
        const num = c.claim_number || c.claimNumber || '';
        const match = String(num).match(/RTV-\d{4}-(\d+)-/i);
        if (match && match[1]) {
          const parsed = parseInt(match[1], 10);
          if (!isNaN(parsed) && parsed > maxSeq) {
            maxSeq = parsed;
          }
        }
      });
    }

    const nextSeq = String(maxSeq + 1).padStart(4, '0');
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let rand = '';
    for (let i = 0; i < 4; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return `RTV-${currentYear}-${nextSeq}-${rand}`;
  },

  /**
   * GET ALL SAVED SUPPLIER DEBIT CLAIMS
   * Fetches from:
   * 1. Supabase public.supplier_claims table (if exists)
   * 2. Supabase rma_settings table (key: 'supplier_claims_store')
   * 3. LocalStorage fallback
   */
  async getClaims() {
    let remoteClaims = null;

    // 1. Try dedicated table first
    try {
      const { data, error } = await supabase
        .from('supplier_claims')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        remoteClaims = data;
      }
    } catch (e) {
      // Table may not exist yet in Postgres
    }

    // 2. If table not found, fetch from rma_settings
    if (!remoteClaims) {
      try {
        const { data, error } = await supabase
          .from('rma_settings')
          .select('value')
          .eq('key', SETTINGS_KEY)
          .single();

        if (!error && data?.value && Array.isArray(data.value)) {
          remoteClaims = data.value;
        }
      } catch (e) {
        console.warn('Could not read supplier_claims_store from rma_settings:', e.message);
      }
    }

    // 3. Fallback to localStorage if offline or first load
    let localClaims = [];
    try {
      const raw = localStorage.getItem(CLAIMS_STORAGE_KEY);
      if (raw) {
        localClaims = JSON.parse(raw);
      }
    } catch (e) {}

    // Merge by claim_number
    const claimMap = new Map();
    localClaims.forEach(c => {
      const id = c.claim_number || c.claimNumber;
      if (id) claimMap.set(id, c);
    });
    (remoteClaims || []).forEach(c => {
      const id = c.claim_number || c.claimNumber;
      if (id) claimMap.set(id, c);
    });

    const merged = Array.from(claimMap.values()).sort((a, b) => {
      const dateA = new Date(a.created_at || a.createdAt || 0).getTime();
      const dateB = new Date(b.created_at || b.createdAt || 0).getTime();
      return dateB - dateA;
    });

    // Cache to localStorage
    try {
      localStorage.setItem(CLAIMS_STORAGE_KEY, JSON.stringify(merged));
    } catch (e) {}

    return merged;
  },

  /**
   * SAVE NEW SUPPLIER DEBIT CLAIM (RTV)
   * Automatically persists to Supabase (supplier_claims table & rma_settings)
   * and updates linked rma_reports with the RTV identifier and audit trail.
   */
  async saveClaim({
    claimNumber,
    supplierName,
    generatedBy,
    items = [],
    totalQuantity = 0,
    totalClaimAmount = 0
  }) {
    if (!claimNumber) throw new Error('Claim number is required');
    if (!items.length) throw new Error('At least one item is required to save claim');

    const cleanClaimNumber = String(claimNumber).trim();
    const cleanSupplier = String(supplierName || 'Savemore').trim();
    const cleanGeneratedBy = String(generatedBy || 'Warehouse Staff').trim();
    const nowIso = new Date().toISOString();

    const claimRecord = {
      claim_number: cleanClaimNumber,
      claimNumber: cleanClaimNumber,
      supplier_name: cleanSupplier,
      supplierName: cleanSupplier,
      generated_by: cleanGeneratedBy,
      generatedBy: cleanGeneratedBy,
      total_quantity: Number(totalQuantity) || items.length,
      totalQuantity: Number(totalQuantity) || items.length,
      total_claim_amount: Number(totalClaimAmount) || 0,
      totalClaimAmount: Number(totalClaimAmount) || 0,
      created_at: nowIso,
      createdAt: nowIso,
      status: 'generated',
      items: items.map(item => ({
        rma_number: item.rma_number,
        barcode: item.barcode,
        name: item.name,
        code: item.code || item.sku || '',
        quantity: Number(item.quantity) || 1,
        unit_name: item.unit_name || 'pc',
        price: Number(item.price_with_vat || item.price || 0),
        total: (Number(item.quantity) || 1) * Number(item.price_with_vat || item.price || 0),
        reason: item.reason || 'Damaged Box / Crushed Packaging'
      }))
    };

    // 1. Try inserting into public.supplier_claims table
    let savedToTable = false;
    try {
      const { error } = await supabase
        .from('supplier_claims')
        .upsert([
          {
            claim_number: cleanClaimNumber,
            supplier_name: cleanSupplier,
            generated_by: cleanGeneratedBy,
            total_quantity: claimRecord.total_quantity,
            total_claim_amount: claimRecord.total_claim_amount,
            items: claimRecord.items,
            status: 'generated',
            created_at: nowIso
          }
        ], { onConflict: 'claim_number' });

      if (!error) savedToTable = true;
    } catch (e) {
      // Table may not exist yet
    }

    // 2. Persist to rma_settings (key: 'supplier_claims_store') as universal sync
    try {
      const existing = await this.getClaims();
      const updatedList = [claimRecord, ...existing.filter(c => (c.claim_number || c.claimNumber) !== cleanClaimNumber)];
      
      await supabase
        .from('rma_settings')
        .upsert({
          key: SETTINGS_KEY,
          value: updatedList,
          updated_at: nowIso
        });

      localStorage.setItem(CLAIMS_STORAGE_KEY, JSON.stringify(updatedList));
    } catch (e) {
      console.warn('Could not update rma_settings with new claim:', e);
    }

    // 3. Update all linked rma_reports: set disposition to RTV and append to audit_trail & notes
    try {
      for (const item of items) {
        const rmaNum = item.rma_number;
        if (!rmaNum) continue;

        // Fetch current row to append to audit_trail
        const { data: currentRows } = await supabase
          .from('rma_reports')
          .select('id, audit_trail, notes')
          .eq('rma_number', rmaNum);

        const row = currentRows && currentRows[0];
        if (row) {
          const currentAudit = Array.isArray(row.audit_trail) ? row.audit_trail : [];
          const updatedAudit = [
            ...currentAudit,
            {
              action: 'RTV_CLAIM_GENERATED',
              rtv_number: cleanClaimNumber,
              supplier_name: cleanSupplier,
              generated_by: cleanGeneratedBy,
              timestamp: nowIso
            }
          ];

          const existingNotes = row.notes || '';
          const tag = `[RTV: ${cleanClaimNumber}]`;
          const updatedNotes = existingNotes.includes(tag) 
            ? existingNotes 
            : (existingNotes ? `${existingNotes}\n${tag}` : tag);

          await supabase
            .from('rma_reports')
            .update({
              disposition: 'Return to Vendor (RTV)',
              audit_trail: updatedAudit,
              notes: updatedNotes
            })
            .eq('id', row.id);
        }
      }
    } catch (e) {
      console.warn('Could not update linked rma_reports with RTV info:', e);
    }

    return claimRecord;
  },

  /**
   * DELETE / VOID A SUPPLIER CLAIM
   */
  async deleteClaim(claimNumber) {
    if (!claimNumber) return;

    // Delete from table
    try {
      await supabase
        .from('supplier_claims')
        .delete()
        .eq('claim_number', claimNumber);
    } catch (e) {}

    // Update rma_settings
    try {
      const existing = await this.getClaims();
      const updatedList = existing.filter(c => (c.claim_number || c.claimNumber) !== claimNumber);
      
      await supabase
        .from('rma_settings')
        .upsert({
          key: SETTINGS_KEY,
          value: updatedList,
          updated_at: new Date().toISOString()
        });

      localStorage.setItem(CLAIMS_STORAGE_KEY, JSON.stringify(updatedList));
    } catch (e) {}
  }
};
