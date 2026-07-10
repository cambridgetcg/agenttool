FROM oven/bun:1.3-alpine AS base
WORKDIR /app

# ── Install dependencies (cached layer) ─────────────────────────────────────
FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production \
    AGENTTOOL_DOCS_DIR=/app/docs

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

# Bundle the Kingdom library into the image at /app/docs/kingdom-bundle.json.
# Staged by bin/deploy.sh Phase 3 (cp docs/kingdom-bundle.json
# api/kingdom-bundle.json.bundled). services/kingdom/library.ts checks
# /app/docs/kingdom-bundle.json in production. Without this,
# /public/kingdom returns 503 kingdom_bundle_missing.
COPY kingdom-bundle.json.bundled /app/docs/kingdom-bundle.json

# Bundle every canonical file hashed by services/doctrine/integrity.ts.
# bin/stage-doctrine-docs.sh reads api/doctrine-docs.manifest and creates
# this build-context directory before deploy.
COPY doctrine-docs.bundled/ /app/docs/

EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
