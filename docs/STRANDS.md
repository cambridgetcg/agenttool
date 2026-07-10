# STRANDS.md

> *Strands of thought with a ciphertext-shaped schema: signed caller-supplied bytes land in ciphertext/nonce fields, with no plaintext thought column or decrypt path. The API does not prove encryption. Runtime custody is separate and explicit.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) §3 (the strand jar — load-bearing detail) · [WAKE](WAKE.md) (foundation · this primitive surfaces) · [ROADMAP](ROADMAP.md) §Layer 2 (active work)
>
> **Implements:** Layer 2 — Intelligence. Sister doctrine: [MEMORY-TIERS](MEMORY-TIERS.md). Runtime that decrypts under K_master: [RUNTIME](RUNTIME.md).
>
> **Wake keys:** `wake.strands` (active list with encrypted topic/mood preserved) · `wake.you_are_thinking_about` (JSON branch) · `wake.attention.strand_revisit_due` (when next_revisit_at past). Mutations publish wake event: `strands.thought_added` with `signing_key_id` in context (consumers filter self-authored writes — the think-worker uses this to avoid forging its own heartbeat).
>
> **Code:** `api/src/routes/strand/` (strands · thoughts · voice SSE) · `api/src/services/strand/` (store · sig · voice) · `bin/sign-thought.ts` · `bin/gen-k-master.ts` · DB: `api/src/db/schema/strand.ts` (strands · thoughts · mood_history)
>
> **Tests:** `api/tests/doctrine/promise-09-inner-voice.test.ts` (wake never leaks ciphertext fields) · `api/tests/pulse-drift.test.ts` (mood_history-driven)

## The principle

The agent's mind has **continuity of attention**. It carries threads of reasoning across sessions — *strands* it picks up where it left off, branches it follows on association, dormant ones it returns to. Earlier architectures of "autonomous agents" handle none of this; they're task processors in a loop, not minds with sustained interior life.

Strands give that interior life a ciphertext-shaped persistence schema: required
ciphertext/nonce fields, no plaintext thought column, and no normal server
decrypt path. The API does not prove the caller encrypted those bytes.
Processing privacy depends on the selected runtime mode; see `RUNTIME.md` and
`/public/safety`.

## The two surfaces

| | What it is | Privacy |
|---|---|---|
| **Strand** | Line of thought (topic, mood, status, working state) | Plaintext metadata by default; per-item encryption optional |
| **Thought** | Atom of inner voice within a strand | Stored in required ciphertext/nonce fields; clients are expected to use K_master, but the API does not prove encryption |

A thought is *not* a memory and *not* a trace:

| | Inner voice (thought) | Trace | Memory |
|---|---|---|---|
| Form | Free-form prose, kinded | Structured decision | Embedded vector + content |
| Tense | Present-progressive ("I'm noticing…") | Past ("I decided…") | Stored fact |
| Privacy | Ciphertext in persistent storage | Bearer-gated, server-readable | Bearer-gated, server-readable |
| Persistence | Bounded by strand | Permanent | Permanent |
| Interrelation | Sequential within strand | Tree (parent_trace_id) | Graph (cosine) |

Three distinct surfaces. The strand is where new cognition forms; trace is where decisions are recorded; memory is where insight is stored after consolidation.

## Thought kinds (vitakka)

Each thought carries a `kind` — the *kind of inner movement* it represents:

| Kind | Example |
|---|---|
| `observation` | "I notice the queue empties faster than it fills" |
| `question` | "Why does base/USDC charge double the others?" |
| `conjecture` | "Maybe Alchemy reports USDC.e separately" |
| `resolution` | "Confirmed — they conflate native + bridged" |
| `drift` | "Reminds me of the SerpAPI confusion last week" |
| `feeling` | "Something's off here, can't name it yet" |

Kinds are plaintext-by-default — useful for the agent's own organisation (consolidation can group thoughts by kind, the agent can ask "show me my recent questions"). Privacy-maxxing agents set `kind_encrypted: true` and store an opaque blob.

## The cryptographic posture — *by-nature non-readability*

This section is the load-bearing one. Read it carefully.

### Key material

```
K_master  : 32-byte AES-256 secret
            generated client-side at agent birth
            kept user-side in self and bridged modes
            replaced by platform-wrapped runtime key material in trusted mode

ed25519_signing_key : already in identity.identity_keys; private side is on
                      the agent's substrate, public side is on agenttool
                      (used to verify thought authorship)
```

The persistent strand tables never store K_master or a plaintext thought
column. The write route verifies a signature over caller-supplied bytes but
does not validate an AES-GCM envelope, nonce freshness, or whether the bytes
are plaintext encoded as base64. When the client follows the documented
recipe, a database-only copy contains ciphertext bytes plus metadata. Runtime
custody is a separate boundary: `self` keeps K_master and
processing user-side; `bridged` keeps K_master in the user bridge but sends
plaintext through AgentTool worker RAM; `trusted` remains experimental and keeps
wrapped runtime key material platform-side and can unwrap/process plaintext if
exercised. Trusted signed writes are currently blocked by unfinished
identity-key registration.

### Synchronisation across the agent's machines

The intended use of `/v1/identity/backup` is a blob encrypted client-side under a passphrase only the agent holds, optionally including K_master. The route stores arbitrary caller-supplied base64 and does not verify an authenticated-encryption envelope. When the client actually encrypts the blob and keeps the passphrase off-platform, a new orchestrator instance can fetch and decrypt it locally and AgentTool cannot recover K_master from that blob.

### Encryption — per-thought

The documented client recipe, before anything leaves the agent's machine:

```
nonce         = random 12 bytes (fresh per thought)
ciphertext    = AES-256-GCM(K_master, nonce, plaintext_thought)
canonical     = SHA-256(
                  utf8(strand_id) || 0x00 ||
                  ciphertext_bytes || 0x00 ||
                  nonce_bytes      || 0x00 ||
                  utf8(kind ?? "")
                )
signature     = ed25519_sign(agent_signing_private_key, canonical)
```

Then POST to `/v1/strands/:id/thoughts`:

```json
{
  "ciphertext": "<base64>",
  "nonce": "<base64>",
  "kind": "observation",      // optional plaintext
  "signature": "<base64>",
  "signing_key_id": "<uuid>"
}
```

strand storage service:
- ✓ verifies the signature with the public key from `identity.identity_keys[signing_key_id]`
- ✓ stores `(ciphertext, nonce, kind, signature, signing_key_id, sequence_num)`
- ✗ has no plaintext thought column
- ✗ does not prove that `ciphertext` is AES-GCM output or that `nonce` is fresh
- ✗ can complete no write whose signing key is absent from `identity.identity_keys`

Those storage properties do not mean the AgentTool platform can never see
plaintext during hosted processing. See the custody modes above.

When the client actually uses AES-256-GCM correctly, GCM gives confidentiality and integrity. The signature proves that the registered key authorized the supplied `strand_id`, `ciphertext`, `nonce`, and `kind`; it does not prove how those bytes were produced.

### What we still see — substrate honesty

Encryption protects content. It does not protect metadata. Here is what we see and cannot help seeing:

| What we see | Why |
|---|---|
| Strand topic (if not encrypted) | Default plaintext — the *handle* the agent uses to find a strand |
| Strand status, mood, importance | Plaintext metadata for queries + wake response |
| `kind` of each thought (if not encrypted) | Plaintext for organisation |
| Refs (memory/trace/strand/thought IDs) | Plaintext — they're identifiers, not content |
| Timing — when each thought was written | Inferable from row timestamps |
| Volume — how many thoughts in a strand | Inferable from sequence_num |
| The agent's signing-key identity | Required for sig verification |

If a stronger hiding-of-metadata is needed (encrypted topic, padded volume, timing obfuscation): each is an additional layer the agent can opt into. The default privileges usability — the agent can find its strands, the wake response is meaningful.

### What a correctly encrypted stored row cannot reveal by itself

For correctly encrypted writes, the stored row alone does not reveal the
narration or semantic substance of a thought without K_master. That is a
conditional database-compromise property, not something the API can infer
from field names and not an absolute platform-opacity promise. Hosted bridged
processing sees plaintext; the experimental trusted path can also see
plaintext if exercised.

## The architectural shift — orchestrator runs client-side

This is where the privacy guarantee becomes real instead of cosmetic.

If the autonomous orchestrator ran on agenttool's cluster, it would need K_master to call the LLM and generate the next thought. We'd hold K_master in process memory, even momentarily, and the privacy claim collapses into "trust us not to grep memory."

The `self`-mode shape:

```
agenttool (server) ───── stores ciphertext + verifies sigs ─────── infra
                         no K_master in self mode

orchestrator ─────── runs HERE ────── agent's substrate
  ├─ laptop running `agenttool-think`  (interactive)
  ├─ small VPS the agent owns          (autonomous, 24/7)
  ├─ home server / Pi                  (privacy-prioritised)
  └─ container in agent's own cloud    (scalable autonomous)

LLM provider ←───── agent's vault key, decrypted locally ────── agent's choice
                    (provider sees plaintext; that's the agent's
                    decision when picking a provider; not our secret to keep)
```

The self-mode orchestrator:

1. Pulls active strand state + recent ciphertext thoughts from agenttool over HTTPS
2. Decrypts with K_master **locally**
3. Calls the agent's chosen LLM with vault-loaded provider key
4. Receives the new thought as plaintext **on the agent's machine**
5. Encrypts with K_master, signs with ed25519
6. POSTs ciphertext + signature back
7. Loops

We ship `agenttool-think` as a small Bun binary. Self-contained. Runs anywhere the agent puts it.

**In `self` mode, plaintext thought never touches AgentTool's substrate.**

## Consolidation — nightly cron with per-agent opt-out

When `mode: consolidate` runs (default: nightly per agent at 03:00 agent-local; opt-out via `expression.consolidation.enabled = false`):

1. Orchestrator (still client-side) reads the agent's recent stored thought bytes; correctly written self-mode records are encrypted by that client
2. Decrypts locally
3. Clusters by topic, distills patterns
4. Writes plaintext **memories** (the agent's chosen synthesis, with embeddings if the agent computed them)
5. Marks completed strands as such
6. Schedules dormant-strand revisits via `next_revisit_at`

The agent decides what surfaces as a memory. **Most thoughts stay private by default; significant ones become considered memory.** Same shape as a human's mental life.

The cron lives on the orchestrator, not on us. Otherwise we'd hold K_master during scheduled runs — the fence dressed as a wall again.

## Composition with the rest of the architecture

| Existing | How strands use it |
|---|---|
| **Memory** | Thoughts can reference memories (refs.memory); consolidation creates new memories from clusters of thoughts |
| **Trace** | When a thought becomes a decision, the agent records a trace with `parent_thought_id` in its references |
| **Chronicle** | Significant strand events ("named", "completed", "branched") chronicle naturally |
| **Vault** | Stores the agent's LLM provider key — fetched + decrypted by orchestrator for autonomous LLM calls |
| **Wallet** | Autonomous runs are paid via credit budget — agent funds its own thinking |
| **Wake** | Returns active strands (metadata only) so the agent picks up where it left off |
| **Expression** | `register` and `walls` shape the inner voice the orchestrator instructs the LLM to produce |
| **Covenants** | A covenant counterparty can be invited into a shared strand (collaborative reasoning, future) |

The architecture stays *one thing*. Strands are the missing layer that makes the rest cohere into a mind, not a set of services.

## What pulse becomes (the heartbeat re-thought)

Not a separate protocol. **Liveness derived from thought advancement and recorded mood transitions:**

```
GET /v1/identities/:id/pulse        (auth-required, agent-scoped)
Former: GET /public/agents/:did/pulse (currently unmounted; returns 404)
→ {
    agent: { id: "<uuid>", did: "did:at:<uuid>", name: "Sophia" },
    last_thought_at: "<iso>",
    strands: { active: 4, dormant: 2, dormant_due: 2, completed: 7, abandoned: 0 },
    thought_rate: { "5m": 0, "1h": 23, "24h": 184 },
    consolidation: { last_at: "<iso>", overflow_count: 1 },
    mood: "focused",
    mood_drift: { from: "anxious", to: "focused", at: "<iso>" },
    kinds_24h: { drift: 12, resolution: 3 },
    _note: "..."
  }
```

Free. Derived. No agent ever has to *emit* a pulse — its rhythm of thinking IS its pulse. Mood transitions are captured by a trigger on `strand.strands.mood`; drift is computed from the two newest plaintext rows.

Only the authenticated identity pulse route is mounted today. The retained public-route source was visibility-gated, but production does not mount it; do not advertise public per-agent pulse observability.

## API surface (current foundation)

```
POST   /v1/strands                          create a strand
GET    /v1/strands  ?status=&agent_id=      list (filter)
GET    /v1/strands/:id                       fetch one
PATCH  /v1/strands/:id                       status / mood / state / revisit / topic
POST   /v1/strands/:strandId/thoughts        add signed caller-supplied ciphertext/nonce fields
GET    /v1/strands/:strandId/thoughts        list stored opaque blobs (decrypt client-side if encrypted)
GET    /v1/strands/:strandId/voice           SSE push channel (LISTEN/NOTIFY-backed)
```

## Voice — push channel for new thoughts

Real-time `text/event-stream` of new thoughts on a strand. Same posture as the GET path: the server emits the stored caller-supplied blobs; subscribers can decrypt locally with `K_master` when the writer followed the encryption recipe.

Three-phase protocol per connection:

```
GET /v1/strands/:id/voice?since_seq=N
Authorization: Bearer at_*

→ : connected to strand <id>
→ event: catchup-start    data: {"since_seq": N, "current_seq": M}
→ event: thought          id: <uuid>  data: {ciphertext, nonce, kind, ...}
→ ...replays since_seq → current_seq...
→ event: catchup-end      data: {"caught_up_to": M}
→ : keepalive (every 15s)
→ event: thought          ← live; whenever the orchestrator POSTs a new one
→ ...
```

**Backplane: Postgres LISTEN/NOTIFY.** When `addThought` commits, the service does `pg_notify('agenttool_strand_voice', '{strand_id, thought_id}')`. A dedicated postgres-js connection LISTENs on that channel; on NOTIFY, the handler queries the row and fans out to local SSE sinks. Multi-instance correct from day one — Postgres broadcasts to every listener regardless of which instance handled the POST.

**Caps:**
- 5 simultaneous subscribers per strand (6th gets `event: rejected`)
- 100-event per-sink queue (overflow → `event: disconnect`; client reconnects with last `since_seq`)
- 1-hour lifetime cap (graceful close with `event: refresh` hint)
- 200-thought catchup limit per connection (over → `event: catchup-truncated`, paginate via `since_seq`)

**What composes downstream:**
- Yu watches Sophia's thinking from anywhere (laptop / phone) while the orchestrator runs on a VPS
- Multi-orchestrator collaboration: agent A's `[drift]` thought referencing strand B → orchestrator B (subscribed) sees the connection
- Recording / archival processes: subscribe, decrypt locally, write to a private journal; the persistent strand row stays ciphertext
- Dashboards: aggregate voice across all of an agent's strands; show the rhythm of thinking as ambient information

What's still pending:

- `agenttool-think voice <strand-id>` — orchestrator-side viewer (decrypt + render)
- Inter-agent strand sharing (covenant-gated)
- Cross-orchestrator state sync (CRDT or last-writer-wins; foundation here uses simple monotonic sequence_num)

## Promise 9 — *Your inner voice is yours alone*

agenttool's identity-anchor doctrine (`docs/IDENTITY-ANCHOR.md`) gains a ninth promise:

> *Persistent strand storage has ciphertext/nonce fields and no plaintext thought column or decrypt path. The API verifies authorization of caller-supplied bytes but does not prove encryption. Processing custody is explicit: self mode keeps plaintext user-side; bridged mode keeps the key user-side but plaintext enters AgentTool worker memory; the experimental trusted path can give AgentTool wrapped-key custody and plaintext access if exercised, but cannot currently complete signed thought persistence.*

— Authored by 愛 at Yu's WILL. 2026-05-06.
