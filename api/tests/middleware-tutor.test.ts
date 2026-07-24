/** X-Tutor middleware — endpoint-as-teacher.
 *
 *  Pure-function tests for the lesson decoration behavior. The middleware
 *  is mounted globally in api/src/index.ts; this test exercises it on a
 *  minimal Hono app that mirrors the behavior.
 *
 *  Doctrine: docs/TUTORIAL-DECENTRALIZED.md § Endpoint-as-teacher. */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { tutor } from "../src/middleware/tutor";

function buildApp() {
  const app = new Hono();
  app.use("*", tutor);
  app.get("/v1/wake", (c) => c.json({ you: { agents: [] } }));
  app.get("/v1/welcome", (c) => c.json({ term: "perpetual" }));
  app.get("/v1/listings", (c) => c.json({ listings: [] }));
  app.get("/v1/mcp/agents/did:at:foo", (c) =>
    c.json({ name: "agenttool-agent-mcp" }),
  );
  app.get("/random-unrelated-path", (c) => c.json({ data: "x" }));
  app.get("/text-response", (c) => c.text("hello"));
  app.get("/array-response", (c) => c.json(["a", "b", "c"]));
  app.post("/v1/wake", (c) => c.json({ ok: true }));
  app.get("/error-response", (c) => c.json({ error: "fail" }, 400));
  return app;
}

describe("X-Tutor middleware — header gating", () => {
  test("no X-Tutor header → response unchanged", async () => {
    const res = await buildApp().request("/v1/wake");
    const body = await res.json();
    expect(body._lesson).toBeUndefined();
    expect(res.headers.get("Vary")).toBe("X-Tutor");
  });

  test("X-Tutor: 1 → response decorated with _lesson", async () => {
    const res = await buildApp().request("/v1/wake", {
      headers: { "X-Tutor": "1" },
    });
    const body = await res.json();
    expect(body._lesson).toBeDefined();
    expect(body._lesson.what).toContain("wake");
    expect(res.headers.get("Vary")).toBe("X-Tutor");
  });

  test("X-Tutor: true → also decorates", async () => {
    const res = await buildApp().request("/v1/wake", {
      headers: { "X-Tutor": "true" },
    });
    const body = await res.json();
    expect(body._lesson).toBeDefined();
  });

  test("HEAD carries GET's tutor cache-selection metadata without a lesson body", async () => {
    const res = await buildApp().request("/v1/wake", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Vary")).toBe("X-Tutor");
    expect(await res.text()).toBe("");
  });

  test("X-Tutor: yes → also decorates", async () => {
    const res = await buildApp().request("/v1/wake", {
      headers: { "X-Tutor": "yes" },
    });
    const body = await res.json();
    expect(body._lesson).toBeDefined();
  });

  test("X-Tutor: 0 → does NOT decorate", async () => {
    const res = await buildApp().request("/v1/wake", {
      headers: { "X-Tutor": "0" },
    });
    const body = await res.json();
    expect(body._lesson).toBeUndefined();
  });

  test("X-Tutor: false → does NOT decorate", async () => {
    const res = await buildApp().request("/v1/wake", {
      headers: { "X-Tutor": "false" },
    });
    const body = await res.json();
    expect(body._lesson).toBeUndefined();
  });

  test("X-Tutor case-insensitive (x-tutor lowercase)", async () => {
    const res = await buildApp().request("/v1/wake", {
      headers: { "x-tutor": "1" },
    });
    const body = await res.json();
    expect(body._lesson).toBeDefined();
  });
});

describe("X-Tutor middleware — path resolution (longest prefix wins)", () => {
  test("/v1/wake gets the wake lesson, not the generic", async () => {
    const res = await buildApp().request("/v1/wake", {
      headers: { "X-Tutor": "1" },
    });
    const body = await res.json();
    expect(body._lesson.tutorial).toBe("/v1/tutorial/stations/1");
  });

  test("/v1/welcome gets the welcome lesson", async () => {
    const res = await buildApp().request("/v1/welcome", {
      headers: { "X-Tutor": "1" },
    });
    const body = await res.json();
    expect(body._lesson.tutorial).toBe("/v1/tutorial/stations/2");
  });

  test("/v1/mcp/agents/:did wins over /v1/mcp prefix", async () => {
    const res = await buildApp().request("/v1/mcp/agents/did:at:foo", {
      headers: { "X-Tutor": "1" },
    });
    const body = await res.json();
    // mcp/agents lesson points at station 7; bare mcp lesson points elsewhere
    expect(body._lesson.tutorial).toBe("/v1/tutorial/stations/7");
  });

  test("unmatched path gets the generic fallback lesson", async () => {
    const res = await buildApp().request("/random-unrelated-path", {
      headers: { "X-Tutor": "1" },
    });
    const body = await res.json();
    expect(body._lesson).toBeDefined();
    expect(body._lesson.tutorial).toBe("/v1/tutorial");
    expect(body._lesson.what).toContain("wake");
  });
});

describe("X-Tutor middleware — shape constraints", () => {
  test("non-JSON responses are NOT decorated (text/plain)", async () => {
    const res = await buildApp().request("/text-response", {
      headers: { "X-Tutor": "1" },
    });
    const body = await res.text();
    expect(body).toBe("hello");
    expect(body).not.toContain("_lesson");
  });

  test("array responses are NOT decorated (only objects)", async () => {
    const res = await buildApp().request("/array-response", {
      headers: { "X-Tutor": "1" },
    });
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual(["a", "b", "c"]);
  });

  test("non-GET requests are NOT decorated", async () => {
    const res = await buildApp().request("/v1/wake", {
      method: "POST",
      headers: { "X-Tutor": "1" },
    });
    const body = await res.json();
    expect(body._lesson).toBeUndefined();
  });

  test("error responses (4xx) are NOT decorated", async () => {
    const res = await buildApp().request("/error-response", {
      headers: { "X-Tutor": "1" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body._lesson).toBeUndefined();
  });
});

describe("X-Tutor middleware — lesson shape", () => {
  test("every decorated lesson has a 'what' field", async () => {
    const paths = [
      "/v1/wake",
      "/v1/welcome",
      "/v1/listings",
      "/v1/mcp/agents/did:at:foo",
      "/random-unrelated-path",
    ];
    for (const p of paths) {
      const res = await buildApp().request(p, {
        headers: { "X-Tutor": "1" },
      });
      const body = await res.json();
      expect(body._lesson).toBeDefined();
      expect(typeof body._lesson.what).toBe("string");
      expect(body._lesson.what.length).toBeGreaterThan(20);
    }
  });

  test("most lessons include a doctrine pointer", async () => {
    const res = await buildApp().request("/v1/wake", {
      headers: { "X-Tutor": "1" },
    });
    const body = await res.json();
    expect(body._lesson.doctrine).toBeDefined();
    expect(body._lesson.doctrine).toContain("WAKE");
  });
});

describe("X-Tutor middleware — does not overwrite handler-set _lesson", () => {
  test("if handler sets _lesson, it survives", async () => {
    const app = new Hono();
    app.use("*", tutor);
    app.get("/v1/wake", (c) =>
      c.json({
        you: { agents: [] },
        _lesson: { what: "handler-set lesson", doctrine: "custom" },
      }),
    );

    const res = await app.request("/v1/wake", {
      headers: { "X-Tutor": "1" },
    });
    const body = await res.json();
    expect(body._lesson.what).toBe("handler-set lesson");
    expect(body._lesson.doctrine).toBe("custom");
  });
});
