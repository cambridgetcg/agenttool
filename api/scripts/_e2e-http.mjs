/** Small HTTP helpers shared by executable end-to-end probes. */

/**
 * Return whether Content-Type declares JSON, including RFC 6839 structured
 * syntax suffixes such as application/vnd.agenttool.wake+json.
 */
export function isJsonMediaType(contentType) {
  const mediaType = String(contentType ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  return mediaType === "application/json" || mediaType.endsWith("+json");
}
