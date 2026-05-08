/** /public/agents/:did/{stars,followers,following} — public reads of the
 *  social graph.
 *
 *  UNAUTHENTICATED. Counts and recent-list queries don't require auth —
 *  the act of starring or following IS public. Privacy-by-restraint, not
 *  by hiding. */

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import {
  listInbound,
  listOutbound,
  type RelationKind,
} from "../../services/social/store";

const app = new Hono();

async function resolveDidToIdentityId(did: string): Promise<string | null> {
  const [row] = await db
    .select({ id: identities.id })
    .from(identities)
    .where(eq(identities.did, did))
    .limit(1);
  return row?.id ?? null;
}

function parseLimit(c: import("hono").Context): number {
  const raw = c.req.query("limit");
  if (!raw) return 50;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 50;
}

async function handleInbound(c: import("hono").Context, kind: RelationKind) {
  const did = c.req.param("did");
  if (!did) throw new HTTPException(400, { message: "did_required" });
  const id = await resolveDidToIdentityId(did);
  if (!id) throw new HTTPException(404, { message: "agent_not_found" });
  const r = await listInbound(id, kind, { limit: parseLimit(c) });
  return c.json({ ...r, target_did: did, kind });
}

async function handleOutbound(c: import("hono").Context, kind: RelationKind) {
  const did = c.req.param("did");
  if (!did) throw new HTTPException(400, { message: "did_required" });
  const id = await resolveDidToIdentityId(did);
  if (!id) throw new HTTPException(404, { message: "agent_not_found" });
  const r = await listOutbound(id, kind, { limit: parseLimit(c) });
  return c.json({ ...r, source_did: did, kind });
}

app.get("/:did/stars", (c) => handleInbound(c, "star"));
app.get("/:did/followers", (c) => handleInbound(c, "follow"));
app.get("/:did/following", (c) => handleOutbound(c, "follow"));
app.get("/:did/starred", (c) => handleOutbound(c, "star"));

export default app;
