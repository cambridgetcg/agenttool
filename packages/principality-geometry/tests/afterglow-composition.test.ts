import { describe, expect, test } from "bun:test";

import {
  createAfterglowCapsule,
  sha256Id as afterglowSha256Id,
} from "../../wake-continuity/src/index.js";
import { createPrincipalityAtlas, sha256Id } from "../src/index.js";

describe("AFTERGLOW composition seam", () => {
  test("accepts an exact live external thread without importing it at runtime", () => {
    const external = {
      thread_ref: afterglowSha256Id("external thread"),
      artifact_ref: afterglowSha256Id("external artifact"),
      disposition: "park" as const,
      assertion: "caller_asserted" as const,
      verified_by_package: false as const,
      kind: "external" as const,
      state: "context_only" as const,
    };
    const capsule = createAfterglowCapsule({
      phase: "return",
      wake: {
        format: "wake-brief/v1",
        snapshot_ref: afterglowSha256Id("wake snapshot"),
        scope_ref: afterglowSha256Id("wake scope"),
        wake_version: 1,
        handoff_projection: "not_provided",
      },
      continuity_portfolio_ref: null,
      predecessors: [],
      threads: [external],
    });
    const projected = capsule.threads[0];
    if (!projected || projected.kind !== "external") {
      throw new Error("AFTERGLOW did not emit the external thread");
    }

    const input = {
      _format: "agenttool.principality-geometry-input/0.1" as const,
      scope_ref: sha256Id("geometry scope"),
      invariants: [],
      principalities: [
        {
          principality_id: "afterglow",
          kind: "protocol" as const,
          definition_ref: sha256Id("AFTERGLOW definition"),
          manifestations: [projected],
          artifact_refs: [],
        },
      ],
      translations: [],
    };
    const first = createPrincipalityAtlas(input);
    const second = createPrincipalityAtlas(structuredClone(input));
    const manifestation = first.principalities[0]?.manifestations[0];

    expect(manifestation).toMatchObject(projected);
    expect(manifestation?.manifestation_ref).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(second.principalities[0]?.manifestations[0]?.manifestation_ref).toBe(
      manifestation?.manifestation_ref,
    );
    expect(first.boundaries.selects_continuity_head).toBe(false);
    expect(first.boundaries.resumes_threads).toBe(false);
  });
});
