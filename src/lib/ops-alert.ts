/**
 * Alerting OPS minimal, via le bot Telegram déjà utilisé par les radars.
 *
 * ## Pourquoi ce fichier existe
 *
 * Audit B3 (20/08/2026) : les 15 automatisations d'IBANforge sont fail-soft et
 * correctes, mais aucune n'a de sonde de vie. Chaque échec finit en
 * `console.error` dans les logs Railway — c'est-à-dire nulle part. Trois pannes
 * réelles produisent aujourd'hui exactement le même silence qu'une semaine
 * calme : une veille hebdo morte, un radar sans clé Anthropic valide, et
 * (depuis le correctif de résilience 97c0f9a) une panne du facilitator CDP.
 *
 * La preuve que ce n'est pas théorique est datée : le cron `refresh-bic` a
 * échoué le 01/05/2026 ET le 01/06/2026 — sur un test sans rapport avec la
 * donnée — et personne n'a réagi pendant deux mois (audit D2).
 *
 * ## Les trois règles qui font que ça ne devient pas du bruit
 *
 * 1. On alerte sur une TRANSITION, jamais sur une condition. `opsFail`/`opsOk`
 *    tiennent un compteur d'échecs consécutifs par clé : le message part au
 *    passage du seuil, et une seule fois. La guérison se dit aussi ("✅"),
 *    sans quoi on ne distingue pas un problème réglé d'une sonde morte.
 * 2. Le garde anti-tempête vit dans `kv_state`, PAS en mémoire. Sur Railway un
 *    redéploiement peut arriver plusieurs fois par jour : une Map ferait dire
 *    "au plus 1×/6h" à un mécanisme qui alerterait en fait à chaque déploiement.
 *    `kv_state` est dans stats.sqlite, donc sur le volume persistant.
 * 3. Jamais de donnée personnelle dans le message. Telegram n'est pas un
 *    sous-traitant déclaré à la politique de confidentialité — même contrainte
 *    que `notify.ts`. Compteurs et noms techniques seulement.
 *
 * Ce module NE JETTE JAMAIS. Une alerte qui casse la chose qu'elle surveille
 * est pire que pas d'alerte.
 *
 * ## Un écart assumé avec le design B3 §3.3
 *
 * B3 marquait l'alerte comme "ouverte" (`firing`) AVANT de consulter le garde
 * anti-tempête et AVANT de savoir si Telegram avait accepté le message. Deux
 * conséquences que l'implémentation corrige ici :
 *   - une alerte tombant dans la fenêtre de silence d'une PRÉCÉDENTE alerte de
 *     la même clé était perdue pour de bon (jamais réémise une fois la fenêtre
 *     rouverte) ;
 *   - une panne de Telegram produisait une alerte "ouverte" que personne n'a
 *     jamais reçue, puis un "✅ résolu" pour un problème dont personne n'avait
 *     entendu parler.
 * Ici `firing` ne passe à true qu'après un envoi RÉUSSI : tant que le message
 * n'est pas parti, le prochain tick réessaie. Le plafond de 1 message/6 h par
 * clé est inchangé.
 */
import { kvGet, kvSet } from './forum-radar-server.js';

/** Fenêtre anti-tempête : une même clé au plus une fois par période. */
const STORM_WINDOW_MS = 6 * 60 * 60 * 1000;

const K_STATE = (key: string): string => `ops:state:${key}`;
const K_SENT = (key: string): string => `ops:sent:${key}`;

interface OpsState {
  /** Échecs consécutifs observés depuis la dernière guérison. */
  fails: number;
  /** true si une alerte est actuellement ouverte ET a bien été envoyée. */
  firing: boolean;
}

function readState(key: string): OpsState {
  try {
    const raw = kvGet(K_STATE(key));
    if (!raw) return { fails: 0, firing: false };
    const p = JSON.parse(raw) as Partial<OpsState>;
    return { fails: Number(p.fails ?? 0), firing: Boolean(p.firing) };
  } catch {
    return { fails: 0, firing: false };
  }
}

function writeState(key: string, s: OpsState): void {
  try {
    kvSet(K_STATE(key), JSON.stringify(s));
  } catch (err) {
    console.error('[ops-alert] state write failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Garde anti-tempête, persisté. Renvoie true si l'envoi est autorisé.
 * Les messages de guérison ne passent PAS par ici : une résolution doit
 * toujours partir, sinon un "✅" étouffé laisse croire que la panne dure.
 */
function stormGateOpen(key: string): boolean {
  try {
    const last = Number(kvGet(K_SENT(key)) ?? 0);
    if (Number.isFinite(last) && last > 0 && Date.now() - last < STORM_WINDOW_MS) return false;
  } catch {
    /* kv illisible : on préfère alerter en double que se taire */
  }
  return true;
}

function markSent(key: string): void {
  try {
    kvSet(K_SENT(key), String(Date.now()));
  } catch {
    /* best-effort */
  }
}

/**
 * Envoi Telegram bas niveau. Volontairement séparé de `notifyPurchaseTelegram`
 * (`src/lib/notify.ts`), dont le message est codé en dur pour un achat Stripe :
 * ce n'est pas un notificateur générique et le transformer en un ferait porter
 * à un chemin de paiement le risque d'un chemin d'alerting.
 *
 * Ne jette jamais et n'attend pas plus de 15 s.
 */
export async function notifyOps(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  const chat = process.env.TELEGRAM_CHAT_ID ?? '';
  if (!token || !chat) {
    console.error('[ops-alert] TELEGRAM_BOT_TOKEN/CHAT_ID absents — alerte non envoyée:', text.slice(0, 200));
    return false;
  }
  if (process.env.OPS_ALERTS_DISABLED === '1') {
    console.warn('[ops-alert] OPS_ALERTS_DISABLED=1 — alerte étouffée:', text.slice(0, 200));
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'User-Agent': 'ibanforge-backend' },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ chat_id: chat, text: text.slice(0, 3900), disable_web_page_preview: true }),
    });
    if (!res.ok) {
      console.error('[ops-alert] telegram HTTP', res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[ops-alert] telegram error:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Signale un échec pour `key`. N'alerte qu'au passage du seuil `threshold`
 * d'échecs CONSÉCUTIFS, et une seule fois tant que l'alerte reste ouverte.
 * `detail` doit rester technique : jamais d'e-mail, de nom de client ni d'IBAN.
 */
export async function opsFail(key: string, detail: string, threshold = 1): Promise<void> {
  try {
    const s = readState(key);
    s.fails += 1;
    // Pas encore au seuil, ou alerte déjà ouverte et reçue : on compte, on se tait.
    if (s.fails < threshold || s.firing) {
      writeState(key, s);
      return;
    }
    // Fenêtre de silence encore ouverte : on ne marque PAS l'alerte comme
    // émise, pour que le prochain tick la repropose au lieu de la perdre.
    if (!stormGateOpen(key)) {
      writeState(key, s);
      return;
    }
    const ok = await notifyOps(`🔴 IBANforge — ${key}\n${detail}\n(${s.fails} échec(s) consécutif(s))`);
    if (ok) {
      markSent(key);
      writeState(key, { fails: s.fails, firing: true });
    } else {
      // Telegram muet : l'alerte n'existe pour personne, donc elle reste à émettre.
      writeState(key, s);
    }
  } catch (err) {
    console.error('[ops-alert] opsFail failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Signale un succès pour `key`. Ferme l'alerte ouverte et envoie une ligne de
 * résolution — sans elle, un silence retrouvé serait indistinguable d'une sonde
 * morte. Aucune résolution n'est envoyée pour une alerte que personne n'a reçue.
 */
export async function opsOk(key: string, detail = ''): Promise<void> {
  try {
    const s = readState(key);
    if (!s.firing && s.fails === 0) return;
    const wasFiring = s.firing;
    writeState(key, { fails: 0, firing: false });
    if (!wasFiring) return;
    await notifyOps(`✅ IBANforge — ${key} résolu${detail ? `\n${detail}` : ''}`);
  } catch (err) {
    console.error('[ops-alert] opsOk failed:', err instanceof Error ? err.message : err);
  }
}

// ─── Homme mort ──────────────────────────────────────────────────────────────

const K_BEAT = (name: string): string => `ops:beat:${name}`;

/**
 * Une automatisation EXTERNE dit "je suis passée".
 *
 * Réservé aux crons GitHub, qui n'ont aucun état dans stats.sqlite. Les quatre
 * radars n'appellent PAS cette fonction : ils écrivent déjà leur dernier passage
 * dans kv_state pour leur propre contrôle "est-ce dû ?", et leur faire écrire un
 * SECOND horodatage du même fait créerait deux états qui peuvent diverger — la
 * façon exacte dont un homme mort se met à mentir (quelqu'un touche au chemin de
 * succès, une clé bouge, l'autre non, et la sonde confirme la vie d'un radar
 * mort). Voir RADAR_BEATS ci-dessous : on LIT leur clé, on n'en écrit pas une.
 */
export function heartbeat(name: string): void {
  try {
    kvSet(K_BEAT(name), String(Date.now()));
  } catch (err) {
    console.error('[ops-alert] heartbeat write failed:', name, err instanceof Error ? err.message : err);
  }
}

/** Crons GitHub : ils pointent via POST /internal/heartbeat/:name. */
export const HEARTBEATS: ReadonlyArray<{ name: string; maxAgeMs: number; label: string }> = [
  // Chaque seuil = cadence nominale + marge franche, pour qu'un simple retard
  // (runner GitHub lent) n'alerte pas. Le but est de détecter une automatisation
  // QUI NE TOURNE PLUS — pas une qui traîne.
  { name: 'weekly-veille', maxAgeMs: 9 * 24 * 3600_000, label: 'veille hebdo (+ canari découvrabilité)' },
  { name: 'weekly-reco-baseline', maxAgeMs: 9 * 24 * 3600_000, label: 'baseline reco-IA' },
  { name: 'refresh-compliance', maxAgeMs: 9 * 24 * 3600_000, label: 'refresh compliance' },
  // Mensuel : 35 j couvre un mois long + un runner en retard.
  { name: 'refresh-bic', maxAgeMs: 35 * 24 * 3600_000, label: 'refresh BIC + clearing CH' },
];

/**
 * Radars in-process : on lit la clé kv_state QU'ILS ÉCRIVENT DÉJÀ.
 *
 * ⚠️ Les quatre n'ont pas la même forme de stockage — revérifié le 21/08/2026 :
 *   - cohortes  : `cohort_radar_last_run`      → chaîne ISO nue   (cohort-radar-server.ts)
 *   - prospects : `prospect_radar_last_run`    → chaîne ISO nue   (prospect-radar-server.ts)
 *   - forums    : `forum_radar_last_scan_at`   → chaîne ISO nue   (forum-radar-server.ts)
 *                 (noter le nom : `last_scan_at`, PAS `last_run`)
 *   - lifecycle : `lifecycle_radar_state`      → OBJET JSON, champ `.last_run_at`
 *                 (lifecycle-radar-server.ts)
 *
 * D'où le `parse` par entrée plutôt qu'un lecteur unique : uniformiser côté
 * sonde serait réécrire l'état des radars, c'est-à-dire prendre le risque qu'un
 * audit casse ce qu'il observe.
 *
 * ✅ Vérifié avant de s'appuyer dessus : les quatre n'écrivent leur clé que sur
 * le CHEMIN DE SUCCÈS, après le travail. Un tick qui jette (clé Anthropic
 * invalide, source fermée) ne rafraîchit rien — l'homme mort ne peut donc pas
 * confirmer la vie d'un radar en panne. En revanche il est LENT sur ce cas :
 * il faut dépasser `maxAgeMs` pour crier. La détection rapide d'un radar qui
 * échoue tick après tick (sonde S2 de B3) demande d'éditer les 4 radars, ce qui
 * est hors du périmètre de cette session — c'est écrit dans E5-execution.md.
 *
 * Seuils = cadence due (DUE_AFTER_MS de chaque radar) × ~1,5.
 */
export const RADAR_BEATS: ReadonlyArray<{
  key: string;
  label: string;
  maxAgeMs: number;
  parse: (raw: string) => number | null;
}> = [
  {
    key: 'lifecycle_radar_state',
    label: 'radar lifecycle',
    maxAgeMs: 30 * 3600_000,
    parse: (raw) => {
      const at = (JSON.parse(raw) as { last_run_at?: string }).last_run_at;
      return at ? new Date(at).getTime() : null;
    },
  },
  { key: 'forum_radar_last_scan_at', label: 'radar forums', maxAgeMs: 30 * 3600_000, parse: (raw) => new Date(raw).getTime() },
  { key: 'prospect_radar_last_run', label: 'radar prospects', maxAgeMs: 12 * 3600_000, parse: (raw) => new Date(raw).getTime() },
  { key: 'cohort_radar_last_run', label: 'radar cohortes', maxAgeMs: 3 * 3600_000, parse: (raw) => new Date(raw).getTime() },
];

/** Juge un âge et alerte/résout. Facteur commun aux crons et aux radars. */
async function judge(alertKey: string, label: string, lastMs: number, maxAgeMs: number): Promise<void> {
  const ageMs = Date.now() - lastMs;
  if (!Number.isFinite(ageMs)) return;
  if (ageMs > maxAgeMs) {
    const h = (ageMs / 3600_000).toFixed(1);
    await opsFail(alertKey, `${label} : aucun signe de vie depuis ${h} h.`);
  } else {
    await opsOk(alertKey, `${label} a repointé.`);
  }
}

/**
 * Vérifie tous les hommes morts.
 *
 * Un battement ABSENT n'alerte pas : au premier démarrage rien n'a encore
 * pointé, et alerter ×8 au boot est la meilleure façon de faire couper les
 * alertes. Pour les crons on pose le battement et on juge à partir de là ; pour
 * les radars on attend simplement leur premier run (ils écrivent leur clé
 * eux-mêmes — en fabriquer une ici serait mentir sur un run qui n'a pas eu lieu).
 */
export async function checkHeartbeats(): Promise<void> {
  for (const h of HEARTBEATS) {
    try {
      const raw = kvGet(K_BEAT(h.name));
      if (!raw) {
        kvSet(K_BEAT(h.name), String(Date.now()));
        continue;
      }
      await judge(`heartbeat:${h.name}`, h.label, Number(raw), h.maxAgeMs);
    } catch (err) {
      console.error('[ops-alert] heartbeat check failed:', h.name, err instanceof Error ? err.message : err);
    }
  }

  for (const r of RADAR_BEATS) {
    try {
      const raw = kvGet(r.key);
      if (!raw) continue; // jamais tourné encore : on n'invente pas un battement
      const last = r.parse(raw);
      if (last === null || !Number.isFinite(last)) continue;
      await judge(`heartbeat:${r.key}`, r.label, last, r.maxAgeMs);
    } catch (err) {
      console.error('[ops-alert] radar beat check failed:', r.key, err instanceof Error ? err.message : err);
    }
  }
}
