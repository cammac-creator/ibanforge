/**
 * POST /v1/admin/correspondent — la fiche d'UN correspondant, pour le bureau
 * (boîte générale, étape 3, lot 3I, 11.11.2026). Le contenu et ses règles :
 * `src/lib/correspondent.ts`.
 *
 * Corps : `{ "email": "…" }`, et rien d'autre. L'adresse voyage dans le corps
 * d'un POST, jamais dans le chemin ni dans la chaîne de requête, pour qu'aucun
 * journal d'accès (Caddy, Railway) ne la porte.
 *
 * Ouverte par le secret complet ou par la famille `BUREAU_CONTEXT_TOKEN`
 * (`src/lib/admin-auth.ts`), bornée à 120 passages acceptés par heure pour cette
 * famille (429 au-delà, par la porte).
 *
 * Rien n'est journalisé de la requête : ni le corps, ni l'adresse, ni la sorte
 * trouvée. La seule trace est la ligne du journal des entrées d'administration
 * (route sous sa forme de gabarit, nom de la clé, statut). Le corps est lu en
 * texte borné et analysé ici, avec une erreur à phrase fixe : un `c.req.json()`
 * nu laisserait remonter le message de `JSON.parse`, qui peut citer le texte
 * reçu, jusqu'au gestionnaire d'erreurs.
 */
import { Hono, type Context } from 'hono';
import { authorizeAdmin } from '../lib/admin-auth.js';
import { correspondentOf } from '../lib/correspondent.js';

export const adminCorrespondent = new Hono();

/** Un corps plus long n'est pas une adresse : refusé avant toute analyse. */
export const MAX_BODY_BYTES = 1024;
/** La longueur maximale d'une adresse (RFC 5321). */
const MAX_EMAIL_LENGTH = 254;

function invalid(c: Context) {
  return c.json(
    { error: 'invalid_body', message: 'Expected a JSON object with a single "email" string.' },
    400,
  );
}

adminCorrespondent.post('/v1/admin/correspondent', async (c) => {
  c.header('Cache-Control', 'private, no-store');
  if (!authorizeAdmin(c)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let text: string;
  try {
    text = await c.req.text();
  } catch {
    return invalid(c);
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return invalid(c);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return invalid(c);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return invalid(c);
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'email') return invalid(c);
  const email = (body as { email: unknown }).email;
  if (typeof email !== 'string') return invalid(c);
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_EMAIL_LENGTH) return invalid(c);
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1 || /\s/.test(trimmed)) return invalid(c);
  return c.json(correspondentOf(trimmed));
});
