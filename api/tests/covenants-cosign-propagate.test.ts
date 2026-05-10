import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { covenants } from "../src/db/schema/continuity";

describe("cosign-propagate worker — exhaustion", () => {
  test("flips to 'rejected' after MAX_ATTEMPTS", async () => {
    // Pre-seed a row at MAX_ATTEMPTS-1 with cosign_propagation_status='pending'
    // and an attempted_at far in the past so it's immediately due.
    const id = crypto.randomUUID();
    await db.insert(covenants).values({
      id,
      projectId: crypto.randomUUID(),
      agentId: crypto.randomUUID(),
      counterpartyDid: "did:at:peer.example/bbbb",
      vows: ["v"],
      status: "active",
      protocolVersion: "v2",
      signature: "x".repeat(88),
      signingKeyId: crypto.randomUUID(),
      counterpartySignature: "y".repeat(88),
      counterpartySigningKeyId: crypto.randomUUID(),
      receivedFromInstance: "unreachable.invalid",
      cosignPropagationStatus: "pending",
      cosignPropagationAttempts: 5,
      cosignPropagationAttemptedAt: new Date(0),
    });

    const { startCosignPropagateWorker, stopCosignPropagateWorker } =
      await import("../src/workers/covenants/cosign-propagate");
    startCosignPropagateWorker();
    await new Promise(r => setTimeout(r, 200)); // let one tick run
    stopCosignPropagateWorker();

    const [row] = await db.select().from(covenants).where(eq(covenants.id, id)).limit(1);
    expect(row.cosignPropagationStatus).toBe("rejected");
    expect(row.cosignPropagationLastError).toMatch(/max_attempts_exceeded/);
  });
});
