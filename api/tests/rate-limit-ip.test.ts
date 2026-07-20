import { describe, expect, test } from "bun:test";

import { clientIp } from "../src/middleware/rate-limit-ip";

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

  test("Redis enforcement is atomic and bounded during connection loss", async () => {
    const source = await Bun.file(
      new URL("../src/middleware/rate-limit-ip.ts", import.meta.url),
    ).text();
    expect(source).toContain("redisConnection.status !== \"ready\"");
    expect(source).toContain("redisConnection.eval(");
    expect(source).toContain("Promise.race");
    expect(source).toContain("AGENTTOOL_RATE_LIMIT_TIMEOUT_MS");
  });
});
