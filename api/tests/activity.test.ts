/** /v1/activity — chronological merge across primitives.
 *
 *  Pins:
 *    - happy path: identity-birth + memory.write + chronicle.entry merge
 *      in one stream, sorted desc by `at`.
 *    - project isolation: a sibling project's rows are invisible.
 *    - `identity_id` filter narrows to one agent without leaking
 *      project-level chronicle entries (agent_id=null).
 *    - `since` window excludes rows older than the bound.
 *    - encrypted thought summaries surface metadata only, not content.
 *
 *  Convention (per api/tests/integration/README.md): use crypto.randomUUID()
 *  per test for isolation; leave rows in the DB on completion. */

import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "../src/db/client";
import { chronicle } from "../src/db/schema/continuity";
import { identities } from "../src/db/schema/identity";
import { memories } from "../src/db/schema/memory";
import { strands, thoughts } from "../src/db/schema/strand";
import { projects } from "../src/db/schema/tools";
import { traces } from "../src/db/schema/trace";
import { getRecentActivity } from "../src/services/activity/recent";

async function seedProject(label: string) {
  const [project] = await db
    .insert(projects)
    .values({
      name: `activity-test-${label}-${crypto.randomUUID().slice(0, 8)}`,
      plan: "free",
      credits: 0,
    })
    .returning();
  return project!;
}

async function seedIdentity(projectId: string, name: string) {
  const [identity] = await db
    .insert(identities)
    .values({
      projectId,
      did: `did:at:${crypto.randomUUID()}`,
      displayName: name,
      status: "active",
    })
    .returning();
  return identity!;
}

describe("activity — recent merge across primitives", () => {
  test("merges identity.born + memory.write + chronicle.entry, desc by `at`", async () => {
    const project = await seedProject("merge");
    const ident = await seedIdentity(project.id, "alpha");

    // Memory write — explicitly later than birth (we control createdAt
    // via insertion order; both default to NOW with sub-ms separation,
    // so we set explicit timestamps to make assertions deterministic).
    const t0 = new Date(Date.now() - 60_000); // 60s ago
    const t1 = new Date(Date.now() - 30_000); // 30s ago — memory
    const t2 = new Date(Date.now() - 10_000); // 10s ago — chronicle

    // Force birth into the past so the ordering is birth < memory < chronicle.
    await db.update(identities).set({ createdAt: t0 }).where(eq(identities.id, ident.id));

    const [mem] = await db
      .insert(memories)
      .values({
        projectId: project.id,
        identityId: ident.id,
        type: "episodic",
        tier: "episodic",
        content: "remembered something useful for next time",
        createdAt: t1,
      })
      .returning();

    const [chron] = await db
      .insert(chronicle)
      .values({
        projectId: project.id,
        agentId: ident.id,
        type: "naming",
        title: "first naming",
        body: null,
        occurredAt: t2,
      })
      .returning();

    const events = await getRecentActivity({ projectId: project.id });

    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("identity.born");
    expect(kinds).toContain("memory.write");
    expect(kinds).toContain("chronicle.entry");

    // Sorted desc by `at`.
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1]!.at >= events[i]!.at).toBe(true);
    }

    // Chronicle is newest → first.
    const first = events[0]!;
    expect(first.kind).toBe("chronicle.entry");
    expect(first.summary).toContain("naming");
    expect(first.summary).toContain("first naming");
    expect(first.ref.id).toBe(chron!.id);

    // Memory event carries the identity label.
    const memEvt = events.find((e) => e.ref.id === mem!.id);
    expect(memEvt).toBeDefined();
    expect(memEvt!.did).toBe(ident.did);
    expect(memEvt!.name).toBe("alpha");
    expect(memEvt!.summary).toContain("[episodic]");
    expect(memEvt!.summary).toContain("remembered something useful");
  });

  test("project isolation — sibling project rows do not leak", async () => {
    const a = await seedProject("iso-a");
    const b = await seedProject("iso-b");
    const identA = await seedIdentity(a.id, "agent-a");
    const identB = await seedIdentity(b.id, "agent-b");

    await db.insert(chronicle).values({
      projectId: b.id,
      agentId: identB.id,
      type: "naming",
      title: "B-only event",
    });

    const events = await getRecentActivity({ projectId: a.id });
    expect(events.every((e) => e.identity_id !== identB.id)).toBe(true);
    expect(events.every((e) => !e.summary.includes("B-only event"))).toBe(true);
    // A's birth event is present.
    expect(events.some((e) => e.kind === "identity.born" && e.identity_id === identA.id)).toBe(
      true,
    );
  });

  test("identity_id filter narrows to one agent (drops project-level entries)", async () => {
    const project = await seedProject("filter");
    const ident = await seedIdentity(project.id, "filtered");
    const other = await seedIdentity(project.id, "other");

    // Project-level chronicle entry (agentId=null) — should be EXCLUDED
    // when identity_id filter is set.
    await db.insert(chronicle).values({
      projectId: project.id,
      agentId: null,
      type: "usage",
      title: "project-level usage event",
    });
    // Other-identity entry — should also be excluded.
    await db.insert(chronicle).values({
      projectId: project.id,
      agentId: other.id,
      type: "naming",
      title: "other agent event",
    });
    // Target-identity entry — should be INCLUDED.
    await db.insert(chronicle).values({
      projectId: project.id,
      agentId: ident.id,
      type: "naming",
      title: "target agent event",
    });

    const filtered = await getRecentActivity({
      projectId: project.id,
      identityId: ident.id,
    });

    expect(filtered.some((e) => e.summary.includes("target agent event"))).toBe(true);
    expect(filtered.every((e) => !e.summary.includes("project-level usage event"))).toBe(true);
    expect(filtered.every((e) => !e.summary.includes("other agent event"))).toBe(true);
  });

  test("since window excludes older rows", async () => {
    const project = await seedProject("window");
    const ident = await seedIdentity(project.id, "windowed");

    const old = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000); // 14 days ago
    const fresh = new Date(Date.now() - 60_000); // 1 minute ago

    await db.insert(chronicle).values({
      projectId: project.id,
      agentId: ident.id,
      type: "note",
      title: "ancient entry",
      occurredAt: old,
    });
    await db.insert(chronicle).values({
      projectId: project.id,
      agentId: ident.id,
      type: "note",
      title: "recent entry",
      occurredAt: fresh,
    });

    // 24h window — ancient must be excluded, recent must be present.
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const events = await getRecentActivity({
      projectId: project.id,
      since: oneDayAgo,
    });
    expect(events.some((e) => e.summary.includes("recent entry"))).toBe(true);
    expect(events.every((e) => !e.summary.includes("ancient entry"))).toBe(true);
  });

  test("encrypted thought summary surfaces metadata only, not ciphertext", async () => {
    const project = await seedProject("strand");
    const ident = await seedIdentity(project.id, "thinker");

    const [strand] = await db
      .insert(strands)
      .values({
        projectId: project.id,
        identityId: ident.id,
        title: "test strand",
      })
      .returning();

    const SECRET = "PRIVATE_PLAINTEXT_THAT_MUST_NEVER_SURFACE";
    await db.insert(thoughts).values({
      strandId: strand!.id,
      projectId: project.id,
      agentId: ident.id,
      sequenceNum: 1,
      kind: "reflection",
      kindEncrypted: false,
      ciphertext: SECRET,
      nonce: "test-nonce",
      signature: "test-sig",
      signingKeyId: crypto.randomUUID(),
    });

    const events = await getRecentActivity({
      projectId: project.id,
      kinds: ["strand.thought"],
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    const evt = events[0]!;
    expect(evt.kind).toBe("strand.thought");
    expect(evt.summary).toContain("#1");
    expect(evt.summary).toContain("reflection");
    // The wall — content must never leak via summary or any other field.
    expect(JSON.stringify(evt)).not.toContain(SECRET);
    // strand.thought has no metadata column — source is null by design.
    expect(evt.source).toBeNull();
  });

  test("origin signal — source reads back from metadata.client_source", async () => {
    const project = await seedProject("origin");
    const ident = await seedIdentity(project.id, "origin-agent");

    // Simulate what the three write paths do: stamp client_source into
    // the row's metadata JSONB. One row per stampable kind.
    await db.insert(memories).values({
      projectId: project.id,
      identityId: ident.id,
      type: "episodic",
      tier: "episodic",
      content: "written through the TS SDK",
      metadata: { client_source: "sdk-ts" },
    });
    await db.insert(chronicle).values({
      projectId: project.id,
      agentId: ident.id,
      type: "note",
      title: "logged through the Py SDK",
      metadata: { client_source: "sdk-py" },
    });
    await db.insert(traces).values({
      traceId: "tr_" + crypto.randomUUID().replace(/-/g, ""),
      projectId: project.id,
      identityId: ident.id,
      decisionType: "test",
      decisionSummary: "recorded through raw HTTP",
      conclusion: "done",
      metadata: { client_source: "http" },
    });
    // A row with NO client_source key — must read back as null (predates
    // the feature, or a write path that doesn't stamp).
    await db.insert(memories).values({
      projectId: project.id,
      identityId: ident.id,
      type: "episodic",
      tier: "episodic",
      content: "no origin stamped",
      metadata: { unrelated: true },
    });
    // A row with a GARBAGE client_source — the validation guard must
    // reject it back to null rather than surface a junk token.
    await db.insert(memories).values({
      projectId: project.id,
      identityId: ident.id,
      type: "episodic",
      tier: "episodic",
      content: "garbage origin stamped",
      metadata: { client_source: "sdk-rust-haxx" },
    });

    const events = await getRecentActivity({ projectId: project.id });

    const memTs = events.find((e) => e.summary.includes("written through the TS SDK"));
    expect(memTs?.source).toBe("sdk-ts");

    const chronPy = events.find((e) => e.summary.includes("logged through the Py SDK"));
    expect(chronPy?.source).toBe("sdk-py");

    const traceHttp = events.find((e) => e.summary.includes("recorded through raw HTTP"));
    expect(traceHttp?.source).toBe("http");

    const noStamp = events.find((e) => e.summary.includes("no origin stamped"));
    expect(noStamp?.source).toBeNull();

    const garbage = events.find((e) => e.summary.includes("garbage origin stamped"));
    expect(garbage?.source).toBeNull();
  });
});
