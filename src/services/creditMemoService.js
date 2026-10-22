import { supabase } from '../supabaseClient';

const CREDIT_MEMOS_STORAGE_KEY = 'rma_portal_credit_memos_v2';

/**
 * Service for managing Finance Credit Memos
 * Persists directly to the dedicated 'credit_memos' table in Supabase
 * with seamless fallback to 'rma_reports' notes and localStorage
 */
export const creditMemoService = {
  /**
   * Generate sequential Credit Memo Number
   * Format: CM-YYYY-XXXX-RAND (e.g. CM-2026-0001-H7D2)
   */
  generateCreditMemoNumber(existingCount = 0) {
    const currentYear = new Date().getFullYear();
    let count = existingCount;
    if (!count) {
      try {
        const raw = localStorage.getItem(CREDIT_MEMOS_STORAGE_KEY);
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) count = list.length;
        }
      } catch (e) {}
    }
    const seq = String(count + 1).padStart(4, '0');
    const chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let rand = '';
    for (let i = 0; i < 4; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `CM-${currentYear}-${seq}-${rand}`;
  },

  /**
   * Generate sequential Pull Out Reference (POR)
   * Format: POR-YYYY-XXXX-RAND (e.g. POR-2026-0001-1A4D)
   * Format: POR _ + Current Year + increasing serial number + random unique alphanumeric
   */
  generatePullOutReference(existingCount = 0) {
    const currentYear = new Date().getFullYear();
    let count = existingCount;
    if (!count) {
      try {
        const raw = localStorage.getItem(CREDIT_MEMOS_STORAGE_KEY);
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) count = list.length;
        }
      } catch (e) {}
    }
    const seq = String(count + 1).padStart(4, '0');
    const chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let rand = '';
    for (let i = 0; i < 4; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `POR-${currentYear}-${seq}-${rand}`;
  },

  /**
   * Get all Credit Memos from dedicated Supabase 'credit_memos' table,
   * legacy 'rma_reports' notes, and local storage
   */
  async getCreditMemos() {
    const memosMap = new Map();

    // 1. Primary Source: Dedicated Supabase 'credit_memos' table
    try {
      const { data: dbMemos, error } = await supabase
        .from('credit_memos')
        .select('*')
        .order('credit_issued_at', { ascending: false });

      if (!error && Array.isArray(dbMemos)) {
        for (const m of dbMemos) {
          if (m.credit_memo_number) {
            memosMap.set(m.credit_memo_number, {
              ...m,
              is_synced_to_db: true
            });
          }
        }
      } else if (error) {
        console.warn('Supabase credit_memos table read note:', error.message || error);
      }
    } catch (e) {
      console.warn('credit_memos fetch catch:', e);
    }

    // 2. Legacy / Secondary fallback: Supabase rma_reports (checking notes for credit memo payload)
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
              if (memoData && memoData.credit_memo_number && !memosMap.has(memoData.credit_memo_number)) {
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
      console.warn('Supabase rma_reports memos fallback notice:', e);
    }

    // 3. Merge with local cache for offline/unsynced entries
    try {
      const raw = localStorage.getItem(CREDIT_MEMOS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach(m => {
            if (m.credit_memo_number && !memosMap.has(m.credit_memo_number)) {
              memosMap.set(m.credit_memo_number, m);
            }
          });
        }
      }
    } catch (e) {}

    const list = Array.from(memosMap.values());
    list.sort((a, b) => new Date(b.credit_issued_at || b.created_at || 0) - new Date(a.credit_issued_at || a.created_at || 0));

    // Update local cache with latest merged list
    try {
      localStorage.setItem(CREDIT_MEMOS_STORAGE_KEY, JSON.stringify(list));
    } catch (e) {}

    return list;
  },

  /**
   * Save a newly issued Credit Memo to Supabase 'credit_memos' table
   */
  async createCreditMemo(memoData) {
    const existing = await this.getCreditMemos();
    const cmNumber = memoData.credit_memo_number || this.generateCreditMemoNumber(existing.length);

    const unitPrice = Number((Number(memoData.unit_price) || 0).toFixed(2));
    const qty = Number(memoData.quantity) || 1;
    const grossAmount = Number((Number(memoData.amount) || (qty * unitPrice)).toFixed(2));
    const creditAmount = Number((Number(memoData.credit_amount) || grossAmount).toFixed(2));
    const pullOutRef = memoData.pull_out_ref ? memoData.pull_out_ref.trim() : this.generatePullOutReference(existing.length);
    const pullOutDate = memoData.pull_out_date || new Date().toISOString().split('T')[0];

    const newMemo = {
      credit_memo_number: cmNumber,
      rma_number: memoData.rma_number,
      report_id: memoData.report_id ? Number(memoData.report_id) : null,
      barcode: memoData.barcode || 'N/A',
      product_name: memoData.product_name || memoData.name || 'Item',
      sku: memoData.sku || memoData.code || null,
      supplier_name: memoData.supplier_name || memoData.supplierName || 'Savemore',
      company: 'Wholesale Distribution',
      customer_ae_name: memoData.customer_ae_name || memoData.ae_name || 'N/A',
      customer_ae_email: memoData.customer_ae_email || memoData.ae_email || '',
      quantity: qty,
      unit_name: memoData.unit_name || memoData.unit || 'pc',
      unit_price: unitPrice,
      amount: grossAmount,
      pull_out_ref: pullOutRef,
      pull_out_date: pullOutDate,
      credit_issued_by: memoData.credit_issued_by || 'Analiza B. Benoza (Finance Head)',
      credit_issued_by_email: memoData.credit_issued_by_email || 'finance@a2z2go.net',
      credit_issued_at: new Date().toISOString(),
      notes: memoData.notes ? memoData.notes.trim() : '',
      status: 'issued'
    };

    let dbSuccess = false;

    // 1. Primary: Save to dedicated 'credit_memos' table in Supabase
    try {
      const { data, error } = await supabase
        .from('credit_memos')
        .upsert([newMemo], { onConflict: 'credit_memo_number' })
        .select();

      if (!error && data && data.length > 0) {
        dbSuccess = true;
        console.log(`[Supabase DB] Credit memo ${cmNumber} inserted into credit_memos table.`);
        if (data[0].id) {
          newMemo.id = data[0].id;
        }
      } else if (error) {
        console.warn(`[Supabase DB] credit_memos table insert notice:`, error.message || error);
      }
    } catch (e) {
      console.warn('credit_memos insert catch:', e);
    }

    // 2. Also update rma_reports status to 'credit_memo_issued' and store backup in notes
    if (memoData.rma_number) {
      try {
        const { error: rmaErr } = await supabase
          .from('rma_reports')
          .update({
            notes: JSON.stringify(newMemo),
            status: 'credit_memo_issued'
          })
          .eq('rma_number', memoData.rma_number);

        if (!rmaErr && !dbSuccess) {
          // If credit_memos table didn't succeed but rma_reports updated, still mark dbSuccess
          dbSuccess = true;
        }
      } catch (e) {
        console.warn('rma_reports status sync notice:', e);
      }
    }

    newMemo.is_synced_to_db = dbSuccess;

    // 3. Save to local storage
    const updatedList = [newMemo, ...existing.filter(m => m.credit_memo_number !== cmNumber)];
    try {
      localStorage.setItem(CREDIT_MEMOS_STORAGE_KEY, JSON.stringify(updatedList));
    } catch (e) {}

    return { success: true, memo: newMemo, dbSaved: dbSuccess };
  },

  /**
   * Update an existing Credit Memo in Supabase 'credit_memos' table
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

    // 1. Update in dedicated 'credit_memos' table
    try {
      const { error } = await supabase
        .from('credit_memos')
        .update({
          quantity: qty,
          unit_price: unitPrice,
          amount: amount,
          pull_out_ref: updated.pull_out_ref,
          pull_out_date: updated.pull_out_date,
          credit_amount: creditAmount,
          notes: updated.notes || '',
          updated_at: new Date().toISOString()
        })
        .eq('credit_memo_number', cmNumber);

      if (error) {
        console.warn('credit_memos table update notice:', error.message || error);
      } else {
        console.log(`[Supabase DB] Credit memo ${cmNumber} updated in credit_memos table.`);
      }
    } catch (e) {
      console.warn('credit_memos update catch:', e);
    }

    // 2. Update rma_reports notes backup
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
      } catch (e) {}
    }

    // 3. Update localStorage
    existing[index] = updated;
    try {
      localStorage.setItem(CREDIT_MEMOS_STORAGE_KEY, JSON.stringify(existing));
    } catch (e) {}

    return { success: true, memo: updated };
  },

  /**
   * Delete / Void a Credit Memo
   */
  async deleteCreditMemo(cmNumber, reportId) {
    const existing = await this.getCreditMemos();
    const target = existing.find(m => m.credit_memo_number === cmNumber);
    const filtered = existing.filter(m => m.credit_memo_number !== cmNumber);

    try {
      localStorage.setItem(CREDIT_MEMOS_STORAGE_KEY, JSON.stringify(filtered));
    } catch (e) {}

    // 1. Delete from dedicated 'credit_memos' table
    try {
      const { error } = await supabase
        .from('credit_memos')
        .delete()
        .eq('credit_memo_number', cmNumber);

      if (error) {
        console.warn('credit_memos table delete notice:', error.message || error);
      } else {
        console.log(`[Supabase DB] Credit memo ${cmNumber} deleted from credit_memos table.`);
      }
    } catch (e) {
      console.warn('credit_memos delete catch:', e);
    }

    // 2. Reset rma_reports status and clear notes
    const rma = target?.rma_number;
    if (rma) {
      try {
        await supabase
          .from('rma_reports')
          .update({
            notes: null,
            status: 'pending'
          })
          .eq('rma_number', rma);
      } catch (e) {}
    } else if (reportId) {
      try {
        await supabase
          .from('rma_reports')
          .update({
            notes: null,
            status: 'pending'
          })
          .eq('id', reportId);
      } catch (e) {}
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

    // 1. Bulk delete from 'credit_memos' table
    try {
      const { error } = await supabase
        .from('credit_memos')
        .delete()
        .in('credit_memo_number', memoNumbers);

      if (error) {
        console.warn('credit_memos bulk delete notice:', error.message || error);
      } else {
        console.log(`[Supabase DB] Bulk deleted ${memoNumbers.length} rows from credit_memos table.`);
      }
    } catch (e) {
      console.warn('credit_memos bulk delete catch:', e);
    }

    // 2. Reset affected rma_reports
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
      } catch (e) {}
    }

    return { success: true, deletedCount: targets.length };
  }
};


