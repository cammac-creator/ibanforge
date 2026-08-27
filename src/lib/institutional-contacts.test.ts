import { describe, expect, it } from 'vitest';
import { getStatsDB } from './db.js';
import {
  deleteInstitutionalContact,
  ensureInstitutionalTable,
  listInstitutionalContacts,
  upsertInstitutionalContact,
} from './institutional-contacts.js';

/**
 * Runs against the real stats database like the rest of the suite, so the
 * fixtures live on invented domains and are removed rather than assumed absent
 * — real correspondents will be written into this same table.
 */
const ALPHA = 'registry@alpha.example.net';
const ALPHA_2 = 'legal@alpha.example.net';
const BETA = 'office@beta.example.org';

function clean(): void {
  ensureInstitutionalTable();
  getStatsDB()
    .prepare(
      `DELETE FROM institutional_contacts
       WHERE email LIKE '%@alpha.example.net' OR email LIKE '%@beta.example.org'`,
    )
    .run();
}

function mine() {
  return listInstitutionalContacts().filter(
    (r) => r.email.endsWith('@alpha.example.net') || r.email.endsWith('@beta.example.org'),
  );
}

describe('the registry of institutions we write to', () => {
  it('keeps one row per address, so re-registering corrects instead of duplicating', () => {
    clean();
    upsertInstitutionalContact({ email: ALPHA, org: 'Autorité Alpha', category: 'autorite' });
    upsertInstitutionalContact({ email: ALPHA, org: 'Autorité Alpha', category: 'registre' });
    const rows = mine();
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('registre');
    clean();
  });

  it('does not forget what it already knew when a later write is partial', () => {
    clean();
    // The common correction is one field. Overwriting the rest with NULL would
    // make every fix a data loss, and the operator would stop correcting.
    upsertInstitutionalContact({
      email: ALPHA,
      org: 'Autorité Alpha',
      category: 'autorite',
      country: 'CH',
      role: 'Guichet des demandes',
      website: 'https://alpha.example.net',
      dossier: 'Réutilisation des données publiées',
    });
    upsertInstitutionalContact({ email: ALPHA, org: 'Autorité Alpha', category: 'autorite', role: 'Service juridique' });
    const row = mine()[0];
    expect(row.role).toBe('Service juridique');
    expect(row.country).toBe('CH');
    expect(row.website).toBe('https://alpha.example.net');
    expect(row.dossier).toBe('Réutilisation des données publiées');
    clean();
  });

  it('stores nothing rather than blanks for the fields left out', () => {
    clean();
    upsertInstitutionalContact({ email: BETA, org: 'Réseau Beta', category: 'reseau_paiement', country: '   ' });
    const row = mine()[0];
    expect(row.country).toBeNull();
    expect(row.role).toBeNull();
    expect(row.website).toBeNull();
    expect(row.dossier).toBeNull();
    clean();
  });

  it('lowercases the address, since the thread is attached by lowercase address', () => {
    clean();
    upsertInstitutionalContact({ email: '  Registry@Alpha.Example.NET ', org: 'Autorité Alpha', category: 'autorite' });
    expect(mine()[0].email).toBe(ALPHA);
    clean();
  });

  it('uppercases the country, so CH and ch are not two countries', () => {
    clean();
    upsertInstitutionalContact({ email: BETA, org: 'Réseau Beta', category: 'reseau_paiement', country: ' ch ' });
    expect(mine()[0].country).toBe('CH');
    clean();
  });

  it('refuses a country that is not a two-letter code instead of truncating it', () => {
    clean();
    // "Suisse".slice(0, 2) is "SU", which is not Switzerland. A stored country
    // is cited as a fact in outgoing institutional mail, so free text is
    // refused loudly rather than minted into a plausible wrong code.
    const res = upsertInstitutionalContact({
      email: BETA,
      org: 'Réseau Beta',
      category: 'reseau_paiement',
      country: 'Suisse',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('ISO');
    expect(mine()).toHaveLength(0);
    clean();
  });

  it('refuses an address that is not one', () => {
    const res = upsertInstitutionalContact({ email: 'pas-une-adresse', org: 'Autorité Alpha', category: 'autorite' });
    expect(res.ok).toBe(false);
  });

  it('refuses a nameless organisation, whitespace included', () => {
    clean();
    // A row with no org is unfindable in a list grouped by org, which is the
    // only thing this registry is read for.
    expect(upsertInstitutionalContact({ email: ALPHA, org: '', category: 'autorite' }).ok).toBe(false);
    expect(upsertInstitutionalContact({ email: ALPHA, org: '   ', category: 'autorite' }).ok).toBe(false);
    expect(mine()).toHaveLength(0);
  });

  it('refuses an empty category, whitespace included', () => {
    clean();
    expect(upsertInstitutionalContact({ email: ALPHA, org: 'Autorité Alpha', category: '' }).ok).toBe(false);
    expect(upsertInstitutionalContact({ email: ALPHA, org: 'Autorité Alpha', category: '  ' }).ok).toBe(false);
    expect(mine()).toHaveLength(0);
  });

  it('takes any category it is handed, because the list of institutions is not closed', () => {
    clean();
    upsertInstitutionalContact({ email: BETA, org: 'Réseau Beta', category: 'chambre_de_compensation' });
    expect(mine()[0].category).toBe('chambre_de_compensation');
    clean();
  });

  it('groups the addresses by organisation, and orders them inside it', () => {
    clean();
    // Two desks at the same institution: the second key is what keeps them in a
    // stable order instead of whatever SQLite happens to return.
    upsertInstitutionalContact({ email: BETA, org: 'Réseau Beta', category: 'reseau_paiement' });
    upsertInstitutionalContact({ email: ALPHA, org: 'Autorité Alpha', category: 'autorite' });
    upsertInstitutionalContact({ email: ALPHA_2, org: 'Autorité Alpha', category: 'autorite' });
    expect(mine().map((r) => r.email)).toEqual([ALPHA_2, ALPHA, BETA]);
    clean();
  });

  it('removes an address, and reports a miss rather than pretending', () => {
    clean();
    upsertInstitutionalContact({ email: ALPHA, org: 'Autorité Alpha', category: 'autorite' });
    expect(deleteInstitutionalContact(' REGISTRY@Alpha.example.NET ')).toBe(true);
    expect(mine()).toHaveLength(0);
    expect(deleteInstitutionalContact(ALPHA)).toBe(false);
  });
});
