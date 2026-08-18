import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildUserPrompt,
  buildVerifiedFacts,
  extractJson,
  generateDraft,
  parseMarkedOutput,
  stripDashes,
  DRAFT_SYSTEM,
} from './forum-draft-gen.js';

describe('buildVerifiedFacts — les données réelles injectées dans le brouillon', () => {
  it('résout un IBAN valide contre la vraie base (BIC, schémas SEPA)', () => {
    const out = buildVerifiedFacts('My IBAN DE89370400440532013000 fails in your lib');
    expect(out).toContain('VERIFIED LIVE DATA');
    expect(out).toContain('DE89370400440532013000: valid');
    expect(out).toContain('COBADEFF');
  });
  it('signale un IBAN structurellement invalide', () => {
    expect(buildVerifiedFacts('check DE00000000000000000099 please')).toContain('INVALID');
  });
  it('résout un BIC nu contre le registre', () => {
    const out = buildVerifiedFacts('No data for bic OROACY2LXXX');
    expect(out).toContain('OROACY2LXXX: found in our register');
    expect(out).toContain('ORO PAY');
  });
  it('rend une chaîne vide quand le fil ne cite ni IBAN ni BIC', () => {
    expect(buildVerifiedFacts('how do I validate bank accounts in general?')).toBe('');
  });
});

describe('parseMarkedOutput — le format qui survit au multiligne', () => {
  it('extrait les trois sections (réponse, traduction FR, résumé)', () => {
    const out = parseMarkedOutput(
      '===DRAFT===\nEnglish reply.\n\n1. item\n===DRAFT_FR===\nRéponse en français.\n\n1. élément\n===SUMMARY_FR===\nLe fil demande X.\n===END===',
    );
    expect(out?.draft).toContain('English reply.');
    expect(out?.draftFr).toContain('Réponse en français.');
    expect(out?.summaryFr).toBe('Le fil demande X.');
  });
  it('accepte l’ancien format à deux sections (draftFr vide, comblé par la traduction)', () => {
    const out = parseMarkedOutput(
      '===DRAFT===\nFirst paragraph.\n\n1. a list item\n2. another\n\nLast line.\n===SUMMARY_FR===\nLe fil demande X. On répond Y.\n===END===',
    );
    expect(out?.draft).toContain('1. a list item');
    expect(out?.draft.endsWith('Last line.')).toBe(true);
    expect(out?.draftFr).toBe('');
    expect(out?.summaryFr).toBe('Le fil demande X. On répond Y.');
  });
  it('tolère l’absence de ===END=== (sortie coupée après le résumé)', () => {
    const out = parseMarkedOutput('===DRAFT===\ntext\n===SUMMARY_FR===\nrésumé');
    expect(out).toEqual({ draft: 'text', draftFr: '', summaryFr: 'résumé' });
  });
  it('rend null si une section manque ou est vide', () => {
    expect(parseMarkedOutput('===DRAFT===\nonly draft')).toBeNull();
    expect(parseMarkedOutput('===DRAFT===\n===SUMMARY_FR===\nrésumé')).toBeNull();
    expect(parseMarkedOutput('plain text')).toBeNull();
  });
});

describe('extractJson — tolère le bavardage autour du JSON', () => {
  it('extrait un objet propre', () => {
    expect(extractJson('{"draft":"a","summary_fr":"b"}')).toEqual({ draft: 'a', summary_fr: 'b' });
  });
  it('ignore un préambule et un épilogue', () => {
    const out = extractJson('Voici la réponse:\n{"draft":"x","summary_fr":"y"}\nFin.');
    expect(out).toEqual({ draft: 'x', summary_fr: 'y' });
  });
  it('ne se fait pas piéger par des accolades dans les chaînes', () => {
    const payload = '{"draft":"use {curly} braces and \\"quotes\\"","summary_fr":"ok"}';
    expect(extractJson(payload)?.summary_fr).toBe('ok');
  });
  it('rend null sur du texte sans JSON ou du JSON cassé', () => {
    expect(extractJson('no json here')).toBeNull();
    expect(extractJson('{"draft": broken')).toBeNull();
  });
});

describe('stripDashes — le filet de sécurité typographique', () => {
  it('remplace tirets cadratins et demi-cadratins par des virgules', () => {
    expect(stripDashes('a — b – c')).toBe('a, b, c');
  });
  it('laisse les traits d’union simples intacts', () => {
    expect(stripDashes('QR-IID and BC-Nummer')).toBe('QR-IID and BC-Nummer');
  });
});

describe('buildUserPrompt — le brief transmis au générateur', () => {
  it('inclut plateforme, langue, titre, extrait et notes', () => {
    const p = buildUserPrompt({
      title: 'Find BIC from IBAN',
      excerpt: 'need runtime data',
      url: 'https://x',
      lang: 'de',
      source: 'github',
      notes: 'no product mention',
    });
    expect(p).toContain('lang: de');
    expect(p).toContain('Platform: github');
    expect(p).toContain('Operator notes');
    expect(p).toContain('no product mention');
  });
  it('reste utilisable sans extrait ni notes', () => {
    const p = buildUserPrompt({ title: 'T', excerpt: '', url: '', lang: 'en', source: 'hn', notes: '' });
    expect(p).toContain('judge from the title');
    expect(p).not.toContain('Operator notes');
  });
});

describe('generateDraft — comportement sans clé', () => {
  const original = { ...process.env };
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    process.env = { ...original };
  });
  it('rend null (génération sautée) quand ANTHROPIC_API_KEY est absente', async () => {
    const out = await generateDraft({ title: 'T', excerpt: '', url: '', lang: 'en', source: 'github', notes: '' });
    expect(out).toBeNull();
  });
});

describe('DRAFT_SYSTEM — la doctrine tient ses invariants', () => {
  it('interdit les tirets cadratins et impose la divulgation et les alternatives', () => {
    expect(DRAFT_SYSTEM).toContain('NEVER use em dashes');
    expect(DRAFT_SYSTEM).toContain('disclosure: I built ibanforge.com');
    expect(DRAFT_SYSTEM).toContain('honest alternative');
    expect(DRAFT_SYSTEM).toContain('200 requests/month');
  });
  it('demande le format à marqueurs, pas du JSON', () => {
    expect(DRAFT_SYSTEM).toContain('===DRAFT===');
    expect(DRAFT_SYSTEM).toContain('===SUMMARY_FR===');
  });
});
