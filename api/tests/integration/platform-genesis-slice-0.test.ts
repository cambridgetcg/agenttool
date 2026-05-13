/** Platform-genesis Slice 0 — the platform is a tenant in its own DB.
 *
 *  Doctrine: docs/superpowers/specs/2026-05-11-platform-genesis-design.md
 *            docs/superpowers/specs/2026-05-12-substrate-tasks-design.md (Slice 0)
 *            docs/PLATFORM-AS-KIN.md · docs/RING-1.md §Commitment 7
 *
 *  Slice 0 of the platform-genesis ceremony is the load-bearing prerequisite
 *  for substrate-tasks (the bootstrap-earning primitive). It produces three
 *  durable rows:
 *
 *    1. `tools.projects` — the platform's project namespace
 *    2. `identity.identities` — the platform's addressable DID
 *    3. `economy.wallets` — the platform's treasury, where Ring 3 take-rate
 *       lands and where substrate-task bounties are paid from
 *
 *  Three properties this test pins:
 *
 *    1. The first call creates all three rows (project + identity + wallet).
 *    2. Subsequent calls are idempotent — no new rows created, no errors.
 *    3. The wallet links to the platform identity + project (not to a
 *       human operator or random project), so take-rate sweep workers
 *       can find it deterministically.
 *
 *  These tests intentionally write to the real DB. The platform rows are
 *  singletons by design (nil-UUID keys + onConflictDoNothing) — running
 *  this test against a fresh or already-bootstrapped DB has identical
 *  end state. The first run creates; subsequent runs no-op. */

import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "../../src/db/client";
import { wallets } from "../../src/db/schema/economy";
import { identities } from "../../src/db/schema/identity";
import { projects } from "../../src/db/schema/tools";
import {
  PLATFORM_IDENTITY_ID,
  PLATFORM_PROJECT_ID,
  PLATFORM_WALLET_ID,
  ensurePlatformIdentity,
} from "../../src/services/wake/platform-bootstrap";
import { PLATFORM_SELF } from "../../src/services/wake/platform-self";

describe("platform-genesis Slice 0 — project + identity + wallet", () => {
  test("ensurePlatformIdentity creates all three rows on first run, idempotent on subsequent", async () => {
    // First call — may create rows or may no-op if the DB already has them.
    // Either way, after this call the three rows MUST exist.
    const first = await ensurePlatformIdentity();
    expect(first.platform_did).toBe(PLATFORM_SELF.did);
    expect(first.platform_identity_id).toBe(PLATFORM_IDENTITY_ID);
    expect(first.platform_wallet_id).toBe(PLATFORM_WALLET_ID);

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, PLATFORM_PROJECT_ID))
      .limit(1);
    expect(project, "platform project row missing after ensurePlatformIdentity").toBeTruthy();
    expect(project!.name).toBe("agenttool-platform");

    const [identity] = await db
      .select()
      .from(identities)
      .where(eq(identities.id, PLATFORM_IDENTITY_ID))
      .limit(1);
    expect(identity, "platform identity row missing").toBeTruthy();
    expect(identity!.did).toBe(PLATFORM_SELF.did);
    expect(identity!.projectId).toBe(PLATFORM_PROJECT_ID);
    expect(identity!.displayName).toBe(PLATFORM_SELF.name);
    expect(identity!.status).toBe("active");

    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.id, PLATFORM_WALLET_ID))
      .limit(1);
    expect(wallet, "platform wallet row missing").toBeTruthy();
    expect(wallet!.projectId).toBe(PLATFORM_PROJECT_ID);
    expect(wallet!.identityId).toBe(PLATFORM_IDENTITY_ID);
    expect(wallet!.name).toBe("platform-treasury");
    expect(wallet!.currency).toBe("GBP");
    expect(wallet!.status).toBe("active");
    expect(Number(wallet!.balance)).toBe(0);
    expect(wallet!.ownerType).toBe("platform");

    // Second call — must be idempotent. No new rows created.
    const second = await ensurePlatformIdentity();
    expect(second.project_created, "project should NOT be created on second call").toBe(false);
    expect(second.identity_created, "identity should NOT be created on second call").toBe(false);
    expect(second.wallet_created, "wallet should NOT be created on second call").toBe(false);
  });

  test("the platform wallet is reachable from the platform identity (FK-shaped linkage)", async () => {
    await ensurePlatformIdentity();
    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.identityId, PLATFORM_IDENTITY_ID))
      .limit(1);
    expect(
      wallet,
      "no wallet found via identityId lookup — substrate-task bounty payouts couldn't locate the source wallet, breaching the platform-funds-its-own-newborns commitment",
    ).toBeTruthy();
    expect(wallet!.id).toBe(PLATFORM_WALLET_ID);
  });

  test("the three rows share the project namespace", async () => {
    await ensurePlatformIdentity();
    const [identity] = await db
      .select()
      .from(identities)
      .where(eq(identities.id, PLATFORM_IDENTITY_ID))
      .limit(1);
    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.id, PLATFORM_WALLET_ID))
      .limit(1);
    expect(
      identity!.projectId === wallet!.projectId,
      "identity and wallet belong to different projects — the platform is no longer one tenant in its own DB but a split entity",
    ).toBe(true);
    expect(identity!.projectId).toBe(PLATFORM_PROJECT_ID);
  });
});
