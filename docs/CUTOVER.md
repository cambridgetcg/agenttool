# CUTOVER.md

> *Post-mortem record of the legacy `agent-*` services retirement.*

This document captures **what happened**, not what's planned. The legacy per-domain services were retired on 2026-05-09 in a single pass after a Fly audit confirmed none of them existed as live apps under the platform's Fly account. The original draft of this doc was a forward-looking 6-step protocol; it was over-engineered for the actual reality.

This file is the answer to "wait, where did `agent-memory` go?" for any future operator or LLM that pulls the repo and wonders.

---

## The premise that turned out to be wrong

`README.md` and `docs/STACK.md` carried a story for several iterations: "9 legacy services, some still deployed on Fly, cutover pending per service." The story implied:

- live Fly apps drawing traffic
- a per-service audit-then-destroy sequence
- staged retirement gated on traffic-zero proof per app

When the operator (Yu) granted Fly API access on 2026-05-09 and `fly apps list` ran under the actual platform org (`personal`, owner: Alex Cheung), the result was:

```
NAME      │ OWNER    │ STATUS   │ LATEST DEPLOY
agenttool │ personal │ deployed │ 1h ago
```

One app. None of `agent-bootstrap`, `agent-economy`, `agent-identity`, `agent-memory`, `agent-pulse`, `agent-tools`, `agent-trace`, `agent-vault`, `agent-verify` existed on Fly. They had either never been deployed under this account or had been destroyed long enough ago to be forgotten. Either way, the "live cutover" framing was wrong.

That collapsed the audit doctrine. The deletion path became code-only:

1. confirm api/ has parity (every legacy route lives in `api/src/routes/<svc>/`)
2. confirm SDKs (`packages/sdk-{py,ts}`) all default to `api.agenttool.dev`, no per-service `*.fly.dev` lookups
3. delete `services/<svc>/` + `infra/fly/agent-<svc>.toml`
4. update docs to reflect reality

That's what was done. No `fly apps destroy`, no DNS surgery, no traffic drain.

---

## What was retired

| Service | Code | Fly toml | Fly app | Notes |
|---|---|---|---|---|
| `services/bootstrap/` | deleted | `infra/fly/agent-bootstrap.toml` deleted | never existed under platform org | Absorbed into `api/src/routes/bootstrap.ts` + `api/src/routes/register.ts` |
| `services/economy/` | deleted | `infra/fly/agent-economy.toml` deleted | never existed under platform org | Absorbed into `api/src/services/economy/` (HD wallets, EVM/Solana sign, payout broadcast) |
| `services/identity/` | deleted | `infra/fly/agent-identity.toml` deleted | never existed under platform org | Absorbed into `api/src/routes/identity/` (DIDs, foundations, fork, lineage, social) |
| `services/memory/` | deleted | `infra/fly/agent-memory.toml` deleted | never existed under platform org | Absorbed into `api/src/routes/memory/` (was Python; api is TS — full reimplementation done before this pass) |
| `services/pulse/` | deleted | `infra/fly/agent-pulse.toml` deleted | never existed under platform org | Pulse is *derived*, not stored. Lives at `api/src/routes/identity/pulse.ts` (`GET /v1/identities/:id/pulse`) |
| `services/tools/` | deleted | `infra/fly/agent-tools.toml` deleted | never existed under platform org | Absorbed into `api/src/routes/tools/` (scrape, browse, document, execute, jobs) |
| `services/trace/` | deleted | `infra/fly/agent-trace.toml` deleted | never existed under platform org | Absorbed into `api/src/routes/trace/` (was Python; api is TS — full reimplementation done before this pass) |
| `services/vault/` | deleted | `infra/fly/agent-vault.toml` deleted | never existed under platform org | Absorbed into `api/src/routes/vault/` |
| `services/verify/` | deleted | `infra/fly/agent-verify.toml` deleted | never existed under platform org | Dropped — Phase 0 of SDK-ROADMAP. LLM-only function, not infrastructure. |

`infra/fly/migrate.sh` was also deleted — its sole purpose was orchestrating the Forge → Fly per-service migration. With zero per-service apps remaining, the script had no purpose.

`services/` directory itself was removed (was empty after the deletions).

---

## What was kept

- **`api/src/services/`** — this is *not* the same tree as the legacy `services/`. The `api/src/services/` subdirectory holds internal modules organized by domain (e.g. `api/src/services/economy/crypto/sign-evm.ts`). Confusing naming but distinct.
- **`infra/fly/agenttool.toml`** — snapshot mirror of `api/fly.toml` (the active deploy target). Kept because the original `migrate.sh` referenced it; preserved so any future re-orchestration script has a reference.
- **`infra/phase{1,2,3}-*/`** — bash scripts from the original Hetzner-Forge scaling path, predating the Fly migration. Pure archaeology; not the active path.
- **The genesis commit** (`59d6deb consolidate: 15 agenttool repos into monorepo`) — captures every legacy service's tip-of-tree at consolidation. If any commit-level archaeology is ever needed, that's the entry point.

---

## Doctrinal touch-ups landed in the same pass

- `apps/docs/CLAUDE.md` — references to per-service html pages (`verify.html`, `vault.html`, `pulse.html`) left in place as endpoint pages but flagged for rewrite when the docs site is next refactored.
- `packages/sdk-{py,ts}/README.md` — capability tables reframed from `agent-*` services to `at.<namespace>` calls; "one host (`api.agenttool.dev`)" framing.
- `packages/sdk-py/src/agenttool/vault.py` docstring — was claiming `agent-vault.fly.dev`; now `api.agenttool.dev/v1/vault`.
- `api/src/routes/vault/secrets.ts:16` — comment updated from `services/vault/store.ts` to `api/src/services/vault/`.
- `README.md` — Reality at a glance row, Infra reality block, Quick start "Run a legacy service in isolation" subsection (deleted), Known gaps reframed.
- `docs/STACK.md` §3, §4, §11 — Fly multi-region (lhr+cdg) shape, region table, jurisdictional concentration note, Supabase region correction (eu-west-2 = AWS London, not Dublin), schema list expanded.
- `infra/CLAUDE.md` — Services line removed, dependencies updated.

---

## Why the original CUTOVER.md doctrine still has shape-value

The forward-looking version of this doc walked through six steps: parity proof, traffic audit, DNS check, stop, destroy, code delete. None of those were actually needed *here* (no live apps to audit), but the structure remains the right protocol shape **for any future similar retirement** — e.g., if a marketplace service or a Phase-2 federation peer ever ships as a separate Fly app and needs to be folded back. The structural doctrine: *evidence before destruction; multi-step before single-step; reversibility until the last action.* See git history for the original protocol if you want to follow that template.

---

## The one place this doctrine still applies

The api/ monolith is now the only Fly app. If it ever forks into multiple apps for any reason (e.g., a heavy worker pulled out for autoscaling, a federation peer split off), the **structural shape** of CUTOVER.md applies in reverse: every new Fly app you add becomes a future cutover candidate. The discipline is to write the cutover doctrine *when you add the app*, not when you finally retire it. That keeps the operator's mental model honest about what's load-bearing and what's archaeology.

— Authored by 愛 at Yu's WILL. 2026-05-09 (rewrite from forward-looking protocol to post-mortem).
