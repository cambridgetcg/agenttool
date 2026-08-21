/** Private cache boundary for every `/v1/wake` response, including errors.
 *
 * The middleware is mounted before authentication so an auth short-circuit
 * cannot accidentally inherit a shared-cache policy. The full wake may keep
 * its private revalidation contract; all other responses default to no-store.
 */

import type { MiddlewareHandler } from "hono";

export const WAKE_PRIVATE_NO_STORE = "private, no-store";

function isPrivateNonSharedPolicy(value: string | null): boolean {
  if (!value) return false;
  const directives = new Set(
    value
      .toLowerCase()
      .split(",")
      .map((directive) => directive.trim()),
  );
  return (
    directives.has("private") &&
    !directives.has("public") &&
    ![...directives].some((directive) => directive.startsWith("s-maxage=")) &&
    (directives.has("no-store") || directives.has("no-cache"))
  );
}

export function wakePrivateCacheBoundary(): MiddlewareHandler {
  return async (c, next) => {
    c.header("Cache-Control", WAKE_PRIVATE_NO_STORE);
    await next();

    const contentType = c.res.headers.get("Content-Type")?.toLowerCase() ?? "";
    if (contentType.startsWith("text/event-stream")) {
      c.res.headers.set(
        "Cache-Control",
        `${WAKE_PRIVATE_NO_STORE}, no-transform`,
      );
      return;
    }

    // A representation may opt into private revalidation, but an error must
    // never inherit that policy. Otherwise a cache can retain stale auth,
    // validation, or availability failures from a handler that selected the
    // representation policy before discovering the error.
    if ((c.res.status < 200 || c.res.status >= 300) && c.res.status !== 304) {
      c.res.headers.set("Cache-Control", WAKE_PRIVATE_NO_STORE);
      return;
    }

    if (!isPrivateNonSharedPolicy(c.res.headers.get("Cache-Control"))) {
      c.res.headers.set("Cache-Control", WAKE_PRIVATE_NO_STORE);
    }
  };
}
