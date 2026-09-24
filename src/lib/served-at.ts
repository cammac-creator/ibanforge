/**
 * The instant a response left the server, as ISO 8601 in UTC, to the second.
 *
 * Why a field and not only the `Date` header: on 24/09/2026 ChatGPT quoted a
 * copy of GET /health as "the current answer" (version 1.3.3, served in July,
 * two months earlier). The copy came from an index or a reader's cache, and the
 * body carried nothing that dated it: an uptime and the date of the data, never
 * the date of the answer. HTTP headers do not survive being copied into an
 * index or pasted into a conversation; a field in the body does. A reader that
 * quotes a stale copy now quotes its date with it.
 *
 * Seconds, not milliseconds: the same shape as `resets_at` (src/lib/trial.ts),
 * and nothing that reads this field needs more.
 *
 * Only on answers built per request (/health, /v1/demo). Never on a text that
 * is memoised for the life of the process, such as /llms.txt: there it would
 * date the boot, not the answer, which is the opposite of its purpose.
 */
export function servedAt(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
