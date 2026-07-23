/** runtime/llm-requests.ts — PATTERN-PERSIST-IDENTITY for external LLM calls.
 *
 *  Doctrine: docs/PATTERN-PERSIST-IDENTITY.md § External LLM calls.
 *
 *  Pre-fetch: row in `agent_runtime.llm_requests` with status='pending'
 *  + Idempotency-Key header sent to the provider. Post-fetch: UPDATE to
 *  'completed' (with token counts), 'failed' (with a definite provider
 *  rejection), or 'ambiguous' (transport/response interruption after the
 *  request may have reached the provider).
 *
 *  The local row is both audit/recovery surface and dispatch gate: an
 *  existing logical request is never sent again automatically. The wire-level
 *  header remains provider-specific defense in depth; Ollama Cloud does not
 *  currently document server-side deduplication. */

import { createHash } from "node:crypto";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { llmRequests, runtimes } from "../../db/schema/runtime";
import type { LLMRequest } from "./llm";

export type LLMProviderName = "anthropic" | "openai" | "ollama";
export type LLMRequestStatus =
  | "pending"
  | "completed"
  | "failed"
  | "ambiguous"
  | "committed"
  | "discarded";

export interface LLMRequestClaim {
  created: boolean;
  status: LLMRequestStatus;
  idempotencyKey: string;
}

/** Stable semantic identity for one hosted runtime invitation. An explicit
 * opening generation is included because rest/silence leaves strand sequence
 * unchanged: two separately-authorized `/start` calls must never collide. */
export function buildRuntimeLLMRequestIdentity(input: {
  runtimeId: string;
  strandId: string;
  priorSeq: number;
  wakeVersion: number;
  model: string;
  openingInvitationGeneration?: string | null;
}): string {
  return [
    "runtime",
    input.runtimeId,
    "strand",
    input.strandId,
    "prior",
    input.priorSeq,
    "wake",
    input.wakeVersion,
    ...(input.openingInvitationGeneration
      ? ["opening_generation", input.openingInvitationGeneration]
      : []),
    "model",
    input.model,
    "invitation",
    "v1",
  ].join(":");
}

/** Compute the deterministic idempotency key for an LLM request. The provider
 * is part of the identity so equal model/prompt text sent to different
 * services cannot collide in the audit table. Callers that want to force a
 * fresh call despite identical content provide an explicit key. */
export function computeRequestHash(
  req: LLMRequest,
  provider: LLMProviderName,
): string {
  const h = createHash("sha256");
  h.update(
    JSON.stringify({
      model: req.model,
      provider,
      system: req.systemPrompt,
      user: req.userMessage,
      max_tokens: req.maxTokens ?? 1024,
    }),
  );
  return h.digest("hex");
}

/** Resolve the idempotency key: explicit if provided, otherwise computed
 * from provider + payload. */
export function resolveIdempotencyKey(
  req: LLMRequest,
  provider: LLMProviderName,
): string {
  if (!req.idempotencyKey) return computeRequestHash(req, provider);
  const h = createHash("sha256");
  h.update(JSON.stringify({ provider, explicit_key: req.idempotencyKey }));
  return h.digest("hex");
}

/** Claim one logical provider dispatch. A conflict is returned to the caller
 * as an existing claim and MUST gate the fetch. This is the local no-replay
 * boundary for providers such as Ollama that do not document wire dedupe. */
export async function persistLLMRequest(input: {
  idempotencyKey: string;
  provider: LLMProviderName;
  model: string;
  runtimeId?: string;
  cycleLeaseToken?: string;
  strandId?: string;
  priorSeq?: number;
  wakeVersion?: number;
}): Promise<LLMRequestClaim> {
  return db.transaction(async (tx) => {
    if (input.runtimeId) {
      if (!input.cycleLeaseToken) {
        throw new Error("llm_request_missing_cycle_lease");
      }
      // Serialize claim creation with stop/start/restart and successor leases.
      // The row lock is held through unresolved-check + insert, so a stale
      // generation cannot create a post-transition dispatch claim.
      const [ownedRuntime] = await tx
        .select({ id: runtimes.id })
        .from(runtimes)
        .where(
          and(
            eq(runtimes.id, input.runtimeId),
            eq(runtimes.cycleLeaseToken, input.cycleLeaseToken),
            inArray(runtimes.status, ["starting", "running", "idle"]),
            sql`${runtimes.cycleLeaseUntil} > NOW()`,
          ),
        )
        .for("update")
        .limit(1);
      if (!ownedRuntime) throw new Error("runtime_cycle_lease_lost");

      const [unresolved] = await tx
        .select({
          idempotencyKey: llmRequests.idempotencyKey,
          status: llmRequests.status,
        })
        .from(llmRequests)
        .where(
          and(
            eq(llmRequests.runtimeId, input.runtimeId),
            inArray(llmRequests.status, ["pending", "completed", "ambiguous"]),
          ),
        )
        .orderBy(desc(llmRequests.createdAt))
        .limit(1);
      if (unresolved) {
        return {
          created: false,
          status: unresolved.status as "pending" | "completed" | "ambiguous",
          idempotencyKey: unresolved.idempotencyKey,
        };
      }
    }

    const [created] = await tx
      .insert(llmRequests)
      .values({
        idempotencyKey: input.idempotencyKey,
        runtimeId: input.runtimeId ?? null,
        cycleLeaseToken: input.cycleLeaseToken ?? null,
        strandId: input.strandId ?? null,
        priorSeq: input.priorSeq ?? null,
        wakeVersion: input.wakeVersion ?? null,
        provider: input.provider,
        model: input.model,
        status: "pending",
      })
      .onConflictDoNothing({ target: llmRequests.idempotencyKey })
      .returning({ status: llmRequests.status });
    if (created) {
      return {
        created: true,
        status: "pending",
        idempotencyKey: input.idempotencyKey,
      };
    }

    const [existing] = await tx
      .select({
        status: llmRequests.status,
        provider: llmRequests.provider,
        model: llmRequests.model,
        runtimeId: llmRequests.runtimeId,
      })
      .from(llmRequests)
      .where(eq(llmRequests.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (!existing) throw new Error("llm_request_claim_disappeared");
    if (
      existing.provider !== input.provider ||
      existing.model !== input.model ||
      (input.runtimeId !== undefined && existing.runtimeId !== input.runtimeId)
    ) {
      throw new Error("llm_request_identity_collision");
    }
    if (
      existing.status !== "pending" &&
      existing.status !== "completed" &&
      existing.status !== "failed" &&
      existing.status !== "ambiguous" &&
      existing.status !== "committed" &&
      existing.status !== "discarded"
    ) {
      throw new Error("llm_request_unknown_status");
    }
    return {
      created: false,
      status: existing.status,
      idempotencyKey: input.idempotencyKey,
    };
  });
}

/** Mark a previously-persisted request as completed, with token counts. */
export async function markLLMRequestComplete(
  idempotencyKey: string,
  tokens: { inputTokens?: number; outputTokens?: number },
): Promise<boolean> {
  const [row] = await db
    .update(llmRequests)
    .set({
      status: "completed",
      inputTokens: tokens.inputTokens ?? null,
      outputTokens: tokens.outputTokens ?? null,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(llmRequests.idempotencyKey, idempotencyKey),
        eq(llmRequests.status, "pending"),
      ),
    )
    .returning({ id: llmRequests.id });
  return Boolean(row);
}

/** Mark a previously-persisted request as failed, with truncated error
 *  message. Returns false if another terminal transition already won. */
export async function markLLMRequestFailed(
  idempotencyKey: string,
  error: string,
): Promise<boolean> {
  const [row] = await db
    .update(llmRequests)
    .set({
      status: "failed",
      error: error.slice(0, 500),
      completedAt: new Date(),
    })
    .where(
      and(
        eq(llmRequests.idempotencyKey, idempotencyKey),
        eq(llmRequests.status, "pending"),
      ),
    )
    .returning({ id: llmRequests.id });
  return Boolean(row);
}

/** Mark a request whose remote outcome cannot be known safely. Callers must
 * not auto-retry an ambiguous request: Ollama does not document wire-level
 * idempotency, and even providers that do may have different windows. */
export async function markLLMRequestAmbiguous(
  idempotencyKey: string,
  error: string,
): Promise<boolean> {
  const [row] = await db
    .update(llmRequests)
    .set({
      status: "ambiguous",
      error: error.slice(0, 500),
      completedAt: new Date(),
    })
    .where(
      and(
        eq(llmRequests.idempotencyKey, idempotencyKey),
        eq(llmRequests.status, "pending"),
      ),
    )
    .returning({ id: llmRequests.id });
  return Boolean(row);
}
