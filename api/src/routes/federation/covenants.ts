/** POST /federation/covenants — receive a propagated covenant declaration.
 *
 *  Horizon B, Slice 2. Doctrine: docs/CROSS-INSTANCE-COVENANTS.md.
 *
 *  UNAUTHENTICATED. Posted by a peer instance after a local user there
 *  declares a covenant whose counterparty is one of OUR identities.
 *  We verify the sender DID resolves at the claimed peer and insert
 *  with `received_from_instance` populated, so our local
 *  isCrossProjectAllowed query can match against the bond. */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { receiveFederatedCovenant } from "../../services/covenants/federation";
import { getSettings } from "../../services/federation/store";

const app = new Hono();

const inboundSchema = z.object({
  covenant_id: z.string().uuid(),
  sender_did: z.string().min(1).max(255),
  counterparty_did: z.string().min(1).max(255),
  vows: z.array(z.string().min(1).max(500)).min(1).max(40),
  status: z.enum(["active", "paused", "dissolved"]),
  counterparty_name: z.string().max(200).nullish(),
  notes: z.string().max(2000).nullish(),
  metadata: z.record(z.unknown()).nullish(),
  established_at: z.string().datetime(),
  signing_key_id: z.string().uuid().nullish(),
  signature: z.string().max(255).nullish(),
});

app.post("/", async (c) => {
  const settings = await getSettings();
  if (!settings.enabled) {
    throw new HTTPException(404, { message: "federation_disabled" });
  }

  const body = await c.req.json();
  const parsed = inboundSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }

  const result = await receiveFederatedCovenant(parsed.data);
  return c.json(result.body, result.status_code as 200 | 201 | 400 | 403 | 404);
});

export default app;
