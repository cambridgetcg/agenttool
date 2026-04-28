FROM oven/bun:latest AS builder
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production
COPY src/ src/
COPY tsconfig.json ./

FROM oven/bun:latest
WORKDIR /app
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/src src
COPY --from=builder /app/package.json .
COPY --from=builder /app/tsconfig.json .
EXPOSE 3000
CMD ["bun", "src/index.ts"]
