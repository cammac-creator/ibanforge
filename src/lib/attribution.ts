import type { Context } from 'hono';
import type { Attribution, HonoEnv } from '../types.js';

/**
 * "Powered by IBANforge" on the free tier.
 *
 * The market study of 02/09/2026 kept one growth lever the free tier had never
 * used: the credit Mapbox, Unsplash and IPinfo ask of their free users. A
 * result shown to people (a page, a form, a document) names where it came
 * from and links there; a result that stays inside a backend owes nothing,
 * because nobody sees it. Paid plans never carry it.
 *
 * The block is DATA, not a header: an integrator reads the response body, and
 * a field that says what to display and where to link is what actually gets
 * displayed. The terms (§2, free tier) state the obligation; this states it
 * on every response so that no one has to read the terms to learn it.
 */
export const ATTRIBUTION: Attribution = {
  required: true,
  text: 'Powered by IBANforge',
  url: 'https://ibanforge.com/?utm_source=attribution',
  note: 'Free tier: when these results are shown to people (a page, a screen, a document), display this credit with the link. Backend-only use owes nothing. Paid plans carry no attribution.',
};

/** Adds the attribution block to a paid-endpoint response body when the request was served on the free tier. */
export function attachAttribution<T extends object>(
  c: Context<HonoEnv>,
  body: T,
): T | (T & { attribution: Attribution }) {
  return c.get('freeTier') ? { ...body, attribution: ATTRIBUTION } : body;
}
