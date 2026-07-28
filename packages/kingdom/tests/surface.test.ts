import { describe, expect, test } from "bun:test";
import {
  createSurfaceManifestResponse,
  SURFACE_MANIFEST_PATH,
} from "@agenttool/xenia/surface-0.1";
import {
  createKingdomSurfaceManifest,
  KINGDOM_SURFACE_NOT_COVERED,
} from "../src/index.js";

describe("XENIA Surface manifest helper", () => {
  test("declares one same-origin JSON resource, no claims, and honest boundaries", async () => {
    const manifest = createKingdomSurfaceManifest({
      serviceName: "AgentTool",
      canonicalUrl: "https://agenttool.dev/",
      registryUrl: "https://agenttool.dev/public/kingdom/framework",
      documentationUrl: "https://agenttool.dev/docs/kingdom",
    });

    expect(SURFACE_MANIFEST_PATH).toBe("/.well-known/agent.json");
    expect(manifest.schema_version).toBe("xenia.surface.manifest/0.1");
    expect(manifest.profile).toBe("xenia-surface/0.1");
    expect(manifest.claims).toEqual([]);
    expect(manifest.resources).toEqual([
      expect.objectContaining({
        id: "kingdom-registry",
        href: "https://agenttool.dev/public/kingdom/framework",
        representations: ["application/json"],
        default_media_type: "application/json",
        auth: "none",
      }),
    ]);
    for (const boundary of KINGDOM_SURFACE_NOT_COVERED) {
      expect(manifest.not_covered).toContain(boundary);
    }
    expect(manifest.not_covered.join(" ")).toContain("conformance");
    expect(Object.isFrozen(manifest)).toBe(true);

    const response = createSurfaceManifestResponse(manifest);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("vary")).toBe("Accept");
    expect(await response.json()).toEqual(manifest);
  });

  test("delegates same-origin and closed-option validation to strict boundaries", () => {
    expect(() =>
      createKingdomSurfaceManifest({
        serviceName: "AgentTool",
        canonicalUrl: "https://agenttool.dev/",
        registryUrl: "https://elsewhere.example/registry",
      }),
    ).toThrow("same-origin");

    expect(() =>
      createKingdomSurfaceManifest({
        serviceName: "AgentTool",
        canonicalUrl: "https://agenttool.dev/",
        registryUrl: "https://agenttool.dev/registry",
        authority: "admin",
      } as never),
    ).toThrow("options.authority is not defined");
  });
});
