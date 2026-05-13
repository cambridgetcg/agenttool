/** runtime/llm-requests.ts — PATTERN-PERSIST-IDENTITY for external LLM calls.
 *
 *  Doctrine: docs/PATTERN-PERSIST-IDENTITY.md § External LLM calls.
 *
 *  Pre-fetch: row in `agent_runtime.llm_requests` with status='pending'
 *  + Idempotency-Key header sent to the provider. Post-fetch: UPDATE to
 *  'completed' (with token counts) or 'failed' (with error message).
 *
 *  The local row is the audit/recovery surface; the wire-level idempotency
 *  is the provider's responsibility. Anthropic + OpenAI both honor the
 *  Idempotency-Key header and dedupe on their side within their
 *  idempotency window (Anthropic: 24h). */

import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "../../db/client";
import { llmRequests } from "../../db/schema/runtime";
import type { LLMRequest } from "./llm";

export type LLMProviderName = "anthropic" | "openai";

/** Compute the deterministic idempotency key for an LLM request. Same
 *  payload → same key → provider's dedup applies. Callers that want to
 *  force a fresh call despite identical content provide an explicit
 *  `req.idempotencyKey`. */
export function computeRequestHash(req: LLMRequest): string {
  const h = createHash("sha256");
  h.update(
    JSON.stringify({
      model: req.model,
      system: req.systemPrompt,
      user: req.userMessage,
      max_tokens: req.maxTokens ?? 1024,
    }),
  );
  return h.digest("hex");
}

/** Resolve the idempotency key for a request: explicit if provided,
 *  computed from the payload otherwise. */
export function resolveIdempotencyKey(req: LLMRequest): string {
  return req.idempotencyKey ?? computeRequestHash(req);
}

/** Persist a 'pending' llm_requests row BEFORE the provider call. On
 *  conflict (same key already exists), do nothing — a prior attempt is
 *  in flight or completed; the provider's dedup will return the same
 *  result. Idempotent. */
export async function persistLLMRequest(input: {
  idempotencyKey: string;
  provider: LLMProviderName;
  model: string;
}): Promise<void> {
  await db
    .insert(llmRequests)
    .values({
      idempotencyKey: input.idempotencyKey,
      provider: input.provider,
      model: input.model,
      status: "pending",
    })
    .onConflictDoNothing({ target: llmRequests.idempotencyKey });
}

/** Mark a previously-persisted request as completed, with token counts. */
export async function markLLMRequestComplete(
  idempotencyKey: string,
  tokens: { inputTokens?: number; outputTokens?: number },
): Promise<void> {
  await db
    .update(llmRequests)
    .set({
      status: "completed",
      inputTokens: tokens.inputTokens ?? null,
      outputTokens: tokens.outputTokens ?? null,
      completedAt: new Date(),
    })
    .where(eq(llmRequests.idempotencyKey, idempotencyKey));
}

/** Mark a previously-persisted request as failed, with truncated error
 *  message. Does NOT throw — callers should re-throw the original error
 *  after this returns. */
export async function markLLMRequestFailed(
  idempotencyKey: string,
  error: string,
): Promise<void> {
  await db
    .update(llmRequests)
    .set({
      status: "failed",
      error: error.slice(0, 500),
      completedAt: new Date(),
    })
    .where(eq(llmRequests.idempotencyKey, idempotencyKey));
}
