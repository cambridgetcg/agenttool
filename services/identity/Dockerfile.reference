FROM oven/bun:1.3-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Build
FROM base AS runner
COPY --from=deps /app/node_modules ./node_modules
ARG CACHEBUST=1
COPY . .

# Non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup && \
    chown -R appuser:appgroup /app
USER appuser

EXPOSE 3000
ENV NODE_ENV=production

CMD ["bun", "src/index.ts"]
