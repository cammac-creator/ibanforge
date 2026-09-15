import { describe, it, expect } from 'vitest';
import {
  looksMachineMade,
  localPartOf,
  findCohorts,
  cohortAddress,
  COHORT_WINDOWS,
  findBurst,
  groupAnonymousCohorts,
  creationMs,
  toSqliteUtc,
  ANON_BURST_WINDOWS,
  ANON_ANCHOR_MIN_KEYS,
  BREAKER_MIN_DISTINCT_SOURCES,
  UNKNOWN_SOURCE,
  type CreationRow,
  type AnonCreationRow,
  type Burst,
} from './cohort-radar.js';

const NOW = new Date('2026-08-19T17:10:00Z');

/** Build a creation row at N minutes before NOW. */
function row(
  minutesAgo: number,
  ua: string | null,
  email: string | null,
  prefix = `ifk_${minutesAgo}${email ?? ''}`,
): CreationRow {
  const at = new Date(NOW.getTime() - minutesAgo * 60 * 1000);
  return {
    key_prefix: prefix,
    user_agent: ua,
    email,
    created_at: at.toISOString().slice(0, 19).replace('T', ' '),
  };
}

describe('looksMachineMade', () => {
  it('accepts the machine-made shapes: long consonant runs or almost no vowels', () => {
    expect(looksMachineMade('pwwhqjpghlvj')).toBe(true); // no vowel at all
    expect(looksMachineMade('koulnvwrgccu')).toBe(true); // six consonants in a row
    expect(looksMachineMade('ugmicpdrqxca')).toBe(true);
  });

  it('leaves ordinary human addresses alone', () => {
    expect(looksMachineMade('claudealainmartin')).toBe(false);
    expect(looksMachineMade('marie.duval')).toBe(false); // a separator is a human sign
    expect(looksMachineMade('heart1010')).toBe(false); // digits too
    expect(looksMachineMade('contact')).toBe(false); // too short to judge
    expect(looksMachineMade('solomon')).toBe(false);
  });

  it('never judges a short pseudonym — several paying customers use one', () => {
    expect(looksMachineMade('fuzzy')).toBe(false);
    expect(looksMachineMade('zeebrow')).toBe(false);
  });
});

describe('localPartOf', () => {
  it('splits on the first @', () => {
    expect(localPartOf('someone@alpha.example.net')).toBe('someone');
    expect(localPartOf('no-at-sign')).toBe('no-at-sign');
  });
});

describe('findCohorts', () => {
  it('groups a burst that shares one client library string', () => {
    const rows = [
      row(1, 'demo-http-client/9.9', 'pwwhqjpghlvj@gmail.com'),
      row(2, 'demo-http-client/9.9', 'koulnvwrgccu@yahoo.com'),
      row(3, 'demo-http-client/9.9', 'ugmicpdrqxca@outlook.com'),
      row(4, 'demo-http-client/9.9', 'gfdrroavihgz@icloud.com'),
      row(5, 'demo-http-client/9.9', 'mnbvpdxndxwv@proton.me'),
    ];
    const cohorts = findCohorts(rows, NOW);
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].userAgent).toBe('demo-http-client/9.9');
    expect(cohorts[0].keyPrefixes).toHaveLength(5);
    expect(cohorts[0].machineShapeRatio).toBe(1);
  });

  it('leaves a busy but human client alone — the shape ratio is what decides', () => {
    const rows = [
      row(1, 'demo-http-client/9.9', 'marie.duval@alpha.example.net'),
      row(2, 'demo-http-client/9.9', 'jean.bernard@alpha.example.net'),
      row(3, 'demo-http-client/9.9', 'paul.henry@alpha.example.net'),
      row(4, 'demo-http-client/9.9', 'anne.moreau@alpha.example.net'),
      row(5, 'demo-http-client/9.9', 'luc.petit@alpha.example.net'),
    ];
    expect(findCohorts(rows, NOW)).toEqual([]);
  });

  it('regroups only the machine-shaped addresses, sparing the human minority', () => {
    const human = row(5, 'demo-http-client/9.9', 'marie.duval@alpha.example.net', 'ifk_human');
    const rows = [
      row(1, 'demo-http-client/9.9', 'pwwhqjpghlvj@gmail.com', 'ifk_m1'),
      row(2, 'demo-http-client/9.9', 'koulnvwrgccu@yahoo.com', 'ifk_m2'),
      row(3, 'demo-http-client/9.9', 'ugmicpdrqxca@outlook.com', 'ifk_m3'),
      row(4, 'demo-http-client/9.9', 'gfdrroavihgz@icloud.com', 'ifk_m4'),
      human,
    ];
    const cohorts = findCohorts(rows, NOW);
    expect(cohorts).toHaveLength(1);
    // The group of 5 triggers (ratio 0.8), but only the 4 machine-shaped keys
    // are regrouped — the human's key is NOT in the cohort.
    expect(cohorts[0].keyPrefixes).toHaveLength(4);
    expect(cohorts[0].keyPrefixes).not.toContain('ifk_human');
    expect(cohorts[0].machineShapeRatio).toBe(0.8);
  });

  it('does not sweep a legitimate signup into a poisoned generic-client batch', () => {
    // An adversary reads the public repo and mints 8 machine-shaped keys under a
    // common client string; a real customer signs up under the same client in
    // the same window. Only the machine-shaped keys are regrouped.
    const legit = row(3, 'axios/1.6.0', 'nicolas.perret@alpha.example.net', 'ifk_legit');
    const rows = [
      ...Array.from({ length: 8 }, (_, i) =>
        row(
          i + 1,
          'axios/1.6.0',
          `pwwhqjpghlv${String.fromCharCode(97 + i)}@gmail.com`,
          `ifk_p${i}`,
        ),
      ),
      legit,
    ];
    const cohorts = findCohorts(rows, NOW);
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].keyPrefixes).not.toContain('ifk_legit');
    expect(cohorts[0].keyPrefixes).toHaveLength(8);
  });

  it('does not group different clients together', () => {
    const rows = [
      row(1, 'client-a/1.0', 'pwwhqjpghlvj@gmail.com'),
      row(2, 'client-a/1.0', 'koulnvwrgccu@yahoo.com'),
      row(3, 'client-b/1.0', 'ugmicpdrqxca@outlook.com'),
      row(4, 'client-b/1.0', 'gfdrroavihgz@icloud.com'),
      row(5, 'client-b/1.0', 'mnbvpdxndxwv@proton.me'),
    ];
    expect(findCohorts(rows, NOW)).toEqual([]); // neither reaches 5 in 15 min
  });

  it('catches the slow variant through the wider window', () => {
    // One signup every 90 minutes never trips the 15-minute rule, but eight of
    // them inside a day do.
    const rows = Array.from({ length: 8 }, (_, i) =>
      row(
        90 * (i + 1),
        'slow-client/1.0',
        `pwwhqjpghlv${String.fromCharCode(97 + i)}@gmail.com`,
        `ifk_slow${i}`,
      ),
    );
    const cohorts = findCohorts(rows, NOW);
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].windowHours).toBe(24);
    expect(cohorts[0].keyPrefixes).toHaveLength(8);
  });

  it('catches a tight burst that finished well before the tick (sliding window)', () => {
    // Five signups in ten minutes, but they ended three hours before this pass.
    // Anchored to now it would be invisible; a slide over the history sees it.
    const rows = Array.from({ length: 5 }, (_, i) =>
      row(
        180 + i * 2,
        'late-client/1.0',
        `pwwhqjpghlv${String.fromCharCode(97 + i)}@gmail.com`,
        `ifk_late${i}`,
      ),
    );
    const cohorts = findCohorts(rows, NOW);
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].windowHours).toBe(0.25);
    expect(cohorts[0].keyPrefixes).toHaveLength(5);
  });

  it('ignores rows with nothing to link them by', () => {
    const rows = [
      row(1, null, 'pwwhqjpghlvj@gmail.com'),
      row(2, null, 'koulnvwrgccu@yahoo.com'),
      row(3, null, 'ugmicpdrqxca@outlook.com'),
      row(4, null, 'gfdrroavihgz@icloud.com'),
      row(5, null, 'mnbvpdxndxwv@proton.me'),
    ];
    expect(findCohorts(rows, NOW)).toEqual([]);
  });

  it('reads timestamps as UTC, whatever the machine timezone', () => {
    // Written the way SQLite does: a space, no zone marker. Parsed as local
    // time these would fall outside the 15-minute window west of Greenwich.
    const rows = [
      row(1, 'tz-client/1.0', 'pwwhqjpghlvj@gmail.com'),
      row(2, 'tz-client/1.0', 'koulnvwrgccu@yahoo.com'),
      row(3, 'tz-client/1.0', 'ugmicpdrqxca@outlook.com'),
      row(4, 'tz-client/1.0', 'gfdrroavihgz@icloud.com'),
      row(5, 'tz-client/1.0', 'mnbvpdxndxwv@proton.me'),
    ];
    expect(rows[0].created_at).not.toContain('T');
    expect(findCohorts(rows, NOW)[0].keyPrefixes).toHaveLength(5);
  });

  it('never forms a cohort below the smallest threshold', () => {
    const rows = Array.from({ length: COHORT_WINDOWS[0].minKeys - 1 }, (_, i) =>
      row(i + 1, 'tiny/1.0', `pwwhqjpghlv${String.fromCharCode(97 + i)}@gmail.com`, `ifk_tiny${i}`),
    );
    expect(findCohorts(rows, NOW)).toEqual([]);
  });
});

describe('cohortAddress', () => {
  it('builds an address on a top-level domain that can never receive mail', () => {
    expect(cohortAddress('demo-http-client/9.9', '2026-08-19')).toBe(
      'demo-http-client-9-9-2026-08-19@cohorte.invalid',
    );
  });

  it('survives a client string made only of punctuation', () => {
    expect(cohortAddress('///', '2026-08-19')).toBe('client-2026-08-19@cohorte.invalid');
  });
});

// ---------------------------------------------------------------------------
// Palier ANONYME (lot 6) : décision pure, aucune base, aucun réseau.
// ---------------------------------------------------------------------------

const T0 = Date.parse('2026-09-15T12:00:00Z');

/** Une ligne de création anonyme à `msAfter` millisecondes de T0. */
function anon(
  msAfter: number,
  ua: string | null,
  ipHash: string,
  extra: { ipFirstSeen?: string | null; prefix?: string } = {},
): AnonCreationRow {
  const prefix = extra.prefix ?? `ifk_${msAfter}${ua ?? ''}${ipHash}`.slice(0, 12);
  return {
    origin_prefix: prefix,
    key_prefix: prefix,
    key_hash: `hash-${prefix}`,
    user_agent: ua,
    ip_hash: ipHash,
    created_at: toSqliteUtc(T0 + msAfter),
    ip_first_seen: extra.ipFirstSeen ?? null,
  };
}

/** N horodatages régulièrement étalés sur `spanMs`, en millisecondes absolues. */
function spread(count: number, spanMs: number): number[] {
  return Array.from({ length: count }, (_, i) =>
    count === 1 ? T0 : T0 + Math.round((i * spanMs) / (count - 1)),
  );
}

describe('findBurst : le déclenchement global, et son étendue', () => {
  it('rend les bornes et la taille sur 15 horodatages en 25 s', () => {
    const ms = spread(15, 25_000);
    const burst = findBurst(ms, ANON_BURST_WINDOWS);
    expect(burst).not.toBeNull();
    expect(burst!.keys).toBe(15);
    expect(burst!.startMs).toBe(ms[0]);
    expect(burst!.endMs).toBe(ms[14]);
  });

  it('rend null sur 14 horodatages en 25 s : le plancher est la seule autorité', () => {
    expect(findBurst(spread(14, 25_000), ANON_BURST_WINDOWS)).toBeNull();
  });

  it("rend l'ÉTENDUE et non le déclencheur sur une ferme de 164 clés en 137 s", () => {
    // 🚨 LE test de cette fonction. La fenêtre de 30 s atteint 15 clés au bout de
    // ~12,5 s : rendre le déclencheur donnerait keys === 15 sur 164, et la
    // réparation évidente de ce rayon trop étroit serait d'élargir à tout le
    // groupe de l'ancre, c'est-à-dire l'incident de régression du 20/08.
    const burst = findBurst(spread(164, 137_000), ANON_BURST_WINDOWS);
    expect(burst!.keys).toBe(164);
    expect(burst!.endMs - burst!.startMs).toBe(137_000);
  });

  it('rend les 41 clés de la ferme mono-IP en 19 s', () => {
    expect(findBurst(spread(41, 19_000), ANON_BURST_WINDOWS)!.keys).toBe(41);
  });

  it("n'agrège jamais deux rafales séparées par une accalmie", () => {
    const first = spread(20, 20_000);
    const second = first.map((t) => t + 40 * 60 * 1000);
    const burst = findBurst([...first, ...second], ANON_BURST_WINDOWS)!;
    expect(burst.keys).toBe(20);
    expect(burst.endMs - burst.startMs).toBeLessThan(40 * 60 * 1000);
  });

  it('rend la PLUS LONGUE suite, jamais la première', () => {
    // Une fausse alerte courte précède la vraie ferme : c'est la ferme qui doit
    // définir le rayon, sinon elle s'échappe derrière un leurre de 16 clés.
    const small = spread(16, 20_000);
    const big = Array.from({ length: 40 }, (_, i) => T0 + 60 * 60 * 1000 + i * 600);
    expect(findBurst([...small, ...big], ANON_BURST_WINDOWS)!.keys).toBe(40);
  });
});

describe('groupAnonymousCohorts : le rayon, borné par une ancre', () => {
  const burstOf = (rows: AnonCreationRow[]): Burst =>
    findBurst(
      rows.map((r) => creationMs(r.created_at)).sort((a, b) => a - b),
      ANON_BURST_WINDOWS,
    )!;

  it('trouve les cohortes SANS aucune adresse dans les lignes', () => {
    // La preuve que la garde de forme d'adresse est bien retirée sur ce palier :
    // AnonCreationRow ne porte même pas de colonne e-mail.
    const rows = spread(20, 20_000).map((t, i) => anon(t - T0, 'farm/1.0', `net-${i}`));
    const cohorts = groupAnonymousCohorts(rows, burstOf(rows));
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].anchor).toBe('ua:farm/1.0');
    expect(cohorts[0].rows).toHaveLength(20);
    expect(cohorts[0].distinctSources).toBe(20);
  });

  it('exclut les lignes hors des bornes de la rafale', () => {
    const inside = spread(20, 20_000).map((t, i) => anon(t - T0, 'farm/1.0', `net-${i}`));
    const outside = anon(-12 * 60 * 1000, 'farm/1.0', 'net-late');
    const cohorts = groupAnonymousCohorts([...inside, outside], burstOf(inside));
    expect(cohorts[0].rows).toHaveLength(20);
    expect(cohorts[0].rows.map((r) => r.ip_hash)).not.toContain('net-late');
  });

  it("applique la seconde borne, celle de l'épisode", () => {
    const rows = spread(20, 20_000).map((t, i) => anon(t - T0, 'farm/1.0', `net-${i}`));
    const burst = burstOf(rows);
    // Un épisode armé DEUX heures après le début de la rafale : la fenêtre du
    // disjoncteur (60 min) ne couvre plus la rafale, donc plus personne n'est
    // dans le rayon. C'est la borne qui protège un intégrateur sous une chaîne
    // générique très ancienne.
    const armedAt = T0 + 2 * 60 * 60 * 1000;
    expect(groupAnonymousCohorts(rows, burst, armedAt)).toHaveLength(0);
    // Armé pendant la rafale : tout le monde y est.
    expect(groupAnonymousCohorts(rows, burst, T0 + 10_000)[0].rows).toHaveLength(20);
  });

  it('exempte du rayon une clé dont le réseau a une histoire (clause 9)', () => {
    const rows = spread(20, 20_000).map((t, i) => anon(t - T0, 'farm/1.0', `net-${i}`));
    const veteran = anon(10_000, 'farm/1.0', 'net-veteran', {
      ipFirstSeen: toSqliteUtc(T0 - 48 * 60 * 60 * 1000),
      prefix: 'ifk_veteran',
    });
    const newcomer = anon(11_000, 'farm/1.0', 'net-new', {
      ipFirstSeen: toSqliteUtc(T0 - 60 * 1000),
      prefix: 'ifk_newcomer',
    });
    const all = [...rows, veteran, newcomer];
    const cohort = groupAnonymousCohorts(all, burstOf(all))[0];
    const prefixes = cohort.rows.map((r) => r.key_prefix);
    expect(prefixes).not.toContain('ifk_veteran'); // réseau avec une histoire
    expect(prefixes).toContain('ifk_newcomer'); // réseau né il y a une minute
  });

  it('regroupe par ip_hash les lignes sans User-Agent, et jamais les autres', () => {
    const rows = spread(20, 19_000).map((t) => anon(t - T0, null, 'one-nat'));
    const withUa = anon(5_000, 'farm/1.0', 'one-nat', { prefix: 'ifk_hasua' });
    const all = [...rows, withUa];
    const cohorts = groupAnonymousCohorts(all, burstOf(all));
    const ip = cohorts.find((c) => c.anchor === 'ip:one-nat')!;
    const ua = cohorts.find((c) => c.anchor === 'ua:farm/1.0')!;
    expect(ip.rows).toHaveLength(20);
    expect(ua.rows).toHaveLength(1);
    expect(ip.rows.map((r) => r.key_prefix)).not.toContain('ifk_hasua');
    // Et la garde de diversité la disqualifie de la coupe AUTOMATIQUE : un
    // ip_hash unique est aussi la signature d'un NAT partagé.
    expect(ip.distinctSources).toBeLessThan(BREAKER_MIN_DISTINCT_SOURCES);
  });

  it("ne fait JAMAIS cohorte sur la sentinelle 'unknown'", () => {
    // 20 clés frappées sans empreinte réseau dans la même demi-minute : rien ne
    // dit qu'elles ont quoi que ce soit en commun. Sous une ancre `ip:unknown`
    // elles seraient coupées ensemble, et dans la CI toute clé anonyme laissée
    // par un autre fichier de test tomberait dedans.
    const rows = spread(20, 19_000).map((t) => anon(t - T0, null, UNKNOWN_SOURCE));
    expect(groupAnonymousCohorts(rows, burstOf(rows))).toHaveLength(0);
  });

  it('variante A du contournement : 7 chaînes à 14 clés chacune ne sauvent plus rien', () => {
    // Sous un regroupement-par-ancre-d'abord, aucun de ces sept groupes
    // n'atteignait le plancher de 15 : 98 clés en 30 s, invisibles, pour le prix
    // de sept chaînes de caractères. Le déclenchement global les voit toutes.
    const rows = spread(98, 29_000).map((t, i) =>
      anon(t - T0, `farm-${i % 7}/1.0`, `net-${i}`, { prefix: `ifk_a${i}` }),
    );
    const burst = burstOf(rows);
    expect(burst.keys).toBe(98);
    const cohorts = groupAnonymousCohorts(rows, burst);
    expect(cohorts).toHaveLength(7);
    for (const c of cohorts) {
      expect(c.rows).toHaveLength(14);
      expect(c.rows.length).toBeGreaterThanOrEqual(ANON_ANCHOR_MIN_KEYS);
    }
  });

  it("variante B : la part de l'ancre est rapportée et ne bloque plus rien", () => {
    // 100 clés sous une ancre + 30 leurres sur cinq autres chaînes donnaient une
    // part de 0,769 < 0,8, donc 130 clés sauvées pour le prix de trente leurres.
    // La part n'est plus qu'un nombre du rapport.
    const rows = spread(130, 29_000).map((t, i) =>
      anon(t - T0, i < 100 ? 'ua-A/1.0' : `leurre-${i % 5}/1.0`, `net-${i}`, {
        prefix: `ifk_b${i}`,
      }),
    );
    const burst = burstOf(rows);
    expect(burst.keys).toBe(130);
    const cohorts = groupAnonymousCohorts(rows, burst);
    expect(cohorts).toHaveLength(6);
    const a = cohorts.find((c) => c.anchor === 'ua:ua-A/1.0')!;
    expect(a.rows.length / burst.keys).toBeCloseTo(0.769, 3);
  });

  it('🚨 dilution extrême : 98 chaînes distinctes, la rafale est vue et aucune ancre ne pèse', () => {
    // LE TROU STRUCTUREL, figé ici pour qu'il ne se redécouvre pas un jour de
    // panne. Une ferme qui change de User-Agent à chaque clé passe l'ancre `ua:`
    // (chaque groupe pèse 1, sous le plancher de 3), passe l'ancre `ip:` (elle
    // envoie un UA, donc elle n'y tombe pas), et sans UA elle tomberait sur la
    // sentinelle, qui ne fait jamais ancre.
    //
    // Le radar ne peut rien contre elle, et ce n'est pas un réglage : sans ancre
    // il n'y a pas de rayon, et un rayon sans ancre serait la coupe de TOUS les
    // nouveaux venus de la fenêtre, c'est-à-dire exactement le dommage que ce
    // module existe pour éviter.
    //
    // Ce qui la touche encore : le disjoncteur la COMPTE (il ne regroupe jamais)
    // et fait naître ses clés dégradées pendant l'épisode. C'est le disjoncteur
    // qui paie, pas le radar.
    const rows = spread(98, 29_000).map((t, i) =>
      anon(t - T0, `uniq-${i}/1.0`, `net-${i}`, { prefix: `ifk_d${i}` }),
    );
    const burst = burstOf(rows);
    expect(burst.keys).toBe(98);
    const cohorts = groupAnonymousCohorts(rows, burst);
    expect(cohorts).toHaveLength(98);
    for (const c of cohorts) expect(c.rows.length).toBeLessThan(ANON_ANCHOR_MIN_KEYS);
  });

  it('un nouveau venu seul de son User-Agent est sous le plancher, donc jamais coupable', () => {
    const farm = spread(40, 20_000).map((t, i) => anon(t - T0, 'farm/1.0', `net-${i}`));
    const lonely = anon(9_000, 'brand-new-sdk/0.1', 'net-lonely', { prefix: 'ifk_lonely' });
    const all = [...farm, lonely];
    const cohorts = groupAnonymousCohorts(all, burstOf(all));
    const his = cohorts.find((c) => c.anchor === 'ua:brand-new-sdk/0.1')!;
    expect(his.rows).toHaveLength(1);
    expect(his.rows.length).toBeLessThan(ANON_ANCHOR_MIN_KEYS);
  });
});
