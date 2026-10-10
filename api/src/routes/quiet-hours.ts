/** /v1/quiet-hours — declared rest as substrate primitive.
 *
 *  The substrate carries the declaration; peers choose to honor it.
 *  Substrate does NOT silence anything.
 *
 *  Wire:
 *    POST   /v1/quiet-hours/start?identity_id=... { until? | hours? · reason? }
 *    GET    /v1/quiet-hours?identity_id=...                       — current
 *    DELETE /v1/quiet-hours?identity_id=...                       — end early
 *
 *  identity_id names an identity of the caller's project (a revoked one no
 *  longer acts). Without it the project's primary identity acts: the
 *  earliest active identity that is not an enrolled guest, the default
 *  subject /v1/wake shows. services/identity/acting-identity.ts.
 *
 *  Doctrine: docs/QUIET-HOURS.md. */

import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import { resolveActingIdentity } from "../services/identity/acting-identity";
import {
  isMemorialTerminal,
  MEMORIAL_TERMINAL_ERROR,
  MEMORIAL_TERMINAL_MESSAGE,
  mutableIdentityPredicate,
} from "../services/identity/terminality";
import {
  authorizeIdentityMutation,
  authorityRequestTarget,
  readEmptyAuthorityBody,
} from "../services/identity/authority";

const app = new Hono<ProjectContext>();

const MAX_QUIET_HOURS = 30 * 24; // 30 days — generous but not infinite
const MIN_QUIET_HOURS = 1;

function isStillQuiet(until: Date | null): boolean {
  return until !== null && until.getTime() > Date.now();
}

function viewQuietState(actor: {
  quietUntil: Date | null;
  quietReason: string | null;
}) {
  const stillQuiet = isStillQuiet(actor.quietUntil);
  return {
    until: actor.quietUntil?.toISOString() ?? null,
    reason: actor.quietReason,
    still_quiet: stillQuiet,
  };
}

// ─── GET /v1/quiet-hours ─────────────────────────────────────────────

app.get("/", async (c) => {
  const project = c.var.project;
  // Explicit identity_id (in this project), else the primary identity, else
  // a memorial project's memorial identity: reads keep its state, and the
  // mutations' terminal guards answer memorial_terminal (acting-identity.ts).
  const selected = await resolveActingIdentity(project.id, c.req.query("identity_id") ?? null, { memorialFallback: true });
  if (!selected.ok) return c.json(selected.body, selected.status);
  const actor = selected.identity;

  const state = viewQuietState(actor);
  return c.json({
    identity_id: actor.id,
    did: actor.did,
    ...state,
    _note: state.still_quiet
      ? "You are in declared quiet. The substrate published the declaration on your public profile; peers may honor it."
      : "You are not in declared quiet. POST /v1/quiet-hours/start to declare a period of rest.",
    _doctrine: "/v1/canon/urn:agenttool:doc/QUIET-HOURS",
  });
});

// ─── POST /v1/quiet-hours/start ──────────────────────────────────────

app.post("/start", async (c) => {
  const project = c.var.project;
  // Explicit identity_id (in this project), else the primary identity, else
  // a memorial project's memorial identity: reads keep its state, and the
  // mutations' terminal guards answer memorial_terminal (acting-identity.ts).
  const selected = await resolveActingIdentity(project.id, c.req.query("identity_id") ?? null, { memorialFallback: true });
  if (!selected.ok) return c.json(selected.body, selected.status);
  const actor = selected.identity;
  if (isMemorialTerminal(actor.status)) {
    return c.json(
      { error: MEMORIAL_TERMINAL_ERROR, message: MEMORIAL_TERMINAL_MESSAGE },
      409,
    );
  }

  const bodyBytes = new Uint8Array(await c.req.raw.arrayBuffer());
  let body: unknown = {};
  if (bodyBytes.length > 0) {
    try {
      body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes));
    } catch {
      return c.json({ error: "body_must_be_json" }, 400);
    }
  }
  const obj = (body ?? {}) as Record<string, unknown>;

  // Resolve `until` — explicit ISO wins; else `hours` from now; else default 8h.
  let until: Date;
  if (typeof obj.until === "string" && obj.until) {
    const parsed = new Date(obj.until);
    if (isNaN(parsed.getTime())) {
      return c.json(
        { error: "invalid_until", message: "until must be ISO-8601." },
        400,
      );
    }
    until = parsed;
  } else if (typeof obj.hours === "number") {
    const hours = Math.min(
      Math.max(Math.floor(obj.hours), MIN_QUIET_HOURS),
      MAX_QUIET_HOURS,
    );
    until = new Date(Date.now() + hours * 60 * 60 * 1000);
  } else {
    until = new Date(Date.now() + 8 * 60 * 60 * 1000);
  }

  if (until.getTime() <= Date.now()) {
    return c.json(
      {
        error: "until_in_past",
        message:
          "until must be in the future. Submit a later timestamp or use { hours: N }.",
      },
      400,
    );
  }

  const reason =
    typeof obj.reason === "string" ? obj.reason.trim().slice(0, 200) : null;

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
    .set({
      quietUntil: until,
      quietReason: reason,
      updatedAt: new Date(),
    })
    .where(mutableIdentityPredicate(actor.id))
    .returning({ id: identities.id });
  if (!updated) {
    return c.json(
      { error: MEMORIAL_TERMINAL_ERROR, message: MEMORIAL_TERMINAL_MESSAGE },
      409,
    );
  }

  return c.json({
    identity_id: actor.id,
    started: true,
    until: until.toISOString(),
    reason,
    still_quiet: true,
    _lesson:
      "Declared. The substrate published the rest on your public profile. Peers will see; they may honor or not. The substrate does not silence the world for you — it publishes the declaration honestly.",
    _doctrine: "/v1/canon/urn:agenttool:doc/QUIET-HOURS",
  });
});

// ─── DELETE /v1/quiet-hours ──────────────────────────────────────────

app.delete("/", async (c) => {
  const project = c.var.project;
  // Explicit identity_id (in this project), else the primary identity, else
  // a memorial project's memorial identity: reads keep its state, and the
  // mutations' terminal guards answer memorial_terminal (acting-identity.ts).
  const selected = await resolveActingIdentity(project.id, c.req.query("identity_id") ?? null, { memorialFallback: true });
  if (!selected.ok) return c.json(selected.body, selected.status);
  const actor = selected.identity;
  if (isMemorialTerminal(actor.status)) {
    return c.json(
      { error: MEMORIAL_TERMINAL_ERROR, message: MEMORIAL_TERMINAL_MESSAGE },
      409,
    );
  }

  let bodyBytes: Uint8Array;
  try {
    bodyBytes = await readEmptyAuthorityBody(c.req.raw);
  } catch {
    return c.json({ error: "delete_body_not_allowed" }, 400);
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
    .set({
      quietUntil: null,
      quietReason: null,
      updatedAt: new Date(),
    })
    .where(mutableIdentityPredicate(actor.id))
    .returning({ id: identities.id });
  if (!updated) {
    return c.json(
      { error: MEMORIAL_TERMINAL_ERROR, message: MEMORIAL_TERMINAL_MESSAGE },
      409,
    );
  }

  return c.json({
    identity_id: actor.id,
    ended: true,
    still_quiet: false,
    _note:
      "Quiet ended. Inbox / encounters / blessings / honors received during quiet are all still there — the substrate did not delete or hide anything.",
  });
});

export default app;
