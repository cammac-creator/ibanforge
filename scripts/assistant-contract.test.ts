import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { FREE_TIER_MONTHLY_LIMIT } from '../src/lib/tiers.js';

const root = resolve(import.meta.dirname, '..');
const skill = readFileSync(resolve(root, 'skills/validate-iban-before-payment/SKILL.md'), 'utf8');
const context = JSON.parse(readFileSync(resolve(root, 'context7.json'), 'utf8')) as {
  rules: string[];
};

describe('le contrat publié pour les assistants suit le serveur', () => {
  it.each([
    ['SKILL.md', skill],
    ['context7.json', context.rules.join('\n')],
  ])('%s annonce le quota mensuel réel de la clé réclamée', (_, text) => {
    const quotas = [...text.matchAll(/(\d+) requests a month/g)].map((m) => Number(m[1]));
    expect(quotas.length).toBeGreaterThan(0);
    expect(quotas.every((quota) => quota === FREE_TIER_MONTHLY_LIMIT)).toBe(true);
  });

  it('documente exactement les raisons de 402 de PaywallCause', () => {
    // Lire le type réel évite une seconde liste qui pourrait vieillir avec la documentation.
    const path = resolve(root, 'src/types.ts');
    const file = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const declaration = file.statements.find(
      (s): s is ts.InterfaceDeclaration =>
        ts.isInterfaceDeclaration(s) && s.name.text === 'PaywallCause',
    );
    const reason = declaration?.members.find(
      (m): m is ts.PropertySignature =>
        ts.isPropertySignature(m) && m.name.getText(file) === 'reason',
    );
    expect(reason?.type && ts.isUnionTypeNode(reason.type)).toBe(true);
    const types = (reason!.type as ts.UnionTypeNode).types;
    const expected = types.map((t) => {
      expect(ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)).toBe(true);
      return ((t as ts.LiteralTypeNode).literal as ts.StringLiteral).text;
    });
    const row = skill.split('\n').find((line) => line.startsWith('| `402` |'))!;
    const actual = [...row.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]);
    expect(actual.sort()).toEqual(expected.sort());
  });

  it('propose la récupération de la même clé révoquée avant une nouvelle clé', () => {
    const text = skill.slice(skill.indexOf('`key_revoked_burst`'));
    expect(text.indexOf('POST /v1/keys/claim')).toBeGreaterThan(0);
    expect(text.indexOf('POST /v1/keys/claim')).toBeLessThan(
      text.indexOf('POST /v1/keys/generate'),
    );
    expect(text).toContain('even if it never served a call');
  });
});
