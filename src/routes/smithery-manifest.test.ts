import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from '../app.js';

/**
 * Le manifeste Smithery a menti du 10/04 au 22/09/2026 sans que rien ne le
 * signale : il annonçait un seul démarrage `stdio` sur `node dist/mcp/server.js`
 * — un chemin que le paquet publié n'a jamais eu — et ignorait le point
 * d'entrée HTTP distant, qui est devenu la voie de presque tous les clients.
 *
 * Ce test ne juge pas le goût du fichier. Il vérifie que chaque chose qu'il
 * annonce EXISTE vraiment : la commande locale est celle du paquet npm, la
 * carte de serveur qu'il désigne est bien servie par cette API, et l'ancien
 * chemin mort n'est pas revenu par un copier-coller.
 */
const MANIFEST = readFileSync(resolve(import.meta.dirname, '../../smithery.yaml'), 'utf8');

/**
 * Le manifeste SANS ses commentaires.
 *
 * L'en-tête explique pourquoi l'ancien chemin était faux, donc il le CITE : un
 * test qui lirait le fichier entier interdirait d'expliquer le piège qu'il
 * ferme. Seul ce qu'un lecteur machine exécute est jugé ici.
 */
const DECLARED = MANIFEST.split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');

describe('smithery.yaml — ce qu’il annonce existe', () => {
  it('nomme le point d’entrée HTTP distant', () => {
    expect(DECLARED).toContain('https://api.ibanforge.com/mcp');
    expect(DECLARED).toContain('streamable-http');
  });

  it('ne renvoie plus vers le chemin de démarrage mort', () => {
    // Le paquet `ibanforge-mcp` est bâti depuis mcp/ et démarre sur
    // dist/index.js. `dist/mcp/server.js` n'a jamais été son point d'entrée.
    expect(DECLARED).not.toContain('dist/mcp/server.js');
  });

  it('la commande locale est celle que le paquet publié expose', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../mcp/package.json'), 'utf8'),
    ) as { name: string; bin: Record<string, string> };
    expect(DECLARED).toContain(pkg.name);
    expect(Object.keys(pkg.bin)).toContain(pkg.name);
  });

  it('la carte de serveur qu’il désigne est réellement servie', async () => {
    const path = '/.well-known/mcp/server-card.json';
    expect(DECLARED).toContain(path);
    const res = await buildApp().request(path);
    expect(res.status).toBe(200);
  });

  it('ses liens sortants portent l’étiquette d’origine de la place de marché', () => {
    // Sans elle, une clé prise depuis la fiche Smithery naît avec la porte du
    // site et la fiche n'est jamais créditée de rien.
    expect(DECLARED).toContain('?src=smithery');
  });
});
