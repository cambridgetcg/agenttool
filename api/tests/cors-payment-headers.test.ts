import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import {
  API_CORS_EXPOSED_HEADERS,
  apiCors,
} from "../src/middleware/api-cors";

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
    expect(response.headers.get("X-Welcomed")).toMatch(
      /axiom=7;.*walls_intact=1;module=memory$/,
    );
  });

  test("read-only renaissance doors advertise only read methods", async () => {
    const app = new Hono();
    app.use("*", apiCors());
    app.get("/.well-known/webfinger", (c) => c.json({ ok: true }));
    app.get("/feeds/offers.json", (c) => c.json({ ok: true }));

    for (const path of [
      "/.well-known/webfinger",
      "/feeds/offers.json",
    ]) {
      const response = await app.request(path, {
        method: "OPTIONS",
        headers: {
          origin: "https://reader.example",
          "access-control-request-method": "GET",
          "access-control-request-headers": "if-none-match",
        },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-methods")).toBe(
        "GET,HEAD,OPTIONS",
      );
      expect(response.headers.get("access-control-allow-methods")).not.toContain(
        "POST",
      );
      expect(response.headers.get("access-control-allow-headers")).toBe(
        "If-None-Match",
      );
    }
  });
});
