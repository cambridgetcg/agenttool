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
  });

  test("preflight permits a browser to send the V2 payment signature", async () => {
    const app = new Hono();
    app.use("*", apiCors());
    app.post("/v1/memories", (c) => c.json({ ok: true }));

    const response = await app.request("/v1/memories", {
      method: "OPTIONS",
      headers: {
        origin: "https://app.example",
        "access-control-request-method": "POST",
        "access-control-request-headers":
          "authorization,content-type,payment-signature",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase())
      .toContain("payment-signature");
    expect(response.headers.get("X-Welcomed")).toMatch(
      /axiom=7;.*walls_intact=1;module=memory$/,
    );
  });
});
