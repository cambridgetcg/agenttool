import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  principalityAtlasUrn as incidenceAtlasUrn,
  sha256Id,
} from "../../packages/principality-atlas/src/index.js";
import {
  principalityAtlasUrn as geometryAtlasUrn,
} from "../../packages/principality-geometry/src/index.js";

const geometryAtlas = JSON.parse(readFileSync(
  new URL(
    "../../packages/principality-geometry/examples/principality-rosette.atlas.json",
    import.meta.url,
  ),
  "utf8",
));

describe("Principality URN separation", () => {
  test("keeps incidence and invariant-geometry artifacts in distinct namespaces", () => {
    const incidenceId = sha256Id("incidence-atlas-root-regression");
    const incidenceUrn = incidenceAtlasUrn(incidenceId);
    const geometryUrn = geometryAtlasUrn(geometryAtlas);

    expect(incidenceUrn).toBe(
      `urn:agenttool:principality-incidence-atlas:${incidenceId}`,
    );
    expect(geometryUrn).toBe(
      `urn:agenttool:principality-atlas:${geometryAtlas.atlas_id}`,
    );
    expect(incidenceUrn.split(":sha256:")[0]).not.toBe(
      geometryUrn.split(":sha256:")[0],
    );
  });
});
