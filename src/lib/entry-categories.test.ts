import { describe, expect, it } from 'vitest';
import { aiAssistantOf, entryPageCategory, entryReferrerCategory } from './entry-categories.js';

describe('l’IA d’une arrivée, sur les champs déjà enregistrés', () => {
  it.each([
    ['chatgpt.com', null, 'chatgpt'],
    ['chat.openai.com', null, 'chatgpt'],
    ['www.perplexity.ai', null, 'perplexity'],
    ['GEMINI.GOOGLE.COM', null, 'gemini'],
    ['copilot.microsoft.com', null, 'copilot'],
    ['claude.ai', null, 'claude'],
    [null, 'chatgpt.com', 'chatgpt'],
    ['', 'ChatGPT.com', 'chatgpt'],
  ])('%s, étiquette %s : %s', (referrer, utm, expected) => {
    expect(aiAssistantOf(referrer, utm)).toBe(expected);
  });

  it.each([
    [null, null],
    ['', ''],
    // Un sosie reste un autre site : la correspondance est exacte.
    ['chatgpt.com.alpha.example.net', null],
    ['alpha.chatgpt.com', null],
    ['google.com', null],
    // Un autre site nommé par le référent n'est pas repris par l'étiquette.
    ['alpha.example.net', 'chatgpt.com'],
    // Une étiquette qui n'est pas celle de ChatGPT ne devine rien.
    [null, 'perplexity'],
    [null, 'newsletter'],
    // Une valeur mal formée n'est pas une provenance.
    ['https://chatgpt.com/', null],
  ])('%s, étiquette %s : aucune IA', (referrer, utm) => {
    expect(aiAssistantOf(referrer, utm)).toBeNull();
  });
});

describe('catégories d’arrivée sans identifiant libre', () => {
  it.each([
    [null, 'unknown'],
    ['', 'unknown'],
    ['https://google.com/search?q=test', 'unknown'],
    ['chatgpt.com', 'ai_assistant'],
    ['chat.openai.com', 'ai_assistant'],
    ['www.perplexity.ai', 'ai_assistant'],
    ['gemini.google.com', 'ai_assistant'],
    ['copilot.microsoft.com', 'ai_assistant'],
    ['claude.ai', 'ai_assistant'],
    ['chatgpt.com.alpha.example.net', 'external'],
    ['WWW.GOOGLE.CH', 'search'],
    ['www.bing.com', 'search'],
    ['duckduckgo.com', 'search'],
    ['google.com.alpha.example.net', 'external'],
    ['github.com', 'developer_platform'],
    ['alpha.example.net', 'external'],
    ['ibanforge.com', 'internal'],
    ['api.ibanforge.com', 'internal'],
    ['ibanforge.com.alpha.example.net', 'external'],
  ])('classe le référent %s en %s', (value, expected) => {
    expect(entryReferrerCategory(value)).toBe(expected);
  });

  it.each([
    [null, 'unknown'],
    ['', 'unknown'],
    ['/audit?email=alpha', 'unknown'],
    ['/fr/blz/37040044', 'bank_lookup'],
    ['/de/iban-welche-bank', 'bank_lookup'],
    ['/en/iban/DE', 'bank_lookup'],
    ['/it/12345', 'bank_lookup'],
    ['/fr/tools/generator', 'tool'],
    ['/playground', 'tool'],
    ['/sheets', 'tool'],
    ['/fr/docs/onboarding', 'docs'],
    ['/de/blog/article', 'blog'],
    ['/vendors', 'vendors'],
    ['/fr/audit', 'audit'],
    ['/en/pricing', 'pricing'],
    ['/pricing-extra', 'other'],
    ['/france/audit', 'other'],
    ['/', 'other'],
    ['/fr', 'other'],
  ])('classe la page %s en %s', (value, expected) => {
    expect(entryPageCategory(value)).toBe(expected);
  });
});
