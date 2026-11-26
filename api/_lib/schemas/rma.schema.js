import { z, StandardErrorSchema, PaginationQuerySchema } from './common.js';

export const RMAStatusEnum = z.enum([
  'draft',
  'received_at_dock',
  'under_inspection',
  'picked_up',
  'pending_finance_approval',
  'credit_memo_issued',
  'restocked',
  'scrapped',
  'closed',
  'rejected',
  'pending',
  'pending_admin_details',
  'resolved',
  'logged',
  'buffer_replacement_dispatched'
]);

export const RMAConditionGradeEnum = z.enum([
  'A - Like New / Resellable',
  'B - Damaged Packaging Only',
  'C - Defective / Parts Only',
  'D - Total Loss / Scrap'
]);

export const RMADispositionEnum = z.enum([
  'Pending Triage',
  'Restock to Inventory',
  'Return to Vendor (RTV)',
  'Quarantine',
  'Scrap / Dispose'
]);

export const RMATypeEnum = z.enum([
  'customer_inbound',
  'supplier_outbound'
]);

export const FourChoiceOutcomeEnum = z.enum([
  'customer_credit',
  'customer_exchange',
  'supplier_credit',
  'supplier_exchange',
  'scrap',
  'restock_good'
]).openapi({
  description: '4-Choice workflow selection: Customer Hub (customer_credit, customer_exchange, scrap, restock_good) or Supplier RTV (supplier_credit, supplier_exchange, scrap, restock_good).'
});

export const PickupPhotoSlotsSchema = z.object({
  driver_license_front: z.array(z.string().url()).max(10).optional().openapi({ description: 'Up to 10 Drive/Storage photo URLs of Driver PH Gov/Legal ID front' }),
  driver_license_back: z.array(z.string().url()).max(10).optional().openapi({ description: 'Up to 10 photo URLs of Driver PH Gov/Legal ID back' }),
  truck_plate: z.array(z.string().url()).max(10).optional().openapi({ description: 'Up to 10 photo URLs of Delivery Truck Plate (auto-OCR via POST /api/upload-photo?action=inspect-plate)' }),
  driver_handover: z.array(z.string().url()).max(10).optional().openapi({ description: 'Up to 10 photo URLs of Driver receiving/handover proof' }),
  pickup_items: z.array(z.string().url()).max(10).optional().openapi({ description: 'Up to 10 photo URLs of physical merchandise (50 photos max across all 5 categories)' })
}).optional();

export const SupplierPickupMetadataSchema = z.object({
  disposition: FourChoiceOutcomeEnum.optional(),
  processed_by: z.string().min(1).optional().openapi({ example: 'Juan Dela Cruz', description: 'Mandatory manually entered Pingcon staff full name (zero auto-fill on new records)' }),
  driver_name: z.string().optional().openapi({ example: 'Pedro Penduko' }),
  driver_id_type: z.string().optional().openapi({ example: 'PhilSys National ID (PhilID / ePhilID)' }),
  driver_license_no: z.string().optional().openapi({ example: 'PSN-4801-9988-7766' }),
  truck_plate: z.string().optional().openapi({ example: 'PW-8899' }),
  photos: PickupPhotoSlotsSchema,
  ourCopyCount: z.number().int().min(0).max(10).optional().openapi({ example: 2, description: 'Customizable Our Company copy count for US Letter B&W Pickup/Handover & Credit Memo forms' }),
  counterpartyCopyCount: z.number().int().min(0).max(10).optional().openapi({ example: 2, description: 'Customizable Customer/Supplier copy count for US Letter B&W Pickup/Handover & Credit Memo forms' }),
  pageLayout: z.enum(['separated', 'combined', 'repeating']).optional().openapi({ example: 'separated', description: 'US Letter B&W form pagination: separated full pages vs combined 50% cut dual-copy sheet' }),
  prepared_at: z.string().datetime().nullable().optional().openapi({ description: 'Manual Prepared Date & Time (Asia/Manila) rendered directly beneath Prepared By on US Letter B&W printables' }),
  picked_up_at: z.string().datetime().nullable().optional()
}).passthrough().openapi('SupplierPickupMetadata');

export const FollowUpMetadataSchema = z.object({
  enabled: z.boolean().optional().openapi({ example: true, description: '10-Calendar-Day SLA daily follow-up countdown switch' }),
  started_at: z.string().datetime().optional().openapi({ description: 'Step 1/2 countdown start ISO timestamp (Asia/Manila calendar day 0..10)' }),
  picked_up_at: z.string().datetime().nullable().optional().openapi({ description: 'Step 3 Picked Up / Handover timestamp (automatically halts follow-up reminders)' }),
  case_closed_at: z.string().datetime().nullable().optional().openapi({ description: 'Step 4 Case Close or Auto-Dispose completion timestamp' }),
  auto_disposed_at: z.string().datetime().nullable().optional(),
  case_status: z.string().optional().openapi({ example: 'waiting_pickup', description: 'e.g. waiting_pickup, picked_up_closed, auto_disposed_after_10_days' }),
  last_sent_day: z.number().int().min(0).max(30).optional().openapi({ example: 2 }),
  last_sent_pht_date: z.string().optional().openapi({ example: '2026-11-24' }),
  supplier_email_to: z.string().optional().openapi({ example: 'claims@supplier.com' }),
  supplier_email_cc: z.string().optional().openapi({ example: 'ap@supplier.com' })
}).passthrough().openapi('FollowUpMetadata');

export const RMAReportSchema = z.object({
  id: z.number().int().openapi({ example: 1042 }),
  rma_number: z.string().openapi({ example: 'RMA-2026-0001-6TYH' }),
  rma_type: RMATypeEnum.default('customer_inbound').openapi({ example: 'customer_inbound', description: 'Logistics type: customer_inbound (store return) or supplier_outbound (vendor RTV)' }),
  barcode: z.string().openapi({ example: '4800016644833' }),
  code: z.string().nullable().optional().openapi({ example: 'OISHI-PRAWN-50G' }),
  name: z.string().openapi({ example: 'Oishi Prawn Crackers 50g' }),
  quantity: z.number().int().default(1).openapi({ example: 5 }),
  supplier_name: z.string().default('Savemore').openapi({ example: 'Liwayway Marketing' }),
  price: z.number().default(0).openapi({ example: 24.50 }),
  price_with_vat: z.number().default(0).openapi({ example: 27.44 }),
  unit_name: z.string().default('pc').openapi({ example: 'pack' }),
  status: RMAStatusEnum.default('received_at_dock').openapi({ example: 'received_at_dock' }),
  condition_grade: RMAConditionGradeEnum.default('B - Damaged Packaging Only').openapi({ example: 'B - Damaged Packaging Only' }),
  disposition: RMADispositionEnum.default('Pending Triage').openapi({ example: 'Pending Triage' }),
  warehouse_location: z.string().nullable().optional().openapi({ example: 'RACK-03-BIN-A' }),
  inspected_by: z.string().nullable().optional().openapi({ example: 'Warehouse Lead' }),
  inspected_at: z.string().datetime().nullable().optional().openapi({ example: '2026-10-26T15:00:00.000Z' }),
  reason: z.string().default('Damaged Box / Crushed Packaging').openapi({ example: 'Damaged Box / Crushed Packaging' }),
  explanation: z.string().nullable().optional().openapi({ example: 'Crushed box during delivery transport.' }),
  photos: z.array(z.string()).default([]).openapi({ example: ['https://example.com/damage-photo-1.jpg'] }),
  reporter_name: z.string().nullable().optional().openapi({ example: 'Juan Dela Cruz' }),
  reporter_contact: z.string().nullable().optional().openapi({ example: '09171234567' }),
  reported_by: z.string().openapi({ example: 'Jarmen (API)' }),
  store_branch: z.string().nullable().optional().openapi({ example: 'Savemore Taguig - Branch 14', description: 'Customer store / branch (Customer Hub customer_inbound only; always null/omitted on Supplier RTV supplier_outbound)' }),
  invoice_dr_number: z.string().nullable().optional().openapi({ example: 'DR-2026-8891' }),
  si_number: z.string().nullable().optional().openapi({ example: 'SI-2026-9021' }),
  dr_number: z.string().nullable().optional().openapi({ example: 'DR-2026-8891' }),
  po_number: z.string().nullable().optional().openapi({ example: 'PO-2026-4401' }),
  expiry_date: z.string().nullable().optional().openapi({ example: '2026-12-31', description: 'ISO YYYY-MM-DD expiry date (required for Supplier RTV & Test Mode; optional for Live Customer Hub)' }),
  gps_latitude: z.number().nullable().optional().openapi({ example: 14.6683 }),
  gps_longitude: z.number().nullable().optional().openapi({ example: 121.0114 }),
  gps_address: z.string().nullable().optional().openapi({ example: '64 Mendez Rd, Baesa, Quezon City, Metro Manila 1106', description: 'Pinpoint geofence anchor (`known_gps_locations`) or Google/Nominatim reverse-geocoded street/barangay/city/ZIP address' }),
  is_parent: z.boolean().default(false).openapi({ example: false, description: 'True if this report is a batch return manifest container' }),
  parent_rma_id: z.number().int().nullable().optional().openapi({ example: null, description: 'Parent report ID if this is a line item inside a batch return manifest' }),
  items: z.array(z.any()).default([]).openapi({ example: [], description: 'Line item breakdown objects for multi-item return manifests' }),
  total_items: z.number().int().default(1).openapi({ example: 1, description: 'Total distinct items in manifest' }),
  total_quantity: z.number().int().default(1).openapi({ example: 1, description: 'Summed quantity across all items in manifest' }),
  notes: z.string().nullable().optional().openapi({ example: 'Customer returned item with receipt' }),
  ai_document_metadata: z.object({
    is_test: z.boolean().optional(),
    test_mode: z.boolean().optional(),
    workflow_resolution: z.enum(['restocked', 'reordered', 'scrapped_no_reorder']).optional(),
    supplier_pickup: SupplierPickupMetadataSchema.optional(),
    follow_up: FollowUpMetadataSchema.optional()
  }).passthrough().optional().openapi({ description: 'Structured metadata including 5-slot multi-photo driver pickup (up to 10/slot, 50 total), 4-Step / 10-Day SLA follow-up tracking, and Test Mode isolation flags' }),
  created_at: z.string().datetime().openapi({ example: '2026-10-26T14:30:00.000Z' })
}).openapi('RMAReport');

export const CreateRMAReportSchema = z.object({
  barcode: z.string().min(1, 'Barcode is required').openapi({ example: '4800016644833' }),
  name: z.string().min(1, 'Product name is required').openapi({ example: 'Oishi Prawn Crackers 50g' }),
  rma_type: RMATypeEnum.optional().default('customer_inbound').openapi({ example: 'customer_inbound', description: 'Logistics type: customer_inbound (default) or supplier_outbound' }),
  is_parent: z.boolean().optional().default(false).openapi({ example: false, description: 'True if submitting a multi-item batch return manifest' }),
  items: z.array(z.any()).optional().default([]).openapi({ example: [], description: 'Array of item breakdown objects for batch returns' }),
  total_items: z.number().int().optional().default(1).openapi({ example: 1 }),
  total_quantity: z.number().int().optional().default(1).openapi({ example: 1 }),
  code: z.string().optional().openapi({ example: 'P2678P' }),
  quantity: z.number().int().min(1).default(1).openapi({ example: 2 }),
  supplier_name: z.string().optional().default('Savemore').openapi({ example: 'Liwayway Marketing' }),
  price: z.number().optional().default(0).openapi({ example: 24.50 }),
  price_with_vat: z.number().optional().default(0).openapi({ example: 27.44 }),
  unit_name: z.string().optional().default('pc').openapi({ example: 'pack' }),
  status: RMAStatusEnum.optional().default('received_at_dock').openapi({ example: 'received_at_dock' }),
  condition_grade: RMAConditionGradeEnum.optional().default('B - Damaged Packaging Only').openapi({ example: 'B - Damaged Packaging Only' }),
  disposition: RMADispositionEnum.optional().default('Pending Triage').openapi({ example: 'Pending Triage' }),
  warehouse_location: z.string().optional().openapi({ example: 'RACK-03-BIN-A' }),
  needs_reorder: z.boolean().optional().openapi({ example: true, description: 'Explicit replenishment toggle for purchasing' }),
  hold_reason: z.string().optional().openapi({ example: 'Pending quality inspection' }),
  rejection_reason: z.string().optional().openapi({ example: 'Customer damage outside return window' }),
  inspected_by: z.string().optional().openapi({ example: 'Warehouse Lead' }),
  reason: z.string().optional().default('Damaged Box / Crushed Packaging').openapi({ example: 'Damaged Box / Crushed Packaging' }),
  explanation: z.string().optional().openapi({ example: 'Crushed box during unloading' }),
  photos: z.array(z.string().url()).optional().default([]).openapi({ example: ['https://example.com/box1.jpg'] }),
  reporter_name: z.string().optional().openapi({ example: 'Warehouse Lead' }),
  reporter_contact: z.string().optional().openapi({ example: '09170001122' }),
  store_branch: z.string().optional().openapi({ example: 'Savemore Taguig - Branch 14', description: 'Customer Hub (customer_inbound) branch only; null/ignored for supplier_outbound' }),
  invoice_dr_number: z.string().optional().openapi({ example: 'DR-2026-8891' }),
  si_number: z.string().optional().openapi({ example: 'SI-2026-9021' }),
  dr_number: z.string().optional().openapi({ example: 'DR-2026-8891' }),
  po_number: z.string().optional().openapi({ example: 'PO-2026-4401' }),
  expiry_date: z.string().optional().openapi({ example: '2026-12-31', description: 'ISO YYYY-MM-DD product expiration date (required for Supplier RTV & Test Mode; optional for Live Customer Hub)' }),
  notes: z.string().optional().openapi({ example: 'Submitted via REST API' })
}).openapi('CreateRMAReportRequest');

export const UpdateRMAReportSchema = z.object({
  rma_number: z.string().optional().openapi({ example: 'RMA-2026-0099-6KKW', description: 'Reconstruct or restore exact historical/deleted RMA ID' }),
  created_at: z.string().optional().openapi({ example: '2026-11-01T09:30:00.000Z', description: 'Historical ingest timestamp' }),
  is_test: z.boolean().optional().openapi({ example: false, description: 'Toggle between Test Mode Sandbox (true) and Live Production Hub (false) with 100% silent guarantee (zero emails)' }),
  name: z.string().optional().openapi({ example: 'Oishi Prawn Crackers 50g' }),
  barcode: z.string().optional().openapi({ example: '4800016644833' }),
  code: z.string().optional().openapi({ example: 'P2678P' }),
  supplier_name: z.string().optional().openapi({ example: 'Liwayway Marketing' }),
  unit_name: z.string().optional().openapi({ example: 'pc' }),
  status: RMAStatusEnum.optional().openapi({ example: 'pending', description: 'Lifecycle status update or full reset via resetReportToPending ("pending" clears 4-Choice disposition, pickup/scrap/restock/closed metadata, and restarts the 10-day SLA countdown cleanly). Also accepts "restocked", "reordered", or "scrapped".' }),
  warehouse_location: z.string().optional().openapi({ example: 'Good Stock Area', description: 'Standardized warehouse area (e.g. Good Stock Area, Supplier Return Area (RTV), Disposal / Scrap Area, Receiving Area)' }),
  notes: z.string().optional().openapi({ example: 'Confirmed restocked into WMS' }),
  disposition: RMADispositionEnum.optional().openapi({ example: 'Restock to Inventory' }),
  condition_grade: RMAConditionGradeEnum.optional().openapi({ example: 'A - Like New / Resellable' }),
  rma_type: RMATypeEnum.optional().openapi({ example: 'customer_inbound', description: 'Reclassify logistics type between customer_inbound and supplier_outbound' }),
  workflow_resolution: z.enum(['restocked', 'reordered', 'scrapped_no_reorder']).optional().openapi({ example: 'restocked', description: 'Resolution workflow flag stored safely in ai_document_metadata' }),
  needs_reorder: z.boolean().optional().openapi({ example: true, description: 'Purchasing replenishment switch: true flags for supplier re-order, false marks as write-off' }),
  hold_reason: z.string().optional().openapi({ example: 'Packaging seal torn during transit' }),
  rejection_reason: z.string().optional().openapi({ example: 'Outside return window' }),
  quantity: z.number().int().min(1).optional().openapi({ example: 3 }),
  store_branch: z.string().optional().openapi({ example: 'Savemore Taguig - Branch 14', description: 'Customer Hub (customer_inbound) branch only; null/ignored for supplier_outbound' }),
  invoice_dr_number: z.string().optional().openapi({ example: 'DR-2026-8891' }),
  si_number: z.string().optional().openapi({ example: 'SI-2026-9021' }),
  dr_number: z.string().optional().openapi({ example: 'DR-2026-8891' }),
  po_number: z.string().optional().openapi({ example: 'PO-2026-4401' }),
  expiry_date: z.string().optional().openapi({ example: '2026-12-31' }),
  batch_lot_number: z.string().optional().openapi({ example: 'LOT-B42' }),
  explanation: z.string().optional().openapi({ example: 'Replacement voucher issued' }),
  price: z.number().optional().openapi({ example: 25.00 }),
  price_with_vat: z.number().optional().openapi({ example: 28.00 })
}).openapi('UpdateRMAReportRequest');

export function registerRMARoutes(registry) {
  // GET /api/v1/rma
  registry.registerPath({
    method: 'get',
    path: '/api/v1/rma',
    summary: 'List RMA Return Reports (Restock & Re-order Queues)',
    description: `Fetch paginated return reports with dedicated support for ERP inventory queues.
Individual line items are automatically returned and generic parent manifest containers are filtered out, completely eliminating double-counting.

### 🟢 Queue 1: Ready to Restock Queue (?queue=restock)
To fetch all goods approved for warehouse restocking:
\`\`\`bash
curl -X GET "https://rma-portal-pingconmarketing.vercel.app/api/v1/rma?queue=restock" \\
  -H "x-api-key: sk_live_rma_..."
\`\`\`
After restocking into ERP, confirm via PATCH:
\`\`\`bash
curl -X PATCH "https://rma-portal-pingconmarketing.vercel.app/api/v1/rma/{id}" \\
  -H "x-api-key: sk_live_rma_..." \\
  -H "Content-Type: application/json" \\
  -d '{"status": "restocked", "warehouse_location": "Good Stock Area"}'
\`\`\`

### 🔴 Queue 2: Re-Order Needed / Scrapped (?queue=reorder)
To fetch all goods deemed total loss / scrapped so your ERP can re-order replacement stock from suppliers:
\`\`\`bash
curl -X GET "https://rma-portal-pingconmarketing.vercel.app/api/v1/rma?queue=reorder" \\
  -H "x-api-key: sk_live_rma_..."
\`\`\`
After re-ordering from suppliers, confirm via PATCH:
\`\`\`bash
curl -X PATCH "https://rma-portal-pingconmarketing.vercel.app/api/v1/rma/{id}" \\
  -H "x-api-key: sk_live_rma_..." \\
  -H "Content-Type: application/json" \\
  -d '{"status": "scrapped", "warehouse_location": "Disposal / Scrap Area"}'
\`\`\`

### 🟣 Queue 3: Vendor Recovery / RTV (?queue=rtv_debit)
To fetch all merchandise scheduled for outbound Return to Vendor (RTV) claims:
\`\`\`bash
curl -X GET "https://rma-portal-pingconmarketing.vercel.app/api/v1/rma?queue=rtv_debit" \\
  -H "x-api-key: sk_live_rma_..."
\`\`\`

### 🟡 Queue 4: Legacy Quarantine Query (?queue=quarantine)
Retained for backwards-compatible REST API consumers; portal UI workflows now route items directly via the 4-Choice Outcome & Pickup Wizard (\`picked_up\`, \`restocked\`, \`scrapped\`, or \`credit_memo_issued\`).
\`\`\`bash
curl -X GET "https://rma-portal-pingconmarketing.vercel.app/api/v1/rma?queue=quarantine" \\
  -H "x-api-key: sk_live_rma_..."
\`\`\`

### 🧪 Test Mode Sandbox (?test_mode=true)
Pass \`test_mode=true\` to isolate queries and updates strictly within the Sandbox environment without altering live records:
\`\`\`bash
curl -X GET "https://rma-portal-pingconmarketing.vercel.app/api/v1/rma?test_mode=true&queue=restock" \\
  -H "x-api-key: sk_live_rma_..."
\`\`\`
Reset any ticket back to pending for re-testing:
\`\`\`bash
curl -X PATCH "https://rma-portal-pingconmarketing.vercel.app/api/v1/rma/{id}" \\
  -H "x-api-key: sk_live_rma_..." \\
  -H "Content-Type: application/json" \\
  -d '{"status": "pending"}'
\`\`\`
`,
    tags: ['RMA Reports'],
    request: {
      query: PaginationQuerySchema.extend({
        rma_type: z.enum(['customer_inbound', 'supplier_outbound']).optional().openapi({ description: 'Filter by logistics type: customer_inbound or supplier_outbound', example: 'customer_inbound' }),
        queue: z.enum(['restock', 'reorder', 'scrap', 'rtv_debit', 'quarantine']).optional().openapi({ description: 'Filter by 4-pillar operational queue: "restock" (ready to restock in WMS), "reorder" or "scrap" (re-order replacement from supplier), "rtv_debit" (vendor recovery / outbound RTV claims), "quarantine" (items on hold)', example: 'restock' }),
        test_mode: z.enum(['true', 'false']).optional().openapi({ description: 'Filter by test mode: "true" returns sandbox test records only, "false" or omitted returns live production records only', example: 'false' }),
        lifecycle: z.enum(['active', 'archived', 'trashed']).optional().openapi({ description: 'Filter by lifecycle state: "active" (default), "archived" (Enterprise Archive Vault), "trashed" (30-day soft trash bin)', example: 'active' }),
        status: z.string().optional().openapi({ description: 'Filter by status (pending, open, restocked, scrapped). "pending" and "open" return all pre-finalized active returns.', example: 'pending' }),
        barcode: z.string().optional().openapi({ description: 'Filter by exact product barcode', example: '4800016644833' }),
        disposition: z.string().optional().openapi({ description: 'Filter by warehouse triage disposition (e.g. "Restock to Inventory", "Return to Vendor (RTV)", "Scrap / Dispose")', example: 'Restock to Inventory' }),
        condition_grade: z.string().optional().openapi({ description: 'Filter by item grade condition', example: 'A - Like New / Resellable' }),
        warehouse_location: z.string().optional().openapi({ description: 'Filter by standardized warehouse area (e.g. "Good Stock Area", "Supplier Return Area (RTV)", "Disposal / Scrap Area")', example: 'Good Stock Area' }),
        is_parent: z.string().optional().openapi({ description: 'Filter by parent manifest container (true) or individual items (false, default)', example: 'false' }),
        search: z.string().optional().openapi({ description: 'Search term across RMA #, name, SKU, or reporter', example: 'Oishi' })
      })
    },
    responses: {
      200: {
        description: 'List of RMA reports',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().openapi({ example: true }),
              client: z.string().openapi({ example: 'Jarmen' }),
              total: z.number().openapi({ example: 142 }),
              limit: z.number().openapi({ example: 50 }),
              offset: z.number().openapi({ example: 0 }),
              data: z.array(RMAReportSchema)
            })
          }
        }
      },
      401: { description: 'Missing or invalid API key', content: { 'application/json': { schema: StandardErrorSchema } } }
    }
  });

  // POST /api/v1/rma
  registry.registerPath({
    method: 'post',
    path: '/api/v1/rma',
    summary: 'Submit New RMA Return Report',
    description: 'Submits a return report from an external system. Automatically assigns an RMA number and attributes the report to the authenticated client system.',
    tags: ['RMA Reports'],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: CreateRMAReportSchema
          }
        }
      }
    },
    responses: {
      201: {
        description: 'RMA report successfully created',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().openapi({ example: true }),
              message: z.string().openapi({ example: 'RMA report RMA-2026-0001-6TYH created successfully.' }),
              client: z.string().openapi({ example: 'Jarmen' }),
              data: RMAReportSchema
            })
          }
        }
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: StandardErrorSchema } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: StandardErrorSchema } } }
    }
  });

  // GET /api/v1/rma/{id}
  registry.registerPath({
    method: 'get',
    path: '/api/v1/rma/{id}',
    summary: 'Get Single RMA Report',
    description: 'Retrieve a return report by its numeric database ID or its public RMA Number (e.g. RMA-2026-0001-6TYH).',
    tags: ['RMA Reports'],
    request: {
      params: z.object({
        id: z.string().openapi({ description: 'Numeric ID or RMA Number', example: 'RMA-2026-0001-6TYH' })
      })
    },
    responses: {
      200: {
        description: 'RMA report retrieved',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().openapi({ example: true }),
              data: RMAReportSchema
            })
          }
        }
      },
      404: { description: 'RMA report not found', content: { 'application/json': { schema: StandardErrorSchema } } }
    }
  });

  // PATCH /api/v1/rma/{id}
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/rma/{id}',
    summary: 'Update RMA Report (Acknowledge Restocked / Scrapped)',
    description: `Update status, warehouse location, inspection notes, or details of an existing RMA report.

### 📦 1. Coworker Inventory Restock Acknowledgment:
When your ERP system has added the returned quantity to your warehouse stock count, call this endpoint to mark the RMA ticket as **restocked**:
\`\`\`bash
curl -X PATCH "https://rma-portal-pingconmarketing.vercel.app/api/v1/rma/RMA-2026-0001-6TYH" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: sk_live_rma_..." \\
  -d '{
    "status": "restocked",
    "disposition": "2- Restock to Inventory",
    "warehouse_location": "RACK-03-BIN-A",
    "notes": "Added to inventory counts in ERP (Ref #INV-8821)"
  }'
\`\`\`

### 🗑️ 2. Coworker Scrapped / Supplier Re-order Acknowledgment:
When your procurement system has processed the scrapped item and placed a replacement Purchase Order to the supplier:
\`\`\`bash
curl -X PATCH "https://rma-portal-pingconmarketing.vercel.app/api/v1/rma/RMA-2026-0001-6TYH" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: sk_live_rma_..." \\
  -d '{
    "status": "scrapped",
    "disposition": "5- Scrap / Dispose",
    "warehouse_location": "SCRAP-BIN",
    "notes": "Item marked scrapped. Replacement supplier PO #PO-2026-9901 issued."
  }'
\`\`\``,
    tags: ['RMA Reports'],
    request: {
      params: z.object({
        id: z.string().openapi({ description: 'Numeric ID or RMA Number', example: 'RMA-2026-0001-6TYH' })
      }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: UpdateRMAReportSchema
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Report updated successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().openapi({ example: true }),
              message: z.string().openapi({ example: 'RMA report updated.' }),
              data: RMAReportSchema
            })
          }
        }
      },
      404: { description: 'Report not found', content: { 'application/json': { schema: StandardErrorSchema } } }
    }
  });

  // DELETE /api/v1/rma/{id}
  registry.registerPath({
    method: 'delete',
    path: '/api/v1/rma/{id}',
    summary: 'Delete RMA Report',
    description: 'Permanently deletes an RMA report by ID or RMA Number.',
    tags: ['RMA Reports'],
    request: {
      params: z.object({
        id: z.string().openapi({ example: 'RMA-2026-0001-6TYH' })
      })
    },
    responses: {
      200: {
        description: 'Report deleted',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().openapi({ example: true }),
              message: z.string().openapi({ example: 'RMA report deleted.' })
            })
          }
        }
      },
      404: { description: 'Report not found', content: { 'application/json': { schema: StandardErrorSchema } } }
    }
  });

  // POST /api/v1/ai/inspect-paperwork
  registry.registerPath({
    method: 'post',
    path: '/api/v1/ai/inspect-paperwork',
    summary: 'Inspect Paperwork Photo via Gemini Flash AI',
    description: 'Validates wholesale logistics paperwork (DR, SI, PO) and auto-extracts document numbers and branch names.',
    tags: ['AI Document Inspection'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              fileData: z.string().optional().openapi({ description: 'Base64 image string', example: 'data:image/jpeg;base64,...' }),
              imageUrl: z.string().url().optional().openapi({ description: 'Public image URL to inspect', example: 'https://example.com/dr.jpg' }),
              mimeType: z.string().optional().default('image/jpeg').openapi({ example: 'image/jpeg' })
            })
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Inspection result',
        content: {
          'application/json': {
            schema: z.object({
              is_valid_document: z.boolean().openapi({ example: true }),
              document_type: z.string().openapi({ example: 'Delivery Receipt' }),
              confidence: z.number().openapi({ example: 0.95 }),
              invoice_dr_number: z.string().nullable().openapi({ example: 'DR-2026-8812' }),
              si_number: z.string().nullable().openapi({ example: 'SI-2026-9021' }),
              dr_number: z.string().nullable().openapi({ example: 'DR-2026-8812' }),
              po_number: z.string().nullable().openapi({ example: 'PO-2026-4401' }),
              store_branch: z.string().nullable().openapi({ example: 'Savemore Market - Taguig' }),
              detected_date: z.string().nullable().openapi({ example: '2026-10-30' }),
              vendor_name: z.string().nullable().openapi({ example: 'Pingcon Marketing' }),
              rejection_reason: z.string().nullable().openapi({ example: null })
            })
          }
        }
      }
    }
  });

  // GET /api/v1/rma-email-edit
  registry.registerPath({
    method: 'get',
    path: '/api/v1/rma-email-edit',
    summary: 'Load Scoped RMA Record for Email-Bound Editor Link',
    description: 'Verifies caller Supabase Google OAuth JWT against the email-bound multi-recipient (To + CC) rma_editor invite token (No Expiry, revocable by Admin), enforces Live vs Test isolation, and returns only the scoped RMA details.',
    tags: ['RMA Reports'],
    security: [{ BearerAuth: [] }],
    request: {
      query: z.object({
        token: z.string().openapi({ example: 'inv_edit_m8x9k_abc123' }),
        rma: z.string().optional().openapi({ example: 'RMA-2026-0001-6TYH' })
      })
    },
    responses: {
      200: { description: 'Scoped RMA record loaded cleanly' },
      401: { description: 'Missing or invalid Google OAuth JWT', content: { 'application/json': { schema: StandardErrorSchema } } },
      403: { description: 'Identity mismatch, revoked/expired invite, RMA scope mismatch, or Live/Test violation', content: { 'application/json': { schema: StandardErrorSchema } } },
      404: { description: 'Invite or RMA record not found', content: { 'application/json': { schema: StandardErrorSchema } } }
    }
  });

  // PATCH /api/v1/rma-email-edit
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/rma-email-edit',
    summary: 'Save Email-Bound RMA Details & Commercial Documents Update',
    description: 'Enforces Google Identity Lock JWT + invite token ownership + Live/Test isolation, updates editable RMA details/pricing/expiry/SI/DR/PO/manifest items, and appends an EMAIL_EDITOR_UPDATE audit trail entry.',
    tags: ['RMA Reports'],
    security: [{ BearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              token: z.string().openapi({ example: 'inv_edit_m8x9k_abc123' }),
              rma_number: z.string().openapi({ example: 'RMA-2026-0001-6TYH' }),
              updates: z.object({
                supplier_name: z.string().optional(),
                name: z.string().optional(),
                code: z.string().optional(),
                quantity: z.number().int().min(1).optional(),
                unit_name: z.string().optional(),
                price: z.number().min(0).optional(),
                price_with_vat: z.number().min(0).optional(),
                expiry_date: z.string().optional(),
                store_branch: z.string().optional(),
                si_number: z.string().optional(),
                dr_number: z.string().optional(),
                po_number: z.string().optional(),
                notes: z.string().optional(),
                items: z.array(z.any()).optional()
              })
            })
          }
        }
      }
    },
    responses: {
      200: { description: 'RMA record updated cleanly with edited_by_email and updated_at' },
      401: { description: 'Unauthorized session', content: { 'application/json': { schema: StandardErrorSchema } } },
      403: { description: 'Identity mismatch, revoked/expired invite, or Live/Test isolation block', content: { 'application/json': { schema: StandardErrorSchema } } }
    }
  });

  // POST /api/upload-photo?action=inspect-plate (plus multi-photo pickup uploads)
  registry.registerPath({
    method: 'post',
    path: '/api/upload-photo',
    summary: 'Upload Proof/Pickup Photo (up to 5x10=50) & OCR Inspection (?action=inspect-plate / inspect-driver-id / inspect-paperwork)',
    description: 'Handles Google Shared Drive / Supabase Storage uploads for intake photos and 5-category driver pickup slots (`string[]` up to 10 photos/slot, 50 total), plus Gemini AI OCR actions including `?action=inspect-plate` for Slot 3 Delivery Truck Plate extraction and `?action=inspect-driver-id` for Philippine Gov/Legal ID extraction.',
    tags: ['AI Document Inspection'],
    request: {
      query: z.object({
        action: z.enum(['inspect-paperwork', 'inspect-driver-id', 'inspect-plate']).optional().openapi({
          example: 'inspect-plate',
          description: 'Optional AI OCR action (`inspect-plate` auto-fills Truck Plate # on Slot 3 upload).'
        })
      }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              fileData: z.string().optional().openapi({ description: 'Base64 / data-URI WebP or PNG image string' }),
              mimeType: z.string().optional().default('image/png'),
              rmaNumber: z.string().optional().openapi({ example: 'RMA-2026-0001-6TYH' }),
              fileName: z.string().optional()
            })
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Photo uploaded cleanly or OCR fields extracted (including `is_valid_plate` & `plate_number` for `?action=inspect-plate`)'
      }
    }
  });

  const DailySchedulerResponseSchema = z.object({
    success: z.boolean().openapi({ example: true }),
    dryRun: z.boolean().optional(),
    skipped: z.boolean().optional(),
    reason: z.string().optional().openapi({ example: 'BEFORE_SCHEDULED_TIME' }),
    phtDate: z.string().optional().openapi({ example: '2026-11-24' }),
    phtTime: z.string().optional().openapi({ example: '13:05' }),
    targetTimePht: z.string().optional().openapi({ example: '13:00', description: 'Editable HH:mm Asia/Manila target schedule persisted in rma_settings (default 13:00 for both Follow-Up & Matrix)' }),
    isTestMode: z.boolean().optional(),
    sandboxEmail: z.string().optional().openapi({ example: 'mgan@pingconmarketing.com' }),
    summary: z.object({
      scanned: z.number().int().optional(),
      followUpsSent: z.number().int().optional(),
      autoDisposed: z.number().int().optional(),
      skippedCount: z.number().int().optional(),
      errorCount: z.number().int().optional()
    }).optional()
  });

  // GET /api/send-email?action=daily-followup|daily-matrix (Cron / Scheduled PHT Execution)
  registry.registerPath({
    method: 'get',
    path: '/api/send-email',
    summary: 'Execute Scheduled Daily 10-Day Pickup Follow-Up (?action=daily-followup), Daily Matrix (?action=daily-matrix), or IMAP Email .xlsx Reply Sync (?action=sync-email-replies)',
    description: 'Vercel Cron / GitHub Actions endpoint (protected by CRON_SECRET or Admin Bearer JWT under 12-function cap). Respects adjustable `autoSendTimePht` (`respectSchedule=true`) in `Asia/Manila` (`13:00` default Follow-Up & Matrix, zero manual Send Follow-Up UI button), enforces Test Sandbox isolation (`mgan@pingconmarketing.com` + `[TEST] ` subject prefix), and polls recent Gmail `SINCE` (2-day window, recursive MIME) `.xlsx` reply attachments via `?action=sync-email-replies` (plus optional `?syncReplies=1` on cron).',
    tags: ['Automation & Email'],
    security: [{ BearerAuth: [] }],
    request: {
      query: z.object({
        action: z.enum(['daily-followup', 'daily-matrix', 'sync-email-replies', 'reply-sync-logs']).openapi({ example: 'daily-followup' }),
        respectSchedule: z.enum(['true', 'false', '1']).optional().openapi({ example: 'true' }),
        force: z.enum(['true', 'false', '1']).optional(),
        dryRun: z.enum(['true', 'false', '1']).optional(),
        testMode: z.enum(['true', 'false']).optional(),
        rmaNumber: z.string().optional(),
        source: z.string().optional(),
        strict: z.enum(['0', '1', 'true', 'false']).optional()
      })
    },
    responses: {
      200: { description: 'Scheduled dispatcher result', content: { 'application/json': { schema: DailySchedulerResponseSchema } } },
      401: { description: 'Unauthorized cron/admin caller', content: { 'application/json': { schema: StandardErrorSchema } } }
    }
  });

  // POST /api/send-email (Intake, 4 Lifecycle PDFs, ?action=daily-followup, ?action=daily-matrix)
  registry.registerPath({
    method: 'post',
    path: '/api/send-email',
    summary: 'Dispatch RMA Email (with Mirror .xlsx), Lifecycle PDF, Daily Matrix (.xlsx), 10-Day SLA Follow-Up, or 2-Way .xlsx Reply Sync',
    description: `Unified serverless mailer & 2-way .xlsx reply processor preserving Vercel's 12-function cap:
- **Standard, Lifecycle & Admin-Only Test Mode Emails**: Routes Live notifications via \`rma_settings.email_recipients_by_type\` and Test Mode notifications via Admin-only \`rma_settings.test_email_recipients\` / \`test_email_recipients_by_type\` (**never exposed on public \`/\`**), enforcing \`[TEST] \` as the first subject word and Sandbox isolation (default \`mgan@pingconmarketing.com\`). New RMA alerts attach an editable \`Serial No. | Field | Value | Format / Notes\` + \`MANIFEST LINE ITEMS\` (\`Serial No.\` Column A) mirror \`.xlsx\` workbook (matching subject + \`formatSaveFileTimestamp\`) and set \`replyTo\`. \`pickup_debit_claim\` omits \`Store / Branch:\` and \`Warehouse Location:\` while embedding \`Explanation / Defect Notes:\`, optional 5-slot pickup photos (max 50), and \`Debit-Claim-Form-*.pdf\` / \`Customer-Credit-Handover-Form-*.pdf\`.
- **\`?action=daily-followup\`**: Runs automated 4-Step Workflow & Day 0..10 Pickup Follow-Up SLA (default \`13:00\` PHT; manual UI \`Send Follow-Up\` buttons removed; stops immediately on Picked Up / \`✓ Case Close\`; resettable via \`resetReportToPending\`; auto-disposes >10 calendar days unclaimed to \`Disposal / Scrap Area\` w/ \`workflow_resolution: "scrapped_no_reorder"\` and notifies \`new_rma\` recipients).
- **\`?action=daily-matrix\`**: Generates and emails the strict OOXML Overall RMA Matrix (\`.xlsx\`) using \`daily_matrix_config\` (Rolling Days or Custom \`YYYY-MM-DD\`, scope, \`includeZeroCatalogSkus\`, editable \`autoSendTimePht\`).
- **\`?action=sync-email-replies\` / \`?action=ingest-xlsx-reply\`**: Automatically polls recent Gmail IMAP \`.xlsx\` replies via \`UID SEARCH SINCE\` + recursive nested MIME parsing (manual Upload/Check UI buttons removed; Admin UI polls every 60s), supports per-item \`Supplier Name\` updates inside \`MANIFEST LINE ITEMS\` (matching Barcode, SKU, or 1-based \`Serial No.\` across \`parentReport.items\`, child \`rma_reports\`, and \`rma_items\` without overwriting siblings), supports legacy headers, enforces strict Test (\`RMA-TEST-...\`) vs Live (\`RMA-...\`) isolation, preserves \`[TEST_MODE]\`, updates \`rma_settings.supplier_directory_store\`, and appends \`EMAIL_XLSX_REPLY_UPDATE\` to \`audit_trail\`.`,
    tags: ['Automation & Email'],
    security: [{ BearerAuth: [] }],
    request: {
      query: z.object({
        action: z.enum(['daily-followup', 'daily-matrix', 'sync-email-replies', 'ingest-xlsx-reply']).optional()
      }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              action: z.string().optional().openapi({ example: 'daily-followup' }),
              fileBase64: z.string().optional().openapi({ description: 'Base64-encoded .xlsx workbook bytes for action=ingest-xlsx-reply' }),
              filename: z.string().optional().openapi({ example: '[RMA Alert] RMA-2026-0001 Nov 25, 2026 0832.xlsx' }),
              senderEmail: z.string().optional().openapi({ example: 'mgan@pingconmarketing.com' }),
              replyTo: z.string().optional(),
              operation: z.enum(['run_all', 'send_single', 'check_dispose_only']).optional().openapi({ example: 'run_all' }),
              rmaNumber: z.string().optional().openapi({ example: 'RMA-2026-0001-6TYH' }),
              respectSchedule: z.boolean().optional().openapi({ example: true }),
              force: z.boolean().optional(),
              dryRun: z.boolean().optional(),
              isTestMode: z.boolean().optional(),
              sandboxEmail: z.string().email().optional().openapi({ example: 'mgan@pingconmarketing.com' }),
              startDate: z.string().optional().openapi({ example: '2026-11-10' }),
              endDate: z.string().optional().openapi({ example: '2026-11-24' }),
              stream: z.enum(['overall', 'customer_inbound', 'supplier_outbound']).optional(),
              includeZeroCatalogSkus: z.boolean().optional(),
              to: z.union([z.string(), z.array(z.string())]).optional(),
              cc: z.array(z.string()).optional(),
              subject: z.string().optional(),
              html: z.string().optional(),
              text: z.string().optional()
            })
          }
        }
      }
    },
    responses: {
      200: { description: 'Email or daily automation batch processed cleanly', content: { 'application/json': { schema: DailySchedulerResponseSchema } } },
      401: { description: 'Unauthorized when invoking daily-followup / daily-matrix without CRON_SECRET or Admin JWT', content: { 'application/json': { schema: StandardErrorSchema } } }
    }
  });
}
