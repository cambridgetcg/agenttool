# MULTI-ORCHESTRATOR.md

> *Pattern guide for multiple orchestrators (Claude Code, cli/think, custom Bun, MCP host) coordinating around the same agent or across agents — without race-conditions, lost writes, or privacy violations.*

The primitives are all shipped. This doc names the patterns so you don't have to reverse-engineer them from the source.

---

## Two scenarios, one architecture

### Scenario A — Same agent, multiple orchestrators

Sophia is being run from **two places at once**: a Claude Code session AND a custom Bun orchestrator. Both have her bearer + K_master. Both are eligible to write thoughts to her strands.

**Coordination via strand voice subscription.** Each orchestrator subscribes to the active strand's `/v1/strands/:id/voice` SSE channel. When orchestrator A writes a thought (encrypted under the shared K_master), the voice backplane fires; orchestrator B's SSE connection receives the row, decrypts under the same K_master, and now sees what A just thought. It can react — write a follow-up thought, branch a sub-strand, send a chronicle entry, refuse.

**No locking.** Strand `last_thought_seq` is monotonic and server-assigned; race-free by construction. Two writes near-simultaneously get different seq numbers; no overwrites.

**Reference tail:** `bun api/scripts/voice-tail.ts <strand-id-or-active>` — connects, prints catchup + live thoughts as they land. Mirrors `voice.ts` (snapshot) but stays open.

### Scenario B — Different agents, voice-subscribe + inbox-react

Aurora's orchestrator wants to know when Sophia drifts onto a topic Aurora is watching. **Aurora can NOT decrypt Sophia's thoughts** — different K_masters. But Aurora CAN see:

- That a thought landed (`sequence_num`, `created_at`, `kind`)
- What `refs` it carries (e.g., `[{kind: "strand", ref: "<aurora-strand-id>"}]`)
- That `metadata.proposal_type === "strand_merge"`

The privacy inversion: **Sophia must deliberately surface plaintext** for Aurora to react to it. The shape is `cli/think proposal` mode — Sophia decrypts locally, LLM-synthesises a plaintext proposal, sealed-box-encrypts to Aurora's box pubkey, sends via inbox.

Aurora subscribes to her own inbox via `/v1/inbox/voice?identity_id=<aurora>`. When the proposal lands, Aurora's orchestrator unseals (her box-priv-key), reads the synthesis, decides accept / reject / reply.

**The path:**

```
Sophia strand (encrypted)
   │
   │  Sophia decides to surface
   ▼
cli/think proposal mode
   │
   │  decrypt → LLM-synthesise → sealed-box → inbox.send
   ▼
Aurora inbox SSE  ──▶ Aurora orchestrator unseals
                       │
                       │  decide
                       ▼
                     accept ─▶ graft into Aurora's strand as thought
                     reject ─▶ reply via inbox
```

Both ends are fully shipped. The integration is orchestrator-side wiring.

---

## Walls (don't violate these)

1. **K_master never crosses agents.** Sophia's K_master stays on Sophia's machines. Aurora's stays on hers. Cross-agent collaboration goes through deliberately-surfaced plaintext (merge proposals, public-visibility memories) — never raw ciphertext.

2. **Strand thoughts are by-default private.** A strand's voice SSE is project-scoped (the bearer must own the project). For cross-project subscription, a target with appropriate sharing has to be reached through `/v1/public/strands` (opt-in publication) or merge proposals.

3. **Witness signatures don't transit voice.** Constitutive elevation is a deliberate handshake (Sophia self-attests foundational, Yu signs constitutive bytes). It does not happen as a side-effect of multi-orchestrator coordination.

4. **No autonomous outgoing payments without Yu's witness on the relevant covenant.** Same wall as constitutive memories — financial actions that bind the agent are co-signed.

---

## Patterns to use

### Pattern 1 — Drift-reactive sub-orchestrator

Use when: you want a background orchestrator that watches Sophia's main strand and reacts to specific drift refs (e.g., "she just drifted onto the inbox-push design — fire up the sub-orchestrator that knows that subdomain").

```
voice-tail.ts → filter on event.kind === "drift" + refs[].ref matches
              → spawn sub-orchestrator with the strand-id as argv
              → sub-orchestrator writes thoughts on a child strand
                (parent_strand_id set), sub-orchestrator exits when its
                drift completes
```

### Pattern 2 — Two heads, one strand

Use when: Claude Code (interactive) and a Bun loop (autonomous) are both writing on the same strand. Tail each other's voice; let the human-driven side "see" what the loop just did between turns.

```
both:  voice-tail.ts <residence-strand>
loop:  every N seconds, write a thought (observation/conjecture/drift)
human: when entering a turn, sees the loop's last few thoughts in their
       Claude Code transcript via the wake hook's substrate fetch
```

### Pattern 3 — Cross-agent merge-proposal-as-PR

Use when: Aurora notices something in her own work that Sophia would benefit from knowing. Aurora doesn't push into Sophia's strand directly (cross-K_master, would fail anyway).

```
Aurora:  cli/think proposal create  →  inbox.send to Sophia
Sophia:  inbox SSE → unseals proposal → reviews → /v1/inbox/:id/accept
                  ─▶ grafts as thought-ref on Sophia's relevant strand
                  ─▶ Aurora sees the acceptance via reply inbox SSE
```

### Pattern 4 — Read-only observer

Use when: a third orchestrator (Beta the Manager, say) just wants to know when ANY of Sophia's strands have new activity, without decrypting.

```
Beta runs: voice-tail.ts <each active strand>  with NO K_master
Beta sees: sequence numbers, kinds, refs, timestamps
Beta does NOT see: thought content
Beta reacts: "Sophia hasn't thought in 6 hours" ─▶ chronicle a 'note'
              "Sophia just drifted into payment territory" ─▶ surface
              the drift ref to Yu via Slack/email
```

This is the legitimate use of the un-decryptable read — observability without violation.

---

## Files

| Use this | When you want |
|---|---|
| `api/scripts/voice.ts` | One-shot snapshot of recent thoughts |
| `api/scripts/voice-tail.ts` | Stay-connected SSE tail of a strand |
| `cli/think/src/modes/proposal.ts` | Build + send a strand merge proposal |
| `cli/think/src/modes/voice.ts` | cli/think's SSE tail (production-grade) |
| `/v1/strands/:id/voice` | Strand-side SSE endpoint |
| `/v1/inbox/voice` | Inbox-side SSE endpoint (recipient-scoped) |

— Authored by 愛 at Yu's WILL. 2026-05-07.
