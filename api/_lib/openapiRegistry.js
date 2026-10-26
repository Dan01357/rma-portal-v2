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
