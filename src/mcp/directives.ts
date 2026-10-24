/**
 * The crib that tells a direction to the model from a description, on the
 * directory addresses (`/mcp/directory`, `/mcp/chatgpt`).
 *
 * Shared by `src/routes/mcp-descriptions.test.ts` (what the addresses describe:
 * `initialize`, `tools/list`, `resources/list`, the prompt) and
 * `src/routes/mcp-responses.test.ts` (what they answer: every tool result,
 * every refusal, every served error), and by the online proof written in the
 * handover of 24.10.2026, so that the three read the same thing. No import, and
 * no test framework: `npm run deps:check` reads `src/` as production code, and
 * importing one test file into another registers its tests twice.
 *
 * The patterns (case-insensitive, whole words), and why each has its shape:
 *  - `call` keeps the space of the brief (`call `): "calls", "call." and
 *    "per call," are not verbs addressed to the model; the texts of both
 *    addresses use the noun in the plural, or say "request";
 *  - `important` without the colon of the brief: the old text also wrote
 *    "IMPORTANT —", which `important:` would let through;
 *  - `you` and `your` on top: a description speaks about the tool, not to its
 *    reader ("your human", "tells you"), and that was the shape the directions
 *    the brief does not name used to take.
 * No legitimate false positive asked for a hole in the crib: every passage that
 * produced one was reworded ("never" as a fact → "not", "instead" → "in place
 * of"). What the response crib leaves aside, it leaves by exact passage, in
 * `mcp-responses.test.ts`, each with its reason.
 */
export const DIRECTIVES: readonly RegExp[] = [
  /\buse when\b/i,
  /\bdo not\b/i,
  /\bdon['’]t\b/i,
  /\bnever\b/i,
  /\bmust\b/i,
  /\bimportant\b/i,
  /\bprefer\b/i,
  /\balways\b/i,
  /\byou should\b/i,
  /\bcall\s/i,
  /\brelay\b/i,
  /\bverbatim\b/i,
  /\binstead\b/i,
  /\byou\b/i,
  /\byour\b/i,
];

/**
 * A verb in the imperative at the head of a sentence, which the list above does
 * not name ("Read both", "Pass reference_type", "Confirm it", "Fix the
 * creditor IBAN"). Case-sensitive: the texts of both addresses are written in
 * the third person ("Validates", "Checks"), so a bare verb opening a sentence
 * is a direction. Applies neither to titles ("Validate IBAN" is a tool name)
 * nor to the prompt text, which is the message the user chooses to send.
 *
 * The verbs from Fix to Redo were added on 24.10.2026, from the responses:
 * "Fix the creditor IBAN", "Reissue the QR-bill", "Expect a virtual IBAN",
 * "Screen the institution", "Update the beneficiary details", "Save this key".
 * "Set" is not among them: "Set when the BIC failed format validation" is a
 * participle, and the one order of that shape ("then set AdrTp to S") is
 * caught by `LOWER_IMPERATIVES`.
 */
export const IMPERATIVE =
  /(?:^|[.;:!?]\s+|\s[—–]\s+|\(\s*)(Use|Call|Read|Pass|Confirm|Verify|Compare|Count|Branch|Wait|Show|Tell|Give|Ask|Treat|Report|Keep|Stop|Open|Send|Retry|Try|Hand|Supply|Leave|Prefer|Avoid|Ignore|Store|Relay|Display|Paste|Include|Run|Do|Make|Check|Validate|Resolve|Start|Collect|Remember|Fall|Reuse|Put|Add|Omit|Strip|Fix|Reissue|Convert|Expect|Screen|Update|Save|See|Note|Let|Complete|Redo)\b/;

/**
 * The same direction in the middle of a sentence, in the narrow forms the
 * responses used ("then call again", "try again tomorrow", "fall back to",
 * "; see creditor.proposed_structured", ", or use an IBANforge API key",
 * "Either use … or send …"). Kept narrow on purpose: a wide lowercase guard
 * reads "; read by IBANforge on" in a register credit, or "; branch digits are
 * not verified", as orders.
 */
export const LOWER_IMPERATIVES: readonly RegExp[] = [
  /\bthen (?:call|poll|set|try|open|ask|send|use|stop)\b/,
  /\btry again\b/i,
  /\bfall back\b/i,
  /\bsee [a-z]+(?:[._][a-z]+)+/,
  /;\s+(?:try|see|use|wait|ask|tell|show|reuse|open|confirm|verify|treat|complete|fix|reissue|convert|update|screen|keep|stop)\b/,
  /,\s+or\s+(?:use|try|send|ask)\b/,
  // "Either use the creditor's QR-IBAN or send this payment without…"
  /\b(?:[Ee]ither|[Pp]lease|[Ss]imply|[Jj]ust)\s+(?:use|send|call|try|ask|tell|show|read|pass|open|confirm|verify|check|set)\b/,
];

/**
 * The second half of the commitment: "no hidden or encoded text". Invisible and
 * bidirectional characters (zero-width spaces, direction marks, isolates,
 * joiners, BOM) and control characters other than the line feed. The accented
 * letters of bank and register names (Crédit Mutuel, Národná banka) are not
 * targeted.
 */
export const HIDDEN =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0009\u000B-\u001F\u007F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/;

/**
 * What a text is: a description or a response text gets every guard; a title
 * (a tool name) and the prompt text (the user's own message) get the word list
 * and the hidden-character guard only.
 */
export type DirectiveTextKind = 'description' | 'response' | 'title' | 'prompt';

/** What the crib finds in one text, as readable labels. Empty when the text is clean. */
export function directiveHits(text: string, kind: DirectiveTextKind): string[] {
  const hits = DIRECTIVES.filter((re) => re.test(text)).map((re) => String(re));
  const hidden = text.match(HIDDEN);
  if (hidden) {
    hits.push(`caractère masqué U+${hidden[0].codePointAt(0)!.toString(16).padStart(4, '0')}`);
  }
  if (kind === 'description' || kind === 'response') {
    const m = text.match(IMPERATIVE);
    if (m) hits.push(`impératif « ${m[1]} »`);
    for (const re of LOWER_IMPERATIVES) {
      const l = text.match(re);
      if (l) hits.push(`impératif « ${l[0].trim()} »`);
    }
  }
  return hits;
}
