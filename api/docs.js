export default function handler(req, res) {
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
