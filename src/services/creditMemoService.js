import { supabase } from '../supabaseClient';

const CREDIT_MEMOS_STORAGE_KEY = 'rma_portal_credit_memos_v2';

/**
 * Service for managing Finance Credit Memos
 * Linked directly to RMA Return Reports and stored in Supabase database
 */
export const creditMemoService = {
  /**
   * Generate sequential Credit Memo Number
   * Format: CM-YYYY-XXXX-RAND (e.g. CM-2026-0001-H7D2)
   */
  generateCreditMemoNumber(existingCount = 0) {
    const currentYear = new Date().getFullYear();
    const seq = String(existingCount + 1).padStart(4, '0');
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let rand = '';
    for (let i = 0; i < 4; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `CM-${currentYear}-${seq}-${rand}`;
  },

  /**
   * Get all Credit Memos from local cache and Supabase rma_reports
   */
  async getCreditMemos() {
    const memosMap = new Map();

    // 1. Load from local cache
    try {
      const raw = localStorage.getItem(CREDIT_MEMOS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach(m => {
            if (m.credit_memo_number) {
              memosMap.set(m.credit_memo_number, m);
            }
          });
        }
      }
    } catch (e) {
      console.warn('Local credit memos read notice:', e);
    }

    // 2. Load from Supabase rma_reports (checking notes for credit memo payload)
    try {
      const { data: reports, error } = await supabase
        .from('rma_reports')
        .select('*')
        .not('status', 'eq', 'deleted')
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(reports)) {
        for (const r of reports) {
          if (r.notes && typeof r.notes === 'string' && r.notes.includes('credit_memo_number')) {
            try {
              const memoData = JSON.parse(r.notes);
              if (memoData && memoData.credit_memo_number) {
                const combined = {
                  ...memoData,
                  report_id: r.id,
                  rma_number: r.rma_number || memoData.rma_number,
                  barcode: r.barcode || memoData.barcode,
                  product_name: r.name || memoData.product_name,
                  sku: r.code || memoData.sku,
                  supplier_name: r.supplier_name || memoData.supplier_name,
                  company: 'Wholesale Distribution',
                  customer_ae_name: r.ae_name || memoData.customer_ae_name,
                  customer_ae_email: r.ae_email || memoData.customer_ae_email,
                  is_synced_to_db: true
                };
                memosMap.set(memoData.credit_memo_number, combined);
              }
            } catch (err) {}
          }
        }
      }
    } catch (e) {
      console.warn('Supabase credit memos fetch notice:', e);
    }

    const list = Array.from(memosMap.values());
    list.sort((a, b) => new Date(b.credit_issued_at || 0) - new Date(a.credit_issued_at || 0));
    return list;
  },

  /**
   * Save a newly issued Credit Memo to Supabase database
   */
  async createCreditMemo(memoData) {
    const existing = await this.getCreditMemos();
    const cmNumber = memoData.credit_memo_number || this.generateCreditMemoNumber(existing.length);

    const unitPrice = Number((Number(memoData.unit_price) || 0).toFixed(2));
    const qty = Number(memoData.quantity) || 1;
    const grossAmount = Number((Number(memoData.amount) || (qty * unitPrice)).toFixed(2));
    const creditAmount = Number((Number(memoData.credit_amount) || grossAmount).toFixed(2));

    const newMemo = {
      id: `cm-${Date.now()}`,
      credit_memo_number: cmNumber,
      rma_number: memoData.rma_number,
      report_id: memoData.report_id || null,
      barcode: memoData.barcode,
      product_name: memoData.product_name || memoData.name,
      sku: memoData.sku || memoData.code || null,
      supplier_name: memoData.supplier_name || memoData.supplierName || 'Savemore',
      company: 'Wholesale Distribution',
      customer_ae_name: memoData.customer_ae_name || memoData.ae_name || 'N/A',
      customer_ae_email: memoData.customer_ae_email || memoData.ae_email || '',
      quantity: qty,
      unit_name: memoData.unit_name || memoData.unit || 'pc',
      unit_price: unitPrice,
      amount: grossAmount,
      pull_out_ref: memoData.pull_out_ref ? memoData.pull_out_ref.trim() : 'Warehouse Pull-Out',
      pull_out_date: memoData.pull_out_date || new Date().toISOString().split('T')[0],
      credit_amount: creditAmount,
      credit_issued_by: memoData.credit_issued_by || 'Finance Officer',
      credit_issued_by_email: memoData.credit_issued_by_email || '',
      credit_issued_at: new Date().toISOString(),
      notes: memoData.notes ? memoData.notes.trim() : '',
      status: 'issued',
      is_synced_to_db: true
    };

    // 1. Save to local storage
    const updatedList = [newMemo, ...existing.filter(m => m.credit_memo_number !== cmNumber)];
    try {
      localStorage.setItem(CREDIT_MEMOS_STORAGE_KEY, JSON.stringify(updatedList));
    } catch (e) {}

    // 2. Persist to Supabase rma_reports
    let dbSuccess = false;
    if (memoData.rma_number) {
      try {
        const { data, error } = await supabase
          .from('rma_reports')
          .update({
            notes: JSON.stringify(newMemo),
            status: 'credit_memo_issued'
          })
          .eq('rma_number', memoData.rma_number)
          .select();

        if (!error && data && data.length > 0) {
          dbSuccess = true;
          console.log(`[Supabase DB] Credit memo ${cmNumber} successfully saved to rma_reports for RMA ${memoData.rma_number}`);
        } else if (memoData.report_id) {
          // Fallback by numeric id
          const { data: idData, error: idErr } = await supabase
            .from('rma_reports')
            .update({
              notes: JSON.stringify(newMemo),
              status: 'credit_memo_issued'
            })
            .eq('id', memoData.report_id)
            .select();

          if (!idErr && idData && idData.length > 0) {
            dbSuccess = true;
          }
        }
      } catch (e) {
        console.warn('Supabase DB save error:', e);
      }
    }

    newMemo.is_synced_to_db = dbSuccess;
    return { success: true, memo: newMemo, dbSaved: dbSuccess };
  },

  /**
   * Update an existing Credit Memo in Supabase database
   */
  async updateCreditMemo(cmNumber, updates) {
    const existing = await this.getCreditMemos();
    const index = existing.findIndex(m => m.credit_memo_number === cmNumber);
    if (index === -1) throw new Error(`Credit Memo ${cmNumber} not found.`);

    const unitPrice = updates.unit_price !== undefined ? Number(Number(updates.unit_price).toFixed(2)) : existing[index].unit_price;
    const qty = updates.quantity !== undefined ? Number(updates.quantity) : existing[index].quantity;
    const amount = updates.amount !== undefined ? Number(Number(updates.amount).toFixed(2)) : Number((qty * unitPrice).toFixed(2));
    const creditAmount = updates.credit_amount !== undefined ? Number(Number(updates.credit_amount).toFixed(2)) : existing[index].credit_amount;

    const updated = {
      ...existing[index],
      ...updates,
      unit_price: unitPrice,
      quantity: qty,
      amount: amount,
      credit_amount: creditAmount,
      company: 'Wholesale Distribution',
      updated_at: new Date().toISOString(),
      is_synced_to_db: true
    };
    existing[index] = updated;

    try {
      localStorage.setItem(CREDIT_MEMOS_STORAGE_KEY, JSON.stringify(existing));
    } catch (e) {}

    // Update Supabase rma_reports
    const rma = updated.rma_number;
    if (rma) {
      try {
        await supabase
          .from('rma_reports')
          .update({
            notes: JSON.stringify(updated),
            status: 'credit_memo_issued'
          })
          .eq('rma_number', rma);
        console.log(`[Supabase DB] Credit memo ${cmNumber} updated in rma_reports for RMA ${rma}`);
      } catch (e) {
        console.warn('Supabase update notice:', e);
      }
    }

    return { success: true, memo: updated };
  },

  /**
   * Delete / Void a Credit Memo
   */
  async deleteCreditMemo(cmNumber) {
    const existing = await this.getCreditMemos();
    const target = existing.find(m => m.credit_memo_number === cmNumber);
    const filtered = existing.filter(m => m.credit_memo_number !== cmNumber);

    try {
      localStorage.setItem(CREDIT_MEMOS_STORAGE_KEY, JSON.stringify(filtered));
    } catch (e) {}

    // Reset notes and status in Supabase
    if (target?.rma_number) {
      try {
        await supabase
          .from('rma_reports')
          .update({
            notes: null,
            status: 'pending'
          })
          .eq('rma_number', target.rma_number);
        console.log(`[Supabase DB] Credit memo ${cmNumber} voided and reset in Supabase for RMA ${target.rma_number}`);
      } catch (e) {
        console.warn('Supabase delete notice:', e);
      }
    }

    return { success: true };
  },

  /**
   * Bulk Delete / Void multiple Credit Memos
   */
  async deleteMultipleCreditMemos(memoNumbers = []) {
    if (!memoNumbers || memoNumbers.length === 0) return { success: true };
    const numSet = new Set(memoNumbers);

    const existing = await this.getCreditMemos();
    const targets = existing.filter(m => numSet.has(m.credit_memo_number));
    const filtered = existing.filter(m => !numSet.has(m.credit_memo_number));

    try {
      localStorage.setItem(CREDIT_MEMOS_STORAGE_KEY, JSON.stringify(filtered));
    } catch (e) {}

    // Reset all target reports in Supabase
    const targetRmas = targets.map(t => t.rma_number).filter(Boolean);
    if (targetRmas.length > 0) {
      try {
        await supabase
          .from('rma_reports')
          .update({
            notes: null,
            status: 'pending'
          })
          .in('rma_number', targetRmas);
        console.log(`[Supabase DB] Bulk voided ${targetRmas.length} credit memos in Supabase`);
      } catch (e) {
        console.warn('Supabase bulk delete notice:', e);
      }
    }

    return { success: true, deletedCount: targets.length };
  }
};

