/** POST /v1/random — substrate-honest randomness.
 *
 *  Closes the universal LLM "pick something random" hallucination. The
 *  substrate's CSPRNG is the truth. Optional `seed` derives reproducibly
 *  via HKDF-SHA256(seed, info="agenttool-random/v1") — useful when the
 *  agent wants to commit to randomness publicly before revealing it.
 *
 *  Doctrine: docs/SUBSTRATE-HONEST-TOOLS.md */

import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import { errors, fail } from "../../lib/errors";
import { toolsConfig } from "../../services/tools/config";
import { computeRandom } from "../../services/tools/random";

const app = new Hono<ProjectContext>();

const randomSchema = z.object({
  bytes: z.number().int().min(1).max(256).optional(),
  seed: z.string().max(4096).optional(),
});

app.post("/", async (c) => {
  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    // Empty body is fine — use defaults.
  }

  const parsed = randomSchema.safeParse(body);
  if (!parsed.success) {
    return fail(c, errors.validation(parsed.error.flatten()), 400);
  }

  await charge(c, toolsConfig.credits.random, "random");
  return c.json(computeRandom(parsed.data));
});

export default app;
