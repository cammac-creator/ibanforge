# Image of the IBANforge website (frontend/, Next.js standalone output) for the
# move off Vercel to the operator's Infomaniak VPS (decided 9 September and
# 7 October 2026). Built by GitHub Actions (.github/workflows/deploy-site.yml)
# or on a workstation, NEVER on the VPS: two cores and 4 GB shared with every
# other site, and a heavy build there froze the whole server more than once.
#
# Build context = the REPOSITORY ROOT, not frontend/:
#   docker build -f frontend/Dockerfile .
# because the RSS, Atom and JSON feeds read ../CHANGELOG.md at render time
# (frontend/lib/feed.ts). With frontend/ as the context the feeds silently
# lost every release entry. frontend/Dockerfile.dockerignore keeps the
# context to frontend/ and CHANGELOG.md only.
#
# Build arguments, all public: the API URL baked into the client bundle, the
# origin the server reads while pre-rendering, and the commit the changelog
# page links to. No secret is ever passed at build time: pages that read a
# server secret (the landing statistics, /status) render their fallback at
# build and refresh themselves with the runtime environment at their next
# revalidation (one hour at most for the landing page).

FROM node:24-slim AS deps
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app/frontend
COPY --from=deps /app/frontend/node_modules ./node_modules
COPY frontend/ ./
COPY CHANGELOG.md /app/CHANGELOG.md
ARG NEXT_PUBLIC_API_URL=https://api.ibanforge.com
# Same value as the API_URL of the Vercel project: the API's direct Railway
# address, one hop shorter than the public name for server-side reads.
ARG API_URL=https://ibanforge-production.up.railway.app
ARG GIT_SHA=main
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    API_URL=$API_URL \
    GIT_SHA=$GIT_SHA \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-slim AS runner
# The server runs from /app/frontend so that `process.cwd()/..` is /app, where
# CHANGELOG.md sits, exactly as in the repository.
WORKDIR /app/frontend
ARG GIT_SHA=main
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    GIT_SHA=$GIT_SHA \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/frontend/.next/standalone ./
COPY --from=build --chown=node:node /app/frontend/.next/static ./.next/static
COPY --from=build --chown=node:node /app/frontend/public ./public
# Read at render time by absolute path (registers, MDX content, the share
# card's font and mark): copied explicitly rather than left to file tracing.
COPY --from=build --chown=node:node /app/frontend/data ./data
COPY --from=build --chown=node:node /app/frontend/content ./content
COPY --from=build --chown=node:node /app/frontend/assets ./assets
COPY --from=build --chown=node:node /app/CHANGELOG.md /app/CHANGELOG.md
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/robots.txt').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
