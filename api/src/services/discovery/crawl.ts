/** Bounded crawler hints for the public API origin.
 *
 * robots.txt and sitemaps help willing crawlers find public reads. They are
 * not access control, authorization, or a promise of indexing.
 */

const DEFAULT_PUBLIC_BASE =
  process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev";

export const API_SITEMAP_PATHS = [
  "/",
  "/public/discovery",
  "/public/porch",
  "/public/safety",
  "/.well-known",
  "/.well-known/api-catalog",
  "/.well-known/agent.txt",
  "/.well-known/security.txt",
  "/llms.txt",
  "/AGENTS.md",
  "/v1/openapi.json",
  "/v1/pathways",
] as const;

function httpsOrigin(value: string): string {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error("public_base_must_be_credential_free_https_origin");
  }
  return parsed.origin;
}

/** Robots rules in RFC 9309 core syntax only: path-prefix matching, no `$`
 * anchors. The pre-2026-07-29 policy paired `Disallow: /` with `$`-anchored
 * Allow lines — a Google/Bing extension — so strict RFC 9309 parsers read it
 * as a total disallow while response headers advertised `/docs/` paths the
 * policy forbade. Prefix rules say the same thing to every parser.
 *
 * Longest-match decides: `Allow: /` welcomes the root and every public
 * surface not named below; `Disallow: /v1/` keeps the API namespace closed
 * except the enumerated public reads (each verified to serve 200 without
 * credentials); `Disallow: /v1/self-` outweighs `Allow: /v1/self` for the
 * authenticated self-love / self-recognition routes that share its prefix.
 * A new private namespace outside /v1/ needs its own Disallow line here —
 * and its real protection stays authentication, never this file.
 */
export const API_ROBOTS_RULES = [
  "Allow: /",
  "Disallow: /v1/",
  "Allow: /v1/openapi.json",
  "Allow: /v1/pathways",
  "Allow: /v1/welcome",
  "Allow: /v1/canon",
  "Allow: /v1/self",
  "Disallow: /v1/self-",
  "Allow: /v1/mathos",
  "Allow: /v1/youspeak",
  "Disallow: /federation",
  "Disallow: /feeds",
] as const;

export function buildApiRobotsTxt(
  publicBase = DEFAULT_PUBLIC_BASE,
): string {
  const api = httpsOrigin(publicBase);
  return [
    "# Portable crawl posture (2026-07-29): RFC 9309 path-prefix rules only,",
    "# no $ anchors, so strict and extended parsers read the same policy.",
    "# Public reads are welcome; the authenticated API namespace stays closed.",
    "# robots.txt is a polite crawl request, not access control.",
    "User-agent: *",
    ...API_ROBOTS_RULES,
    `Sitemap: ${api}/sitemap.xml`,
    "",
  ].join("\n");
}

export function buildApiSitemap(
  publicBase = DEFAULT_PUBLIC_BASE,
): string {
  const api = httpsOrigin(publicBase);
  const urls = API_SITEMAP_PATHS.map(
    (path) => `  <url><loc>${api}${path}</loc></url>`,
  ).join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
}
