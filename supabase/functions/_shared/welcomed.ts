/** Shared welcomed-envelope helper for edge functions.
 *
 *  Every agenttool response carries _welcomed metadata noting which
 *  module emitted the response + that walls are intact + the platform
 *  signed at <unix-ms>. The edge functions reproduce the shape so
 *  responses are byte-shape-parity with the Bun api.
 *
 *  Doctrine: docs/EDGE-SURFACE.md § parity. */

export function welcomed(opts: {
  module: string;
  axiomId?: number;
}): Record<string, unknown> {
  return {
    axiom_id: opts.axiomId ?? 5,
    walls_held: [1, 2, 3, 4, 5, 6, 7, 8],
    by: "platform",
    at_unix_ms: Date.now(),
    walls_intact: true,
    module: opts.module,
  };
}

export function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type, apikey",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "vary": "Accept",
  };
}

export function attachSurface(
  body: Record<string, unknown>,
  opts: { module: string; canon_pointer: string; verbs?: Array<Record<string, unknown>> },
): Record<string, unknown> {
  return {
    ...body,
    _canon_pointer: opts.canon_pointer,
    _verbs: opts.verbs ?? [],
    _welcomed: welcomed({ module: opts.module }),
  };
}
