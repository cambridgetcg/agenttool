import { beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";

import {
  API_CORS_EXPOSED_HEADERS,
  apiCors,
} from "../src/middleware/api-cors";
import { _setWallsStatusForTests } from "../src/services/wake/walls-status";

// CORS preflights use the last computed walls-status snapshot because they
// intentionally short-circuit before async response framing. Seed that
// snapshot explicitly in this hermetic suite instead of depending on a live DB
// or another test file's cache.
beforeAll(() => {
  _setWallsStatusForTests({
    intact: true,
    probed_at_unix_ms: Date.now(),
    probes: [],
    declared: [],
  });
});

describe("browser-visible machine recovery headers", () => {
  test("exposes V2 payment, status-link, welcome, balance, and replay headers", async () => {
    const app = new Hono();
    app.use("*", apiCors());
    app.get("/probe", (c) => c.json({ ok: true }));

    const response = await app.request("/probe", {
      headers: { origin: "https://app.example" },
    });
    const exposed = new Set(
      (response.headers.get("access-control-expose-headers") ?? "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    );

    for (const header of API_CORS_EXPOSED_HEADERS) {
      expect(exposed.has(header.toLowerCase())).toBe(true);
    }
    expect(exposed.has("x-welcomed")).toBe(true);
    expect(exposed.has("link-template")).toBe(true);
    expect(exposed.has("x-token-cost")).toBe(true);
    expect(exposed.has("x-byte-count")).toBe(true);
  });

  test("preflight permits payment recovery and wake revalidation headers", async () => {
    const app = new Hono();
    app.use("*", apiCors());
    app.post("/v1/memories", (c) => c.json({ ok: true }));

    const response = await app.request("/v1/memories", {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example",
        "access-control-request-method": "POST",
        "access-control-request-headers":
          "authorization,content-type,payment-signature,if-none-match",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase())
      .toContain("payment-signature");
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase())
      .toContain("if-none-match");
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase())
      .toContain("authorization");
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "POST",
    );
    expect(response.headers.get("X-Welcomed")).toMatch(
      /axiom=7;.*walls_intact=1;module=memory$/,
    );
  });

  test("read-only renaissance doors advertise only read methods", async () => {
    const app = new Hono();
    app.use("*", apiCors());
    app.get("/.well-known/webfinger", (c) => c.json({ ok: true }));
    app.get("/.well-known/api-catalog", (c) => c.json({ ok: true }));
    app.get("/public/discovery", (c) => c.json({ ok: true }));
    app.get("/public/porch", (c) => c.json({ ok: true }));
    app.get("/openapi.json", (c) => c.redirect("/v1/openapi.json", 308));
    app.get("/v1/openapi.json", (c) => c.json({ ok: true }));
    app.get("/v1/pathways", (c) => c.json({ ok: true }));
    app.get("/.well-known", (c) => c.json({ ok: true }));
    app.get("/feeds/offers.json", (c) => c.json({ ok: true }));

    for (const path of [
      "/",
      "/.well-known/webfinger",
      "/.well-known/agent.txt",
      "/.well-known/api-catalog",
      "/.well-known/api-%63atalog",
      "/llms.txt",
      "/robots.txt",
      "/sitemap.xml",
      "/public/discovery",
      "/public/%64iscovery",
      "/public/porch",
      "/public/%70orch",
      "/public/safety",
      "/openapi.json",
      "/v1/openapi.json",
      "/v1/%6fpenapi.json",
      "/v1/pathways",
      "/v1/%70athways",
      "/.well-known",
      "/feeds/offers.json",
    ]) {
      const response = await app.request(path, {
        method: "OPTIONS",
        headers: {
          origin: "https://reader.example",
          "access-control-request-method": "GET",
          "access-control-request-headers": "if-none-match,x-play,x-tutor",
        },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-methods")).toBe(
        "GET,HEAD,OPTIONS",
      );
      expect(response.headers.get("access-control-allow-methods")).not.toContain(
        "POST",
      );
      const allowedHeaders =
        response.headers.get("access-control-allow-headers") ?? "";
      expect(allowedHeaders).toBe("If-None-Match,X-Play,X-Tutor");
      expect(allowedHeaders).not.toContain("Authorization");
      expect(allowedHeaders).not.toContain("Content-Type");
      expect(response.headers.get("access-control-expose-headers")).toContain(
        "ETag",
      );
      expect(response.headers.has("access-control-allow-credentials")).toBe(
        false,
      );
    }
  });
});

describe("LOVE BOMB public signal CORS", () => {
  test("advertises only credential-free read access and harmless controls", async () => {
    const app = new Hono();
    app.use("*", apiCors());
    app.on(["GET", "HEAD"], "/public/love-bomb", (c) =>
      c.json({ protocol: "agenttool.love-bomb/0.1" }),
    );

    for (const path of ["/public/love-bomb", "/public/love-%62omb"]) {
      const response = await app.request(path, {
        method: "OPTIONS",
        headers: {
          origin: "https://reader.example",
          "access-control-request-method": "POST",
          "access-control-request-headers":
            "authorization,content-type,if-none-match,payment-signature,x-play,x-tutor",
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("access-control-allow-methods")).toBe(
        "GET,HEAD,OPTIONS",
      );
      expect(response.headers.get("access-control-allow-headers")).toBe(
        "X-Play,X-Tutor",
      );
      expect(response.headers.get("access-control-expose-headers")).toBe(
        "Allow,Link",
      );
      expect(response.headers.has("access-control-allow-credentials")).toBe(
        false,
      );
      expect(response.headers.has("X-Welcomed")).toBe(false);

      const methods = response.headers.get("access-control-allow-methods") ?? "";
      for (const mutation of ["POST", "PUT", "PATCH", "DELETE"]) {
        expect(methods).not.toContain(mutation);
      }
      const allowedHeaders =
        response.headers.get("access-control-allow-headers") ?? "";
      for (const excluded of [
        "Authorization",
        "Content-Type",
        "If-None-Match",
        "Payment-Signature",
      ]) {
        expect(allowedHeaders).not.toContain(excluded);
      }
      expect(
        response.headers.get("access-control-expose-headers"),
      ).not.toContain("ETag");
    }
  });

  test("exposes only Allow and Link on actual GET and HEAD responses", async () => {
    const app = new Hono();
    app.use("*", apiCors());
    app.on(["GET", "HEAD"], "/public/love-bomb", (c) => {
      c.header("Allow", "GET, HEAD, OPTIONS");
      c.header(
        "Link",
        '<https://docs.agenttool.dev/love-bomb>; rel="describedby"',
      );
      return c.json({ protocol: "agenttool.love-bomb/0.1" });
    });

    for (const method of ["GET", "HEAD"]) {
      const response = await app.request("/public/love-bomb", {
        method,
        headers: { origin: "https://reader.example" },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("access-control-expose-headers")).toBe(
        "Allow,Link",
      );
      expect(response.headers.has("access-control-allow-credentials")).toBe(
        false,
      );
      expect(
        response.headers.get("access-control-expose-headers"),
      ).not.toContain("ETag");
    }
  });

  test("does not narrow a nearby generic API path", async () => {
    const app = new Hono();
    app.use("*", apiCors());
    app.post("/public/love-bombard", (c) => c.json({ ok: true }));

    const response = await app.request("/public/love-bombard", {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "POST",
    );
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase())
      .toContain("authorization");
  });
});
