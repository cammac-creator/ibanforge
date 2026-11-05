import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const folder = join(process.cwd(), 'public/integrations');
const names = readdirSync(folder).filter(name => /^ibanforge-postman-premiers-appels-[a-f0-9]{12}\.json$/.test(name));
if (names.length !== 1) throw new Error('Une seule collection courante de premiers appels est attendue.');
const raw = readFileSync(join(folder, names[0]), 'utf8');
const collection = JSON.parse(raw);
type Item = {
  name: string;
  request: { method: string; url: string; auth?: { type: string }; body?: { raw: string } };
  event: { listen: string; script: { type: string; exec: string[] } }[];
};
const items: Item[] = collection.item.flatMap((group: { item: Item[] }) => group.item);

function runChecks(item: Item, status: number, body: unknown) {
  const failures: string[] = [];
  const pm = {
    test: (name: string, check: () => void) => {
      try { check(); } catch { failures.push(name); }
    },
    expect,
    response: { json: () => body, to: { have: { status: (wanted: number) => expect(status).toBe(wanted) } } },
  };
  for (const event of item.event) {
    runInNewContext(event.script.exec.join('\n'), { pm }, { timeout: 1000 });
  }
  return failures;
}

describe('collection Postman téléchargeable de premiers appels', () => {
  it('porte son empreinte et reste identique à l’ancienne adresse de téléchargement', () => {
    expect(names[0]).toContain(createHash('sha256').update(raw).digest('hex').slice(0, 12));
    expect(readFileSync(join(process.cwd(), 'public/ibanforge-postman.json'), 'utf8')).toBe(raw);
    for (const locale of ['fr', 'en', 'de']) {
      for (const path of ['docs/index.mdx', 'blog/2026-04-01-v1-changelog.mdx']) {
        expect(readFileSync(join(process.cwd(), 'content', locale, path), 'utf8')).toContain(`/integrations/${names[0]}`);
      }
    }
  });

  it('ne contient ni secret ni opération de compte, courrier, achat ou modification', () => {
    expect(collection.variable.find((v: { key: string }) => v.key === 'apiKey').value).toBe('');
    expect(collection.variable.find((v: { key: string }) => v.key === 'baseUrl').value).toBe('https://api.ibanforge.com');
    expect(raw).not.toMatch(/ifk_[a-f0-9]{64}/);
    const permitted = new Set([
      'POST /v1/iban/format', 'GET /v1/demo', 'POST /v1/iban/validate',
      'POST /v1/iban/batch', 'GET /v1/bic/DEUTDEFF', 'GET /v1/ch/clearing/230',
    ]);
    for (const item of items) {
      expect(item.request.url.startsWith('{{baseUrl}}/')).toBe(true);
      expect(permitted.has(`${item.request.method} ${item.request.url.replace('{{baseUrl}}', '')}`)).toBe(true);
      for (const event of item.event) {
        expect(event.listen).toBe('test');
        expect(event.script.exec.join('\n')).not.toMatch(/sendRequest|setNextRequest|\.set\(|fetch\(|require\(/);
      }
    }
  });

  it('sépare les appels sans clé des appels qui héritent du Bearer privé', () => {
    expect(collection.auth).toEqual({ type: 'bearer', bearer: [{ key: 'token', value: '{{apiKey}}', type: 'string' }] });
    for (const group of collection.item.slice(0, 2)) {
      for (const item of group.item) expect(item.request.auth).toEqual({ type: 'noauth' });
    }
    for (const item of collection.item[2].item) expect(item.request.auth).toBeUndefined();
    expect(JSON.parse(collection.item[2].item[1].request.body.raw).ibans).toHaveLength(2);
  });

  it('distingue un format valide d’une somme de contrôle fausse même en HTTP 200', () => {
    const [valid, invalid] = collection.item[0].item;
    expect(runChecks(valid, 200, { valid: true })).toEqual([]);
    expect(runChecks(invalid, 200, { valid: false })).toEqual([]);
    expect(runChecks(valid, 200, { valid: false })).toHaveLength(1);
    expect(runChecks(invalid, 200, { valid: true })).toHaveLength(1);
  });

  it.each([401, 402, 429, 500])('ne présente aucun HTTP %s comme un appel réussi', status => {
    for (const item of items) {
      expect(runChecks(item, status, { error: 'erreur_fictive' })).toContain('Réponse HTTP 200');
    }
  });
});
