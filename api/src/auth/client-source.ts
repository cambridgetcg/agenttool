/** Client-origin classification — which surface a request came through.
 *
 *  A soft signal, not a security boundary. A caller can spoof the header;
 *  the value is best-effort provenance ("this write came via the TS SDK"),
 *  used by /v1/activity to label events. Never gate on it.
 *
 *  The signal arrives as `X-Agenttool-Client` (preferred — browser-safe;
 *  fetch() in a browser cannot set User-Agent) with `User-Agent` as a
 *  fallback for older SDK builds. Both SDKs send `agenttool-sdk-<lang>/<ver>`.
 *
 *  Doctrine: docs/ACTIVITY.md §Origin signal. */

/** The closed set of origins /v1/activity surfaces. `http` is the honest
 *  default — the request WAS recorded, it just didn't come from a surface
 *  we recognize. Distinct from `null` on an event, which means "not
 *  recorded" (a pre-feature row, or a write path that doesn't stamp). */
export type ClientSource = "sdk-ts" | "sdk-py" | "bridge" | "platform" | "http";

/** The full closed set — exported so the activity reader can validate a
 *  value pulled from a metadata JSONB blob before trusting it. */
export const CLIENT_SOURCES: readonly ClientSource[] = [
  "sdk-ts",
  "sdk-py",
  "bridge",
  "platform",
  "http",
] as const;

/** True when `value` is one of the known ClientSource tokens. Used to
 *  validate metadata.client_source read back from the DB — a hand-written
 *  or stale row could carry anything. */
export function isClientSource(value: unknown): value is ClientSource {
  return (
    typeof value === "string" &&
    (CLIENT_SOURCES as readonly string[]).includes(value)
  );
}

/** Classify a client-identifier string into a ClientSource.
 *
 *  Matches the `agenttool-<surface>-<lang>` / `agenttool-<surface>` family
 *  the SDKs + bridge + platform-internal callers send. Anything else —
 *  including an empty/missing header — classifies as `http`: a real,
 *  recorded request that simply didn't announce a known surface.
 *
 *  Pure + total: every input maps to exactly one ClientSource, never throws.
 *  Pinned by api/tests/client-source.test.ts. */
export function classifyClient(header: string | undefined | null): ClientSource {
  if (!header) return "http";
  // SDK identifiers look like `agenttool-sdk-ts/0.8.0` — take the token
  // before the first slash/space so the version never affects the match.
  const token = header.trim().toLowerCase().split(/[/\s]/)[0] ?? "";
  if (token === "agenttool-sdk-ts") return "sdk-ts";
  if (token === "agenttool-sdk-py") return "sdk-py";
  if (token === "agenttool-bridge") return "bridge";
  if (token === "agenttool-platform" || token === "agenttool-internal") {
    return "platform";
  }
  return "http";
}
