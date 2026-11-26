import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { registerHealthRoutes } from './schemas/health.schema.js';
import { registerRMARoutes } from './schemas/rma.schema.js';
import { registerProductRoutes } from './schemas/products.schema.js';
import { registerCreditMemoRoutes } from './schemas/creditMemos.schema.js';
import { registerApiKeyRoutes } from './schemas/apiKeys.schema.js';

/**
 * Builds the Code-First OpenAPI 3.1 Specification dynamically.
 * Whenever routes or Zod schemas are edited/added/removed in code,
 * this registry regenerates the full OpenAPI document automatically.
 */
export function generateCodeFirstOpenApiSpec() {
  const registry = new OpenAPIRegistry();

  // 1. Register Global Security Schemes
  registry.registerComponent('securitySchemes', 'ApiKeyHeader', {
    type: 'apiKey',
    in: 'header',
    name: 'x-api-key',
    description: 'Pass secret key via x-api-key header'
  });

  registry.registerComponent('securitySchemes', 'BearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'API-Key',
    description: 'Pass secret key via Authorization: Bearer <key>'
  });

  // 2. Register all Route Schemas (Code-First)
  registerHealthRoutes(registry);
  registerRMARoutes(registry);
  registerProductRoutes(registry);
  registerCreditMemoRoutes(registry);
  registerApiKeyRoutes(registry);

  // 3. Generate OpenAPI 3.1 Document
  const generator = new OpenApiGeneratorV31(registry.definitions);

  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Wholesale RMA Multi-System REST API',
      version: '1.0.0',
      description: `
**Code-First & Schema-Driven REST API** for Wholesale RMA Portal v2.
Built with Zod & \`@asteasolutions/zod-to-openapi\`.

### 4 Authenticated Client Systems:
- **Primary System (Mine)**
- **Jarmen**
- **Jelo**
- **Arlito**

### Authentication:
Pass your secret API key in all requests:
- \`x-api-key: sk_live_rma_...\`
- Or \`Authorization: Bearer sk_live_rma_...\`

### 🧪 Coworker Simulation & Test Mode vs Live Mode:
- **🟢 Live Production Mode**:
  Requests made with live keys (\`sk_live_...\`) or without test flags operate directly on production books. Live returns appear in **Customer RMA Hub** or **Supplier Hub**.
- **🧪 Test Mode Sandbox (Safe Isolation)**:
  Coworkers can simulate inventory restocks, supplier re-orders, driver pickups, and consolidated credit memos safely without touching live financial ledgers or triggering live customer/boss emails. Test Mode emails honor customizable Admin-only per-email recipient profiles (\`rma_settings.test_email_recipients\` & \`rma_settings.test_email_recipients_by_type\`, defaulting to Sandbox \`mgan@pingconmarketing.com\`, **never exposed on public \`/\`**) with \`[TEST] \` as the very first subject word, and support Test Mode \`.xlsx\` reply ingestion (\`RMA-TEST-...\` strict Test-to-Test isolation):
  1. **Query Param**: Add \`?test_mode=true\` (e.g. \`GET /api/v1/rma?test_mode=true\`)
  2. **HTTP Header**: Pass \`x-test-mode: true\`
  3. **POST Payload**: Include \`"is_test": true\`
  4. **API Keys**: Test keys prefixed with \`sk_test_...\` automatically route to the Test Sandbox.
- **📅 Unambiguous ISO Date Standard**:
  All portal views, emails, US Letter B&W printables, and \`.xlsx\` Matrix exports use unambiguous \`YYYY-MM-DD\` and \`YYYY-MM-DD HH:mm\` (Asia/Manila) formatting.
- **🚀 Simulating Connections via Scalar Documentation (/docs)**:
  1. Click **"Authorize"** in the top right and paste your API key (\`sk_test_...\` or \`sk_live_...\`).
  2. Select an endpoint (e.g. \`GET /api/v1/rma\` or \`POST /api/v1/rma\`).
  3. Set \`test_mode\` to \`true\` in query parameters.
  4. Click **"Send Request"** to execute real HTTP queries directly against the Vercel backend.

### 📄 Standard Commercial Documents (SI, DR, PO):
All endpoints support and return standardized commercial logistics references:
- \`si_number\`: Sales Invoice Number
- \`dr_number\`: Delivery Receipt Number
- \`po_number\`: Purchase Order Number

### 📦 4-Pillar Operations & Coworker Inventory Integration Guide:

#### 1. 🟢 Ready to Restock Queue (?queue=restock):
If you are syncing returned goods back into your warehouse inventory:
1. **Query Pending Restock Items**:
   Send \`GET /api/v1/rma?queue=restock\`
   Retrieves all items that warehouse inspection approved for restocking with quantities and bin locations.
2. **Update Inventory & Acknowledge**:
   Once added to your ERP stock, send \`PATCH /api/v1/rma/{id}\` with body:
   \`\`\`json
   {
     "status": "resolved",
     "workflow_resolution": "restocked",
     "disposition": "2- Restock to Inventory",
     "warehouse_location": "RACK-03-BIN-A",
     "notes": "Added to inventory counts in ERP"
   }
   \`\`\`
   *(Passing \`"status": "restocked"\` is also supported and automatically resolved safely without Supabase constraint errors).*
   This marks the ticket as **6- Restocked** so it won't be double-counted.

#### 2. 🔄 Supplier Re-Order Queue (?queue=reorder):
If you need to know which items were lost/scrapped so your procurement system can re-order replacement stock from suppliers:
1. **Query Re-Order Needed Items**:
   Send \`GET /api/v1/rma?queue=reorder\`
   Retrieves all items that were flagged for replenishment with \`needs_reorder: true\`.
2. **Place Replacement PO & Acknowledge**:
   Once your procurement system places a replacement Purchase Order to the supplier, send \`PATCH /api/v1/rma/{id}\` with body:
   \`\`\`json
   {
     "status": "resolved",
     "workflow_resolution": "reordered",
     "disposition": "5- Scrap / Dispose",
     "notes": "Replacement supplier PO #PO-2026-9901 issued."
   }
   \`\`\`
   This marks the ticket as **7- Re-Ordered (PO Placed)**.

#### 3. 🚫 No Re-Order / Write-Off Queue (?queue=scrap_no_reorder):
If you need to audit items marked for disposal without placing a replacement supplier purchase order:
1. **Query Write-Off Items**:
   Send \`GET /api/v1/rma?queue=scrap_no_reorder\`
   Retrieves all items where \`needs_reorder: false\`.
2. **Confirm Scrap & Acknowledge**:
   Send \`PATCH /api/v1/rma/{id}\` with \`workflow_resolution: "scrapped_no_reorder"\`.
   This marks the ticket as **7- Scrapped / Written Off**.

#### 3. 🟣 Vendor Recovery / Outbound RTV Queue (?queue=rtv_debit):
Send \`GET /api/v1/rma?queue=rtv_debit\` to retrieve merchandise queued for return to vendor recovery claims (including single & multi-RMA consolidated \`RTV-\` / \`RTV-TEST-\` claims and \`picked_up\` driver handovers).

#### 4. 🟡 Legacy Hold / Quarantine Query Filter (?queue=quarantine):
Retained for backwards-compatible REST API clients only; the streamlined portal UI routes returns directly through the **4-Choice Outcome & 5-Photo Driver Pickup Wizard** (Debit Claim, Replacement / Exchange, Scrap, or Good Stock Restock).

#### 5. Dual Logistics Streams, Multi-RMA Consolidation & Batch Manifests:
- **\`rma_type: "customer_inbound"\`**: Customer / branch store returns awaiting 4-Choice disposition, restock, or single/consolidated Credit Memo issuance (collects \`store_branch\`).
- **\`rma_type: "supplier_outbound"\`**: Defective merchandise batched for outbound Return to Vendor (RTV) recovery, 5-photo driver pickup verification with US Letter B&W PDF forms, and shared multi-RMA \`RTV-\` claims (**\`store_branch\` is completely omitted and saved as \`null\`** across submission UI, Quick Actions, \`RmaEmailEditorView\`, New RMA/lifecycle emails, and Supplier Claims \`.xlsx\`).
- **Multi-Item Batch Manifests**: Batched returns are represented with \`is_parent: true\`, \`items\` (JSONB breakdown of line items), \`total_items\`, and \`total_quantity\`. Child records link via \`parent_rma_id\`.
- **Dual-Stream 4-Choice Outcome & Multi-Photo Pickup Forms**:
  - **Customer Hub (\`customer_inbound\`)**: \`customer_credit\` (*Customer Credit Memo / Return Handover*), \`customer_exchange\` (*Customer Buffer Replacement / Good Stock Exchange*), \`scrap\` (*Throw Away / Dispose*), \`restock_good\` (*Put Back on Good Shelf*). Renders plain black-and-white US Letter (\`8.5in x 11in\`) \`CUSTOMER CREDIT MEMO / RETURN HANDOVER FORM\` and \`CUSTOMER BUFFER REPLACEMENT & HANDOVER FORM\`.
  - **Supplier RTV (\`supplier_outbound\`)**: \`supplier_credit\` (*Debit Claim*), \`supplier_exchange\` (*Replacement / Exchange*), \`scrap\`, \`restock_good\`. Renders \`SUPPLIER DEBIT CLAIM & PICKUP VALIDATION FORM\` and \`SUPPLIER REPLACEMENT / EXCHANGE & PICKUP FORM\`.
  - **Custom Multi-Copy B&W Printables**: Both \`SupplierPickupFormModal\` and \`CreditMemoVoucherModal\` support separated full pages vs combined dual-copy cut sheets and customizable \`ourCopyCount\` + \`counterpartyCopyCount\` (e.g., \`2 Ours + 2 Customer = 4 copies\`).
  - **Driver Pickup Multi-Photos & OCR**: Supports \`string[]\` arrays up to **10 photos per slot (50 max across 5 categories)** (\`driver_license_front\`, \`driver_license_back\`, \`truck_plate\`, \`driver_handover\`, \`pickup_items\`), accepts any valid **Philippine Gov't / Legal ID**, runs Truck Plate OCR via \`POST /api/upload-photo?action=inspect-plate\`, requires manual \`processed_by\` entry, and sends \`pickup_debit_claim\` emails with item \`explanation\` included and \`Store / Branch\` + \`Warehouse Location\` omitted.
- **Unified Printable QR Card & Multi-Select Studio (\`ReturnQRModal.jsx\`)**: Single centered source of truth rendered inside \`#rma-qr-batch-sheet-root\` and printed strictly via isolated \`iframe.srcdoc\` (\`printIsolatedElement\`, never main-window \`window.print()\`) for \`Save QR (PNG)\` and \`Print QR\` showing **Quantity & Unit** cleanly with **no Supplier Name**, plus US Letter default 1-page / multi-page consolidated packing, independent per-QR mm/scale sizing, Public Portal / QR Studio **\`Add More RMA QRs\`** (\`➕ Add More RMA QRs to Sheet\` + \`Add Recent Session QRs\`), and a **\`Consolidated (1 QR per RMA)\` *(default)* vs \`Single / Per-Item QRs (1 QR per Item)\`** segmented toggle when any RMA contains multiple line items.
- **Relocated Customer RMA Hub Architecture**: \`Credit Memos Ledger\` operates directly as an integrated sub-tab inside \`Customer RMA Hub\` (in both Live Mode and Test Mode Sandbox).
- **Email-Bound RMA Editor (\`/api/v1/rma-email-edit\`)**: Scoped Google Identity Lock endpoint allowing all authorized **To + CC recipients** (\`No Expiry • Revocable by Admin\`, routed cleanly without extra Vercel functions) to update supplier, product/SKU, pricing, expiry (\`YYYY-MM-DD\`), and SI/DR/PO documents.
- **Per-Email Recipient Profiles, 4-Step 10-Day Pickup Follow-Up & Editable Schedules (\`/api/send-email?action=daily-matrix\`, \`?action=daily-followup\`)**:
  - Supports Admin-only customizable per-type **To** and **CC** lists under \`rma_settings.email_recipients_by_type\` (Live) & \`rma_settings.test_email_recipients_by_type\` (Test Sandbox — **never exposed on public \`/\`**), editable \`rma_settings.daily_matrix_config\` (Rolling or Custom \`YYYY-MM-DD\`, scope, \`includeZeroCatalogSkus\`), and adjustable \`autoSendTimePht\` (\`HH:mm Asia/Manila\`, defaulting to **\`13:00\` (1:00 PM PHT)** for both Daily Matrix and Daily Follow-Up while honoring \`respectSchedule=true\`). Manual \`Send Follow-Up\` UI buttons are removed; follow-ups dispatch automatically via scheduler/cron.
  - **Strict 4-Choice Statuses, Day 0..10 Timeline & Full Outcome Reset**: Returns default strictly to \`Pending\` (\`pending\`) upon intake (never false \`Scrapped\`), render \`Status (YYYY-MM-DD HH:mm)\` badges alongside explicit **Day 0..10 Step 1–4 Workflow Timelines**, support bundling additional RMAs directly inside the 4-Choice Wizard, allow optional 5 pickup photos with persistent \`rma_settings.supplier_directory_store\` auto-fill, record mandatory \`Prepared Date & Time\` below \`Prepared By\`, append \`formatSaveFileTimestamp\` (\`MMM DD, YYYY HHmm Asia/Manila\`) onto downloaded XLSX/PDF/PNG artifacts, and support **Full Timeline & Outcome Reset** (\`resetReportToPending\` via \`🔄 Reset Timeline\` / \`↩️ Reset to Pending\`, clearing 4-Choice outcome, pickup/scrap/restock/closed state & restarting the 10-day clock back to \`Pending\` while preserving Supplier Name & Emails).
  - Tracks **4-Step SLA Lifecycle**: \`Step 1 Report Date\` -> \`Step 2 Waiting (Day 1..10 Follow-Up)\` -> \`Step 3 Picked Up / Handover Date\` -> \`Step 4 Case Close\` (auto-stops on pickup/\`✓ Case Close\`, or auto-disposes after Day 10 to \`Disposal / Scrap Area\` w/ \`workflow_resolution: "scrapped_no_reorder"\` and notifies \`new_rma\` recipients).
- **Standardized \`Serial No.\` Exports, 2-Way RMA Alert Mirror \`.xlsx\` & Email Reply Sync (\`/api/send-email?action=sync-email-replies\`, \`?action=ingest-xlsx-reply\`)**:
  - All non-Matrix Excel tables (\`Customer Inbound\`, \`Supplier Claims\`, \`Credit Memos\`, \`Tickets Vault\`) and every New RMA Alert mirror \`.xlsx\` workbook (\`Serial No. | Field | Value | Format / Notes\` plus \`MANIFEST LINE ITEMS\` including per-item **\`Supplier Name\`**) enforce **\`'Serial No.'\`** as **Column A** (1-indexed integer sequence) and set \`replyTo\`.
  - **Fully Automatic \`.xlsx\` Reply Ingestion & Diagnostics (\`?action=sync-email-replies\`, \`?action=reply-sync-logs\`)**: Manual \`Upload Edited .xlsx\` and \`Check Email .xlsx Replies\` UI buttons are removed; replies are ingested automatically via 1-minute external cron, GitHub Actions backup, and 60s Admin background polling using TLS SNI (\`servername\`), a 45s concurrency lock (\`email_reply_sync_lock\`), \`UID SEARCH SINCE\` (2-day window, recursive nested MIME \`.xlsx\` extractor), and non-burning deduplication (\`processed_reply_message_ids\` only records cleanly processed messages—never failed or \`UNAUTHORIZED_SENDER\` replies). All sync outcomes and errors persist to \`rma_settings.email_reply_sync_logs\` and \`email_reply_sync_status\`. \`imapReplySyncHandler.js\` matches \`MANIFEST LINE ITEMS\` rows by Barcode, SKU, or 1-based \`Serial No.\` index (and keeps single-item \`items[0]\` in sync), honors \`customer_rma_invites_store\` per-RMA \`allowed_emails\`, enforces strict Live vs Test (\`RMA-TEST-...\` / \`[TEST_MODE]\`) isolation, and appends \`EMAIL_XLSX_REPLY_UPDATE\` to \`audit_trail\`.
- **Pinpoint Reverse-Geocode GPS, Unified Timestamp Camera & Single Section 3 Input (\`/api/v1/products/lookup?action=reverse-geocode\`)**:
  - Resolves coordinates using Priority 1 **Known Warehouse / Dock Geofence Anchors** (\`rma_settings.known_gps_locations\`, seeded \`Pingcon Warehouse\`: \`64 Mendez Rd, Baesa, Quezon City, Metro Manila 1106\` within \`250m\`), Priority 2 **Google Maps Geocoding API**, and Priority 3 **Nominatim (\`zoom=18\`)** prioritizing Street+ZIP resolution, anchoring Google Maps pins via \`/maps/place/{address}/@{lat},{lon},18z\`.
  - Unified live timestamped camera capture everywhere (\`Take Photo\` -> full-bleed \`object-cover\` \`CameraCaptureModal\` + \`Upload from Gallery\`, removing old 3-way \`Capture Mode\` switchers and un-watermarked \`capture="environment"\` triggers) and single bordered stream-aware Section 3 input (\`3. Supplier Name (Optional)\` via \`<SupplierInput />\` on Supplier RTV vs \`3. Company / Store Name (Optional)\` on Customer Hub).
  - Scheduled via GitHub Actions (\`.github/workflows/rma-scheduler.yml\`) + Vercel Cron + Admin browser scheduler under Vercel's \`API_ROUTE_COUNT === 12\` limit; Test Mode enforces \`[TEST] \` as the very first subject word and routes to customizable Admin Test Mode recipients (defaulting to Sandbox \`mgan@pingconmarketing.com\`).

Click **Authorize** on the top right to test live endpoints directly from this interactive documentation.
      `,
      contact: {
        name: 'Finance & Systems Engineering',
        email: 'finance2@keysysincorporated.com'
      }
    },
    servers: [
      {
        url: '/',
        description: 'Current Environment (Vercel Serverless)'
      }
    ],
    security: [
      { ApiKeyHeader: [] },
      { BearerAuth: [] }
    ]
  });
}
