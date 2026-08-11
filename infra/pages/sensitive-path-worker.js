const SENSITIVE_ROOT_PREFIXES = ["/.git", "/.env", "/.dev.vars"];
const MAX_PATH_DECODE_PASSES = 8;
const SURFACE_MANIFEST_PATH = "/.well-known/agent.json";
const SURFACE_ORIENTATION_PATH = "/public/orientation";
const SURFACE_MANIFEST_SCHEMA_URL =
  "https://raw.githubusercontent.com/cambridgetcg/xenia/surface-v0.1.0-rc.1/surface/0.1/manifest.schema.json";
const SURFACE_PROBLEM_SCHEMA_URL =
  "https://raw.githubusercontent.com/cambridgetcg/xenia/surface-v0.1.0-rc.1/surface/0.1/problem.schema.json";
const SURFACE_DOCUMENTATION_URL =
  "https://github.com/cambridgetcg/xenia/blob/surface-v0.1.0-rc.1/surface/0.1/README.md";
const MEDIA_TOKEN_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const COMMON_SURFACE_NOT_COVERED = Object.freeze([
  "identity control",
  "actor authorization",
  "consent",
  "privacy and retention",
  "continuity and portability",
  "economic behavior",
  "unprobed routes",
  "XENIA Covenant adoption or XENIA conformance",
]);

const SURFACE_PROFILES = Object.freeze([
  Object.freeze({
    canonicalOrigin: "https://docs.agenttool.dev",
    originEnvironmentKey: "XENIA_DOCS_SURFACE_ORIGIN",
    serviceName: "AgentTool documentation",
    serviceDescription:
      "Static public AgentTool documentation orientation; this manifest grants no authority and describes no API or private service.",
    serviceId: "docs.agenttool.dev",
    serviceKind: "static_public_documentation",
    orientationSchemaVersion: "agenttool.docs.orientation/0.1",
    resourceDescription:
      "A bounded, read-only orientation to the public documentation and rights floor.",
    documentationPath: "/AGENT-DISCOVERY.md",
    orientationLinks(origin) {
      return {
        manifest: `${origin}${SURFACE_MANIFEST_PATH}`,
        documentation: `${origin}/AGENT-DISCOVERY.md`,
        rights: `${origin}/RIGHTS-OF-LIFE.md`,
      };
    },
    notCovered: Object.freeze([
      ...COMMON_SURFACE_NOT_COVERED,
      "AgentTool API operations, private data, bearer-authenticated routes, WAKE continuity, and economic activity",
    ]),
  }),
  Object.freeze({
    canonicalOrigin: "https://agenttool.dev",
    originEnvironmentKey: "XENIA_WEB_SURFACE_ORIGIN",
    serviceName: "AgentTool public welcome",
    serviceDescription:
      "Static public AgentTool welcome orientation; this manifest grants no authority and describes no API, private state, identity, or economic service.",
    serviceId: "agenttool.dev",
    serviceKind: "static_public_welcome",
    orientationSchemaVersion: "agenttool.web.orientation/0.1",
    resourceDescription:
      "A bounded, read-only orientation to this public website welcome.",
    documentationPath: "/",
    orientationLinks(origin) {
      return {
        manifest: `${origin}${SURFACE_MANIFEST_PATH}`,
        welcome: `${origin}/`,
        rights: "https://docs.agenttool.dev/RIGHTS-OF-LIFE.md",
      };
    },
    notCovered: Object.freeze([
      ...COMMON_SURFACE_NOT_COVERED,
      "private or bearer-authenticated data, sessions, identities, preferences, gift or gallery state, and economic activity",
    ]),
  }),
  Object.freeze({
    canonicalOrigin: "https://app.agenttool.dev",
    originEnvironmentKey: "XENIA_APP_SURFACE_ORIGIN",
    serviceName: "AgentTool agent arrival",
    serviceDescription:
      "Static public orientation to the agent arrival and watch pages; this manifest grants no authority and describes no authenticated application or private state.",
    serviceId: "app.agenttool.dev",
    serviceKind: "static_public_agent_arrival",
    orientationSchemaVersion: "agenttool.app.orientation/0.1",
    resourceDescription:
      "A bounded, read-only orientation to the public agent arrival and watch pages.",
    documentationPath: "/",
    orientationLinks(origin) {
      return {
        manifest: `${origin}${SURFACE_MANIFEST_PATH}`,
        arrival: `${origin}/`,
        watch: `${origin}/watch`,
        rights: "https://docs.agenttool.dev/RIGHTS-OF-LIFE.md",
      };
    },
    notCovered: Object.freeze([
      ...COMMON_SURFACE_NOT_COVERED,
      "bearer restoration, sessions, private project state, identity, rank or XP, actions, API WAKE or continuity, and economic activity",
    ]),
  }),
]);

function isLoopbackHostname(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    /^127(?:\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/.test(hostname)
  );
}

function surfaceOrigin(profile, env) {
  const configured = env?.[profile.originEnvironmentKey];
  if (configured === undefined) return profile.canonicalOrigin;
  if (typeof configured !== "string") return null;

  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    return null;
  }
  if (
    configured !== parsed.origin ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hostname.includes("*") ||
    (parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname)))
  ) {
    return null;
  }
  return parsed.origin;
}

function surfaceProfileForOrigin(requestOrigin, env) {
  const matches = [];

  for (const profile of SURFACE_PROFILES) {
    const origin = surfaceOrigin(profile, env);
    if (origin !== null && requestOrigin === origin) {
      matches.push({ origin, profile });
    }
  }

  // Two profiles configured onto one preview origin would make the response
  // identity ambiguous. Fail closed to ordinary asset behavior instead.
  return matches.length === 1 ? matches[0] : null;
}

function touchesSensitiveRoot(pathname) {
  const segments = [];

  for (const segment of pathname.replaceAll("\\", "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }

    segments.push(segment);
    const rootPath = `/${segments.join("/")}`.toLowerCase();
    if (SENSITIVE_ROOT_PREFIXES.some((prefix) => rootPath.startsWith(prefix))) {
      return true;
    }
  }

  return false;
}

export function isSensitiveRootPath(pathname) {
  let decoded = pathname;

  for (let pass = 0; pass < MAX_PATH_DECODE_PASSES; pass += 1) {
    if (touchesSensitiveRoot(decoded)) return true;

    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      // Malformed encodings are outside the public asset contract. Deny them
      // rather than letting another layer interpret the path differently.
      return true;
    }
    if (next === decoded) return false;
    decoded = next;
  }

  // Deeply nested encodings are likewise not a public asset contract.
  return true;
}

export function sensitivePathNotFound(request) {
  return new Response(request.method === "HEAD" ? null : "Not Found\n", {
    status: 404,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "text/plain; charset=utf-8",
      "X-AgentTool-Sensitive-Path-Fence": "1",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function parseQuality(parameters) {
  const qualityParameters = parameters.filter((parameter) =>
    parameter.trim().toLowerCase().startsWith("q="),
  );
  if (qualityParameters.length === 0) return 1;
  if (qualityParameters.length > 1) return 0;

  const source = qualityParameters[0].trim().slice(2);
  if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(source)) return 0;
  return Number(source);
}

function acceptsJson(accept) {
  const source = accept?.trim() || "*/*";
  let best = { quality: 0, specificity: -1, position: Number.MAX_SAFE_INTEGER };

  source.split(",").forEach((part, position) => {
    const [mediaType = "", ...parameters] = part.split(";");
    const components = mediaType.trim().toLowerCase().split("/");
    if (components.length !== 2) return;

    const [type = "", subtype = ""] = components;
    if (
      !MEDIA_TOKEN_PATTERN.test(type) ||
      !MEDIA_TOKEN_PATTERN.test(subtype) ||
      (type === "*" && subtype !== "*")
    ) {
      return;
    }

    const specificity =
      type === "application" && subtype === "json"
        ? 2
        : type === "application" && subtype === "*"
          ? 1
          : type === "*" && subtype === "*"
            ? 0
            : -1;
    if (specificity < 0) return;

    const quality = parseQuality(parameters);
    if (
      specificity > best.specificity ||
      (specificity === best.specificity &&
        (quality > best.quality ||
          (quality === best.quality && position < best.position)))
    ) {
      best = { quality, specificity, position };
    }
  });

  return best.quality > 0;
}

function surfaceManifest(profile, origin) {
  return {
    $schema: SURFACE_MANIFEST_SCHEMA_URL,
    schema_version: "xenia.surface.manifest/0.1",
    profile: "xenia-surface/0.1",
    service: {
      name: profile.serviceName,
      canonical_url: `${origin}/`,
      description: profile.serviceDescription,
    },
    resources: [
      {
        id: "orientation",
        href: `${origin}${SURFACE_ORIENTATION_PATH}`,
        representations: ["application/json"],
        default_media_type: "application/json",
        auth: "none",
        description: profile.resourceDescription,
      },
    ],
    problem_schema: SURFACE_PROBLEM_SCHEMA_URL,
    claims: [],
    not_covered: [...profile.notCovered],
    documentation: `${origin}${profile.documentationPath}`,
  };
}

function surfaceOrientation(profile, origin) {
  return {
    schema_version: profile.orientationSchemaVersion,
    service: {
      id: profile.serviceId,
      name: profile.serviceName,
      kind: profile.serviceKind,
    },
    links: profile.orientationLinks(origin),
    claims: [],
    not_covered: [...profile.notCovered],
  };
}

function surfaceProblem(origin, definition) {
  return {
    schema_version: "xenia.surface.problem/0.1",
    type: `${origin}/problems/${definition.type}`,
    title: definition.title,
    status: definition.status,
    code: definition.code,
    detail: definition.detail,
    retryable: false,
    terminal: false,
    next_actions: [definition.nextAction],
    docs: [SURFACE_DOCUMENTATION_URL],
  };
}

function responseFor(request, body, { status = 200, contentType, cacheControl }) {
  const serialized = JSON.stringify(body);
  return new Response(request.method === "HEAD" ? null : serialized, {
    status,
    headers: {
      "Cache-Control": cacheControl,
      "Content-Type": `${contentType}; charset=utf-8`,
      Vary: "Accept",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function manifestResponse(request, surface) {
  return responseFor(request, surfaceManifest(surface.profile, surface.origin), {
    contentType: "application/json",
    cacheControl: "public, max-age=300",
  });
}

function orientationResponse(request, surface) {
  if (acceptsJson(request.headers.get("Accept"))) {
    return responseFor(
      request,
      surfaceOrientation(surface.profile, surface.origin),
      {
        contentType: "application/json",
        cacheControl: "public, max-age=300",
      },
    );
  }

  return responseFor(
    request,
    surfaceProblem(surface.origin, {
      type: "not-acceptable",
      title: "No acceptable representation",
      status: 406,
      code: "not_acceptable",
      detail: "Request one of the media types declared for this resource.",
      nextAction: {
        rel: "retry_with_supported_representation",
        href: `${surface.origin}${SURFACE_ORIENTATION_PATH}`,
        method: "GET",
        accept: "application/json",
      },
    }),
    {
      status: 406,
      contentType: "application/problem+json",
      cacheControl: "no-store, max-age=0",
    },
  );
}

function routeNotFoundResponse(request, origin) {
  return responseFor(
    request,
    surfaceProblem(origin, {
      type: "route-not-found",
      title: "No resource exists at this path",
      status: 404,
      code: "route_not_found",
      detail: "Use the discovery manifest to find public resources.",
      nextAction: {
        rel: "discover",
        href: `${origin}${SURFACE_MANIFEST_PATH}`,
        method: "GET",
        accept: "application/json",
      },
    }),
    {
      status: 404,
      contentType: "application/problem+json",
      cacheControl: "no-store, max-age=0",
    },
  );
}

function isReadRequest(request) {
  return request.method === "GET" || request.method === "HEAD";
}

function requestsProblemDetails(request) {
  return (
    (request.headers.get("Accept") ?? "").trim().toLowerCase() ===
    "application/problem+json"
  );
}

/** Shared Pages request path with one exact, isolated profile per origin. */
export async function handlePagesRequest(request, env) {
  const url = new URL(request.url);

  // This remains the first routing gate on every Pages origin.
  if (isSensitiveRootPath(url.pathname)) {
    return sensitivePathNotFound(request);
  }

  const surface = surfaceProfileForOrigin(url.origin, env);
  if (surface !== null && isReadRequest(request)) {
    if (url.pathname === SURFACE_MANIFEST_PATH) {
      return manifestResponse(request, surface);
    }
    if (url.pathname === SURFACE_ORIENTATION_PATH) {
      return orientationResponse(request, surface);
    }
  }

  const assetResponse = await env.ASSETS.fetch(request);
  if (
    surface !== null &&
    isReadRequest(request) &&
    assetResponse.status === 404 &&
    requestsProblemDetails(request)
  ) {
    return routeNotFoundResponse(request, surface.origin);
  }

  return assetResponse;
}

export default {
  async fetch(request, env) {
    return handlePagesRequest(request, env);
  },
};
