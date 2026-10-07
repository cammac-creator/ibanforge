/**
 * Le dépôt des deux veilles du lundi dans le bulletin (étape B, 07.10.2026).
 *
 * `weekly-veille.ts` et `reco-baseline.ts` envoient leur message Telegram COMME
 * AVANT : rien ne quitte Telegram tant que Claude-Alain n'a pas vu la page (décision
 * du 28.09.2026). En plus, chacune dépose un résumé dans le bulletin du lundi, par
 * `POST /internal/bulletin/:source` (jeton `BULLETIN_FEED_TOKEN`).
 *
 * Trois règles :
 *
 *  1. Le dépôt ne fait JAMAIS échouer le run : sans jeton, ou après trois essais
 *     refusés, il écrit un avertissement et rend la main. Un run rouge déclencherait
 *     l'alerte d'échec du workflow et retiendrait son battement, pour un détail.
 *  2. Rien de ce qui est déposé n'est écrit dans le journal : les journaux des
 *     workflows d'un dépôt PUBLIC sont publics, et les lignes de la veille peuvent
 *     porter des chiffres réels. Seuls un état et un code HTTP sont écrits.
 *  3. Le texte est préparé ici (lignes coupées à deux cents caractères, au plus
 *     trois) : la route refuse ce qui dépasse, elle ne coupe pas.
 */

export type BulletinSource = 'weekly-veille' | 'weekly-reco-baseline';

export interface DepositPayload {
  lines: string[];
  score?: { value: number; out_of: number; errors: number };
}

export const LINE_MAX = 200;
export const MAX_LINES = 3;

/* eslint-disable no-control-regex -- the control characters are what this removes */
const CONTROL = /[\u0000-\u001f\u007f]/g;
/* eslint-enable no-control-regex */

/** Une ligne de texte brut, sans caractère de contrôle, coupée à `LINE_MAX` caractères. */
export function toLine(raw: string): string {
  const flat = raw.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  return chars.length <= LINE_MAX
    ? flat
    : `${chars
        .slice(0, LINE_MAX - 1)
        .join('')
        .trimEnd()}…`;
}

/** Ce que la veille dépose quand sa recherche n'a rien rendu de lisible. */
export const VEILLE_NOTHING_READABLE =
  'La recherche de la veille n’a rien rendu de lisible cette semaine : voir son message Telegram.';

/**
 * Les trois lignes de la veille : les premières « portes qui s'ouvrent » de sa
 * recherche, l'entrée la plus actionnable d'abord, dans l'ordre où le modèle les rend.
 *
 * 🚨 Jamais le bloc des chiffres de conversion : il cite des préfixes de clés et des
 * domaines de clients, qui n'ont rien à faire dans une autre table.
 */
export function veilleLines(research: string): string[] {
  const all = research.split('\n');
  const start = all.findIndex((l) => /PORTES QUI S['’]OUVRENT/i.test(l));
  if (start < 0) return [VEILLE_NOTHING_READABLE];
  const out: string[] = [];
  for (const line of all.slice(start + 1)) {
    const t = line.trim();
    // La section suivante commence par son titre en capitales (« 🔭 PISTES À CREUSER »).
    if (/^\S+\s+[A-ZÀ-Ý'’ ]{6,}$/u.test(t) && !t.startsWith('•')) break;
    if (!t.startsWith('•')) continue;
    const text = toLine(t.replace(/^•\s*/, ''));
    if (text) out.push(text);
    if (out.length === MAX_LINES) break;
  }
  return out.length > 0 ? out : [VEILLE_NOTHING_READABLE];
}

export interface RecoResult {
  query: string;
  present: boolean;
  error?: string;
}

/** Le dépôt de la mesure des IA : le score, et en trois lignes où l'on apparaît ou non. */
export function recoPayload(results: RecoResult[]): DepositPayload {
  const errors = results.filter((r) => r.error).length;
  const present = results.filter((r) => !r.error && r.present).map((r) => r.query);
  const absent = results.filter((r) => !r.error && !r.present).map((r) => r.query);
  const lines = [
    present.length > 0
      ? toLine(`Présent sur : ${present.join(' ; ')}`)
      : 'Présent sur aucune des requêtes de référence lues.',
  ];
  if (absent.length > 0) lines.push(toLine(`Absent de : ${absent.join(' ; ')}`));
  if (errors > 0) {
    lines.push(
      `${errors} ${errors > 1 ? 'requêtes en erreur' : 'requête en erreur'} : score partiel.`,
    );
  }
  return {
    lines: lines.slice(0, MAX_LINES),
    score: { value: present.length, out_of: results.length, errors },
  };
}

export interface DepositOptions {
  apiBase: string;
  token: string | undefined;
  fetchImpl?: typeof fetch;
  attempts?: number;
  waitMs?: number;
  /** Où écrire les états ; jamais le contenu. */
  log?: (line: string) => void;
}

export type DepositOutcome = 'sent' | 'skipped' | 'failed';

/**
 * Dépose dans le bulletin. Ne jette jamais ; trois essais espacés, comme le battement.
 * Le corps de la réponse n'est pas lu : il ne porte que `{ ok: true }`, et rien de
 * ce qui a été envoyé ne doit pouvoir revenir dans le journal.
 */
export async function depositToBulletin(
  source: BulletinSource,
  payload: DepositPayload,
  opts: DepositOptions,
): Promise<DepositOutcome> {
  const log = opts.log ?? ((line: string) => console.log(line));
  if (!opts.token) {
    log('::warning::BULLETIN_FEED_TOKEN absent : rien de déposé dans le bulletin');
    return 'skipped';
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const attempts = opts.attempts ?? 3;
  const waitMs = opts.waitMs ?? 20_000;
  let last = 'aucune réponse';
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await doFetch(`${opts.apiBase}/internal/bulletin/${source}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bulletin-token': opts.token },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        log(`[bulletin] dépôt ${source} : accepté`);
        return 'sent';
      }
      last = `HTTP ${res.status}`;
      // Un refus de forme ou de jeton ne passera pas mieux au deuxième essai.
      if (res.status === 400 || res.status === 401 || res.status === 404 || res.status === 413) {
        break;
      }
    } catch (err) {
      last =
        err instanceof Error && err.name === 'TimeoutError' ? 'délai dépassé' : 'erreur réseau';
    }
    if (i < attempts && waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  }
  log(`::warning::dépôt ${source} dans le bulletin refusé (${last}), non bloquant`);
  return 'failed';
}
