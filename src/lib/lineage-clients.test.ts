import { describe, expect, it } from 'vitest';
import {
  DEVICE_DOORS,
  LINEAGE_CLIENTS,
  deviceDoorSql,
  normalizeDeviceDoor,
  normalizeLineageClient,
} from './lineage-clients.js';

/**
 * La liste fermée des familles de client, et les préfixes d'User-Agent qu'elle
 * reconnaît.
 *
 * 🚨 Les UA attendus ici sont ceux que les paquets POSENT RÉELLEMENT, relus dans
 * les paquets le 15/09/2026. Le test le plus utile du fichier est celui sur
 * `ibanforge-ts/` : la valeur supposée était `ibanforge-sdk/`, qui aurait rangé
 * tout le SDK TypeScript dans `other` sans qu'aucune assertion ne rougisse.
 *
 * Fixtures inventées, ce dépôt est public.
 */
describe('la famille de client', () => {
  it('reconnaît les cinq clients que nous publions, à leur VRAI préfixe', () => {
    expect(normalizeLineageClient('ibanforge-mcp/1.6.0', null)).toBe('mcp-npm');
    expect(normalizeLineageClient('ibanforge-ts/1.6.0', null)).toBe('sdk-ts');
    expect(normalizeLineageClient('ibanforge-python/1.6.0', null)).toBe('sdk-python');
    expect(normalizeLineageClient('ibanforge-java/1.6.0', null)).toBe('sdk-java');
    expect(normalizeLineageClient('ibanforge-dotnet/1.5.0', null)).toBe('sdk-dotnet');
  });

  it("`ibanforge-sdk/` n'est PAS le SDK TypeScript : il tombe dans other", () => {
    // La supposition que ce test existe pour rendre fausse une fois pour toutes.
    expect(normalizeLineageClient('ibanforge-sdk/1.6.0', null)).toBe('other');
  });

  it('reconnaît curl, et sa casse', () => {
    expect(normalizeLineageClient('curl/8.7.1', null)).toBe('curl');
    expect(normalizeLineageClient('CURL/8.7.1', null)).toBe('curl');
  });

  it('un PRÉFIXE, jamais une inclusion au milieu de la chaîne', () => {
    // Un UA qui mentionne notre paquet sans en être un ne doit pas le devenir.
    expect(normalizeLineageClient('quelquechose ibanforge-mcp/1.0', null)).toBe('other');
    // Et la barre oblique fait partie du motif : un futur paquet voisin ne se
    // confond pas avec celui-ci.
    expect(normalizeLineageClient('ibanforge-mcp-proxy/1.0', null)).toBe('other');
  });

  it('le marqueur `demo` passe avant tout, et vaut browser', () => {
    expect(normalizeLineageClient('Mozilla/5.0 (Macintosh) Safari/605', 'demo')).toBe('browser');
    expect(normalizeLineageClient(null, 'DEMO')).toBe('browser');
    expect(normalizeLineageClient(null, ' demo ')).toBe('browser');
    // Tout autre contexte ne décide de rien : c'est l'UA qui parle.
    expect(normalizeLineageClient('ibanforge-mcp/1.0', 'production')).toBe('mcp-npm');
  });

  it('un UA absent, vide ou inconnu vaut other, JAMAIS browser', () => {
    // Le contrat interdit de déduire un contexte d'une trace muette.
    expect(normalizeLineageClient(null, null)).toBe('other');
    expect(normalizeLineageClient('   ', null)).toBe('other');
    expect(normalizeLineageClient('Mozilla/5.0 (Macintosh) Safari/605', null)).toBe('other');
    // n8n ne pose aucun UA à nous : il n'y a pas de famille n8n.
    expect(normalizeLineageClient('axios/1.7.2', null)).toBe('other');
  });

  it('rend toujours une valeur de la liste fermée', () => {
    for (const ua of [
      'ibanforge-mcp/1',
      'ibanforge-ts/1',
      'curl/1',
      'n8n',
      '',
      'Mozilla/5.0',
      'ibanforge-',
    ]) {
      expect(LINEAGE_CLIENTS).toContain(normalizeLineageClient(ua, null));
    }
    expect(LINEAGE_CLIENTS).toHaveLength(8);
  });
});

describe('la porte du rail device', () => {
  it('ne garde que les deux portes connues, tout le reste vaut other', () => {
    expect(normalizeDeviceDoor('web-device')).toBe('web-device');
    expect(normalizeDeviceDoor('mcp-device')).toBe('mcp-device');
    expect(normalizeDeviceDoor('WEB-DEVICE')).toBe('web-device');
    // 🚨 C'est ce qui borne `device_grant_daily` : la source est une chaîne
    // libre choisie par l'appelant, et sans cette réduction la table porterait
    // un jeu d'identifiants non borné, conservé sans politique de rétention.
    expect(normalizeDeviceDoor('ma-porte-a-moi')).toBe('other');
    expect(normalizeDeviceDoor(null)).toBe('other');
    expect(normalizeDeviceDoor(undefined)).toBe('other');
    expect(DEVICE_DOORS).toHaveLength(3);
  });

  it('la réduction SQL nomme la colonne demandée et les deux mêmes portes', () => {
    const sql = deviceDoorSql('source');
    expect(sql).toContain("'web-device'");
    expect(sql).toContain("'mcp-device'");
    expect(sql).toContain("'other'");
    expect(sql).toContain('source');
  });
});
