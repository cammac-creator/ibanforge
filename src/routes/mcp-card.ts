import { Hono } from 'hono';

const mcpCard = new Hono();

mcpCard.get('/.well-known/mcp/server-card.json', (c) => {
  return c.json({
    name: 'IBANforge',
    description: 'IBAN validation & BIC/SWIFT lookup API with SEPA compliance, issuer classification, and risk indicators',
    url: 'https://api.ibanforge.com/mcp',
    transport: 'streamable-http',
    version: '1.0.0',
    tools: [
      { name: 'validate_iban', description: 'Validate a single IBAN with BIC, SEPA, issuer, and risk data' },
      { name: 'batch_validate_iban', description: 'Validate up to 100 IBANs in one call' },
      { name: 'lookup_bic', description: 'Look up a BIC/SWIFT code (39K+ GLEIF entries)' },
    ],
    homepage: 'https://ibanforge.com',
    repository: 'https://github.com/cammac-creator/ibanforge',
    documentation: 'https://ibanforge.com/docs/mcp',
  });
});

export { mcpCard };
