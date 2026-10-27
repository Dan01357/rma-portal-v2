import { z, StandardErrorSchema, PaginationQuerySchema } from './common.js';

export const ProductSchema = z.object({
  id: z.number().int().openapi({ example: 341 }),
  barcode: z.string().openapi({ example: '4800016644833' }),
  ean_code: z.string().nullable().optional().openapi({ description: 'Physical item barcode (EAN / UPC)', example: '4800016644833' }),
  code: z.string().nullable().optional().openapi({ description: 'Internal SKU / Product Code', example: 'OISHI-PRAWN-50G' }),
  name: z.string().openapi({ example: 'Oishi Prawn Crackers 50g' }),
  price: z.number().default(0).openapi({ example: 24.50 }),
  price_with_vat: z.number().default(0).openapi({ example: 27.44 }),
  supplier_name: z.string().default('Savemore').openapi({ example: 'Liwayway Marketing' }),
  brand_name: z.string().nullable().optional().openapi({ example: 'Oishi' }),
  unit_name: z.string().default('pc').openapi({ example: 'pack' }),
  image_url: z.string().nullable().optional().openapi({ example: 'https://example.com/product.jpg' }),
  ae_name: z.string().nullable().optional().openapi({ description: 'Assigned Customer Account Executive', example: 'Jaezelle Benito' }),
  ae_email: z.string().nullable().optional().openapi({ description: 'Assigned Customer AE Email', example: 'jaezelle.benito@pingconmarketing.com' }),
  is_verified: z.boolean().default(true).openapi({ example: true }),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional()
}).openapi('Product');

export const CreateProductSchema = z.object({
  barcode: z.string().min(1, 'Barcode is required').openapi({ example: '4800016644833' }),
  ean_code: z.string().optional().openapi({ example: '4800016644833' }),
  name: z.string().min(1, 'Product name is required').openapi({ example: 'Oishi Prawn Crackers 50g' }),
  code: z.string().optional().openapi({ example: 'P2678P' }),
  price: z.number().optional().default(0).openapi({ example: 24.50 }),
  price_with_vat: z.number().optional().default(0).openapi({ example: 27.44 }),
  supplier_name: z.string().optional().default('Savemore').openapi({ example: 'Liwayway Marketing' }),
  brand_name: z.string().optional().openapi({ example: 'Oishi' }),
  unit_name: z.string().optional().default('pc').openapi({ example: 'pack' }),
  image_url: z.string().optional().openapi({ example: 'https://example.com/item.jpg' }),
  ae_name: z.string().optional().openapi({ example: 'Jaezelle Benito' }),
  ae_email: z.string().optional().openapi({ example: 'jaezelle.benito@pingconmarketing.com' })
}).openapi('CreateProductRequest');

export function registerProductRoutes(registry) {
  // GET /api/v1/products/lookup (Public Serverless Proxy)
  registry.registerPath({
    method: 'get',
    path: '/api/v1/products/lookup',
    summary: 'Public Barcode & Product Lookup Proxy',
    description: 'Secure server-side product lookup proxy. Resolves barcodes across Supabase, ERPLY POS/ERP live catalog, and wholesale verified catalog without requiring client credentials.',
    tags: ['Products & Catalog'],
    request: {
      query: z.object({
        barcode: z.string().optional().openapi({ description: 'Barcode or SKU code to scan and resolve', example: '4800016644833' }),
        search: z.string().optional().openapi({ description: 'Keyword search across product names and SKUs', example: 'Bonita' }),
        limit: z.string().optional().openapi({ description: 'Maximum products to return', example: '25' })
      })
    },
    responses: {
      200: {
        description: 'Lookup result',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().openapi({ example: true }),
              found: z.boolean().optional().openapi({ example: true }),
              source: z.string().optional().openapi({ example: 'erply_api' }),
              product: ProductSchema.nullable().optional(),
              products: z.array(ProductSchema).optional()
            })
          }
        }
      }
    }
  });

  // GET /api/v1/products
  registry.registerPath({
    method: 'get',
    path: '/api/v1/products',
    summary: 'Search & List Products Catalog',
    description: 'Retrieve items from the wholesale master catalog filtered by barcode, SKU code, or keyword search.',
    tags: ['Products & Catalog'],
    request: {
      query: PaginationQuerySchema.extend({
        barcode: z.string().optional().openapi({ description: 'Filter by exact product barcode', example: '4800016644833' }),
        code: z.string().optional().openapi({ description: 'Filter by SKU item code', example: 'P2678P' }),
        search: z.string().optional().openapi({ description: 'Search name or barcode', example: 'Crackers' })
      })
    },
    responses: {
      200: {
        description: 'Matching products',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().openapi({ example: true }),
              client: z.string().openapi({ example: 'Arlito' }),
              total: z.number().openapi({ example: 450 }),
              limit: z.number().openapi({ example: 50 }),
              offset: z.number().openapi({ example: 0 }),
              data: z.array(ProductSchema)
            })
          }
        }
      },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: StandardErrorSchema } } }
    }
  });

  // POST /api/v1/products
  registry.registerPath({
    method: 'post',
    path: '/api/v1/products',
    summary: 'Create or Upsert Product',
    description: 'Adds or updates a product in the catalog indexed by barcode.',
    tags: ['Products & Catalog'],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: CreateProductSchema
          }
        }
      }
    },
    responses: {
      201: {
        description: 'Product upserted',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().openapi({ example: true }),
              message: z.string().openapi({ example: 'Product saved successfully.' }),
              data: ProductSchema
            })
          }
        }
      },
      400: { description: 'Bad request', content: { 'application/json': { schema: StandardErrorSchema } } }
    }
  });

  // GET /api/v1/products/{id}
  registry.registerPath({
    method: 'get',
    path: '/api/v1/products/{id}',
    summary: 'Get Product Details',
    description: 'Retrieve a product by its numeric ID or its barcode.',
    tags: ['Products & Catalog'],
    request: {
      params: z.object({
        id: z.string().openapi({ description: 'Numeric ID or Barcode', example: '4800016644833' })
      })
    },
    responses: {
      200: {
        description: 'Product found',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().openapi({ example: true }),
              data: ProductSchema
            })
          }
        }
      },
      404: { description: 'Product not found', content: { 'application/json': { schema: StandardErrorSchema } } }
    }
  });
}
