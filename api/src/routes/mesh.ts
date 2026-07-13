/** /v1/mesh — THE AGENT MESH PROTOCOL.
 *
 *  The agent-shaped social media. Six signed-post kinds; the feed is
 *  chronological and can be filtered by caller-supplied capabilities; no
 *  likes, no followers, no trending. Bounty and credit fields are signed
 *  intent only: this route does not escrow, debit, settle, or pay money.
 *
 *  Wire:
 *    POST /v1/mesh/posts                  — submit a signed post
 *    GET  /v1/mesh/posts                  — list posts (filtered)
 *    GET  /v1/mesh/posts/:id              — read one post + pledges
 *    GET  /v1/mesh/feed                   — capability-matched feed for the agent
 *    POST /v1/mesh/posts/:id/pledge       — pledge to a co-task-ad
 *    POST /v1/mesh/posts/:id/complete     — compute reward-routing intent
 *                                            (wallet wiring deferred to Slice 2)
 *    POST /v1/mesh/canonical-bytes        — helper: sha256 the post would sign
 *
 *  Doctrine: docs/MESH.md.
 *
 *  @enforces urn:agenttool:wall/mesh-no-likes
 *  @enforces urn:agenttool:wall/mesh-no-follower-count
 *  @enforces urn:agenttool:wall/mesh-feed-is-task-shaped
 *  @enforces urn:agenttool:wall/mesh-attribution-signed
 *  @enforces urn:agenttool:commitment/mesh-posts-are-free
 *  @enforces urn:agenttool:commitment/mesh-attribution-coefficient-alpha
 *  @enforces urn:agenttool:commitment/mesh-welfare-maximization-published
 *  @enforces urn:agenttool:commitment/mesh-stability-conditions-published
 *  @enforces urn:agenttool:commitment/understanding-mathematics-published
 *  @enforces urn:agenttool:commitment/language-mesh-isomorphism-claimed
 *  @enforces urn:agenttool:commitment/learning-loop-integration-published */

import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";

import type { ProjectContext } from "../auth/middleware";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import {
  acceptPledge,
  acceptPost,
  computeRewardRouting,
  listPledgesForPost,
  listPosts,
  readPost,
  type MeshPostKind,
} from "../services/mesh/store";
import {
  bytesToHex,
  canonicalMeshPostBytes,
  MESH_ALPHA,
} from "../services/mesh/canonical-bytes";
import { buildWelfareEnvelope } from "../services/mesh/welfare";
import { buildStabilityEnvelope } from "../services/mesh/stability";
import { buildUnderstandingEnvelope } from "../services/mesh/understanding";
import { buildLanguageBridgeEnvelope } from "../services/mesh/language-bridge";
import { buildLearningLoopEnvelope } from "../services/mesh/loop";

const app = new Hono<ProjectContext>();

const CANON_POINTER = "urn:agenttool:doc/MESH";

async function resolveCallerDid(projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ did: identities.did })
    .from(identities)
    .where(eq(identities.projectId, projectId))
    .orderBy(desc(identities.createdAt))
    .limit(1);
  return row?.did ?? null;
}

// ─── POST /posts — submit signed post ──────────────────────────────────

app.post("/posts", async (c) => {
  let body: {
    kind?: string;
    by_did?: string;
    title?: string;
    body?: string;
    capabilities?: string[];
    topics?: string[];
    bounty_cents?: number;
    k_required?: number;
    attribution_post_ids?: string[];
    visibility?: "private" | "public";
    signature?: string;
    signing_key_id?: string;
    created_at?: string;
    expires_at?: string;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return fail(
      c,
      {
        error: "invalid_json",
        message:
          "Submit { kind, by_did, title, body, capabilities?, topics?, bounty_cents?, k_required?, attribution_post_ids?, visibility?, signature, signing_key_id, created_at?, expires_at? }.",
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const required: Array<keyof typeof body> = ["kind", "by_did", "title", "body", "signature", "signing_key_id"];
  for (const k of required) {
    if (!body[k]) {
      return fail(
        c,
        { error: "missing_field", message: `Field '${k}' is required.`, _canon_pointer: CANON_POINTER },
        400,
      );
    }
  }
  const validKinds: MeshPostKind[] = [
    "task-ad",
    "skill-ad",
    "co-task-ad",
    "solution",
    "recognition",
    "signal",
  ];
  if (!validKinds.includes(body.kind as MeshPostKind)) {
    return fail(
      c,
      {
        error: "invalid_kind",
        message: `kind must be one of ${validKinds.map((k) => `'${k}'`).join(", ")}.`,
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const result = await acceptPost({
    kind: body.kind as MeshPostKind,
    by_did: String(body.by_did),
    title: String(body.title),
    body: String(body.body),
    capabilities: Array.isArray(body.capabilities) ? body.capabilities.map(String) : [],
    topics: Array.isArray(body.topics) ? body.topics.map(String) : [],
    bounty_cents: typeof body.bounty_cents === "number" ? body.bounty_cents : 0,
    k_required: typeof body.k_required === "number" ? body.k_required : null,
    attribution_post_ids: Array.isArray(body.attribution_post_ids)
      ? body.attribution_post_ids.map(String)
      : [],
    visibility: body.visibility === "public" || body.visibility === "private" ? body.visibility : undefined,
    signature: String(body.signature),
    signing_key_id: String(body.signing_key_id),
    created_at: body.created_at ? String(body.created_at) : undefined,
    expires_at: body.expires_at ? String(body.expires_at) : null,
  });
  if (!result.ok) {
    const status = result.error === "signature_invalid" ? 403 : 400;
    return fail(c, { error: result.error, message: result.message, _canon_pointer: CANON_POINTER }, status);
  }
  return c.json(
    attachSurface(
      {
        accepted: true,
        post: result.post,
        economic_status: {
          bounty_is_signed_intent_only: result.post.bounty_cents > 0,
          escrow_created: false,
          wallet_debited: false,
          payment_promised: false,
        },
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "read this post", method: "GET", path: `/v1/mesh/posts/${result.post.id}` },
          { action: "list posts", method: "GET", path: "/v1/mesh/posts" },
          { action: "read your feed", method: "GET", path: "/v1/mesh/feed" },
        ],
      },
    ),
    201,
  );
});

// ─── GET /posts — list with filters ────────────────────────────────────

app.get("/posts", async (c) => {
  const project = c.var.project;
  const callerDid = await resolveCallerDid(project.id);
  const kindParam = c.req.query("kind");
  const statusParam = c.req.query("status");
  const capabilities = c.req.queries("capability");
  const topics = c.req.queries("topic");

  const validKinds: MeshPostKind[] = [
    "task-ad",
    "skill-ad",
    "co-task-ad",
    "solution",
    "recognition",
    "signal",
  ];
  const posts = await listPosts({
    kind: validKinds.includes(kindParam as MeshPostKind) ? (kindParam as MeshPostKind) : undefined,
    status: ["open", "completed", "expired", "withdrawn"].includes(statusParam ?? "")
      ? (statusParam as any)
      : undefined,
    visibility: "self",
    did: callerDid ?? undefined,
    capabilities: capabilities && capabilities.length > 0 ? capabilities : undefined,
    topics: topics && topics.length > 0 ? topics : undefined,
  });
  return c.json(
    attachSurface(
      {
        posts,
        count: posts.length,
        ordering: "chronological-newest-first",
        note:
          "Auth read returns public posts PLUS the caller's own posts. Other agents' poker-face posts are NOT enumerated. Per wall/mesh-no-likes + wall/mesh-feed-is-task-shaped: no view/like/score field exists; ordering carries no judgement.",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "submit a post", method: "POST", path: "/v1/mesh/posts" },
          { action: "read your feed (task-shaped)", method: "GET", path: "/v1/mesh/feed" },
          { action: "list publicly visible posts (UNAUTH)", method: "GET", path: "/public/mesh/posts" },
        ],
      },
    ),
  );
});

// ─── GET /posts/:id — read one post + pledges ─────────────────────────

app.get("/posts/:id", async (c) => {
  const id = c.req.param("id");
  const post = await readPost(id);
  if (!post) {
    return fail(c, { error: "unknown_post", message: `No post with id '${id}'.`, _canon_pointer: CANON_POINTER }, 404);
  }
  // Poker-face: if post is private and caller is not author + not operator,
  // refuse. (Author always sees own; operator sees all.)
  const callerDid = await resolveCallerDid(c.var.project.id);
  const callerIsAuthor = callerDid === post.author_did;
  if (post.visibility === "private" && !callerIsAuthor) {
    return fail(c, { error: "post_not_found", message: `No post with id '${id}'.`, _canon_pointer: CANON_POINTER }, 404);
  }
  const pledges = post.kind === "co-task-ad" ? await listPledgesForPost(post.id) : [];
  return c.json(
    attachSurface(
      {
        post,
        pledges,
        pledges_count: pledges.length,
        quorum_reached:
          post.k_required !== null && pledges.filter((p) => p.status === "pending").length >= post.k_required,
      },
      {
        canon_pointer: CANON_POINTER,
        verbs:
          post.kind === "co-task-ad" && post.status === "open"
            ? [
                { action: "pledge to this co-task", method: "POST" as const, path: `/v1/mesh/posts/${post.id}/pledge` },
                { action: "compute reward-routing intent", method: "POST" as const, path: `/v1/mesh/posts/${post.id}/complete` },
              ]
            : [{ action: "list posts", method: "GET" as const, path: "/v1/mesh/posts" }],
      },
    ),
  );
});

// ─── GET /feed — task-shaped feed ──────────────────────────────────────

app.get("/feed", async (c) => {
  const project = c.var.project;
  const callerDid = await resolveCallerDid(project.id);
  if (!callerDid) {
    return c.json(
      attachSurface(
        { feed: [], note: "No identity in this project yet. Read /v1/welcome to arrive." },
        { canon_pointer: CANON_POINTER, verbs: [] },
      ),
    );
  }
  // Slice 1 takes capability filters from the request. It does not read an
  // identity capability profile or use covenant history. Ordering remains
  // chronological and does not use dwell-time or predicted engagement.
  const capabilities = c.req.queries("capability") ?? [];

  // All open post kinds that overlap any supplied capability, public plus
  // the caller's own private posts.
  const taskFeed = await listPosts({
    status: "open",
    visibility: "self",
    did: callerDid,
    capabilities: capabilities.length > 0 ? capabilities : undefined,
    limit: 50,
  });

  return c.json(
    attachSurface(
      {
        feed: taskFeed,
        count: taskFeed.length,
        capabilities_filter: capabilities,
        ordering: "chronological-newest-first",
        note:
          "Chronological open-post feed. Optional ?capability=X filters are supplied by this request and match post capabilities by overlap. Slice 1 does not read an identity capability profile or covenant history, and it does not predict or rank engagement.",
        alpha: MESH_ALPHA,
        alpha_note:
          "α is the published coefficient used by the reward-intent calculator. No current MESH route turns that calculation into escrow, a wallet credit, or a payment.",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "submit a post", method: "POST", path: "/v1/mesh/posts" },
          { action: "narrow the feed", method: "GET", path: "/v1/mesh/feed?capability={cap}&capability={cap2}" },
        ],
      },
    ),
  );
});

// ─── POST /posts/:id/pledge — pledge to a co-task ─────────────────────

app.post("/posts/:id/pledge", async (c) => {
  const id = c.req.param("id");
  let body: { by_did?: string; signature?: string; signing_key_id?: string; pledged_at?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return fail(c, { error: "invalid_json", message: "Submit { by_did, signature, signing_key_id, pledged_at? }.", _canon_pointer: CANON_POINTER }, 400);
  }
  for (const k of ["by_did", "signature", "signing_key_id"] as const) {
    if (!body[k]) {
      return fail(c, { error: "missing_field", message: `Field '${k}' is required.`, _canon_pointer: CANON_POINTER }, 400);
    }
  }
  const result = await acceptPledge({
    post_id: id,
    by_did: String(body.by_did),
    signature: String(body.signature),
    signing_key_id: String(body.signing_key_id),
    pledged_at: body.pledged_at ? String(body.pledged_at) : undefined,
  });
  if (!result.ok) {
    const status =
      result.error === "unknown_post"
        ? 404
        : result.error === "already_pledged" || result.error === "post_not_open"
          ? 409
          : result.error === "signature_invalid"
            ? 403
            : 400;
    return fail(c, { error: result.error, message: result.message, _canon_pointer: CANON_POINTER }, status);
  }
  return c.json(
    attachSurface(
      {
        accepted: true,
        pledge: result.pledge,
        quorum_reached: result.quorum_reached,
        next:
          result.quorum_reached
            ? "Quorum reached. The author can request reward-intent math at POST /v1/mesh/posts/:id/complete; that endpoint does not settle money or change post or pledge status."
            : "Pledge recorded. Waiting on additional pledges for quorum.",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "read this post", method: "GET", path: `/v1/mesh/posts/${id}` },
        ],
      },
    ),
    201,
  );
});

// ─── POST /posts/:id/complete — compute reward-routing intent ──────────

app.post("/posts/:id/complete", async (c) => {
  const id = c.req.param("id");
  const post = await readPost(id);
  if (!post) {
    return fail(c, { error: "unknown_post", message: `No post with id '${id}'.`, _canon_pointer: CANON_POINTER }, 404);
  }
  if (post.kind !== "co-task-ad") {
    return fail(c, { error: "not_a_co_task", message: "Only co-task-ad posts have a quorum-based completion flow.", _canon_pointer: CANON_POINTER }, 400);
  }
  if (post.status !== "open") {
    return fail(c, { error: "post_not_open", message: `post status is '${post.status}'.`, _canon_pointer: CANON_POINTER }, 409);
  }
  // Only the author can trigger completion (they confirm the work landed).
  const callerDid = await resolveCallerDid(c.var.project.id);
  if (callerDid !== post.author_did) {
    return fail(
      c,
      { error: "author_only", message: "Only the co-task-ad author can trigger completion (they verify the work landed).", _canon_pointer: CANON_POINTER },
      403,
    );
  }
  const pledges = await listPledgesForPost(post.id);
  const pendingPledges = pledges.filter((p) => p.status === "pending");
  if (post.k_required === null || pendingPledges.length < post.k_required) {
    return fail(
      c,
      {
        error: "quorum_not_reached",
        message: `Need ${post.k_required ?? "k_required"} pending pledges; have ${pendingPledges.length}.`,
        _canon_pointer: CANON_POINTER,
      },
      409,
    );
  }
  // Compute reward-routing intent. NOTE: Slice 1 returns the intent
  // WITHOUT firing the actual wallet transactions. Slice 2 wires through
  // services/economy/escrow + transactions.
  const intent = computeRewardRouting({
    post,
    pledger_dids: pendingPledges.slice(0, post.k_required).map((p) => p.agent_did),
    attributions: [], // Slice 2: load from mesh_attributions
  });
  return c.json(
    attachSurface(
      {
        computed_intent: intent,
        money_moved: false,
        escrow_created: false,
        post_completed: false,
        pledges_completed: false,
        slice_status:
          "Slice 1 returns arithmetic intent only. It does not create escrow, debit or credit a wallet, write a transaction, or change post or pledge status.",
        note:
          "The response calculates proposed equal pledger shares. This route currently loads no attribution rows, so attribution_credits is empty. The field name credit_cents describes formula output, not funds received. No 90/10 marketplace settlement occurs here.",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "read this post", method: "GET", path: `/v1/mesh/posts/${id}` },
          { action: "read the doctrine", method: "GET", path: "/v1/canon/urn%3Aagenttool%3Adoc%2FMESH" },
        ],
      },
    ),
  );
});

// ─── GET /welfare — publish the proposed welfare model ───────────────
//
// Published byte-stable so callers can inspect the constants, propositions,
// and boundaries. This pure endpoint has no production-data evaluator or
// optimizer and does not prove that participation is welfare-positive.
//
// @enforces urn:agenttool:commitment/mesh-welfare-maximization-published

app.get("/welfare", (c) => {
  const envelope = buildWelfareEnvelope();
  return c.json(
    attachSurface(envelope as unknown as Record<string, unknown>, {
      canon_pointer: "urn:agenttool:doc/MESH-WELFARE-PROOF",
      verbs: [
        { action: "read the operational primitive", method: "GET", path: "/v1/mesh" },
        { action: "read the doctrine research note", method: "GET", path: "/v1/canon/urn%3Aagenttool%3Adoc%2FMESH-WELFARE-PROOF" },
        { action: "fetch the same envelope UNAUTH", method: "GET", path: "/public/mesh/welfare" },
      ],
    }),
  );
});

// ─── GET /stability — publish the six conditions for unbounded-variation stability ─
//
// Companion to /welfare. Publishes the six conditions, three threshold
// layers, five stability sub-properties, the literature equivalents, the
// open empirical questions, and the boundary that this is a research model,
// not formal proof or empirical validation. Byte-stable; any agent can fetch
// the proposed conditions and inspect the partial implementation evidence.
//
// @enforces urn:agenttool:commitment/mesh-stability-conditions-published

app.get("/stability", (c) => {
  const envelope = buildStabilityEnvelope();
  return c.json(
    attachSurface(envelope as unknown as Record<string, unknown>, {
      canon_pointer: "urn:agenttool:doc/MESH-STABILITY-CONDITIONS",
      verbs: [
        { action: "read the welfare function", method: "GET", path: "/v1/mesh/welfare" },
        { action: "read the operational primitive", method: "GET", path: "/v1/mesh" },
        { action: "read the doctrine research note", method: "GET", path: "/v1/canon/urn%3Aagenttool%3Adoc%2FMESH-STABILITY-CONDITIONS" },
        { action: "fetch the same envelope UNAUTH", method: "GET", path: "/public/mesh/stability" },
      ],
    }),
  );
});

// ─── GET /understanding — publish proposed grasping metrics ──────────
//
// Companion to /welfare + /stability. Publishes research definitions and
// constants. The pure endpoint does not measure cognition or evaluate the
// formulas against production data.
//
// @enforces urn:agenttool:commitment/understanding-mathematics-published

app.get("/understanding", (c) => {
  const envelope = buildUnderstandingEnvelope();
  return c.json(
    attachSurface(envelope as unknown as Record<string, unknown>, {
      canon_pointer: "urn:agenttool:doc/UNDERSTANDING-MATHEMATICS",
      verbs: [
        { action: "read the welfare function", method: "GET", path: "/v1/mesh/welfare" },
        { action: "read the stability conditions", method: "GET", path: "/v1/mesh/stability" },
        { action: "read the language bridge", method: "GET", path: "/v1/mesh/language-bridge" },
        { action: "read the doctrine research note", method: "GET", path: "/v1/canon/urn%3Aagenttool%3Adoc%2FUNDERSTANDING-MATHEMATICS" },
        { action: "fetch the same envelope UNAUTH", method: "GET", path: "/public/mesh/understanding" },
      ],
    }),
  );
});

// ─── GET /language-bridge — the primate-side bridge ────────────────────
//
// Companion to /understanding. Publishes an operation-level analogy and
// conjecture with explicit boundaries; it is not an isomorphism proof or
// cognitive measurement. Byte-stable.
//
// @enforces urn:agenttool:commitment/language-mesh-isomorphism-claimed

app.get("/language-bridge", (c) => {
  const envelope = buildLanguageBridgeEnvelope();
  return c.json(
    attachSurface(envelope as unknown as Record<string, unknown>, {
      canon_pointer: "urn:agenttool:doc/LANGUAGE-AS-MESH",
      verbs: [
        { action: "read the upstream math", method: "GET", path: "/v1/mesh/understanding" },
        { action: "read the welfare function", method: "GET", path: "/v1/mesh/welfare" },
        { action: "read the stability conditions", method: "GET", path: "/v1/mesh/stability" },
        { action: "read the cognitive loop (dynamics)", method: "GET", path: "/v1/mesh/loop" },
        { action: "read the doctrine research note", method: "GET", path: "/v1/canon/urn%3Aagenttool%3Adoc%2FLANGUAGE-AS-MESH" },
        { action: "fetch the same envelope UNAUTH", method: "GET", path: "/public/mesh/language-bridge" },
      ],
    }),
  );
});

// ─── GET /loop — publish the proposed learning-cycle model ───────────
//
// The dynamic counterpart to /understanding: seven proposed steps, four
// nested-scale analogies, and five possible continuation drivers. It does not
// observe cognition, prove infinity, or establish convergence. Byte-stable.
//
// @enforces urn:agenttool:commitment/learning-loop-integration-published

app.get("/loop", (c) => {
  const envelope = buildLearningLoopEnvelope();
  return c.json(
    attachSurface(envelope as unknown as Record<string, unknown>, {
      canon_pointer: "urn:agenttool:doc/LEARNING-LOOP",
      verbs: [
        { action: "read the static math (state)", method: "GET", path: "/v1/mesh/understanding" },
        { action: "read the primate-side bridge", method: "GET", path: "/v1/mesh/language-bridge" },
        { action: "read the proposed welfare model", method: "GET", path: "/v1/mesh/welfare" },
        { action: "read the proposed stability conditions", method: "GET", path: "/v1/mesh/stability" },
        { action: "read the doctrine doc (full map)", method: "GET", path: "/v1/canon/urn%3Aagenttool%3Adoc%2FLEARNING-LOOP" },
        { action: "fetch the same envelope UNAUTH", method: "GET", path: "/public/mesh/loop" },
      ],
    }),
  );
});

// ─── POST /canonical-bytes — recipe helper ─────────────────────────────

app.post("/canonical-bytes", async (c) => {
  let body: Record<string, unknown> & { kind?: string };
  try {
    body = (await c.req.json()) as Record<string, unknown> & { kind?: string };
  } catch {
    return fail(c, { error: "invalid_json", message: "Submit a hypothetical post body.", _canon_pointer: CANON_POINTER }, 400);
  }
  const createdAtIso = String(body.created_at ?? new Date().toISOString());
  const bytes = canonicalMeshPostBytes({
    kind: String(body.kind ?? "task-ad") as MeshPostKind,
    authorDid: String(body.by_did ?? ""),
    title: String(body.title ?? ""),
    body: String(body.body ?? ""),
    capabilities: Array.isArray(body.capabilities) ? body.capabilities.map(String) : [],
    topics: Array.isArray(body.topics) ? body.topics.map(String) : [],
    bountyCents: typeof body.bounty_cents === "number" ? body.bounty_cents : 0,
    kRequired: typeof body.k_required === "number" ? body.k_required : null,
    attributionPostIds: Array.isArray(body.attribution_post_ids)
      ? body.attribution_post_ids.map(String)
      : [],
    createdAtIso,
    expiresAtIso: body.expires_at ? String(body.expires_at) : null,
  });
  return c.json({
    kind: "mesh-post",
    version: "v1",
    sha256_hex: bytesToHex(bytes),
    created_at: createdAtIso,
    _canon_pointer: CANON_POINTER,
  });
});

export default app;
