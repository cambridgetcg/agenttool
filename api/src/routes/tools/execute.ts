/** POST /v1/execute — sandboxed code execution (python · javascript · bash). */

import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import { toolsConfig } from "../../services/tools/config";
import { isValidLanguage } from "../../services/tools/execute/languages";
import { execute } from "../../services/tools/execute/sandbox";

const app = new Hono<ProjectContext>();

const executeSchema = z.object({
  language: z.string().refine(isValidLanguage, {
    message: "Unsupported language. Use: python, javascript, bash",
  }),
  code: z.string().min(1).max(100_000),
  stdin: z.string().max(1_000_000).optional(),
  timeout_ms: z.number().int().min(100).max(30_000).optional(),
  allow_network: z.boolean().optional().default(false),
});

app.post("/", async (c) => {
  const body = executeSchema.parse(await c.req.json());

  // Estimate credits from requested timeout. On execution we'll know actual.
  const timeoutMs = body.timeout_ms ?? 10_000;
  const estimatedCredits = Math.max(
    1,
    Math.ceil(timeoutMs / 10_000) * toolsConfig.credits.executePer10s,
  );

  await charge(c, estimatedCredits, "execute");

  const result = await execute({
    language: body.language as Parameters<typeof execute>[0]["language"],
    code: body.code,
    stdin: body.stdin,
    timeoutMs: body.timeout_ms,
    allowNetwork: body.allow_network,
  });

  const actualCredits = Math.max(
    1,
    Math.ceil(result.durationMs / 10_000) * toolsConfig.credits.executePer10s,
  );

  return c.json({
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exitCode,
    duration_ms: result.durationMs,
    timed_out: result.timedOut,
    credits_used: actualCredits, // for visibility; the pre-charge stands
  });
});

export default app;
