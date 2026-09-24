/**
 * Les cinq routes du device grant (RFC 8628).
 *
 * Deux du CHEMIN AGENT : `POST /v1/keys/device` ouvre un grant,
 * `POST /v1/keys/device/token` vient chercher la clé en long-polling. Trois du
 * CHEMIN HUMAIN : `lookup` dit à la page ce qu'elle approuve et lui remet son
 * jeton, `approve` frappe la clé, `deny` refuse.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FICHIER NEUF, ET C'EST UNE DÉCISION
 * ─────────────────────────────────────────────────────────────────────────────
 * `src/routes/api-keys.ts` passe les deux mille lignes et deux sessions s'y
 * sont déjà télescopées. Les libellés que ces routes réutilisent « mot pour
 * mot » sont donc recopiés comme chaînes littérales identiques, et le fichier
 * voisin n'est pas refactorisé pour les exporter : un agent qui touche un
 * fichier de deux mille lignes pour en extraire six constantes crée le conflit
 * qu'il voulait éviter.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 AUCUNE GARDE DE QUOTA ICI
 * ─────────────────────────────────────────────────────────────────────────────
 * La réservation, le plafond horaire et la capture d'empreinte vivent tous dans
 * `openGrant()`. Ce fichier ne recopie aucun des trois : deux surfaces MCP
 * appellent le module en direct, sans passer par HTTP, et une serrure laissée
 * ici serait une porte sans plafond et sans journal chez elles.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 LA RÈGLE DES DEUX EMPREINTES
 * ─────────────────────────────────────────────────────────────────────────────
 * Le device grant est le seul chemin du produit où DEUX appareils interviennent.
 *
 *   - journal des créations, disjoncteur, radar   -> l'empreinte du CRÉATEUR,
 *     capturée à l'ouverture du grant (`grant.ip_hash`, `grant.user_agent`) :
 *     la clé est née de l'agent, pas du navigateur qui a cliqué. Prendre
 *     « naturellement » l'en-tête de la requête d'approbation ferait de toutes
 *     les clés device honnêtes une fausse cohorte de navigateurs, et ferait
 *     disparaître la ferme qui approuve en `curl` avec l'UA de son choix.
 *   - plafonds d'ENVOI de code (`challengeSendAllowed`, `recordVerificationSend`)
 *     -> l'empreinte de l'APPROBATEUR : c'est CETTE requête qui déclenche
 *     réellement un envoi de courrier. Indexer ce plafond sur le créateur le
 *     rendrait contournable en renouvelant le grant.
 *   - `device_code_attempts` -> l'APPROBATEUR : c'est lui qui devine un code.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { evaluateBreakerOnCreation } from '../lib/creation-breaker.js';
import { generateApiKey, markShieldBirth, revokeApiKey } from '../lib/api-keys.js';
import { isAllowedOrigin } from '../lib/cors-origins.js';
import { extractClientIp } from '../lib/stats.js';
import { isDisposableDomain } from '../lib/disposable-domains.js';
import { domainAcceptsMail, domainOf } from '../lib/mail-domain.js';
import { isPlainEmail } from '../lib/email-shape.js';
import { deliverKeyVerificationEmail } from '../lib/email.js';
import { opsFail } from '../lib/ops-alert.js';
import { parseAttribution, recordSignupAttribution } from '../lib/signup-attribution.js';
import {
  ANONYMOUS_MONTHLY_LIMIT,
  FREE_TIER_MONTHLY_LIMIT,
  SHIELD_MONTHLY_LIMIT,
  type KeyTier,
} from '../lib/tiers.js';
import {
  VERIFICATION_MAX_ATTEMPTS,
  VERIFICATION_TTL_MINUTES,
  challengeSendAllowed,
  checkVerificationCode,
  createVerificationChallenge,
  keyCreationSource,
  markVerificationOutcome,
  recordVerificationSend,
} from '../lib/key-creation-guard.js';
import {
  DEVICE_CODE_TTL_SECONDS,
  DEVICE_POLL_INTERVAL_SECONDS,
  DEVICE_TEXTS,
  DEVICE_VERIFICATION_URI,
  type GrantRow,
  approveGrant,
  awaitGrantSettlement,
  checkApprovalToken,
  consumeGrantKey,
  denyGrant,
  deviceConfigLine,
  deviceMissDelayFloorMs,
  devicePollsInFlightMax,
  displayToHuman,
  enterPoll,
  pollsInFlight,
  extendForEmail,
  findGrantBySecret,
  findGrantByUserCode,
  formatUserCode,
  grantMonthlyLimit,
  hashGrantSecret,
  issueApprovalToken,
  markApprover,
  normalizeGrantSource,
  normalizeUserCode,
  openGrant,
  recordApprovalAttempt,
  sanitizeDisplayField,
  secondsUntil,
  touchPoll,
  uniformMissDelayMs,
} from '../lib/device-grant.js';

export const deviceGrant = new Hono();

/** RFC 8628 §3.4 : l'URN que la RFC impose, et la seule que cette route sert. */
const DEVICE_GRANT_TYPE_URN = 'urn:ietf:params:oauth:grant-type:device_code';

const CLIENT_NAME_MAX = 60;
const REASON_MAX = 200;

/**
 * Les textes rendus aux agents. En anglais, comme tout ce que lit un modèle, et
 * SANS AUCUN CHIFFRE ÉCRIT : chaque nombre est interpolé depuis sa constante.
 * Un chiffre tapé ici serait une énième autorité sur un plafond, et il
 * mentirait le jour où le palier bouge.
 *
 * 🚨 Les phrases du CHEMIN AGENT viennent de `DEVICE_TEXTS` (le module), elles
 * ne sont pas recopiées : la surface MCP HTTP sert les MÊMES phrases dans sa
 * sortie structurée, et deux copies d'un refus, c'est un agent qui lit deux
 * explications du même mur. Les clés ci-dessous sont celles qui n'existent que
 * sur cette route, dont tout le CHEMIN HUMAIN (la page d'approbation).
 */
const TEXTS = {
  ...DEVICE_TEXTS,
  invalid_or_expired: 'This code is not valid, or it has expired. Ask the agent for a new one.',
  key_rate_limited: 'Only one API key can be generated per email per day. Try again tomorrow.',
  approval_token_required:
    'Reload the approval page and try again: the approval it was holding is no longer current.',
  unsupported_media_type: 'Send this request as application/json.',
  forbidden_origin: 'This origin is not allowed to approve or refuse a device request.',
  code_sent: `A 6-digit code was sent to the address supplied. Submit it within ${VERIFICATION_TTL_MINUTES} minutes to receive a key with the higher allowance.`,
} as const;

const TERMS_URL = 'https://ibanforge.com/legal/terms';

function clientIpOf(c: Context): string | null {
  return extractClientIp({
    'x-forwarded-for': c.req.header('x-forwarded-for') ?? null,
    'x-real-ip': c.req.header('x-real-ip') ?? null,
  });
}

/** L'attente, interruptible par l'abandon du client. */
function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

type Body = Record<string, unknown>;

/**
 * Lecture par TEXTE, et c'est la seule forme correcte : `c.req.json()` jette
 * sur un corps ABSENT comme sur un corps CASSÉ, et un catch unique répondrait
 * 400 aux deux. Seul le VIDE est un corps par défaut ; l'illisible garde son
 * 400.
 *
 * `POST /v1/keys/device/token` accepte aussi le form-encodé : une bibliothèque
 * OAuth existante postera cette forme, et l'accepter coûte trois lignes plutôt
 * qu'un client RFC-conforme qui se croit devant un serveur cassé.
 */
async function readBody(c: Context, acceptForm = false): Promise<Body | 'invalid'> {
  const contentType = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const raw = (await c.req.text().catch(() => '')).trim();
  if (acceptForm && contentType === 'application/x-www-form-urlencoded') {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }
  if (raw === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'invalid';
  }
  // Un scalaire ou un tableau est du JSON valide et n'est pas un corps de
  // requête : le refuser ici évite de lire un champ sur `null` plus bas.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'invalid';
  return parsed as Body;
}

function text(body: Body, field: string): string {
  const value = body[field];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * La réponse 404 UNIFORME de lookup, approve et deny : introuvable, expiré,
 * déjà approuvé, déjà refusé.
 *
 * 🚨 L'uniformité est la protection principale, et elle vaut dans le TEMPS
 * aussi. Distinguer « inconnu » de « expiré » de « déjà tranché » donnerait à
 * un devineur un oracle qui lui dit quand il a touché juste. Un seul corps, un
 * seul statut, et un même délai — d'où l'attente ci-dessous sur TOUS les 404,
 * `hit` compris.
 */
async function uniform404(
  c: Context,
  approverSource: string | null,
  route: 'lookup' | 'approve' | 'deny',
): Promise<Response> {
  // 🚨 Retarder est un moyen de défense, pas un moyen de se faire tenir des
  // connexions : l'attente d'un 404 prend une place dans le même compteur que
  // le long-polling (spec 04 §3.3). Une fois le plafond global atteint, le
  // délai retombe au plancher, qui reste uniforme — l'oracle temporel ne
  // rouvre pas, seule l'escalade s'arrête.
  const release = enterPoll('device', approverSource);
  try {
    const saturated = pollsInFlight() >= devicePollsInFlightMax();
    const delay = saturated ? deviceMissDelayFloorMs() : uniformMissDelayMs(approverSource, route);
    await sleep(delay, c.req.raw.signal);
  } finally {
    release();
  }
  return c.json({ error: 'invalid_or_expired', message: TEXTS.invalid_or_expired }, 404);
}

/**
 * Les gardes communes de `approve` et `deny`, dans l'ordre.
 *
 * `Content-Type: application/json` OBLIGATOIRE : c'est ce qui force le
 * preflight, donc ce qui fait que CORS s'applique vraiment. Une requête
 * « simple » au sens du fetch (`Content-Type: text/plain`, corps JSON) part
 * sans preflight et serait traitée. Et l'`Origin` est contrôlé QUAND IL EST
 * PRÉSENT, jamais quand il est absent, sinon `curl` cesse de fonctionner et la
 * recette de vérification avec lui.
 */
function writeGuards(c: Context): Response | null {
  const contentType = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return c.json({ error: 'unsupported_media_type', message: TEXTS.unsupported_media_type }, 415);
  }
  const origin = c.req.header('origin');
  if (origin && !isAllowedOrigin(origin)) {
    return c.json({ error: 'forbidden_origin', message: TEXTS.forbidden_origin }, 403);
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// 1. POST /v1/keys/device — ouvrir un grant
// ────────────────────────────────────────────────────────────────────────────

deviceGrant.post('/v1/keys/device', async (c) => {
  const body = await readBody(c);
  if (body === 'invalid') {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }

  const result = openGrant({
    ip: clientIpOf(c),
    userAgent: c.req.header('user-agent') ?? null,
    // 🚨 Nettoyés ici parce qu'ils seront AFFICHÉS À UN HUMAIN sur une page
    // qu'il croit être la nôtre. Un champ qui ne passe pas le nettoyage n'est
    // pas une erreur : il devient null, et la page affiche son libellé de repli.
    clientName: sanitizeDisplayField(body.client_name, CLIENT_NAME_MAX),
    reason: sanitizeDisplayField(body.reason, REASON_MAX),
    // `web-device` par défaut, `mcp-device` quand l'appelant le déclare ainsi.
    // 🚨 Ce champ est une chaîne LIBRE : il sert l'attribution, jamais un
    // plafond. Le plafond compte l'empreinte de réseau, et c'est pour cela
    // qu'il ne se contourne pas en changeant de `source` à chaque appel.
    source: normalizeGrantSource(body.source, 'web-device'),
  });

  // 🚨 Les DEUX sorties portent `display_to_human`, y compris le refus : les
  // surfaces MCP A et B sont de simples relais de cette route, et un refus sans
  // bloc à montrer les obligerait à en composer un — trois compositions locales
  // pour une phrase (§5.4).
  if (!result.ok) {
    return result.error === 'device_rate_limited'
      ? c.json(
          {
            error: 'device_rate_limited',
            message: TEXTS.device_rate_limited,
            display_to_human: displayToHuman({ status: 'device_rate_limited' }),
          },
          429,
        )
      : c.json({ error: 'device_unavailable', message: TEXTS.device_unavailable }, 503);
  }

  // Celui que l'agent affiche : il pré-remplit le code. `verification_uri`
  // seul sert le cas où l'humain tape l'adresse à la main sur un autre appareil.
  const verificationUriComplete = `${DEVICE_VERIFICATION_URI}?code=${encodeURIComponent(result.userCode)}`;

  return c.json(
    {
      device_code: result.deviceCode,
      user_code: result.userCode,
      verification_uri: DEVICE_VERIFICATION_URI,
      verification_uri_complete: verificationUriComplete,
      expires_in: result.expiresIn,
      interval: DEVICE_POLL_INTERVAL_SECONDS,
      message: TEXTS.opened,
      display_to_human: displayToHuman({
        status: 'ok',
        userCode: result.userCode,
        verificationUriComplete,
      }),
    },
    201,
  );
});

// ────────────────────────────────────────────────────────────────────────────
// 2. POST /v1/keys/device/token — long-polling
// ────────────────────────────────────────────────────────────────────────────

function pendingBody(expiresIn: number): Record<string, unknown> {
  return {
    error: 'authorization_pending',
    message: TEXTS.authorization_pending,
    expires_in: expiresIn,
    interval: DEVICE_POLL_INTERVAL_SECONDS,
  };
}

function deliveredBody(minted: {
  api_key: string;
  key_prefix: string;
  tier: KeyTier | null;
  monthly_limit: number | null;
  email: string | null;
}): Record<string, unknown> {
  return {
    api_key: minted.api_key,
    key_prefix: minted.key_prefix,
    tier: minted.tier,
    monthly_limit: grantMonthlyLimit(minted.tier, minted.monthly_limit),
    // 🚨 Le champ `email` est ABSENT sur le palier anonyme : il ne vaut pas
    // `null` et surtout pas la sentinelle. La publier apprendrait à un agent à
    // recopier ce mot comme si c'était une adresse, et il finirait dans un
    // formulaire.
    ...(minted.email ? { email: minted.email } : {}),
    message: TEXTS.saved,
    terms_url: TERMS_URL,
    config_line: deviceConfigLine(minted.api_key),
  };
}

deviceGrant.post('/v1/keys/device/token', async (c) => {
  const body = await readBody(c, true);
  if (body === 'invalid') {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }
  const grantType = text(body, 'grant_type');
  if (grantType !== '' && grantType !== DEVICE_GRANT_TYPE_URN) {
    return c.json(
      {
        error: 'unsupported_grant_type',
        message: `This endpoint only serves the device grant. Send grant_type "${DEVICE_GRANT_TYPE_URN}", or omit it.`,
      },
      400,
    );
  }
  const secret = text(body, 'device_code');
  if (secret === '') {
    return c.json({ error: 'invalid_grant', message: TEXTS.invalid_grant }, 400);
  }
  const secretHash = hashGrantSecret(secret);

  // 🚨 Cette route ne connaît QUE le rail 'device'. Un nonce de paiement
  // présenté ici répond invalid_grant sans rien consommer : ni poll_count, ni
  // last_polled_at, ni le clair de la clé.
  let grant = findGrantBySecret(secret, 'device');
  if (!grant) return c.json({ error: 'invalid_grant', message: TEXTS.invalid_grant }, 400);

  const settled = settle(c, grant, secretHash);
  if (settled) return settled;

  // À partir d'ici le grant est 'pending' et vivant : c'est le seul cas où l'on
  // attend. Le contrôle d'intervalle vient AVANT l'attente, et rend la main
  // tout de suite : il met la contre-pression du grant devant le limiteur
  // global de requêtes par minute, qu'un client mal réglé atteindrait sinon en
  // trente secondes.
  if (touchPoll(secretHash, 'device') === 'slow_down') {
    return c.json(
      {
        error: 'slow_down',
        message: TEXTS.slow_down,
        expires_in: grant.expires_in,
        interval: DEVICE_POLL_INTERVAL_SECONDS,
      },
      400,
    );
  }

  const ipHash = keyCreationSource(clientIpOf(c));

  // 1) Un navigateur n'est JAMAIS un poller légitime. Une requête qui porte
  //    `Origin` ou `Sec-Fetch-Mode` vient d'une page web : trois lignes de
  //    script sur une page fréquentée feraient tenir trente secondes de serveur
  //    à chacun de ses visiteurs, depuis autant d'adresses résidentielles
  //    qu'elle a de lecteurs — et comme la route accepte le form-encodé, c'est
  //    une requête simple, sans preflight. Coût de cette règle pour un client
  //    RFC-conforme : zéro.
  const fromBrowser = Boolean(c.req.header('origin') || c.req.header('sec-fetch-mode'));
  if (fromBrowser) return c.json(pendingBody(grant.expires_in), 400);

  // 🚨 La boucle vit dans le module depuis le 15/09/2026, parce que la surface
  // MCP HTTP attend sur la MÊME base avec les MÊMES trois plafonds de
  // `pollsInFlight` : deux boucles auraient donné deux comportements sous
  // saturation, et les deux répondent `authorization_pending`, donc rien ne
  // dirait laquelle a raison. Les trois bornes sont lues là-bas.
  const waited = await awaitGrantSettlement(secret, 'device', grant, ipHash, c.req.raw.signal);
  if (waited.kind === 'vanished') {
    return c.json({ error: 'invalid_grant', message: TEXTS.invalid_grant }, 400);
  }
  grant = waited.grant;

  const after = settle(c, grant, secretHash);
  if (after) return after;
  return c.json(pendingBody(secondsUntil(grant.expires_at)), 400);
});

/**
 * La réponse quand le grant n'est plus en attente, ou plus vivant. `null`
 * signifie « en attente et vivant », c'est-à-dire le seul cas où l'on attend.
 *
 * 🚨 Le retrait est tenté AVANT le contrôle d'intervalle : une clé approuvée
 * est la réponse terminale, et faire passer deux retraits concurrents par un
 * `slow_down` rendrait l'unicité intestable. C'est aussi ce qui garde
 * `consumeGrantKey` seul juge de la course.
 */
function settle(c: Context, grant: GrantRow, secretHash: string): Response | null {
  if (grant.status === 'denied') {
    return c.json({ error: 'access_denied', message: TEXTS.access_denied }, 400);
  }
  if (grant.status === 'delivered') {
    return c.json({ error: 'invalid_grant', message: TEXTS.invalid_grant }, 400);
  }
  if (grant.status === 'approved') {
    const minted = consumeGrantKey(secretHash, 'device');
    if (minted) return c.json(deliveredBody(minted), 200);
    // Approuvé mais rien à remettre : soit la fenêtre de retrait est passée,
    // soit une course concurrente a gagné. Les deux réponses sont honnêtes et
    // différentes, et c'est ce qui permet à l'agent de savoir s'il peut
    // rouvrir un grant.
    return grant.expired === 1
      ? c.json({ error: 'expired_token', message: TEXTS.expired_token }, 400)
      : c.json({ error: 'invalid_grant', message: TEXTS.invalid_grant }, 400);
  }
  if (grant.status === 'expired' || grant.expired === 1) {
    return c.json({ error: 'expired_token', message: TEXTS.expired_token }, 400);
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. POST /v1/keys/device/lookup — ce que la page affiche, et son jeton
// ────────────────────────────────────────────────────────────────────────────

/**
 * POST et non GET, et le motif n'est pas le journal des requêtes (qui ne
 * stocke que le chemin) : un `user_code` dans une URL entre dans l'historique
 * du navigateur, dans les journaux d'accès de l'hébergeur du site, et fuit en
 * `Referer` vers toute ressource tierce que la page chargerait.
 *
 * ⚠️ Le parcours principal fait pourtant exactement cela :
 * `verification_uri_complete` porte le code, affiché par l'agent, collé par
 * l'humain. C'est un arbitrage assumé au profit du parcours humain, pas une
 * doctrine que ce module respecte. Ce qui en borne l'impact : la clé ne sort
 * jamais par la page, et un refus obtenu par un tiers ne condamne plus la
 * tentative.
 */
deviceGrant.post('/v1/keys/device/lookup', async (c) => {
  const approverSource = keyCreationSource(clientIpOf(c));
  const body = await readBody(c);
  if (body === 'invalid') {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }
  const userCode = normalizeUserCode(text(body, 'user_code'));
  const grant = userCode === '' ? null : findGrantByUserCode(userCode);
  // `hit` = le code EXISTAIT, expiré ou déjà tranché compris. Le budget ne
  // compte que les `hit = 0` ; le délai s'applique aux deux.
  recordApprovalAttempt(approverSource, 'lookup', grant !== null);
  if (!grant || grant.status !== 'pending' || grant.expired === 1) {
    return uniform404(c, approverSource, 'lookup');
  }

  // 🚨 La garde CSRF. Un seul jeton vivant par grant : un nouveau lookup
  // écrase le précédent, donc de deux onglets ouverts sur le même code c'est
  // le dernier chargé qui peut approuver. Aucune ligne écrite (le grant vient
  // d'être tranché par une requête concurrente) : c'est le même 404 uniforme.
  const approvalToken = issueApprovalToken(grant.device_code_hash);
  if (approvalToken === null) return uniform404(c, approverSource, 'lookup');

  return c.json({
    user_code: formatUserCode(userCode),
    client_name: grant.client_name,
    reason: grant.reason,
    expires_in: grant.expires_in,
    status: grant.status,
    anonymous_monthly_limit: ANONYMOUS_MONTHLY_LIMIT,
    claimed_monthly_limit: FREE_TIER_MONTHLY_LIMIT,
    approval_token: approvalToken,
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. POST /v1/keys/device/approve — l'humain approuve
// ────────────────────────────────────────────────────────────────────────────

/** Le texte servi quand une clé naît pendant une alerte du disjoncteur. Les
 *  deux nombres viennent des constantes de paliers, jamais d'un littéral. */
function shieldNotice(): string {
  return (
    `This key was issued with a reduced allowance of ${SHIELD_MONTHLY_LIMIT} requests this month. ` +
    'It goes back up on its own within a few hours. To lift it to ' +
    `${FREE_TIER_MONTHLY_LIMIT} right away, claim it: POST /v1/keys/claim.`
  );
}

deviceGrant.post('/v1/keys/device/approve', async (c) => {
  const guard = writeGuards(c);
  if (guard) return guard;

  const approverSource = keyCreationSource(clientIpOf(c));
  const body = await readBody(c);
  if (body === 'invalid') {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }

  const userCode = normalizeUserCode(text(body, 'user_code'));
  const grant = userCode === '' ? null : findGrantByUserCode(userCode);
  recordApprovalAttempt(approverSource, 'approve', grant !== null);
  if (!grant || grant.status !== 'pending' || grant.expired === 1) {
    return uniform404(c, approverSource, 'approve');
  }
  if (!checkApprovalToken(grant.device_code_hash, text(body, 'approval_token'))) {
    return c.json(
      { error: 'approval_token_required', message: TEXTS.approval_token_required },
      403,
    );
  }
  markApprover(grant.device_code_hash, approverSource);

  const rawEmail = text(body, 'email').toLowerCase();
  const code = text(body, 'code');

  // ── Branche e-mail : le contrôle d'adresse d'abord, l'envoi ensuite ───────
  if (rawEmail !== '') {
    if (!isPlainEmail(rawEmail)) {
      return c.json({ error: 'invalid_email', message: 'A valid email address is required' }, 400);
    }
    if (process.env.IBANFORGE_ADMIN_TEST_KEYS !== 'true' && isDisposableDomain(rawEmail)) {
      return c.json(
        {
          error: 'disposable_email',
          message:
            'An address was supplied, and this one is a disposable domain: example.com, mailinator and the ' +
            'like are blocked. Either send an address you can read, or approve without one — a key with no ' +
            'address is issued on the spot.',
        },
        400,
      );
    }
    // Un domaine sans serveur de courrier ne peut recevoir ni la clé ni le
    // code, et chaque envoi vers un tel domaine coûte la réputation de la
    // boîte chez le fournisseur. Sauté sous vitest : les domaines de la suite
    // sont des noms de documentation, et un test ne doit pas dépendre d'un
    // résolveur.
    if (!process.env.VITEST && !(await domainAcceptsMail(domainOf(rawEmail)))) {
      return c.json(
        {
          error: 'undeliverable_email',
          message:
            'The domain of this address has no mail server, so no key or verification code could reach it. ' +
            'Check the address, or use another mailbox you can read.',
        },
        400,
      );
    }

    if (code === '') {
      const sent = await sendVerificationCode(c, grant, approverSource, rawEmail);
      if (sent) return sent;
    } else {
      const check = checkVerificationCode(rawEmail, code);
      if (!check.ok) {
        return c.json(
          {
            error: 'verification_failed',
            reason: check.reason,
            message:
              check.reason === 'expired' || check.reason === 'no_challenge'
                ? 'This code is no longer valid — approve again without a code to receive a fresh one.'
                : `Wrong code. Check the most recent mail; the challenge locks after ${VERIFICATION_MAX_ATTEMPTS} attempts.`,
          },
          403,
        );
      }
      return mint(c, grant, rawEmail);
    }
  }

  return mint(c, grant, null);
});

/**
 * L'envoi du code à six chiffres, plus la rallonge d'échéance du grant.
 *
 * 🚨 L'ORDRE des quatre gestes est un contrat, pas un détail : plafond
 * d'envoi, enregistrement de l'envoi, création du défi, puis envoi réel.
 * `createVerificationChallenge` remet le compteur d'essais à zéro par son
 * `ON CONFLICT` — réémettre un défi EST cette remise à zéro, seul rempart
 * contre la force brute des six chiffres. Créer le défi avant de mesurer
 * l'envoi offrirait des remises à zéro gratuites.
 *
 * 🚨 Et les plafonds portent sur l'APPROBATEUR, jamais sur le créateur du
 * grant : c'est cette requête-ci qui déclenche un courrier, et un plafond
 * indexé sur le créateur serait contournable en renouvelant le grant.
 */
async function sendVerificationCode(
  c: Context,
  grant: GrantRow,
  approverSource: string | null,
  email: string,
): Promise<Response | null> {
  const sendCheck = challengeSendAllowed(approverSource, email);
  if (!sendCheck.ok) {
    return c.json(
      {
        error: 'verification_rate_limited',
        message:
          sendCheck.reason === 'recipient'
            ? 'Too many verification codes were requested for this address today. Try again tomorrow, or use the most recent code you already received.'
            : sendCheck.reason === 'domain'
              ? 'Too many verification codes were sent to addresses at this domain today. Existing keys keep working; try again tomorrow, or use another mailbox you can read.'
              : 'Too many verification codes were requested from this network today. Existing keys keep working; prepaid credits are instant (POST /v1/credits/buy/1k) and x402 needs no key.',
      },
      429,
    );
  }
  const sendId = recordVerificationSend(approverSource, email);
  // Défi de CRÉATION : aucune cible de clé (troisième argument absent), donc le
  // même comportement que /v1/keys/generate et aucun `wrong_target` possible à
  // la vérification.
  const challenge = createVerificationChallenge(email, approverSource);
  if (typeof challenge !== 'string') {
    return c.json(
      {
        error: 'verification_in_flight',
        message:
          'A verification code was just sent for this address. Use it, or try again in a moment.',
      },
      409,
    );
  }
  const outcome = await deliverKeyVerificationEmail({ to: email, code: challenge });
  const sent = outcome === 'sent';
  // L'issue est écrite dans les deux sens : un refus qui ne laisse aucune trace
  // est exactement la manière dont ce canal a échoué sans que personne ne le voie.
  markVerificationOutcome(sendId, sent);
  if (outcome === 'undeliverable') {
    return c.json(
      {
        error: 'undeliverable_email',
        message:
          'The mail server for this address refused it, so no verification code could be delivered. ' +
          'Check the address, or use another mailbox you can read.',
      },
      400,
    );
  }
  if (!sent) {
    void opsFail(
      'mail:verification',
      'Verification codes are not leaving: the device-grant approval answers 503 while the relay refuses or cannot be reached.',
      3,
    );
    return c.json(
      {
        error: 'verification_unavailable',
        message: 'A verification mail could not be sent right now. Try again in a few minutes.',
      },
      503,
    );
  }

  // 🚨 LES DEUX HORLOGES NE PARTENT PAS EN MÊME TEMPS. Le grant court depuis sa
  // création, le code depuis son ENVOI, c'est-à-dire maintenant. Sans cette
  // rallonge, un humain qui met cinq minutes à ouvrir le lien puis demande la
  // voie e-mail tape un code JUSTE et s'entend répondre invalide. Rallongé à
  // chaque envoi, dans la borne de deux durées de vie depuis la création.
  const expiresAt = extendForEmail(grant.device_code_hash);
  return c.json(
    {
      status: 'code_sent',
      // Le NOUVEAU décompte, pour que la page recale son horloge.
      expires_in: expiresAt ? secondsUntil(expiresAt) : DEVICE_CODE_TTL_SECONDS,
      message: TEXTS.code_sent,
    },
    202,
  );
}

/**
 * La frappe. C'est la séquence la plus contrainte du module.
 *
 * 🚨 La clé est frappée par `generateApiKey`, et c'est elle, seule et
 * inconditionnellement, qui écrit la ligne de naissance dans `key_creations`.
 * Un appel à `recordKeyCreation` ajouté ici produirait DEUX lignes par clé
 * device : un disjoncteur qui s'arme à la moitié du volume réel, et un chargeur
 * de cohortes qui voit deux fois chaque clé.
 *
 * 🚨 La clé n'est JAMAIS rendue à la page. Elle part uniquement à l'agent, par
 * `/v1/keys/device/token`. C'est ce qui empêche un tiers qui a deviné un
 * `user_code` de repartir avec la clé : au mieux il fait recevoir une clé
 * anonyme à l'agent légitime.
 */
async function mint(c: Context, grant: GrantRow, verifiedEmail: string | null): Promise<Response> {
  // 0. L'empreinte est celle du CRÉATEUR du grant, jamais celle de
  //    l'approbateur. La sentinelle remplace un ip_hash absent POUR LE JOURNAL
  //    seulement : un compteur global n'a besoin d'aucune ancre pour compter,
  //    et la garde par réseau interroge un hash précis, donc elle l'ignore
  //    d'elle-même.
  const birth = { ipHash: grant.ip_hash ?? 'unknown', userAgent: grant.user_agent };

  // 1. Le disjoncteur global, AVANT la frappe : il compte les créations
  //    PRÉCÉDENTES, donc la première au-delà du seuil est la première dégradée.
  //    Il ne refuse jamais, il dégrade.
  const shield = evaluateBreakerOnCreation();
  // 🚨 Le prédicat est « alerte armée ET pas de boîte prouvée », jamais
  //    « alerte armée ET palier anonyme ». `provenMailbox` est exactement
  //    « claimed_at sera posé à la naissance », ce que generateApiKey écrit sur
  //    cette seule branche : le prédicat `claimed_at IS NULL` de la spec se lit
  //    donc ici comme `!provenMailbox`, avant même que la ligne existe.
  const provenMailbox = verifiedEmail !== null;
  const degrade = shield.armed && !provenMailbox;
  const tier: KeyTier = provenMailbox ? 'email' : 'anonymous';

  // 2. La frappe. Branche anonyme : `null`, et generateApiKey pose la
  //    sentinelle sans arobase plus un plafond ÉCRIT — jamais laissé NULL, un
  //    NULL se relisant « palier gratuit » plus bas.
  //    Le plafond réduit se passe ICI plutôt que par un UPDATE d'après-coup :
  //    la colonne ne doit jamais porter une valeur que la réponse contredit.
  const monthlyLimit = degrade
    ? SHIELD_MONTHLY_LIMIT
    : provenMailbox
      ? undefined // undefined = le plafond du palier gratuit, inchangé
      : ANONYMOUS_MONTHLY_LIMIT;
  const result = generateApiKey(
    verifiedEmail,
    monthlyLimit,
    grant.source ?? 'web-device',
    false,
    birth,
    // 🚨 `provenMailbox` EST le « markVerifiedAtBirth » de la spec : il fait
    // écrire `claimed_at` et `claim_method = 'email_code'` dès la naissance.
    // Sans lui, une clé device née d'un code VÉRIFIÉ aurait claimed_at IS NULL,
    // serait dégradée par le bouclier, et contredirait la doctrine « une clé
    // qui prouve une boîte n'est pas dégradée ».
    provenMailbox,
  );

  // 2bis. La garde du jour de generateApiKey a mordu : une clé existe déjà pour
  //    cette adresse depuis moins de vingt-quatre heures. Le grant RESTE
  //    `pending`, rien n'est écrit (ni attribution, ni fenêtre de retrait), et
  //    l'humain garde ses deux issues sur le même écran : recommencer demain,
  //    ou prendre la clé anonyme sur le même bouton — la branche anonyme ne
  //    peut pas rendre null, la garde du jour ne s'exécutant que si une adresse
  //    est fournie.
  if (result === null) {
    return c.json({ error: 'key_rate_limited', message: TEXTS.key_rate_limited }, 429);
  }

  // 3. Le bouclier marque la clé née sous alerte. 🚨 PAR key_hash et par objet
  //    nommé : `api_keys.key_prefix` n'a AUCUNE contrainte d'unicité, donc un
  //    UPDATE par préfixe ne toucherait aucune ligne. La clé sortirait bien au
  //    plafond réduit (il passe par generateApiKey) mais sans `no_recredit` ni
  //    épisode : elle se rechargerait tous les mois, échapperait à la remontée
  //    du désarmement, et resterait inauditable.
  if (degrade) markShieldBirth({ keyHash: result.key_hash, episodeId: shield.episode_id });

  // 4. L'attribution : de la télémétrie, jamais une condition. Une base de
  //    mesure qui refuse une écriture ne doit coûter sa clé à personne.
  try {
    recordSignupAttribution(
      result.key_prefix,
      grant.source ?? 'web-device',
      parseAttribution(null),
    );
  } catch {
    /* rien */
  }

  // 5. Le grant passe à 'approved' et ouvre la fenêtre de retrait.
  //    🚨 Sur `changes`, jamais sur la lecture d'avant : entre le contrôle du
  //    jeton et cette ligne, une résolution MX peut durer deux secondes, et
  //    deux onglets peuvent frapper pour le même grant. Le perdant de la
  //    course aurait sinon une clé ACTIVE qu'aucune ligne ne porte — que la
  //    purge ne pourrait jamais révoquer — et répondrait « c'est fait » à un
  //    humain dont l'agent recevra l'autre clé (revue du 15/09, C1). La clé
  //    perdante est révoquée sur-le-champ ; sa ligne de naissance reste, le
  //    budget du jour a bien été débité.
  const attached = approveGrant(
    grant.device_code_hash,
    { tier, keyHash: result.key_hash, rawKey: result.api_key },
    'device',
  );
  if (!attached) {
    revokeApiKey(result.api_key);
    return uniform404(c, keyCreationSource(clientIpOf(c)), 'approve');
  }

  return c.json({
    ok: true,
    tier,
    monthly_limit: degrade
      ? SHIELD_MONTHLY_LIMIT
      : provenMailbox
        ? FREE_TIER_MONTHLY_LIMIT
        : ANONYMOUS_MONTHLY_LIMIT,
    ...(verifiedEmail ? { email: verifiedEmail } : {}),
    ...(degrade ? { notice: shieldNotice() } : {}),
  });
}

// ────────────────────────────────────────────────────────────────────────────
// 5. POST /v1/keys/device/deny — l'humain refuse
// ────────────────────────────────────────────────────────────────────────────

/**
 * Le jeton compte davantage ici que sur `approve` : un refus intersite ne
 * fabrique rien, il DÉTRUIT. Et un refus obtenu par un tiers ne condamne plus
 * la tentative honnête, l'agent ayant droit à un nouveau grant : un `user_code`
 * qui fuit (il voyage dans une URL) garantissait sinon l'échec définitif de la
 * tentative honnête.
 */
deviceGrant.post('/v1/keys/device/deny', async (c) => {
  const guard = writeGuards(c);
  if (guard) return guard;

  const approverSource = keyCreationSource(clientIpOf(c));
  const body = await readBody(c);
  if (body === 'invalid') {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }
  const userCode = normalizeUserCode(text(body, 'user_code'));
  const grant = userCode === '' ? null : findGrantByUserCode(userCode);
  recordApprovalAttempt(approverSource, 'deny', grant !== null);
  if (!grant || grant.status !== 'pending' || grant.expired === 1) {
    return uniform404(c, approverSource, 'deny');
  }
  const token = text(body, 'approval_token');
  if (!checkApprovalToken(grant.device_code_hash, token)) {
    return c.json(
      { error: 'approval_token_required', message: TEXTS.approval_token_required },
      403,
    );
  }
  markApprover(grant.device_code_hash, approverSource);
  if (!denyGrant(grant.device_code_hash, token)) {
    return uniform404(c, approverSource, 'deny');
  }
  return c.json({ ok: true });
});
