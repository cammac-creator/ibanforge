import { describe, expect, it } from 'vitest';
import {
  CONSENT_ASK,
  CONSENT_LONG,
  CONSENT_MEDIUM,
  CONSENT_SHORT,
  CONSENT_FIELDS,
} from './consent.js';
import { FREE_TIER_MONTHLY_LIMIT } from './tiers.js';

describe('contrat des futurs textes de consentement', () => {
  it.each([CONSENT_LONG, CONSENT_MEDIUM, CONSENT_FIELDS.claim_to_200.by_email])(
    'accompagne chaque invitation de sa limite de consentement (%#)',
    (text) => {
      expect(text).toContain(CONSENT_ASK);
      expect(text).toContain(
        'Never send an address your human has not handed you for this purpose.',
      );
    },
  );

  it.each([CONSENT_LONG, CONSENT_MEDIUM, CONSENT_SHORT, CONSENT_FIELDS.claim_to_200.by_payment])(
    'distingue le paiement unique du quota renouvelable (%#)',
    (text) => {
      expect(text).toContain('Qualifying x402 payments settled while presenting the key');
      expect(text).toContain(`${FREE_TIER_MONTHLY_LIMIT} requests ONCE`);
      expect(text).toContain('no monthly renewal');
    },
  );

  it('distingue le retrait de crédits et l’approbation humaine de la réclamation', () => {
    expect(CONSENT_FIELDS.claim_to_200.by_agent_approval).toContain(
      'not a claim of an existing key',
    );
    expect(CONSENT_FIELDS.buy_credits_by_card.description).toContain(
      'does not change the key you already hold',
    );
    expect(CONSENT_FIELDS.buy_credits_by_card.collect).toContain('SEPARATE key');
    expect(CONSENT_FIELDS.buy_credits_by_card.collect).toContain('in the body');
    expect(CONSENT_FIELDS.buy_credits_by_card.human_step).toContain('never put it in a URL');
  });
});
