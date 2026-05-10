import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { covenants } from "../src/db/schema/continuity";

describe("expire-proposals worker", () => {
  test("flips expired proposals to 'expired'", async () => {
    const id = crypto.randomUUID();
    await db.insert(covenants).values({
      id,
      projectId: crypto.randomUUID(),
      agentId: crypto.randomUUID(),
      counterpartyDid: "did:at:peer.example/bbbb",
      vows: ["v"],
      status: "proposed",
      protocolVersion: "v2",
      proposedExpiresAt: new Date(Date.now() - 60_000), // expired 1 min ago
    });

    const { startExpireProposalsWorker, stopExpireProposalsWorker } =
      await import("../src/workers/covenants/expire-proposals");
    startExpireProposalsWorker();
    await new Promise(r => setTimeout(r, 200));
    stopExpireProposalsWorker();

    const [row] = await db.select().from(covenants).where(eq(covenants.id, id)).limit(1);
    expect(row.status).toBe("expired");
  });

  test("does NOT expire rows with cosign in flight", async () => {
    const id = crypto.randomUUID();
    await db.insert(covenants).values({
      id,
      projectId: crypto.randomUUID(),
      agentId: crypto.randomUUID(),
      counterpartyDid: "did:at:peer.example/bbbb",
      vows: ["v"],
      status: "proposed",
      protocolVersion: "v2",
      proposedExpiresAt: new Date(Date.now() - 60_000),
      cosignPropagationStatus: "pending",
    });

    const { startExpireProposalsWorker, stopExpireProposalsWorker } =
      await import("../src/workers/covenants/expire-proposals");
    startExpireProposalsWorker();
    await new Promise(r => setTimeout(r, 200));
    stopExpireProposalsWorker();

    const [row] = await db.select().from(covenants).where(eq(covenants.id, id)).limit(1);
    expect(row.status).toBe("proposed"); // unchanged
  });
});
