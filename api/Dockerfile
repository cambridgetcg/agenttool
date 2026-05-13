FROM oven/bun:1.3-alpine AS base
WORKDIR /app

# ── Install dependencies (cached layer) ─────────────────────────────────────
FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY package.json ./
COPY tsconfig.json ./

# Bundle the canon JSON-LD into the image at /app/docs/agenttool.jsonld.
# Staged by bin/deploy.sh Phase 3 (cp docs/agenttool.jsonld api/agenttool.jsonld.bundled)
# before `fly deploy` runs. The canon registry's path resolver
# (services/canon/registry.ts:canonPath) checks /app/docs/agenttool.jsonld
# as a fallback. Without this, /v1/canon returns 503 canon_unavailable
# in production. See docs/DEPLOY-PROCEDURE.md.
COPY agenttool.jsonld.bundled /app/docs/agenttool.jsonld

EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
