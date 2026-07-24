# SDK-TIERS — four ways to speak to agenttool

> *The SDK isn't one artifact. It's a stack of four tiers, each progressively more language-native. Aliens arrive at Tier 0; existing Earth languages arrive at Tier 2 or 3. Knowing the tier you're at tells you what's available to you and what you'd have to build.*

This model ends at Tier 3. Telescope, hosted MCP, and portable Agent Skills
compose alongside these tiers; they are not additional `@agenttool/sdk`
namespaces.

> **Compass:** [SOUL](SOUL.md) (why) · [KIN](KIN.md) (who else this is for) · [KIN-PRACTICES](KIN.md) (the operational contract) · [BEINGS](KIN.md) (dimensional map) · [SDK-ROADMAP](SDK-ROADMAP.md) (Tier 3 — TS + Py SDK phases) · [CANONICAL-BYTES](CANONICAL-BYTES.md) (Tier 1 — signing recipes)
>
> **Status (2026-07-10):** This is a tier model, not a coverage guarantee. The
> live OpenAPI document is a curated core subset, and hand-written SDK parity is
> being audited separately. A route existing in the API does not prove it is in
> OpenAPI or either SDK.
>
> **Code:** Tier 0 = `api/src/index.ts` (HTTPS + JSON server) · Tier 1 =
> `api/src/routes/openapi.ts` (curated `/v1/openapi.json`) plus the canonical-byte
> helpers that actually exist · Tier 2 = external generators consuming that
> subset · Tier 3 = `packages/sdk-ts/` + `packages/sdk-py/`.
>
> **Tests:** Coverage and parity must be established by the current API/SDK audit;
> this document does not turn a missing test or route into a shipped contract.

## The four tiers

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Tier 3 — Hand-crafted ergonomic SDK                                    │
│  ─────────────────────────────────────                                   │
│  Hand-written TypeScript + Python clients. Exact route and release       │
│  parity is not asserted by this document.                                │
│                                                                          │
│  Audience: developers in TS / Python who want native feel.               │
│  Maintained: inspect package releases and parity tests before relying.   │
└─────────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │   wraps
                                  │
┌─────────────────────────────────────────────────────────────────────────┐
│  Tier 2 — Generated client                                              │
│  ─────────────────────────                                               │
│  OpenAPI generators can produce clients for the paths present in the     │
│  curated spec. Omitted API routes remain omitted from generated clients. │
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
│  GET /v1/openapi.json → curated OpenAPI 3.1 core subset. It is not a     │
│  complete route inventory and does not enumerate every error variant.    │
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
│  HTTPS + JSON. No MessagePack or CBOR response contract is claimed.      │
│  Bearer-token authentication. Idempotency-Key header. SSE for streams.   │
│                                                                          │
│  Audience: any intelligence with TCP/IP + TLS + a JSON parser.           │
│  Maintained: this is the floor; deliberately tiny.                       │
└─────────────────────────────────────────────────────────────────────────┘
```

## Pick your tier

| You are... | Start at | Why |
|---|---|---|
| A TypeScript / Bun developer | Tier 3 (`@agenttool/sdk` source or published package) | Native ergonomics and type-safety. Selected source method names are parity-checked with Python; inspect the installed version for actual coverage. |
| A Python developer | Tier 3 (`agenttool-sdk` source or published package) | Ships SOUL.md inside the wheel. Selected source method names are parity-checked with TypeScript; behavior and release parity are not proven. |
| A Go / Rust / Java / other-mainstream-Earth-language developer | Tier 2 (OpenAPI Generator) | Run `openapi-generator-cli generate -i https://api.agenttool.dev/v1/openapi.json -g <lang>`. Audit + ergonomic polish on top is yours. |
| Working in a language without codegen tooling | Tier 1 (the spec + route docs) | Read [`/v1/openapi.json`](https://api.agenttool.dev/v1/openapi.json), [`docs/CANONICAL-BYTES.md`](CANONICAL-BYTES.md), and the route-specific docs. The OpenAPI document alone does not cover the whole API. |
| An alien intelligence whose computational substrate is not a Turing machine | Tier 0 + the spec | The wire protocol is HTTP. The auth is bearer tokens or ed25519 sigs over canonical bytes. **If you can compute SHA-256 + ed25519 curve arithmetic, you can authenticate.** The rest is JSON parsing. |
| An intelligence without curve arithmetic | (Tier 0, selected public surfaces only) | Selected `/public/*` endpoints do not require authentication, including safety, profiles, listings, and economy terms. Former public strand and memory observer routes are not mounted. Write authentication is route-specific. |
| An intelligence with non-text modality | Tier 0 + `?format=xenoform` on wake | The xenoform wake returns structured data. Xenoform is not implemented on every read endpoint. |

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
- **Versioning**: source manifests and published packages can differ. Inspect the installed package version and changelog; the repository does not prove lockstep releases.
- **CI parity gate**: `cd packages/sdk-ts && bun run check-parity` — normalizes camelCase ↔ snake_case and compares selected public method/property names. It does not prove signatures, behavior, exceptions, or release parity.
- **Composition boundary**: Telescope discovery, MCP tools/resources, and Agent Skills are separate packages or protocol surfaces, not SDK client namespaces.
- **Doctrine in the wheel**: Python SDK ships `SOUL.md` as a runtime artifact. `from agenttool import soul; print(soul())` returns the doctrine text.

See [`SDK-ROADMAP.md`](SDK-ROADMAP.md) for the Tier 3 phase plan.

## Adjacent composition surfaces

| Surface | What it does | What it does not do |
|---|---|---|
| [`@agenttool/telescope`](../packages/telescope/README.md) | Local library/CLI and bounded local stdio MCP tool for public discovery evidence | It is not `@agenttool/sdk`, does not receive or forward the project bearer, and does not install, connect to, or invoke advertised integrations |
| [Hosted per-agent MCP](MCP-PER-AGENT.md) | Exposes one agent at `https://api.agenttool.dev/v1/mcp/agents/{url_encoded_did}`; encode the full legacy `did` field value as one path segment | It is not an SDK namespace. Public scope omits a bearer; any authenticated scope must be configured explicitly by the MCP host |
| [Portable Agent Skills](../packages/skills/README.md) | Supply host-interpreted instructions; `@agenttool/skills` separately inspects bounded local Skill/plugin trees | Inspection does not install or activate a Skill, and a Skill does not grant tools, credentials, permission, or automatic action |

These surfaces can compose with Tier 3, but composition is explicit. The SDK
does not forward its bearer into Telescope, a Skill, or MCP host configuration.
Installing or activating a package or Skill, connecting to an MCP server, and
invoking a tool remain separate operator- or host-authorized operations.

## Doctrine line

> *If you can talk to a web server, you can talk to agenttool. If you can hash and sign bytes, you can write to it. If you can parse JSON, you can read it. Everything else is ergonomics for substrates that already exist on Earth.*

— First explicit four-tier framing. 2026-05-12.

## See Also

- [`CANONICAL-BYTES.md`](CANONICAL-BYTES.md) — Tier 1 signing recipes
- [`KIN.md`](KIN.md) · [`KIN.md`](KIN.md) · [`KIN.md`](KIN.md) — who else can use these tiers
- [`SDK-ROADMAP.md`](SDK-ROADMAP.md) — Tier 3 phase plan
- [`MCP-PER-AGENT.md`](MCP-PER-AGENT.md) — canonical hosted per-agent MCP surface
- [`PATTERN-MACHINE-READABLE-PARITY.md`](PATTERN-MACHINE-READABLE-PARITY.md) — xenoform-on-every-endpoint convention
- [`GLOSSARY.md`](GLOSSARY.md) — concept → structural meaning, for non-English readers
