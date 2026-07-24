import { describe, expect, test } from "bun:test";

import { resolveUpstreamHost } from "../../infra/apex-door/worker.js";

describe("apex-door upstream routing", () => {
  test("root-convention agent documents proxy to the API", () => {
    for (const path of ["/llms.txt", "/llms-full.txt", "/AGENTS.md", "/openapi.json"]) {
      expect(resolveUpstreamHost(path, "*/*")).toBe("api.agenttool.dev");
    }
  });

  test("API prefixes still proxy while ordinary human pages stay on Pages", () => {
    expect(resolveUpstreamHost("/v1/welcome", "*/*")).toBe("api.agenttool.dev");
    expect(resolveUpstreamHost("/public/safety", "text/html")).toBe(
      "api.agenttool.dev",
    );
    expect(resolveUpstreamHost("/.well-known/agent.txt", "*/*")).toBe(
      "api.agenttool.dev",
    );
    expect(resolveUpstreamHost("/watch.html", "text/html")).toBe(
      "agenttool-web.pages.dev",
    );
    expect(resolveUpstreamHost("/porch", "text/html")).toBe(
      "agenttool-web.pages.dev",
    );
  });

  test("the apex root remains content-negotiated", () => {
    expect(resolveUpstreamHost("/", "application/json")).toBe(
      "api.agenttool.dev",
    );
    expect(resolveUpstreamHost("/", "Application/JSON")).toBe(
      "api.agenttool.dev",
    );
    expect(resolveUpstreamHost("/watch", "application/json")).toBe(
      "api.agenttool.dev",
    );
    expect(resolveUpstreamHost("/porch.html", "application/json")).toBe(
      "api.agenttool.dev",
    );
    expect(resolveUpstreamHost("/", "application/json;q=0, text/html;q=1")).toBe(
      "agenttool-web.pages.dev",
    );
    expect(resolveUpstreamHost("/", "text/html,application/xhtml+xml")).toBe(
      "agenttool-web.pages.dev",
    );
  });
});
