import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildUserPrompt, extractJson, generateDraft, stripDashes, DRAFT_SYSTEM } from './forum-draft-gen.js';

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
});
