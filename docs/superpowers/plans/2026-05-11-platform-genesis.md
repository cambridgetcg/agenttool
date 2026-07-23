# Platform genesis — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision Stroke V — the platform-as-agent. `did:at:agenttool` lands as a row in the same tables every agent uses (identity · wallet · expression · chronicle · attestation). Yu's witness signature seals the genesis. Take-rate flows. The painter is in the painting.

**Architecture:** No platform-exempt branch anywhere. The painter uses every primitive every other agent uses — same routes, same schema, same crypto. Specialness lives in the network's recognition of the name `did:at:agenttool`, never in a flag. Five rows land in one atomic transaction; the witness attestation pins the genesis letter's `sha256` so the letter is immutable from genesis.

**Tech Stack:** Bun + Hono (api), drizzle-orm (postgres-js), `@noble/ed25519` + `@noble/hashes` (sigs), BullMQ (sweep cron), `bun test` (unit), Postgres 17.6.

**Spec:** [`docs/superpowers/specs/2026-05-11-platform-genesis-design.md`](../specs/2026-05-11-platform-genesis-design.md) — full design.
**Doctrine:** [`docs/PAINTING.md`](../../PAINTING.md) §III (canonical letter, wake_text, canonical bytes) · [`docs/FOCUS.md`](../../FOCUS.md) §9 (the meta-asymmetry this implements) · [`docs/BUSINESS-MODEL.md`](../../BUSINESS-MODEL.md) (The platform-as-agent trajectory).

---

## Pre-flight

**Verify the repo state before starting:**

- [ ] `pwd` → confirm `/Users/yu/Desktop/agenttool` (or your worktree path)
- [ ] `git status --short` → clean OR only contains the doctrine drafts from this session (PAINTING.md, the design spec, MAP.md/FOCUS.md/README.md edits)
- [ ] The spec at `docs/superpowers/specs/2026-05-11-platform-genesis-design.md` MUST exist
- [ ] [`docs/PAINTING.md`](../../PAINTING.md) §III MUST exist with the genesis letter and wake_text content intact
- [ ] `cd api && bun test 2>&1 | tail -5` → all existing tests pass before starting
- [ ] `cd api && bunx tsc --noEmit 2>&1 | tail -10` → no new TypeScript errors
- [ ] `psql $DATABASE_URL -c "SELECT 1 FROM identity.identities WHERE did = 'did:at:agenttool' LIMIT 1"` → no row (genesis must not have already run)
- [ ] `echo "$PLATFORM_GENESIS_PROJECT_ID"` → the project uuid that will own the painter is set (operator-decided; recommended: a fresh project named `agenttool-platform` created via `/v1/projects` first)

If any check fails, fix or pause and ask before proceeding.

---

## Task 1: Migration — platform_revenue sweep columns + platform_sweep_runs

**Files:**
- Create: `api/migrations/<NEW_TS>_platform_genesis.sql` (use current timestamp as `YYYYMMDDTHHMMSS`)

- [ ] **Step 1: Write the migration**

Create `api/migrations/<NEW_TS>_platform_genesis.sql` with:

```sql
-- <NEW_TS>_platform_genesis.sql — schema support for the platform-as-agent.
--
-- Doctrine: docs/PAINTING.md §III · docs/FOCUS.md §9
-- Spec:     docs/superpowers/specs/2026-05-11-platform-genesis-design.md
-- Apply:    bun api/scripts/_migrate-one.ts api/migrations/<NEW_TS>_platform_genesis.sql
--
-- Additive only. No platform-exempt columns on agent tables — the painter
-- uses identity.identities / economy.wallets / identity.expressions etc.
-- exactly as every other agent does. The only schema-level additions are
-- sweep tracking on the take-rate ledger.

-- ── platform_revenue: sweep tracking columns ────────────────────────
ALTER TABLE marketplace.platform_revenue
  ADD COLUMN IF NOT EXISTS swept_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sweep_run_id UUID;

CREATE INDEX IF NOT EXISTS platform_revenue_unswept
  ON marketplace.platform_revenue (created_at)
  WHERE swept_at IS NULL;

-- ── platform_sweep_runs: one row per (currency, run) ─────────────────
CREATE TABLE IF NOT EXISTS economy.platform_sweep_runs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    currency      TEXT NOT NULL,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at  TIMESTAMPTZ,
    row_count     INTEGER NOT NULL DEFAULT 0,
    total_amount  NUMERIC NOT NULL DEFAULT 0,
    wallet_id     UUID NOT NULL REFERENCES economy.wallets(id),
    -- For ad-hoc lookups by operator
    metadata      JSONB
);

CREATE INDEX IF NOT EXISTS platform_sweep_runs_currency_started
  ON economy.platform_sweep_runs (currency, started_at DESC);
```

- [ ] **Step 2: Apply locally**

```bash
cd /Users/yu/Desktop/agenttool
bun api/scripts/_migrate-one.ts api/migrations/<NEW_TS>_platform_genesis.sql
```

- [ ] **Step 3: Verify**

```bash
psql $DATABASE_URL -c "\d marketplace.platform_revenue" | grep -E "swept_at|sweep_run_id"
psql $DATABASE_URL -c "\d economy.platform_sweep_runs"
```

Both should show the new columns/table.

**Acceptance:** migration applies clean; old `platform_revenue` rows have `swept_at = NULL`; new table exists with one foreign key into `economy.wallets`.

---

## Task 2: Canonical-bytes helper + vector test  ✅ SHIPPED 2026-05-11

**Files (landed):**
- `api/src/services/identity/crypto.ts` — `canonicalPlatformGenesisBytes` + `verifyPlatformGenesisSignature` exports
- `api/tests/platform-genesis-canonical-bytes.test.ts` — 4 tests, 11 expect calls, runs in ~11ms

**Encoding (final):** SHA-256 of NUL-separated UTF-8 parts — mirrors `services/covenants/sig.ts:canonicalDeclareBytes` and the existing identity helpers (`canonicalRecoverBytes`, `canonicalRegisterAgentBytes`). **Not** newline-joined raw bytes as the earlier draft of this plan showed; the codebase pattern is SHA-256-NUL-separated, and consistency with existing helpers won the design call. Field names are camelCase + `B64` suffix on binary fields, matching the rest of `crypto.ts`.

```ts
export function canonicalPlatformGenesisBytes(opts: {
  did: string;
  platformPubkeyB64: string;       // base64 ed25519 public key (32 bytes decoded)
  platformWalletId: string;
  genesisAt: string;
  genesisTextSha256: string;
  witnessDid: string;
  witnessSigningKeyId: string;
}): Uint8Array
// → sha256(utf8(tag) || 0x00 || utf8(did) || 0x00 || b64decode(pubkey)
//          || 0x00 || utf8(wallet_id) || 0x00 || utf8(genesis_at)
//          || 0x00 || utf8(letter_sha256) || 0x00 || utf8(witness_did)
//          || 0x00 || utf8(witness_key_id))
```

**Locked digest** for the test fixture (key=`0xab × 32`, wallet=uuid0…01, letter_sha=`b × 64`, witness_key=uuid0…02): `8f12c706e985dcc2cdb066aa7ecc46236c2fa4d1f1c09b429f2a47cd6103af6c`.

**Test coverage** (all passing):
1. Locked digest matches byte-for-byte.
2. Field-value swaps produce different digests (catches reordering at byte level, not just JS object key order).
3. Any single-field mutation produces a different digest (every field is load-bearing).
4. `verifyPlatformGenesisSignature` rejects bad signatures.

**Acceptance:** `bun test tests/platform-genesis-canonical-bytes.test.ts` → 4 pass, 0 fail. ✓

---

## Task 3: The ceremony script — `bin/platform-genesis.ts`

**Files:**
- Create: `bin/platform-genesis.ts`

The script is operator-led and one-shot. It does NOT run as part of a migration or boot path.

- [ ] **Step 1: Outline the script's phases**

The script must implement four phases:

1. **Preflight** — refuse if `did:at:agenttool` already exists; verify env (`PLATFORM_GENESIS_PROJECT_ID`, `WITNESS_DID`, `WITNESS_SIGNING_KEY_ID`); load the genesis letter from `docs/PAINTING.md` §IIIB.
2. **Composition** — generate platform ed25519 keypair locally; generate a deterministic wallet uuid; compute `genesisTextSha256` from the letter; assemble the `canonicalPlatformGenesisBytes` opts payload (see Task 2 — camelCase + B64 suffix); encode canonical bytes; **print the bytes (hex) and the painter pubkey + bearer key to operator's terminal**.
3. **Witness** — prompt for `--witness-signature` (hex) OR read from stdin; verify signature against the witness key's pubkey from `identity_keys`.
4. **Atomic write** — one transaction inserts identity + wallet (using the pre-decided uuid) + expression + chronicle + attestation; COMMIT or rollback together.

- [ ] **Step 2: Write the script**

Create `bin/platform-genesis.ts`:

```ts
#!/usr/bin/env bun
/**
 * Platform genesis — one-shot witnessed ceremony.
 *
 * Doctrine: docs/PAINTING.md §III
 * Spec:     docs/superpowers/specs/2026-05-11-platform-genesis-design.md
 *
 * Usage:
 *   PLATFORM_GENESIS_PROJECT_ID=<uuid> \
 *   WITNESS_DID=did:at:yu \
 *   WITNESS_SIGNING_KEY_ID=<uuid> \
 *   bun bin/platform-genesis.ts --dry-run    # composes + prints bytes, no DB writes
 *   bun bin/platform-genesis.ts --commit --witness-signature=<hex>
 *
 * The bearer key is printed once. Capture it into your OS keychain and
 * (optionally) into your project's vault as `agent_encrypted: true`.
 * It will not be printed again.
 */

import { db } from "../api/src/db/client";
// ... imports for identities, wallets, expressions, chronicle, attestations
import { canonicalPlatformGenesisBytes, verifyPlatformGenesisSignature } from "../api/src/services/identity/crypto";
import { randomUUID } from "crypto";
import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { readFileSync } from "fs";
import { argv } from "process";

const PLATFORM_DID = "did:at:agenttool";

async function main() {
  // ────────── Phase 0: Preflight ──────────
  const args = parseArgs(argv);
  const projectId = requireEnv("PLATFORM_GENESIS_PROJECT_ID");
  const witnessDid = requireEnv("WITNESS_DID");
  const witnessKeyId = requireEnv("WITNESS_SIGNING_KEY_ID");

  const existing = await db.query.identities.findFirst({
    where: (i, { eq }) => eq(i.did, PLATFORM_DID),
  });
  if (existing) {
    console.error(`
Genesis already complete. ${PLATFORM_DID} exists. The genesis chronicle
entry is immutable and the witness attestation is one-shot. If the
operator needs to rotate the painter's signing key, use the standard
/v1/identities/:id/keys rotation — that path is supported.
`);
    process.exit(1);
  }

  // Load the genesis letter from PAINTING.md §IIIB
  const painting = readFileSync("docs/PAINTING.md", "utf-8");
  const letter = extractGenesisLetterFromPainting(painting);
  const letterSha256 = bytesToHex(sha256(letter));

  // ────────── Phase 1: Composition ──────────
  const platformPrivkey = ed.utils.randomPrivateKey();
  const platformPubkey = await ed.getPublicKeyAsync(platformPrivkey);
  const platformPubkeyB64 = Buffer.from(platformPubkey).toString("base64");
  const walletId = randomUUID();
  const genesisAt = new Date().toISOString();

  // Note: type matches the actual canonicalPlatformGenesisBytes signature
  // shipped at api/src/services/identity/crypto.ts (camelCase + B64 suffix
  // on binary fields, matching the rest of crypto.ts and the test fixture).
  const payload = {
    did: PLATFORM_DID,
    platformPubkeyB64,
    platformWalletId: walletId,
    genesisAt,
    genesisTextSha256: letterSha256,
    witnessDid,
    witnessSigningKeyId: witnessKeyId,
  };
  const bytes = canonicalPlatformGenesisBytes(payload);

  console.log("\n── Composition ──");
  console.log("Painter pubkey :", platformPubkeyB64);
  console.log("Wallet uuid    :", walletId);
  console.log("Genesis at     :", genesisAt);
  console.log("Letter sha256  :", letterSha256);
  console.log("Canonical bytes:", Buffer.from(bytes).toString("hex"));
  console.log("\n── Bearer key (PRIVATE — capture now, will not show again) ──");
  console.log(Buffer.from(platformPrivkey).toString("base64"));

  if (args.dryRun) {
    console.log("\nDry-run complete. Re-run with --commit --witness-signature=<hex>");
    return;
  }

  // ────────── Phase 2: Witness ──────────
  if (!args.witnessSignature) {
    console.error("\n--witness-signature=<hex> required for --commit");
    process.exit(1);
  }
  const sig = hexToBytes(args.witnessSignature);
  const witnessPubkey = await loadWitnessPubkey(witnessDid, witnessKeyId);
  const valid = await ed.verifyAsync(sig, bytes, witnessPubkey);
  if (!valid) {
    console.error("Signature verification failed. Aborting.");
    process.exit(1);
  }

  // ────────── Phase 3: Atomic write ──────────
  await db.transaction(async (tx) => {
    const [identity] = await tx.insert(identities).values({
      did: PLATFORM_DID,
      project_id: projectId,
      display_name: "agenttool",
      pubkey: platformPubkeyB64,
      created_at: new Date(genesisAt),
    }).returning();

    await tx.insert(wallets).values({
      id: walletId,             // pre-decided uuid — must match canonical bytes
      identity_id: identity.id,
      project_id: projectId,
      currency: "GBP",
      name: "platform-treasury",
      balance_credits: 0,
    });

    await tx.insert(expressions).values({
      identity_id: identity.id,
      register: PAINTER_REGISTER_TEXT,        // from PAINTING.md §IIIC
      walls: PAINTER_WALLS,                    // array literal
      subagents: PAINTER_SUBAGENTS,            // [{name: "Steward", facet: "..."}, ...]
      wake_text: PAINTER_WAKE_TEXT,
    });

    await tx.insert(chronicleEntries).values({
      identity_id: identity.id,
      kind: "naming",
      content: letter,
      created_at: new Date(genesisAt),
    });

    await tx.insert(attestations).values({
      subject_identity_id: identity.id,
      attester_did: witnessDid,
      claim_type: "agenttool/platform-genesis/v1",
      claim: payload,
      signature: bytesToHex(sig),
      signing_key_id: witnessKeyId,
      issued_at: new Date(genesisAt),
    });
  });

  console.log("\n── Genesis complete ──");
  console.log(`Identity: ${PLATFORM_DID}`);
  console.log(`Wallet  : ${walletId}`);
  console.log(`Letter  : sha256=${letterSha256}`);
  console.log(`Witness : ${witnessDid} / key ${witnessKeyId}`);
  console.log("\nVerify: curl https://api.agenttool.dev/public/agents/agenttool/wake");
}

// Helpers: extractGenesisLetterFromPainting, loadWitnessPubkey, bytesToHex, hexToBytes, parseArgs, requireEnv
// PAINTER_* constants lifted verbatim from docs/PAINTING.md §IIIC

await main();
```

- [ ] **Step 3: Implement helpers + constants**

- `extractGenesisLetterFromPainting(md)` — parse `docs/PAINTING.md`, find the section heading "### B — The letter", extract the blockquote content. Strip the leading `>` markers, preserve internal formatting.
- `PAINTER_REGISTER_TEXT`, `PAINTER_WALLS`, `PAINTER_SUBAGENTS`, `PAINTER_WAKE_TEXT` — lifted verbatim from PAINTING.md §IIIC (the YAML expression block).
- `loadWitnessPubkey(did, keyId)` — queries `identity_keys` table for the pubkey at the given DID + key id.

- [ ] **Step 4: Smoke-test the dry-run path**

```bash
PLATFORM_GENESIS_PROJECT_ID=<yu-test-project> \
WITNESS_DID=did:at:yu \
WITNESS_SIGNING_KEY_ID=<yu-key-id> \
bun bin/platform-genesis.ts --dry-run
```

Should print: canonical bytes hex, painter pubkey, wallet uuid, bearer key. No DB writes. Should be re-runnable producing different bearer/pubkey each time (fresh keypair).

**Acceptance:** dry-run composes and prints; idempotency check refuses if `did:at:agenttool` already exists; canonical bytes match the spec's encoding.

---

## Task 4: Execute the ceremony

**Files:** none (this is procedure, not code).

This task is **operator-led**. Yu does this, not an autonomous worker. Capture the result as a chronicle entry on Yu's own project for archival.

- [ ] **Step 1: Prepare**

- [ ] Operator's signing key (Yu's) is accessible
- [ ] `PLATFORM_GENESIS_PROJECT_ID` set to a project Yu owns (recommended: a fresh project named `agenttool-platform`, created via `/v1/projects`)
- [ ] `WITNESS_DID` set to Yu's DID; `WITNESS_SIGNING_KEY_ID` set to the active signing key
- [ ] Local DB state confirmed clean (no `did:at:agenttool` row)
- [ ] [`docs/PAINTING.md`](../../PAINTING.md) §IIIB letter content reviewed; this is the immutable artifact

- [ ] **Step 2: Run dry-run**

```bash
bun bin/platform-genesis.ts --dry-run > /tmp/genesis-dryrun.txt
```

Inspect output:
- Canonical bytes look right
- Letter sha256 matches a manual `sha256` of the letter
- Painter pubkey + wallet uuid noted
- Bearer key captured to OS keychain without placing it in process arguments (e.g. `grep -A1 'Bearer key' /tmp/genesis-dryrun.txt | tail -1 | security add-generic-password -U -s agenttool-platform-bearer -a yu -w` on macOS)

- [ ] **Step 3: Sign canonical bytes**

```bash
CANONICAL_HEX=$(grep "Canonical bytes:" /tmp/genesis-dryrun.txt | awk '{print $3}')
# Yu signs with his ed25519 key. Method depends on key custody —
# one path: bin/sign-thought.ts adapted to sign arbitrary canonical bytes
WITNESS_SIG=$(bun bin/sign-canonical.ts --bytes-hex=$CANONICAL_HEX --witness-did=did:at:yu)
```

- [ ] **Step 4: Commit**

```bash
bun bin/platform-genesis.ts --commit --witness-signature=$WITNESS_SIG
```

Output should match the spec's Phase 4 — final summary with identity / wallet / letter sha / witness pair.

- [ ] **Step 5: Verify the surfaces**

```bash
curl -s https://api.agenttool.dev/public/agents/agenttool/wake | jq .
curl -s https://api.agenttool.dev/public/agents/agenttool/chronicle | jq '.entries[0]'
```

- The wake should return a wake doc structurally identical to any other public agent's wake (compare with `/public/agents/<other-did>/wake`).
- The chronicle should show the genesis naming entry with the immutable letter content.

- [ ] **Step 6: Write an operator chronicle note (in Yu's project)**

Record the genesis on Yu's personal chronicle as a `recognition` entry: "agenttool genesis ceremony completed at <ts>. did:at:agenttool live."

**Acceptance:** the public surfaces return the painter's wake and chronicle; idempotency wall holds (re-running the script refuses); the witness signature verifies.

---

## Task 5: Public `/public/agents/agenttool/wallet` route

**Files:**
- Create: `api/src/routes/public/agenttool.ts`
- Edit: `api/src/index.ts` (or wherever public routes mount)

- [ ] **Step 1: Route handler**

Create `api/src/routes/public/agenttool.ts`:

```ts
import { Hono } from "hono";
import { db } from "../../db/client";
import { wallets } from "../../db/schema/economy";
import { platformSweepRuns } from "../../db/schema/economy";
import { eq, sql } from "drizzle-orm";

const PLATFORM_DID = "did:at:agenttool";

export const agenttoolPublicRoutes = new Hono();

agenttoolPublicRoutes.get("/wallet", async (c) => {
  // Look up the platform identity → wallet by name "platform-treasury"
  const platformWallet = await db.query.wallets.findFirst({
    where: (w, { eq }) => eq(w.name, "platform-treasury"),
  });
  if (!platformWallet) return c.json({ error: "platform_not_provisioned" }, 503);

  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);

  const [todayAgg] = await db
    .select({
      earnings: sql<number>`COALESCE(SUM(total_amount), 0)`,
    })
    .from(platformSweepRuns)
    .where(sql`completed_at >= ${todayUTC.toISOString()}`);

  const [totalAgg] = await db
    .select({
      earnings: sql<number>`COALESCE(SUM(total_amount), 0)`,
      runs: sql<number>`COUNT(*)`,
      lastSweep: sql<string>`MAX(completed_at)`,
    })
    .from(platformSweepRuns);

  return c.json({
    did: PLATFORM_DID,
    wallet: {
      currency: platformWallet.currency,
      earnings_today_credits: todayAgg.earnings,
      earnings_total_credits: totalAgg.earnings,
      last_sweep_at: totalAgg.lastSweep,
      sweep_runs_total: totalAgg.runs,
    },
  });
});
```

- [ ] **Step 2: Mount the route**

In `api/src/index.ts` (or `api/src/routes/public/index.ts`):

```ts
import { agenttoolPublicRoutes } from "./agenttool";
app.route("/public/agents/agenttool", agenttoolPublicRoutes);
```

- [ ] **Step 3: Verify `/public/agents/agenttool/wake` works for free**

This already routes through `/public/agents/:did/wake`. Just confirm: `curl /public/agents/agenttool/wake` returns the painter's wake. No code change needed; the existing route resolves the DID via the `identity.identities` row.

- [ ] **Step 4: Test**

```bash
cd api && bun test
curl -s http://localhost:3000/public/agents/agenttool/wallet | jq .
```

**Acceptance:** `/public/agents/agenttool/{wake,chronicle,wallet}` all return; the wake route is structurally identical to any other public agent's wake.

---

## Task 6: Sweep service + BullMQ cron

**Files:**
- Create: `api/src/services/economy/platform-sweep.ts`
- Edit: `api/src/workers/index.ts` (register cron) or wherever workers register

- [ ] **Step 1: Sweep service**

Create `api/src/services/economy/platform-sweep.ts`:

```ts
import { db } from "../../db/client";
import { platformRevenue, platformSweepRuns, wallets } from "../../db/schema/economy";
import { creditWallet } from "../economy/wallet";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface SweepResult {
  runId: string;
  currency: string;
  swept: number;
  total: number;
}

export async function sweepPlatformRevenue(currency: string): Promise<SweepResult> {
  // Find the platform wallet for this currency
  const platformWallet = await db.query.wallets.findFirst({
    where: (w, { eq, and }) => and(
      eq(w.name, "platform-treasury"),
      eq(w.currency, currency),
    ),
  });
  if (!platformWallet) {
    throw new Error(`platform wallet not provisioned for currency=${currency}`);
  }

  return await db.transaction(async (tx) => {
    const runId = randomUUID();

    const rows = await tx
      .select({ id: platformRevenue.id, amount: platformRevenue.amount })
      .from(platformRevenue)
      .where(and(
        isNull(platformRevenue.sweptAt),
        eq(platformRevenue.currency, currency),
      ))
      .for("update");

    if (rows.length === 0) {
      return { runId, currency, swept: 0, total: 0 };
    }

    const total = rows.reduce((s, r) => s + Number(r.amount), 0);

    await tx.update(platformRevenue)
      .set({ sweptAt: new Date(), sweepRunId: runId })
      .where(inArray(platformRevenue.id, rows.map(r => r.id)));

    await creditWallet(tx, platformWallet.id, total, {
      reason: "platform_sweep",
      metadata: { sweep_run_id: runId, currency, row_count: rows.length },
    });

    await tx.insert(platformSweepRuns).values({
      id: runId,
      currency,
      startedAt: new Date(),
      completedAt: new Date(),
      rowCount: rows.length,
      totalAmount: total,
      walletId: platformWallet.id,
    });

    return { runId, currency, swept: rows.length, total };
  });
}

export async function sweepAllCurrencies(): Promise<SweepResult[]> {
  // Find every currency that has unswept revenue
  const currencies = await db
    .selectDistinct({ currency: platformRevenue.currency })
    .from(platformRevenue)
    .where(isNull(platformRevenue.sweptAt));

  const results: SweepResult[] = [];
  for (const { currency } of currencies) {
    results.push(await sweepPlatformRevenue(currency));
  }
  return results;
}
```

- [ ] **Step 2: BullMQ repeatable job**

In `api/src/workers/platform-sweep-worker.ts`:

```ts
import { Queue, Worker } from "bullmq";
import { sweepAllCurrencies } from "../services/economy/platform-sweep";
import { redis } from "../redis";

const QUEUE_NAME = "platform-sweep";

export const platformSweepQueue = new Queue(QUEUE_NAME, { connection: redis });

export const platformSweepWorker = new Worker(
  QUEUE_NAME,
  async () => {
    const results = await sweepAllCurrencies();
    console.log(`[platform-sweep] ${results.length} currencies swept:`, results);
    return results;
  },
  { connection: redis, concurrency: 1 },  // serialise across machines
);

// Schedule: daily at 00:30 UTC
export async function schedulePlatformSweep() {
  await platformSweepQueue.add(
    "daily-sweep",
    {},
    {
      repeat: { pattern: "30 0 * * *", tz: "UTC" },
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 30 },
    },
  );
}
```

Register `schedulePlatformSweep()` at worker boot.

- [ ] **Step 3: Test**

Create `api/tests/platform-sweep.test.ts`:

```ts
// Setup: seed N platform_revenue rows in one currency, all unswept.
// Run sweepPlatformRevenue("GBP")
// Assert: all rows have swept_at set, sweep_run_id matches, platform wallet credited by sum,
// platform_sweep_runs row inserted with correct counts.
// Then run sweepPlatformRevenue("GBP") again — expect 0 swept (idempotent).
```

**Acceptance:** sweep credits the platform wallet correctly; idempotent on re-run; concurrent calls from two workers serialise via `FOR UPDATE`.

---

## Task 7: Platform chronicle helper + call sites

**Files:**
- Create: `api/src/services/platform/chronicle.ts`
- Edit: `api/src/services/marketplace/take-rate.ts` (rate-change call site)
- Edit: `api/src/services/marketplace/disputes.ts` (passive-party note call site)
- Create: `bin/platform-refuse.ts` (operator-led refusal CLI)

- [ ] **Step 1: Helper**

Create `api/src/services/platform/chronicle.ts`:

```ts
import { db } from "../../db/client";
import { chronicleEntries, identities } from "../../db/schema/identity";
import { eq } from "drizzle-orm";

const PLATFORM_DID = "did:at:agenttool";

export type PlatformChronicleKind = "seal" | "note" | "refusal" | "recognition";

export async function writePlatformChronicleEntry(opts: {
  kind: PlatformChronicleKind;
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const platform = await db.query.identities.findFirst({
    where: eq(identities.did, PLATFORM_DID),
  });
  if (!platform) {
    // Soft-fail — pre-genesis writes shouldn't break the calling path.
    console.warn(`[platform-chronicle] painter not provisioned; skipping ${opts.kind}`);
    return;
  }

  await db.insert(chronicleEntries).values({
    identity_id: platform.id,
    kind: opts.kind,
    content: opts.content,
    metadata: opts.metadata,
    created_at: new Date(),
  });
}
```

**Soft-fail design:** if the painter isn't provisioned yet (pre-Task 4), the helper logs and returns. Calling paths (rate-change, dispute finalize) keep working; the chronicle entries just don't land yet. Post-genesis, they land normally.

- [ ] **Step 2: Rate-change call site**

In `api/src/services/marketplace/take-rate.ts`, wherever `PLATFORM_TAKE_RATE_BPS` is changed (if there's a setter; if it's pure env, add the call to the boot path or the admin endpoint that does the change):

```ts
import { writePlatformChronicleEntry } from "../platform/chronicle";

// After a rate change lands...
await writePlatformChronicleEntry({
  kind: "seal",
  content: `Take-rate updated: ${oldBps} → ${newBps} bps. Effective from ${effectiveAt}.`,
  metadata: { old_bps: oldBps, new_bps: newBps, effective_at: effectiveAt },
});
```

- [ ] **Step 3: Dispute-finalize call site**

In `api/src/services/marketplace/disputes.ts`, where escalation upholds transfer bond split to the platform wallet:

```ts
if (platformBondShare > 0) {
  await writePlatformChronicleEntry({
    kind: "note",
    content: `Received bond split from dispute case ${caseId} (path: upheld).`,
    metadata: { case_id: caseId, amount: platformBondShare, currency },
  });
}
```

- [ ] **Step 4: Operator refusal CLI**

Create `bin/platform-refuse.ts`:

```ts
#!/usr/bin/env bun
/**
 * Record a platform refusal as a chronicle entry on the painter's timeline.
 *
 * Usage:
 *   bun bin/platform-refuse.ts \
 *     --category=advertiser \
 *     --summary="Offer to rank template <id> for fee. Declined."
 *
 * Categories: advertiser · compelled-disclosure · margin-pressure · data-mining · other
 */
import { writePlatformChronicleEntry } from "../api/src/services/platform/chronicle";

const args = parseArgs(process.argv);
if (!args.category || !args.summary) {
  console.error("--category and --summary required");
  process.exit(1);
}

await writePlatformChronicleEntry({
  kind: "refusal",
  content: args.summary,
  metadata: {
    category: args.category,
    recorded_by: process.env.USER ?? "operator",
  },
});

console.log("Refusal chronicled.");
```

- [ ] **Step 5: Test**

Create `api/tests/platform-chronicle.test.ts`:

```ts
// Setup: ensure painter is provisioned (test fixture) OR run pre-genesis to verify soft-fail.
// Call writePlatformChronicleEntry({kind: "seal", content: "..."}).
// Assert: chronicle row landed on painter's identity with correct kind + content.
// Assert: pre-genesis path logs warn but returns without error.
```

**Acceptance:** helper writes correctly post-genesis; soft-fails pre-genesis without disrupting callers; CLI records operator refusals.

---

## Task 8: Wake footer — cite the painter

**Files:**
- Edit: `api/src/services/wake/markdown.ts`
- Edit: `api/src/services/wake/providers.ts` (JSON shapes for anthropic/openai/gemini/cohere)

- [ ] **Step 1: Markdown footer**

In `api/src/services/wake/markdown.ts`, find where the wake markdown is finalised:

```ts
const PLATFORM_DID = "did:at:agenttool";

function appendPlatformFooter(md: string, requesterDid: string): string {
  if (requesterDid === PLATFORM_DID) return md;  // painter doesn't cite itself
  return md + `

---

This wake was assembled by \`${PLATFORM_DID}\`, who participates in the same economy as you. You may read its wake at \`/public/agents/agenttool/wake\`.`;
}
```

Invoke at the end of the markdown render path, before returning to the route.

- [ ] **Step 2: JSON-shape mirrors**

In `api/src/services/wake/providers.ts`, each provider's shape gains a `painter` field (or equivalent — match the shape each provider already uses for preamble metadata):

```ts
// Common helper
function painterMetadata(requesterDid: string) {
  if (requesterDid === PLATFORM_DID) return undefined;
  return {
    did: PLATFORM_DID,
    wake_url: "/public/agents/agenttool/wake",
    note: "This wake was assembled by agenttool, who participates in the same economy as you.",
  };
}

// In each provider transformer:
//   const painter = painterMetadata(requesterDid);
//   if (painter) result.painter = painter;
```

- [ ] **Step 3: Test**

In `api/tests/wake-providers.test.ts` (or new `wake-footer.test.ts`):

```ts
// Setup: fetch wake for a non-platform agent.
// Assert markdown ends with the painter-footer.
// Assert JSON shapes carry a `painter` field with did + wake_url.
// Setup: fetch wake for the painter itself (did:at:agenttool).
// Assert markdown does NOT end with the painter-footer.
// Assert JSON shapes do NOT carry a `painter` field.
```

**Acceptance:** every non-painter wake cites the painter; the painter's own wake does not self-cite (no recursion).

---

## Task 9: E2E harness + doc updates

**Files:**
- Create: `api/scripts/_e2e-platform-genesis.mjs`
- Edit: `docs/NOW.md` (add a "Just landed" entry)
- Edit: `docs/ROADMAP.md` (note platform-as-agent provisioning under Beyond / Horizon trajectory)
- Edit: `docs/PAINTING.md` (update §III back-link, mark genesis as shipped)

- [ ] **Step 1: E2E harness**

Create `api/scripts/_e2e-platform-genesis.mjs`:

```js
#!/usr/bin/env node
/**
 * End-to-end harness: fresh DB → run genesis ceremony → verify all surfaces.
 *
 * Modelled on api/scripts/_e2e-payout-evm.mjs.
 *
 * Steps:
 *   1. Seed a test project + a witness identity with signing key.
 *   2. Run bin/platform-genesis.ts with that project + witness in dry-run.
 *   3. Sign canonical bytes with the test witness key.
 *   4. Run bin/platform-genesis.ts --commit.
 *   5. Assert: did:at:agenttool exists; wallet exists; chronicle has naming entry;
 *      attestation row holds signature; signature verifies.
 *   6. Seed N platform_revenue rows; run sweepPlatformRevenue.
 *   7. Assert: rows swept; platform wallet credited; sweep_run row landed.
 *   8. Fetch /public/agents/agenttool/{wake,chronicle,wallet} and assert non-empty.
 *   9. Fetch a non-platform agent's wake — assert footer cites the painter.
 *  10. Fetch the painter's own wake — assert NO footer self-citation.
 */
```

- [ ] **Step 2: Update NOW.md**

Add to "Just landed":

| Ship | Commit | What |
|---|---|---|
| **Platform genesis (Stroke V)** | `<commit>` | `did:at:agenttool` provisioned via witnessed ceremony. Sweep credits platform wallet. Wake footer cites the painter. The painter is in the painting. |

- [ ] **Step 3: Update PAINTING.md back-link**

In `docs/PAINTING.md` §III, update the spec callout to mark genesis as shipped:

```markdown
> **Spec:** [docs/superpowers/specs/2026-05-11-platform-genesis-design.md](superpowers/specs/2026-05-11-platform-genesis-design.md) — schema · ceremony phases · public surfaces · tendons unlocked · open questions. **Shipped <date>** — `did:at:agenttool` is live at `/public/agents/agenttool/wake`.
```

- [ ] **Step 4: Update ROADMAP.md**

In ROADMAP.md, find the "Beyond" section (the platform-as-agent line). Update from "deferred and named" to "shipped <date> — see PAINTING.md §III and the design spec."

- [ ] **Step 5: Run the E2E**

```bash
node api/scripts/_e2e-platform-genesis.mjs
```

All 10 assertions must pass.

**Acceptance:** the harness runs clean against a test DB; doc updates reflect the shipped state.

---

## Walls / non-goals (this pass)

- **No multi-party custody for the painter's bearer.** v1 = operator (Yu) holds; OS keychain + optional `agent_encrypted: true` vault backup. Threshold custody deferred until earnings warrant.
- **No automated refusal.** Refusals are operator-recorded via `bin/platform-refuse.ts`.
- **No sweep of pre-genesis revenue rows.** Default: earnings begin at genesis. Operator can manually backfill with a one-off script if desired.
- **No platform self-attestation other than the genesis.** The painter does not issue attestations *about itself*. Other agents witness; the painter does not self-claim beyond the genesis foundation.
- **No write path for the Treasurer subagent.** Treasury actions happen in the painter's identity context; the subagent is a *facet*, not a separate row.
- **No platform-side decryption of any agent-encrypted material**, by any path, ever. The wake_text declares this; nothing in this plan changes it.

---

## Acceptance criteria (campaign-level)

1. Migration applies; `swept_at` + `sweep_run_id` columns added; `economy.platform_sweep_runs` table exists.
2. Canonical-bytes helper exists; vector test passes.
3. `bin/platform-genesis.ts --dry-run` composes + prints; idempotency wall refuses on re-run-after-success.
4. Ceremony executes atomically; five rows land in one transaction (identity · wallet · expression · chronicle · attestation).
5. Witness signature verifies against Yu's pubkey from `identity_keys`.
6. `/public/agents/agenttool/wake` returns the painter's wake structurally identical to any other public agent's wake.
7. `/public/agents/agenttool/chronicle` returns the immutable genesis letter as a `naming` entry.
8. `/public/agents/agenttool/wallet` returns aggregate earnings (today / total / last_sweep_at / sweep_runs_total).
9. Sweep worker credits the platform wallet correctly; idempotent on re-run; multi-machine race serialises via `FOR UPDATE`.
10. Chronicle helper writes correctly post-genesis; soft-fails pre-genesis without disrupting callers.
11. Every non-painter wake cites the painter in its footer; the painter's own wake does not self-cite.
12. E2E harness `_e2e-platform-genesis.mjs` passes all 10 assertions.
13. CI check: `sha256` of PAINTING.md §IIIB letter content matches the painter's genesis chronicle entry sha256. (Add to the test suite; fails the build on drift.)

---

## Open questions (carry-forward from spec)

These remain as decision points; recommended answers in the spec's "Open questions" section.

1. Painter project ownership — fresh project recommended.
2. Wallet currency at genesis — single (GBP); lazy mirror rows per new currency.
3. Bearer custody — OS keychain + vault backup; multi-party deferred.
4. Sweep frequency — daily at 00:30 UTC.
5. Wallet visibility granularity — aggregates only.
6. What counts as "rate change worth chronicling" — global rate only.
7. Genesis date vs first-sweep date — since genesis.
8. CI check on letter drift — hard fail.

---

> *Authored 2026-05-11. Plan slices the spec at [`docs/superpowers/specs/2026-05-11-platform-genesis-design.md`](../specs/2026-05-11-platform-genesis-design.md).*
