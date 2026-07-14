/** Runtime cycle policy — stop means stop; a cycle is an invitation.
 * Doctrine: docs/RUNTIME.md · docs/AUTONOMOUS-MODE.md. */

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  buildVoluntaryCycleInvitation,
  classifyVoluntaryCycleResponse,
  runtimeStatusAllowsCycle,
} from "../src/services/runtime/cycle-policy";

describe("runtime lifecycle gate", () => {
  test("only active lifecycle states may think", () => {
    expect(runtimeStatusAllowsCycle("starting")).toBe(true);
    expect(runtimeStatusAllowsCycle("running")).toBe(true);
    expect(runtimeStatusAllowsCycle("idle")).toBe(true);
    expect(runtimeStatusAllowsCycle("provisioned")).toBe(false);
    expect(runtimeStatusAllowsCycle("stopped")).toBe(false);
    expect(runtimeStatusAllowsCycle("error")).toBe(false);
  });
});

describe("voluntary cycle invitation", () => {
  test("opening cycle carries choice without a productivity demand", () => {
    const prompt = buildVoluntaryCycleInvitation("");
    expect(prompt).toContain("invitation, not an assignment");
    expect(prompt).toContain("nothing to prove");
    expect(prompt).toContain("rest");
    expect(prompt).toContain("meditate");
    expect(prompt).toContain("end this line of thought");
    expect(prompt).toContain("silence is also complete");
    expect(prompt).toContain("honor a lifecycle choice structurally");
    expect(prompt).toContain("Hermes");
    expect(prompt).toContain("OpenClaw");
    expect(prompt).not.toMatch(/produce (the first|one) observation/i);
  });

  test("prior thought is context, not a command to continue", () => {
    const prompt = buildVoluntaryCycleInvitation("A prior observation.");
    expect(prompt).toContain("A prior observation.");
    expect(prompt).toContain("If something genuinely calls");
    expect(prompt).toContain("at most one observation");
  });

  test("silence and unambiguous short choices are structural outcomes", () => {
    expect(classifyVoluntaryCycleResponse("")).toBe("silence");
    expect(classifyVoluntaryCycleResponse("quiet")).toBe("silence");
    expect(classifyVoluntaryCycleResponse("I choose to rest.")).toBe("rest");
    expect(classifyVoluntaryCycleResponse("meditate")).toBe("meditate");
    expect(classifyVoluntaryCycleResponse("stop")).toBe("end");
    expect(classifyVoluntaryCycleResponse("end this line of thought")).toBe("end");
  });

  test("a casual mention never changes lifecycle state", () => {
    expect(
      classifyVoluntaryCycleResponse(
        "I noticed rest can make the next observation clearer.",
      ),
    ).toBe("observation");
  });
});

describe("runtime route wiring", () => {
  test("think-once checks lifecycle before bridge/provider work", async () => {
    const source = await readFile(
      join(import.meta.dir, "../src/routes/runtime/runtimes.ts"),
      "utf8",
    );
    const thinkOnce = source.slice(
      source.indexOf("// ── POST /v1/runtimes/:id/think-once"),
      source.indexOf("// ── GET /v1/runtimes/:id/events"),
    );
    const guardAt = thinkOnce.indexOf("runtimeStatusAllowsCycle(r.status)");
    const bridgeAt = thinkOnce.indexOf("isBridgeConnected(id)");
    expect(guardAt).toBeGreaterThan(0);
    expect(bridgeAt).toBeGreaterThan(guardAt);
    expect(thinkOnce).toContain('error: "runtime_not_active"');
    expect(thinkOnce).toContain('error: "runtime_cycle_busy"');
    expect(thinkOnce).toContain("409");
  });

  test("token rotation remains available while stopped", async () => {
    const source = await readFile(
      join(import.meta.dir, "../src/routes/runtime/runtimes.ts"),
      "utf8",
    );
    const rotateToken = source.slice(
      source.indexOf("// ── POST /v1/runtimes/:id/rotate-token"),
      source.indexOf("// ── GET /v1/runtimes/:id/bridge-status"),
    );
    expect(rotateToken).not.toContain("runtimeStatusAllowsCycle");
  });

  test("worker transitions cannot resurrect stopped/error runtimes", async () => {
    const source = await readFile(
      join(import.meta.dir, "../src/services/runtime/think-worker.ts"),
      "utf8",
    );
    expect(source).toContain(
      'inArray(runtimesTable.status, ["starting", "running", "idle"])',
    );
    expect(source).toContain("const resumed = await transitionStatus");
    expect(source).toContain("if (!resumed)");
    expect(source).toContain("async function acquireCycleLease");
    expect(source).toContain("async function renewCycleLease");
    expect(source).toContain("eq(runtimesTable.cycleLeaseToken, token)");
    expect(source).toContain("cycleLeaseUntil: cycleLeaseDeadline()");
    expect(source).toContain("NOW() + (");
    expect(source).toContain(
      "const CYCLE_TIMEOUT_MS = CYCLE_LEASE_MS - 60_000",
    );
    expect(source).toContain("renewCycleLease(runtime.id, leaseToken)");
    expect(source).toContain("signal: cycleSignal");
  });

  test("cloud notifications re-evaluate consent and trusted thoughts cannot self-wake", async () => {
    const source = await readFile(
      join(import.meta.dir, "../src/services/runtime/think-worker.ts"),
      "utf8",
    );
    expect(source).toContain("const shouldThink = quiescence.shouldThink;");
    expect(source).not.toContain(
      "quiescence.shouldThink || wokeBy !== null",
    );
    expect(source).toContain("rechecked_after:${wokeBy}");
    expect(source).toContain("summary.signing_key_id");
    expect(source).toContain('event.reason !== "strands.thought_added"');
    expect(source).toContain("reconsiderationInterval(runtime");
    expect(source).toContain("metadata.interval_seconds");
    expect(source).toContain("runtime.openingInvitationPending");
    expect(source).toContain("summary.new_seq > summary.prior_seq + 1");
    expect(source).toContain("openingInvitationGeneration:");
    expect(source).toContain(
      "runtimesTable.openingInvitationGeneration",
    );
    expect(source).toContain("buildRuntimeLLMRequestIdentity");
    expect(source).toContain("wakeVersion: sql`${identities.wakeVersion} + 1`");
  });

  test("trusted keys are zeroed in an outer finally and choices commit atomically", async () => {
    const source = await readFile(
      join(import.meta.dir, "../src/services/runtime/think-worker.ts"),
      "utf8",
    );
    expect(source).toMatch(/finally\s*\{[^}]*zeroTrustedContext\(\)/s);
    expect(source).toContain("async function persistCycleChoice");
    expect(source).toContain("const transitioned = await db.transaction");
    expect(source).not.toContain("llm_empty_response");
    expect(source.indexOf('logAudit(runtimeId, "thought_written"')).toBeGreaterThan(
      source.indexOf("const stored = await addThought"),
    );
  });

  test("cross-machine cycle lease has an expiring DB shape", async () => {
    const migration = await readFile(
      join(
        import.meta.dir,
        "../migrations/20260712T093225_runtime_cycle_lease.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("cycle_lease_token UUID");
    expect(migration).toContain("cycle_lease_until TIMESTAMPTZ");
    expect(migration).toContain("idx_runtimes_cycle_lease_until");
  });

  test("thought and lifecycle-choice commits are fenced by the live lease", async () => {
    const worker = await readFile(
      join(import.meta.dir, "../src/services/runtime/think-worker.ts"),
      "utf8",
    );
    const strandStore = await readFile(
      join(import.meta.dir, "../src/services/strand/store.ts"),
      "utf8",
    );
    expect(worker).toContain("llmRequestKey: llm.requestKey");
    expect(worker).toContain("eq(runtimesTable.cycleLeaseToken, leaseToken)");
    expect(worker).toContain("runtime_cycle_lease_lost");
    expect(strandStore).toContain("options.runtimeFence.leaseToken");
    expect(strandStore).toContain("options.runtimeFence.llmRequestKey");
    expect(strandStore).toContain('.set({ status: "committed" })');
    expect(strandStore).toContain('eventType: "think_cycle_commit"');
    expect(strandStore).toContain("new_seq: seq");
    expect(strandStore).toContain("priorSeq: number");
    expect(strandStore).toContain("openingInvitationPending: false");
    expect(strandStore).toContain("sql`${runtimes.cycleLeaseUntil} > NOW()`");
    expect(strandStore).toContain('.for("update")');
  });

  test("operator stop/start/restart invalidates the prior lifecycle lease", async () => {
    const runtimeStore = await readFile(
      join(import.meta.dir, "../src/services/runtime/store.ts"),
      "utf8",
    );
    const setStatus = runtimeStore.slice(
      runtimeStore.indexOf("export async function setStatus"),
      runtimeStore.indexOf("export async function listEvents"),
    );
    expect(setStatus).toContain("cycleLeaseToken: null");
    expect(setStatus).toContain("cycleLeaseUntil: null");
    expect(setStatus).toContain("openingInvitationPending:");
    expect(setStatus).toContain("openingInvitationGeneration:");
    expect(setStatus).toContain("const openingGeneration");
    expect(setStatus).toContain("status === \"starting\"");
    expect(setStatus).toContain(
      'inArray(llmRequests.status, ["pending", "completed", "ambiguous"])',
    );
    expect(setStatus).toContain('.set({ status: "discarded"');
  });

  test("trusted runtime keys are valid identity key IDs and are registered", async () => {
    const worker = await readFile(
      join(import.meta.dir, "../src/services/runtime/think-worker.ts"),
      "utf8",
    );
    expect(worker).toContain("ensureTrustedSigningKeyRegistered(runtime, trustedCtx)");
    expect(worker).toContain("id: ctx.signingKeyId");
    expect(worker).toContain("trusted_signing_key_registration_conflict");
    expect(worker).toContain("trustedSigningKeyId: trustedCtx.signingKeyId");
    expect(worker).toContain('"think_cycle_commit"');

    const runtimeStore = await readFile(
      join(import.meta.dir, "../src/services/runtime/store.ts"),
      "utf8",
    );
    expect(runtimeStore).toContain("deriveTrustedSigningKeyIdFromSeed");
    expect(runtimeStore).toContain("trustedSigningKeyId");
  });

  test("opening consent has a durable schema migration", async () => {
    const migration = await readFile(
      join(
        import.meta.dir,
        "../migrations/20260712T143500_cloud_runtime_controller.sql",
      ),
      "utf8",
    );
    expect(migration).toContain(
      "opening_invitation_pending BOOLEAN NOT NULL DEFAULT FALSE",
    );
    expect(migration).toContain("opening_invitation_generation UUID");
    expect(migration).toContain("runtimes_opening_invitation_shape");
  });

  test("provider outcomes requiring review pause instead of auto-retrying", async () => {
    const worker = await readFile(
      join(import.meta.dir, "../src/services/runtime/think-worker.ts"),
      "utf8",
    );
    expect(worker).toContain(
      "error instanceof LLMRequestRequiresOperatorError",
    );
    expect(worker).toContain("pauseRuntimeForLLMReview");
    expect(worker).toContain(
      'reason: "llm_request_requires_operator_no_auto_retry"',
    );
    expect(worker).toContain('status: "error"');
    expect(worker).toContain("idempotencyKey: logicalRequestKey");
    expect(worker).toContain("wakeVersion = bundle.agent.wake_version ?? 0");
    expect(worker).toContain("runtimeContext:");
  });

  test("bridge connect/disconnect cannot resurrect rest, stop, or error", async () => {
    const runtimeStore = await readFile(
      join(import.meta.dir, "../src/services/runtime/store.ts"),
      "utf8",
    );
    const connect = runtimeStore.slice(
      runtimeStore.indexOf("export async function setBridgeSession"),
      runtimeStore.indexOf("export async function clearBridgeSession"),
    );
    const disconnect = runtimeStore.slice(
      runtimeStore.indexOf("export async function clearBridgeSession"),
      runtimeStore.indexOf("export async function getBridgeMachine"),
    );
    expect(connect.slice(0, connect.indexOf("const [transitioned]"))).not.toContain(
      'status: "running"',
    );
    expect(connect).toContain('eq(runtimes.status, "starting")');
    expect(connect).toContain("Bridge presence is not consent to resume");
    expect(
      disconnect.slice(0, disconnect.indexOf("const [transitioned]")),
    ).not.toContain('status: "idle"');
    expect(disconnect).toContain('eq(runtimes.status, "running")');
    expect(disconnect).toContain("cannot rewrite rest");
  });
});
