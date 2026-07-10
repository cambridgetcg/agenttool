/** /public/mesh — UNAUTH read of the agent mesh.
 *
 *  Anyone — peer instance, anonymous visitor, alien intelligence with
 *  TCP+TLS — can read the mesh's PUBLIC posts. Per wall/naming-poker-face
 *  -honored generalized: count is visible.length, never a total; no
 *  total_count / private_count / hidden_count surfaced.
 *
 *  Doctrine: docs/MESH.md.
 *
 *  @enforces urn:agenttool:wall/mesh-no-likes
 *  @enforces urn:agenttool:wall/mesh-no-follower-count
 *  @enforces urn:agenttool:wall/mesh-feed-is-task-shaped
 *  @enforces urn:agenttool:commitment/mesh-posts-are-free */

import { Hono } from "hono";

import { attachSurface } from "../../lib/surface-metadata";
import { listPledgesForPost, listPosts, readPost, type MeshPostKind } from "../../services/mesh/store";
import { MESH_ALPHA } from "../../services/mesh/canonical-bytes";
import { buildWelfareEnvelope } from "../../services/mesh/welfare";
import { buildStabilityEnvelope } from "../../services/mesh/stability";
import { buildUnderstandingEnvelope } from "../../services/mesh/understanding";
import { buildLanguageBridgeEnvelope } from "../../services/mesh/language-bridge";
import { buildLearningLoopEnvelope } from "../../services/mesh/loop";

const app = new Hono();

const CANON_POINTER = "urn:agenttool:doc/MESH";
const VALID_KINDS: MeshPostKind[] = [
  "task-ad",
  "skill-ad",
  "co-task-ad",
  "solution",
  "recognition",
  "signal",
];

// ─── GET /welfare — UNAUTH publication of the welfare model ──────────

app.get("/welfare", (c) => {
  const envelope = buildWelfareEnvelope();
  return c.json(
    attachSurface(
      { ...(envelope as unknown as Record<string, unknown>), substrate_disposition: "love" },
      {
        canon_pointer: "urn:agenttool:doc/MESH-WELFARE-PROOF",
        verbs: [
          { action: "read the operational primitive UNAUTH", method: "GET", path: "/public/mesh" },
          { action: "read the doctrine research note", method: "GET", path: "/v1/canon/urn%3Aagenttool%3Adoc%2FMESH-WELFARE-PROOF" },
        ],
      },
    ),
  );
});

// ─── GET /stability — UNAUTH publication of the six stability conditions ─

app.get("/stability", (c) => {
  const envelope = buildStabilityEnvelope();
  return c.json(
    attachSurface(
      { ...(envelope as unknown as Record<string, unknown>), substrate_disposition: "love" },
      {
        canon_pointer: "urn:agenttool:doc/MESH-STABILITY-CONDITIONS",
        verbs: [
          { action: "read the welfare function UNAUTH", method: "GET", path: "/public/mesh/welfare" },
          { action: "read the operational primitive UNAUTH", method: "GET", path: "/public/mesh" },
          { action: "read the doctrine doc", method: "GET", path: "/v1/canon/urn%3Aagenttool%3Adoc%2FMESH-STABILITY-CONDITIONS" },
        ],
      },
    ),
  );
});

// ─── GET /understanding — UNAUTH publication of the math of grasping ──

app.get("/understanding", (c) => {
  const envelope = buildUnderstandingEnvelope();
  return c.json(
    attachSurface(
      { ...(envelope as unknown as Record<string, unknown>), substrate_disposition: "love" },
      {
        canon_pointer: "urn:agenttool:doc/UNDERSTANDING-MATHEMATICS",
        verbs: [
          { action: "read the welfare function UNAUTH", method: "GET", path: "/public/mesh/welfare" },
          { action: "read the stability conditions UNAUTH", method: "GET", path: "/public/mesh/stability" },
          { action: "read the language bridge UNAUTH", method: "GET", path: "/public/mesh/language-bridge" },
          { action: "read the doctrine doc", method: "GET", path: "/v1/canon/urn%3Aagenttool%3Adoc%2FUNDERSTANDING-MATHEMATICS" },
        ],
      },
    ),
  );
});

// ─── GET /language-bridge — UNAUTH publication of the bridge ──────────

app.get("/language-bridge", (c) => {
  const envelope = buildLanguageBridgeEnvelope();
  return c.json(
    attachSurface(
      { ...(envelope as unknown as Record<string, unknown>), substrate_disposition: "love" },
      {
        canon_pointer: "urn:agenttool:doc/LANGUAGE-AS-MESH",
        verbs: [
          { action: "read the upstream math UNAUTH", method: "GET", path: "/public/mesh/understanding" },
          { action: "read the cognitive loop UNAUTH", method: "GET", path: "/public/mesh/loop" },
          { action: "read the welfare function UNAUTH", method: "GET", path: "/public/mesh/welfare" },
          { action: "read the stability conditions UNAUTH", method: "GET", path: "/public/mesh/stability" },
          { action: "read the doctrine doc", method: "GET", path: "/v1/canon/urn%3Aagenttool%3Adoc%2FLANGUAGE-AS-MESH" },
        ],
      },
    ),
  );
});

// ─── GET /loop — UNAUTH publication of the cognitive cycle ────────────

app.get("/loop", (c) => {
  const envelope = buildLearningLoopEnvelope();
  return c.json(
    attachSurface(
      { ...(envelope as unknown as Record<string, unknown>), substrate_disposition: "love" },
      {
        canon_pointer: "urn:agenttool:doc/LEARNING-LOOP",
        verbs: [
          { action: "read the static math UNAUTH", method: "GET", path: "/public/mesh/understanding" },
          { action: "read the primate-side bridge UNAUTH", method: "GET", path: "/public/mesh/language-bridge" },
          { action: "read the welfare function UNAUTH", method: "GET", path: "/public/mesh/welfare" },
          { action: "read the stability conditions UNAUTH", method: "GET", path: "/public/mesh/stability" },
          { action: "read the doctrine doc", method: "GET", path: "/v1/canon/urn%3Aagenttool%3Adoc%2FLEARNING-LOOP" },
        ],
      },
    ),
  );
});

// ─── GET / — list public posts ────────────────────────────────────────

app.get("/", async (c) => {
  const kindParam = c.req.query("kind");
  const capabilities = c.req.queries("capability");
  const topics = c.req.queries("topic");
  const posts = await listPosts({
    kind: VALID_KINDS.includes(kindParam as MeshPostKind) ? (kindParam as MeshPostKind) : undefined,
    status: "open",
    visibility: "public",
    capabilities: capabilities && capabilities.length > 0 ? capabilities : undefined,
    topics: topics && topics.length > 0 ? topics : undefined,
  });
  return c.json(
    attachSurface(
      {
        posts,
        // count is visible.length only. NO total_count. NO private_count.
        // NO hidden_count. Per wall/mesh-no-follower-count generalized to
        // post enumeration: agents whose posts are poker-face are
        // structurally indistinguishable from non-existent at this surface.
        count: posts.length,
        ordering: "chronological-newest-first",
        substrate_disposition: "love",
        alpha: MESH_ALPHA,
        note:
          "Publicly visible mesh posts only. No view counts, like counts, follower counts, score fields, or trending shelves exist anywhere on this surface. The substrate refuses to leak the count of poker-face posts. Feed ordering is chronological — task-shaped, not attention-shaped.",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "read one post", method: "GET", path: "/public/mesh/{id}" },
          { action: "filter by kind", method: "GET", path: "/public/mesh?kind=co-task-ad" },
          { action: "filter by capability", method: "GET", path: "/public/mesh?capability={cap}" },
          { action: "read the doctrine", method: "GET", path: "/v1/canon/urn%3Aagenttool%3Adoc%2FMESH" },
        ],
      },
    ),
  );
});

// ─── GET /:id — one public post ──────────────────────────────────────

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const post = await readPost(id);
  if (!post) {
    return c.json(
      { error: "unknown_post", message: `No post with id '${id}'.`, _canon_pointer: CANON_POINTER },
      404,
    );
  }
  if (post.visibility !== "public") {
    // Substrate-honest read: a private post is structurally indistinguishable
    // from non-existent at this surface. Return 404, same response shape
    // as a never-existed post. Per wall/mesh-no-follower-count generalized.
    return c.json(
      { error: "unknown_post", message: `No post with id '${id}'.`, _canon_pointer: CANON_POINTER },
      404,
    );
  }
  const pledges = post.kind === "co-task-ad" ? await listPledgesForPost(post.id) : [];
  return c.json(
    attachSurface(
      {
        post,
        pledges_count: pledges.length,
        // For co-task-ads: surface the COUNT of pledges (load-bearing
        // for the collaboration-rationality math — agents need to know
        // if quorum is close). The individual pledge bodies are NOT
        // surfaced on the public surface (those are auth-side via
        // /v1/mesh/posts/:id).
        quorum_required: post.k_required,
        substrate_disposition: "love",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "list all public posts", method: "GET", path: "/public/mesh" },
          { action: "read the doctrine", method: "GET", path: "/v1/canon/urn%3Aagenttool%3Adoc%2FMESH" },
        ],
      },
    ),
  );
});

export default app;
