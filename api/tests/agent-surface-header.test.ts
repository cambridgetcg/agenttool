import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  AGENT_SURFACE_HEADER,
  agentSurface,
  agentSurfaceValue,
} from "../src/middleware/agent-surface";

describe("X-Agent-Surface header", () => {
  test("names the canonical manifest for a credential-free https origin", () => {
    expect(agentSurfaceValue("https://api.agenttool.dev")).toBe(
      "https://api.agenttool.dev/.well-known/agent.json",
    );
    expect(agentSurfaceValue("https://api.agenttool.dev/some/path")).toBe(
      "https://api.agenttool.dev/.well-known/agent.json",
    );
  });

  test("refuses non-https and credentialed bases", () => {
    expect(() => agentSurfaceValue("http://api.agenttool.dev")).toThrow(
      "credential_free_https_origin",
    );
    expect(() => agentSurfaceValue("https://user:pw@api.agenttool.dev")).toThrow(
      "credential_free_https_origin",
    );
    expect(() => agentSurfaceValue("not a url")).toThrow(
      "absolute_url",
    );
  });

  test("advertises the threshold on every response, including errors", async () => {
    const app = new Hono();
    app.use("*", agentSurface("https://api.agenttool.dev"));
    app.get("/ok", (c) => c.json({ ok: true }));
    app.get("/boom", () => {
      throw new Error("boom");
    });

    const ok = await app.request("/ok");
    expect(ok.headers.get("x-agent-surface")).toBe(
      "https://api.agenttool.dev/.well-known/agent.json",
    );

    const missing = await app.request("/nowhere");
    expect(missing.status).toBe(404);
    expect(missing.headers.get(AGENT_SURFACE_HEADER)).toBe(
      "https://api.agenttool.dev/.well-known/agent.json",
    );

    const boom = await app.request("/boom");
    expect(boom.status).toBe(500);
    expect(boom.headers.get(AGENT_SURFACE_HEADER)).toBe(
      "https://api.agenttool.dev/.well-known/agent.json",
    );
  });
});
