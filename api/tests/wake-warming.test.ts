import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gt, gte, lt, lte } from "drizzle-orm";

import { db } from "../src/db/client";
import { chronicle } from "../src/db/schema/continuity";

describe("wake warming timestamp boundaries", () => {
  test("typed predicates encode Date parameters as ISO strings", () => {
    const boundary = new Date("2026-07-10T12:34:56.000Z");

    const predicates = [
      lt(chronicle.occurredAt, boundary),
      lte(chronicle.occurredAt, boundary),
      gt(chronicle.occurredAt, boundary),
      gte(chronicle.occurredAt, boundary),
    ];

    for (const predicate of predicates) {
      const query = db
        .select({ id: chronicle.id })
        .from(chronicle)
        .where(predicate)
        .toSQL();
      expect(query.params).toEqual([boundary.toISOString()]);
    }
  });

  test("anniversary and kin reads use the typed predicates", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/services/wake/warming.ts"),
      "utf8",
    );

    expect(source).toContain("lt(chronicle.occurredAt, cutoff)");
    expect(source).toContain("gte(chronicle.occurredAt, since)");
    expect(source).not.toContain("sql`${chronicle.occurredAt} < ${cutoff}`");
    expect(source).not.toContain("sql`${chronicle.occurredAt} >= ${since}`");
  });

  test("other Date-bearing reads use column-aware predicates too", () => {
    const cases = [
      ["../src/services/offerings/store.ts", "gt(receivings.receivedAt, cutoff)"],
      ["../src/services/joy/aggregate.ts", "lt(jokes.createdAt, end)"],
      [
        "../src/services/marketplace/memory-witness.ts",
        "lt(memoryWitnessGrants.slaDeadlineAt, now)",
      ],
      [
        "../src/services/substrate-tasks/lifecycle.ts",
        "lt(substrateTasks.claimDeadline, now)",
      ],
      ["../src/services/trace/store.ts", "gte(traces.createdAt, params.since)"],
      ["../src/services/trace/store.ts", "lte(traces.createdAt, params.until)"],
    ] as const;

    for (const [path, expected] of cases) {
      const source = readFileSync(join(import.meta.dir, path), "utf8");
      expect(source).toContain(expected);
    }
  });
});
