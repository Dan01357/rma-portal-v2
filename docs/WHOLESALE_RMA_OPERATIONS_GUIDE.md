# Wholesale RMA Portal v2 — Comprehensive Operations Manual

**Document Version:** 2.1.0  
**Target Systems:** Public Intake Portal, Warehouse Operations, Finance & Credit Accounting, Supplier RTV, Headless REST API  
**Environment:** Production (`https://rma-portal-v2.vercel.app`)  
**Database Backend:** Supabase PostgreSQL (`lschluviltzsknptwgrz.supabase.co`)  
**ERP Integration:** Laravel Cloud Enterprise Catalog (`purchase-order-db-production-ff1oho.laravel.cloud`)  

---

## Executive Summary & Workflow Lifecycle

The Wholesale RMA Portal v2 is an enterprise reverse logistics and return merchandise authorization platform engineered for high-volume wholesale distribution (covering Pingcon Marketing, Bonita Mills, Keysys Incorporated, A2Z2GO Logistics Supply, and Savemore/Liwayway supplier lines).

```mermaid
flowchart TD
    A["1. Dock Arrival & Public Scan\n(/ on Mobile/Desktop)"] --> B{"Barcode in Catalog?"}
    B -- Yes --> C["Auto-Populate Product Specs\nCapture Dock Proof & GPS\nGenerate RMA # & Box Sticker"]
    B -- No --> D["Flag as 'pending_admin_details'\nCapture Unidentified Item\nStaff Alert Dispatched"]
    C --> E["2. Physical Intake & Box Labeling\nPrint 4x6' Thermal Sticker\nAttach to Box"]
    D --> F["Admin SKU Assignment\nServerless Multi-Catalog Auto-Suggest\n(Supabase + ERPLY ERP + Wholesale)"]
    F --> C
    E --> G["3. Physical Inspection & Triage\nGrade: A/B/C/D\nDisposition: Restock / RTV / Quarantine / Scrap\nAssign Rack/Bin Location"]
    G --> H{"Claim Value > ₱10,000?"}
    H -- Yes --> I["Super Admin Authorization Required"]
    H -- No --> J["Standard Admin / Finance Approval"]
    I --> K["4. Finance Credit Memo Issuance\n12% VAT Breakdown\nIssue CM-YYYY-XXXX Voucher"]
    J --> K
    K --> L["5. Supplier Chargeback (RTV)\nBatch Debit Claims for Savemore,\nLiwayway, Pingcon & Bonita"]
    L --> M["6. Headless REST API Sync\nPrimary System, Jarmen, Jelo, Arlito\nvia SHA-256 API Key Vault"]
```

### Consolidated Enterprise Operational Architecture

The Admin Workspace provides 4 crystal-clear, segregated operational hubs:
1. **Saved Products Catalog** (`adminActiveTab === 'products'`): Verified master SKU catalog with multi-vendor auto-suggest and ERP sync.
2. **Customer RMA Hub (Inbound Logistics)** (`adminActiveTab === 'customer_reports'`): Dedicated to supermarket and store branch returns (`rma_type: 'customer_inbound'`), billing document matching (SI#/DR#/PO#), and Customer Credit Memo issuance.
3. **Supplier Hub (RTV Claims)** (`adminActiveTab === 'supplier_claims'`): Unified vendor reverse logistics for warehouse floor defects (`rma_type: 'supplier_outbound'`) and RTV dispositions (`SupplierClaimsTab.jsx`), supporting single and batch vendor debit notes with sequential RTV IDs.
4. **Finance Credit Memos** (`adminActiveTab === 'credit_memos'`): Official accounting credit memorandum ledger, 12% VAT calculations, and printable vouchers.
5. **Settings & SMTP** (`adminActiveTab === 'settings'`, Super Admin Only): API key vault, Google SMTP notification configuration, and system diagnostics.

---

## Chapter 1: Unified Role-Based QR Code & 6-Digit PIN Gatekeeper Engine

To prevent unauthorized public submissions while maintaining rapid frictionless intake for physical warehouse staff and verified customer returns, the portal employs the **Unified Role-Based QR Code & 6-Digit PIN Gatekeeper Engine**.

```mermaid
flowchart TD
    Scan["Physical Arrival:\nScan Wall Poster or Box Sticker\n(/intake/:slug)"] --> Lookup{"Profile Exists\n& is_active?"}
    Lookup -- Inactive / Missing --> Block["Block Screen:\n'QR Code Inactive / Contact Supervisor'"]
    Lookup -- Active --> CheckSession{"Valid Device Session\nCookie/Token Exists?"}
    CheckSession -- Yes --> Form["Direct Unlock:\nLoad RMA Intake Scanner\nShow Station Banner"]
    CheckSession -- No --> Pin["Mobile-First 6-Box PIN Prompt\nAuto-Advance & Auto-Verify"]
    Pin -- 5 Incorrect Attempts --> Cooldown["30-Second Lockout Cooldown\nRate-Limit Brute Force Shield"]
    Pin -- Correct PIN --> CreateSession{"Station Type?"}
    CreateSession -- "internal_warehouse\n(Dock Station)" --> PermSession["Permanent Device Session\n(duration = 0, No Expiry)"]
    CreateSession -- "external_customer\n(Carton Repack)" --> TempSession["Expiring Device Session\n(duration = 2 to 24 Hours)"]
    PermSession --> Form
    TempSession --> Form
    Root["Direct URL Access (/)\nWithout Active Session"] --> Gate["Branded Gatekeeper Screen:\n'Please scan official QR code at dock or carton'\n(Admin Login Link)"]
```

### 1.1 Database Architecture (`public.portal_access_keys`)
The security layer is backed by PostgreSQL table `public.portal_access_keys` in Supabase:
- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`: Globally unique identifier.
- `name text NOT NULL`: Station identifier (e.g., "Main Warehouse Floor", "Customer Delivery Boxes").
- `type text NOT NULL CHECK (type IN ('internal_warehouse', 'external_customer'))`: Role profile classification.
- `access_slug text UNIQUE NOT NULL`: Routing slug for printable QR URLs (`https://rma-portal-v2.vercel.app/intake/:slug`).
- `pin_code varchar(6) NOT NULL`: Secure 6-digit numeric PIN for station unlocking.
- `session_duration_hours integer DEFAULT 0`: Session lifetime (`0` = Permanent / No Expiry for internal warehouse devices; `>0` e.g. 2, 4, 24 hours for customer devices).
- `is_active boolean DEFAULT true`: Instant remote kill switch to deactivate lost posters or decommissioned boxes.
- `created_by text`, `created_at timestamptz`, `updated_at timestamptz`: Audit timestamps and creator metadata.

**Seed Profiles:**
1. **Main Warehouse Floor**: `internal_warehouse`, Slug `/intake/dock`, PIN `123456`, Duration `0` (Permanent).
2. **Customer Delivery Boxes**: `external_customer`, Slug `/intake/returns`, PIN `654321`, Duration `2` (2 Hours per device).

### 1.2 Device Session Lifespan & Expiration Model
- **Warehouse Floor Devices (`internal_warehouse`)**: Designed for shared company zebra handhelds, tablets, and dock workstations. Once the supervisor enters the 6-digit PIN (`123456`), the encrypted session token persists indefinitely in `localStorage`. Warehouse personnel can report hundreds of returns daily without repeated PIN interruptions.
- **Customer Carton Scanners (`external_customer`)**: Designed for retail store repackers scanning QR stickers taped onto delivery boxes. When scanned, the customer enters the box PIN (`654321`) and receives a strict 2-hour session. Once 2 hours elapse, the session token automatically self-terminates, preventing unauthorized subsequent submissions from outside the store.

### 1.3 Anti-Brute-Force Rate Limiting
- The PIN input utilizes a 6-box auto-advancing, mobile-optimized component.
- If an incorrect PIN is entered, the modal performs an error shake animation, clears the inputs, and decrements remaining attempts.
- If 5 consecutive failures occur within 2 minutes, the engine locks the device for **30 seconds** with a visible countdown timer, neutralizing automated brute-force attacks.

### 1.4 Admin QR Access Keys & PIN Manager UI
Restricted strictly to authenticated `SUPER_ADMIN` and `ADMIN` personnel:
- Accessible via **"QR Keys & PINs"** in the top navigation and tab bar.
- **Dynamic Profile Creation**: "+ New QR Access Code" generates custom slugs and random 6-digit PINs.
- **Instant PIN & Expiry Modification**: Administrators can change PINs or adjust expiry hours without reprinting posters.
- **High-Resolution Poster & Sticker Printing**: Renders print-ready A4 or 4x6" sheets with the generated station QR code, instructions, and an optional PIN visibility toggle.
- **1-Click Revocation**: Toggling status to `Inactive` immediately blocks all inbound scans from that profile.

### 1.5 Unbypassable Cooldown Lockout System & Anti-Fraud Architecture

To prevent duplicate returns, spam submissions, and inventory tampering by external customer reporters, the portal incorporates a server-side **Unbypassable Cooldown Lockout Engine**.

#### 1. The Multi-Vector Bypass Vulnerability Solved
Previously, client-side session expiration stored strictly in browser `localStorage` or cookies could be bypassed if a user:
1. Cleared their browser cache and history.
2. Opened an Incognito / Private browsing window.
3. Switched browsers on the same phone (e.g. Chrome to Safari, Brave, Edge, or Firefox).

#### 2. Deterministic Physical Hardware Fingerprinting
The client calculates an immutable hardware signature via `src/utils/deviceFingerprint.js`:
- Queries the physical GPU vendor & renderer string via WebGL (`UNMASKED_RENDERER_WEBGL`).
- Queries Web Audio API oscillator frequency response and sample rate.
- Analyzes hardware concurrency (CPU cores), device pixel ratio, and physical display dimensions.
- Produces a high-entropy SHA-256 hardware hash that remains **identical across Incognito tabs and different browsers on the same physical phone**.

#### 3. Database Schema (`public.device_intake_sessions`)
Backed by a high-performance Supabase tracking table:
- `id`: `uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `profile_id`: `uuid REFERENCES public.portal_access_keys(id) ON DELETE CASCADE`
- `access_slug`: `text NOT NULL` (e.g., `returns`)
- `device_fingerprint`: `text NOT NULL` (deterministic hardware hash)
- `ip_address`: `text NOT NULL` (client network IP extracted from headers)
- `session_started_at`: `timestamptz DEFAULT now()`
- `session_expires_at`: `timestamptz NOT NULL` (e.g. `NOW() + 2 hours`)
- `cooldown_until`: `timestamptz NOT NULL` (e.g. `session_expires_at + 6 hours`)
- `status`: `text CHECK (status IN ('active', 'in_cooldown', 'expired'))`

#### 4. Server-Side Verification Endpoint (`/api/v1/auth/verify-pin`)
1. Receives `{ slug, pin, deviceFingerprint }` and client IP.
2. Checks if an active cooldown exists in `public.device_intake_sessions` where `NOW() < cooldown_until`.
3. If active, rejects authentication with HTTP `429 Too Many Requests`:
   ```json
   {
     "error": "COOLDOWN_ACTIVE",
     "message": "Return Window Currently Locked",
     "cooldownRemainingMinutes": 145,
     "unlocksAt": "2026-10-29T23:30:00Z"
   }
   ```
4. Renders the **Cooldown Lockout Screen** with a live ticking countdown timer (`HH:MM:SS`), support contact button, and Supervisor Override option.

#### 5. Admin Emergency Reset / Clear Cooldowns
If an authorized customer or technician urgently needs to submit returns before the cooldown period expires, an Admin can click **"Clear Cooldowns"** on the profile in the QR Keys & PINs Manager. This calls `/api/v1/auth/clear-cooldown`, instantly releasing all device lockouts.

---

## Chapter 2: Physical Dock Arrival & Initial Intake

### 1.1 Mobile & Desktop Scanning Workflow
When a delivery truck, return pallet, or customer shipment arrives at the warehouse unloading bay, the receiving clerk or customer uses the responsive Public Intake Portal at `https://rma-portal-v2.vercel.app/`:

1. **Barcode / QR Code Capture**:
   * **Mobile Camera Scanning**: Tapping **"Scan with Phone Camera"** launches the integrated `html5-qrcode` camera overlay with automatic environment/back-camera selection (`facingMode: 'environment'`). The scanner continuously samples video frames at 10 FPS with a responsive QR viewfinder.
   * **Hardware Barcode Scanners & Keyboard Entry**: Dock stations equipped with USB or Bluetooth HID handheld laser scanners (e.g., Keysys 2D Desktop Scanner) can scan directly into the `#barcode-input` field. An automatic 300ms debounce captures Code128, EAN-13, UPC-A, and custom QR codes.
   * **Quantity Multiplier**: Clerk increments or decrements quantity using the `+` / `-` stepper buttons (minimum 1, default 1).

2. **Server-Side Catalog Resolution**:
   * The barcode is sent to the serverless proxy endpoint `GET /api/v1/products/lookup?barcode=[code]`.
   * **Priority 1**: Supabase `public.products` table (`barcode = code` or `code = code`).
   * **Priority 2**: ERPLY POS/ERP live cloud catalog (`/data/erply_products` indexed across `ean_code`, `code2`, and SKU `code`).
   * **Priority 3**: Verified Wholesale Catalog fallback (`BON-FT-200`, `KEY-POS-T1`, `A2Z-BOX-M`, etc.).
   * If recognized, product name, net unit price, 12% VAT price, supplier, unit of measure (`pc`, `box`, `roll`, `unit`), and assigned Customer Account Executive (AE) auto-populate instantly.
   * If uncatalogued, the portal flags the submission as `Unidentified Item`, allowing intake to continue without blocking dock operations while queueing the item for Admin SKU enrichment.

3. **Tap-First Dual-Zone Photo Capture & Google Drive Subfolder Architecture**:
   * **Zone 1: Damaged Product Photo (Required)**: Max 3 photos of damaged carton, crushed packaging, or broken product seals. Files are compressed via client-side WebP canvas to $< 180\text{KB}$.
   * **Zone 2: Official Paperwork Photo (Required - Zero Typing UX)**: Warehouse clerks snap the paper Delivery Receipt (DR), Sales Invoice (SI), or Purchase Order (PO). The caption instructs: *"Don't type numbers! Snap your paper delivery receipt, DR, invoice, or PO."* Both product and paperwork photos are mandatory for submission.
   * **Automated Hierarchical Google Drive Storage**: Rather than dumping files into a single flat directory, images are sorted into structured nested folders:
     ```
     Root: "Wholesale RMA Records"
       └── [YYYY-MM] (e.g. 2026-10)
           └── [RMA_NUMBER] (e.g. RMA-20261030-9841)
               ├── 01_Damaged_Items/ (stores photos of defective products)
               └── 02_Official_Paperwork/ (stores verified DR, SI, and PO photos)
     ```
   * Public preview URLs (`https://lh3.googleusercontent.com/d/{fileId}`) are saved directly to `rma_reports.photos` and `rma_reports.paperwork_photos`.
   * **Full Lifecycle Google Drive Asset Deletion**: When an administrator permanently deletes an RMA report (single or bulk), the system calls the Google Drive API (`DELETE` / `trashed: true`) to purge the entire dedicated RMA folder (`google_drive_folder_id`) and all nested photos, leaving zero orphaned files.

4. **Gemini Flash AI Paperwork Inspector & Unbiased Store / Branch Auto-Fill**:
   * **Instant Serverless OCR (`/api/v1/ai/inspect-paperwork`)**: Invokes Google Gemini Flash (`gemini-2.5-flash`) to validate document authenticity and extract `invoice_dr_number`, `store_branch`, `vendor_name`, and `detected_date`.
   * **Anti-Fraud Rejection Gate**: If a user uploads non-paperwork (food, floor, face, or unrelated item), the card shakes (`animate-shake`), the input clears, and a warning alert instructs the user to provide an official logistics receipt.
   * **Unbiased Store / Branch Location**: Manual input field with zero supplier bias (no hardcoded favoritism or preset dropdowns). If Gemini Flash detects the store/branch from the attached paperwork, it automatically populates the field with an *"Auto-filled from Paperwork"* indicator, while allowing the user to freely type or modify.
   * **Persistent Local Contact Info**: Reporter name and contact phone/email are cached in `localStorage` (`rma_reporter_name`, `rma_reporter_contact`), saving repeat drivers and warehouse clerks from ever having to re-type contact info.

5. **Accurate Dock GPS Geofencing Threshold Check**:
   * The portal invokes `navigator.geolocation.getCurrentPosition()` with `{ enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }`.
   * **Anti-False Coordinate Filter**: Desktop computers and office Wi-Fi routers frequently return cellular/IP-approximated coordinates with inaccuracies exceeding 500–5,000 meters. The portal strictly enforces an accuracy threshold:
     ```javascript
     const isAccurateGps = pos.coords.accuracy <= 150; // Must be within ±150 meters
     ```
   * If accuracy is within 150m (physical mobile hardware GPS at the dock), `gps_latitude` and `gps_longitude` are recorded.
   * If accuracy exceeds 150m, false coordinates are rejected and stored as `null` to maintain 100% audit integrity.

6. **RMA Authorization Generation**:
   * Upon submission, the database generates an enterprise RMA number formatted as:
     `RMA-YYYY-MMDD-XXXX` (e.g., `RMA-2026-1028-9B2F`).
   * The record is committed to `public.rma_reports` with initial status `received_at_dock` (or `pending_admin_details` if uncatalogued).
   * An initial audit trail event is appended to `audit_trail`:
     ```json
     {
       "timestamp": "2026-10-28T08:15:00.000Z",
       "stage": "INTAKE",
       "actor": "Danilo Alvaro Jr.",
       "note": "RMA intake recorded at warehouse dock"
     }
     ```

7. **Instant Box QR Sticker**:
   * The success screen provides an immediate **"Save Sticker (PNG)"** button.
   * Renders a 1200x1600 canvas sticker with:
     * High-contrast QR code pointing to `https://rma-portal-v2.vercel.app/?rma=RMA-...`
     * Auto-scaled RMA number (26px–54px dynamic sizing to strictly prevent QR frame overlap)
     * Wrapped 2-line item description (up to 960px width)
     * Defect reason, quantity, reporter, and supplier pill
     * Dashed cut lines for affixing directly onto outer cartons.

---

## Chapter 2: Admin SKU Enrichment & Catalog Synchronization

When an uncatalogued item arrives, warehouse staff are never blocked from receiving physical stock. The system handles enrichment through a unified workflow.

### 2.1 Detection & Identification
1. Unidentified returns receive the amber badge `Pending Unknown` in the Admin **Return Reports** table.
2. The KPI counter **"Pending Unknown Barcodes"** on the dashboard highlights items awaiting catalog assignment.
3. Clicking **"Pending Unknown Barcodes"** opens the dedicated batch triage modal with instant search, pagination, and photo lightbox verification.

### 2.2 Server-Side Auto-Suggest & Enrichment
When an admin clicks **"Assign SKU"** from either:
- The Return Reports table row,
- The Mobile grid card,
- The Quick RMA Processing modal, or
- The Pending Barcodes modal:

The unified **`ProductEditModal`** opens with pre-filled barcode details:
1. **Live Multi-Catalog Auto-Suggest (`ProductAutoSuggest`)**:
   * Typing into either the **Product Name** or **SKU / Item Code** fields initiates a 300ms debounced server query.
   * Calls `/api/v1/products/lookup?search=[query]&limit=30` using the server's private ERP credentials.
   * Searches live ERPLY catalog (5,793+ wholesale SKUs) and local catalog simultaneously.
   * Selecting a suggested item instantly auto-populates:
     * Official SKU / Code (e.g., `BON-KT-2R`, `MH117P`)
     * Clean Catalog Name
     * Supplier Name (e.g., `Bonita Mills Inc.`, `Savemore`, `Liwayway Marketing`)
     * Net Unit Price & 12% VAT Price (`priceWithVat = price * 1.12`)
     * Unit of measure (`pc`, `box`, `pack`, `roll`)
2. **Customer Account Executive (AE) Assignment**:
   * System enforces mandatory assignment of an Account Executive from the employee directory:
     * Jaezelle Benito (`jaezelle.benito@pingconmarketing.com`)
     * Mary Jane Gan (`mgan@pingconmarketing.com`)
     * Arlito Gan (`azgan@pingconmarketing.com`)
3. **Database Cascading Update**:
   * Saving the product writes to `public.products` (upsert on `barcode`).
   * Automatically executes a cascading update across `public.rma_reports`:
     ```sql
     UPDATE public.rma_reports
     SET name = $name, code = $sku, price = $price, price_with_vat = $vat,
         supplier_name = $supplier, unit_name = $unit, ae_name = $ae_name,
         ae_email = $ae_email, status = 'logged'
     WHERE barcode = $barcode AND status = 'pending_admin_details';
     ```
   * Dispatches automated email notification to the assigned AE and management CCs containing product photo, return quantity, defect reason, and customer details.

---

## Chapter 3: Physical Inspection, Triage & 4x6" Thermal Printing

Once merchandise is physically sorted at the inspection benches, warehouse inspectors record physical condition and storage routing.

### 3.1 Direct Access from Return Reports Table
Inspectors do not need to switch tabs or scan codes again:
- **Clicking anywhere on a report row** in the Return Reports table opens the **Quick RMA Processing Modal**.
- **Clicking the RMA number link** (`RMA-2026-...`) opens the modal.
- **Clicking the "Inspect / Triage" button** opens the modal.

### 3.2 Condition Grading Standards
Inspectors select from 4 enterprise condition grades:
* **Grade A — Like New / Resellable**: Pristine factory packaging, seals intact. Suitable for immediate restocking to active pick locations.
* **Grade B — Damaged Packaging Only**: Carton crushed, torn exterior box, but inner product 100% intact and non-expired. Suitable for repackaging or discount wholesale clearance.
* **Grade C — Defective / Parts Only**: Electrical failure, broken components, leakage. Requires Return to Vendor (RTV) debit claim or component salvage.
* **Grade D — Total Loss / Scrap**: Expired food items, shattered glass, contaminated chemicals. Hazardous waste or authorized destruction.

### 3.3 Warehouse Disposition Routing
Inspectors select the physical disposition route:
1. **Restock to Inventory**: Generates positive inventory adjustment in WMS/ERP.
2. **Return to Vendor (RTV)**: Queues item for Chapter 5 Supplier Debit Claims.
3. **Quarantine**: Holds item pending manufacturer rep inspection or safety audit.
4. **Scrap / Dispose**: Marks item for certified destruction certificate.

### 3.4 Rack & Bin Location Tagging
Inspectors input the physical warehouse address (e.g., `RACK-03-BIN-A`, `BAY-2-PALLET-09`, `QUARANTINE-LOCKER`). This prints directly on box labels for pickers.

### 3.5 4x6" Thermal Box Label Printing
Tapping **"Print 4x6" Label"** launches the thermal printing layout engineered specifically for standard 4x6-inch (101.6mm x 152.4mm) direct thermal label printers (Zebra, TSC, Rongta, Xprinter):
* High-density Code128 machine-scannable barcode (`*RMA-YYYY-MMDD-XXXX*`)
* High-contrast 2D QR Code linking to digital audit trail
* Prominent Condition Grade and Disposition Callouts
* Assigned Rack/Bin location in 24pt bold monospaced typography
* Inspector name and timestamp
* Automatic audit trail logging in `rma_reports.audit_trail` (`stage: 'THERMAL_PRINT'`).

---

## Chapter 4: Finance Credit Memo Issuance & Threshold Governance

### 4.1 Credit Memo Calculation & VAT Rules
Finance officers review triaged returns to approve credit deductions for customers.
1. **Base Value**: Quantity $\times$ Unit Price (inclusive of 12% Philippine VAT).
   $$\text{Gross Amount} = \text{Quantity} \times \text{Price with VAT}$$
   $$\text{Net Amount} = \frac{\text{Gross Amount}}{1.12}$$
   $$\text{VAT Amount} = \text{Gross Amount} - \text{Net Amount}$$
2. **Deduction Percentage Buttons**: Quick-selection chips automatically calculate approved credit amounts:
   * **100%**: Full refund / credit for factory defects.
   * **75% / 50% / 25%**: Pro-rated credits for partial box returns, handling fees, or expired returns.
3. **Pull-Out Reference Number (POR)**: Automatically generated in enterprise format:
   `POR-YYYY-XXXX-XXXX` (e.g., `POR-2026-0004-8E1A`).

### 4.2 Multi-Tier Financial Governance (₱10,000 Rule)
To prevent unauthorized credit issuance on large wholesale claims:
* **Claims $\le$ ₱10,000**: Standard Admins, Inventory Staff, and Finance Officers can approve and issue the credit memo immediately.
* **Claims $>$ ₱10,000 (High-Value Claims)**:
  * The system locks the **"Issue Credit Memo"** action button.
  * Displays an amber alert:
    > `High-Value Claim (> ₱10,000.00). Super Admin authorization required to issue credit memo.`
  * Only users authenticated with the **`super_admin`** role can approve and issue the credit memo.

### 4.3 Official Printable Credit Memo Voucher
Issued credit memos generate an official voucher (`CM-YYYY-XXXX`) compliant with BIR/wholesale accounting:
* Two-tone formal header with company seal
* Linked RMA number, Pull-Out Reference (POR), Pull-Out Date
* Line items with Gross Price, Net Price, 12% VAT amount, and Total Credit
* Triple signature blocks:
  1. *Prepared By (Warehouse/Dock)*
  2. *Verified By (Finance & Accounting)*
  3. *Approved By (General Manager / Super Admin)*
* One-click PDF / Print preview with bulk multi-voucher batch printing support.

---

## Chapter 5: Supplier Chargebacks & Return to Vendor (RTV)

When goods are triaged with disposition **"Return to Vendor (RTV)"**, the financial loss is charged back to the originating manufacturer or distributor.

### 5.1 Supported Supplier Accounts
* **Savemore / SM Markets**: High-volume retail returns (packaged foods, beverages, household supplies).
* **Liwayway Marketing Corporation**: Oishi snack and confectionery products.
* **Bonita Mills Inc.**: Facial tissue, kitchen towels, bathroom tissue, and hygiene lines.
* **Keysys Incorporated**: POS hardware, thermal receipt printers, and barcode scanners.
* **A2Z2GO Logistics Supply**: Packaging straps, cartons, and warehouse consumables.

### 5.2 Batch Claim Aggregation & Debit Note Generation
In the **Supplier Claims (RTV)** tab:
1. Filter returns by specific supplier (e.g., *Liwayway Marketing*).
2. Multi-select returned items using checkboxes.
3. The dashboard calculates:
   * Total Selected Items Count
   * Total Physical Units
   * Total Claim Debit Value (₱)
4. Tapping **"Generate RTV Debit Claim"** bundles selected returns into a formal supplier chargeback claim.
5. Export formal CSV reports for supplier credit accounting or print supplier debit vouchers.

---

## Chapter 6: Headless REST API Architecture (Enterprise System Integration)

The RMA Portal provides a secure, headless OpenAPI 3.1 REST API allowing external ERPs, warehouse management systems, and partner software to integrate seamlessly.

### 6.1 Integrated Partner Systems & Key Vault
API access is governed by the SHA-256 Key Vault in `public.api_keys`. Secret keys are generated using cryptographically secure random bytes:
`rma_live_[32 characters]` (e.g., `rma_live_demo_hash_vault_key_2026`).

Only the SHA-256 hash is stored in the database. The plain key is displayed **once** upon generation.

| Partner System ID | Name | Role | Permitted Endpoints |
| :--- | :--- | :--- | :--- |
| `primary` | Primary System (Mine) | Internal Central System | Full Read/Write (`/api/v1/*`) |
| `jarmen` | Jarmen | Partner Wholesale System | Products, RMA Submission, Status |
| `jelo` | Jelo | Partner Operations System | RMA Intake, Triage, Physical Disposition |
| `arlito` | Arlito | Partner Inventory System | Catalog Query, Credit Memos Read |

### 6.2 Authentication Header
All REST requests must include the API key in the `X-API-Key` HTTP header:
```http
GET /api/v1/rma HTTP/1.1
Host: rma-portal-v2.vercel.app
X-API-Key: rma_live_demo_hash_vault_key_2026
Accept: application/json
```

### 6.3 Endpoints Reference Map
All API routes are served under `https://rma-portal-v2.vercel.app`:

| Method | Endpoint | Auth | Purpose |
| :--- | :--- | :---: | :--- |
| `GET` | `/docs` | Public | Interactive Scalar OpenAPI 3.1 Reference & Swagger UI |
| `GET` | `/api/openapi.json` | Public | Machine-readable OpenAPI 3.1 JSON Specification |
| `GET` | `/api/v1/health` | Public | Real-time database & SMTP health check |
| `GET` | `/api/v1/products/lookup` | Public/Proxy | Barcode & SKU lookup across Supabase & ERPLY |
| `GET` | `/api/v1/products` | `X-API-Key` | Search & list wholesale product master catalog |
| `POST` | `/api/v1/products` | `X-API-Key` | Create or update product item specs |
| `GET` | `/api/v1/products/:id` | `X-API-Key` | Get single product by numeric ID or barcode |
| `PATCH` | `/api/v1/products/:id` | `X-API-Key` | Update product price, AE, or details |
| `DELETE`| `/api/v1/products/:id` | `X-API-Key` | Delete product from catalog |
| `GET` | `/api/v1/rma` | `X-API-Key` | List return reports with pagination & filters |
| `POST` | `/api/v1/rma` | `X-API-Key` | Submit programmatic RMA return ticket |
| `GET` | `/api/v1/rma/:id` | `X-API-Key` | Retrieve single RMA report & triage specs |
| `PATCH` | `/api/v1/rma/:id` | `X-API-Key` | Update triage grade, disposition, or rack/bin |
| `DELETE`| `/api/v1/rma/:id` | `X-API-Key` | Super admin delete RMA report |
| `GET` | `/api/v1/credit-memos` | `X-API-Key` | List finance credit memos |
| `POST` | `/api/v1/credit-memos` | `X-API-Key` | Issue official credit memo (enforces ₱10K rule) |
| `GET` | `/api/v1/credit-memos/:id` | `X-API-Key` | Retrieve credit memo voucher details |
| `POST` | `/api/v1/api-keys` | Super Admin | Generate & issue new SHA-256 partner key |
| `PATCH` | `/api/v1/api-keys/:id` | Super Admin | Toggle key status, update rate limit |
| `DELETE`| `/api/v1/api-keys/:id` | Super Admin | Revoke partner API key |

### 6.4 Rate Limiting & Security Governance
* Default rate limit is **60 requests per minute** per key (configurable up to 300 req/min).
* Rate limits are tracked in-memory with automatic `429 Too Many Requests` status codes and `Retry-After: 60` headers.
* Key usage timestamps (`last_used_at`) update automatically on valid invocations.

---

## Chapter 7: Sandbox Test Mode vs. Live Operations

To ensure dock staff and administrators can train without corrupting production accounting:
1. **Strict Super Admin Gating**: Test Mode is strictly accessible only when authenticated as `super_admin`.
2. **Visual Awareness Banner**: When active, a prominent amber bar warns:
   > `⚡ Super Admin Sandbox Active — Submissions will simulate without sending real emails or dispatching warehouse stock.`
3. **Email Interception**: During test mode, email notifications are routed exclusively to `finance2@keysysincorporated.com` with a `[TEST SIMULATION]` subject prefix. Real customer and AE emails are completely blocked.
4. **Dock Worker Protection**: Unauthenticated mobile phone scans and dock staff tablets are **100% locked to Live Mode**, ensuring real incoming customer returns are never misfiled as simulations.

---

## Chapter 8: Role-Based QR Gatekeeper & 6-Digit PIN Authorization Workflow

To prevent unauthorized public access while simplifying return submission for approved customer supermarket branches and warehouse intake docks, the portal utilizes a role-based QR gatekeeper engine paired with an automated request and approval workflow.

### 8.1 Station Architecture & Profile Types
1. **Internal Warehouse Dock (`internal_warehouse`)**:
   - Deployed on dock wall posters (e.g. `/intake/dock`).
   - Default PIN: `123456`.
   - Session duration: `0` (Permanent / No Expiry) so warehouse dock scanners remain permanently unlocked once authenticated.
2. **External Customer Carton Stickers (`external_customer`)**:
   - Printed dynamically on adhesive carton labels or packing slips (e.g. `/intake/returns`).
   - Default PIN: `654321`.
   - Session duration: Configurable (e.g. 2 hours, 4 hours, or custom minutes/hours) to ensure customer devices expire after return processing.

### 8.2 Automated PIN Request & Approval Workflow
When an external store reporter or driver scans a QR code without knowing the authorization PIN:
1. **Scanner Prompt**: The user scans the QR code via Google Lens and lands on `/intake/:slug`.
2. **Request Access Option**: Directly beneath the 6-digit PIN boxes, the user clicks *"Don't have the 6-digit PIN? Request Access Here"*.
3. **Information Submission**: The reporter enters their work email, full name, supermarket/store location (e.g. *Savemore Market Branch 5*), and optional delivery notes.
4. **Admin Queue Notification**: The request is instantly logged in `public.pin_requests`. Admin dashboards display a live notification badge: `PIN Requests (X pending)`.
5. **One-Click Approval & SMTP Dispatch**:
   - Admin opens the Pending PIN Requests Queue and clicks `[ Approve & Dispatch PIN ]` (or batches multiple requests via "Approve Selected").
   - System fetches the active 6-digit PIN for that profile and sends a branded HTML email via Google SMTP (`api/send-email.js`).
   - The email contains a prominent 6-digit PIN box, instructions, and a direct portal link.
6. **PIN Reuse Protocol**:
   - The store user enters the 6-digit PIN to unlock the intake form.
   - For all future damaged returns under that QR profile, they **do not need to request access again**—the approved PIN remains valid.

### 8.3 Sandbox Test Mode Bypass
For rapid developer and QA testing:
- When **Test Mode: ON** is active, submitting a PIN request immediately reveals the station's active 6-digit PIN on-screen in an amber sandbox banner with an *Auto-Fill PIN & Unlock Now* shortcut.
- Dispatched emails in Test Mode are safely rerouted exclusively to `finance2@keysysincorporated.com`.

---

## Chapter 9: Gemini Flash Paperwork Inspection & Hierarchical Google Drive Storage

To eliminate manual data entry for warehouse handlers and prevent fraudulent or invalid return claims, the portal integrates **Google Gemini Flash** multimodal AI with structured Google Workspace Drive storage.

### 9.1 Gemini Flash Paperwork Validator & OCR Engine
- **Endpoint**: `/api/v1/ai/inspect-paperwork` (powered by `@google/genai` and `gemini-2.5-flash`).
- **Input**: Base64 or URL of captured paperwork image.
- **Strict Verification Rules**:
  1. **Valid Document Criteria**: The uploaded image must be an authentic logistics document:
     - Delivery Receipt (DR)
     - Sales Invoice (SI)
     - Purchase Order (PO)
     - Official Pull-Out / Credit Slip
  2. **Automated Rejection**: If the user uploads a selfie, face, floor, furniture, food produce only, or blank box without paperwork, Gemini returns `is_valid_document: false` with a clear explanation:
     > *"Photo does not appear to be an official invoice, DR, or PO."*
  3. **Frontend Rejection Behavior**: The uploader card performs a CSS shake animation (`.animate-shake`), highlights in red, and displays:
     > *"Invalid document photo: Please take a clear picture of the paper delivery receipt or invoice."*
  4. **Zero-Typing UX**: For valid documents, Gemini extracts the `invoice_dr_number`, `store_branch`, `detected_date`, and `vendor_name`, displaying a verified green badge:
     > `✓ Verified Delivery Receipt (DR-2026-8812) • 95% AI Confidence`
     The DR number and store branch are auto-filled into the return ticket behind the scenes.

### 9.2 Structured Google Drive Storage Hierarchy
Rather than saving proof photos in a flat unorganized folder, the upload service (`/api/upload-photo`) organizes all incoming media in a structured directory tree:

```
Root Folder: "Wholesale RMA Records"
  └── [YYYY-MM] (e.g. 2026-10)
      └── [RMA_NUMBER] (e.g. RMA-20261030-9841)
          ├── 01_Damaged_Items/ (stores photos of defective goods)
          └── 02_Official_Paperwork/ (stores verified DR, SI, and PO photos)
```

- **Database Preservation**:
  - `rma_reports.photos`: Array of URLs for damaged item photos.
  - `rma_reports.paperwork_photos`: Array of URLs for verified paperwork documents.
  - `rma_reports.google_drive_folder_url`: Direct link to the RMA folder in Google Drive.
- **Admin Portal Access**: In `QuickRMAActionModal`, warehouse supervisors and finance managers can click **"Open RMA Drive Folder"** to inspect the organized media and view the AI-extracted metadata.
- **Manual Override**: If Gemini misread a handwritten digit on a carbon copy receipt, Admins can click **"Edit DR# / Branch"** to manually update the record with instant database synchronization.

---

## Chapter 10: Operational Separation — Inbound Customer Logistics vs Outbound Supplier Reverse Logistics

To satisfy enterprise supply chain compliance (aligned with SAP ERP, Oracle SCM, and FMCG distributor standards), the portal provides clean operational segregation between **Inbound Customer Logistics** and **Outbound Supplier Reverse Logistics (RTV)**.

### 10.1 Key Operational Differences

| Operational Domain | Inbound Customer Returns (`customer_inbound`) | Outbound Supplier Claims (`supplier_outbound` / RTV) |
| :--- | :--- | :--- |
| **Origin Station** | Customer Stores / Branches (Savemore, Puregold, Robinson's) | Internal Warehouse Floor & Dock Bays |
| **Primary Goal** | Validate customer defect claims & issue accurate Credit Memos | Recover financial loss via vendor chargebacks & debit notes |
| **Intake Mechanism** | Customer Delivery Carton QR Sticker (`/intake/returns`) | Internal Warehouse Floor Dock Poster (`/intake/dock`) |
| **Key Commercial Docs** | Customer Sales Invoice (SI), Delivery Receipt (DR), Customer PO | Supplier PO, Vendor Delivery Note, Batch/Lot Number |
| **Financial Instrument** | **Customer Credit Memo Voucher** (Deduction from accounts receivable) | **Supplier Debit Claim Note** (Chargeback against vendor accounts payable) |
| **Admin Hub Tab** | `Customer RMA Hub (Inbound)` (`adminActiveTab: 'customer_reports'`) | `Supplier RMA Hub (Outbound / RTV)` (`adminActiveTab: 'supplier_claims'`) |
| **CSV Export Report** | `Customer_Inbound_RMAs_[Date].csv` (Branch, DR#, AE Name, Credit Memo #) | `Supplier_Outbound_Claims_[Date].csv` (Supplier, Bin, Batch/Lot#, Purchase Price) |

### 10.2 Zero-Typing Automatic Attribution Engine
- **Gatekeeper Profile Detection**: When a user scans a station QR code or inputs an authorized 6-digit PIN, the portal creates a gatekeeper session (`gateSession.type`).
  - Profile `external_customer` $\rightarrow$ automatically logs `rma_type: 'customer_inbound'`.
  - Profile `internal_warehouse` $\rightarrow$ automatically logs `rma_type: 'supplier_outbound'`.
- Drivers and store personnel do zero configuration or categorizing; the station QR guarantees accurate logistics attribution.

### 10.3 Quick Processing Reclassification & Triage Governance
- If an authorized warehouse supervisor inspects an item and discovers it was filed under the wrong logistics category, they can open `QuickRMAActionModal`.
- At the top of the modal, the **Logistics Classification Switcher** allows 1-click reclassification:
  `[ 📥 Customer Return (Inbound) ]` $\longleftrightarrow$ `[ 📤 Supplier Claim (Outbound / RTV) ]`
- Toggling this switcher executes an optimistic UI update, changes `rma_type` in Supabase via `catalogService.updateRMAType`, and appends an entry to `rma_reports.audit_trail`. The record shifts seamlessly into the appropriate hub table without page reload.


