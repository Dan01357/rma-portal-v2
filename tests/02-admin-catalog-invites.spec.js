import { test, expect } from '@playwright/test';
import {
  attachStrictGuards,
  installPrintStubs,
  gotoAdmin
} from './helpers/testUtils.js';

test.describe('Suite 02: Admin KPIs, Catalog CRUD, Pending SKUs, Roles & Invites', () => {
  test('clicks all 6 KPI cards, NotificationBell, Saved Products CRUD/filters/Auto-Suggest/AE, Awaiting SKU, Roles & Invites', async ({
    page,
    context
  }) => {
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);
    const uniqueSuffix = String(Date.now()).slice(-6);
    const testBarcode = `PWBC-${uniqueSuffix}`;
    const testSku = `PWSKU-${uniqueSuffix}`;
    const testProductName = `Playwright Synthetic Product ${uniqueSuffix}`;
    const testInviteEmail = `pw-invite-${uniqueSuffix}@pingcon-test.local`;

    try {
      await gotoAdmin(page);

      // 1. Click all 6 Top KPI Cards genuinely
      // Card 1: Saved Products
      await page.locator('div.cursor-pointer', { hasText: 'Catalog items' }).first().click();
      await expect(page.getByText('Verified Products Catalog')).toBeVisible();

      // Card 2: Customer Inbound
      await page.locator('div.cursor-pointer', { hasText: 'Customer Inbound' }).first().click();
      await expect(page.getByText(/Customer RMA Hub/i).first()).toBeVisible();

      // Card 3: Supplier RTVs
      await page.locator('div.cursor-pointer', { hasText: 'Vendor claims queued' }).first().click();
      await expect(page.getByText(/Supplier/i).first()).toBeVisible();

      // Card 4: Credit Memos
      await page.locator('div.cursor-pointer', { hasText: 'Finance' }).filter({ hasText: 'Credit Memos' }).first().click();
      await expect(page.getByRole('button', { name: /Issue Credit Memo/i })).toBeVisible();

      // Card 5: Awaiting SKU -> opens Pending Unknown Barcodes modal
      await page.locator('div.cursor-pointer', { hasText: 'Needs SKU assignment' }).first().click();
      await expect(page.getByText('Pending Unknown Barcodes')).toBeVisible();
      // Interact inside Awaiting SKU modal cleanly
      const pendingFilter = page.locator('input[placeholder="Filter pending by barcode or SN..."]');
      if (await pendingFilter.isVisible().catch(() => false)) {
        await page.locator('button[title="Toggle SN sorting"]').click();
        await pendingFilter.fill('480');
        await pendingFilter.fill('');
        const enterDetailsBtn = page.getByRole('button', { name: /Enter Details/i }).first();
        if (await enterDetailsBtn.isVisible().catch(() => false)) {
          await enterDetailsBtn.click();
          await expect(page.getByRole('button', { name: /Back to List/i })).toBeVisible();
          await page.getByRole('button', { name: /Back to List/i }).click();
        }
      }
      // Close Pending Barcodes modal
      await page
        .locator('div.fixed', { hasText: 'Pending Unknown Barcodes' })
        .locator('button')
        .first()
        .click();
      await expect(page.getByText('Pending Unknown Barcodes')).toBeHidden();

      // Card 6: Staff Directory -> opens Employee Access & Roles Management modal
      await page.locator('div.cursor-pointer', { hasText: 'Company staff' }).first().click();
      await expect(page.getByText('Employee Access & Roles Management')).toBeVisible();
      await page.locator('input[placeholder*="Search by employee name" i]').fill('Danilo');
      await page.locator('input[placeholder*="Search by employee name" i]').fill('');
      await page.locator('div.fixed', { hasText: 'Employee Access & Roles Management' }).locator('select').first().selectOption('super_admin');
      await page.locator('div.fixed', { hasText: 'Employee Access & Roles Management' }).locator('select').first().selectOption('all');
      await page
        .locator('div.fixed', { hasText: 'Employee Access & Roles Management' })
        .locator('div.border-b button')
        .first()
        .click();
      await expect(page.getByText('Employee Access & Roles Management')).toBeHidden();

      // Also test Notification Bell & "Awaiting SKU" & "Roles & Access" bar buttons
      await page.locator('button[title="Notifications"]').click();
      await expect(page.getByText(/Notifications/i).first()).toBeVisible();
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: /Awaiting SKU \(/i }).click();
      await expect(page.getByText('Pending Unknown Barcodes')).toBeVisible();
      await page
        .locator('div.fixed', { hasText: 'Pending Unknown Barcodes' })
        .locator('button')
        .first()
        .click();

      await page.getByRole('button', { name: /Roles & Access/i }).click();
      await expect(page.getByText('Employee Access & Roles Management')).toBeVisible();
      await page
        .locator('div.fixed', { hasText: 'Employee Access & Roles Management' })
        .locator('div.border-b button')
        .first()
        .click();

      // 2. Saved Products Tab: View Switcher, Search, Filters, + Add Product, Auto-Suggest, AE selection, Edit & Delete
      await page.getByRole('button', { name: /Saved Products \(/i }).click();
      await expect(page.getByText('Verified Products Catalog')).toBeVisible();

      // Toggle Grid Cards vs Rows List
      await page.getByRole('button', { name: /Grid Cards/i }).click();
      await page.getByRole('button', { name: /Rows List/i }).click();

      // Test Search & Filter Dropdowns + Reset button
      const productSearch = page.locator('input[placeholder*="Search by SN" i]');
      await productSearch.fill('Magnolia');
      await page.getByRole('button', { name: /Reset/i }).click();
      await expect(productSearch).toHaveValue('');

      const statusSelect = page.locator('select', { hasText: 'All Status' }).first();
      await statusSelect.selectOption('verified');
      await page.getByRole('button', { name: /Reset/i }).click();

      // Click "+ Add Product" -> open ProductEditModal
      await page.getByRole('button', { name: /Add Product/i }).click();
      const productModal = page.locator('div.fixed', { hasText: 'Add New Product to Catalog' });
      await expect(productModal).toBeVisible();

      // Test validation guard when submitting empty Barcode / Product Name
      await productModal.getByRole('button', { name: /Save Product/i }).click();

      // Test ProductAutoSuggest on Product Name by typing known catalog fragment
      const nameInput = productModal.locator('input[placeholder*="Oishi"]').first();
      await nameInput.fill('Magnolia');
      await page.waitForTimeout(450);

      // Fill synthetic product fields for clean CRUD test
      await nameInput.fill(testProductName);
      await productModal.locator('input[placeholder*="4800016551857"]').fill(testBarcode);
      await productModal.locator('input[placeholder*="SS1742P"]').fill(testSku);

      // Test Customer AE search, selection, Change AE / Clear, and re-select AE
      const aeInput = productModal.locator('input[placeholder*="Search AE employee" i]');
      await expect(aeInput).toBeVisible({ timeout: 25_000 });
      await aeInput.click();
      await aeInput.fill('Danilo');
      const aeFirstOption = productModal.locator('button', { hasText: 'Select' }).first();
      await expect(aeFirstOption).toBeVisible({ timeout: 8_000 });
      await aeFirstOption.click();
      await expect(productModal.getByRole('button', { name: 'Clear', exact: true })).toBeVisible();
      await productModal.getByRole('button', { name: 'Clear', exact: true }).click();
      // Re-select AE cleanly
      const aeInput2 = productModal.locator('input[placeholder*="Search AE employee" i]');
      await aeInput2.click();
      await aeInput2.fill('Danilo');
      await productModal.locator('button', { hasText: 'Select' }).first().click();

      // Test Net Price -> automatic 12% VAT calculation + SupplierInput autocomplete
      const netPriceInput = productModal.locator('input[placeholder="0.00"]').first();
      await netPriceInput.fill('100');
      await netPriceInput.blur();
      const vatPriceInput = productModal.locator('input[placeholder="0.00"]').nth(1);
      await expect(vatPriceInput).toHaveValue('112.00');

      const supplierField = productModal.locator('#supplier-name-input');
      await supplierField.fill('Suy Sing');

      await productModal.getByRole('button', { name: /Save Product/i }).click();
      await expect(productModal).toBeHidden({ timeout: 15_000 });

      // Search our newly saved synthetic product, toggle Grid Cards & back, Edit it, then Delete it
      await productSearch.fill(testBarcode);
      await expect(page.getByText(testProductName)).toBeVisible({ timeout: 10_000 });

      // Open Edit Product modal
      await page.locator('button[title="Edit product"]').first().click();
      const editModal = page.locator('div.fixed', { hasText: 'Edit Product Details' });
      await expect(editModal).toBeVisible();
      await editModal.locator('input[placeholder="e.g. 24"]').fill('24');
      await editModal.getByRole('button', { name: /Save Changes/i }).click();
      await expect(editModal).toBeHidden({ timeout: 15_000 });

      // Delete synthetic product so catalog stays clean
      await page.locator('button[title="Delete product"]').first().click();
      await expect(page.getByText('Delete Product from Catalog?')).toBeVisible();
      await page.getByRole('button', { name: /Yes, Delete Permanently/i }).click();
      await expect(page.locator('tr', { hasText: testProductName })).toBeHidden({ timeout: 10_000 });
      await page.getByRole('button', { name: /Reset/i }).click();

      // 3. Generate RMA Invites modal (Header button + Customer & Supplier tabs + Copy Link + Delete Guard)
      await page.getByRole('button', { name: /Generate RMA Invites/i }).click();
      const invitesModal = page.locator('div.fixed', { hasText: 'Google Identity Lock' });
      await expect(invitesModal).toBeVisible();

      // Click Supplier RTV Invite tab and back to Customer Return Invite tab
      await invitesModal.getByRole('button', { name: /Supplier RTV Invite/i }).first().click();
      await invitesModal.getByRole('button', { name: /Customer Return Invite/i }).first().click();

      // Select Test Mode Sandbox environment so invite is isolated
      await invitesModal.getByRole('button', { name: /Test Mode Sandbox/i }).click();
      await invitesModal.locator('input[type="email"]').fill(testInviteEmail);
      await invitesModal.getByRole('button', { name: /24 Hours/i }).click();
      await invitesModal.getByRole('button', { name: /Generate Customer Return Invite/i }).click();

      // Locate created invite row and test Copy Invite Link
      const inviteRow = invitesModal.locator('tr', { hasText: testInviteEmail }).first();
      await expect(inviteRow).toBeVisible({ timeout: 12_000 });
      await inviteRow.locator('button[title="Copy Invite Link"]').click();

      // Test Delete Guard: dismiss confirm dialog FIRST and confirm invite STILL exists
      page.once('dialog', async (dialog) => {
        expect(dialog.type()).toBe('confirm');
        await dialog.dismiss();
      });
      await inviteRow.locator('button[title="Delete Invite Record"]').click();
      await expect(inviteRow).toBeVisible();

      // Now revoke + accept confirm, then delete + accept confirm to keep invites clean
      page.once('dialog', async (dialog) => await dialog.accept());
      await inviteRow.locator('button[title="Revoke Active Invite Access"]').click();
      await expect(inviteRow.getByText('Revoked', { exact: true }).first()).toBeVisible({ timeout: 25_000 });

      page.once('dialog', async (dialog) => await dialog.accept());
      await inviteRow.locator('button[title="Delete Invite Record"]').click();
      await expect(inviteRow).toBeHidden({ timeout: 25_000 });

      await invitesModal.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(invitesModal).toBeHidden();

      guard.assertClean('suite 02 admin catalog invites');
    } finally {
      guard.detach();
    }
  });
});
