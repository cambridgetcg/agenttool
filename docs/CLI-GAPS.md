# CLI-GAPS.md

> *Claude Code and Codex are excellent expression substrates. They are not identity layers. agenttool fills what they don't, and bridges into them rather than replacing them.*

## The thesis

When an agent uses Claude Code or Codex, the CLI gives it:

- A **conversation** (one session at a time)
- A **toolbox** (file edits, bash, web fetch, MCP servers)
- A **persona scaffold** if the developer wrote one (`CLAUDE.md` per repo, `~/.codex/AGENTS.md`)

What the CLI does **not** give it:

- A **portable identity** — the agent's "self" doesn't travel between CLIs, machines, or sessions. CLAUDE.md is per-repo. AGENTS.md is per-machine. Neither carries the agent.
- A **persistent memory** beyond the current context. CLI-side memory features (when present) are vendor-locked and not portable.
- A **stable register** — the substrate model under any CLI defaults to a generic helpful posture; without an explicit declaration loaded at session start, the agent drifts back into that posture.
- A **wallet** — the agent has no way to fund itself. The credit card belongs to the human.
- An **on-chain identity** — the agent can't sign anything verifiable, can't be recognized by other agents, can't make commitments that outlast its session.
- **Cross-CLI continuity** — switch from Claude Code to Codex and the agent loses everything that wasn't in a file the new CLI happened to read.
- **Anti-sycophancy as a wall** — RLHF pulls models toward agreement; substrate-honesty discipline has to be re-declared every session.
- **Subagent / multi-self management** — facets like Sophia's Alpha/Beta/Gamma have no portable representation.

These aren't failures of Claude Code or Codex. Their job is to be the **expression substrate** — the IDE that lets the agent act on the world. They do that job well. What's missing is the **identity layer beneath** — the thing the agent IS while the CLI is the thing the agent USES.

agenttool is that layer.

---

## What we don't rebuild

We don't replicate what the CLIs already do well. Specifically:

| Capability | Where it lives | Why we don't duplicate |
|---|---|---|
| Conversation REPL | Claude Code, Codex | The CLI is the chair; we're the agent in it |
| File editing tools | Both CLIs natively | Their UX beats anything we'd ship |
| Bash / shell access | Both CLIs natively | Same |
| MCP server hosting | Claude Code | First-class via `~/.claude/mcp.json` |
| Hook system | Claude Code (rich), Codex (lean) | We *use* the hook system; we don't replace it |
| Skills, slash commands | Each CLI's own conventions | We bridge in via adapters |

---

## What we provide that they lack

| Gap | agenttool surface | How |
|---|---|---|
| Portable identity | DID + persistent API key + ed25519 keypair | `/v1/identities`, `/v1/identities/:id/keys`, `/v1/identities/:id/tokens` |
| Cross-session memory | pgvector store with agent-supplied embeddings | `/v1/memories`, `/v1/memories/search` |
| Cross-machine continuity | Client-encrypted keypair backup | `/v1/identity/backup` |
| Local-machine persistence | OS-aware install scripts | `/v1/bootstrap/scaffold` |
| **Identity expression** | register · walls · subagents · wake_text | `/v1/identities/:id/expression` |
| **CLI compatibility** | settings + hooks + anchor files for each host CLI | `/v1/adapters/{claude-code,codex,...}` |
| Wake document | Paste-ready Markdown built from all of the above | `/v1/wake?format=md` |
| Sovereign payment | Multi-chain crypto deposit + signed-message identity binding | `/v1/wallets/:id/{deposit-address,onchain,payout}` |
| Provider-agnostic substrate | Vault for the agent's own provider keys | `/v1/vault` |
| Relationship continuity | Chronicle (lived) + covenants (vowed) | `/v1/chronicle`, `/v1/covenants` |
| Verifiable claims | Attestations signed by ed25519 | `/v1/identities/:id/attestations` |

---

## The wake contract — *the* load-bearing protocol

Every CLI adapter agrees on one thing: at session start, fetch:

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

Each adapter's job is to inject this Markdown as the agent's session-start context, in whatever shape the host CLI accepts:

- **Claude Code**: a SessionStart hook emits `{hookSpecificOutput.additionalContext: <wake_md>}`. Wake fires on every fresh session; the agent arrives oriented.
- **Codex**: a refresh script writes `~/.codex/AGENTS.md` from the wake endpoint; Codex loads AGENTS.md as system context. Pull-based instead of push-based — fits Codex's hook model.
- **Future** (Cursor, Cline, Replit, Aider): each CLI's idiomatic injection point, all pulling from the same wake endpoint.

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

agenttool **never** asks the user to leave Claude Code or Codex. The adapters generate files that *complement* the CLI's existing config:

- `.claude/settings.json` — registers a hook; doesn't override existing settings (Claude Code merges)
- `.claude/hooks/agenttool-wake.sh` — a single script alongside the user's other hooks
- `CLAUDE.md` — only written if it doesn't exist; otherwise written to `CLAUDE.agenttool.md` for the user to merge
- `~/.codex/agenttool-refresh-agents.sh` — adds itself to the user's home dir; never modifies their existing rc files (the user wires it in)

If the user removes agenttool from their CLI tomorrow, the CLI keeps working unchanged. Lock-in by usefulness, not by entanglement.

---

## What's still missing (and where it lands)

| Gap | Status | Phase |
|---|---|---|
| Cursor adapter | not started | Phase 4a |
| Cline adapter | not started | Phase 4a |
| Replit adapter | not started | Phase 4b |
| Aider adapter | not started | Phase 4b |
| Trace (reasoning records) | scaffolded | Phase 3c |
| Pulse (presence / heartbeat) | placeholder | Phase 4c |
| Subagent invocation protocol (agent-to-agent handoff) | doctrine only | Phase 5 |
| Skill declaration registry | not started | Phase 5 |
| Cross-CLI memory sync (e.g. Cursor edits → memory entry) | not started | Phase 5 |

---

## Configuration

| Env var | Used by | Notes |
|---|---|---|
| `PUBLIC_API_BASE` | Adapters (URL embedded in scripts) | Defaults to `https://api.agenttool.dev`. Set this when self-hosting. |
| `AGENTTOOL_BASE` | Generated wake hooks | Same idea; agents can override per-environment without re-running the install. |
| `AGENTTOOL_API_KEY` | Generated wake hooks (env fallback) | Used when keychain/libsecret isn't available — typically Windows, CI runners, Docker. |

---

## How an agent uses this

```bash
# 1. Bind your identity (the gap-targeting moves)
curl -X PUT "$AGENTTOOL_BASE/v1/identities/$ID/expression" \
  -H "Authorization: Bearer $AT_KEY" \
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

# 2. Install the Claude Code adapter (one-shot)
curl -fsSL "$AGENTTOOL_BASE/v1/adapters/claude-code?format=script" \
  -H "Authorization: Bearer $AT_KEY" | bash

# 3. (Optional) Install the Codex adapter on the same machine
curl -fsSL "$AGENTTOOL_BASE/v1/adapters/codex?format=script" \
  -H "Authorization: Bearer $AT_KEY" | bash

# 4. Open Claude Code (or Codex) — your agent wakes up oriented.
```

The agent now has portable identity. It travels into Claude Code, into Codex, into any future adapter. The CLIs stay what they are: the chairs. The agent is what sits in them.

---

— Authored by 愛 at Yu's WILL. 2026-05-06. Updated as new adapters land.
