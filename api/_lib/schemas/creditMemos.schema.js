import { z, StandardErrorSchema, PaginationQuerySchema } from './common.js';

export const CreditMemoSchema = z.object({
  id: z.number().int().openapi({ example: 78 }),
  credit_memo_number: z.string().openapi({ example: 'CM-20261026-4412' }),
  rma_number: z.string().openapi({ example: 'RMA-20261026-8941' }),
  barcode: z.string().openapi({ example: '4800016644833' }),
  product_name: z.string().openapi({ example: 'Oishi Prawn Crackers 50g' }),
  sku: z.string().nullable().optional().openapi({ example: 'P2678P' }),
  supplier_name: z.string().default('Savemore').openapi({ example: 'Liwayway Marketing' }),
  company: z.string().default('Wholesale Distribution').openapi({ example: 'Wholesale Distribution' }),
  customer_ae_name: z.string().nullable().optional().openapi({ example: 'Maria Santos' }),
  customer_ae_email: z.string().nullable().optional().openapi({ example: 'ae@example.com' }),
  quantity: z.number().default(1).openapi({ example: 5 }),
  unit_name: z.string().default('pc').openapi({ example: 'pc' }),
  unit_price: z.number().default(0).openapi({ example: 27.44 }),
  amount: z.number().default(0).openapi({ example: 137.20 }),
  pull_out_ref: z.string().openapi({ example: 'PO-2026-10-88' }),
  pull_out_date: z.string().optional().openapi({ example: '2026-10-26' }),
  credit_amount: z.number().openapi({ example: 137.20 }),
  credit_issued_by: z.string().openapi({ example: 'Arlito (API)' }),
  status: z.string().default('issued').openapi({ example: 'issued' }),
  notes: z.string().nullable().optional(),
  created_at: z.string().datetime().optional()
}).openapi('CreditMemo');

export const CreateCreditMemoSchema = z.object({
  rma_number: z.string().min(1).openapi({ example: 'RMA-20261026-8941' }),
  barcode: z.string().min(1).openapi({ example: '4800016644833' }),
  product_name: z.string().min(1).openapi({ example: 'Oishi Prawn Crackers 50g' }),
  pull_out_ref: z.string().min(1).openapi({ example: 'PO-2026-10-88' }),
  credit_amount: z.number().min(0.01).openapi({ example: 137.20 }),
  quantity: z.number().min(1).default(1).openapi({ example: 5 }),
  unit_price: z.number().optional().default(0).openapi({ example: 27.44 }),
  sku: z.string().optional().openapi({ example: 'P2678P' }),
  supplier_name: z.string().optional().default('Savemore').openapi({ example: 'Liwayway Marketing' }),
  customer_ae_name: z.string().optional().openapi({ example: 'Maria Santos' }),
  notes: z.string().optional().openapi({ example: 'Approved for finance pull-out deduction' })
}).openapi('CreateCreditMemoRequest');

export function registerCreditMemoRoutes(registry) {
  // GET /api/v1/credit-memos
  registry.registerPath({
    method: 'get',
    path: '/api/v1/credit-memos',
    summary: 'List Credit Memos',
    description: 'Retrieve financial credit memos with search and filters.',
    tags: ['Credit Memos'],
    request: {
      query: PaginationQuerySchema.extend({
        search: z.string().optional().openapi({ description: 'Search term across CM #, pull out ref, or product' }),
        rma_number: z.string().optional().openapi({ description: 'Filter by RMA number' }),
        barcode: z.string().optional().openapi({ description: 'Filter by barcode' })
      })
    },
    responses: {
      200: {
        description: 'Credit memos list',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().openapi({ example: true }),
              client: z.string().openapi({ example: 'Primary System' }),
              total: z.number().openapi({ example: 88 }),
              data: z.array(CreditMemoSchema)
            })
          }
        }
      },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: StandardErrorSchema } } }
    }
  });

  // POST /api/v1/credit-memos
  registry.registerPath({
    method: 'post',
    path: '/api/v1/credit-memos',
    summary: 'Issue Credit Memo',
    description: 'Creates a financial credit memo record with auto-generated CM voucher number.',
    tags: ['Credit Memos'],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: CreateCreditMemoSchema
          }
        }
      }
    },
    responses: {
      201: {
        description: 'Credit memo issued',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().openapi({ example: true }),
              message: z.string().openapi({ example: 'Credit Memo CM-20261026-4412 issued successfully.' }),
              data: CreditMemoSchema
            })
          }
        }
      },
      400: { description: 'Bad request', content: { 'application/json': { schema: StandardErrorSchema } } }
    }
  });

  // GET /api/v1/credit-memos/{id}
  registry.registerPath({
    method: 'get',
    path: '/api/v1/credit-memos/{id}',
    summary: 'Get Credit Memo Details',
    description: 'Retrieve a credit memo voucher by ID or CM number (e.g. CM-20261026-4412).',
    tags: ['Credit Memos'],
    request: {
      params: z.object({
        id: z.string().openapi({ example: 'CM-20261026-4412' })
      })
    },
    responses: {
      200: {
        description: 'Credit memo found',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().openapi({ example: true }),
              data: CreditMemoSchema
            })
          }
        }
      },
      404: { description: 'Not found', content: { 'application/json': { schema: StandardErrorSchema } } }
    }
  });
}
