# syntax=docker/dockerfile:1.7
# Antego — Colyseus game server + PWA client (models and voice lines are pre-rendered and committed)

ARG NODE_VERSION=24

# ---------- deps: install all workspace dependencies ----------
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --no-audit --no-fund

# ---------- build: client (PWA) + server bundle ----------
FROM deps AS build
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:${NODE_VERSION}-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=2567 \
    CLIENT_DIR=/app/client
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --omit=dev --no-audit --no-fund --workspace @antego/server --include-workspace-root=false \
 && npm cache clean --force
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist client
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.source="https://github.com/ulfendk/antego" \
      org.opencontainers.image.description="Antego – myresoldater og Stratego (PWA + Colyseus)"
USER node
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:2567/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "packages/server/dist/index.js"]
