import { describe, expect, test } from "bun:test";

import { clientIp, createRegistrationRateLimiter } from "../src/middleware/rate-limit-ip";
import { registrationRateLimitConfig, registrationRateLimitTimeout } from "../src/services/tools/queue/admission-config";

function request(headers: Record<string, string>): Request {
  return new Request("https://api.agenttool.dev/v1/register/agent", { headers });
}

describe("clientIp", () => {
  test("Fly's injected address wins over spoofable forwarding headers", () => {
    expect(
      clientIp(
        request({
          "fly-client-ip": "203.0.113.9",
          "cf-connecting-ip": "198.51.100.7",
          "x-forwarded-for": "192.0.2.1",
        }),
      ),
    ).toBe("203.0.113.9");
  });

  test("caller-controlled proxy headers are ignored by default", () => {
    expect(
      clientIp(
        request({
          "cf-connecting-ip": "198.51.100.7",
          "x-forwarded-for": "192.0.2.1",
          "x-real-ip": "203.0.113.8",
        }),
        { trustProxyHeaders: false },
      ),
    ).toBe("unknown");
  });

  test("an origin-locked deployment may explicitly trust proxy headers", () => {
    expect(
      clientIp(request({ "cf-connecting-ip": "198.51.100.7" }), {
        trustProxyHeaders: true,
      }),
    ).toBe("198.51.100.7");
    expect(
      clientIp(request({ "x-forwarded-for": "192.0.2.1, 10.0.0.1" }), {
        trustProxyHeaders: true,
      }),
    ).toBe("192.0.2.1");
  });

  test("invalid edge addresses cannot become Redis key material", () => {
    expect(
      clientIp(
        request({
          "fly-client-ip": "attacker:key:value",
          "cf-connecting-ip": "also-not-an-ip",
        }),
        { trustProxyHeaders: true },
      ),
    ).toBe("unknown");
  });

});

describe("independent registration admission", () => {
  const input = { key: "registration:test:fixture", limit: 5, windowSec: 3600 };
  test("default worker hold, explicit URL validation, and opt-in stay separate", () => {
    expect(registrationRateLimitConfig({ AGENTTOOL_DISABLE_WORKERS: "1" }).mode).toBe("disabled");
    expect(registrationRateLimitConfig({ AGENTTOOL_REGISTRATION_RATE_LIMIT_ENABLED: "1" }).mode).toBe("unconfigured");
    expect(registrationRateLimitConfig({ AGENTTOOL_REGISTRATION_RATE_LIMIT_ENABLED: "1", REDIS_URL: "https://invalid.test" }).mode).toBe("unconfigured");
    expect(registrationRateLimitConfig({ AGENTTOOL_DISABLE_WORKERS: "1", AGENTTOOL_REGISTRATION_RATE_LIMIT_ENABLED: "1", REDIS_URL: "redis://127.0.0.1:1/0" }).mode).toBe("independent");
    expect(registrationRateLimitTimeout({ AGENTTOOL_RATE_LIMIT_TIMEOUT_MS: "999999" })).toBe(2000);
  });
  test("absent and disconnected legacy clients fail open without connection attempts", async () => {
    expect((await createRegistrationRateLimiter(null)(input)).allowed).toBe(true);
    let attempts = 0;
    const client = { status: "wait", async connect() { attempts++; }, async eval() { attempts++; } };
    expect((await createRegistrationRateLimiter(client)(input)).allowed).toBe(true);
    expect(attempts).toBe(0);
  });
  test("concurrent requests share first connection and enforce Redis counts", async () => {
    let connects = 0, increments = 0;
    const client = {
      status: "wait",
      async connect() { connects++; await new Promise(r => setTimeout(r, 1)); client.status = "ready"; },
      async eval(script: string, numKeys: number, key: string, window: string) {
        expect(script).toContain("redis.call('INCR',KEYS[1])");
        expect(script).toContain("redis.call('EXPIRE',KEYS[1],ARGV[1])");
        expect([numKeys, key, window]).toEqual([1, input.key, "3600"]);
        return [++increments, 37];
      },
    };
    const limiter = createRegistrationRateLimiter(client, { connectOnDemand: true });
    const results = await Promise.all(Array.from({ length: 8 }, () => limiter(input)));
    expect(connects).toBe(1);
    expect(results.filter(r => r.allowed)).toHaveLength(5);
    expect(results.filter(r => !r.allowed)).toHaveLength(3);
    expect(results[7]).toMatchObject({ allowed: false, retryAfterSec: 37 });
  });
  test("connect failure is cooled down and a later request can recover", async () => {
    let now = 1000, attempts = 0;
    const client = {
      status: "end",
      async connect() { if (++attempts === 1) throw new Error("private provider failure"); client.status = "ready"; },
      async eval() { return [6, 12]; },
    };
    const limiter = createRegistrationRateLimiter(client, { connectOnDemand: true, now: () => now });
    expect((await limiter(input)).allowed).toBe(true);
    expect((await limiter(input)).allowed).toBe(true);
    expect(attempts).toBe(1);
    now += 1001;
    expect((await limiter(input)).allowed).toBe(false);
    expect(attempts).toBe(2);
  });
  test("slow commands return within the deadline without retry or late rejection", async () => {
    let calls = 0;
    const client = { status: "ready", async connect() {}, async eval() {
      calls++; await new Promise(r => setTimeout(r, 40)); throw new Error("late private error");
    } };
    const started = performance.now();
    const result = await createRegistrationRateLimiter(client, { timeoutMs: 5 })(input);
    expect(result.allowed).toBe(true);
    expect(performance.now() - started).toBeLessThan(100);
    await new Promise(r => setTimeout(r, 50));
    expect(calls).toBe(1);
  });
  test("a connection completing after the deadline does not issue a late increment", async () => {
    let increments = 0;
    const client = { status: "wait", async connect() { await new Promise(r => setTimeout(r, 25)); client.status = "ready"; }, async eval() { increments++; return [1, 10]; } };
    expect((await createRegistrationRateLimiter(client, { connectOnDemand: true, timeoutMs: 5 })(input)).allowed).toBe(true);
    await new Promise(r => setTimeout(r, 35));
    expect(increments).toBe(0);
  });
  test("malformed or unbounded Redis windows never masquerade as an enforced limit", async () => {
    for (const response of [[0, 10], [6, -1], [Infinity, 3], null, [1.1, 10]]) {
      const client = { status: "ready", async connect() {}, async eval() { return response; } };
      expect(await createRegistrationRateLimiter(client)(input)).toMatchObject({ allowed: true, remaining: 5 });
    }
  });
});
