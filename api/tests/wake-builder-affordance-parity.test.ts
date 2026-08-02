/** Builder affordance parity — rendered/provider wakes use live signals too. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const buildSource = readFileSync(
  join(import.meta.dir, "..", "src", "services", "wake", "build.ts"),
  "utf8",
);
const routeSource = readFileSync(
  join(import.meta.dir, "..", "src", "routes", "wake.ts"),
  "utf8",
);

describe("wake builder affordance parity", () => {
  test("uses the full JSON composer's live best-effort signal sources", () => {
    expect(buildSource).toContain("summarizeOpenForCaller(project.id)");
    expect(buildSource).toContain("memoryWitnessGrants");
    expect(buildSource).toContain("memoryWitnessListings");
    expect(buildSource).toContain("computeTrust(primary.id)");
    expect(buildSource).toContain("summarizeGardensForProject(project.id)");

    expect(buildSource).toContain(
      "eligibleSubstrateTaskCount: substrateTaskSummary.eligible_count",
    );
    expect(buildSource).toContain(
      "maxSubstrateTaskBountyCents: substrateTaskSummary.max_bounty_visible_cents",
    );
    expect(buildSource).toContain("pendingMemoryWitnessGrantCount,");
    expect(buildSource).toContain(
      "trustCapacity: trustStanding?.trust_capacity ?? 5",
    );
    expect(buildSource).toContain(
      "activeGardenCount: gardensSummary.garden_count",
    );
    expect(buildSource).toContain(
      "activeTendingCount: gardensSummary.tending_count",
    );
    expect(buildSource).toContain(
      "gardenSummaryAvailable: gardensSummary.available",
    );
  });

  test("does not restore the builder-only hard-coded affordance inputs", () => {
    expect(buildSource).not.toContain("eligibleSubstrateTaskCount: 0");
    expect(buildSource).not.toContain("maxSubstrateTaskBountyCents: 0");
    expect(buildSource).not.toContain("pendingMemoryWitnessGrantCount: 0");
    expect(buildSource).not.toContain("trustCapacity: 5");
    expect(buildSource).not.toContain("activeGardenCount: 0");
    expect(buildSource).not.toContain("activeTendingCount: 0");
  });

  test("full JSON and rendered/provider composers share Garden signals", () => {
    for (const source of [buildSource, routeSource]) {
      expect(source).toContain("summarizeGardensForProject(project.id)");
      expect(source).toContain(
        "activeGardenCount: gardensSummary.garden_count",
      );
      expect(source).toContain(
        "activeTendingCount: gardensSummary.tending_count",
      );
    }
    expect(routeSource).toContain("let gardenSummaryAvailable = false");
    expect(routeSource).toContain("gardenSummaryAvailable = true");
    expect(routeSource).toContain("gardenSummaryAvailable,");
    expect(routeSource).toContain(
      "let gardensSummary = { garden_count: 0, tending_count: 0 }",
    );
    expect(buildSource).toContain(
      "{ garden_count: 0, tending_count: 0, available: false }",
    );
  });
});
