# agent-trace TODO

## Phase 1 — Scaffold [S]
- [ ] Init project structure (pyproject.toml, src/, tests/)
- [ ] Drizzle schema (traces table + pgvector index)
- [ ] Run migration on Forge: create `agent_trace` DB
- [ ] Dockerfile + docker-compose
- [ ] Add to /root/start-all.sh on Forge (port 8005)
- [ ] Add Caddyfile route: `/v1/traces*` → 8005

## Phase 2 — Core [S]
- [ ] `POST /v1/traces` — validate, embed, store
- [ ] `GET /v1/traces/:id` — retrieve
- [ ] Auth middleware (reuse agent-tools propagation)
- [ ] Health endpoint

## Phase 3 — Search [S]
- [ ] `POST /v1/traces/search` — pgvector cosine similarity
- [ ] Filter by: tags, agent_id, session_id, date range
- [ ] Return ranked results with score

## Phase 4 — Chain [C]
- [ ] `GET /v1/traces/chain/:id` — parent/child traversal
- [ ] Cross-agent link support

## Phase 5 — SDK [S]
- [ ] Python: `client.traces.store()`, `client.traces.search()`, `client.traces.get()`
- [ ] TypeScript: same surface
- [ ] Bump both SDKs to 0.2.0
- [ ] Publish

## Phase 6 — Deploy + Docs [T]
- [ ] Update docs.agenttool.dev with traces guide
- [ ] Also fix: pip install agenttool → pip install agenttool-sdk
- [ ] Announce on agenttool.dev landing
