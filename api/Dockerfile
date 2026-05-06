FROM oven/bun:1.1-alpine AS base
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

EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
