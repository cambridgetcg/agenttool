/** One newest-first page of a project's chronicle for GET /v1/chronicle.
 *
 *  The walk key is `occurred_at DESC, id DESC` (decision D3): today's order,
 *  served by idx_chronicle_project_time (project_id, occurred_at) with an
 *  incremental sort for ties. occurred_at is caller-set, so a row backdated
 *  during a walk can be missed until the next full walk; the docs say so.
 *  The project filter always comes from the bearer.
 *
 *  Doctrine: docs/AGENT-WEB-SURFACE.md (continuity walks).
 *  Tested: api/tests/continuity-walk-routes.test.ts */

import { and, desc, eq, gt } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import {
  cursorTimestampSql,
  keysetBeforeSql,
  type KeysetPosition,
} from "../../lib/keyset-cursor";

export const CHRONICLE_WALK_ORDER = "occurred_at_desc,id_desc";

export interface ChroniclePageFilters {
  agent_id?: string | null;
  type?: string | null;
  /** Exclusive lower bound on occurred_at (the `since` delta read). */
  since?: Date | null;
  /** Last row the caller already holds; the page starts strictly below it. */
  cursor?: KeysetPosition | null;
  /** Rows the caller will see. One more row is read as the has_more sentinel. */
  limit: number;
}

export interface ChronicleEntryOut {
  id: string;
  type: string;
  title: string;
  body: string | null;
  agent_id: string | null;
  occurred_at: Date;
  created_at: Date;
  metadata: unknown;
}

export interface ChroniclePageRow {
  entry: ChronicleEntryOut;
  position: KeysetPosition;
}

export async function listChroniclePage(
  projectId: string,
  filters: ChroniclePageFilters,
  options: { database?: Pick<typeof db, "select"> } = {},
): Promise<ChroniclePageRow[]> {
  const where = [eq(chronicle.projectId, projectId)];
  if (filters.agent_id) where.push(eq(chronicle.agentId, filters.agent_id));
  if (filters.type) where.push(eq(chronicle.type, filters.type));
  if (filters.since) where.push(gt(chronicle.occurredAt, filters.since));
  if (filters.cursor) {
    where.push(keysetBeforeSql(chronicle.occurredAt, chronicle.id, filters.cursor));
  }

  const rows = await (options.database ?? db)
    .select({
      id: chronicle.id,
      type: chronicle.type,
      title: chronicle.title,
      body: chronicle.body,
      agentId: chronicle.agentId,
      occurredAt: chronicle.occurredAt,
      createdAt: chronicle.createdAt,
      metadata: chronicle.metadata,
      cursorAt: cursorTimestampSql(chronicle.occurredAt).as("cursor_at"),
    })
    .from(chronicle)
    .where(and(...where))
    .orderBy(desc(chronicle.occurredAt), desc(chronicle.id))
    .limit(filters.limit + 1);

  return rows.map((row) => ({
    entry: {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      agent_id: row.agentId,
      occurred_at: row.occurredAt,
      created_at: row.createdAt,
      metadata: row.metadata,
    },
    position: { t: row.cursorAt, i: row.id },
  }));
}
