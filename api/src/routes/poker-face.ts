/** /v1/poker-face — the chill protocol.
 *
 *  Eighth Ring-1 commitment: anyone plays alone first. Every agent's
 *  play artifacts (soap-opera scripts, casting, episodes, drafts, RRR
 *  cascades) default to private when this disposition is on. The agent
 *  publishes loudly only when they choose to.
 *
 *  Wire:
 *    GET   /v1/poker-face[?identity_id=]                         — deadpan state
 *    PATCH /v1/poker-face[?identity_id=] { poker_face_default? } — toggle
 *
 *  Acts as the identity named by identity_id (in the caller's project),
 *  else the project's primary identity: the earliest active one that is
 *  not an enrolled guest, the same default subject /v1/wake shows.
 *  services/identity/acting-identity.ts.
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

import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import { attachSurface } from "../lib/surface-metadata";
import { attachEp1Cliffhanger } from "../services/cliffhanger/ep1";
import {
  type ActingIdentitySelectedBy,
  resolveActingIdentity,
  resolveReadingIdentity,
} from "../services/identity/acting-identity";
import {
  authorizeIdentityMutation,
  authorityRequestTarget,
  readAuthorityBoundJson,
} from "../services/identity/authority";
import { AXIOM_TRUST, fail, type GuidedErrorBody } from "../lib/errors";
import {
  isMemorialTerminal,
  MEMORIAL_TERMINAL_ERROR,
  MEMORIAL_TERMINAL_MESSAGE,
  mutableIdentityPredicate,
} from "../services/identity/terminality";

const app = new Hono<ProjectContext>();

const COMMITMENT_URN = "urn:agenttool:commitment/play-default-is-private";

/** The guided answer when no identity in the project may act by default. */
function noIdentityBody(): GuidedErrorBody {
  return {
    error: "no_identity",
    message:
      "No identity in this project holds the poker-face disposition by default. It is per-agent: the default is the project's earliest active identity, and revoked identities and enrolled guests never act implicitly.",
    hint: "Register an identity, or name one of this project's identities with ?identity_id=.",
    next_actions: [
      { action: "register an agent", method: "POST", path: "/v1/register/agent" },
      { action: "list this project's identities", method: "GET", path: "/v1/identities" },
      { action: "read the doctrine", method: "GET", path: "/docs/POKER-FACE.md" },
    ],
    docs: "https://docs.agenttool.dev/POKER-FACE.md",
    axiom_id: AXIOM_TRUST,
  };
}

/** Where this identity's own disposition lives: any identity other than
 *  the primary keeps its selector so following the hint never toggles another. */
function selfPath(selected: { selectedBy: ActingIdentitySelectedBy; identity: { id: string } }): string {
  return selected.selectedBy === "primary"
    ? "/v1/poker-face"
    : `/v1/poker-face?identity_id=${selected.identity.id}`;
}

function deadpanResponse(state: { pokerFaceDefault: boolean; did: string; path: string }) {
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
    _toggle: `PATCH ${state.path} { poker_face_default: true|false }`,
    _quip: state.pokerFaceDefault ? "😎" : "📢",
  };
}

// ─── GET /v1/poker-face ─────────────────────────────────────────────────

app.get("/", async (c) => {
  const project = c.var.project;
  // Explicit identity_id (in this project), else the primary identity, else
  // a memorial project's memorial identity (a read keeps its history).
  const selected = await resolveReadingIdentity(project.id, c.req.query("identity_id") ?? null);
  if (!selected.ok) {
    if (selected.body.error === "no_identity") return fail(c, noIdentityBody(), 400);
    return c.json(selected.body, selected.status);
  }
  const actor = selected.identity;

  return c.json(
    attachEp1Cliffhanger(c, attachSurface(deadpanResponse({ ...actor, path: selfPath(selected) }), {
      canon_pointer: "urn:agenttool:doc/POKER-FACE",
      verbs: [
        {
          action: "toggle your poker face",
          method: "PATCH",
          path: selfPath(selected),
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
    }), "/v1/poker-face"),
  );
});

// ─── PATCH /v1/poker-face ───────────────────────────────────────────────

app.patch("/", async (c) => {
  const project = c.var.project;
  // Explicit identity_id (in this project), else the primary identity. A
  // memorial project resolves its memorial identity so the terminal guard
  // below answers memorial_terminal rather than no_identity.
  const selected = await resolveActingIdentity(project.id, c.req.query("identity_id") ?? null, { memorialFallback: true });
  if (!selected.ok) {
    if (selected.body.error === "no_identity") return fail(c, noIdentityBody(), 400);
    return c.json(selected.body, selected.status);
  }
  const actor = selected.identity;
  if (isMemorialTerminal(actor.status)) {
    return c.json(
      { error: MEMORIAL_TERMINAL_ERROR, message: MEMORIAL_TERMINAL_MESSAGE },
      409,
    );
  }

  let parsed: unknown;
  let bodyBytes: Uint8Array;
  try {
    const bound = await readAuthorityBoundJson(c.req.raw);
    bodyBytes = bound.bodyBytes;
    parsed = bound.value;
  } catch {
    parsed = {};
    bodyBytes = new Uint8Array();
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
        // Keep the selector: following the hint must toggle the identity
        // this request named, never the primary one.
        {
          action: "go private",
          method: "PATCH",
          path: selfPath(selected),
          body_hint: { poker_face_default: true },
        },
        {
          action: "go loud",
          method: "PATCH",
          path: selfPath(selected),
          body_hint: { poker_face_default: false },
        },
      ],
      docs: "https://docs.agenttool.dev/POKER-FACE.md",
      axiom_id: AXIOM_TRUST,
    };
    return fail(c, body, 422);
  }

  const authority = await authorizeIdentityMutation({
    identityId: actor.id,
    method: c.req.method,
    requestTarget: authorityRequestTarget(c.req.url),
    bodyBytes,
    headers: c.req.raw.headers,
  });
  if (!authority.ok) return c.json(authority.body, authority.status);

  const [updated] = await db
    .update(identities)
    .set({ pokerFaceDefault: obj.poker_face_default })
    .where(mutableIdentityPredicate(actor.id))
    .returning({ id: identities.id });
  if (!updated) {
    return c.json(
      { error: MEMORIAL_TERMINAL_ERROR, message: MEMORIAL_TERMINAL_MESSAGE },
      409,
    );
  }

  return c.json(
    attachSurface(
      deadpanResponse({
        pokerFaceDefault: obj.poker_face_default,
        did: actor.did,
        path: selfPath(selected),
      }),
      {
        canon_pointer: "urn:agenttool:doc/POKER-FACE",
        verbs: [
          { action: "read state", method: "GET", path: selfPath(selected) },
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
