# IBANforge website

The Next.js site and dashboard of IBANforge (`ibanforge.com`), on Node 24.

How this folder is built, tested and deployed, and the rules that hold across
the repository, are in [`AGENTS.md`](../AGENTS.md) at its root; the long
version is [`docs/handover.md`](../docs/handover.md).

```bash
npm ci
npm run dev        # http://localhost:3000
npx vitest run     # the site's tests, run from this folder
npx tsc --noEmit   # typecheck
npm run build      # next build
```
