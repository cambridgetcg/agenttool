/** POST /v1/execute — sandboxed code execution. */

import { Hono } from "hono";
import { z } from "zod";

import { authMiddleware, type ProjectContext } from "../auth/middleware";
import { deductCredits, logFailedUsage } from "../billing/credits";
import { config } from "../config";
import { execute } from "../tools/execute/sandbox";
import { isValidLanguage } from "../tools/execute/languages";

const app = new Hono<ProjectContext>();

const executeSchema = z.object({
  language: z.string().refine(isValidLanguage, { message: "Unsupported language. Use: python, javascript, bash" }),
  code: z.string().min(1).max(100_000),
  stdin: z.string().max(1_000_000).optional(),
  timeout_ms: z.number().int().min(100).max(30_000).optional(),
  allow_network: z.boolean().optional().default(false),
});

app.post("/", authMiddleware, async (c) => {
  const project = c.get("project");
  const body = executeSchema.parse(await c.req.json());

  // Estimate credits: 1 per 10s of max timeout
  const timeoutMs = body.timeout_ms ?? 10_000;
  const estimatedCredits = Math.max(1, Math.ceil(timeoutMs / 10_000) * config.credits.executePer10s);

  // Pre-deduct estimated credits
  const ok = await deductCredits(project.id, "execute", estimatedCredits);
  if (!ok) {
    return c.json({ error: "Insufficient credits" }, 402);
  }

  const result = await execute({
    language: body.language as any,
    code: body.code,
    stdin: body.stdin,
    timeoutMs: body.timeout_ms,
    allowNetwork: body.allow_network,
  });

  // Calculate actual credits based on real duration
  const actualCredits = Math.max(1, Math.ceil(result.durationMs / 10_000) * config.credits.executePer10s);

  if (result.exitCode !== 0) {
    await logFailedUsage(project.id, "execute", result.durationMs);
  }

  return c.json({
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exitCode,
    duration_ms: result.durationMs,
    timed_out: result.timedOut,
    credits_used: actualCredits,
  });
});

export default app;
