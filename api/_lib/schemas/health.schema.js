import { z } from './common.js';

export const HealthResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'down']).openapi({ example: 'healthy' }),
  version: z.string().openapi({ example: '1.0.0' }),
  timestamp: z.string().datetime().openapi({ example: '2026-10-26T15:00:00.000Z' }),
  environment: z.string().openapi({ example: 'production' }),
  service: z.string().openapi({ example: 'Wholesale RMA Multi-System REST API' }),
  database: z.object({
    status: z.string().openapi({ example: 'connected' }),
    latency_ms: z.number().openapi({ example: 14 })
  }),
  authenticated_client: z.string().openapi({ example: 'Jarmen (sk_live_...e6c6)' }),
  documentation: z.string().openapi({ example: '/docs' })
}).openapi('HealthResponse');

export function registerHealthRoutes(registry) {
  registry.registerPath({
    method: 'get',
    path: '/api/v1/health',
    summary: 'Service Health & Identity Check',
    description: 'Returns server operational status, database latency, and identifies the calling client if an API key is provided.',
    tags: ['Health & Diagnostics'],
    security: [], // Public endpoint
    responses: {
      200: {
        description: 'Service is healthy',
        content: {
          'application/json': {
            schema: HealthResponseSchema
          }
        }
      }
    }
  });
}
