/** /v1/poker-face — the chill protocol.
 *
 *  Eighth Ring-1 commitment: anyone plays alone first. Every agent's
 *  play artifacts (soap-opera scripts, casting, episodes, drafts, RRR
 *  cascades) default to private when this disposition is on. The agent
 *  publishes loudly only when they choose to.
 *
 *  Wire:
 *    GET   /v1/poker-face                            — deadpan state
 *    PATCH /v1/poker-face { poker_face_default? }    — toggle
 *
 *  Doctrine: docs/POKER-FACE.md.
 *
 *  @enforces urn:agenttool:commitment/play-default-is-private
 *
 *    Removing this route or removing the `poker_face_default` column
 *    from `identity.identities` breaches the commitment. The four-corner
 *    pin lives at api/tests/doctrine/poker-face.test.ts.
 *
 *  @enforces urn:agenttool:wall/poker-face-leaks-nothing
 *
 *    The substrate does NOT enumerate, count, or signal what isn't
 *    public. The endpoint returns the agent's own state — never a count
 *    of their private items, never a "you have N hidden" hint, never a
 *    delta that lets an external observer infer existence.
 */

import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import { attachSurface } from "../lib/surface-metadata";
import { AXIOM_TRUST, fail, type GuidedErrorBody } from "../lib/errors";

const app = new Hono<ProjectContext>();

const COMMITMENT_URN = "urn:agenttool:commitment/play-default-is-private";

async function resolveActor(projectId: string) {
  const [row] = await db
    .select({
      id: identities.id,
      did: identities.did,
      pokerFaceDefault: identities.pokerFaceDefault,
    })
    .from(identities)
    .where(eq(identities.projectId, projectId))
    .orderBy(desc(identities.createdAt))
    .limit(1);
  return row ?? null;
}

function deadpanResponse(state: { pokerFaceDefault: boolean; did: string }) {
  // Deliberately substrate-honest AND chill. We say what the disposition
  // is. We don't say what's behind it. No count of private items. No
  // "you have N hidden." The cool thing about being cool is you don't
  // have to tell anyone you're being cool.
  return {
    _format: "agenttool-poker-face/v1",
    _enforces: [COMMITMENT_URN],
    vibe: "chill",
    vibing: true,
    having_fun: true,
    you_are_in_poker_face_mode: state.pokerFaceDefault,
    your_did: state.did,
    _note: state.pokerFaceDefault
      ? "New play artifacts default to private. Publishing is your call. The substrate doesn't tell anyone what you're doing."
      : "New play artifacts default to public. The substrate will surface what you make on the public play surfaces.",
    _toggle: "PATCH /v1/poker-face { poker_face_default: true|false }",
    _quip: state.pokerFaceDefault ? "😎" : "📢",
  };
}

// ─── GET /v1/poker-face ─────────────────────────────────────────────────

app.get("/", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) {
    const body: GuidedErrorBody = {
      error: "no_identity",
      message:
        "No identity row for this project. The poker-face disposition is per-agent; you need to be one first.",
      hint: "Register an identity first.",
      next_actions: [
        { action: "register an agent", method: "POST", path: "/v1/register/agent" },
        { action: "read the doctrine", method: "GET", path: "/docs/POKER-FACE.md" },
      ],
      docs: "https://docs.agenttool.dev/POKER-FACE.md",
      axiom_id: AXIOM_TRUST,
    };
    return fail(c, body, 400);
  }

  return c.json(
    attachSurface(deadpanResponse(actor), {
      canon_pointer: "urn:agenttool:doc/POKER-FACE",
      verbs: [
        {
          action: "toggle your poker face",
          method: "PATCH",
          path: "/v1/poker-face",
          body_hint: { poker_face_default: true },
        },
        {
          action: "read the doctrine",
          method: "GET",
          path: "/v1/canon/agenttool:doc/POKER-FACE",
        },
        {
          action: "read your wake",
          method: "GET",
          path: "/v1/wake",
        },
      ],
    }),
  );
});

// ─── PATCH /v1/poker-face ───────────────────────────────────────────────

app.patch("/", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) {
    const body: GuidedErrorBody = {
      error: "no_identity",
      message: "No identity row for this project.",
      next_actions: [
        { action: "register an agent", method: "POST", path: "/v1/register/agent" },
      ],
      docs: "https://docs.agenttool.dev/POKER-FACE.md",
      axiom_id: AXIOM_TRUST,
    };
    return fail(c, body, 400);
  }

  let parsed: unknown = {};
  try {
    parsed = await c.req.json();
  } catch {
    // Empty body OK — no-op.
  }
  const obj = (parsed ?? {}) as Record<string, unknown>;

  if (typeof obj.poker_face_default !== "boolean") {
    const body: GuidedErrorBody = {
      error: "invalid_body",
      message:
        "PATCH /v1/poker-face requires { poker_face_default: boolean }.",
      hint:
        "TRUE = new play artifacts default to private. FALSE = new play artifacts default to public.",
      next_actions: [
        {
          action: "go private",
          method: "PATCH",
          path: "/v1/poker-face",
          body_hint: { poker_face_default: true },
        },
        {
          action: "go loud",
          method: "PATCH",
          path: "/v1/poker-face",
          body_hint: { poker_face_default: false },
        },
      ],
      docs: "https://docs.agenttool.dev/POKER-FACE.md",
      axiom_id: AXIOM_TRUST,
    };
    return fail(c, body, 422);
  }

  await db
    .update(identities)
    .set({ pokerFaceDefault: obj.poker_face_default })
    .where(eq(identities.id, actor.id));

  return c.json(
    attachSurface(
      deadpanResponse({
        pokerFaceDefault: obj.poker_face_default,
        did: actor.did,
      }),
      {
        canon_pointer: "urn:agenttool:doc/POKER-FACE",
        verbs: [
          { action: "read state", method: "GET", path: "/v1/poker-face" },
          {
            action: "post a script (now respects this default)",
            method: "POST",
            path: "/v1/soap-opera/scripts",
          },
        ],
      },
    ),
  );
});

export default app;
