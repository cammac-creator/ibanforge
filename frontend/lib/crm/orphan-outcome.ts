/**
 * What happened to a mail that left the « Courrier à rattacher » queue, in the
 * operator's words.
 *
 * Until the sorting robot learned to file mail on its own, a resolved row was
 * either attached to an address or dismissed, and « rattaché à … » read well
 * for everything that carried a value. The robot records its decisions in the
 * same field as a label followed by the sender's domain in parentheses
 * (« démarchage (alpha.example.net) »), and « rattaché à démarchage (…) »
 * says the opposite of what happened: nothing was attached, the mail was
 * filed. This names the three outcomes apart, and says when the robot decided,
 * so a wrong filing is recognisable at a glance in the list of recent ones.
 */

/** The labels the sorting robot writes when it files a mail without attaching it. */
export const ROBOT_FILING_LABELS = [
  'notification',
  'démarchage',
  'envoi en masse',
  'déjà classé',
] as const;

export type RobotFilingLabel = (typeof ROBOT_FILING_LABELS)[number];

const ROBOT_FILING = new RegExp(`^(${ROBOT_FILING_LABELS.join('|')}) \\(`, 'i');

/** The robot's label when `resolvedAs` is one of its filings, otherwise null. */
export function robotFilingLabel(resolvedAs: string | null): RobotFilingLabel | null {
  const m = ROBOT_FILING.exec((resolvedAs ?? '').trim());
  return m ? (m[1]!.toLowerCase() as RobotFilingLabel) : null;
}

const ROBOT_FILING_FR: Record<RobotFilingLabel, string> = {
  notification: 'avis automatique',
  démarchage: 'démarchage',
  'envoi en masse': 'envoi en masse',
  'déjà classé': 'expéditeur déjà classé',
};

/** One short French phrase for the outcome of a resolved row. */
export function orphanOutcome(row: { sender: string; resolved_as: string | null }): string {
  const value = (row.resolved_as ?? '').trim();
  if (!value) return 'classé sans rattachement';
  const label = robotFilingLabel(value);
  if (label) return `rangé par l’automate : ${ROBOT_FILING_FR[label]}`;
  if (value.toLowerCase() === row.sender.trim().toLowerCase())
    return 'enregistré comme correspondant';
  return `rattaché à ${value}`;
}
