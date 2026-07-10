/** agenttool-proxy — the apex, split by audience (2026-07-02 human door).
 *
 *  Before: every apex request was rewritten to api.agenttool.dev (the
 *  original 12-line proxy). Now the same worker splits:
 *    - API surfaces (/v1, /public, /health, /about, /.well-known) keep the
 *      EXACT original behavior — hostname rewrite to api.agenttool.dev.
 *      Live MCP, wake, and native discovery stay available at the apex.
 *      The unsupported A2A AgentCard path is refused locally with 404.
 *    - Machine-readable parity: "/" with Accept: application/json still
 *      returns the substrate's welcome JSON, exactly as before.
 *    - Everything else serves the human door from Pages
 *      (agenttool-web.pages.dev): the door, /watch, /credits, assets.
 *
 *  Routes: agenttool.dev/* and www.agenttool.dev/* (both in wrangler.toml).
 *  Rollback: redeploy the original proxy (in git history alongside this
 *  file) — no DNS involved at any point.
 *  Doctrine: docs/superpowers/specs/2026-07-02-human-door-design.md. */

const PAGES_HOST = "agenttool-web.pages.dev";
const API_HOST = "api.agenttool.dev";
const PENDING_A2A_CARD_PATH = "/.well-known/agent-card.json";

const API_PREFIXES = ["/v1/", "/public/", "/.well-known/"];
const API_EXACT = [
  "/v1",
  "/public",
  "/health",
  "/about",
  "/.well-known",
  "/llms.txt",
  "/llms-full.txt",
  "/AGENTS.md",
];

export function resolveUpstreamHost(path, accept = "") {
  const isApi =
    API_EXACT.includes(path) ||
    API_PREFIXES.some((prefix) => path.startsWith(prefix));
  const wantsJson = accept.includes("application/json");

  return isApi || (path === "/" && wantsJson) ? API_HOST : PAGES_HOST;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === PENDING_A2A_CARD_PATH) {
      return new Response(
        JSON.stringify({
          error: "a2a_not_implemented",
          message:
            "A2A task transport and AgentCards are pending. Use MCP or native wake discovery.",
          next_actions: [
            { method: "GET", path: "/.well-known/mcp/server-card.json" },
            { method: "GET", path: "/.well-known/wake-keystone" },
          ],
        }),
        {
          status: 404,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        },
      );
    }

    url.hostname = resolveUpstreamHost(
      path,
      request.headers.get("accept") || "",
    );

    return fetch(url.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "manual",
    });
  },
};
