import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPLIER_DIRECTORY_SETTINGS_KEY,
  TEST_SUPPLIER_DIRECTORY_SETTINGS_KEY,
  SUPPLIER_DIRECTORY_STORAGE_KEY,
  TEST_SUPPLIER_DIRECTORY_STORAGE_KEY,
  getSupplierDirectorySettingsKey,
  getSupplierDirectoryStorageKey,
  parseSupplierDirectoryValue,
  isPlaceholderOrTestEmail,
  isBlockedLiveDirectoryName,
  isBlockedLiveDirectoryContact
} from '../../src/utils/supplierDirectoryHelpers.js';

test('separates Live and Test Sandbox supplier directory keys completely', () => {
  assert.equal(getSupplierDirectorySettingsKey(false), SUPPLIER_DIRECTORY_SETTINGS_KEY);
  assert.equal(getSupplierDirectorySettingsKey(true), TEST_SUPPLIER_DIRECTORY_SETTINGS_KEY);
  assert.notEqual(SUPPLIER_DIRECTORY_SETTINGS_KEY, TEST_SUPPLIER_DIRECTORY_SETTINGS_KEY);

  assert.equal(getSupplierDirectoryStorageKey(false), SUPPLIER_DIRECTORY_STORAGE_KEY);
  assert.equal(getSupplierDirectoryStorageKey(true), TEST_SUPPLIER_DIRECTORY_STORAGE_KEY);
  assert.notEqual(SUPPLIER_DIRECTORY_STORAGE_KEY, TEST_SUPPLIER_DIRECTORY_STORAGE_KEY);
});

test('parses both native JSONB arrays and legacy stringified JSON arrays safely', () => {
  const sample = [{ supplier_name: 'Suy Sing Commercial Corp', email_to: 'claims@suysing.com' }];
  assert.deepEqual(parseSupplierDirectoryValue(sample), sample);
  assert.deepEqual(parseSupplierDirectoryValue(JSON.stringify(sample)), sample);
  assert.deepEqual(parseSupplierDirectoryValue('invalid-json'), []);
  assert.deepEqual(parseSupplierDirectoryValue(null), []);
});

test('blocks placeholder/test emails and Playwright suppliers from Live directory', () => {
  assert.equal(isPlaceholderOrTestEmail('vendor-claims@example.com'), true);
  assert.equal(isPlaceholderOrTestEmail('batch-claims@example.org'), true);
  assert.equal(isPlaceholderOrTestEmail('reply-claims@suysing-test.local'), true);
  assert.equal(isPlaceholderOrTestEmail('pw-test-to@pingconmarketing.com'), true);
  assert.equal(isPlaceholderOrTestEmail('waltermart@testgmail.com'), true);

  assert.equal(isPlaceholderOrTestEmail('claims@suysing.com'), false);
  assert.equal(isPlaceholderOrTestEmail('accounts.payable@pingconmarketing.com'), false);

  assert.equal(isBlockedLiveDirectoryName('PW Test Supplier Corp'), true);
  assert.equal(isBlockedLiveDirectoryName('Reset Preservation Supplier'), true);
  assert.equal(isBlockedLiveDirectoryName('Supplier A'), true);
  assert.equal(isBlockedLiveDirectoryName('Suy Sing Commercial Corp'), false);

  assert.equal(
    isBlockedLiveDirectoryContact('Suy Sing Commercial Corp', 'vendor-claims@example.com', ''),
    true
  );
  assert.equal(
    isBlockedLiveDirectoryContact('PW Test Supplier Corp', 'ops@company.com', ''),
    true
  );
  assert.equal(
    isBlockedLiveDirectoryContact('Suy Sing Commercial Corp', 'claims@suysing.com', 'ap@suysing.com'),
    false
  );
});
