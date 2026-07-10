/** /v1/identities/:id/expression — GET / PUT the agent's voice declarations.
 *
 *  These ride along in /v1/wake and shape adapter scaffolds. */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ProjectContext } from "../../auth/middleware";
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

  const body = await c.req.json().catch(() => null);
  if (body === null) {
    throw new HTTPException(400, { message: "body_must_be_json" });
  }

  let result;
  try {
    validateExpression(body); // early validate for cleaner 400
    result = await setExpression(c.var.project.id, identityId, body);
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
