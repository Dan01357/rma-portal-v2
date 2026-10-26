import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

// Extend Zod once globally
extendZodWithOpenApi(z);

export { z };

/**
 * Standard Error Response Schema
 */
export const StandardErrorSchema = z.object({
  success: z.boolean().openapi({ example: false }),
  error: z.string().openapi({ example: 'VALIDATION_ERROR' }),
  code: z.string().openapi({ example: 'MISSING_REQUIRED_FIELD' }),
  message: z.string().openapi({ example: 'Field "barcode" is required.' })
}).openapi('StandardError');

/**
 * Pagination Query Parameters Schema
 */
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(200).default(50).openapi({
    description: 'Max number of records to return (1-200)',
    example: 50
  }),
  offset: z.coerce.number().min(0).default(0).openapi({
    description: 'Number of records to skip for pagination',
    example: 0
  })
});
