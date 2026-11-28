import { supabase } from '../supabaseClient';
import {
  SUPPLIER_DIRECTORY_SETTINGS_KEY,
  TEST_SUPPLIER_DIRECTORY_SETTINGS_KEY,
  SUPPLIER_DIRECTORY_STORAGE_KEY,
  TEST_SUPPLIER_DIRECTORY_STORAGE_KEY,
  isPlaceholderSupplierName,
  normalizeSupplierDirectoryKey,
  getSupplierDirectorySettingsKey,
  getSupplierDirectoryStorageKey,
  parseSupplierDirectoryValue,
  splitDirectoryEmails,
  isBlockedLiveDirectoryContact
} from '../utils/supplierDirectoryHelpers';

export {
  SUPPLIER_DIRECTORY_SETTINGS_KEY,
  TEST_SUPPLIER_DIRECTORY_SETTINGS_KEY,
  SUPPLIER_DIRECTORY_STORAGE_KEY,
  TEST_SUPPLIER_DIRECTORY_STORAGE_KEY
};
export const SUPPLIER_DIRECTORY_EVENT = 'rma-supplier-directory-changed';

export function normalizeSupplierKey(name) {
  return normalizeSupplierDirectoryKey(name);
}

function normalizeEmailString(raw) {
  return splitDirectoryEmails(raw).join(', ');
}

function normalizeContactRecord(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const cleanName = String(entry.supplier_name || entry.supplierName || '').trim();
  if (isPlaceholderSupplierName(cleanName)) return null;
  const emailTo = normalizeEmailString(entry.email_to || entry.supplier_email_to || entry.to || '');
  const emailCc = normalizeEmailString(entry.email_cc || entry.supplier_email_cc || entry.cc || '');
  const contactPerson = String(entry.contact_person || entry.contactPerson || '').trim();
  const notes = String(entry.notes || '').trim();
  const id = String(entry.id || `sup_${normalizeSupplierKey(cleanName).replace(/[^a-z0-9]+/g, '_')}`).trim();
  const updatedAt = entry.updated_at || new Date().toISOString();

  return {
    id,
    supplier_name: cleanName,
    email_to: emailTo,
    email_cc: emailCc,
    contact_person: contactPerson,
    notes,
    updated_at: updatedAt
  };
}

function normalizeDirectoryList(raw, { isTestMode = false } = {}) {
  const arr = parseSupplierDirectoryValue(raw);
  const map = new Map();
  for (const item of arr) {
    const norm = normalizeContactRecord(item);
    if (!norm) continue;
    if (!isTestMode && isBlockedLiveDirectoryContact(norm.supplier_name, norm.email_to, norm.email_cc)) {
      continue;
    }
    const k = normalizeSupplierKey(norm.supplier_name);
    const existing = map.get(k);
    if (!existing) {
      map.set(k, norm);
    } else {
      map.set(k, {
        ...existing,
        ...norm,
        email_to: norm.email_to || existing.email_to,
        email_cc: norm.email_cc || existing.email_cc,
        contact_person: norm.contact_person || existing.contact_person,
        notes: norm.notes || existing.notes
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.supplier_name.localeCompare(b.supplier_name));
}

function writeLocalCache(list, isTestMode = false) {
  const modeFlag = Boolean(isTestMode);
  const storageKey = getSupplierDirectoryStorageKey(modeFlag);
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(storageKey, JSON.stringify(list));
      window.dispatchEvent(
        new CustomEvent(SUPPLIER_DIRECTORY_EVENT, {
          detail: { isTestMode: modeFlag, list }
        })
      );
    }
  } catch (err) {
    console.warn('[supplierDirectoryService] Cache write warning:', err?.message || err);
  }
}

async function fetchDirectoryFromDb(isTestMode = false) {
  const modeFlag = Boolean(isTestMode);
  const settingsKey = getSupplierDirectorySettingsKey(modeFlag);
  const { data, error } = await supabase
    .from('rma_settings')
    .select('value')
    .eq('key', settingsKey)
    .maybeSingle();

  if (!error && data && (Array.isArray(data.value) || typeof data.value === 'string')) {
    return normalizeDirectoryList(data.value, { isTestMode: modeFlag });
  }
  return null;
}

async function persistDirectoryToDb(list, isTestMode = false) {
  const modeFlag = Boolean(isTestMode);
  const settingsKey = getSupplierDirectorySettingsKey(modeFlag);
  const normalized = normalizeDirectoryList(list, { isTestMode: modeFlag });
  writeLocalCache(normalized, modeFlag);
  try {
    const { error } = await supabase
      .from('rma_settings')
      .upsert(
        {
          key: settingsKey,
          value: normalized,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'key' }
      );
    if (error) {
      console.warn('[supplierDirectoryService] Supabase upsert warning:', error.message);
    }
  } catch (err) {
    console.warn('[supplierDirectoryService] Supabase upsert exception:', err?.message || err);
  }
  return normalized;
}

export const supplierDirectoryService = {
  getCachedDirectory({ isTestMode = false } = {}) {
    const modeFlag = Boolean(isTestMode);
    const storageKey = getSupplierDirectoryStorageKey(modeFlag);
    try {
      if (typeof window !== 'undefined') {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          return normalizeDirectoryList(raw, { isTestMode: modeFlag });
        }
      }
    } catch {}
    return [];
  },

  async loadDirectory({ isTestMode = false } = {}) {
    const modeFlag = Boolean(isTestMode);
    try {
      const dbList = await fetchDirectoryFromDb(modeFlag);
      if (Array.isArray(dbList)) {
        writeLocalCache(dbList, modeFlag);
        return dbList;
      }
    } catch (err) {
      console.warn('[supplierDirectoryService] Load warning:', err?.message || err);
    }
    return this.getCachedDirectory({ isTestMode: modeFlag });
  },

  findBySupplierName(name, { isTestMode = false } = {}) {
    const modeFlag = Boolean(isTestMode);
    const key = normalizeSupplierKey(name);
    if (!key || isPlaceholderSupplierName(key)) return null;
    const list = this.getCachedDirectory({ isTestMode: modeFlag });
    const exact = list.find((c) => normalizeSupplierKey(c.supplier_name) === key);
    if (exact) return exact;
    const compactKey = key.replace(/[^a-z0-9]/g, '');
    if (!compactKey) return null;
    return list.find((c) => normalizeSupplierKey(c.supplier_name).replace(/[^a-z0-9]/g, '') === compactKey) || null;
  },

  async upsertContact(contact = {}, { explicitEdit = true, isTestMode = false } = {}) {
    const modeFlag = Boolean(isTestMode);
    const cleanName = String(contact.supplier_name || contact.supplierName || '').trim();
    if (isPlaceholderSupplierName(cleanName)) {
      throw new Error('Please enter a valid Supplier / Company Name.');
    }
    const emailTo = normalizeEmailString(contact.email_to ?? contact.supplier_email_to ?? '');
    const emailCc = normalizeEmailString(contact.email_cc ?? contact.supplier_email_cc ?? '');
    const contactPerson = String(contact.contact_person ?? contact.contactPerson ?? '').trim();
    const notes = String(contact.notes ?? '').trim();

    // Never permit placeholder/test emails or test supplier names into Live Supplier Directory
    if (!modeFlag && isBlockedLiveDirectoryContact(cleanName, emailTo, emailCc)) {
      if (!explicitEdit) return null;
      throw new Error('Test or placeholder supplier names/emails (@example.com, *.local) cannot be saved in the Live Supplier Directory. Enable Test Mode Sandbox instead.');
    }

    let current = [];
    try {
      const dbList = await fetchDirectoryFromDb(modeFlag);
      current = Array.isArray(dbList) ? dbList : this.getCachedDirectory({ isTestMode: modeFlag });
    } catch {
      current = this.getCachedDirectory({ isTestMode: modeFlag });
    }

    const targetKey = normalizeSupplierKey(cleanName);
    const prevIdx = current.findIndex((c) => (contact.id && c.id === contact.id) || normalizeSupplierKey(c.supplier_name) === targetKey);
    const prev = prevIdx >= 0 ? current[prevIdx] : null;

    const merged = {
      id: (contact.id && String(contact.id).trim()) || prev?.id || `sup_${targetKey.replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString(36)}`,
      supplier_name: cleanName,
      email_to: explicitEdit ? emailTo : (emailTo || prev?.email_to || ''),
      email_cc: explicitEdit ? emailCc : (emailCc || prev?.email_cc || ''),
      contact_person: explicitEdit ? contactPerson : (contactPerson || prev?.contact_person || ''),
      notes: explicitEdit ? notes : (notes || prev?.notes || ''),
      updated_at: new Date().toISOString()
    };

    const nextList = [...current];
    if (prevIdx >= 0) {
      nextList[prevIdx] = merged;
    } else {
      nextList.push(merged);
    }

    const persisted = await persistDirectoryToDb(nextList, modeFlag);
    return {
      saved: persisted.find((c) => normalizeSupplierKey(c.supplier_name) === targetKey) || merged,
      directory: persisted
    };
  },

  async upsertFromSubmission({ supplier_name, supplier_email_to, supplier_email_cc }, { isTestMode = false } = {}) {
    const modeFlag = Boolean(isTestMode);
    const cleanName = String(supplier_name || '').trim();
    const emailTo = normalizeEmailString(supplier_email_to || '');
    const emailCc = normalizeEmailString(supplier_email_cc || '');
    if (isPlaceholderSupplierName(cleanName) || (!emailTo && !emailCc)) {
      return null;
    }
    if (!modeFlag && isBlockedLiveDirectoryContact(cleanName, emailTo, emailCc)) {
      return null;
    }
    return this.upsertContact(
      {
        supplier_name: cleanName,
        email_to: emailTo,
        email_cc: emailCc
      },
      { explicitEdit: false, isTestMode: modeFlag }
    );
  },

  async deleteContact(idOrName, { isTestMode = false } = {}) {
    const modeFlag = Boolean(isTestMode);
    const rawKey = normalizeSupplierKey(idOrName);
    const idTarget = String(idOrName || '').trim();
    if (!idTarget) return this.getCachedDirectory({ isTestMode: modeFlag });

    let current = this.getCachedDirectory({ isTestMode: modeFlag });
    try {
      const dbList = await fetchDirectoryFromDb(modeFlag);
      if (Array.isArray(dbList)) {
        current = dbList;
      }
    } catch {}

    const filtered = current.filter(
      (c) => c.id !== idTarget && normalizeSupplierKey(c.supplier_name) !== rawKey
    );
    return persistDirectoryToDb(filtered, modeFlag);
  }
};
