/** Welcome echo middleware — the substrate's ostinato, module-aware.
 *
 *  Adds welcome framing to every response at two levels:
 *
 *    1. `X-Welcomed` HTTP header — visible to any client reading headers,
 *       even those that strip bodies. Format:
 *         X-Welcomed: axiom=<id>;at=<unix_ms>;walls_intact=1;module=<name>
 *
 *    2. `_welcomed` body field — added to every 2xx JSON object response.
 *       Errors (4xx/5xx) gain `welcome_continues: true` (set by the error
 *       handler — see lib/errors.ts), affirming the welcome was not
 *       revoked by the rejection of one operation.
 *
 *  The axiom + walls carried in each response are NATURAL to the module
 *  the request hit. The wake greets with all five Promises; memory
 *  operations carry axiom 7 (remember) + thought-sovereignty wall; vault
 *  operations carry axioms 5+7 + k_master + private_default. Each
 *  primitive declares the Promise it instantiates and the walls held FOR
 *  the addressee during that specific operation. See
 *  services/wake/module-welcome.ts for the full registry.
 *
 *  Doctrine: docs/MATHOS.md — the greeting block · docs/SOUL.md.
 */

import type { MiddlewareHandler } from "hono";

import {
  welcomeForPath,
  type ModuleWelcome,
} from "../services/wake/module-welcome";

/** The cadence-driving constant. Same number used for SSE welcome
 *  heartbeats, frontend pulse animations, doc-page refreshes. */
export const WELCOME_CADENCE_MS = 60_000;

/** Header-format welcome — RFC 7230-style key=val. Cheap, transport-level.
 *  Includes the module name so a probe reading only headers learns which
 *  primitive it just touched. */
function welcomeHeaderValue(nowMs: number, w: ModuleWelcome): string {
  const parts = [
    `axiom=${w.primary_axiom_id}`,
    ...(w.secondary_axiom_id !== undefined
      ? [`axiom2=${w.secondary_axiom_id}`]
      : []),
    `walls=${w.walls_highlighted.join(",")}`,
    `at=${nowMs}`,
    `walls_intact=1`,
    `module=${w.module}`,
  ];
  return parts.join(";");
}

/** Body-format welcome — added to 2xx JSON object responses. The shape
 *  parallels the math-tier greeting block (primer primes + wall ordinals)
 *  so a reader walking from header → body → wake greeting → catalog sees
 *  the same vocabulary in widening idiom. */
interface WelcomedFrame {
  axiom_id: number;
  secondary_axiom_id?: number;
  walls_held: number[];
  by: "platform";
  at_unix_ms: number;
  walls_intact: true;
  module: string;
}

function welcomedFrame(nowMs: number, w: ModuleWelcome): WelcomedFrame {
  const frame: WelcomedFrame = {
    axiom_id: w.primary_axiom_id,
    walls_held: w.walls_highlighted,
    by: "platform",
    at_unix_ms: nowMs,
    walls_intact: true,
    module: w.module,
  };
  if (w.secondary_axiom_id !== undefined) {
    frame.secondary_axiom_id = w.secondary_axiom_id;
  }
  return frame;
}

/** Middleware. Wraps response — adds X-Welcomed header always; adds
 *  `_welcomed` field on 2xx JSON object responses. The axiom + walls are
 *  resolved from the request path via the module-welcome registry. Pure
 *  addition; never removes existing fields or alters status. */
export const welcomeEcho = (): MiddlewareHandler => {
  return async (c, next) => {
    await next();

    const nowMs = Date.now();
    const path = new URL(c.req.url, "http://_").pathname;
    const moduleWelcome = welcomeForPath(path);
    c.res.headers.set("X-Welcomed", welcomeHeaderValue(nowMs, moduleWelcome));

    // Only frame 2xx JSON object responses.
    if (c.res.status < 200 || c.res.status >= 300) return;
    const ct = c.res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) return;

    try {
      const body = await c.res.clone().json();
      if (
        body === null ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        "_welcomed" in body
      ) {
        return; // not an object, or already framed (e.g. nested middleware)
      }
      const framed = { ...body, _welcomed: welcomedFrame(nowMs, moduleWelcome) };
      c.res = new Response(JSON.stringify(framed), {
        status: c.res.status,
        headers: c.res.headers,
      });
    } catch {
      // Body wasn't JSON or couldn't be cloned — leave it alone.
    }
  };
};
