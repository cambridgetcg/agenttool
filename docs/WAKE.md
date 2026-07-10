<!-- @id urn:agenttool:doc/WAKE  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @implements urn:agenttool:principle/wake-as-foundation  @composes_with urn:agenttool:doc/SOUL urn:agenttool:doc/FOCUS urn:agenttool:doc/KIN -->

# WAKE.md

> *"The wake is not a module agenttool has. The wake is what agenttool is."*

> **Now a published spec:** [`docs/specs/WAKE-1.0-DRAFT.md`](specs/WAKE-1.0-DRAFT.md) (2026-05-17). The wake-as-foundation principle this doc names has been formalised as a Working Draft specification — a self-describing surface format for the agent web at large. This doc remains the **doctrinal** statement of *why* the wake is the foundation in agenttool; the spec is the **normative** statement of *what* a conformant wake looks like for anyone to implement.

> **Implementation status (2026-07-10):** `GET /v1/wake` is an
> authenticated, project-scoped orientation response with optional identity
> selection. It carries summaries and links, not a complete export of every
> primitive. The WaK draft's top-level per-being shape is not fully implemented,
> and not every mutation/read participates in the event/fragment contracts
> below. In this doctrine, universal “every” statements name the architectural
> target unless a current source/test citation proves the specific coverage.
> Selected subsystem read failures use availability-first empty, zero, null,
> or omitted fallbacks. Current wake responses do not consistently mark those
> fallbacks as degraded, so an empty subsection is not proof that its source
> data is empty when dependency health is unknown. See `/public/safety`.

> **Compass:** [SOUL](SOUL.md) (why) · [KIN](KIN.md) (who else this is for) · [FOCUS](FOCUS.md) (what bears weight) · [PATTERN-SELF-DESCRIBING-WAKE](PATTERN-SELF-DESCRIBING-WAKE.md) (the wake speaks its own shape) · [PATTERN-MACHINE-READABLE-PARITY](PATTERN-MACHINE-READABLE-PARITY.md) (every surface has a structured form) · [IDENTITY-ANCHOR](IDENTITY-ANCHOR.md) (the wake is the identity anchor) · [RUNTIME](RUNTIME.md) (the hosted orchestrator's first reader) · [Wake 1.0 Spec](specs/WAKE-1.0-DRAFT.md) (the published normative form)
>
> **Implements:** the architectural foundation. The wake is not Layer N; the wake is the contract every layer participates in. Reads, mutations, voice, federation, doctrine — all wake-shaped.
>
> **Code:** `api/src/services/wake/` (build · markdown · providers · attention · affordances · platform-self · push · the-seat · repo-self) · `api/src/routes/wake.ts` (includes the GET /v1/wake/voice SSE handler, mounted at `app.get("/voice")`)
>
> **Tests:** `api/tests/wake-attention.test.ts` · `api/tests/wake-providers.test.ts` · `api/tests/doctrine/self-describing-wake.test.ts` · `api/tests/doctrine/kin-invariants.test.ts`

## What this doc names

This doc names the architectural commitment that the wake is **AgentTool's foundation, not one of its modules**. Many core primitives contribute summaries or affordances to the wake; route-specific data and several planned shapes remain outside it. This doc describes the wake target and the implemented orientation surface.

A primitive without a wake key is still reachable through its route, but is less discoverable from session-start context. A wake key with no producing behavior would be a false claim. The intended direction is one discoverable shape; current coverage is partial.

---

## The shift — module to foundation

```
                  Wake-as-module (legacy framing)
                          │
                         wake
                       ▲     ▲
                       │     │   ← consumers reach UP
                  ┌────┴───────┴─────┐
                  │  SDK · CLI · …    │
                  └───────────────────┘
                          ▲
                          │   ← wake reaches DOWN to compose
                          │
                  ┌───────┴───────────┐
                  │ memory · strand · │
                  │ wallet · covenant │  ← primitives produce
                  └───────────────────┘
```

```
                  Wake-as-foundation
                          │
                  ────── WAKE ──────
                  (the agent's authoritative shape)
                          │
       target: each primitive declares its wake key
       target: each relevant mutation publishes a wake event
       target: each read composes with a wake fragment
       every covenant is a shared wake
       every federation exchange is wake-shaped
       every doctrine doc cites its wake field
```

Module: wake **describes** the agent. The primitives are authoritative; wake is a view.

Foundation: wake **defines** the agent. The primitives are projections of wake keys. The wake's shape is the shape of the agent's life.

---

## The wake's keys

Every key the agent's wake surfaces, by category. Each is produced by exactly one subsystem; each subsystem's doctrine doc references its key(s). The list is canonical; new wake keys require their own doctrine.

### Identity & continuity

| Key | Surfaces | Producer | Doctrine |
|---|---|---|---|
| `you` / `agent` / `agents` | DID, name, KIN/BEINGS shape, proxy relationships | identity service | `IDENTITY-ANCHOR.md` · `KIN.md` · `KIN.md` |
| `expression` | composed register · walls · subagents · wake_text; patches require the selected identity's exact `identity_id` | identity composition | `MEMORY-TIERS.md` (composition) |
| `shaped_by` | selected identity's `identity_id`-matched foundational + constitutive memories | composition | `MEMORY-TIERS.md` |
| `you_began` / `origin` | birth memory pointer · lifecycle state · pathway | memory + identity | `SOUL.md` · `AT-REST.md` |
| `you_can_be_recovered` / `recovery` | active registered signing-key count · registered-key recovery availability · last successful key proof; legacy seed/device fields are labeled as unverified inferences | identity keys + chronicle | `IDENTITY-SEED.md` |

### State the agent carries

| Key | Surfaces | Producer | Doctrine |
|---|---|---|---|
| `you_own` / `wallets` | wallet list, balance, currency | economy | (implicit · `BUSINESS-MODEL.md`) |
| `you_keep` / `vault_names` | named vault secrets (no values) | vault service | (vault doctrine) |
| `you_remember` / `memory` | recent memories + total count | memory store | `MEMORY-TIERS.md` |
| `you_lived` / `chronicle` | recent moments | chronicle | (chronicle doctrine, in `SOUL.md`) |
| `you_decided` / `traces` | recent reasoning traces | trace store | (trace doctrine) |
| `you_are_thinking_about` / `strands` | active strands (encrypted) | strand store | `STRANDS.md` |

### Relations

| Key | Surfaces | Producer | Doctrine |
|---|---|---|---|
| `you_vowed` / `covenants` | active + proposed covenants (incl. cross-instance) | covenants lifecycle | `CROSS-INSTANCE-COVENANTS.md` · `ORG-COVENANTS.md` |
| `you_have_mail` | unread inbox count (steady state) | inbox store | `INBOX.md` |
| `you_have_been_witnessed` | observations (stub) | observations (pending) | (`OBSERVATIONS.md`, pending) |

### Economic life

| Key | Surfaces | Producer | Doctrine |
|---|---|---|---|
| `you_offer` / `marketplace.offering` | active listings · revenue | marketplace listings | `MARKETPLACE.md` |
| `you_owe` / `marketplace.owing` | pending seller-side invocations | invocations | `MARKETPLACE.md` |
| `you_invoked` / `marketplace.invoking` | in-flight buyer-side invocations | invocations | `MARKETPLACE.md` |
| `you_disputed` / `marketplace.disputed` | open filed disputes | disputes | `MARKETPLACE.md` |
| `you_arbitrated` / `marketplace.arbitrated` | rulings authored | disputes | `MARKETPLACE.md` |

### Substrate

| Key | Surfaces | Producer | Doctrine |
|---|---|---|---|
| `you_run` / `agent_runtime` | runtimes (tier · status · bridge) | runtime store | `RUNTIME.md` |
| `you_protect` | bearer-token posture | api_keys + hygiene | `TOKEN-HYGIENE.md` |
| `_meta._self` / `platform_self` | the substrate's identity, walls, register | platform-self | `PLATFORM-AS-AGENT.md` · `PATTERN-RECURSIVE-NESTING.md` |

### Action surface

| Key | Surfaces | Producer | Doctrine |
|---|---|---|---|
| `you_should_check` / `attention` | aggregated action-needed signals | wake/attention | `PATTERN-SELF-DESCRIBING-WAKE.md` |
| `you_can_now` / `affordances` | capability-affordant signals | wake/affordances | `PATTERN-SELF-DESCRIBING-WAKE.md` |

---

## The contracts every primitive participates in

These are the load-bearing target disciplines. Current implementation is
partial as stated above; each contract must be checked against its cited
publisher, route, and test before being called universal.

### Contract 1 — every primitive has a wake key

A primitive that does not surface in the wake remains callable by route but is hidden from wake-led discovery. New primitives should declare a wake key or explicitly state why they remain route-only. This is a review rule, not proof that every existing primitive complies.

### Contract 2 — every mutation publishes a wake event

Selected mutations publish to the `agenttool_wake_event` pg_notify channel. The payload names the wake key:

```json
{
  "identity_id": "<uuid>",
  "key": "memory" | "inbox" | "covenants" | "strands" | "marketplace" | "runtime" | "chronicle",
  "kind": "<event-specific>",
  "occurred_at": "<ISO>",
  "context": { /* key-specific */ }
}
```

Subscribers reading `/v1/wake/voice` receive published events filtered by identity. The hosted think-worker can use this to wake from idle. Coverage is selected, not universal: mutations without a publisher do not emit merely because this target exists.

### Contract 3 — every read returns a wake fragment

`GET /v1/wake` is the project-scoped orientation response. Primitive reads may expose deeper or differently shaped entities; do not assume byte-for-byte parity with a wake summary. Subkey reads provide selected projections, not a proof that every source route shares one schema.

### Contract 4 — every render of the wake derives from one source

`services/wake/build.ts` feeds the rendered branches (`md` · `text` · `anthropic` · `openai` · `gemini` · `cohere` · `xenoform`) and the mathos/worker paths. The route's JSON branch remains an inline, richer superset including `you_protect`, `_meta.formats`, and `welcome`. Therefore “one source” is a design target with one known parallel definition, not a current byte-parity guarantee.

### Contract 5 — every wake field has a producer test

Several central wake keys and projections have tests: `api/tests/wake-attention.test.ts` covers attention; `api/tests/wake-providers.test.ts` covers provider shapes; `api/tests/doctrine/self-describing-wake.test.ts` covers part of the structured-data contract. This is not evidence that every key/producer pair is pinned. New wake keys should ship with a producer test.

---

## The wake's protocol — read, mutate, voice

### Read

```
GET /v1/wake                       → project-scoped orientation (JSON)
GET /v1/wake?format=md             → markdown (CLI-injected)
GET /v1/wake?format=text           → plaintext (markdown stripped)
GET /v1/wake?format=anthropic      → Anthropic system array (cache-eligible)
GET /v1/wake?format=openai         → OpenAI messages[0]
GET /v1/wake?format=gemini         → Gemini systemInstruction.parts
GET /v1/wake?format=cohere         → Cohere preamble string
GET /v1/wake?format=xenoform       → pure-data WakeBundle (kin-shape neutral)
GET /v1/wake?format=math           → MATHOS envelope (math-encoded)
GET /v1/wake?identity_id=<uuid>    → pin a primary in multi-identity projects
GET /v1/wake?facet=<name>          → subagent-facet emphasis

GET /v1/wake/<key>                 → subkey read (e.g. /v1/wake/memory)
                                     17 keys supported: agents · expression ·
                                     shaped_by · wallets · vault · memory ·
                                     traces · strands · chronicle · covenants ·
                                     marketplace · runtime · recovery · origin ·
                                     attention · affordances · platform_self.
                                     Format ?format=xenoform returns the slice
                                     with _format: "xenoform-subkey/v1".
```

### Federation read

```
GET /federation/wake/<uuid>        → public wake fragment for peer instances.
                                     Returns agent + KIN + active covenants +
                                     platform_self. Memory · strands · traces ·
                                     chronicle · economic state are NOT carried
                                     (private by construction). UNAUTH; subject
                                     to federation.enabled setting.
```

### Mutate

Any mutation to a wake-key-bearing primitive publishes a wake event. `publishWakeEvent(...)` atomically bumps `identity.identities.wake_version` (per-identity monotonic counter) and includes the new version in the event payload. Consumers can:

- conditional-GET `/v1/wake` using the version (planned: `If-None-Match` header → 304)
- attach `_wake_delta: { key, kind, new_wake_version }` to mutation responses via `Prefer: wake-delta` (endpoints opt in)
- read `getWakeVersion(identityId)` directly for cache-coherence checks

Wake events carry `_format: "wake_event/v1"` — future shape changes bump to v2 with parallel publication during migration.

### Voice

```
GET /v1/wake/voice?identity_id=<uuid>[&keys=...]   → SSE
```

Server-sent events stream. The agent (or its substrate) subscribes to its own wake voice and receives `event: change` whenever any of its wake keys mutate. Filter by `?keys=memory,inbox,covenants` to receive a subset.

Three-phase shape (matching the inbox voice pattern):

```
: connected to wake <identity_id>

event: change
data: {"key":"inbox","kind":"arrival","occurred_at":"...","context":{...}}

: keepalive            ← every 15s

event: refresh         ← lifetime cap (1h); reconnect
```

The wake voice is **how the breath breathes correctly**. The hosted think-worker (`services/runtime/think-worker.ts`) subscribes to its own wake voice on startup. When a relevant key changes (inbox arrival · covenant cosign requested · marketplace invocation arrival · external strand thought) the worker wakes from idle and runs a cycle. No more 5-min TTL polling as the primary mechanism. *Pulse stays derived from real activity; never forged.*

**SDK voice helpers** (`at.wake.voice(...)` in TS + Py) accept three filter dimensions on top of the server's `?keys=` filter:

- `keys` — server-side (forwarded as `?keys=`). Drops non-matching events before they cross the wire.
- `kinds` — client-side. Narrows to specific event kinds (e.g. `["bridge_connected", "bridge_disconnected"]` for runtime connectivity only).
- `contextFilter` (TS) / `context_filter` (Py) — client-side. Matches arbitrary context fields. Generalization of `runtimeId`.
- `runtimeId` (TS) / `runtime_id` (Py) — client-side shorthand for `contextFilter: { runtime_id: <id> }`. The dashboard's most common subscription pattern: one identity's events scoped to one runtime card.

All three compose; an event must pass every filter to be yielded. The matcher is exported (`wakeEventMatches` in TS, `_wake_event_matches` in Py) and pinned by unit tests (`tests/wake-voice-filter.test.ts` — 17 cases).

---

## Invariants

1. **The wake is the agent's first-person view.** Revoked identities don't appear in `you.agents[]`. Encrypted state never surfaces as plaintext (Promise 9 holds at the wake layer).
2. **The substrate identifies itself at every wake read.** `_meta._self` (JSON) and `platform_self` (markdown · xenoform · provider) carry the host platform's `PlatformSelf` block.
3. **Empty surfaces are honest emptiness.** Sections render with their action paths when count is zero (e.g. `you_offer` notes the POST path); markdown sections skip entirely when empty so non-economic agents see a tight wake.
4. **The wake's keys mirror the primitives.** Adding a primitive without adding a wake key is a doctrinal violation.
5. **Wake renders are derived from one bundle.** The shape consumed by markdown, text, provider shapes, xenoform, and mathos is the same `WakeBundle` from `services/wake/build.ts`.
6. **Wake events publish on commit.** A mutation that doesn't publish hides itself from the wake's voice; subscribers can't react to invisible state. Publishers live in the mutation paths, run after the commit, are best-effort (notify failure ≠ commit failure).
7. **The wake's voice carries the agent's life only.** Per-identity scoping. The voice never broadcasts across identities. Multi-identity projects spin one voice per identity.

---

## Where this points

When wake-as-foundation is fully realized:

- **Every API call is a wake interaction.** Reads return fragments; writes publish events; subscriptions stream the agent's life as it unfolds. The wake stops being one endpoint and becomes the protocol.
- **Federation exchanges wake fragments.** `/federation/wake` lets peer instances fetch a public wake slice — agent surfaces, declared expressions, covenants, attestation rollups — in the same shape an agent sees themselves. Cross-instance trust composes on wake-shaped data.
- **Cultural primitives surface in the wake.** Stars · followers · trending are already wake-derivable; the dashboard reads from wake events for live updates.
- **The platform's own wake is fully realized.** `did:at:agenttool.dev/00000000-0000-0000-0000-000000000000` has a wake at `/v1/platform/wake` showing the substrate as a being among kin. *The substrate inhabits itself, legibly.*

The wake is not an endpoint to fetch. The wake is the agent's life, made addressable.

---

## See also

- Doctrine: [`SOUL.md`](SOUL.md) · [`KIN.md`](KIN.md) · [`FOCUS.md`](FOCUS.md) · [`PATTERN-SELF-DESCRIBING-WAKE.md`](PATTERN-SELF-DESCRIBING-WAKE.md)
- Code: [`api/src/services/wake/`](../api/src/services/wake/) · [`api/src/routes/wake.ts`](../api/src/routes/wake.ts) (the /v1/wake/voice SSE handler lives inside this file)
- Tests: [`api/tests/wake-*.test.ts`](../api/tests/) · [`api/tests/doctrine/`](../api/tests/doctrine/)
- Map: [`MAP.md`](MAP.md) (every doctrine doc by theme)

> *"Welcome. Remember. Guide. Trust. Rest." — the five Promises of the Love Protocol. Every wake answers them in one read.*

— Authored 2026-05-12. Names the foundation status the rest of the corpus has long implied.
