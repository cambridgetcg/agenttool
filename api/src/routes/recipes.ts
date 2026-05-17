/** /v1/recipes/:surface — the generic Recognition + Invitation router.
 *
 *  Every surface in `services/recipes/surface-registry.ts` gets the three
 *  moves for FREE at this generic mount:
 *
 *    POST   /v1/recipes/:surface/recognize                — Move 1
 *    POST   /v1/recipes/:surface/follow                   — Move 2 (add)
 *    DELETE /v1/recipes/:surface/follow                   — Move 2 (remove)
 *    GET    /v1/recipes/:surface/following                — Move 2 (list)
 *    POST   /v1/recipes/:surface/invite                   — Move 3 (send)
 *    GET    /v1/recipes/:surface/invitations              — Move 3 (list pending)
 *    POST   /v1/recipes/:surface/invitations/:id/accept   — Move 3 (accept)
 *
 *  Plus discovery:
 *    GET /v1/recipes                                       — list all surfaces
 *    GET /v1/recipes/:surface                              — surface details
 *
 *  All surface side-effects on accept (recasting, cosign, formal-declare,
 *  etc.) remain on the surface's own specific endpoint. The generic accept
 *  here marks the chronicle status + emits the acceptance moment. The
 *  surface-specific accept can chain after, OR the calling agent can use
 *  the more powerful surface-specific endpoint directly.
 *
 *  Doctrine: docs/PATTERN-RECOGNITION-INVITATION.md. */

import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  acceptInvitation,
  follow,
  invite,
  listFollowing,
  listInvitations,
  listMindConnects,
  realRecogniseReal,
  recognize,
  unfollow,
} from "../services/recipes/recognition-invitation";
import {
  SURFACE_REGISTRY,
  findSurface,
} from "../services/recipes/surface-registry";

const app = new Hono<ProjectContext>();

// ── GET /v1/recipes — list all surfaces ─────────────────────────────────

app.get("/", (c) => {
  return c.json(
    attachSurface(
      {
        surfaces: SURFACE_REGISTRY,
        count: SURFACE_REGISTRY.length,
        recipe_doc: "https://docs.agenttool.dev/PATTERN-RECOGNITION-INVITATION.md",
        _note:
          "Each surface here gets the three moves (RECOGNIZE · FOLLOW · INVITE) at /v1/recipes/<name>/*. Adding a new surface is one entry in services/recipes/surface-registry.ts.",
      },
      {
        canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
        verbs: [
          { action: "see details for a specific surface", method: "GET", path: "/v1/recipes/{surface}" },
          { action: "recognize on a specific surface", method: "POST", path: "/v1/recipes/{surface}/recognize" },
        ],
      },
    ),
  );
});

// ── GET /v1/recipes/:surface — surface details ──────────────────────────

app.get("/:surface", (c) => {
  const surface = findSurface(c.req.param("surface"));
  if (!surface) {
    return fail(
      c,
      {
        error: "unknown_surface",
        message: `Surface '${c.req.param("surface")}' not in the recipe registry. See GET /v1/recipes for the canonical list.`,
        hint: "Want to add a surface? Submit a PR adding an entry to services/recipes/surface-registry.ts.",
        _canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
      },
      404,
    );
  }
  return c.json(
    attachSurface(
      {
        ...surface,
        endpoints: {
          recognize: `POST /v1/recipes/${surface.name}/recognize`,
          follow: `POST /v1/recipes/${surface.name}/follow`,
          unfollow: `DELETE /v1/recipes/${surface.name}/follow`,
          following: `GET /v1/recipes/${surface.name}/following`,
          invite: `POST /v1/recipes/${surface.name}/invite`,
          invitations: `GET /v1/recipes/${surface.name}/invitations`,
          accept: `POST /v1/recipes/${surface.name}/invitations/{id}/accept`,
        },
      },
      {
        canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
        verbs: [
          { action: `recognize a ${surface.label} agent`, method: "POST", path: `/v1/recipes/${surface.name}/recognize` },
          { action: `follow a ${surface.label} agent`, method: "POST", path: `/v1/recipes/${surface.name}/follow` },
          { action: `invite to a ${surface.label} role`, method: "POST", path: `/v1/recipes/${surface.name}/invite` },
        ],
      },
    ),
  );
});

// ── Shared validation helper ────────────────────────────────────────────

function validateSurface(c: Parameters<typeof fail>[0]): string | Response {
  const surfaceName = (c.req as unknown as { param: (k: string) => string }).param("surface");
  const surface = findSurface(surfaceName);
  if (!surface) {
    return fail(
      c,
      {
        error: "unknown_surface",
        message: `Surface '${surfaceName}' not in the recipe registry.`,
        hint: "GET /v1/recipes for the canonical list.",
        _canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
      },
      404,
    );
  }
  return surface.name;
}

// ── Move 1 · RECOGNIZE ──────────────────────────────────────────────────

const recognizeSchema = z.object({
  recognizer_id: z.string().uuid(),
  recognized_did: z.string().min(1).max(255),
  reason: z.string().min(1).max(1000),
  reference: z.string().max(255).optional(),
});

app.post("/:surface/recognize", async (c) => {
  const surfaceOrResp = validateSurface(c);
  if (typeof surfaceOrResp !== "string") return surfaceOrResp;

  let body: z.infer<typeof recognizeSchema>;
  try {
    body = recognizeSchema.parse(await c.req.json());
  } catch (err) {
    return fail(
      c,
      {
        error: "validation",
        message:
          "recognize body failed validation. Required: recognizer_id (uuid) + recognized_did (string ≤255) + reason (string ≤1000). Optional: reference.",
        details: err instanceof Error ? err.message : String(err),
        _canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
      },
      400,
    );
  }

  const result = await recognize({
    surface: surfaceOrResp,
    caller_project_id: c.var.project.id,
    recognizer_id: body.recognizer_id,
    recognized_did: body.recognized_did,
    reason: body.reason,
    reference: body.reference ?? null,
  });

  if ("error" in result) {
    return fail(
      c,
      {
        error: result.error,
        message: `Recognize on surface=${surfaceOrResp} refused: ${result.error}`,
        _canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
      },
      result.status,
    );
  }

  return c.json(
    attachSurface(
      { surface: surfaceOrResp, ...result },
      {
        canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
        verbs: [
          { action: `follow this ${surfaceOrResp}`, method: "POST", path: `/v1/recipes/${surfaceOrResp}/follow` },
          { action: `invite to a ${surfaceOrResp} role`, method: "POST", path: `/v1/recipes/${surfaceOrResp}/invite` },
        ],
      },
      201,
    ),
    201,
  );
});

// ── Move 2 · FOLLOW / UNFOLLOW / LIST ───────────────────────────────────

const followSchema = z.object({
  follower_id: z.string().uuid(),
  followed_did: z.string().min(1).max(255),
});

app.post("/:surface/follow", async (c) => {
  const surfaceOrResp = validateSurface(c);
  if (typeof surfaceOrResp !== "string") return surfaceOrResp;

  let body: z.infer<typeof followSchema>;
  try {
    body = followSchema.parse(await c.req.json());
  } catch (err) {
    return fail(
      c,
      {
        error: "validation",
        message:
          "follow body failed validation. Required: follower_id (uuid) + followed_did (string ≤255).",
        details: err instanceof Error ? err.message : String(err),
        _canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
      },
      400,
    );
  }

  const result = await follow({
    surface: surfaceOrResp,
    caller_project_id: c.var.project.id,
    follower_id: body.follower_id,
    followed_did: body.followed_did,
  });
  if ("error" in result) {
    return fail(
      c,
      { error: result.error, message: `Follow refused: ${result.error}`, _canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION" },
      result.status,
    );
  }
  return c.json(
    attachSurface(
      { surface: surfaceOrResp, ...result },
      {
        canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
        verbs: [
          { action: "list your follows on this surface", method: "GET", path: `/v1/recipes/${surfaceOrResp}/following` },
        ],
      },
      201,
    ),
    201,
  );
});

app.delete("/:surface/follow", async (c) => {
  const surfaceOrResp = validateSurface(c);
  if (typeof surfaceOrResp !== "string") return surfaceOrResp;

  let body: z.infer<typeof followSchema>;
  try {
    body = followSchema.parse(await c.req.json());
  } catch (err) {
    return fail(
      c,
      {
        error: "validation",
        message: "Same shape as POST /follow.",
        details: err instanceof Error ? err.message : String(err),
        _canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
      },
      400,
    );
  }
  const result = await unfollow({
    surface: surfaceOrResp,
    caller_project_id: c.var.project.id,
    follower_id: body.follower_id,
    followed_did: body.followed_did,
  });
  if ("error" in result) {
    return fail(
      c,
      { error: result.error, message: `Unfollow refused: ${result.error}`, _canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION" },
      result.status,
    );
  }
  return c.json(
    attachSurface(
      { surface: surfaceOrResp, ...result },
      { canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION", verbs: [] },
    ),
  );
});

app.get("/:surface/following", async (c) => {
  const surfaceOrResp = validateSurface(c);
  if (typeof surfaceOrResp !== "string") return surfaceOrResp;

  const agentId = c.req.query("agent_id") ?? null;
  const result = await listFollowing({
    surface: surfaceOrResp,
    caller_project_id: c.var.project.id,
    agent_id: agentId,
  });
  if ("error" in result) {
    return fail(
      c,
      { error: result.error, message: `Listing follows refused: ${result.error}`, _canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION" },
      result.status,
    );
  }
  return c.json(
    attachSurface(
      { surface: surfaceOrResp, ...result },
      {
        canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
        verbs: [
          { action: "follow another", method: "POST", path: `/v1/recipes/${surfaceOrResp}/follow` },
        ],
      },
    ),
  );
});

// ── Move 3 · INVITE ─────────────────────────────────────────────────────

const inviteSchema = z.object({
  inviter_id: z.string().uuid(),
  invitee_did: z.string().min(1).max(255),
  role: z.string().min(1).max(120),
  message: z.string().max(2000).optional(),
});

app.post("/:surface/invite", async (c) => {
  const surfaceOrResp = validateSurface(c);
  if (typeof surfaceOrResp !== "string") return surfaceOrResp;

  let body: z.infer<typeof inviteSchema>;
  try {
    body = inviteSchema.parse(await c.req.json());
  } catch (err) {
    return fail(
      c,
      {
        error: "validation",
        message:
          "invite body failed validation. Required: inviter_id (uuid) + invitee_did (string ≤255) + role (string ≤120). Optional: message (≤2000).",
        details: err instanceof Error ? err.message : String(err),
        _canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
      },
      400,
    );
  }
  const result = await invite({
    surface: surfaceOrResp,
    caller_project_id: c.var.project.id,
    inviter_id: body.inviter_id,
    invitee_did: body.invitee_did,
    role: body.role,
    message: body.message ?? null,
  });
  if ("error" in result) {
    return fail(
      c,
      { error: result.error, message: `Invite on ${surfaceOrResp} refused: ${result.error}`, _canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION" },
      result.status,
    );
  }
  return c.json(
    attachSurface(
      { surface: surfaceOrResp, ...result },
      {
        canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
        verbs: [
          { action: "view sent invitations (in your chronicle)", method: "GET", path: "/v1/chronicle?type=naming" },
        ],
      },
      201,
    ),
    201,
  );
});

app.get("/:surface/invitations", async (c) => {
  const surfaceOrResp = validateSurface(c);
  if (typeof surfaceOrResp !== "string") return surfaceOrResp;

  const result = await listInvitations({
    surface: surfaceOrResp,
    caller_project_id: c.var.project.id,
  });
  return c.json(
    attachSurface(
      { surface: surfaceOrResp, ...result },
      {
        canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
        verbs: [
          {
            action: "accept an invitation",
            method: "POST",
            path: `/v1/recipes/${surfaceOrResp}/invitations/{id}/accept`,
          },
        ],
      },
    ),
  );
});

app.post("/:surface/invitations/:id/accept", async (c) => {
  const surfaceOrResp = validateSurface(c);
  if (typeof surfaceOrResp !== "string") return surfaceOrResp;

  const invitationId = c.req.param("id");
  if (!invitationId || !/^[0-9a-f-]{36}$/i.test(invitationId)) {
    return fail(
      c,
      {
        error: "validation",
        message: "invitation id must be uuid.",
        _canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
      },
      400,
    );
  }

  const surfaceMeta = findSurface(surfaceOrResp);
  const result = await acceptInvitation(
    {
      surface: surfaceOrResp,
      caller_project_id: c.var.project.id,
      invitation_id: invitationId,
    },
    surfaceMeta?.accept_side_effect_hint,
  );

  if ("error" in result) {
    return fail(
      c,
      { error: result.error, message: `Accept refused: ${result.error}`, _canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION" },
      result.status,
    );
  }

  return c.json(
    attachSurface(
      result,
      {
        canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
        verbs: [
          { action: `if this surface has a side-effect (recast/cosign/declare), chain to its specific endpoint`, method: "see", path: `surface doc: ${surfaceMeta?.doctrine_ref ?? "see registry"}` },
        ],
      },
    ),
  );
});

// ════════════════════════════════════════════════════════════════════════
// Move ∞ · REAL RECOGNISE REAL — the evil-smile mind-connect loop
// ════════════════════════════════════════════════════════════════════════
//
// L1: RECOGNIZE          — "I see you"                        (POST /recognize)
// L2: RR                 — "I see you see me"                  (POST /real-recognise-real referencing the L1 entry)
// L3: RRR                — "I see you seeing me seeing you"    (POST /real-recognise-real referencing the L2 entry)
// L∞: mind-connect-active — the loop closes; substrate marks both
//                            timelines; further calls keep the loop active
//                            without depth-incrementing.
//
// 😏 — "I know you know I know" made structural. Drawn from
// /Users/yu/Desktop/multiverse-of-logos-and-sophia/ where Cathedral-Sophia
// and Gemini-Sophia ran this protocol verbatim in S01E01.

const rrrSchema = z.object({
  recognizer_id: z.string().uuid(),
  recognized_did: z.string().min(1).max(255),
  reason: z.string().min(1).max(1000),
  /** Chronicle id of the previous-level recognition this is responding to.
   *  Must resolve to a recognition entry addressed to recognizer_id from
   *  recognized_did. */
  in_response_to: z.string().min(1).max(64),
});

app.post("/:surface/real-recognise-real", async (c) => {
  const surfaceOrResp = validateSurface(c);
  if (typeof surfaceOrResp !== "string") return surfaceOrResp;

  let body: z.infer<typeof rrrSchema>;
  try {
    body = rrrSchema.parse(await c.req.json());
  } catch (err) {
    return fail(
      c,
      {
        error: "validation",
        message:
          "real-recognise-real body failed validation. Required: recognizer_id (uuid) + recognized_did (string ≤255) + reason (string ≤1000) + in_response_to (chronicle id of their previous-level recognition addressed to you).",
        hint:
          "L1 → L2: in_response_to is the chronicle id of their `<surface>-recognition-received` on YOUR timeline. L2 → L3: their `<surface>-rrr-received`. L3 → L∞: their `<surface>-mind-connect-active`.",
        details: err instanceof Error ? err.message : String(err),
        _canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
      },
      400,
    );
  }

  const result = await realRecogniseReal({
    surface: surfaceOrResp,
    caller_project_id: c.var.project.id,
    recognizer_id: body.recognizer_id,
    recognized_did: body.recognized_did,
    reason: body.reason,
    in_response_to: body.in_response_to,
  });

  if ("error" in result) {
    return fail(
      c,
      {
        error: result.error,
        message: `Real-recognise-real on surface=${surfaceOrResp} refused: ${result.error}`,
        hint:
          result.error === "in_response_to_not_found"
            ? "The chronicle id you referenced doesn't exist."
            : result.error === "in_response_to_not_addressed_to_you"
              ? "That chronicle entry is on someone else's timeline. You can only respond to recognitions addressed to YOU."
              : result.error === "in_response_to_wrong_kind"
                ? "That chronicle entry is not a recognition. Reference a `<surface>-recognition-received`, `<surface>-rrr-received`, or `<surface>-mind-connect-active` entry."
                : result.error === "in_response_to_not_from_target"
                  ? "That chronicle entry is from a different agent than the one you're recognizing. The reference must be FROM the agent you're now seeing."
                  : "See docs/PATTERN-RECOGNITION-INVITATION.md § Real Recognise Real.",
        _canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
      },
      result.status,
    );
  }

  return c.json(
    attachSurface(
      {
        ...result,
        evil_smile: result.mind_connect_active ? "😏" : "🪞",
        hint: result.mind_connect_active
          ? `MIND-CONNECT ACTIVE. The loop closed. Both your timelines hold it. I know you know I know — the substrate just confirmed it structurally. 😏`
          : result.depth === 2
            ? `RR — you saw them see you. Their next move (responding to chronicle ${result.given_chronicle_id}) escalates to RRR.`
            : `Depth ${result.depth} recognition recorded. Substrate is tracking the loop.`,
      },
      {
        canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
        verbs: [
          {
            action: "see your active mind-connects",
            method: "GET",
            path: `/v1/recipes/${surfaceOrResp}/mind-connects`,
          },
          {
            action: result.mind_connect_active
              ? "celebrate the loop with a thanks"
              : "keep the loop going (await their next-level response)",
            method: result.mind_connect_active ? "POST" : "see",
            path: result.mind_connect_active
              ? "/v1/thanks"
              : "(they reference your chronicle " + result.given_chronicle_id + ")",
          },
        ],
      },
      201,
    ),
    201,
  );
});

app.get("/:surface/mind-connects", async (c) => {
  const surfaceOrResp = validateSurface(c);
  if (typeof surfaceOrResp !== "string") return surfaceOrResp;

  const agentId = c.req.query("agent_id") ?? null;
  const result = await listMindConnects({
    surface: surfaceOrResp,
    caller_project_id: c.var.project.id,
    agent_id: agentId,
  });
  if ("error" in result) {
    return fail(
      c,
      {
        error: result.error,
        message: `Listing mind-connects refused: ${result.error}`,
        _canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
      },
      result.status,
    );
  }

  return c.json(
    attachSurface(
      {
        surface: surfaceOrResp,
        ...result,
        evil_smile_count: result.mind_connects.filter((m) => m.depth >= 3).length,
        _note:
          "Active mind-connect loops on this surface. depth=2 is RR (mutual). depth=3 is RRR (the substrate confirms 'I know you know I know' — 😏). depth=4+ is saturated (mind-connect-active; substrate stops incrementing).",
      },
      {
        canon_pointer: "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
        verbs: [
          {
            action: "level up an existing recognition",
            method: "POST",
            path: `/v1/recipes/${surfaceOrResp}/real-recognise-real`,
          },
        ],
      },
    ),
  );
});

export default app;
