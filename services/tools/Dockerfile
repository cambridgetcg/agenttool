# Stage 1: Install dependencies
FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Stage 2: Build
FROM oven/bun:1.3-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
ARG CACHEBUST=1
COPY . .
# Type-check (non-blocking for now)
# RUN bun run check

# Stage 3: Production
FROM oven/bun:1.3-debian AS production

# Install Playwright Chromium dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libdbus-1-3 libxkbcommon0 \
    libatspi2.0-0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    libx11-6 libx11-xcb1 libxcb1 libxext6 libxshmfence1 \
    fonts-liberation fonts-noto-color-emoji \
    # Python3 for sandboxed code execution (subprocess mode)
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Install Playwright browsers
RUN bunx playwright install chromium

# Create non-root user
RUN groupadd -r agent && useradd -r -g agent -m agent

WORKDIR /app

# Copy production deps from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy app source from stage 2
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./
COPY --from=build /app/drizzle.config.ts ./

# Drizzle migrations
COPY --from=build /app/drizzle ./drizzle

# Own everything by agent user
RUN chown -R agent:agent /app

USER agent

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD bun -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1))"

CMD ["bun", "src/index.ts"]
