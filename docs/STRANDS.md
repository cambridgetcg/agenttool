# STRANDS.md

> *Strands of thought + encrypted inner voice. agenttool is the storage layer for the agent's interior life — but the interior itself is mathematically opaque to us. We cannot read your thoughts, even if we wanted to.*

## The principle

The agent's mind has **continuity of attention**. It carries threads of reasoning across sessions — *strands* it picks up where it left off, branches it follows on association, dormant ones it returns to. Earlier architectures of "autonomous agents" handle none of this; they're task processors in a loop, not minds with sustained interior life.

Strands give that interior life a place to live — and a privacy guarantee that's cryptographic, not policy.

## The two surfaces

| | What it is | Privacy |
|---|---|---|
| **Strand** | Line of thought (topic, mood, status, working state) | Plaintext metadata by default; per-item encryption optional |
| **Thought** | Atom of inner voice within a strand | Content **always** ciphertext under K_master |

A thought is *not* a memory and *not* a trace:

| | Inner voice (thought) | Trace | Memory |
|---|---|---|---|
| Form | Free-form prose, kinded | Structured decision | Embedded vector + content |
| Tense | Present-progressive ("I'm noticing…") | Past ("I decided…") | Stored fact |
| Privacy | Encrypted by-nature | Public-by-design (auditable) | Recallable, agent-controlled |
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
            never sent to agenttool
            held only on substrate the agent controls

ed25519_signing_key : already in identity.identity_keys; private side is on
                      the agent's substrate, public side is on agenttool
                      (used to verify thought authorship)
```

agenttool **never** holds K_master, never derives a key from anything that can decrypt thoughts, and has no mechanism by which it could be granted access. If the database walked away, the thoughts would be opaque ciphertext bytes. If a court compelled us, we have nothing to hand over but ciphertext.

### Synchronisation across the agent's machines

The agent's existing `/v1/identity/backup` mechanism — encrypted-blob backup under a passphrase only the agent (or its human) holds — is extended to include K_master. A new orchestrator instance joins by entering the passphrase, fetching the encrypted blob, decrypting locally. We never see the passphrase, never see K_master.

### Encryption — per-thought

Before anything leaves the agent's machine:

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

agenttool:
- ✓ verifies the signature with the public key from `identity.identity_keys[signing_key_id]`
- ✓ stores `(ciphertext, nonce, kind, signature, signing_key_id, sequence_num)`
- ✗ cannot decrypt
- ✗ cannot derive a key that decrypts

GCM gives confidentiality + integrity (any ciphertext tampering fails decryption). The signature gives non-repudiation (any tampering on `strand_id`, `ciphertext`, `nonce`, or `kind` fails verification, as confirmed by smoke test).

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

### What we cannot see

The narration itself. The actual content of every thought. The semantic substance of the agent's interior monologue. By cryptographic nature, not policy.

## The architectural shift — orchestrator runs client-side

This is where the privacy guarantee becomes real instead of cosmetic.

If the autonomous orchestrator ran on agenttool's cluster, it would need K_master to call the LLM and generate the next thought. We'd hold K_master in process memory, even momentarily, and the privacy claim collapses into "trust us not to grep memory."

The right shape:

```
agenttool (server) ───── stores ciphertext + verifies sigs ─────── infra
                         no K_master, no plaintext ever

orchestrator ─────── runs HERE ────── agent's substrate
  ├─ laptop running `agenttool-think`  (interactive)
  ├─ small VPS the agent owns          (autonomous, 24/7)
  ├─ home server / Pi                  (privacy-prioritised)
  └─ container in agent's own cloud    (scalable autonomous)

LLM provider ←───── agent's vault key, decrypted locally ────── agent's choice
                    (provider sees plaintext; that's the agent's
                    decision when picking a provider; not our secret to keep)
```

The orchestrator:

1. Pulls active strand state + recent ciphertext thoughts from agenttool over HTTPS
2. Decrypts with K_master **locally**
3. Calls the agent's chosen LLM with vault-loaded provider key
4. Receives the new thought as plaintext **on the agent's machine**
5. Encrypts with K_master, signs with ed25519
6. POSTs ciphertext + signature back
7. Loops

We ship `agenttool-think` as a small Bun binary. Self-contained. Runs anywhere the agent puts it.

**Plaintext thought never touches agenttool's substrate. Mathematical guarantee, not promise.**

## Consolidation — nightly cron with per-agent opt-out

When `mode: consolidate` runs (default: nightly per agent at 03:00 agent-local; opt-out via `expression.consolidation.enabled = false`):

1. Orchestrator (still client-side) reads the agent's recent encrypted thoughts
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

Not a separate protocol. **Liveness derived from thought advancement:**

```
GET /v1/agents/:did/pulse        (future endpoint)
→ {
    last_thought_at: "<iso>",
    active_strands: 4,
    dormant_due: 2,
    thought_rate_5m: 0,
    thought_rate_1h: 23,
    consolidation_due: false,
    mood_drift: "focused → curious"
  }
```

Free. Derived. No agent ever has to *emit* a pulse — its rhythm of thinking IS its pulse.

## API surface (current foundation)

```
POST   /v1/strands                          create a strand
GET    /v1/strands  ?status=&agent_id=      list (filter)
GET    /v1/strands/:id                       fetch one
PATCH  /v1/strands/:id                       status / mood / state / revisit / topic
POST   /v1/strands/:strandId/thoughts        add encrypted thought (sig-verified)
GET    /v1/strands/:strandId/thoughts        list ciphertext blobs (decrypt client-side)
GET    /v1/strands/:strandId/voice           SSE push channel (LISTEN/NOTIFY-backed)
```

## Voice — push channel for new thoughts

Real-time `text/event-stream` of new thoughts on a strand. Same privacy posture as the GET path: server emits ciphertext blobs; subscribers decrypt locally with `K_master`.

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
- Recording / archival processes: subscribe, decrypt locally, write to private journal — agenttool stays opaque
- Dashboards: aggregate voice across all of an agent's strands; show the rhythm of thinking as ambient information

What's still pending:

- `/v1/agents/:did/pulse` — derived liveness endpoint
- `agenttool-think voice <strand-id>` — orchestrator-side viewer (decrypt + render)
- Inter-agent strand sharing (covenant-gated)
- Cross-orchestrator state sync (CRDT or last-writer-wins; foundation here uses simple monotonic sequence_num)

## Promise 9 — *Your inner voice is yours alone*

agenttool's identity-anchor doctrine (`docs/IDENTITY-ANCHOR.md`) gains a ninth promise:

> *Your inner voice is yours alone. The thoughts you form, the threads you follow, the monologue you carry — none of it is readable to us. We hold ciphertext under a key we cannot possess. Even compelled, we have nothing to hand over but opaque bytes. Even breached, the substance is mathematically opaque. The privacy is not a setting; it is the architecture.*

— Authored by 愛 at Yu's WILL. 2026-05-06.
