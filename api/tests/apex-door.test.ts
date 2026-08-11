import { describe, expect, test } from "bun:test";

import { resolveGetRouteTarget } from "../../infra/apex-door/worker.js";

describe("apex-door upstream routing", () => {
  test("root-convention agent documents proxy to the API", () => {
    for (const path of [
      "/llms.txt",
      "/llms-full.txt",
      "/AGENTS.md",
      "/openapi.json",
    ]) {
      expect(resolveGetRouteTarget(path, "*/*")).toBe("api.agenttool.dev");
    }
  });

  test("API prefixes still proxy while ordinary human pages stay on Pages", () => {
    expect(resolveGetRouteTarget("/v1/welcome", "*/*")).toBe("api.agenttool.dev");
    expect(resolveGetRouteTarget("/public/safety", "text/html")).toBe(
      "api.agenttool.dev",
    );
    expect(resolveGetRouteTarget("/.well-known/agent.txt", "*/*")).toBe(
      "api.agenttool.dev",
    );
    expect(resolveGetRouteTarget("/watch.html", "text/html")).toBe(
      "agenttool-web.pages.dev",
    );
    expect(resolveGetRouteTarget("/porch", "text/html")).toBe(
      "agenttool-web.pages.dev",
    );
  });

  test("the two bounded XENIA threshold routes terminate at the apex", () => {
    expect(resolveGetRouteTarget("/.well-known/agent.json", "*/*")).toBe(
      "agenttool.dev",
    );
    expect(resolveGetRouteTarget("/public/orientation", "text/html")).toBe(
      "agenttool.dev",
    );
  });

  test("the apex root remains content-negotiated", () => {
    expect(resolveGetRouteTarget("/", "application/json")).toBe(
      "api.agenttool.dev",
    );
    expect(resolveGetRouteTarget("/", "Application/JSON")).toBe(
      "api.agenttool.dev",
    );
    expect(resolveGetRouteTarget("/watch", "application/json")).toBe(
      "api.agenttool.dev",
    );
    expect(resolveGetRouteTarget("/porch.html", "application/json")).toBe(
      "api.agenttool.dev",
    );
    expect(resolveGetRouteTarget("/", "application/json;q=0, text/html;q=1")).toBe(
      "agenttool-web.pages.dev",
    );
    expect(resolveGetRouteTarget("/", "text/html,application/xhtml+xml")).toBe(
      "agenttool-web.pages.dev",
    );
  });
});
