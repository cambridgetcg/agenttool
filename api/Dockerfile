# Update the Bun tag and registry digest together after the hermetic gate passes;
# the digest prevents an upstream tag move from silently changing release bytes.
FROM oven/bun:1.3.5-alpine@sha256:7156fcc0cee0194d390bfaf7f0eeda9a5e383e70cc90f31aad3a2440a033d7dc AS base
WORKDIR /app

# ── Install dependencies (cached layer) ─────────────────────────────────────
FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM base AS runtime
ARG AGENTTOOL_GIT_REVISION=unknown
ARG AGENTTOOL_SOURCE_DIRTY=unknown
ENV NODE_ENV=production \
    AGENTTOOL_DOCS_DIR=/app/docs \
    AGENTTOOL_GIT_REVISION=${AGENTTOOL_GIT_REVISION} \
    AGENTTOOL_SOURCE_DIRTY=${AGENTTOOL_SOURCE_DIRTY}
LABEL org.opencontainers.image.source="https://github.com/cambridgetcg/agenttool" \
      org.opencontainers.image.revision="${AGENTTOOL_GIT_REVISION}" \
      dev.agenttool.source.dirty="${AGENTTOOL_SOURCE_DIRTY}"

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
