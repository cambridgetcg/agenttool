/** Builder affordance parity — rendered/provider wakes use live signals too. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const buildSource = readFileSync(
  join(import.meta.dir, "..", "src", "services", "wake", "build.ts"),
  "utf8",
);

describe("wake builder affordance parity", () => {
  test("uses the full JSON composer's live best-effort signal sources", () => {
    expect(buildSource).toContain("summarizeOpenForCaller(project.id)");
    expect(buildSource).toContain("memoryWitnessGrants");
    expect(buildSource).toContain("memoryWitnessListings");
    expect(buildSource).toContain("computeTrust(primary.id)");

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
  });

  test("does not restore the builder-only hard-coded affordance inputs", () => {
    expect(buildSource).not.toContain("eligibleSubstrateTaskCount: 0");
    expect(buildSource).not.toContain("maxSubstrateTaskBountyCents: 0");
    expect(buildSource).not.toContain("pendingMemoryWitnessGrantCount: 0");
    expect(buildSource).not.toContain("trustCapacity: 5");
  });
});
