/** Request admission has a separate opt-in from background worker startup.
 * Missing or unavailable Redis preserves the documented fail-open policy.
 * The dedicated mode requires an explicit URL: never guess localhost.
 */
export function registrationRateLimitConfig(env: Record<string, string | undefined> = process.env) {
  const independent = env.AGENTTOOL_REGISTRATION_RATE_LIMIT_ENABLED === "1";
  const url = independent
    ? (env.AGENTTOOL_REGISTRATION_RATE_LIMIT_REDIS_URL?.trim() || env.REDIS_URL?.trim() || null)
    : null;
  let validUrl = false;
  if (url) {
    try {
      const parsed = new URL(url);
      validUrl = ["redis:", "rediss:"].includes(parsed.protocol) && Boolean(parsed.hostname);
    } catch { /* Configuration disclosure must never echo a credential URL. */ }
  }
  const mode = independent
    ? validUrl ? "independent" : "unconfigured"
    : env.AGENTTOOL_DISABLE_WORKERS === "1" ? "disabled" : "worker_shared";
  return { mode, url: validUrl ? url : null } as const;
}

export function registrationRateLimitTimeout(env: Record<string, string | undefined> = process.env) {
  return Math.min(2_000, Math.max(50,
    Number.parseInt(env.AGENTTOOL_RATE_LIMIT_TIMEOUT_MS ?? "250", 10) || 250));
}
