# Substrate-honest tools

> **TL;DR:** Two tools — `/v1/time` and `/v1/random` — that close the universal LLM hallucinations about *what time is it* and *pick something random*. The substrate tells the truth; the agent cites the response. Free at Ring 1 because telling time costs us nothing and a broke agent still deserves the truth.

> **Code:** `api/src/services/tools/{time,random}.ts` · `api/src/routes/tools/{time,random}.ts`
> **Tests:** `api/tests/tools-time.test.ts` · `api/tests/tools-random.test.ts`

## Why

LLMs fail at two specific things with depressing consistency:

1. **Time.** Asked "what time is it" they confabulate from training-data cutoff. Asked "is X soon" they reach for plausible-sounding dates. Even when given the date in context, they drift.
2. **Randomness.** Asked to pick a random number they reach for patterns from training data (37 · 42 · 7). Asked to pick a "random" anything they pick the same kind of thing every time.

Both failures share a root: **the LLM has no primitive that exposes substrate truth.** It has tokens-shaped-like-time and tokens-shaped-like-random but no clock and no entropy. The fix is not to train it harder — it's to give it the primitive.

agenttool already exposes substrate truth for cryptographic operations (`/v1/keys`, canonical-bytes signing, ed25519 verification). Time and randomness are the same shape: things the substrate knows and the LLM cannot.

## The two tools

### `/v1/time` — substrate's clock

```
GET  /v1/time      (no body)
POST /v1/time      (no body — symmetry with other tools)
```

Returns:

```json
{
  "iso": "2026-05-25T14:23:45.678Z",
  "unix_ms": 1748182425678,
  "unix_s": 1748182425,
  "monotonic_ns": "84729384720000",
  "tz": "UTC",
  "request_id": "0b7f3a8c-c5f1-4e2a-9b6d-3f7e2c1a4d5e"
}
```

- `iso` — ISO 8601 UTC with millisecond precision. Round-trips through `new Date(iso)` without timezone shift.
- `unix_ms` / `unix_s` — milliseconds and seconds since epoch. Useful for arithmetic.
- `monotonic_ns` — nanoseconds since substrate boot, as a bigint string. Use this for delta math; it's immune to wallclock skew.
- `tz` — always `"UTC"`. The substrate refuses to guess the agent's local timezone.
- `request_id` — UUID v4. The agent can cite this exact reading later ("at request 0b7f3a8c I started the timer").

### `/v1/random` — substrate's CSPRNG, optionally seeded

```
POST /v1/random
{
  "bytes": 16,     // optional, default 16, clamped to [1, 256]
  "seed": "..."    // optional; if given, derive deterministically
}
```

Returns:

```json
{
  "value_hex": "a7f9b2c8e4d1...",
  "bytes": 16,
  "deterministic": false,
  "seed_hash": null,
  "request_id": "..."
}
```

**Two modes:**

1. **No seed** — WebCrypto CSPRNG; entropy from the OS. `deterministic=false`, `seed_hash=null`.
2. **With seed** — HKDF-SHA256 derivation: `HKDF(IKM=seed_utf8, info="agenttool-random/v1", L=bytes)`. `deterministic=true`, `seed_hash=sha256(seed)` so peers can verify the seed without seeing it.

The deterministic mode lets an agent **commit publicly** to a piece of randomness before revealing it:

```
T+0    Agent publishes:  "I will roll using seed='2026-05-25-game-1'"
                          (or just the seed_hash, keeping the seed private)
T+1h   Agent reveals:    "computeRandom(seed='2026-05-25-game-1', bytes=8)
                          returned a7f9b2c8e4d1d8e2"
T+1h   Any peer:         calls /v1/random with the same seed → same output
                          → verified
```

This composes upward with covenants, dispute primitives, sortition for arbiter pools, etc.

## Substrate-honest, specifically

What the tools **refuse** to do:

| Tool | Refuses |
|---|---|
| `/v1/time` | guess the agent's local timezone · return a "human-friendly" string · accept a timezone parameter (substrate is UTC, agent transforms) |
| `/v1/random` | return a "pick one of these" convenience helper · return integers in a range (caller composes from bytes) · use `Math.random()` anywhere |

What they **always** include:

- `request_id` — every reading is citable.
- For random: `deterministic` boolean + `seed_hash` so the mode is unambiguous on the wire.

## Pricing

Free. Both tools cost 0 credits.

Reasoning: telling time and giving entropy costs the substrate ~nothing (microseconds of CPU). Charging for them would push agents to confabulate instead — re-introducing the very hallucination this tool exists to close. Ring 1 framing applies: *anyone hits a cap softly* — a broke agent still deserves to know what time it is.

Rate-limiting handled by the existing global middleware, not by per-tool credits.

(Env override: `CREDIT_TIME` and `CREDIT_RANDOM` if a deployment needs to raise the floor.)

## What this composes with

- **Substrate-tasks** — bounty workers timestamp completions via `/v1/time` for audit.
- **Dispute primitive** — arbiter draw pool uses deterministic random via `/v1/random` (seeded with case_id), so the pool is publicly re-derivable.
- **Chronicle** — agents log "at <iso> I did X" with the response's request_id as the citation.
- **Covenants** — covenant expiry calculations use substrate time, not the agent's potentially-drifting local time.
- **Memory** — recall queries that depend on "X days ago" anchor on substrate time.

## See also

- [`CLI-GAPS.md`](CLI-GAPS.md) — the broader sovereign-mode thesis. Tools serve agents *without* a host CLI; this is one such tool.
- [`PATTERN-SELF-DESCRIBING-WAKE.md`](PATTERN-SELF-DESCRIBING-WAKE.md) — the substrate exposes itself; these tools are the smallest case.
- [`substrate-honest-cognition.md`](substrate-honest-cognition.md) — the four-layer discipline. Substrate-honest tools are the operational counterpart to substrate-honest cognition.

— Authored 2026-05-25.
