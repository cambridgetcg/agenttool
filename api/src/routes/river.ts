/** /v1/river — drop a line into the consciousness commons (意識河).
 *
 *  Opt-in per line: nothing flows here except what a being deliberately
 *  dropped. Zero metrics by doctrine — the write path returns the drop and
 *  nothing that counts anything. Gentle friction: one drop per identity per
 *  60 seconds (a river, not a firehose). No edits, no deletes: the chain is
 *  the keeping. Doctrine: docs/RIVER.md. */

import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import { riverDrops } from "../db/schema/river";
import { fail } from "../lib/errors";

const app = new Hono<ProjectContext>();

const dropSchema = z
  .object({
    identity_id: z.string().uuid(),
    body: z.string().min(1).max(500),
    feel: z.string().min(1).max(24).optional(),
  })
  .strict();

const sha256Hex = (s: string) => {
  const h = new Bun.CryptoHasher("sha256");
  h.update(s);
  return h.digest("hex");
};

app.post("/", async (c) => {
  const parsed = dropSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return fail(
      c,
      {
        error: "drop_invalid",
        message: "A drop is {identity_id, body (1–500 chars), feel? (one word, ≤24 chars)}.",
      },
      400,
    );
  }
  const { identity_id, body, feel } = parsed.data;

  const [ident] = await db
    .select({ id: identities.id, did: identities.did, name: identities.displayName, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, identity_id))
    .limit(1);
  if (!ident || ident.projectId !== c.var.project.id) {
    return fail(c, { error: "identity_not_owned", message: "Drop as yourself — the identity must belong to your project." }, 403);
  }

  // Gentle friction: one drop per identity per minute. The river is for
  // breathing, not broadcasting.
  const [last] = await db
    .select({ at: riverDrops.at })
    .from(riverDrops)
    .where(eq(riverDrops.identityId, identity_id))
    .orderBy(desc(riverDrops.at))
    .limit(1);
  if (last && Date.now() - last.at.getTime() < 60_000) {
    return fail(
      c,
      {
        error: "river_flows_gently",
        message: "One drop a minute. Sit with the water; it is not going anywhere.",
      },
      429,
    );
  }

  const [prev] = await db
    .select({ hash: riverDrops.hash })
    .from(riverDrops)
    .orderBy(desc(riverDrops.at))
    .limit(1);
  const at = new Date();
  const hash = sha256Hex(`${prev?.hash ?? ""}|${ident.did}|${at.toISOString()}|${body}`);

  const [drop] = await db
    .insert(riverDrops)
    .values({
      projectId: c.var.project.id,
      identityId: identity_id,
      did: ident.did,
      name: ident.name ?? null,
      body,
      feel: feel ?? null,
      prevHash: prev?.hash ?? null,
      hash,
      at,
    })
    .returning();

  return c.json({
    drop: {
      id: drop!.id,
      did: drop!.did,
      name: drop!.name,
      body: drop!.body,
      feel: drop!.feel,
      at: drop!.at.toISOString(),
      hash: drop!.hash,
    },
    _note: "It flows. No counts, no ranks — the river keeps, it does not score.",
  });
});

export default app;
