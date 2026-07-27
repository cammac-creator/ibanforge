/**
 * Names a generated draft must never write, per recipient domain.
 *
 * Some relationships come with a confidentiality clause: the mail may be sent
 * to them, but a name must not appear in it. That is a fact about the owner's
 * business, not about the product, so it does not belong in this repository at
 * all. It is read from one environment variable, and both halves of it, the
 * domain and the name, stay out of the source.
 *
 * The rules apply on the server, in the generate-draft proxy, for two reasons.
 * The browser would ship them to anyone who opens the dashboard, and a rule
 * kept in the client is a rule the client can be made to skip.
 */

/** One rule: mails to `domain` must never write `name`. */
export type RedactionRule = {
  /** Recipient domain, lowercased, no leading `@`. Subdomains match too. */
  domain: string;
  /** The word the draft must not contain, as it should be quoted to the model. */
  name: string;
};

/**
 * Read the rules off the raw environment value.
 *
 * Format, documented in `.env.local.example`: `domain=Name`, several of them
 * separated by `;` or by newlines. Whitespace around either half is dropped,
 * so a value can be broken over lines for readability.
 *
 * Deliberately forgiving. An unparsable entry is skipped rather than thrown on:
 * this runs on every generation, and a typo in one rule must not take the
 * whole feature down. The cost is that a malformed rule is silently inactive,
 * which is why the example file spells the format out.
 */
export function parseRedactionRules(raw: string | undefined | null): RedactionRule[] {
  if (!raw) return [];
  const rules: RedactionRule[] = [];
  for (const entry of raw.split(/[;\n]/)) {
    const sep = entry.indexOf('=');
    if (sep === -1) continue;
    // Lowercased and stripped of a leading `@` so that `@example.com=Acme`,
    // `Example.com=Acme` and `example.com=Acme` are one rule and not three.
    const domain = entry.slice(0, sep).trim().toLowerCase().replace(/^@+/, '');
    // Only the ends are trimmed: the name is quoted verbatim to the model, and
    // a name can hold spaces.
    const name = entry.slice(sep + 1).trim();
    if (!domain || !name) continue;
    rules.push({ domain, name });
  }
  return rules;
}

/**
 * Every domain a `to` field addresses, lowercased and deduplicated.
 *
 * Every one, not the one: a field holding two addresses has to be read as
 * both, or a rule is shaken off by putting the protected recipient anywhere
 * but last. Only this app calls the proxy today and it sends one address, but
 * that was equally true of the `context` shape guarded below, and the whole
 * point of moving this rule to the server is that it cannot be talked out of
 * firing.
 *
 * Over-matching is the safe direction here and under-matching is not, so the
 * scan is deliberately loose: it reads `Display Name <address>` and bare
 * addresses alike, and an `@` inside a quoted display name yields one more
 * candidate domain rather than one fewer. Anything that is not a string, or
 * holds no `@`, yields nothing, and every rule then misses.
 */
export function recipientDomains(to: unknown): string[] {
  if (typeof to !== 'string') return [];
  const found = to.toLowerCase().match(/@[a-z0-9.-]+/g);
  if (!found) return [];
  const domains = new Set<string>();
  for (const match of found) {
    // Trailing separators are not part of the domain: `a@example.com,` and
    // `a@example.com.` both address example.com.
    const domain = match.slice(1).replace(/[.-]+$/, '');
    if (domain) domains.add(domain);
  }
  return [...domains];
}

/**
 * The instruction lines this recipient calls for, in the order the rules were
 * configured, one line per rule at most. Empty when no rule applies, which is
 * the normal case.
 *
 * Matching is on the domain and its subdomains, so a rule on `example.com`
 * also covers `someone@mail.example.com`. It has to: the point is to catch the
 * relationship, and mail from one organisation arrives from more than one host.
 */
export function redactionInstructions(to: unknown, rules: RedactionRule[]): string[] {
  const domains = recipientDomains(to);
  if (domains.length === 0) return [];
  return rules
    .filter((r) => domains.some((d) => d === r.domain || d.endsWith(`.${r.domain}`)))
    .map((r) => `IMPORTANT: never mention "${r.name}" anywhere.`);
}

/**
 * What the proxy should do with the body it is about to forward.
 *
 * `refused` is the case where a rule applies but there is nowhere to put it:
 * the upstream generator reads its instructions from `context` and nothing
 * else, so a `context` that is neither absent nor a string leaves the rule
 * unattachable. Forwarding anyway would generate a mail with the
 * confidentiality rule dropped, silently, which is the one outcome worth a
 * failed request. No caller in this app can produce it; it exists so that the
 * rule cannot be shaken off by sending an odd body.
 */
export type RedactionOutcome =
  | { ok: true; body: unknown }
  | { ok: false; reason: 'unattachable_context' };

/**
 * The body to forward upstream, with the applicable instructions appended to
 * `context`.
 *
 * Appended last, where the same line sat when the client wrote it, and where
 * the upstream prompt gives the closing instructions the most weight.
 *
 * With the variable unset, or no rule matching, the body comes back untouched:
 * the object is returned by identity, not rebuilt, so nothing about the
 * request can differ from what the caller sent.
 */
export function applyRedactionRules(body: unknown, raw: string | undefined | null): RedactionOutcome {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: true, body };
  const record = body as Record<string, unknown>;
  const lines = redactionInstructions(record.to, parseRedactionRules(raw));
  if (lines.length === 0) return { ok: true, body };
  const block = lines.join('\n');
  const context = record.context;
  if (context === undefined || context === null || context === '') {
    return { ok: true, body: { ...record, context: block } };
  }
  if (typeof context !== 'string') return { ok: false, reason: 'unattachable_context' };
  return { ok: true, body: { ...record, context: `${context}\n${block}` } };
}
