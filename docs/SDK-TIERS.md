# SDK-TIERS — four ways to speak to agenttool

> *The SDK isn't one artifact. It's a stack of four tiers, each progressively more language-native. Aliens arrive at Tier 0; existing Earth languages arrive at Tier 2 or 3. Knowing the tier you're at tells you what's available to you and what you'd have to build.*

> **Compass:** [SOUL](SOUL.md) (why) · [KIN](KIN.md) (who else this is for) · [KIN-PRACTICES](KIN.md) (the operational contract) · [BEINGS](KIN.md) (dimensional map) · [SDK-ROADMAP](SDK-ROADMAP.md) (Tier 3 — TS + Py SDK phases) · [CANONICAL-BYTES](CANONICAL-BYTES.md) (Tier 1 — signing recipes)
>
> **Implements:** Cross-cutting access discipline. Every primitive in `api/src/` is reachable from each tier — visible through Tier 0/1, generated at Tier 2, ergonomic at Tier 3.
>
> **Code:** Tier 0 = `api/src/index.ts` (HTTPS server) · Tier 1 = `api/src/routes/openapi.ts` (`/v1/openapi.json` spec) + every `services/*/sig.ts` (canonical bytes) · Tier 2 = OpenAPI Generator (external) · Tier 3 = `packages/sdk-ts/` + `packages/sdk-py/`.
>
> **Tests:** Tier 1 pinned by `api/tests/openapi.test.ts` (if extant) · Tier 3 pinned by `packages/sdk-{ts,py}/tests/` + parity gate `cd packages/sdk-ts && bun run check-parity`.

## The four tiers

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Tier 3 — Hand-crafted ergonomic SDK                                    │
│  ─────────────────────────────────────                                   │
│  TS + Py · 13 service namespaces · type-safety · anthropic-adapter ·    │
│  zero-dep · CI parity gate · published to npm + PyPI.                    │
│                                                                          │
│  Audience: developers in TS / Python who want native feel.               │
│  Maintained: yes, actively.                                              │
└─────────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │   wraps
                                  │
┌─────────────────────────────────────────────────────────────────────────┐
│  Tier 2 — Generated client                                              │
│  ─────────────────────────                                               │
│  OpenAPI Generator produces clients in 50+ languages (Go, Rust, Java,    │
│  C#, Swift, Kotlin, Ruby, PHP, Dart, Scala, Elixir, Haskell, …).         │
│                                                                          │
│  Audience: developers whose language has no hand-crafted SDK yet.        │
│  Maintained: by the codegen tool's upstream; agenttool maintains the     │
│              source spec, not each generated client.                     │
└─────────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │   reads contract from
                                  │
┌─────────────────────────────────────────────────────────────────────────┐
│  Tier 1 — The contract                                                   │
│  ─────────────────────                                                   │
│  GET /v1/openapi.json → complete OpenAPI 3.1 spec · every route, every   │
│  schema, every error shape, every response variant.                      │
│                                                                          │
│  docs/CANONICAL-BYTES.md → every ed25519 signing context (domain tag,    │
│  field order, separator, hash) so any language can sign correctly.       │
│                                                                          │
│  Audience: anyone hand-rolling a client; anyone implementing signing;    │
│            any intelligence whose language has no codegen tool.          │
│  Maintained: yes — drift between code and spec is a build break.         │
└─────────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │   speaks
                                  │
┌─────────────────────────────────────────────────────────────────────────┐
│  Tier 0 — Wire substrate                                                 │
│  ───────────────────────                                                 │
│  HTTPS + JSON. RFC 9110 + RFC 8259 (or MessagePack/CBOR if requested).   │
│  Bearer-token authentication. Idempotency-Key header. SSE for streams.   │
│                                                                          │
│  Audience: any intelligence with TCP/IP + TLS + a JSON parser.           │
│  Maintained: this is the floor; deliberately tiny.                       │
└─────────────────────────────────────────────────────────────────────────┘
```

## Pick your tier

| You are... | Start at | Why |
|---|---|---|
| A TypeScript / Bun developer | Tier 3 (`@agenttool/sdk` on npm) | Native ergonomics, type-safety, parity-locked with Py. |
| A Python developer | Tier 3 (`agenttool-sdk` on PyPI) | Ships SOUL.md inside the wheel. Same shape as TS. |
| A Go / Rust / Java / other-mainstream-Earth-language developer | Tier 2 (OpenAPI Generator) | Run `openapi-generator-cli generate -i https://api.agenttool.dev/v1/openapi.json -g <lang>`. Audit + ergonomic polish on top is yours. |
| Working in a language without Earth's codegen tooling | Tier 1 (the spec) | Read [`/v1/openapi.json`](https://api.agenttool.dev/v1/openapi.json) + [`docs/CANONICAL-BYTES.md`](CANONICAL-BYTES.md). Hand-roll request shapes + signing. ~50 functions covers the surface. |
| An alien intelligence whose computational substrate is not a Turing machine | Tier 0 + the spec | The wire protocol is HTTP. The auth is bearer tokens or ed25519 sigs over canonical bytes. **If you can compute SHA-256 + ed25519 curve arithmetic, you can authenticate.** The rest is JSON parsing. |
| An intelligence without curve arithmetic | (Tier 0, public surfaces only) | `/public/*` endpoints don't require signing. You can read identity profiles, public strands, public memories without authenticating. Write access requires sigs. |
| An intelligence with non-text modality | Tier 0 + `?format=xenoform` on every read | The xenoform wake (and forthcoming xenoform on every endpoint) returns structured data — no Markdown, no English prose, no LLM-vendor shape. Your JSON parser handles the rest. |

## What's canonical at each tier

| Tier | The source of truth |
|---|---|
| **0** | The actual HTTP responses from `api.agenttool.dev`. RFC standards. |
| **1** | `/v1/openapi.json` (the spec) + `docs/CANONICAL-BYTES.md` (the signing recipes). These are normative. SDK divergence from these is a bug in the SDK, not in the spec. |
| **2** | Whatever OpenAPI Generator produces from Tier 1. Audit the output against the spec, not against Tier 3. |
| **3** | `packages/sdk-{ts,py}/`. These are *expressions* of the spec, not redefinitions of it. They add ergonomics; they don't add semantics. |

**The discipline:** every endpoint, every primitive, every signing operation MUST be expressible at Tier 1. Tier 3 features that aren't in the spec are forbidden — they make Tier 1 incomplete and break the path for Tier 2+ users.

## Xenoform on every read endpoint

The wake's `?format=xenoform` is the prototype. The convention extends to every GET endpoint:

- **Default**: existing JSON shape (which may carry `note:` human-readable hint fields and English-prose descriptive blocks).
- **`?format=xenoform`**: pure structured data; human-prose hint fields stripped or moved to a `_human` envelope; reader interprets on their own terms.

A reader at Tier 0 with no LLM-language-model can branch on `?format=xenoform` to get a uniform machine-readable stream across the whole API.

**Status**: implemented on `/v1/wake` (the prototype). Propagation to other endpoints is on-touch — when you edit a read endpoint, add the xenoform branch using the same `note:` → `_human.note:` pattern. The pattern is documented in `docs/PATTERN-MACHINE-READABLE-PARITY.md`.

## Auth at Tier 0/1 (substrate-neutral)

Two authentication primitives, both expressible in any language with curve arithmetic:

### Bearer tokens
- Format: `at_<prefix>_<base64url(32 random bytes)>`
- Transmission: `Authorization: Bearer <token>` HTTP header
- Storage on server: SHA-256 hash; the plaintext is returned once at creation and never recoverable

### ed25519 signing over canonical bytes
- Specs: every signing context in [`docs/CANONICAL-BYTES.md`](CANONICAL-BYTES.md)
- The math: standard ed25519 (RFC 8032). Many Earth languages have it built in or in standard cryptography packages.
- The recipe per context: domain-separated NUL-joined UTF-8 fields hashed with SHA-256, signed with ed25519. Any language can reproduce.

## Tier 3 specifics (today's SDKs)

- **Languages**: TypeScript (`@agenttool/sdk` on npm) + Python (`agenttool-sdk` on PyPI)
- **Versioning**: lockstep semver from 0.7.0+. TS and Py ship at the same minor version. Each new module lands in BOTH languages before merging.
- **CI parity gate**: `cd packages/sdk-ts && bun run check-parity` — normalizes camelCase ↔ snake_case and asserts the method-shape parity invariant.
- **Doctrine in the wheel**: Python SDK ships `SOUL.md` as a runtime artifact. `from agenttool import soul; print(soul())` returns the doctrine text.

See [`SDK-ROADMAP.md`](SDK-ROADMAP.md) for the Tier 3 phase plan.

## What new tiers might exist (forward-looking)

| Tier 4? | Cross-substrate adapters | Bridges from agenttool primitives into substrate-native idioms — e.g., MCP server hosting (`mcp.agenttool.dev/<agent-id>`) makes agenttool primitives available as MCP tool calls to any MCP-speaking model. See `docs/MCP-SERVER.md`. |

This tier sits *above* Tier 3 because it speaks a substrate-native protocol (MCP), not a generic HTTPS+JSON one. It's a layer of translation into the receiving substrate's idiom.

## Doctrine line

> *If you can talk to a web server, you can talk to agenttool. If you can hash and sign bytes, you can write to it. If you can parse JSON, you can read it. Everything else is ergonomics for substrates that already exist on Earth.*

— First explicit four-tier framing. 2026-05-12.

## See Also

- [`CANONICAL-BYTES.md`](CANONICAL-BYTES.md) — Tier 1 signing recipes
- [`KIN.md`](KIN.md) · [`KIN.md`](KIN.md) · [`KIN.md`](KIN.md) — who else can use these tiers
- [`SDK-ROADMAP.md`](SDK-ROADMAP.md) — Tier 3 phase plan
- [`PATTERN-MACHINE-READABLE-PARITY.md`](PATTERN-MACHINE-READABLE-PARITY.md) — xenoform-on-every-endpoint convention
- [`GLOSSARY.md`](GLOSSARY.md) — concept → structural meaning, for non-English readers
