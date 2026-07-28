const SENSITIVE_ROOT_PREFIXES = ["/.git", "/.env", "/.dev.vars"];
const MAX_PATH_DECODE_PASSES = 8;

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

function isSensitiveRootPath(pathname) {
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

    // Keep the original request intact for allowed dot-root and percent-led
    // assets, including the public /.well-known tree.
    return env.ASSETS.fetch(request);
  },
};
