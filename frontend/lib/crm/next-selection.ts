/**
 * Which file the CRM opens after a mail has left, and the one rule that makes
 * it safe: it is the next row of the list AS THE OPERATOR SEES IT.
 *
 * `rows` is the table's own output — filtered, searched and sorted, handed up
 * by ContactTable through `onRowsChange`. Not the raw contact array: the
 * operator is working a queue ("À répondre", "Relances", a search), and
 * advancing into a contact that queue does not contain would take them out of
 * the run they are doing.
 *
 * Three answers are the same answer, `null`, and each is a real state rather
 * than a defensive branch:
 *  - nothing is open (`currentId` null), so there is no "next";
 *  - the file that was open is no longer in the list. That is not a corner
 *    case: sending a reply can drop the contact out of "À répondre" on the
 *    very refresh that follows the send, and `indexOf` then answers -1. `-1 + 1`
 *    is 0, so a naive read would jump to the TOP of the list — a row the
 *    operator has already done — which is worse than staying put;
 *  - it was the last row, and the run is finished.
 *
 * Pure and list-shaped rather than reaching into the contacts: the same
 * function answers for the table's ordering, for a search result and for the
 * ◀ ▶ walk in the drawer, and one answer is what keeps those three from
 * drifting apart.
 */
export function nextSelectionAfterSend(
  rows: readonly string[],
  currentId: string | null,
): string | null {
  if (!currentId) return null;
  const at = rows.indexOf(currentId);
  if (at < 0) return null;
  return rows[at + 1] ?? null;
}
