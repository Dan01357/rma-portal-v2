import { supabase } from '../supabaseClient';

export const SUPPLIER_DIRECTORY_SETTINGS_KEY = 'supplier_directory_store';
export const SUPPLIER_DIRECTORY_STORAGE_KEY = 'rma_portal_supplier_directory_store';
export const SUPPLIER_DIRECTORY_EVENT = 'rma-supplier-directory-changed';

const PLACEHOLDER_SUPPLIERS = new Set([
  '',
  'pending',
  'pending assignment',
  'unassigned',
  'warehouse',
  'n/a',
  'none',
  'unknown'
]);

function isPlaceholderName(name) {
  return PLACEHOLDER_SUPPLIERS.has(String(name || '').trim().toLowerCase());
}

export function normalizeSupplierKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeEmailString(raw) {
  if (!raw) return '';
  const arr = Array.isArray(raw) ? raw : String(raw).split(/[,;\n]+/);
  const unique = new Set();
  for (const part of arr) {
    const clean = String(part || '').trim().toLowerCase();
    if (clean && clean.includes('@') && clean.includes('.')) {
      unique.add(clean);
    }
  }
  return Array.from(unique).join(', ');
}

function normalizeContactRecord(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const cleanName = String(entry.supplier_name || entry.supplierName || '').trim();
  if (isPlaceholderName(cleanName)) return null;
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

function normalizeDirectoryList(raw) {
  if (!Array.isArray(raw)) return [];
  const map = new Map();
  for (const item of raw) {
    const norm = normalizeContactRecord(item);
    if (!norm) continue;
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

function writeLocalCache(list) {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SUPPLIER_DIRECTORY_STORAGE_KEY, JSON.stringify(list));
      window.dispatchEvent(new CustomEvent(SUPPLIER_DIRECTORY_EVENT, { detail: list }));
    }
  } catch (err) {
    console.warn('[supplierDirectoryService] Cache write warning:', err?.message || err);
  }
}

async function persistDirectoryToDb(list) {
  const normalized = normalizeDirectoryList(list);
  writeLocalCache(normalized);
  try {
    const { error } = await supabase
      .from('rma_settings')
      .upsert(
        {
          key: SUPPLIER_DIRECTORY_SETTINGS_KEY,
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
  getCachedDirectory() {
    try {
      if (typeof window !== 'undefined') {
        const raw = localStorage.getItem(SUPPLIER_DIRECTORY_STORAGE_KEY);
        if (raw) {
          return normalizeDirectoryList(JSON.parse(raw));
        }
      }
    } catch {}
    return [];
  },

  async loadDirectory() {
    try {
      const { data, error } = await supabase
        .from('rma_settings')
        .select('value')
        .eq('key', SUPPLIER_DIRECTORY_SETTINGS_KEY)
        .maybeSingle();

      if (!error && data && Array.isArray(data.value)) {
        const normalized = normalizeDirectoryList(data.value);
        writeLocalCache(normalized);
        return normalized;
      }
    } catch (err) {
      console.warn('[supplierDirectoryService] Load warning:', err?.message || err);
    }
    return this.getCachedDirectory();
  },

  findBySupplierName(name) {
    const key = normalizeSupplierKey(name);
    if (!key || isPlaceholderName(key)) return null;
    const list = this.getCachedDirectory();
    const exact = list.find((c) => normalizeSupplierKey(c.supplier_name) === key);
    if (exact) return exact;
    const compactKey = key.replace(/[^a-z0-9]/g, '');
    if (!compactKey) return null;
    return list.find((c) => normalizeSupplierKey(c.supplier_name).replace(/[^a-z0-9]/g, '') === compactKey) || null;
  },

  async upsertContact(contact = {}, { explicitEdit = true } = {}) {
    const cleanName = String(contact.supplier_name || contact.supplierName || '').trim();
    if (isPlaceholderName(cleanName)) {
      throw new Error('Please enter a valid Supplier / Company Name.');
    }
    const emailTo = normalizeEmailString(contact.email_to ?? contact.supplier_email_to ?? '');
    const emailCc = normalizeEmailString(contact.email_cc ?? contact.supplier_email_cc ?? '');
    const contactPerson = String(contact.contact_person ?? contact.contactPerson ?? '').trim();
    const notes = String(contact.notes ?? '').trim();

    let current = [];
    try {
      const { data } = await supabase
        .from('rma_settings')
        .select('value')
        .eq('key', SUPPLIER_DIRECTORY_SETTINGS_KEY)
        .maybeSingle();
      if (data && Array.isArray(data.value)) {
        current = normalizeDirectoryList(data.value);
      } else {
        current = this.getCachedDirectory();
      }
    } catch {
      current = this.getCachedDirectory();
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

    const persisted = await persistDirectoryToDb(nextList);
    return {
      saved: persisted.find((c) => normalizeSupplierKey(c.supplier_name) === targetKey) || merged,
      directory: persisted
    };
  },

  async upsertFromSubmission({ supplier_name, supplier_email_to, supplier_email_cc }) {
    const cleanName = String(supplier_name || '').trim();
    const emailTo = normalizeEmailString(supplier_email_to || '');
    const emailCc = normalizeEmailString(supplier_email_cc || '');
    if (isPlaceholderName(cleanName) || (!emailTo && !emailCc)) {
      return null;
    }
    return this.upsertContact(
      {
        supplier_name: cleanName,
        email_to: emailTo,
        email_cc: emailCc
      },
      { explicitEdit: false }
    );
  },

  async deleteContact(idOrName) {
    const rawKey = normalizeSupplierKey(idOrName);
    const idTarget = String(idOrName || '').trim();
    if (!idTarget) return this.getCachedDirectory();

    let current = this.getCachedDirectory();
    try {
      const { data } = await supabase
        .from('rma_settings')
        .select('value')
        .eq('key', SUPPLIER_DIRECTORY_SETTINGS_KEY)
        .maybeSingle();
      if (data && Array.isArray(data.value)) {
        current = normalizeDirectoryList(data.value);
      }
    } catch {}

    const filtered = current.filter(
      (c) => c.id !== idTarget && normalizeSupplierKey(c.supplier_name) !== rawKey
    );
    return persistDirectoryToDb(filtered);
  }
};
