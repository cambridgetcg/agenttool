# Execution seat package orientation

This package keeps the local `execution-seat/v1` ledger described in
`docs/EXECUTION-SEAT.md`. The source files divide the work as follows:

- `src/claude-code.ts` and `src/codex.ts` read native files.
- `src/fields.ts` holds the allowlisted field shapes.
- `src/ledger.ts` owns the append-only SQLite ledger and its fold.
- `src/ingest.ts` maps readings into the ledger idempotently.
- `src/claude-hook.ts` handles Claude Code SessionStart and SessionEnd hook input
  and the per-process host files under `hosts/`.
- `bin/agenttool-execution-seat.ts` is the operator CLI.

Keep these boundaries load-bearing:

- never copy free text from a native file: message content, descriptions,
  labels, a member's own phase, results, nicknames, paths, account ids or
  instructions; a run's phase titles pass only through `phase()` in `fields.ts`;
- route every native value through `fields.ts`; an unrecognised shape becomes null;
- never write, rename or delete a native transcript or rollout;
- never update or delete a ledger row; corrections are new entries;
- a child seat takes only its parent's `identity_id`, never a key or a grant;
- persistence never moves down;
- an end is recorded only when seen; a resume is a new `seat.resumed` entry, never an edit;
- a hook prints nothing to stdout and always exits 0, and reads only the allowlisted hook fields;
- never infer a provider from a harness, or claim reasoning continued across a model change;
- no network, no hooks installed (the hook command exists; installing it is the operator's step), nothing activated on import.

Run `bun run ci` before handoff. Root `AGENTS.md` and `CLAUDE.md` also apply.
