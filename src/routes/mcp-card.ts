import { Hono } from 'hono';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

const mcpCard = new Hono();

mcpCard.get('/.well-known/mcp/server-card.json', (c) => {
  return c.json({
    name: 'IBANforge',
    description:
      'IBAN validation, BIC/SWIFT lookup, Swiss clearing, SEPA compliance and risk scoring API for AI agents. 121K+ bank entries from GLEIF, 1,190 Swiss BC-Nummer from SIX, 84 countries.',
    url: 'https://api.ibanforge.com/mcp',
    transport: 'streamable-http',
    version: pkg.version,
    tools: [
      { name: 'validate_iban', description: 'Validate a single IBAN with BIC, SEPA, issuer, and risk data ($0.005)' },
      { name: 'batch_validate_iban', description: 'Validate up to 100 IBANs in one call ($0.002 each)' },
      { name: 'lookup_bic', description: 'Look up a BIC/SWIFT code with LEI enrichment (121K+ GLEIF entries, $0.003)' },
      { name: 'check_compliance', description: 'Full compliance check: sanctions + FATF + SEPA reachability + VoP + risk score ($0.02)' },
      { name: 'lookup_ch_clearing', description: 'Look up a Swiss BC-Nummer / IID with SIC, QR-IID, institution type (1,190 entries, $0.003)' },
    ],
    homepage: 'https://ibanforge.com',
    repository: 'https://github.com/cammac-creator/ibanforge',
    documentation: 'https://ibanforge.com/docs/mcp',
  });
});

export { mcpCard };
