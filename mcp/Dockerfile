# IBANforge MCP server — minimal Docker image for Glama deployment.
#
# This Dockerfile is what Glama uses to containerize the MCP server, run
# security scans, and let users one-click deploy ibanforge-mcp.
#
# Two-stage build: compile TypeScript in a builder stage, ship only the
# runtime artifacts in the final slim image. Final image is ~120 MB.
#
# Configuration is via environment variables (see mcp/server.json for the
# canonical schema). All runtime calls go to https://api.ibanforge.com by
# default — no local state, no DB, fully stateless.
#
# Node 22, exact patch. Node 20 went end-of-life on 2026-04-30. 22 is the
# maintained line that still ships npm 10, the npm the `mcp` job of ci.yml
# installs this lockfile with (that job stays on Node 20 on purpose: the
# package advertises `engines: node >=18`). Exact patch rather than the
# floating `22-slim`, so the Node version Glama builds is readable from the
# commit; Dependabot (docker ecosystem, directory /mcp) proposes the next 22.x
# patch, never a new major. Both stages carry the same tag
# (scripts/dockerfile-node-pin.test.ts). The npm package itself does not
# change: this file is not in its `files`.

# ─── Builder stage ────────────────────────────────────────────────────────────
FROM node:22.23.4-slim AS builder

WORKDIR /build

# Install build deps with reproducible lockfile
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# Compile TypeScript → dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev deps to keep the runtime layer slim
RUN npm prune --omit=dev

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22.23.4-slim AS runtime

WORKDIR /app

# Run as a non-root user (Glama security scan rewards this)
RUN groupadd --system mcp && useradd --system --gid mcp --home /app mcp

# Bring only the artifacts the runtime needs
COPY --from=builder --chown=mcp:mcp /build/dist ./dist
COPY --from=builder --chown=mcp:mcp /build/node_modules ./node_modules
COPY --chown=mcp:mcp package.json README.md ./

USER mcp

# Tunables — every value has a sensible default; override at deploy time.
ENV NODE_ENV=production
# Where the MCP tools route their HTTP calls. Override only if you self-host.
ENV IBANFORGE_API_BASE=https://api.ibanforge.com
# Optional API key. Without it, every paid call returns 402; agents can use
# the x402 micropayment flow on their side, or set IBANFORGE_API_KEY=ifk_...
# to charge the calls against the key's free monthly allowance (its size is
# served by GET https://api.ibanforge.com/v1 and /.well-known/rate-limits.yml).
# Generate one in 1 line: POST https://api.ibanforge.com/v1/keys/generate
ENV IBANFORGE_API_KEY=

# stdio transport — the standard MCP transport. Glama wires this up
# automatically; clients connect to stdin/stdout.
ENTRYPOINT ["node", "dist/index.js"]
