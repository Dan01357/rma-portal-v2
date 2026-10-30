import { z, StandardErrorSchema, PaginationQuerySchema } from './common.js';

export const RMAStatusEnum = z.enum([
  'draft',
  'received_at_dock',
  'under_inspection',
  'pending_finance_approval',
  'credit_memo_issued',
  'closed',
  'rejected',
  'pending',
  'pending_admin_details',
  'resolved',
  'logged'
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

export const RMAReportSchema = z.object({
  id: z.number().int().openapi({ example: 1042 }),
  rma_number: z.string().openapi({ example: 'RMA-20261026-8941' }),
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
  store_branch: z.string().nullable().optional().openapi({ example: 'Savemore Taguig - Branch 14' }),
  invoice_dr_number: z.string().nullable().optional().openapi({ example: 'DR-2026-8891' }),
  si_number: z.string().nullable().optional().openapi({ example: 'SI-2026-9021' }),
  dr_number: z.string().nullable().optional().openapi({ example: 'DR-2026-8891' }),
  po_number: z.string().nullable().optional().openapi({ example: 'PO-2026-4401' }),
  expiry_date: z.string().nullable().optional().openapi({ example: '2026-12-31' }),
  batch_lot_number: z.string().nullable().optional().openapi({ example: 'LOT-B42' }),
  notes: z.string().nullable().optional().openapi({ example: 'Customer returned item with receipt' }),
  created_at: z.string().datetime().openapi({ example: '2026-10-26T14:30:00.000Z' })
}).openapi('RMAReport');

export const CreateRMAReportSchema = z.object({
  barcode: z.string().min(1, 'Barcode is required').openapi({ example: '4800016644833' }),
  name: z.string().min(1, 'Product name is required').openapi({ example: 'Oishi Prawn Crackers 50g' }),
  rma_type: RMATypeEnum.optional().default('customer_inbound').openapi({ example: 'customer_inbound', description: 'Logistics type: customer_inbound (default) or supplier_outbound' }),
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
  inspected_by: z.string().optional().openapi({ example: 'Warehouse Lead' }),
  reason: z.string().optional().default('Damaged Box / Crushed Packaging').openapi({ example: 'Damaged Box / Crushed Packaging' }),
  explanation: z.string().optional().openapi({ example: 'Crushed box during unloading' }),
  photos: z.array(z.string().url()).optional().default([]).openapi({ example: ['https://example.com/box1.jpg'] }),
  reporter_name: z.string().optional().openapi({ example: 'Warehouse Lead' }),
  reporter_contact: z.string().optional().openapi({ example: '09170001122' }),
  store_branch: z.string().optional().openapi({ example: 'Savemore Taguig - Branch 14' }),
  invoice_dr_number: z.string().optional().openapi({ example: 'DR-2026-8891' }),
  si_number: z.string().optional().openapi({ example: 'SI-2026-9021' }),
  dr_number: z.string().optional().openapi({ example: 'DR-2026-8891' }),
  po_number: z.string().optional().openapi({ example: 'PO-2026-4401' }),
  expiry_date: z.string().optional().openapi({ example: '2026-12-31' }),
  batch_lot_number: z.string().optional().openapi({ example: 'LOT-B42' }),
  notes: z.string().optional().openapi({ example: 'Submitted via REST API' })
}).openapi('CreateRMAReportRequest');

export const UpdateRMAReportSchema = z.object({
  rma_type: RMATypeEnum.optional().openapi({ example: 'supplier_outbound', description: 'Reclassify logistics type between customer_inbound and supplier_outbound' }),
  status: RMAStatusEnum.optional().openapi({ example: 'under_inspection' }),
  condition_grade: RMAConditionGradeEnum.optional().openapi({ example: 'A - Like New / Resellable' }),
  disposition: RMADispositionEnum.optional().openapi({ example: 'Restock to Inventory' }),
  warehouse_location: z.string().optional().openapi({ example: 'RACK-03-BIN-A' }),
  inspected_by: z.string().optional().openapi({ example: 'Supervisor Danilo' }),
  quantity: z.number().int().min(1).optional().openapi({ example: 3 }),
  store_branch: z.string().optional().openapi({ example: 'Savemore Taguig - Branch 14' }),
  invoice_dr_number: z.string().optional().openapi({ example: 'DR-2026-8891' }),
  si_number: z.string().optional().openapi({ example: 'SI-2026-9021' }),
  dr_number: z.string().optional().openapi({ example: 'DR-2026-8891' }),
  po_number: z.string().optional().openapi({ example: 'PO-2026-4401' }),
  expiry_date: z.string().optional().openapi({ example: '2026-12-31' }),
  batch_lot_number: z.string().optional().openapi({ example: 'LOT-B42' }),
  notes: z.string().optional().openapi({ example: 'Inspection verified by supervisor' }),
  explanation: z.string().optional().openapi({ example: 'Replacement voucher issued' }),
  price: z.number().optional().openapi({ example: 25.00 }),
  price_with_vat: z.number().optional().openapi({ example: 28.00 })
}).openapi('UpdateRMAReportRequest');

export function registerRMARoutes(registry) {
  // GET /api/v1/rma
  registry.registerPath({
    method: 'get',
    path: '/api/v1/rma',
    summary: 'List RMA Return Reports',
    description: 'Fetch paginated return reports with optional filtering by status, product barcode, or text search.',
    tags: ['RMA Reports'],
    request: {
      query: PaginationQuerySchema.extend({
        rma_type: z.enum(['customer_inbound', 'supplier_outbound']).optional().openapi({ description: 'Filter by logistics type: customer_inbound or supplier_outbound', example: 'customer_inbound' }),
        status: z.string().optional().openapi({ description: 'Filter by status (pending, resolved, etc.)', example: 'pending' }),
        barcode: z.string().optional().openapi({ description: 'Filter by exact product barcode', example: '4800016644833' }),
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
              message: z.string().openapi({ example: 'RMA report RMA-20261026-8941 created successfully.' }),
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
    description: 'Retrieve a return report by its numeric database ID or its public RMA Number (e.g. RMA-20261026-8941).',
    tags: ['RMA Reports'],
    request: {
      params: z.object({
        id: z.string().openapi({ description: 'Numeric ID or RMA Number', example: 'RMA-20261026-8941' })
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
    summary: 'Update RMA Report',
    description: 'Update status, inspection notes, or details of an existing RMA report.',
    tags: ['RMA Reports'],
    request: {
      params: z.object({
        id: z.string().openapi({ description: 'Numeric ID or RMA Number', example: 'RMA-20261026-8941' })
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
        id: z.string().openapi({ example: 'RMA-20261026-8941' })
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
}
