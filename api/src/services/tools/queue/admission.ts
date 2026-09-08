/** A bounded request-only Redis connection. It never starts a queue or worker.
 * Explicit opt-in can use the existing REDIS_URL while HTTP workers stay held.
 * No offline command queue, command replay, or automatic reconnect: a later
 * request may reconnect after the limiter's short outage cooldown.
 */
import IORedis from "ioredis";
import { redisConnection } from "./connection";
import { registrationRateLimitConfig, registrationRateLimitTimeout } from "./admission-config";

const admissionConfig = registrationRateLimitConfig();
export function createIndependentRegistrationRedis(url: string) {
  const client = new IORedis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      enableReadyCheck: true,
      maxRetriesPerRequest: 0,
      autoResendUnfulfilledCommands: false,
      retryStrategy: () => null,
      connectTimeout: registrationRateLimitTimeout(),
      commandTimeout: registrationRateLimitTimeout(),
    });
  // Errors are handled by the limiter; never print provider messages or URLs.
  client.on("error", () => {});
  return client;
}
export const registrationRedisIndependent = admissionConfig.mode === "independent";
export const registrationRedis = registrationRedisIndependent
  ? createIndependentRegistrationRedis(admissionConfig.url!)
  : admissionConfig.mode === "worker_shared" ? redisConnection : null;
