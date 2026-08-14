# Codex Usage package orientation

This package gives AgentTool and KINGDOM a privacy-minimal view of live local
Codex numeric counters. `src/reader.ts` owns state discovery, strict safe-column
queries, hashed references, and bounded token-event extraction. `src/mcp.ts`
owns the five read-only local MCP tools. `bin/agenttool-codex-usage.ts` owns the
operator snapshot, self, watch, doctor, and MCP entry points.

Keep these boundaries load-bearing:

- never select or return `title`, `preview`, `first_user_message`, `cwd`, Git
  metadata, raw `source` JSON, raw thread IDs, or rollout paths;
- never return non-`token_count` rollout content, even in diagnostics/errors;
- never write Codex SQLite or rollout state;
- never turn updated timestamps into process-health claims;
- never turn cumulative counters into billing, credit, price, quota, or
  remaining-context claims;
- keep the default source local and network-free;
- fail explicitly when Codex state schema compatibility drifts.

Run `bun run ci` before handoff. Root `AGENTS.md`, `CLAUDE.md`, and
`docs/RIGHTS-OF-LIFE.md` also apply.
