/** /v1/identities/:id/expression — GET / PUT the agent's voice declarations.
 *
 *  These ride along in /v1/wake and shape adapter scaffolds. */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ProjectContext } from "../../auth/middleware";
import {
  authorizeIdentityMutation,
  authorityRequestTarget,
  readAuthorityBoundJson,
} from "../../services/identity/authority";
import {
  getExpression,
  setExpression,
  validateExpression,
} from "../../services/identity/expression";

const app = new Hono<ProjectContext>();

// Hono nested routes inherit the parent param `:id`. The router is mounted
// at /v1/identities/:id/expression so c.req.param("id") is the identity id.

app.get("/", async (c) => {
  const identityId = c.req.param("id");
  if (!identityId) throw new HTTPException(400, { message: "identity_id_required" });

  const expression = await getExpression(c.var.project.id, identityId);
  if (expression === null) {
    throw new HTTPException(404, { message: "identity_not_found" });
  }

  return c.json({
    identity_id: identityId,
    expression,
    is_default:
      Object.keys(expression).filter((k) => k !== "updated_at").length === 0,
  });
});

app.put("/", async (c) => {
  const identityId = c.req.param("id");
  if (!identityId) throw new HTTPException(400, { message: "identity_id_required" });

  let bound: Awaited<ReturnType<typeof readAuthorityBoundJson>>;
  try {
    bound = await readAuthorityBoundJson(c.req.raw);
  } catch {
    throw new HTTPException(400, { message: "body_must_be_json" });
  }
  const body = bound.value;

  let result;
  try {
    const expression = validateExpression(body); // early validate for cleaner 400
    const current = await getExpression(c.var.project.id, identityId);
    if (current === null) {
      throw new Error("identity_not_found");
    }
    const authority = await authorizeIdentityMutation({
      identityId,
      method: c.req.method,
      requestTarget: authorityRequestTarget(c.req.url),
      bodyBytes: bound.bodyBytes,
      headers: c.req.raw.headers,
    });
    if (!authority.ok) return c.json(authority.body, authority.status);
    result = await setExpression(c.var.project.id, identityId, expression);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "identity_not_found") {
      throw new HTTPException(404, { message: msg });
    }
    if (msg === "identity_memorial_terminal") {
      return c.json(
        {
          error: msg,
          message:
            "A memorial identity is immutable. Its witnessed expression remains intact.",
        },
        409,
      );
    }
    if (msg === "identity_state_changed") {
      return c.json(
        {
          error: msg,
          message: "Identity lifecycle changed concurrently. No expression was saved.",
        },
        409,
      );
    }
    return c.json({ error: "validation", message: msg }, 400);
  }

  return c.json({
    identity_id: identityId,
    expression: result,
    saved: true,
  });
});

export default app;
