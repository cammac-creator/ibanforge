import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSpec } from './openapi.js';
import { CBPR_NOTE } from '../lib/address-conformity.js';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

interface PostmanItem {
  item?: PostmanItem[];
  request?: {
    url?: { path?: string[] };
    description?: { content?: string };
  };
}

function requests(items: PostmanItem[]): PostmanItem[] {
  return items.flatMap((item) => (item.item ? requests(item.item) : [item]));
}

describe('copies publiques du calendrier des adresses', () => {
  // Décision EPC du 29.10.2026 : décider d’ici février ne signifie pas retirer en février.
  // Une note API juste ne suffit pas si /vendors conserve l’annonce de septembre.
  it.each([
    ['fr', 'décision d’ici février 2027', 'Février 2027 n’est pas la date de retrait'],
    ['en', 'decision by February 2027', 'February 2027 is not the retirement date'],
    ['de', 'Entscheidung bis Februar 2027', 'Februar 2027 ist nicht das Abschaltdatum'],
  ])('la page éditeurs distingue décision et retrait en %s', (locale, decision, limite) => {
    const messages = JSON.parse(read(`frontend/messages/${locale}.json`));
    const body: string = messages.vendors.deadline.body;
    expect(body).toContain(decision);
    expect(body).toContain(limite);
    expect(body).not.toMatch(/nouvelle date en octobre|new date in October|im Oktober festgelegt/);
    expect(body).not.toMatch(/10 septembre 2026|10 September 2026|10\. September 2026/);
  });

  it('la collection Postman conserve la description complète du contrat courant', () => {
    const collection: { item: PostmanItem[] } = JSON.parse(
      read('integrations/postman/ibanforge.postman_collection.json'),
    );
    const found = requests(collection.item).filter(
      ({ request }) => request?.url?.path?.join('/') === 'v1/address/check',
    );
    expect(found).toHaveLength(1);
    const description = found[0].request?.description?.content;
    expect(description).toBe(buildSpec().paths['/v1/address/check'].post.description);
    expect(description).toContain(CBPR_NOTE);
    expect(description).not.toContain('new date announced for October 2026');
  });
});
