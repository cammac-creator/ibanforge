import { describe, it, expect } from 'vitest';
import { buildJourney, type JourneyStep } from './journey';
import de from './__fixtures__/validate-de.json';
import gb from './__fixtures__/validate-gb.json';
import ch from './__fixtures__/validate-ch.json';
import fr from './__fixtures__/validate-fr.json';

// The fixtures are the live /v1/demo payloads, saved verbatim on 2026-09-01.
// This suite is the honesty lock of the village: if the pipeline's response
// shape evolves, these tests must be re-recorded and the map updated — the
// world is never allowed to drift from what the API actually did.

const stations = (steps: JourneyStep[]) => steps.map((s) => s.station);
const at = (steps: JourneyStep[], station: string) =>
  steps.find((s) => s.station === station);

// Real invalid shape per src/lib/iban.ts: valid:false + a typed error code,
// and enrichResult never runs (no bban/bic/… blocks).
const invalid = { iban: 'DE89370400440532013001', valid: false, error: 'checksum_failed', cost_usdc: 0.005 };

describe('buildJourney — happy path (DE, national register)', () => {
  const steps = buildJourney(de as Record<string, unknown>);

  it('walks the full main road in pipeline order', () => {
    expect(stations(steps)).toEqual([
      'gate', 'scribe', 'cutter', 'library', 'registry',
      'court', 'classifier', 'border', 'forge', 'exit',
    ]);
  });

  it('reports the register truth at the registry house', () => {
    const reg = at(steps, 'registry')!;
    expect(reg.outcome).toBe('ok');
    expect(reg.params).toMatchObject({
      cc: 'DE',
      register: 'Deutsche Bundesbank Bankleitzahlendatei',
      bic: 'COBADEFFXXX',
    });
  });

  it('the court verdict carries status and authority', () => {
    const court = at(steps, 'court')!;
    expect(court.outcome).toBe('ok');
    expect(court.params).toMatchObject({ status: 'verified', authoritative: true });
  });

  it('the border reads the sepa block, not a guess', () => {
    expect(at(steps, 'border')!.params).toMatchObject({
      sepa: true,
      vopRequired: true,
      vopParticipant: true,
    });
  });

  it('the forge seals a valid ingot with the resolved BIC', () => {
    expect(at(steps, 'forge')!.outcome).toBe('ok');
    expect(at(steps, 'forge')!.params).toMatchObject({ valid: true, bic: 'COBADEFFXXX' });
  });
});

describe('buildJourney — GB (composite directory, modulus, PRA)', () => {
  const steps = buildJourney(gb as Record<string, unknown>);

  it('never visits a registry house when the BIC basis is not a national register', () => {
    expect(stations(steps)).not.toContain('registry');
  });

  it('runs the UK modulus arithmetic at the cutter, after the split', () => {
    const idx = stations(steps).indexOf('cutter');
    expect(steps[idx + 1]).toMatchObject({
      station: 'cutter',
      key: 'modulus',
      outcome: 'ok',
      params: { passed: true },
    });
  });

  it('adds the PRA authorisation reading at the court', () => {
    const pra = steps.filter((s) => s.station === 'court' && s.key === 'pra');
    expect(pra).toHaveLength(1);
    expect(pra[0].params).toMatchObject({ authorised: true });
  });
});

describe('buildJourney — CH (SIX clearing booth)', () => {
  const steps = buildJourney(ch as Record<string, unknown>);

  it('visits the SIX booth with the clearing facts', () => {
    const six = at(steps, 'six')!;
    expect(six.outcome).toBe('ok');
    expect(six.params).toMatchObject({ name: 'UBS Switzerland AG', sic: true });
  });

  it('still gets a court verdict backed by the SIX register', () => {
    expect(at(steps, 'court')!.params).toMatchObject({ status: 'verified', authoritative: true });
  });
});

describe('buildJourney — FR (plain composite path)', () => {
  const steps = buildJourney(fr as Record<string, unknown>);

  it('takes the simple road: no registry, no six, no modulus, no pra', () => {
    const ids = stations(steps);
    expect(ids).not.toContain('registry');
    expect(ids).not.toContain('six');
    expect(steps.some((s) => s.key === 'modulus')).toBe(false);
    expect(steps.some((s) => s.key === 'pra')).toBe(false);
  });
});

describe('buildJourney — invalid IBAN', () => {
  const steps = buildJourney(invalid);

  it('fails at the scribe and leaves — later stations never run', () => {
    expect(stations(steps)).toEqual(['gate', 'scribe', 'exit']);
    const scribe = at(steps, 'scribe')!;
    expect(scribe.outcome).toBe('fail');
    expect(scribe.params).toMatchObject({ reason: 'checksum_failed' });
    expect(at(steps, 'exit')!.outcome).toBe('fail');
  });
});

describe('buildJourney — contract', () => {
  it('is deterministic: same response, same film', () => {
    expect(buildJourney(de as Record<string, unknown>)).toEqual(
      buildJourney(de as Record<string, unknown>),
    );
  });

  it('shows the toll as free when the API charged nothing (relay key)', () => {
    const free = buildJourney({ ...(de as Record<string, unknown>), cost_usdc: 0 });
    expect(at(free, 'gate')!.params).toMatchObject({ paid: false });
    expect(at(buildJourney(de as Record<string, unknown>), 'gate')!.params)
      .toMatchObject({ paid: true, cost: 0.005 });
  });

  it('never throws on an empty or alien payload', () => {
    expect(() => buildJourney({})).not.toThrow();
    const steps = buildJourney({});
    expect(steps[0].station).toBe('gate');
    expect(steps[steps.length - 1].station).toBe('exit');
  });
});
