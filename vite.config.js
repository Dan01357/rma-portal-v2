import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

function patchVercelResponse(res) {
  if (typeof res.status === 'function' && typeof res.json === 'function' && typeof res.send === 'function') {
    return res;
  }
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(payload));
    return res;
  };
  res.send = (payload) => {
    if (typeof payload === 'object' && payload !== null && !Buffer.isBuffer(payload)) {
      return res.json(payload);
    }
    res.end(payload == null ? '' : String(payload));
    return res;
  };
  return res;
}

function readJsonOrTextBody(req) {
  return new Promise((resolve) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return resolve(undefined);
    }
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
    req.on('error', () => resolve(undefined));
  });
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  Object.assign(process.env, env);

  return {
    plugins: [
      react(),
      basicSsl(),
      {
        name: 'docs-server',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const rawUrl = req.url || '/';
            if (!rawUrl.startsWith('/docs') && !rawUrl.startsWith('/api')) {
              return next();
            }

            if (rawUrl === '/docs' || rawUrl === '/docs/') {
              res.setHeader('Content-Type', 'text/html; charset=utf-8');
              return res.end(`<!doctype html>
<html lang="en">
  <head>
    <title>Wholesale RMA Portal | Interactive REST API Documentation</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin: 0; background-color: #0b0f19;">
    <script
      id="api-reference"
      data-url="/api/openapi.json"
      data-configuration='{"theme":"purple","layout":"modern","showSidebar":true,"searchHotKey":"k"}'
      src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`);
            }

            try {
              const urlObj = new URL(rawUrl, 'https://localhost:5173');
              const pathname = urlObj.pathname;
              const query = Object.fromEntries(urlObj.searchParams.entries());
              req.query = { ...(req.query || {}), ...query };
              patchVercelResponse(res);

              const invokeHandler = async (importer, extraQuery = {}) => {
                Object.assign(req.query, extraQuery);
                req.body = await readJsonOrTextBody(req);
                const mod = await importer();
                const fn = mod.default || mod;
                return fn(req, res);
              };

              if (pathname === '/api/openapi.json' || pathname === '/api/docs') {
                return await invokeHandler(() => import('./api/docs.js'), pathname === '/api/openapi.json' ? { format: 'json' } : {});
              }
              if (pathname === '/api/context' || pathname === '/api/project-context') {
                return await invokeHandler(() => import('./api/docs.js'), { format: 'context' });
              }
              if (pathname === '/api/v1/auth/verify-pin' || pathname === '/api/v1/auth/clear-cooldown') {
                req.body = await readJsonOrTextBody(req);
                const { handleVerifyPin, handleClearCooldown } = await import('./api/_lib/verifyPinHandler.js');
                return pathname.includes('verify-pin') ? handleVerifyPin(req, res) : handleClearCooldown(req, res);
              }
              if (pathname === '/api/v1/products/lookup') {
                return await invokeHandler(() => import('./api/_lib/lookupHandler.js'));
              }
              if (pathname === '/api/send-email') {
                return await invokeHandler(() => import('./api/send-email.js'));
              }
              if (pathname === '/api/upload-photo' || pathname === '/api/v1/ai/inspect-paperwork') {
                return await invokeHandler(
                  () => import('./api/upload-photo.js'),
                  pathname === '/api/v1/ai/inspect-paperwork' ? { action: 'inspect-paperwork' } : {}
                );
              }
              if (pathname === '/api/v1/health') {
                return await invokeHandler(() => import('./api/v1/health.js'));
              }
              if (pathname === '/api/v1/api-keys') {
                return await invokeHandler(() => import('./api/v1/api-keys/index.js'));
              }
              if (pathname.startsWith('/api/v1/api-keys/')) {
                const id = decodeURIComponent(pathname.slice('/api/v1/api-keys/'.length));
                return await invokeHandler(() => import('./api/v1/api-keys/[id].js'), { id });
              }
              if (pathname === '/api/v1/products') {
                return await invokeHandler(() => import('./api/v1/products/index.js'));
              }
              if (pathname.startsWith('/api/v1/products/')) {
                const id = decodeURIComponent(pathname.slice('/api/v1/products/'.length));
                return await invokeHandler(() => import('./api/v1/products/[id].js'), { id });
              }
              if (pathname === '/api/v1/rma') {
                return await invokeHandler(() => import('./api/v1/rma/index.js'));
              }
              if (pathname.startsWith('/api/v1/rma/')) {
                const id = decodeURIComponent(pathname.slice('/api/v1/rma/'.length));
                return await invokeHandler(() => import('./api/v1/rma/[id].js'), { id });
              }
              if (pathname === '/api/v1/credit-memos') {
                return await invokeHandler(() => import('./api/v1/credit-memos/index.js'));
              }
              if (pathname.startsWith('/api/v1/credit-memos/')) {
                const id = decodeURIComponent(pathname.slice('/api/v1/credit-memos/'.length));
                return await invokeHandler(() => import('./api/v1/credit-memos/[id].js'), { id });
              }
            } catch (err) {
              console.error('[Vite API Dev Middleware Error]:', err);
              if (!res.headersSent) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ success: false, error: err.message }));
              }
            }
            next();
          });
        }
      }
    ],
    server: {
      port: 5173,
      host: true
    }
  };
})
