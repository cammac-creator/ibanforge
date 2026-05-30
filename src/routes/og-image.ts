import { Hono } from 'hono';

const ogImage = new Hono();

ogImage.get('/og-image.png', (c) => {
  c.header('Cache-Control', 'public, max-age=86400');
  c.header('Content-Type', 'image/svg+xml');

  const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#09090b"/>
  <text x="600" y="240" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="72" font-weight="800" fill="#fafafa">IBAN<tspan fill="#f59e0b">forge</tspan></text>
  <text x="600" y="310" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="28" fill="#a1a1aa">IBAN Validation &amp; BIC Lookup API</text>
  <text x="600" y="400" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="20" fill="#71717a">121K BICs · 89 Countries · MCP Native · x402 Micropayments</text>
  <rect x="440" y="450" width="320" height="48" rx="10" fill="#f59e0b"/>
  <text x="600" y="482" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="18" font-weight="700" fill="#000">api.ibanforge.com</text>
</svg>`;

  return c.body(svg);
});

export { ogImage };
