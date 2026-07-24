/** Real producer-to-consumer checks for AgentTool's discovery documents.
 *
 * The server builders are parsed by the exact Telescope 0.2.1 source that
 * ships from this repository. This keeps both sides honest without changing
 * the reviewed Telescope package or its checked-in LOVE artifact.
 */

import { describe, expect, test } from "bun:test";

import { buildApiCatalog } from "../../api/src/services/discovery/api-catalog";
import { serializeDiscoveryCompass } from "../../api/src/services/discovery/compass";
import { DEFAULT_LIMITS } from "../../packages/telescope/src/constants";
import { parseApiCatalog } from "../../packages/telescope/src/parsers/api-catalog";
import { parseAgenttoolDiscovery } from "../../packages/telescope/src/parsers/discovery";

const encoder = new TextEncoder();

describe("server discovery documents round-trip through Telescope 0.2.1", () => {
  test("the serialized discovery compass satisfies the Telescope parser", () => {
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
    expect(parsed.warnings).toEqual([]);
  });

  test("the API catalog satisfies the Telescope parser", () => {
    const parsed = parseApiCatalog(
      encoder.encode(JSON.stringify(buildApiCatalog())),
      DEFAULT_LIMITS,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.code);
    expect(parsed.value.discovery_advertised).toBe(true);
    expect(parsed.value.relations).toContain("service-meta");
    expect(parsed.warnings).toEqual([]);
  });
});
