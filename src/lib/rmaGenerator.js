/**
 * Generates an official RMA tracking ID
 * Format: RMA-[Year]-[4-Digit Sequential Number]-[4-Character Random Alphanumeric]
 * Example: RMA-2026-0001-T21R
 */
export function generateRMAId(existingCount = 0) {
  const year = new Date().getFullYear();
  const sequenceNum = String(existingCount + 1).padStart(4, '0');
  
  // Characters avoiding confusing characters like 0/O, 1/I if preferred, or standard uppercase alphanumeric
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let randomCode = '';
  for (let i = 0; i < 4; i++) {
    randomCode += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return `RMA-${year}-${sequenceNum}-${randomCode}`;
}

/**
 * Validates whether an RMA ID adheres to the standard pattern
 */
export function isValidRMAId(rmaId) {
  if (!rmaId) return false;
  const regex = /^RMA-\d{4}-\d{4}-[A-Z0-9]{4}$/;
  return regex.test(rmaId.trim().toUpperCase());
}
