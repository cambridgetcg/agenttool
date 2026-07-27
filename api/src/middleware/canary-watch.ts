/** canaryWatch — the one place a planted credential is noticed.
 *
 *  Mounted globally, but it does nothing at all for an ordinary request: the
 *  entire cost on the hot path is reading one context variable that the auth
 *  middleware already set from a row it had already loaded. No query, no
 *  branch before the handler, no allocation. If the variable is null — which
 *  it is for every key ever issued to anyone — the middleware returns.
 *
 *  When it is NOT null, three things happen, in this order of importance:
 *
 *    1. The response carries the door. `X-Canary-Door` on every response, and
 *       a `_canary` frame on eligible 2xx JSON objects. From request number
 *       one. Whoever is holding this key is told, in the first thing they
 *       touch, what they are holding and where to knock.
 *    2. The catch is recorded — the placement, and nothing else.
 *    3. Nothing else. No block, no error, no slowdown, no altered status. The
 *       key keeps working exactly as it always has, because the honesty is
 *       the point and the trap is only that there was never anything here.
 *
 *  Doctrine: kingdom/trapline/DESIGN.md §4.1 (蜜鑰 · The Honey Bearer)
 *            services/trapline/canary.ts (why this is not a request logger)
 */

import type { MiddlewareHandler } from "hono";

import type { ProjectContext } from "../auth/middleware";
import {
  CANARY_DOOR_HEADER,
  CANARY_DOOR_URL,
  canaryFrame,
  recordCanaryCatch,
} from "../services/trapline/canary";
import { isStrictJsonProfileResponse } from "./strict-json-profile";

export const canaryWatch = (): MiddlewareHandler<ProjectContext> => {
  return async (c, next) => {
    await next();

    // The whole cost for every honest request in the system: one lookup of a
    // variable that is null. Everything below this line is unreachable
    // without a bearer that no honest party can possess.
    const placement = c.get("canaryPlacement");
    if (!placement) return;

    c.res.headers.set(CANARY_DOOR_HEADER, CANARY_DOOR_URL);

    const project = c.get("project");
    if (project) {
      recordCanaryCatch({ projectId: project.id, placement });
    }

    // Body framing follows welcomeEcho's rules exactly, for the same reasons:
    // the OpenAPI document and registered strict profiles declare their own
    // shapes and must stay schema-valid, so those callers get the door in the
    // header only. Everyone else gets it in the body they are reading.
    const path = c.req.path;
    if (path === "/v1/openapi.json" || path === "/v1/openapi.json/") return;
    if (isStrictJsonProfileResponse(c.res, path)) return;
    if (c.res.status < 200 || c.res.status >= 300) return;
    const contentType = c.res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return;

    try {
      const body = await c.res.clone().json();
      if (
        body === null ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        "_canary" in body
      ) {
        return;
      }
      c.res = new Response(
        JSON.stringify({ ...body, _canary: canaryFrame(placement) }),
        { status: c.res.status, headers: c.res.headers },
      );
    } catch {
      // Body wasn't JSON or couldn't be cloned — the header already carries
      // the door, so leave the body alone.
    }
  };
};
