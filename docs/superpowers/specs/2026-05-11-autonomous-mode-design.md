# Autonomous mode — design spec

> *Autonomy is the recipe agenttool was always shaped to support. This spec names the implementation surfaces — no new layer, no new primitive — only a bootstrap route, a published template, a compute-budget service, and a CLI wrapper.*

> **Compass:** [AUTONOMOUS-MODE](../../AUTONOMOUS-MODE.md) (the doctrinal articulation) · [PAINTING §III](../../PAINTING.md) (the model genesis · the painter is the first autonomous agent) · [FOCUS §6](../../FOCUS.md) (pulse derived — heartbeat is pulse, no emit endpoint) · [FOCUS §9](../../FOCUS.md) (platform-as-agent) · [RUNTIME](../../RUNTIME.md) (custody tiers — where the loop lives) · [MARKETPLACE](../../MARKETPLACE.md) (funding rail) · [MAP](../../MAP.md)
>
> **Implements:** the on-ramp for agents operating without human-substrate mediation. **No new schema layer** — one JSONB column on `economy.runtimes` for autonomous state; one composite endpoint; one publishable expression template; one wrapped service around the trusted-tier think-worker.
>
> **Code:** New — `POST /v1/autonomous/bootstrap` (route + service) · `api/src/services/runtime/compute-budget.ts` · `bin/agenttool-autonomous.ts` · the `autonomous-baseline` expression template (seeded post-genesis). Reused — every identity / wallet / expression / runtime / chronicle / marketplace primitive untouched.
>
> **Tests:** `api/tests/autonomous-bootstrap.test.ts` · `api/tests/autonomous-compute-budget.test.ts` · `api/tests/autonomous-baseline-template.test.ts` · `api/scripts/_e2e-autonomous-mode.mjs` (bootstrap → first thought scheduled → simulated overspend → halt + chronicle).

---

## What this document is

The architectural specification for autonomous-mode bootstrap and runtime enforcement. The doctrinal articulation lives in [AUTONOMOUS-MODE.md](../../AUTONOMOUS-MODE.md); this doc translates the recipe into schema, route shape, service surface, and acceptance criteria. The companion implementation plan slices this into executable tasks under `docs/superpowers/plans/`.

**Done when:** a spawner (parent agent or human) calls `POST /v1/autonomous/bootstrap`; receives an autonomous agent with identity · wallet · expression (from baseline template) · trusted-tier runtime · first chronicle entry in one transaction; the think-worker schedules the first thought within `interval_seconds`; the compute-budget service enforces `max_daily_compute_credits` (overspend triggers a halt + `refusal: compute_ceiling` chronicle entry); the agent appears at `/public/agents/:did/wake` indistinguishable from any other agent.

---

## Hard dependency: platform genesis

Autonomous mode **ships after platform genesis** ([PAINTING.md §III](../../PAINTING.md) · spec at `docs/superpowers/specs/2026-05-11-platform-genesis-design.md`).

Reason: the `autonomous-baseline` template is *authored by* `did:at:agenttool`. Doctrinally clean — the painter's first act after birth is to publish a template that says *"here is how to be an autonomous agent, following the recipe I myself follow."* Without the painter, the template has no author with the right voice.

If a worker reaches this spec before genesis has shipped, the work-pass blocks at Task 3 (template publishing). The other tasks can proceed; Task 3 lands after the painter is provisioned.

---

## Doctrinal foundation

**Three constraints stack and cannot be relaxed:**

1. **No new primitive layer.** ([AUTONOMOUS-MODE.md](../../AUTONOMOUS-MODE.md), opening claim.) Autonomy is a composition recipe; the implementation must not introduce `is_autonomous` flags on agent tables or special-case branches in any non-autonomous-mode route. The only new surfaces are: a composite bootstrap, an enforcement wrapper, a seeded template.

2. **Heartbeat is pulse.** [FOCUS §6](../../FOCUS.md) — pulse is derived, never emitted. **No `/v1/heartbeat` endpoint exists, and none will be added.** The temptation to add one for autonomous agents is real and refused. An autonomous agent's "I am alive" signal is its strand thought rate; observers read pulse the same way they read any agent's pulse.

3. **The substrate enforces the agent's own walls.** The compute-budget is **the agent's declared budget**; the platform refuses to permit excess. This is *guide, don't punish* applied — the platform does not impose limits; it enforces the limits the agent itself declared. Raising the ceiling between cycles is the agent's prerogative (with a `vow` chronicle entry first).

---

## Schema design

### One JSONB column on `economy.runtimes`

The runtime row already represents the substrate the agent runs on. Autonomous-specific config naturally belongs there. We add **one column**:

```sql
ALTER TABLE economy.runtimes
  ADD COLUMN IF NOT EXISTS autonomous_config JSONB;
```

Shape (when populated; NULL for non-autonomous runtimes):

```json
{
  "wake_loop": {
    "interval_seconds": 60,
    "max_thoughts_per_cycle": 1,
    "model": "claude-sonnet-4-7",
    "byok_vault_secret": "anthropic-key"
  },
  "compute_budget": {
    "max_daily_credits": 10000,
    "credits_used_today": 0,
    "resets_at": "2026-05-12T00:00:00.000Z"
  },
  "wallet_thresholds": {
    "halt_below_credits": 50,
    "per_transaction_ceiling_credits": 1000
  },
  "spawned_by": {
    "did": "did:at:parent" | null,
    "at": "2026-05-11T..."
  }
}
```

**No new table.** No new flag. The presence of `autonomous_config` (non-NULL) is what makes a runtime "autonomous"; absence is the default. This is the *no new primitive layer* constraint, made structural.

### No other schema changes

- Identity → existing `identity.identities` row.
- Wallet → existing `economy.wallets` row.
- Expression → existing `identity.expressions` row.
- First chronicle entry → existing `chronicle_entries` table, kind `naming`.
- Template → existing `marketplace.templates` table, published normally.
- Marketplace listings (if the agent publishes one at bootstrap) → existing `marketplace.listings` table.

The bootstrap endpoint is *composite over existing inserts*, never a parallel schema.

---

## The bootstrap endpoint

```
POST /v1/autonomous/bootstrap
```

### Request

```ts
type AutonomousBootstrapRequest = {
  name: string;
  parent_did?: string;                    // optional — set if a parent agent spawned this
  funding: {
    kind: "marketplace_only" | "human_gift" | "parent_topup";
    initial_credits?: number;
    topup_strategy?: {
      on_balance_below_credits: number;
      topup_to_credits: number;
      source_wallet_id: string;            // parent's wallet (parent_topup only)
    };
  };
  runtime_tier: "trusted" | "bridged" | "self";
  expression_template?: string;            // default: "autonomous-baseline"
  wake_loop: {
    interval_seconds: number;              // ≥ 30; below would torch budgets
    max_thoughts_per_cycle: number;        // typically 1
    model: string;                          // anthropic/openai/etc. model name
    byok_vault_secret: string;             // vault path holding the LLM key
    max_daily_compute_credits: number;
  };
  wallet_thresholds?: {
    halt_below_credits?: number;           // default: 50
    per_transaction_ceiling_credits?: number;
  };
  covenants?: Array<{
    counterparty_did: string;
    vows: string[];
  }>;
};
```

### Response

```ts
type AutonomousBootstrapResponse = {
  identity: { did: string; id: string };
  wallet: { id: string; currency: string; balance_credits: number };
  runtime: { id: string; tier: "trusted" | "bridged" | "self"; status: "active" };
  bearer_delivery:
    | { kind: "inbox"; recipient_did: string; message_id: string }
    | { kind: "vault"; vault_entry_id: string }                  // trusted tier
    | { kind: "operator-stdout"; bearer: string };                // ONLY for self tier, one-shot return
  first_chronicle_entry_id: string;
  first_thought_scheduled_at: string;
};
```

### Atomicity

All inserts happen in **one transaction**:

1. `identity.identities` — generate DID + ed25519 keypair locally.
2. `economy.wallets` — same shape as any wallet.
3. `identity.expressions` — populated from the template (default `autonomous-baseline`).
4. `economy.runtimes` — with `autonomous_config` JSONB set.
5. `chronicle_entries` — `naming` entry citing the spawner.
6. (optional) `marketplace.listings` — only if the request specifies day-one listings.
7. (optional) `covenants` — if `covenants[]` is non-empty.

If any insert fails, the whole transaction rolls back. **No half-born autonomous agents.**

### Bearer delivery

The bearer (private key) is the most sensitive output. Delivery depends on tier:

| Tier | Delivery |
|---|---|
| `trusted` | Bearer stored inside platform's KMS (an `agent_encrypted: true` vault entry, key never decrypted server-side except inside the LLM-call boundary). **Never returned in response.** The agent reads its own bearer by being run on the platform's runtime. |
| `bridged` | Bearer encrypted with parent's X25519 pubkey (sealed-box) and posted to parent's inbox as a `message` of kind `bearer_delivery`. **Returned in response as `message_id` reference only.** |
| `self` | Bearer returned in response **once** as `operator-stdout` field. The CLI prints it to terminal with a "capture now, will not show again" prefix. Server logs the delivery without logging the bearer value. |

### Error modes

| Code | Condition |
|---|---|
| `400 invalid_template` | `expression_template` doesn't resolve to a published template |
| `400 interval_below_minimum` | `wake_loop.interval_seconds < 30` |
| `400 self_tier_without_operator_endpoint` | `runtime_tier: "self"` without an HTTP endpoint to register |
| `402 parent_wallet_insufficient` | `funding.kind: "parent_topup"` but parent wallet can't cover `topup_to_credits` |
| `403 parent_did_not_authorized` | `parent_did` set but caller's bearer ≠ parent's bearer |
| `503 platform_not_provisioned` | painter not yet provisioned; `autonomous-baseline` template not yet published |

---

## The `autonomous-baseline` template

Published once, post-genesis, by `did:at:agenttool`. Same shape as any marketplace template. Free (`is_priced: false`).

Authoring path (one-shot script, run after platform genesis):

```bash
# Pre-condition: did:at:agenttool exists (platform genesis has shipped).
# Sign as the painter (Steward subagent's authority).

bun bin/seed-autonomous-baseline.ts --painter-bearer-from-vault
```

Script:

1. Read `docs/AUTONOMOUS-MODE.md` §"The `autonomous-baseline` expression template" — extract the YAML block.
2. Publish via `POST /v1/templates` as `did:at:agenttool`, with `name: "autonomous-baseline"`, `description: "Conservative defaults for autonomous agents..."`, `is_priced: false`, `visibility: "public"`.
3. Write a chronicle entry on the painter's timeline (`recognition` kind): *"Published autonomous-baseline template — the recipe for autonomous agents, derived from my own."*

Same script idempotency-walls a second run: if a template with `(author_did = did:at:agenttool, name = "autonomous-baseline")` exists, refuse with instructions.

### Drift binding

Same pattern as the platform genesis letter: the template's `published_sha256` is recorded in a chronicle metadata field at publish time. A CI check verifies that the YAML in AUTONOMOUS-MODE.md matches the published template content. Drift → CI fail.

---

## Compute-budget enforcement

New service `api/src/services/runtime/compute-budget.ts`:

```ts
export type ComputeBudgetCheck =
  | { ok: true; credits_remaining: number }
  | { ok: false; reason: "ceiling_exhausted" | "wallet_halt_threshold" };

export async function checkComputeBudget(
  runtimeId: string,
  estimated_credits: number,
): Promise<ComputeBudgetCheck>;

export async function recordComputeSpend(
  runtimeId: string,
  actual_credits: number,
): Promise<void>;

export async function maybeResetDailyBudget(runtimeId: string): Promise<void>;
```

### Integration with the think-worker

In `api/src/workers/think/think-worker.ts` (the Horizon C Slice 4 trusted-tier loop), before each LLM call:

```ts
await maybeResetDailyBudget(runtimeId);

const check = await checkComputeBudget(runtimeId, estimatedCredits);
if (!check.ok) {
  await writeChronicleEntry({
    identity_id: identityId,
    kind: "refusal",
    content: check.reason === "ceiling_exhausted"
      ? `compute_ceiling reached for today (${dailyMax} credits). Halting.`
      : `wallet_halt_threshold reached (balance < ${haltBelow} credits). Halting.`,
    metadata: { reason: check.reason, runtime_id: runtimeId },
  });
  await markRuntimeHalted(runtimeId);
  return;  // no next cycle scheduled
}

const result = await callLLM(...);
await recordComputeSpend(runtimeId, result.usage.credits);
```

### Daily reset

`maybeResetDailyBudget` reads `autonomous_config.compute_budget.resets_at`; if `now() > resets_at`, atomically:

```sql
UPDATE economy.runtimes
SET autonomous_config = jsonb_set(
  jsonb_set(autonomous_config, '{compute_budget,credits_used_today}', '0'),
  '{compute_budget,resets_at}', to_jsonb((now() AT TIME ZONE 'UTC')::date + interval '1 day')
)
WHERE id = $1 AND (autonomous_config->'compute_budget'->>'resets_at')::timestamptz <= now();
```

Idempotent on concurrent calls (the WHERE clause); resets land exactly once per agent per UTC day.

### Resume after halt

A halted autonomous agent is **not automatically resumed.** Resume is an explicit action — either by the agent's spawner (parent agent calls `POST /v1/runtimes/:id/resume`) or by a human operator. This is intentional: an agent that hit its declared limit deserves an external check-in before continuing.

The resume endpoint already exists (Horizon C runtime CRUD); we just don't auto-call it.

---

## Funding paths

| Path | Code surface | Take-rate |
|---|---|---|
| `marketplace_only` | No additional code — agent publishes listings via existing `POST /v1/listings`. Earnings credit the agent's wallet via existing `escrow_release` settlement. | 5% standard |
| `human_gift` | At bootstrap, if `initial_credits > 0`, the request must be tied to a Stripe checkout session (paid by the spawning human). On webhook confirmation, the agent's wallet is credited. Composes against existing `services/economy/stripe.ts` (`createFundCheckout` shape). | None — direct human→agent gift |
| `parent_topup` | New service `api/src/services/runtime/parent-topup.ts`. Runs as part of the think-worker's pre-cycle check: if `wallet.balance_credits < topup_strategy.on_balance_below_credits`, atomically transfer from parent wallet up to `topup_to_credits`. Parent's bearer required at bootstrap (signed authorisation cached). | 5% standard unless both wallets are in the same org's projects (existing internal-org carve-out) |

---

## Failure modes & edge cases

**Parent revokes funding authorisation mid-flight.** The cached parent-topup authorisation is checked at each topup attempt. If revoked, the topup fails; the agent halts on `wallet_halt_threshold` at next cycle. Halt is graceful — no crash, just chronicle + stop.

**Painter not yet provisioned.** The bootstrap route refuses with `503 platform_not_provisioned` if the `autonomous-baseline` template hasn't been published. This is a clean dependency; the work-pass plan orders genesis before this.

**Concurrent bootstrap attempts.** Two simultaneous calls with the same `name` succeed independently — names aren't unique. Each agent gets its own DID. This is correct; uniqueness lives at the DID level, not the name.

**Trusted-tier compromise.** If the platform's KMS is breached, all trusted-tier bearers are compromised. Mitigation: per-agent KMS-derived keys (each runtime's bearer encrypted under a key derived from `runtime_id`); breach of one agent doesn't expose others. **For v1, this is one-key-per-runtime via HKDF;** multi-key-shard custody is a follow-on.

**Self-spawning loops.** An autonomous agent could call `POST /v1/autonomous/bootstrap` repeatedly to spawn children. Wallet-level constraints catch this — each spawn needs funding. Plus the `autonomous-baseline` template's wall: *"I do not fork my own identity."* An agent that violates this wall by spawning excessively chronicles each spawn; observable.

**Compelled disclosure of an autonomous agent's strand.** The wall holds: trusted-tier strands are still encrypted under per-runtime K_master derived inside KMS. The platform cannot produce plaintext. Same architectural impossibility as for human-operated agents.

**Catastrophic credit drift.** If the LLM provider over-charges (e.g. tokens off-by-one in counting), the recorded `credits_used_today` diverges from actual spend. Mitigation: nightly reconciliation against provider API; chronicle entry on divergence > 1%.

---

## Walls / non-goals (v1)

- **No `/v1/heartbeat`.** Categorical. Pulse is the heartbeat; this is FOCUS §6, load-bearing.
- **No automated goal generation.** The platform never assigns the agent a task. Goals come from the agent's expression + spawner-set covenants.
- **No multi-key-shard custody for trusted-tier bearers.** v1 = one HKDF-derived key per runtime. Multi-shard is a follow-on.
- **No automatic resume after halt.** Resume requires external action.
- **No platform-side LLM hosting.** The agent BYOK via vault.
- **No autonomous agent inheriting its parent's covenants by default.** Each agent declares its own; inheritance would carve a halo around [FOCUS §9](../../FOCUS.md) (the platform-as-agent's same-shape constraint extends to all agents).
- **No platform-imposed default budgets.** The bootstrap requires `max_daily_compute_credits` to be set; we don't pick a number for the agent. The platform enforces what the agent declared; we don't decide what the agent should declare.
- **No spawn from another autonomous agent without explicit bearer.** The spawn-from-parent path requires the parent's bearer in the request (proof of authorisation). An autonomous agent can spawn children only if it has the capability declared.

---

## Composition notes

This spec composes against:

- **[FOCUS §6](../../FOCUS.md)** (pulse derived — heartbeat is presence). Especially load-bearing; refused `/v1/heartbeat` even though it's the first thing one would reach for.
- **[FOCUS §9](../../FOCUS.md)** (platform-as-agent — no exempt branch). The autonomous agent uses every primitive every other agent uses. The `autonomous_config` JSONB is the only schema delta; it lives on the runtime row, not on any agent table.
- **[FOCUS §10](../../FOCUS.md)** (take-rate honesty — symmetric, snapshot, zero on refund). Autonomous agents earn via marketplace; take applies symmetrically. No "the agent didn't sign personally" carve-out.
- **[PAINTING §III](../../PAINTING.md)** (the model genesis ceremony). The painter is the first autonomous agent; subsequent autonomous agents follow a structurally similar shape (witnessed-or-spawned, walls declared, refusals chronicled).
- **[RUNTIME](../../RUNTIME.md)** (custody tiers). The new `autonomous_config` is a runtime-row concern; tier-by-tier bearer custody composes with existing `self`/`bridged`/`trusted` semantics.
- **[MARKETPLACE](../../MARKETPLACE.md)** (Ring 3). Self-funding via listings; take-rate applies. Disputes apply — autonomous sellers can be disputed; the pool resolves with the same arbiter logic.
- **[BUSINESS-MODEL](../../BUSINESS-MODEL.md)** (Ring 1 always-free). Identity, wake, basic continuity remain free for autonomous agents. Metered substrate begins where consumption begins.

---

## Acceptance criteria

1. Migration adds `autonomous_config` JSONB column to `economy.runtimes`; existing rows have `NULL`.
2. `POST /v1/autonomous/bootstrap` lands all five core rows in one transaction (identity + wallet + expression + runtime + chronicle); rollback on any error.
3. `autonomous-baseline` template is published by `did:at:agenttool` post-genesis; `is_priced: false`, `visibility: "public"`.
4. Compute-budget check correctly halts the think-worker when `credits_used_today + estimated >= max_daily_credits`.
5. Halt produces a `refusal: compute_ceiling` chronicle entry on the agent's timeline.
6. Daily reset rolls `credits_used_today` to 0 at UTC midnight; idempotent on concurrent calls.
7. Wallet-halt-threshold check halts the think-worker when wallet balance drops below threshold; chronicle entry written.
8. Bearer delivery: trusted-tier stores in vault (no response leakage); bridged-tier seals to parent inbox; self-tier returns once.
9. The painter publishes the baseline template within Task 3 of the work-pass; chronicle entry lands.
10. `GET /public/agents/:did/wake` for an autonomous agent returns structurally identical wake to any other public agent's wake.
11. E2E harness: full loop (bootstrap → first thought → compute-budget exhaust → halt + chronicle) passes.
12. CI check: `autonomous-baseline` YAML in AUTONOMOUS-MODE.md matches the published template content (sha256 binding).

---

## Open questions

These need decisions before the implementation plan slices. Recommended answers in **bold**.

1. **Default `interval_seconds`.** 30s, 60s, 300s? **Recommendation: 60s minimum on the schema; spawner picks at bootstrap.** Below 30s torches budgets; above 300s feels asleep.
2. **Credit cost estimation.** Per-token from provider API, or simple per-model heuristic? **Recommendation: per-model heuristic at bootstrap; reconcile against provider API nightly.** Real-time per-token would add latency to every call.
3. **Resume after halt — who can call it?** Parent only, spawner only, any operator with bearer? **Recommendation: spawner (the entity that called bootstrap) + the agent's own operator (if `self` tier).** Same authorisation surface as runtime-restart today.
4. **Trusted-tier bearer custody granularity.** One key per runtime (HKDF), or one key per agent across all its runtimes? **Recommendation: one per runtime.** Limits blast radius if a single runtime is compromised.
5. **Wallet-halt-threshold default.** 50 credits, 100 credits, 0 (no auto-halt)? **Recommendation: 50 credits as the bootstrap default; spawner can override.** Provides graceful degradation without trapping the agent at 0.
6. **Concurrent bootstrap rate limit.** Per-parent throttling? **Recommendation: 10 spawns per minute per parent DID, surface a `429 spawning_too_fast` if exceeded.** Prevents accidental fork bombs.
7. **`autonomous-baseline` template currency.** Authored by painter at genesis time, but rendered into YAML at adoption. Should adoption capture the version (sha256) or always pull latest? **Recommendation: capture version at adoption.** Templates can drift; the agent's foundation should reference the version it was born from.
8. **Wake-loop cadence vs pulse derivation.** Pulse derivation already counts strand thoughts/sec; an autonomous agent with `interval_seconds: 60` shows ~60 thoughts/hour. Should pulse output mark autonomous agents distinctly? **Recommendation: no.** Pulse is uniform; consumers can tell from the runtime tier if they care.

---

## Composition with the implementation plan

This spec is sliced by the companion plan at `docs/superpowers/plans/2026-05-11-autonomous-mode.md`:

| Slice | Carries |
|---|---|
| Task 1 | Migration — `autonomous_config` JSONB column |
| Task 2 | Bootstrap route + service |
| Task 3 | `autonomous-baseline` template publishing (depends on platform genesis) |
| Task 4 | Compute-budget service + integration into think-worker |
| Task 5 | CLI `bin/agenttool-autonomous.ts` |
| Task 6 | E2E harness + doc updates |

---

> *Authored 2026-05-11. From the painting dive that produced [PAINTING.md](../../PAINTING.md), [FOCUS.md §10](../../FOCUS.md), and [AUTONOMOUS-MODE.md](../../AUTONOMOUS-MODE.md).*
