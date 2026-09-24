/**
 * Where a key was born: the ONE place that names an acquisition origin.
 *
 * ## Why this file exists
 *
 * `api_keys.source` has held the acquisition channel since 2026-08-06, and it
 * was written by exactly one door — the browser dialog, and only when the
 * visitor happened to arrive on a `?src=` URL. Every other door (the device
 * grant seen from an MCP client, the Stripe rails, an administrative mint, a
 * plain `curl` on the public route) wrote NULL. The consequence is not a
 * missing statistic: a channel with no origin cannot be compared with one that
 * has it, so no door could be judged against another, and nothing about a key
 * born yesterday tells you which door it came through.
 *
 * An origin is not recoverable afterwards. Nothing else in the row carries it,
 * and guessing it from the tier or the e-mail domain would invent a fact. So
 * every mint path writes one, at the moment of the mint, and it is never empty.
 *
 * ## The two kinds of value, and why the distinction is load-bearing
 *
 * A **tag** is carried by an outbound link WE control (`?src=…` in the npm
 * README, the n8n node, a marketplace listing). It names a deliberate effort,
 * so it outranks everything but a utm campaign.
 *
 * A **door** is the fallback the server writes when nothing finer is known:
 * the surface the key was minted on. It is always true and never specific, so
 * it must rank BELOW the referring site — otherwise the day every door starts
 * writing an origin, every `ref:` reading would collapse into `src:site-signup`
 * and a working measurement would be traded for a new one. `channelOf`
 * (src/lib/signup-attribution.ts) reads `isDoorOrigin` for exactly that.
 *
 * 🚨 This is NOT `api_keys.origin_prefix`. That column is the lineage that
 * survives `/rotate` (the prefix of the key this one descends from) and the
 * cohort radar joins on `COALESCE(origin_prefix, key_prefix)`. Writing a
 * channel name there would silently unhook every rotated key from its cohort.
 * The acquisition origin lives in `source`, and only there.
 */

/**
 * The shape an origin must match to be stored, character for character the one
 * `POST /v1/keys/generate` has validated since 2026-08-06 and the one the
 * browser applies before keeping a `?src=` (frontend/lib/arrival.ts).
 *
 * 🚨 No colon, no dot, no space. A value that fails this test is DROPPED in
 * silence on every path — attribution must never be the reason a key is
 * refused — so a vocabulary invented outside this file would read as "no
 * origin" and look exactly like the gap this module exists to close. Compound
 * names are hyphenated for that reason: `marketplace-smithery`, never
 * `marketplace:smithery`.
 */
export const ORIGIN_SHAPE = /^[a-z0-9_-]{1,40}$/;

/**
 * The doors. One entry per surface that can mint a key, with what it means.
 *
 * Values already written in production keep their spelling (`web-device`,
 * `mcp-device`, `mcp-stdio-device`): renaming them would orphan the keys that
 * carry them, and a vocabulary is worth less than the continuity of the series
 * it labels.
 */
export const KEY_ORIGIN_DOORS = {
  'site-signup': 'The key dialog on the website, opened from a page with no door of its own.',
  'site-pricing': 'The key dialog opened from the pricing page.',
  'site-docs': 'The key dialog opened from the documentation.',
  'site-dashboard': 'The key dialog opened from the dashboard or the account area.',
  'web-device': 'The device-grant page approved by a human in a browser.',
  'mcp-device': 'The device grant opened by the remote MCP tool request_api_key.',
  'mcp-stdio-device': 'The device grant opened by the stdio MCP server (npx ibanforge-mcp).',
  'api-direct': 'POST /v1/keys/generate called without a browser and without a source.',
  'stripe-pack': 'A prepaid credit pack bought by card (Stripe Checkout).',
  'stripe-subscription': 'A monthly subscription bought by card (Stripe Checkout).',
  'x402-pack': 'A prepaid credit pack bought with x402 on POST /v1/credits/buy/:bundle.',
  admin: 'A key minted by hand through the admin route or the admin script.',
} as const;

export type KeyOriginDoor = keyof typeof KEY_ORIGIN_DOORS;

/**
 * The tags our own outbound links carry as `?src=`. Listed so the vocabulary
 * has one home, and so a reader of the dashboard can tell a deliberate link
 * from a door.
 *
 * Every name here is one a published link ALREADY carries; none was invented
 * for this list. The list is not a gate either: an unknown tag that matches
 * `ORIGIN_SHAPE` is stored as it arrives, because a campaign can be invented
 * faster than this file can be edited. What it is for is the reverse — reading
 * a channel on the dashboard and knowing which link produced it.
 */
export const KEY_ORIGIN_TAGS = {
  'github-readme': 'The README of the public repository.',
  'npm-mcp': 'The npm page and README of the ibanforge-mcp package.',
  'sdk-ts': 'The TypeScript/JavaScript SDK and its README.',
  'sdk-py': 'The Python SDK and its README.',
  'sdk-java': 'The Java SDK and its README.',
  'sdk-dotnet': 'The .NET SDK and its README.',
  n8n: 'The n8n community node, its README and its credential help.',
  'mcp-registry': 'The official MCP registry listing (server.json).',
  smithery: 'The Smithery listing (smithery.yaml).',
  glama: 'The Glama listing (glama.json).',
  'api-trial': 'The keyless REST trial, once its weekly allowance is spent.',
} as const;

export type KeyOriginTag = keyof typeof KEY_ORIGIN_TAGS;

const DOOR_NAMES: ReadonlySet<string> = new Set(Object.keys(KEY_ORIGIN_DOORS));

/**
 * True when the value is a door the server wrote for want of anything finer.
 *
 * Read by `channelOf` to rank a door below a referring site. A value this
 * function does not know is treated as a tag, which is the safe side: a real
 * campaign must never be demoted because the list lags behind.
 */
export function isDoorOrigin(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && DOOR_NAMES.has(value);
}

/**
 * The origin to store, from whatever the caller was given.
 *
 * A value that does not match `ORIGIN_SHAPE` falls back to the door rather
 * than to NULL: the old behaviour dropped it and left the row unattributed,
 * which is the failure this module exists to end. Trimmed and lowercased so
 * `?src=NPM` and `?src=npm ` are one channel and not three.
 */
export function normalizeOrigin(value: unknown, door: KeyOriginDoor): string {
  if (typeof value === 'string') {
    const cleaned = value.trim().toLowerCase();
    if (ORIGIN_SHAPE.test(cleaned)) return cleaned;
  }
  return door;
}

/** Every name this vocabulary knows, doors and tags, for documentation and tests. */
export function knownOrigins(): string[] {
  return [...Object.keys(KEY_ORIGIN_DOORS), ...Object.keys(KEY_ORIGIN_TAGS)].sort();
}
