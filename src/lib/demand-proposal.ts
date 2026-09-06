import type { DemandGapRow, DemandGapSummary } from './demand-gaps.js';

/**
 * The monthly turn of the living tool: the demand ledger proposes, the
 * operator decides.
 *
 * Until 03/09/2026 the ledger (demand-gaps.ts) only ranked what callers asked
 * for that we could not answer; the "which register next" decision was still
 * taken by supposition. This module turns the ranking into ONE proposal per
 * month, deterministic and explainable, so the decision starts from the
 * traffic. Nothing here acts: no register is fetched, no letter is sent. The
 * proposal is shown on the dashboard, carried in the weekly facts the digest
 * is written from, and sent once a month on the ops channel.
 *
 * What the ledger can and cannot tell: a bank code of a checksum-valid IBAN
 * that no source of ours knows means a REGISTER we do not consult (or a
 * country we do not cover); a bank code the country's own register says is
 * unallocated means nothing to plug (an example IBAN, a typo); a BIC of valid
 * shape that GLEIF and the Swift list do not carry means the composite map
 * needs that entry. Everything else is too thin to name.
 */

/** Below this many hits in the window, the ledger says "too early" rather than naming a register. */
export const MIN_HITS_TO_PROPOSE = 5;

export type ProposalKind = 'register' | 'composite' | 'none' | 'too_early';

export interface DemandProposal {
  /** Calendar month the proposal stands for, YYYY-MM. */
  month: string;
  kind: ProposalKind;
  country: string | null;
  /** The code (or the first of the country's codes) that carried the demand. */
  code: string;
  /** Distinct codes behind a register proposal; 1 otherwise. */
  codes: number;
  hits: number;
  /** Share of all real-demand hits in the window, in percent, one decimal. */
  share_pct: number;
  action_fr: string;
  why_fr: string;
  source_hint: string | null;
}

/**
 * Where the national bank-code register lives, for the countries the ledger
 * is most likely to name. A hint, not a promise: each entry is what we know
 * of the publisher, to save the first hour of the search. Countries we
 * already consult (DE, CH, LI, AT, BE, BG, SK, FI, PL, NL, ES via the MFI lists)
 * are not here on purpose: a gap there is a register we hold, not one to plug.
 */
export const REGISTER_HINTS: Readonly<Record<string, string>> = {
  TR: 'TCMB, liste des participants EFT (codes banque à 5 chiffres)',
  CN: 'CNAPS, codes de compensation publiés par la PBOC',
  LT: 'Bank of Lithuania, liste des codes banque ; la lettre est prête (fiche registres nationaux)',
  GB: 'sort codes Vocalink, sous licence : la table ne va jamais dans le dépôt public',
  IT: 'codici ABI et CAB, Banca d’Italia',
  FR: 'fichier des guichets bancaires, Banque de France',
  PT: 'Banco de Portugal, lista de instituições e códigos',
  IE: 'NSC (sort codes) irlandais, Banking & Payments Federation Ireland',
  SE: 'clearingnummer, Svenska Bankföreningen / Bankgirot',
  DK: 'registreringsnumre, Finans Danmark',
  NO: 'Bankregisteret, Bits AS',
  HU: 'bank azonosító, GIRO Zrt.',
  CZ: 'číselník kódů platebního styku, Česká národní banka',
  RO: 'Banca Națională a României, registrul instituțiilor de credit',
  GR: 'Hellenic Bank Association / Bank of Greece',
};

function isRealDemand(r: DemandGapRow): boolean {
  return !r.outcome.startsWith('unavailable');
}

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

/** The calendar month that ended before `now`, YYYY-MM: on the 1st of October the proposal is September's. */
export function monthEndedBefore(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  d.setUTCDate(0);
  return d.toISOString().slice(0, 7);
}

/**
 * Pure: the ledger summary in, one proposal out (or null when the window holds
 * no real demand at all). Register proposals aggregate per COUNTRY, because
 * that is the grain of the decision: three Turkish codes asked four times
 * each are one register to plug, not three separate questions.
 */
export function proposeFromDemand(summary: DemandGapSummary, month: string): DemandProposal | null {
  const rows = summary.top.filter(isRealDemand);
  if (rows.length === 0) return null;
  const total = rows.reduce((a, r) => a + r.hits, 0);

  // Candidate 1: a country whose bank codes no source of ours knows.
  const perCountry = new Map<string, { hits: number; codes: number; code: string }>();
  for (const r of rows) {
    if (r.kind !== 'bank_code' || !r.country) continue;
    if (!r.outcome.includes('absent_from_reference_data')) continue;
    const cur = perCountry.get(r.country) ?? { hits: 0, codes: 0, code: r.code };
    cur.hits += r.hits;
    cur.codes += 1;
    perCountry.set(r.country, cur);
  }
  let best: DemandProposal | null = null;
  for (const [country, agg] of perCountry) {
    if (best && agg.hits <= best.hits) continue;
    const hint = REGISTER_HINTS[country] ?? null;
    best = {
      month,
      kind: 'register',
      country,
      code: agg.code,
      codes: agg.codes,
      hits: agg.hits,
      share_pct: pct(agg.hits, total),
      action_fr: hint
        ? `Brancher le registre national des codes banque de ${country} : ${hint}.`
        : `Chercher et brancher le registre national des codes banque de ${country}.`,
      why_fr:
        `${agg.hits} appel${agg.hits > 1 ? 's' : ''} sur ${total} (${pct(agg.hits, total)} % de la demande non servie) ` +
        `visaient ${agg.codes} code${agg.codes > 1 ? 's' : ''} banque ${country} qu'aucune de nos sources ne connaît.`,
      source_hint: hint,
    };
  }

  // Candidate 2: a BIC of valid shape absent from every BIC source.
  for (const r of rows) {
    if (r.kind !== 'bic' || !r.outcome.startsWith('not_found')) continue;
    if (best && r.hits <= best.hits) continue;
    best = {
      month,
      kind: 'composite',
      country: r.country,
      code: r.code,
      codes: 1,
      hits: r.hits,
      share_pct: pct(r.hits, total),
      action_fr: `Enrichir la carte composite avec le BIC ${r.code} (le vérifier sur GLEIF ou auprès de Swift avant de l'ajouter).`,
      why_fr: `${r.hits} appel${r.hits > 1 ? 's' : ''} sur ${total} (${pct(r.hits, total)} %) ont demandé ce BIC, absent de GLEIF et de la liste Swift.`,
      source_hint: null,
    };
  }

  if (best) {
    if (best.hits >= MIN_HITS_TO_PROPOSE) return best;
    return {
      ...best,
      kind: 'too_early',
      action_fr: `Attendre : la demande la plus forte (${best.country ?? '?'} ${best.code}, ${best.hits} appel${best.hits > 1 ? 's' : ''}) reste sous le seuil de ${MIN_HITS_TO_PROPOSE}.`,
      why_fr: `Sous ${MIN_HITS_TO_PROPOSE} appels dans la fenêtre, un registre coûte plus qu'il ne sert ; le relevé du mois prochain tranchera.`,
    };
  }

  // Only unallocated codes (or Swiss IIDs unknown to SIX): nothing to plug.
  const top = rows[0];
  return {
    month,
    kind: 'none',
    country: top.country,
    code: top.code,
    codes: 1,
    hits: top.hits,
    share_pct: pct(top.hits, total),
    action_fr: `Rien à brancher : le code ${top.code} (${top.country ?? '?'}) n'est attribué par aucun registre ; un IBAN d'exemple ou une saisie fausse.`,
    why_fr: `Toute la demande non servie de la fenêtre porte sur des codes que le registre du pays dit non attribués.`,
    source_hint: null,
  };
}

/** One line for Telegram, plain text. */
export function formatProposalTelegram(p: DemandProposal): string {
  const head = `🌱 Registre de la demande, ${p.month}`;
  const where = p.country ? `${p.country} ${p.code}` : p.code;
  return `${head} : ${where}, ${p.hits} appel${p.hits > 1 ? 's' : ''} (${p.share_pct} % de la demande non servie). ${p.action_fr} Tu tranches : le détail est sur le tableau de bord, carte « L'outil vivant ».`;
}
