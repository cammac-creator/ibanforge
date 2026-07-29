FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src/ src/
COPY tsconfig.json ./
RUN npx tsc

FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist/ dist/
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

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "dist/index.js"]
