import { describe, expect, it } from 'vitest';
import { orphanOutcome, robotFilingLabel, ROBOT_FILING_LABELS } from './orphan-outcome';

const row = (resolved_as: string | null, sender = 'adam@alpha.example.net') => ({
  sender,
  resolved_as,
});

describe('orphanOutcome', () => {
  it('says a dismissed row was filed without attachment', () => {
    expect(orphanOutcome(row(null))).toBe('classé sans rattachement');
    expect(orphanOutcome(row('  '))).toBe('classé sans rattachement');
  });

  it('says the robot filed it, and why, instead of « rattaché à démarchage »', () => {
    expect(orphanOutcome(row('démarchage (alpha.example.net)'))).toBe(
      'rangé par l’automate : démarchage',
    );
    expect(orphanOutcome(row('envoi en masse (alpha.example.net)'))).toBe(
      'rangé par l’automate : envoi en masse',
    );
    expect(orphanOutcome(row('déjà classé (alpha.example.net)'))).toBe(
      'rangé par l’automate : expéditeur déjà classé',
    );
    expect(orphanOutcome(row('notification (alpha.example.net)'))).toBe(
      'rangé par l’automate : avis automatique',
    );
  });

  it('keeps the two attachments apart: a correspondent of its own, or another file', () => {
    expect(orphanOutcome(row('Adam@Alpha.example.net'))).toBe('enregistré comme correspondant');
    expect(orphanOutcome(row('acme@example.com'))).toBe('rattaché à acme@example.com');
  });

  it('reads the label whatever its case', () => {
    expect(robotFilingLabel('Démarchage (alpha.example.net)')).toBe('démarchage');
    expect(robotFilingLabel('ENVOI EN MASSE (alpha.example.net)')).toBe('envoi en masse');
    expect(orphanOutcome(row('Déjà classé (alpha.example.net)'))).toBe(
      'rangé par l’automate : expéditeur déjà classé',
    );
  });

  it('reads an attachment made by the robot like one made by hand', () => {
    // The robot records a colleague joining a file as the bare address of that file.
    expect(orphanOutcome(row('acme@example.com', 'colleague@example.com'))).toBe(
      'rattaché à acme@example.com',
    );
  });

  it('does not read an address, or a free text without the label shape, as a robot filing', () => {
    expect(robotFilingLabel('démarchage')).toBeNull();
    expect(robotFilingLabel('le dossier de la Société Alpha (suite)')).toBeNull();
    expect(robotFilingLabel('notification@alpha.example.net')).toBeNull();
    expect(orphanOutcome(row('le dossier de la Société Alpha'))).toBe(
      'rattaché à le dossier de la Société Alpha',
    );
  });

  it('knows every label the robot writes', () => {
    for (const label of ROBOT_FILING_LABELS) {
      expect(robotFilingLabel(`${label} (alpha.example.net)`)).toBe(label);
    }
  });
});
