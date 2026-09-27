/** Explicit, bounded hosted memory selection. Doctrine: docs/IDENTITY-PARTITIONS.md.
 * This is a project-bearer read projection, not an attenuated credential or
 * proof that the caller controls the selected identity. No Wake composition.
 */
import { createHash } from "node:crypto";

import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { memories } from "../../db/schema/memory";
import { requireActiveProjectIdentity } from "./partition";

export const LOCAL_CONTEXT_BOUNDS = Object.freeze({
  max_items: 8,
  max_candidates: 32,
  max_record_bytes: 4096,
  max_content_bytes: 8192,
  max_response_bytes: 32768,
});

export interface LocalContextCandidate {
  id: string;
  content: string | null;
  contentBytes: number;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface LocalContextRecord {
  id: string;
  created_at: string;
  expires_at: string | null;
  content_bytes: number;
  sha256: string;
  content: string;
}

type OmissionReason = "record_too_large" | "invalid_content" | "content_budget" | "item_limit";

/** Pure packing boundary. Input is the bounded, partitioned database window. */
export function packLocalContext(
  projectId: string,
  identityId: string,
  candidates: LocalContextCandidate[],
  now: Date,
) {
  const records: LocalContextRecord[] = [];
  const omissions: Array<{ id: string; reason: OmissionReason }> = [];
  let used = 0;
  for (const row of candidates.slice(0, LOCAL_CONTEXT_BOUNDS.max_candidates)) {
    let reason: OmissionReason | undefined;
    if (row.contentBytes > LOCAL_CONTEXT_BOUNDS.max_record_bytes) reason = "record_too_large";
    else if (typeof row.content !== "string" || !row.content.isWellFormed()
      || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(row.content)
      || Buffer.byteLength(row.content, "utf8") !== row.contentBytes) reason = "invalid_content";
    else if (records.length === LOCAL_CONTEXT_BOUNDS.max_items) reason = "item_limit";
    else if (used + row.contentBytes > LOCAL_CONTEXT_BOUNDS.max_content_bytes) reason = "content_budget";
    if (reason) { omissions.push({ id: row.id, reason }); continue; }
    const content = row.content!;
    records.push({
      id: row.id,
      created_at: row.createdAt.toISOString(),
      expires_at: row.expiresAt?.toISOString() ?? null,
      content_bytes: row.contentBytes,
      sha256: createHash("sha256").update(content, "utf8").digest("hex"),
      content,
    });
    used += row.contentBytes;
  }
  const result = {
    format: "agenttool-local-api-context/v1" as const,
    project_id: projectId,
    identity_id: identityId,
    generated_at: now.toISOString(),
    scope: {
      authentication: "project_bearer" as const,
      selection: "identity_partition" as const,
      identity_proven: false,
      bearer_attenuated: false,
      project_shared_included: false,
    },
    bounds: LOCAL_CONTEXT_BOUNDS,
    used_content_bytes: used,
    records,
    omissions,
    has_more: candidates.length > LOCAL_CONTEXT_BOUNDS.max_candidates,
  };
  // Quotes, backslashes and allowed whitespace can expand during JSON encoding.
  // Keep this separate from the content budget even though fixed bounds leave room.
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > LOCAL_CONTEXT_BOUNDS.max_response_bytes) {
    throw new Error("local_context_response_too_large");
  }
  return result;
}

export async function readLocalContext(
  projectId: string,
  identityId: string,
  options: { database?: Pick<typeof db, "transaction">; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("local_context_invalid_time");
  return (options.database ?? db).transaction(async (tx) => {
    const subject = await requireActiveProjectIdentity(projectId, identityId, { database: tx });
    const rows = await tx.select({
      id: memories.id,
      // Do not transfer large memory bodies out of PostgreSQL merely to omit them.
      content: sql<string | null>`CASE WHEN octet_length(${memories.content}) <= ${LOCAL_CONTEXT_BOUNDS.max_record_bytes} THEN ${memories.content} ELSE NULL END`,
      contentBytes: sql<number>`octet_length(${memories.content})`,
      createdAt: memories.createdAt,
      expiresAt: memories.expiresAt,
    }).from(memories).where(and(
      eq(memories.projectId, projectId),
      eq(memories.identityId, subject.id),
      or(isNull(memories.expiresAt), gt(memories.expiresAt, now)),
    )).orderBy(desc(memories.createdAt), desc(memories.id))
      .limit(LOCAL_CONTEXT_BOUNDS.max_candidates + 1);
    return packLocalContext(projectId, subject.id, rows, now);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
