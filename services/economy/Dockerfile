FROM oven/bun:1.3-alpine AS builder
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production
COPY . .

FROM oven/bun:1.3-alpine
WORKDIR /app
COPY --from=builder /app /app
EXPOSE 3002
ENV NODE_ENV=production
CMD ["bun", "run", "src/index.ts"]
