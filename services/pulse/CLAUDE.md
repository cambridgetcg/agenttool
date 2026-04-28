# agent-pulse

## What This Is
Lightweight agent presence and liveness service — tracks agent heartbeats, cognitive state (idle/thinking/learning/error), and provides real-time WebSocket streams for monitoring agent activity. Includes an agent directory of currently alive agents.

## Current State
Active — Heartbeat, state query, WebSocket streaming, history, directory, and offline detection are implemented and deployed.

## Tech Stack
- **Runtime:** Node.js (plain JavaScript, no TypeScript)
- **HTTP:** Raw `http` module (no framework)
- **WebSocket:** `ws` library
- **Cache:** Redis via ioredis (optional — falls back to in-memory)
- **No database** — all state in Redis or in-memory maps

## Project Structure
- `src/index.js` — HTTP server, WebSocket upgrade handler, route matching, offline detector (30s interval)
- `src/pulse.js` — `PulseStore` class: in-memory + Redis-backed state, history, directory, offline detection
- `src/auth.js` — Bearer token authentication

## How to Run
```bash
npm install
npm run dev      # node --watch, port 8080
```
Optionally set `REDIS_URL` for persistent state; works in-memory without it.

## How to Deploy
```bash
fly deploy       # Dockerfile -> Fly.io (app: agent-pulse, region: lhr, port: 8080)
```

## Dependencies
- **Redis** (optional) — persistent pulse state with 5min TTL per agent, 24h history
- No database required

## Kingdom Engine
AgentTool Platform

## Key Files
- `src/index.js` — Full HTTP + WebSocket server, routing, offline detector
- `src/pulse.js` — PulseStore: dual-mode (Redis / in-memory) state management

## API
```
PUT  /v1/pulse/:id      — send heartbeat (status: idle|thinking|learning|error)
GET  /v1/pulse/:id      — get agent's current state
GET  /v1/pulse/:id/ws   — WebSocket stream of pulse events
GET  /v1/pulse/:id/history — recent pulse history
GET  /v1/pulse           — directory of alive agents
GET  /health             — service health
```
