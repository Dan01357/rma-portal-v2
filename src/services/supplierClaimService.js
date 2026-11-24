import { supabase } from '../supabaseClient';
import { isTestRecord } from '../utils/rmaHelpers';

const CLAIMS_STORAGE_KEY = 'rma_portal_supplier_claims_v2';
const SETTINGS_KEY = 'supplier_claims_store';

export const supplierClaimService = {
  /**
   * Shared helper to generate sequential prefixed tracking IDs (`RTV-` / `BUF-`)
   */
  _generatePrefixedRefId(prefix, existingItems = [], extractors = [], isTestMode = false) {
    const currentYear = new Date().getFullYear();
    const seqRegex = new RegExp(`^${prefix}-(?:TEST-)?\\d{4}-(\\d+)-`, 'i');
    let maxSeq = 0;

    if (Array.isArray(existingItems)) {
      existingItems.forEach((item) => {
        extractors.forEach((getVal) => {
          const num = getVal(item) || '';
          const match = String(num).match(seqRegex);
          if (match && match[1]) {
            const parsed = parseInt(match[1], 10);
            if (!isNaN(parsed) && parsed > maxSeq) {
              maxSeq = parsed;
            }
          }
        });
      });
    }

    const nextSeq = String(maxSeq + 1).padStart(4, '0');
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let rand = '';
    for (let i = 0; i < 4; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return `${prefix}-${isTestMode ? 'TEST-' : ''}${currentYear}-${nextSeq}-${rand}`;
  },

  /**
   * GENERATE UNIQUE RTV ID
   * Format: RTV-YYYY-XXXX-RAND (e.g. RTV-2026-0001-HY67)
   */
  generateRtvId(existingClaims = [], isTestMode = false) {
    return this._generatePrefixedRefId(
      'RTV',
      existingClaims,
      [(c) => c?.claim_number || c?.claimNumber],
      isTestMode
    );
  },

  /**
   * GENERATE UNIQUE CUSTOMER BUFFER REPLACEMENT ID
   * Format: BUF-YYYY-XXXX-RAND (or BUF-TEST-YYYY-XXXX-RAND in Test Mode)
   */
  generateBufferId(existingReports = [], isTestMode = false) {
    return this._generatePrefixedRefId(
      'BUF',
      existingReports,
      [
        (r) => r?.ai_document_metadata?.supplier_pickup?.claim_number,
        (r) => r?.claim_number || r?.claimNumber
      ],
      isTestMode
    );
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
          .maybeSingle();

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
    totalClaimAmount = 0,
    notes = '',
    isTest = null,
    preserveReportFields = false
  }) {
    const effectiveIsTest = Boolean(
      isTest === true ||
      /^RTV-TEST-/i.test(String(claimNumber || '')) ||
      String(notes || '').includes('[TEST_MODE]') ||
      (Array.isArray(items) && items.some(it => isTestRecord(it)))
    );
    const trimmedNotes = String(notes || '').trim();
    const finalClaimNotes = effectiveIsTest && !trimmedNotes.includes('[TEST_MODE]')
      ? (trimmedNotes ? `[TEST_MODE] ${trimmedNotes}` : '[TEST_MODE] Sandbox RTV Claim')
      : trimmedNotes;
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
      notes: finalClaimNotes,
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
            notes: claimRecord.notes || '',
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
          const hasExistingAudit = currentAudit.some(
            (a) => a?.action === 'RTV_CLAIM_GENERATED' && a?.rtv_number === cleanClaimNumber
          );
          const updatedAudit = hasExistingAudit
            ? currentAudit
            : [
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

          const reportUpdate = {
            audit_trail: updatedAudit,
            notes: updatedNotes
          };
          if (!preserveReportFields) {
            reportUpdate.status = 'vendor_claimed';
            reportUpdate.disposition = 'Return to Vendor (RTV)';
          }

          await supabase
            .from('rma_reports')
            .update(reportUpdate)
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
