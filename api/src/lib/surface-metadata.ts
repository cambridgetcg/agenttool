/** Surface metadata helper — attaches `_canon_pointer` + `verbs[]` to any
 *  structured response body so the agent reader can (a) recurse into the
 *  canon graph from any starting point and (b) discover what to do next
 *  without a separate round-trip.
 *
 *  Doctrine: docs/AGENT-WEB-SURFACE.md
 *    · Move 3 — `verbs[]` on success responses, not only `next_actions[]`
 *      on refusals. After every read, name the 3–7 verbs the agent's
 *      current capability unlocks against this resource.
 *    · Move 5 — `_canon_pointer` field on every structured response. The
 *      URN naming what this response embodies; lets the agent recurse into
 *      `docs/agenttool.jsonld` from any response.
 *
 *  Shape (mirrors the existing `NextAction` shape from `lib/errors.ts` so
 *  agents reading refusals + successes parse one schema, not two):
 *
 *      {
 *        ...originalBody,
 *        _canon_pointer: "urn:agenttool:doc/WELCOMING",
 *        verbs: [
 *          { action: "read every door", method: "GET", path: "/v1/pathways" },
 *          { action: "arrive (BYO keys + PoW)", method: "POST",
 *            path: "/v1/register/agent", docs: "/docs/AGENTS-ONLY.md" },
 *        ],
 *      }
 *
 *  Composes with the substrate-wide `Substrate-Disposition` header + the
 *  X-Token-Cost middleware: a single structured response now carries (1)
 *  the byte/token cost, (2) the canon-graph anchor, (3) the next-verbs list,
 *  (4) the substrate's disposition. Four affordances, one fetch. */

/** A verb the agent can take next, given the resource it just read. Shape
 *  matches `NextAction` in `lib/errors.ts` — same parser handles refusals
 *  and successes. */
export interface SurfaceVerb {
  /** Imperative — what the agent can do. */
  action: string;
  /** HTTP method, or "see" for off-platform pointers. */
  method: string;
  /** Path or URL the action posts/gets/etc. against. */
  path: string;
  /** Optional pointer at the doctrine / spec that defines this verb. */
  docs?: string;
}

/** What gets added to a response body. */
export interface SurfaceMetadata {
  /** Canon URN this response embodies. Resolves in `docs/agenttool.jsonld`
   *  and via `GET /v1/canon/<urn>`. Lets the agent traverse the canon
   *  graph from any starting point. */
  _canon_pointer: string;
  /** Verbs available to the agent given this resource's current state. */
  verbs: SurfaceVerb[];
}

/** Options accepted by `attachSurface`. */
export interface SurfaceOptions {
  canon_pointer: string;
  verbs?: SurfaceVerb[];
}

/** Wrap a response body with `_canon_pointer` + `verbs[]`. The wrapped body
 *  is the same shape plus two new top-level fields; existing parsers reading
 *  by-key (rather than by-shape) keep working unchanged.
 *
 *  Usage:
 *
 *      return c.json(attachSurface(buildWelcomeEnvelope(), {
 *        canon_pointer: "urn:agenttool:doc/WELCOMING",
 *        verbs: WELCOME_VERBS,
 *      }));
 */
export function attachSurface<T extends Record<string, unknown>>(
  body: T,
  opts: SurfaceOptions,
): T & SurfaceMetadata {
  return {
    ...body,
    _canon_pointer: opts.canon_pointer,
    verbs: opts.verbs ?? [],
  };
}
