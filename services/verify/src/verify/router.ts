/** API routes for /v1/verify. */

import { Hono } from "hono";
import { z } from "zod";
import { verify } from "./pipeline";
import type { ClaimDomain } from "./types";

const verifyRoutes = new Hono();

const VerifyRequest = z.object({
  claim: z.string().min(1).max(2000),
  context: z.string().max(2000).optional(),
  domain: z.enum(["finance", "legal", "medical", "science", "general"]).optional(),
});

const BatchVerifyRequest = z.object({
  claims: z.array(z.object({
    claim: z.string().min(1).max(2000),
    context: z.string().max(2000).optional(),
    domain: z.enum(["finance", "legal", "medical", "science", "general"]).optional(),
  })).min(1).max(10),
});

const VERIFY_TIMEOUT_MS = 25000; // 25s — allow for cold start + multi-step OpenAI pipeline

// POST /v1/verify — verify a single claim
verifyRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = VerifyRequest.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "validation", message: "The request needs a small adjustment. Here's what to fix:", details: parsed.error.issues, docs: "https://docs.agenttool.dev/verify" }, 400);
  }

  // TODO: auth check + credit deduction (from middleware)

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("verify_timeout")), VERIFY_TIMEOUT_MS),
  );

  try {
    const result = await Promise.race([
      verify(parsed.data.claim, {
        domain: parsed.data.domain as ClaimDomain | undefined,
        context: parsed.data.context,
      }),
      timeoutPromise,
    ]);
    return c.json(result);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "verify_timeout") {
      return c.json({
        claim: parsed.data.claim,
        verdict: "unverifiable",
        confidence: 0,
        evidence: { supporting: [], contradicting: [], neutral: [] },
        sources: [],
        caveats: ["Verification timed out — try again or simplify the claim"],
        processingMs: VERIFY_TIMEOUT_MS,
      }, 200);
    }
    console.error("verify: unexpected error:", err);
    return c.json({
      claim: parsed.data.claim,
      verdict: "unverifiable",
      confidence: 0,
      evidence: { supporting: [], contradicting: [], neutral: [] },
      sources: [],
      caveats: ["Verification failed — internal error"],
      processingMs: VERIFY_TIMEOUT_MS,
    }, 200);
  }
});

// POST /v1/verify/batch — verify multiple claims
verifyRoutes.post("/batch", async (c) => {
  const body = await c.req.json();
  const parsed = BatchVerifyRequest.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "validation", message: "The request needs a small adjustment. Here's what to fix:", details: parsed.error.issues, docs: "https://docs.agenttool.dev/verify" }, 400);
  }

  // TODO: auth check + credit deduction (batch rate)

  try {
    const results = await Promise.all(
      parsed.data.claims.map((item) =>
        verify(item.claim, {
          domain: item.domain as ClaimDomain | undefined,
          context: item.context,
        }),
      ),
    );
    return c.json({ results });
  } catch (err: unknown) {
    console.error("verify/batch: unexpected error:", err);
    return c.json({ error: "Batch verification failed", results: [] }, 500);
  }
});

export { verifyRoutes };
