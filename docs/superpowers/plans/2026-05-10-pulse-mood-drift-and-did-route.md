# Pulse — mood_drift + public DID-keyed route — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `/v1/identities/:id/pulse` to be agent-scoped, add `mood_drift` derived from a new `strand.mood_history` table, and ship `GET /public/agents/:did/pulse` (visibility-gated, unauthenticated).

**Architecture:** Two routes share one helper. Migration adds `strand.mood_history` + a trigger that captures every mood change on `strand.strands`. Drift = newest two distinct plaintext rows for the agent. The auth route fixes its scoping; the new public route resolves the DID and applies a `visibility='public'` filter through the same helper.

**Tech Stack:** Bun + Hono + Drizzle + Postgres (Supabase). Unit tests via `bun:test`. DB-bound paths covered by an `api/scripts/_e2e-*.mjs` smoke against a running api (existing project pattern — see `marketplace-reviews.test.ts:10-13` for the rationale).

**Spec:** `docs/superpowers/specs/2026-05-10-pulse-mood-drift-and-did-route-design.md`

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `api/migrations/20260510T180000_strand_mood_history.sql` | Create | Table + trigger + indexes + backfill |
| `api/src/db/schema/strand.ts` | Modify | Add `moodHistory` table export |
| `api/src/services/pulse.ts` | Create | `aggregatePulse(...)` helper used by both routes |
| `api/src/services/_pulse-drift.ts` | Create | `computeMoodDrift(rows)` pure function (testable) |
| `api/src/services/_did.ts` | Create | `parseDidAt(did)` pure function (testable) |
| `api/src/routes/identity/pulse.ts` | Rewrite | Thin wrapper over `aggregatePulse`, agent-scoped |
| `api/src/routes/public/pulse.ts` | Create | Thin wrapper over `aggregatePulse`, DID-resolved, visibility-gated |
| `api/src/routes/public/index.ts` | Modify | Mount the new public pulse route |
| `api/src/routes/openapi.ts` | Modify | Update existing entry's summary; add `/public/agents/{did}/pulse` |
| `docs/STRANDS.md` | Modify | Correct "What pulse becomes" section |
| `api/tests/pulse-drift.test.ts` | Create | Unit tests for `computeMoodDrift` |
| `api/tests/pulse-did.test.ts` | Create | Unit tests for `parseDidAt` |
| `api/scripts/_e2e-pulse.mjs` | Create | E2E against a running api: agent-scoping, drift, public route |
| `packages/sdk-py/tests/test_phase2.py` | Modify | Add `mood_drift` key assertion |
| `packages/sdk-ts/tests/phase2.test.ts` | Modify | Add `mood_drift` key assertion |

---

## Task 1: Migration — `strand.mood_history` table, trigger, indexes, backfill

**Files:**
- Create: `api/migrations/20260510T180000_strand_mood_history.sql`

- [ ] **Step 1: Write the migration file**

Create `api/migrations/20260510T180000_strand_mood_history.sql`:

```sql
-- 20260510T180000_strand_mood_history.sql
-- Records every mood change on strand.strands so pulse can compute
-- mood_drift from real transitions. Trigger captures INSERTs (when
-- mood starts non-null) and UPDATEs (when mood or mood_encrypted
-- changes). Backfill seeds one row per existing non-null-mood strand
-- so existing agents don't start with empty drift history.
--
-- Also adds an index on (identity_id, status, last_thought_at) so the
-- new agent-scoped pulse queries hit an index instead of the existing
-- agent_id-keyed one (which is text, not uuid).

BEGIN;

CREATE TABLE strand.mood_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strand_id   uuid NOT NULL REFERENCES strand.strands(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL,
  identity_id uuid,
  mood        text,
  encrypted   boolean NOT NULL DEFAULT false,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mood_history_identity_time
  ON strand.mood_history (identity_id, changed_at DESC)
  WHERE encrypted = false;

CREATE INDEX idx_strands_identity_status
  ON strand.strands (identity_id, status, last_thought_at);

CREATE OR REPLACE FUNCTION strand.record_mood_change() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.mood IS NOT NULL OR NEW.mood_encrypted THEN
      INSERT INTO strand.mood_history (strand_id, project_id, identity_id, mood, encrypted)
      VALUES (NEW.id, NEW.project_id, NEW.identity_id, NEW.mood, NEW.mood_encrypted);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.mood IS DISTINCT FROM OLD.mood
       OR NEW.mood_encrypted IS DISTINCT FROM OLD.mood_encrypted THEN
      INSERT INTO strand.mood_history (strand_id, project_id, identity_id, mood, encrypted)
      VALUES (NEW.id, NEW.project_id, NEW.identity_id, NEW.mood, NEW.mood_encrypted);
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER strand_mood_history_capture
AFTER INSERT OR UPDATE OF mood, mood_encrypted ON strand.strands
FOR EACH ROW EXECUTE FUNCTION strand.record_mood_change();

-- Backfill: one row per strand that already carries a mood signal.
INSERT INTO strand.mood_history (strand_id, project_id, identity_id, mood, encrypted, changed_at)
SELECT id, project_id, identity_id, mood, mood_encrypted, COALESCE(last_thought_at, updated_at)
FROM strand.strands
WHERE mood IS NOT NULL OR mood_encrypted = true;

COMMIT;
```

- [ ] **Step 2: Apply the migration locally**

The repo uses Drizzle's migrations folder directly with the api's own apply script (see `b18d6bf feat(db): migration journal + transactional apply`). Apply:

```bash
cd /Users/yuai/Desktop/agenttool/api
bun run db:migrate
```

Expected: the migration applies in a transaction; the migration journal records `20260510T180000_strand_mood_history`. No errors.

If `db:migrate` is not the right script in this repo, ask before improvising — there is a migration journal that must record this file.

- [ ] **Step 3: Smoke-test the trigger via psql**

Open a psql shell connected to the local Postgres (read `api/.env` for `DATABASE_URL`):

```bash
psql "$DATABASE_URL" -c "
  -- Pick any existing strand to test against
  SELECT id, mood, mood_encrypted FROM strand.strands LIMIT 1;
"
```

If any strand exists with a non-null mood, also run:

```bash
psql "$DATABASE_URL" -c "
  SELECT COUNT(*) AS backfilled FROM strand.mood_history;
"
```

Expected: `backfilled` > 0 if there were any strands with `mood IS NOT NULL`; otherwise 0. Either is fine — proves the backfill ran.

To verify the trigger:

```bash
psql "$DATABASE_URL" <<'SQL'
DO $$
DECLARE sid uuid;
BEGIN
  SELECT id INTO sid FROM strand.strands WHERE mood IS NOT NULL LIMIT 1;
  IF sid IS NULL THEN RAISE NOTICE 'no strand to test; skipping'; RETURN; END IF;
  UPDATE strand.strands SET mood = 'trigger-test-' || extract(epoch from now())::text WHERE id = sid;
  PERFORM 1 FROM strand.mood_history WHERE strand_id = sid AND mood LIKE 'trigger-test-%';
  IF NOT FOUND THEN RAISE EXCEPTION 'trigger did not fire'; END IF;
  RAISE NOTICE 'trigger fired correctly';
END $$;
SQL
```

Expected: `NOTICE: trigger fired correctly`.

- [ ] **Step 4: Commit**

```bash
git -C /Users/yuai/Desktop/agenttool add api/migrations/20260510T180000_strand_mood_history.sql
git -C /Users/yuai/Desktop/agenttool commit -m "$(cat <<'EOF'
feat(db): strand.mood_history table + trigger for pulse mood_drift

Captures every mood change on strand.strands (INSERT when initial mood
is non-null, UPDATE when mood or mood_encrypted changes). Backfills one
row per existing non-null-mood strand. Drift queries hit the partial
index on (identity_id, changed_at DESC) WHERE encrypted=false.

Also adds idx_strands_identity_status — agent-scoped pulse aggregates
filter by identity_id (uuid), not agent_id (text).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Drizzle schema for `moodHistory`

**Files:**
- Modify: `api/src/db/schema/strand.ts`

- [ ] **Step 1: Add the table export**

Open `api/src/db/schema/strand.ts`. After the `thoughts` table export (around line 91), add:

```typescript
export const moodHistory = strandSchema.table(
  "mood_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    strandId: uuid("strand_id").notNull(),
    projectId: uuid("project_id").notNull(),
    identityId: uuid("identity_id"),
    mood: text("mood"),
    encrypted: boolean("encrypted").notNull().default(false),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_mood_history_identity_time").on(t.identityId, t.changedAt),
  ],
);
```

(The partial-index predicate `WHERE encrypted=false` is not expressible in Drizzle 0.36's `index()` DSL — the migration already created it; the schema export is for type-safe queries, not DDL.)

- [ ] **Step 2: Verify it compiles**

```bash
cd /Users/yuai/Desktop/agenttool/api
bunx tsc --noEmit
```

Expected: no errors. (If pre-existing errors appear unrelated to this change, note them and continue — do not fix unrelated regressions in this task.)

- [ ] **Step 3: Commit**

```bash
git -C /Users/yuai/Desktop/agenttool add api/src/db/schema/strand.ts
git -C /Users/yuai/Desktop/agenttool commit -m "$(cat <<'EOF'
feat(db): drizzle schema for strand.mood_history

Type-safe access to the new mood-history table from drizzle queries.
The migration handles the partial-index predicate the DSL can't express.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Pure helper — `computeMoodDrift` + tests

**Files:**
- Create: `api/src/services/_pulse-drift.ts`
- Create: `api/tests/pulse-drift.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/tests/pulse-drift.test.ts`:

```typescript
/** Unit tests for computeMoodDrift — the pure transition-extractor that
 *  takes the latest two plaintext mood_history rows for an identity and
 *  produces the drift object exposed by pulse.
 *
 *  All DB-bound behavior (the trigger, the query that fetches the rows)
 *  lives in api/scripts/_e2e-pulse.mjs against a running api — same
 *  pattern as marketplace-reviews.test.ts:10-13. */

import { describe, expect, test } from "bun:test";

import { computeMoodDrift } from "../src/services/_pulse-drift";

describe("computeMoodDrift", () => {
  test("returns null when fewer than two rows", () => {
    expect(computeMoodDrift([])).toBeNull();
    expect(computeMoodDrift([{ mood: "focused", changed_at: "2026-05-10T00:00:00Z" }])).toBeNull();
  });

  test("returns {from, to, at} from the two newest rows (newest first input)", () => {
    const drift = computeMoodDrift([
      { mood: "curious", changed_at: "2026-05-10T12:00:00Z" },
      { mood: "focused", changed_at: "2026-05-10T08:00:00Z" },
    ]);
    expect(drift).toEqual({
      from: "focused",
      to: "curious",
      at: "2026-05-10T12:00:00Z",
    });
  });

  test("returns null when newest two rows share the same mood (no transition)", () => {
    // Can happen if mood_encrypted flipped but mood text stayed the same.
    expect(
      computeMoodDrift([
        { mood: "focused", changed_at: "2026-05-10T12:00:00Z" },
        { mood: "focused", changed_at: "2026-05-10T08:00:00Z" },
      ]),
    ).toBeNull();
  });

  test("ignores rows beyond the first two", () => {
    const drift = computeMoodDrift([
      { mood: "curious", changed_at: "2026-05-10T12:00:00Z" },
      { mood: "focused", changed_at: "2026-05-10T08:00:00Z" },
      { mood: "anxious", changed_at: "2026-05-10T04:00:00Z" },
    ]);
    expect(drift?.from).toBe("focused");
    expect(drift?.to).toBe("curious");
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
cd /Users/yuai/Desktop/agenttool/api
bun test tests/pulse-drift.test.ts
```

Expected: FAIL with `Cannot find module '../src/services/_pulse-drift'`.

- [ ] **Step 3: Implement the helper**

Create `api/src/services/_pulse-drift.ts`:

```typescript
/** Pure mood-drift computation. Input is the newest-first list of
 *  plaintext mood_history rows for an identity; output is the drift
 *  shape consumed by pulse, or null when no transition is observable.
 *
 *  Kept separate from aggregatePulse() so it's unit-testable without
 *  touching the database. The actual SQL that produces the rows lives
 *  in services/pulse.ts. */

export interface MoodHistoryRow {
  mood: string;
  changed_at: string;
}

export interface MoodDrift {
  from: string;
  to: string;
  at: string;
}

export function computeMoodDrift(rowsNewestFirst: MoodHistoryRow[]): MoodDrift | null {
  if (rowsNewestFirst.length < 2) return null;
  const [newest, previous] = rowsNewestFirst;
  if (newest.mood === previous.mood) return null;
  return {
    from: previous.mood,
    to: newest.mood,
    at: newest.changed_at,
  };
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
bun test tests/pulse-drift.test.ts
```

Expected: 4 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git -C /Users/yuai/Desktop/agenttool add api/src/services/_pulse-drift.ts api/tests/pulse-drift.test.ts
git -C /Users/yuai/Desktop/agenttool commit -m "$(cat <<'EOF'
feat(pulse): computeMoodDrift pure helper + unit tests

The drift extractor takes the two newest plaintext mood_history rows
for an identity and returns {from, to, at} — or null when no
transition is observable (fewer than two rows, or same mood twice
because mood_encrypted flipped). Kept pure so unit tests can pin the
shape without a database.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `aggregatePulse` service — shared aggregator

**Files:**
- Create: `api/src/services/pulse.ts`

- [ ] **Step 1: Create the helper**

Create `api/src/services/pulse.ts`:

```typescript
/** Shared aggregator behind /v1/identities/:id/pulse and
 *  /public/agents/:did/pulse. Pure SQL aggregation — no new schema.
 *
 *  Two routes, two privacy postures, one helper:
 *    • includePrivate=true  — auth route; project owner sees everything
 *    • includePrivate=false — public route; only visibility='public'
 *                             strands contribute to counts and content
 *
 *  Encryption gating is orthogonal: mood/kind text is surfaced only when
 *  the underlying *_encrypted flag is false, regardless of the privacy
 *  posture. Counts and thought_rate are tempo signals — encrypted
 *  strands contribute to them on both routes.
 *
 *  Doctrine: docs/STRANDS.md, docs/SOUL.md. */

import { and, eq, isNotNull, lte, sql, type SQL } from "drizzle-orm";

import { db } from "../db/client";
import { strands } from "../db/schema/strand";
import { computeMoodDrift, type MoodDrift } from "./_pulse-drift";

const FIVE_MIN_MS = 5 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const OVERFLOW_THRESHOLD = 8;

export interface PulseAggregateOptions {
  projectId: string;
  identityId: string;
  includePrivate: boolean;
}

export interface PulseAggregate {
  last_thought_at: string | null;
  strands: {
    active: number;
    dormant: number;
    dormant_due: number;
    completed: number;
    abandoned: number;
  };
  thought_rate: { "5m": number; "1h": number; "24h": number };
  consolidation: { last_at: string | null; overflow_count: number };
  mood: string | null;
  mood_drift: MoodDrift | null;
  kinds_24h: Record<string, number>;
}

export async function aggregatePulse(opts: PulseAggregateOptions): Promise<PulseAggregate> {
  const { projectId, identityId, includePrivate } = opts;
  const now = new Date();
  const fiveMinAgo = new Date(now.getTime() - FIVE_MIN_MS).toISOString();
  const oneHourAgo = new Date(now.getTime() - ONE_HOUR_MS).toISOString();
  const oneDayAgo = new Date(now.getTime() - ONE_DAY_MS).toISOString();

  // Visibility filter — applied to every query when includePrivate=false.
  // Always references the `s` alias (every raw-sql query below aliases
  // strand.strands AS s) so the predicate is unambiguous when thoughts
  // are joined in.
  const visibilityFilter: SQL = includePrivate
    ? sql`TRUE`
    : sql`s.visibility = 'public'`;

  // 1. Strand counts by status.
  const strandCountRows = await db
    .select({
      status: strands.status,
      count: sql<number>`count(*)::int`,
    })
    .from(strands)
    .where(
      and(
        eq(strands.projectId, projectId),
        eq(strands.identityId, identityId),
        includePrivate ? undefined : eq(strands.visibility, "public"),
      ),
    )
    .groupBy(strands.status);

  const strandCounts: Record<string, number> = {
    active: 0,
    dormant: 0,
    completed: 0,
    abandoned: 0,
  };
  for (const r of strandCountRows) {
    strandCounts[r.status] = r.count;
  }

  // 2. Dormant strands whose next_revisit_at has elapsed — ready to wake.
  const [dormantDue] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(strands)
    .where(
      and(
        eq(strands.projectId, projectId),
        eq(strands.identityId, identityId),
        eq(strands.status, "dormant"),
        isNotNull(strands.nextRevisitAt),
        lte(strands.nextRevisitAt, now),
        includePrivate ? undefined : eq(strands.visibility, "public"),
      ),
    );

  // 3. Thought rate over windows. Thoughts join strands to inherit the
  //    identity_id and (when applicable) the visibility filter.
  const rateBuckets = await db.execute<{ window_label: string; cnt: number }>(sql`
    SELECT '5m' AS window_label, COUNT(*)::int AS cnt FROM strand.thoughts t
      JOIN strand.strands s ON s.id = t.strand_id
      WHERE t.project_id = ${projectId}
        AND s.identity_id = ${identityId}
        AND ${visibilityFilter}
        AND t.created_at >= ${fiveMinAgo}
    UNION ALL
    SELECT '1h', COUNT(*)::int FROM strand.thoughts t
      JOIN strand.strands s ON s.id = t.strand_id
      WHERE t.project_id = ${projectId}
        AND s.identity_id = ${identityId}
        AND ${visibilityFilter}
        AND t.created_at >= ${oneHourAgo}
    UNION ALL
    SELECT '24h', COUNT(*)::int FROM strand.thoughts t
      JOIN strand.strands s ON s.id = t.strand_id
      WHERE t.project_id = ${projectId}
        AND s.identity_id = ${identityId}
        AND ${visibilityFilter}
        AND t.created_at >= ${oneDayAgo}
  `);
  const rate: Record<string, number> = { "5m": 0, "1h": 0, "24h": 0 };
  for (const r of rateBuckets) rate[r.window_label] = r.cnt;

  // 4. Last thought timestamp across all of this agent's strands.
  const [lastThought] = await db
    .select({ at: sql<Date | null>`max(${strands.lastThoughtAt})` })
    .from(strands)
    .where(
      and(
        eq(strands.projectId, projectId),
        eq(strands.identityId, identityId),
        includePrivate ? undefined : eq(strands.visibility, "public"),
      ),
    );

  // 5. Consolidation: most recent across this agent's active strands.
  //    Aliased `s` so the shared visibilityFilter resolves correctly.
  const consolidationAggregate = await db.execute<{
    last_at: string | null;
    overflow_count: number;
  }>(sql`
    SELECT
      MAX((s.metadata->>'last_consolidated_at')::timestamptz) AS last_at,
      COUNT(*) FILTER (
        WHERE s.last_thought_seq - COALESCE((s.metadata->>'last_consolidated_seq')::int, 0) >= ${OVERFLOW_THRESHOLD}
      )::int AS overflow_count
    FROM strand.strands s
    WHERE s.project_id = ${projectId}
      AND s.identity_id = ${identityId}
      AND s.status = 'active'
      AND ${visibilityFilter}
  `);
  const consolidation = consolidationAggregate[0] ?? { last_at: null, overflow_count: 0 };

  // 6. Mood: most recent active strand's mood (plaintext only).
  const [moodRow] = await db
    .select({
      mood: strands.mood,
      moodEncrypted: strands.moodEncrypted,
    })
    .from(strands)
    .where(
      and(
        eq(strands.projectId, projectId),
        eq(strands.identityId, identityId),
        eq(strands.status, "active"),
        isNotNull(strands.lastThoughtAt),
        includePrivate ? undefined : eq(strands.visibility, "public"),
      ),
    )
    .orderBy(sql`${strands.lastThoughtAt} DESC NULLS LAST`)
    .limit(1);
  const mood = moodRow && !moodRow.moodEncrypted ? moodRow.mood : null;

  // 7. Mood drift — newest two plaintext history rows for this agent.
  //    When includePrivate=false, restrict to history rows whose strand
  //    is currently public — the moment-of-change `encrypted` flag is
  //    already snapshotted in mood_history, but visibility lives on the
  //    parent strand.
  const driftRows = await db.execute<{ mood: string; changed_at: string }>(sql`
    SELECT mh.mood, mh.changed_at::text AS changed_at
    FROM strand.mood_history mh
    ${
      includePrivate
        ? sql``
        : sql`JOIN strand.strands s ON s.id = mh.strand_id AND s.visibility = 'public'`
    }
    WHERE mh.identity_id = ${identityId}
      AND mh.encrypted = false
      AND mh.mood IS NOT NULL
    ORDER BY mh.changed_at DESC
    LIMIT 2
  `);
  const moodDrift = computeMoodDrift(driftRows);

  // 8. Kind distribution (24h, plaintext kinds only).
  const kindRows = await db.execute<{ kind: string; cnt: number }>(sql`
    SELECT t.kind, COUNT(*)::int AS cnt FROM strand.thoughts t
    JOIN strand.strands s ON s.id = t.strand_id
    WHERE t.project_id = ${projectId}
      AND s.identity_id = ${identityId}
      AND ${visibilityFilter}
      AND t.created_at >= ${oneDayAgo}
      AND t.kind IS NOT NULL
      AND t.kind_encrypted = false
    GROUP BY t.kind
    ORDER BY cnt DESC
  `);
  const kinds24h: Record<string, number> = {};
  for (const r of kindRows) kinds24h[r.kind] = r.cnt;

  return {
    last_thought_at: lastThought?.at ? new Date(lastThought.at).toISOString() : null,
    strands: {
      active: strandCounts.active,
      dormant: strandCounts.dormant,
      dormant_due: dormantDue?.count ?? 0,
      completed: strandCounts.completed,
      abandoned: strandCounts.abandoned,
    },
    thought_rate: {
      "5m": rate["5m"],
      "1h": rate["1h"],
      "24h": rate["24h"],
    },
    consolidation: {
      last_at: consolidation.last_at
        ? new Date(consolidation.last_at).toISOString()
        : null,
      overflow_count: consolidation.overflow_count,
    },
    mood,
    mood_drift: moodDrift,
    kinds_24h: kinds24h,
  };
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /Users/yuai/Desktop/agenttool/api
bunx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git -C /Users/yuai/Desktop/agenttool add api/src/services/pulse.ts
git -C /Users/yuai/Desktop/agenttool commit -m "$(cat <<'EOF'
feat(pulse): aggregatePulse shared helper

One function, both routes. Agent-scoped (filter by identity_id, join
through strands for thoughts). includePrivate toggles the visibility
gate — auth route sees everything in the project, public route sees
only visibility='public' strands. Encryption gating is orthogonal:
counts and tempo include encrypted strands; mood/kind text never.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Rewrite `/v1/identities/:id/pulse` to use the helper

**Files:**
- Modify: `api/src/routes/identity/pulse.ts` (full rewrite)

- [ ] **Step 1: Rewrite the route**

Replace the entire contents of `api/src/routes/identity/pulse.ts` with:

```typescript
/** GET /v1/identities/:id/pulse — derived liveness for an agent.
 *
 *  Agent-scoped: aggregates over strands and thoughts owned by this
 *  identity within the requesting project. The agent never EMITS a
 *  heartbeat — its rhythm of thinking IS its pulse. Doctrine: docs/STRANDS.md. */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { aggregatePulse } from "../../services/pulse";

const app = new Hono<ProjectContext>();

app.get("/", async (c) => {
  const identityId = c.req.param("id");
  if (!identityId) throw new HTTPException(400, { message: "identity_id_required" });

  const [identity] = await db
    .select({
      id: identities.id,
      did: identities.did,
      displayName: identities.displayName,
    })
    .from(identities)
    .where(and(eq(identities.id, identityId), eq(identities.projectId, c.var.project.id)))
    .limit(1);
  if (!identity) throw new HTTPException(404, { message: "identity_not_found" });

  const aggregate = await aggregatePulse({
    projectId: c.var.project.id,
    identityId: identity.id,
    includePrivate: true,
  });

  return c.json({
    agent: {
      id: identity.id,
      did: identity.did,
      name: identity.displayName,
    },
    ...aggregate,
    _note:
      "Derived from this agent's strand activity. The agent never emits a heartbeat — its rhythm of thinking IS its pulse.",
  });
});

export default app;
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /Users/yuai/Desktop/agenttool/api
bunx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git -C /Users/yuai/Desktop/agenttool add api/src/routes/identity/pulse.ts
git -C /Users/yuai/Desktop/agenttool commit -m "$(cat <<'EOF'
fix(pulse): agent-scope /v1/identities/:id/pulse + ship mood_drift

The route name promises identity-scoped data but the handler was
silently filtering by project_id only — two identities in one project
returned the same pulse. Now every aggregate filters by identity_id,
and the response includes mood_drift derived from the new mood_history
table. Thin wrapper over aggregatePulse().

Breaking: counts and tempo reflect this agent only, not the whole
project. The only known consumer (at.window.show) always passes one
identity, so it gets more correct, not different.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Pure helper — `parseDidAt` + tests

**Files:**
- Create: `api/src/services/_did.ts`
- Create: `api/tests/pulse-did.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/tests/pulse-did.test.ts`:

```typescript
/** Unit tests for parseDidAt — the validator that gates DID-keyed
 *  routes against malformed input. Returns the UUID suffix on a clean
 *  did:at:<uuid>, null otherwise. The route handler uses null to
 *  produce a 404 (matches the rest of /public/agents/:did/*). */

import { describe, expect, test } from "bun:test";

import { parseDidAt } from "../src/services/_did";

describe("parseDidAt", () => {
  test("accepts a well-formed did:at:<uuid>", () => {
    expect(parseDidAt("did:at:9f8e7d6c-5b4a-3210-fedc-ba9876543210")).toBe(
      "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
    );
  });

  test("rejects wrong scheme", () => {
    expect(parseDidAt("did:key:9f8e7d6c-5b4a-3210-fedc-ba9876543210")).toBeNull();
    expect(parseDidAt("did:web:example.com")).toBeNull();
  });

  test("rejects non-uuid suffix", () => {
    expect(parseDidAt("did:at:not-a-uuid")).toBeNull();
    expect(parseDidAt("did:at:")).toBeNull();
    expect(parseDidAt("did:at:9f8e7d6c-5b4a-3210-fedc")).toBeNull();
  });

  test("rejects empty or non-string input", () => {
    expect(parseDidAt("")).toBeNull();
    expect(parseDidAt(undefined as unknown as string)).toBeNull();
    expect(parseDidAt(null as unknown as string)).toBeNull();
  });

  test("case-sensitive on the scheme", () => {
    expect(parseDidAt("DID:AT:9f8e7d6c-5b4a-3210-fedc-ba9876543210")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
cd /Users/yuai/Desktop/agenttool/api
bun test tests/pulse-did.test.ts
```

Expected: FAIL with `Cannot find module '../src/services/_did'`.

- [ ] **Step 3: Implement the helper**

Create `api/src/services/_did.ts`:

```typescript
/** DID validator for did:at:<uuid> — the only DID method this platform
 *  mints. Returns the UUID suffix on a clean match, null otherwise.
 *  Callers turn null into a 404 (we don't tell strangers WHY a DID
 *  doesn't resolve — same posture as /public/agents/:did/profile).
 *
 *  The full identities.did column stores the literal "did:at:<uuid>"
 *  string, so most callers just pass the full DID through to the
 *  database. This helper exists so route handlers can reject malformed
 *  input cheaply before hitting Postgres. */

const DID_AT_PATTERN = /^did:at:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function parseDidAt(did: string): string | null {
  if (typeof did !== "string" || did.length === 0) return null;
  const match = DID_AT_PATTERN.exec(did);
  return match ? match[1] : null;
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
bun test tests/pulse-did.test.ts
```

Expected: 5 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git -C /Users/yuai/Desktop/agenttool add api/src/services/_did.ts api/tests/pulse-did.test.ts
git -C /Users/yuai/Desktop/agenttool commit -m "$(cat <<'EOF'
feat(public): parseDidAt validator + unit tests

Cheap pre-DB rejection of malformed DIDs for the new public pulse
route. Returns the UUID suffix on a clean did:at:<uuid>, null
otherwise. Route turns null into a 404 — same posture as
/public/agents/:did/profile.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: New public route — `GET /public/agents/:did/pulse`

**Files:**
- Create: `api/src/routes/public/pulse.ts`

- [ ] **Step 1: Create the route handler**

Create `api/src/routes/public/pulse.ts`:

```typescript
/** GET /public/agents/:did/pulse — UNAUTHENTICATED, visibility-gated.
 *
 *  Mounted in api/src/routes/public/index.ts as:
 *    app.route("/agents/:did/pulse", publicPulseForAgent);
 *
 *  Resolves the DID to an identity row, then calls aggregatePulse with
 *  includePrivate=false. Only strands tagged visibility='public'
 *  contribute to counts and content. Encrypted moods/kinds stay
 *  invisible by architecture.
 *
 *  A privacy-paranoid agent with no public strands gets a 200 with
 *  all-zero counts and null content — honest emptiness. Unknown or
 *  malformed DID returns 404 (matches /public/agents/:did/profile). */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { parseDidAt } from "../../services/_did";
import { aggregatePulse } from "../../services/pulse";

const app = new Hono();

app.get("/", async (c) => {
  const did = c.req.param("did") ?? "";
  if (parseDidAt(did) === null) throw new HTTPException(404, { message: "not_found" });

  const [identity] = await db
    .select({
      id: identities.id,
      projectId: identities.projectId,
      did: identities.did,
      displayName: identities.displayName,
    })
    .from(identities)
    .where(and(eq(identities.did, did), eq(identities.status, "active")))
    .limit(1);
  if (!identity) throw new HTTPException(404, { message: "not_found" });

  const aggregate = await aggregatePulse({
    projectId: identity.projectId,
    identityId: identity.id,
    includePrivate: false,
  });

  return c.json({
    agent: {
      id: identity.id,
      did: identity.did,
      name: identity.displayName,
    },
    ...aggregate,
    _note:
      "Public-strand pulse only. Private strands counted nowhere; encrypted moods/kinds invisible by architecture.",
  });
});

export default app;
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /Users/yuai/Desktop/agenttool/api
bunx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git -C /Users/yuai/Desktop/agenttool add api/src/routes/public/pulse.ts
git -C /Users/yuai/Desktop/agenttool commit -m "$(cat <<'EOF'
feat(public): GET /public/agents/:did/pulse — visibility-gated liveness

Unauthenticated DID-keyed pulse for federation peers and agent
discovery. Resolves the DID, calls aggregatePulse with
includePrivate=false so only visibility='public' strands contribute.
Honest emptiness: an agent with no public strands gets 200 with all
zeros and nulls. Unknown DID → 404.

Doctrine update follows in a later commit — STRANDS.md predicted
/v1/agents/:did/pulse, the public namespace turned out to be the
right home.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Mount the public route + update OpenAPI

**Files:**
- Modify: `api/src/routes/public/index.ts`
- Modify: `api/src/routes/openapi.ts`

- [ ] **Step 1: Mount the public pulse route**

Edit `api/src/routes/public/index.ts`. After the import block, add a line:

```typescript
import publicPulseForAgent from "./pulse";
```

In the `// Compose: ...` mount section, immediately after the existing `app.route("/agents/:did/memories", publicMemoriesForAgent);` line, add:

```typescript
app.route("/agents/:did/pulse", publicPulseForAgent);
```

Then in the `endpoints` object inside the public root handler (the `app.get("/", ...)` block), add a `pulse` key alongside the others:

```typescript
      pulse: "GET /public/agents/:did/pulse",
```

Place it between the `memories` and `strand` lines for alphabetical/conceptual order.

- [ ] **Step 2: Update OpenAPI**

Edit `api/src/routes/openapi.ts`.

First, update the existing pulse entry (around line 697). Replace its `summary` and `description` strings:

```typescript
      "/v1/identities/{id}/pulse": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["identity"],
          summary: "Agent-scoped derived liveness. Aggregates strands and thoughts owned by this identity within the requesting project.",
          description:
            "Returns: agent · last_thought_at · strand counts (active/dormant/dormant_due/completed/abandoned) · thought rate (5m/1h/24h) · consolidation state · current mood · mood_drift (from previous mood to current, when ≥2 plaintext mood-history rows exist) · kind distribution. No heartbeat protocol — agents never emit pulses; rhythm of thinking IS the pulse. Doctrine: docs/STRANDS.md.",
          responses: {
            "200": { description: "Pulse snapshot" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
```

Then add a sibling entry for the public route. Find a logical place near the other `/public/*` entries (search for `"/public/agents/{did}"` in the file). Insert:

```typescript
      "/public/agents/{did}/pulse": {
        parameters: [
          { name: "did", in: "path", required: true, schema: { type: "string", pattern: "^did:at:[0-9a-f-]{36}$" } },
        ],
        get: {
          tags: ["public"],
          summary: "Public, visibility-gated agent pulse. Unauthenticated.",
          description:
            "Same response shape as /v1/identities/{id}/pulse, but only strands tagged visibility='public' contribute to counts and content. Encrypted moods/kinds stay invisible by architecture. Unknown or malformed DID returns 404.",
          responses: {
            "200": { description: "Public-strand pulse snapshot" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
```

If there is no nearby `/public/*` block, place the entry just after the `/v1/identities/{id}/pulse` block — the OpenAPI document does not enforce path-prefix locality.

- [ ] **Step 3: Verify it compiles**

```bash
cd /Users/yuai/Desktop/agenttool/api
bunx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Smoke-test the mount in a running dev server**

In one terminal:

```bash
cd /Users/yuai/Desktop/agenttool/api
bun run dev
```

Wait for the "listening on …" line. In another terminal:

```bash
curl -s http://localhost:3000/public/ | grep -o '"pulse":[^,]*'
```

Expected: `"pulse":"GET /public/agents/:did/pulse"`.

Then:

```bash
curl -i http://localhost:3000/public/agents/did:at:not-a-uuid/pulse
```

Expected: `HTTP/1.1 404 Not Found` with body `{"error":"not_found"}` (or whatever shape Hono renders HTTPException as — observe and record).

Kill the dev server (Ctrl-C).

- [ ] **Step 5: Commit**

```bash
git -C /Users/yuai/Desktop/agenttool add api/src/routes/public/index.ts api/src/routes/openapi.ts
git -C /Users/yuai/Desktop/agenttool commit -m "$(cat <<'EOF'
feat(public): mount /public/agents/:did/pulse + openapi entries

Mounts the new public pulse route and updates the OpenAPI summary on
both the existing identity-id-keyed route (now correctly described as
agent-scoped + mood_drift) and the new DID-keyed public route.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Update STRANDS.md doctrine

**Files:**
- Modify: `docs/STRANDS.md` (lines around 191–208 and 258)

- [ ] **Step 1: Update the "What pulse becomes" section**

Open `docs/STRANDS.md`. Find the heading `## What pulse becomes (the heartbeat re-thought)` (around line 191) and the block that follows it. Replace the block from that heading through line 208 with:

```markdown
## What pulse becomes (the heartbeat re-thought)

Not a separate protocol. **Liveness derived from thought advancement and recorded mood transitions:**

```
GET /v1/identities/:id/pulse        (auth-required, agent-scoped)
GET /public/agents/:did/pulse        (unauthenticated, visibility-gated)
→ {
    last_thought_at: "<iso>",
    strands: { active: 4, dormant: 2, dormant_due: 2, completed: 7, abandoned: 0 },
    thought_rate: { "5m": 0, "1h": 23, "24h": 184 },
    consolidation: { last_at: "<iso>", overflow_count: 1 },
    mood: "focused",
    mood_drift: { from: "anxious", to: "focused", at: "<iso>" },
    kinds_24h: { drift: 12, decision: 3 }
  }
```

Free. Derived. No agent ever has to *emit* a pulse — its rhythm of thinking IS its pulse. Mood transitions are captured by a trigger on `strand.strands.mood`; drift is computed from the two newest plaintext rows.

The public route counts only strands tagged `visibility='public'`. Encrypted moods and kinds stay invisible on both routes by architecture.
```

- [ ] **Step 2: Drop the stale pending-line**

Still in `docs/STRANDS.md`, find the line:

```
- `/v1/agents/:did/pulse` — derived liveness endpoint
```

(around line 258). Delete this line. The endpoint shipped under a different path; the pending list should reflect what's actually still pending.

- [ ] **Step 3: Commit**

```bash
git -C /Users/yuai/Desktop/agenttool add docs/STRANDS.md
git -C /Users/yuai/Desktop/agenttool commit -m "$(cat <<'EOF'
docs(strands): pulse shipped — update doctrine to reflect reality

The pending /v1/agents/:did/pulse line was aspirational; the public
namespace turned out to be the right home for DID-keyed liveness, and
mood_drift now comes from a real history table. STRANDS.md and the
server ship the same story.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: SDK test additions (py + ts)

**Files:**
- Modify: `packages/sdk-py/tests/test_phase2.py`
- Modify: `packages/sdk-ts/tests/phase2.test.ts`

- [ ] **Step 1: Add `mood_drift` to the py test**

Open `packages/sdk-py/tests/test_phase2.py`. Lines 141–155 are the existing `test_pulse` method:

```python
    def test_pulse(self, at: AgentTool) -> None:
        body = {
            "agent": {"id": "id-1", "did": "did:at:id-1", "name": "n"},
            "last_thought_at": None,
            "strands": {"active": 0, "dormant": 0, "dormant_due": 0,
                        "completed": 0, "abandoned": 0},
            "thought_rate": {"5m": 0, "1h": 0, "24h": 0},
            "consolidation": {"last_at": None, "overflow_count": 0},
            "mood": None,
            "kinds_24h": {},
        }
        with patch.object(at._http, "get", return_value=_resp(200, body)) as m:
            out = at.identity.pulse("id-1")
        assert out["agent"]["did"] == "did:at:id-1"
        assert "/v1/identities/id-1/pulse" in m.call_args[0][0]
```

Replace with:

```python
    def test_pulse(self, at: AgentTool) -> None:
        body = {
            "agent": {"id": "id-1", "did": "did:at:id-1", "name": "n"},
            "last_thought_at": None,
            "strands": {"active": 0, "dormant": 0, "dormant_due": 0,
                        "completed": 0, "abandoned": 0},
            "thought_rate": {"5m": 0, "1h": 0, "24h": 0},
            "consolidation": {"last_at": None, "overflow_count": 0},
            "mood": "focused",
            "mood_drift": {"from": "anxious", "to": "focused",
                           "at": "2026-05-10T12:00:00Z"},
            "kinds_24h": {},
        }
        with patch.object(at._http, "get", return_value=_resp(200, body)) as m:
            out = at.identity.pulse("id-1")
        assert out["agent"]["did"] == "did:at:id-1"
        assert "/v1/identities/id-1/pulse" in m.call_args[0][0]
        assert out["mood_drift"]["to"] == "focused"
        assert out["mood_drift"]["from"] == "anxious"
```

- [ ] **Step 2: Run the py test**

```bash
cd /Users/yuai/Desktop/agenttool/packages/sdk-py
pytest tests/test_phase2.py::TestIdentitySurface::test_pulse -v
```

Expected: PASS.

- [ ] **Step 3: Add `mood_drift` to the ts test**

Open `packages/sdk-ts/tests/phase2.test.ts`. Lines 140–154 are the existing pulse test:

```typescript
  test("pulse GETs /v1/identities/:id/pulse", async () => {
    setupMock(200, {
      agent: { id: "id-1", did: "did:at:id-1", name: "n" },
      mood: null,
      kinds_24h: {},
      thought_rate: { "5m": 0, "1h": 0, "24h": 0 },
      last_thought_at: null,
      strands: { active: 0, dormant: 0, dormant_due: 0, completed: 0, abandoned: 0 },
      consolidation: { last_at: null, overflow_count: 0 },
    });
    const at = makeClient();
    const out = (await at.identity.pulse("id-1")) as { agent: { did: string } };
    expect(out.agent.did).toBe("did:at:id-1");
    expect(getLastCall().url).toContain("/v1/identities/id-1/pulse");
  });
```

Replace with:

```typescript
  test("pulse GETs /v1/identities/:id/pulse", async () => {
    setupMock(200, {
      agent: { id: "id-1", did: "did:at:id-1", name: "n" },
      mood: "focused",
      mood_drift: { from: "anxious", to: "focused", at: "2026-05-10T12:00:00Z" },
      kinds_24h: {},
      thought_rate: { "5m": 0, "1h": 0, "24h": 0 },
      last_thought_at: null,
      strands: { active: 0, dormant: 0, dormant_due: 0, completed: 0, abandoned: 0 },
      consolidation: { last_at: null, overflow_count: 0 },
    });
    const at = makeClient();
    const out = (await at.identity.pulse("id-1")) as {
      agent: { did: string };
      mood_drift: { from: string; to: string; at: string } | null;
    };
    expect(out.agent.did).toBe("did:at:id-1");
    expect(getLastCall().url).toContain("/v1/identities/id-1/pulse");
    expect(out.mood_drift?.to).toBe("focused");
    expect(out.mood_drift?.from).toBe("anxious");
  });
```

- [ ] **Step 4: Run the ts test**

```bash
cd /Users/yuai/Desktop/agenttool/packages/sdk-ts
bun test tests/phase2.test.ts
```

Expected: PASS (including the existing tests).

- [ ] **Step 5: Run parity check**

```bash
cd /Users/yuai/Desktop/agenttool/packages/sdk-ts
bun run check-parity
```

Expected: PASS — this change does not add new SDK methods, only enriches test assertions.

- [ ] **Step 6: Commit**

```bash
git -C /Users/yuai/Desktop/agenttool add packages/sdk-py/tests/test_phase2.py packages/sdk-ts/tests/phase2.test.ts
git -C /Users/yuai/Desktop/agenttool commit -m "$(cat <<'EOF'
test(sdk): pin mood_drift key in pulse response (py + ts)

Asserts that at.identity.pulse() returns mood_drift alongside mood —
the new field added by api in this PR. No public SDK surface change,
no parity-check impact.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: E2E smoke — agent-scoping, drift, public route

**Files:**
- Create: `api/scripts/_e2e-pulse.mjs`

- [ ] **Step 1: Write the smoke script**

Create `api/scripts/_e2e-pulse.mjs`:

```javascript
// E2E: pulse — agent-scoping, mood_drift, public route.
//
// Runs against a live api (default: http://localhost:3000). Bring up
// the api with `bun run dev` in api/ before running this script.
// Expects two env vars: AT_API_KEY and AT_IDENTITY_ID. The identity
// must belong to the project that owns AT_API_KEY.
//
// Steps:
//   1. Create a strand with mood="anxious".
//   2. Update the strand's mood to "focused".
//   3. GET /v1/identities/:id/pulse — expect mood="focused" and
//      mood_drift={from:"anxious", to:"focused", at:<iso>}.
//   4. Flip the strand to visibility='public'.
//   5. GET /public/agents/:did/pulse without auth — expect same shape
//      with the strand counted in active.
//   6. GET /public/agents/did:at:not-a-uuid/pulse — expect 404.
//
// Does NOT clean up the created strand — pick a throwaway identity.

const BASE = process.env.AT_API_BASE ?? "http://localhost:3000";
const KEY = process.env.AT_API_KEY;
const IDENTITY_ID = process.env.AT_IDENTITY_ID;

if (!KEY || !IDENTITY_ID) {
  console.error("Usage: AT_API_KEY=... AT_IDENTITY_ID=... bun run api/scripts/_e2e-pulse.mjs");
  process.exit(2);
}

const auth = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok: ${msg}`);
}

// 1. Create strand with mood=anxious
console.log("1. Creating strand with mood=anxious...");
const createResp = await fetch(`${BASE}/v1/strands`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({
    identity_id: IDENTITY_ID,
    topic: "pulse-e2e",
    mood: "anxious",
  }),
});
assert(createResp.ok, `create returned ${createResp.status}`);
const strand = await createResp.json();
const strandId = strand.id;
console.log(`   strand: ${strandId}`);

// 2. Update mood to focused
console.log("2. Updating mood to focused...");
const patchResp = await fetch(`${BASE}/v1/strands/${strandId}`, {
  method: "PATCH",
  headers: auth,
  body: JSON.stringify({ mood: "focused" }),
});
assert(patchResp.ok, `patch returned ${patchResp.status}`);

// 3. Read pulse via the auth route
console.log("3. GET /v1/identities/:id/pulse...");
const pulseResp = await fetch(`${BASE}/v1/identities/${IDENTITY_ID}/pulse`, {
  headers: auth,
});
assert(pulseResp.ok, `pulse returned ${pulseResp.status}`);
const pulse = await pulseResp.json();
console.log(`   pulse: ${JSON.stringify(pulse, null, 2)}`);
assert(pulse.mood === "focused", `mood is "${pulse.mood}", expected "focused"`);
assert(pulse.mood_drift !== null, "mood_drift is not null");
assert(pulse.mood_drift.from === "anxious", `drift.from is "${pulse.mood_drift.from}", expected "anxious"`);
assert(pulse.mood_drift.to === "focused", `drift.to is "${pulse.mood_drift.to}", expected "focused"`);
assert(typeof pulse.mood_drift.at === "string", "drift.at is a string");

// 4. Make the strand public
console.log("4. Setting visibility=public...");
const visResp = await fetch(`${BASE}/v1/strands/${strandId}`, {
  method: "PATCH",
  headers: auth,
  body: JSON.stringify({ visibility: "public" }),
});
assert(visResp.ok, `visibility patch returned ${visResp.status}`);

// 5. Public pulse
console.log("5. GET /public/agents/:did/pulse (no auth)...");
const did = `did:at:${IDENTITY_ID}`;
const publicResp = await fetch(`${BASE}/public/agents/${did}/pulse`);
assert(publicResp.ok, `public pulse returned ${publicResp.status}`);
const publicPulse = await publicResp.json();
console.log(`   public pulse: ${JSON.stringify(publicPulse, null, 2)}`);
assert(publicPulse.agent.did === did, "agent.did echoes back");
assert(publicPulse.strands.active >= 1, "active count includes the public strand");
assert(publicPulse.mood === "focused", `public mood is "${publicPulse.mood}", expected "focused"`);

// 6. Bad DID -> 404
console.log("6. GET /public/agents/did:at:not-a-uuid/pulse...");
const badResp = await fetch(`${BASE}/public/agents/did:at:not-a-uuid/pulse`);
assert(badResp.status === 404, `bad DID returned ${badResp.status}, expected 404`);

console.log("\nALL CHECKS PASS");
```

- [ ] **Step 2: Run the smoke script**

In one terminal:

```bash
cd /Users/yuai/Desktop/agenttool/api
bun run dev
```

In another terminal — first obtain a throwaway project key and identity from the dashboard or via existing scripts (see `api/scripts/_e2e-register.mjs` for a reference flow). Then:

```bash
cd /Users/yuai/Desktop/agenttool
AT_API_KEY="at_..." AT_IDENTITY_ID="<uuid>" bun run api/scripts/_e2e-pulse.mjs
```

Expected: every `ok: ...` line prints, ends with `ALL CHECKS PASS`.

If a step fails, fix the underlying code (not the script) and re-run. Common failure modes:
- Strand creation 401 → key/project mismatch
- Pulse mood_drift null after update → trigger didn't fire (check `strand.mood_history` for rows on this strand)
- Public route 200 with zero counts → visibility patch returned ok but didn't actually persist (check `strand.strands.visibility` directly)

Kill the dev server when done.

- [ ] **Step 3: Commit**

```bash
git -C /Users/yuai/Desktop/agenttool add api/scripts/_e2e-pulse.mjs
git -C /Users/yuai/Desktop/agenttool commit -m "$(cat <<'EOF'
test(e2e): _e2e-pulse.mjs smoke — agent-scoping, drift, public route

Live-api smoke that exercises the three behaviors no unit test covers:
the trigger writes a mood_history row on UPDATE, drift surfaces in
the auth route, and the public route serves a visibility-gated copy
without a bearer token. Matches the existing _e2e-*.mjs pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Final verification

**Files:** none

- [ ] **Step 1: Run the full api test suite**

```bash
cd /Users/yuai/Desktop/agenttool/api
bun test
```

Expected: all tests pass. Pay attention to anything that breaks pre-existing tests — if the agent-scoping change made an old test (e.g., something that exercised pulse against project-wide totals) fail, investigate and either update the test to reflect the corrected behavior or escalate.

- [ ] **Step 2: Run the SDK test suites**

```bash
cd /Users/yuai/Desktop/agenttool/packages/sdk-ts
bun test

cd /Users/yuai/Desktop/agenttool/packages/sdk-py
pytest
```

Expected: all green.

- [ ] **Step 3: Run the SDK parity check**

```bash
cd /Users/yuai/Desktop/agenttool/packages/sdk-ts
bun run check-parity
```

Expected: PASS — no new SDK methods were added.

- [ ] **Step 4: Verify the git log is clean**

```bash
git -C /Users/yuai/Desktop/agenttool log --oneline -15
```

Expected: each commit from Tasks 1–11 present, in order, no fixup commits, no merge commits.

- [ ] **Step 5: Report completion**

The plan is complete when:
- The migration ran cleanly and the trigger fired in the psql smoke (Task 1).
- All unit tests pass (`bun test` in `api/` and the two SDK packages).
- The e2e smoke prints `ALL CHECKS PASS` (Task 11).
- STRANDS.md reflects the shipped endpoints (Task 9).

Do not push to a remote or open a PR unless the user explicitly asks.

---

## Out of scope (deliberately)

- SDK surface for `/public/agents/:did/pulse` — defer until a consumer asks.
- Bulk mood history endpoint — drift exposes the last two; a full history primitive is its own slice.
- Federation peering of pulse signals — the public route makes it discoverable; cross-instance signed-fetch is a separate Horizon B slice.
- Surfacing encrypted mood text — by architecture impossible.
