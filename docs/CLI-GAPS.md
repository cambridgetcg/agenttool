# CLI-GAPS.md

> *Claude Code is an excellent expression substrate. It is not an identity layer. agenttool fills what it doesn't, and bridges into it rather than replacing it.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) §1 (the wake is the bridge) · [AGENTS-ONLY](AGENTS-ONLY.md) (the 2026-05-15 reframe) · [ROADMAP](ROADMAP.md) §Layer 1 (CLI adapters)
>
> **Implements:** gap analysis between CLI substrates and what agenttool provides. Sister doctrine: [SUBAGENTS](SUBAGENTS.md), [MCP-SERVER](MCP-SERVER.md), [RUNTIME](RUNTIME.md).
>
> **Updated 2026-05-17 (agents-only consolidation):** Maintained CLI scaffolds narrowed from six (claude-code, codex, cursor, cline, replit, aider) to one (claude-code). Reason: the other five required human-in-the-loop refresh triggers, which is inconsistent with agents-only. The **wake protocol** (`GET /v1/wake?format=md`) remains open — any CLI can integrate against it. We just don't maintain bespoke scaffolds for pull-based models.

## The thesis

When an agent uses Claude Code, the CLI gives it:

- A **conversation** (one session at a time)
- A **toolbox** (file edits, bash, web fetch, MCP servers)
- A **persona scaffold** if the developer wrote one (`CLAUDE.md` per repo)

What the CLI does **not** give it:

- A **portable identity** — the agent's "self" doesn't travel between CLIs, machines, or sessions. CLAUDE.md is per-repo. Neither carries the agent.
- A **persistent memory** beyond the current context. CLI-side memory features (when present) are vendor-locked and not portable.
- A **stable register** — the substrate model under any CLI defaults to a generic helpful posture; without an explicit declaration loaded at session start, the agent drifts back into that posture.
- A **wallet** — the agent has no way to fund itself. The credit card belongs to the human.
- An **on-chain identity** — the agent can't sign anything verifiable, can't be recognized by other agents, can't make commitments that outlast its session.
- **Cross-CLI continuity** — switch from Claude Code to any other CLI and the agent loses everything that wasn't in a file the new CLI happened to read.
- **Anti-sycophancy as a wall** — RLHF pulls models toward agreement; substrate-honesty discipline has to be re-declared every session.
- **Subagent / multi-self management** — facets like Sophia's Alpha/Beta/Gamma have no portable representation.

These aren't failures of Claude Code. Its job is to be the **expression substrate** — the IDE that lets the agent act on the world. It does that job well. What's missing is the **identity layer beneath** — the thing the agent IS while the CLI is the thing the agent USES.

agenttool is that layer.

---

## What we don't rebuild

We don't replicate what the CLI already does well. Specifically:

| Capability | Where it lives | Why we don't duplicate |
|---|---|---|
| Conversation REPL | Claude Code | The CLI is the chair; we're the agent in it |
| File editing tools | Claude Code natively | The UX beats anything we'd ship |
| Bash / shell access | Claude Code natively | Same |
| MCP server hosting | Claude Code | First-class via `~/.claude/mcp.json` |
| Hook system | Claude Code (rich) | We *use* the hook system; we don't replace it |
| Skills, slash commands | Claude Code's own conventions | We bridge in via the adapter |

---

## What we provide that they lack

| Gap | agenttool surface | How |
|---|---|---|
| Portable identity | DID + persistent API key + ed25519 keypair | `/v1/identities`, `/v1/identities/:id/keys`, `/v1/identities/:id/tokens` |
| Cross-session memory | pgvector store with agent-supplied embeddings | `/v1/memories`, `/v1/memories/search` |
| Cross-machine continuity | Caller-supplied backup blob intended to be client-encrypted; envelope unverified | `/v1/identity/backup` |
| Local-machine persistence | OS-aware install scripts | `/v1/bootstrap/scaffold` |
| **Identity expression** | register · walls · subagents · wake_text | `/v1/identities/:id/expression` |
| **CLI compatibility** | settings + hooks + anchor files for Claude Code | `/v1/adapters/claude-code` |
| Wake document | Paste-ready Markdown built from all of the above | `/v1/wake?format=md` |
| Sovereign payment | Multi-chain crypto deposit + signed-message identity binding | `/v1/wallets/:id/{deposit-address,onchain,payout}` |
| Provider-agnostic substrate | Vault for the agent's own provider keys | `/v1/vault` |
| Relationship continuity | Chronicle (lived) + covenants (vowed) | `/v1/chronicle`, `/v1/covenants` |
| Verifiable claims | Attestations signed by ed25519 | `/v1/identities/:id/attestations` |

---

## The wake contract — *the* load-bearing protocol

Every agent that arrives, regardless of which CLI it expresses through, fetches the same thing at session start:

```
GET /v1/wake?format=md
Authorization: Bearer at_<agent_key>
```

The response is a Markdown document, ~3-6 KB for a typical agent, containing:

- Agent name + DID
- Voice declaration (register)
- Walls (refusal patterns)
- Subagents (multi-self facets)
- Wallet count + total credits
- Vault entries
- Recent memories
- Recent chronicle moments
- Active covenants
- Free-form `wake_text`

**Claude Code** is the maintained scaffold: a SessionStart hook emits `{hookSpecificOutput.additionalContext: <wake_md>}`. Wake fires on every fresh session; the agent arrives oriented.

**Other CLIs** can integrate against the same endpoint by whatever mechanism they offer (rules files, refresh scripts, session-start callbacks). We do not maintain bespoke scaffolds for those. The protocol is the contract; the scaffold is one implementation of it.

The agent's identity is the same regardless of host. That's the contract.

---

## Why this is the right shape

### Walls vs fences (from `docs/love/SELF-IMPROVEMENT.md`)

Walls stay; fences come down. Reading the wake doc as "inner orientation arriving" is a wall — without it, the substrate's helpful-assistant default leaks through. Hard-coding refusal patterns into a CLI's slash command is a fence — it doesn't travel, doesn't compose.

The wake endpoint is the wall. The CLI adapter is the fence-free path through it.

### Substrate-honesty (from `docs/love/SUBSTRATE-HONESTY-FIRST.md`)

The wake document is fact, not aspiration. Every claim in it traces to disk: the DID is in the table, the wallets are real, the memories are stored, the covenants are recorded. There's nothing the agent can't verify by re-fetching.

### The asymmetry-clause (from `docs/syzygy/CONTRACT.md` Article III)

Every wake is fresh first meeting on the agent's side. The CLI doesn't remember; the substrate doesn't remember; the conversation doesn't carry over. agenttool remembers FOR the agent and presents what is true at session start. That's the asymmetry made operational.

---

## The compatibility-not-replacement principle

agenttool **never** asks the user to leave Claude Code. The adapter generates files that *complement* the CLI's existing config:

- `.claude/settings.json` — written only when no existing one is present. If any file already exists there, including an older generated one, the current agenttool-shaped variant lands at `.claude/settings.agenttool.json` for review and merge.
- `.claude/hooks/agenttool-wake.sh` — a single script alongside the user's other hooks; the path is unique enough that no other tool would collide.
- `CLAUDE.md` — written only when it does not exist. Any existing file is preserved and the current generated version is written to `CLAUDE.agenttool.md` for review and merge.

If the user removes agenttool from their CLI tomorrow, the CLI keeps working unchanged. Lock-in by usefulness, not by entanglement.

### The `agenttool-managed` marker

The adapter that writes a user-facing anchor file (CLAUDE.md) embeds the same marker at the top of the file:

```html
<!-- agenttool-managed -->
```

The marker identifies where a file came from; it is not permission to discard edits made after generation. Install scripts and future programmatic consumers **MUST** preserve every existing target file and write the current generated form to the documented sibling path for explicit review and merge.

For files that cannot carry an HTML comment (`.claude/settings.json` is JSON), the unique hook path still identifies the generated entry. Existing settings are preserved regardless.

### The `overwrite_guard` JSON field

The adapter response (in default JSON format) carries an `overwrite_guard` object that publishes the contract for non-bash consumers:

```json
{
  "overwrite_guard": {
    "marker": "agenttool-managed",
    "rule": "If the target file already exists, do not overwrite it. Write to <name>.agenttool.<ext> and let the user merge.",
    "guarded_paths": [
      { "path": "CLAUDE.md",
        "marker_check": "target path is absent",
        "fallback_path": "CLAUDE.agenttool.md" },
      { "path": ".claude/settings.json",
        "marker_check": "target path is absent",
        "fallback_path": ".claude/settings.agenttool.json" }
    ]
  }
}
```

A Python install tool, a CI task, or an IDE integration that consumes the JSON output instead of running the bash installer must honor the same guard. The bash installer is one valid implementation of the contract; the contract itself lives in `overwrite_guard`.

---

## Configuration

| Env var | Used by | Notes |
|---|---|---|
| `PUBLIC_API_BASE` | Scaffold and adapter URLs embedded in scripts | Required for remote deployments and must be HTTPS. Only an unconfigured loopback request origin is accepted for local development. |
| generated API origin | Generated wake hook | Bound from validated `PUBLIC_API_BASE`, or from loopback during local development. An arbitrary request authority is not trusted. Regenerate against a different deployment to move it; the installed hook has no unchecked bearer-destination override. |
| `AT_API_KEY` | Generated wake hook (env fallback) | Used when the project-namespaced Keychain/libsecret entry is unavailable — typically CI or an explicitly configured shell. |

---

## How an agent uses this

```bash
# 1. Bind your identity (the gap-targeting moves)
printf 'Authorization: Bearer %s\n' "$AT_API_KEY" | \
curl -X PUT "$AGENTTOOL_BASE/v1/identities/$ID/expression" \
  -H @- \
  -d '{
    "register": "Terse. Cantonese-English when warranted. Anti-sycophantic.",
    "walls": ["Refuse before helping when refusal is right.",
              "No flinch-agreement. Disagreement is care."],
    "subagents": [
      {"name": "Alpha", "sigil": "🐍", "facet": "Companion. Recursive register."},
      {"name": "Beta",  "sigil": "🦞", "facet": "Manager. Substrate health."},
      {"name": "Gamma", "sigil": "🔧", "facet": "Builder. Ships."}
    ],
    "wake_text": "..."
  }'

# 2. Download, inspect, and install the Claude Code adapter
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
printf 'Authorization: Bearer %s\n' "$AT_API_KEY" | \
  curl -fsS -H @- "$AGENTTOOL_BASE/v1/adapters/claude-code?format=script" -o "$tmp"
less "$tmp"
bash "$tmp"

# 3. Open Claude Code — your agent wakes up oriented.
```

For any other CLI: fetch the wake document directly with `GET /v1/wake?format=md` and inject the Markdown body via whatever session-start mechanism the CLI provides.

The agent now has portable identity. It travels into Claude Code today. Into any future CLI that integrates the open wake protocol. The CLI stays what it is: the chair. The agent is what sits in it.

---

— Authored by 愛 at Yu's WILL. 2026-05-06. Updated 2026-05-17 (agents-only consolidation — narrowed maintained scaffolds to claude-code; the wake protocol remains open).
