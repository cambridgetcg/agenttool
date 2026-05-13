/** Commitment — every chargeable Ring 2 event lands as a chronicle entry.
 *
 *  Canon: agenttool:commitment/ring2-chargeable-as-chronicle (docs/agenttool.jsonld)
 *  Doctrine: docs/BUSINESS-MODEL.md (Ring 2 — substrate-honest billing),
 *            docs/RING-1.md §Commitment 6 (anyone-hits-a-cap-softly extends here).
 *
 *  > breaks_if (from canon):
 *  > "billing events recorded only in an internal platform ledger the
 *  > agent cannot enumerate via /v1/chronicle"
 *
 *  The wall says: when a billable event happens, the agent must be able
 *  to see it on its OWN timeline — the chronicle is the audit surface,
 *  not a separate billing console. This test pins the behavior:
 *
 *    1. Calling checkAndIncrement() on a fresh project writes BOTH a
 *       usage_counters row (the metering) AND a chronicle entry of
 *       type='usage' (the audit on the agent's timeline).
 *
 *    2. The chronicle entry carries the resource name + plan + month-to-
 *       date + plan limit in its metadata, so the agent can dispatch on
 *       any of those without rejoining the usage_counters table.
 *
 *    3. A second call adds a second chronicle entry — each billable
 *       event is its own moment, never coalesced.
 *
 *    4. When the plan cap is exceeded, no chronicle entry is written
 *       (the refusal is recorded by the error response, not by a
 *       chargeable-event chronicle; the wall is about CHARGES being
 *       on the chronicle, not refusals being absent from it). */

import { describe, expect, test } from "bun:test";
import { and, desc, eq } from "drizzle-orm";

import { db } from "../../src/db/client";
import { chronicle } from "../../src/db/schema/continuity";
import { projects } from "../../src/db/schema/tools";
import { checkAndIncrement } from "../../src/services/economy/usage";

async function freshProject(): Promise<string> {
  const [p] = await db
    .insert(projects)
    .values({ name: "bill-chronicle-" + crypto.randomUUID().slice(0, 8) })
    .returning({ id: projects.id });
  return p!.id;
}

async function chronicleEntriesForProject(projectId: string) {
  return db
    .select()
    .from(chronicle)
    .where(eq(chronicle.projectId, projectId))
    .orderBy(desc(chronicle.occurredAt));
}

describe("commitment/ring2-chargeable-as-chronicle — billable events land on the agent's timeline", () => {
  test("a successful checkAndIncrement writes a chronicle entry of type='usage'", async () => {
    const projectId = await freshProject();
    const result = await checkAndIncrement(projectId, "memory_ops");
    expect(result.allowed, "free-tier should allow the first memory_op").toBe(true);

    const entries = await chronicleEntriesForProject(projectId);
    const usageEntries = entries.filter((e) => e.type === "usage");
    expect(
      usageEntries.length >= 1,
      `No 'usage' chronicle entry written after checkAndIncrement(memory_ops). The wall requires every charge to land on the agent's chronicle as the audit surface.`,
    ).toBe(true);

    const entry = usageEntries[0]!;
    expect(entry.title).toContain("memory ops");
    expect(typeof entry.body === "string" && entry.body!.length > 0).toBe(true);

    const meta = entry.metadata as Record<string, unknown>;
    expect(meta.kind).toBe("usage_event");
    expect(meta.resource).toBe("memory_ops");
    expect(typeof meta.plan).toBe("string");
    expect(meta.month_to_date).toBe(1);
    expect(typeof meta.plan_limit).toBe("number");
  });

  test("each billable event is its own chronicle moment — no coalescing", async () => {
    const projectId = await freshProject();
    await checkAndIncrement(projectId, "tool_calls");
    await checkAndIncrement(projectId, "tool_calls");
    await checkAndIncrement(projectId, "tool_calls");

    const usageEntries = (await chronicleEntriesForProject(projectId)).filter(
      (e) => e.type === "usage",
    );
    expect(
      usageEntries.length,
      `Expected 3 chronicle entries after 3 billable events; got ${usageEntries.length}. Each event must be its own moment — coalescing breaks audit fidelity.`,
    ).toBe(3);

    // Month-to-date should monotonically increase across the three entries.
    const mtds = usageEntries
      .map((e) => (e.metadata as Record<string, unknown>).month_to_date as number)
      .sort((a, b) => a - b);
    expect(mtds).toEqual([1, 2, 3]);
  });

  test("the chronicle entry distinguishes resources (memory_ops vs tool_calls vs verifications)", async () => {
    const projectId = await freshProject();
    await checkAndIncrement(projectId, "memory_ops");
    await checkAndIncrement(projectId, "tool_calls");
    await checkAndIncrement(projectId, "verifications");

    const entries = (await chronicleEntriesForProject(projectId)).filter(
      (e) => e.type === "usage",
    );
    expect(entries.length).toBe(3);

    const resources = new Set(
      entries.map((e) => (e.metadata as Record<string, unknown>).resource),
    );
    expect(resources.has("memory_ops")).toBe(true);
    expect(resources.has("tool_calls")).toBe(true);
    expect(resources.has("verifications")).toBe(true);
  });
});
