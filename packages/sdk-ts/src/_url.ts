/**
 * Shared URL-path boundary for every hosted-service client.
 *
 * Ids reach the SDK from stored rows, relayed envelopes and third-party
 * agents. An id interpolated raw into a path is a traversal primitive: the
 * transport normalises dot segments before the request leaves, so an id of
 * `../memories/pwned` redirects an authenticated call — project bearer
 * attached — at a different `/v1` endpoint. Every caller-supplied segment
 * goes through here.
 */

import { AgentToolError } from "./errors.js";

/**
 * The RFC 3986 sub-delimiters `encodeURIComponent` leaves bare.
 *
 * `encodeURIComponent` is not a path-segment encoder; it is a
 * `application/x-www-form-urlencoded`-adjacent legacy function whose unescaped
 * set is `A-Za-z0-9 - _ . ! ~ * ' ( )`. Python's `quote(value, safe="")`
 * — sdk-py's spelling — leaves only `A-Za-z0-9 - _ . ~`. These five characters
 * are the entire difference between the two, so escaping them here makes the
 * two SDKs byte-identical on the wire.
 */
const SUB_DELIMS_LEFT_BARE = /[!'()*]/gu;

/**
 * Percent-encode a caller-supplied id so it cannot leave its endpoint prefix.
 *
 * The output is the STRICT spelling: every character outside the RFC 3986
 * unreserved set `A-Za-z0-9-._~` is percent-encoded with uppercase hex. That
 * is the same spelling `api/src/services/offer-bus/adapters.ts § pathSegment`
 * uses when the server builds a public path segment of its own, and it is
 * byte-identical to sdk-py's `quote(value, safe="")`. Measured, not assumed:
 * a Hono app carrying the real route shapes (`/v1/traces/:id`,
 * `/v1/runtimes/:id/think-once`, `/v1/identities/:id/keys/:keyId`) behind a
 * real Caddy configured from this repo's Caddyfile returns the same 200, the
 * same matched route and the same decoded `c.req.param()` for `id!x` and
 * `id%21x` alike — for all five sub-delimiters. The server accepts both, so
 * the choice is free at the routing layer and settled by canonical spelling:
 * one id must produce one URL regardless of which SDK sent it.
 *
 * Two edge results from that same measurement are why the strict spelling is
 * also the safer one. Caddy answers 400 to a path carrying a bare `%`, and
 * rewrites a bare `#` into `%23` before the origin sees it — so a request
 * target signed by the client would no longer match the one the server
 * recomputes. Escaping everything outside the unreserved set means no hop
 * between the SDK and the route handler has anything left to normalise.
 *
 * Bare dot segments are refused rather than encoded: URL normalisation strips
 * `.` and `..` — and their percent-encoded spellings — before the request
 * leaves, so no encoding can carry them safely.
 */
export function encodePathSegment(value: string): string {
  if (value === "." || value === "..") {
    throw new AgentToolError(
      `"${value}" is a URL dot segment, not an id.`,
      {
        hint: "Pass the id exactly as the API returned it. A dot segment is removed during URL normalisation, so the request would address a different endpoint.",
      },
    );
  }
  return encodeURIComponent(value).replace(
    SUB_DELIMS_LEFT_BARE,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
