/**
 * Les plafonds propres de la clé du tableau de bord (`SITE_ADMIN_TOKEN`) sur les
 * écritures de sa liste qui partent sur le réseau (audit C10, section 5,
 * 11.11.2026).
 *
 * Le limiteur de débit exempte toute clé valide sur les routes de sa liste
 * (`src/middleware/rate-limit.ts`) : sans plafond ici, une clé du site qui fuit
 * pourrait relancer sans fin le balayage des forums (des appels sortants vers des
 * sites tiers), ou faire envoyer à volonté des messages d'« alerte de connexion »
 * par le bot de l'API. Relevé route par route dans la liste du site, ce sont les
 * deux seules écritures qui partent sur le réseau depuis l'API ; les autres
 * écrivent dans la base et rien d'autre.
 *
 * Chaque plafond vaut pour une heure glissante découpée en fenêtres fixes, en
 * mémoire (un redémarrage le remet à zéro : il borne une rafale, pas un mois).
 * Le secret complet et les autres clés ne sont pas plafonnés ici : le secret
 * complet garde tous ses pouvoirs, et aucune famille des scripts n'ouvre ces
 * deux routes.
 */
import type { Context } from 'hono';
import { adminKeyOf } from './admin-auth.js';

/**
 * Six balayages par heure : le bouton du CRM en lance un à la fois, et un
 * balayage déjà en cours répond 409 sans compter. Vingt alertes de connexion par
 * heure : une par connexion réussie au tableau de bord, plus la fermeture des
 * connexions après trop d'échecs ; vingt connexions dans l'heure ne sont pas un
 * usage, c'est un signal.
 */
export const SITE_KEY_CAPS = {
  'forum-scan': { max: 6, windowMs: 60 * 60_000 },
  'dashboard-login-alert': { max: 20, windowMs: 60 * 60_000 },
} as const;

export type SiteKeyCap = keyof typeof SITE_KEY_CAPS;

interface CapState {
  start: number;
  used: number;
  /** Vrai quand un appel de cette fenêtre a déjà été refusé. */
  refusing: boolean;
}
const caps = new Map<SiteKeyCap, CapState>();

export interface SiteKeySlot {
  /** Faux : le plafond de l'heure est atteint pour la clé du site. */
  allowed: boolean;
  /** Le premier refus d'une fenêtre : le moment de le dire, une fois. */
  firstRefusal: boolean;
  /** Le premier appel admis après une fenêtre refusée : le moment de refermer. */
  recovered: boolean;
}

const OPEN: SiteKeySlot = { allowed: true, firstRefusal: false, recovered: false };

/**
 * Prend une place pour cet appel. Toujours admis pour une autre clé que celle du
 * site. Ne jette jamais.
 */
export function takeSiteKeySlot(c: Context, name: SiteKeyCap, now = Date.now()): SiteKeySlot {
  if (adminKeyOf(c) !== 'SITE_ADMIN_TOKEN') return OPEN;
  const { max, windowMs } = SITE_KEY_CAPS[name];
  const prev = caps.get(name);
  const wasRefusing = prev?.refusing ?? false;
  const state: CapState =
    !prev || now - prev.start >= windowMs ? { start: now, used: 0, refusing: wasRefusing } : prev;
  caps.set(name, state);
  if (state.used >= max) {
    const firstRefusal = !state.refusing;
    state.refusing = true;
    return { allowed: false, firstRefusal, recovered: false };
  }
  state.used += 1;
  state.refusing = false;
  return { allowed: true, firstRefusal: false, recovered: wasRefusing };
}

/** Pour les tests : oublie les fenêtres. */
export function resetSiteKeyCaps(): void {
  caps.clear();
}
