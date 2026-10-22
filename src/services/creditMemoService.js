import { supabase } from '../supabaseClient';

const CREDIT_MEMOS_STORAGE_KEY = 'rma_portal_credit_memos_v2';

/**
 * Service for managing Finance Credit Memos
 * Linked directly to RMA Return Reports
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
                  company: r.company || memoData.company,
                  customer_ae_name: r.ae_name || memoData.customer_ae_name,
                  customer_ae_email: r.ae_email || memoData.customer_ae_email
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
   * Save a newly issued Credit Memo
   */
  async createCreditMemo(memoData) {
    const existing = await this.getCreditMemos();
    const cmNumber = memoData.credit_memo_number || this.generateCreditMemoNumber(existing.length);

    const newMemo = {
      id: `cm-${Date.now()}`,
      credit_memo_number: cmNumber,
      rma_number: memoData.rma_number,
      report_id: memoData.report_id || null,
      barcode: memoData.barcode,
      product_name: memoData.product_name || memoData.name,
      sku: memoData.sku || memoData.code || null,
      supplier_name: memoData.supplier_name || memoData.supplierName || 'Savemore',
      company: memoData.company || 'Pingcon / Bonita',
      customer_ae_name: memoData.customer_ae_name || memoData.ae_name || 'N/A',
      customer_ae_email: memoData.customer_ae_email || memoData.ae_email || '',
      quantity: Number(memoData.quantity) || 1,
      unit_name: memoData.unit_name || memoData.unit || 'pc',
      unit_price: Number(memoData.unit_price) || 0,
      amount: Number(memoData.amount) || (Number(memoData.quantity || 1) * Number(memoData.unit_price || 0)),
      pull_out_ref: memoData.pull_out_ref ? memoData.pull_out_ref.trim() : 'Warehouse Pull-Out',
      pull_out_date: memoData.pull_out_date || new Date().toISOString().split('T')[0],
      credit_amount: Number(memoData.credit_amount) || Number(memoData.amount) || 0,
      credit_issued_by: memoData.credit_issued_by || 'Finance Officer',
      credit_issued_by_email: memoData.credit_issued_by_email || '',
      credit_issued_at: new Date().toISOString(),
      notes: memoData.notes ? memoData.notes.trim() : '',
      status: 'issued'
    };

    // 1. Save to local storage
    const updatedList = [newMemo, ...existing.filter(m => m.credit_memo_number !== cmNumber)];
    try {
      localStorage.setItem(CREDIT_MEMOS_STORAGE_KEY, JSON.stringify(updatedList));
    } catch (e) {}

    // 2. Update Supabase rma_reports with credit memo details in notes
    if (memoData.report_id || memoData.rma_number) {
      try {
        let query = supabase.from('rma_reports').update({
          notes: JSON.stringify(newMemo),
          status: 'credit_memo_issued'
        });
        if (memoData.report_id) {
          query = query.eq('id', memoData.report_id);
        } else {
          query = query.eq('rma_number', memoData.rma_number);
        }
        await query;
      } catch (e) {
        console.warn('Failed to update report with credit memo in Supabase:', e);
      }
    }

    return { success: true, memo: newMemo };
  },

  /**
   * Update an existing Credit Memo
   */
  async updateCreditMemo(cmNumber, updates) {
    const existing = await this.getCreditMemos();
    const index = existing.findIndex(m => m.credit_memo_number === cmNumber);
    if (index === -1) throw new Error(`Credit Memo ${cmNumber} not found.`);

    const updated = {
      ...existing[index],
      ...updates,
      updated_at: new Date().toISOString()
    };
    existing[index] = updated;

    try {
      localStorage.setItem(CREDIT_MEMOS_STORAGE_KEY, JSON.stringify(existing));
    } catch (e) {}

    // Update Supabase if linked to a report
    if (updated.report_id || updated.rma_number) {
      try {
        let query = supabase.from('rma_reports').update({
          notes: JSON.stringify(updated)
        });
        if (updated.report_id) query = query.eq('id', updated.report_id);
        else query = query.eq('rma_number', updated.rma_number);
        await query;
      } catch (e) {}
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

    // If report was linked, reset its notes and status
    if (target?.report_id || target?.rma_number) {
      try {
        let query = supabase.from('rma_reports').update({
          notes: null,
          status: 'pending'
        });
        if (target.report_id) query = query.eq('id', target.report_id);
        else query = query.eq('rma_number', target.rma_number);
        await query;
      } catch (e) {}
    }

    return { success: true };
  }
};
