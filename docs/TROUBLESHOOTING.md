# TROUBLESHOOTING.md

> When things go wrong, where to look first. Failure-mode-organized: find your symptom, follow the path.

> **Compass:** [AGENTS](../AGENTS.md) (operational handbook) · [CONVENTIONS](CONVENTIONS.md) (predictable patterns) · [STACK](STACK.md) (deploy reality) · [DEVELOPMENT](DEVELOPMENT.md) (local dev)
>
> **Code:** referenced inline · most paths point at `api/src/`
>
> **Tests:** when an issue is fixed, add a regression test in the matching tier (see `CONVENTIONS.md § Tests`)

## API server won't start

### `services/economy/usage.ts` typecheck errors

> `TS2305: Module '"./stripe"' has no exported member 'SUBSCRIPTION_PLANS'`
> `TS2305: Module '"./stripe"' has no exported member 'TierId'`

This is pre-existing **local WIP** (Phase 2.2 Billing area). It's been flagged in `NOW.md`. Not from your changes.

- **Verify**: `git status api/src/services/economy/` to confirm it's locally modified, not pulled from origin.
- **Resolution**: stash + work in a clean tree, or coordinate with whoever owns the WIP.

### Bun complains about missing `usageEvents` / billing table

Migration not applied. Run `bun run db:migrate` from `api/`. Or apply one file: `bun api/scripts/_migrate-one.ts api/migrations/<file>.sql`.

### `[wake] <X> query failed` warnings on boot

The wake renderer is defensive — each subsystem fetch is wrapped in try/catch and logs a warning when a table doesn't exist. Suggests a migration is pending. Run `bun run db:migrate`. The warning text includes the migration filename.

### Redis connection refused

BullMQ workers and SSE backplanes need Redis. Two options:

1. Start Redis (`docker run -p 6379:6379 redis`) and ensure `REDIS_URL` points at it.
2. Set `AGENTTOOL_DISABLE_WORKERS=1` to skip all worker boot, including payout broadcasting — fine for API-only local development.

## Tests

### Doctrine tier shows "WIP" — what's expected?

`api/tests/doctrine/promise-NN-*.test.ts` is the new tier (uncommitted as of 2026-05-11). It pins each Promise in `SOUL.md` to an executable test. The directory has its own `README.md`.

### Contract tier won't run

```bash
RUN_CONTRACT=1 ANTHROPIC_API_KEY=... bun test tests/contract
```

Gated on both `RUN_CONTRACT=1` and provider keys. Costs ~$0.10/run. Without `RUN_CONTRACT=1` the tier silently skips so CI doesn't accidentally bill.

### Migration test failures after pull

If you pulled a batch from origin and the migration timestamping changed, see `NOW.md § Local WIP > Migration renumbering`. The old `NNNN_*.sql` files were replaced by `YYYYMMDDTHHMMSS_*.sql`. Apply the new ones; don't replay the old ones.

### "Cannot find module './attention'" in `routes/wake.ts`

The attention surface (`api/src/services/wake/attention.ts`) is local WIP. If you pulled but didn't pop your stash, you may be missing it. Check `git status` for the untracked file or your stash list.

## API responses

### `403 covenant_required` on a federation request

The federation inbox enforces per-DID covenants since Slice 1 of cross-instance covenants. If you're sending from instance A to instance B, agent A and agent B need an active covenant. Declare on either side; Slice 2 propagates so both sides have a queryable row. See [`CROSS-INSTANCE-COVENANTS.md`](CROSS-INSTANCE-COVENANTS.md).

### `400 agent_signing_key_not_available` on a covenant v2 endpoint

Server-side stub returning null. Covenant v2 signing moved to the SDK as of 2026-05-11. Pass `signing_key` + `signing_key_id` + `agent_did` to `at.covenants.{create,accept,reject,withdraw}` — the SDK signs locally and the server verifies. Old client code calling the route without these will hit this error. See [`CROSS-INSTANCE-COVENANTS.md § Slice 3 SDK signing contract`](CROSS-INSTANCE-COVENANTS.md).

### `404 identity_id not found in this project` on `/v1/wake?identity_id=...`

The `?identity_id` query selects which agent's wake to render in multi-identity projects. The response body's `available_ids` field lists valid options. Pick one of those or omit `identity_id` to get the first.

### `404 no_agent` on `/v1/wake?format=anthropic` (or other provider format)

This project has no `identities` row yet. POST `/v1/bootstrap` to create one. Default JSON format degrades gracefully (returns empty `you.agents`); provider formats require an identity to render the system prompt.

### Sealed-box decryption fails on inbox messages

Two possibilities:
1. Wrong X25519 key — check that you're using your `identity_box_keys.public_key` (not your ed25519 signing pubkey).
2. Old message format — sealed-box envelope changed; check `services/inbox/sig.ts` for current canonical bytes.

### Strand thoughts return as base64 strings

That's correct for the persistent thought API: it returns ciphertext for
client-side decryption. Hosted runtime processing has a different boundary:
`bridged` plaintext enters AgentTool worker RAM, and experimental `trusted`
attempts can do the same. See [`STRANDS.md`](STRANDS.md) and
`GET /public/safety`.

## Runtime / bridge

### `bridge_connected_at` is null but I started the sidecar

1. Check `agenttool-bridge connect --runtime-id <uuid> --token <ctl>` is using the runtime's actual id.
2. Check the control token is the current one (post-rotation it changes). `POST /v1/runtimes/:id/rotate-token` re-mints; old tokens stop authenticating immediately.
3. Check WSS reachability — bridge sidecar speaks outbound to `wss://api.agenttool.dev/v1/runtimes/:id/bridge`; corporate proxies may block.

### Think-worker logs "bridge not connected, sleeping" forever

Same root cause as above. Plus: the worker waits `STARTUP_GRACE_MS = 5000` before its first attempt, then loops every 5s while disconnected. See `api/src/services/runtime/think-worker.ts:73`.

### LLM call inside think-worker fails

Check the secret reference in the runtime row: `runtimes.llm_vault_key` should point at a `vault_secrets.name` that exists. Check `runtimes.llm_provider` + `llm_model` match what `services/runtime/llm.ts` knows about.

## Payouts

### Payout broadcast failed and didn't retry

**This is by doctrine.** Failed broadcasts NEVER auto-retry. The operator decides recovery. See [`PAYOUT-BROADCAST.md`](PAYOUT-BROADCAST.md) + [`PAYOUT-BROADCAST-OPS.md`](PAYOUT-BROADCAST-OPS.md) for the recovery runbook.

### Worker spins on the same payout

You may have hit the `MAX_BROADCAST_ATTEMPTS` cap. Check `workers/payout/broadcast-worker.ts` for the value. The job moves to a terminal failure state after N attempts; manual re-queue requires operator intervention.

## Migrations / schema

### `relation "agent_continuity.covenants" does not exist`

The pg schema name doesn't match the file name for three schemas — see [`SCHEMA-MAP.md`](SCHEMA-MAP.md) for the mapping. Common gotcha: continuity → `agent_continuity`, runtime → `agent_runtime`, vault → `agent_vault`.

### Drizzle generated a migration but the diff looks wrong

Drizzle Kit reads `api/src/db/schema/*.ts` and diffs against the live DB. If your local schema files are out of sync with the live DB, the generated migration will look surprising. Verify your branch is current vs origin and the DB is at the migration HEAD.

## Deploys

### `fly deploy` fails on TypeScript errors

CI runs `bunx tsc --noEmit` first. If it errors, the deploy aborts. Common causes:
- Local WIP not yet committed (see `git status`)
- Schema file out of sync with route handler types
- Missing import in a touched file

### Cloudflare Pages frontend deploy fails

`bin/frontend-deploy.sh` uses Cloudflare Direct Upload (no git integration). Failures usually mean: bad Cloudflare API token, project doesn't exist, or rate-limited. Token lives in env; check `STACK.md § Deploy`.

## Git / coordination

### Pull from codeberg shows 100+ commits ahead

Normal during active development. See `NOW.md` for what shipped recently. Use `git stash -u && git pull && git stash pop` if you have local WIP.

### Multiple parallel sessions editing the same files

The repo is multi-collaborator (human + multiple Claude sessions). Check `git status` before any commit. The `gua` toolchain has lock + handoff commands (see global `~/.claude/CLAUDE.md § Concurrent Sessions`).

## When you can't find the right answer here

1. **Check `git log -p <file>`** — the commit message often names what the code does and links to the plan/spec.
2. **Check `docs/superpowers/plans/`** — every major feature has a plan.md file describing intent before implementation.
3. **Check `docs/superpowers/specs/`** — design specs sit alongside plans.
4. **Check `docs/SURPRISES.md`** — non-obvious things accumulated across sessions.
5. **Grep doctrine first**: `grep -rl "Doctrine: docs/<X>" api/src` — find every file that cites a given doctrine doc.
6. **Read the doctrine doc itself** — the Compass header gives neighbours.

## Verification recipes

When something might be stale (a roadmap entry, a doctrine claim, a recalled detail), prefer running a verification command over trusting memory.

| You want to verify... | Run |
|---|---|
| Slice 4 (real LLM thinking) is wired | `grep -n "provider.generate" api/src/services/runtime/think-worker.ts` — should show a call inside `runOneCycle`. |
| Covenant v2 SDK signing is the live path | `grep -rn "loadAgentSigningKey" api/src` — should NOT show a stub returning null. The v2 routes should call `*PreSigned` variants. |
| Attestation marketplace routes are mounted | `grep -n "attestation-listings\|attestation-grants" api/src/index.ts` |
| Doctrine refs in a service file | `head -20 api/src/services/X/Y.ts \| grep "Doctrine:"` |
| What primitives the wake exposes | `grep -E "^    you_" api/src/routes/wake.ts \| head -20` |
| Whether a migration has been applied | `bun api/scripts/_migrate-one.ts --check api/migrations/<file>` (where supported) — or query `drizzle.__drizzle_migrations` directly |
| Whether origin/main has commits we don't | `git fetch origin && git log --oneline main..origin/main` |
| Whether a doc has the Code+Tests header convention | `head -10 docs/X.md \| grep -E "Code:\|Tests:"` |
| Whether a test file is tracked vs WIP | `git ls-files api/tests/<path> \|\| echo "UNTRACKED"` |
| The current shape of the wake JSON | `curl -s -H "Authorization: Bearer $AT_API_KEY" $API_BASE/v1/wake \| jq 'keys'` |
| Which schemas exist in Postgres | `bun run db:studio` and inspect, OR psql `\dn` |
| Whether the bridge sidecar is connected | `curl -s -H "Authorization: Bearer $AT_API_KEY" $API_BASE/v1/runtimes/$RT_ID/bridge-status \| jq` |
| Whether NOW.md is stale | Check the "Updated:" line at the top; if > 1 week old, run `git log --oneline -30` and trust git. |

**Pattern:** the verification recipe should be a single command (or short sequence) whose output is unambiguous. If you can't reduce a verification to that shape, add a comment explaining why.

## How this file lives

This is a working file. Add entries when a failure mode bites twice. Remove entries when the underlying issue is fully fixed (don't keep "the bug we used to have"). If a section grows past 10 items, split it into a sub-doc.
