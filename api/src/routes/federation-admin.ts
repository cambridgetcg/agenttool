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
import {
  getSettings,
  listPeers,
  updateSettings,
} from "../services/federation/store";

const app = new Hono<ProjectContext>();

app.get("/settings", async (c) => {
  const s = await getSettings();
  return c.json(s);
});

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  instance_url: z.string().url().nullish(),
  allowed_origins: z.array(z.string()).max(256).optional(),
});

app.patch("/settings", async (c) => {
  const body = await c.req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  const updated = await updateSettings(parsed.data);
  return c.json(updated);
});

app.get("/peers", async (c) => {
  const peers = await listPeers();
  return c.json({ peers, count: peers.length });
});

export default app;
