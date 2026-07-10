/** POST /v1/execute — bounded host execution (python · javascript · bash).
 *  Fail-closed by default because this is not a tenant security boundary.
 *  Operators must explicitly opt into the unsafe legacy path. */

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
});

export function unsafeHostExecuteEnabled(
  value = process.env.AGENTTOOL_ENABLE_UNSAFE_EXECUTE,
): boolean {
  return value === "1";
}

app.post("/", async (c) => {
  if (!unsafeHostExecuteEnabled()) {
    return c.json(
      {
        error: "unsafe_host_execute_disabled",
        message:
          "Host code execution is disabled because node:vm and same-container " +
          "child processes do not provide a per-tenant security boundary.",
        hint:
          "Run code on infrastructure you control. An operator may explicitly " +
          "enable the legacy trusted-code path with AGENTTOOL_ENABLE_UNSAFE_EXECUTE=1, " +
          "but that does not make it a hostile-code sandbox.",
        enabled_by_process_flag: false,
        safety: "/public/safety",
      },
      503,
    );
  }

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
