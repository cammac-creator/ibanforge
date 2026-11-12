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
 * filed. This names the four outcomes apart (dismissed by hand, filed by the
 * robot, registered as a correspondent, attached to another file), so a wrong
 * filing by the robot is recognisable at a glance in the list of recent ones.
 *
 * What it cannot tell: an attachment the robot made (a colleague joining the
 * file of their company) is recorded as the bare address, exactly like one made
 * by hand, and reads « rattaché à … » in both cases. The value is free text on
 * the API side, so the test is the label followed by an opening parenthesis and
 * nothing more: a hand-typed value shaped that way would read as a filing.
 */

/** The labels the sorting robot writes when it files a mail without attaching it. */
export const ROBOT_FILING_LABELS = [
  'notification',
  'démarchage',
  'envoi en masse',
  'déjà classé',
] as const;

export type RobotFilingLabel = (typeof ROBOT_FILING_LABELS)[number];

// Labels are escaped, so one that ever carries a regex character stays literal.
const ROBOT_FILING = new RegExp(
  `^(${ROBOT_FILING_LABELS.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}) \\(`,
  'i',
);

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
