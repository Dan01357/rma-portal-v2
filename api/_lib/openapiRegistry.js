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
- **Printable Forms**: Standardized strictly on US Letter (\`8.5in x 11in\`, plain black-and-white ink) for Sticker Studio sheets, Credit Memo Vouchers, and Unified Debit Claim / Replacement & Pickup Forms (accepting any valid Philippine Government / Legal ID).
- **Email-Bound RMA Editor (\`/api/v1/rma-email-edit\`)**: Scoped Google Identity Lock endpoint allowing all authorized **To + CC recipients** (\`No Expiry • Revocable by Admin\`, routed cleanly without extra Vercel functions) to update supplier, product/SKU, pricing, expiry (\`YYYY-MM-DD\`), and SI/DR/PO documents.
- **Per-Email Recipient Profiles, Editable Schedule & 10-Day Pickup Follow-Up (\`/api/send-email?action=daily-matrix\`, \`?action=daily-followup\`)**: Supports per-type **To** (single or multi-recipient) and **CC** profiles via \`rma_settings.email_recipients_by_type\` (including \`supplier_followup\` CCs), configurable Rolling/Custom \`YYYY-MM-DD\` date ranges, scope (\`overall\`, \`customer_inbound\`, \`supplier_outbound\`), \`includeZeroCatalogSkus\`, and adjustable \`HH:mm Asia/Manila\` auto-send schedules for both Daily Matrix (default \`13:00\`) and 10-Calendar-Day Pickup Follow-Up / Auto-Dispose (default \`08:00\`). Scheduled via GitHub Actions + Vercel Cron + Admin browser scheduler and manually triggerable; all Test Mode emails enforce \`[TEST]\` as the very first word in the subject line and isolate delivery to the configured Sandbox email (default \`mgan@pingconmarketing.com\`).

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
