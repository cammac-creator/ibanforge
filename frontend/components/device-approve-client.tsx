'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DEVICE_USER_CODE_LENGTH,
  countdownParts,
  formatUserCode,
  isCompleteUserCode,
  normalizeUserCode,
  routeDeviceFailure,
} from '@/lib/device-code';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://api.ibanforge.com';

/**
 * La page d'approbation du device grant (RFC 8628) : un agent a demandé une
 * clé API, un humain vient dire oui ou non ici.
 *
 * 🚨 La clé n'apparaît JAMAIS sur cette page. L'API ne la rend pas au
 * navigateur : elle part à l'agent par `/v1/keys/device/token`, et c'est
 * précisément ce qui borne le dommage d'un lien d'approbation détourné — au
 * pire, un agent légitime reçoit une clé anonyme qu'il n'a pas demandée.
 *
 * 🚨 `approval_token` (la garde CSRF rendue par `lookup`) vit dans un `ref` et
 * nulle part ailleurs : jamais `localStorage`, jamais l'URL, jamais le DOM.
 * Un seul jeton est vivant par grant, donc un second onglet chargé plus tard
 * périme le premier ; c'est ce que rattrape la relance unique de `lookup` sur
 * un 403, et à défaut l'écran `tokenStale`.
 */

interface Grant {
  user_code: string;
  client_name: string | null;
  reason: string | null;
  anonymous_monthly_limit: number;
  claimed_monthly_limit: number;
}

/**
 * Les écrans. Les quatre premiers sont le parcours de la spec (saisie, revue,
 * code e-mail, fini) ; les quatre autres sont des fins de course.
 *
 * `keyRateLimited` n'en est pas un : ce refus ramène à la revue avec son
 * avertissement et le bouton anonyme remis en avant, parce que le bouton d'à
 * côté marche tout de suite et qu'un mur serait un mensonge.
 */
type Screen = 'code' | 'review' | 'emailCode' | 'done' | 'denied' | 'expired' | 'invalid' | 'tokenStale';

/** Un avertissement au-dessus du geste en cours, jamais un écran. */
type Notice = { kind: 'keyRateLimited' } | { kind: 'text'; text: string };

/**
 * Un POST du rail device.
 *
 * `Content-Type: application/json` est OBLIGATOIRE sur `approve` et `deny` :
 * l'en-tête force le préflight, donc CORS s'applique vraiment, et tout autre
 * type vaut 415. `lookup` le porte aussi, pour que les trois appels se
 * ressemblent côté réseau.
 */
async function postJson(
  path: 'lookup' | 'approve' | 'deny',
  payload: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const r = await fetch(`${API_BASE}/v1/keys/device/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok, status: r.status, body };
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Rien à quoi s'abonner : le `?code=` arrive dans l'URL au chargement et en
 * repart tout seul (voir `replaceState` plus bas). Le patron vient de
 * `audit-done-client.tsx` : lire `window.location` par `useSyncExternalStore`
 * plutôt que dans un effet évite à la fois le rendu en cascade que
 * `react-hooks/set-state-in-effect` interdit et l'erreur de build que
 * `useSearchParams()` provoque sur une page prérendue.
 */
function subscribeToNothing(): () => void {
  return () => {};
}

export function DeviceApproveClient() {
  const t = useTranslations('device');
  const tKey = useTranslations('apiKeyDialog');
  const tCommon = useTranslations('common');

  const [screen, setScreen] = useState<Screen>('code');
  const [code, setCode] = useState('');
  const [grant, setGrant] = useState<Grant | null>(null);
  /** Échéance absolue (ms), d'où le décompte se recalcule sans dériver. */
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);

  /** Le jeton d'approbation, et le verrou d'appel : ni l'un ni l'autre ne se rend. */
  const tokenRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  /** Le `?code=` ne se consomme qu'une fois, même si l'URL est relue. */
  const urlConsumedRef = useRef(false);

  const search = useSyncExternalStore<string | null>(
    subscribeToNothing,
    () => window.location.search,
    () => null,
  );
  /**
   * Ce que l'URL portait. `null` veut dire « pas de paramètre `code` du tout »
   * — ce qui n'est PAS la même chose qu'un paramètre illisible, et la
   * différence décide si l'URL doit être nettoyée.
   */
  const urlParam = useMemo(() => {
    if (search === null) return null;
    const raw = new URLSearchParams(search).get('code');
    return raw === null ? null : { clean: normalizeUserCode(raw) };
  }, [search]);

  const noticeOf = useCallback(
    (notice: 'keyRateLimited' | 'apiMessage', body: Record<string, unknown>): Notice =>
      notice === 'keyRateLimited' ? { kind: 'keyRateLimited' } : { kind: 'text', text: str(body.message) ?? '' },
    [],
  );

  /**
   * `lookup` : ce que la page a le droit d'afficher, et le jeton qui lui
   * permettra d'écrire. Stable (aucune dépendance) parce que l'effet de
   * pré-remplissage la nomme : recréée à chaque rendu, elle relancerait une
   * requête réseau par rendu.
   */
  const lookup = useCallback(async (userCode: string) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const { ok, status, body } = await postJson('lookup', { user_code: formatUserCode(userCode) });
      if (!ok) {
        const route = routeDeviceFailure(status, body.error);
        // Le 404 est uniforme (inconnu, expiré, déjà tranché) : « pas valide »
        // est le seul verdict honnête. Le reste ne quitte pas la saisie.
        if (route.screen === 'invalid') setScreen('invalid');
        else setNotice(noticeOf(route.screen === 'stay' ? route.notice : 'apiMessage', body));
        return;
      }
      tokenRef.current = str(body.approval_token);
      const seconds = num(body.expires_in);
      setGrant({
        user_code: str(body.user_code) ?? formatUserCode(userCode),
        client_name: str(body.client_name),
        reason: str(body.reason),
        anonymous_monthly_limit: num(body.anonymous_monthly_limit) ?? 0,
        claimed_monthly_limit: num(body.claimed_monthly_limit) ?? 0,
      });
      setCode(normalizeUserCode(userCode));
      if (seconds !== null) {
        setExpiresAt(Date.now() + seconds * 1000);
        setRemaining(seconds);
      }
      setScreen('review');
    } catch {
      setNotice({ kind: 'text', text: '' });
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }, [noticeOf]);

  /**
   * `?code=` : on le lit une fois, on le retire de l'URL, puis on interroge.
   *
   * 🚨 `replaceState` AVANT la requête, et non après comme le concède §2.4 :
   * l'écart est volontaire. Le code a déjà traversé le transcript du modèle,
   * l'historique et les journaux de l'hébergeur — rien ne rattrape cela — mais
   * tant qu'il est dans l'URL, chaque ressource que la page chargerait le
   * ferait fuir en `Referer`. Le retirer d'abord réduit cette fenêtre à zéro
   * au lieu de la fixer à la durée d'un aller-retour réseau.
   *
   * 🚨 Et le nettoyage est INCONDITIONNEL : il a lieu dès qu'un paramètre
   * `code` existe, avant même de savoir s'il est lisible. Le gardait-on pour
   * les seuls codes complets, un collage tronqué ou une faute de frappe
   * resterait dans l'URL et dans l'historique — c'est-à-dire exactement les
   * cas où la page ne peut rien faire d'autre que laisser l'humain retaper.
   *
   * `urlConsumedRef` rend l'effet idempotent : `window.location.search` change
   * sous nos pieds à cause du `replaceState`, donc l'instantané relu par React
   * peut faire rejouer cet effet, et un second `lookup` n'aurait aucun sens.
   *
   * Le `setTimeout(0)` fait partir l'appel hors du corps synchrone de l'effet
   * (`react-hooks/set-state-in-effect` est une erreur dans ce dépôt).
   */
  useEffect(() => {
    if (urlParam === null || urlConsumedRef.current) return;
    urlConsumedRef.current = true;
    window.history.replaceState(null, '', window.location.pathname);
    if (!isCompleteUserCode(urlParam.clean)) return;
    const timer = setTimeout(() => {
      void lookup(urlParam.clean);
    }, 0);
    return () => clearTimeout(timer);
  }, [urlParam, lookup]);

  /**
   * Le décompte. Il ne tourne que sur les deux écrans où le temps compte, et
   * il lit l'horloge dans son propre battement : jamais pendant un rendu, que
   * `react-hooks/purity` garde pur.
   *
   * Zéro atteint sous les yeux de l'humain est le SEUL cas où la page sait que
   * le code est expiré plutôt que simplement refusé — d'où l'écran `expired`
   * ici, et `invalid` sur un 404.
   *
   * 🚨 Le passage à `expired` est conditionnel À L'INTÉRIEUR du battement. La
   * garde d'écran ci-dessus est évaluée au montage de l'effet, pas à chaque
   * tour : un battement tombé entre l'approbation et le nettoyage de l'effet
   * remplacerait « c'est fait » par « ce code a expiré » chez quelqu'un dont
   * l'agent vient de recevoir sa clé.
   */
  useEffect(() => {
    if (expiresAt === null) return;
    if (screen !== 'review' && screen !== 'emailCode') return;
    const timer = setInterval(() => {
      const left = Math.round((expiresAt - Date.now()) / 1000);
      if (left <= 0) {
        setRemaining(0);
        setScreen((s) => (s === 'review' || s === 'emailCode' ? 'expired' : s));
        return;
      }
      setRemaining(left);
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt, screen]);

  /**
   * Approuver ou refuser.
   *
   * `allowRetry` est la relance unique de §4.4 : un 403
   * `approval_token_required` (deuxième onglet, ou page laissée ouverte plus
   * longtemps que le jeton) ne s'affiche pas tel quel : on redemande un jeton
   * par un `lookup` et on rejoue le geste. Deux tours au maximum, donc une
   * boucle est impossible et le second échec mène à `tokenStale`.
   */
  const decide = useCallback(
    async (kind: 'approve' | 'deny', extra: Record<string, string> = {}): Promise<void> => {
      // 🚨 Le même verrou que `lookup`, et il compte davantage ici : `disabled`
      // n'agit qu'au rendu suivant, donc deux clics très rapprochés partiraient
      // tous les deux. Le second recevrait le 404 du grant déjà tranché et
      // remplacerait « c'est fait » par « ce code n'est pas valide ».
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setBusy(true);
      setNotice(null);
      try {
        // Deux tours au maximum, et le second n'a lieu qu'avec un jeton frais :
        // la borne de la boucle EST la garde anti-boucle.
        for (let attempt = 0; attempt < 2; attempt++) {
          const token = tokenRef.current;
          if (token === null) {
            setScreen('tokenStale');
            return;
          }
          const { ok, status, body } = await postJson(kind, {
            user_code: formatUserCode(code),
            approval_token: token,
            ...extra,
          });

          if (!ok) {
            const route = routeDeviceFailure(status, body.error);
            if (route.screen === 'invalid') {
              setScreen('invalid');
              return;
            }
            if (route.screen === 'stale') {
              if (attempt > 0) {
                setScreen('tokenStale');
                return;
              }
              const fresh = await postJson('lookup', { user_code: formatUserCode(code) });
              const freshToken = fresh.ok ? str(fresh.body.approval_token) : null;
              if (freshToken === null) {
                setScreen('tokenStale');
                return;
              }
              tokenRef.current = freshToken;
              const seconds = num(fresh.body.expires_in);
              if (seconds !== null) {
                setExpiresAt(Date.now() + seconds * 1000);
                setRemaining(seconds);
              }
              continue;
            }
            if (route.notice === 'keyRateLimited') {
              // Une clé par adresse et par jour : retour à la revue, champ
              // e-mail replié, bouton anonyme de nouveau en tête.
              setNotice({ kind: 'keyRateLimited' });
              setEmailOpen(false);
              setScreen('review');
              return;
            }
            // Adresse jetable ou injoignable, plafond d'envoi, code faux, relais
            // en panne, 415, inconnu : on ne bouge pas, on montre le message de
            // l'API.
            setNotice(noticeOf(route.notice, body));
            return;
          }

          // 202 : le code à 6 chiffres est parti, le grant reste en attente et
          // son échéance a été rallongée une fois. Le jeton, lui, est conservé.
          if (status === 202 || str(body.status) === 'code_sent') {
            const seconds = num(body.expires_in);
            if (seconds !== null) {
              setExpiresAt(Date.now() + seconds * 1000);
              setRemaining(seconds);
            }
            setEmailCode('');
            setScreen('emailCode');
            return;
          }

          // Tranché : le jeton est mort côté serveur, il n'a plus rien à faire ici.
          tokenRef.current = null;
          setScreen(kind === 'deny' ? 'denied' : 'done');
          return;
        }
      } catch {
        setNotice({ kind: 'text', text: '' });
      } finally {
        inFlightRef.current = false;
        setBusy(false);
      }
    },
    [code, noticeOf],
  );

  /**
   * La saisie, normalisée à la frappe et interrogée dès qu'elle est complète.
   *
   * Aucun bouton d'envoi sur cet écran : §5.6 ne donne pas de libellé pour lui
   * et la consigne est de ne rien inventer. Huit caractères valides partent
   * donc tout seuls, et la touche d'envoi du clavier (`enterKeyHint`) reste le
   * chemin manuel.
   */
  const onCodeInput = (value: string) => {
    const next = normalizeUserCode(value);
    setCode(next);
    if (isCompleteUserCode(next) && !busy) void lookup(next);
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    if (busy || !isCompleteUserCode(code)) return;
    void lookup(code);
  };

  const submitEmail = (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (busy || address === '') return;
    void decide('approve', { email: address });
  };

  const submitEmailCode = (e: FormEvent) => {
    e.preventDefault();
    const digits = emailCode.replace(/\D/g, '');
    const address = email.trim().toLowerCase();
    if (busy || digits.length !== 6) return;
    void decide('approve', { email: address, code: digits });
  };

  const restart = () => {
    tokenRef.current = null;
    setCode('');
    setGrant(null);
    setExpiresAt(null);
    setRemaining(null);
    setEmail('');
    setEmailCode('');
    setEmailOpen(false);
    setNotice(null);
    setScreen('code');
  };

  const clock =
    remaining === null ? null : (
      <p className="font-mono text-xs text-muted-foreground tabular-nums">
        {t('expiresIn', countdownParts(remaining))}
      </p>
    );

  const warning =
    notice === null ? null : (
      <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
        {notice.kind === 'keyRateLimited' ? (
          <>
            <p className="text-sm font-medium">{t('keyRateLimitedTitle')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('keyRateLimitedBody')}</p>
          </>
        ) : (
          // Aucun texte de notre cru : le `message` de l'API est écrit pour
          // être actionnable, et une phrase anglaise vaut mieux qu'un vide.
          <p className="text-sm">{notice.text || tCommon('somethingWentWrong')}</p>
        )}
      </div>
    );

  /** Le mot de sécurité, sur tous les écrans : il est ce qui empêche cette page de servir de gabarit d'hameçonnage. */
  const safety = (
    <p className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">{t('safetyNote')}</p>
  );

  if (screen === 'done' || screen === 'denied' || screen === 'expired' || screen === 'invalid' || screen === 'tokenStale') {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {screen === 'done' ? t('doneTitle') : null}
          {screen === 'denied' ? t('deniedTitle') : null}
          {screen === 'expired' ? t('expiredTitle') : null}
          {screen === 'invalid' ? t('invalidTitle') : null}
          {screen === 'tokenStale' ? t('tokenStaleTitle') : null}
        </h1>
        {screen === 'done' ? <p className="text-sm text-muted-foreground">{t('doneBody')}</p> : null}
        {screen === 'expired' ? <p className="text-sm text-muted-foreground">{t('expiredBody')}</p> : null}
        {screen === 'tokenStale' ? <p className="text-sm text-muted-foreground">{t('tokenStaleBody')}</p> : null}
        {screen === 'invalid' ? (
          <Button type="button" variant="outline" onClick={restart} className="w-full sm:w-auto">
            {tCommon('tryAgain')}
          </Button>
        ) : null}
        {screen === 'tokenStale' ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => window.location.reload()}
            className="w-full sm:w-auto"
          >
            {tCommon('tryAgain')}
          </Button>
        ) : null}
        {safety}
      </div>
    );
  }

  if (screen === 'emailCode') {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('codeSent')}</p>
        {warning}
        <form onSubmit={submitEmailCode} className="flex flex-col gap-3">
          <label htmlFor="device-email-code" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {tKey('verify.codeLabel')}
          </label>
          <input
            id="device-email-code"
            type="text"
            value={emailCode}
            onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            autoFocus
            required
            disabled={busy}
            className="w-full rounded-lg border border-input bg-transparent px-3 py-3 font-mono text-xl tracking-[0.3em] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          />
          <Button type="submit" size="lg" disabled={busy || emailCode.length !== 6} className="w-full">
            {busy ? tKey('verify.submitting') : tKey('verify.submit')}
          </Button>
          {/*
            Sans cette porte de sortie, une adresse mal tapée enferme l'humain
            sur un champ qui ne recevra jamais son code, jusqu'à l'expiration du
            grant — alors que le bouton sans adresse, deux écrans plus haut,
            marche tout de suite. Le libellé est celui du dialogue de clé
            existant, qui fait déjà exactement ce geste.
          */}
          <button
            type="button"
            onClick={() => {
              setEmailCode('');
              setNotice(null);
              setEmailOpen(true);
              setScreen('review');
            }}
            disabled={busy}
            className="w-full text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
          >
            {tKey('verify.changeEmail')}
          </button>
        </form>
        {clock}
        {safety}
      </div>
    );
  }

  if (screen === 'review' && grant !== null) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        <dl className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('codeLabel')}</dt>
            {/* Texte, jamais du HTML : `client_name` et `reason` viennent de
                l'agent, donc d'un inconnu. */}
            <dd className="font-mono text-xl tracking-[0.2em]">{formatUserCode(grant.user_code)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('whoLabel')}</dt>
            <dd className="break-words text-sm">{grant.client_name ?? t('whoUnknown')}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('whyLabel')}</dt>
            <dd className="break-words text-sm">{grant.reason ?? t('whyUnknown')}</dd>
          </div>
        </dl>

        {clock}
        {warning}

        {/* Le geste par défaut, en tête et pleine largeur : sur 390 px, ce qui
            est au-dessus du bouton décide, et la clé sans adresse est le
            chemin que ce module existe pour offrir. */}
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="lg"
            disabled={busy}
            onClick={() => void decide('approve')}
            className="w-full"
          >
            {t('approveAnon', { limit: String(grant.anonymous_monthly_limit) })}
          </Button>
          <p className="text-xs text-muted-foreground">{t('approveAnonNote')}</p>
        </div>

        {emailOpen ? (
          <form onSubmit={submitEmail} className="flex flex-col gap-3 border-t pt-4">
            <label htmlFor="device-email" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {tKey('emailLabel')}
            </label>
            <input
              id="device-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              required
              disabled={busy}
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2.5 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            />
            <p className="text-xs leading-relaxed text-muted-foreground">{t('approveEmailNote')}</p>
            <Button type="submit" size="lg" variant="outline" disabled={busy || email.trim() === ''} className="w-full">
              {busy ? tKey('submitting') : tKey('submit')}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-2 border-t pt-4">
            <Button
              type="button"
              size="lg"
              variant="outline"
              disabled={busy}
              onClick={() => setEmailOpen(true)}
              className="w-full"
            >
              {t('approveEmail', { limit: String(grant.claimed_monthly_limit) })}
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">{t('approveEmailNote')}</p>
          </div>
        )}

        {/* Discret, et un bouton : refuser est une écriture, pas un lien. */}
        <button
          type="button"
          onClick={() => void decide('deny')}
          disabled={busy}
          className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
        >
          {t('deny')}
        </button>

        {safety}
      </div>
    );
  }

  // Écran 1 : la saisie. C'est aussi ce qui s'affiche pendant que le `?code=`
  // de l'URL part en `lookup`, et au premier rendu serveur, où il n'y a pas
  // d'URL à lire.
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      {warning}
      <form onSubmit={submitCode} className="flex flex-col gap-3">
        <label htmlFor="device-code" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('codeLabel')}
        </label>
        <input
          id="device-code"
          type="text"
          value={formatUserCode(code)}
          onChange={(e) => onCodeInput(e.target.value)}
          placeholder="XXXX-XXXX"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={DEVICE_USER_CODE_LENGTH + 1}
          autoFocus
          required
          disabled={busy}
          className="w-full rounded-lg border border-input bg-transparent px-3 py-3 font-mono text-xl uppercase tracking-[0.2em] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        />
        {busy ? <p className="text-xs text-muted-foreground">{tCommon('loading')}</p> : null}
      </form>
      {safety}
    </div>
  );
}
