# Village v9 — tranche A « Fondations » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the /live village geometrically right, legible and alive at rest, and give the visitor a first gesture — without a single new art board.

**Architecture:** Three files carry the engine (`world.ts` geometry + atlas drawing, `village-canvas.tsx` simulation + paint + DOM overlay, `page.tsx` data + narration); pure logic that can be unit-tested goes to `lib/village/*.ts` next to `path.ts`/`roads.ts`. One API touch: the courier feed (`src/routes/ops-recent.ts`) stops serving the operations made by internal keys (playground, probes) — decision n°3 of the owner, 01/09/2026.

**Tech Stack:** Next.js 16 (App Router, next-intl), canvas 2D without libraries, vitest (node env in `frontend/`, `src/` suite at the repo root), Hono + better-sqlite3 for the API.

**Spec:** the three audits of 01/09/2026 (`~/Documents/ibanforge-audits-village-2026-09-01/rapport-{ux,da,conversion}.md`) and the decision page « Le Village v9 » (decisions 1, 3, 4 ratified by the owner on 01/09/2026 22:10).

## Global Constraints

- Honesty: nothing moves unless a real API response or a real logged operation triggers it; replays are dated and labelled.
- i18n: every string goes through `messages/{fr,en,de}.json`, namespace `live`; no text painted into the canvas.
- `prefers-reduced-motion`: movement may be removed, reading time never.
- Public repository: no client email, no real traffic figure in comments or fixtures (`alpha.example.net` fixtures only).
- Deploy: Railway follows `git push` (API); Vercel does NOT — `vercel --prod --yes` from the repo ROOT then `vercel alias set <url> ibanforge.com` AND `www.ibanforge.com`; prove with a capture and the served data.

---

### Task 1: Six door anchors on the painted doors

**Files:**
- Modify: `frontend/app/[locale]/live/world.ts:117-142` (STATIONS)

**Interfaces:**
- Produces: `StationGeo.door` / `.anchor` used by `runQuest` (village-canvas.tsx) and by the spotlight (Task 3).

- [ ] **Step 1: Replace the six anchors** (measured on the boards by the DA audit, ±3 px world):

```ts
geo('gate', 'gate', 80, 182, 84, 116, [43, 196], [43, 192]),
geo('library', 'library', 655, 176, 176, 126, [705, 186], [705, 192], { scale: 0.92 }),
geo('warehouse', 'warehouse', 850, 106, 132, 104, [790, 96], [790, 76]),
geo('court', 'court-b', 358, 337, 128, 99, [326, 348], [326, 342]),
geo('six', 'six-b', 470, 340, 128, 124, [420, 348], [420, 342]),
geo('forge', 'forge', 560, 488, 152, 126, [537, 500], [537, 498]),
```

- [ ] **Step 2: Verify by eye** — reduced-motion quest capture (`releve-rm.js` variant taking a screenshot at every narration change), crop 160×120 around each door: the hero stands in the doorway, not on a wall.

- [ ] **Step 3: Commit** with Tasks 2-4 and 6 (engine batch).

### Task 2: A hero you can find

**Files:**
- Modify: `frontend/app/[locale]/live/world.ts` (`Actor` gets `alpha?: number`; `drawActor` honours it)
- Modify: `frontend/app/[locale]/live/village-canvas.tsx` (paint pass: hero halo + chevron, hero sort priority, couriers at alpha 0.86)

- [ ] **Step 1: `Actor.alpha`** — in `world.ts`: `alpha?: number` on the interface; `drawSprite(..., { ..., alpha: a.alpha })` in `drawActor`.
- [ ] **Step 2: Halo under the hero** — in the entities loop, before pushing the hero entity, push a ground ring drawn UNDER the sprite (same base, `draw` first):

```ts
if (!w.hero.hidden) {
  ents.push({ base: w.hero.y - 0.01, draw: () => {
    const pulse = w.reduced ? 1 : 0.86 + 0.14 * Math.sin(t / 700)
    const g = ctx.createRadialGradient(w.hero.x, w.hero.y, 2, w.hero.x, w.hero.y, 13 * pulse)
    g.addColorStop(0, "rgba(253,224,138,0.34)"); g.addColorStop(1, "rgba(253,224,138,0)")
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = g
    ctx.fillRect(w.hero.x - 16, w.hero.y - 16, 32, 32); ctx.restore()
  } })
}
```
- [ ] **Step 3: Chevron above the hero during a quest** (after the entity pass, before FX): a 7 px golden triangle at `hero.y - 46 + bob` where `bob = reduced ? 0 : Math.sin(t / 900) * 2`.
- [ ] **Step 4: Sort priority** — the hero entity uses `base: a.y + 0.5` so it never hides behind the building it visits; couriers get `alpha: 0.86` at creation.
- [ ] **Step 5: Verify by eye** on a quest capture: the hero reads at a glance against houses and couriers.

### Task 3: A spotlight that points at the door

**Files:**
- Modify: `frontend/app/[locale]/live/village-canvas.tsx` (veil block)

- [ ] **Step 1:** `vc.fillStyle = "rgba(6,6,12,0.52)"`; hero hole radius 104 → 78; focus hole 126 → 96 centred on the door: `hole(w.focus.door[0], w.focus.door[1] - 22, 96)`.
- [ ] **Step 2: Verify** — measure luminance inside/outside the hole on a quest capture (target contrast ≥ 2×; was 1.27×).

### Task 4: Life at rest

**Files:**
- Modify: `frontend/app/[locale]/live/village-canvas.tsx` (scenery draw closure; forge halo breathing)

- [ ] **Step 1: Trees and tufts sway** — in the SCENERY entity closure, before drawing, when `!w.reduced`:

```ts
const sway = p.sprite.startsWith("tree") || p.sprite === "grove" ? Math.sin(t / 2800 + p.cx) * 1.0
  : p.sprite.startsWith("tuft") ? Math.sin(t / 1900 + p.cx) * 0.6 : 0
```
and draw at `p.cx + sway`.
- [ ] **Step 2: The hearth breathes** — forge halo (index 1 of HALOS) pulses 0.78–1.08 on a 2.4 s period instead of 0.86–1.0 on 520 ms; keep the other halos as they are.
- [ ] **Step 3: Verify** — two idle captures 3 s apart differ on the trees and the hearth (pixel diff > 0 in those regions), nothing else moves that should not.

### Task 5: Couriers from the first second, honestly dated

**Files:**
- Create: `frontend/lib/village/ops-age.ts`, `frontend/lib/village/ops-age.test.ts`
- Modify: `frontend/app/[locale]/live/page.tsx` (traffic poll), `frontend/messages/{fr,en,de}.json` (`live.traffic.ago*`)

**Interfaces:**
- Produces: `opAgeMinutes(t: string, nowMs: number): number | null` — accepts both stats.sqlite timestamp shapes (`YYYY-MM-DD HH:MM:SS` UTC and ISO `…T…Z`), returns whole minutes ≥ 0, `null` if unparseable.

- [ ] **Step 1: Failing test** (`ops-age.test.ts`):

```ts
import { describe, expect, it } from 'vitest'
import { opAgeMinutes } from './ops-age'
describe('opAgeMinutes', () => {
  const now = Date.UTC(2026, 8, 1, 19, 0, 0)
  it('reads the SQLite default shape as UTC', () => { expect(opAgeMinutes('2026-09-01 18:45:51', now)).toBe(14) })
  it('reads the ISO shape', () => { expect(opAgeMinutes('2026-09-01T18:30:00.000Z', now)).toBe(30) })
  it('never goes negative', () => { expect(opAgeMinutes('2026-09-01 19:00:30', now)).toBe(0) })
  it('rejects garbage', () => { expect(opAgeMinutes('yesterday', now)).toBeNull() })
})
```
- [ ] **Step 2: Run** `npx vitest run lib/village/ops-age` → FAIL (module missing).
- [ ] **Step 3: Implement** (`ops-age.ts`): normalise `' '` → `'T'`, append `'Z'` when no zone, `Date.parse`, `Math.max(0, Math.floor((now - ms) / 60000))`, `null` on NaN.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: page.tsx** — the first poll no longer returns silently: it replays the 3 most recent operations as couriers whose tip role ends with the age (`t('traffic.ago', { min })` / `t('traffic.agoHours', { h })` / `t('traffic.justNow')`); later polls keep `t('traffic.live')`. Keys ×3 languages:
  - fr: `ago: "il y a {min} min"`, `agoHours: "il y a {h} h"`, `justNow: "à l'instant"`, `live: "en direct"`
  - en: `"{min} min ago"`, `"{h} h ago"`, `"just now"`, `"live"`
  - de: `"vor {min} Min."`, `"vor {h} Std."`, `"gerade eben"`, `"live"`
- [ ] **Step 6: Verify** — fresh page load: couriers on the road within 2 s; hover one: the card says its age.

### Task 6: The fail seal is red, and the paid frames are drawn

**Files:**
- Modify: `frontend/app/[locale]/live/world.ts` (`drawTinted`), `frontend/app/[locale]/live/village-canvas.tsx` (`Seal.tint`, forge props)

- [ ] **Step 1: `drawTinted(ctx, img, name, cx, baseY, tint, strength, opts)`** in `world.ts` — draws the sprite on a shared offscreen canvas, fills it with `tint` under `source-atop` at `strength` alpha, then blits it (so the tint never spills on the ground).
- [ ] **Step 2:** seals get `tint?: string`; every `seal-x` push passes `tint: "#B91C1C"`, drawn through `drawTinted(…, 0.55)`.
- [ ] **Step 3: Forge props** — new transient list `w.props: { sprite; x; y; l; scale? }[]` drawn after the entities: at the forge step push `{ sprite: 'spark', x: 522, y: 476, l: 22, scale: 0.9 }` and, on `outcome !== 'fail'`, `{ sprite: 'ingot', x: 522, y: 472, l: 140 }` (fades over its last 30 frames).
- [ ] **Step 4: Verify** — capture the forge moment: the `spark` burst and the ingot on the anvil; capture a failed quest: the seal is red.

### Task 7: Five example quests, one click each

**Files:**
- Create: `frontend/lib/village/examples.ts` (data), `frontend/lib/village/examples.test.ts`
- Modify: `frontend/app/[locale]/live/page.tsx` (chips row), `frontend/messages/*.json` (`live.chips.*`)

- [ ] **Step 1: Failing test** — every example IBAN passes mod-97 except the one flagged `broken`, and every example has a mode:

```ts
import { describe, expect, it } from 'vitest'
import { LIVE_EXAMPLES } from './examples'
const mod97 = (iban: string) => { const s = iban.slice(4) + iban.slice(0, 4); let r = 0; for (const ch of s) { r = (r * 10 + (/\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 55)) % 97 } return r === 1 }
describe('LIVE_EXAMPLES', () => {
  it('has five stories, each with a mode', () => { expect(LIVE_EXAMPLES).toHaveLength(5); for (const e of LIVE_EXAMPLES) expect(['iban', 'compliance']).toContain(e.mode) })
  it('every well-formed example passes mod-97, the broken one fails', () => { for (const e of LIVE_EXAMPLES) expect(mod97(e.iban.replace(/\s+/g, ''))).toBe(e.key !== 'broken') })
})
```
- [ ] **Step 2: Data** — keys `de` (DE89 3704 0044 0532 0130 00, iban), `ch` (CH78 0076 7001 2345 6700 0, iban), `tr` (TR33 0006 1005 1978 6457 8413 26, compliance), `broken` (DE89 3704 0044 0532 0130 01, iban), `gb` (GB33 BUKB 2020 1555 5555 55, compliance) — all verified against the production API by the DA audit on 01/09/2026.
- [ ] **Step 3: Chips row** under the form: `t('chips.label')` + five `<Button variant="outline" size="sm">` → `setMode(e.mode); setIban(e.iban); void runValidation(e.iban.replace(/\s+/g, ''), e.mode)` (runValidation takes the mode as a parameter so the state update cannot race). Labels ×3: fr `Ou lance une quête d'exemple :` · `IBAN allemand` · `Guichet suisse` · `Compliance (Turquie)` · `IBAN cassé` · `Royaume-Uni (PRA)`; en `Or start an example quest:` · `German IBAN` · `Swiss counter` · `Compliance (Turkey)` · `Broken IBAN` · `United Kingdom (PRA)`; de `Oder starte eine Beispiel-Quest:` · `Deutsche IBAN` · `Schweizer Schalter` · `Compliance (Türkei)` · `Kaputte IBAN` · `Vereinigtes Königreich (PRA)`.
- [ ] **Step 4: Verify** — click « IBAN cassé »: the quest stops at the Scribe with a red seal.

### Task 8: Canvas and narration above the fold on a 13" laptop

**Files:**
- Modify: `frontend/app/[locale]/live/page.tsx` (lede, wrapper), `frontend/app/[locale]/live/village-canvas.tsx` (labels hidden under 640 px), `frontend/messages/*.json` (`live.lede`, `live.ledeMore`)

- [ ] **Step 1:** `lede` keeps only its first sentence; the rest becomes `ledeMore`, rendered under the canvas above `honesty`.
- [ ] **Step 2:** the canvas wrapper gets `className="mx-auto"` and `style={{ maxWidth: 'max(560px, min(100%, calc((100dvh - 380px) * 16 / 9)))' }}`.
- [ ] **Step 3:** registry labels and the lane banner get `className="… hidden sm:inline-block"` (mobile keeps 13 labels, not 20).
- [ ] **Step 4: Verify** — capture at 1440×790: the narration bar's bottom edge is above 790 px; capture at 390×844: no label overflows the canvas.

### Task 9: The landing points at the village; a quest has a permalink

**Files:**
- Create: `frontend/lib/village/permalink.ts`, `frontend/lib/village/permalink.test.ts`
- Modify: `frontend/app/[locale]/live/page.tsx` (autoplay effect), `frontend/messages/*.json` (`nav.live`, `home.film.ship.tryLive` target check)

**Interfaces:**
- Produces: `parseLiveParams(search: string): { iban: string | null; mode: 'iban' | 'compliance'; autoplay: boolean }`.

- [ ] **Step 1: Failing test** — `?iban=de89%203704&mode=compliance&autoplay=1` → `{ iban: 'DE89 3704', mode: 'compliance', autoplay: true }`; junk mode → `'iban'`; no params → `{ iban: null, mode: 'iban', autoplay: false }`; iban longer than 42 chars → `null`.
- [ ] **Step 2: Implement** with `URLSearchParams`, uppercase + collapse whitespace, length guard.
- [ ] **Step 3: page.tsx** — the autoplay effect uses `parseLiveParams(window.location.search)`: sets the field and the mode when `iban` is present, runs when `autoplay`.
- [ ] **Step 4: Nav label** — `nav.live`: fr « Le Village », en “The Village”, de „Das Dorf“. Check that `home.film.ship.tryLive` links to `/live`; if it links elsewhere, point it at `/{locale}/live?autoplay=1`.
- [ ] **Step 5: Verify** — `curl -s https://ibanforge.com/fr | grep -o 'Le Village'` after deploy; `/fr/live?iban=CH78…&autoplay=1` starts on that IBAN.

### Task 10: The courier feed no longer shows our own demonstrations (decision n°3)

**Files:**
- Modify: `src/routes/ops-recent.ts` (WHERE clause), `src/routes/ops-recent.test.ts` (create if absent)

- [ ] **Step 1: Failing test** — insert an api_keys row with an internal email (the `is_internal_email` SQL function already used by `src/lib/stats.ts:658`) and two operations: one with that key_prefix, one keyless; `GET /v1/ops/recent` returns only the keyless one.
- [ ] **Step 2: Implement** — `WHERE id > ? AND (key_prefix IS NULL OR key_prefix NOT IN (SELECT key_prefix FROM api_keys WHERE is_internal_email(email)))`.
- [ ] **Step 3: Run** the root suite → PASS; commit `feat(ops): the courier feed leaves out our own demonstrations`.

### Task 11: Around 40 s, faster on empty stretches, a « faster » button (decision n°4)

**Files:**
- Modify: `frontend/app/[locale]/live/village-canvas.tsx` (`w.fast`, `makeSleep`, `makeMove` speed on long segments), `frontend/app/[locale]/live/page.tsx` (button), `frontend/messages/*.json` (`live.faster`)

- [ ] **Step 1:** `makeMove`: `speed * (d > 300 ? 1.5 : 1) * (w.fast ? 2 : 1)` per segment; `makeSleep`: `left -= tick * (w.fast ? 3 : 1)`.
- [ ] **Step 2:** `VillageCanvas` exposes `fast` as a prop (`fast?: boolean`) copied into `w.fast` in an effect; `page.tsx` shows `<Button variant="outline" size="sm">⏩ {t('faster')}</Button>` in the vignettes row only while `running`, toggling `fast`. Keys: fr `Accélérer`, en `Speed up`, de `Schneller`.
- [ ] **Step 3: Verify** — relevé: a DE quest without the button lands between 36 and 44 s; with the button pressed at 5 s, under 20 s.

### Task 12: Deploy and prove

- [ ] `cd frontend && npx tsc --noEmit && npx eslint "app/[locale]/live" lib/village && npx vitest run` → green; root `npx vitest run` → green.
- [ ] `git fetch && git rebase origin/main && git push` (Railway picks up Task 10).
- [ ] `cd ~/ibanforge && vercel --prod --yes` → `vercel alias set <url> ibanforge.com` and `www.ibanforge.com`.
- [ ] Proofs: HTTP 200 ×3 locales; `curl -s https://ibanforge.com/api/ops` no longer lists DE-by-default demo ops after a village quest (key_prefix internal); captures: idle (couriers + sway), quest (hero, spotlight, forge), 1440×790 fold, 390×844; relevé duration.
