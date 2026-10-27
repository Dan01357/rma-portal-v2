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

export const RMAReportSchema = z.object({
  id: z.number().int().openapi({ example: 1042 }),
  rma_number: z.string().openapi({ example: 'RMA-20261026-8941' }),
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
  notes: z.string().nullable().optional().openapi({ example: 'Customer returned item with receipt' }),
  created_at: z.string().datetime().openapi({ example: '2026-10-26T14:30:00.000Z' })
}).openapi('RMAReport');

export const CreateRMAReportSchema = z.object({
  barcode: z.string().min(1, 'Barcode is required').openapi({ example: '4800016644833' }),
  name: z.string().min(1, 'Product name is required').openapi({ example: 'Oishi Prawn Crackers 50g' }),
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
  notes: z.string().optional().openapi({ example: 'Submitted via REST API' })
}).openapi('CreateRMAReportRequest');

export const UpdateRMAReportSchema = z.object({
  status: RMAStatusEnum.optional().openapi({ example: 'under_inspection' }),
  condition_grade: RMAConditionGradeEnum.optional().openapi({ example: 'A - Like New / Resellable' }),
  disposition: RMADispositionEnum.optional().openapi({ example: 'Restock to Inventory' }),
  warehouse_location: z.string().optional().openapi({ example: 'RACK-03-BIN-A' }),
  inspected_by: z.string().optional().openapi({ example: 'Supervisor Danilo' }),
  quantity: z.number().int().min(1).optional().openapi({ example: 3 }),
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
}
