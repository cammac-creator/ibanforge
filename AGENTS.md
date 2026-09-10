# Working on IBANforge

Instructions for any coding agent opening this repository. Codex reads this file;
Claude Code reads `CLAUDE.md` next to it. **The two must say the same thing** — if you
change a rule here, change it there.

**`docs/handover.md` is the long version**: why each rule below exists, how the bank-code
verdict works, what a green test suite does not prove, the traps already paid for, the work
in flight and the known debts. Read this file first, that one before your first commit.

IBANforge is an IBAN validation and BIC lookup API. Three areas live in one repository:

| Area | Path | Runs on | Deployed by |
|---|---|---|---|
| The API (Hono, TypeScript, SQLite) | `src/`, `scripts/`, `data/` | Node 22 | Railway, on every push to `main` |
| The website and dashboard (Next.js) | `frontend/` | Node 24 | Vercel today, an Infomaniak VPS soon (see below) |
| The published packages | `mcp/`, `sdks/`, `integrations/` | Node 20 | a tagged release workflow, never by hand |

---

## The rules that are not negotiable

**1. Never push to `main`.** A push to `main` deploys the API to production. There is no
staging. Work on a branch, open a pull request, let CI go green, and let a human merge.
`main` carries no branch protection: the rule is the protection.

**2. This repository is public.** Never write a customer's or prospect's name, a real
e-mail address, or a real activity figure (accounts, calls served, revenue, reply rates)
into code, comments, test fixtures, documentation or commit messages. A pushed commit
message cannot be rewritten. Invented fixtures only: `acme@example.com`, `Société Alpha`,
`alpha.example.net`. Public bank names and public bank codes are data, and are fine.
The reasoning stays, the quantity goes: "measured on the real mailbox, N of M were bots"
becomes "close to a third were automation".

**3. One Node version per area.** Node 22 at the root: `better-sqlite3` ships no linux-x64
prebuild for the ABI of Node 24, so 24 breaks the production image. Node 24 under
`frontend/`. Node 20 for `mcp/` and `sdks/typescript/`. CI runs each in its own job.

**4. `npm run check` before every commit** (typecheck, prettier, lint, tests, runtime
dependency check). Frontend tests run **from** `frontend/`: at the root, vitest finds
nothing and exits zero, which reads like success.

**5. Prettier on `src/**/*.ts` is a CI gate.** Run `npx prettier --write` on every file you
create under `src/` or `scripts/`. Do **not** run it across `frontend/`: that tree does not
follow the root config and a blanket `--write` reformats hundreds of lines you did not
write.

**6. Do not regenerate `data/bic.sqlite`** unless your task is exactly that. It is a
tracked 35 MB binary; two branches that both reseed it produce a conflict that cannot be
merged. Same for `package-lock.json`: never commit a rewrite that changes no dependency.

**7. Never deploy, publish, or touch infrastructure.** No `vercel`, no `railway`, no
`npm publish`, no `gh release`, no DNS. Releases follow `RELEASING.md` and are run by a
human. Never print a secret; the repository holds none, and none should ever enter it.

**8. No `Intl`, `toLocaleString` or `toLocaleDateString` in a client component.** WebKit
formats differently from Node, React blows up on the hydration mismatch and wipes the
class on `<html>`. Format through the helpers in `frontend/lib/`.

**9. Absolute paths in shell commands.** Never `cd somewhere && grep -rn foo src/`. The
permission guard cannot tell where a relative path points and stops to ask a human who is
not watching.

**10. Leave other people's work alone.** Several agents and sessions share this repository.
Branches, worktrees under `.claude/`, and stashes belong to whoever made them. `git fetch`
before every push. If you break `main`, fix it or revert it immediately.

---

## Commands

```bash
npm ci                    # root deps (Node 22)
npm run check             # typecheck + prettier + lint + tests + runtime deps — the gate
npm run test              # vitest, tests live next to the source as *.test.ts
npm run dev               # API on :3000
npm run openapi:lint      # the contract

cd frontend && npm ci     # site deps (Node 24)
npx vitest run            # site tests, FROM frontend/
npx tsc --noEmit          # site typecheck
npm run build             # next build
```

---

## Where things live

- `src/lib/enrich.ts` — the verdict on a bank code. `NATIONAL_REGISTERS` means *a miss
  proves non-existence*; `NON_EXHAUSTIVE_REGISTERS` means *a hit names the holder and a
  miss says nothing*. Putting a partial register in the first map is the trap this codebase
  has already fallen into once: `decideBankCode` reads `const registerDown = !!national`,
  so every miss would answer "we could not consult the register" about a register that
  answered.
- `src/lib/national-registers.ts`, `scripts/seed-national.ts` — the registers and their
  loaders. Each carries its source string and its `as_of`, and some carry licence
  conditions that must appear on every response built from them.
- `src/lib/trial.ts` — the keyless trial, in figures and in words. Every surface quotes
  these constants; none of them hardcodes the number.
- `src/middleware/x402.ts` — prices. `frontend/data/` — what the site pre-renders,
  exported from the API by `npm run pages:export` and `pages:export-countries`.
- `docs/data-sources.md` — every data source, its licence, and the permission we hold in
  writing. **Read it before touching a register.** Some sources impose an exact credit line
  and a notice that must be reproduced in full on every response.

---

## Work in progress, at 10 September 2026

**The Greek register (HEBIC).** Branches `registre-gr-api` and `registre-gr-site`, local
only, not pushed. The Hellenic Bank Association granted commercial reuse in writing on
8 September under two conditions: the exact credit line, and its disclaimer reproduced in
full on every response carrying HEBIC data. The branches currently treat Greece as an
*authoritative* register, and that is wrong: the association's file lists credit
institutions, not the whole code allocation, so a real payment institution's code would be
answered "not allocated". The switch to `NON_EXHAUSTIVE_REGISTERS` is decided and being
applied on `registre-gr-fix`. Do not start over.

**Moving the website off Vercel to an Infomaniak VPS in Geneva.** Branch `vps-migration`
holds the first commit: a container image for `frontend/`, a deploy workflow that builds on
GitHub and ships to the VPS over a restricted SSH key, and the legal texts updated
(Infomaniak replaces Vercel as sub-processor). The API does not move. Remaining: two DNS
records, a decision on a CDN in front, and the cutover. The reasoning is in the internal
report named below.

**The keyless trial goes from ten to twenty-five calls a day.** Decided 9 September, **not
yet in the code**: `REST_TRIAL_DAILY_LIMIT` in `src/lib/trial.ts` still reads 10. No e-mail
and no key are required for those calls — that is the point of the change, and it should be
said plainly wherever the trial is described. Changing it means the constant, its tests, and
the surfaces that quote it (the `/v1` text in `src/app.ts`, the rate-limit artifact, the
docs under `frontend/content/*/docs/`, the three message catalogues).

---

## Internal reports and the roadmap

`docs/internal/` is **ignored by git and never published**: it holds traffic and revenue
reality, correspondence, and prospect files. Nothing from it may be quoted in a commit, in
code, or in a public document.

Two conventions live there and matter to any agent:

- **One roadmap, one address.** `docs/internal/pages/feuille-de-route-2026-09-06.html` is
  the single roadmap. It is generated from
  `docs/internal/feuille-de-route/feuille-de-route-gen.py`: change a line in the lists,
  regenerate, keep the same filename. Never create a second roadmap beside it. Superseded
  documents carry an archive banner pointing back to it.
- **Every chantier gets its report.** A study, an audit or a decision produces one
  self-contained HTML page in `docs/internal/pages/`, named `<sujet>-<date>.html`, served
  locally. The roadmap lists them all. If you deliver a study, deliver its page.

---

## Who does what

The main Claude Code session integrates, deploys, and owns anything touching production
data, the registers, and the deployment chain. A second agent is welcome on isolated
chantiers and on reviewing pull requests. Two agents editing the same files at once is the
one failure mode this repository has already paid for: say which files you are taking
before you take them.

`frontend/AGENTS.md` is written and re-added automatically by `next dev`. Leave it there.
