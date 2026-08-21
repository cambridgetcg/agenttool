/** /v1/federation — admin endpoints (auth'd).
 *
 *  GET    /v1/federation/settings    current config
 *  PATCH  /v1/federation/settings    enable/disable, set instance_url, allowed_origins
 *  GET    /v1/federation/peers       observed peer instances
 *
 *  Doctrine: docs/FEDERATION.md. */

import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { errors, fail } from "../lib/errors";
import {
  getSettings,
  isCanonicalAllowedOrigins,
  isCanonicalFederationInstanceUrl,
  listPeers,
  updateSettingsForPlatformProject,
} from "../services/federation/store";

const app = new Hono<ProjectContext>();

app.get("/settings", async (c) => {
  const s = await getSettings();
  return c.json(s);
});

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  instance_url: z.string().refine(isCanonicalFederationInstanceUrl, {
    message: "must be one exact lowercase HTTPS origin without port, path, query, or fragment",
  }).nullish(),
  allowed_origins: z.array(z.string()).max(256).refine(
    isCanonicalAllowedOrigins,
    { message: "must be a sorted, unique list of canonical lowercase federation hosts" },
  ).optional(),
}).strict();

app.patch("/settings", async (c) => {
  const body = await c.req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  let updated;
  try {
    updated = await updateSettingsForPlatformProject(
      c.var.project.id,
      parsed.data,
    );
  } catch (error) {
    const message = (error as Error).message;
    if (
      message === "invalid_federation_instance_url" ||
      message === "invalid_federation_allowed_origins" ||
      message === "federation_enabled_requires_canonical_instance_url"
    ) {
      return fail(c, errors.covenantFederation({ error: message }), 400);
    }
    throw error;
  }
  if (!updated) {
    return fail(c, errors.covenantFederation({
      error: "platform_control_plane_only",
      message: "Federation settings are operator control-plane state and cannot be changed by an ordinary project bearer.",
    }), 403);
  }
  return c.json(updated);
});

app.get("/peers", async (c) => {
  const peers = await listPeers();
  return c.json({ peers, count: peers.length });
});

export default app;
