import { describe, expect, it } from 'vitest';
import { formatGrouped } from './format-grouped';
import { isCreditKey, readBalance, type AccountUsage } from './account-credits';

/**
 * Fixtures inventées, et le chiffre du milieu est celui qui compte.
 *
 * Un acheteur d'un lot de 25 000 crédits qui a passé UN appel ce mois-ci :
 * l'API lui sert `used: 1` et un `remaining` de 199, calculé contre le plafond
 * du palier gratuit que sa clé ne porte pas. C'est exactement le nombre que la
 * page affichait à sa place. Le prendre comme fixture est ce qui rend
 * l'assertion « et pas 199 » capable d'attraper une régression : avec un autre
 * nombre d'appels, elle passerait sans rien vérifier.
 */
const CREDIT_KEY: AccountUsage = {
  used: 1,
  limit: 200,
  remaining: 199,
  month: '2026-09',
  basis: 'credits',
  tier: 'email',
  credits_remaining: 24939,
  credits_total: 25000,
  note: 'This key draws on a prepaid credit bundle.',
};

const MONTHLY_KEY: AccountUsage = {
  used: 1,
  limit: 200,
  remaining: 199,
  month: '2026-09',
  basis: 'monthly',
  tier: 'email',
};

/** Ce que la tuile montre vraiment, helpers du site compris. */
function shown(value: number | null, locale = 'fr'): string {
  return value === null ? '—' : formatGrouped(value, locale);
}

/** Les séparateurs de milliers du site sont insécables : comparer sans eux. */
function digits(s: string): string {
  return s.replace(/[\s  ]/g, '');
}

describe('une clé adossée à un lot de crédits', () => {
  it('est reconnue par son basis comme par son solde', () => {
    expect(isCreditKey(CREDIT_KEY)).toBe(true);
    expect(isCreditKey({ ...CREDIT_KEY, basis: undefined })).toBe(true);
    expect(isCreditKey({ ...CREDIT_KEY, credits_remaining: undefined })).toBe(true);
  });

  it('affiche son solde réel, et non le reste du plafond mensuel', () => {
    const balance = readBalance(CREDIT_KEY);
    expect(balance.kind).toBe('credits');
    if (balance.kind !== 'credits') return;

    expect(balance.creditsRemaining).toBe(24939);
    expect(balance.creditsTotal).toBe(25000);

    const value = shown(balance.creditsRemaining);
    expect(digits(value)).toBe('24939');
    // Le chiffre faux que cette page servait : 200 − 1 appel du mois.
    expect(digits(value)).not.toBe('199');
    expect(digits(shown(balance.creditsTotal))).toBe('25000');
  });

  it('ne porte aucune tuile de reste mensuel : rien ne lui est opposé', () => {
    const balance = readBalance(CREDIT_KEY);
    expect(balance).not.toHaveProperty('remaining');
  });

  it('garde ses appels du mois, qui restent une information utile', () => {
    const balance = readBalance(CREDIT_KEY);
    expect(balance.used).toBe(1);
  });

  it("dit qu'elle ne sait pas plutôt que de réafficher le plafond mensuel", () => {
    // Une réponse d'API antérieure au champ, ou tronquée : le basis fait foi,
    // le solde manque. Un tiret est honnête, 199 ne l'est pas.
    const balance = readBalance({ ...CREDIT_KEY, credits_remaining: undefined });
    expect(balance.kind).toBe('credits');
    expect(shown(balance.kind === 'credits' ? balance.creditsRemaining : 0)).toBe('—');
  });

  it("ne rend pas « 24 939 / 0 » quand le total n'est pas connu", () => {
    // L'API sert `credits_total ?? 0` : un zéro est un total inconnu.
    const balance = readBalance({ ...CREDIT_KEY, credits_total: 0 });
    expect(balance.kind === 'credits' && balance.creditsTotal).toBe(null);
    const absent = readBalance({ ...CREDIT_KEY, credits_total: undefined });
    expect(absent.kind === 'credits' && absent.creditsTotal).toBe(null);
  });
});

describe('une clé à quota mensuel', () => {
  it("garde l'affichage d'avant, au chiffre près", () => {
    const balance = readBalance(MONTHLY_KEY);
    expect(balance).toEqual({ kind: 'quota', used: 1, remaining: 199 });
    expect(digits(shown(balance.kind === 'quota' ? balance.remaining : 0))).toBe('199');
  });

  it('reste mensuelle sans basis servi du tout', () => {
    // Le champ est arrivé après la page : une réponse plus ancienne n'en a pas.
    const older: AccountUsage = { ...MONTHLY_KEY };
    delete older.basis;
    expect(readBalance(older).kind).toBe('quota');
  });

  it('suit aussi la voie mensuelle quand le plafond se mesure sur sa vie', () => {
    // `lifetime` : le plafond existe et il est opposé, seule l'assiette change.
    expect(readBalance({ ...MONTHLY_KEY, basis: 'lifetime' }).kind).toBe('quota');
  });

  it('ne montre jamais un reste négatif', () => {
    const balance = readBalance({ ...MONTHLY_KEY, used: 240, remaining: -40 });
    expect(balance.kind === 'quota' && balance.remaining).toBe(0);
  });

  it('survit à une réponse dont les nombres ne sont pas des nombres', () => {
    const broken = { month: '2026-09' } as unknown as AccountUsage;
    expect(readBalance(broken)).toEqual({ kind: 'quota', used: 0, remaining: 0 });
  });
});

describe('le nombre tel que le lecteur le voit', () => {
  it('groupe les milliers dans les trois langues, sans Intl', () => {
    expect(digits(formatGrouped(24939, 'fr'))).toBe('24939');
    expect(digits(formatGrouped(24939, 'de'))).toBe('24939');
    expect(formatGrouped(24939, 'en')).toBe('24,939');
  });
});
