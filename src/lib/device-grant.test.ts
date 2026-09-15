import { describe, expect, it } from 'vitest';
import { getStatsDB } from './db.js';
import { generateApiKey } from './api-keys.js';
import { keyCreationSource, recordKeyCreation } from './key-creation-guard.js';
import { DAILY_KEY_CREATION_LIMIT } from './key-creation-guard.js';
import {
  DEVICE_APPROVAL_MISSES_PER_IP_HOUR,
  DEVICE_CHECKOUT_CLAIM_WINDOW_DAYS,
  DEVICE_COLLECT_WINDOW_SECONDS,
  DEVICE_MISS_DELAY_MAX_MS,
  DEVICE_USER_CODE_CHARSET,
  DEVICE_USER_CODE_LENGTH,
  approveGrant,
  consumeGrantKey,
  drawUserCode,
  enterPoll,
  findGrantByUserCode,
  grantReservationCount,
  hashGrantSecret,
  missDelayMs,
  normalizeUserCode,
  openGrant,
  pollsInFlight,
  purgeExpiredDeviceCodes,
  recordApprovalAttempt,
  sanitizeDisplayField,
} from './device-grant.js';

/**
 * 🚨 LE TEMPS SE DÉPLACE PAR SQL, JAMAIS PAR L'HORLOGE DE VITEST.
 *
 * `vi.setSystemTime` ne déplace pas l'horloge de better-sqlite3 : toutes les
 * échéances de ce module sont posées et comparées PAR SQLITE (`expires_at`
 * TEXT, `datetime('now')`, purge en `datetime('now','-1 hour')`). Écrits avec
 * une horloge simulée, les tests d'expiration et de purge passeraient à côté du
 * défaut ou échoueraient sans raison lisible. Le précédent de la maison est
 * dans `key-creation-guard.test.ts` : on recule la LIGNE par UPDATE.
 */
function rewind(secretHash: string, clause: string): void {
  getStatsDB()
    .prepare(`UPDATE device_codes SET expires_at = datetime('now', ?) WHERE device_code_hash = ?`)
    .run(clause, secretHash);
}

/** Un grant device ouvert depuis une adresse donnée, avec sa clé déjà frappée
 *  et approuvée : le point de départ de tout ce qui concerne le retrait. */
function approvedGrant(ip: string | null = null): {
  secret: string;
  secretHash: string;
  rawKey: string;
  keyHash: string;
} {
  const opened = openGrant({
    ip,
    userAgent: 'vitest/1.0',
    clientName: 'vitest',
    reason: 'unit test',
    source: 'web-device',
  });
  if (!opened.ok) throw new Error(`openGrant refused: ${opened.error}`);
  const minted = generateApiKey(null, undefined, 'web-device', false, {
    ipHash: keyCreationSource(ip) ?? 'unknown',
    userAgent: 'vitest/1.0',
  });
  if (!minted) throw new Error('generateApiKey returned null');
  const secretHash = hashGrantSecret(opened.deviceCode);
  expect(
    approveGrant(
      secretHash,
      { tier: 'anonymous', keyHash: minted.key_hash, rawKey: minted.api_key },
      'device',
    ),
  ).toBe(true);
  return {
    secret: opened.deviceCode,
    secretHash,
    rawKey: minted.api_key,
    keyHash: minted.key_hash,
  };
}

/** Une ligne du rail checkout, posée à la main : son écriture appartient au
 *  module du paiement, mais ce module-ci doit prouver qu'il ne la touche pas. */
function insertCheckoutRow(p: {
  secretHash: string;
  status: string;
  rawKey?: string | null;
  keyHash?: string | null;
  expiresClause?: string;
  createdClause?: string;
  ipHash?: string | null;
  approvedClause?: string | null;
}): void {
  const db = getStatsDB();
  db.prepare(
    `INSERT INTO device_codes
       (device_code_hash, user_code, grant_type, status, key_hash, raw_key_once, ip_hash,
        stripe_session_id, expires_at, created_at, approved_at)
     VALUES (?, NULL, 'checkout', ?, ?, ?, ?, 'cs_test_fixture', datetime('now', ?),
             datetime('now', ?), ${p.approvedClause ? `datetime('now', ?)` : 'NULL'})`,
  ).run(
    ...[
      p.secretHash,
      p.status,
      p.keyHash ?? null,
      p.rawKey ?? null,
      p.ipHash ?? null,
      p.expiresClause ?? '+24 hours',
      p.createdClause ?? '+0 seconds',
      ...(p.approvedClause ? [p.approvedClause] : []),
    ],
  );
}

describe('le tirage du code court', () => {
  it('ne sort jamais du jeu de caractères, et garde une longueur constante', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const code = drawUserCode();
      expect(code).toHaveLength(DEVICE_USER_CODE_LENGTH);
      for (const char of code) seen.add(char);
    }
    for (const char of seen) expect(DEVICE_USER_CODE_CHARSET).toContain(char);
  });

  it('ne contient aucune voyelle et aucun chiffre — asserté, pas espéré', () => {
    // C'est ce qui rend le code dictable au téléphone : aucune confusion 0/O ni
    // 1/I/L, et aucun mot involontaire formé par hasard.
    expect(DEVICE_USER_CODE_CHARSET).not.toMatch(/[AEIOUY0-9]/);
    for (let i = 0; i < 2_000; i++) {
      expect(drawUserCode()).not.toMatch(/[AEIOUY0-9]/);
    }
  });

  it('la normalisation est symétrique', () => {
    const opened = openGrant({
      ip: null,
      userAgent: null,
      clientName: null,
      reason: null,
      source: 'web-device',
    });
    if (!opened.ok) throw new Error(opened.error);
    const shown = opened.userCode; // XXXX-XXXX
    const bare = normalizeUserCode(shown);
    for (const form of [shown, shown.toLowerCase(), bare, `${bare.slice(0, 4)} ${bare.slice(4)}`]) {
      expect(findGrantByUserCode(form)?.user_code, `forme refusée : ${form}`).toBe(bare);
    }
    // Un caractère changé ne trouve rien. Le dernier caractère du jeu est
    // remplacé par un autre du même jeu, sinon le test prouverait seulement que
    // la normalisation rejette les caractères interdits.
    const other =
      DEVICE_USER_CODE_CHARSET[0] === bare[7]
        ? DEVICE_USER_CODE_CHARSET[1]
        : DEVICE_USER_CODE_CHARSET[0];
    expect(findGrantByUserCode(bare.slice(0, 7) + other)).toBeNull();
  });
});

describe('le secret du grant', () => {
  it("n'est jamais stocké en clair", () => {
    const opened = openGrant({
      ip: null,
      userAgent: null,
      clientName: null,
      reason: null,
      source: 'mcp-device',
    });
    if (!opened.ok) throw new Error(opened.error);
    const rows = getStatsDB().prepare('SELECT * FROM device_codes').all();
    expect(JSON.stringify(rows)).not.toContain(opened.deviceCode);
    // Et le haché, lui, est bien là : sans cette moitié, le test passerait aussi
    // sur une table vide.
    expect(JSON.stringify(rows)).toContain(hashGrantSecret(opened.deviceCode));
  });
});

describe('le retrait de la clé', () => {
  it('rend la clé une fois, null ensuite, et efface le clair immédiatement', () => {
    const { secretHash, rawKey } = approvedGrant();
    const first = consumeGrantKey(secretHash, 'device');
    expect(first?.api_key).toBe(rawKey);
    // 🚨 Le clair est effacé DANS la requête de retrait, pas en deux temps : un
    // effacement différé laisse une fenêtre où deux appelants lisent la même clé.
    const row = getStatsDB()
      .prepare('SELECT raw_key_once, status FROM device_codes WHERE device_code_hash = ?')
      .get(secretHash) as { raw_key_once: string | null; status: string };
    expect(row.raw_key_once).toBeNull();
    expect(row.status).toBe('delivered');
    expect(consumeGrantKey(secretHash, 'device')).toBeNull();
  });

  it('ne consomme pas un grant expiré, même approuvé', () => {
    const { secretHash } = approvedGrant();
    rewind(secretHash, '-1 second');
    expect(consumeGrantKey(secretHash, 'device')).toBeNull();
    // Le clair est toujours là : c'est la purge qui l'efface, pas le refus.
    const row = getStatsDB()
      .prepare('SELECT raw_key_once FROM device_codes WHERE device_code_hash = ?')
      .get(secretHash) as { raw_key_once: string | null };
    expect(row.raw_key_once).not.toBeNull();
  });
});

describe('le délai anti-force-brute', () => {
  it('croît sur les tentatives infructueuses et reste à zéro sur les réussites', () => {
    const guesser = keyCreationSource('198.51.100.7') as string;
    for (let i = 0; i < DEVICE_APPROVAL_MISSES_PER_IP_HOUR + 5; i++) {
      recordApprovalAttempt(guesser, 'approve', false);
    }
    expect(missDelayMs(guesser, 'approve')).toBeGreaterThan(0);

    // 🚨 La seconde moitié est celle qui compte : sans elle, la clause
    // `WHERE hit = 0` peut disparaître d'un refactor sans qu'aucun test ne
    // bouge, et le budget devient un interrupteur d'arrêt mondial — dix
    // adresses tirant leur quota fermeraient la porte à tout humain honnête.
    for (let ip = 0; ip < 10; ip++) {
      const source = keyCreationSource(`198.51.100.1${ip}`) as string;
      for (let i = 0; i < 5; i++) recordApprovalAttempt(source, 'approve', true);
    }
    const honest = keyCreationSource('198.51.100.200') as string;
    expect(missDelayMs(honest, 'approve')).toBe(0);
  });

  it('ne rend jamais un refus : au-delà de tous les budgets, un nombre borné', () => {
    const guesser = keyCreationSource('198.51.100.42') as string;
    for (let i = 0; i < DEVICE_APPROVAL_MISSES_PER_IP_HOUR + 20; i++) {
      recordApprovalAttempt(guesser, 'approve', false);
    }
    const delay = missDelayMs(guesser, 'approve');
    expect(typeof delay).toBe('number');
    expect(delay).toBe(DEVICE_MISS_DELAY_MAX_MS);
  });

  it('donne à lookup son propre budget', () => {
    // Le parcours honnête consomme un lookup PUIS un approve, et le jeton
    // d'approbation vient du lookup : un budget commun ferait payer au parcours
    // honnête l'émission de son propre jeton.
    const source = keyCreationSource('198.51.100.88') as string;
    for (let i = 0; i < DEVICE_APPROVAL_MISSES_PER_IP_HOUR + 5; i++) {
      recordApprovalAttempt(source, 'approve', false);
    }
    expect(missDelayMs(source, 'approve')).toBeGreaterThan(0);
    expect(missDelayMs(source, 'lookup')).toBe(0);
  });
});

describe('la purge', () => {
  it('révoque la clé orpheline du rail device et efface son clair', () => {
    const { secretHash, keyHash } = approvedGrant();
    // Approuvée, jamais retirée, et l'échéance passée depuis plus d'une heure :
    // c'est une clé que PERSONNE ne détient. Sans cette étape, elle resterait
    // active, invisible dans les statistiques d'usage et impossible à rattacher
    // à quiconque.
    rewind(secretHash, '-2 hours');
    purgeExpiredDeviceCodes();
    const key = getStatsDB()
      .prepare('SELECT active FROM api_keys WHERE key_hash = ?')
      .get(keyHash) as { active: number };
    expect(key.active).toBe(0);
    const row = getStatsDB()
      .prepare('SELECT raw_key_once, status FROM device_codes WHERE device_code_hash = ?')
      .get(secretHash) as { raw_key_once: string | null; status: string };
    expect(row.raw_key_once).toBeNull();
    expect(row.status).toBe('expired');
  });

  it("n'attrape JAMAIS une ligne checkout payée", () => {
    // 🚨 L'exigence la plus grave du lot. La forme calibrée sur un grant gratuit
    // de quinze minutes supprimait cette ligne au premier passage tombant entre
    // T+24 h et T+25 h, clair encore rempli : l'acheteur revenait à une ligne
    // disparue et une clé toujours active. Le passage fatal était CERTAIN.
    const minted = generateApiKey(null, undefined, 'checkout', false, { ipHash: 'unknown' });
    if (!minted) throw new Error('generateApiKey returned null');
    const secretHash = hashGrantSecret('ifn_paid_fixture');
    insertCheckoutRow({
      secretHash,
      status: 'approved',
      rawKey: minted.api_key,
      keyHash: minted.key_hash,
      expiresClause: `+${DEVICE_CHECKOUT_CLAIM_WINDOW_DAYS} days`,
      createdClause: '-25 hours',
      approvedClause: '-25 hours',
    });
    purgeExpiredDeviceCodes();
    const row = getStatsDB()
      .prepare('SELECT raw_key_once, status FROM device_codes WHERE device_code_hash = ?')
      .get(secretHash) as { raw_key_once: string | null; status: string } | undefined;
    expect(row, 'la ligne payée a été supprimée par la purge').toBeDefined();
    expect(row!.raw_key_once).not.toBeNull();
    expect(row!.status).toBe('approved');
    const key = getStatsDB()
      .prepare('SELECT active FROM api_keys WHERE key_hash = ?')
      .get(minted.key_hash) as { active: number };
    expect(key.active).toBe(1);
  });

  it('remonte la clé payée que personne ne vient chercher, sans la détruire', () => {
    const minted = generateApiKey(null, undefined, 'checkout', false, { ipHash: 'unknown' });
    if (!minted) throw new Error('generateApiKey returned null');
    const secretHash = hashGrantSecret('ifn_unclaimed_fixture');
    insertCheckoutRow({
      secretHash,
      status: 'approved',
      rawKey: minted.api_key,
      keyHash: minted.key_hash,
      createdClause: '-8 days',
      approvedClause: '-8 days',
    });
    const result = purgeExpiredDeviceCodes();
    // Un cas de support, pas un déchet : la liste remonte, la ligne reste.
    expect(result.unclaimedPaid).toContain(minted.key_prefix);
    expect(
      getStatsDB()
        .prepare('SELECT 1 AS one FROM device_codes WHERE device_code_hash = ?')
        .get(secretHash),
    ).toBeDefined();
  });

  it('rattrape un clair qui aurait survécu à son retrait', () => {
    // Le filet de l'étape 2d. La requête de retrait efface le clair elle-même ;
    // ceci rattrape le cas où quelqu'un l'aurait réécrite en deux temps.
    const secretHash = hashGrantSecret('ifn_delivered_fixture');
    insertCheckoutRow({ secretHash, status: 'delivered', rawKey: 'ifk_should_not_survive' });
    purgeExpiredDeviceCodes();
    const row = getStatsDB()
      .prepare('SELECT raw_key_once FROM device_codes WHERE device_code_hash = ?')
      .get(secretHash) as { raw_key_once: string | null };
    expect(row.raw_key_once).toBeNull();
  });
});

describe('la réservation partagée', () => {
  it('compte les clés ET les grants ouverts, et ignore le rail checkout', () => {
    const ip = '203.0.113.10';
    const source = keyCreationSource(ip) as string;
    recordKeyCreation(source, 'vitest/1.0', 'ifk_fixture01');
    expect(grantReservationCount(source)).toBe(1);

    const opened = openGrant({
      ip,
      userAgent: 'vitest/1.0',
      clientName: null,
      reason: null,
      source: 'mcp-device',
    });
    if (!opened.ok) throw new Error(opened.error);
    // Un grant en attente est une clé PROMISE : il occupe une place jusqu'à ce
    // qu'il soit tranché ou qu'il expire.
    expect(grantReservationCount(source)).toBe(2);

    // 🚨 Trois ouvertures de paiement de la même adresse n'ajoutent RIEN. Sans
    // cette clause, trois paiements gratuits et légitimes fermeraient la porte
    // gratuite à tout le réseau pendant vingt-quatre heures — sous NAT
    // d'entreprise, un développeur couperait la clé gratuite à ses collègues.
    for (let i = 0; i < 3; i++) {
      insertCheckoutRow({
        secretHash: hashGrantSecret(`ifn_reservation_${i}`),
        status: 'pending',
        ipHash: source,
      });
    }
    expect(grantReservationCount(source)).toBe(2);

    // Un grant expiré cesse de compter.
    rewind(hashGrantSecret(opened.deviceCode), '-1 second');
    expect(grantReservationCount(source)).toBe(1);
  });

  it('refuse une ouverture de plus quand le budget du réseau est plein', () => {
    const ip = '203.0.113.20';
    const source = keyCreationSource(ip) as string;
    for (let i = 0; i < DAILY_KEY_CREATION_LIMIT; i++) {
      recordKeyCreation(source, 'vitest/1.0', `ifk_full_${i}`);
    }
    const refused = openGrant({
      ip,
      userAgent: null,
      clientName: null,
      reason: null,
      source: 'web-device',
    });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error).toBe('device_rate_limited');
  });
});

describe('le rail, paramètre obligatoire', () => {
  it('filtre, et ne consomme rien quand il ne correspond pas', () => {
    const secretHash = hashGrantSecret('ifn_rail_fixture');
    insertCheckoutRow({
      secretHash,
      status: 'approved',
      rawKey: 'ifk_paid_rail_fixture',
      keyHash: 'fixture-hash',
    });
    const before = getStatsDB()
      .prepare(
        'SELECT raw_key_once, status, poll_count, last_polled_at FROM device_codes WHERE device_code_hash = ?',
      )
      .get(secretHash);

    // Un secret du mauvais rail rend null et ne touche AUCUNE colonne.
    expect(consumeGrantKey(secretHash, 'device')).toBeNull();
    expect(
      getStatsDB()
        .prepare(
          'SELECT raw_key_once, status, poll_count, last_polled_at FROM device_codes WHERE device_code_hash = ?',
        )
        .get(secretHash),
    ).toEqual(before);

    // Et le BON rail rend bien la clé : sans cette moitié, le test passerait
    // aussi sur une fonction entièrement cassée.
    expect(consumeGrantKey(secretHash, 'checkout')?.api_key).toBe('ifk_paid_rail_fixture');
  });

  it("l'inverse aussi : un grant device présenté au rail checkout", () => {
    const { secretHash, rawKey } = approvedGrant();
    expect(consumeGrantKey(secretHash, 'checkout')).toBeNull();
    expect(consumeGrantKey(secretHash, 'device')?.api_key).toBe(rawKey);
  });

  it('un grant device reste introuvable par le code court du rail checkout', () => {
    // `findGrantByUserCode` porte aussi son rail : la table est partagée, donc
    // aucune lecture ne doit s'en passer.
    insertCheckoutRow({ secretHash: hashGrantSecret('ifn_no_user_code'), status: 'pending' });
    expect(findGrantByUserCode('')).toBeNull();
  });
});

describe("la fenêtre de retrait posée par l'approbation", () => {
  it('device : au moins la fenêtre de collecte, même sur un grant qui allait mourir', () => {
    const opened = openGrant({
      ip: null,
      userAgent: null,
      clientName: null,
      reason: null,
      source: 'web-device',
    });
    if (!opened.ok) throw new Error(opened.error);
    const secretHash = hashGrantSecret(opened.deviceCode);
    // L'humain approuve à la dernière minute : sans la fenêtre, il voit « c'est
    // fait » pendant que l'agent reçoit expired_token au poll suivant.
    rewind(secretHash, '+10 seconds');
    expect(approveGrant(secretHash, { tier: 'anonymous', rawKey: 'ifk_window' }, 'device')).toBe(
      true,
    );
    const row = getStatsDB()
      .prepare(
        `SELECT CAST(strftime('%s', expires_at) - strftime('%s','now') AS INTEGER) AS s
           FROM device_codes WHERE device_code_hash = ?`,
      )
      .get(secretHash) as { s: number };
    expect(row.s).toBeGreaterThanOrEqual(DEVICE_COLLECT_WINDOW_SECONDS - 2);
  });

  it("checkout : sept jours FERMES, même quand l'échéance était plus lointaine", () => {
    // 🚨 Pas un MAX(). Sur un nonce de vingt-quatre heures, le MAX est sans
    // effet tant qu'il reste du temps et devient une fenêtre de trois minutes
    // quand il n'en reste plus : la fenêtre d'une clé PAYÉE rétrécirait à zéro à
    // mesure que le nonce vieillit.
    const secretHash = hashGrantSecret('ifn_window_fixture');
    insertCheckoutRow({ secretHash, status: 'pending', expiresClause: '+30 days' });
    expect(approveGrant(secretHash, { tier: null, rawKey: 'ifk_paid_window' }, 'checkout')).toBe(
      true,
    );
    const row = getStatsDB()
      .prepare(
        `SELECT CAST(strftime('%s', expires_at) - strftime('%s','now') AS INTEGER) AS s
           FROM device_codes WHERE device_code_hash = ?`,
      )
      .get(secretHash) as { s: number };
    const sevenDays = DEVICE_CHECKOUT_CLAIM_WINDOW_DAYS * 24 * 3600;
    expect(row.s).toBeGreaterThan(sevenDays - 60);
    expect(row.s).toBeLessThan(sevenDays + 60);
  });

  it('dérive le key_hash de la clé quand il manque', () => {
    // Le module du paiement ne peut pas le calculer, la fonction de hachage des
    // clés n'étant pas exportée. Le dériver ici retire à tous les appelants la
    // possibilité d'écrire un key_hash qui ne correspond pas à la clé remise.
    const secretHash = hashGrantSecret('ifn_derive_fixture');
    insertCheckoutRow({ secretHash, status: 'pending' });
    expect(approveGrant(secretHash, { tier: null, rawKey: 'ifk_derive_me' }, 'checkout')).toBe(
      true,
    );
    const row = getStatsDB()
      .prepare('SELECT key_hash FROM device_codes WHERE device_code_hash = ?')
      .get(secretHash) as { key_hash: string };
    expect(row.key_hash).toBe(
      // Le SHA-256 de la clé remise, calculé ici à la main plutôt qu'importé :
      // un test qui réutilise la fonction testée ne prouve rien sur sa valeur.
      '75affd5fc99042946a240f16e42de2605289fd007d0cc8193d399c7078391264',
    );
  });

  it("n'approuve pas deux fois : un double-clic frappe une clé, pas deux", () => {
    const opened = openGrant({
      ip: null,
      userAgent: null,
      clientName: null,
      reason: null,
      source: 'web-device',
    });
    if (!opened.ok) throw new Error(opened.error);
    const secretHash = hashGrantSecret(opened.deviceCode);
    expect(approveGrant(secretHash, { tier: 'anonymous', rawKey: 'ifk_first' }, 'device')).toBe(
      true,
    );
    // La condition vit dans la requête (`WHERE status = 'pending'`) et la
    // décision dans `changes`.
    expect(approveGrant(secretHash, { tier: 'anonymous', rawKey: 'ifk_second' }, 'device')).toBe(
      false,
    );
    expect(consumeGrantKey(secretHash, 'device')?.api_key).toBe('ifk_first');
  });
});

describe('le compteur des attentes longues', () => {
  it('compte par rail et par empreinte, et revient à zéro', () => {
    expect(pollsInFlight()).toBe(0);
    const a = enterPoll('device', 'fingerprint-a');
    const b = enterPoll('device', 'fingerprint-a');
    const c = enterPoll('checkout', 'fingerprint-b');
    expect(pollsInFlight()).toBe(3);
    expect(pollsInFlight('device')).toBe(2);
    expect(pollsInFlight('checkout')).toBe(1);
    expect(pollsInFlight('device', 'fingerprint-a')).toBe(2);
    expect(pollsInFlight('device', 'fingerprint-b')).toBe(0);
    a();
    b();
    c();
    // Une place jamais rendue est une place perdue jusqu'au redémarrage : c'est
    // pourquoi l'appelant libère dans un `finally`.
    expect(pollsInFlight()).toBe(0);
    // Libérer deux fois ne décompte pas deux fois.
    a();
    expect(pollsInFlight()).toBe(0);
  });
});

describe("le nettoyage de ce que l'agent déclare", () => {
  it('retire les balises, les sauts de ligne et les URL, et tronque', () => {
    // Ces deux champs sont écrits par un agent et AFFICHÉS À UN HUMAIN sur une
    // page qu'il croit être la nôtre.
    const dirty = '<script>alert(1)</script>\nsee https://autre.example/x';
    const cleaned = sanitizeDisplayField(dirty, 60);
    expect(cleaned).not.toContain('<');
    expect(cleaned).not.toContain('>');
    expect(cleaned).not.toContain('\n');
    expect(cleaned).not.toContain('://');
    expect(cleaned?.toLowerCase()).not.toContain('http');
    expect(sanitizeDisplayField('x'.repeat(200), 60)).toHaveLength(60);
    // Un champ qui ne survit à rien devient null, et la page affiche son
    // libellé de repli : ce n'est pas une erreur de requête.
    expect(sanitizeDisplayField('<<<>>>', 60)).toBeNull();
    expect(sanitizeDisplayField(42, 60)).toBeNull();
    // Et un libellé honnête traverse intact.
    expect(sanitizeDisplayField('Claude Code (v1.2)', 60)).toBe('Claude Code (v1.2)');
  });
});
