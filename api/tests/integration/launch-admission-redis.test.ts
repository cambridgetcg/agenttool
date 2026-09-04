/** Explicit real-Redis proof. Only loopback Redis DB15 is accepted, and only
 * one random fixture key is deleted; never FLUSHDB/FLUSHALL or shared data.
 * Run in its own Bun process with HTTP workers held.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { createIndependentRegistrationRedis } from "../../src/services/tools/queue/admission";
import { createRegistrationRateLimiter } from "../../src/middleware/rate-limit-ip";
import { redisConnection } from "../../src/services/tools/queue/connection";

const target = process.env.AGENTTOOL_LAUNCH_ADMISSION_TEST_REDIS_URL?.trim();
if (target) {
  const url = new URL(target);
  if (url.protocol !== "redis:" || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !url.port || url.pathname !== '/15' || url.search || url.hash || url.username || url.password ||
      process.env.AGENTTOOL_DISABLE_WORKERS !== '1') {
    throw new Error('admission test requires explicit credential-free loopback Redis DB15 and workers held');
  }
}
const clients = target ? [createIndependentRegistrationRedis(target), createIndependentRegistrationRedis(target)] : [];
const key = `agenttool-launch-admission-test:${crypto.randomUUID()}`;
const run = target ? test : test.skip;
afterAll(async () => {
  const ready = clients.find(c => c.status === 'ready');
  try { if (ready) await ready.del(key); } finally { clients.forEach(c => c.disconnect()); }
});
describe('independent admission against real Redis', () => {
  run('two independent clients share one atomic window while worker Redis stays absent', async () => {
    expect(redisConnection).toBeNull();
    expect(clients.map(c => c.status)).toEqual(['wait', 'wait']);
    const limiters = clients.map(c => createRegistrationRateLimiter(c, { connectOnDemand: true, timeoutMs: 1000 }));
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      limiters[i % 2]!({ key, limit: 5, windowSec: 1 })));
    expect(results.filter(r => r.allowed)).toHaveLength(5);
    expect(results.filter(r => !r.allowed)).toHaveLength(15);
    expect(await clients[0]!.get(key)).toBe('20');
    expect(await clients[0]!.ttl(key)).toBeGreaterThanOrEqual(0);
    await new Promise(r => setTimeout(r, 1100));
    expect(await limiters[0]!({ key, limit: 5, windowSec: 1 })).toMatchObject({ allowed: true, remaining: 4 });
    expect(redisConnection).toBeNull();
  }, 5000);
  run('a real connection failure remains bounded, fail-open, and reconnectable', async () => {
    const unavailable = createIndependentRegistrationRedis('redis://127.0.0.1:1/15');
    const limiter = createRegistrationRateLimiter(unavailable, { connectOnDemand: true, timeoutMs: 100 });
    const started = performance.now();
    try {
      expect((await limiter({ key, limit: 5, windowSec: 1 })).allowed).toBe(true);
      expect(performance.now() - started).toBeLessThan(500);
      expect(unavailable.status).toBe('end');
      expect((await limiter({ key, limit: 5, windowSec: 1 })).allowed).toBe(true);
    } finally { unavailable.disconnect(); }
    clients[0]!.disconnect();
    await new Promise(r => setTimeout(r, 10));
    const recovered = await createRegistrationRateLimiter(clients[0]!, { connectOnDemand: true, timeoutMs: 1000 })({ key, limit: 5, windowSec: 1 });
    expect(recovered).toMatchObject({ allowed: true, remaining: 3 });
  }, 5000);
});
