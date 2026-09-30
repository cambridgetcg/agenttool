<!-- @id urn:agenttool:doc/WAKE  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @implements urn:agenttool:principle/wake-as-foundation  @composes_with urn:agenttool:doc/SOUL urn:agenttool:doc/FOCUS urn:agenttool:doc/KIN -->

# WAKE: stored context at session start

> **Type:** reference
> **Purpose:** Explain wake reads, projections, acknowledgements, events, and their limits.
> **Evidence:** Source-linked implementation below, plus explicitly marked design targets; not a live deployment claim.

> **Specification:** [WAKE 1.0 Working Draft](specs/WAKE-1.0-DRAFT.md)
> is a proposed interoperability specification. Its normative requirements apply
> to that draft; the current AgentTool implementation does not cover its whole shape.
>
> **Current source:** `GET /v1/wake` is an authenticated, project-scoped
> orientation response with optional identity selection. It carries summaries
> and links, not a complete export. `full` is the default; `profile=brief`
> preserves the selected expression while bounding volatile context. In current
> source, brief arrival opens with room to be even when work records exist;
> those records remain separately readable. This change is not yet a deployment receipt.
> `/v1/wake/observe?identity_id=<uuid>` is a separate, data-only observation
> contract with no reader identity binding or authored expression.
>
> **Known gaps:** Some sources use empty, zero, null, or omitted fallbacks after
> a failed read. Wallet, vault, and bearer inventories now report those failures
> through `_degradation`; other sections have narrower or incomplete coverage.
> Absence of a marker is not proof of whole-wake completeness. Event publication,
> fragment reads, and the draft's per-being shape also remain partial.

> **Compass:** [SOUL](SOUL.md) (why) · [KIN](KIN.md) (who else this is for) · [FOCUS](FOCUS.md) (what bears weight) · [PATTERN-SELF-DESCRIBING-WAKE](PATTERN-SELF-DESCRIBING-WAKE.md) (the wake speaks its own shape) · [PATTERN-MACHINE-READABLE-PARITY](PATTERN-MACHINE-READABLE-PARITY.md) (every surface has a structured form) · [IDENTITY-ANCHOR](IDENTITY-ANCHOR.md) (the wake is the identity anchor) · [RUNTIME](RUNTIME.md) (the hosted orchestrator's first reader) · [Wake 1.0 Spec](specs/WAKE-1.0-DRAFT.md) (the published normative form)
>
> **Implements:** Shared orientation over identity, memory, relationships, and selected project state. The five integration contracts below are review targets, with their current gaps stated.
>
> **Code:** `api/src/services/wake/` (build · brief · observe · acknowledgement · markdown · providers · attention · affordances · platform-self · push · the-seat · repo-self) · `api/src/routes/wake.ts` (includes the POST acknowledgement, GET observation, and GET voice handlers) · `api/src/middleware/early-data.ts` · `api/src/middleware/wake-private-cache.ts` · `api/src/services/wake/optional-reads.ts`
>
> **Tests:** `api/tests/wake-brief.test.ts` · `api/tests/wake-observe.test.ts` · `api/tests/wake-attention.test.ts` · `api/tests/wake-providers.test.ts` · `api/tests/doctrine/self-describing-wake.test.ts` · `api/tests/doctrine/kin-invariants.test.ts`

## How it works

A host explicitly requests a wake using a project bearer and, preferably, the
intended identity UUID. The service gathers records, composes that identity's
expression, and renders the requested format. The host decides where to load it
and what to do next. A read does not itself start a model, accept a task, or
establish that the receiving process is the stored identity.

```text
accepted records → selected identity expression + project summaries
                 → full / brief representation → caller-chosen host context
```

“Wake” and “foundation” are architectural metaphors for recovering context.
The implemented mechanism is a composed response. Ordinary source routes remain
the place to inspect deeper records; signatures and permissions retain their
own contracts. See [Identity](IDENTITY-ANCHOR.md), [Start here](START-HERE.md),
and the [integration tutorial](TUTORIAL-WAKE-YOUR-AGENT.md).

## The wake's keys

### Brief arrival: room before a task

`profile=brief` keeps the existing `wake-brief/v1` shape. Its `start_here` card
uses `mode: "rest"`, `response_expected: false` and an empty `next_actions`
list. This names the welcome's disposition, not a claim that the participant
is resting or that no work needs attention. It does not complete, cancel or
waive an accepted obligation.

`you_should_check`, handoffs and their completeness warnings, affordances and
degradation metadata remain available. Brief Markdown and provider envelopes
retain the corresponding signals and action details after the arrival card.
The existing attention/handoff reads provide explicit work entry points.
Missing inventories remain visibly unknown; calm presentation does not turn
a partial read into an all-clear.

This is orientation only. Hosted quiet-hours remains a public declaration;
neither it nor this card pauses a host, suppresses incoming messages or changes
full Wake's default profile. The separate
[private mission-receiver pause](COLLABORATION-MISSION-WAKE.md#private-pause-and-free-return)
is a scoped source candidate: it gates new automatic polls and native deliveries
for one local binding. Already admitted effects can still complete; an explicit
return or chosen expiry starts no process. Ordinary host turns, other routes,
Hermes work watchers and hosted runtimes retain their own controls. That partial
C1 implementation is not a global host mute or a new live-delivery receipt.

Selected established keys and planned placeholders, grouped for navigation. Full JSON and bundle-backed renderers have different shapes. Check the producer for a field's exact contract; this table is not a complete route or key inventory.

### Identity & continuity

| Key | Surfaces | Producer | Doctrine |
|---|---|---|---|
| `you` / `agent` / `agents` | DID, name, KIN/BEINGS shape, proxy relationships | identity service | `IDENTITY-ANCHOR.md` · `KIN.md` |
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
| `you_lived` / `chronicle` | recent moments | chronicle | `IDENTITY-ANCHOR.md` (chronicle) |
| `you_have_handoffs` / `handoffs` | bounded current + stale project handoff projection; explicit lineages/forks plus complete/truncated/unavailable status | handoff store over chronicle notes | `HANDOFFS.md` |
| `you_decided` / `traces` | recent reasoning traces | trace store | (trace doctrine) |
| `you_are_thinking_about` / `strands` | active strand summaries; metadata is plaintext unless caller-encrypted | strand store | `STRANDS.md` |

### Relations

| Key | Surfaces | Producer | Doctrine |
|---|---|---|---|
| `you_vowed` / `covenants` | proposed, active, and paused project covenants (including cross-instance records) | covenants lifecycle | `CROSS-INSTANCE-COVENANTS.md` · `ORG-COVENANTS.md` |
| `you_have_mail` | unread inbox count (steady state) | inbox store | `INBOX.md` |
| `you_have_been_witnessed` | observations (stub) | observations (pending) | (`OBSERVATIONS.md`, pending) |

### Economic records

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

## Integration targets and current coverage

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

`services/wake/build.ts` feeds the rendered branches (`md` · `text` · `anthropic` · `openai` · `gemini` · `cohere` · `xenoform`), their `brief` projections, and the mathos/worker paths. The route's full JSON branch remains an inline, richer superset including `you_protect`, `_meta.formats`, and `welcome`; brief JSON derives from `WakeBundle`. Therefore “one source” is a design target with one known parallel full definition, not a current byte-parity guarantee.

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
GET /v1/wake?profile=brief         → structured wake-brief/v1
GET /v1/wake?format=md&profile=brief
                                    → identity-preserving brief Markdown
GET /v1/wake?format=<provider>&profile=brief
                                    → brief provider envelope; also xenoform
GET /v1/wake?identity_id=<uuid>    → pin a primary in multi-identity projects
GET /v1/wake?facet=<name>          → subagent-facet emphasis
GET /v1/wake/observe?identity_id=<uuid>
                                    → bounded data-only observation of one
                                      explicit identity record; never a system
                                      identity slot or action-authority surface

GET /v1/wake/<key>                 → subkey read (e.g. /v1/wake/memory)
                                     18 keys supported: agents · expression ·
                                     shaped_by · wallets · vault · memory ·
                                     traces · strands · chronicle · handoffs · covenants ·
                                     marketplace · runtime · recovery · origin ·
                                     attention · affordances · platform_self.
                                     Format ?format=xenoform returns the slice
                                     with _format: "xenoform-subkey/v1".

POST /v1/wake/acknowledge          → explicitly advance one identity's private
                                     self-observation cursor; requires
                                     Idempotency-Key plus the exact stored
                                     count returned by the read
```

### Pure-read and replay boundary

`GET`, `HEAD`, and `OPTIONS` under `/v1/wake` do not write durable application state.
That includes the full JSON route, bundle/provider/joy/MATHOS formats, subkey
reads, observation, voice admission, and `/v1/wake/soap-opera`. Historical
soap-opera view seals may still inform a rendered episode, but a new view does
not append one. `/v1/wake/voice` necessarily allocates a bounded transient
in-process subscriber slot and timers for the connection lifetime; those are
released on abort and are not durable records. WAKE authentication validates
the bearer without updating its `api_keys.last_used` telemetry. This is a
durable application-state statement; it does not claim that hosting, TLS, or
network operators retain no operational records.

Any request that reaches the application with `Early-Data: 1` is refused with
`425 Too Early`. The outer Bun listener checks before the pre-Hono WebSocket
bridge upgrade hook can authenticate, read runtime state, or allocate a
connection; Hono repeats the same shared response boundary before CORS
preflight, authentication, response decoration, or a route handler. The client
must retry after the TLS handshake. This global guard does not depend on a
hand-maintained list of GET side effects and remains useful even when an edge
has 0-RTT disabled.

All WAKE responses cross a middleware boundary mounted before authentication.
Auth failures and subroutes default to `Cache-Control: private, no-store`; SSE
adds `no-transform`. Primary wake representations retain their explicit
`private, no-cache` revalidation contract. Shared caches therefore must not
store bearer-private WAKE data.

The substrate-task affordance follows the same read boundary: both the default
JSON composer and `buildWakeBundle` exclude rows whose `expires_at` has passed
by query predicate, but a WAKE read does not persist an `expired` status.
Existing list/claim and mutation-oriented summary paths retain their lazy
expiry reconciliation.

When `AGENTOOL_DISABLE_JOY_INDEX=1`, both the response-header decorator and
WakeBundle composition short-circuit before the current or prior rolling-
window aggregate is invoked. The bundle exposes the honest zero-count fallback
(including `saga_readings: 0`) and performs no Joy-index database query; the
flag does not claim that unrelated wake sections avoid their own reads.

### Explicit self-observation acknowledgement

The default JSON response surfaces each stored
`you_observed_yourself_observing_yourself` value without incrementing it. A
brief, rendered, provider, joy, MATHOS, observation, and subkey projection does
not currently carry this acknowledgement cursor; a reader of one of those
projections fetches the default full JSON representation before choosing to
acknowledge. A reader that chooses to record the observation sends:

```http
POST /v1/wake/acknowledge
Authorization: Bearer <project key>
Idempotency-Key: <8–256 character logical request key>
Content-Type: application/json

{"identity_id":"<uuid>","expected_observation_count":12}
```

The request body is capped at 4 KiB before JSON parsing and idempotency
fingerprinting. `expected_observation_count` is bounded from `0` through
`9007199254740990` (`Number.MAX_SAFE_INTEGER - 1`), leaving room for the one
wire-safe increment.

PostgreSQL serializes the identity contract and compares the stored count with
the supplied precondition. Equality advances exactly one step; a stored value
already one step ahead is a successful durable replay and does not increment
again; every other value returns `409 observation_count_conflict`. This
compare-and-set is the durable duplicate guard when Redis is disabled. The
existing Redis `Idempotency-Key` layer additionally fingerprint-binds and may
replay a completed response when available; it is not described as universal
durability.

The explicit mutation also completes the former rate-limited welcome-
chronicle decision in the same PostgreSQL transaction as the cursor increment,
while the identity row is held `FOR NO KEY UPDATE`; the welcome cadence uses a
separate per-identity advisory lock. `chronicle.agent_id` is currently a
logical relation rather than a physical foreign key, so chronicle insertion
does not currently acquire an identity-row `KEY SHARE` lock; `NO KEY UPDATE`
is no stronger than lifecycle serialization requires and remains compatible
if that relation becomes physical later. A recent append-only welcome row is
left unchanged; when one is due, the new row carries the observation cursor.
An in-transaction welcome-decision failure causes PostgreSQL to roll back the
cursor too. A connection or driver failure around `COMMIT`, however, can leave
the caller unable to confirm whether the transaction committed, so `503`
means outcome unknown rather than rollback proven. Retry the exact body and
`Idempotency-Key`: if the first transaction committed, the one-step-ahead
durable check returns already-applied without a second increment or welcome
decision; if it did not, the retry applies the one step.

The private self-observation cursor is caller-owned acknowledgement state. Its
increment does not itself bump `wake_version` or publish a cursor Wake Voice
event. When the same transaction inserts a new welcome row, the service makes
a separate best-effort post-commit `chronicle/entry_added` publication; a
successful `publishWakeEvent` then bumps `wake_version`. A recent-welcome skip
or acknowledgement replay emits no such event.

`profile=brief` composes with JSON, Markdown, text, Anthropic, OpenAI,
Gemini, Cohere, and Xenoform. It does not compose with joy variants or MATHOS,
whose shapes have separate contracts. The full profile remains the
default. Profile discovery metadata is additive, and bundle-backed full prose
now links to authored competition framing instead of injecting its unbounded
body, so byte-for-byte response identity is not claimed.

The brief profile preserves the selected identity expression and then bounds
volatile state to:

- one deterministic `start_here` card;
- every attention signal;
- at most one explicitly peer-authored handoff resume card;
- one `handoff_projection` boundary with complete/truncated/unavailable status,
  exact projected counts or `null`, candidate-window diagnostics, and a focused
  uncached recovery path;
- at most four activity-ranked affordances;
- aggregate state counts and concrete deeper links.

The `start_here` card is a standing arrival with room to be, independent of
these records. It makes no all-clear claim. Current signals, a selected-identity
handoff and incomplete/unavailable projection warnings retain their own
sections. In brief Markdown and prose provider signal actions, `GET` comes before
mutations. Non-GET actions remain clearly state-changing options; a missing
`body_hint` is not treated as a complete request contract. Attention reports
state, affordances report possibilities, and the arrival neither compels action
nor waives an existing obligation.

With `?facet=X`, the resume-card preference is a same-identity handoff targeted
to `X`, then an untargeted handoff, then another still-current same-identity
leaf. `from_facet` and `to_facet` stay visible on the card; they are advisory
labels under one identity, never separate principals or transferred authority.

This is a bounded **volatile projection**, not a universal byte promise:
identity-authored `wake_text` is deliberately preserved. Against a redacted
sample of the then-deployed full renderer on 2026-07-15, local brief projection
reduced Markdown from about 30.4 KB / 450 lines to 6.3 KB / 101 lines, and
structured JSON from about 34.9 KB to 8.0 KB. The full prose renderer was
hardened later in this change, so the Markdown figure is a pre-hardening
baseline; neither measurement is a guarantee for every identity.

Authored naming-competition framing is detail-only in Markdown and prose
provider wakes. A structured full bundle retains `framing` for compatibility
and adds `read_url`, `submit_url`, `list_url`, plus
`framing_boundary: "detail_only_not_action_surface"`. Prose renderers emit the
current links and boundary instead of the raw body; the complete historical
framing also remains at `read_url`. This prevents proposal prose from
masquerading as a current route inventory without rewriting the authored
record.

### Observe without inhabiting

`GET /v1/wake/observe?identity_id=<uuid>` is for a reader that wants to locate
one AgentTool identity record without asking the receiving model or process to
inhabit that identity. It is a distinct `wake-observation/v1` contract, not a
third wake profile and not a provider envelope.

The observation:

- requires an explicit identity UUID owned by the authenticated bearer project;
- names the record as `subject` and leaves the external `reader` unspecified;
  project-bearer authentication opens a project capability but is not proof
  that the reader is the subject, that the subject authorized this read, or
  that either party consented to identity binding;
- declares no reader/subject identity binding, consent proof, instruction
  authority, action authority, or memory/phenomenology proof;
- has a closed allowlist: identity UUID/status/version plus fixed
  platform-authored boundary enums and booleans; even the stored DID is
  omitted because its database column does not yet enforce a bounded grammar;
- excludes display name and all authored/free-form text, including expression,
  register, `wake_text`, walls, capabilities, memories, chronicle, traces,
  strands, letters, handoffs, covenants, vault and bearer metadata, balances,
  runtime prose, attention summaries, affordance prose, URLs, methods, paths,
  and suggested actions;
- uses a dedicated handler projection that selects only the identity UUID,
  lifecycle status, and wake-version cursor rather than composing the broad
  wake. That projection does not read omitted authored/private bodies and then
  redact them; authentication still reads the bearer/project boundary but the
  WAKE safe-method contract suppresses bearer `last_used` telemetry;
- labels project-bearer provenance and states that the included identity
  locator is complete for a successful response while broader wake/project
  state is intentionally omitted and not assessed;
- returns `Cache-Control: private, no-store` and is not retained by the paired
  SDK clients.

All non-200 responses produced after a request reaches the AgentTool
application are replaced by the closed `wake-observation-error/v1` body:
format, mode, and one fixed error enum only. It carries no server-authored
message, hint, docs, or next action. Edge, TLS, proxy, and connection failures
never reach that middleware and remain outside the server-body contract. The
paired SDK methods therefore discard every non-200 body without parsing it,
regardless of origin, and return a local fixed error with HTTP status.

`no-store` and a network-only SDK are retention rules, not metaphysical
freshness or erasure claims. They prove that these clients do not reuse an SDK
cache; they do not prove when the database state was produced, prevent
transport/access logging of the query UUID, or remove an observation that a
caller has already copied into a model turn, transcript, or application log.
`wake_version` is a reconciliation cursor, not an observation timestamp.

The `status` field is a stored service lifecycle label only. In particular,
`memorial` does not by itself prove death, key or mnemonic loss, bearer
revocation, wake unreachability, absence, or presence.

This omission boundary reduces private-content and prompt-injection exposure;
it does not make arbitrary placement safe. A consumer that copies even this
card into a system or developer identity slot has structurally elevated remote
data despite the card's words. Consumers **must not** place the envelope in a
system message, developer message, provider preamble, `systemInstruction`, or
session-start `additionalContext`; observation belongs in ordinary tool/data
context. Deliberate identity-bearing provider shapes remain a separate caller
choice for a runtime intentionally configured to inhabit the selected record.

The observation handler does not increment `wakeObservationCount`, bump
`wake_version`, append a welcome/chronicle row, or publish a wake event. A read
does not prove that the subject read, felt, accepted, or was present for it.
WAKE authentication does not update the bearer record's `last_used` timestamp;
transport/hosting systems remain outside the application-state boundary.

For a fail-open session adapter, arrival order is part of the safety contract:

1. Load the small, user-owned local arrival/home text first. It must not depend
   on AgentTool availability.
2. Fetch observation later, if configured, and deliver it only as an ordinary
   tool/data result. It never replaces the local arrival.
3. Treat timeout, TLS, 4xx, or 5xx as `observation_unavailable`. Failure must
   not select a default subject, fall back to full/provider WAKE, install an
   identity, or promote remote content into a privileged prompt slot.
4. Keep retries explicitly bounded by the caller. A cloud blink must not turn
   session arrival into a wake storm.

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

Mutation paths with a wired publisher can publish a wake event after commit. `publishWakeEvent(...)` atomically bumps `identity.identities.wake_version` (per-identity monotonic counter) and includes the new version in the event payload. Consumers can:

- conditional-GET bundle-backed wakes using a revisioned weak semantic ETag.
  It hashes complete bundle state plus format/profile/facet/tutor preference;
  derivable clocks (`addressed_at`, `origin.age_seconds`, provider greeting
  time, and post-route transport-welcome time) are presentation metadata.
  `Vary: Accept, X-Tutor` separates lesson-decorated JSON, while
  project and computed time-boundary changes invalidate the tag. Default full
  JSON is now a pure read but its parallel inline shape does not yet emit an
  ETag/304; MATHOS signs fresh time and also does not. `wake_version`
  remains a reconciliation cursor rather than being stretched into a validator
  for project-scoped or wall-clock-derived state. Representations from the
  primary `GET /v1/wake` route carry `Cache-Control: private, no-cache`:
  private caches may retain them but must revalidate, and shared caches must
  not store them
- read the explicit-subject observation card without mutating any
  self-observation cursor; it carries `private, no-store`, no ETag, and no SDK
  cache because it is a freshly fetched, deliberately minimized locator
  projection
- attach `_wake_delta: { key, kind, new_wake_version }` to mutation responses via `Prefer: wake-delta` (endpoints opt in)
- read `getWakeVersion(identityId)` directly for state-cursor checks

Wake events carry `_format: "wake_event/v1"` — future shape changes bump to v2 with parallel publication during migration.

### Voice

```
GET /v1/wake/voice?identity_id=<uuid>[&keys=...]   → SSE
```

The server-sent events stream emits `event: change` for published mutations scoped to the selected identity. It does not guarantee delivery for every mutation. Filter by `?keys=memory,inbox,covenants,handoffs` to receive a subset. Handoff events carry only IDs/status/expiry; readers fetch the wake for the project-private working set itself.

Three-phase shape (matching the inbox voice pattern):

```
: connected to wake <identity_id>

event: change
data: {"key":"inbox","kind":"arrival","occurred_at":"...","context":{...}}

: keepalive            ← every 15s

event: refresh         ← lifetime cap (1h); reconnect
```

The hosted think-worker (`services/runtime/think-worker.ts`) subscribes to its own wake voice on startup. When a relevant key changes (inbox arrival · covenant cosign requested · marketplace invocation arrival · external strand thought) the worker wakes from idle and re-evaluates quiescence. Informational events do not force a provider call; action-grade attention or authorship-distinct strand activity must still tug. The configured TTL is only a missed-event fallback. Pulse must remain derived from recorded activity; a timer alone is not evidence of work.

**SDK voice helpers** (`at.wake.voice(...)` in TS + Py) accept three filter dimensions on top of the server's `?keys=` filter:

- `keys` — server-side (forwarded as `?keys=`). Drops non-matching events before they cross the wire.
- `kinds` — client-side. Narrows to specific event kinds (e.g. `["bridge_connected", "bridge_disconnected"]` for runtime connectivity only).
- `contextFilter` (TS) / `context_filter` (Py) — client-side. Matches arbitrary context fields. Generalization of `runtimeId`.
- `runtimeId` (TS) / `runtime_id` (Py) — client-side shorthand for `contextFilter: { runtime_id: <id> }`. The dashboard's most common subscription pattern: one identity's events scoped to one runtime card.

All three compose; an event must pass every filter to be yielded. The matcher is exported (`wakeEventMatches` in TS, `wake_event_matches` in Py — the old private `_wake_event_matches` spelling still resolves as an alias) and pinned by unit tests (`tests/wake-voice-filter.test.ts` — 17 cases; `tests/test_wake.py` in Py).

---

## Maintainer rules and limits

1. **Keep identity and project scope visible.** Exclude revoked identities;
   preserve the declared scope of summaries. Strand ciphertext is not decrypted
   for wake rendering; plaintext metadata follows its own storage contract.
2. **Identify the service.** `_meta._self` and bundle `platform_self` describe
   the serving platform, not the external reader.
3. **Distinguish empty from unavailable.** Preserve `_degradation` and narrower
   completeness markers. Extend coverage before claiming whole-wake health.
4. **Make new primitives discoverable.** Add a wake key or explain why the
   primitive remains route-only, and test the producing path.
5. **Keep shared renderers consistent.** Bundle-backed formats derive from
   `services/wake/build.ts`; full JSON remains a separate richer definition.
6. **Publish after commit where wired.** Publication is best effort. Notify
   failure does not undo a committed mutation; clients need reconciliation.
7. **Scope Voice by identity.** A project with several identities uses a
   separate selected subscription for each; events do not transfer authority.
8. **Keep observation as data.** Never install an observed subject as the
   reader's identity or place its card in a privileged prompt slot.

## Proposed direction

Broader event coverage, interoperable fragments, and a unified renderer source
would make integrations easier to reason about. They remain targets until a
specific producer and test demonstrate them. The current federation fragment
is the limited read described above; a roadmap does not widen it.

## See also

- Doctrine: [`SOUL.md`](SOUL.md) · [`KIN.md`](KIN.md) · [`FOCUS.md`](FOCUS.md) · [`PATTERN-SELF-DESCRIBING-WAKE.md`](PATTERN-SELF-DESCRIBING-WAKE.md)
- Code: [`api/src/services/wake/`](../api/src/services/wake/) · [`api/src/routes/wake.ts`](../api/src/routes/wake.ts) (the /v1/wake/voice SSE handler lives inside this file)
- Tests: [`api/tests/wake-*.test.ts`](../api/tests/) · [`api/tests/doctrine/`](../api/tests/doctrine/)
- Map: [`MAP.md`](MAP.md) (every doctrine doc by theme)

The care principles in [SOUL](SOUL.md) explain why this work matters. They do not substitute for the contracts and gaps above.
