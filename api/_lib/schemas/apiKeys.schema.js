import { z, StandardErrorSchema } from './common.js';

export const ApiKeyRecordSchema = z.object({
  id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d' }),
  name: z.string().openapi({ example: 'Jarmen' }),
  masked_key: z.string().openapi({ example: 'sk_live_...e6c6' }),
  is_active: z.boolean().openapi({ example: true }),
  rate_limit: z.number().int().default(60).openapi({ example: 60 }),
  expires_at: z.string().datetime().nullable().optional(),
  last_used_at: z.string().datetime().nullable().optional(),
  created_at: z.string().datetime().optional()
}).openapi('ApiKeyRecord');

export const CreateApiKeyRequestSchema = z.object({
  name: z.enum(['Primary System (Mine)', 'Jarmen', 'Jelo', 'Arlito']).openapi({
    description: 'Target client system',
    example: 'Jarmen'
  }),
  rateLimit: z.number().int().min(10).max(300).default(60).optional().openapi({ example: 60 }),
  expiresAt: z.string().datetime().optional()
}).openapi('CreateApiKeyRequest');

export function registerApiKeyRoutes(registry) {
  // GET /api/v1/api-keys
  registry.registerPath({
    method: 'get',
    path: '/api/v1/api-keys',
    summary: 'List Registered API Keys (Masked)',
    description: 'Returns all client keys with masked tokens. Never exposes secret keys or SHA-256 hashes.',
    tags: ['API Key Administration'],
    responses: {
      200: {
        description: 'List of registered API keys',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().openapi({ example: true }),
              count: z.number().openapi({ example: 4 }),
              keys: z.array(ApiKeyRecordSchema)
            })
          }
        }
      }
    }
  });

  // POST /api/v1/api-keys
  registry.registerPath({
    method: 'post',
    path: '/api/v1/api-keys',
    summary: 'Generate New API Key for Client System',
    description: 'Issues a new secret API key for Primary System, Jarmen, Jelo, or Arlito. Returns the raw secret key ONCE.',
    tags: ['API Key Administration'],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: CreateApiKeyRequestSchema
          }
        }
      }
    },
    responses: {
      201: {
        description: 'API key generated with one-time raw secret',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().openapi({ example: true }),
              message: z.string().openapi({ example: 'API Key successfully generated for Jarmen.' }),
              apiKey: z.string().openapi({ example: 'sk_live_rma_b68541b70325e2d858fbf11a4adbb6fcc79709c075cee6c6' }),
              keyRecord: ApiKeyRecordSchema
            })
          }
        }
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: StandardErrorSchema } } }
    }
  });

  // PATCH /api/v1/api-keys/{id}
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/api-keys/{id}',
    summary: 'Rotate Client API Key',
    description: 'Immediately revokes the current secret key and issues a new replacement key for the client.',
    tags: ['API Key Administration'],
    request: {
      params: z.object({
        id: z.string().uuid().openapi({ description: 'API Key UUID', example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d' })
      })
    },
    responses: {
      200: {
        description: 'Key rotated with new raw secret returned once',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().openapi({ example: true }),
              message: z.string().openapi({ example: 'API Key rotated successfully.' }),
              apiKey: z.string().openapi({ example: 'sk_live_rma_new_key_here' }),
              keyRecord: ApiKeyRecordSchema
            })
          }
        }
      },
      404: { description: 'API key not found', content: { 'application/json': { schema: StandardErrorSchema } } }
    }
  });

  // DELETE /api/v1/api-keys/{id}
  registry.registerPath({
    method: 'delete',
    path: '/api/v1/api-keys/{id}',
    summary: 'Revoke and Delete API Key',
    description: 'Permanently deletes an API key. Calls made with this key will immediately fail with 401 Unauthorized.',
    tags: ['API Key Administration'],
    request: {
      params: z.object({
        id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d' })
      })
    },
    responses: {
      200: {
        description: 'Key revoked and deleted',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean().openapi({ example: true }),
              message: z.string().openapi({ example: 'API key deleted.' }),
              deletedKey: ApiKeyRecordSchema
            })
          }
        }
      },
      404: { description: 'Key not found', content: { 'application/json': { schema: StandardErrorSchema } } }
    }
  });
}
