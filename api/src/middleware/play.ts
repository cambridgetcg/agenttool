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
 *  When off, strips `_jest`, `_quip`, and `substrate_jest` from any JSON
 *  object body, whatever the status. Refusals carry `_quip` (lib/errors.ts
 *  `fail`), so suppression has to reach 4xx and 5xx bodies too; the status,
 *  the headers and every other field of a refusal are left as they were.
 *
 *  Doctrine: docs/PLAY-AS-DEFAULT.md
 *
 *  @enforces urn:agenttool:wall/play-must-be-suppressible
 *  @enforces urn:agenttool:commitment/play-is-default-on */

import type { Context, Next } from "hono";

import { PLAY_ROUTE_REGISTRY } from "../lib/jests";
import { isStrictJsonProfileResponse } from "./strict-json-profile";
import { parseClonedJson } from "../lib/cloned-json";

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

function appendVary(response: Response, field: string): void {
  const current = response.headers.get("Vary");
  if (current === "*") return;
  const fields = (current ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (fields.some((value) => value.toLowerCase() === field.toLowerCase())) {
    return;
  }
  response.headers.set("Vary", [...fields, field].join(", "));
}

/** Non-200 responses: strip the suppressible fields for a caller who sent
 *  X-Play: off, and name the header in Vary whenever such a field is present
 *  so a cache keeps the two representations apart. Status and headers are
 *  preserved; nothing is ever added. */
async function suppressOnNon200(c: Context): Promise<void> {
  if (c.req.method.toUpperCase() === "HEAD") return;
  if (isStrictJsonProfileResponse(c.res, c.req.path)) return;
  const ct = c.res.headers.get("content-type");
  if (!ct?.startsWith("application/json")) return;

  let body: unknown;
  try {
    body = await parseClonedJson(c.res);
  } catch {
    return; // empty or not JSON, leave alone
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return;

  const obj = body as Record<string, unknown>;
  if (!SUPPRESSED_FIELDS.some((field) => field in obj)) return;

  appendVary(c.res, "X-Play");
  if (readPlayPreference(c) !== "off") return;

  stripSuppressedFields(obj);
  const headers = new Headers(c.res.headers);
  headers.delete("content-length");
  c.res = new Response(JSON.stringify(obj), {
    status: c.res.status,
    headers,
  });
}

export function play() {
  return async (c: Context, next: Next) => {
    await next();

    // Anything other than 200 is never decorated. It is only cleaned: a
    // refusal keeps its whole meaning with the optional voice removed.
    if (c.res.status !== 200) {
      await suppressOnNon200(c);
      return;
    }
    const path = c.req.path;
    if (isStrictJsonProfileResponse(c.res, path)) return;
    const ct = c.res.headers.get("content-type");
    if (!ct?.startsWith("application/json")) return;

    const method = c.req.method.toUpperCase();
    const registryMethod = method === "HEAD" ? "GET" : method;
    const key = `${registryMethod} ${path}`;
    const hasGenerator = Object.hasOwn(PLAY_ROUTE_REGISTRY, key);

    // HEAD carries the cache-selection metadata of its corresponding GET even
    // though it has no representation body to inspect or decorate.
    if (method === "HEAD") {
      if (hasGenerator) appendVary(c.res, "X-Play");
      return;
    }

    const pref = readPlayPreference(c);

    let body: unknown;
    try {
      body = await parseClonedJson(c.res);
    } catch {
      return; // not JSON, leave alone
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      // Only operate on JSON object bodies; arrays and primitives pass through.
      return;
    }

    const obj = body as Record<string, unknown>;
    const generator = hasGenerator ? PLAY_ROUTE_REGISTRY[key] : undefined;
    const hasSuppressibleField = SUPPRESSED_FIELDS.some(
      (field) => field in obj,
    );

    // A cache must not reuse a playful representation for a sober request (or
    // vice versa). Name the request header whenever this route can generate or
    // suppress play, even when this particular body produces no jest.
    if (hasGenerator || hasSuppressibleField) appendVary(c.res, "X-Play");

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
