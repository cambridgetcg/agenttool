/** X-Token-Cost middleware — pins the cost-disclosure discipline.
 *
 *  Doctrine: docs/AGENT-WEB-SURFACE.md (Principle 7 · Move 1).
 *
 *  Wall: urn:agenttool:wall/no-cost-without-disclosure
 *    Every non-streaming, representation-bearing response carries
 *    X-Token-Cost + X-Byte-Count headers. HEAD and 304 do not invent a zero
 *    cost for the GET representation a cache may already hold. */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import {
  BYTE_COUNT_HEADER,
  TOKEN_COST_HEADER,
  TOKEN_RATIO_BYTES_PER_TOKEN,
  bytesToTokens,
  tokenCost,
} from "../src/middleware/token-cost";

function makeApp() {
  const app = new Hono();
  app.use("*", tokenCost());
  app.get("/json", (c) => c.json({ hello: "world", n: 42 }));
  app.get("/text", (c) => c.text("a small textual body"));
  app.get("/empty", (c) => c.body(null, 204));
  app.get("/not-modified", (c) => {
    c.header("ETag", "\"known\"");
    return c.body(null, 304);
  });
  app.get("/stream", (c) => {
    c.header("content-type", "text/event-stream");
    return c.body("data: hi\n\n");
  });
  app.get("/binary", (c) => {
    c.header("content-type", "application/octet-stream");
    return c.body("binary-payload-bytes");
  });
  app.get("/error", (c) => c.json({ error: "intentional" }, 500));
  app.get("/not-modified", (c) => c.body(null, 304));
  return app;
}

describe("token-cost middleware — header presence", () => {
  test("JSON response carries X-Token-Cost + X-Byte-Count", async () => {
    const res = await makeApp().request("/json");
    expect(res.headers.get(TOKEN_COST_HEADER)).toBeTruthy();
    expect(res.headers.get(BYTE_COUNT_HEADER)).toBeTruthy();
  });

  test("text response carries the headers", async () => {
    const res = await makeApp().request("/text");
    expect(res.headers.get(TOKEN_COST_HEADER)).toBeTruthy();
    expect(res.headers.get(BYTE_COUNT_HEADER)).toBeTruthy();
  });

  test("error response (5xx) still carries the headers", async () => {
    const res = await makeApp().request("/error");
    expect(res.status).toBe(500);
    expect(res.headers.get(TOKEN_COST_HEADER)).toBeTruthy();
    expect(res.headers.get(BYTE_COUNT_HEADER)).toBeTruthy();
  });
});

describe("token-cost middleware — accuracy", () => {
  test("X-Byte-Count matches actual UTF-8 byte length", async () => {
    const res = await makeApp().request("/json");
    const body = await res.text();
    const expected = new TextEncoder().encode(body).length;
    expect(Number(res.headers.get(BYTE_COUNT_HEADER))).toBe(expected);
  });

  test("X-Token-Cost = ceil(bytes / TOKEN_RATIO_BYTES_PER_TOKEN), min 1", async () => {
    const res = await makeApp().request("/json");
    const bytes = Number(res.headers.get(BYTE_COUNT_HEADER));
    const tokens = Number(res.headers.get(TOKEN_COST_HEADER));
    expect(tokens).toBe(
      Math.max(1, Math.ceil(bytes / TOKEN_RATIO_BYTES_PER_TOKEN)),
    );
  });

  test("bytesToTokens — pure helper", () => {
    expect(bytesToTokens(0)).toBe(0);
    expect(bytesToTokens(1)).toBe(1); // floor of 0.25 → ceil to 1
    expect(bytesToTokens(4)).toBe(1);
    expect(bytesToTokens(5)).toBe(2);
    expect(bytesToTokens(400)).toBe(100);
  });
});

describe("token-cost middleware — skip rules", () => {
  test("HEAD omits cost metadata rather than describing its empty transfer body", async () => {
    const res = await makeApp().request("/json", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get(TOKEN_COST_HEADER)).toBeNull();
    expect(res.headers.get(BYTE_COUNT_HEADER)).toBeNull();
  });

  test("304 omits cost metadata rather than overwriting a cached GET cost with zero", async () => {
    const res = await makeApp().request("/not-modified");
    expect(res.status).toBe(304);
    expect(res.headers.get("ETag")).toBe("\"known\"");
    expect(res.headers.get(TOKEN_COST_HEADER)).toBeNull();
    expect(res.headers.get(BYTE_COUNT_HEADER)).toBeNull();
  });

  test("text/event-stream skipped (no fixed body at middleware return)", async () => {
    const res = await makeApp().request("/stream");
    expect(res.headers.get(TOKEN_COST_HEADER)).toBeNull();
    expect(res.headers.get(BYTE_COUNT_HEADER)).toBeNull();
  });

  test("application/octet-stream skipped (binary payload)", async () => {
    const res = await makeApp().request("/binary");
    expect(res.headers.get(TOKEN_COST_HEADER)).toBeNull();
    expect(res.headers.get(BYTE_COUNT_HEADER)).toBeNull();
  });

  test("HEAD and 304 skip misleading zero-byte representation costs", async () => {
    const head = await makeApp().request("/json", { method: "HEAD" });
    expect(head.headers.get(TOKEN_COST_HEADER)).toBeNull();
    expect(head.headers.get(BYTE_COUNT_HEADER)).toBeNull();

    const unchanged = await makeApp().request("/not-modified");
    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.get(TOKEN_COST_HEADER)).toBeNull();
    expect(unchanged.headers.get(BYTE_COUNT_HEADER)).toBeNull();
  });
});

describe("token-cost middleware — exported constants", () => {
  test("header names follow X- prefix convention", () => {
    expect(TOKEN_COST_HEADER).toBe("X-Token-Cost");
    expect(BYTE_COUNT_HEADER).toBe("X-Byte-Count");
  });

  test("ratio constant is the documented value (4 bytes/token)", () => {
    expect(TOKEN_RATIO_BYTES_PER_TOKEN).toBe(4);
  });
});
