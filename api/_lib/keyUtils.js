import crypto from 'crypto';

export const ALLOWED_SYSTEMS = [
  'Primary System (Mine)',
  'Jarmen',
  'Jelo',
  'Arlito'
];

/**
 * Computes SHA-256 hash of a raw API key.
 * @param {string} rawKey 
 * @returns {string} 64-char hex hash
 */
export function hashApiKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') return '';
  return crypto.createHash('sha256').update(rawKey.trim()).digest('hex');
}

/**
 * Creates a masked version for safe UI display (e.g. "sk_live_...4a2b")
 * @param {string} rawKey 
 * @returns {string} Masked string
 */
export function maskApiKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') return 'sk_live_...';
  const clean = rawKey.trim();
  const last4 = clean.slice(-4);
  return `sk_live_...${last4}`;
}

/**
 * Generates a cryptographically strong raw API key and its hash + mask.
 * Format: sk_live_rma_<48 hex chars>
 */
export function generateApiKeyPair() {
  const entropy = crypto.randomBytes(24).toString('hex'); // 48 chars
  const rawKey = `sk_live_rma_${entropy}`;
  const keyHash = hashApiKey(rawKey);
  const maskedKey = maskApiKey(rawKey);

  return {
    rawKey,
    keyHash,
    maskedKey
  };
}
