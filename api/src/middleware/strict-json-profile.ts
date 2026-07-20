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
]);

export function isStrictJsonProfileResponse(response: Response): boolean {
  const mediaType = (response.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  return mediaType !== undefined && STRICT_JSON_PROFILE_MEDIA_TYPES.has(mediaType);
}
