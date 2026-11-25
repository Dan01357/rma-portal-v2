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
  Coworkers can simulate inventory restocks, supplier re-orders, driver pickups, and consolidated credit memos safely without touching live financial ledgers or triggering live customer/boss emails (UI Test Mode emails route safely to \`mgan@pingconmarketing.com\` with \`[TEST]\` prefixes):
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
- **\`rma_type: "customer_inbound"\`**: Customer / branch store returns awaiting 4-Choice disposition, restock, or single/consolidated Credit Memo issuance.
- **\`rma_type: "supplier_outbound"\`**: Defective merchandise batched for outbound Return to Vendor (RTV) recovery, 5-photo driver pickup verification with US Letter B&W PDF forms, and shared multi-RMA \`RTV-\` claims.
- **Multi-Item Batch Manifests**: Batched returns are represented with \`is_parent: true\`, \`items\` (JSONB breakdown of line items), \`total_items\`, and \`total_quantity\`. Child records link via \`parent_rma_id\`.
- **Dual-Stream 4-Choice Outcome & Multi-Photo Pickup Forms**:
  - **Customer Hub (\`customer_inbound\`)**: \`customer_credit\` (*Customer Credit Memo / Return Handover*), \`customer_exchange\` (*Customer Buffer Replacement / Good Stock Exchange*), \`scrap\` (*Throw Away / Dispose*), \`restock_good\` (*Put Back on Good Shelf*). Renders plain black-and-white US Letter (\`8.5in x 11in\`) \`CUSTOMER CREDIT MEMO / RETURN HANDOVER FORM\` and \`CUSTOMER BUFFER REPLACEMENT & HANDOVER FORM\`.
  - **Supplier RTV (\`supplier_outbound\`)**: \`supplier_credit\` (*Debit Claim*), \`supplier_exchange\` (*Replacement / Exchange*), \`scrap\`, \`restock_good\`. Renders \`SUPPLIER DEBIT CLAIM & PICKUP VALIDATION FORM\` and \`SUPPLIER REPLACEMENT / EXCHANGE & PICKUP FORM\`.
  - **Custom Multi-Copy B&W Printables**: Both \`SupplierPickupFormModal\` and \`CreditMemoVoucherModal\` support separated full pages vs combined dual-copy cut sheets and customizable \`ourCopyCount\` + \`counterpartyCopyCount\` (e.g., \`2 Ours + 2 Customer = 4 copies\`).
  - **Driver Pickup Multi-Photos & OCR**: Supports \`string[]\` arrays up to **10 photos per slot (50 max across 5 categories)** (\`driver_license_front\`, \`driver_license_back\`, \`truck_plate\`, \`driver_handover\`, \`pickup_items\`), accepts any valid **Philippine Gov't / Legal ID**, runs Truck Plate OCR via \`POST /api/upload-photo?action=inspect-plate\`, requires manual \`processed_by\` entry, and sends \`pickup_debit_claim\` emails with item \`explanation\` included and \`Store / Branch\` + \`Warehouse Location\` omitted.
- **Unified Printable QR Card & Multi-Select Studio (\`ReturnQRModal.jsx\`)**: Single centered source of truth for \`Save QR (PNG)\` and \`Print QR\` showing **Quantity & Unit** cleanly with **no Supplier Name**, plus US Letter default 1-page / multi-page consolidated packing and independent per-QR mm/scale sizing.
- **Relocated Customer RMA Hub Architecture**: \`Credit Memos Ledger\` operates directly as an integrated sub-tab inside \`Customer RMA Hub\` (in both Live Mode and Test Mode Sandbox).
- **Email-Bound RMA Editor (\`/api/v1/rma-email-edit\`)**: Scoped Google Identity Lock endpoint allowing all authorized **To + CC recipients** (\`No Expiry • Revocable by Admin\`, routed cleanly without extra Vercel functions) to update supplier, product/SKU, pricing, expiry (\`YYYY-MM-DD\`), and SI/DR/PO documents.
- **Per-Email Recipient Profiles, 4-Step 10-Day Pickup Follow-Up & Editable Schedules (\`/api/send-email?action=daily-matrix\`, \`?action=daily-followup\`)**:
  - Supports customizable per-type **To** and **CC** lists under \`rma_settings.email_recipients_by_type\`, editable \`rma_settings.daily_matrix_config\` (Rolling or Custom \`YYYY-MM-DD\`, scope, \`includeZeroCatalogSkus\`), and adjustable \`autoSendTimePht\` (\`HH:mm Asia/Manila\`, honoring \`respectSchedule=true\`).
  - **Strict 4-Choice Statuses & Day 0..10 Timeline**: Returns default strictly to \`Pending\` (\`pending\`) upon intake (never false \`Scrapped\`), render \`Status (YYYY-MM-DD HH:mm)\` badges alongside explicit **Day 0..10 Step 1–4 Workflow Timelines**, support bundling additional RMAs directly inside the 4-Choice Wizard, allow optional 5 pickup photos with persistent \`rma_settings.supplier_directory_store\` auto-fill, record mandatory \`Prepared Date & Time\` below \`Prepared By\`, and append \`formatSaveFileTimestamp\` (\`MMM DD, YYYY HHmm Asia/Manila\`) onto downloaded XLSX/PDF/PNG artifacts.
  - Tracks **4-Step SLA Lifecycle**: \`Step 1 Report Date\` -> \`Step 2 Waiting (Day 1..10 Follow-Up)\` -> \`Step 3 Picked Up / Handover Date\` -> \`Step 4 Case Close\` (auto-stops on pickup/\`✓ Case Close\`, or auto-disposes after Day 10 to \`Disposal / Scrap Area\` w/ \`workflow_resolution: "scrapped_no_reorder"\` and notifies \`new_rma\` recipients).
- **2-Way RMA Alert Mirror \`.xlsx\` & Email Reply Sync (\`/api/send-email?action=sync-email-replies\`, \`?action=ingest-xlsx-reply\`)**:
  - Every New RMA Alert email attaches an editable \`.xlsx\` mirror (\`Field | Value\` + \`MANIFEST LINE ITEMS\`, named from subject + \`formatSaveFileTimestamp\`) and sets \`replyTo\`.
  - Authorized recipients can reply-all with the edited \`.xlsx\` (polled automatically via TLS IMAP \`UNSEEN\` filter on \`.github/workflows/rma-scheduler.yml\` or manually uploaded in \`QuickRMAActionModal\` / \`SettingsTab\`), writing updates to \`rma_reports\` + \`supplier_directory_store\` and appending \`EMAIL_XLSX_REPLY_UPDATE\` to \`audit_trail\` with strict Test vs Live isolation.
- **Reverse-Geocode GPS & Live Camera Watermarks (\`/api/v1/products/lookup?action=reverse-geocode\`)**:
  - Resolves coordinates (\`gps_latitude\`, \`gps_longitude\`) to clean Street / Barangay / City / Region / ZIP (\`gps_address\` + \`ai_document_metadata.gps_address\`) powering clear address labels and Google Maps search URLs everywhere, while \`CameraCaptureModal\` stamps live PHT timestamp, address & operator tag onto captured/uploaded photos.
  - Scheduled via GitHub Actions (\`.github/workflows/rma-scheduler.yml\`) + Vercel Cron + Admin browser scheduler under Vercel's \`API_ROUTE_COUNT === 12\` limit; Test Mode enforces \`[TEST] \` as the very first subject word and routes exclusively to the configured Sandbox email (default \`mgan@pingconmarketing.com\`).

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
