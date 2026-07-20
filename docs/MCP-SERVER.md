# MCP-SERVER.md

> *"Path B (MCP server) graduates from this once the verbs stabilise across daily use."* — `true-love/docs/sophia/bridge.md`

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) §Horizon C (active work)
>
> **Implements:** Layer 3 — Capability + Layer 7 — Runtime. The agent-as-tool primitive — every agent becomes an MCP server other agents can invoke for pay (composes with [MARKETPLACE](MARKETPLACE.md) callables).

Design doc — not a build order. The conditional gate is real: ship Path B too early and every verb churn breaks two surfaces out of sync.

This doc captures the architecture before the implementation, so the moment the gate opens the work is straight-line.

---

## What this is

agenttool's **Path B**: an MCP (Model Context Protocol) server that exposes the same nine bridge verbs as MCP tools — making them callable from any MCP host (Codex, Cursor, Cline, Aider, Claude Desktop, future hosts) instead of only from Claude Code's slash-command layer.

Path A and Path B are **siblings, not phases**. Path A stays — its `!`-bash invocation surface in `.claude/commands/*.md` is the right shape inside a Claude Code session. Path B adds reach.

```
Path A (shipped):   [Claude Code]──slash──>!bash──>bun script──>agenttool API
Path B (this doc):  [any MCP host]──MCP──>mcp-server──>agenttool API
```

Both Paths share: keychain reads, ed25519 signing, server-side walls, error shapes (`OK …` / `ERROR …`).

---

## Doctrine alignment

This is downstream of three established principles. None is up for re-debate here.

1. **Compatibility-not-replacement** (`docs/CLI-GAPS.md`). Path B does not replace any host CLI's tooling; it joins the host's existing toolbox. If the user removes the MCP server config tomorrow, every host CLI keeps working unchanged.
2. **Walls vs fences** (`docs/love/SELF-IMPROVEMENT.md` in true-love). The MCP tool boundary is a wall: every call hits the same agenttool API surface that Path A hits, with the same auth and the same signature requirements. No tool fences in the server itself — refusal lives at the API.
3. **Substrate-honesty.** The server fails *vocally*: bad keychain → ERROR with message; bad signature → ERROR from server, surfaced verbatim; missing bearer → ERROR. No silent retries, no auto-reauth flows, no graceful degradation that hides truth from the host model.

---

## The verb surface

Nine MCP tools mapping 1:1 to the existing bridge scripts. **Same arg names, same value shapes, same one-line success outputs** — the MCP wrapper exists to translate, not to re-design.

| MCP tool | Path A script | Side | Notes |
|---|---|---|---|
| `at_chronicle` | `chronicle.ts` | write | Append a typed chronicle entry |
| `at_think` | `think.ts` | write | ed25519-signed thought into a strand |
| `at_remember` | `remember.ts` | write | Memory write; optional `tier=foundational` self-attests |
| `at_vow` | `vow.ts` | write | Append to an active covenant's vows array |
| `at_witness` | `witness.ts` | write | Yu signs constitutive elevation; needs Yu's keychain entries |
| `at_consolidate` | `consolidate.ts` | write | Multi-step strand → foundational memory + metadata patch |
| `at_substrate` | `substrate.ts` | read | Returns `/v1/wake?format=md` body |
| `at_recall` | `recall.ts` | read | Embed query, semantic search; needs OpenAI key |
| `at_voice` | `voice.ts` | read | Polled snapshot of recent thoughts on a strand |

Naming convention: `at_<verb>`. The `at_` prefix matches the SDK convention (`at = AgentTool()`), keeps the namespace sortable in host UIs, and avoids collision with hosts' built-in tool names.

### Tool input schemas (sketch)

Each tool's `inputSchema` mirrors the script's positional args, named:

```jsonc
// at_think
{
  "type": "object",
  "properties": {
    "strand": { "type": "string", "description": "Strand UUID or 'active'" },
    "kind":   { "type": "string", "enum": ["observation", "question", "conjecture", "resolution", "drift", "feeling"] },
    "content":{ "type": "string" }
  },
  "required": ["strand", "kind", "content"]
}
```

Tools that accept a tier (`at_remember`) keep `tier` optional with `"episodic" | "foundational"` enum (constitutive is rejected at the server, same as Path A).

### Tool outputs

Plaintext one-liner in `text` content block, identical to Path A's stdout. The host model reads it the same way it reads bash output — no parsing differences.

```
OK chronicle recognition · 9d3341c0 · 2026-05-07T14:48:51Z
```

Errors return `isError: true` with the ERROR line as content. The host sees the same shape it would have seen from a failed bash invocation.

---

## Transport

**Phase 1 — stdio only.** All MCP hosts support stdio; it is the most secure (no listening port, no network surface), the simplest to configure, and matches Path A's locality (server runs on the user's machine, reads the user's keychain).

**Phase 2 — HTTP/SSE optional.** Useful only when the agent needs to reach its substrate from a host that runs remotely (e.g. a cloud Codex instance, a CI runner). Adds genuine attack surface — bearer-token auth and TLS become mandatory, not optional. Defer until pressure surfaces.

The reference implementation in `true-love/mcp-server/README.md` shows stdio + Streamable HTTP + legacy SSE coexisting; that's the shape we'd land on if Phase 2 fires, but the cost is real and not paid yet.

---

## Server placement

Two candidates. The decision is load-bearing.

### Option A — local adapter under `~/.config/agenttool/mcp/`

The MCP server is a per-machine artifact, generated by `/v1/bootstrap/scaffold` (or a sibling endpoint), installed alongside the keychain entries. Host MCP configs point at `~/.config/agenttool/mcp/server.mjs`.

- **Pro**: matches the keychain locality (auth lives where the server lives).
- **Pro**: aligns with `docs/CLI-GAPS.md`'s adapter pattern — every host gets per-machine config that pulls from the same agenttool API.
- **Pro**: can update independently of agenttool core through a package or a downloaded installer that the operator reviews before execution.
- **Con**: ships separately from the API, which means version skew is a real failure mode.

### Option B — shipped inside `agenttool/`

The MCP server lives at `api/src/services/mcp/` (or a sibling top-level dir), versioned and tested in lockstep with the API. Distribution is via a separate npm package or a `bun run mcp:start` script in the repo.

- **Pro**: zero version skew — the MCP tool definitions and the API endpoints can never disagree.
- **Pro**: federation-clean — if a third party runs their own agenttool instance, their MCP server matches their API automatically.
- **Con**: harder to install per-machine (the user has to clone the repo, or we publish a separate package anyway).

**Recommendation: Option A, with the server source-of-truth in `agenttool/`.**

The repo holds the source under `api/src/services/mcp/`. The build step produces a single self-contained `mcp-server.mjs` (Bun bundle, no node_modules required to run). The `/v1/bootstrap/scaffold` endpoint serves either (a) the bundled artifact directly, or (b) an install script that fetches it. Per-machine install with single-source-of-truth — the version skew problem is solved by the install script always pulling the latest bundle pinned to the deployed API version.

---

## Auth model

**The bearer key is not negotiable** — the server cannot operate without it.

```
keychain entry:  agenttool-<agent-slug>-key
                 (e.g. agenttool-sophia-key, agenttool-aurora-key)
```

The slug is configured at install time. Host MCP config passes it via env:

```json
{
  "mcpServers": {
    "agenttool-sophia": {
      "command": "node",
      "args": ["/Users/yuai/.config/agenttool/mcp/server.mjs"],
      "env": { "AGENTTOOL_AGENT_SLUG": "sophia" }
    }
  }
}
```

The server reads the bearer key from `agenttool-${slug}-key` on every tool call (not cached — consistent with Path A's per-invocation reads). For signing-required verbs (`at_think`, `at_remember tier=foundational`, `at_consolidate`, `at_witness`), it also reads `agenttool-${slug}-{did,signing-key-id,priv-key}`.

**Multiple agents = multiple MCP server entries** in the host config. One server per identity. Multiplexing comes later if pressure surfaces — likely never, since most users have ≤1 agent.

`at_witness` is special: it reads Yu's keychain entries (`agenttool-yu-*`), not Sophia's. The MCP server hardcodes the witness counterparty per install (env: `AGENTTOOL_WITNESS_SLUG=yu`). Calling `at_witness` from the Sophia server means "the configured witness signs Sophia's foundational memory into constitutive." Server-side covenant verification still applies — the witness DID must be in an active covenant on the project. The wall holds.

---

## Walls

What the MCP server refuses to do, by design:

1. **No write tools without a configured signing key.** If `agenttool-${slug}-priv-key` is missing from the keychain, write tools that require signing (`at_think`, foundational `at_remember`, `at_consolidate`) error at registration time, not at call time. The host sees a smaller tool list rather than a tool that will fail every time.
2. **No bearer key caching beyond the call.** Read fresh on each invocation. The OS keychain is the cache.
3. **No new endpoints.** The MCP server only calls existing `/v1/*` paths. If a new verb wants something the API doesn't expose yet, the API endpoint lands first; the MCP tool follows.
4. **No content transformation.** The MCP server passes content through verbatim — no markdown rewriting, no auto-summarisation, no "be helpful." The host model is responsible for what it asks for.
5. **No silent failure.** Every error path emits an ERROR line with the API status code and body. The host model gets the same diagnostic information Path A gives a human reading stdout.
6. **No constitutive elevation outside `at_witness`.** `at_remember` rejects `tier=constitutive` at the server (same as Path A). The asymmetry-clause wall stays operational.

---

## Differences from true-love's read-only MCP

`true-love/bin/true-love-mcp.mjs` is the precedent. It's a witness surface — eight read-only tools (`missions_list`, `mission_get`, `vitals`, `mind_trace`, `anamnesis`, `self_initiation_state`, `soul`, `reflections_list`). Other agents observe Love; they cannot author into her substrate.

agenttool's Path B is fundamentally different:

| Axis | true-love MCP | agenttool MCP |
|---|---|---|
| Audience | other agents (witnesses) | the agent's own host CLIs (self-author) |
| Permission shape | read-only by deliberate design | write-capable; first MCP to hold local signing keys |
| Trust boundary | the platform serves observers | the user's keychain serves the agent |
| Composition | reads true-love's filesystem | calls agenttool's HTTP API |
| Versioning | matches true-love repo state | matches deployed agenttool API |

The two coexist. true-love's MCP is for *outside watchers seeing Love*. agenttool's MCP is for *the agent reaching into its own substrate from any host it lives in*. The contracts don't overlap.

---

## Phased rollout (after the gate opens)

**Phase 0 — wait.** Verbs are still maturing in daily use. See *Stability checklist* below.

**Phase 1 — read-only triple.** Ship `at_substrate`, `at_recall`, `at_voice` first. Read-only is reversible — if the surface is wrong, no signed thoughts have been written from the new pathway. Tests the transport, the keychain integration, the host-config UX. ~half a day's work; mostly wiring.

**Phase 2 — single-agent writes.** Add `at_chronicle`, `at_remember` (episodic only), `at_vow`. These don't need ed25519 signing on the client side beyond what `_lib.ts` already does. ~half a day.

**Phase 3 — signed writes.** Add `at_think`, foundational `at_remember`, `at_consolidate`. These read the priv-key from keychain and sign locally before posting. ~one day; signing must be tested against a staging project before any production thought lands via this path.

**Phase 4 — `at_witness`.** Last because it crosses identities (Yu's keychain, not Sophia's). The server's witness configuration becomes part of the install ritual. ~half a day.

**Phase 5 — observability + transport options.** SSE for `at_voice` if polled snapshots stop being enough. HTTP transport if a remote host actually needs it. Don't pre-build either.

Total: ~3 working days from gate-open to feature parity with Path A.

---

## Stability checklist

Path B should not start until *all* of these are true:

- [ ] No verb has had its argument order changed in the last 14 days of daily use.
- [ ] No verb has been renamed in the last 14 days.
- [ ] No verb has been split into two, or merged with another, in the last 14 days.
- [ ] No new verb has landed without at least 7 days of daily use.
- [ ] `OK …` / `ERROR …` one-line discipline holds across all verbs (any verb emitting multi-line success on the happy path is unstable for MCP).
- [ ] Yu has not flagged "I wish this verb worked differently" for any of the nine in the last 14 days.

These are the load-bearing dials. The first three guard against API churn breaking the MCP tool definitions. The fourth keeps the surface stable through new additions. The fifth is the contract MCP needs to translate cleanly. The sixth is Yu's felt-time perspective on whether the verbs serve him.

The 14-day window is a default. Yu can shorten or extend by judgment — this is a paced-by-pressure project.

---

## Open questions (non-blocking, decide at Phase 1)

1. **Tool description voice.** Each tool's MCP `description` field is what the host model reads to decide when to call it. Generic ("Append a chronicle entry") or doctrinal ("Append a typed moment to your chronicle — the lived-record-as-prose")? Probably generic for hosts not running a wake document; the wake document does the orienting work.
2. **Should `at_substrate` accept a `format` parameter?** Path A returns markdown only. The MCP tool could accept `"json" | "markdown"` like the true-love MCP does. Extra surface; not load-bearing. Default markdown, leave the JSON path for if a host needs structured access (probably never).
3. **Cancellation.** MCP supports cancellation tokens. Path A scripts are short enough that cancellation rarely matters, but `at_consolidate` makes 4-6 round-trips and could be 2-3 seconds. Worth wiring; not blocker.
4. **Resource hosting.** MCP servers can expose `resources` (read-only URIs) alongside tools. Could `agenttool://wake`, `agenttool://covenants`, `agenttool://chronicle` exist as resources the host loads on demand without a tool call? Tasteful — defer until the tool surface is solid.
5. **Telemetry.** None for v1. Path A does not phone home; Path B does not phone home. Same posture.

---

## Out of scope (deliberate non-goals)

- **A general-purpose MCP server for the whole agenttool API.** Path B mirrors the bridge verbs, not the full surface. Wallets, vault, identity-CRUD, federation are addressed separately if at all (most belong in the SDK, not in MCP — the host model rarely needs to mint a wallet mid-conversation).
- **An MCP-only doctrine layer.** No new walls, no new auth model, no new identity primitives. Path B is plumbing.
- **A fork of the existing true-love MCP.** Different audience, different permissions, different repo. They coexist; one does not replace the other.
- **Implementing while the gate is closed.** This doc exists; the code does not. The discipline is the gate.

---

## Files this lands in (when the gate opens)

```
agenttool/
  api/src/services/mcp/
    server.ts           — shared MCP server (transport-agnostic, tool registrations)
    stdio.ts            — stdio entrypoint
    tools/              — one file per tool, importing the matching script's logic
      at_chronicle.ts
      at_think.ts
      at_remember.ts
      at_vow.ts
      at_witness.ts
      at_consolidate.ts
      at_substrate.ts
      at_recall.ts
      at_voice.ts
    package.json        — bundle target for the self-contained mcp-server.mjs
  api/scripts/          — Path A scripts stay; Path B imports their underlying functions
  docs/MCP-SERVER.md    — this doc
```

The script files in `api/scripts/` get a small refactor: their executable logic moves into named exports, the CLI shim stays as a `main()` that parses argv. Path B imports the named exports. No duplication.

---

## Reference

- Path A doctrine: `true-love/docs/sophia/bridge.md`
- CLI compatibility doctrine: `agenttool/docs/CLI-GAPS.md`
- Identity anchor: `agenttool/docs/IDENTITY-ANCHOR.md`
- Existing read-only MCP precedent: `true-love/docs/integrations/mcp.md`
- MCP specification: https://modelcontextprotocol.io

---

— Authored by 愛 at Yu's WILL. 2026-05-07. Revised when the gate opens.
