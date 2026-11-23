import { supabase } from '../supabaseClient';
import { authService } from './authService';
import {
  isTestRecord,
  stripCreditMemoMetaTag,
  parseCreditMemoMeta,
  getCreditMemoConsolidatedItems,
  getCreditMemoRmaNumbers
} from '../utils/rmaHelpers';

const CREDIT_MEMOS_STORAGE_KEY = 'rma_portal_credit_memos_v2';
const CONSOLIDATED_CM_SETTINGS_KEY = 'consolidated_cm_items_store';
const CONSOLIDATED_CM_LOCAL_KEY = 'rma_consolidated_cm_items_v1';

function buildPackedCmNotes(humanNotes, isTest, consolidatedItems = [], rmaNumbers = [], reportIds = []) {
  let base = stripCreditMemoMetaTag(humanNotes || '');
  if (isTest && !base.includes('[TEST_MODE]')) {
    base = base ? `[TEST_MODE] ${base}` : '[TEST_MODE] Sandbox Credit Memo';
  }
  if (Array.isArray(consolidatedItems) && consolidatedItems.length > 1) {
    const payload = JSON.stringify({
      consolidated_items: consolidatedItems,
      rma_numbers: rmaNumbers,
      report_ids: reportIds
    });
    if (payload.length <= 12000) {
      return `${base ? `${base}\n` : ''}[CM_META:${payload}]`;
    }
  }
  return base;
}

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
  generateCreditMemoNumber(existingCount = 0, isTestMode = false) {
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
    return `CM-${isTestMode ? 'TEST-' : ''}${currentYear}-${seq}-${rand}`;
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

  async getConsolidatedItemsStore() {
    let localMap = {};
    try {
      const raw = localStorage.getItem(CONSOLIDATED_CM_LOCAL_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') localMap = parsed;
      }
    } catch {}

    try {
      const { data, error } = await supabase
        .from('rma_settings')
        .select('value')
        .eq('key', CONSOLIDATED_CM_SETTINGS_KEY)
        .maybeSingle();
      if (!error && data?.value && typeof data.value === 'object') {
        const merged = { ...localMap, ...data.value };
        try {
          localStorage.setItem(CONSOLIDATED_CM_LOCAL_KEY, JSON.stringify(merged));
        } catch {}
        return merged;
      }
    } catch {}

    return localMap;
  },

  async saveConsolidatedItemsEntry(cmNumber, entryOrNull) {
    if (!cmNumber) return;
    try {
      const current = await this.getConsolidatedItemsStore();
      const next = { ...current };
      if (entryOrNull === null) {
        delete next[cmNumber];
      } else {
        next[cmNumber] = entryOrNull;
      }
      try {
        localStorage.setItem(CONSOLIDATED_CM_LOCAL_KEY, JSON.stringify(next));
      } catch {}
      await supabase
        .from('rma_settings')
        .upsert({
          key: CONSOLIDATED_CM_SETTINGS_KEY,
          value: next,
          updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
    } catch (e) {
      console.warn('Could not sync consolidated_cm_items_store to rma_settings:', e?.message || e);
    }
  },

  /**
   * Get all Credit Memos from dedicated Supabase 'credit_memos' table,
   * legacy 'rma_reports' notes, and local storage
   */
  async getCreditMemos() {
    const memosMap = new Map();
    const consolidatedStore = await this.getConsolidatedItemsStore();

    // 1. Primary Source: Dedicated Supabase 'credit_memos' table
    try {
      const { data: dbMemos, error } = await supabase
        .from('credit_memos')
        .select('*')
        .order('credit_issued_at', { ascending: false });

      if (!error && Array.isArray(dbMemos)) {
        for (const m of dbMemos) {
          if (m.credit_memo_number) {
            const creditAmt = Number(m.credit_amount ?? m.amount ?? 0);
            const grossAmt = Number(m.amount ?? m.credit_amount ?? 0);
            memosMap.set(m.credit_memo_number, {
              ...m,
              credit_amount: creditAmt,
              amount: grossAmt || creditAmt,
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
        .like('notes', '%credit_memo_number%')
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(reports)) {
        for (const r of reports) {
          if (r.notes && typeof r.notes === 'string' && r.notes.includes('credit_memo_number')) {
            try {
              const memoData = JSON.parse(r.notes);
              if (memoData && memoData.credit_memo_number && !memosMap.has(memoData.credit_memo_number)) {
                const creditAmt = Number(memoData.credit_amount ?? memoData.amount ?? 0);
                const grossAmt = Number(memoData.amount ?? memoData.credit_amount ?? 0);
                const combined = {
                  ...memoData,
                  credit_amount: creditAmt,
                  amount: grossAmt || creditAmt,
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

    const list = Array.from(memosMap.values()).map((m) => {
      const storeEntry = consolidatedStore?.[m.credit_memo_number];
      const meta = parseCreditMemoMeta(m.notes);
      const items = (Array.isArray(storeEntry?.consolidated_items) && storeEntry.consolidated_items.length > 0)
        ? storeEntry.consolidated_items
        : getCreditMemoConsolidatedItems(m);
      const rmaNums = (Array.isArray(storeEntry?.rma_numbers) && storeEntry.rma_numbers.length > 0)
        ? storeEntry.rma_numbers
        : getCreditMemoRmaNumbers(m);
      const reportIds = Array.isArray(storeEntry?.report_ids)
        ? storeEntry.report_ids
        : (Array.isArray(meta?.report_ids) ? meta.report_ids : (m.report_id ? [m.report_id] : []));
      return {
        ...m,
        clean_notes: stripCreditMemoMetaTag(m.notes),
        consolidated_items: items,
        consolidated_rma_numbers: rmaNums,
        consolidated_report_ids: reportIds
      };
    });
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
    const consolidatedItems = Array.isArray(memoData.consolidated_items)
      ? memoData.consolidated_items
      : [];
    const rmaNumbersList = Array.from(new Set([
      ...(Array.isArray(memoData.consolidated_rma_numbers) ? memoData.consolidated_rma_numbers : []),
      ...consolidatedItems.map((it) => it?.rma_number),
      ...String(memoData.rma_number || '').split(',').map((s) => s.trim())
    ].map((s) => String(s || '').trim()).filter(Boolean)));
    const reportIdsList = Array.from(new Set([
      ...(Array.isArray(memoData.consolidated_report_ids) ? memoData.consolidated_report_ids : []),
      ...consolidatedItems.map((it) => it?.report_id),
      memoData.report_id
    ].filter((id) => id !== null && id !== undefined && /^\d+$/.test(String(id))).map((id) => Number(id))));

    const isTest = Boolean(
      memoData.is_test ||
      memoData.test_mode ||
      /^CM-TEST-/i.test(String(memoData.credit_memo_number || '')) ||
      rmaNumbersList.some((n) => /^RMA-TEST-/i.test(n)) ||
      String(memoData.notes || '').includes('[TEST_MODE]')
    );
    const modeExisting = existing.filter((m) => isTestRecord(m) === isTest);
    const cmNumber = memoData.credit_memo_number || this.generateCreditMemoNumber(modeExisting.length, isTest);

    const isConsolidated = consolidatedItems.length > 1 || rmaNumbersList.length > 1;
    const joinedRmas = rmaNumbersList.join(', ');
    const displayRmaField = isConsolidated
      ? (joinedRmas.length <= 120 ? joinedRmas : `${rmaNumbersList[0]} (+${rmaNumbersList.length - 1} RMAs)`)
      : (rmaNumbersList[0] || memoData.rma_number || '');

    const cleanHumanNotes = stripCreditMemoMetaTag(memoData.notes || '');
    const packedNotes = buildPackedCmNotes(cleanHumanNotes, isTest, consolidatedItems, rmaNumbersList, reportIdsList);

    const unitPrice = Number((Number(memoData.unit_price) || 0).toFixed(2));
    const qty = Number(memoData.quantity) || 1;
    const grossAmount = Number((Number(memoData.amount) || (qty * unitPrice)).toFixed(2));
    const creditAmount = Number((Number(memoData.credit_amount) || grossAmount).toFixed(2));
    const pullOutRef = memoData.pull_out_ref ? memoData.pull_out_ref.trim() : this.generatePullOutReference(existing.length);
    const pullOutDate = memoData.pull_out_date || new Date().toISOString().split('T')[0];

    // STRICTLY ONLY valid columns on public.credit_memos (no root 'items' column)
    const dbMemoRow = {
      credit_memo_number: cmNumber,
      rma_number: displayRmaField,
      report_id: reportIdsList[0] ?? (memoData.report_id ? Number(memoData.report_id) : null),
      barcode: memoData.barcode || (isConsolidated ? 'CONSOLIDATED' : 'N/A'),
      product_name: isConsolidated
        ? (memoData.product_name || `Consolidated Credit Memo (${rmaNumbersList.length} RMAs)`)
        : (memoData.product_name || memoData.name || 'Item'),
      sku: memoData.sku || memoData.code || null,
      supplier_name: memoData.supplier_name || memoData.supplierName || 'Savemore',
      company: 'Wholesale Distribution',
      customer_ae_name: memoData.customer_ae_name || memoData.ae_name || 'N/A',
      customer_ae_email: memoData.customer_ae_email || memoData.ae_email || '',
      quantity: qty,
      unit_name: memoData.unit_name || memoData.unit || 'pc',
      unit_price: unitPrice,
      amount: grossAmount,
      credit_amount: creditAmount,
      pull_out_ref: pullOutRef,
      pull_out_date: pullOutDate,
      credit_issued_by: memoData.credit_issued_by || 'Analiza B. Benoza',
      credit_issued_by_email: memoData.credit_issued_by_email || 'analiza@savemore.com',
      credit_issued_at: new Date().toISOString(),
      notes: packedNotes,
      status: 'issued'
    };

    const newMemo = {
      ...dbMemoRow,
      clean_notes: cleanHumanNotes,
      consolidated_items: consolidatedItems,
      consolidated_rma_numbers: rmaNumbersList,
      consolidated_report_ids: reportIdsList,
      is_test: isTest
    };

    let dbSuccess = false;

    // 1. Primary: Save to dedicated 'credit_memos' table in Supabase (strict schema columns only)
    try {
      const { data, error } = await supabase
        .from('credit_memos')
        .upsert([dbMemoRow], { onConflict: 'credit_memo_number' })
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

    // 2. Persist full consolidated item breakdown safely in rma_settings ('consolidated_cm_items_store')
    if (isConsolidated) {
      await this.saveConsolidatedItemsEntry(cmNumber, {
        consolidated_items: consolidatedItems,
        rma_numbers: rmaNumbersList,
        report_ids: reportIdsList,
        updated_at: new Date().toISOString()
      });
    }

    // 3. Also update ALL linked rma_reports rows to 'credit_memo_issued' and store compact backup in notes
    if (rmaNumbersList.length > 0 || reportIdsList.length > 0) {
      try {
        const rmaReportBackup = JSON.stringify({
          credit_memo_number: cmNumber,
          pull_out_ref: pullOutRef,
          pull_out_date: pullOutDate,
          credit_amount: creditAmount,
          amount: grossAmount,
          credit_issued_by: dbMemoRow.credit_issued_by,
          credit_issued_at: dbMemoRow.credit_issued_at,
          consolidated_rma_numbers: rmaNumbersList,
          ...(isTest ? { is_test: true } : {})
        });
        if (rmaNumbersList.length > 0) {
          const { error: rmaErr } = await supabase
            .from('rma_reports')
            .update({
              notes: rmaReportBackup,
              status: 'credit_memo_issued'
            })
            .in('rma_number', rmaNumbersList);
          if (!rmaErr && !dbSuccess) dbSuccess = true;
        }
        if (reportIdsList.length > 0) {
          await supabase
            .from('rma_reports')
            .update({
              notes: rmaReportBackup,
              status: 'credit_memo_issued'
            })
            .in('id', reportIdsList);
        }
      } catch (e) {
        console.warn('rma_reports status sync notice:', e);
      }
    }

    newMemo.is_synced_to_db = dbSuccess;

    // 4. Save to local storage
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
    const currentMemo = existing[index];
    const isTestMemo = isTestRecord(currentMemo) || /^CM-TEST-/i.test(String(cmNumber || '')) || isTestRecord(updates);

    const consolidatedItems = Array.isArray(updates?.consolidated_items) && updates.consolidated_items.length > 0
      ? updates.consolidated_items
      : (currentMemo.consolidated_items || []);
    const rmaNumbersList = Array.from(new Set([
      ...(Array.isArray(updates?.consolidated_rma_numbers) ? updates.consolidated_rma_numbers : []),
      ...(Array.isArray(currentMemo.consolidated_rma_numbers) ? currentMemo.consolidated_rma_numbers : []),
      ...getCreditMemoRmaNumbers(currentMemo)
    ].filter(Boolean)));
    const reportIdsList = Array.from(new Set([
      ...(Array.isArray(updates?.consolidated_report_ids) ? updates.consolidated_report_ids : []),
      ...(Array.isArray(currentMemo.consolidated_report_ids) ? currentMemo.consolidated_report_ids : []),
      currentMemo.report_id
    ].filter((id) => id !== null && id !== undefined && /^\d+$/.test(String(id))).map((id) => Number(id))));

    const rawHumanNotes = updates?.notes !== undefined
      ? stripCreditMemoMetaTag(updates.notes || '')
      : (currentMemo.clean_notes ?? stripCreditMemoMetaTag(currentMemo.notes || ''));
    const packedNotes = buildPackedCmNotes(rawHumanNotes, isTestMemo, consolidatedItems, rmaNumbersList, reportIdsList);

    const unitPrice = updates.unit_price !== undefined ? Number(Number(updates.unit_price).toFixed(2)) : currentMemo.unit_price;
    const qty = updates.quantity !== undefined ? Number(updates.quantity) : currentMemo.quantity;
    const amount = updates.amount !== undefined ? Number(Number(updates.amount).toFixed(2)) : Number((qty * unitPrice).toFixed(2));
    const creditAmount = updates.credit_amount !== undefined ? Number(Number(updates.credit_amount).toFixed(2)) : currentMemo.credit_amount;

    const updated = {
      ...currentMemo,
      ...updates,
      unit_price: unitPrice,
      quantity: qty,
      amount: amount,
      credit_amount: creditAmount,
      notes: packedNotes,
      clean_notes: stripCreditMemoMetaTag(rawHumanNotes),
      consolidated_items: consolidatedItems,
      consolidated_rma_numbers: rmaNumbersList,
      consolidated_report_ids: reportIdsList,
      company: 'Wholesale Distribution',
      updated_at: new Date().toISOString(),
      is_synced_to_db: true
    };

    // 1. Update in dedicated 'credit_memos' table (strict schema columns only)
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
          credit_issued_by: updated.credit_issued_by,
          notes: packedNotes,
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

    if (consolidatedItems.length > 1) {
      await this.saveConsolidatedItemsEntry(cmNumber, {
        consolidated_items: consolidatedItems,
        rma_numbers: rmaNumbersList,
        report_ids: reportIdsList,
        updated_at: new Date().toISOString()
      });
    }

    // 2. Update ALL linked rma_reports rows
    if (rmaNumbersList.length > 0) {
      try {
        await supabase
          .from('rma_reports')
          .update({
            notes: JSON.stringify({
              credit_memo_number: cmNumber,
              pull_out_ref: updated.pull_out_ref,
              pull_out_date: updated.pull_out_date,
              credit_amount: creditAmount,
              amount,
              consolidated_rma_numbers: rmaNumbersList
            }),
            status: 'credit_memo_issued'
          })
          .in('rma_number', rmaNumbersList);
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
   * Delete / Void a Credit Memo (resets ALL linked rma_reports rows for consolidated memos)
   */
  async deleteCreditMemo(cmNumber, reportId) {
    const existing = await this.getCreditMemos();
    const target = existing.find(m => m.credit_memo_number === cmNumber);
    const filtered = existing.filter(m => m.credit_memo_number !== cmNumber);

    try {
      localStorage.setItem(CREDIT_MEMOS_STORAGE_KEY, JSON.stringify(filtered));
    } catch (e) {}

    // Run consolidated items cleanup, credit_memos deletion, and linked RMA resets in parallel
    const linkedRmas = Array.from(new Set([
      ...(target ? getCreditMemoRmaNumbers(target) : [])
    ].filter(Boolean)));
    const linkedIds = Array.from(new Set([
      ...(Array.isArray(target?.consolidated_report_ids) ? target.consolidated_report_ids : []),
      target?.report_id,
      reportId
    ].filter((id) => id !== null && id !== undefined && /^\d+$/.test(String(id))).map((id) => Number(id))));

    const ops = [
      this.saveConsolidatedItemsEntry(cmNumber, null),
      supabase
        .from('credit_memos')
        .delete()
        .eq('credit_memo_number', cmNumber)
        .then(({ error }) => {
          if (error) {
            console.warn('credit_memos table delete notice:', error.message || error);
          } else {
            console.log(`[Supabase DB] Credit memo ${cmNumber} deleted from credit_memos table.`);
          }
        })
    ];

    if (linkedRmas.length > 0) {
      ops.push(
        supabase
          .from('rma_reports')
          .update({
            notes: null,
            status: 'pending'
          })
          .in('rma_number', linkedRmas)
      );
    }
    if (linkedIds.length > 0) {
      ops.push(
        supabase
          .from('rma_reports')
          .update({
            notes: null,
            status: 'pending'
          })
          .in('id', linkedIds)
      );
    }

    await Promise.allSettled(ops);

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

    for (const cmNum of memoNumbers) {
      await this.saveConsolidatedItemsEntry(cmNum, null);
    }

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

    // 2. Reset ALL affected rma_reports across single & consolidated memos
    const targetRmaSet = new Set();
    const targetIdSet = new Set();
    targets.forEach((t) => {
      getCreditMemoRmaNumbers(t).forEach((n) => targetRmaSet.add(n));
      if (t.report_id && /^\d+$/.test(String(t.report_id))) targetIdSet.add(Number(t.report_id));
      (Array.isArray(t.consolidated_report_ids) ? t.consolidated_report_ids : []).forEach((id) => {
        if (id && /^\d+$/.test(String(id))) targetIdSet.add(Number(id));
      });
    });

    const targetRmas = Array.from(targetRmaSet);
    const targetIds = Array.from(targetIdSet);
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
    if (targetIds.length > 0) {
      try {
        await supabase
          .from('rma_reports')
          .update({
            notes: null,
            status: 'pending'
          })
          .in('id', targetIds);
      } catch (e) {}
    }

    return { success: true, deletedCount: targets.length };
  }
};


