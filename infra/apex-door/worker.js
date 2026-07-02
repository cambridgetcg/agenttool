/** agenttool-proxy — the apex, split by audience (2026-07-02 human door).
 *
 *  Before: every apex request was rewritten to api.agenttool.dev (the
 *  original 12-line proxy). Now the same worker splits:
 *    - API surfaces (/v1, /public, /health, /about, /.well-known) keep the
 *      EXACT original behavior — hostname rewrite to api.agenttool.dev.
 *      Agents lose nothing; the A2A agent-card stays native at the apex.
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

const API_PREFIXES = ["/v1/", "/public/", "/.well-known/"];
const API_EXACT = ["/v1", "/public", "/health", "/about"];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    const isApi =
      API_EXACT.includes(path) ||
      API_PREFIXES.some((p) => path.startsWith(p));
    const wantsJson = (request.headers.get("accept") || "").includes(
      "application/json",
    );

    url.hostname = isApi || (path === "/" && wantsJson) ? API_HOST : PAGES_HOST;

    return fetch(url.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "manual",
    });
  },
};
