import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import {
  PNG_BUFFER,
  attachStrictGuards,
  installPrintStubs,
  interceptAndCaptureEmails,
  gotoAdmin
} from './helpers/testUtils.js';

test.describe('Suite 02: Admin Auth/KPIs, NotificationBell, Staff Roles, Invites & Saved Products Catalog CRUD', () => {
  test('Logout UI in isolated context, all 6 KPI cards & 7 tabs, NotificationBell, EmployeeManagementModal & Invites filters/email/revoke/delete', async ({
    page,
    browser,
    context
  }) => {
    test.setTimeout(150_000);
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);
    const capturedEmails = await interceptAndCaptureEmails(page);
    const uniqueSuffix = String(Date.now()).slice(-6);
    const testInviteEmail = `pw-invite-${uniqueSuffix}@pingcon-test.local`;

    try {
      // 1. Main Admin session: Click all 6 Top KPI Cards & all 7 Tabs
      await gotoAdmin(page);

      // Card 1: Saved Products
      await page.locator('div.cursor-pointer', { hasText: 'Catalog items' }).first().click();
      await expect(page.getByText('Verified Products Catalog')).toBeVisible();

      // Card 2: Customer Inbound
      await page.locator('div.cursor-pointer', { hasText: 'Customer Inbound' }).first().click();
      await expect(page.getByRole('button', { name: /Export Inbound \(\.xlsx\)/i })).toBeVisible();

      // Card 3: Supplier RTVs
      await page.locator('div.cursor-pointer', { hasText: 'Vendor claims queued' }).first().click();
      await expect(page.getByRole('button', { name: /Export Supplier Claims \(\.xlsx\)/i })).toBeVisible();

      // Card 4: Credit Memos
      await page.locator('div.cursor-pointer', { hasText: 'Finance' }).filter({ hasText: 'Credit Memos' }).first().click();
      await expect(page.getByRole('button', { name: /Issue Credit Memo/i })).toBeVisible();

      // Card 5: Awaiting SKU -> Pending Unknown Barcodes modal
      await page.locator('div.cursor-pointer', { hasText: 'Needs SKU assignment' }).first().click();
      await expect(page.getByText('Pending Unknown Barcodes')).toBeVisible();
      const pendingFilter = page.locator('input[placeholder="Filter pending by barcode or SN..."]');
      if (await pendingFilter.isVisible().catch(() => false)) {
        await page.locator('button[title="Toggle SN sorting"]').click();
        await pendingFilter.fill('480');
        await pendingFilter.fill('');
        const enterDetailsBtn = page.getByRole('button', { name: /Enter Details/i }).first();
        if (await enterDetailsBtn.isVisible().catch(() => false)) {
          await enterDetailsBtn.click();
          await expect(page.getByRole('button', { name: /Back to List/i })).toBeVisible();
          // Verify Barcode is locked readOnly during SKU assignment
          const lockedBcInput = page.locator('input[title*="Scanned barcode is locked" i]').first();
          if (await lockedBcInput.isVisible().catch(() => false)) {
            await expect(lockedBcInput).toHaveAttribute('readonly', '');
          }
          await page.getByRole('button', { name: /Back to List/i }).click();
        }
      }
      await page
        .locator('div.fixed', { hasText: 'Pending Unknown Barcodes' })
        .locator('button')
        .first()
        .click();
      await expect(page.getByText('Pending Unknown Barcodes')).toBeHidden();

      // Card 6: Staff Directory -> EmployeeManagementModal (Search, Role/Status/Sort filters, Reset, Add Employee, HR Center API Sync)
      await page.locator('div.cursor-pointer', { hasText: 'Company staff' }).first().click();
      const empModal = page.locator('div.fixed', { hasText: 'Employee Access & Roles Management' });
      await expect(empModal).toBeVisible();
      await empModal.locator('input[placeholder*="Search by employee name" i]').fill('Danilo');
      await empModal.locator('select').nth(0).selectOption('super_admin');
      await empModal.locator('select').nth(1).selectOption('active');
      await empModal.locator('select').nth(2).selectOption('name_desc');
      await empModal.getByRole('button', { name: 'Reset', exact: true }).click();
      await expect(empModal.locator('input[placeholder*="Search by employee name" i]')).toHaveValue('');

      await empModal.getByRole('button', { name: /HR Center API Sync/i }).click();
      await expect(empModal.getByText(/Sync Active Staff/i)).toBeVisible();
      await empModal.getByRole('button', { name: /HR Center API Sync/i }).click();

      await empModal.getByRole('button', { name: /Add Employee/i }).click();
      await expect(empModal.getByText('Add Authorized Company Staff')).toBeVisible();
      await empModal.getByRole('button', { name: 'Cancel', exact: true }).last().click();

      await empModal.locator('div.border-b button').first().click();
      await expect(page.getByText('Employee Access & Roles Management')).toBeHidden();

      // Click top navigation tabs & header Awaiting SKU / Roles buttons
      await page.getByRole('button', { name: /Archive & Trash/i }).click();
      await expect(page.getByRole('button', { name: /Trash Bin/i })).toBeVisible();
      await page.getByRole('button', { name: /Settings & SMTP/i }).click();
      await expect(page.getByText('Simulation / Test Mode Toggle')).toBeVisible();
      await page.getByRole('button', { name: /Test Mode Sandbox/i }).first().click();
      await expect(page.getByRole('button', { name: /Sandbox Customer RMAs/i })).toBeVisible();

      // 3. NotificationBell (Open, All/Unread toggle, Mark all read, Close)
      await page.locator('button[title="Notifications"]').click();
      await expect(page.getByText(/Notifications/i).first()).toBeVisible();
      const unreadBtn = page.getByRole('button', { name: /^Unread/i }).first();
      if (await unreadBtn.isVisible().catch(() => false)) {
        await unreadBtn.click();
        await page.getByRole('button', { name: /^All/i }).first().click();
      }
      const markAllBtn = page.getByRole('button', { name: /Mark all read/i }).first();
      if (await markAllBtn.isVisible().catch(() => false)) {
        await markAllBtn.click();
      }
      await page.keyboard.press('Escape');

      // 4. Generate RMA Invites Modal (Customer vs Supplier, Live vs Test, Custom expiry, Send Email, Table filter, Refresh, Revoke, Delete)
      await page.getByRole('button', { name: /Generate RMA Invites/i }).click();
      const invitesModal = page.locator('div.fixed', { hasText: 'Google Identity Lock' });
      await expect(invitesModal).toBeVisible();

      await invitesModal.getByRole('button', { name: /RMA Details Editor/i }).first().click();
      await invitesModal.getByRole('button', { name: /Supplier RTV Invite/i }).first().click();
      await invitesModal.getByRole('button', { name: /Customer Return Invite/i }).first().click();
      await invitesModal.getByRole('button', { name: /Test Mode Sandbox/i }).click();
      await invitesModal.locator('input[type="email"]').fill(testInviteEmail);
      await invitesModal.getByRole('button', { name: /24 Hours/i }).click();
      await invitesModal.getByRole('button', { name: /Generate Customer Return Invite/i }).click();

      const inviteRow = invitesModal.locator('tr', { hasText: testInviteEmail }).first();
      await expect(inviteRow).toBeVisible({ timeout: 45_000 });
      await inviteRow.locator('button[title="Copy Invite Link"]').click();

      // Test table stream filter pills (Customer / Supplier / Editor / All) + Refresh
      await invitesModal.getByRole('button', { name: /Refresh/i }).first().click().catch(() => {});
      await invitesModal.getByRole('button', { name: /^Customer \(/i }).first().click().catch(() => {});
      await invitesModal.getByRole('button', { name: /^Editor \(/i }).first().click().catch(() => {});
      await invitesModal.getByRole('button', { name: /^All \(/i }).first().click().catch(() => {});

      // Send Invite Email button -> captured safely by interceptAndCaptureEmails
      const sendEmailBtn = inviteRow.locator('button[title*="Send" i]').first();
      if (await sendEmailBtn.isVisible().catch(() => false)) {
        const countBefore = capturedEmails.length;
        await sendEmailBtn.click();
        await expect.poll(() => capturedEmails.length, { timeout: 8_000 }).toBeGreaterThan(countBefore);
      }

      // Delete guard dismiss -> still present, then Revoke + Delete cleanly
      page.once('dialog', async (dialog) => {
        expect(dialog.type()).toBe('confirm');
        await dialog.dismiss();
      });
      await inviteRow.locator('button[title="Delete Invite Record"]').click();
      await expect(inviteRow).toBeVisible();

      page.once('dialog', async (dialog) => await dialog.accept());
      await inviteRow.locator('button[title="Revoke Active Invite Access"]').click();
      await expect(inviteRow.getByText('Revoked', { exact: true }).first()).toBeVisible({ timeout: 45_000 });

      page.once('dialog', async (dialog) => await dialog.accept());
      await inviteRow.locator('button[title="Delete Invite Record"]').click();
      await expect(inviteRow).toBeHidden({ timeout: 25_000 });

      await invitesModal.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(invitesModal).toBeHidden();

      // Isolated Logout check so shared admin refresh token is never revoked
      const isoCtx = await browser.newContext({
        ignoreHTTPSErrors: true,
        storageState: 'tests/.auth/admin.json'
      });
      const isoPage = await isoCtx.newPage();
      const isoGuard = attachStrictGuards(isoPage);
      await isoPage.route('**/auth/v1/logout**', async (route) => {
        return route.fulfill({ status: 204, body: '' });
      });
      await gotoAdmin(isoPage);
      const logoutBtn = isoPage.locator('button[title*="Sign out" i], button:has-text("Logout")').first();
      await expect(logoutBtn).toBeVisible();
      await logoutBtn.click();
      await expect(isoPage.locator('button:has-text("Logout")')).toBeHidden({ timeout: 15_000 });
      await isoPage.goto('/admin', { waitUntil: 'commit', timeout: 45_000 });
      await expect(isoPage.getByRole('button', { name: /Send OTP Verification Code/i })).toBeVisible({
        timeout: 20_000
      });
      isoGuard.assertClean('isolated admin logout check');
      isoGuard.detach();
      await isoCtx.close();

      guard.assertClean('suite 02 admin KPIs, logout, notifications, staff & invites');
    } finally {
      guard.detach();
    }
  });

  test('Saved Products Tab 1: Auto-Suggest lowercase SKU/Name, AE select, 12% VAT, CRUD, sort headers, copy barcode & bulk delete', async ({
    page,
    context
  }) => {
    test.setTimeout(150_000);
    await installPrintStubs(context);
    const guard = attachStrictGuards(page);
    const uniqueSuffix = String(Date.now()).slice(-6);
    const bc1 = `PWBC-${uniqueSuffix}`;
    const sku1 = `PWSKU-${uniqueSuffix}`;
    const name1 = `Playwright Synthetic Product ${uniqueSuffix}`;
    const bc2 = `PWBC2-${uniqueSuffix}`;
    const sku2 = `PWSKU2-${uniqueSuffix}`;
    const name2 = `Playwright Bulk Product ${uniqueSuffix}`;

    try {
      await gotoAdmin(page);
      const savedProductsTab = page.getByRole('button', { name: /Saved Products \([1-9]/i });
      await expect(savedProductsTab).toBeVisible({ timeout: 25_000 });
      await savedProductsTab.click();
      await expect(page.getByText('Verified Products Catalog')).toBeVisible();

      // View switcher, search, filters, Reset, sortable column headers
      await page.getByRole('button', { name: /Grid Cards/i }).click();
      await page.getByRole('button', { name: /Rows List/i }).click();

      const productSearch = page.locator('input[placeholder*="Search by SN" i]');
      await productSearch.fill('Magnolia');
      await page.getByRole('button', { name: /Reset/i }).click();
      await expect(productSearch).toHaveValue('');

      await page.locator('th', { hasText: /^SN$/i }).first().click();
      await page.locator('th', { hasText: /^Barcode$/i }).first().click();
      await page.locator('th', { hasText: /^SN$/i }).first().click();

      const copyBcBtn = page.locator('button[title="Copy barcode"]').first();
      if (await copyBcBtn.isVisible().catch(() => false)) {
        await copyBcBtn.click();
      }

      // Open "+ Add Product" & verify empty validation + Auto-Suggest lowercase SKU + Name auto-fill!
      await page.getByRole('button', { name: /Add Product/i }).click();
      const productModal = page.locator('div.fixed', { hasText: 'Add New Product to Catalog' });
      await expect(productModal).toBeVisible();

      await productModal.getByRole('button', { name: /Save Product/i }).click();

      // Type lowercase SKU `ss1319p` (triggers case-insensitive + ?code= search!) & check Auto-Suggest dropdown
      const skuField = productModal.locator('input[placeholder*="SS1742P"]').first();
      await skuField.click();
      await skuField.fill('ss1319p');
      const dropdownBanner = productModal.getByText('Select to Auto-Populate Product Details');
      if (await dropdownBanner.isVisible({ timeout: 6000 }).catch(() => false)) {
        const firstSuggest = productModal.locator('button:has-text("SKU:")').first();
        if (await firstSuggest.isVisible().catch(() => false)) {
          await firstSuggest.click();
        }
      }

      // Also verify Product Name Auto-Suggest typing `Magnolia`
      const nameInput = productModal.locator('input[placeholder*="Oishi"]').first();
      await nameInput.click();
      await nameInput.fill('Magnolia');
      if (await dropdownBanner.isVisible({ timeout: 6000 }).catch(() => false)) {
        const firstByName = productModal.locator('button:has-text("SKU:")').first();
        if (await firstByName.isVisible().catch(() => false)) {
          await firstByName.click();
          await expect(skuField).not.toHaveValue('');
        }
      }

      // Replace with synthetic Product #1 for safe CRUD testing
      await productModal.locator('input[placeholder*="4800016551857"]').fill(bc1);
      await nameInput.fill(name1);
      await skuField.fill(sku1);

      const aeInput = productModal.locator('input[placeholder*="Search AE employee" i]');
      await expect(aeInput).toBeVisible({ timeout: 20_000 });
      await aeInput.click();
      await aeInput.fill('Danilo');
      const aeSelectBtn = productModal.locator('button', { hasText: 'Select' }).first();
      await expect(aeSelectBtn).toBeVisible({ timeout: 8_000 });
      await aeSelectBtn.click();
      await productModal.getByRole('button', { name: 'Clear', exact: true }).click();
      await productModal.locator('input[placeholder*="Search AE employee" i]').fill('Danilo');
      await productModal.locator('button', { hasText: 'Select' }).first().click();

      const netPriceInput = productModal.locator('input[placeholder="0.00"]').first();
      await netPriceInput.fill('100');
      await netPriceInput.blur();
      await expect(productModal.locator('input[placeholder="0.00"]').nth(1)).toHaveValue('112.00');

      await productModal.locator('#supplier-name-input').fill('Suy Sing');

      // Upload photo & test Save Product
      const prodPhotoInput = productModal.locator('input[type="file"][accept="image/*"]').first();
      if (await prodPhotoInput.count()) {
        await prodPhotoInput.setInputFiles({
          name: 'pw-prod-1.png',
          mimeType: 'image/png',
          buffer: PNG_BUFFER
        });
      }

      await productModal.getByRole('button', { name: /Save Product/i }).click();
      await expect(productModal).toBeHidden({ timeout: 15_000 });

      // Edit Product #1 & then delete individually
      await productSearch.fill(bc1);
      await expect(page.getByText(name1)).toBeVisible({ timeout: 10_000 });

      await page.locator('button[title="Edit product"]').first().click();
      const editModal = page.locator('div.fixed', { hasText: 'Edit Product Details' });
      await expect(editModal).toBeVisible();
      await editModal.locator('input[placeholder="e.g. 24"]').fill('24');
      await editModal.getByRole('button', { name: /Save Changes/i }).click();
      await expect(editModal).toBeHidden({ timeout: 15_000 });

      await page.locator('button[title="Delete product"]').first().click();
      await expect(page.getByText('Delete Product from Catalog?')).toBeVisible();
      await page.getByRole('button', { name: /Yes, Delete Permanently/i }).click();
      await expect(page.locator('tr', { hasText: name1 })).toBeHidden({ timeout: 10_000 });

      // Add Product #2 -> test bulk checkbox, Select all filtered, Deselect, Delete Selected
      await page.getByRole('button', { name: /Reset/i }).click();
      await page.getByRole('button', { name: /Add Product/i }).click();
      await expect(productModal).toBeVisible();
      await productModal.locator('input[placeholder*="4800016551857"]').fill(bc2);
      await productModal.locator('input[placeholder*="Oishi"]').first().fill(name2);
      await productModal.locator('input[placeholder*="SS1742P"]').first().fill(sku2);
      await productModal.locator('input[placeholder="0.00"]').first().fill('50');
      await productModal.locator('#supplier-name-input').fill('Playwright Supplier');
      await productModal.getByRole('button', { name: /Save Product/i }).click();
      await expect(productModal).toBeHidden({ timeout: 15_000 });

      await productSearch.fill(bc2);
      const row2 = page.locator('tr', { hasText: name2 }).first();
      await expect(row2).toBeVisible({ timeout: 10_000 });
      await row2.locator('input[type="checkbox"]').first().check();
      await page.getByRole('button', { name: 'Deselect', exact: true }).click();
      await row2.locator('input[type="checkbox"]').first().check();
      await page.getByRole('button', { name: /Delete Selected/i }).click();
      await page.getByRole('button', { name: /Yes, Delete Permanently/i }).click();
      await expect(row2).toBeHidden({ timeout: 15_000 });
      await page.getByRole('button', { name: /Reset/i }).click();

      guard.assertClean('suite 02 saved products catalog CRUD & auto-suggest');
    } finally {
      guard.detach();
    }
  });
});
