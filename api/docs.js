import fs from 'fs';
import path from 'path';
import { setCorsHeaders } from './_lib/auth.js';
import { generateCodeFirstOpenApiSpec } from './_lib/openapiRegistry.js';

export default function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Support returning PROJECT_CONTEXT.txt (served via /api/context or /api/project-context rewrite)
  if (req.query?.format === 'context' || req.query?.format === 'txt' || req.url?.includes('context') || req.url?.includes('PROJECT_CONTEXT')) {
    try {
      const candidates = [
        path.join(process.cwd(), 'dist', 'PROJECT_CONTEXT.txt'),
        path.join(process.cwd(), 'public', 'PROJECT_CONTEXT.txt'),
        path.join(process.cwd(), 'PROJECT_CONTEXT.txt')
      ];

      let foundPath = null;
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          foundPath = c;
          break;
        }
      }

      if (!foundPath) {
        return res.status(404).json({
          success: false,
          error: 'CONTEXT_NOT_FOUND',
          message: 'PROJECT_CONTEXT.txt has not been generated yet. Please run npm run build:context.'
        });
      }

      const content = fs.readFileSync(foundPath, 'utf-8');
      const stats = fs.statSync(foundPath);

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
      res.setHeader('X-Context-Size-Bytes', String(stats.size));
      res.setHeader('X-Context-Updated-At', stats.mtime.toISOString());

      return res.status(200).send(content);
    } catch (err) {
      console.error('[Context Reader Error]:', err);
      return res.status(500).json({
        success: false,
        error: 'CONTEXT_READ_ERROR',
        message: err.message
      });
    }
  }

  // Support returning raw OpenAPI 3.1 JSON
  if (req.query?.format === 'json' || req.url?.includes('openapi.json')) {
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

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const html = `<!doctype html>
<html lang="en">
  <head>
    <title>Wholesale RMA Portal | Interactive REST API Documentation</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%231d6fce' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3 7V5a2 2 0 0 1 2-2h2'/><path d='M17 3h2a2 2 0 0 1 2 2v2'/><path d='M21 17v2a2 2 0 0 1-2 2h-2'/><path d='M7 21H5a2 2 0 0 1-2-2v-2'/><rect width='10' height='8' x='7' y='8' rx='1'/></svg>" />
    <style>
      body {
        margin: 0;
        background-color: #0b0f19;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
    </style>
  </head>
  <body>
    <!-- Scalar Modern Interactive API Reference -->
    <script
      id="api-reference"
      data-url="/api/openapi.json"
      data-configuration='{"theme":"purple","layout":"modern","showSidebar":true,"searchHotKey":"k"}'
      src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;

  return res.status(200).send(html);
}
