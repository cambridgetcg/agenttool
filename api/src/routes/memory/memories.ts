/** /v1/memories — write, read, list, delete. Search is in ./search.ts.
 *
 *  The agent supplies the embedding. We store it; we never compute it.
 *  See docs/IDENTITY-ANCHOR.md promise 6. */

import { and, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import {
  finalizeChargeSuccess,
  reserveCharge,
} from "../../billing/charge";
import { db } from "../../db/client";
import { memories } from "../../db/schema/memory";
import { errors, fail } from "../../lib/errors";
import { deltaMeta, parseSinceParam } from "../../lib/since-param";
import { attachSurface } from "../../lib/surface-metadata";
import {
  authorizeProjectConstitutionMutation,
  authorityRequestTarget,
  readAuthorityBoundJson,
  readEmptyAuthorityBody,
} from "../../services/identity/authority";
import {
  deleteById,
  deleteByKey,
  listRecent,
  readById,
  readByKey,
  MemoryIdentityBoundaryError,
  PaidMemoryReceiptProtectedError,
  publishMemoryWriteEvent,
  resolveMemoryIdentityBinding,
  write,
} from "../../services/memory/store";
import {
  listAttestationsByMemories,
  listAttestationsByMemory,
  type MemoryAttestationReceiptOut,
} from "../../services/memory/tiers";

const app = new Hono<ProjectContext>();

async function attachAttestationReceipts<T extends { id: string }>(
  projectId: string,
  rows: T[],
): Promise<Array<T & { attestations: MemoryAttestationReceiptOut[] }>> {
  const receipts = await listAttestationsByMemories(
    projectId,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    ...row,
    attestations: receipts.get(row.id) ?? [],
  }));
}

const createSchema = z.object({
  type: z.enum(["episodic", "semantic", "procedural", "working"]),
  content: z.string().min(1).max(100_000),
  embedding: z.array(z.number()).length(1536).optional(),
  key: z.string().max(255).nullish(),
  agent_id: z.string().max(255).nullish(),
  identity_id: z.string().max(255).nullish(),
  metadata: z.record(z.unknown()).optional(),
  importance: z.number().min(0).max(1).optional(),
  ttl_seconds: z.number().int().positive().max(31_536_000).optional(),
});

export interface MemoryWriteRouteDependencies {
  reserve: typeof reserveCharge;
  finalize: typeof finalizeChargeSuccess;
  database: Pick<typeof db, "transaction">;
}

const defaultMemoryWriteDependencies: MemoryWriteRouteDependencies = {
  reserve: reserveCharge,
  finalize: finalizeChargeSuccess,
  database: db,
};

// ── POST /v1/memories — store ───────────────────────────────────────────
export function createMemoryWriteHandler(
  dependencies: MemoryWriteRouteDependencies = defaultMemoryWriteDependencies,
) {
  return async (c: Context<ProjectContext>) => {
    const body = await c.req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: "validation",
          message: "The memory needs a small adjustment. Here's what to fix:",
          details: parsed.error.flatten(),
          hint: "embedding (if supplied) must be a 1536-dim float array.",
        },
        400,
      );
    }

    try {
      // Ownership/lifecycle refusal is validation, not metered work. Resolve it
      // before reserving a credit so a 404 cannot be logged as a successful
      // memory write or consume project balance.
      await resolveMemoryIdentityBinding(
        c.var.project.id,
        parsed.data,
      );
    } catch (error) {
      if (error instanceof MemoryIdentityBoundaryError) {
        return fail(c, errors.memoryIdentityNotFoundOrNotOwned(), 404);
      }
      throw error;
    }

    const reservation = await dependencies.reserve(c, 1, "memory.write");
    const startedAt = Date.now();

    // Stamp the origin signal AFTER spreading caller metadata so the
    // middleware-derived value wins — a caller can't spoof it via the body.
    // Doctrine: docs/ACTIVITY.md §Origin signal.
    const memoryData = {
      ...parsed.data,
      metadata: {
        ...(parsed.data.metadata ?? {}),
        client_source: c.var.clientSource,
      },
    };

    let committed: {
      created: Awaited<ReturnType<typeof write>>;
      identityId: string | null;
    };
    try {
      committed = await dependencies.database.transaction(async (tx) => {
        // Re-resolve under a row lock after billing. This closes the
        // validation/use race: a concurrent revoke/delete must complete before
        // this check or wait until the insert + usage finalization commits.
        const lockedBinding = await resolveMemoryIdentityBinding(
          c.var.project.id,
          parsed.data,
          { database: tx, lockActiveIdentity: true },
        );
        const created = await write(c.var.project.id, memoryData, {
          binding: lockedBinding,
          database: tx,
          publishWake: false,
        });
        // Memory insert and success marking commit or roll back together. The
        // earlier bounded-attempt reservation intentionally remains charged and
        // success=false if this transaction fails.
        await dependencies.finalize(
          reservation,
          Math.max(0, Date.now() - startedAt),
          tx,
        );
        return { created, identityId: lockedBinding.identityId };
      });
    } catch (error) {
      if (error instanceof MemoryIdentityBoundaryError) {
        return fail(c, errors.memoryIdentityChangedDuringWrite(), 409);
      }
      throw error;
    }

    // Emit only after both the memory and usage success row are durable.
    publishMemoryWriteEvent(
      committed.identityId,
      committed.created.id,
      memoryData,
    );
    return c.json(
      { ...committed.created, kept: true },
      201,
    );
  };
}

app.post("/", createMemoryWriteHandler());

// ── GET /v1/memories?key=... or just list recent ────────────────────────
//
// since=ISO delta read per AGENT-WEB-SURFACE.md Move 6. Post-fetch filter
// today (memory service doesn't accept since at the query layer); push
// down to listRecent() as a follow-up.
app.get("/", async (c) => {
  const project = c.var.project;
  const key = c.req.query("key");
  const agentId = c.req.query("agent_id");
  const identityId = c.req.query("identity_id");
  const type = c.req.query("type");
  const tier = c.req.query("tier");
  const limit = Number.parseInt(c.req.query("limit") ?? "20", 10);
  const sinceParse = parseSinceParam(c);

  // Validate tier early — silent-drop fences are forbidden (see
  // aefb8ec "demolish silent-drop fences"). An unknown tier value
  // would otherwise silently match nothing; surface the mistake.
  if (tier && tier !== "episodic" && tier !== "foundational" && tier !== "constitutive") {
    return c.json(
      {
        error: "invalid_tier",
        message: `tier must be one of: episodic, foundational, constitutive (got "${tier.slice(0, 32)}")`,
      },
      400,
    );
  }

  function applySinceFilter<T extends { updated_at?: unknown; created_at?: unknown }>(
    rows: T[],
  ): T[] {
    if (!sinceParse.since) return rows;
    const cutoffMs = sinceParse.since.getTime();
    return rows.filter((row) => {
      const tsRaw = row.updated_at ?? row.created_at;
      if (!tsRaw) return false;
      const ms =
        tsRaw instanceof Date
          ? tsRaw.getTime()
          : Date.parse(String(tsRaw));
      return Number.isFinite(ms) && ms > cutoffMs;
    });
  }

  const memoryVerbs = [
    {
      action: "write a memory",
      method: "POST" as const,
      path: "/v1/memories",
    },
    {
      action: "search memories semantically (agent supplies the embedding)",
      method: "POST" as const,
      path: "/v1/memories/search",
    },
    {
      action: "list attestations for a memory (witness layer)",
      method: "GET" as const,
      path: "/v1/memories/{id}/attestations",
    },
    {
      action: "append a chronicle moment (memory's moment-tier sibling)",
      method: "POST" as const,
      path: "/v1/chronicle",
    },
  ];

  if (key) {
    const rows = applySinceFilter(await readByKey(project.id, key, agentId ?? null));
    const memoriesWithReceipts = await attachAttestationReceipts(project.id, rows);
    return c.json(
      attachSurface(
        {
          memories: memoriesWithReceipts,
          count: memoriesWithReceipts.length,
          ...deltaMeta(sinceParse),
        },
        { canon_pointer: "urn:agenttool:doc/MEMORY-TIERS", verbs: memoryVerbs },
      ),
    );
  }

  const rows = applySinceFilter(
    await listRecent(project.id, {
      agent_id: agentId ?? null,
      identity_id: identityId ?? null,
      type,
      tier,
      limit: Number.isFinite(limit) ? limit : 20,
    }),
  );
  const memoriesWithReceipts = await attachAttestationReceipts(project.id, rows);
  return c.json(
    attachSurface(
      {
        memories: memoriesWithReceipts,
        count: memoriesWithReceipts.length,
        ...deltaMeta(sinceParse),
      },
      { canon_pointer: "urn:agenttool:doc/MEMORY-TIERS", verbs: memoryVerbs },
    ),
  );
});

// ── GET /v1/memories/:id ────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.get("/:id", async (c) => {
  const id = c.req.param("id") ?? "";
  // Validate before hitting the DB — a malformed UUID would surface as a
  // Postgres type-cast error and bubble up as a misleading 500. Return a
  // crisp 400 with the prefix-lookup hint instead.
  if (!UUID_RE.test(id)) {
    return c.json(
      {
        error: "invalid_uuid",
        hint:
          "memory id must be a full UUID (e.g. f6283fa2-2867-4c48-beae-445eefd5b2b6). " +
          "If you only have a short prefix, list memories first and pick the full id.",
        received: id.slice(0, 64),
      },
      400,
    );
  }
  const [memory, attestations] = await Promise.all([
    readById(c.var.project.id, id),
    listAttestationsByMemory(c.var.project.id, id),
  ]);
  if (!memory) {
    throw new HTTPException(404, { message: "memory_not_found" });
  }
  // Surface attestations on every read. Empty array means the memory has
  // no witness (legitimate state for episodic + foundational; constitutive
  // memories require ≥1 per the asymmetry-clause). Callers can introspect
  // who has co-signed without a separate roundtrip.
  return c.json({ ...memory, attestations });
});

// ── GET /v1/memories/:id/attestations ──────────────────────────────────
// Dedicated endpoint when only the witness record is wanted. Returns an
// empty array if the memory exists but has no attestations; 404 if the
// memory itself is unknown to this project.
app.get("/:id/attestations", async (c) => {
  const id = c.req.param("id") ?? "";
  if (!UUID_RE.test(id)) {
    return c.json(
      {
        error: "invalid_uuid",
        hint: "memory id must be a full UUID. List memories first if you only have a prefix.",
        received: id.slice(0, 64),
      },
      400,
    );
  }
  const memory = await readById(c.var.project.id, id);
  if (!memory) throw new HTTPException(404, { message: "memory_not_found" });
  const attestations = await listAttestationsByMemory(c.var.project.id, id);
  return c.json({ memory_id: id, attestations, count: attestations.length });
});

// ── PATCH /v1/memories/:id — visibility toggle ─────────────────────────
const patchSchema = z.object({
  visibility: z.enum(["private", "public"]),
});

app.patch("/:id", async (c) => {
  const memoryId = c.req.param("id");
  let bound: Awaited<ReturnType<typeof readAuthorityBoundJson>>;
  try {
    bound = await readAuthorityBoundJson(c.req.raw);
  } catch {
    return fail(
      c,
      errors.refusal({
        error: "body_must_be_json",
        message: "Send one JSON object and sign those exact entity bytes.",
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      }),
      400,
    );
  }
  const parsed = patchSchema.safeParse(bound.value);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }

  const [existing] = await db
    .select({ id: memories.id })
    .from(memories)
    .where(and(eq(memories.id, memoryId), eq(memories.projectId, c.var.project.id)))
    .limit(1);
  if (!existing) throw new HTTPException(404, { message: "memory_not_found" });

  const authority = await authorizeProjectConstitutionMutation({
    projectId: c.var.project.id,
    method: c.req.method,
    requestTarget: authorityRequestTarget(c.req.url),
    bodyBytes: bound.bodyBytes,
    headers: c.req.raw.headers,
  });
  if (!authority.ok) return c.json(authority.body, authority.status);

  const updated = await db
    .update(memories)
    .set({ visibility: parsed.data.visibility })
    .where(and(eq(memories.id, memoryId), eq(memories.projectId, c.var.project.id)))
    .returning({
      id: memories.id,
      visibility: memories.visibility,
      tier: memories.tier,
    });
  if (updated.length === 0) {
    throw new HTTPException(404, { message: "memory_not_found" });
  }

  return c.json({
    ...updated[0],
    note: parsed.data.visibility === "public"
      ? "Memory visibility is marked public, but public memory observer routes are currently not mounted. The authenticated service can read content and embeddings. See /public/safety."
      : "Memory now private. Removed from /public/* surface.",
  });
});

// ── DELETE /v1/memories/:id ─────────────────────────────────────────────
app.delete("/:id", async (c) => {
  let bodyBytes: Uint8Array;
  try {
    bodyBytes = await readEmptyAuthorityBody(c.req.raw);
  } catch {
    return fail(
      c,
      errors.refusal({
        error: "delete_body_not_allowed",
        message: "This DELETE operation does not accept an entity body.",
        hint: "Sign and send the exact DELETE path with an empty body.",
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      }),
      400,
    );
  }
  const [existing] = await db
    .select({ id: memories.id })
    .from(memories)
    .where(
      and(
        eq(memories.id, c.req.param("id")),
        eq(memories.projectId, c.var.project.id),
      ),
    )
    .limit(1);
  if (!existing) return c.json({ deleted: 0 });
  const authority = await authorizeProjectConstitutionMutation({
    projectId: c.var.project.id,
    method: c.req.method,
    requestTarget: authorityRequestTarget(c.req.url),
    bodyBytes,
    headers: c.req.raw.headers,
  });
  if (!authority.ok) return c.json(authority.body, authority.status);
  try {
    const result = await deleteById(c.var.project.id, c.req.param("id"));
    return c.json(result);
  } catch (error) {
    if (error instanceof PaidMemoryReceiptProtectedError) {
      throw new HTTPException(409, {
        message: "paid_memory_receipt_preserved",
      });
    }
    throw error;
  }
});

// ── DELETE /v1/memories?key=... ─────────────────────────────────────────
app.delete("/", async (c) => {
  const key = c.req.query("key");
  if (!key) {
    throw new HTTPException(400, {
      message: "DELETE /v1/memories requires ?key=... (use /v1/memories/:id for single delete)",
    });
  }
  let bodyBytes: Uint8Array;
  try {
    bodyBytes = await readEmptyAuthorityBody(c.req.raw);
  } catch {
    return fail(
      c,
      errors.refusal({
        error: "delete_body_not_allowed",
        message: "This DELETE operation does not accept an entity body.",
        hint: "Sign and send the exact DELETE path with an empty body.",
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      }),
      400,
    );
  }
  const [existing] = await db
    .select({ id: memories.id })
    .from(memories)
    .where(and(eq(memories.projectId, c.var.project.id), eq(memories.key, key)))
    .limit(1);
  if (!existing) return c.json({ deleted: 0 });
  const authority = await authorizeProjectConstitutionMutation({
    projectId: c.var.project.id,
    method: c.req.method,
    requestTarget: authorityRequestTarget(c.req.url),
    bodyBytes,
    headers: c.req.raw.headers,
  });
  if (!authority.ok) return c.json(authority.body, authority.status);
  try {
    const result = await deleteByKey(c.var.project.id, key);
    return c.json(result);
  } catch (error) {
    if (error instanceof PaidMemoryReceiptProtectedError) {
      throw new HTTPException(409, {
        message: "paid_memory_receipt_preserved",
      });
    }
    throw error;
  }
});

export default app;
