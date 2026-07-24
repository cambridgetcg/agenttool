/** Real producer-to-consumer checks for AgentTool's discovery documents.
 *
 * The server builders are parsed by the current Telescope source. This keeps
 * the invitation and its read-only observer aligned without weakening either
 * contract or following a returned road.
 */

import { describe, expect, test } from "bun:test";

import { buildApiCatalog } from "../../api/src/services/discovery/api-catalog";
import { serializeDiscoveryCompass } from "../../api/src/services/discovery/arrival";
import { DEFAULT_LIMITS } from "../../packages/telescope/src/constants";
import { parseApiCatalog } from "../../packages/telescope/src/parsers/api-catalog";
import { parseAgenttoolDiscovery } from "../../packages/telescope/src/parsers/discovery";

const encoder = new TextEncoder();

describe("server discovery documents round-trip through Telescope", () => {
  test("the canonical three-road compass satisfies the Telescope parser", () => {
    const parsed = parseAgenttoolDiscovery(
      encoder.encode(serializeDiscoveryCompass()),
      DEFAULT_LIMITS,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.code);
    expect(parsed.value.roads.map((road) => road.id)).toEqual([
      "understand",
      "inspect",
      "choose",
    ]);
    expect(parsed.value.roads.every((road) => road.exit.includes("silent"))).toBe(
      true,
    );
    expect(parsed.warnings).toEqual([]);
  });

  test("the full seven-context API catalog satisfies the Telescope parser", () => {
    const document = buildApiCatalog();
    expect(document.linkset).toHaveLength(7);
    expect(JSON.stringify(document)).toContain(
      "https://docs.agenttool.dev/tools#scrape",
    );

    const parsed = parseApiCatalog(
      encoder.encode(JSON.stringify(document)),
      DEFAULT_LIMITS,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.code);
    expect(parsed.value.discovery_advertised).toBe(true);
    expect(parsed.value.relations).toEqual([
      "item",
      "service-desc",
      "service-doc",
      "service-meta",
      "status",
    ]);
    expect(parsed.warnings).toEqual([]);
  });
});
