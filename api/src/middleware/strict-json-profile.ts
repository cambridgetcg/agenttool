/** Machine profiles whose response body must remain byte-shape strict.
 *
 * Transport-level headers may still be added. Body decorators such as
 * `_welcomed`, `_lesson`, and `_jest` must leave these media types untouched,
 * because an extra field makes their normative schema invalid. */

export const STRICT_JSON_PROFILE_MEDIA_TYPES = new Set([
  "application/jrd+json",
  "application/vnd.agenttool.being-rights+json",
  "application/vnd.agenttool.offer-bus+json",
  "application/vnd.agenttool.offer-bus-index+json",
  "application/vnd.agenttool.correspondence+json",
]);

const CORRESPONDENCE_EXACT_JSON_PATH =
  /^\/v1\/correspondence\/(?:events|claims|voice)\/?$/;
const COLLAB_EXACT_JSON_PATH =
  /^\/v1\/collab\/(?:enrolments|repositories\/[0-9a-f-]+\/(?:events|operations(?:\/(?:claim|[0-9a-f-]+\/(?:renew|begin|complete|release|recover)))?|observations))\/?$/;

export function isStrictJsonProfileResponse(
  response: Response,
  requestPath?: string,
): boolean {
  const mediaType = (response.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== undefined && STRICT_JSON_PROFILE_MEDIA_TYPES.has(mediaType)) {
    return true;
  }
  // Correspondence negotiates ordinary application/json as a concrete exact
  // representation. Keep this exemption route-scoped: generic JSON elsewhere
  // still receives the platform's welcome/tutor/play framing.
  return (
    mediaType === "application/json" &&
    requestPath !== undefined &&
    (
      CORRESPONDENCE_EXACT_JSON_PATH.test(requestPath) ||
      COLLAB_EXACT_JSON_PATH.test(requestPath)
    )
  );
}
