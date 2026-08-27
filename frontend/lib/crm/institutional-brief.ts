import { threadTail } from './thread-tail';
import type { Contact, Message } from './types';

/**
 * The direction of the last real message in a thread, or null for no thread.
 *
 * Drafts are skipped. `ContactBase.messages` is documented as correspondence
 * only and never containing drafts, so today this filter removes nothing; it
 * stays because the whole instruction below hangs on this one letter, and a
 * brief that told the writer to answer its own unsent draft would be wrong in a
 * way nobody would read in the output.
 */
function lastDirection(messages: Message[]): 'in' | 'out' | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const d = messages[i].direction;
    if (d === 'in' || d === 'out') return d;
  }
  return null;
}

/**
 * What the generator is told about a written exchange with an institution.
 *
 * Three situations under one roof, and the difference is one line of
 * instruction rather than three code paths: when they wrote last the thread IS
 * the brief, exactly as it is for a customer's answer; when OUR letter is last
 * the due gesture is a follow-up; when there is no thread at all this is the
 * first written request and the file line is all there is to write from.
 *
 * The middle case is not a corner. Institutions reach this sheet from
 * "Relances" as much as from "À répondre" — a permission letter that got no
 * answer in three weeks is precisely the thread the operator opens — and the
 * brief used to tell the writer "they wrote last and are waiting on you" the
 * moment a thread existed, which for that state is the opposite of the truth.
 * The writer would then answer questions nobody had asked.
 *
 * The register is stated explicitly because nothing else in this app would set
 * it. Every other brief in the CRM describes a commercial conversation, and the
 * writer upstream is the same writer: without this it would open a letter to a
 * financial supervisor the way it opens a mail to a lead.
 *
 * `dossier` is the ground truth. It is the operator's own one-line statement of
 * what we are asking that institution for, and it is the only thing in here
 * that cannot be derived from anything else.
 *
 * Lives in lib/ rather than beside the sheet that calls it so it can be pinned
 * by tests: the three instructions below are the whole behaviour, and vitest
 * collects `lib/**` and `app/**` only.
 */
export function institutionalBrief(c: Extract<Contact, { kind: 'institution' }>): string {
  const i = c.institution;
  const last = lastDirection(c.messages);
  return [
    `Institution: ${i.org}`,
    `Type of institution: ${i.category}`,
    i.country ? `Country: ${i.country}` : '',
    i.role ? `Desk or role addressed: ${i.role}` : '',
    i.dossier ? `What we are asking them for (our file with them): ${i.dossier}` : '',
    'This is written correspondence with an institution, not a commercial mail. Formal register, plain sentences, no marketing, no product pitch, no call to action, no unsubscribe line. Say what is being asked, on what basis, and what answer is expected.',
    last === 'in'
      ? 'They wrote last and are waiting on you. Answer every question their mail asks, each one explicitly, before anything else. Keep the file reference and any case number they used.'
      : last === 'out'
        ? 'Our letter is the last message in the thread. Write the due follow-up: brief, courteous, reference the pending request without recapping it, one precise ask.'
        : 'There is no correspondence yet: this is the FIRST written request to this institution. State plainly who IBANforge is, exactly what is being requested, why, and ask for a written answer.',
    last !== null ? `Thread so far:\n${threadTail(c.messages)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
