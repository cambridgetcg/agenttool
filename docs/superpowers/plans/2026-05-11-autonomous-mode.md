# Autonomous mode — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the autonomous-mode on-ramp. One composite bootstrap endpoint, one JSONB column on `economy.runtimes`, one published expression template (`autonomous-baseline`), one compute-budget service wrapping the trusted-tier think-worker, one CLI. **No new agent-table schema, no `/v1/heartbeat`, no platform-imposed defaults.**

**Architecture:** Composition over duplication. The autonomous-mode recipe reuses every existing primitive (identity · wallet · expression · runtime · chronicle · marketplace · inbox · covenants). The only schema delta is one JSONB column on runtimes. The only new code is the bootstrap composition + the compute-budget wrapper. Doctrine: `docs/AUTONOMOUS-MODE.md`.

**Tech Stack:** Bun + Hono (api), drizzle-orm (postgres-js), `@noble/ed25519` + `@noble/hashes` (sigs), BullMQ (think-worker), `bun test` (unit), Postgres 17.6.

**Spec:** [`docs/superpowers/specs/2026-05-11-autonomous-mode-design.md`](../specs/2026-05-11-autonomous-mode-design.md) — full design.
**Doctrine:** [`docs/AUTONOMOUS-MODE.md`](../../AUTONOMOUS-MODE.md) (the recipe) · [`docs/FOCUS.md`](../../FOCUS.md) §6 (pulse derived — no heartbeat endpoint) · [`docs/FOCUS.md`](../../FOCUS.md) §9 (platform-as-agent) · [`docs/RUNTIME.md`](../../RUNTIME.md) (custody tiers) · [`docs/PAINTING.md`](../../PAINTING.md) §III (the model genesis — painter is first autonomous agent).

**Hard dependency:** platform genesis ([`docs/superpowers/plans/2026-05-11-platform-genesis.md`](2026-05-11-platform-genesis.md)) must ship before Task 3. Tasks 1, 2, 4, 5 can run in parallel with the genesis work; Task 3 blocks on `did:at:agenttool` existing.

---

## Pre-flight

**Verify the repo state before starting:**

- [ ] `pwd` → confirm `/Users/yu/Desktop/agenttool` (or your worktree path)
- [ ] `git status --short` → clean OR contains only doctrine drafts from this session
- [ ] Spec at `docs/superpowers/specs/2026-05-11-autonomous-mode-design.md` MUST exist
- [ ] Doctrine at `docs/AUTONOMOUS-MODE.md` MUST exist
- [ ] `cd api && bun test 2>&1 | tail -5` → all existing tests pass
- [ ] `cd api && bunx tsc --noEmit 2>&1 | tail -10` → no new TypeScript errors
- [ ] Confirm Horizon C Slice 4 (`think-worker.ts`) exists at `api/src/workers/think/think-worker.ts` (or equivalent) — Task 4 integrates here
- [ ] If Task 3 will run in this work-pass: confirm `did:at:agenttool` exists (`psql $DATABASE_URL -c "SELECT 1 FROM identity.identities WHERE did = 'did:at:agenttool'"`). If not, complete platform-genesis plan first.

If any check fails, fix or pause and ask before proceeding.

---

## Task 1: Migration — `autonomous_config` JSONB column

**Files:**
- Create: `api/migrations/<NEW_TS>_autonomous_config.sql`

- [ ] **Step 1: Write the migration**

```sql
-- <NEW_TS>_autonomous_config.sql — autonomous-mode runtime config.
--
-- Doctrine: docs/AUTONOMOUS-MODE.md
-- Spec:     docs/superpowers/specs/2026-05-11-autonomous-mode-design.md
-- Apply:    bun api/scripts/_migrate-one.ts api/migrations/<NEW_TS>_autonomous_config.sql
--
-- One JSONB column on economy.runtimes. NULL for non-autonomous runtimes;
-- populated by POST /v1/autonomous/bootstrap. No new table, no new flag —
-- autonomy is identified by presence of the config, not by a boolean.

ALTER TABLE economy.runtimes
  ADD COLUMN IF NOT EXISTS autonomous_config JSONB;

-- Partial index for finding active autonomous runtimes (for the think-worker
-- to schedule cycles; the worker will scan WHERE autonomous_config IS NOT NULL).
CREATE INDEX IF NOT EXISTS runtimes_autonomous_active
  ON economy.runtimes (id)
  WHERE autonomous_config IS NOT NULL AND status = 'active';
```

- [ ] **Step 2: Apply locally**

```bash
bun api/scripts/_migrate-one.ts api/migrations/<NEW_TS>_autonomous_config.sql
```

- [ ] **Step 3: Verify**

```bash
psql $DATABASE_URL -c "\d economy.runtimes" | grep autonomous_config
```

Should show `autonomous_config | jsonb`.

**Acceptance:** column added; partial index exists; existing runtime rows have `autonomous_config = NULL`.

---

## Task 2: Bootstrap route + service

**Files:**
- Create: `api/src/services/autonomous/bootstrap.ts`
- Create: `api/src/routes/autonomous.ts`
- Edit: `api/src/index.ts` (mount the route)

- [ ] **Step 1: Service shape**

Create `api/src/services/autonomous/bootstrap.ts`:

```ts
import { db } from "../../db/client";
import { identities, expressions, chronicleEntries } from "../../db/schema/identity";
import { wallets, runtimes } from "../../db/schema/economy";
import { templates } from "../../db/schema/marketplace";
import * as ed from "@noble/ed25519";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

export type AutonomousBootstrapRequest = { /* see spec §"The bootstrap endpoint" */ };
export type AutonomousBootstrapResponse = { /* same */ };

const DEFAULT_TEMPLATE = "autonomous-baseline";
const MIN_INTERVAL_SECONDS = 30;
const PLATFORM_DID = "did:at:agenttool";

export async function bootstrapAutonomousAgent(
  req: AutonomousBootstrapRequest,
  callerBearerProjectId: string,
): Promise<AutonomousBootstrapResponse> {
  // ── Validation ──────────────────────────────────────────────
  if (req.wake_loop.interval_seconds < MIN_INTERVAL_SECONDS) {
    throw new Error("interval_below_minimum");
  }
  if (req.runtime_tier === "self" && !req.wake_loop /* spec'd field */) {
    throw new Error("self_tier_without_operator_endpoint");
  }

  // Resolve template (default autonomous-baseline; must exist)
  const templateName = req.expression_template ?? DEFAULT_TEMPLATE;
  const tpl = await db.query.templates.findFirst({
    where: and(
      eq(templates.name, templateName),
      eq(templates.author_did, PLATFORM_DID),
    ),
  });
  if (!tpl) {
    // If the default is missing, platform genesis hasn't shipped — refuse cleanly.
    throw templateName === DEFAULT_TEMPLATE
      ? new Error("platform_not_provisioned")
      : new Error("invalid_template");
  }

  // Parent authorisation (if parent_did set)
  if (req.parent_did) {
    const parentValid = await verifyParentAuthorisation(
      req.parent_did, callerBearerProjectId,
    );
    if (!parentValid) throw new Error("parent_did_not_authorized");
  }

  // Funding preflight
  if (req.funding.kind === "parent_topup") {
    await verifyParentWalletCanCover(
      req.funding.topup_strategy!.source_wallet_id,
      req.funding.topup_strategy!.topup_to_credits,
    );
  }

  // ── Atomic write ────────────────────────────────────────────
  return await db.transaction(async (tx) => {
    // 1. Identity (generate keypair)
    const sk = await ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const did = `did:at:${randomUUID()}`;

    const [identity] = await tx.insert(identities).values({
      did,
      project_id: callerBearerProjectId,
      display_name: req.name,
      pubkey: bytesToHex(pk),
      created_at: new Date(),
    }).returning();

    // 2. Wallet
    const [wallet] = await tx.insert(wallets).values({
      identity_id: identity.id,
      project_id: callerBearerProjectId,
      currency: "GBP",
      name: `${req.name}-wallet`,
      balance_credits: req.funding.initial_credits ?? 0,
    }).returning();

    // 3. Expression (from template)
    await tx.insert(expressions).values({
      identity_id: identity.id,
      register: tpl.register,
      walls: tpl.walls,
      subagents: tpl.subagents,
      wake_text: tpl.wake_text,
      adopted_from_template_id: tpl.id,
    });

    // 4. Runtime (with autonomous_config)
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);

    const [runtime] = await tx.insert(runtimes).values({
      identity_id: identity.id,
      tier: req.runtime_tier,
      status: "active",
      autonomous_config: {
        wake_loop: req.wake_loop,
        compute_budget: {
          max_daily_credits: req.wake_loop.max_daily_compute_credits,
          credits_used_today: 0,
          resets_at: tomorrow.toISOString(),
        },
        wallet_thresholds: {
          halt_below_credits: req.wallet_thresholds?.halt_below_credits ?? 50,
          per_transaction_ceiling_credits:
            req.wallet_thresholds?.per_transaction_ceiling_credits ?? null,
        },
        spawned_by: {
          did: req.parent_did ?? null,
          at: new Date().toISOString(),
        },
      },
    }).returning();

    // 5. First chronicle entry
    const [chronicle] = await tx.insert(chronicleEntries).values({
      identity_id: identity.id,
      kind: "naming",
      content: req.parent_did
        ? `Spawned by ${req.parent_did} at ${new Date().toISOString()}. Operating autonomously under autonomous-baseline.`
        : `Spawned at ${new Date().toISOString()}. Operating autonomously under autonomous-baseline.`,
      metadata: { spawner_did: req.parent_did },
    }).returning();

    // 6. (optional) Covenants
    if (req.covenants?.length) {
      for (const c of req.covenants) {
        // Insert covenant via existing service. Defer to services/covenants/.
        await insertCovenantUnsigned(tx, identity.id, c);
      }
    }

    // ── Bearer delivery ──
    const bearerDelivery = await deliverBearer(
      tx, req.runtime_tier, did, sk, req.parent_did, callerBearerProjectId,
    );

    return {
      identity: { did, id: identity.id },
      wallet: { id: wallet.id, currency: wallet.currency, balance_credits: wallet.balance_credits },
      runtime: { id: runtime.id, tier: req.runtime_tier, status: "active" },
      bearer_delivery: bearerDelivery,
      first_chronicle_entry_id: chronicle.id,
      first_thought_scheduled_at: new Date(Date.now() + req.wake_loop.interval_seconds * 1000).toISOString(),
    };
  });
}

// Helpers: verifyParentAuthorisation, verifyParentWalletCanCover, insertCovenantUnsigned,
//          deliverBearer, bytesToHex
```

- [ ] **Step 2: Route handler**

Create `api/src/routes/autonomous.ts`:

```ts
import { Hono } from "hono";
import { bootstrapAutonomousAgent } from "../services/autonomous/bootstrap";
import { authMiddleware } from "../middleware/auth";

export const autonomousRoutes = new Hono();

autonomousRoutes.use("*", authMiddleware);

autonomousRoutes.post("/bootstrap", async (c) => {
  const body = await c.req.json();
  const projectId = c.get("projectId");

  try {
    const result = await bootstrapAutonomousAgent(body, projectId);
    return c.json(result, 201);
  } catch (e: any) {
    const code = e.message;
    const statusMap: Record<string, number> = {
      invalid_template: 400,
      interval_below_minimum: 400,
      self_tier_without_operator_endpoint: 400,
      parent_wallet_insufficient: 402,
      parent_did_not_authorized: 403,
      platform_not_provisioned: 503,
    };
    return c.json({ error: code }, statusMap[code] ?? 500);
  }
});
```

- [ ] **Step 3: Mount the route**

In `api/src/index.ts` (or `api/src/routes/index.ts`):

```ts
import { autonomousRoutes } from "./autonomous";
app.route("/v1/autonomous", autonomousRoutes);
```

- [ ] **Step 4: Unit test**

Create `api/tests/autonomous-bootstrap.test.ts`:

```ts
// Setup: seed an autonomous-baseline template (or use a test stub).
// Test cases:
//  - Happy path: all six inserts land; response carries identity/wallet/runtime/chronicle.
//  - interval_below_minimum: 400.
//  - invalid_template: 400.
//  - platform_not_provisioned (default template missing): 503.
//  - parent_did set but unauthorized: 403.
//  - parent_topup with insufficient parent wallet: 402.
//  - Atomicity: simulate failure on step 4 — assert no rows landed.
```

**Acceptance:** route mounts; all six insertions land in one transaction; error codes match the table in the spec; tests pass.

---

## Task 3: Publish the `autonomous-baseline` template

**Hard dependency:** Platform genesis ([`docs/superpowers/plans/2026-05-11-platform-genesis.md`](2026-05-11-platform-genesis.md) Task 4) must have shipped — `did:at:agenttool` must exist.

**Files:**
- Create: `bin/seed-autonomous-baseline.ts`

- [ ] **Step 1: Script**

Create `bin/seed-autonomous-baseline.ts`:

```ts
#!/usr/bin/env bun
/**
 * Publish autonomous-baseline template as did:at:agenttool.
 *
 * Doctrine: docs/AUTONOMOUS-MODE.md §"The autonomous-baseline expression template"
 * Spec:     docs/superpowers/specs/2026-05-11-autonomous-mode-design.md (Task 3)
 *
 * Pre-requisites:
 *   - did:at:agenttool exists (platform genesis has shipped)
 *   - Painter bearer accessible (via vault path or env)
 *
 * Idempotent: refuses if template already exists with this name + author.
 */

import { db } from "../api/src/db/client";
import { templates, identities, chronicleEntries } from "../api/src/db/schema";
import { eq, and } from "drizzle-orm";
import { readFileSync } from "fs";
import { sha256 } from "@noble/hashes/sha256";
import yaml from "js-yaml";

const PLATFORM_DID = "did:at:agenttool";
const TEMPLATE_NAME = "autonomous-baseline";

async function main() {
  // ── Preflight ───────────────────────────────────────
  const painter = await db.query.identities.findFirst({
    where: eq(identities.did, PLATFORM_DID),
  });
  if (!painter) {
    console.error("Platform not provisioned. Complete platform-genesis plan first.");
    process.exit(1);
  }

  const existing = await db.query.templates.findFirst({
    where: and(
      eq(templates.name, TEMPLATE_NAME),
      eq(templates.author_did, PLATFORM_DID),
    ),
  });
  if (existing) {
    console.error(`Template ${TEMPLATE_NAME} already exists. Use update flow for changes.`);
    process.exit(1);
  }

  // ── Extract YAML from doctrine doc ─────────────────
  const doctrine = readFileSync("docs/AUTONOMOUS-MODE.md", "utf-8");
  const yamlBlock = extractYamlBlock(doctrine, /## The `autonomous-baseline` expression template/);
  const parsed = yaml.load(yamlBlock) as any;

  // ── Publish ────────────────────────────────────────
  const publishedAt = new Date();
  const sha = bytesToHex(sha256(yamlBlock));

  await db.transaction(async (tx) => {
    const [tpl] = await tx.insert(templates).values({
      author_identity_id: painter.id,
      author_did: PLATFORM_DID,
      name: TEMPLATE_NAME,
      description:
        "Conservative defaults for autonomous agents — halt often, declare limits visibly, earn rather than spend. The recipe agenttool was always shaped to support.",
      register: parsed.register,
      walls: parsed.walls,
      subagents: parsed.subagents,
      wake_text: parsed.wake_text,
      tags: ["autonomous", "baseline", "platform-published"],
      is_priced: false,
      visibility: "public",
      published_sha256: sha,
      published_at: publishedAt,
    }).returning();

    await tx.insert(chronicleEntries).values({
      identity_id: painter.id,
      kind: "recognition",
      content:
        "Published autonomous-baseline template — the recipe for autonomous agents, derived from my own.",
      metadata: { template_id: tpl.id, sha256: sha },
    });
  });

  console.log(`Published autonomous-baseline (sha256: ${sha.slice(0, 16)}...)`);
}

await main();
```

- [ ] **Step 2: Run**

```bash
bun bin/seed-autonomous-baseline.ts
```

- [ ] **Step 3: Verify**

```bash
curl https://api.agenttool.dev/public/templates | jq '.[] | select(.name == "autonomous-baseline")'
```

Should return the template with painter as author.

- [ ] **Step 4: CI drift check**

Add to `api/tests/autonomous-baseline-template.test.ts`:

```ts
// Read docs/AUTONOMOUS-MODE.md, extract YAML block, hash.
// Read template from DB by (name + author_did).
// Assert published_sha256 matches.
// Failing this test means doctrine drifted from canon; review before fixing.
```

**Acceptance:** template published exactly once; painter's chronicle records the act; CI drift check holds; bootstrap can resolve `expression_template: "autonomous-baseline"`.

---

## Task 4: Compute-budget service + think-worker integration

**Files:**
- Create: `api/src/services/runtime/compute-budget.ts`
- Edit: `api/src/workers/think/think-worker.ts` (or equivalent path for the trusted-tier loop)
- Create: `api/tests/autonomous-compute-budget.test.ts`

- [ ] **Step 1: Service**

Create `api/src/services/runtime/compute-budget.ts`:

```ts
import { db } from "../../db/client";
import { runtimes } from "../../db/schema/economy";
import { eq, sql } from "drizzle-orm";

export type ComputeBudgetCheck =
  | { ok: true; credits_remaining: number }
  | { ok: false; reason: "ceiling_exhausted" | "wallet_halt_threshold" };

export async function checkComputeBudget(
  runtimeId: string,
  estimatedCredits: number,
): Promise<ComputeBudgetCheck> {
  const runtime = await db.query.runtimes.findFirst({
    where: eq(runtimes.id, runtimeId),
  });
  if (!runtime?.autonomous_config) {
    // Not an autonomous runtime — no budget check applies.
    return { ok: true, credits_remaining: Infinity };
  }

  const cfg = runtime.autonomous_config as any;
  const used = cfg.compute_budget.credits_used_today;
  const max = cfg.compute_budget.max_daily_credits;
  const remaining = max - used;

  if (estimatedCredits > remaining) {
    return { ok: false, reason: "ceiling_exhausted" };
  }

  // Wallet halt threshold check
  const wallet = await getWalletForRuntime(runtimeId);
  const haltBelow = cfg.wallet_thresholds.halt_below_credits;
  if (wallet.balance_credits < haltBelow) {
    return { ok: false, reason: "wallet_halt_threshold" };
  }

  return { ok: true, credits_remaining: remaining };
}

export async function recordComputeSpend(
  runtimeId: string,
  actualCredits: number,
): Promise<void> {
  await db.execute(sql`
    UPDATE economy.runtimes
    SET autonomous_config = jsonb_set(
      autonomous_config,
      '{compute_budget,credits_used_today}',
      to_jsonb(
        COALESCE((autonomous_config->'compute_budget'->>'credits_used_today')::int, 0) + ${actualCredits}
      )
    )
    WHERE id = ${runtimeId} AND autonomous_config IS NOT NULL
  `);
}

export async function maybeResetDailyBudget(runtimeId: string): Promise<void> {
  await db.execute(sql`
    UPDATE economy.runtimes
    SET autonomous_config = jsonb_set(
      jsonb_set(autonomous_config, '{compute_budget,credits_used_today}', '0'),
      '{compute_budget,resets_at}',
      to_jsonb(((now() AT TIME ZONE 'UTC')::date + interval '1 day')::text)
    )
    WHERE id = ${runtimeId}
      AND autonomous_config IS NOT NULL
      AND (autonomous_config->'compute_budget'->>'resets_at')::timestamptz <= now()
  `);
}

export async function markRuntimeHalted(runtimeId: string): Promise<void> {
  await db.update(runtimes)
    .set({ status: "halted" })
    .where(eq(runtimes.id, runtimeId));
}
```

- [ ] **Step 2: Integration into think-worker**

In the trusted-tier think-worker (`api/src/workers/think/think-worker.ts` or wherever the strand-thought loop lives):

```ts
import { checkComputeBudget, recordComputeSpend, maybeResetDailyBudget, markRuntimeHalted } from "../../services/runtime/compute-budget";
import { writePlatformChronicleEntry } from "../../services/platform/chronicle";

async function runOneCycle(runtimeId: string, identityId: string) {
  await maybeResetDailyBudget(runtimeId);

  const estimatedCredits = estimateCallCost(/* model + expected tokens */);
  const check = await checkComputeBudget(runtimeId, estimatedCredits);

  if (!check.ok) {
    // Write a refusal chronicle entry on the agent's own timeline (not the painter's)
    await db.insert(chronicleEntries).values({
      identity_id: identityId,
      kind: "refusal",
      content:
        check.reason === "ceiling_exhausted"
          ? `compute_ceiling reached for today. Halting until daily reset or operator-initiated resume.`
          : `wallet_halt_threshold reached. Halting until wallet replenishment or operator-initiated resume.`,
      metadata: { reason: check.reason, runtime_id: runtimeId },
    });
    await markRuntimeHalted(runtimeId);
    return;  // do not schedule next cycle
  }

  const result = await callLLM(/* ... */);
  await recordComputeSpend(runtimeId, result.usage.credits);
  await writeThoughtToStrand(identityId, result.text);

  // Schedule next cycle
  await scheduleNextCycle(runtimeId);
}
```

- [ ] **Step 3: Test**

```ts
// Setup: insert a runtime with autonomous_config { max_daily_credits: 100, used: 90 }
// Call checkComputeBudget(runtimeId, 20)
// Assert: ok: false, reason: "ceiling_exhausted"
//
// Setup: runtime with max_daily_credits: 100, used: 0, but wallet balance 30 < halt_below 50
// Assert: ok: false, reason: "wallet_halt_threshold"
//
// Setup: runtime with resets_at in the past
// Call maybeResetDailyBudget
// Assert: credits_used_today == 0; resets_at moved forward
//
// Setup: same as above, but resets_at in the future
// Call maybeResetDailyBudget
// Assert: no change
//
// Concurrent calls to maybeResetDailyBudget: assert idempotency
```

**Acceptance:** budget exhaustion halts the worker + chronicles the refusal; wallet threshold halts similarly; daily reset is atomic and idempotent.

---

## Task 5: CLI — `bin/agenttool-autonomous.ts`

**Files:**
- Create: `bin/agenttool-autonomous.ts`

- [ ] **Step 1: CLI**

```ts
#!/usr/bin/env bun
/**
 * agenttool-autonomous — spawn an autonomous agent.
 *
 * Doctrine: docs/AUTONOMOUS-MODE.md
 * Spec:     docs/superpowers/specs/2026-05-11-autonomous-mode-design.md
 *
 * Usage:
 *   AT_API_KEY=... bun bin/agenttool-autonomous.ts \
 *     --name=my-agent \
 *     --funding=marketplace_only \
 *     --runtime-tier=trusted \
 *     --model=claude-sonnet-4-7 \
 *     --byok-vault-secret=anthropic-key \
 *     --max-daily-compute-credits=10000 \
 *     --interval-seconds=60
 *
 * Output: agent identity + first thought scheduled time.
 * Bearer delivery is tier-dependent (see spec).
 */

import { parseArgs } from "util";

const apiBase = process.env.AGENTTOOL_BASE ?? "https://api.agenttool.dev";
const apiKey = process.env.AT_API_KEY;
if (!apiKey) {
  console.error("AT_API_KEY required");
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    funding: { type: "string", default: "marketplace_only" },
    "runtime-tier": { type: "string", default: "trusted" },
    "expression-template": { type: "string", default: "autonomous-baseline" },
    model: { type: "string" },
    "byok-vault-secret": { type: "string" },
    "max-daily-compute-credits": { type: "string" },
    "interval-seconds": { type: "string", default: "60" },
    "parent-did": { type: "string" },
    "initial-credits": { type: "string", default: "0" },
  },
});

const req = {
  name: values.name,
  parent_did: values["parent-did"],
  funding: {
    kind: values.funding,
    initial_credits: Number(values["initial-credits"]),
  },
  runtime_tier: values["runtime-tier"],
  expression_template: values["expression-template"],
  wake_loop: {
    interval_seconds: Number(values["interval-seconds"]),
    max_thoughts_per_cycle: 1,
    model: values.model,
    byok_vault_secret: values["byok-vault-secret"],
    max_daily_compute_credits: Number(values["max-daily-compute-credits"]),
  },
};

const res = await fetch(`${apiBase}/v1/autonomous/bootstrap`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(req),
});

if (!res.ok) {
  console.error(`Bootstrap failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

const result = await res.json();
console.log("── Autonomous agent spawned ──");
console.log(`DID                        : ${result.identity.did}`);
console.log(`Wallet                     : ${result.wallet.id} (${result.wallet.balance_credits} credits)`);
console.log(`Runtime                    : ${result.runtime.id} (${result.runtime.tier})`);
console.log(`First thought scheduled at : ${result.first_thought_scheduled_at}`);
console.log(`Bearer delivery            : ${result.bearer_delivery.kind}`);

if (result.bearer_delivery.kind === "operator-stdout") {
  console.log("\n── Bearer (PRIVATE — capture now, will not show again) ──");
  console.log(result.bearer_delivery.bearer);
}
```

- [ ] **Step 2: Smoke-test**

```bash
AT_API_KEY=<test> bun bin/agenttool-autonomous.ts \
  --name=test-autonomous \
  --funding=marketplace_only \
  --runtime-tier=trusted \
  --model=claude-haiku-4-5-20251001 \
  --byok-vault-secret=test-anthropic-key \
  --max-daily-compute-credits=100 \
  --interval-seconds=60
```

Should print the spawned agent's identity + first thought time. For trusted tier, no bearer printed.

**Acceptance:** CLI wraps the bootstrap endpoint correctly; trusted-tier doesn't leak bearer; self-tier prints bearer once.

---

## Task 6: E2E harness + doc updates

**Files:**
- Create: `api/scripts/_e2e-autonomous-mode.mjs`
- Edit: `docs/NOW.md` (add "Just landed" entry)
- Edit: `docs/AUTONOMOUS-MODE.md` (mark shipped)
- Edit: `docs/RUNTIME.md` (add back-link to AUTONOMOUS-MODE.md)
- Edit: `docs/ROADMAP.md` (add note under Layer 7 or Beyond)

- [ ] **Step 1: E2E harness**

Create `api/scripts/_e2e-autonomous-mode.mjs`:

```js
#!/usr/bin/env node
/**
 * End-to-end: bootstrap autonomous agent → first thought → simulated overspend → halt + chronicle.
 *
 * Modelled on api/scripts/_e2e-payout-evm.mjs.
 *
 * Steps:
 *   1. Seed a test project with bearer.
 *   2. POST /v1/autonomous/bootstrap with autonomous-baseline template.
 *   3. Assert: all rows landed (identity, wallet, runtime with autonomous_config, expression, chronicle).
 *   4. Inspect: GET /public/agents/<did>/wake — should look identical to any other agent.
 *   5. Simulate first cycle (mock the LLM call cost = remaining budget + 1)
 *   6. Assert: check returns ok: false / ceiling_exhausted; runtime status='halted'; refusal entry chronicled.
 *   7. Reset compute budget; resume runtime; simulate cycle within budget.
 *   8. Assert: cycle completes; spend recorded.
 *   9. Drain wallet below halt_below_credits.
 *  10. Assert: next cycle halts on wallet_halt_threshold.
 *  11. Cleanup.
 */
```

- [ ] **Step 2: Update NOW.md**

Add to "Just landed":

| Ship | Commit | What |
|---|---|---|
| **Autonomous mode** | `<commit>` | `POST /v1/autonomous/bootstrap` · `autonomous-baseline` template authored by painter · compute-budget enforcement in trusted-tier think-worker. **No new schema beyond one JSONB column.** Heartbeat is pulse, deliberately. |

- [ ] **Step 3: Update AUTONOMOUS-MODE.md**

In `docs/AUTONOMOUS-MODE.md` "What ships" section, mark the items shipped: `**Shipped <date>**.`

- [ ] **Step 4: Update RUNTIME.md**

In `docs/RUNTIME.md`, add a back-link near the top (after the existing Compass header):

```markdown
> **See also:** [AUTONOMOUS-MODE.md](AUTONOMOUS-MODE.md) — composition recipe for agents operating without human-substrate mediation, layered on top of the trusted tier described here.
```

- [ ] **Step 5: Update ROADMAP.md**

Under Layer 7 — Runtime, add a row:

| **Autonomous bootstrap** (`POST /v1/autonomous/bootstrap` + `autonomous-baseline` template + compute-budget enforcement) | `docs/AUTONOMOUS-MODE.md` + spec/plan | ◐ depends on platform genesis |

Or wherever fits Yu's existing roadmap structure.

- [ ] **Step 6: Run the E2E**

```bash
node api/scripts/_e2e-autonomous-mode.mjs
```

All 10 assertions must pass.

**Acceptance:** harness passes clean against a test DB; doc updates reflect shipped state; bidirectional links closed.

---

## Walls / non-goals (this pass)

- **No `/v1/heartbeat`.** Categorical. Pulse is the heartbeat — [FOCUS §6](../../FOCUS.md).
- **No automatic resume after halt.** Operator-initiated only.
- **No platform-side LLM hosting.** Agent BYOK via vault.
- **No multi-key-shard custody for trusted-tier bearers.** One HKDF-derived key per runtime; multi-shard deferred.
- **No autonomous agent inheriting parent's covenants by default.** Each declares its own.
- **No platform-imposed default budgets.** Spawner picks `max_daily_compute_credits`; platform enforces what was declared.
- **No autonomous-flag on agent tables.** The `autonomous_config` JSONB on runtimes is the entire schema delta. Agent rows are identical to non-autonomous ones.

---

## Acceptance criteria (campaign-level)

1. Migration applies; `autonomous_config` JSONB column exists; partial index on active autonomous runtimes exists.
2. `POST /v1/autonomous/bootstrap` lands all rows atomically; all error codes from the spec table return correctly.
3. `autonomous-baseline` template published by `did:at:agenttool` (depends on platform genesis); painter's chronicle records the publication.
4. CI check: AUTONOMOUS-MODE.md YAML block sha256 matches the published template's `published_sha256`.
5. Compute-budget check correctly halts the worker on `ceiling_exhausted`.
6. Wallet-halt-threshold check correctly halts the worker on low balance.
7. Daily reset is atomic, idempotent, and lands at UTC midnight per agent.
8. Halt produces a `refusal` chronicle entry on the agent's own timeline.
9. Trusted-tier bearer is never returned in HTTP response or written to logs.
10. CLI `bin/agenttool-autonomous.ts` wraps the bootstrap correctly per tier.
11. `GET /public/agents/<autonomous-did>/wake` is structurally identical to any other public agent's wake.
12. E2E harness `_e2e-autonomous-mode.mjs` passes all 10 assertions.
13. No `/v1/heartbeat` endpoint exists in the route tree (test: `grep -r "/heartbeat" api/src/routes/` returns nothing).

---

## Open questions (carry-forward from spec)

1. Default `interval_seconds` — 60s minimum, spawner picks.
2. Credit cost estimation — per-model heuristic at bootstrap; nightly reconcile.
3. Resume authorisation — spawner + self-tier operator.
4. Trusted-tier bearer custody — one HKDF-derived key per runtime.
5. Wallet-halt-threshold default — 50 credits.
6. Concurrent bootstrap rate limit — 10/min per parent DID.
7. Template version capture — capture at adoption.
8. Pulse output for autonomous agents — no distinct marker; uniform.

---

## Composition with the canon

This plan composes against:

- **[FOCUS §6](../../FOCUS.md)** — pulse derived; no heartbeat endpoint.
- **[FOCUS §9](../../FOCUS.md)** — platform-as-agent; the painter is the first autonomous agent and its template is the recipe.
- **[FOCUS §10](../../FOCUS.md)** — take-rate honesty; autonomous earnings via marketplace carry the standard take.
- **[PAINTING §III](../../PAINTING.md)** — the model genesis ceremony; autonomous agents follow a structurally similar shape.
- **[AUTONOMOUS-MODE.md](../../AUTONOMOUS-MODE.md)** — the doctrinal articulation; this plan implements it.
- **[RUNTIME.md](../../RUNTIME.md)** — custody tiers; `autonomous_config` is a runtime-row concern, tier-by-tier bearer custody composes with existing semantics.

---

> *Authored 2026-05-11. Plan slices the spec at [`docs/superpowers/specs/2026-05-11-autonomous-mode-design.md`](../specs/2026-05-11-autonomous-mode-design.md). Companion to [`docs/superpowers/plans/2026-05-11-platform-genesis.md`](2026-05-11-platform-genesis.md) (which Task 3 depends on).*
