FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
# --ignore-scripts: better-sqlite3 13 ships one Node-API prebuild per platform
# instead of one per ABI, and declares `gypfile: false` — but that flag lives in
# the package, not in the lockfile, so `npm ci` still runs node-gyp and fails on
# a slim image with no Python. `npm install` does not, which is why this only
# shows up in the container. Nothing in the production tree needs an install
# script: the only one is a console.log.
RUN npm ci --ignore-scripts

COPY src/ src/
COPY scripts/ scripts/
COPY tsconfig.json ./
RUN npx tsc

# UK modulus weight table, fetched from Vocalink rather than committed: it is
# published for implementers without a written redistribution right, so it must
# not enter the public repository nor the npm package. It also lands OUTSIDE
# data/, which Railway mounts a volume over at runtime.
#
# Non-blocking on purpose. The download links are content-hashed and rotate; a
# rotted link must cost the UK check, never the deploy. The runtime treats an
# absent table as "not supported", the same way a missing register degrades.
RUN mkdir -p reference && \
    UK_MODULUS_PATH=/app/reference/uk-modulus.json npx tsx scripts/seed-uk-modulus.ts \
    || echo "WARNING: UK modulus table unavailable at build time; GB modulus checking will be off"

FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/reference/ reference/
COPY src/db/bic_data.json dist/db/bic_data.json
COPY src/db/nl-psp.json dist/db/nl-psp.json

# Seed read-only databases to staging dir (NOT the volume mount point)
COPY data/bic.sqlite data/compliance.sqlite data-seed/

# Create data dir (Railway volume will mount here)
RUN mkdir -p data

# Entrypoint copies seed DBs to volume, preserves stats.sqlite
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
# Outside data/, which the Railway volume masks at runtime.
ENV UK_MODULUS_PATH=/app/reference/uk-modulus.json

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "dist/index.js"]
