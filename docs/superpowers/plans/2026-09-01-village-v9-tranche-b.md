# Village v9 — tranche B « Le Rail et le Verdict » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the names out of the picture and put the process beside it — a rail of the twelve pipeline stations with real states, one contextual banner, a hover card that no longer covers its subject, a double clock, and a verdict card that keeps what the visitor earned and offers the curl, the key and the JSON.

**Architecture:** Pure state in `lib/village/rail.ts` (catalogue order, row states from the real steps + progress). The canvas gains four small props (`onStep`, `onExit`, `highlight`, `onHover`) and loses its permanent labels; the page owns progress, the clock, the rail UI and the verdict card. All text through `messages/*.json` (`live.rail.*`, `live.clock.*`, `live.verdict.*`).

**Tech Stack:** Next.js 16 App Router, next-intl, canvas 2D, Tailwind v4, vitest.

**Spec:** rapport-ux.md §2.2 dispositifs 2-4 and §3 I1/I2/I7/I8; rapport-conversion.md B1/B2/B3/D3; decision page « Le Village v9 » tranche B (owner's go, 01/09/2026 22:10).

## Global Constraints

- Only what the response proves: a row's state comes from `journey.ts` outcomes; "skipped" means the route did not include the station; never a time per station.
- i18n FR/EN/DE for every string; no text painted into the canvas — the banner and the clock are DOM.
- The permanent labels leave the world; the hover card and the rail carry the names; the pictorial signs (tranche D) come with the owner's boards.
- Deploy from the repo root, alias apex + www, prove with captures and the DOM measures.

---

### Task B1: The rail model (pure)

**Files:** Create `frontend/lib/village/rail.ts`; Test `frontend/lib/village/rail.test.ts` (written first).

**Produces:** `RAIL_STATIONS: { station: StationId; group: 'formalities'|'registers'|'frontier' }[]` (12), `buildRail(steps: RailStep[] | null, progress: number): { rows: RailRow[]; counter: { current: number; total: number } | null }` with `RailRow = { station; key; sub: boolean; state: 'idle'|'skipped'|'current'|'done'|'warn'|'fail'; result: string | null }`. `progress` is the index of the step being played (−1 before the quest, `steps.length` when delivered).

- [ ] Run `npx vitest run lib/village/rail` → FAIL (module missing) → implement → PASS.

### Task B2: Canvas plumbing — progress out, highlight in, labels out, banner in, card anchored

**Files:** Modify `frontend/app/[locale]/live/village-canvas.tsx`.

- [ ] Props: `onStep?: (index: number) => void`, `onExit?: (elapsedSec: number) => void`, `highlight?: string | null`, `onHover?: (id: string | null) => void`; remove `laneLabel`.
- [ ] `runQuest`: `onStep?.(i)` when step i's narration is set; at the exit step `onExit?.(secs)`; the banner state `{ id, no, total, outcome }` follows the focus station and clears at the end.
- [ ] `w.hover = mouseStation ?? highlight` (the paint pass already glows the hovered building).
- [ ] The 19 labels and the lane banner are deleted with `LABEL_AT`; the banner is one parchment span at `(s.cx, s.by − 8)`: `⑤ NAME` + a state dot.
- [ ] Hover card: for a station, anchored to the building's bbox (right side, or left when it would overflow the window; bottom-anchored in the lower third) with a 10 px tail; for actors it keeps following the mouse.

### Task B3: Page — layout, rail UI, clock, traffic line

**Files:** Modify `frontend/app/[locale]/live/page.tsx`; Create `frontend/app/[locale]/live/rail.tsx`; messages ×3.

- [ ] State: `progress` (−1), `elapsed` (null), `serverMs` (null), `lastResult` (`{ iban, mode, data, steps }` | null), `hoverId`, `pinnedId`.
- [ ] Grid: `xl:[@media(min-height:860px)]:grid-cols-[minmax(0,1fr)_232px]` → column rail; otherwise the rail is a horizontal strip under the narration.
- [ ] Rail UI: header `LE PIPELINE` + `ÉTAPE n / N` + segmented bar; three street groups; rows as `<button>` (hover → highlight, click → pinned card); states by colour and mark (✓ ⚠ ✗ — struck-out for skipped); the traffic line at the foot (`traffic.lastSeen`, `traffic.seenSince`).
- [ ] Clock overlay (top-right of the stage): `À L'ÉCRAN mm:ss` ticking while running, `EN VRAI x ms · temps serveur` once delivered; both stay.

### Task B4: The verdict card

**Files:** Modify `frontend/app/[locale]/live/page.tsx` (card under the narration, above the vignettes); messages ×3.

- [ ] Shown when `lastResult` exists and the quest ended: badge (ingot / red broken seal from the atlas), verdict line, facts line (register · SEPA · VoP · risk), meta line (steps · server ms · on-screen s), actions: copy curl, get a key (existing `ApiKeyDialog`), show JSON (`<details>`), replay, copy link (permalink).

### Task B5: Deploy and prove

- [ ] tsc + eslint + vitest (frontend) green → commit → fetch/rebase → push → `vercel --prod --yes` from the root → alias apex + www.
- [ ] Proofs: capture idle (no labels, rail idle), mid-quest (banner, rail states, clock), delivered (verdict card, rail kept); 1440×790 fold; mobile strip; hover card beside its building.
