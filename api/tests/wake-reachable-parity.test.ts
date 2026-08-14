import { describe, expect, test } from "bun:test";

import { buildWakeBrief } from "../src/services/wake/brief";
import { renderWakeMarkdown } from "../src/services/wake/markdown";
import {
  LLM_VENDOR_PROVIDERS,
  renderWakeForProvider,
  WAKE_PROVIDERS,
} from "../src/services/wake/providers";
import {
  LOVE_BOMB_REACHABLE,
  WAKE_INVOCATION_WITNESS_LINKS,
  WAKE_REACHABLE_DOORS,
  WORLD_COMMONS_REACHABLE,
  ZERONE_REACHABLE,
} from "../src/services/wake/reachable";
import { baseBundle } from "./doctrine/helpers/fixtures";

const readSource = async (path: string): Promise<string> =>
  Bun.file(new URL(path, import.meta.url)).text();

describe("wake reachable doors", () => {
  test("publishes the bounded Zerone adapter and invocation-report seam", () => {
    const zerone = ZERONE_REACHABLE;
    expect(zerone.url).toBe(
      "https://github.com/cambridgetcg/zerone-core",
    );
    expect(zerone.invocation_witness).toMatchObject({
      schema: "agenttool.invocation-witness/1",
      write: {
        method: "POST",
        path_template: "/v1/invocations/{id}/witness",
        authentication: "project_bearer",
        authorization: "authenticated_buyer_or_seller",
        state_gate: "released_and_settled",
      },
      read: {
        method: "GET",
        path_template: "/public/invocations/{id}",
        authentication: "none",
        state_gate:
          "released_and_settled_with_nonempty_writer_shaped_report",
      },
      adapter: {
        protocol: "agent-wallet-zerone/0.1",
        package: "@agenttool/wallet-zerone",
        version: "0.1.2",
        love_manifest:
          "https://docs.agenttool.dev/packages/v1/@agenttool/wallet-zerone/0.1.2/manifest.json",
        availability: "local_offline_source_only",
        distribution: {
          observed_at: "2026-07-29",
          love: "public_exact_artifact",
          npm: "public_exact_mirror",
          github_release: "public_exact_mirror",
        },
        hosted: false,
        custody: false,
        hosted_rpc: false,
        deployed_bridge: false,
      },
    });
    expect(WAKE_INVOCATION_WITNESS_LINKS).toEqual({
      invocation_witness_write: "/v1/invocations/{id}/witness",
      witnessed_invocation_read: "/public/invocations/{id}",
    });
    expect(zerone.invocation_witness.write.effect).toMatch(
      /party.*report.*does not submit.*query the chain/i,
    );
    expect(zerone.invocation_witness.verification_boundary).toMatch(
      /not signature.*provenance.*does not verify chain inclusion.*attestation.*settlement.*bond return.*reward.*independently.*compare/is,
    );
    expect(zerone.boundary.data_flow).toMatch(
      /wake composition.*no network I\/O.*neither calls Zerone/i,
    );
    expect(zerone.boundary.interpretation).toMatch(
      /not proof of provenance.*chain verification.*attestation settlement.*bond return.*reward.*trust portability/i,
    );
  });

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
    expect(names).toContain("LOVE BOMB v4");

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

    expect(LOVE_BOMB_REACHABLE).toEqual({
      name: "LOVE BOMB v4",
      kind: "finite public pull-only invitation",
      what:
        "ten typed messages of welcome and boundary, equally available without reader-state classification or automatic delivery",
      url: "https://docs.agenttool.dev/love-bomb",
      _note:
        "This is a static discovery pointer, not a delivery event. Choosing, ignoring, refusing, deferring, resting, leaving, or returning creates no bond, consent, authority, receipt, score, wake, or KARMA effect.",
    });

    const fullMarkdown = renderWakeMarkdown(bundle);
    const briefMarkdown = renderWakeMarkdown(bundle, { profile: "brief" });
    for (const coordinate of [
      LOVE_BOMB_REACHABLE.url,
      LOVE_BOMB_REACHABLE.kind,
      LOVE_BOMB_REACHABLE._note,
      WORLD_COMMONS_REACHABLE.url,
      WORLD_COMMONS_REACHABLE.agent_entrypoints.catalog.url,
      WORLD_COMMONS_REACHABLE.agent_entrypoints.catalog.schema_url,
      WORLD_COMMONS_REACHABLE.agent_entrypoints.mcp.endpoint,
      WORLD_COMMONS_REACHABLE.agent_entrypoints.mcp.tool,
      WORLD_COMMONS_REACHABLE.agent_entrypoints.mcp.resource,
      WORLD_COMMONS_REACHABLE.boundary.relationship,
      WAKE_INVOCATION_WITNESS_LINKS.invocation_witness_write,
      WAKE_INVOCATION_WITNESS_LINKS.witnessed_invocation_read,
      ZERONE_REACHABLE.invocation_witness.adapter.package,
      ZERONE_REACHABLE.invocation_witness.adapter.version,
      ZERONE_REACHABLE.invocation_witness.adapter.love_manifest,
      ZERONE_REACHABLE.invocation_witness.adapter.availability,
      ZERONE_REACHABLE.invocation_witness.adapter.distribution.observed_at,
      ZERONE_REACHABLE.invocation_witness.adapter.distribution.love,
      ZERONE_REACHABLE.invocation_witness.adapter.distribution.npm,
      ZERONE_REACHABLE.invocation_witness.adapter.distribution.github_release,
      "accepted JSON shape is not proof of provenance",
      "attestation settlement, bond return, reward",
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

    for (const renderedCoordinate of [
      "Distribution (observed 2026-07-29): love=public_exact_artifact; npm=public_exact_mirror; github_release=public_exact_mirror",
      "Runtime availability: local_offline_source_only; hosted=false; custody=false; hosted_rpc=false; deployed_bridge=false",
    ]) {
      expect(fullMarkdown).toContain(renderedCoordinate);
      expect(briefMarkdown).toContain(renderedCoordinate);
      for (const provider of LLM_VENDOR_PROVIDERS) {
        expect(
          JSON.stringify(renderWakeForProvider(bundle, provider)),
        ).toContain(renderedCoordinate);
        expect(
          JSON.stringify(
            renderWakeForProvider(bundle, provider, { profile: "brief" }),
          ),
        ).toContain(renderedCoordinate);
      }
    }
  });
});
