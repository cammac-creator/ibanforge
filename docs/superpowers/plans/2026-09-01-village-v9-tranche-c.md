# Village v9 — tranche C « La vie et le spectacle » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A visitor who never clicks still sees the pipeline work (a dated replay of a real answer), and the control points hit hard — the forge above all — while every effect stays tied to a real step of the response.

**Architecture:** The attract mode lives in the page (a recorded response fed to the same `buildJourney` → `setQuest` path, no network) with an abort signal to the canvas. The juice lives in the canvas as a small grammar (hitstop, flash, shake, elliptical wave, card handoff, persistent stamp) reused per station. The idle carousel is the page rotating the `idle` line and the `highlight`.

**Tech Stack:** Next.js 16, canvas 2D, next-intl, vitest. Recorded answers: `frontend/lib/village/demo-journeys.json` (captured from the production API, dated).

**Spec:** rapport-da.md §3 (juice grammar, forge 3.12, border 3.10, registry 3.6, cutter 3.4, classifier 3.9) and §4.2 (attract mode, life at rest); rapport-conversion.md A1/A4; owner's decisions n°2 (replay, never a call) and n°4.

## Global Constraints

- Honesty: the replay is labelled with its capture date; the first click always makes a real call; no effect fires without a real step.
- `prefers-reduced-motion`: no shake, no flash, no hitstop; states appear instead of animating.
- Readability first: never a shake or a full-screen flash while a line is being read — impacts sit in the first 400 ms of a step.
- i18n FR/EN/DE for every string.

---

### Task C1: Attract mode — the village plays itself once

**Files:** Create `frontend/lib/village/attract.ts` (+ test); Modify `frontend/app/[locale]/live/page.tsx`, `village-canvas.tsx` (`abortKey` prop), messages ×3 (`live.attract.*`).

- [ ] `pickDemo(count: number): key` rotates the playlist by a visit counter (localStorage), tested.
- [ ] Page: after 6 s without pointer/keyboard/wheel/touch, with the canvas ≥ 50 % visible, the tab visible, no reduced motion, and `sessionStorage['village-attract']` empty → `runReplay(journey)`: `buildJourney(response)` → `setQuest` with `demo: true`; the narration idle line becomes `attract.banner` (date); a liseré on the canvas says `attract.hint`. Any interaction aborts (`abortKey++` → canvas `w.gen++`, hero hidden, veil off, narration idle) and marks the session. Never twice.

### Task C2: The forge — three strikes, one seal, one wave

**Files:** Modify `village-canvas.tsx` (juice grammar: `w.hitstopUntil`, `w.flash`, `w.shake`, `w.waves`, `w.stamp`), `world.ts` if a helper is needed.

- [ ] Grammar: hitstop freezes actors (not particles) for N ms; flash = white rect at alpha decaying over 2 frames (canvas-wide, alpha ≤ 0.22); shake = translate by decaying `e^(−5t)`; wave = ellipse (ry = 0.45 rx) growing with alpha fading; stamp = a seal drawn on the forge façade until the next quest.
- [ ] Forge step sequence (≈ 2.4 s, inside the step's hold): veil 0.52 → 0.68 · hearth halo ×1.6 · ingot white-hot cooling · strikes at 700/1000/1300 ms (hitstop 90/90/120, shake 3/3/4.5, spark frame outBack, 14/14/22 sparks, ground wave) · seal drops (inQuad), lands with hitstop 120 + flash 0.22 + golden wave r→150 + village wave r→420 · stamp stays. Fail (tower) variant: red-ringed stamp. Reduced motion: seal appears, one static ring.

### Task C3: Stations that explain — cards, cuts, shutters, pigeonholes

**Files:** Modify `village-canvas.tsx` (`w.cards` primitive), `world.ts` (slot points).

- [ ] Card primitive: a parchment slip travelling from A to B (outCubic), optional wax dot, optional split into 2–3 segments that spread (the cutter), optional overlap of two slips (the border's VoP: two names laid over each other).
- [ ] Scribe: three light strokes on the counter, then a stamp thump (mini hitstop). Cutter: the slip splits into segments. Library: a slip rises from the porch with a wax dot. Registry: shutter opens (two panels), slip to the hero, shutter closes. Classifier: slip goes INTO the building, one of four pigeonhole slots lights. Border: barrier bar lifts (a drawn bar over the fence), two slips overlap (VoP). Court: gavel thump (mini hitstop + ring). Tower: beam sweeps to the hero, brazier colour by outcome.

### Task C4: Palier 0 of the casting — the clerks take their posts

**Files:** Modify `village-canvas.tsx` (agents list), `world.ts`.

- [ ] Librarian (clerk3) on the library porch, sorter (clerk0) at the classifier, usher (clerk1) at the court — removed from the market crowd; each turns to the hero at its step and bobs once; the market keeps clerk2. The archivist keeps clerk4, the vigil keeps clerk5.

### Task C5: The idle carousel

**Files:** Modify `page.tsx`, messages ×3 (`live.carousel.*`, 5 lines).

- [ ] While no quest has played, the idle line rotates every 12 s through five lines, each naming a station and lighting it (`highlight`). Stops at the first interaction or quest.

### Task C6: Deploy and prove

- [ ] tsc + eslint + vitest green → commit → rebase → push → `vercel --prod --yes` (root) → alias apex + www.
- [ ] Proofs: cold visit capture at 8 s shows the replay running with its dated label; an interaction stops it; forge capture at the strike; border capture with the two slips; rail + verdict unchanged; zero console errors; the replay makes no call to `/api/playground` (network log).
