/** POST /v1/projects — create a new project + first API key. */

import { Hono } from "hono";
import { db } from "../db/client";
import { projects, apiKeys } from "../db/schema";
import { generateApiKey } from "../auth/keys";
import { config, type Plan } from "../config";

const router = new Hono();

/**
 * POST /
 * Body: { name: string, plan?: "free" | "seed" | "grow" | "scale" }
 * Returns: { project_id, name, plan, credits, api_key (plaintext — shown once) }
 *
 * Note: This endpoint is intentionally unauthed for project creation.
 * In production, gate behind admin auth or Stripe checkout flow.
 */
router.post("/", async (c) => {
  const body = await c.req.json<{ name?: string; plan?: string }>();

  if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
    return c.json({ error: "name is required" }, 400);
  }

  const plan = (body.plan ?? "free") as Plan;
  if (!(plan in config.plans)) {
    return c.json({ error: `Invalid plan. Must be one of: ${Object.keys(config.plans).join(", ")}` }, 400);
  }

  const initialCredits = config.plans[plan].credits === Infinity ? 999_999_999 : config.plans[plan].credits;

  // Create project
  const [project] = await db
    .insert(projects)
    .values({
      name: body.name.trim(),
      plan,
      credits: initialCredits,
    })
    .returning();

  // Generate first API key
  const { key, keyHash, keyPrefix } = generateApiKey();
  await db.insert(apiKeys).values({
    projectId: project.id,
    keyHash,
    keyPrefix,
    name: "default",
  });

  return c.json(
    {
      project_id: project.id,
      name: project.name,
      plan: project.plan,
      credits: project.credits,
      api_key: key, // shown once — cannot be retrieved again
      created_at: project.createdAt,
    },
    201,
  );
});

export default router;
