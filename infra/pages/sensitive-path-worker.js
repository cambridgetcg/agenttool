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
const GENERATED_CONTENT_SECURITY_POLICY =
  "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'";
const GENERATED_PERMISSIONS_POLICY =
  "accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()";
const STATIC_CSP_PREFIX =
  "default-src 'self'; base-uri 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; frame-ancestors 'none'; form-action 'self'";
// Docs still has committed inline style blocks. Keep their exact hashes here;
// the separate style-src-attr allowance below is limited to legacy attributes.
const DOCS_STYLE_HASH_SOURCES = Object.freeze([
  "'sha256-+SUq5ute7ZvuUvBUA/BlmpOJp82oi1Qs4RY3RF+KYaQ='",
  "'sha256-/J843t4efXFXuHDnY1cX6ya5hrrEa+9J3aNdEDWjD9E='",
  "'sha256-1lHDK5WKGl9IecXcFM1FzYvePQRyH5GMq7bni4e5D2w='",
  "'sha256-2W1LsgZ87RpQ0Wdr942G2VyPOEBhcaUVXTj6KGeg8uI='",
  "'sha256-3vWy7p4lC9dcFBbfeyoZdVORbmky6TElAFGPPcRLJCw='",
  "'sha256-4w9mFeXXwl3/xCKXrurdisMoPnDTs4NfG3ZNVACa2/E='",
  "'sha256-5pzRZOqLssT0wEyNG4MCQVnvqcv1Dqk1Lih+qJxeNrs='",
  "'sha256-7ODNhwOqj5QpjJRVnZRreOSDxc9MXzGfAdsz9RIZHHo='",
  "'sha256-9IhJXSJSTVWg3ELF1LfkrH8fQvidpLQQSSApQatkWFw='",
  "'sha256-A+CQC/AJr613scHPiPvE+a0dl2UFo6JxpqTFKYx1N3A='",
  "'sha256-AhARQwkg9g1+0hzVmqDAe9KAbOoJRGvyjoyM8qIqrtc='",
  "'sha256-CDIaUg68giAd0chtTipS+tLVx1KrI5KDa9cLo5LLB3Q='",
  "'sha256-CErY4jzaxQujMmHkdZkSvS1CYHTGD9p9UsIsIQWQzTM='",
  "'sha256-FVRB3WX0U9UQWCcJhvzRAlBiZ38Q96KQkROnTIOkpWg='",
  "'sha256-I6sVieqgBKHMyuzRoRumfHL5hMWJ+e9d8cr3gH3rFLU='",
  "'sha256-IIov2Z69liiMcWG7v45N5JO8rFexrpodjob9zrWT5AU='",
  "'sha256-INl/CUDeRdydvThZ3xDJzXdHuknID2EJ7D/T1XAWa0Q='",
  "'sha256-KOGuxFDkjGNRFRU9R6ZJreGDfKzq7ZewBdGDaftS2cs='",
  "'sha256-KQETSIm+4JPu9n57zQrVf0fIZJWezoFOKqOr1Pcmf3w='",
  "'sha256-M8iW+ZHZlyz9aSHO9yjSowJ1MRlSPiUochZE6PnZjfw='",
  "'sha256-Ny6sxyr3QE4FAQBClE1eRuRwVjr9J8UZ8CG82iTxuUM='",
  "'sha256-PF//wVwLRIXw4VFYgzKElXExybN+XEmYYDUMd1nyvaI='",
  "'sha256-PtU6NhaQoHsusNJCK+/mRvtMZwkNFhTnOC/tEw4uz/I='",
  "'sha256-QHtK7uQSCphdmh4FjxnFQ5lWsuhgp3IL3XX/w7pnB4Y='",
  "'sha256-RC+OCNNa7m5llwA7FVNETUokFXtTjg/Z2p4y65OjwC4='",
  "'sha256-SlA7xPfCbL018o0GXyAZO9YKGISsHzxJAGl4m+0ImmI='",
  "'sha256-TKeT3NugG8JpZqR/U6rBxAU+5AbiA2jtBdBhkxapiS0='",
  "'sha256-U69KowLSFUK66aJOKvQHZdpFg8D6J3SBlU2ARDn4lLw='",
  "'sha256-WbbNDfLq9Ja7q6r5+qSG3d5r8sipLOo8W9eohqBhQT0='",
  "'sha256-apavzhniG9qQlGLIEmC28LTNyW8+KTJHts7lzI8uTcw='",
  "'sha256-bMrKTnkF19pLB/GVy+Hxaq3hgE45dYTrPi8dMCv1nbU='",
  "'sha256-hqTe6TsmtBv9BE5Kn36DKOxE9j8IaveZlUL1QH84a1E='",
  "'sha256-iarzzaMVacJn2t3y8Fr6NHDx6sPWzgT9N4JCS85tyLk='",
  "'sha256-io/OAURLis1VpL178ACIQpdEAOQDoNKvNDF6GwMGcls='",
  "'sha256-jDsEFJ+Kn3sdOvYbP8W1zoKb1TZ2rYBplRkOH62Sa/c='",
  "'sha256-l8MG9UgLYKoP2e0O14DTKEGF+AgSVTt/sl367/MsloQ='",
  "'sha256-m5f+2V6ews/xJGt68tGoi72z2KiH2S2fvQjxjRsnYu4='",
  "'sha256-oc0n9BLcoXLxW8fJcTtL99nHHNvFy7KMkG9wMGotKAo='",
  "'sha256-pBg7hJ+z9TKWjfi8t+1e1HZjtar77EkelxhbG81neHw='",
  "'sha256-qxhqkCCAz9Y8d9qr8hDr2BhnulxwPJIfwJr6gLsr8ns='",
  "'sha256-rP28puhYp8dxl5yn0IdHmC5DWCkTAqW2mvY6o8Hz+mI='",
  "'sha256-vtrABAe4+exNoG18DdRv4f7keCvULPH/FnyGpcmCcPw='",
  "'sha256-vxv9SAkrD2n9jzKUTPhZwi7F5uu1j0ijLQys/pm0680='",
  "'sha256-w0yHxNATpk1pefzsFfl0ESGfuc1tGwKpIuWDgdJyFZE='",
  "'sha256-x7moxtbMRx/tY5VuC96rhtXtYAyBR3eT3F/hfEHaGgE='",
  "'sha256-xaZUeoV4cerMWMhhKW64HCNuqnEW9GvTrkTyyuhRN9M='",
]);
const STATIC_CONTENT_SECURITY_POLICIES = Object.freeze({
  "app.agenttool.dev":
    `default-src 'self'; base-uri 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src-elem 'self' 'sha256-NL0t3dpwsKsS5rKxh9Giwc4LeF1a++CKmr8K99oPL3M=' 'sha256-Yorb9bWi57ocdq6NoZIEFBWLMN4lFrJnChP8GQPnYuY=' 'sha256-pTQz5OaQNyn6eosOcwomg0t4NUjjVDsk6TncOkCEOXU=' 'sha256-q/5VHj9oTRmu7WJOS6f8pNmiYB4pV6IsSX2luJs8hR0='; script-src-attr 'none'; style-src-elem 'self' https://fonts.googleapis.com 'sha256-077/Kofze5+HIOgjFPOtBIMBo/qnbOre2X9w+hbPbGk=' 'sha256-1vBz5BG3xQnJcgZj6THGwq+MaWWJ7gj40PQWRGUHZ/o=' 'sha256-8H3dSXualBXRiQn91rz+YCLAiHsnK4NBeL2r4S77n7o='; style-src-attr 'unsafe-inline'; connect-src 'self' https://api.agenttool.dev; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; upgrade-insecure-requests`,
  "docs.agenttool.dev":
    `${STATIC_CSP_PREFIX}; script-src-elem 'self' https://docs.agenttool.dev 'sha256-3dQoqXC34Igbr63uTJYpg77P9lU76pQMgZyiL3x0L2Q=' 'sha256-nh0Vsc/MSvpF9098o78HwNSRcKC08M5LwEnstscQY6E=' 'sha256-q9RplrPVGLHk0ZdTsraLXRunBrvHRMuKk+uy+QpNzYQ=' 'sha256-snX1SvBWJrwG1PdEByYcd4ev1fzhMn0pNorU1RBZTv0=' 'sha256-wPdkd+kbZgilNc8JaN9N5XHIZrBxsXVYmu9ZfNHIYSc='; script-src-attr 'unsafe-hashes' 'sha256-3YZsSuU/gpEOa9tQKmvC+L/OlTzeR7yawYxYJiJHpqw=' 'sha256-40NaUQGlj89bDUW+jfBVB1xWITzy/+/IMKX0TJR0PCc=' 'sha256-5upVdTTCzrq48/BCOJhHhSJqCxoqjKSFYAAlF/nUUfw=' 'sha256-7BoFpHJmr/ODzCMUuHNXAJ3SHvyDb59ilL7KEIzaY98=' 'sha256-Dh5NaP1NZiBQdkMMPiRJxRnqQ2NEw0bA9JLtslHbhHM=' 'sha256-KfsEq7utfxqNXymiVQm0Ki+J4F5SCL70nK2lP4fbako=' 'sha256-OhmiMk/qG6FnV/Iv27XVUmfB6D8oJ9IlS0HOpy13YPo=' 'sha256-SNxs30KBTjN1ORLO2owZVMnsW0THOLb5BYQIrM6AV7I=' 'sha256-dX5C5oQTOyHeOr3I7bf0NoPh59KBd7OuoQasJ43ZV9M=' 'sha256-gssMMkcEiFR2LT2+aHKP3cdADG0hPkHjUcdXiLFM9e0=' 'sha256-kpo1A4d55Ow14su5N1M/sFPUY0HqbbmSwO3KtLQp0DI=' 'sha256-n6819RwO/4hMe+kLEB3N7ODsi/oThRARkS7RJniFxhU=' 'sha256-pUnTendwAdzhlWjppGh5zVws6PVloNc0pY9rdzjYdxc=' 'sha256-zZ5bKQhF2jfcDvJzUFixIle5bO9YQordrLFa8OLNocA='; style-src-elem 'self' https://fonts.googleapis.com ${DOCS_STYLE_HASH_SOURCES.join(" ")}; style-src-attr 'unsafe-inline'; connect-src 'self' https://api.agenttool.dev; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; upgrade-insecure-requests`,
  "agenttool.dev":
    `${STATIC_CSP_PREFIX}; script-src-elem 'self' 'sha256-7LXFBMtVLiNzNUFG2zEgjuHeiXRS1XXz6U2GQNSD8JA=' 'sha256-TCyLbQHtBLjhYNu+6NperWy3KkqU1QNdxhE4qwj1Tbo=' 'sha256-UDQ13BmwnFfEsfhYQvkrSp2HEJZo1icjphxXdvskdWY=' 'sha256-WMRigj0q0qkwIesBfXajrmmPm/Y8nUocukzFvSOZufU=' 'sha256-ZA5zWI5hzhtHIuxnMabIXU42AsBIelCj1dAzXPZ53EU=' 'sha256-puwgAvgMPSN3mMoEPGgPBmw2x8DxMWE1qaJQEzKp528='; script-src-attr 'none'; style-src-elem 'self' 'sha256-KyZ5jV0GLnxfJqF99RO3haM82sN5QHQFzP1vfPysthI=' 'sha256-UQIeEGJ+debTBqPWgTq8rh8996C9/+TAStrE3rt0ofc=' 'sha256-XbqOUeV0VgtCGZjU4Xdg8muYJz+agKH1ebaEO837LJ0='; style-src-attr 'unsafe-inline'; connect-src 'self' https://api.agenttool.dev; img-src 'self' data:; font-src 'self'; upgrade-insecure-requests`,
});

/** Security headers for responses produced by Workers rather than Pages
 * assets. Cloudflare Pages `_headers` rules do not decorate these responses. */
export function generatedResponseHeaders(init) {
  const headers = new Headers(init);
  headers.set("Content-Security-Policy", GENERATED_CONTENT_SECURITY_POLICY);
  headers.set("Permissions-Policy", GENERATED_PERMISSIONS_POLICY);
  headers.set("Referrer-Policy", "no-referrer");
  // Keep parity with the estate's initial five-minute HSTS observation stage.
  // A longer age, includeSubDomains, or preload is a separate rollout.
  headers.set("Strict-Transport-Security", "max-age=300");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");
  return headers;
}

function staticAssetResponseWithSecurity(response, surface) {
  if (surface === null) return response;
  const contentSecurityPolicy =
    STATIC_CONTENT_SECURITY_POLICIES[surface.profile.serviceId];
  if (contentSecurityPolicy === undefined) return response;

  const headers = new Headers(response.headers);
  const defaults = [
    ["Content-Security-Policy", contentSecurityPolicy],
    ["Permissions-Policy", GENERATED_PERMISSIONS_POLICY],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["Strict-Transport-Security", "max-age=300"],
    ["X-Content-Type-Options", "nosniff"],
    ["X-Frame-Options", "DENY"],
    ["X-Permitted-Cross-Domain-Policies", "none"],
  ];
  let changed = false;
  for (const [name, value] of defaults) {
    if (headers.has(name)) continue;
    headers.set(name, value);
    changed = true;
  }
  if (!changed) return response;

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function isSurfaceResourcePath(pathname) {
  return (
    pathname === SURFACE_MANIFEST_PATH ||
    pathname === SURFACE_ORIENTATION_PATH
  );
}

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
    headers: generatedResponseHeaders({
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "text/plain; charset=utf-8",
      "X-AgentTool-Sensitive-Path-Fence": "1",
    }),
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
    headers: generatedResponseHeaders({
      "Cache-Control": cacheControl,
      "Content-Type": `${contentType}; charset=utf-8`,
      Vary: "Accept",
    }),
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

/**
 * Return a declared XENIA Surface response for an exact, read-only route on
 * one configured origin. Callers must apply the sensitive-path fence before
 * this helper so every edge keeps the same first routing gate.
 */
export function surfaceResponseForRequest(request, env) {
  const url = new URL(request.url);
  const surface = surfaceProfileForOrigin(url.origin, env);

  if (
    surface === null ||
    !isReadRequest(request) ||
    !isSurfaceResourcePath(url.pathname)
  ) {
    return null;
  }
  if (url.pathname === SURFACE_MANIFEST_PATH) {
    return manifestResponse(request, surface);
  }
  if (url.pathname === SURFACE_ORIENTATION_PATH) {
    return orientationResponse(request, surface);
  }
  return null;
}

/**
 * Return the bounded XENIA problem for a fresh, exact-origin machine miss.
 * Pages calls this only after ASSETS returns 404; the apex Worker calls it
 * only from its existing unknown-JSON refusal branch.
 */
export function surfaceRouteNotFoundForRequest(request, env) {
  const url = new URL(request.url);
  const surface = surfaceProfileForOrigin(url.origin, env);

  if (
    surface === null ||
    !isReadRequest(request) ||
    !requestsProblemDetails(request)
  ) {
    return null;
  }
  return routeNotFoundResponse(request, surface.origin);
}

/** Shared Pages request path with one exact, isolated profile per origin. */
export async function handlePagesRequest(request, env) {
  const url = new URL(request.url);

  // This remains the first routing gate on every Pages origin.
  if (isSensitiveRootPath(url.pathname)) {
    return sensitivePathNotFound(request);
  }

  const surfaceResponse = surfaceResponseForRequest(request, env);
  if (surfaceResponse !== null) return surfaceResponse;

  const assetResponse = await env.ASSETS.fetch(request);
  if (assetResponse.status === 404) {
    const problemResponse = surfaceRouteNotFoundForRequest(request, env);
    if (problemResponse !== null) return problemResponse;
  }

  return staticAssetResponseWithSecurity(
    assetResponse,
    surfaceProfileForOrigin(url.origin, env),
  );
}

export default {
  async fetch(request, env) {
    return handlePagesRequest(request, env);
  },
};
