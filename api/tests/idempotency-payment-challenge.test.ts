/** Idempotency must not freeze a recoverable x402 challenge. */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";
import {
  containsSensitiveIdempotencyMaterial,
  idempotency,
  type IdempotencyStore,
  isCacheableIdempotencyStatus,
} from "../src/middleware/idempotency";

describe("idempotency response classification", () => {
  test("classifies cached 402 challenges as misses as well as refusing new writes", () => {
    expect(isCacheableIdempotencyStatus(402)).toBe(false);
    expect(isCacheableIdempotencyStatus(500)).toBe(false);
    expect(isCacheableIdempotencyStatus(503)).toBe(false);
  });

  test("retains existing replay behavior for completed JSON outcomes", () => {
    expect(isCacheableIdempotencyStatus(200)).toBe(true);
    expect(isCacheableIdempotencyStatus(201)).toBe(true);
    expect(isCacheableIdempotencyStatus(400)).toBe(true);
    expect(isCacheableIdempotencyStatus(409)).toBe(true);
  });

  test("refuses one-time credentials without treating public keys or ciphertext as secrets", () => {
    expect(containsSensitiveIdempotencyMaterial({
      keypair: { private_key: "base64-private" },
    })).toBe(true);
    expect(containsSensitiveIdempotencyMaterial({
      runtime: { control_token: "at_rt_once-only" },
    })).toBe(true);
    expect(containsSensitiveIdempotencyMaterial({ api_key: "at_project-key" }))
      .toBe(true);
    expect(containsSensitiveIdempotencyMaterial({ bearer: "opaque" })).toBe(true);
    expect(containsSensitiveIdempotencyMaterial({
      public_key: "base64-public",
      ciphertext: "opaque",
      nonce: "opaque",
      metadata: { seed_enrolled: false },
    })).toBe(false);
  });

  test("never stores or replays sensitive JSON and marks the response no-store", async () => {
    const entries = new Map<string, string>();
    const deleted: string[] = [];
    let setCalls = 0;
    const store: IdempotencyStore = {
      async get(key) {
        return entries.get(key) ?? null;
      },
      async del(key) {
        deleted.push(key);
        entries.delete(key);
        return 1;
      },
      async setex(key, _ttl, value) {
        setCalls += 1;
        entries.set(key, value);
        return "OK";
      },
    };
    const app = new Hono<ProjectContext>();
    app.use("*", async (c, next) => {
      c.set("project", { id: "project-1" } as any);
      await next();
    });
    app.use("*", idempotency(store));
    let handlerCalls = 0;
    app.post("/sensitive", (c) => {
      handlerCalls += 1;
      return c.json({
        keypair: {
          public_key: "public",
          private_key: `private-${handlerCalls}`,
        },
      }, 201);
    });
    app.post("/legacy", (c) => c.json({ ok: true }, 201));

    for (let index = 0; index < 2; index += 1) {
      const response = await app.request("/sensitive", {
        method: "POST",
        headers: { "Idempotency-Key": "sensitive-key" },
      });
      expect(response.status).toBe(201);
      expect(response.headers.get("X-Idempotency-Supported")).toBeNull();
      expect(response.headers.get("X-Idempotency-Skipped"))
        .toBe("sensitive-response");
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(handlerCalls).toBe(2);
    expect(setCalls).toBe(0);
    expect(entries.size).toBe(0);

    const legacyKey = "idempotency:project-1:/legacy:legacy-key";
    entries.set(legacyKey, JSON.stringify({
      status: 201,
      body: { private_key: "previously-cached-secret" },
    }));
    const legacy = await app.request("/legacy", {
      method: "POST",
      headers: { "Idempotency-Key": "legacy-key" },
    });
    expect(legacy.headers.get("Idempotent-Replay")).toBeNull();
    expect(await legacy.json()).toEqual({ ok: true });
    expect(deleted).toContain(legacyKey);
  });

  test("still stores and replays an ordinary response", async () => {
    const entries = new Map<string, string>();
    let setCalls = 0;
    const store: IdempotencyStore = {
      async get(key) {
        return entries.get(key) ?? null;
      },
      async del(key) {
        entries.delete(key);
        return 1;
      },
      async setex(key, _ttl, value) {
        setCalls += 1;
        entries.set(key, value);
        return "OK";
      },
    };
    const app = new Hono<ProjectContext>();
    app.use("*", async (c, next) => {
      c.set("project", { id: "project-1" } as any);
      await next();
    });
    app.use("*", idempotency(store));
    let handlerCalls = 0;
    app.post("/safe", (c) => {
      handlerCalls += 1;
      return c.json({ ok: true, call: handlerCalls }, 201);
    });

    const init = { method: "POST", headers: { "Idempotency-Key": "safe-key-1" } };
    const first = await app.request("/safe", init);
    expect(first.headers.get("X-Idempotency-Supported")).toBe("Idempotency-Key");
    const second = await app.request("/safe", init);
    expect(second.headers.get("Idempotent-Replay")).toBe("true");
    expect(await second.json()).toEqual({ ok: true, call: 1 });
    expect(handlerCalls).toBe(1);
    expect(setCalls).toBe(1);
  });
});
