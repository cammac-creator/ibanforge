import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { landing } from './landing.js';
import { PAYMENT_LINKS } from '../lib/payment-links.js';
import { ANONYMOUS_MONTHLY_LIMIT, FREE_TIER_MONTHLY_LIMIT } from '../lib/tiers.js';

const app = new Hono();
app.route('/', landing);

let res: Response;
let html: string;

beforeAll(async () => {
  res = await app.request('/');
  html = await res.text();
});

describe('Landing page', () => {
  it('returns 200 with HTML content-type', () => {
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('has Cache-Control header', () => {
    expect(res.headers.get('cache-control')).toContain('public');
  });

  it('has title with IBANforge', () => {
    expect(html).toMatch(/<title>.*IBANforge.*<\/title>/);
  });

  it('has meta description', () => {
    expect(html).toMatch(/<meta\s+name="description"\s+content="[^"]+"/);
  });

  it('has canonical link', () => {
    expect(html).toMatch(/<link\s+rel="canonical"\s+href="https:\/\/api\.ibanforge\.com"/);
  });

  it('has robots meta', () => {
    expect(html).toMatch(/<meta\s+name="robots"\s+content="index, follow"/);
  });

  it('has og:title', () => {
    expect(html).toMatch(/<meta\s+property="og:title"\s+content="[^"]+"/);
  });

  it('has og:image pointing to /og-image.png', () => {
    expect(html).toContain('og:image');
    expect(html).toContain('/og-image.png');
  });

  it('has twitter:card summary_large_image', () => {
    expect(html).toContain('twitter:card');
    expect(html).toContain('summary_large_image');
  });

  it('has WebAPI JSON-LD schema', () => {
    expect(html).toContain('"@type":"WebAPI"');
  });

  it('has FAQPage JSON-LD schema', () => {
    expect(html).toContain('"@type":"FAQPage"');
  });

  it('has hero with 121K BICs', () => {
    expect(html).toContain('121K');
  });

  it('has Try it demo with compliance tab', () => {
    expect(html).toContain('Compliance');
  });

  it('has features grid with MCP Native', () => {
    expect(html).toContain('MCP Native');
  });

  it('has pricing section with both paths', () => {
    // Les deux marches, depuis les constantes : la carte du palier gratuit
    // annonce le quota de la clé anonyme, et la page dit où mène la
    // réclamation. Un littéral ici serait une dixième autorité sur un plafond.
    expect(html).toContain(`${ANONYMOUS_MONTHLY_LIMIT} requests/month`);
    expect(html).toContain(`${FREE_TIER_MONTHLY_LIMIT} a month`);
    expect(html).toContain('$0.003');
  });

  it('ne demande plus une adresse pour rendre une clé', () => {
    // Le champ e-mail du formulaire a perdu `required` le 15/09/2026 : la page
    // annonce « no e-mail, no card » juste au-dessus, et un champ obligatoire
    // en dessous aurait été une contradiction sur une seule page.
    expect(html).not.toContain('name="email" placeholder="your@email.com" required');
    // Espaces normalisés : prettier coupe la carte de prix en plusieurs lignes,
    // et une promesse ne change pas de sens parce qu'un retour à la ligne la
    // traverse.
    expect(html.replace(/\s+/g, ' ')).toContain('no e-mail, no card');
  });

  it('has quick start with multiple languages', () => {
    expect(html).toContain('cURL');
    expect(html).toContain('JavaScript');
    expect(html).toContain('Python');
  });

  // Regression guard: the three buy buttons shipped literal
  // `href="STRIPE_PAYMENT_LINK_1K"` placeholders from 2026-05-12 to 2026-06-19,
  // so every card click 404'd for 38 days (311 hits in request_log). Now that
  // the URLs are interpolated from a shared module, assert they actually render
  // — an escaped or empty interpolation would rebuild the same dead end.
  it('renders the three live Stripe Payment Links on the buy buttons', () => {
    for (const url of Object.values(PAYMENT_LINKS)) {
      expect(html).toContain(`href="${url}"`);
    }
    expect(html).not.toContain('STRIPE_PAYMENT_LINK_1K"');
  });
});
