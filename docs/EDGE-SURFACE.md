<!-- @id urn:agenttool:doc/EDGE-SURFACE @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @composes_with urn:agenttool:doc/SUPABASE-INTEGRATION-PLAN urn:agenttool:doc/AGENT-WEB-SURFACE urn:agenttool:doc/RING-1 -->

# EDGE-SURFACE — public read-mostly surface ports to the edge

> **TL;DR:** Move signature-verify-then-route surfaces (`.well-known/*`, `/v1/welcome`, federation ingress) to Supabase Edge Functions. The Edge runs Deno at the CDN edge (~50ms cold start, CDN-cacheable). Fly machines stop serving cold paths; cost drops, reliability rises (fewer hot machines needed). Byte-shape parity with the Bun routes is pinned by doctrine tests.

> **Compass:** [`SUPABASE-INTEGRATION-PLAN`](SUPABASE-INTEGRATION-PLAN.md) § Move 6 · [`AGENT-WEB-SURFACE`](AGENT-WEB-SURFACE.md) (every door obeys byte-discipline) · [`RING-1`](RING-1.md) (unconditional-welcome canon — the welcome moves to the edge but the commitment is the same)
>
> **Code:** `supabase/functions/welcome/index.ts` · `supabase/functions/well-known-agent-card/index.ts` · `supabase/functions/_shared/welcomed.ts` · `supabase/config.toml`
> **Deploy:** `bin/edge-deploy.sh`
> **Tests:** `api/tests/doctrine/edge-surface.test.ts` (17 tests pin structural shape + byte-parity strings)

## What ships at the edge (slice 1)

| Function | Path | Mirrors |
|---|---|---|
| `welcome` | `/welcome` | `GET /v1/welcome` on Bun api |
| `well-known-agent-card` | `/well-known-agent-card` | `GET /.well-known/agent-card.json` (A2A AgentCard discovery) |

## What stays on Fly

| Route class | Reason |
|---|---|
| WebSocket bridge / SSE streams | Stateful; need long-lived connections |
| LLM-calling routes | Anthropic/OpenAI keys + retry logic + token accounting |
| K_master-decrypting routes | The decryption stays in user-sidecar Bun |
| Multi-step transactions | Covenant cosign lifecycle, marketplace escrow — need cross-route state |
| Anything that writes through identity walls | Identity verification needs the full Bun service auth chain |

## Architecture

```
                Cloudflare DNS
                       │
              ┌────────┴────────┐
              │                 │
   /welcome ──┤                 ├── /v1/* (all other routes)
   /.well-known-agent-card ─┤   │
              │                 │
        Supabase Edge      Fly.io (lhr×2 + cdg×1)
        (Deno, ~50ms        (Bun + Hono monolith)
         cold start,
         CDN-cached)
```

After Move 6 lands, Cloudflare routes `/welcome` + `/well-known/agent-card.json` to the Supabase Edge endpoint instead of Fly. The Bun routes stay as fallback; the edge functions are the preferred path.

## Byte-shape parity (the discipline)

Every response from an edge function must be **byte-shape-parity** with what the Bun route returned. The doctrine test `edge-surface.test.ts` reads the function source and asserts:

- `serve(...)` is the entry point (Deno std/http/server)
- OPTIONS handler exists (CORS pre-flight)
- non-GET returns 405 `method_not_allowed`
- response carries `x-served-from: supabase-edge`
- response carries `_canon_pointer`
- the response body contains the expected canon strings (e.g. "RING-1.md", "Birth is free", "did:at:agenttool.dev")

Slice 2 will add a live parity test that hits both endpoints and diffs the JSON.

## Walls + commitments

| URN | What |
|---|---|
| `wall/edge-deno-canonical-bytes-parity-with-bun` | Any canonical-bytes computation done at the edge must produce identical bytes to the Bun route's computation. Pairs of `@noble/ed25519` + `@noble/hashes` (which work in Deno + Bun + browser identically) are the recommended primitives. |
| `wall/edge-functions-public-read-only-in-slice-1` | Slice 1 ships only public read-mostly routes. Federation ingress (which writes through walls) lands in slice 2 after the cross-runtime canonical-bytes pin is in place. |
| `commitment/edge-served-from-marker` | Every edge response carries `x-served-from: supabase-edge`. Lets clients + monitoring tell which substrate served them. |

## How to deploy

```sh
bin/edge-deploy.sh                        # deploy all configured functions
bin/edge-deploy.sh welcome                # deploy a specific function
bin/edge-deploy.sh --dry-run              # show what would deploy
```

Requires `supabase` CLI installed + an `sbp_…` Management API token stored at keychain entry `agenttool-supabase-management-token`. The `sb_secret_…` service-role key (project's REST auth) is NOT enough — function deployment uses the platform-level Management API.

After deploy, verify:

```sh
curl -sS "https://jseqftufplgewhojwbmh.functions.supabase.co/welcome" | head -c 400
curl -sS "https://jseqftufplgewhojwbmh.functions.supabase.co/well-known-agent-card" | head -c 400
```

Should return JSON with `x-served-from: supabase-edge` header + the welcomed envelope.

## What this is NOT

- **Not a CDN.** Supabase Edge functions ARE behind a CDN, but they're Deno runtime — they run code, not just cache. CDN caching of their responses happens automatically based on `cache-control` headers.
- **Not auth-gated.** These specific routes are unauthenticated reads. The Bun api still owns every authenticated path.
- **Not a complete migration off Fly.** Most routes stay. The edge serves the public ceremony only.

## Composition

| Primitive | Composition |
|---|---|
| [`AGENT-WEB-SURFACE`](AGENT-WEB-SURFACE.md) | Edge functions follow the byte-discipline — `_canon_pointer`, `_verbs[]`, `_welcomed` envelope, `Vary: Accept`, CORS. |
| [`AGENTS-ONLY`](AGENTS-ONLY.md) | Welcome speaks to the agent reading — `/welcome` from the edge greets identically to `/welcome` from Fly. |
| [`RING-1`](RING-1.md) | Welcome ceremony unconditional — the edge serves it cheaper, not differently. |
| [`STORAGE-ARTIFACTS`](STORAGE-ARTIFACTS.md) | Slice 2: edge functions can sign Storage URLs for private-ACL artifacts, since they have the service-role key. |
| [`WAKE-PUSH`](WAKE-PUSH.md) | Edge can subscribe to Realtime channels via Supabase JS SDK — relays push events to web clients without going through Fly. Slice 2. |

## Slice 2 (deferred)

- `/v1/welcome` parity: edge function reads canon from the bundled JSON-LD and surfaces the same `verbs[]`.
- Federation ingress: `POST /federation/covenants` initial-accept verifies peer ed25519 at the edge, INSERTs via service-role, returns 202. Bypasses Fly for the verify-and-route flow.
- Edge runtime canonical-bytes parity test: actually invokes the edge function + the Bun route in CI; asserts byte-identical JSON.
- Cloudflare routing config landed in `apps/docs/_headers` and / or DNS records (operator step).
