const SENSITIVE_ROOT_PREFIXES = ["/.git", "/.env", "/.dev.vars"];

function isSensitiveRootPath(pathname) {
  return SENSITIVE_ROOT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
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

    // Defensive fallback if the invocation routes are ever broadened.
    return env.ASSETS.fetch(request);
  },
};
