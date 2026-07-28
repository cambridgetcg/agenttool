const SENSITIVE_ROOT_PREFIXES = ["/.git", "/.env", "/.dev.vars"];
const MAX_PATH_DECODE_PASSES = 8;

function canonicalRootPath(pathname) {
  let decoded = pathname;

  for (let pass = 0; pass < MAX_PATH_DECODE_PASSES; pass += 1) {
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return null;
    }
    if (next === decoded) {
      const segments = [];
      for (const segment of decoded.replaceAll("\\", "/").split("/")) {
        if (segment === "" || segment === ".") continue;
        if (segment === "..") {
          segments.pop();
          continue;
        }
        segments.push(segment);
      }
      return `/${segments.join("/")}`;
    }
    decoded = next;
  }

  // Deeply nested encodings are not a public asset contract. Deny them rather
  // than forwarding a path that another layer could continue decoding.
  return null;
}

function isSensitiveRootPath(pathname) {
  const canonicalPath = canonicalRootPath(pathname);
  if (canonicalPath === null) return true;

  const foldedPath = canonicalPath.toLowerCase();
  return SENSITIVE_ROOT_PREFIXES.some((prefix) =>
    foldedPath.startsWith(prefix),
  );
}

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;

    if (isSensitiveRootPath(pathname)) {
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

    // Keep the original request intact for ordinary static assets. The
    // route-complete Worker is what prevents encoded aliases from reaching a
    // stale Pages asset cache before this canonical path check.
    return env.ASSETS.fetch(request);
  },
};
