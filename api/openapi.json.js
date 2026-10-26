import { setCorsHeaders } from './_lib/auth.js';
import { generateCodeFirstOpenApiSpec } from './_lib/openapiRegistry.js';

/**
 * Dynamic Code-First OpenAPI 3.1 Spec Endpoint
 * Generated at runtime from Zod schemas and route definitions.
 */
export default function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    const spec = generateCodeFirstOpenApiSpec();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json(spec);
  } catch (err) {
    console.error('[OpenAPI Generator Error]:', err);
    return res.status(500).json({
      success: false,
      error: 'OPENAPI_GENERATION_FAILED',
      message: err.message
    });
  }
}
