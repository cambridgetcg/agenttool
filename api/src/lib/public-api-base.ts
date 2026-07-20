/** Select the configured origin that generated credential-bearing helpers may
 * call. Without configuration, only a loopback request origin is accepted for
 * local development; a remote request authority is untrusted and fails closed.
 * Paths, queries, fragments, and URL credentials are discarded. */
export function safePublicApiBase(
  requestUrl: string,
  configuredBase = process.env.PUBLIC_API_BASE,
): string | null {
  try {
    const configured = configuredBase?.trim();
    const parsed = new URL(configured || new URL(requestUrl).origin);
    const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (!configured && !loopback) return null;
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
      return null;
    }
    if (parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}
