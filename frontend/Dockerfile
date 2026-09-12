# syntax=docker/dockerfile:1.7
# Image du site IBANforge (Next.js 16, sortie autonome « standalone »).
# Construite par GitHub Actions, JAMAIS sur le VPS : 4 Go de RAM, crash OOM du
# 18/03/2026 en construisant Tabornio là-bas. Trois arguments de build, tous
# publics : l'URL de l'API cuite dans le bundle client, l'URL d'origine que les
# pages lisent au rendu, et le commit affiché par la page changelog.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_URL=https://api.ibanforge.com
ARG API_URL=https://ibanforge-production.up.railway.app
ARG GIT_SHA=main
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL API_URL=$API_URL GIT_SHA=$GIT_SHA NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Lus au rendu par chemin absolu (registres, polices et marque de l'image de
# partage) : copiés explicitement plutôt que confiés au traçage automatique.
COPY --from=build --chown=node:node /app/data ./data
COPY --from=build --chown=node:node /app/assets ./assets
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/robots.txt').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
