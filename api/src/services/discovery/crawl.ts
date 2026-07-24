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

export function buildApiRobotsTxt(
  publicBase = DEFAULT_PUBLIC_BASE,
): string {
  const api = httpsOrigin(publicBase);
  const allowedDiscoveryPaths = [
    ...API_SITEMAP_PATHS,
    "/sitemap.xml",
  ].map((path) => `Allow: ${path}$`);
  return [
    "# These exact public discovery reads are welcome.",
    "# robots.txt is a polite crawl request, not access control.",
    "User-agent: *",
    "Disallow: /",
    ...allowedDiscoveryPaths,
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
