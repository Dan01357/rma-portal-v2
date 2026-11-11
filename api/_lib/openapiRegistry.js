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
Send \`GET /api/v1/rma?queue=rtv_debit\` to retrieve merchandise queued for return to vendor recovery claims.

#### 4. 🟡 On Hold / Quarantine Queue (?queue=quarantine):
Send \`GET /api/v1/rma?queue=quarantine\` to retrieve items currently frozen on hold. Financial claims are locked until released.

#### 3. Dual Logistics Streams & Batch Manifests:
- **\`rma_type: "customer_inbound"\`**: Customer / branch store returns awaiting warehouse triage, restock, or Credit Memo issuance.
- **\`rma_type: "supplier_outbound"\`**: Defective merchandise batched for outbound Return to Vendor (RTV) recovery and supplier debit claims.
- **Multi-Item Batch Manifests**: Batched returns are represented with \`is_parent: true\`, \`items\` (JSONB breakdown of line items), \`total_items\`, and \`total_quantity\`. Child records link via \`parent_rma_id\`. Parent containers never require individual product SKUs.

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
