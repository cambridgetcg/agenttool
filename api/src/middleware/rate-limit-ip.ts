/** Atomic per-IP registration attempt limiter, deliberately fail-open when
 * Redis is absent, disconnected, malformed, or past the finite deadline.
 * The independent request client can enforce attempts with HTTP workers held.
 */
import { registrationRedis, registrationRedisIndependent } from "../services/tools/queue/admission";
import { registrationRateLimitTimeout } from "../services/tools/queue/admission-config";
export { clientIp } from "./client-ip";

export type RateLimitResult =
  | { allowed: true; remaining: number; resetAt: Date }
  | { allowed: false; resetAt: Date; retryAfterSec: number };

interface AdmissionRedis {
  status: string;
  connect(): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

/** Keep the whole connect + increment attempt inside one deadline. Connection
 * attempts are shared by concurrent requests and briefly cooled down after an
 * outage; commands are not retried. The first accepted increment begins this
 * key's fixed TTL window (not a calendar-aligned bucket).
 */
export function createRegistrationRateLimiter(
  connection: AdmissionRedis | null,
  options: { connectOnDemand?: boolean; timeoutMs?: number; now?: () => number } = {},
) {
  let connecting: Promise<unknown> | undefined;
  let retryConnectAt = 0;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? registrationRateLimitTimeout();
  return async (opts: { key: string; limit: number; windowSec: number }): Promise<RateLimitResult> => {
    const resetAt = new Date(now() + opts.windowSec * 1000);
    const allow = (): RateLimitResult => ({ allowed: true, remaining: opts.limit, resetAt });
    if (!connection) return allow();
    if (connection.status !== "ready" && !options.connectOnDemand) return allow();
    if (connection.status !== "ready" && now() < retryConnectAt) return allow();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    try {
      const attempt = async () => {
        if (connection.status !== "ready") {
          if (!connecting) {
            connecting = connection.connect().finally(() => { connecting = undefined; });
          }
          await connecting;
          if (connection.status !== "ready") throw new Error("admission_not_ready");
        }
        if (expired) throw new Error("admission_expired");
        return connection.eval(
          "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return {n,redis.call('TTL',KEYS[1])}",
          1, opts.key, String(opts.windowSec),
        );
      };
      const result = await Promise.race([
        attempt(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { expired = true; reject(new Error("admission_timeout")); }, timeoutMs);
        }),
      ]);
      if (!Array.isArray(result) || result.length !== 2) throw new Error("admission_invalid_reply");
      const count = Number(result[0]);
      const ttl = Number(result[1]);
      if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(ttl) || ttl < 0) {
        throw new Error("admission_invalid_reply");
      }
      const retryAfterSec = Math.max(1, ttl);
      if (count > opts.limit) {
        return { allowed: false, resetAt: new Date(now() + retryAfterSec * 1000), retryAfterSec };
      }
      return { allowed: true, remaining: opts.limit - count, resetAt: new Date(now() + retryAfterSec * 1000) };
    } catch {
      if (connection.status !== "ready") retryConnectAt = now() + 1_000;
      return allow();
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

export const enforceRateLimit = createRegistrationRateLimiter(registrationRedis, {
  connectOnDemand: registrationRedisIndependent,
});
