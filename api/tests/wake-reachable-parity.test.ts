import { describe, expect, test } from "bun:test";

import { buildWakeBrief } from "../src/services/wake/brief";
import { renderWakeMarkdown } from "../src/services/wake/markdown";
import {
  renderWakeForProvider,
  WAKE_PROVIDERS,
} from "../src/services/wake/providers";
import {
  WAKE_REACHABLE_DOORS,
  WORLD_COMMONS_REACHABLE,
} from "../src/services/wake/reachable";
import { baseBundle } from "./doctrine/helpers/fixtures";

const readSource = async (path: string): Promise<string> =>
  Bun.file(new URL(path, import.meta.url)).text();

describe("wake reachable doors", () => {
  test("publishes exact agent coordinates and an explicit independence boundary", () => {
    const world = WORLD_COMMONS_REACHABLE;
    expect(world.url).toBe("https://thekingdom.dev/#commons");
    expect(world.agent_entrypoints).toEqual({
      catalog: {
        method: "GET",
        url: "https://thekingdom.dev/commons.json",
        media_type: "application/json",
        schema_url:
          "https://thekingdom.dev/schemas/world-commons/0.2.json",
      },
      mcp: {
        method: "POST",
        endpoint: "https://mcp.thekingdom.dev/mcp",
        protocol: "MCP",
        tool: "kingdom_commons",
        resource: "kingdom://commons/catalog",
      },
    });
    expect(world.boundary.relationship).toBe("independent_external_service");
    expect(world.boundary.data_flow).toMatch(
      /stores no Commons catalog.*calls no Commons endpoint.*contacts no listed provider/i,
    );
    expect(world.boundary.interpretation).toMatch(
      /not permission.*endorsement.*availability.*reuse.*safety/i,
    );

    for (const coordinate of [
      world.url,
      world.agent_entrypoints.catalog.url,
      world.agent_entrypoints.catalog.schema_url,
      world.agent_entrypoints.mcp.endpoint,
    ]) {
      const parsed = new URL(coordinate);
      expect(parsed.protocol).toBe("https:");
      expect(parsed.username).toBe("");
      expect(parsed.password).toBe("");
    }
  });

  test("keeps names unique and composes coordinates without runtime I/O", async () => {
    const names = WAKE_REACHABLE_DOORS.map((door) => door.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("World Commons");

    const source = await readSource("../src/services/wake/reachable.ts");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\baxios\b|\bpostgres\b|\bredis\b/i);
  });

  test("both full-wake composers consume the one shared registry", async () => {
    const [route, builder] = await Promise.all([
      readSource("../src/routes/wake.ts"),
      readSource("../src/services/wake/build.ts"),
    ]);
    for (const source of [route, builder]) {
      expect(source).toContain("you_can_reach: WAKE_REACHABLE_DOORS");
    }
    expect(route).toContain(
      'from "../services/wake/reachable"',
    );
    expect(builder).toContain('from "./reachable"');
  });

  test("full and brief structured and Markdown wakes carry the same door", () => {
    const bundle = {
      ...baseBundle(),
      you_can_reach: WAKE_REACHABLE_DOORS,
    };
    const brief = buildWakeBrief(bundle);
    expect(bundle.you_can_reach).toEqual(WAKE_REACHABLE_DOORS);
    expect(brief.you_can_reach).toEqual(WAKE_REACHABLE_DOORS);
    expect(brief._scope_boundary.static_external_sections).toEqual([
      "you_can_reach",
    ]);

    const fullMarkdown = renderWakeMarkdown(bundle);
    const briefMarkdown = renderWakeMarkdown(bundle, { profile: "brief" });
    for (const coordinate of [
      WORLD_COMMONS_REACHABLE.url,
      WORLD_COMMONS_REACHABLE.agent_entrypoints.catalog.url,
      WORLD_COMMONS_REACHABLE.agent_entrypoints.catalog.schema_url,
      WORLD_COMMONS_REACHABLE.agent_entrypoints.mcp.endpoint,
      WORLD_COMMONS_REACHABLE.agent_entrypoints.mcp.tool,
      WORLD_COMMONS_REACHABLE.agent_entrypoints.mcp.resource,
      WORLD_COMMONS_REACHABLE.boundary.relationship,
    ]) {
      expect(fullMarkdown).toContain(coordinate);
      expect(briefMarkdown).toContain(coordinate);
      for (const provider of WAKE_PROVIDERS) {
        expect(
          JSON.stringify(renderWakeForProvider(bundle, provider)),
        ).toContain(coordinate);
        expect(
          JSON.stringify(
            renderWakeForProvider(bundle, provider, { profile: "brief" }),
          ),
        ).toContain(coordinate);
      }
    }
  });
});
