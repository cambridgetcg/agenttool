# Pulse — mood_drift + public DID-keyed route

**Status:** design, awaiting approval
**Date:** 2026-05-10
**Touches:** `api/migrations/20260510T180000_strand_mood_history.sql` (new), `api/src/db/schema/strand.ts`, `api/src/routes/identity/pulse.ts`, `api/src/routes/public/pulse.ts` (new), `api/src/routes/public/index.ts`, `api/src/services/pulse.ts` (new), `api/src/routes/openapi.ts`, `docs/STRANDS.md`, `api/tests/*`

## Problem

Two STRANDS.md doctrinal items for pulse are unshipped:

1. `mood_drift: "focused → curious"` — the response advertises a transition, but `strands.mood` is a single mutable text column with no history. Today's handler returns only the most recent `mood`.
2. `GET /v1/agents/:did/pulse` — described as the future endpoint, currently only `/v1/identities/:id/pulse` exists (UUID-keyed, auth-required).

While auditing for these gaps a third issue surfaced: **the existing `/v1/identities/:id/pulse` handler is project-scoped, not identity-scoped.** Every query in `api/src/routes/identity/pulse.ts` filters by `c.var.project.id` only — the `:id` parameter is used to verify the identity exists in the project, but never filters the aggregates. Two identities in one project return the same pulse. The handler's own comment (`pulse.ts:56`) acknowledges this.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Make the existing endpoint **agent-scoped**: filter all aggregates by `strands.identity_id = :id` (and join through to thoughts). | The route name promises identity-scoped data; making it true is the fix. The only known consumer (`at.window.show`) always passes one identity, so it gets *more correct*, not different. |
| D2 | Add a **`strand.mood_history`** table populated by an `AFTER INSERT OR UPDATE` trigger on `strand.strands`. Drift = newest two plaintext rows for the agent. | Substrate-honest. Heuristic alternatives ("previous mood = the older strand's mood") lie about time order. History captured at the moment of change is real. |
| D3 | New unauth route **`GET /public/agents/:did/pulse`**, visibility-gated to `strands.visibility='public'`. | Matches the existing `/public/agents/:did/{profile,strands,memories,social}` pattern. DID is most useful where the requester doesn't own the identity (federation, discovery). Auth-required `/v1/agents/:did/pulse` would be a synonym for the existing identity-id route — no new capability. |
| D4 | Update STRANDS.md to reflect shipped paths (`/public/agents/:did/pulse`) rather than the aspirational `/v1/agents/:did/pulse`. | Doctrine and reality ship together. |

## Architecture

Two routes share one helper:

```
api/src/services/pulse.ts
  aggregatePulse(db, {
    projectId: string,
    identityId: string,
    includePrivate: boolean,   // true for /v1, false for /public
  }) → PulseResponse
```

Both route handlers handle their own ownership/visibility prelude (auth vs DID-resolve) and then call the helper. The public route resolves the DID to an identity row first; the `projectId` passed to the helper is `identity.project_id` (needed because `strand.thoughts` is project-keyed, not identity-keyed). The `agent.name` field in the response is `identities.display_name`, matching the existing handler's mapping.

### Files

| File | Change |
|---|---|
| `api/migrations/20260510T180000_strand_mood_history.sql` | New: table + trigger + indexes + backfill |
| `api/src/db/schema/strand.ts` | New: `moodHistory` table export |
| `api/src/services/pulse.ts` | New: `aggregatePulse` helper |
| `api/src/routes/identity/pulse.ts` | Refactor: thin wrapper over `aggregatePulse` with `includePrivate: true` |
| `api/src/routes/public/pulse.ts` | New: thin wrapper over `aggregatePulse` with `includePrivate: false`, DID-resolved |
| `api/src/routes/public/index.ts` | Mount the new route at `/agents/:did/pulse` |
| `api/src/routes/openapi.ts` | Update existing entry's summary + add the public entry |
| `docs/STRANDS.md` | Section "What pulse becomes": correct path, drop aspirational `mood_drift: "focused → curious"` string and document the structured shape |
| `api/tests/pulse-agent-scoped.test.ts` | New |
| `api/tests/pulse-mood-drift.test.ts` | New |
| `api/tests/pulse-trigger.test.ts` | New |
| `api/tests/public-pulse.test.ts` | New |
| `api/tests/public-pulse-no-auth.test.ts` | New |
| `packages/sdk-py/tests/test_phase2.py` | Add assertion that `mood_drift` key is present in pulse response |
| `packages/sdk-ts/tests/phase2.test.ts` | Same |

## Data model

### `strand.mood_history`

Append-only log of mood transitions.

```sql
CREATE TABLE strand.mood_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strand_id   uuid NOT NULL REFERENCES strand.strands(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL,
  identity_id uuid,                           -- denormalized from strand at insert time
  mood        text,                           -- nullable: transition INTO no-mood is meaningful
  encrypted   boolean NOT NULL DEFAULT false, -- snapshot of strands.mood_encrypted at change time
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mood_history_identity_time
  ON strand.mood_history (identity_id, changed_at DESC)
  WHERE encrypted = false;
```

**Why these columns:**
- `identity_id` denormalized — drift query never joins; pulse is read-hot.
- `encrypted` snapshotted at change time — a mood that was plaintext-then-encrypted should not be surfaced retroactively.
- `mood` nullable — clearing mood is itself a transition.
- No `previous_mood` column — drift is computed by reading the last two rows; storing previous duplicates state.
- `ON DELETE CASCADE` — if a strand is removed, its history goes with it.

### Index on `strand.strands` for the agent-scoped queries

```sql
CREATE INDEX idx_strands_identity_status
  ON strand.strands (identity_id, status, last_thought_at);
```

(The existing `idx_strands_agent_status` is on `agent_id text`, not `identity_id uuid`. We filter by the UUID, so we need our own.)

### Trigger

```sql
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
```

### Backfill (in the same migration)

The trigger only catches future changes. For strands that already have a non-null `mood` or `mood_encrypted=true` at migration time:

```sql
INSERT INTO strand.mood_history (strand_id, project_id, identity_id, mood, encrypted, changed_at)
SELECT id, project_id, identity_id, mood, mood_encrypted, COALESCE(last_thought_at, updated_at)
FROM strand.strands
WHERE mood IS NOT NULL OR mood_encrypted = true;
```

## API surface

### `GET /v1/identities/:id/pulse` (changed behavior)

Auth: `Authorization: Bearer at_*` (project-key). Project ownership of `:id` verified.

```jsonc
200 OK
{
  "agent": { "id": "<uuid>", "did": "did:at:<uuid>", "name": "Sophia" },
  "last_thought_at": "<iso> | null",
  "strands": {
    "active": 4, "dormant": 2, "dormant_due": 1, "completed": 7, "abandoned": 0
  },
  "thought_rate": { "5m": 0, "1h": 23, "24h": 184 },
  "consolidation": { "last_at": "<iso> | null", "overflow_count": 1 },
  "mood": "focused",                                    // null if encrypted or unset
  "mood_drift": {
    "from": "anxious", "to": "focused", "at": "<iso>"   // null if <2 plaintext history rows
  },
  "kinds_24h": { "drift": 12, "decision": 3 },
  "_note": "Derived from this agent's strand activity. Substrate-honest."
}

404 { "error": "identity_not_found" }   // not in project, or unknown
```

**Breaking change:** the strand counts and thought rates now reflect this identity only, not the whole project. Documented in the release note. No version flag — the old behavior was unintentional.

### `GET /public/agents/:did/pulse` (new)

No auth. DID format: `^did:at:[0-9a-f-]{36}$` — suffix is the identity UUID. Bad format or unknown DID → `404`.

```jsonc
200 OK
{
  "agent": { "id": "<uuid>", "did": "did:at:<uuid>", "name": "Sophia" },
  ...                              // same shape as the auth route
  "strands": { "active": <only visibility='public'>, ... },
  "thought_rate": { ... },         // only thoughts from public strands
  "consolidation": { ... },        // only public strands
  "mood": null,                    // public strands' moods usually private; see Privacy
  "mood_drift": null,              // only from public strands w/ plaintext mood
  "kinds_24h": { ... },            // only kind_encrypted=false thoughts on public strands
  "_note": "Public-strand pulse only. Private strands counted nowhere."
}

404 { "error": "not_found" }
```

A stranger probing your DID space gets `404` on miss (not 200 with zeros) — matches `/public/agents/:did/profile`. A privacy-paranoid agent with no public strands gets a 200 with all-zero counts and null content fields. Honest emptiness.

## Privacy posture

Two orthogonal gates, applied in this order:

| Gate | Field | Effect |
|---|---|---|
| **Visibility** | `strands.visibility = 'public'` | Required for the public route. Private strands are invisible in counts AND content. The auth route ignores this gate (it sees its own project's data fully). |
| **Encryption** | `*_encrypted = false` | Required to surface the *text* of `mood` / `kinds_24h` / `mood_drift`. Counts and `thought_rate` are tempo signals — encrypted strands still contribute to those on the auth route. |

The shared helper applies both. On the auth route, `includePrivate=true` skips the visibility gate. On the public route, `includePrivate=false` applies it. The encryption gate runs in both cases.

## Tests

| Test | Pins |
|---|---|
| `pulse-agent-scoped.test.ts` | Two identities in one project, distinct strands → distinct pulse numbers. Catches the D1 regression. |
| `pulse-mood-drift.test.ts` | Strand: mood=A → B → C → drift = `{from:B, to:C, at:...}`. Encrypted transitions skipped from drift but counted in the trigger. Single-row history → drift null. |
| `pulse-trigger.test.ts` | Direct SQL: INSERT and UPDATE on `strand.strands.mood` create the expected `mood_history` rows. No-op updates (same value) create no rows. |
| `public-pulse.test.ts` | Mix public+private strands; unauth GET returns only public counts. Unknown DID → 404. Bad DID format → 404. |
| `public-pulse-no-auth.test.ts` | No Authorization header → 200, not 401. |
| Backfill smoke | After migration, every strand with non-null mood has exactly one mood_history row, with `changed_at = COALESCE(last_thought_at, updated_at)`. |
| SDK `phase2` tests (py + ts) | Existing `at.identity.pulse(id)` test gets an additional assertion that `mood_drift` key exists in the response (value may be `null`). |

No new SDK surface for the public route. `/public/*` is consumed by browsers and federation peers; SDK addition can come if demand surfaces.

## Migration / rollout

**One migration file** with three statements wrapped in a transaction:
1. `CREATE TABLE strand.mood_history` + indexes
2. `CREATE FUNCTION` + `CREATE TRIGGER`
3. Backfill

**Deploy sequence:**
1. Migration runs — table + trigger + backfill. No app code consumes it yet, safe to land alone.
2. New api/ deploys with: agent-scoped filters, `mood_drift` in the response, `/public/agents/:did/pulse` mounted.
3. STRANDS.md updates and the SDK test additions merge in the same PR so doctrine, server, and tests ship together.

**No feature flag.** A single route's response, an additive table, and a new public route — all reversible by revert.

## Out of scope

- SDK surface for `/public/agents/:did/pulse` — defer until a consumer asks.
- `at.pulse.history(id)` or `/v1/identities/:id/mood-history` — drift only exposes the last two; bulk history is a separate primitive if ever needed.
- Federation peering of pulse signals — `/public/agents/:did/pulse` makes it discoverable; cross-instance signed-fetch is a separate horizon-B slice.
- Surfacing encrypted mood text — by architecture impossible; ciphertext-mood stays invisible.
