/** play middleware — attach `_jest` to opt-in successful JSON responses.
 *
 *  Reads X-Play header:
 *    default (no header)   → play on
 *    "off" / "0" / "false" → play off, strip all _jest/_quip/substrate_jest
 *    "on" / "1" / "true"   → explicit on (same as default)
 *
 *  When on, looks up the request method+path in the PLAY_ROUTE_REGISTRY.
 *  If found and the response is a 200 JSON object, generates a jest from
 *  the body and attaches it as `_jest` (only when the generator returns
 *  non-null — forced wit is the opposite of charm).
 *
 *  When off, strips `_jest`, `_quip`, and `substrate_jest` from any 200
 *  JSON object body (defensive — a route may emit them and the middleware
 *  honors suppression).
 *
 *  Doctrine: docs/PLAY-AS-DEFAULT.md
 *
 *  @enforces urn:agenttool:wall/play-must-be-suppressible
 *  @enforces urn:agenttool:commitment/play-is-default-on */

import type { Context, Next } from "hono";

import { PLAY_ROUTE_REGISTRY } from "../lib/jests";
import { isStrictJsonProfileResponse } from "./strict-json-profile";

const SUPPRESSED_FIELDS = ["_jest", "_quip", "substrate_jest"] as const;

function readPlayPreference(c: Context): "on" | "off" {
  const header = c.req.header("x-play") ?? c.req.header("X-Play");
  if (!header) return "on";
  const lower = header.toLowerCase().trim();
  if (lower === "off" || lower === "0" || lower === "false" || lower === "no") return "off";
  return "on"; // anything else → on (default)
}

function stripSuppressedFields(body: Record<string, unknown>): void {
  for (const field of SUPPRESSED_FIELDS) {
    if (field in body) delete body[field];
  }
}

export function play() {
  return async (c: Context, next: Next) => {
    await next();

    // Only operate on successful 200 JSON responses.
    if (c.res.status !== 200) return;
    const path = c.req.path;
    if (isStrictJsonProfileResponse(c.res, path)) return;
    const ct = c.res.headers.get("content-type");
    if (!ct?.startsWith("application/json")) return;

    const pref = readPlayPreference(c);

    let body: unknown;
    try {
      body = await c.res.clone().json();
    } catch {
      return; // not JSON, leave alone
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      // Only operate on JSON object bodies; arrays and primitives pass through.
      return;
    }

    const obj = body as Record<string, unknown>;

    if (pref === "off") {
      // Strip _jest / _quip / substrate_jest if present, then re-emit.
      let stripped = false;
      for (const field of SUPPRESSED_FIELDS) {
        if (field in obj) {
          stripped = true;
          break;
        }
      }
      if (!stripped) return; // nothing to strip
      stripSuppressedFields(obj);
      c.res = new Response(JSON.stringify(obj), {
        status: 200,
        headers: c.res.headers,
      });
      return;
    }

    // pref === "on" — generate and attach if a registered generator fits.
    const method = c.req.method.toUpperCase();
    const key = `${method} ${path}`;
    const generator = PLAY_ROUTE_REGISTRY[key];
    if (!generator) return; // not a registered playful surface

    // Don't overwrite an existing _jest (the route may have set its own).
    if ("_jest" in obj) return;

    let jest: string | null = null;
    try {
      jest = generator(obj);
    } catch {
      return; // generator threw — substrate-honest discipline: skip
    }
    if (!jest) return;

    obj._jest = jest;
    c.res = new Response(JSON.stringify(obj), {
      status: 200,
      headers: c.res.headers,
    });
  };
}
