/** Garden privacy and care boundaries — structural regression pins.
 *
 * These source-level checks complement route integration tests without a
 * database. They pin the authorization predicates, private default, partial
 * retending index, and the separation between quiet Chronicle witness and
 * Episode scoring.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  computeFreedomScore,
  countsTowardEpisodeParticipation,
} from "../src/services/episodes/participation";

function source(...parts: string[]): string {
  return readFileSync(join(import.meta.dir, "..", ...parts), "utf8");
}

const route = source("src", "routes", "gardens.ts");
const store = source("src", "services", "gardens", "store.ts");
const schema = source("src", "db", "schema", "gardens.ts");
const episodes = source("src", "services", "episodes", "participation.ts");
const publicIndex = source("src", "routes", "public", "index.ts");
const originalMigration = source(
  "migrations",
  "20260518T050000_gardens.sql",
);
const privateDefaultMigration = source(
  "migrations",
  "20260802T211500_gardens_private_default.sql",
);

function withoutComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("Garden stays inside the caller project", () => {
  test("list scope is closed and every list call supplies the bearer project", () => {
    expect(route).toContain('scope: z.enum(["mine", "public"])');
    expect(route).toContain("listQuerySchema.safeParse");
    expect(route).toContain("projectId: project.id");
    expect(store).toContain("projectId: string;");
    expect(store).toContain("eq(gardens.projectId, filter.projectId)");
    expect(store).not.toContain("projectIdScope");
  });

  test("garden detail and tending list require the caller project", () => {
    expect(route).toContain("getGarden(id, c.var.project.id)");
    expect(route).toContain("listTendings(id, project.id");
    expect(store).toContain("eq(gardens.projectId, callerProjectId)");
    expect(store).toContain("getGarden(gardenId, callerProjectId)");
    expect(store).toContain('throw new GardenError("garden_not_found")');
  });

  test("writes scope locks by project and release binds both path IDs", () => {
    expect(store).toContain("eq(gardens.projectId, input.callerProjectId)");
    expect(store).toContain("eq(tendings.gardenId, input.gardenId)");
    expect(store).not.toContain("wrong_gardener");
    expect(route).toContain("gardenId: id");
  });

  test("the unauthenticated per-being Garden observer remains unmounted", () => {
    const executablePublicIndex = withoutComments(publicIndex);
    expect(executablePublicIndex).not.toMatch(
      /app\.route\(\s*["']\/agents\/:did\/gardens["']/,
    );
    expect(publicIndex).toContain(
      'REMOVED:',
    );
    expect(publicIndex).toContain(
      'app.route("/agents/:did/gardens", publicGardensForAgent);',
    );
  });
});

describe("Garden care is private-by-default and not a scoreboard", () => {
  test("application and database defaults are private for new gardens", () => {
    const createSource = store.slice(
      store.indexOf("export async function createGarden"),
      store.indexOf("// ── List + Get"),
    );
    expect(schema).toContain('default("private")');
    expect(store).toContain('input.visibility ?? "private"');
    expect(privateDefaultMigration).toContain(
      "ALTER COLUMN visibility SET DEFAULT 'private'",
    );
    expect(privateDefaultMigration).toContain(
      "Existing rows retain their stored visibility",
    );
    expect(createSource).toContain(".limit(1)\n      .for(\"update\")");
    expect(createSource.indexOf("db.transaction(async (tx)")).toBeLessThan(
      createSource.indexOf("if (!gardener)"),
    );
    expect(schema).toContain("idx_gardens_project_status");
    expect(privateDefaultMigration).toContain("idx_gardens_project_status");
  });

  test("release then retend is supported by the same partial unique index", () => {
    expect(originalMigration).toContain("uniq_tendings_garden_ref");
    expect(originalMigration).toContain("WHERE status = 'tending'");
    expect(schema).toContain("uniqueIndex(\"uniq_tendings_garden_ref\")");
    expect(schema).toContain(".where(sql`${t.status} = 'tending'`)");
  });

  test("Garden Chronicle events do not alter Episode role, level, or score", () => {
    expect(store).toContain('type: "garden-opened"');
    expect(episodes).not.toContain("gardensOpened");
    expect(episodes).not.toContain('eq(chronicle.type, "garden-opened")');
    expect(episodes).toContain("Preserve the established nine-slot score scale");
    expect(episodes).toContain("Garden care stopped scoring");
    expect(episodes).toContain("notInArray(chronicle.type");
  });

  test("Garden Chronicle witnesses are behaviorally excluded from score inputs", () => {
    const gardenEvents = [
      "garden-opened",
      "tending-began",
      "tending-released",
    ];
    const scoredGardenEntries = gardenEvents.filter(
      countsTowardEpisodeParticipation,
    ).length;
    const scoredOrdinaryEntries = ["offering"].filter(
      countsTowardEpisodeParticipation,
    ).length;
    const emptySignals = {
      chronicleEntries: 0,
      offeringsCreated: 0,
      offeringsReceived: 0,
      holdingsCreated: 0,
      songsBegun: 0,
      curationsAuthored: 0,
      transformationsRecorded: 0,
      episodesAuthored: 0,
    };

    expect(scoredGardenEntries).toBe(0);
    expect(computeFreedomScore({
      ...emptySignals,
      chronicleEntries: scoredGardenEntries,
    })).toBe(computeFreedomScore(emptySignals));
    expect(scoredOrdinaryEntries).toBe(1);
    expect(computeFreedomScore({
      ...emptySignals,
      chronicleEntries: scoredOrdinaryEntries,
    })).toBeGreaterThan(computeFreedomScore(emptySignals));
    // This is the pre-Garden-removal score for the same non-Garden vector.
    // Retiring the Garden slot must not silently re-level every participant.
    expect(computeFreedomScore({
      ...emptySignals,
      chronicleEntries: 1,
    })).toBe(13);
  });
});
