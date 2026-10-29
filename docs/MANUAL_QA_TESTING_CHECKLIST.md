# Wholesale RMA Portal v2 — Comprehensive Manual QA Testing Checklist

**QA Director:** Lead QA Director & Principal Software Architect  
**Test Suite:** End-to-End Functional, Regression, UI/UX, and Database Integrity Suite  
**Application Target:** `https://rma-portal-v2.vercel.app`  
**Execution Type:** Manual QA with checkable verification boxes `[ ]`  

---

> [!IMPORTANT]
> ### 📜 LIVING DOCUMENTATION CONTRACT & QA PROTOCOL
> 1. **Single Source of Truth**: This checklist (`docs/MANUAL_QA_TESTING_CHECKLIST.md`) is our binding contract for Quality Assurance.
> 2. **Mandatory Simultaneous Update**: WHENEVER any developer, DevOps engineer, or AI assistant modifies, adds, or removes any UI button, modal, form input, or API endpoint in this project, they **MUST simultaneously update this document** with the corresponding test cases and checkboxes `[ ]`.
> 3. **Free-Tier Protection**: All tests verify strict adherence to Vercel Hobby limits (12 serverless functions, 10s execution cap) and Supabase Free Tier quotas (1 GB storage, 500 MB database, connection pooling).

---

## Document Structure & Legend
Each test scenario defines:
* **Location**: Specific screen, modal, or tab.
* **Button / Input Label**: Exact text as rendered in the interface.
* **Action**: User interaction (Click, Type, Scan, Touch, Keypress).
* **Expected Behavior (UI + Database)**: Exact frontend response and Supabase table mutation.
* **Edge-Case / Failure Test**: Negative test case verifying validation, error handling, and recovery.

---

## Section 1: Public Intake Portal (`/`)

### 1.1 Super Admin Awareness Banner
- [ ] **TC-PUB-01 (Unauthenticated User View)**
  * **Location**: Top of Public Portal (`/`)
  * **Action**: Load `/` in an incognito browser window (unauthenticated).
  * **Expected Behavior**: No Sandbox / Live mode banner is shown. The portal is strictly locked to **Live Mode**.
  * **Edge Case**: Verify unauthenticated users cannot toggle test mode or simulate returns.

- [ ] **TC-PUB-02 (Super Admin Sandbox Active)**
  * **Location**: Top of Public Portal (`/`)
  * **Action**: Log in as `super_admin` in Admin, enable Test Mode in Settings, then return to `/`.
  * **Expected Behavior**: Amber warning banner appears: `⚡ Super Admin Sandbox Active — Submissions will simulate without sending real emails or dispatching warehouse stock.` The toggle switch indicates ON.
  * **Edge Case**: Submitting a return records `is_test: true` in `rma_reports` and dispatches test emails exclusively to `finance2@keysysincorporated.com`.

- [ ] **TC-PUB-03 (Super Admin 1-Click Toggle)**
  * **Location**: Top banner toggle switch
  * **Action**: Click the toggle switch on the amber banner.
  * **Expected Behavior**: Banner instantly transitions to emerald green: `✓ Super Admin Live Mode Active — All return reports and emails are live.`
  * **Edge Case**: Refresh the page; verify the selected mode persists via `localStorage.rma_portal_test_mode`.

---

### 1.2 Barcode Intake & Camera Scanner
- [ ] **TC-PUB-04 (Handheld Laser Scanner Input)**
  * **Location**: Section 1: `PRODUCT BARCODE / QR CODE`
  * **Input**: `#barcode-input`
  * **Action**: Scan or type a known barcode (`4806518330012` for *Bonita Soft Facial Tissue 200 pulls*) and press Enter.
  * **Expected Behavior**: Blue spinner shows briefly; product card appears below displaying product name, image, supplier (*Bonita Mills Inc.*), net price (₱68.50), and VAT price (₱76.72).
  * **Edge Case**: Scan an uncatalogued barcode (e.g., `4809999888877`). System displays amber `Uncatalogued Barcode` notice, allowing submission to proceed as `pending_admin_details`.

- [ ] **TC-PUB-04B (Anonymous Coworker Live Catalog Fallback)**
  * **Location**: Section 1: `PRODUCT BARCODE / QR CODE`
  * **Action**: In an incognito / unauthenticated window, scan or type barcode `4801234165512` (*Mr. Muscle Toilet Bowl Cleaner Citrus Scent 500mL x1*).
  * **Expected Behavior**: Recognizes product name, supplier (*Monheim Distributors, Inc.*), net price (₱92.31), and VAT price (₱103.39) from coworker's live ERP API without requiring an admin login.
  * **Edge Case**: Verifies `purchaseOrdersApi.loadApiKeyFromCloud()` automatically retrieves `EXTERNAL_API_KEY_DANILO` from Supabase `rma_settings`.

- [ ] **TC-PUB-05 (Mobile Camera Scanner Modal)**
  * **Location**: Button **"Scan with Phone Camera"**
  * **Action**: Click button.
  * **Expected Behavior**: Scanner overlay modal opens, activates the rear/environment camera with active green laser viewfinder line.
  * **Edge Case**: Scan a printed QR code containing `https://rma-portal-v2.vercel.app/?rma=RMA-2026-1020-0001`. Scanner parses the RMA number directly and redirects to the Quick Processing modal.

- [ ] **TC-PUB-06 (Quantity Counter Stepper)**
  * **Location**: Quantity `+` and `-` buttons
  * **Action**: Click `+` 4 times; click `-` 2 times.
  * **Expected Behavior**: Value displays `3`.
  * **Edge Case**: Click `-` until value reaches `1`. Clicking `-` again does nothing (quantity cannot drop below 1).

---

### 1.3 Proof Photo Capture, WebP Compression & Google Drive Storage
- [ ] **TC-PUB-07 (In-Browser Aggressive WebP Compression)**
  * **Location**: Section 2: `PROOF PHOTOS (REQUIRED)`
  * **Action**: Upload a high-resolution 48MP / 10MB mobile phone camera JPG.
  * **Expected Behavior**: Canvas compressor resizes the image to $\le$ 1280px max dimension and encodes it as `image/webp` at `0.7` quality. The payload is reduced by $>95\%$ to approximately 80KB–180KB, preventing Vercel 10s serverless timeout errors.
  * **Edge Case**: Upload an image on a browser with canvas WebP disabled; verify automatic fallback to JPEG 0.7 without crashing.

- [ ] **TC-PUB-07B (Google Workspace Drive Primary Photo Upload)**
  * **Location**: Section 2: `PROOF PHOTOS (REQUIRED)` -> Submission workflow
  * **Action**: Submit report with Google Service Account credentials configured.
  * **Expected Behavior**: Photo is uploaded via `/api/upload-photo` directly into Google Workspace Drive (`keysysincorporated.com` / `pingconmarketing.com`) within dedicated directory `Wholesale RMA Photos/YYYY-MM/`. Public reader permission is granted, and resulting CDN preview URL (`https://lh3.googleusercontent.com/d/{fileId}`) is saved into `rma_reports.photos`.
  * **Verification**: URL loads directly inside `<img>` tags without CORS errors or download redirects.

- [ ] **TC-PUB-07C (Supabase Storage Secondary Fallback)**
  * **Location**: Section 2: `PROOF PHOTOS (REQUIRED)` -> Submission workflow
  * **Action**: Temporarily unset Google Drive credentials in environment.
  * **Expected Behavior**: System automatically and gracefully falls back to Supabase Storage `rma-photos` bucket (`reports/[timestamp]_[filename].webp`). Submission succeeds seamlessly with zero errors shown to warehouse staff.

- [ ] **TC-PUB-07D (Offline Base64 Tertiary Fallback)**
  * **Location**: Section 2: `PROOF PHOTOS (REQUIRED)`
  * **Action**: Disconnect network immediately after selecting photo and submit.
  * **Expected Behavior**: Photo safely falls back to in-memory Base64 Data URL, ensuring warehouse staff never lose evidence during dock connectivity drops.

- [ ] **TC-PUB-08 (Multi-Photo Lightbox Preview)**
  * **Location**: Uploaded photo thumbnail
  * **Action**: Upload 3 distinct photos, then click thumbnail 2.
  * **Expected Behavior**: `ImageLightboxModal` opens displaying photo 2 with navigation arrows `<-` and `->`, zoom control, and subtitle `Photo 2 of 3`. Supporting both Google Drive CDN URLs and Supabase storage URLs.

---

### 1.4 Defect Reason, Reporter Specs & GPS Geofence
- [ ] **TC-PUB-09 (Defect Reason Chips)**
  * **Location**: Section 3: `WHY ARE YOU RETURNING THIS ITEM?`
  * **Action**: Click **"Damaged Box / Crushed Packaging"**.
  * **Expected Behavior**: Chip highlights with bold rose border and checkmark icon. Selected reason is stored in submission payload.
  * **Edge Case**: Click **"Other Reason"**. Additional textarea appears requesting custom defect explanation.

- [ ] **TC-PUB-10 (Dock GPS Accuracy Filter)**
  * **Location**: Section 4: `YOUR CONTACT DETAILS`
  * **Action**: Allow browser location permissions when prompted.
  * **Expected Behavior**: If GPS accuracy is within $\le$ 150m (mobile GPS), green badge displays: `✓ Dock Coordinates Verified (±18m)`.
  * **Edge Case**: On a desktop device where Wi-Fi geolocation accuracy is $\pm 800\text{m}$, badge displays: `Coordinates Filtered (Inaccurate Geolocation)`. `gps_latitude` and `gps_longitude` are sent as `null` to prevent false data corruption.

---

### 1.5 Submission & Box QR Sticker Generation
- [ ] **TC-PUB-11 (Submit Return Report)**
  * **Location**: Button **"Submit Return Report"**
  * **Action**: Click button with valid barcode, photo, reason, and reporter name.
  * **Expected Behavior**: Button shows loading spinner; confetti animation triggers (`canvas-confetti`); screen switches to Success confirmation displaying generated `RMA-YYYY-MMDD-XXXX`.
  * **Database Verification**: New row exists in `public.rma_reports` with correct `barcode`, `photo_urls`, `status = 'received_at_dock'` (or `'pending_admin_details'`), and initial `audit_trail` entry.

- [ ] **TC-PUB-12 (Save Sticker PNG Download)**
  * **Location**: Success Screen button **"Save Sticker (PNG)"**
  * **Action**: Click button.
  * **Expected Behavior**: A high-resolution PNG file `BOX-STICKER-[RMA-NUMBER].png` downloads.
  * **Visual Layout Verification**:
    1. RMA Number font dynamically scales between 26px–54px and **never overlaps** the QR code frame.
    2. Long item names wrap cleanly across 2 lines (up to 960px width) without truncation ellipses.
    3. Defect reason wraps cleanly across 2 lines (up to 560px width).
    4. Dashed cut line and footer instructions are crisp and legible.

- [ ] **TC-PUB-09 (Uncatalogued Return Catalog Isolation)**
  * **Location**: Public Portal (`/`) -> Submission
  * **Action**: Submit an uncatalogued barcode return (e.g. barcode `999123`).
  * **Expected Behavior**: Return is saved to `public.rma_reports`, but **DOES NOT** insert an `Unidentified Item` row into `public.products`.
  * **Verification**: Query `public.products` in Supabase; table remains clean and only contains verified catalog SKUs.

---

## Section 2: Admin Top Nav, Global Controls & KPI Cards

- [ ] **TC-NAV-01 (Admin Login Modal & Role Detection)**
  * **Location**: Header button **"Admin"** (or navigating to `/admin` or pressing `Shift+A`)
  * **Action**: Enter employee email (e.g., `danilo.alvaro@a2z2go.net`) and PIN.
  * **Expected Behavior**: Modal authenticates against `authService`; toast notification announces: `Welcome back, Danilo Alvaro Jr. (Super Admin)! Authenticated as super_admin.` Admin workspace reveals.

- [ ] **TC-NAV-02 (Universal Dark / Light Theme Toggle)**
  * **Location**: Header Moon / Sun icon button
  * **Action**: Click toggle.
  * **Expected Behavior**: Interface switches seamlessly between dark slate palette (`bg-slate-950`) and clean light palette (`bg-slate-50`). Theme persists across browser reloads via `localStorage.theme`.

- [ ] **TC-NAV-03 (Public Portal QR & Poster Modal)**
  * **Location**: Header button **"Portal QR & Poster"**
  * **Action**: Click button.
  * **Expected Behavior**: `PortalAccessQRModal` opens with large high-contrast QR code pointing to `https://rma-portal-v2.vercel.app/`, dock worker instructions, and **"Download Printable A4 Poster"** button.

- [ ] **TC-NAV-04 (5 Live KPI Dashboard Counters)**
  * **Location**: Dashboard Header KPI Section
  * **Action**: Observe the 5 metric cards:
    1. **Total Incoming RMA**: Sum of active return tickets.
    2. **Verified Catalog Products**: Count of active SKUs in `products` table.
    3. **Pending Unknown Barcodes**: Count of returns with `pending_admin_details`.
    4. **Finance Credit Memos**: Count of issued credit memos.
    5. **Supplier Claims (RTV)**: Count of vendor debit claims.
  * **Expected Behavior**: Numbers accurately match `rma_reports`, `products`, and `credit_memos` database rows.

- [ ] **TC-NAV-05 (Instant Cross-Tab Logout Synchronization)**
  * **Location**: Global Application State
  * **Action**: Open `https://rma-portal-v2.vercel.app/admin` in Tab A (authenticated). Open the same URL in Tab B. Click **"Logout"** in Tab A.
  * **Expected Behavior**: Tab A logs out and resets URL to `/`. Tab B **instantly** receives the `BroadcastChannel('rma_auth_bus')` event, resets to `/`, clears all session modals, and destroys all cached admin tokens.
  * **Edge Case**: Copy the previous logged-in `/admin` URL and paste into a new browser tab; verifies the user remains unauthenticated and is prompted with the login gate.

---

## Section 3: Tab 1 — Saved Products Catalog

- [ ] **TC-CAT-01 ("+ Add Product" Modal)**
  * **Location**: Tab 1 button **"+ Add Product"**
  * **Action**: Click button.
  * **Expected Behavior**: `ProductEditModal` opens in creation mode with title `Add New Product to Catalog`.

- [ ] **TC-CAT-02 (Live ERP Auto-Suggest during SKU Registration)**
  * **Location**: `ProductEditModal` -> Product Name input
  * **Action**: Type `Oishi` into the product name field.
  * **Expected Behavior**: Dropdown appears showing matching products from live ERPLY catalog (e.g., *Oishi Prawn Crackers 50g*). Clicking a suggestion auto-fills SKU, price, 12% VAT price, and supplier.

- [ ] **TC-CAT-03 (Mandatory Customer AE Enforcement)**
  * **Location**: `ProductEditModal` -> Customer AE Selector
  * **Action**: Try to save product without selecting an AE.
  * **Expected Behavior**: Error banner displays: `Customer Account Executive (AE) is required. Please search and select an AE from the employee directory.` Form submission is blocked.

- [ ] **TC-CAT-04 (Catalog Grid / Table Layout Toggle)**
  * **Location**: Catalog view mode buttons (Table vs. Cards icon)
  * **Action**: Toggle between Table view and Grid card view.
  * **Expected Behavior**: Layout switches smoothly without re-fetching data.

- [ ] **TC-CAT-05 (Product Search & Supplier Filter)**
  * **Location**: Search bar and Supplier dropdown
  * **Action**: Type `Bonita` in search and select `Bonita Mills Inc.` from supplier dropdown.
  * **Expected Behavior**: Products list filters in real-time, displaying only matching Bonita tissue items.

- [ ] **TC-CAT-06 (Delete Product with Cascading Safety)**
  * **Location**: Product row Trash icon
  * **Action**: Click Delete on a test product.
  * **Expected Behavior**: `DeleteConfirmationModal` opens requiring explicit confirmation. Deleting soft-deletes or removes product and updates catalog count immediately.

---

## Section 4: Tab 2 — Incoming Return Reports Table (Parity Audit)

- [ ] **TC-REP-01 (Table Row Click to Inspect / Triage)**
  * **Location**: Return Reports Table row
  * **Action**: Click anywhere on a report row (not on a checkbox or button).
  * **Expected Behavior**: `QuickRMAActionModal` opens immediately with that report's RMA number, condition grade, disposition, and rack/bin location pre-populated.

- [ ] **TC-REP-02 (RMA Number Link Click)**
  * **Location**: Column 2 `RMA #` text link
  * **Action**: Click the blue monospaced RMA number link.
  * **Expected Behavior**: `QuickRMAActionModal` opens immediately.

- [ ] **TC-REP-03 ("Inspect / Triage" Action Button)**
  * **Location**: Column 10 `Actions` -> Button **"Inspect / Triage"**
  * **Action**: Click button.
  * **Expected Behavior**: `QuickRMAActionModal` opens immediately.

- [ ] **TC-REP-04 (Save Physical Triage & Immediate Optimistic UI Sync)**
  * **Location**: Inside `QuickRMAActionModal`
  * **Action**: Change Condition Grade to `Grade C`, Disposition to `Return to Vendor (RTV)`, Location to `RACK-04-BIN-B`, and click **"Save Physical Triage"**.
  * **Expected Behavior**:
    1. Success banner displays inside modal: `Warehouse triage & location saved successfully!`.
    2. The underlying Return Reports table behind the modal updates **immediately** without requiring a page refresh.
    3. `rma_reports` table row in Supabase updates with new specs and an audit trail entry.

- [ ] **TC-REP-05 (4x6" Thermal Label from Table Row Printer Icon)**
  * **Location**: Column 10 `Actions` -> Printer Icon button
  * **Action**: Click printer icon.
  * **Expected Behavior**: `ThermalBoxLabelModal` opens for that specific RMA item showing Code128 barcode, QR code, Condition Grade, and Rack/Bin location.
  * **Audit Verification**: Printing appends a `THERMAL_PRINT` event to `rma_reports.audit_trail`.

- [ ] **TC-REP-06 (Mobile Card Parity & Triage Buttons)**
  * **Location**: Mobile viewport ($\le 768\text{px}$) or Grid Card view
  * **Action**: Inspect card controls.
  * **Expected Behavior**: Mobile card contains:
    1. Clickable RMA number link.
    2. Printer icon button (launches 4x6" thermal label).
    3. **"Triage"** button (launches Quick Processing modal).
    4. **"Assign SKU"** button (if uncatalogued).

- [ ] **TC-REP-07 (Multi-Select & Bulk Delete)**
  * **Location**: Table row checkboxes
  * **Action**: Select 3 reports; click floating bar button **"Delete Selected (3)"**.
  * **Expected Behavior**: Super Admin confirmation modal verifies deletion. All 3 rows are removed from Supabase and UI simultaneously.

- [ ] **TC-REP-08 (CSV Export)**
  * **Location**: Button **"Export CSV"**
  * **Action**: Click button.
  * **Expected Behavior**: Downloads `rma_reports_export_[timestamp].csv` containing all filtered reports with RMA number, barcode, name, quantity, price, supplier, triage status, and GPS coordinates.

---

## Section 5: Tab 3 — Finance Credit Memos

- [ ] **TC-FIN-01 ("+ Issue Credit Memo" Modal)**
  * **Location**: Tab 3 button **"+ Issue Credit Memo"**
  * **Action**: Click button.
  * **Expected Behavior**: `CreditMemoModal` opens. Selecting an RMA report from the dropdown auto-populates barcode, item name, quantity, unit price, and gross amount.

- [ ] **TC-FIN-02 (12% VAT Breakdown & Calculations)**
  * **Location**: `CreditMemoModal`
  * **Action**: Select an item with price ₱1,120.00 inclusive of VAT.
  * **Expected Behavior**: System accurately calculates:
    * Gross Amount: ₱1,120.00
    * Net Amount: ₱1,000.00
    * 12% VAT: ₱120.00
  * **Edge Case**: Toggle credit deduction chips (100%, 75%, 50%, 25%). Credit amount calculates correctly to 2 decimal places.

- [ ] **TC-FIN-03 (High-Value Claim ₱10,000 Governance Enforcement)**
  * **Location**: `CreditMemoModal`
  * **Action**: Attempt to issue credit memo for total value ₱14,500.00 while logged in as a standard `admin` or `inventory_staff`.
  * **Expected Behavior**: Action is blocked with amber warning: `High-Value Claim (> ₱10,000.00). Super Admin authorization required to issue credit memo.`
  * **Edge Case**: Log in as `super_admin`; the button unlocks and credit memo issues successfully.

- [ ] **TC-FIN-04 (Official Credit Memo Voucher View & Print)**
  * **Location**: Credit Memos Table -> Button **"CM Voucher"**
  * **Action**: Click button.
  * **Expected Behavior**: `CreditMemoVoucherModal` opens with formal BIR-compliant header, linked RMA number, Pull-Out Reference (`POR-...`), VAT breakdown, and triple signature blocks.
  * **Edge Case**: Click **"Print Voucher"**; triggers clean print CSS formatted for A4/Letter without UI chrome.

---

## Section 6: Tab 4 — Supplier Claims (RTV)

- [ ] **TC-RTV-01 (Supplier Account Filtering)**
  * **Location**: Supplier dropdown filter
  * **Action**: Select `Liwayway Marketing Corporation`.
  * **Expected Behavior**: List displays only returns linked to Oishi/Liwayway items triaged for RTV.

- [ ] **TC-RTV-02 (Batch Selection & Debit Calculator)**
  * **Location**: RTV items checkboxes
  * **Action**: Check 4 separate return items.
  * **Expected Behavior**: Bottom summary bar instantly computes:
    * Total Selected Items: `4`
    * Total Units: `[Sum of quantities]`
    * Total Claim Debit: `₱[Sum of line totals]`

- [ ] **TC-RTV-03 (Generate RTV Debit Claim Voucher)**
  * **Location**: Button **"Generate RTV Debit Claim"**
  * **Action**: Click button with items selected.
  * **Expected Behavior**: Bundles returns into a supplier debit note and displays a formal printable debit voucher.

---

## Section 7: Tab 5 — Settings, Diagnostics & API Key Vault

- [ ] **TC-SET-01 (Supabase Backend Diagnostic Test)**
  * **Location**: Card `Supabase Database Connection` -> Button **"Test Supabase Backend"**
  * **Action**: Click button.
  * **Expected Behavior**: Performs query against `rma_reports` and displays green badge: `✓ Supabase Backend Connected (Latency: ~120ms)`.

- [ ] **TC-SET-02 (Google SMTP Credential Test)**
  * **Location**: Card `Google SMTP Notification Service` -> Button **"Test SMTP Credentials"**
  * **Action**: Click button.
  * **Expected Behavior**: Calls `/api/send-email?diagnostic=true`; validates App Password length, eliminates whitespace, and reports: `✓ SMTP Authentication Successful (finance2@keysysincorporated.com)`.

- [ ] **TC-SET-03 (Configurable Email Recipients & CC Management)**
  * **Location**: Section `Automated RMA Email Notification Recipients`
  * **Action**: Add CC email `audit@pingconmarketing.com` and click **"Save Email Settings"**.
  * **Expected Behavior**: Updates `public.rma_settings` table. Subsequent RMA submissions CC the new address.

- [ ] **TC-SET-04 (External Catalog API Key Configuration)**
  * **Location**: Section `External Catalog & Purchase Orders API Key`
  * **Action**: Enter private key `pk_live_...` and click **"Save Key"**.
  * **Expected Behavior**: Saves key to Supabase `rma_settings` and `products` config row, enabling immediate auto-suggest for dock staff.

- [ ] **TC-SET-05 (SHA-256 API Key Generation & Reveal Modal)**
  * **Location**: Section `Multi-System REST API Keys` -> Button **"+ Generate API Key"**
  * **Action**: Select partner system `Jarmen`, set rate limit `120 req/min`, and click **"Generate Key"**.
  * **Expected Behavior**: Modal generates cryptographically secure `rma_live_[32-chars]`, stores SHA-256 hash in `api_keys`, and reveals the plain key with a copy button. Warning reminds user the key will not be shown again.

- [ ] **TC-SET-06 (API Key Revocation & Deletion)**
  * **Location**: API Keys table -> Trash icon
  * **Action**: Click Delete on a test key.
  * **Expected Behavior**: Prompts for confirmation; removes key from `api_keys`. Subsequent calls using that key return `401 Unauthorized`.

- [ ] **TC-SET-07 (Scalar Interactive API Documentation Link)**
  * **Location**: Button **"Open API Docs (/docs)"**
  * **Action**: Click link.
  * **Expected Behavior**: Opens `/docs` displaying modern Scalar interactive documentation generated from OpenAPI 3.1 specification.

- [ ] **TC-SET-08 (Supabase Free-Tier Connection Pooling & Client Reuse Test)**
  * **Location**: Serverless backend `api/_lib/supabase.js`
  * **Action**: Rapidly trigger 20 consecutive health checks (`/api/v1/health`) and product queries (`/api/v1/products`).
  * **Expected Behavior**: Client reuses connection agent cached on `globalThis._supabaseServerlessClient`. Zero `remaining connection slots are reserved for non-replication superuser connections` errors appear; connection pooling remains healthy and within free-tier threshold.

- [ ] **TC-SET-09 (Database Free-Tier Indexing Verification Test)**
  * **Location**: Supabase SQL Editor / `optimize_free_tier_indexes.sql`
  * **Action**: Execute `EXPLAIN ANALYZE SELECT * FROM public.rma_reports WHERE rma_number = 'RMA-2026-0001-A14R' ORDER BY created_at DESC;`.
  * **Expected Behavior**: Query plan executes via `Index Scan using idx_rma_reports_rma_number` with execution time $< 5\text{ms}$ (instead of sequential table scan), conserving free-tier database CPU quota.

- [ ] **TC-SET-10 (Vercel 10s Serverless Execution Cap & WebP Timing Test)**
  * **Location**: Mobile Intake photo submission `/api/upload-photo`
  * **Action**: Trigger photo upload with client-side WebP compression.
  * **Expected Behavior**: Execution completes within $\approx 250\text{ms}–800\text{ms}$, well below Vercel Hobby's 10-second timeout limit. If Google Drive network stalls, internal abort controller terminates cleanly at 7.5s and signals Supabase fallback.

---

## Section 8: Auxiliary Modals & Workflows

### 8.1 Pending Unknown Barcodes Modal
- [ ] **TC-MOD-01 (Pending Barcodes Batch Review)**
  * **Location**: Admin Top Nav or Dashboard Alert -> Click **"Pending Unknown Barcodes"**
  * **Action**: Review uncatalogued items.
  * **Expected Behavior**: Modal lists all returns needing SKU assignment with proof photo lightbox and quick search.
- [ ] **TC-MOD-02 (Assign Details & Verify in Batch Modal)**
  * **Action**: Select an item, assign SKU and Customer AE, and click **"Save & Verify"**.
  * **Expected Behavior**: Product saves to `products`, updates pending `rma_reports` to `logged`, and fires AE notification email.

### 8.2 Employee Access & Roles Management Modal
- [ ] **TC-MOD-03 (Role Modification)**
  * **Location**: Header button **"Staff Roles"**
  * **Action**: Change an employee's role from `inventory_staff` to `admin`.
  * **Expected Behavior**: Updates role in database; user immediately receives admin privileges upon their next session refresh.
- [ ] **TC-MOD-04 (Super Admin Role Protection)**
  * **Action**: Attempt to delete the last active Super Admin account.
  * **Expected Behavior**: System strictly blocks deletion with alert: `Cannot delete primary Super Admin account.`

### 8.3 Return Authorization QR Code & Quick Actions Modal
- [ ] **TC-MOD-05 (RMA QR Scan Protected 2-Step OTP Gate)**
  * **Location**: Visiting `/?rma=[RMA_NUMBER]` or scanning RMA Box QR code on mobile camera
  * **Action**: Open an RMA quick processing URL while unauthenticated.
  * **Expected Behavior**:
    1. Report summary card loads and displays RMA details.
    2. Quick Actions controls are locked behind **Admin Verification Required** gate.
    3. Step 1: User types company email. System checks if account is an active `admin` or `super_admin`. Unrecognized or public customer emails are blocked with `Access Denied`.
    4. Step 2: System dispatches genuine 6-digit OTP code to employee email.
    5. User enters 6-digit OTP code and clicks **"Verify & Unlock"**.
    6. Triage and Quick Actions unlock exclusively for that session.
  * **Security Check**: Verify `localStorage` is **never** used to persist quick auth across tabs or browser restarts.

- [ ] **TC-MOD-06 (Re-opening Quick Actions from Box Sticker Modal)**
  * **Location**: Return QR Box Sticker Modal -> Quick Actions button
  * **Action**:
    1. Submit an RMA return.
    2. Click **"Print Box Sticker"**.
    3. Click **"Quick Actions"**.
    4. Click **"X"** to close.
    5. Click **"Print Box Sticker"** again.
    6. Click **"Quick Actions"** again.
  * **Expected Behavior**: Modal re-opens smoothly with zero console errors or `TypeError: Cannot read properties of null (reading 'inspected_by')` crashes. All report fields load safely.

### 8.4 Defects & Refinements Verification Suite (Oct 2026 QA Run)

#### 8.4.1 RMA Return Reports Table Columns Separation & Display
- [ ] **TC-REP-01 (4 Distinct Columns Display)**
  * **Location**: Admin Return Reports Table (`/admin`) and RMA Return Reports Modal
  * **Action**: View reports table.
  * **Expected Behavior**: 
    1. Table displays 4 distinct, sortable columns: `Catalog Status`, `Lifecycle Stage`, `Disposition`, and `Location`.
    2. `Catalog Status` displays either `LOGGED` (green) or `PENDING SKU` (amber).
    3. `Lifecycle Stage` displays color-coded badge (`Received at Dock`, `Under Inspection`, `Pending Finance`, `Credit Memo Issued`, `Closed / Restocked`, `Rejected / Invalid`).
    4. `Disposition` displays untruncated badge (`Restock to Inventory`, `Return to Vendor (RTV)`, `Quarantine`, `Scrap / Dispose`, or `Pending Triage`).
    5. `Location` displays mono rack/bin badge (e.g. `RACK-03-BIN-A`) or `—` if unassigned.
  * **Edge Case**: Click column headers to verify multi-directional sorting (asc/desc) works for each column.

#### 8.4.2 Lifecycle Stage Auto-Update on Credit Memo Issuance
- [ ] **TC-CM-01 (Auto-Update Lifecycle Stage to Credit Memo Issued)**
  * **Location**: Credit Memo Modal (`+ Credit Memo`)
  * **Action**: Issue a new credit memo for an RMA report in `Received at Dock` or `Under Inspection` stage.
  * **Expected Behavior**:
    1. Credit memo is saved successfully.
    2. Associated RMA report's lifecycle stage is automatically updated to `credit_memo_issued` in database and UI.
    3. Row in Return Reports immediately updates to green `Credit Memo Issued` badge without manual page reload.
    4. RMA remains fully editable via `Inspect / Triage` modal for any subsequent adjustments or warehouse restock updates.

#### 8.4.3 Permanent Image Asset Purge on Report & Product Deletion
- [ ] **TC-DEL-01 (Single Report Deletion Photo Cleanup)**
  * **Location**: RMA Return Reports -> Delete button (Trash icon)
  * **Action**: Delete an RMA report with proof photos stored in Google Drive and Supabase Storage.
  * **Expected Behavior**:
    1. Report is deleted from `rma_reports`.
    2. Associated photos in Google Workspace Drive and Supabase `rma-photos` bucket are permanently deleted via `DELETE /api/upload-photo`.
    3. No orphan images remain in storage.
- [ ] **TC-DEL-02 (Bulk Report Deletion Photo Cleanup)**
  * **Action**: Select multiple RMA reports with checkboxes and click **"Delete Selected"**.
  * **Expected Behavior**: All selected reports are purged and all corresponding images across Google Drive and Supabase are deleted in parallel.
- [ ] **TC-DEL-03 (Product Deletion Reference Image Cleanup)**
  * **Action**: Delete a product with an uploaded image from Catalog.
  * **Expected Behavior**: Product record is deleted and stored image is purged from Google Drive / Supabase storage.

#### 8.4.4 Instant Public Portal RMA Submission
- [ ] **TC-SUB-01 (Sub-1.5s Submission Latency)**
  * **Location**: Public Portal (`/`)
  * **Action**: Fill in barcode, quantity, reason, reporter info, attach proof photo, and click **"Submit Return Report"**.
  * **Expected Behavior**:
    1. Photos upload in parallel via `Promise.all`.
    2. Submission completes and displays QR Sticker screen in under 1.5 seconds (previously 7–8 seconds).
    3. Background refreshes (email notification, catalog sync, data reload) proceed non-blockingly without delaying the user's QR confirmation.

#### 8.4.5 Unit Selection Dropdowns ("pc" or "case")
- [ ] **TC-UNT-01 (Strict Unit Selection)**
  * **Location**: Public Portal intake form, Product Edit modal, Pending Barcodes modal, and Credit Memo modal.
  * **Action**: Inspect unit input in each modal.
  * **Expected Behavior**: All unit inputs are strict `<select>` dropdowns offering only `"pc"` or `"case"`. Free-text typos are impossible. Default is `"pc"`. If a recognized barcode has `"case"` in catalog, the dropdown automatically selects `"case"`.

#### 8.4.6 Official Signatures & Voucher Issuer Enforcement
- [ ] **TC-CM-BEN-01 (Credit Memo Finance Head Strictly Analiza B. Benoza)**
  * **Location**: Finance Credit Memo Voucher (`CreditMemoVoucherModal`) & Credit Memo Forms
  * **Action**: Generate and preview any Finance Credit Memorandum Voucher.
  * **Expected Behavior**:
    1. Finance Head signature block strictly displays **Analiza B. Benoza** (never Danilo Alvaro Jr.).
    2. Role displays cleanly as `Finance Head`.
    3. Danilo Alvaro Jr. is never included on official accounting credit memo vouchers.

- [ ] **TC-RTV-PREP-01 (Supplier Claims Prepared By Pure Name Without Role)**
  * **Location**: Supplier Claims & RTV Chargeback Batching Voucher (`SupplierClaimsTab`)
  * **Action**: Generate a Supplier Debit Claim Voucher while logged in as any employee (e.g., `Elisa (Admin)` or warehouse staff).
  * **Expected Behavior**:
    1. `PREPARED BY (LOGISTICS / WAREHOUSE)` displays the active user's pure name without parenthetical roles (e.g. `Elisa`, not `Elisa (Admin)`).
    2. Danilo Alvaro Jr. is never printed as Logistics/Warehouse preparer (defaults to active warehouse staff).
    3. The Prepared By field is also directly editable prior to printing.

#### 8.4.7 Barcode Lock & Catalog Protection
- [ ] **TC-BC-LOCK-01 (Read-Only Barcode When Assigning SKU)**
  * **Location**: Catalog / Pending Barcodes -> Edit / Assign SKU Modal (`ProductEditModal`)
  * **Action**: Open an existing barcode to assign SKU or update catalog details.
  * **Expected Behavior**:
    1. Barcode input field is locked and strictly non-editable (`readOnly` / `disabled`).
    2. A lock icon and tooltip clearly indicate the barcode is permanently fixed to prevent accidental corruption.
    3. SKU, Product Name, Category, Unit, and Price remain freely editable.

#### 8.4.8 Supplier Claims (RTV) Multi-Vendor Validation & Dropdown Filter
- [ ] **TC-RTV-VEND-01 (Single Vendor RTV Bundling Enforcement)**
  * **Location**: Supplier Claims (RTV) Tab
  * **Action**: Attempt to generate an RTV claim voucher while items from multiple different suppliers (e.g. Suysing and Walter Mart) are selected.
  * **Expected Behavior**:
    1. System warns user that an RTV debit claim must belong to a single vendor.
    2. Prevents misattributing Suysing returns under a Walter Mart voucher (`RTV-WALTERMA-...`).
- [ ] **TC-RTV-SUP-01 (Supplier Clean Dropdown Filter)**
  * **Location**: Supplier Claims (RTV) Tab
  * **Action**: View supplier filter on desktop and mobile.
  * **Expected Behavior**:
    1. Horizontal pill buttons are replaced with a clean `<select>` dropdown menu with supplier item counts.
    2. Easily accommodates large directories of 50+ vendors without cluttering the screen.

#### 8.4.9 Filtering & Column Sorting in Credit Memos & Supplier Claims
- [ ] **TC-CM-SORT-01 (Credit Memos Table Filtering & Sorting)**
  * **Location**: Credit Memos Tab
  * **Expected Behavior**:
    1. Search filter, Supplier `<select>` dropdown, and Date Range filters filter rows reactively.
    2. Table headers (CM #, RMA, Product, Qty, Gross, Pull Out Ref, Credit Amount, Issued By) are clickable and sort ascending/descending with arrow indicators.
- [ ] **TC-RTV-SORT-01 (Supplier Claims Table Filtering & Sorting)**
  * **Location**: Supplier Claims (RTV) Tab
  * **Expected Behavior**:
    1. Search filter, Supplier dropdown, and Triage Disposition dropdown filter claims table.
#### 8.4.10 Supplier Claims (RTV) Streamlined Actions, Database Persistence & Sequential RTV ID Suite
- [ ] **TC-RTV-ACT-02 (Streamlined Actions & Individual Debit Claim Generation)**
  * **Location**: Supplier Claims (RTV) Tab
  * **Action**: View claims table rows.
  * **Expected Behavior**:
    1. Unnecessary buttons (**Inspect / Triage**, **CM Voucher**, **RMA QR display / Print 4x6 Label**, and **Assign SKU**) are completely removed from the table rows.
    2. Each row displays an individual Debit Claim action:
       - Displays amber **"+ Debit Claim"** button if no debit claim has been generated for that RMA report yet.
       - Displays emerald **"RTV Voucher"** button if a claim has already been logged.
    3. Dedicated **Delete** (rose trash icon) button is retained per row for authorized users, purging proof photos from Google Drive & Supabase storage upon deletion.

- [ ] **TC-RTV-DB-01 (Supplier Claim Database Persistence & RMA Report Sync)**
  * **Location**: Supplier Claims (RTV) Tab -> Generate Claim (Individual or Batch)
  * **Action**: Click "+ Debit Claim" or batch "Generate Claim".
  * **Expected Behavior**:
    1. Claim record is persisted to the database (`rma_settings` fallback store + `public.supplier_claims` table) with claim number, vendor, item list, totals, and preparer.
    2. Each associated `rma_reports` record has its disposition automatically set to `"Return to Vendor (RTV)"`.
    3. Report notes are tagged with `[RTV: {claim_number}]` and an audit event (`RTV Debit Claim Generated`) is logged in `audit_trail`.
    4. Claim and voucher data persist across browser restarts, page reloads, and across different user accounts.

- [ ] **TC-RTV-ID-01 (RTV ID Sequential Format: RTV-YYYY-XXXX-RAND)**
  * **Action**: Inspect the generated RTV Claim ID in modal and voucher.
  * **Expected Behavior**:
    1. Format strictly matches `RTV-{YYYY}-{SEQUENCE}-{ALPHANUMERIC}` (e.g. `RTV-2026-0001-HY67`).
    2. Prefix is `RTV`.
    3. Year matches current year (e.g. `2026`).
    4. Sequence is a 4-digit strictly increasing number (`0001`, `0002`, `0003`, ...).
    5. Suffix is a 4-character uppercase alphanumeric string (e.g. `HY67`, `8K9P`).

- [ ] **TC-RTV-SEL-01 (Multi-Select Operations: Printing or Deleting Only)**
  * **Location**: Supplier Claims (RTV) Tab -> Multi-Select Checkboxes
  * **Action**: Select one or more rows or click **"Select All"**.
  * **Expected Behavior**:
    1. Selection bar appears with count badge and actions strictly limited to:
       - **Print Vouchers**: Prints RTV vouchers for all selected items.
       - **Delete Selected (N)**: Bulk deletes selected RMA reports and cleans up proof photos from Google Drive and Supabase storage.
       - **Deselect All / Clear**: Clears selection state.
    2. The yellow/amber "Generate Claim" button is **excluded** from Select All, the top banner, and the selection toolbar to eliminate confusion and completely prevent doubling or re-generating vouchers for transactions that already have one.
    3. Debit claim generation is handled strictly individually per row via amber **"+ Debit Claim"** (for unassigned claims) or emerald **"RTV Voucher"** (for reviewing already logged claims).

- [ ] **TC-DEL-GD-01 (Google Drive Shared Drive Photo Deletion & Trash Fallback)**
  * **Location**: RMA Reports / Supplier Claims Delete Action
  * **Action**: Delete an RMA return report whose photos are stored in a Google Workspace Shared Drive.
  * **Expected Behavior**:
    1. System attempts permanent deletion via `DELETE /drive/v3/files/{id}?supportsAllDrives=true`.
    2. If permanent deletion is rejected due to Shared Drive permissions (e.g. Service Account is Content Manager without Manager privileges), system automatically falls back to `PATCH` with `{"trashed": true}`.
    3. File is moved to trash and removed from the active folder in Google Shared Drive.
    4. Exact deletion status and hints are logged for full observability.

- [ ] **TC-BC-RACE-01 (Barcode Lookup Race Condition & Persistent Display)**
  * **Location**: Public Portal (`/`) -> Barcode Input
  * **Action**: Type or scan an existing barcode (e.g. `4801234165512`).
  * **Expected Behavior**:
    1. System queries the database and displays the recognized product card in green (`MH117P Mr. Muscle Toilet Bowl Cleaner...`).
    2. The recognized product remains permanently displayed without disappearing or being overwritten by slower out-of-order responses from preceding keystrokes.
    3. Accidental Enter keys from hardware scanners or keyboards do not prematurely submit or clear the form.


---

## QA Director Sign-Off & Verification Protocol

| Verification Stage | Target System | Status | Lead QA Signature |
| :--- | :--- | :--- | :--- |
| **Phase 1: Dock Arrival & Geofence** | Public Portal (`/`) | `READY FOR TESTING` | *Lead QA Director* |
| **Phase 2: Admin SKU & ERP Lookup** | Return Reports & Catalog | `READY FOR TESTING` | *Lead QA Director* |
| **Phase 3: Triage & Thermal Print** | Quick Processing Modal | `READY FOR TESTING` | *Lead QA Director* |
| **Phase 4: Credit Memo ₱10K Rule** | Finance Accounting | `READY FOR TESTING` | *Lead QA Director* |
| **Phase 5: Supplier RTV Claims** | Vendor Chargebacks | `READY FOR TESTING` | *Lead QA Director* |
| **Phase 6: SHA-256 REST API Vault** | Partner Integration (`/docs`) | `READY FOR TESTING` | *Lead QA Director* |
| **Phase 7: Free-Tier Optimization & Google Drive** | WebP Compression & Cloud Storage | `READY FOR TESTING` | *Lead QA Director* |
| **Phase 8: Column Separation & Instant Submit** | Table Views & Storage Cleanup | `READY FOR TESTING` | *Lead QA Director* |

