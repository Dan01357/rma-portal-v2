import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    basicSsl(),
    {
      name: 'docs-server',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url === '/docs' || req.url === '/docs/') {
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
          if (req.url === '/api/openapi.json') {
            const handler = (await import('./api/openapi.json.js')).default;
            return handler(req, res);
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
})
