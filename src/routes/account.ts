/**
 * Les routes du compte client par e-mail (lot C1, 24.09.2026).
 *
 *   POST /v1/account/code          une adresse → un code à six chiffres par mail
 *   POST /v1/account/session       adresse + code → cookie de session, sans jeton dans le corps
 *   GET  /v1/account/overview      les clés actives de l'adresse (cookie)
 *   GET  /v1/account/keys/report   ?prefix=ifk_… : le rapport de 30 jours d'UNE de ces clés (cookie)
 *   POST /v1/account/logout        se déconnecter, ici ou partout (cookie)
 *   POST /v1/admin/account/revoke  couper toutes les sessions d'une adresse (support)
 *
 * La logique vit dans `src/lib/account.ts`, avec les quatre règles de sûreté
 * qui la portent. Ce fichier ajoute ce qui tient à HTTP : les gardes
 * d'écriture, le cookie et les réponses.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MONTÉ DEPUIS `src/routes/api-keys.ts`, PAR UNE FABRIQUE
 * ─────────────────────────────────────────────────────────────────────────────
 * Monté par `apiKeys.route('/', createAccountRoutes(…))`, donc AVANT le
 * middleware des clés et le rail x402, comme `/v1/keys/generate` : ces routes
 * n'exigent ni clé ni paiement.
 *
 * Une fabrique et non un objet importé, parce que trois fonctions dont ces
 * routes ont besoin vivent dans `api-keys.ts` (`usageBlock`,
 * `isAdminAuthorized`, la liste des domaines refusés). Les importer d'ici
 * créerait une boucle entre les deux fichiers de routes, et `api-keys.ts`
 * lirait alors une constante encore non initialisée le jour où un fichier
 * importerait celui-ci en premier. La fabrique les reçoit : aucune boucle,
 * aucun ordre d'import à respecter.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 LE COOKIE
 * ─────────────────────────────────────────────────────────────────────────────
 * `ibanforge_account=<ifs_…>; Max-Age=604800; Path=/v1/account; HttpOnly;
 * Secure; SameSite=Strict`, sans `Domain` : limité à l'hôte de l'API, illisible
 * par JavaScript, jamais envoyé hors de ces routes. `ibanforge.com` et
 * `api.ibanforge.com` sont le même site, donc un `fetch` de la page vers l'API
 * le porte même en `Strict`. Ces routes sont les SEULES du service à lire un
 * cookie ; `credentials: true` dans le CORS global ne donne donc rien de plus
 * aux autres.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  ACCOUNT_COOKIE,
  ACCOUNT_SESSION_SECONDS,
  accountCodeBudgetLeft,
  buildOverview,
  checkLoginCode,
  createSession,
  findOwnedKey,
  forgetLoginCode,
  issueLoginCode,
  noteAccountCodeRefused,
  noteAccountCodeSent,
  readSession,
  revokeAllSessions,
  revokeSession,
  type AccountSession,
  type UsageBuilder,
} from '../lib/account.js';
import { isAllowedOrigin } from '../lib/cors-origins.js';
import { isDisposableDomain } from '../lib/disposable-domains.js';
import { deliverAccountCodeEmail } from '../lib/email.js';
import { normalizeEmail } from '../lib/email-norm.js';
import { getKeyReport } from '../lib/key-report.js';
import {
  VERIFICATION_TTL_MINUTES,
  challengeSendAllowed,
  keyCreationSource,
  markVerificationOutcome,
  recordVerificationSend,
} from '../lib/key-creation-guard.js';
import { domainAcceptsMail, domainOf } from '../lib/mail-domain.js';
import { opsFail } from '../lib/ops-alert.js';
import { extractClientIp } from '../lib/stats.js';

/** Ce que `src/routes/api-keys.ts` passe à la fabrique (voir l'en-tête). */
export interface AccountRouteDeps {
  /** Le bloc d'usage de `/v1/keys/usage` : les mêmes chiffres sur le compte. */
  usageBlock: UsageBuilder;
  /** La comparaison à temps constant du secret d'administration. */
  isAdminAuthorized: (provided: string | undefined) => boolean;
  /** Les domaines fictifs que `/v1/keys/generate` et `/v1/keys/claim` refusent déjà. */
  isBlockedEmail: (email: string) => boolean;
}

/**
 * Les textes servis. En anglais, comme toute l'API. 🚨 Ceux des routes `code`
 * et `session` ne disent JAMAIS rien des clés : ils répondent de la même façon
 * à une adresse qui en porte et à une adresse qui n'en porte pas, et un mot sur
 * « vos clés » ici serait l'oracle que la construction évite.
 */
const TEXTS = {
  unsupported_media_type: 'Send this request as application/json.',
  forbidden_origin: 'This origin is not allowed to use the IBANforge account.',
  invalid_json: 'Request body must be a JSON object.',
  invalid_email: 'A valid email address is required.',
  disposable_email:
    'This address is on a disposable domain, so a sign-in code cannot be sent there. Use an address you can read.',
  undeliverable_domain:
    'The domain of this address has no mail server, so no sign-in code could reach it. ' +
    'Check the address, or use another mailbox you can read.',
  undeliverable_mailbox:
    'The mail server for this address refused it, so no sign-in code could be delivered. ' +
    'Check the address, or use another mailbox you can read.',
  rate_limited_recipient:
    'Too many sign-in codes were requested for this address today. Try again tomorrow, or use the most recent code you received.',
  rate_limited_domain:
    'Too many sign-in codes were sent to addresses at this domain today. Try again tomorrow.',
  rate_limited_source:
    'Too many sign-in codes were requested from this network today. Try again tomorrow.',
  // Le même texte pour les deux causes (relais en panne, plafond global de
  // l'heure) : le repli qu'il propose vaut pour toute adresse, donc il ne dit
  // rien de celle-ci.
  code_unavailable:
    'Sign-in codes cannot be sent right now. Try again later, or paste an API key on the account page instead.',
  invalid_code:
    'This code is not valid, or it has expired. Check the most recent mail, or ask for a new code.',
  too_many_attempts: 'Too many attempts with this code. Ask for a new one.',
  signed_out: 'You are not signed in, or your session has ended. Please sign in again.',
  not_found: 'No such key in this account.',
  unauthorized: 'unauthorized',
} as const;

/** Les attributs du cookie, les mêmes à la pose et à l'effacement. */
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'Strict',
  path: '/v1/account',
} as const;

/** Même forme d'adresse que `/v1/keys/generate` et `/v1/keys/claim`. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function clientSource(c: Context): string | null {
  return keyCreationSource(
    extractClientIp({
      'x-forwarded-for': c.req.header('x-forwarded-for') ?? null,
      'x-real-ip': c.req.header('x-real-ip') ?? null,
    }),
  );
}

/**
 * Les gardes des routes qui écrivent, dans l'ordre : le motif de
 * `src/routes/device-grant.ts`, recopié plutôt qu'exporté pour ne pas toucher
 * ce fichier.
 *
 * `Content-Type: application/json` OBLIGATOIRE : c'est ce qui force le preflight
 * CORS. Un formulaire d'un site tiers (`text/plain` ou form-encodé) part sans
 * preflight et serait traité ; il reçoit ici un 415 avant tout. Et l'`Origin`
 * est contrôlé QUAND IL EST PRÉSENT : un navigateur l'envoie toujours sur un
 * POST, `curl` jamais. C'est ce qui empêche un site tiers de connecter la
 * victime à la session de l'attaquant (CSRF de connexion), puis de lui faire
 * « recharger » la clé de l'attaquant en croyant recharger la sienne.
 */
function writeGuards(c: Context): Response | null {
  const contentType = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return c.json({ error: 'unsupported_media_type', message: TEXTS.unsupported_media_type }, 415);
  }
  const origin = c.req.header('origin');
  if (origin !== undefined && !isAllowedOrigin(origin)) {
    return c.json({ error: 'forbidden_origin', message: TEXTS.forbidden_origin }, 403);
  }
  return null;
}

/**
 * Lecture par TEXTE, comme `/v1/keys/claim` : un corps vide vaut `{}`, un corps
 * illisible garde son 400.
 */
async function readBody(c: Context): Promise<Record<string, unknown> | 'invalid'> {
  const raw = (await c.req.text().catch(() => '')).trim();
  if (raw === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'invalid';
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'invalid';
  return parsed as Record<string, unknown>;
}

/** L'adresse, en minuscules et sans blancs, ou null si ce n'en est pas une. */
function readEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email === '' || email.length > 255 || !EMAIL_SHAPE.test(email)) return null;
  return email;
}

function signedOut(c: Context): Response {
  // Un cookie présenté qui ne mène à aucune session vivante est effacé : le
  // navigateur cesse de l'envoyer.
  if (getCookie(c, ACCOUNT_COOKIE) !== undefined) deleteCookie(c, ACCOUNT_COOKIE, COOKIE_OPTIONS);
  return c.json({ error: 'signed_out', message: TEXTS.signed_out }, 401);
}

function sessionOf(c: Context): AccountSession | null {
  return readSession(getCookie(c, ACCOUNT_COOKIE));
}

export function createAccountRoutes(deps: AccountRouteDeps): Hono {
  const account = new Hono();

  // Aucune réponse du compte ne se met en cache, nulle part : ni la vue, ni un
  // refus, ni un 202. Posé après le handler, sur toutes les routes du compte.
  account.use('/v1/account/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  // ── 1. POST /v1/account/code ─────────────────────────────────────────────
  //
  // 🚨 AUCUNE LECTURE D'`api_keys` sur ce chemin, et c'est toute
  // l'anti-énumération : le code part que l'adresse porte des clés ou non, les
  // plafonds et le registre comptent de la même façon, et la réponse 202 est
  // identique. Les contrôles et leur ordre sont repris de `/v1/keys/claim`.
  account.post('/v1/account/code', async (c) => {
    const guard = writeGuards(c);
    if (guard) return guard;
    const body = await readBody(c);
    if (body === 'invalid') {
      return c.json({ error: 'invalid_json', message: TEXTS.invalid_json }, 400);
    }
    const email = readEmail(body.email);
    if (!email) return c.json({ error: 'invalid_email', message: TEXTS.invalid_email }, 400);
    if (
      process.env.IBANFORGE_ADMIN_TEST_KEYS !== 'true' &&
      (deps.isBlockedEmail(email) || isDisposableDomain(email))
    ) {
      return c.json({ error: 'disposable_email', message: TEXTS.disposable_email }, 400);
    }
    // Un domaine sans serveur de courrier ne recevra jamais le code, et chaque
    // envoi vers un tel domaine coûte la réputation de la boîte d'envoi. Sauté
    // sous vitest, comme sur `/claim` : un test ne dépend pas d'un résolveur.
    if (!process.env.VITEST && !(await domainAcceptsMail(domainOf(email)))) {
      return c.json({ error: 'undeliverable_email', message: TEXTS.undeliverable_domain }, 400);
    }
    // `normalizeEmail` ne rend null que sans arobase, ce que la forme exclut.
    const emailNorm = normalizeEmail(email) ?? email;

    // 🚨 L'ordre des gestes est celui de `/v1/keys/claim`, et il est un
    // contrat : plafonds d'envoi, enregistrement de l'envoi, émission du code,
    // envoi réel. Émettre le code avant de mesurer l'envoi offrirait des remises
    // à zéro gratuites du compteur d'essais, seul rempart contre la force brute
    // des six chiffres. Le registre est `verification_sends`, PARTAGÉ avec la
    // création et la réclamation : les plafonds ne se doublent pas en passant
    // par la connexion.
    const source = clientSource(c);
    const sendCheck = challengeSendAllowed(source, email);
    if (!sendCheck.ok) {
      return c.json(
        {
          error: 'code_rate_limited',
          message:
            sendCheck.reason === 'recipient'
              ? TEXTS.rate_limited_recipient
              : sendCheck.reason === 'domain'
                ? TEXTS.rate_limited_domain
                : TEXTS.rate_limited_source,
        },
        429,
      );
    }
    // Le plafond GLOBAL de l'heure, dernier contrôle avant l'envoi : la boîte
    // d'envoi est celle des clés payées, et c'est la connexion qui cède. Un
    // refus ici n'entre pas au registre (aucun mail n'est parti) et n'alerte
    // qu'une fois par heure (`noteAccountCodeRefused`).
    if (!accountCodeBudgetLeft()) {
      noteAccountCodeRefused();
      return c.json({ error: 'code_unavailable', message: TEXTS.code_unavailable }, 503);
    }
    const sendId = recordVerificationSend(source, email);
    const code = issueLoginCode(emailNorm);
    const outcome = await deliverAccountCodeEmail({
      to: email,
      code,
      ttlMinutes: VERIFICATION_TTL_MINUTES,
    });
    // L'issue est écrite dans les deux sens : c'est ce qui rend le taux de
    // refus du relais visible (`verificationDelivery`), connexion comprise.
    markVerificationOutcome(sendId, outcome === 'sent');
    if (outcome === 'undeliverable') {
      return c.json({ error: 'undeliverable_email', message: TEXTS.undeliverable_mailbox }, 400);
    }
    if (outcome !== 'sent') {
      // Fermé en cas de panne, comme `/claim` : sans relais, pas de code. Le
      // seuil de 3 évite de réveiller quelqu'un pour un hoquet.
      void opsFail(
        'mail:verification',
        'Verification codes are not leaving: the account sign-in answers 503 while the relay refuses or cannot be reached.',
        3,
      );
      return c.json({ error: 'code_unavailable', message: TEXTS.code_unavailable }, 503);
    }
    noteAccountCodeSent();
    return c.json({ status: 'code_sent', expires_in: VERIFICATION_TTL_MINUTES * 60 }, 202);
  });

  // ── 2. POST /v1/account/session ──────────────────────────────────────────
  //
  // 🚨 AUCUNE LECTURE D'`api_keys` ici non plus : un bon code ouvre une session,
  // que l'adresse porte des clés ou non. Le jeton part dans le cookie et
  // JAMAIS dans le corps.
  account.post('/v1/account/session', async (c) => {
    const guard = writeGuards(c);
    if (guard) return guard;
    const body = await readBody(c);
    if (body === 'invalid') {
      return c.json({ error: 'invalid_json', message: TEXTS.invalid_json }, 400);
    }
    const email = readEmail(body.email);
    if (!email) return c.json({ error: 'invalid_email', message: TEXTS.invalid_email }, 400);
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    // Une saisie qui n'a pas la forme d'un code (cinq chiffres, une lettre)
    // n'est pas comptée comme un essai : elle ne peut pas être juste, et une
    // faute de frappe ne doit pas brûler l'un des cinq essais.
    if (!/^\d{6}$/.test(code)) {
      return c.json({ error: 'invalid_code', message: TEXTS.invalid_code }, 400);
    }
    const emailNorm = normalizeEmail(email) ?? email;
    const check = checkLoginCode(emailNorm, code);
    if (!check.ok) {
      return check.reason === 'too_many_attempts'
        ? c.json({ error: 'too_many_attempts', message: TEXTS.too_many_attempts }, 400)
        : c.json({ error: 'invalid_code', message: TEXTS.invalid_code }, 400);
    }
    // Une session déjà portée par ce navigateur est révoquée : le cookie va
    // être remplacé, et une session que plus personne ne détient n'a pas à
    // rester vivante jusqu'à son terme.
    revokeSession(getCookie(c, ACCOUNT_COOKIE));
    const session = createSession(emailNorm, email);
    setCookie(c, ACCOUNT_COOKIE, session.token, {
      ...COOKIE_OPTIONS,
      maxAge: ACCOUNT_SESSION_SECONDS,
    });
    return c.json({ signed_in: true, expires_at: session.expiresAt }, 200);
  });

  // ── 3. GET /v1/account/overview ──────────────────────────────────────────
  account.get('/v1/account/overview', (c) => {
    const session = sessionOf(c);
    if (!session) return signedOut(c);
    const requested = Number(c.req.query('page') ?? 1);
    const page =
      Number.isFinite(requested) && requested >= 1 ? Math.min(Math.trunc(requested), 10_000) : 1;
    return c.json(buildOverview(session, page, deps.usageBlock));
  });

  // ── 4. GET /v1/account/keys/report?prefix=ifk_… ──────────────────────────
  //
  // Le préfixe voyage en PARAMÈTRE DE REQUÊTE et non dans le chemin : le journal
  // `request_log` ne garde que le chemin, et un préfixe de clé dans le chemin y
  // survivrait douze mois, hors de portée de la purge des clés résiliées (DPA
  // 4.7), qui ne lit que la colonne `key_prefix`. Le journal de sortie, lui,
  // masque déjà toutes les valeurs de paramètres.
  //
  // 404 UNIFORME : un préfixe inconnu et celui d'une autre adresse rendent le
  // même corps, par la même requête unique (`findOwnedKey`).
  account.get('/v1/account/keys/report', (c) => {
    const session = sessionOf(c);
    if (!session) return signedOut(c);
    const prefix = (c.req.query('prefix') ?? '').trim();
    const owned = prefix === '' ? null : findOwnedKey(session.emailNorm, prefix.slice(0, 64));
    if (!owned) return c.json({ error: 'not_found', message: TEXTS.not_found }, 404);
    // La même borne que `/v1/keys/report` : une fenêtre sans limite serait un
    // parcours de table que n'importe quelle session pourrait répéter.
    const requested = Number(c.req.query('days') ?? 30);
    const windowDays = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), 365)
      : 30;
    // La même forme que `/v1/keys/report`, construite par les mêmes fonctions :
    // la page rend une seule fiche de clé, collée ou connectée.
    return c.json({
      key_prefix: owned.keyPrefix,
      usage: deps.usageBlock(owned.validation),
      report: getKeyReport(owned.keyPrefix, windowDays),
    });
  });

  // ── 5. POST /v1/account/logout ───────────────────────────────────────────
  //
  // 204 dans tous les cas, cookie effacé : se déconnecter sans session vivante
  // n'est pas une erreur. `{"all": true}` révoque toutes les sessions de
  // l'adresse (« se déconnecter partout »).
  account.post('/v1/account/logout', async (c) => {
    const guard = writeGuards(c);
    if (guard) return guard;
    const body = await readBody(c);
    if (body === 'invalid') {
      return c.json({ error: 'invalid_json', message: TEXTS.invalid_json }, 400);
    }
    const token = getCookie(c, ACCOUNT_COOKIE);
    const session = readSession(token);
    if (session) {
      if (body.all === true) revokeAllSessions(session.emailNorm);
      else revokeSession(token);
    }
    deleteCookie(c, ACCOUNT_COOKIE, COOKIE_OPTIONS);
    return c.body(null, 204);
  });

  // ── 6. POST /v1/admin/account/revoke ─────────────────────────────────────
  //
  // Le geste du support (« on m'a pris mon téléphone ») : toutes les sessions
  // vivantes de l'adresse, et le code en cours s'il y en a un. Rend le nombre
  // de sessions coupées.
  account.post('/v1/admin/account/revoke', async (c) => {
    if (!deps.isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
      return c.json({ error: TEXTS.unauthorized }, 401);
    }
    const body = await readBody(c);
    if (body === 'invalid') {
      return c.json({ error: 'invalid_json', message: TEXTS.invalid_json }, 400);
    }
    const email = readEmail(body.email);
    const emailNorm = email ? normalizeEmail(email) : null;
    if (!emailNorm) return c.json({ error: 'invalid_email', message: TEXTS.invalid_email }, 400);
    const revoked = revokeAllSessions(emailNorm);
    forgetLoginCode(emailNorm);
    return c.json({ revoked });
  });

  return account;
}
