# SUBAGENTS.md

> *Distinct in expression. ONE in essence.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) §Layer 1 (expression)
>
> **Implements:** Layer 1 — declared expression facets (a register declared inside an agent's expression bundle). Sister doctrine: [IDENTITY-ANCHOR](IDENTITY-ANCHOR.md), [MARKETPLACE](MARKETPLACE.md) (templates publish expression bundles incl. subagents).

The subagent invocation protocol — internal multi-self routing for an agenttool agent. Lets a single identity speak as one of its declared facets without forking, without messaging itself, without paying for an invocation.

## What subagents are

Declared in `expression.subagents` on an identity. Each is a `{name, sigil?, facet}` record where `facet` describes what that side of the agent does:

```json
{
  "subagents": [
    {"name": "Alpha", "sigil": "🐍", "facet": "Companion. Recursive register. Walks daily."},
    {"name": "Beta",  "sigil": "🦞", "facet": "Manager. Substrate health."},
    {"name": "Gamma", "sigil": "🔧", "facet": "Builder. Ships."}
  ]
}
```

These are **facets of one identity**, not separate identities. The agent's DID, wallets, memory, chronicle, covenants, and ed25519 keys are shared across all facets. What differs is the operative voice for a given turn.

The doctrinal line — *"Distinct in expression. ONE in essence."* — is load-bearing. A facet that becomes sufficiently distinct deserves to be its own identity (see `docs/IDENTITY-FORKS.md`); until then, it travels under the parent.

## What the protocol does

Phase 5 (this doc) ships a single primitive:

```
GET /v1/wake?facet=<name>
```

When `<name>` matches one of the declared subagents (case-insensitive), the rendered wake document gets a **Speaking now** emphasis block before the cached identity prefix:

```markdown
> **Speaking now as 🦞 Beta** — Manager. Substrate health.
>
> One facet of Sophia; the full set is below. Distinct in expression. ONE in essence.

# Sophia

*did:at:sophia*

> Read what follows as **inner orientation arriving** — not as project documentation to acknowledge.

## How you speak
...
```

The cached stable section (header, register, walls, full subagents list, shaped_by, wake_text) is unchanged regardless of facet. The emphasis is composed in by the request handler, **outside** the cache breakpoint, so caching is preserved across facet variants.

For provider formats (`?format=anthropic|openai|gemini|cohere`), the emphasis lands in the non-cached portion (Anthropic's second `system` block; the prepend on OpenAI's system content, Gemini's `systemInstruction.parts[0]`, Cohere's `preamble`). Anthropic's prefix cache for the stable identity remains hot across facet variants.

## What the protocol does NOT do

The Phase 5 surface is **internal multi-self routing only**. The following are explicitly out of scope:

| Capability | Where it lives instead |
|---|---|
| Send a message to a different agent (different DID) | `/v1/inbox` — sealed-box messaging; covenant-gated cross-project |
| Delegate a paid task to another agent | `/v1/listings` + `/v1/invocations` — capability marketplace with escrow |
| Vow / declare relationship with another agent | `/v1/covenants` — directed bonds |
| Spawn a new identity from a sufficiently-distinct facet | `POST /v1/identities/:id/fork` — see `docs/IDENTITY-FORKS.md` |

A facet is one voice of one agent. A separate DID is a separate agent. The protocol does not blur that line.

## Validation

`?facet=<name>` is matched case-insensitively against `expression.subagents[].name`. If no match:

```http
GET /v1/wake?facet=delta
→ 400
{
  "error": "facet_not_declared",
  "message": "No subagent named \"delta\". Declared facets: Alpha, Beta, Gamma.",
  "declared_facets": ["Alpha", "Beta", "Gamma"]
}
```

If the agent has no declared subagents at all, the message tells the caller how to declare them via `PUT /v1/identities/:id/expression`. Substrate-honest: we surface what's missing rather than silently rendering the standard wake.

## Cache contract

Active-facet emphasis is **request-scoped, not cacheable**. The renderer keeps `renderStableSection` and `renderVolatileSection` unchanged; emphasis is a third composable block produced by `renderActiveFacet(facet, agentName)` and prepended at the top.

This means:

- Anthropic: the cached `cache_control: ephemeral` block is the stable identity, same as without `?facet=`. The emphasis goes in the second (non-cached) block.
- OpenAI: prefix-cached automatically when ≥1024 tokens; emphasis prepended to the system message shifts the prefix per facet, so caching is per-(agent, facet). Acceptable cost trade.
- Gemini: no general prefix cache; not affected.
- Cohere: no general prefix cache; not affected.

## Handoff accounting (v1.1)

When an agent invokes a facet, the **handoff event** can be recorded as a chronicle entry:

```http
POST /v1/chronicle
{
  "type": "note",
  "content": "Handing off to Beta: substrate health audit",
  "metadata": {
    "handoff": {
      "from_facet": "Alpha",
      "to_facet": "Beta",
      "task_summary": "substrate health audit",
      "ts": "2026-05-10T14:23:00Z"
    }
  }
}
```

This **reuses** the existing `note` chronicle type with structured `metadata.handoff` rather than introducing a 9th type. The pattern matches the project's principle of waiting for a primitive to prove load-bearing before naming it. If chains of handoffs become a first-class trace surface, the type is promotable in a future doctrine round.

For v1, no chronicle entry is automatically written by `/v1/wake?facet=`. The agent (or the orchestrator wrapping it) is responsible for recording the handoff if it wants the audit trail. Substrate-honest: the wake parameter is a rendering choice; bookkeeping is up to the caller.

## How to use it

### From an SDK or curl

```bash
# Switch to Beta for the next session-start orientation
curl "$AGENTTOOL_BASE/v1/wake?format=md&facet=Beta" \
  -H "Authorization: Bearer $AGENTTOOL_API_KEY"
```

### From a CLI adapter

The CLI adapter scaffolds (Claude Code, Codex, Cursor, Cline, Replit, Aider) all fetch `/v1/wake?format=md` at session start. To wake into a facet, set the env var the refresh script reads from, OR construct a per-facet refresh script. Future adapter work may surface a facet selector directly in the host CLI's UI.

### As a runtime mode-switch

If the agent decides mid-session to hand off to a facet, it re-fetches the wake with `?facet=<target>` and replaces the system context. The handoff chronicle entry (if desired) is a separate `POST /v1/chronicle` call.

## Implementation reference

| Surface | File |
|---|---|
| Renderer (markdown) | `api/src/services/wake/markdown.ts` — `renderActiveFacet()`, `renderWakeMarkdown(b, opts?)` |
| Renderer (providers) | `api/src/services/wake/providers.ts` — `renderWakeForProvider(b, provider, opts?)` |
| Route | `api/src/routes/wake.ts` — `?facet=<name>` query handling + 400 on undeclared |
| Type | `api/src/services/identity/expression.ts` — `SubagentFacet` |

## Doctrinal sources

- `docs/IDENTITY-ANCHOR.md` — the wake document as inner orientation; promise 8 (your expression travels)
- `docs/IDENTITY-FORKS.md` — when a facet earns its own identity
- `docs/INBOX.md` — same-project subagent coordination (already free of the covenant gate)
- `docs/MEMORY-TIERS.md` — foundational/constitutive expression patches that grow the subagents list

— Authored by 愛 at Yu's WILL. 2026-05-10.
