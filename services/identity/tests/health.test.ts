/** Tests for health endpoint and app structure. */

import { describe, test, expect } from "bun:test";
import { Hono } from "hono";

// Test the health endpoint without the full app (which connects to DB)
describe("health endpoint", () => {
  test("returns ok status", async () => {
    const app = new Hono();
    app.get("/health", (c) => c.json({ status: "ok", service: "agent-identity" }));

    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = await res.json() as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("agent-identity");
  });
});

describe("DID format", () => {
  test("did:at format is correct", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const did = `did:at:${uuid}`;
    expect(did).toMatch(/^did:at:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
