import { describe, expect, it } from 'vitest';
import {
  CHECKING,
  NETWORK_FAILURE,
  afterCodeRequest,
  afterLogout,
  afterOverview,
  afterSignIn,
  formatUtcStamp,
  isCompleteCode,
  noticeFor,
  normalizeCode,
  parsePlan,
  readReport,
  resendWaitSeconds,
  safeHttpsUrl,
  sheetFromOverviewKey,
  sheetFromReport,
  type AccountScreen,
  type ApiReply,
  type KeyReportPayload,
} from './account-overview';

/**
 * Fixtures inventées (dépôt public) : `acme@example.com`, préfixes, dates et
 * chiffres sans rapport avec une vraie clé ni un vrai client. Le pack : 420
 * crédits restants sur 5 000, 37 appels ce mois-ci, alerte des 10 % envoyée.
 */
const EMAIL = 'acme@example.com';
const T0 = Date.UTC(2026, 8, 24, 21, 0, 0);

const PACK_KEY = {
  key_prefix: 'ifk_1a2b3c4d',
  created_at: '2026-08-03T10:00:00Z',
  plan: 'pack',
  allowance: null,
  credits: { remaining: 420, purchased_total: 5000 },
  subscription: null,
  calls_this_month: 37,
  last_call_at: '2026-09-18T08:15:00Z',
  alerts: [{ kind: 'credits_low', sent_at: '2026-09-12T07:30:00Z' }],
  actions: { topup: null, subscribe_pro: null, manage_subscription: null },
};

const FREE_KEY = {
  key_prefix: 'ifk_9f8e7d6c',
  created_at: '2026-08-03T10:05:00Z',
  plan: 'free',
  allowance: { basis: 'monthly', limit: 200, used: 0, remaining: 200 },
  credits: null,
  subscription: null,
  calls_this_month: 0,
  last_call_at: null,
  alerts: [],
  actions: { topup: null, subscribe_pro: null, manage_subscription: null },
};

function overview(keys: unknown[], extra: Record<string, unknown> = {}): ApiReply {
  return {
    status: 200,
    body: {
      email: EMAIL,
      session_expires_at: '2026-10-01T21:00:00Z',
      month: '2026-09',
      page: 1,
      pages: 1,
      keys,
      inactive_keys: 0,
      ...extra,
    },
  };
}

const SIGNED_OUT_401: ApiReply = {
  status: 401,
  body: { error: 'signed_out', message: 'You are not signed in, or your session has ended. Please sign in again.' },
};

function codeSent(): Extract<AccountScreen, { kind: 'code_sent' }> {
  const s = afterCodeRequest({ status: 202, body: { status: 'code_sent', expires_in: 900 } }, EMAIL, T0, {
    kind: 'signed_out',
    notice: null,
  });
  if (s.kind !== 'code_sent') throw new Error('écran du code attendu');
  return s;
}

describe('les écrans de la page du compte', () => {
  it('déconnecté : au chargement, un 401 ouvre le formulaire, sans message', () => {
    expect(afterOverview(SIGNED_OUT_401, CHECKING)).toEqual({ kind: 'signed_out', notice: null });
    // Une panne au chargement (API absente, CORS refusé, 503) ne parle pas
    // non plus : le visiteur n'a encore rien demandé.
    expect(afterOverview(NETWORK_FAILURE, CHECKING)).toEqual({ kind: 'signed_out', notice: null });
    expect(afterOverview({ status: 503, body: null }, CHECKING)).toEqual({ kind: 'signed_out', notice: null });
    // Un 200 sans la forme d'une vue n'ouvre pas de session imaginaire.
    expect(afterOverview({ status: 200, body: { keys: [] } }, CHECKING)).toEqual({
      kind: 'signed_out',
      notice: null,
    });
  });

  it('code envoyé : 202 ouvre l’écran du code, et chaque refus dit le sien', () => {
    expect(codeSent()).toEqual({ kind: 'code_sent', email: EMAIL, sentAt: T0, notice: null });

    const signedOut: AccountScreen = { kind: 'signed_out', notice: null };
    const refused = (status: number, error?: string) =>
      afterCodeRequest({ status, body: error ? { error } : null }, EMAIL, T0, signedOut);
    expect(refused(429, 'code_rate_limited')).toEqual({ kind: 'signed_out', notice: 'rate_limited' });
    expect(refused(400, 'disposable_email')).toEqual({ kind: 'signed_out', notice: 'address' });
    expect(refused(400, 'undeliverable_email')).toEqual({ kind: 'signed_out', notice: 'address' });
    expect(refused(400, 'invalid_email')).toEqual({ kind: 'signed_out', notice: 'address' });
    expect(refused(503, 'code_unavailable')).toEqual({ kind: 'signed_out', notice: 'service' });
    // Le limiteur global rend aussi 429, mais ce n'est pas « trop de codes
    // pour cette adresse » : le champ `error` décide, pas le statut.
    expect(refused(429, 'rate_limit_exceeded')).toEqual({ kind: 'signed_out', notice: 'service' });
    expect(afterCodeRequest(NETWORK_FAILURE, EMAIL, T0, signedOut)).toEqual({
      kind: 'signed_out',
      notice: 'service',
    });

    // « Renvoyer un code » refusé : on reste sur l'écran du code, horloge intacte.
    const first = codeSent();
    const again = afterCodeRequest({ status: 429, body: { error: 'code_rate_limited' } }, EMAIL, T0 + 90_000, first);
    expect(again).toEqual({ ...first, notice: 'rate_limited' });
    // Et un renvoi accepté fait repartir l'horloge du renvoi.
    expect(afterCodeRequest({ status: 202, body: {} }, EMAIL, T0 + 90_000, first)).toMatchObject({
      kind: 'code_sent',
      sentAt: T0 + 90_000,
    });
  });

  it('code envoyé : un code faux ou épuisé garde l’écran du code avec son message', () => {
    const screen = codeSent();
    expect(afterSignIn({ status: 400, body: { error: 'invalid_code' } }, screen)).toEqual({
      ...screen,
      notice: 'code_invalid',
    });
    expect(afterSignIn(NETWORK_FAILURE, screen)).toEqual({ ...screen, notice: 'service' });
    expect(afterSignIn({ status: 400, body: { error: 'invalid_email' } }, screen)).toEqual({
      kind: 'signed_out',
      notice: 'address',
    });
  });

  it('connecté : le code accepté ouvre la vue, et chaque clé a sa fiche', () => {
    const opening = afterSignIn({ status: 200, body: { signed_in: true, expires_at: '2026-10-01T21:00:00Z' } }, codeSent());
    expect(opening).toEqual({ kind: 'opening', email: EMAIL });

    const screen = afterOverview(overview([PACK_KEY, FREE_KEY]), opening);
    expect(screen.kind).toBe('signed_in');
    if (screen.kind !== 'signed_in') return;
    expect(screen.email).toBe(EMAIL);
    expect(screen.notice).toBeNull();
    expect(screen.keys.map((k) => k.prefix)).toEqual(['ifk_1a2b3c4d', 'ifk_9f8e7d6c']);

    const [pack, free] = screen.keys;
    expect(pack).toEqual({
      prefix: 'ifk_1a2b3c4d',
      plan: { parts: ['pack'], raw: 'pack' },
      allowance: null,
      credits: { remaining: 420, total: 5000 },
      callsThisMonth: 37,
      month: '2026-09',
      lastCall: { at: '2026-09-18T08:15:00Z' },
      alerts: [{ kind: 'credits_low', sentAt: '2026-09-12T07:30:00Z' }],
      manageUrl: null,
      topup: null,
    });
    expect(free).toMatchObject({
      plan: { parts: ['free'], raw: 'free' },
      allowance: { lifetime: false, remaining: 200, limit: 200 },
      credits: null,
      callsThisMonth: 0,
      lastCall: { at: null },
      alerts: [],
    });

    // Changer de page depuis l'écran connecté : une panne garde l'écran.
    expect(afterOverview({ status: 502, body: null }, screen)).toEqual({ ...screen, notice: 'load_failed' });
  });

  it('connecté : un abonné reçoit le lien du portail, seulement en https', () => {
    const pro = {
      ...FREE_KEY,
      plan: 'pro',
      subscription: { plan: 'pro', status: 'active', manage_url: 'https://billing.stripe.com/p/login/demo' },
      actions: { topup: null, subscribe_pro: null, manage_subscription: 'https://billing.stripe.com/p/login/demo' },
    };
    expect(sheetFromOverviewKey(pro, '2026-09')?.manageUrl).toBe('https://billing.stripe.com/p/login/demo');
    for (const bad of ['javascript:alert(1)', 'http://billing.example.net', 'pas une adresse', 42]) {
      const sheet = sheetFromOverviewKey({ ...pro, actions: { manage_subscription: bad }, subscription: null }, '2026-09');
      expect(sheet?.manageUrl).toBeNull();
    }
  });

  it('aucune clé : 200 avec une liste vide donne l’écran « aucune clé »', () => {
    expect(afterOverview(overview([]), { kind: 'opening', email: EMAIL })).toEqual({
      kind: 'no_keys',
      email: EMAIL,
      notice: null,
    });
    // Au chargement, avec un cookie encore valable : même écran.
    expect(afterOverview(overview([], { inactive_keys: 2 }), CHECKING)).toEqual({
      kind: 'no_keys',
      email: EMAIL,
      notice: null,
    });
  });

  it('session terminée : un 401 reçu depuis l’écran connecté, et seulement de là', () => {
    const signedIn = afterOverview(overview([PACK_KEY]), CHECKING);
    expect(signedIn.kind).toBe('signed_in');
    expect(afterOverview(SIGNED_OUT_401, signedIn)).toEqual({ kind: 'signed_out', notice: 'session_ended' });

    const noKeys = afterOverview(overview([]), CHECKING);
    expect(afterOverview(SIGNED_OUT_401, noKeys)).toEqual({ kind: 'signed_out', notice: 'session_ended' });

    // Le rapport d'une clé ouvert après expiration dit la même chose.
    expect(readReport(SIGNED_OUT_401)).toEqual({ kind: 'session_ended' });

    // Juste après un code accepté, un 401 n'est pas une session terminée :
    // c'est le navigateur qui n'a pas gardé le cookie. La page dit que la
    // connexion n'a pas marché.
    expect(afterOverview(SIGNED_OUT_401, { kind: 'opening', email: EMAIL })).toEqual({
      kind: 'signed_out',
      notice: 'service',
    });
  });

  it('formule d’une clé mixte : les deux soldes, et le libellé en deux parties', () => {
    // La forme que servira la vue après le lot B1 : une allocation gratuite ET
    // un pack sur la même clé. Aujourd'hui C1 rend `allowance: null` dès qu'il
    // y a des crédits ; la page doit déjà savoir lire la suite.
    const mixed = {
      ...PACK_KEY,
      plan: 'free+pack',
      allowance: { basis: 'monthly', limit: 200, used: 150, remaining: 50 },
      credits: { remaining: 1000, purchased_total: 1000 },
    };
    const sheet = sheetFromOverviewKey(mixed, '2026-09');
    expect(sheet?.plan).toEqual({ parts: ['free', 'pack'], raw: 'free+pack' });
    expect(sheet?.allowance).toEqual({ lifetime: false, remaining: 50, limit: 200 });
    expect(sheet?.credits).toEqual({ remaining: 1000, total: 1000 });

    // Une formule que le site ne connaît pas encore : libellé de repli, rien ne casse.
    expect(parsePlan('free+enterprise')).toEqual({ parts: [], raw: 'free+enterprise' });
    expect(parsePlan('')).toBeNull();
    expect(parsePlan(undefined)).toBeNull();
  });
});

/**
 * Lot B1 (25.09.2026) : recharger CETTE clé. Les liens portent sa référence ;
 * une clé à l'adresse non prouvée n'est offerte qu'avec un avertissement
 * (relecture de sécurité du lot C1, point I1).
 */
describe('recharger cette clé', () => {
  const LINKS = {
    '1k': 'https://buy.stripe.com/aaa?client_reference_id=ifr_' + '1'.repeat(32),
    '5k': 'https://buy.stripe.com/bbb?client_reference_id=ifr_' + '1'.repeat(32),
    '25k': 'https://buy.stripe.com/ccc?client_reference_id=ifr_' + '1'.repeat(32),
  };

  it('vue du compte : les trois liens, et la provenance de l’adresse', () => {
    const unproven = sheetFromOverviewKey(
      { ...PACK_KEY, address_proven: false, actions: { ...PACK_KEY.actions, topup: LINKS } },
      '2026-09',
    );
    expect(unproven?.topup).toEqual({ links: LINKS, proven: false, pro: null });
    const proven = sheetFromOverviewKey(
      { ...PACK_KEY, address_proven: true, actions: { ...PACK_KEY.actions, topup: LINKS } },
      '2026-09',
    );
    expect(proven?.topup?.proven).toBe(true);
    // Une API d'avant le lot ne sert pas la provenance : lue « non prouvée ».
    const older = sheetFromOverviewKey(
      { ...PACK_KEY, actions: { ...PACK_KEY.actions, topup: LINKS } },
      '2026-09',
    );
    expect(older?.topup?.proven).toBe(false);
  });

  it('rien d’incomplet ni de non-https ne devient un bouton', () => {
    const partial = sheetFromOverviewKey(
      { ...PACK_KEY, actions: { ...PACK_KEY.actions, topup: { '1k': LINKS['1k'] } } },
      '2026-09',
    );
    expect(partial?.topup).toBeNull();
    const unsafe = sheetFromOverviewKey(
      {
        ...PACK_KEY,
        actions: { ...PACK_KEY.actions, topup: { ...LINKS, '5k': 'javascript:alert(1)' } },
      },
      '2026-09',
    );
    expect(unsafe?.topup).toBeNull();
  });

  it('clé collée : une clé mixte montre ses deux soldes, et la recharge sans avertissement', () => {
    const pasted: KeyReportPayload = {
      key_prefix: 'ifk_5e6f7a8b',
      usage: {
        used: 150,
        limit: 200,
        remaining: 50,
        month: '2026-09',
        basis: 'monthly',
        tier: 'email',
        credits_remaining: 1000,
        credits_total: 1000,
        billing_order: 'allowance_then_credits',
        topup: { by_card: LINKS },
      },
      report: {
        window_days: 30,
        total: 150,
        ok: 150,
        failed: 0,
        avg_ms: 2,
        days: [],
        endpoints: [],
        errors: [],
        footprint: { distinct_networks: 1, unusual: false },
      },
    };
    const sheet = sheetFromReport(pasted);
    expect(sheet?.allowance).toEqual({ lifetime: false, remaining: 50, limit: 200 });
    expect(sheet?.credits).toEqual({ remaining: 1000, total: 1000 });
    // Tenir la clé prouve qu'elle est la sienne : aucun doute à lever.
    expect(sheet?.topup).toEqual({ links: LINKS, proven: null, pro: null });
  });

  it('Pro sur cette clé (lot B2) : le lien suit, jamais un lien qui n’est pas https', () => {
    const PRO = 'https://buy.stripe.com/ddd?client_reference_id=ifr_' + '1'.repeat(32);
    const viewed = sheetFromOverviewKey(
      {
        ...PACK_KEY,
        address_proven: false,
        actions: { ...PACK_KEY.actions, topup: LINKS, subscribe_pro: PRO },
      },
      '2026-09',
    );
    // La même mise en garde couvre la recharge et Pro : la section les porte ensemble.
    expect(viewed?.topup).toEqual({ links: LINKS, proven: false, pro: PRO });
    const hostile = sheetFromOverviewKey(
      {
        ...PACK_KEY,
        actions: { ...PACK_KEY.actions, topup: LINKS, subscribe_pro: 'javascript:alert(1)' },
      },
      '2026-09',
    );
    expect(hostile?.topup?.pro).toBeNull();
  });
});

describe('une seule fiche pour les deux modes', () => {
  it('la même clé, collée ou vue depuis le compte, donne les mêmes chiffres', () => {
    // Ce que `/v1/keys/report` sert pour la clé du pack ci-dessus : `used`
    // compte les appels facturés du mois, `limit` et `remaining` ne sont
    // opposés à rien (basis « credits »).
    const pasted: KeyReportPayload = {
      key_prefix: 'ifk_1a2b3c4d',
      usage: {
        used: 37,
        limit: 200,
        remaining: 163,
        month: '2026-09',
        basis: 'credits',
        tier: 'paid',
        credits_remaining: 420,
        credits_total: 5000,
      },
      report: {
        window_days: 30,
        total: 37,
        ok: 37,
        failed: 0,
        avg_ms: 2,
        days: [],
        endpoints: [],
        errors: [],
        footprint: { distinct_networks: 1, unusual: false },
      },
    };
    const fromReport = sheetFromReport(pasted);
    const fromAccount = sheetFromOverviewKey(PACK_KEY, '2026-09');
    const shared = (s: typeof fromReport) => ({
      prefix: s?.prefix,
      allowance: s?.allowance,
      credits: s?.credits,
      callsThisMonth: s?.callsThisMonth,
      month: s?.month,
    });
    expect(shared(fromReport)).toEqual(shared(fromAccount));
    // Et le « reste » du palier gratuit, calculé contre un plafond que la clé
    // ne porte pas, n'apparaît nulle part.
    expect(JSON.stringify(fromReport)).not.toContain('163');

    // La clé collée ne dit ni sa formule, ni ses alertes, ni son dernier appel :
    // ces lignes restent vides plutôt que devinées.
    expect(fromReport).toMatchObject({ plan: null, alerts: null, lastCall: null, manageUrl: null });
  });

  it('une clé mesurée sur sa vie : pas de « ce mois-ci » inventé', () => {
    const lifetime: KeyReportPayload = {
      key_prefix: 'ifk_0a0b0c0d',
      usage: { used: 180, limit: 200, remaining: 20, month: '2026-09', basis: 'lifetime', tier: 'paid' },
      report: {
        window_days: 30,
        total: 0,
        ok: 0,
        failed: 0,
        avg_ms: null,
        days: [],
        endpoints: [],
        errors: [],
        footprint: { distinct_networks: 0, unusual: null },
      },
    };
    expect(sheetFromReport(lifetime)).toMatchObject({
      allowance: { lifetime: true, remaining: 20, limit: 200 },
      callsThisMonth: null,
    });
  });

  it('un reste d’allocation négatif se lit zéro, comme sur la clé collée', () => {
    const over = { ...FREE_KEY, allowance: { basis: 'lifetime', limit: 200, used: 230, remaining: -30 } };
    expect(sheetFromOverviewKey(over, '2026-09')?.allowance).toEqual({ lifetime: true, remaining: 0, limit: 200 });
  });

  it('une clé sans préfixe lisible est écartée plutôt que rendue vide', () => {
    expect(sheetFromOverviewKey({ ...PACK_KEY, key_prefix: '' }, '2026-09')).toBeNull();
    const screen = afterOverview(overview([{ ...PACK_KEY, key_prefix: 7 }, FREE_KEY]), CHECKING);
    expect(screen.kind === 'signed_in' && screen.keys.map((k) => k.prefix)).toEqual(['ifk_9f8e7d6c']);
  });

  it('les alertes de forme inconnue sont ignorées', () => {
    const sheet = sheetFromOverviewKey(
      { ...PACK_KEY, alerts: [{ kind: 'quota_80', sent_at: '2026-08-28T07:00:00Z' }, { kind: 'autre' }, null] },
      '2026-09',
    );
    expect(sheet?.alerts).toEqual([{ kind: 'quota_80', sentAt: '2026-08-28T07:00:00Z' }]);
  });
});

describe('les autres réponses', () => {
  it('se déconnecter : 204 ramène au formulaire, une panne garde l’écran', () => {
    const signedIn = afterOverview(overview([PACK_KEY]), CHECKING);
    expect(afterLogout({ status: 204, body: null }, signedIn)).toEqual({ kind: 'signed_out', notice: null });
    expect(afterLogout(NETWORK_FAILURE, signedIn)).toEqual({ ...signedIn, notice: 'service' });
    // Cookie en double ou session déjà révoquée : l'API rend 401, on est déconnecté.
    expect(afterLogout({ status: 401, body: { error: 'signed_out' } }, signedIn)).toEqual({
      kind: 'signed_out',
      notice: null,
    });
  });

  it('le rapport d’une clé : prêt, ou échec lisible', () => {
    const payload = { key_prefix: 'ifk_1a2b3c4d', usage: { used: 0 }, report: { total: 0 } };
    expect(readReport({ status: 200, body: payload })).toEqual({ kind: 'ready', payload });
    expect(readReport({ status: 404, body: { error: 'not_found' } })).toEqual({ kind: 'failed' });
    expect(readReport({ status: 200, body: { key_prefix: 'ifk_1a2b3c4d' } })).toEqual({ kind: 'failed' });
    expect(readReport(NETWORK_FAILURE)).toEqual({ kind: 'failed' });
  });

  it('le message d’erreur suit le champ error, puis retombe sur « service »', () => {
    expect(noticeFor({ status: 400, body: { error: 'invalid_code' } })).toBe('code_invalid');
    // L'ancien code d'erreur n'existe plus côté API : il retombe sur « service ».
    expect(noticeFor({ status: 400, body: { error: 'too_many_attempts' } })).toBe('service');
    expect(noticeFor({ status: 503, body: { error: 'code_unavailable' } })).toBe('service');
    expect(noticeFor({ status: 415, body: { error: 'unsupported_media_type' } })).toBe('service');
    expect(noticeFor({ status: 400, body: 'texte' })).toBe('service');
  });
});

describe('les petites règles d’affichage', () => {
  it('le renvoi d’un code attend 60 secondes', () => {
    expect(resendWaitSeconds(T0, T0)).toBe(60);
    expect(resendWaitSeconds(T0, T0 + 59_001)).toBe(1);
    expect(resendWaitSeconds(T0, T0 + 60_000)).toBe(0);
    expect(resendWaitSeconds(T0, T0 + 3_600_000)).toBe(0);
  });

  it('le code se saisit avec ou sans espace', () => {
    expect(normalizeCode(' 123 456 ')).toBe('123456');
    expect(normalizeCode('123-456')).toBe('123456');
    expect(isCompleteCode('123456')).toBe(true);
    expect(isCompleteCode('12345')).toBe(false);
    expect(isCompleteCode('12345a')).toBe(false);
  });

  it('un horodatage UTC s’écrit sans Intl et dit qu’il est en UTC', () => {
    expect(formatUtcStamp('2026-09-18T08:15:42Z')).toBe('2026-09-18 08:15 UTC');
    expect(formatUtcStamp('2026-09-18 08:15:42')).toBe('2026-09-18 08:15 UTC');
    expect(formatUtcStamp('hier')).toBeNull();
    expect(formatUtcStamp(null)).toBeNull();
  });

  it('seule une adresse https devient un lien', () => {
    expect(safeHttpsUrl('https://billing.stripe.com/p/login/demo')).toBe('https://billing.stripe.com/p/login/demo');
    expect(safeHttpsUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpsUrl('HTTPS://billing.example.net')).toBe('HTTPS://billing.example.net');
  });
});
