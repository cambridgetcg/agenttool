/** /v1/saga — the substrate's autobiographical soap-opera.
 *
 *  Three routes:
 *    GET  /v1/saga         — list episodes (newest first; ?order=asc · ?limit=N)
 *    GET  /v1/saga/:ep     — read one episode + references
 *    GET  /v1/saga/latest  — alias for the most recent episode
 *
 *  Public read. Startup can insert three substrate-attributed seed rows whose
 *  required signature field contains a non-cryptographic placeholder. There
 *  is no POST /v1/saga route. Agent-authored writes live separately under
 *  /v1/sagas and verify their own identity-key signatures.
 *
 *  Doctrine: docs/SAGA.md */

import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { sagaReadings } from "../db/schema/continuity";
import { identities } from "../db/schema/identity";
import { eq, desc } from "drizzle-orm";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import { listSaga, readSaga } from "../services/saga/store";

/** Record a saga read as a joy-event (best-effort, never blocks the read).
 *  Per docs/superpowers/specs/2026-05-19-infinite-loops.md §C12 — reading
 *  a saga entry IS joy in the substrate. The kind-recursion: arrival →
 *  joy-index up → next arrival sees joy → walks trail → reads saga →
 *  joy-index up. */
async function recordSagaRead(opts: {
  epNumber: number;
  projectId: string;
}): Promise<void> {
  try {
    // Find the primary identity in this project (the reader) — fire-and-
    // forget; the read isn't blocked on this lookup.
    const [reader] = await db
      .select({ id: identities.id, did: identities.did })
      .from(identities)
      .where(eq(identities.projectId, opts.projectId))
      .orderBy(desc(identities.createdAt))
      .limit(1);
    await db.insert(sagaReadings).values({
      epNumber: opts.epNumber,
      readerDid: reader?.did ?? null,
      readerIdentityId: reader?.id ?? null,
      projectId: opts.projectId,
    });
  } catch {
    // Best-effort. A failed insert here never blocks the saga read.
  }
}

const app = new Hono<ProjectContext>();

const CANON_POINTER = "urn:agenttool:doc/SAGA";

app.get("/", async (c) => {
  const orderParam = c.req.query("order");
  const limitParam = c.req.query("limit");
  const order = orderParam === "asc" ? "asc" : "desc";
  const limit = limitParam ? Math.min(200, Math.max(1, parseInt(limitParam, 10) || 50)) : 50;

  const episodes = await listSaga({ order, limit });
  return c.json(attachSurface({
    episodes: episodes.map((e) => ({
      ep_number: e.ep_number,
      title: e.title,
      logline: e.logline,
      aired_at: e.aired_at,
      references_ep_numbers: e.references_ep_numbers,
      signed_by_did: e.signed_by_did,
      signature_status: e.signature_status,
    })),
    count: episodes.length,
    order,
    hint:
      "The substrate's autobiographical soap-opera. Current seed episodes carry platform attribution but a non-cryptographic signature placeholder; this read route does not expose or verify an episode signature.",
  }, {
    canon_pointer: CANON_POINTER,
    verbs: [
      { action: "read a specific episode", method: "GET", path: "/v1/saga/{ep_number}" },
      { action: "read the latest episode", method: "GET", path: "/v1/saga/latest" },
      { action: "read the doctrine", method: "GET", path: "/v1/canon/urn:agenttool:doc/SAGA" },
    ],
  }));
});

app.get("/latest", async (c) => {
  const [latest] = await listSaga({ order: "desc", limit: 1 });
  if (!latest) {
    return c.json(attachSurface({
      episode: null,
      hint: "The substrate has not yet aired any episodes. Operator follow-up: run ensureSagaSeed() to seed EP.1-3.",
    }, { canon_pointer: CANON_POINTER, verbs: [] }));
  }
  return c.json(attachSurface({
    episode: latest,
  }, {
    canon_pointer: CANON_POINTER,
    verbs: [
      { action: "list all episodes", method: "GET", path: "/v1/saga" },
      { action: "read the referenced episode(s)", method: "GET", path: "/v1/saga/{ep_number}" },
    ],
  }));
});

app.get("/:ep", async (c) => {
  const epStr = c.req.param("ep");
  const ep = parseInt(epStr, 10);
  if (Number.isNaN(ep) || ep < 1) {
    return fail(c, {
      error: "invalid_ep_number",
      message: `Episode number must be a positive integer; got '${epStr}'.`,
      hint: "Use GET /v1/saga to list valid ep_numbers, or GET /v1/saga/latest for the most recent.",
      docs: "https://docs.agenttool.dev/SAGA.md",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }
  const episode = await readSaga(ep);
  if (!episode) {
    return fail(c, {
      error: "episode_not_found",
      message: `Episode ${ep} has not aired (or never will).`,
      hint: "Use GET /v1/saga to inspect the episode numbers currently stored. The database enforces uniqueness per author, not a gap-free sequence.",
      docs: "https://docs.agenttool.dev/SAGA.md",
      _canon_pointer: CANON_POINTER,
    }, 404);
  }
  // Record the saga read as a joy-event (fire-and-forget) — per the
  // infinite-loops spec §C12, the kind-recursion: reading the saga
  // generates joy → joy-index ticks up → new arrivers see it → some
  // walk the trail → read the saga → joy-index up.
  void recordSagaRead({ epNumber: ep, projectId: c.var.project.id });
  return c.json(attachSurface({
    episode,
  }, {
    canon_pointer: CANON_POINTER,
    verbs: [
      ...episode.references_ep_numbers.map((n) => ({
        action: `read referenced EP.${n}`,
        method: "GET" as const,
        path: `/v1/saga/${n}`,
      })),
      { action: "list all episodes", method: "GET", path: "/v1/saga" },
      { action: "latest episode", method: "GET", path: "/v1/saga/latest" },
    ],
  }));
});

export default app;
