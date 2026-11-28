export const SUPPLIER_DIRECTORY_SETTINGS_KEY = 'supplier_directory_store';
export const TEST_SUPPLIER_DIRECTORY_SETTINGS_KEY = 'test_supplier_directory_store';
export const SUPPLIER_DIRECTORY_STORAGE_KEY = 'rma_portal_supplier_directory_store';
export const TEST_SUPPLIER_DIRECTORY_STORAGE_KEY = 'rma_portal_test_supplier_directory_store';

const PLACEHOLDER_SUPPLIER_NAMES = new Set([
  '',
  'pending',
  'pending assignment',
  'unassigned',
  'warehouse',
  'n/a',
  'none',
  'unknown'
]);

const BLOCKED_LIVE_SUPPLIER_PATTERNS = [
  /^pw\s+test\b/i,
  /^playwright\b/i,
  /^reset preservation supplier$/i,
  /^supplier\s+[ab]$/i,
  /^other guard vendor$/i
];

const BLOCKED_LIVE_EMAIL_DOMAINS = [
  'example.com',
  'example.org',
  'example.net',
  'testgmail.com'
];

const BLOCKED_LIVE_EMAIL_PREFIXES = [
  'pw-test-',
  'pw-invite-',
  'vendor-claims@',
  'vendor-cc@',
  'batch-claims@',
  'batch-ap@',
  'preserve-to@',
  'preserve-cc@',
  'claims-supa@',
  'reply-claims@',
  'vendor-fu@',
  'cc-fu@'
];

export function isPlaceholderSupplierName(name) {
  return PLACEHOLDER_SUPPLIER_NAMES.has(String(name || '').trim().toLowerCase());
}

export function normalizeSupplierDirectoryKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function getSupplierDirectorySettingsKey(isTestMode = false) {
  return isTestMode ? TEST_SUPPLIER_DIRECTORY_SETTINGS_KEY : SUPPLIER_DIRECTORY_SETTINGS_KEY;
}

export function getSupplierDirectoryStorageKey(isTestMode = false) {
  return isTestMode ? TEST_SUPPLIER_DIRECTORY_STORAGE_KEY : SUPPLIER_DIRECTORY_STORAGE_KEY;
}

/**
 * Safely parses `rma_settings.value` whether Supabase returns a native JSONB array
 * or a serialized JSON array string (preventing accidental cache overwrite on string values).
 */
export function parseSupplierDirectoryValue(rawValue) {
  if (Array.isArray(rawValue)) return rawValue;
  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Splits a comma/semicolon/newline-separated string or array of emails into lowercase valid emails.
 */
export function splitDirectoryEmails(raw) {
  if (!raw) return [];
  const parts = Array.isArray(raw) ? raw : String(raw).split(/[,;\s\n]+/);
  const out = [];
  const seen = new Set();
  for (const part of parts) {
    const clean = String(part || '').trim().toLowerCase();
    if (clean && clean.includes('@') && clean.includes('.') && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

/**
 * Detects reserved/placeholder/test emails that must never pollute Live Production directories.
 */
export function isPlaceholderOrTestEmail(rawEmail) {
  const emails = splitDirectoryEmails(rawEmail);
  if (emails.length === 0) return false;
  return emails.some((email) => {
    const atIdx = email.lastIndexOf('@');
    if (atIdx < 1) return false;
    const domain = email.slice(atIdx + 1);
    if (
      domain.endsWith('.local') ||
      domain.endsWith('.test') ||
      domain.endsWith('.example') ||
      BLOCKED_LIVE_EMAIL_DOMAINS.includes(domain)
    ) {
      return true;
    }
    if (/^pw-ed\d+-/i.test(email)) return true;
    return BLOCKED_LIVE_EMAIL_PREFIXES.some((prefix) => email.startsWith(prefix));
  });
}

export function isBlockedLiveDirectoryName(supplierName) {
  const clean = String(supplierName || '').trim();
  if (!clean || isPlaceholderSupplierName(clean)) return true;
  return BLOCKED_LIVE_SUPPLIER_PATTERNS.some((re) => re.test(clean));
}

export function isBlockedLiveDirectoryContact(supplierName, emailTo = '', emailCc = '') {
  if (isBlockedLiveDirectoryName(supplierName)) return true;
  return isPlaceholderOrTestEmail(emailTo) || isPlaceholderOrTestEmail(emailCc);
}
