import { setCorsHeaders } from './_lib/auth.js';

export default function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'Wholesale RMA Multi-System REST API',
      version: '1.0.0',
      description: `
Enterprise-grade RESTful API for Wholesale RMA Portal v2.
Built for secure cross-system integration across 4 client systems:
- **Primary System (Mine)**
- **Jarmen**
- **Jelo**
- **Arlito**

### Authentication
All requests (except public \`/api/v1/health\`) require a valid API Key.
Pass your key using either:
- **Header**: \`x-api-key: sk_live_rma_...\`
- **Header**: \`Authorization: Bearer sk_live_rma_...\`

Click **Authorize** on the top right to test endpoints directly from this interactive console.
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
    components: {
      securitySchemes: {
        ApiKeyHeader: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'Pass secret key via x-api-key header'
        },
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API-Key',
          description: 'Pass secret key via Authorization: Bearer <key>'
        }
      },
      schemas: {
        StandardError: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: { type: 'string', example: 'Unauthorized' },
            code: { type: 'string', example: 'MISSING_API_KEY' },
            message: { type: 'string', example: 'Missing API key in request header.' }
          }
        },
        RMAReport: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1042 },
            rma_number: { type: 'string', example: 'RMA-20261026-8941' },
            barcode: { type: 'string', example: '4800016644833' },
            code: { type: 'string', example: 'OISHI-PRAWN-50G' },
            name: { type: 'string', example: 'Oishi Prawn Crackers 50g' },
            quantity: { type: 'integer', example: 5 },
            supplier_name: { type: 'string', example: 'Liwayway Marketing' },
            price: { type: 'number', example: 24.50 },
            price_with_vat: { type: 'number', example: 27.44 },
            unit_name: { type: 'string', example: 'pack' },
            status: { type: 'string', example: 'pending', enum: ['pending', 'pending_admin_details', 'resolved', 'logged'] },
            reason: { type: 'string', example: 'Damaged Box / Crushed Packaging' },
            explanation: { type: 'string', example: 'Water damage during warehouse transit.' },
            photos: { type: 'array', items: { type: 'string' }, example: ['https://example.com/photo1.jpg'] },
            reporter_name: { type: 'string', example: 'Juan Dela Cruz' },
            reporter_contact: { type: 'string', example: '09171234567' },
            reported_by: { type: 'string', example: 'Jarmen (API)' },
            created_at: { type: 'string', format: 'date-time' }
          }
        },
        Product: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 341 },
            barcode: { type: 'string', example: '4800016644833' },
            code: { type: 'string', example: 'OISHI-PRAWN-50G' },
            name: { type: 'string', example: 'Oishi Prawn Crackers 50g' },
            price: { type: 'number', example: 24.50 },
            price_with_vat: { type: 'number', example: 27.44 },
            supplier_name: { type: 'string', example: 'Liwayway Marketing' },
            unit_name: { type: 'string', example: 'pack' },
            is_verified: { type: 'boolean', example: true }
          }
        },
        CreditMemo: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 78 },
            credit_memo_number: { type: 'string', example: 'CM-20261026-4412' },
            rma_number: { type: 'string', example: 'RMA-20261026-8941' },
            barcode: { type: 'string', example: '4800016644833' },
            product_name: { type: 'string', example: 'Oishi Prawn Crackers 50g' },
            pull_out_ref: { type: 'string', example: 'PO-2026-10-88' },
            quantity: { type: 'number', example: 5 },
            credit_amount: { type: 'number', example: 137.20 },
            credit_issued_by: { type: 'string', example: 'Arlito (API)' },
            status: { type: 'string', example: 'issued' }
          }
        }
      }
    },
    security: [
      { ApiKeyHeader: [] },
      { BearerAuth: [] }
    ],
    paths: {
      '/api/v1/health': {
        get: {
          summary: 'Service Health & Identity Check',
          description: 'Returns API server status, database latency, and identifies the caller if an API key is attached.',
          security: [],
          tags: ['Health & Diagnostics'],
          responses: {
            '200': {
              description: 'Service is healthy',
              content: {
                'application/json': {
                  example: {
                    status: 'healthy',
                    version: '1.0.0',
                    timestamp: '2026-10-26T14:30:00.000Z',
                    database: { status: 'connected', latency_ms: 12 },
                    authenticated_client: 'Jarmen (sk_live_...9f2a)'
                  }
                }
              }
            }
          }
        }
      },
      '/api/v1/rma': {
        get: {
          summary: 'List RMA Reports',
          description: 'Fetch paginated RMA return reports with optional filtering by status, barcode, or text search.',
          tags: ['RMA Reports'],
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Filter by status (pending, resolved, etc.)' },
            { name: 'barcode', in: 'query', schema: { type: 'string' }, description: 'Filter by exact product barcode' },
            { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search term across RMA #, name, SKU, or reporter' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 }, description: 'Max records (max 200)' },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 }, description: 'Pagination offset' }
          ],
          responses: {
            '200': {
              description: 'List of RMA reports',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      client: { type: 'string' },
                      total: { type: 'integer' },
                      data: { type: 'array', items: { $ref: '#/components/schemas/RMAReport' } }
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/401Error' }
          }
        },
        post: {
          summary: 'Submit New RMA Return Report',
          description: 'Submits a return report from an external system. Automatically generates a unique RMA Number and attributes the report to the calling client system.',
          tags: ['RMA Reports'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['barcode', 'name'],
                  properties: {
                    barcode: { type: 'string', example: '4800016644833' },
                    name: { type: 'string', example: 'Oishi Prawn Crackers 50g' },
                    code: { type: 'string', example: 'P2678P' },
                    quantity: { type: 'integer', example: 2 },
                    supplier_name: { type: 'string', example: 'Liwayway Marketing' },
                    price: { type: 'number', example: 24.50 },
                    price_with_vat: { type: 'number', example: 27.44 },
                    unit_name: { type: 'string', example: 'pack' },
                    reason: { type: 'string', example: 'Damaged Box / Crushed Packaging' },
                    explanation: { type: 'string', example: 'Crushed during warehouse handling' },
                    photos: { type: 'array', items: { type: 'string' }, example: ['https://example.com/damage1.jpg'] },
                    reporter_name: { type: 'string', example: 'Juan Dela Cruz' },
                    reporter_contact: { type: 'string', example: '09170001122' },
                    notes: { type: 'string', example: 'Urgent pull-out requested.' }
                  }
                }
              }
            }
          },
          responses: {
            '201': {
              description: 'RMA report successfully created'
            },
            '400': { $ref: '#/components/responses/400Error' },
            '401': { $ref: '#/components/responses/401Error' }
          }
        }
      },
      '/api/v1/rma/{id}': {
        get: {
          summary: 'Get Single RMA Report',
          tags: ['RMA Reports'],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Numeric ID or RMA Number (e.g. RMA-20261026-1234)' }
          ],
          responses: {
            '200': { description: 'RMA report found' },
            '404': { description: 'RMA report not found' }
          }
        },
        patch: {
          summary: 'Update RMA Report',
          tags: ['RMA Reports'],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
          ],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['pending', 'pending_admin_details', 'resolved', 'logged'] },
                    notes: { type: 'string' },
                    explanation: { type: 'string' },
                    quantity: { type: 'integer' }
                  }
                }
              }
            }
          },
          responses: {
            '200': { description: 'Updated successfully' }
          }
        },
        delete: {
          summary: 'Delete RMA Report',
          tags: ['RMA Reports'],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
          ],
          responses: {
            '200': { description: 'Deleted successfully' }
          }
        }
      },
      '/api/v1/products': {
        get: {
          summary: 'Query Product Catalog',
          tags: ['Products & Catalog'],
          parameters: [
            { name: 'barcode', in: 'query', schema: { type: 'string' }, description: 'Query by exact barcode' },
            { name: 'code', in: 'query', schema: { type: 'string' }, description: 'Query by SKU item code' },
            { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search name or barcode' }
          ],
          responses: {
            '200': { description: 'Products list' }
          }
        },
        post: {
          summary: 'Create or Upsert Product',
          tags: ['Products & Catalog'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['barcode', 'name'],
                  properties: {
                    barcode: { type: 'string', example: '4800016644833' },
                    name: { type: 'string', example: 'Oishi Prawn Crackers 50g' },
                    code: { type: 'string', example: 'P2678P' },
                    price: { type: 'number', example: 24.50 },
                    price_with_vat: { type: 'number', example: 27.44 },
                    supplier_name: { type: 'string', example: 'Liwayway Marketing' },
                    unit_name: { type: 'string', example: 'pc' }
                  }
                }
              }
            }
          },
          responses: {
            '201': { description: 'Product saved or updated' }
          }
        }
      },
      '/api/v1/credit-memos': {
        get: {
          summary: 'List Credit Memos',
          tags: ['Credit Memos'],
          parameters: [
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'rma_number', in: 'query', schema: { type: 'string' } },
            { name: 'barcode', in: 'query', schema: { type: 'string' } }
          ],
          responses: {
            '200': { description: 'Credit memos list' }
          }
        },
        post: {
          summary: 'Issue Credit Memo',
          tags: ['Credit Memos'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['rma_number', 'barcode', 'product_name', 'pull_out_ref', 'credit_amount'],
                  properties: {
                    rma_number: { type: 'string', example: 'RMA-20261026-8941' },
                    barcode: { type: 'string', example: '4800016644833' },
                    product_name: { type: 'string', example: 'Oishi Prawn Crackers 50g' },
                    sku: { type: 'string', example: 'P2678P' },
                    pull_out_ref: { type: 'string', example: 'PO-2026-10-88' },
                    quantity: { type: 'number', example: 5 },
                    unit_price: { type: 'number', example: 27.44 },
                    credit_amount: { type: 'number', example: 137.20 },
                    supplier_name: { type: 'string', example: 'Liwayway Marketing' }
                  }
                }
              }
            }
          },
          responses: {
            '201': { description: 'Credit Memo issued' }
          }
        }
      },
      '/api/v1/api-keys': {
        get: {
          summary: 'List All Client API Keys',
          description: 'Returns active/revoked keys with masked tokens. Never exposes secret keys or SHA-256 hashes.',
          tags: ['API Key Administration'],
          responses: {
            '200': { description: 'Keys list' }
          }
        },
        post: {
          summary: 'Generate New Client API Key',
          description: 'Issues a new secret API key for one of the 4 systems. The raw key is returned ONCE.',
          tags: ['API Key Administration'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: {
                      type: 'string',
                      enum: ['Primary System (Mine)', 'Jarmen', 'Jelo', 'Arlito'],
                      example: 'Jarmen'
                    },
                    rateLimit: { type: 'integer', default: 60, example: 60 },
                    expiresAt: { type: 'string', format: 'date-time' }
                  }
                }
              }
            }
          },
          responses: {
            '201': { description: 'Key generated with one-time raw secret' }
          }
        }
      }
    },
    responses: {
      '400Error': {
        description: 'Bad Request / Validation Failure',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/StandardError' } } }
      },
      '401Error': {
        description: 'Unauthorized / Invalid Key',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/StandardError' } } }
      }
    }
  };

  return res.status(200).json(spec);
}
