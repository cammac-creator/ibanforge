/**
 * Reading an answer from the three CRM write endpoints.
 *
 * These rules live here, pure and tested, rather than inline in the composer
 * and the draft card, because they are the part that is easy to get wrong and
 * impossible to see once it is wrong: every one of them decides whether the
 * operator is told a thing happened.
 *
 * The rule that motivates the module: **HTTP 200 is not proof of a change.**
 *   - `POST /v1/admin/email-messages` answers `{ upserted: n }` and skips any
 *     row whose address has no '@', so a malformed address stores nothing and
 *     still answers 200.
 *   - `POST /v1/admin/email-messages/delete` answers `{ deleted: n }` and only
 *     ever deletes a row whose direction is 'draft', so a stale or wrong id
 *     deletes nothing and still answers 200.
 *   - `/api/crm/draft-message` wraps the first of those in `{ saved: true, … }`
 *     whenever the HTTP call itself worked, so `saved` is not evidence either.
 *     `upserted` is.
 *
 * The same defect already bit the prospect status control, which now reads
 * `updated` for exactly this reason (components/crm/prospect-status.tsx).
 */

/** What a fetch came back with, once its body has been read at most once. */
export interface ApiAnswer {
  /** HTTP-level success, i.e. `Response.ok`. */
  ok: boolean;
  /** Parsed JSON body, or null when there was none or it did not parse. */
  body: unknown;
}

/** The narrowest shape a Response needs for readAnswer, so tests need no DOM. */
export interface ReadableResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

/** Read the body once, tolerating an empty or non-JSON one. */
export async function readAnswer(r: ReadableResponse): Promise<ApiAnswer> {
  const body: unknown = await r.json().catch(() => null);
  return { ok: r.ok, body };
}

function field(body: unknown, name: string): unknown {
  if (!body || typeof body !== 'object') return undefined;
  return (body as Record<string, unknown>)[name];
}

/**
 * The reason an endpoint gave for refusing, whichever field it used.
 *
 * Three shapes are in play and the order matters. FastAPI on the VPS raises
 * `HTTPException(404, "no active account …")`, which serialises as `detail`,
 * and both Next proxies forward the upstream body verbatim. Reading only
 * `message`/`error` would flatten that case, the one where the mailbox is not
 * configured, into a generic failure and leave the operator with nothing to
 * act on. `message` beats `error` because the routes that set both put the
 * sentence in `message` and a slug in `error`.
 */
export function reasonOf(a: ApiAnswer): string | null {
  for (const name of ['detail', 'message', 'error']) {
    const v = field(a.body, name);
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/**
 * True only when the endpoint reports it changed at least one row.
 *
 * Strict on purpose, including when the counter is missing: claiming a save
 * that did not happen loses text the operator wrote, whereas claiming a
 * failure that did happen costs one idempotent retry. A missing counter means
 * the upstream body did not parse, which is not a success either.
 */
export function changedRows(a: ApiAnswer, name: 'upserted' | 'deleted'): boolean {
  if (!a.ok) return false;
  const n = field(a.body, name);
  return typeof n === 'number' && n >= 1;
}

/**
 * True only when the send endpoint confirms with `sent: true`.
 *
 * `/api/crm/send` gates its immediate `recordSent()` on that same flag, so a
 * 200 without it means the mail is not in the timeline either. Treating it as
 * a success would hide the mail from the only place the operator looks.
 */
export function confirmedSent(a: ApiAnswer): boolean {
  return a.ok && field(a.body, 'sent') === true;
}

/**
 * Name the action that failed, then quote what the endpoint said, as one
 * sentence that ends cleanly.
 *
 * Showing the upstream reason alone leaves the operator with a bare slug, or
 * an English sentence, and no clue which button produced it. Dropping it loses
 * the only actionable part, such as which mailbox is not configured. The
 * trailing period is trimmed off the reason so the caller can always append
 * another sentence after this one.
 */
export function withReason(what: string, reason: string | null): string {
  if (!reason) return `${what}.`;
  return `${what} : ${reason.replace(/[.\s]+$/, '')}.`;
}

/** A generation that can actually be put in the composer. */
export interface GeneratedDraft {
  subject: string;
  emailEn: string;
  translationFr: string | null;
}

/**
 * The generated draft, or null when the answer does not carry one.
 *
 * Validated rather than trusted: the proxy answers `{ error:
 * 'bad_upstream_response' }` at the upstream's own status, so a 200 whose body
 * did not parse would otherwise feed `undefined` into a controlled input and
 * turn it uncontrolled mid-session. An empty body is refused too: there is
 * nothing to review in it.
 */
export function generatedDraft(a: ApiAnswer): GeneratedDraft | null {
  if (!a.ok) return null;
  const emailEn = field(a.body, 'email_en');
  if (typeof emailEn !== 'string' || !emailEn.trim()) return null;
  const subject = field(a.body, 'subject');
  const fr = field(a.body, 'translation_fr');
  return {
    subject: typeof subject === 'string' ? subject : '',
    emailEn,
    translationFr: typeof fr === 'string' && fr.trim() ? fr : null,
  };
}

/**
 * One proposed angle for a follow-up, as the composer offers it.
 *
 * `key` is deliberately absent. The VPS builds it with `str(a.get("key") or
 * "")[:40]`, so it is guaranteed neither non-empty nor unique: two angles can
 * both carry the empty string, and selecting on it would apply the first when
 * the operator clicked the second. Selection is by position in the array.
 */
export interface ProposedAngle {
  /** Shown as the choice. At most 60 characters, em dashes scrubbed upstream. */
  title: string;
  /** The one line under it. At most 200 characters, scrubbed the same way. */
  hint: string;
  /**
   * The way out of the conversation, which the VPS guarantees is always among
   * the angles: it appends one itself when the model omits it. This is the only
   * thing `key` is read for, and the only reason it is read at all.
   */
  isExit: boolean;
}

/**
 * The angles that can actually be put in front of the operator, or null.
 *
 * Validated rather than trusted, for the same reason as generatedDraft above:
 * the proxy answers `{ error: 'bad_upstream_response' }` at the upstream's own
 * status, so a 200 whose body did not parse would otherwise put `undefined` in
 * a button. An angle with no title is dropped, because a button with no label
 * is a button nobody can choose between.
 *
 * Null and an empty array mean the same thing to the caller, "no choice to
 * offer", and the caller must have one branch for both. The upstream contract
 * is two or three angles and a 502 below that, so a short list here is already
 * an upstream that broke its own promise; the composer's answer is the same in
 * every case, which is to let the mail be written without an angle.
 */
export function proposedAngles(a: ApiAnswer): ProposedAngle[] | null {
  if (!a.ok) return null;
  const raw = field(a.body, 'angles');
  if (!Array.isArray(raw)) return null;
  const out: ProposedAngle[] = [];
  for (const entry of raw) {
    const title = field(entry, 'title');
    if (typeof title !== 'string' || !title.trim()) continue;
    const hint = field(entry, 'hint');
    out.push({
      title: title.trim(),
      hint: typeof hint === 'string' ? hint.trim() : '',
      isExit: field(entry, 'key') === 'graceful_exit',
    });
  }
  return out;
}
