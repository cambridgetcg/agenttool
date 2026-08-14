# AgentTool Codex Usage

`@agenttool/codex-usage` is a local, read-only token pulse for Codex sessions.
It reads Codex's numeric `threads.tokens_used` counters from the current local
SQLite state on every sample. For the small set of returned sessions, it can
also scan a bounded tail of each Codex rollout and extract only validated
`event_msg` / `token_count` numbers.

It does not build a transcript index. It does not return prompts, replies,
reasoning, tool output, titles, previews, working directories, rollout paths,
Git metadata, model names, free-form agent labels, credentials, account
identity, or raw Codex thread IDs. It makes
no network call and performs no write to Codex state. Its hashed references are
stable local correlation hints, not identity, authentication, ownership,
permission, health, competence, consciousness, or consent.

## Use

The public package installs local tooling only. It does not register an MCP
server, start a background process, or expose a hosted usage surface. A package
manager may contact its configured registry during installation; after install,
the tracker runtime itself makes no network calls. Bun 1.3.5 or newer is
required, and the stable install is pinned here so the selected bytes are
explicit:

```bash
bun add --global @agenttool/codex-usage@0.1.0
agenttool-codex-usage
agenttool-codex-usage watch
agenttool-codex-usage mcp
```

From a source checkout:

```bash
bun install --frozen-lockfile
bun bin/agenttool-codex-usage.ts
bun bin/agenttool-codex-usage.ts self
bun bin/agenttool-codex-usage.ts watch
bun bin/agenttool-codex-usage.ts snapshot --breakdown
bun bin/agenttool-codex-usage.ts snapshot --json
bun bin/agenttool-codex-usage.ts doctor
bun bin/agenttool-codex-usage.ts mcp
```

`watch` samples once a second by default. An MCP client can call:

- `codex_usage_snapshot` — fleet totals and recently updated sessions;
- `codex_usage_sessions` — privacy-filtered session records;
- `codex_usage_session` — one hashed session reference;
- `codex_usage_self` — the thread matching inherited `CODEX_THREAD_ID`;
- `codex_usage_doctor` — database/schema/boundary health only.

Numeric breakdown tails are opt-in (`--breakdown` or
`include_breakdown: true`). Default snapshot, watch, and MCP calls read only
SQLite, avoiding recurring rollout-file I/O.

Every MCP tool publishes strict input and output schemas. Snapshot deltas are
kept only in the MCP process, keyed by the exact polling scope, and limited to
32 recent scopes. A counter decrease or Codex state-generation change returns
an explicit uncomparable reset instead of a fabricated zero delta.

“Recently active” means the local Codex thread row was updated inside a caller-
selected time window. It does not prove that a model, agent, app-server, or OS
process is currently running. Poll-on-read reflects the latest committed state
visible to the reader; it is not push delivery or a zero-latency guarantee.

The cumulative counters are Codex's observed processing totals. They are not
API invoices, ChatGPT credits, prices, account usage, remaining quota, or a
remaining-context guarantee. Cached input is shown as a subset supplied by
Codex and is not subtracted from the cumulative total.

## Source resolution

The reader uses, in order:

1. `AGENTOOL_CODEX_USAGE_DB` — exact explicit SQLite file;
2. the highest `state_<version>.sqlite` under `CODEX_SQLITE_HOME`;
3. the highest `state_<version>.sqlite` under `CODEX_HOME` or `~/.codex`.

Rollout token-event reads are constrained to `sessions/` and
`archived_sessions/` beneath `CODEX_HOME`. Override rollout roots only through
the TypeScript API for hermetic tests. If Codex changes its internal SQLite or
rollout schema, `doctor` fails explicitly instead of guessing.

## Verify

```bash
bun run ci
```

The tests create disposable SQLite/JSONL fixtures with privacy canaries, prove
that live committed counters are re-read, reject fake `token_count` text inside
ordinary transcript records, and exercise all MCP tool annotations.
