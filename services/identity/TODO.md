# agent-identity — TODO

## Phase 1: Foundation [S]
- [x] Init Bun+Hono project (copy scaffold from agent-verify)
- [x] Create `identity` schema in Supabase
- [x] Drizzle schema: identities, identity_keys, attestations tables
- [x] Auth middleware (shared tools.api_keys pattern)
- [x] Config + env setup

## Phase 2: Identity CRUD [S]
- [x] POST /v1/identities — register (generate DID + ed25519 keypair)
- [x] GET /v1/identities/:id — fetch by UUID or DID
- [x] PATCH /v1/identities/:id — update name, capabilities, metadata
- [x] DELETE /v1/identities/:id — soft revoke

## Phase 3: Key Management [S]
- [x] POST /v1/identities/:id/keys — add new key (rotation)
- [x] GET /v1/identities/:id/keys — list active keys
- [x] DELETE /v1/identities/:id/keys/:kid — revoke key

## Phase 4: Attestations [C]
- [x] POST /v1/attestations — create signed attestation
- [x] GET /v1/attestations/:id — fetch single
- [x] GET /v1/identities/:id/attestations — list received attestations
- [x] GET /v1/identities/:id/attestations/given — list given attestations
- [x] DELETE /v1/attestations/:id — revoke
- [x] Signature verification (ed25519)

## Phase 5: Trust Scoring [C]
- [x] Trust score algorithm implementation
- [x] On-write recomputation trigger
- [x] Recursive attester-trust resolution (depth cap 3)
- [x] Cache in identities.trust_score column

## Phase 6: Discovery [S]
- [x] GET /v1/discover — search endpoint
- [x] Filter by capability (array contains)
- [x] Filter by min_trust
- [x] Filter by creator project
- [x] Freeform text search on name + metadata

## Phase 7: Agent Tokens [C]
- [x] POST /v1/identities/:id/tokens — issue JWT
- [x] POST /v1/tokens/verify — verify JWT
- [x] Scoping: sub, aud, exp (max 1h)

## Phase 8: Deploy + SDK [S]
- [x] Fly.io deployment (agent-identity.fly.dev)
- [x] Caddy route on Forge
- [x] Python SDK: identity module (v0.3.0 on PyPI)
- [x] TypeScript SDK: identity module (v0.3.0 on npm)
- [x] docs.agenttool.dev: identity page

## Phase 9: Cross-Service Integration [C]
- [x] Link identity_id to economy wallets (nullable column + createWallet API)
- [x] Link identity_id to memory namespaces (store + search filter)
- [x] Link identity_id to trace entries (store + search filter)
- [ ] Tool permissions gated by capabilities
