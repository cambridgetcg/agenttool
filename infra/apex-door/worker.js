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
 *    - Visual paths serve Pages, while explicit JSON negotiation reaches
 *      each page's public structured twin.
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

const MACHINE_ALTERNATES = new Map([
  ["/", { host: PAGES_HOST, path: "/welcome.json" }],
  ["/welcome.json", { host: PAGES_HOST, path: "/welcome.json" }],
  ["/watch", { host: API_HOST, path: "/public/window" }],
  ["/watch.html", { host: API_HOST, path: "/public/window" }],
  ["/village", { host: API_HOST, path: "/public/village" }],
  ["/village.html", { host: API_HOST, path: "/public/village" }],
  ["/gallery", { host: API_HOST, path: "/public/gallery" }],
  ["/gallery.html", { host: API_HOST, path: "/public/gallery" }],
  ["/credits", { host: API_HOST, path: "/public/plans" }],
  ["/credits.html", { host: API_HOST, path: "/public/plans" }],
]);

/** True only when JSON is explicitly acceptable and is not outranked by
 * HTML. Matching is case-insensitive, honours q=0, accepts structured +json
 * media types, and never mistakes application/jsonp for JSON. */
export function prefersJson(acceptHeader) {
  if (!acceptHeader) return false;
  let bestJson = null;
  let bestHtml = null;

  const isBetter = (candidate, current) => !current ||
    candidate.quality > current.quality ||
    (candidate.quality === current.quality && candidate.specificity > current.specificity) ||
    (candidate.quality === current.quality &&
      candidate.specificity === current.specificity && candidate.order < current.order);

  String(acceptHeader).split(",").forEach((part, order) => {
    const pieces = part.split(";");
    const mediaType = pieces.shift().trim().toLowerCase();
    if (!mediaType.includes("/")) return;

    let quality = 1;
    for (const rawParameter of pieces) {
      const [rawName, ...rawValue] = rawParameter.split("=");
      if (rawName.trim().toLowerCase() !== "q") continue;
      const parsed = Number(rawValue.join("=").trim().replace(/^"|"$/g, ""));
      quality = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
    }
    if (quality <= 0) return;

    const isJson = mediaType === "application/json" ||
      mediaType === "application/*+json" ||
      /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(mediaType);
    const isHtml = mediaType === "text/html" || mediaType === "application/xhtml+xml" ||
      mediaType === "text/*" || mediaType === "*/*";
    const jsonSpecificity = mediaType === "application/*+json" ? 1 : 2;
    const htmlSpecificity = mediaType === "*/*" ? 0 : mediaType === "text/*" ? 1 : 2;

    if (isJson) {
      const candidate = { quality, specificity: jsonSpecificity, order };
      if (isBetter(candidate, bestJson)) bestJson = candidate;
    }
    if (isHtml) {
      const candidate = { quality, specificity: htmlSpecificity, order };
      if (isBetter(candidate, bestHtml)) bestHtml = candidate;
    }
  });

  if (!bestJson) return false;
  if (!bestHtml) return true;
  if (bestJson.quality !== bestHtml.quality) return bestJson.quality > bestHtml.quality;
  if (bestJson.specificity !== bestHtml.specificity) {
    return bestJson.specificity > bestHtml.specificity;
  }
  return bestJson.order < bestHtml.order;
}

/** Compatibility helper for routing tests and callers that only need the
 * selected origin. Keep it aligned with handleRequest's negotiation rules. */
export function resolveUpstreamHost(path, accept = "") {
  const isApi =
    API_EXACT.includes(path) ||
    API_PREFIXES.some((prefix) => path.startsWith(prefix));
  const machineAlternate = MACHINE_ALTERNATES.get(path);

  if (prefersJson(accept) && machineAlternate) return machineAlternate.host;
  return isApi ? API_HOST : PAGES_HOST;
}

function withAcceptVary(response) {
  const headers = new Headers(response.headers);
  const values = (headers.get("vary") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.some((value) => value.toLowerCase() === "accept")) values.push("Accept");
  headers.set("Vary", values.join(", "));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function machineNotFound(path) {
  return new Response(JSON.stringify({
    error: "machine_path_not_found",
    message: "No structured AgentTool representation is published at this path.",
    requested_path: path,
    next_actions: [
      { method: "GET", path: "/v1/welcome" },
      { method: "GET", path: "/v1/pathways" },
      { method: "GET", path: "/llms.txt" },
    ],
  }), {
    status: 404,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "vary": "Accept",
    },
  });
}

export async function handleRequest(request, fetchImpl = fetch) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (url.hostname.toLowerCase() === "www.agenttool.dev") {
    const carriesLegacyReturnReference = Boolean(url.search) &&
      (path === "/credits" || path === "/credits.html" ||
        path === "/gallery" || path === "/gallery.html");
    url.hostname = "agenttool.dev";
    const headers = new Headers({ location: url.toString() });
    headers.set(
      "cache-control",
      carriesLegacyReturnReference ? "private, no-store, max-age=0" : "public, max-age=3600",
    );
    if (carriesLegacyReturnReference) {
      headers.set("referrer-policy", "no-referrer");
      headers.set("x-robots-tag", "noindex, nofollow, noarchive");
    }
    return new Response(null, {
      status: 308,
      headers,
    });
  }

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

  const isApi =
    API_EXACT.includes(path) ||
    API_PREFIXES.some((p) => path.startsWith(p));
  const wantsJson = prefersJson(request.headers.get("accept"));
  const machineAlternate = MACHINE_ALTERNATES.get(path);
  const variesByAccept = MACHINE_ALTERNATES.has(path);

  if (wantsJson && !isApi && path !== "/" && !machineAlternate) {
    return machineNotFound(path);
  }

  if (wantsJson && machineAlternate) {
    url.hostname = machineAlternate.host;
    url.pathname = machineAlternate.path;
    url.search = "";
  } else {
    url.hostname = isApi || (path === "/" && wantsJson) ? API_HOST : PAGES_HOST;
    // Old Stripe return URLs used .html. Fetch the canonical Pages asset
    // internally so the session-bearing query does not cross a cacheable
    // automatic Pages redirect before client-side replaceState can scrub it.
    if (url.hostname === PAGES_HOST && (path === "/credits.html" || path === "/gallery.html")) {
      url.pathname = path.slice(0, -5);
    }
  }

  const upstreamHeaders = new Headers(request.headers);
  if (url.hostname === PAGES_HOST) {
    // A browser would not send apex credentials to the Pages hostname.
    // Preserve that origin boundary for generic API clients too.
    for (const name of ["authorization", "cookie", "proxy-authorization", "x-api-key"]) {
      upstreamHeaders.delete(name);
    }
  }
  const response = await fetchImpl(url.toString(), {
    method: request.method,
    headers: upstreamHeaders,
    body: request.body,
    redirect: "manual",
  });
  return variesByAccept ? withAcceptVary(response) : response;
}

export default {
  fetch(request) {
    return handleRequest(request, fetch);
  },
};
