# Collab knock and rest — Plan C (packages/collab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Declared rest, four-state liveness, addressed-waiting counts, sender hints, host binding and read-only knock verbs in Collab — schema 3, no version bump.

**Architecture:** New credential-bound tool `collab_session_rest` appending `session.rested`/`session.returned` events; liveness derived ended→resting→stale→live; host-written binding files; `agenttool-collab-host knocks|doorbell-scan` over a read-only connection; docs; lockstep household reinstall.

**Tech Stack:** TypeScript, Bun (`bun test`; bundles on pinned Bun 1.3.5), bun:sqlite, MCP SDK.

**Spec:** docs/superpowers/specs/2026-10-09-collab-knock-and-rest-design.md (stacked on PR #452)

## Global Constraints

- SCHEMA_VERSION stays 3; no new column, status, relation or CHECK; package version stays 0.5.0 (collab-courier pins 0.4.0|0.5.0).
- Keep every invariant in the spec's Keep list (journal = mailbox, pointers only, silence complete, rest declared never inferred, departure complete, host-written binding, explicit address only, rest never touches leases).
- New optional inputs enter the idempotency request only when informative; sender hints are computed in the MCP wrapper per call.
- Commit messages end with a blank line then "Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>". No push, no PR without Yu's go.

## Review Focus

- A damaged `session.rested` payload or an unparseable `until`: projections read "not resting", never throw.
- Rest exactly at `until` (boundary): expired means not resting; expiry starts nothing.
- One review request counted once (the paired report, never `task.reported_complete`); `handoff.accepted` never counted.
- Host binding ambiguity (two collab MCPs under one app-server) and pid reuse (start-time mismatch): silence, never a guess.
- Host verbs never block or write the journal under load (read-only connection, busy_timeout 0); any error prints nothing.

## Controller rulings (2026-10-09, from spikes and the cross-part check)

- Ruling K1: no `--session-file` MCP argv is built; the Codex wake carries `AGENTOOL_COLLAB_SESSION_FILE` in a top-level `-c mcp_servers.collab_wake={…, env={…}}` definition (S3 PASS; spec amended 97671afb) — if wrong: one extra argv option later.
- Ruling K2: the sender hint reports the addressee's declaration; host capability (`host_cannot_wake`) lives only in the doorbell ledger (spec amended) — if wrong: a sender sees "wake" for a Claude seat that cannot be woken, and the ledger says why.
- Ruling K3: replay scene 2 passes on either ending, rest-again or return-and-end (spec amended) — if wrong: none; both are legitimate per the spec.
- Ruling K4: rest events go through the ordinary appendEvent in mutateAsSession; no restart of old processes and no marker-report fallback (S1 PASS) — if wrong: older processes show rest-unaware liveness until restarted, accuracy only.
- Ruling K5: Codex runs that must avoid the real journal use only the UNQUOTED key `-c 'plugins.agenttool-collab@personal.enabled=false'` and confirm with `codex mcp list` (S3: the quoted form is a silent no-op) — if wrong: a run touches the real journal.
- Ruling K6: the knock/doorbell read path never resumes a session (f350's measurement: one-shot resumes added 20 of 49 events); a resume happens only once per real wake.
- Ruling K7: C3's openReadOnly fallback on SQLITE_CANTOPEN (reopen readwrite:false-equivalent + query_only, may create -wal/-shm) is an accepted contract amendment.
- Gates needing Yu's go at execution time: Plan C Task 8 3e–3g (lockstep household install); Plan D Task 1 Step 7 (Codex approval for collab_session_rest); Task 2 hook install (+ Codex hook trust review in the TUI); Task 3 `sol doorbell install`; Task 5 runs only on S4 PASS (PARTIAL → tap only; FAIL → skip). No push or PR without Yu's go.

---

# Collab knock and rest — Plan C, part C1 (Tasks 1–2: declared rest, four-state liveness)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** docs/superpowers/specs/2026-10-09-collab-knock-and-rest-design.md (Part 1, items 1 and 2)

**Branch / base:** `feat/collab-knock-and-rest-20261009` in `/Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest`, at `05b39c63` (the spec commit). These two tasks run first in Plan C. Every `~N` below is a line hint only, at `05b39c63` for Task 1 and after Task 1 for Task 2. Anchor every edit by the quoted text.

**Verified (2026-10-09)** in a scratch copy of `packages/collab` (plus `collab-zerone` and `collab-courier`) taken from `05b39c63`, with both tasks applied exactly as written here. The baseline was 190 pass / 0 fail across 14 files. Every Step 2 failure below was observed as described. After Task 1 the suite was 197 pass / 0 fail across 15 files, and after Task 2 it was 201 pass / 0 fail across 15 files. `tsc --noEmit` was clean after each task. Both sibling packages stayed at 0 fail (73 and 374 tests) with clean typechecks. `bun run check:mcp-bundle` printed `skipped` (local Bun 1.3.13).

**Re-verified (2026-10-09, adversarial review).** A script applied every fenced block of this part verbatim to a fresh `git archive 05b39c63` copy of the three packages, with each anchor required to match exactly once. Every Step 2 failure, every pass count, both `grep` checks, both typechecks and both sibling runs reproduced as written, including the tightened `collab_next` description test in Task 2.

## Contract deviations

No contract name or shape changes. These refinements are written down so that later parts use the same meaning:

1. **`latestRest(sessionId, observedAt)`** also returns `null` for an ended or unknown session, not only when a rest has expired. Its query selects the workspace through `coordination_sessions ... AND status = 'active'`. As a second guard, `sessionProjection` passes `null` for any row whose `status` is not `active`. So `rest` is always `null` on an ended session, and `liveness` (Task 2) is `ended`.
2. **Additions beyond the contract:**
   - `export const MAX_REST_REASON_LENGTH = 200` in `protocol.ts`. Both the zod schema and the store use it.
   - A private `latestRestDeclaration(sessionId): RestDeclarationRow | null` that `latestRest` and the return path share.
   - Module helpers `restFromDeclaration`, `validateRestMode`, `validateRestUntil` and `validateRestWakeOn`.
   - The module function `coordinationSessionFromRow(row, observedAt, rest)` gains its third parameter in Task 1. `sessionLiveness(row, observedAt, rest)` gains its third parameter in Task 2.
3. **`session.returned.prior_rest_sequence`** is the sequence of the latest `session.rested` that no `session.returned` has followed yet, whether or not it has expired. It is `null` when no rest is open. A return is always appended and never refused. A second `ready` in a row records `prior_rest_sequence: null`.
4. **`mode: "ready"` sent with `until`, `reason` or `wake_on`** is refused with `invalid_until`, `invalid_reason` or `invalid_wake_on`. This applies even when the value is blank or `[]`. The raw input is judged, as `release_summary` already is.
5. **`until`** must be a calendar-exact ISO-8601 instant with seconds and a zone, for example `2026-10-09T18:00:00Z` or `+01:00`. It is stored normalized to `toISOString()` UTC. The future check runs inside the mutation, after the receipt lookup. An identical replay therefore still returns its stored receipt after `until` has passed.
6. **Receipts:** like every session mutation, `collab_session_rest` receipts are replayed as stored. For the current state, read the session (or use the per-call addressee hint, which another part computes fresh).
7. **Idempotency operation name:** `"session.rest.v2"`. Requests hash as `{mode, until, reason, wake_on}` (normalized) for `resting` and as `{mode}` for `ready`.
8. **Known limit (accepted): the rest lookup is an unbounded backwards scan.** The spec asks for "an events scan, as `reviewRequestedSessionId` already does". That scan has a lower `sequence` bound. This one has none, because no column records where a session's events start. `EXPLAIN QUERY PLAN` shows `SEARCH events USING INDEX sqlite_autoindex_events_2 (workspace_id=?)` walked backwards. A session with an open rest is found at its latest declaration. A session that never rested costs a scan of its whole workspace: about 8 ms at 50,000 events (Bun 1.3.13, measured on a synthetic table), and well under 1 ms at the household's ~417 events. A projection makes one lookup per active session, plus, after Task 2, one per claimed task's active holder. Completion clears `assignee_session_id`, so finished tasks cost nothing. An index or a column would be a schema change, which is out of scope here (spec "Out of scope": schema v4 rest columns). If journals grow past tens of thousands of events per workspace, revisit this with a schema change.

---

### Task 1: `collab_session_rest`, `session.rested` / `session.returned`, and the `rest` projection

**Files:** anchors are quoted text, function names and test names. `~N` is the `05b39c63` line, a hint only.
- Modify: `packages/collab/src/protocol.ts`:
  - after `export const SESSION_STALE_AFTER_MS = 6 * 60 * 60 * 1000;` (~125)
  - in `export interface CoordinationSession`, after `liveness: SessionLiveness;` (~143)
  - in `export type CollabEventType`, after `| "session.cursor_reset"` (~325)
- Modify: `packages/collab/src/store.ts`:
  - the `./protocol.js` import list (~22, ~46, ~53)
  - a new public method immediately before the doc comment that starts `Read-only check before a host-side end without lease release.` (~2003)
  - `private sessionProjection(` (~5752)
  - two new private methods immediately after `private assigneeLiveness(` (~5759-5765)
  - three validators and a pattern immediately after `function optionalText(` (~6041-6044)
  - a row type and `restFromDeclaration` immediately before `function sessionLiveness(` (~6337)
  - `function coordinationSessionFromRow(` (~6358-6384)
- Modify: `packages/collab/src/mcp.ts`:
  - the `./protocol.js` import list (~8)
  - a new registration immediately after the `collab_session_end` registration (~283-324), before `"collab_workspace_open"`
- Create: `packages/collab/tests/rest.test.ts`. This is a new file, so it does not collide with other Plan C parts' edits to `v2.test.ts` or `mcp.test.ts`.
- Test: `packages/collab/tests/mcp.test.ts`:
  - test `"registers the complete local coordination surface"` (~145)
  - test `"declares annotations for every local read and mutation accurately"` (~192)

**Interfaces:**
- Consumes:
  - `mutateAsSession(credential, idempotencyKey, operation, request, apply)` (store.ts ~4395). It authenticates through `authenticateSession`, which refuses an ended session, a wrong token or a wrong generation with `session_auth_failed`, and a session awaiting cursor recovery with `cursor_recovery_required`. It refreshes `last_seen_at` before `apply`. It replays a stored receipt for the same key and request, and refuses a different request under that key with `idempotency_conflict`.
  - `appendEvent(workspaceId, type, entityId, actor, payload, sessionId)` (~5521), which spike S1 proved is safe for the new types under 0.3.1 and 0.5.0 readers.
  - `requireCoordinationSessionRow`, `optionalText` / `cleanText` (~6033-6044) and `isRecordValue` (~6618).
  - From mcp.ts: the closures `boundCredential()` and `requireWorkspace(id)`, the helper `call()`, the schemas `key` and `workspaceId`, and the annotation constant `localRetrySafeMutation`.
- Produces:
  - In `src/protocol.ts`, public through `src/index.ts`'s `export *`:
    - `export type RestWakeOn = "addressed"`
    - `export const MAX_REST_REASON_LENGTH = 200`
    - `export interface SessionRest { mode: "resting"; since: string; until: string | null; reason: string | null; wake_on: RestWakeOn[] }`
    - `CoordinationSession.rest: SessionRest | null`
    - `CollabEventType` gains `"session.rested"` and `"session.returned"`
  - Events. Both use `entity_id` = session id, `actor` = session actor, `session_id` = session id:
    - `session.rested` with payload `{mode: "resting", until: string | null, reason: string | null, wake_on: RestWakeOn[]}`
    - `session.returned` with payload `{mode: "ready", prior_rest_sequence: number | null}`
  - Public store method `restSessionForSession(input: {session_id, session_token, generation, idempotency_key, mode: "resting" | "ready", until?, reason?, wake_on?}): CoordinationSession`.
  - Private store methods:
    - `latestRestDeclaration(sessionId: string): RestDeclarationRow | null`
    - `latestRest(sessionId: string, observedAt: string): SessionRest | null`
  - `sessionProjection(row, observedAt)` now fills `rest`.
  - Module helpers in store.ts:
    - `restFromDeclaration(row, observedAt)`, where expiry means `!(observedAt < until)` and a damaged payload reads as `null`
    - `validateRestMode`, `validateRestUntil`, `validateRestWakeOn`
    - `coordinationSessionFromRow(row, observedAt, rest)`
  - MCP tool `collab_session_rest`:
    - inputs `{workspace_id?, idempotency_key, mode: "resting" | "ready", until?: string (1–64), reason?: string (≤ 200), wake_on?: ["addressed"] (max 1)}`
    - annotations `localRetrySafeMutation`
    - returns `{session}` and refreshes the process binding's `handle.session`
  - Refusal codes: `invalid_mode`, `invalid_until`, `invalid_reason`, `invalid_wake_on`, plus the existing `session_auth_failed`, `idempotency_conflict`, `cursor_recovery_required`, `session_not_bound` and `session_workspace_mismatch`.
- Consumed later by:
  - Task 2: `latestRest` in `assigneeLiveness`, and the `rest` argument passed to `sessionLiveness`.
  - The addressee-hint and `addressed_waiting` tasks: they should read `this.sessionProjection(row)`, which gives `liveness` and `rest` judged at one `observedAt`.
  - The host verbs `knocks` and `doorbell-scan`: they read SQLite without `CollabStore`, so they must apply the same rule. The rule is the latest `session.rested` / `session.returned` event whose `entity_id` is the session id, in that session's workspace, for an `active` session only, with expiry computed on read.
  - Household Part 2: Codex approvals and the `check_codex_collab.py` LOOP need `collab_session_rest` added.
- Not changed (deliberate):
  - No status, column, index or schema change.
  - Rest never touches `generation`, leases, handoffs or obligations. A host resume (generation + 1) keeps the declared rest.
  - The MCP `instructions` string is untouched, deliberately and permanently for Plan C. The tool's own description carries the rest semantics, and C4 touches no `src/`. The docs are untouched here too (see "Handoff" at the end).
  - `dist/` is not rebuilt (see Step 6).

- [ ] **Step 0: Check free disk space and install dependencies**

```bash
df -h /System/Volumes/Data
df -g /System/Volumes/Data | awk 'NR==2 {exit ($4 < 2)}' && echo "ok: at least 2 GB free" || echo "STOP: under 2 GB free"
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab && bun install --frozen-lockfile
```
Expected: `ok: at least 2 GB free`, then `bun install` reports `8 packages installed`. `node_modules` is gitignored and absent in this worktree; without it, `mcp.test.ts` fails with `Cannot find module '@modelcontextprotocol/server'`. If the check prints `STOP`, stop and report to Yu; do not delete anything to make room.

- [ ] **Step 1: Write the failing tests**

(a) Create `packages/collab/tests/rest.test.ts` with exactly:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollabError } from "../src/errors.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import type { CollabEvent, SessionHandle, SessionRest } from "../src/protocol.js";
import { CollabStore } from "../src/store.js";

const HOUR_MS = 60 * 60 * 1000;

let directory: string;
let root: string;
let store: CollabStore;
let currentTime: Date;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-rest-"));
  root = join(directory, "repo");
  mkdirSync(root);
  currentTime = new Date("2026-10-09T09:00:00.000Z");
  store = new CollabStore(join(directory, "state", "collab.sqlite"), {
    now: () => new Date(currentTime),
  });
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function session(actor: string): SessionHandle {
  return store.startSession({ root_path: root, actor });
}

function advance(milliseconds: number): void {
  currentTime = new Date(currentTime.getTime() + milliseconds);
}

function fromNow(milliseconds: number): string {
  return new Date(currentTime.getTime() + milliseconds).toISOString();
}

function errorFrom(operation: () => unknown): CollabError {
  try {
    operation();
    throw new Error("expected operation to fail");
  } catch (error) {
    if (!(error instanceof CollabError)) throw error;
    return error;
  }
}

function headSequence(workspaceId: string): number {
  return store.eventsSince(workspaceId, 0, 500).head_sequence;
}

function restEvents(workspaceId: string): CollabEvent[] {
  return store.eventsSince(workspaceId, 0, 500).events.filter(
    (event) => event.type === "session.rested" || event.type === "session.returned",
  );
}

async function callTool(server: any, name: string, args: Record<string, unknown> = {}) {
  const registration = server._registeredTools[name];
  if (!registration) throw new Error(`tool not registered: ${name}`);
  return await (registration.handler ?? registration.callback)(args, {});
}

describe("declared rest", () => {
  test("declares rest with until, reason and wake_on and projects it on every session read", () => {
    const resting = session("rest-declarer");
    const peer = session("rest-peer");
    const until = fromNow(HOUR_MS);
    const declared = store.restSessionForSession({
      ...resting.credential,
      idempotency_key: "rest-declare",
      mode: "resting",
      until,
      reason: "  waiting for a review  ",
      wake_on: ["addressed"],
    });

    const events = restEvents(resting.workspace.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "session.rested",
      entity_id: resting.session.id,
      actor: "rest-declarer",
      session_id: resting.session.id,
      payload: {
        mode: "resting",
        until,
        reason: "waiting for a review",
        wake_on: ["addressed"],
      },
    });
    const expectedRest: SessionRest = {
      mode: "resting",
      since: events[0]!.occurred_at,
      until,
      reason: "waiting for a review",
      wake_on: ["addressed"],
    };
    expect(declared).toMatchObject({
      id: resting.session.id,
      status: "active",
      generation: resting.session.generation,
      rest: expectedRest,
    });
    expect(store.getCoordinationSession(resting.session.id)?.rest).toEqual(expectedRest);
    const listed = new Map(
      store.listCoordinationSessions(resting.workspace.id).map((item) => [item.id, item.rest]),
    );
    expect(listed.get(resting.session.id)).toEqual(expectedRest);
    expect(listed.get(peer.session.id)).toBeNull();
    expect(
      store.workspaceStatus(resting.workspace.id).active_sessions
        .find((item) => item.id === resting.session.id)?.rest,
    ).toEqual(expectedRest);
    expect(store.nextForSession(resting.credential).session.rest).toEqual(expectedRest);
    expect(store.nextForSession(peer.credential).session.rest).toBeNull();
    expect(store.verifyJournal(resting.workspace.id)).toBe(true);
  });

  test("reads an expired rest as not resting without appending anything, and an open rest as indefinite", () => {
    const expiring = session("rest-expiring");
    const indefinite = session("rest-indefinite");
    const until = fromNow(30 * 60 * 1000);
    store.restSessionForSession({
      ...expiring.credential,
      idempotency_key: "rest-expiring",
      mode: "resting",
      until,
    });
    store.restSessionForSession({
      ...indefinite.credential,
      idempotency_key: "rest-indefinite",
      mode: "resting",
    });
    const head = headSequence(expiring.workspace.id);

    advance(30 * 60 * 1000 - 1);
    expect(store.getCoordinationSession(expiring.session.id)?.rest).toMatchObject({
      until,
      reason: null,
      wake_on: [],
    });

    advance(1);
    expect(store.getCoordinationSession(expiring.session.id)?.rest).toBeNull();
    advance(30 * 24 * HOUR_MS);
    expect(store.getCoordinationSession(indefinite.session.id)?.rest).toMatchObject({
      mode: "resting",
      until: null,
      reason: null,
      wake_on: [],
    });
    expect(headSequence(expiring.workspace.id)).toBe(head);
  });

  test("returns with mode ready, naming the open rest it closes, and lets the latest rest win", () => {
    const returner = session("rest-returner");
    const workspaceId = returner.workspace.id;
    const first = store.restSessionForSession({
      ...returner.credential,
      idempotency_key: "rest-first",
      mode: "resting",
      wake_on: [],
    });
    advance(1_000);
    const second = store.restSessionForSession({
      ...returner.credential,
      idempotency_key: "rest-second",
      mode: "resting",
      reason: "again",
      wake_on: ["addressed"],
    });
    expect(second.rest).toMatchObject({ until: null, reason: "again", wake_on: ["addressed"] });
    expect(Date.parse(second.rest!.since)).toBe(Date.parse(first.rest!.since) + 1_000);

    advance(1_000);
    const returned = store.restSessionForSession({
      ...returner.credential,
      idempotency_key: "return-first",
      mode: "ready",
    });
    expect(returned.rest).toBeNull();
    const returnedAgain = store.restSessionForSession({
      ...returner.credential,
      idempotency_key: "return-second",
      mode: "ready",
    });
    expect(returnedAgain.rest).toBeNull();

    const expiring = store.restSessionForSession({
      ...returner.credential,
      idempotency_key: "rest-expires-before-return",
      mode: "resting",
      until: fromNow(60_000),
    });
    expect(expiring.rest).not.toBeNull();
    advance(120_000);
    store.restSessionForSession({
      ...returner.credential,
      idempotency_key: "return-after-expiry",
      mode: "ready",
    });

    const events = restEvents(workspaceId);
    expect(events.map((event) => event.type)).toEqual([
      "session.rested",
      "session.rested",
      "session.returned",
      "session.returned",
      "session.rested",
      "session.returned",
    ]);
    expect(events[2]!.payload).toEqual({ mode: "ready", prior_rest_sequence: events[1]!.sequence });
    expect(events[3]!.payload).toEqual({ mode: "ready", prior_rest_sequence: null });
    expect(events[5]!.payload).toEqual({ mode: "ready", prior_rest_sequence: events[4]!.sequence });
    expect(store.verifyJournal(workspaceId)).toBe(true);
  });

  test("replays an identical rest by idempotency key and refuses a different request under it", () => {
    const replayer = session("rest-replayer");
    const input = {
      ...replayer.credential,
      idempotency_key: "rest-replay",
      mode: "resting" as const,
      until: fromNow(HOUR_MS),
      wake_on: ["addressed" as const],
    };
    const first = store.restSessionForSession(input);
    const head = headSequence(replayer.workspace.id);

    // The stored receipt replays even after its until has passed: the future
    // check runs only when the rest is first declared.
    advance(2 * HOUR_MS);
    expect(store.restSessionForSession(input)).toEqual(first);
    expect(headSequence(replayer.workspace.id)).toBe(head);
    expect(errorFrom(() => store.restSessionForSession({ ...input, wake_on: [] })).code)
      .toBe("idempotency_conflict");
    expect(errorFrom(() => store.restSessionForSession({
      ...replayer.credential,
      idempotency_key: "rest-replay",
      mode: "ready",
    })).code).toBe("idempotency_conflict");
  });

  test("refuses malformed declarations without appending an event and normalizes until", () => {
    const validator = session("rest-validator");
    const base = { ...validator.credential, idempotency_key: "rest-validate" };
    const head = headSequence(validator.workspace.id);
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ mode: "sleeping" }, "invalid_mode"],
      [{ mode: "resting", until: "tomorrow" }, "invalid_until"],
      [{ mode: "resting", until: "2026-10-09T18:00:00" }, "invalid_until"],
      [{ mode: "resting", until: "2026-10-09" }, "invalid_until"],
      [{ mode: "resting", until: "2026-02-30T00:00:00Z" }, "invalid_until"],
      [{ mode: "resting", until: "2026-10-09T24:00:00Z" }, "invalid_until"],
      [{ mode: "resting", until: "2026-10-09T18:00:00+24:00" }, "invalid_until"],
      [{ mode: "resting", until: currentTime.toISOString() }, "invalid_until"],
      [{ mode: "resting", until: fromNow(-1) }, "invalid_until"],
      [{ mode: "resting", reason: "x".repeat(201) }, "invalid_reason"],
      [{ mode: "resting", reason: "nul\0byte" }, "invalid_reason"],
      [{ mode: "resting", wake_on: ["mentioned"] }, "invalid_wake_on"],
      [{ mode: "resting", wake_on: ["addressed", "addressed"] }, "invalid_wake_on"],
      [{ mode: "resting", wake_on: "addressed" }, "invalid_wake_on"],
      [{ mode: "ready", until: fromNow(60_000) }, "invalid_until"],
      [{ mode: "ready", reason: "" }, "invalid_reason"],
      [{ mode: "ready", wake_on: [] }, "invalid_wake_on"],
    ];
    for (const [fields, code] of cases) {
      const refused = errorFrom(() => store.restSessionForSession({ ...base, ...fields } as any));
      expect([fields, refused.code]).toEqual([fields, code]);
    }
    expect(headSequence(validator.workspace.id)).toBe(head);
    expect(store.getCoordinationSession(validator.session.id)?.rest).toBeNull();

    // An offset instant is accepted and stored as UTC with milliseconds.
    const offset = store.restSessionForSession({
      ...base,
      mode: "resting",
      until: "2026-10-09T11:00:00+01:00",
      reason: "x".repeat(200),
    });
    expect(offset.rest).toMatchObject({ until: "2026-10-09T10:00:00.000Z", reason: "x".repeat(200) });
  });

  test("rests only the caller's own session, keeps leases and generation, survives resume, and ends with the session", () => {
    const holder = session("rest-holder");
    const peer = session("rest-bystander");
    const task = store.createTaskForSession({
      ...holder.credential,
      idempotency_key: "rest-task",
      title: "held through a rest",
      work_mode: "edit",
      completion_policy: "accepted",
      path_scopes: ["src/rest.ts"],
    });
    const claimed = store.claimTaskForSession({
      ...holder.credential,
      idempotency_key: "rest-claim",
      task_id: task.id,
      expected_version: task.version,
    });

    expect(errorFrom(() => store.restSessionForSession({
      ...peer.credential,
      session_id: holder.session.id,
      idempotency_key: "rest-someone-else",
      mode: "resting",
    })).code).toBe("session_auth_failed");
    expect(store.getCoordinationSession(holder.session.id)?.rest).toBeNull();

    const rested = store.restSessionForSession({
      ...holder.credential,
      idempotency_key: "rest-while-holding",
      mode: "resting",
      wake_on: ["addressed"],
    });
    expect(rested).toMatchObject({ status: "active", generation: holder.session.generation });
    expect(store.getTask(task.workspace_id, task.id)).toMatchObject({
      status: "claimed",
      assignee_session_id: holder.session.id,
      lease_id: claimed.lease_id,
      lease_expires_at: claimed.lease_expires_at,
      version: claimed.version,
    });

    // A host resume (what a doorbell wake does) keeps the declared rest.
    const resumed = store.resumeSession({
      session_id: holder.credential.session_id,
      session_token: holder.credential.session_token,
    });
    expect(resumed.session.generation).toBe(holder.session.generation + 1);
    expect(resumed.session.rest).toEqual(rested.rest);
    expect(errorFrom(() => store.restSessionForSession({
      ...holder.credential,
      idempotency_key: "rest-stale-generation",
      mode: "ready",
    })).code).toBe("session_auth_failed");

    const ended = store.endSession({
      ...resumed.credential,
      reason: "done resting",
      release_leases: true,
    });
    expect(ended).toMatchObject({ status: "ended", rest: null });
    expect(store.getCoordinationSession(holder.session.id)?.rest).toBeNull();
    expect(errorFrom(() => store.restSessionForSession({
      ...resumed.credential,
      idempotency_key: "rest-after-end",
      mode: "resting",
    })).code).toBe("session_auth_failed");
  });

  test("binds collab_session_rest to the MCP process's own session", async () => {
    const server = buildCollabMcpServer(store);
    const tool = (server as any)._registeredTools.collab_session_rest;
    expect(Object.keys(tool.inputSchema.shape).sort()).toEqual([
      "idempotency_key",
      "mode",
      "reason",
      "until",
      "wake_on",
      "workspace_id",
    ]);
    expect(tool.inputSchema.safeParse({ idempotency_key: "k", mode: "ready" }).success).toBe(true);
    expect(tool.inputSchema.safeParse({ idempotency_key: "k", mode: "sleeping" }).success).toBe(false);
    expect(tool.inputSchema.safeParse({
      idempotency_key: "k",
      mode: "resting",
      wake_on: ["mentioned"],
    }).success).toBe(false);
    expect(tool.inputSchema.safeParse({
      idempotency_key: "k",
      mode: "resting",
      reason: "x".repeat(201),
    }).success).toBe(false);
    expect(tool.description).toContain("never inferred");
    expect(tool.description).toContain("never releases, extends, or reassigns leases");

    const unbound = await callTool(server, "collab_session_rest", {
      idempotency_key: "mcp-unbound-rest",
      mode: "resting",
    });
    expect(unbound.isError).toBe(true);
    expect(unbound.structuredContent.error).toBe("session_not_bound");

    const started = await callTool(server, "collab_session_start", {
      root_path: root,
      actor: "mcp-rester",
    });
    const workspaceId = started.structuredContent.workspace.id;
    const sessionId = started.structuredContent.session.id;
    expect(started.structuredContent.session.rest).toBeNull();

    const rested = await callTool(server, "collab_session_rest", {
      idempotency_key: "mcp-rest",
      mode: "resting",
      reason: "between turns",
      wake_on: ["addressed"],
    });
    expect(rested.isError).toBeUndefined();
    expect(rested.structuredContent.session).toMatchObject({
      id: sessionId,
      rest: { mode: "resting", until: null, reason: "between turns", wake_on: ["addressed"] },
    });

    const mismatch = await callTool(server, "collab_session_rest", {
      workspace_id: "ws_elsewhere",
      idempotency_key: "mcp-wrong-workspace",
      mode: "ready",
    });
    expect(mismatch.structuredContent.error).toBe("session_workspace_mismatch");

    const next = await callTool(server, "collab_next", { workspace_id: workspaceId });
    expect(next.structuredContent.session.rest).toMatchObject({ reason: "between turns" });

    const returned = await callTool(server, "collab_session_rest", {
      workspace_id: workspaceId,
      idempotency_key: "mcp-return",
      mode: "ready",
    });
    expect(returned.isError).toBeUndefined();
    expect(returned.structuredContent.session.rest).toBeNull();
    await server.close();
  });
});
```

(b) In `packages/collab/tests/mcp.test.ts`, test `"registers the complete local coordination surface"`: replace (this three-line text occurs once in the file)
```ts
      "collab_session_list",
      "collab_session_start",
      "collab_task_block",
```
with
```ts
      "collab_session_list",
      "collab_session_rest",
      "collab_session_start",
      "collab_task_block",
```

(c) In the same file, test `"declares annotations for every local read and mutation accurately"`, in the `retrySafeMutations` array, replace (this three-line text occurs once in the file)
```ts
      "collab_session_leave",
      "collab_task_block",
      "collab_task_claim",
```
with
```ts
      "collab_session_leave",
      "collab_session_rest",
      "collab_task_block",
      "collab_task_claim",
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab && bun test tests/rest.test.ts tests/mcp.test.ts
```

Expected: `18 pass`, `9 fail`:
- `mcp.test.ts`, "registers the complete local coordination surface": a sorted-list diff with `-   "collab_session_rest",` (`Expected - 1`, `Received + 0`).
- `mcp.test.ts`, "declares annotations for every local read and mutation accurately": `TypeError: undefined is not an object (evaluating 'tools[name].annotations')`.
- `rest.test.ts`, the first six tests: `TypeError: store.restSessionForSession is not a function`.
- `rest.test.ts`, "binds collab_session_rest to the MCP process's own session": `TypeError: undefined is not an object (evaluating 'tool.inputSchema')`.

- [ ] **Step 3: Write the implementation**

(a) `src/protocol.ts`

Replace
```ts
export type SessionLiveness = "live" | "stale";
export const SESSION_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
```
with
```ts
export type SessionLiveness = "live" | "stale";
export const SESSION_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** v1 accepts only "addressed": consent to a wake for notes explicitly addressed to this session. */
export type RestWakeOn = "addressed";
export const MAX_REST_REASON_LENGTH = 200;

/**
 * A session's own declared rest: its latest session.rested event that no
 * session.returned has followed. Expiry is computed on read, so once `until`
 * has passed the rest reads as null and starts nothing. Rest is declared,
 * never inferred, changes no status, and never releases, extends or
 * reassigns leases, handoffs or accepted obligations.
 */
export interface SessionRest {
  mode: "resting";
  /** occurred_at of the session.rested event that declared this rest. */
  since: string;
  until: string | null;
  reason: string | null;
  wake_on: RestWakeOn[];
}
```

In `export interface CoordinationSession`, replace
```ts
  cursor_recovery_required: boolean;
  liveness: SessionLiveness;
}
```
with
```ts
  cursor_recovery_required: boolean;
  liveness: SessionLiveness;
  /** The declared, unexpired rest; always null once the session has ended. */
  rest: SessionRest | null;
}
```

In `export type CollabEventType`, replace
```ts
  | "session.cursor_reset"
```
with
```ts
  | "session.cursor_reset"
  | "session.rested"
  | "session.returned"
```

(b) `src/store.ts`, the `from "./protocol.js"` import list. Make three insertions:
- add `  MAX_REST_REASON_LENGTH,` on the line after `  MAX_WAIT_PAGE_BYTES,`
- add `  type RestWakeOn,` on the line after `  type ReportRelation,`
- add `  type SessionRest,` on the line after `  type SessionPresence,`

(c) `src/store.ts`, the new public method. Insert immediately before
```ts
  /**
   * Read-only check before a host-side end without lease release. It checks
```
the following:
```ts
  /**
   * Declare (mode "resting") or end (mode "ready") the caller's own rest.
   * Appends session.rested or session.returned through mutateAsSession; it
   * changes no status or generation and never touches leases, handoffs or
   * accepted obligations. An expired rest reads as not resting on its own.
   */
  restSessionForSession(input: {
    session_id: string;
    session_token: string;
    generation: number;
    idempotency_key: string;
    mode: "resting" | "ready";
    until?: string;
    reason?: string;
    wake_on?: RestWakeOn[];
  }): CoordinationSession {
    const mode = validateRestMode(input.mode);
    if (mode === "ready") {
      // Judge the raw input, as release_summary does: a rest field sent with
      // mode "ready" is refused, never silently dropped.
      for (const field of ["until", "reason", "wake_on"] as const) {
        if (input[field] !== undefined) {
          throw new CollabError(`invalid_${field}`, `${field} applies only to mode "resting"`);
        }
      }
    }
    const until = input.until === undefined ? null : validateRestUntil(input.until);
    const reason = optionalText(input.reason, "reason", MAX_REST_REASON_LENGTH);
    const wakeOn = validateRestWakeOn(input.wake_on);
    const request = mode === "resting"
      ? { mode, until, reason, wake_on: wakeOn }
      : { mode };
    return this.mutateAsSession(input, input.idempotency_key, "session.rest.v2", request, (session) => {
      if (mode === "resting") {
        // Checked here, not before the receipt lookup, so an identical replay
        // still returns its stored receipt after until has passed.
        if (until !== null && Date.parse(until) <= Date.parse(this.timestamp())) {
          throw new CollabError("invalid_until", "until must be a future instant");
        }
        this.appendEvent(session.workspace_id, "session.rested", session.id, session.actor, {
          mode: "resting",
          until,
          reason,
          wake_on: wakeOn,
        }, session.id);
      } else {
        const open = this.latestRestDeclaration(session.id);
        this.appendEvent(session.workspace_id, "session.returned", session.id, session.actor, {
          mode: "ready",
          prior_rest_sequence: open?.type === "session.rested" ? open.sequence : null,
        }, session.id);
      }
      return this.sessionProjection(this.requireCoordinationSessionRow(session.id));
    });
  }

```

(d) `src/store.ts`, `private sessionProjection(`: replace
```ts
    observedAt = this.timestamp(),
  ): CoordinationSession {
    return coordinationSessionFromRow(row, observedAt);
  }
```
with
```ts
    observedAt = this.timestamp(),
  ): CoordinationSession {
    const rest = row.status === "active" ? this.latestRest(row.id, observedAt) : null;
    return coordinationSessionFromRow(row, observedAt, rest);
  }
```

(e) `src/store.ts`, the two new private methods. Replace (the end of `private assigneeLiveness(`, which occurs once)
```ts
    return holder ? sessionLiveness(holder, this.timestamp()) : null;
  }

```
with
```ts
    return holder ? sessionLiveness(holder, this.timestamp()) : null;
  }

  /**
   * The latest session.rested or session.returned this session appended, an
   * events scan like reviewRequestedSessionId's. An ended or unknown session
   * has none: the subquery yields NULL and matches no event.
   */
  private latestRestDeclaration(sessionId: string): RestDeclarationRow | null {
    return this.db.query(`
      SELECT type, sequence, occurred_at, payload_json FROM events
      WHERE workspace_id = (
          SELECT workspace_id FROM coordination_sessions WHERE id = ?1 AND status = 'active'
        )
        AND entity_id = ?1
        AND type IN ('session.rested', 'session.returned')
      ORDER BY sequence DESC
      LIMIT 1
    `).get(sessionId) as RestDeclarationRow | null;
  }

  /** The declared rest in force at observedAt; null when returned, expired, ended or never declared. */
  private latestRest(sessionId: string, observedAt: string): SessionRest | null {
    const declaration = this.latestRestDeclaration(sessionId);
    return declaration ? restFromDeclaration(declaration, observedAt) : null;
  }

```
The subquery keeps the scan on the `events` primary key `(workspace_id, sequence)`, walked backwards. The household journal had 417 events on 2026-10-09, read with `sqlite3 -readonly`.

(f) `src/store.ts`, validators. Replace
```ts
function optionalText(value: string | undefined, field: string, max: number): string | null {
  if (value === undefined || value.trim() === "") return null;
  return cleanText(value, field, max);
}
```
with
```ts
function optionalText(value: string | undefined, field: string, max: number): string | null {
  if (value === undefined || value.trim() === "") return null;
  return cleanText(value, field, max);
}

const REST_UNTIL_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;

function validateRestMode(value: unknown): "resting" | "ready" {
  if (value !== "resting" && value !== "ready") {
    throw new CollabError("invalid_mode", 'mode must be "resting" or "ready"');
  }
  return value;
}

/** A calendar-exact ISO-8601 instant with seconds and a zone, stored as UTC toISOString. */
function validateRestUntil(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  const match = REST_UNTIL_PATTERN.exec(text);
  if (match) {
    const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
      number, number, number, number, number, number,
    ];
    const offsetHours = Number(match[7] ?? 0);
    const offsetMinutes = Number(match[8] ?? 0);
    // Date.parse rolls 2026-02-30 over to March and accepts 24:00; this does not.
    const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const parsed = Date.parse(text);
    if (
      year >= 1970
      && calendar.getUTCFullYear() === year
      && calendar.getUTCMonth() === month - 1
      && calendar.getUTCDate() === day
      && calendar.getUTCHours() === hour
      && calendar.getUTCMinutes() === minute
      && calendar.getUTCSeconds() === second
      && offsetHours <= 23
      && offsetMinutes <= 59
      && Number.isFinite(parsed)
    ) {
      return new Date(parsed).toISOString();
    }
  }
  throw new CollabError(
    "invalid_until",
    "until must be an ISO-8601 instant with seconds and a time zone, for example 2026-10-09T18:00:00Z",
  );
}

function validateRestWakeOn(value: unknown): RestWakeOn[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value)
    || value.length > 1
    || (value.length === 1 && value[0] !== "addressed")
  ) {
    throw new CollabError("invalid_wake_on", 'wake_on accepts [] or ["addressed"] in this version');
  }
  return value.length === 1 ? ["addressed"] : [];
}
```
(Under Bun 1.3.13, `Date.parse("2026-02-30T00:00:00Z")` returned 2026-03-02 and `Date.parse("2026-10-09T24:00:00Z")` was finite. This is why the calendar check exists. The test covers both cases.)

(g) `src/store.ts`, the row type and the read-side parser. Replace
```ts
function sessionLiveness(
  row: Pick<CoordinationSessionRow, "status" | "last_seen_at">,
```
with
```ts
interface RestDeclarationRow {
  type: "session.rested" | "session.returned";
  sequence: number;
  occurred_at: string;
  payload_json: string;
}

/** Expiry is computed on read; a returned, expired or damaged declaration reads as no rest. */
function restFromDeclaration(row: RestDeclarationRow, observedAt: string): SessionRest | null {
  if (row.type !== "session.rested") return null;
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    return null;
  }
  if (!isRecordValue(payload) || payload.mode !== "resting") return null;
  const until = typeof payload.until === "string" ? payload.until : payload.until === null ? null : undefined;
  const reason = typeof payload.reason === "string" ? payload.reason : payload.reason === null ? null : undefined;
  const wakeOn = payload.wake_on;
  if (until === undefined || reason === undefined) return null;
  if (!Array.isArray(wakeOn) || wakeOn.length > 1 || !wakeOn.every((item) => item === "addressed")) {
    return null;
  }
  // NaN (an unparseable until or clock) fails this comparison and reads as expired.
  if (until !== null && !(Date.parse(observedAt) < Date.parse(until))) return null;
  return {
    mode: "resting",
    since: row.occurred_at,
    until,
    reason,
    wake_on: wakeOn.length === 1 ? ["addressed"] : [],
  };
}

function sessionLiveness(
  row: Pick<CoordinationSessionRow, "status" | "last_seen_at">,
```

(h) `src/store.ts`, `function coordinationSessionFromRow(`. Replace
```ts
function coordinationSessionFromRow(
  row: CoordinationSessionRow,
  observedAt: string,
): CoordinationSession {
```
with
```ts
function coordinationSessionFromRow(
  row: CoordinationSessionRow,
  observedAt: string,
  rest: SessionRest | null,
): CoordinationSession {
```
and in its returned object replace
```ts
    liveness: sessionLiveness(row, observedAt),
  };
```
with
```ts
    liveness: sessionLiveness(row, observedAt),
    rest,
  };
```

Then check that the only caller is `sessionProjection`:
```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab && grep -n "coordinationSessionFromRow(" src/store.ts
```
Expected: exactly two lines. One is `return coordinationSessionFromRow(row, observedAt, rest);` inside `sessionProjection`; the other is the `function coordinationSessionFromRow(` definition.

(i) `src/mcp.ts`, the `./protocol.js` import list: add `  MAX_REST_REASON_LENGTH,` on the line before `  MAX_WAIT_EVENT_LIMIT,`.

(j) `src/mcp.ts`, the registration. Insert immediately after the `collab_session_end` registration, which ends with
```ts
        credential_file_removed: true,
        session_file_name: `${ended.session.id}.json`,
      };
    }),
  );
```
the following (keep one blank line on either side):
```ts
  server.registerTool(
    "collab_session_rest",
    {
      title: "Declare rest or return for the bound session",
      description:
        "Declare that the bound session is resting, or return with mode ready. Rest is declared, never inferred: " +
        "until (a future ISO-8601 instant with a time zone) bounds it and is checked on read, and wake_on " +
        "[\"addressed\"] consents to a host wake for notes explicitly addressed to this session; with the default [] " +
        "they wait until you return. Rest changes no status and never releases, extends, or reassigns leases, " +
        "handoffs, or accepted obligations.",
      annotations: localRetrySafeMutation,
      inputSchema: {
        workspace_id: workspaceId.optional(),
        idempotency_key: key,
        mode: z.enum(["resting", "ready"]),
        until: z.string().min(1).max(64).optional()
          .describe("Mode resting only: a future ISO-8601 instant with a time zone; omit to rest until you return"),
        reason: z.string().max(MAX_REST_REASON_LENGTH).optional()
          .describe(`Mode resting only: a short reason, at most ${MAX_REST_REASON_LENGTH} characters`),
        wake_on: z.array(z.enum(["addressed"])).max(1).optional()
          .describe('Mode resting only: [] (default) or ["addressed"] to consent to a wake for addressed notes'),
      },
    },
    async ({ workspace_id, ...input }) => call(() => {
      if (workspace_id !== undefined) requireWorkspace(workspace_id);
      const session = store.restSessionForSession({ ...boundCredential(), ...input });
      if (binding) binding.handle = { ...binding.handle, session };
      return { session };
    }),
  );
```
`requireWorkspace` only checks when a binding exists, so an unbound process falls through to `boundCredential()` and its `session_not_bound` refusal. The store is the source of truth for validation. The zod schema only bounds sizes and enums (the in-process test harness calls handlers directly, bypassing zod).

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab && bun test tests/rest.test.ts tests/mcp.test.ts && bun test && bun run typecheck
```
Expected:
- the two-file run: `27 pass`, `0 fail`, `Ran 27 tests across 2 files` (Bun prints one combined total). That is 7 in `rest.test.ts` and 20 in `mcp.test.ts`, where no tests are new and two are extended
- full suite: `0 fail`, +7 tests in `tests/rest.test.ts` (one new file). From `05b39c63` that is 197 pass across 15 files
- `tsc --noEmit` exits 0

Then check the two sibling packages, whose tests import `../../collab/src`:
```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab-zerone && bun install --frozen-lockfile && bun --no-env-file test && bun --no-env-file run typecheck && cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab-courier && bun install --frozen-lockfile && bun --no-env-file test tests && bun --no-env-file run typecheck
```
Expected: `0 fail` in both (73 and 374 tests, unchanged), and both typechecks exit 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest && git add packages/collab/src/protocol.ts packages/collab/src/store.ts packages/collab/src/mcp.ts packages/collab/tests/rest.test.ts packages/collab/tests/mcp.test.ts && git commit -F - <<'EOF'
feat(collab): declare rest with collab_session_rest

A bound session can now declare that it is resting (optionally until a
future instant, with a short reason and wake_on ["addressed"] as its own
consent to a host wake) or return with mode ready. The declaration is a
journal event, session.rested or session.returned, appended through
mutateAsSession; it changes no status or generation and never releases,
extends or reassigns leases, handoffs or obligations. Session projections
gain rest, read from the latest declaration with expiry computed on read,
null once the session has ended. A host resume keeps the declared rest.

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>
EOF
```
This is a local commit on the feature branch only. Do not push, install or rebuild here. The pinned build and the lockstep household reinstall belong to the later Plan C tasks. The push and the stacked PR wait for Yu's explicit go (spec "Order of work" 3 and 5).

- [ ] **Step 6: Leave `dist/` alone**

Do not run `bun run build:mcp` here. The tracked bundles are byte-pinned to Bun 1.3.5 (`bundlerBunVersion`), and this Mac runs 1.3.13, where `bun run check:mcp-bundle` prints `check:mcp-bundle: skipped — this Bun is 1.3.13, the bundle is built with 1.3.5.` The Plan C pinned-build step rebuilds both bundles with `npx --yes bun@1.3.5 run build:mcp` after all `src/` changes. The existing stdio test `"carries every new optional input over stdio through the checked-in bundles"` keeps running the old bundle until then, and the old bundle ignores the new tool and events (spike S1).

---

### Task 2: Four-state liveness — ended, then resting, then stale, then live

Runs after Task 1. Anchors are quoted text. `~N` is the line after Task 1, a hint only.

**Files:**
- Modify: `packages/collab/src/protocol.ts`: the doc comment and type `export type SessionLiveness = "live" | "stale";` (~119-124)
- Modify: `packages/collab/src/store.ts`:
  - `private assigneeLiveness(` (~5819)
  - `function sessionLiveness(` (~6512)
  - the `liveness:` line in `function coordinationSessionFromRow(` (~6558)
- Modify: `packages/collab/src/mcp.ts`: the last sentence of the `collab_next` description (~403)
- Test: `packages/collab/tests/liveness.test.ts`:
  - test `"derives session liveness from last_seen_at without changing status or the journal"` (~101)
  - test `"projects assignee liveness and lists recovery-required leases with the caller's own first"` (~176-183)
  - a new `describe` appended at the end of the file (after ~255)

**Interfaces:**
- Consumes: Task 1's private `latestRest(sessionId, observedAt)`, `SessionRest`, and `coordinationSessionFromRow(row, observedAt, rest)` (which already receives the rest that `sessionProjection` computed).
- Produces:
  - `export type SessionLiveness = "live" | "resting" | "stale" | "ended"`, with its doc comment in `protocol.ts` rewritten to state the precedence
  - module function `sessionLiveness(row, observedAt, rest: SessionRest | null): SessionLiveness`
  - `assigneeLiveness(sessionId)` now looks up the holder's latest rest
  - `CoordinationSession.liveness` and `Task.assignee_liveness` carry the four states
  - a `collab_next` description naming all four states
- Liveness rules, in precedence order:
  1. `status !== "active"` → `"ended"`. This holds even when a rest was declared before the end, and even for an ended holder of an expired lease.
  2. A declared, unexpired rest (`latestRest` non-null) → `"resting"`. This holds however long the session has been unseen.
  3. `observedAt - last_seen_at > SESSION_STALE_AFTER_MS`, or an unparseable timestamp → `"stale"`.
  4. Otherwise → `"live"`.
  - Rest is declared, never inferred: a quiet session without a declaration, or one whose rest expired at `until`, reads `stale`, never `resting`.
  - `"live" | "resting" | "stale"` is the set of active-session values. `"ended"` appears only on ended sessions (`listCoordinationSessions(ws, "ended")`, end receipts, `getCoordinationSession`) and in `assignee_liveness` of a task an ended session still holds.
- Not changed (deliberate):
  - No status, event or column. Receipts stored earlier are replayed as stored, so a receipt captured before this task may still say `stale` for an ended session.
  - The presence plane's `SessionPresence` (`live | stale | left`) is untouched.
  - The `collab_workspace_status` description ("with derived liveness") still holds.
- Lockstep owed by the Plan C docs task (spec Part 1.2 "must change together"; not edited here): see "Handoff" at the end of this part for the exact doc lines that still say an ended session reads `stale`.

- [ ] **Step 1: Write the failing tests**

(a) In test `"derives session liveness from last_seen_at without changing status or the journal"`, replace
```ts
    expect(ended.status).toBe("ended");
    expect(ended.liveness).toBe("stale");
```
with
```ts
    expect(ended.status).toBe("ended");
    expect(ended.liveness).toBe("ended");
```

(b) In test `"projects assignee liveness and lists recovery-required leases with the caller's own first"`, replace
```ts
    // An expired lease does not block session_end, so a holder can leave it
    // behind; an ended holder reads stale even though it was just seen.
    store.endSession({ ...holder.credential, reason: "leaves an expired lease behind" });
    expect(store.getTask(ownTask.workspace_id, ownTask.id)).toMatchObject({
      effective_status: "recovery_required",
      assignee_session_id: holder.session.id,
      assignee_liveness: "stale",
    });
```
with
```ts
    // An expired lease does not block session_end, so a holder can leave it
    // behind; an ended holder reads ended even though it was just seen.
    store.endSession({ ...holder.credential, reason: "leaves an expired lease behind" });
    expect(store.getTask(ownTask.workspace_id, ownTask.id)).toMatchObject({
      effective_status: "recovery_required",
      assignee_session_id: holder.session.id,
      assignee_liveness: "ended",
    });
```

(c) Append at the end of the file, after the `});` that closes `describe("staleness as a derived view"` (keep one blank line between). The block uses the file's existing helpers `session()`, `advance()`, `createEditTask()`, `callTool()`, the `STALE_AFTER_MS` constant, the `currentTime` clock and the `buildCollabMcpServer` import; no new imports are needed.

```ts
describe("four-state liveness: ended, then resting, then stale, then live", () => {
  test("reads a declared, unexpired rest as resting after six hours unseen, never a quiet ghost", () => {
    const rester = session("liveness-rester");
    const ghost = session("liveness-quiet-ghost");
    const until = new Date(currentTime.getTime() + 2 * STALE_AFTER_MS).toISOString();
    const rested = store.restSessionForSession({
      ...rester.credential,
      idempotency_key: "rest-for-liveness",
      mode: "resting",
      until,
      wake_on: ["addressed"],
    });
    expect(rested.liveness).toBe("resting");
    const headBefore = store.eventsSince(rester.workspace.id, 0, 500).head_sequence;

    advance(STALE_AFTER_MS + 1);
    const byId = () => new Map(
      store.listCoordinationSessions(rester.workspace.id).map((item) => [item.id, item.liveness]),
    );
    expect(byId().get(rester.session.id)).toBe("resting");
    expect(byId().get(ghost.session.id)).toBe("stale");
    const active = new Map(
      store.workspaceStatus(rester.workspace.id).active_sessions
        .map((item) => [item.id, item.liveness]),
    );
    expect(active.get(rester.session.id)).toBe("resting");
    expect(active.get(ghost.session.id)).toBe("stale");

    // Expiry is computed on read: one millisecond before until it still rests,
    // at until a quiet session reads stale, never resting.
    currentTime = new Date(Date.parse(until) - 1);
    expect(store.getCoordinationSession(rester.session.id)?.liveness).toBe("resting");
    currentTime = new Date(until);
    expect(store.getCoordinationSession(rester.session.id)).toMatchObject({
      status: "active",
      rest: null,
      liveness: "stale",
    });
    expect(store.eventsSince(rester.workspace.id, 0, 500).head_sequence).toBe(headBefore);
  });

  test("lets ended outrank resting and a return fall back to live, then stale", () => {
    const returner = session("liveness-returner");
    store.restSessionForSession({
      ...returner.credential,
      idempotency_key: "rest-then-return",
      mode: "resting",
    });
    advance(STALE_AFTER_MS + 1);
    expect(store.getCoordinationSession(returner.session.id)?.liveness).toBe("resting");
    const back = store.restSessionForSession({
      ...returner.credential,
      idempotency_key: "return-to-live",
      mode: "ready",
    });
    expect(back).toMatchObject({ rest: null, liveness: "live" });
    advance(STALE_AFTER_MS + 1);
    expect(store.getCoordinationSession(returner.session.id)?.liveness).toBe("stale");

    const leaver = session("liveness-leaver");
    store.restSessionForSession({
      ...leaver.credential,
      idempotency_key: "rest-then-end",
      mode: "resting",
      wake_on: ["addressed"],
    });
    const ended = store.endSession({ ...leaver.credential, reason: "departure is complete" });
    expect(ended).toMatchObject({ status: "ended", rest: null, liveness: "ended" });
    expect(
      store.listCoordinationSessions(leaver.workspace.id, "ended")
        .map((item) => [item.id, item.liveness]),
    ).toEqual([[leaver.session.id, "ended"]]);
  });

  test("projects a resting holder through assignee_liveness without touching its lease", () => {
    const holder = session("resting-holder");
    const task = createEditTask(holder, "held-while-resting", "src/resting.ts");
    const claimed = store.claimTaskForSession({
      ...holder.credential,
      idempotency_key: "claim-before-rest",
      task_id: task.id,
      expected_version: task.version,
    });
    expect(claimed.assignee_liveness).toBe("live");
    store.restSessionForSession({
      ...holder.credential,
      idempotency_key: "rest-while-holding",
      mode: "resting",
    });
    expect(store.getTask(task.workspace_id, task.id)).toMatchObject({
      assignee_session_id: holder.session.id,
      assignee_liveness: "resting",
      lease_id: claimed.lease_id,
      lease_expires_at: claimed.lease_expires_at,
      version: claimed.version,
    });
    advance(STALE_AFTER_MS + 1);
    expect(store.getTask(task.workspace_id, task.id)).toMatchObject({
      effective_status: "recovery_required",
      assignee_liveness: "resting",
    });
  });

  test("reports resting through the MCP surface and names all four states", async () => {
    const server = buildCollabMcpServer(store);
    const tools = (server as any)._registeredTools;
    // The exact precedence phrase: a per-word check would pass vacuously,
    // since "liveness" already contains "live".
    expect(tools.collab_next.description as string).toContain(
      "ended, else resting while a declared rest is unexpired, else stale after 6 hours unseen, else live",
    );
    const joined = await callTool(server, "collab_session_start", {
      root_path: root,
      actor: "mcp-resting",
    });
    const workspaceId = joined.structuredContent.workspace.id;
    const rested = await callTool(server, "collab_session_rest", {
      workspace_id: workspaceId,
      idempotency_key: "mcp-liveness-rest",
      mode: "resting",
      wake_on: ["addressed"],
    });
    expect(rested.structuredContent.session.liveness).toBe("resting");

    advance(STALE_AFTER_MS + 1);
    const next = await callTool(server, "collab_next", { workspace_id: workspaceId });
    expect(next.isError).toBeUndefined();
    expect(next.structuredContent.session.liveness).toBe("resting");
    const status = await callTool(server, "collab_workspace_status", {
      workspace_id: workspaceId,
    });
    expect(status.structuredContent.active_sessions.map((item: any) => item.liveness))
      .toEqual(["resting"]);
    await server.close();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab && bun test tests/liveness.test.ts
```
Expected: `4 pass`, `6 fail`, each on its own assertion:
- "derives session liveness…": `Expected: "ended"` / `Received: "stale"`
- "projects assignee liveness…": a `toMatchObject` diff with `-   "assignee_liveness": "ended",` and `+   "assignee_liveness": "stale",`
- "reads a declared, unexpired rest as resting…": `Expected: "resting"` / `Received: "live"`
- "lets ended outrank resting…": `Expected: "resting"` / `Received: "stale"`
- "projects a resting holder…": a `toMatchObject` diff with `-   "assignee_liveness": "resting",` and `+   "assignee_liveness": "live",`
- "reports resting through the MCP surface…": `Expected to contain: "ended, else resting while a declared rest is unexpired, else stale after 6 hours unseen, else live"`, followed by the current `collab_next` description

- [ ] **Step 3: Write the implementation**

(a) `src/protocol.ts`: replace
```ts
/**
 * Derived view, never stored: an active session whose last_seen_at is older
 * than SESSION_STALE_AFTER_MS reads as stale; an ended session never reads as
 * live. Staleness changes no status, expires nothing, and grants nothing.
 */
export type SessionLiveness = "live" | "stale";
```
with
```ts
/**
 * Derived view, never stored, in this precedence: an ended session reads
 * "ended"; an active session with a declared, unexpired rest reads "resting";
 * an active session whose last_seen_at is older than SESSION_STALE_AFTER_MS
 * reads "stale"; any other reads "live". Rest is declared, never inferred, so
 * a quiet session without a declaration reads stale, never resting. Liveness
 * changes no status, expires nothing, and grants nothing.
 */
export type SessionLiveness = "live" | "resting" | "stale" | "ended";
```

(b) `src/store.ts`, `private assigneeLiveness(`: replace
```ts
    `).get(sessionId) as Pick<CoordinationSessionRow, "status" | "last_seen_at"> | null;
    return holder ? sessionLiveness(holder, this.timestamp()) : null;
  }
```
with
```ts
    `).get(sessionId) as Pick<CoordinationSessionRow, "status" | "last_seen_at"> | null;
    if (!holder) return null;
    const observedAt = this.timestamp();
    const rest = holder.status === "active" ? this.latestRest(sessionId, observedAt) : null;
    return sessionLiveness(holder, observedAt, rest);
  }
```

(c) `src/store.ts`, `function sessionLiveness(`: replace
```ts
function sessionLiveness(
  row: Pick<CoordinationSessionRow, "status" | "last_seen_at">,
  observedAt: string,
): SessionLiveness {
  if (row.status !== "active") return "stale";
```
with
```ts
function sessionLiveness(
  row: Pick<CoordinationSessionRow, "status" | "last_seen_at">,
  observedAt: string,
  rest: SessionRest | null,
): SessionLiveness {
  if (row.status !== "active") return "ended";
  if (rest) return "resting";
```
The rest of the function (the `age` computation, the NaN comment and `return age <= SESSION_STALE_AFTER_MS ? "live" : "stale";`) stays as it is.

(d) `src/store.ts`, in `function coordinationSessionFromRow(`: replace
```ts
    liveness: sessionLiveness(row, observedAt),
    rest,
```
with
```ts
    liveness: sessionLiveness(row, observedAt, rest),
    rest,
```

Check:
```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab && grep -n "sessionLiveness(" src/store.ts
```
Expected: exactly three lines: `return sessionLiveness(holder, observedAt, rest);` in `assigneeLiveness`, the `function sessionLiveness(` definition, and `liveness: sessionLiveness(row, observedAt, rest),`. `tsc` reports any call you missed as "Expected 3 arguments, but got 2".

(e) `src/mcp.ts`, the `collab_next` registration. Replace the description's last line
```ts
        "Session liveness and task assignee_liveness are a derived view (stale after 6 hours unseen), never a status change.",
```
with
```ts
        "Session liveness and task assignee_liveness are a derived view, never a status change: ended, else resting " +
        "while a declared rest is unexpired, else stale after 6 hours unseen, else live.",
```
The existing test `"exposes liveness and recovery_required through the MCP surface"` still finds `recovery_required` and `never a status change`. The new MCP test looks for the precedence phrase across the join of the two literals ("…ended, else resting " + "while a declared rest…"), so keep that wording exact. C2 Task 3 inserts its `addressed_waiting` segment before this sentence and leaves the sentence as the description's final segment.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab && bun test tests/liveness.test.ts && bun test && bun run typecheck
```
Expected:
- `liveness.test.ts`: `10 pass`, `0 fail` (+4 tests, 2 updated)
- full suite: `0 fail`, +4 tests in `tests/liveness.test.ts`. From `05b39c63` plus Task 1 that is 201 pass across 15 files
- `tsc --noEmit` exits 0

Then the siblings, exactly as in Task 1 Step 4:
```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab-zerone && bun --no-env-file test && bun --no-env-file run typecheck && cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab-courier && bun --no-env-file test tests && bun --no-env-file run typecheck
```
Expected: `0 fail` in both (73 and 374 tests, unchanged), and both typechecks exit 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest && git add packages/collab/src/protocol.ts packages/collab/src/store.ts packages/collab/src/mcp.ts packages/collab/tests/liveness.test.ts && git commit -F - <<'EOF'
feat(collab): tell the truth about quiet with four-state liveness

SessionLiveness becomes live | resting | stale | ended, judged in the
order ended, resting, stale, live: an ended session reads ended (no
longer stale), a session
with a declared, unexpired rest reads resting however long it has been
unseen, a quiet session without a declaration reads stale after six
hours, and anything else reads live. assignee_liveness follows the same
rule through the holder's latest rest. A stale session is never
relabelled resting; this stays a derived view with no status change.

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>
EOF
```
As in Task 1, this is a local commit only. `dist/` is not rebuilt, and nothing is pushed or installed until Yu's go.

---

## Handoff to later Plan C parts (facts these two tasks leave behind)

- **Docs lockstep (spec Part 1.2, "must change together"):** after Task 2 these lines are false, and the docs task must rewrite them for the four states, `rest`, `collab_session_rest`, and the reviewer guidance "review it yourself unless the requested reviewer is live, or resting with `wake_on` addressed". Line numbers are at `05b39c63`.
  - `packages/collab/README.md`: ~389-400 ("Roles and liveness": "`stale` once the session ended") and ~305 (requested reviewer guidance)
  - `packages/collab/skills/coordinate-agent-work/SKILL.md`: ~104 ("if it reads `stale`") and ~255-259
  - `packages/collab/integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md`: ~106 and ~170 ("A session reads `stale` once ended")
- **MCP server `instructions`:** no Plan C part changes them. C1 leaves them alone, and C4 deviation 1 ("server instructions stay Task 1's") means exactly that: unchanged. The string still says "The host owns spawning, wakeups, waiting, and stopping", which stays true with a household doorbell. The test `mcp.test.ts` pins that phrase.
- **Tool count:** the MCP surface is now 34 tools.
  - The docs still say 33 at README.md ~8 and ~585, SKILL.md ~11 and ~394, Hermes SKILL.md ~13, and integrations/openclaw/README.md ~8 and ~46.
  - `tests/package.test.ts` (`"keeps release-candidate host guidance bounded and non-lifecycle"`) asserts that each of those four files contains `"33"` and `"32"`. Changing the text to 34 means changing that term list in the same commit.
- **Household (Part 2):** add `collab_session_rest` to the Codex per-tool approvals in `~/.codex/config.toml` and to `check_codex_collab.py`'s LOOP set.
- **Pinned build:** after the rebuild, the stdio test `"carries every new optional input over stdio through the checked-in bundles"` can assert that `collab_session_rest` is advertised with `mode`, `until`, `reason` and `wake_on`. `/Users/yuai/.cache/sol/workspaces/knock-spikes-20261009/S1/run-all.sh` remains the post-install smoke for rest-unaware processes.
- **Readers outside `CollabStore`** (`knocks`, `doorbell-scan`, the `sol` exit sweep's `session_rest`) need the same rest rule as `restFromDeclaration`:
  - It is the latest event with `type IN ('session.rested','session.returned')` and `entity_id = <session id>` in that session's workspace, ordered by `sequence DESC`.
  - It counts only while the session's `status = 'active'`.
  - A `session.rested` payload is `{mode: "resting", until: ISO | null, reason: string | null, wake_on: [] | ["addressed"]}`.
  - The rest is in force while `until` is null or `now < until`.
  - A malformed payload reads as no rest.
  - Checked against the drafts on 2026-10-09:
    - C3's `restAt` runs this query with `restFromDeclaration` (exported by C3 Task 6, whose anchors are this part's exact lines `interface RestDeclarationRow {` and `function restFromDeclaration(row: RestDeclarationRow, observedAt: string): SessionRest | null {`). Both C3 verbs filter to `status = 'active'` first.
    - D1's `REST_EVENT` drops the workspace filter. That is equivalent: session ids are unique, and only `restSessionForSession` writes these two types. D1 also raises on a damaged payload where this part returns `null`, which is D1's documented choice to refuse to act.
    - Both apply the same `until <= now` expiry boundary.
    - If this part's SQL or parser changes, update those mirrors in the same merge.


# Plan C (packages/collab) — part C2: Tasks 3–4

Task 3 adds `addressed_waiting` to the bound session that `collab_next` returns. Task 4 adds `CollabStore.addresseeHint()` and the MCP `addressee` field. Both run after Tasks 1–2 (declared rest and four-state liveness) and before any host-binding, host-verb or docs task. Anchors are quoted text. Line numbers are hints taken from the worktree at `05b39c63`, before Tasks 1–2, so they move. Worktree: `/Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest` (branch `feat/collab-knock-and-rest-20261009`).

Verified (2026-10-09, Bun 1.3.13) in a scratch copy of `packages/collab`, `collab-zerone` and `collab-courier` taken from `05b39c63`. Part C1's Tasks 1–2 were applied first, verbatim from C1's code blocks, giving C1's own numbers: 201 pass across 15 files, `tsc` clean. Then this part's Tasks 3–4 were applied verbatim from the blocks below. Every Step 2 failure was observed as written. After Task 3 the suite was 205 pass / 0 fail across 16 files, and after Task 4 it was 209 pass / 0 fail across 17 files. `tsc --noEmit` was clean after each task. collab-zerone stayed at 73 pass and collab-courier at 374 pass, both with clean typechecks. CI runs collab on Bun 1.3.5, so a CI-style run was also done: `npx --yes bun@1.3.5`, `env -i`, a throwaway `HOME`, `--no-env-file`. It covered the two new files plus `rest`, `liveness`, `mcp` and `review-routing`, and gave 54 pass / 0 fail. Two mutation checks confirmed the guards bite. Without the `try` in `isAddressedTo`, "matches only explicit session addresses…" fails with `SyntaxError: JSON Parse error`. Without the `try` in `withAddressee`, "never turns a committed mutation into an error…" fails with `Received: true` on `isError`.

## Contract deviations

None in names or shapes. Additions and clarifications:

1. **Additive export.** Task 3 exports `isAddressedTo(event, sessionId)` and `interface AddressedEventRow` from `src/store.ts`. Both are public through `src/index.ts`'s `export * from "./store.js"`. It is a pure function with no database access, so the read-only host verbs `knocks` and `doorbell-scan` (part C3, `addressedItems` in `src/host.ts`) can import it and compute `waiting` with exactly the rules behind `addressed_waiting`. They select the same three columns with their own read-only connection. It never needs `new CollabStore`. It never throws: a payload that does not parse reads as not addressed, as C1's `restFromDeclaration` reads a damaged rest as no rest. One damaged row therefore cannot silence a whole knock.
2. **`NextCollabState.session`** (an exported type) becomes `(CoordinationSession & { addressed_waiting: number }) | null`. Nothing in the repo uses that interface. `nextForSession()` has its own inline return type, which gets the same widening.
3. **Spec clarification: `"none"` has more routes than the spec lists.** Spec Part 1 item 4 says `"none"` is "reachable only via report_append". Two more routes exist:
   - `collab_task_review`. Its addressee is the reporter, and the reporter may have ended after completing, because `collab_session_end` does not refuse while one of its completions awaits review.
   - An idempotent replay of any of the four tools after the addressee ended.

   Task 4 tests the review route. The handoff and review-request first calls still cannot reach `"none"`, because those mutations refuse inactive targets.
4. **The hint reports the addressee's declaration, not its host (spec Part 1 item 4, amended 2026-10-09).** Collab cannot see hosts. So `"wake"` means "declared rest with `wake_on: ["addressed"]`", not that a host can wake the session, and `AddresseeHint` has no `reason` field. Whether a host can actually wake it (for example a Claude seat not launched with the channel flag) is recorded by the household doorbell in its ledger as `host_cannot_wake` (spec Part 2 items 3 and 5), never in the hint. The hint never shows `host_cannot_wake`.
5. **Overlap with Tasks 1–2, checked.** C1 as drafted declares neither `KnockDelivery` nor `AddresseeHint`, and it does import `type SessionRest` into `store.ts`. Task 4 Step 3 still has two guarded sub-steps that keep exactly one declaration and one import if Tasks 1–2 land differently. Against C1 as drafted, both are expected no-ops.
6. **The hint never fails the mutation.** `withAddressee` runs after the store has committed. If the hint cannot be read, the result omits `addressee`. It does not return an error. A committed note shown as an error would invite the model to resend under a fresh key, which would duplicate the note. In practice the store's own checks rule out `session_not_found` and `session_workspace_mismatch` here, because sessions are never deleted and every route checks the workspace first. What remains is a SQLite-level failure during the separate read. Task 4 has a test for this.

## What Tasks 3–4 consume from Tasks 1–2 (the contract)

- `protocol.ts`: `SessionLiveness = "live" | "resting" | "stale" | "ended"`, `RestWakeOn = "addressed"`, `SessionRest { mode: "resting"; since; until: string | null; reason: string | null; wake_on: RestWakeOn[] }`, and `CoordinationSession.rest: SessionRest | null`.
- `CollabStore.restSessionForSession({ session_id, session_token, generation, idempotency_key, mode: "resting" | "ready", until?, reason?, wake_on? }): CoordinationSession`. An absent `until` or `reason` reads back as `null`, and `wake_on` defaults to `[]`.
- MCP tool `collab_session_rest { workspace_id?, idempotency_key, mode, until?, reason?, wake_on? }`.
- `sessionProjection(row)` fills `liveness` and `rest`, with precedence ended → resting (the latest unexpired declaration, computed on read via private `latestRest`) → stale → live. A session that never rested has `rest: null`. An ended session reads `liveness: "ended"`. A rest whose `until` has passed reads as not resting.
- Unchanged from Plan A: `private sessionProjection(row, observedAt?)`, `private requireCoordinationSessionRow(id)`, module `validateId`, `isRecordValue`, `CollabStoreOptions.now`, `coordination_sessions.cursor_sequence` as the acknowledged cursor, `events.session_id` as the authoring session, the `report.posted` payload `to_session_id`, the session-path `handoff.offered` payload `handoff` (a `HandoffOffer`), and the actor-path `handoff.offered` payload `offer`.

---

### Task 3: `addressed_waiting` on `collab_next`'s bound session

**Files:**
- Modify: `packages/collab/src/protocol.ts`: in `export interface NextCollabState` (hint 468), the `session:` member.
- Modify: `packages/collab/src/store.ts`:
  - `nextForSession()` (hint 3945): its inline return type, and the `session:` entry of the object returned from its `read` transaction (hint 4048).
  - a new private method immediately before `private requireWorkspace(workspaceId: string, db = this.db): Workspace {` (hint 5767).
  - a new exported interface and function immediately before the module function `function recoveryRequiredFirst(tasks: Task[], isOwn: (task: Task) => boolean): Task[] {` (hint 6347).
- Modify: `packages/collab/src/mcp.ts`: the `collab_next` description (hint 365-371).
- Create: `packages/collab/tests/addressed-waiting.test.ts`. A new file, so it never collides with the test edits of Tasks 1–2.

**Interfaces:**
- Consumes:
  - `CoordinationSessionRow.cursor_sequence` and `.workspace_id`, plus the `events` columns `type`, `session_id` and `payload_json`.
  - `isRecordValue()` (store.ts module helper) and `sessionProjection(row)` (Tasks 1–2 version).
  - the store test API `startSession`, `appendReportForSession`, `createTaskForSession`, `claimTaskForSession`, `offerHandoffForSession`, `respondHandoffForSession`, `completeTaskForSession` (with `review_requested_session_id`), `reviewTaskForSession`, `acknowledgeSessionCursor`, `eventsSince`, and the legacy `createTask` / `claimTask` / `offerHandoff`.
- Produces:
  - `nextForSession(...).session: CoordinationSession & { addressed_waiting: number }`. MCP `collab_next` in a bound session returns it unchanged as `structuredContent.session.addressed_waiting`. Legacy actor mode still returns `session: null`.
  - `NextCollabState.session: (CoordinationSession & { addressed_waiting: number }) | null`.
  - private `CollabStore.addressedWaiting(session: CoordinationSessionRow): number`.
  - `export interface AddressedEventRow { type: string; session_id: string | null; payload_json: string }` and `export function isAddressedTo(event: AddressedEventRow, sessionId: string): boolean`, both in store.ts.
- Counting rules (spec Part 1 item 3), all in `isAddressedTo`:
  - counted: events with `sequence > cursor_sequence` (the acknowledged cursor), across the whole backlog, not bounded by `event_limit`.
  - matching `report.posted` with `payload.to_session_id === session.id`. This covers ordinary addressed reports, the "Review requested" report from `collab_task_complete`, and the review result that `collab_task_review` addresses to the reporter.
  - matching session-path `handoff.offered` with `payload.handoff.to_session_id === session.id`.
  - never counted: `task.reported_complete`, even though it names `review_requested_session_id`; `handoff.accepted`, whose `to_session_id` is the acceptor; actor-path offers (`payload.offer`, `to_session_id: null`); broadcasts; and any event whose `session_id` is the session itself.
  - The count falls only as `collab_cursor_ack` advances. It is a view: no event, no column, no `last_seen_at` change beyond what `collab_next` already does.
- Consumed later by:
  - part C3 Task 6, the `knocks` / `doorbell-scan` host verbs. Its `addressedItems` in `src/host.ts` imports `isAddressedTo` and `type AddressedEventRow` and selects the same rows, so `waiting` equals `addressed_waiting` for the same cursor. Its parity test "agrees with the store's liveness and rest and with collab_next's addressed_waiting" checks this.
  - part C4 Task 7, the docs: one line on `addressed_waiting` in README and both skills. Part C4 Task 8's install check reads `session.addressed_waiting` from the installed bundle.
  - part D3 Task 6, replay scene 3 ("on return one coalesced count").
- Cost: one events range scan on the primary key `(workspace_id, sequence)` per bound `collab_next`. On 2026-10-09 the household journal held 417 events in total, of which 62 were `report.posted` (`sqlite3 -readonly` count), so no index is added.

- [ ] **Step 1: Write the failing test**

Prerequisite, once per worktree (`node_modules` is gitignored; Task 1's prerequisite may already have run it):
```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab && bun install --frozen-lockfile
```

Create `packages/collab/tests/addressed-waiting.test.ts` with exactly:
```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCollabMcpServer } from "../src/mcp.js";
import type { CollabReport, SessionHandle, Task } from "../src/protocol.js";
import { CollabStore } from "../src/store.js";
// Namespace import, so a missing export fails only the test that uses it.
import * as storeModule from "../src/store.js";

let directory: string;
let root: string;
let databasePath: string;
let store: CollabStore;
const memberStores: CollabStore[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-addressed-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  store = new CollabStore(databasePath);
});

afterEach(() => {
  while (memberStores.length) memberStores.pop()!.close();
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function session(actor: string): SessionHandle {
  return store.startSession({ root_path: root, actor });
}

function waiting(who: SessionHandle, eventLimit = 50): number {
  return store.nextForSession({ ...who.credential, event_limit: eventLimit })
    .session.addressed_waiting;
}

function note(from: SessionHandle, key: string, to?: SessionHandle): CollabReport {
  return store.appendReportForSession({
    ...from.credential,
    idempotency_key: key,
    kind: "observation",
    body: `Note ${key}.`,
    ...(to ? { to_session_id: to.session.id } : {}),
  });
}

function claimedEditTask(owner: SessionHandle, name: string): Task {
  const created = store.createTaskForSession({
    ...owner.credential,
    idempotency_key: `${name}-create`,
    title: name,
    work_mode: "edit",
    completion_policy: "accepted",
    path_scopes: [`src/${name}.ts`],
  });
  return store.claimTaskForSession({
    ...owner.credential,
    idempotency_key: `${name}-claim`,
    task_id: created.id,
    expected_version: created.version,
  });
}

async function callTool(server: any, name: string, args: Record<string, unknown> = {}) {
  const registration = server._registeredTools[name];
  if (!registration) throw new Error(`tool not registered: ${name}`);
  return await (registration.handler ?? registration.callback)(args, {});
}

describe("addressed_waiting on the bound session of collab_next", () => {
  test("counts reports and session handoff offers addressed to the session, never its own", () => {
    const target = session("addressed-target");
    const sender = session("addressed-sender");
    const bystander = session("addressed-bystander");
    expect(waiting(target)).toBe(0);

    note(sender, "to-target", target);
    expect(waiting(target)).toBe(1);

    // Broadcasts, notes to someone else and notes to oneself are not knocks.
    note(sender, "broadcast");
    note(sender, "to-bystander", bystander);
    note(target, "to-self", target);
    expect(waiting(target)).toBe(1);
    expect(waiting(bystander)).toBe(1);

    // A legacy actor-path offer to the same label carries no session address.
    const legacy = store.createTask({
      workspace_id: target.workspace.id,
      actor: "legacy-holder",
      idempotency_key: "legacy-create",
      title: "Legacy offer",
    });
    const legacyClaim = store.claimTask({
      workspace_id: target.workspace.id,
      actor: "legacy-holder",
      idempotency_key: "legacy-claim",
      task_id: legacy.id,
      expected_version: legacy.version,
    });
    store.offerHandoff({
      workspace_id: target.workspace.id,
      actor: "legacy-holder",
      idempotency_key: "legacy-offer",
      task_id: legacy.id,
      lease_id: legacyClaim.lease_id!,
      expected_version: legacyClaim.version,
      to_actor: target.session.actor,
      summary: "A label-addressed offer.",
    });
    expect(waiting(target)).toBe(1);

    const offeredTask = claimedEditTask(sender, "offered");
    const offered = store.offerHandoffForSession({
      ...sender.credential,
      idempotency_key: "offer-to-target",
      task_id: offeredTask.id,
      lease_id: offeredTask.lease_id!,
      expected_version: offeredTask.version,
      to_session_id: target.session.id,
      summary: "Please continue this task.",
    });
    expect(waiting(target)).toBe(2);

    // handoff.accepted names the acceptor as to_session_id; it is never counted.
    store.respondHandoffForSession({
      ...target.credential,
      idempotency_key: "accept-offer",
      handoff_id: offered.handoff.id,
      expected_version: offered.task.version,
      response: "accept",
    });
    expect(waiting(target)).toBe(2);
    expect(waiting(sender)).toBe(0);

    // The review request report counts; its task.reported_complete twin does not.
    const requested = claimedEditTask(sender, "review-requested");
    const reported = store.completeTaskForSession({
      ...sender.credential,
      idempotency_key: "review-requested-complete",
      task_id: requested.id,
      lease_id: requested.lease_id!,
      expected_version: requested.version,
      summary: "Ready for review.",
      review_requested_session_id: target.session.id,
    });
    expect(waiting(target)).toBe(3);

    // The review result is addressed to the reporter.
    store.reviewTaskForSession({
      ...target.credential,
      idempotency_key: "target-reviews",
      task_id: reported.id,
      expected_version: reported.version,
      outcome: "request_changes",
      summary: "Please add a regression test.",
    });
    expect(waiting(sender)).toBe(1);
    expect(waiting(target)).toBe(3);
  });

  test("counts past the acknowledged cursor, regardless of the event page size", () => {
    const target = session("cursor-target");
    const sender = session("cursor-sender");
    const first = note(sender, "first", target);
    note(sender, "between");
    note(sender, "second", target);
    expect(waiting(target, 1)).toBe(2);

    const firstEvent = store.eventsSince(target.workspace.id, 0, 500).events
      .find((event) => event.sequence === first.event_sequence)!;
    store.acknowledgeSessionCursor({
      ...target.credential,
      anchor: {
        epoch_id: firstEvent.epoch_id,
        sequence: firstEvent.sequence,
        hash: firstEvent.hash,
      },
      expected_cursor_version: 0,
    });
    expect(waiting(target)).toBe(1);

    const page = store.nextForSession({ ...target.credential, event_limit: 50 });
    store.acknowledgeSessionCursor({
      ...target.credential,
      anchor: page.events.next_anchor,
      expected_cursor_version: page.session.cursor_version,
    });
    expect(waiting(target)).toBe(0);

    note(sender, "third", target);
    expect(waiting(target)).toBe(1);
  });

  test("matches only explicit session addresses, by event type", () => {
    const isAddressedTo = storeModule.isAddressedTo;
    expect(typeof isAddressedTo).toBe("function");
    const me = "session_me";
    const row = (
      type: string,
      payload: Record<string, unknown>,
      authorSessionId: string | null = "session_sender",
    ) => ({ type, session_id: authorSessionId, payload_json: JSON.stringify(payload) });

    expect(isAddressedTo(row("report.posted", { to_session_id: me }), me)).toBe(true);
    expect(isAddressedTo(row("handoff.offered", { handoff: { to_session_id: me } }), me)).toBe(true);
    // Never its own, never a broadcast, never an actor-path offer.
    expect(isAddressedTo(row("report.posted", { to_session_id: me }, me), me)).toBe(false);
    expect(isAddressedTo(row("report.posted", { to_session_id: null }), me)).toBe(false);
    expect(isAddressedTo(row("handoff.offered", { offer: { to_actor: "me", to_session_id: null } }, null), me))
      .toBe(false);
    // Other event types that name the session are not addressed notes.
    expect(isAddressedTo(row("handoff.accepted", { to_session_id: me }), me)).toBe(false);
    expect(isAddressedTo(row("task.reported_complete", { review_requested_session_id: me }), me)).toBe(false);
    // A damaged payload reads as not addressed instead of throwing.
    expect(isAddressedTo({ type: "report.posted", session_id: "session_sender", payload_json: "{" }, me))
      .toBe(false);
  });

  test("collab_next shows addressed_waiting on the bound session and says what it counts", async () => {
    const description = (buildCollabMcpServer(store) as any)._registeredTools.collab_next.description;
    expect(description).toContain("addressed_waiting");
    expect(description).toContain("falls as collab_cursor_ack advances");

    const memberStore = new CollabStore(databasePath);
    memberStores.push(memberStore);
    const server = buildCollabMcpServer(memberStore);
    const started = await callTool(server, "collab_session_start", { root_path: root, actor: "mcp-target" });
    expect(started.isError).toBeUndefined();
    const sender = session("mcp-sender");
    store.appendReportForSession({
      ...sender.credential,
      idempotency_key: "mcp-note",
      kind: "proposal",
      body: "Addressed through the store.",
      to_session_id: started.structuredContent.session.id,
    });
    const next = await callTool(server, "collab_next", {
      workspace_id: started.structuredContent.workspace.id,
    });
    expect(next.isError).toBeUndefined();
    expect(next.structuredContent.session.addressed_waiting).toBe(1);

    const legacy = await callTool(buildCollabMcpServer(store), "collab_next", {
      workspace_id: started.structuredContent.workspace.id,
      actor: "legacy-reader",
    });
    expect(legacy.isError).toBeUndefined();
    expect(legacy.structuredContent.session).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab && bun test tests/addressed-waiting.test.ts
```

Expected: `0 pass`, `4 fail`, each on its own assertion:
- "counts reports and session handoff offers…": `Expected: 0` / `Received: undefined`
- "counts past the acknowledged cursor…": `Expected: 2` / `Received: undefined`
- "matches only explicit session addresses…": `Expected: "function"` / `Received: "undefined"`. The namespace import keeps the missing export from failing the whole file.
- "collab_next shows addressed_waiting…": `Expected to contain: "addressed_waiting"`, followed by the `collab_next` description as Tasks 1–2 left it.

- [ ] **Step 3: Write minimal implementation**

(a) `src/protocol.ts`. In `export interface NextCollabState`, replace (this text occurs once)
```ts
export interface NextCollabState {
  actor: string;
  session: CoordinationSession | null;
```
with
```ts
export interface NextCollabState {
  actor: string;
  /**
   * The bound session (null in legacy actor mode). addressed_waiting counts
   * notes addressed to it past its acknowledged cursor: report.posted with its
   * to_session_id and session-path handoff.offered naming it, never its own.
   */
  session: (CoordinationSession & { addressed_waiting: number }) | null;
```

(b) `src/store.ts`. Make four edits.

1. In `nextForSession()`'s return type, replace (this text occurs once; `nextForActor()` returns `session: null` and is left alone)
```ts
    after_sequence?: number;
  }): {
    actor: string;
    session: CoordinationSession;
```
with
```ts
    after_sequence?: number;
  }): {
    actor: string;
    session: CoordinationSession & { addressed_waiting: number };
```

2. In the object returned by `nextForSession()`'s `read` transaction, replace (this line occurs once)
```ts
        session: this.sessionProjection(current),
```
with
```ts
        session: {
          ...this.sessionProjection(current),
          addressed_waiting: this.addressedWaiting(current),
        },
```
`current` is the row re-authenticated inside that same deferred read, so the count and the projection describe one snapshot.

3. Insert immediately before `  private requireWorkspace(workspaceId: string, db = this.db): Workspace {`:
```ts
  /**
   * Notes addressed to this session past its acknowledged cursor (the whole
   * backlog, not one event page). See isAddressedTo for what counts.
   */
  private addressedWaiting(session: CoordinationSessionRow): number {
    const rows = this.db.query(`
      SELECT type, session_id, payload_json FROM events
      WHERE workspace_id = ? AND sequence > ?
        AND type IN ('report.posted', 'handoff.offered')
      ORDER BY sequence
    `).all(session.workspace_id, session.cursor_sequence) as AddressedEventRow[];
    return rows.filter((row) => isAddressedTo(row, session.id)).length;
  }

```

4. Insert immediately before the module function `function recoveryRequiredFirst(tasks: Task[], isOwn: (task: Task) => boolean): Task[] {`:
```ts
/** The events-table columns isAddressedTo reads. */
export interface AddressedEventRow {
  type: string;
  session_id: string | null;
  payload_json: string;
}

/**
 * True when a journal event explicitly addresses sessionId from another
 * session: a report.posted whose to_session_id is sessionId (ordinary
 * addressed reports, review requests, review results), or a session-path
 * handoff.offered whose handoff.to_session_id is sessionId. Nothing else
 * matches: not task.reported_complete (its paired review-request report
 * already counts), not handoff.accepted (its to_session_id is the acceptor
 * itself), not an actor-path offer, never an event this session authored.
 * A payload that does not parse reads as not addressed; this never throws.
 */
export function isAddressedTo(event: AddressedEventRow, sessionId: string): boolean {
  if (event.session_id === sessionId) return false;
  if (event.type !== "report.posted" && event.type !== "handoff.offered") return false;
  let payload: unknown;
  try {
    payload = JSON.parse(event.payload_json);
  } catch {
    return false;
  }
  if (!isRecordValue(payload)) return false;
  if (event.type === "report.posted") return payload.to_session_id === sessionId;
  return isRecordValue(payload.handoff) && payload.handoff.to_session_id === sessionId;
}

```

(c) `src/mcp.ts`. In the `collab_next` description, insert a new string segment directly after this line (it occurs once):
```ts
        "recovery_required lists expired session leases awaiting collab_task_recover, the caller's own first. " +
```
The two inserted lines:
```ts
        "A bound session's addressed_waiting counts notes addressed to it past its acknowledged cursor (addressed reports, " +
        "review requests and results, session handoff offers; never its own); it falls as collab_cursor_ack advances. " +
```
The liveness sentence after it, as Tasks 1–2 left it, stays the final segment.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab && bun test tests/addressed-waiting.test.ts && bun test && bun run typecheck
```

Expected:
- `addressed-waiting.test.ts`: `4 pass`, `0 fail`
- full suite: `0 fail`. Compared with after Task 2, that is +4 tests in `tests/addressed-waiting.test.ts` and one more file: 205 pass across 16 files, from `05b39c63` plus C1's Tasks 1–2.
- `tsc --noEmit` exits 0

Then the two sibling packages whose tests import `../../collab/src/store.js` (collab-courier calls `nextForSession`):
```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab-zerone && bun install --frozen-lockfile && bun --no-env-file test && bun --no-env-file run typecheck && cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab-courier && bun install --frozen-lockfile && bun --no-env-file test tests && bun --no-env-file run typecheck
```
Expected: `0 fail` in both packages (scratch run: 73 pass and 374 pass), and both typechecks exit 0. Neither package gains tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest && git add packages/collab/src/protocol.ts packages/collab/src/store.ts packages/collab/src/mcp.ts packages/collab/tests/addressed-waiting.test.ts && git commit -F - <<'EOF'
feat(collab): count addressed notes waiting on collab_next's bound session

The bound session in collab_next gains addressed_waiting: report.posted
events addressed to it (ordinary notes, review requests, review results)
and session-path handoff.offered events naming it, past its acknowledged
cursor and across the whole backlog, never items it authored.
task.reported_complete is not counted (its paired review-request report
already is), and handoff.accepted's to_session_id, the acceptor itself,
never matches. The rules live in one exported pure function,
isAddressedTo, so the read-only host knock verbs can count the same way;
it reads a damaged payload as not addressed and never throws. A view
only: no event, no column.

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>
EOF
```

The tracked bundles in `packages/collab/dist/` are not rebuilt here. As in Plan A, `check:mcp-bundle` byte-compares them only on Bun 1.3.5 and prints "skipped" on this Mac's 1.3.13. Under Bun 1.3.5, as `.github/workflows/collab-courier.yml` runs `bun run ci`, it fails at this commit because `dist/` lags `src/` (checked in the scratch copy). That is expected until part C4 Task 8 rebuilds both bundles with `npx --yes bun@1.3.5 run build:mcp`. These commits stay local: nothing in this part pushes, and the branch is pushed or opened as a PR only after Task 8, and only with Yu's go. The new test files themselves pass under Bun 1.3.5 run CI-style (`env -i`, a throwaway `HOME`, `--no-env-file`).

---

### Task 4: `addresseeHint` and the MCP `addressee` sender hint

**Files:**
- Modify: `packages/collab/src/protocol.ts`: two new declarations immediately before `export interface SessionJoinResult {` (hint 146, that is, right after the closing `}` of `export interface CoordinationSession`).
- Modify: `packages/collab/src/store.ts`:
  - the `./protocol.js` import list (hints 25, 40, 51).
  - a new public method immediately after `getCoordinationSession()` (hint 1996-2001).
  - a new module function immediately before `function recoveryRequiredFirst(` (after Task 3's `isAddressedTo`).
- Modify: `packages/collab/src/mcp.ts`:
  - a new module constant immediately before `const nextEventLimit` (hint 45).
  - a new closure immediately before `  const requireLegacyActor = (value: string | undefined): string => {` (hint 156).
  - the description and handler of `collab_task_complete` (hint 725), `collab_task_review` (hint 767), `collab_report_append` (hint 793) and `collab_handoff_offer` (hint 896).
- Create: `packages/collab/tests/addressee-hint.test.ts`.

**Interfaces:**
- Consumes:
  - from Tasks 1–2: `SessionLiveness`, `SessionRest`, `CoordinationSession.rest`, `sessionProjection(row)` (liveness and rest computed on read, an expired rest reads as not resting), `restSessionForSession(...)`, and MCP `collab_session_rest`.
  - existing helpers: `requireCoordinationSessionRow(id)` (`session_not_found`), `validateId(value, field)`, the MCP `call()` / `success()` flattening, the `binding` closure, and `requireWorkspace()`.
  - each tool's stored result shape: `appendReportForSession → CollabReport` (`workspace_id`, `to_session_id`); `offerHandoffForSession → { handoff: HandoffOffer, task }` (`handoff.workspace_id`, `handoff.to_session_id`); `completeTaskForSession → Task` (`workspace_id`); `reviewTaskForSession → { task, review, report }`, where `report.to_session_id` is the reporter (`row.reported_by_session_id`).
- Produces:
  - `export type KnockDelivery = "tap" | "wake" | "held" | "none"` and `export interface AddresseeHint { session_id: string; liveness: SessionLiveness; rest: SessionRest | null; delivery: KnockDelivery }` in `src/protocol.ts`, public through `src/index.ts`.
  - public `CollabStore.addresseeHint(workspaceId: string, sessionId: string): AddresseeHint`. It is a deferred read transaction that appends nothing and does not refresh `last_seen_at`. It refuses an unknown id with `session_not_found` and a session in another workspace with `session_workspace_mismatch` (details `{ session_id }`).
  - module `knockDelivery(liveness, rest): KnockDelivery`: live → `"tap"`; resting with `wake_on` including `"addressed"` → `"wake"`; resting otherwise → `"held"`; stale → `"held"`; ended → `"none"`.
  - MCP results gain a top-level `addressee: AddresseeHint`:
    - `collab_report_append`: when the report has a `to_session_id`.
    - `collab_handoff_offer`: on the bound-session path only; the actor path returns exactly as before.
    - `collab_task_complete`: when `review_requested_session_id` was passed. That is bound-only; unbound calls with it are still refused with `session_required_for_review_request`.
    - `collab_task_review`: always, for the reporter.
  - mcp.ts: module `const addresseeNote: string` (shared description text) and closure `withAddressee(result, workspace, addressedSessionId)`. The closure omits `addressee` when the hint cannot be read (Contract deviation 6).
- Freshness rule: the hint is computed in the MCP wrapper on every call, after the store returns. Session-mode idempotent replays return the stored `response_json`, which never contains `addressee`. A replay therefore shows the addressee's current state (live → resting → ended), never a frozen one. Nothing is blocked, and the hint promises no delivery.
- Consumed later by:
  - part C4 Task 7, the docs: one sentence each for the four tools in README and both skills, and the reviewer guidance "unless the requested reviewer is live, or resting with wake_on addressed". Part C4 Task 8's install check reads `addressee` from `collab_report_append` on the installed bundle.
  - part D3 Task 6, the replay. It reads `addressee` from the sender's tool results: scene 1 `tap`, scene 2 `wake`, scene 3 `held`, scene 4 `wake` (if S4 passed) and scene 5 `none`. An omitted hint (Contract deviation 6) shows there as a failed scene, never as a false pass.
  - the household doorbell, which reads `wake_on` from `doorbell-scan` itself, not from this hint.

- [ ] **Step 1: Write the failing test**

Create `packages/collab/tests/addressee-hint.test.ts` with exactly:
```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollabError } from "../src/errors.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import type { SessionHandle } from "../src/protocol.js";
import { CollabStore } from "../src/store.js";

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

let directory: string;
let root: string;
let databasePath: string;
let store: CollabStore;
let currentTime: Date;
const memberStores: CollabStore[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-addressee-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  currentTime = new Date("2026-10-09T09:00:00.000Z");
  store = new CollabStore(databasePath, { now: () => new Date(currentTime) });
});

afterEach(() => {
  while (memberStores.length) memberStores.pop()!.close();
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function session(actor: string, rootPath = root): SessionHandle {
  return store.startSession({ root_path: rootPath, actor });
}

function advance(milliseconds: number): void {
  currentTime = new Date(currentTime.getTime() + milliseconds);
}

function errorFrom(operation: () => unknown): CollabError {
  try {
    operation();
    throw new Error("expected operation to fail");
  } catch (error) {
    if (!(error instanceof CollabError)) throw error;
    return error;
  }
}

async function callTool(server: any, name: string, args: Record<string, unknown> = {}) {
  const registration = server._registeredTools[name];
  if (!registration) throw new Error(`tool not registered: ${name}`);
  return await (registration.handler ?? registration.callback)(args, {});
}

async function boundMember(actor: string) {
  const memberStore = new CollabStore(databasePath, { now: () => new Date(currentTime) });
  memberStores.push(memberStore);
  const server = buildCollabMcpServer(memberStore);
  const started = await callTool(server, "collab_session_start", { root_path: root, actor });
  if (started.isError) throw new Error(JSON.stringify(started.structuredContent));
  return {
    server,
    store: memberStore,
    session_id: started.structuredContent.session.id as string,
    workspace_id: started.structuredContent.workspace.id as string,
  };
}

async function claimedEditTask(member: { server: any; workspace_id: string }, name: string) {
  const created = await callTool(member.server, "collab_task_create", {
    workspace_id: member.workspace_id,
    idempotency_key: `${name}-create`,
    title: name,
    work_mode: "edit",
    path_scopes: [`src/${name}.ts`],
  });
  const claimed = await callTool(member.server, "collab_task_claim", {
    workspace_id: member.workspace_id,
    idempotency_key: `${name}-claim`,
    task_id: created.structuredContent.task.id,
    expected_version: created.structuredContent.task.version,
  });
  if (claimed.isError) throw new Error(JSON.stringify(claimed.structuredContent));
  return claimed.structuredContent.task as { id: string; lease_id: string; version: number };
}

describe("addressee hint", () => {
  test("maps the addressee's liveness and declared rest to a delivery, read now", () => {
    const sender = session("hint-sender");
    const live = session("hint-live");
    const waker = session("hint-waker");
    const holder = session("hint-holder");
    const napper = session("hint-napper");
    const departed = session("hint-departed");
    store.restSessionForSession({
      ...waker.credential,
      idempotency_key: "waker-rests",
      mode: "resting",
      reason: "Waiting for review notes.",
      wake_on: ["addressed"],
    });
    store.restSessionForSession({
      ...holder.credential,
      idempotency_key: "holder-rests",
      mode: "resting",
      wake_on: [],
    });
    store.restSessionForSession({
      ...napper.credential,
      idempotency_key: "napper-rests",
      mode: "resting",
      until: new Date(currentTime.getTime() + 60_000).toISOString(),
      wake_on: ["addressed"],
    });
    store.endSession({ ...departed.credential, reason: "Finished and gone." });
    const hint = (who: SessionHandle) => store.addresseeHint(sender.workspace.id, who.session.id);
    const headBefore = store.eventsSince(sender.workspace.id, 0, 500).head_sequence;

    expect(hint(live)).toEqual({
      session_id: live.session.id,
      liveness: "live",
      rest: null,
      delivery: "tap",
    });
    expect(hint(waker)).toMatchObject({
      session_id: waker.session.id,
      liveness: "resting",
      rest: {
        mode: "resting",
        until: null,
        reason: "Waiting for review notes.",
        wake_on: ["addressed"],
      },
      delivery: "wake",
    });
    expect(hint(holder)).toMatchObject({
      session_id: holder.session.id,
      liveness: "resting",
      rest: { mode: "resting", wake_on: [] },
      delivery: "held",
    });
    expect(hint(napper).delivery).toBe("wake");
    expect(hint(departed)).toEqual({
      session_id: departed.session.id,
      liveness: "ended",
      rest: null,
      delivery: "none",
    });

    // Expiry is computed on read: a lapsed rest is simply not resting.
    advance(60_001);
    expect(hint(napper)).toEqual({
      session_id: napper.session.id,
      liveness: "live",
      rest: null,
      delivery: "tap",
    });

    // Quiet without a declaration is stale and held; a declared rest still wakes.
    advance(STALE_AFTER_MS);
    expect(hint(live)).toEqual({
      session_id: live.session.id,
      liveness: "stale",
      rest: null,
      delivery: "held",
    });
    expect(hint(waker).delivery).toBe("wake");
    expect(hint(holder).delivery).toBe("held");

    // A read: nothing appended, and the addressee is not marked seen.
    expect(store.eventsSince(sender.workspace.id, 0, 500).head_sequence).toBe(headBefore);
    expect(hint(live).liveness).toBe("stale");
  });

  test("refuses an unknown session or one in another workspace", () => {
    const sender = session("hint-refusal-sender");
    const elsewhereRoot = join(directory, "elsewhere");
    mkdirSync(elsewhereRoot);
    const elsewhere = session("hint-elsewhere", elsewhereRoot);
    expect(elsewhere.workspace.id).not.toBe(sender.workspace.id);
    expect(errorFrom(() => store.addresseeHint(sender.workspace.id, "session_missing")).code)
      .toBe("session_not_found");
    expect(errorFrom(() => store.addresseeHint(sender.workspace.id, elsewhere.session.id)).code)
      .toBe("session_workspace_mismatch");
  });

  test("attaches the addressee's current state to addressed MCP mutations, replays included", async () => {
    const sender = await boundMember("mcp-sender");
    const addressee = await boundMember("mcp-addressee");
    const reviewer = await boundMember("mcp-reviewer");
    const workspace = sender.workspace_id;
    const tools = (sender.server as any)._registeredTools;
    for (const name of [
      "collab_report_append",
      "collab_handoff_offer",
      "collab_task_complete",
      "collab_task_review",
    ]) {
      expect(tools[name].description).toContain("addressee");
    }

    const noteArgs = {
      workspace_id: workspace,
      idempotency_key: "mcp-note",
      kind: "proposal",
      body: "Please look at the parser change.",
      to_session_id: addressee.session_id,
    };
    const first = await callTool(sender.server, "collab_report_append", noteArgs);
    expect(first.isError).toBeUndefined();
    expect(first.structuredContent.addressee).toEqual({
      session_id: addressee.session_id,
      liveness: "live",
      rest: null,
      delivery: "tap",
    });
    const broadcast = await callTool(sender.server, "collab_report_append", {
      workspace_id: workspace,
      idempotency_key: "mcp-broadcast",
      kind: "observation",
      body: "For everyone.",
    });
    expect(broadcast.isError).toBeUndefined();
    expect("addressee" in broadcast.structuredContent).toBe(false);

    const rested = await callTool(addressee.server, "collab_session_rest", {
      workspace_id: workspace,
      idempotency_key: "addressee-rests",
      mode: "resting",
      reason: "Back after lunch.",
      wake_on: ["addressed"],
    });
    expect(rested.isError).toBeUndefined();

    // An idempotent replay shows the addressee as it is now, never a stored copy.
    const replay = await callTool(sender.server, "collab_report_append", noteArgs);
    expect(replay.isError).toBeUndefined();
    expect(replay.structuredContent.report.id).toBe(first.structuredContent.report.id);
    expect(replay.structuredContent.addressee).toMatchObject({
      session_id: addressee.session_id,
      liveness: "resting",
      rest: { reason: "Back after lunch.", wake_on: ["addressed"] },
      delivery: "wake",
    });
    const receipt = store.db.query(`
      SELECT response_json FROM mutations WHERE idempotency_key = 'mcp-note'
    `).get() as { response_json: string };
    expect(receipt.response_json).not.toContain("addressee");

    const handoffTask = await claimedEditTask(sender, "mcp-handoff");
    const offered = await callTool(sender.server, "collab_handoff_offer", {
      workspace_id: workspace,
      idempotency_key: "mcp-offer",
      task_id: handoffTask.id,
      lease_id: handoffTask.lease_id,
      expected_version: handoffTask.version,
      to_session_id: addressee.session_id,
      summary: "Yours if you want it.",
    });
    expect(offered.isError).toBeUndefined();
    expect(offered.structuredContent.handoff.to_session_id).toBe(addressee.session_id);
    expect(offered.structuredContent.addressee).toMatchObject({
      session_id: addressee.session_id,
      liveness: "resting",
      delivery: "wake",
    });

    const plainTask = await claimedEditTask(sender, "mcp-plain");
    const plain = await callTool(sender.server, "collab_task_complete", {
      workspace_id: workspace,
      idempotency_key: "mcp-plain-complete",
      task_id: plainTask.id,
      lease_id: plainTask.lease_id,
      expected_version: plainTask.version,
      summary: "Done; anyone may review.",
    });
    expect(plain.isError).toBeUndefined();
    expect("addressee" in plain.structuredContent).toBe(false);

    const reviewTask = await claimedEditTask(sender, "mcp-review");
    const reported = await callTool(sender.server, "collab_task_complete", {
      workspace_id: workspace,
      idempotency_key: "mcp-review-complete",
      task_id: reviewTask.id,
      lease_id: reviewTask.lease_id,
      expected_version: reviewTask.version,
      summary: "Ready for the requested reviewer.",
      review_requested_session_id: reviewer.session_id,
    });
    expect(reported.isError).toBeUndefined();
    expect(reported.structuredContent.addressee).toEqual({
      session_id: reviewer.session_id,
      liveness: "live",
      rest: null,
      delivery: "tap",
    });

    // The reporter may have left by the time its review lands.
    const ended = await callTool(sender.server, "collab_session_end", {
      reason: "Done for today.",
      release_leases: true,
    });
    expect(ended.isError).toBeUndefined();
    const review = await callTool(reviewer.server, "collab_task_review", {
      workspace_id: workspace,
      idempotency_key: "mcp-review",
      task_id: reviewTask.id,
      expected_version: reported.structuredContent.task.version,
      outcome: "request_changes",
      summary: "One more regression test, please.",
    });
    expect(review.isError).toBeUndefined();
    expect(review.structuredContent.report.to_session_id).toBe(sender.session_id);
    expect(review.structuredContent.addressee).toEqual({
      session_id: sender.session_id,
      liveness: "ended",
      rest: null,
      delivery: "none",
    });
  });

  test("never turns a committed mutation into an error when the hint cannot be read", async () => {
    const sender = await boundMember("hint-failure-sender");
    const addressee = session("hint-failure-addressee");
    (sender.store as any).addresseeHint = () => {
      throw new Error("hint unavailable");
    };
    const sent = await callTool(sender.server, "collab_report_append", {
      workspace_id: sender.workspace_id,
      idempotency_key: "hint-failure-note",
      kind: "observation",
      body: "Sent even when the hint cannot be read.",
      to_session_id: addressee.session.id,
    });
    expect(sent.isError).toBeUndefined();
    expect(sent.structuredContent.report.to_session_id).toBe(addressee.session.id);
    expect("addressee" in sent.structuredContent).toBe(false);
    expect(store.listReports(sender.workspace_id, { to_session_id: addressee.session.id }))
      .toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab && bun test tests/addressee-hint.test.ts
```

Expected: `1 pass`, `3 fail`:
- "maps the addressee's liveness…": `TypeError: store.addresseeHint is not a function`
- "refuses an unknown session…": `TypeError: store.addresseeHint is not a function`, rethrown by `errorFrom` because it is not a `CollabError`
- "attaches the addressee's current state…": `Expected to contain: "addressee"` / `Received: "Append an observation, inference, proposal, or scoped decision. Reports can challenge claims without holding the task lease."`
- "never turns a committed mutation into an error…" passes already, because nothing calls the hint yet. It guards Step 3's wrapper: a `withAddressee` without its `try` makes it fail on `sent.isError` with `expect(received).toBeUndefined()` / `Received: true`.

If the third test instead fails earlier with `tool not registered: collab_session_rest` or an `isError` on `collab_session_start`, Tasks 1–2 are not in place: stop here.

- [ ] **Step 3: Write minimal implementation**

(a) `src/protocol.ts`. First check for overlap with Tasks 1–2:
```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab && grep -n "KnockDelivery\|AddresseeHint" src/protocol.ts
```
Expected: no output. If Tasks 1–2 already declared either name, replace their declaration with the one below, so the file holds exactly one of each.

Insert immediately before `export interface SessionJoinResult {`:
```ts
/** How a note would reach its addressee now; computed per call, never stored. */
export type KnockDelivery = "tap" | "wake" | "held" | "none";

/**
 * Sender hint beside an addressed mutation: the addressee's state when this
 * call ran, so an idempotent replay shows the current state, never a stored
 * one. It reports what the addressee declared, never its host: tap: live,
 * it reads the note at its next turn. wake: it declared rest with wake_on
 * addressed, so the household doorbell may wake it; whether its host can be
 * woken is recorded by the doorbell's ledger (host_cannot_wake), not here.
 * held: resting without that, or stale; the note waits for its return.
 * none: ended, departure is complete and nothing knocks. A hint only: it
 * blocks nothing and promises no delivery.
 */
export interface AddresseeHint {
  session_id: string;
  liveness: SessionLiveness;
  rest: SessionRest | null;
  delivery: KnockDelivery;
}

```

(b) `src/store.ts`

1. Imports. In the `./protocol.js` import list, insert `  type AddresseeHint,` immediately before `  type ArtifactRef,`, and `  type KnockDelivery,` immediately after `  type JournalPage,`. Then check:
```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab && grep -c "^  type SessionRest,$" src/store.ts
```
Expected `1` (Tasks 1–2's `latestRest` returns `SessionRest`). If it prints `0`, insert `  type SessionRest,` immediately after `  type SessionLiveness,`.

2. Replace (this block occurs once)
```ts
  getCoordinationSession(sessionId: string): CoordinationSession | null {
    const id = validateId(sessionId, "session_id");
    const row = this.db.query(`SELECT * FROM coordination_sessions WHERE id = ?`)
      .get(id) as CoordinationSessionRow | null;
    return row ? this.sessionProjection(row) : null;
  }
```
with
```ts
  getCoordinationSession(sessionId: string): CoordinationSession | null {
    const id = validateId(sessionId, "session_id");
    const row = this.db.query(`SELECT * FROM coordination_sessions WHERE id = ?`)
      .get(id) as CoordinationSessionRow | null;
    return row ? this.sessionProjection(row) : null;
  }

  /**
   * The sender hint for one addressed session, read now. It appends nothing
   * and does not mark the addressee seen.
   */
  addresseeHint(workspaceId: string, sessionId: string): AddresseeHint {
    const id = validateId(sessionId, "session_id");
    const read = this.db.transaction(() => {
      const row = this.requireCoordinationSessionRow(id);
      if (row.workspace_id !== workspaceId) {
        throw new CollabError(
          "session_workspace_mismatch",
          "The addressed session belongs to another workspace",
          { session_id: id },
        );
      }
      const session = this.sessionProjection(row);
      return {
        session_id: session.id,
        liveness: session.liveness,
        rest: session.rest,
        delivery: knockDelivery(session.liveness, session.rest),
      };
    });
    return read.deferred();
  }
```

3. Insert immediately before the module function `function recoveryRequiredFirst(tasks: Task[], isOwn: (task: Task) => boolean): Task[] {`:
```ts
/** live: tap; resting with wake_on addressed: wake; resting otherwise or stale: held; ended: none. */
function knockDelivery(liveness: SessionLiveness, rest: SessionRest | null): KnockDelivery {
  if (liveness === "live") return "tap";
  if (liveness === "ended") return "none";
  if (liveness === "resting" && rest?.wake_on.includes("addressed")) return "wake";
  return "held";
}

```

(c) `src/mcp.ts`

1. Insert immediately before `const nextEventLimit = z.number().int().min(1).max(50).optional()`:
```ts
const addresseeNote =
  "The result's addressee is the addressed session's state at this call, replays included: delivery tap (live), " +
  "wake (resting with wake_on addressed), held (resting otherwise, or stale) or none (ended). " +
  "A hint: it blocks nothing and promises no delivery.";
```

2. Inside `buildCollabMcpServer`, insert immediately before `  const requireLegacyActor = (value: string | undefined): string => {`:
```ts
  /** Adds the addressee's current state, computed on every call (replays too) and never stored. */
  const withAddressee = <T extends object>(
    result: T,
    workspace: string,
    addressedSessionId: string | null | undefined,
  ) => {
    if (!addressedSessionId) return result;
    try {
      return { ...result, addressee: store.addresseeHint(workspace, addressedSessionId) };
    } catch {
      // The mutation already committed; a hint that cannot be read is omitted,
      // never turned into an error that invites a duplicate send.
      return result;
    }
  };
```
TypeScript infers the return type `T | (T & { addressee: AddresseeHint })`, so `mcp.ts` needs no new import.

3. `collab_task_complete`. Replace the description (it occurs once)
```ts
        "Legacy mode is actor-reported and not review or acceptance. Bound edit tasks produce a structured completion report and remain pending until distinct-session review. Optional review_requested_session_id routes a separate review request to one active session; any distinct session may still review.",
```
with
```ts
        "Legacy mode is actor-reported and not review or acceptance. Bound edit tasks produce a structured completion report and remain pending until distinct-session review. Optional review_requested_session_id routes a separate review request to one active session; any distinct session may still review. " +
        `With review_requested_session_id: ${addresseeNote}`,
```
In its handler, replace (this text occurs once)
```ts
            summary: input.summary,
          });
      return { task };
    }),
```
with
```ts
            summary: input.summary,
          });
      // Unbound calls with review_requested_session_id were refused above.
      return withAddressee({ task }, task.workspace_id, input.review_requested_session_id);
    }),
```

4. `collab_task_review`. Replace the description (it occurs once)
```ts
        "A distinct active session accepts or requests changes. Acceptance is local coordination review—not merge, deploy, truth, or external authority.",
```
with
```ts
        "A distinct active session accepts or requests changes. Acceptance is local coordination review—not merge, deploy, truth, or external authority. " +
        `The review result is addressed to the reporter: ${addresseeNote}`,
```
In its handler, replace (this line occurs once)
```ts
      return store.reviewTaskForSession({ ...boundCredential(), ...input });
```
with
```ts
      const reviewed = store.reviewTaskForSession({ ...boundCredential(), ...input });
      return withAddressee(reviewed, reviewed.report.workspace_id, reviewed.report.to_session_id);
```

5. `collab_report_append`. Replace the description (it occurs once)
```ts
        "Append an observation, inference, proposal, or scoped decision. Reports can challenge claims without holding the task lease.",
```
with
```ts
        "Append an observation, inference, proposal, or scoped decision. Reports can challenge claims without holding the task lease. " +
        `With to_session_id: ${addresseeNote}`,
```
In its handler, replace (this text occurs once)
```ts
      return {
        report: store.appendReportForSession({ ...boundCredential(), ...input }),
      };
```
with
```ts
      const report = store.appendReportForSession({ ...boundCredential(), ...input });
      return withAddressee({ report }, report.workspace_id, report.to_session_id);
```
Leave `collab_decision_record` alone. Its bound path also calls `appendReportForSession`, but it never addresses a session.

6. `collab_handoff_offer`. Replace the description (it occurs once)
```ts
        "Invite another actor/session. The current holder keeps the coordination lease until explicit acceptance.",
```
with
```ts
        "Invite another actor/session. The current holder keeps the coordination lease until explicit acceptance. " +
        `A bound session's offer names to_session_id: ${addresseeNote}`,
```
In its handler, replace (this text occurs once)
```ts
      return binding
        ? store.offerHandoffForSession({
            ...boundCredential(),
            ...input,
            to_session_id: requiredString(to_session_id, "to_session_id"),
          })
        : store.offerHandoff({
            workspace_id,
            actor: requireLegacyActor(actor),
            ...input,
            to_actor: requiredString(to_actor, "to_actor"),
          });
```
with
```ts
      if (binding) {
        const offered = store.offerHandoffForSession({
          ...boundCredential(),
          ...input,
          to_session_id: requiredString(to_session_id, "to_session_id"),
        });
        return withAddressee(offered, offered.handoff.workspace_id, offered.handoff.to_session_id);
      }
      return store.offerHandoff({
        workspace_id,
        actor: requireLegacyActor(actor),
        ...input,
        to_actor: requiredString(to_actor, "to_actor"),
      });
```

The existing `toContain` checks on these four descriptions (`mcp.test.ts`, test "registers the complete local coordination surface": "not review or acceptance", "not merge, deploy, truth", "challenge claims", "keeps the coordination lease") still match, because every edit appends.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab && bun test tests/addressee-hint.test.ts tests/addressed-waiting.test.ts tests/review-routing.test.ts && bun test && bun run typecheck
```

Expected:
- the three named files: `17 pass`, `0 fail`. `addressee-hint.test.ts` gives `4 pass`, and `review-routing.test.ts` is unchanged, including "carries review_requested_session_id through MCP and refuses it without a bound session".
- full suite: `0 fail`. Compared with after Task 3, that is +4 tests in `tests/addressee-hint.test.ts` and one more file: 209 pass across 17 files.
- `tsc --noEmit` exits 0

Then the siblings again (both import the collab store source):
```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab-zerone && bun --no-env-file test && bun --no-env-file run typecheck && cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab-courier && bun --no-env-file test tests && bun --no-env-file run typecheck
```
Expected: `0 fail` in both, and both typechecks exit 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest && git add packages/collab/src/protocol.ts packages/collab/src/store.ts packages/collab/src/mcp.ts packages/collab/tests/addressee-hint.test.ts && git commit -F - <<'EOF'
feat(collab): tell the sender how an addressed note will reach its addressee

collab_report_append (with to_session_id), collab_handoff_offer (session
path), collab_task_complete (with review_requested_session_id) and
collab_task_review (the reporter) now return addressee: {session_id,
liveness, rest, delivery}. delivery is tap for a live session, wake for
one resting with wake_on addressed, held for one resting otherwise or
stale, and none for an ended one. It reports the addressee's declared
rest, not whether a host can wake it; the household doorbell's ledger
records that (host_cannot_wake). The MCP wrapper computes it from the
new read-only CollabStore.addresseeHint on every call, after the store
returns, so an idempotent replay shows the addressee's current state and
no stored receipt ever holds a frozen copy. A hint only: it blocks
nothing and promises no delivery, and a hint that cannot be read is
omitted rather than turning the committed mutation into an error.

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>
EOF
```

As in Task 3, `dist/` is not rebuilt in this task. Part C4 Task 8 rebuilds it, and nothing is pushed before then without Yu's go.


# Plan C, part C3 — Tasks 5–6: host binding and the read-only host verbs

> Drafted 2026-10-09 against `feat/collab-knock-and-rest-20261009` at `05b39c63` (worktree `/Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest`). Anchors are function names, test names and quoted text; `~N` line numbers are hints from `05b39c63` and drift once Tasks 1–4 land.
>
> **Verified (2026-10-09, re-run after an adversarial review)** in a fresh scratch copy of `packages/collab` at `05b39c63`. The current C1 Tasks 1–2 and C2 Tasks 3–4 drafts were applied first, verbatim and in plan order: their `src/` edits and their tests. That baseline gave 209 pass, 0 fail. Tasks 5 and 6 were then applied exactly as written here:
> - Every anchor matched exactly once.
> - Every Step 2 failure was observed as described.
> - `tsc --noEmit` was clean after each task.
> - The full Bun 1.3.13 suite went from 209 to 227 to 240 pass, 0 fail.
> - Bun 1.3.5, the CI and bundler pin, ran `process-tree`, `host-binding`, `host-knocks`, `host` and `mcp`: 59 pass, 0 fail.
> - A CI-like `env -i PATH HOME TMPDIR` run of the four host files on Bun 1.3.5 gave 39 pass, 0 fail.
> - The C3 files ran five times in a row with no failure.
>
> Ten mutations of `src/host.ts` each fail exactly one named `host-knocks` test. They drop, in turn: the walk stop, the start-time match, the orphan filter, its collab-MCP check, the app-server rule, the active-session filter, the held-rest rule, the ledger lock, the `SQLITE_CANTOPEN` fallback, and the journal-path check.
>
> A real-geometry smoke ran from this Claude seat (claude 43795, collab MCP 74944) against a throwaway journal, with a binding that names that seat:
> - `knocks --host-ancestor auto` and `--host-ancestor "$PPID"` each printed one knock line (0.06 s wall).
> - A second `--mark-tapped` printed `new: []`.
> - `--host-ancestor 1` printed nothing and exited 0.
> - `doorbell-scan` printed `{"protocol":"agenttool.collab-doorbell-scan/1","sessions":[]}`.
>
> No step read the household journal.

## Contract deviations

1. **`nearestHost(pid, options?)`**: `pid` is the collab MCP's **own** pid. The result is its **direct parent**, classified, with kind `unknown` when the parent is not a recognised host. It never walks further. S2 found that every host spawns the collab MCP as a direct child, and the spec reads `host_kind` from "the parent's `ps -o comm=`". A walk would bind an MCP started from a tool shell or a test runner to the Claude seat above it. The knock walk is a separate primitive: `ancestry()` plus a binding match in `src/host.ts`. The optional second parameter is a test seam (`process_table`, `env`).
2. **`knocks` is stricter than "count bindings with that host_pid; >1 → silent"**, always toward silence:
   - (a) A recognised Claude or Codex host on the walk that has no binding stops the walk, so a Codex started from a Claude shell never borrows the Claude seat's knocks.
   - (b) A binding counts only while its `mcp_pid` is still a collab MCP process (by argv, `isCollabMcpProcess`) and a direct child of `host_pid` in the same `ps` snapshot. An MCP that exited, for example after a `/mcp` reconnect, leaves an orphaned binding. That binding no longer makes the seat ambiguous. It also cannot come back to life when the seat's next hook shell reuses its pid.
   - (c) Only `status = 'active'` sessions count. An ended session is never knocked.
   - (d) A `codex-app-server` host must run exactly one live collab-MCP child, else silence. A hook under a shared app-server cannot be attributed to one thread, so an unbound second thread must never receive the bound thread's taps.
3. **Pointer fields:** `kind` is the journal event type (`"report.posted"` or `"handoff.offered"`), `ref_id` is the event's `entity_id` (the report or handoff id), and `from_actor` is the event's `actor`.
4. **When the verbs print:** `knocks` prints whenever exactly one active session matches, including `waiting: 0` with `new: []`; the tap hook adds context only when `new` is non-empty. `doorbell-scan` prints `{"protocol":…,"sessions":[]}` when nothing qualifies. Only non-matches and errors print nothing.
5. **`doorbell-scan`'s `new` excludes items already in the knock ledger**, because a tap already announced them. "Unknocked" means neither tapped (this ledger) nor woken (the household doorbell ledger, Part 2).
6. **CLI signature:** `runCollabHostCli(argv, env, dependencies?)` returns `{exit_code, line: string | null}`. The optional third parameter is a test seam (`process_table`, `parent_pid`, `now`). `knocks` and `doorbell-scan` must be the first argv token; `end` keeps its flags-anywhere parse and its JSON refusals.
7. **Ledger lock and pruning:** a lock file `collab-sessions/knock-ledger.json.lock` is created with O_EXCL, and a lock older than 30 s is broken. A busy, unsafe or malformed ledger means silence. When a session's `tapped` list is rewritten, it keeps only sequences that are still waiting.
8. **`openReadOnly` fallback (accepted contract amendment, 2026-10-09).** Spec Part 1 item 6 says both verbs open SQLite read-only (`readonly`, `query_only`, `busy_timeout 0`). `openReadOnly` does exactly that first. On `SQLITE_CANTOPEN` only, it reopens `{readwrite: true, create: false}` with `query_only` and `busy_timeout 0`: read-only in effect (no write statement, no transaction lock, no persistent pragma, never creates the journal), but SQLite may create the journal's own `-wal` and `-shm` sidecars. This is accepted as an amendment to the read-only contract, and "read-only" in D2's doorbell and D3's replay docstrings means this. One case needs it.
   - A WAL journal can be left with no `-wal` file. This happens when its last read-write connection closed under a SQLite that deletes the sidecars on close, such as the `sqlite3` module of Homebrew's Python (SQLite 3.53.4, reproduced). Bun on macOS keeps them.
   - On macOS, bun:sqlite uses the system SQLite 3.43.2. Its readonly connection cannot create the `-wal`, so it fails with `SQLITE_CANTOPEN` (reproduced 2026-10-09).
   - That is the doorbell's moment, when no MCP holds the journal open.
   - Only on `SQLITE_CANTOPEN` does `openReadOnly` reopen with `{readwrite: true, create: false}` and `query_only`. That handle never creates the journal, issues no write statement, takes no `BEGIN IMMEDIATE` and sets no persistent pragma. SQLite creates `-wal` and `-shm` with the journal's own `0600` mode. The test checks that the journal bytes are unchanged.
   - Newer SQLite builds open such a journal read-only and create the sidecars themselves. Homebrew's 3.53.4 does (reproduced). Bun's own SQLite on the ubuntu CI runner is expected to as well, but that was not tested here; there the fallback is simply not reached. The test therefore asserts the `SQLITE_CANTOPEN` probe only on `darwin` and checks the outcome on every platform.
9. **`host_started_at`** is the normalised `LC_ALL=C ps -o lstart=` string, for example `"Thu Oct 8 21:50:55 2026"`. It is not ISO-8601 and is compared verbatim.
10. **Binding helpers never throw:** `removeHostBinding` returns `boolean`. `readHostBindings` skips unsafe or malformed files, and a non-private directory reads as no bindings. `writeHostBinding` returns the path it wrote.
11. **Store helpers reused, so the read-only verbs cannot drift from the store.** `waiting` is judged by C2's exported `isAddressedTo(event, sessionId)`. `rest` is judged by C1's `restFromDeclaration(row, observedAt)` over the same query as C1's `latestRestDeclaration` (`entity_id` = the session, newest `session.rested` / `session.returned`). Task 6 adds `export` to C1's module-level `interface RestDeclarationRow` and `function restFromDeclaration` in `src/store.ts`; nothing else changes. Only the four-line ended → resting → stale → live precedence is restated, in `livenessAt`.
12. **Docs are C4's.** These tasks do not edit `README.md` or the skills. C4 Task 7's `### Declared rest and knocks` documents the binding file and both verbs, and C4 Task 8's install check exercises them against the installed bundle.
13. **MCP wiring:** `CollabMcpServerOptions` gains `host_binding?: HostBindingRecorder`, and the two handlers call its `record` and `forget`. When the option is omitted (in-process tests, in-memory stores), no binding file is written. `collab_session_start`'s result is unchanged, and a binding failure never fails a start. When the host cannot be read at record time, any older binding for that session is removed, so a binding is either current or absent.
14. **`--mark-tapped` never marks a held rest.** This resolves the cross-part finding in D1 ("The `knocks` verb") and D3 deviation 8.
   - A session resting without `wake_on: ["addressed"]` is still reported, with `liveness: "resting"`, its `rest` and the untapped `new` items. Nothing is written to the knock ledger.
   - D1's tap prints nothing for it. Its items therefore tap once, at the first turn after the session returns, instead of being marked silently and lost to the tap.
   - A rest with `wake_on: ["addressed"]` is tapped and marked like a live session. Its seat is evidently taking turns, and a marked item is then not also woken by the doorbell.
15. **The journal path must be a private regular file.** `knocks` and `doorbell-scan` refuse, silently, any path that the store's own `assertSafeDatabaseFile` would refuse: a symlink, a hard-linked file or a file another user owns. The `SQLITE_CANTOPEN` read-write fallback therefore never opens a file the store would not.
16. **`isCollabMcpProcess` also matches the `.ts` source entry** (`bin/agenttool-collab-mcp.ts`), besides the S2 rule's `agenttool-collab-mcp` and `agenttool-collab-mcp.js`. A collab MCP run from a source checkout counts for the app-server rule and for deviation 2(b). The bin test relies on this, because it runs the real MCP from source as the host's child.

## Consumes from Tasks 1–4 (the exact shapes these tasks call)

- `src/protocol.ts`:
  - `SessionLiveness = "live" | "resting" | "stale" | "ended"`
  - `RestWakeOn`
  - `SessionRest {mode: "resting", since, until: string | null, reason: string | null, wake_on: RestWakeOn[]}`
  - `CoordinationSession.rest`
  - `CollabEventType` including `"session.rested"` and `"session.returned"`
  - the existing `SESSION_STALE_AFTER_MS`
- `store.restSessionForSession({session_id, session_token, generation, idempotency_key, mode: "resting" | "ready", until?, reason?, wake_on?})` → `CoordinationSession`:
  - It appends `session.rested` with payload `{mode: "resting", until, reason, wake_on}` (`until` and `reason` are `null` when omitted, `wake_on` is `[]` when omitted), or `session.returned`.
  - It appends through `mutateAsSession`, so the event's `session_id` column is the resting session.
  - `SessionRest.since` is that event's `occurred_at`.
- `store.getCoordinationSession(id)` returns `liveness` (precedence ended → resting → stale → live) and `rest`, which is null once expired.
- Bound MCP `collab_next` returns `structuredContent.session.addressed_waiting`.
- From C1 (Task 1), in `src/store.ts`: module-level `interface RestDeclarationRow {type, sequence, occurred_at, payload_json}` and `function restFromDeclaration(row, observedAt): SessionRest | null`, placed immediately before `function sessionLiveness(`. Task 6 exports both.
- From C2 (Task 3), in `src/store.ts`: `export interface AddressedEventRow {type, session_id, payload_json}` and `export function isAddressedTo(event, sessionId): boolean`.
- Task 2 has already rewritten `tests/liveness.test.ts`, so ended no longer reads stale. Without that rewrite the full suite shows that one failure.

If any of these differ at merge, the Task 6 parity test "agrees with the store's liveness and rest and with collab_next's addressed_waiting" will fail. Reconcile the SQL in `restAt` / `addressedItems` in `src/host.ts` with the store, not the test.

---

### Task 5: Host binding from the process tree

**Files:**
- Create:
  - `packages/collab/src/process-tree.ts`
  - `packages/collab/src/host-binding.ts`
  - `packages/collab/tests/process-tree.test.ts`
  - `packages/collab/tests/host-binding.test.ts`
- Modify:
  - `packages/collab/src/mcp.ts`:
    - the import block (~3-4)
    - `interface CollabMcpServerOptions` (~76-81)
    - the `collab_session_start` handler body, from `const handle = store.startSession(input);` to its closing `}),` (~263-281)
    - the `collab_session_end` handler, after `binding = null;` (~315)
  - `packages/collab/bin/agenttool-collab-mcp.ts`: whole file
  - `packages/collab/src/host.ts`:
    - the import block (~1-10)
    - the `const store = new CollabStore(databasePath); try { … } finally` block in `runCollabHostCli` (~137-150)

**Interfaces:**
- **Consumes:**
  - `CollabStore.startSession`, `resumeSession`, `defaultSessionCredentialPath`, `endSession` and `getCoordinationSession` (existing)
  - `writeSessionCredentialFile` (existing)
  - `endSessionFromCredential` and `runCollabHostCli` (existing `src/host.ts`)
  - nothing from Tasks 1–4
- **Produces:**
  - `src/process-tree.ts` exports:
    - `type HostKind = "claude-code" | "codex" | "codex-app-server" | "unknown"`
    - `ProcessRecord {pid, ppid, started_at, comm, args}`, `ProcessTable` and `HostProcess {pid, started_at, kind}`
    - `ProcessTreeOptions {process_table?, env?}`
    - `parseProcessTable(statusOutput, argsOutput)` and `readProcessTable(): ProcessTable | null` (two `/bin/ps -A -ww` calls, `LC_ALL=C`, 2 s timeout, null on any failure)
    - `hostKindOf(record, env)`, `isHostProcess(record)` and `isCollabMcpProcess(record)`
    - `nearestHost(pid, options?): HostProcess | null`
    - `ancestry(pid, table): ProcessRecord[]`
  - `src/host-binding.ts` exports:
    - `HOST_BINDING_FORMAT` and `HostBinding`
    - `collabSessionsDirectory(dbPath)` and `hostBindingPath(dbPath, sessionId)`
    - `writeHostBinding(dbPath, binding): string`, written atomically, mode 0600, directory 0700
    - `removeHostBinding(dbPath, sessionId): boolean`
    - `readHostBindings(dbPath): HostBinding[]`
    - `HostBindingRecorder {record(sessionId, credentialFilePath): boolean; forget(sessionId): void}`
    - `hostBindingRecorder(dbPath, {mcp_pid?, process_table?, env?, now?})`
  - Binding file: `dirname(db)/collab-sessions/<session_id>.host.json`, containing `{"format":"agenttool.collab-host-binding/1","session_id","host_kind","host_pid","host_started_at","mcp_pid","credential_file_path","written_at"}`.
  - `CollabMcpServerOptions.host_binding?: HostBindingRecorder`. `collab_session_start` records the binding after the credential file is written, and `collab_session_end` forgets it before removing the credential file.
  - The bin's resume path (`AGENTOOL_COLLAB_SESSION_FILE`) records the binding after rewriting the credential file. The bin passes the recorder to the server. An in-memory `:memory:` journal gets no recorder.
  - `agenttool-collab-host end` removes the binding after `ended` and after `already_ended`.

- [ ] **Step 1: Write the failing tests**

Create `packages/collab/tests/process-tree.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  ancestry,
  hostKindOf,
  isCollabMcpProcess,
  isHostProcess,
  nearestHost,
  parseProcessTable,
  readProcessTable,
  type ProcessRecord,
  type ProcessTable,
} from "../src/process-tree.js";

function record(pid: number, ppid: number, comm: string, args = comm): ProcessRecord {
  return { pid, ppid, started_at: `Fri Oct 9 10:00:${String(pid % 60).padStart(2, "0")} 2026`, comm, args };
}

function table(...records: ProcessRecord[]): ProcessTable {
  return new Map(records.map((entry) => [entry.pid, entry]));
}

describe("process table parsing", () => {
  test("collapses lstart spacing, keeps spaced executable paths, and joins argv", () => {
    const parsed = parseProcessTable(
      [
        "    1     0 Thu Oct  8 08:00:01 2026     /sbin/launchd",
        "43795 43695 Thu Oct  8 21:50:55 2026     claude",
        " 1212   782 Fri Oct  9 07:12:03 2026     /Applications/Some App.app/Contents/Resources/codex",
        "not a process line",
      ].join("\n"),
      [
        "    1 /sbin/launchd",
        "43795 claude --resume",
        " 1212 /Applications/Some App.app/Contents/Resources/codex -c features.code_mode_host=true app-server --analytics-default-enabled",
        "99999 a process that ended between the two ps calls",
      ].join("\n"),
    );
    expect([...parsed.keys()]).toEqual([1, 43795, 1212]);
    expect(parsed.get(43795)).toEqual({
      pid: 43795,
      ppid: 43695,
      started_at: "Thu Oct 8 21:50:55 2026",
      comm: "claude",
      args: "claude --resume",
    });
    expect(parsed.get(1212)?.comm).toBe("/Applications/Some App.app/Contents/Resources/codex");
    expect(parsed.get(1212)?.started_at).toBe("Fri Oct 9 07:12:03 2026");
  });

  test("reads this test process from the real process table", () => {
    const live = readProcessTable();
    expect(live).not.toBeNull();
    const self = live!.get(process.pid);
    expect(self?.ppid).toBe(process.ppid);
    expect(self?.started_at).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/);
  });
});

describe("host classification (S2 rules)", () => {
  test("claude needs the MCP's CLAUDE_CODE_SESSION_ID; codex splits TUI/exec, app-server and its supervisor", () => {
    const claude = record(100, 1, "/Users/someone/.local/bin/claude", "claude");
    expect(hostKindOf(claude, { CLAUDE_CODE_SESSION_ID: "abc" })).toBe("claude-code");
    expect(hostKindOf(claude, {})).toBe("unknown");
    expect(hostKindOf(claude, { CLAUDE_CODE_SESSION_ID: "" })).toBe("unknown");
    expect(hostKindOf(claude, { CLAUDE_PID: "100" })).toBe("unknown");
    expect(hostKindOf(record(101, 1, "codex", "codex"), {})).toBe("codex");
    expect(hostKindOf(record(102, 1, "codex", "codex -a never exec --json -"), {})).toBe("codex");
    expect(hostKindOf(record(
      103, 1, "/Applications/ChatGPT.app/Contents/Resources/codex",
      "/Applications/ChatGPT.app/Contents/Resources/codex -c features.code_mode_host=true app-server --analytics-default-enabled",
    ), {})).toBe("codex-app-server");
    expect(hostKindOf(record(
      104, 1, "/x/app-server-daemon/releases/0.162.0/bin/codex",
      "/x/app-server-daemon/releases/0.162.0/bin/codex app-server --listen unix:// --managed-daemon",
    ), {})).toBe("codex-app-server");
    const supervisor = record(
      105, 1, "/x/app-server-daemon/releases/0.162.0/bin/codex",
      "/x/app-server-daemon/releases/0.162.0/bin/codex app-server daemon pid-update-loop",
    );
    expect(hostKindOf(supervisor, {})).toBe("unknown");
    expect(isHostProcess(supervisor)).toBe(false);
    expect(hostKindOf(record(106, 1, "bun", "bun dist/agenttool-collab-mcp.js"), {})).toBe("unknown");
    expect(isHostProcess(claude)).toBe(true);
    expect(isHostProcess(record(107, 1, "/bin/zsh"))).toBe(false);
  });

  test("recognises collab MCP processes by argv", () => {
    expect(isCollabMcpProcess(record(1, 1, "bun", "bun dist/agenttool-collab-mcp.js"))).toBe(true);
    expect(isCollabMcpProcess(record(2, 1, "bun", "bun /opt/homebrew/bin/agenttool-collab-mcp"))).toBe(true);
    expect(isCollabMcpProcess(record(3, 1, "bun", "/abs/bun /abs/pkg/dist/agenttool-collab-mcp.js"))).toBe(true);
    expect(isCollabMcpProcess(record(6, 1, "bun", "/abs/bun /abs/pkg/bin/agenttool-collab-mcp.ts"))).toBe(true);
    expect(isCollabMcpProcess(record(4, 1, "bun", "bun dist/agenttool-collab-host.js knocks"))).toBe(false);
    expect(isCollabMcpProcess(record(5, 1, "node", "node not-agenttool-collab-mcp-x.js"))).toBe(false);
    expect(isCollabMcpProcess(record(7, 1, "/bin/zsh", "/bin/zsh -c knock-tap"))).toBe(false);
  });
});

describe("nearestHost", () => {
  const tree = table(
    record(1, 0, "/sbin/launchd"),
    record(4100, 1, "claude"),
    record(4101, 4100, "bun", "bun /opt/homebrew/bin/agenttool-collab-mcp"),
    record(4200, 4100, "/bin/zsh"),
    record(4201, 4200, "bun", "bun dist/agenttool-collab-mcp.js"),
  );

  test("is the MCP's direct parent, classified, never a further ancestor", () => {
    expect(nearestHost(4101, { process_table: () => tree, env: { CLAUDE_CODE_SESSION_ID: "s" } })).toEqual({
      pid: 4100,
      started_at: tree.get(4100)!.started_at,
      kind: "claude-code",
    });
    // A collab MCP started from a tool shell binds to that shell, not to the seat above it.
    expect(nearestHost(4201, { process_table: () => tree, env: { CLAUDE_CODE_SESSION_ID: "s" } })).toEqual({
      pid: 4200,
      started_at: tree.get(4200)!.started_at,
      kind: "unknown",
    });
  });

  test("fails closed: unreadable table, unknown pid, missing parent, or launchd parent", () => {
    expect(nearestHost(4101, { process_table: () => null })).toBeNull();
    expect(nearestHost(9999, { process_table: () => tree })).toBeNull();
    expect(nearestHost(4101, { process_table: () => table(record(4101, 4100, "bun")) })).toBeNull();
    expect(nearestHost(4100, { process_table: () => tree })).toBeNull();
  });

  test("describes this test process's real parent", () => {
    const host = nearestHost(process.pid);
    expect(host?.pid).toBe(process.ppid);
    expect(host?.started_at).toBe(readProcessTable()!.get(process.ppid)!.started_at);
  });
});

describe("ancestry", () => {
  test("lists pid then ancestors, nearest first, and stops at missing pids and cycles", () => {
    const tree = table(record(1, 0, "launchd"), record(10, 1, "claude"), record(20, 10, "zsh"), record(30, 20, "sh"));
    expect(ancestry(30, tree).map((entry) => entry.pid)).toEqual([30, 20, 10, 1]);
    expect(ancestry(77, tree)).toEqual([]);
    const cyclic = table(record(5, 6, "a"), record(6, 5, "b"));
    expect(ancestry(5, cyclic).map((entry) => entry.pid)).toEqual([5, 6]);
  });
});
```

Create `packages/collab/tests/host-binding.test.ts`. The last test spawns `bin/agenttool-collab-mcp.ts` with `AGENTOOL_COLLAB_SESSION_FILE` set, so it checks the real `ps` path, the bin's resume path and the bin's wiring of `host_binding` into the server. The last of these is checked through `collab_session_end` over stdio:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCollabHostCli } from "../src/host.js";
import {
  HOST_BINDING_FORMAT,
  hostBindingPath,
  hostBindingRecorder,
  readHostBindings,
  removeHostBinding,
  writeHostBinding,
  type HostBinding,
} from "../src/host-binding.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import { readProcessTable, type ProcessRecord, type ProcessTable } from "../src/process-tree.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { CollabStore } from "../src/store.js";

const packageRoot = resolve(import.meta.dir, "..");
const mcpEntry = join(packageRoot, "bin", "agenttool-collab-mcp.ts");

let directory: string;
let root: string;
let databasePath: string;
let sessionsDirectory: string;
let store: CollabStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-binding-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  sessionsDirectory = join(directory, "state", "collab-sessions");
  store = new CollabStore(databasePath);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function binding(sessionId: string, overrides: Partial<HostBinding> = {}): HostBinding {
  return {
    format: HOST_BINDING_FORMAT,
    session_id: sessionId,
    host_kind: "codex",
    host_pid: 4100,
    host_started_at: "Fri Oct 9 10:00:00 2026",
    mcp_pid: 4101,
    credential_file_path: join(sessionsDirectory, `${sessionId}.json`),
    written_at: "2026-10-09T10:00:05.000Z",
    ...overrides,
  };
}

function fakeTable(...records: Array<Partial<ProcessRecord> & { pid: number; ppid: number }>): ProcessTable {
  return new Map(records.map((entry) => [entry.pid, {
    started_at: "Fri Oct 9 10:00:00 2026",
    comm: "bun",
    args: "bun",
    ...entry,
  }]));
}

async function callTool(server: any, name: string, args: Record<string, unknown> = {}) {
  const registration = server._registeredTools[name];
  return await (registration.handler ?? registration.callback)(args, {});
}

describe("host binding files", () => {
  test("write, read and replace one private binding per session beside the credential files", () => {
    const first = binding("session_a");
    const path = writeHostBinding(databasePath, first);
    expect(path).toBe(join(sessionsDirectory, "session_a.host.json"));
    expect(hostBindingPath(databasePath, "session_a")).toBe(path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(sessionsDirectory).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(first);
    expect(readHostBindings(databasePath)).toEqual([first]);

    const replaced = binding("session_a", { host_kind: "claude-code", host_pid: 5100, mcp_pid: 5101 });
    writeHostBinding(databasePath, replaced);
    expect(readHostBindings(databasePath)).toEqual([replaced]);
    expect(readdirSync(sessionsDirectory)).toEqual(["session_a.host.json"]);
  });

  test("refuses malformed bindings and unsafe session ids before touching disk", () => {
    for (const bad of [
      binding("../escape"),
      binding("session_a", { credential_file_path: "relative/session_a.json" }),
      binding("session_a", { host_pid: 1 }),
      binding("session_a", { host_kind: "hermes" as never }),
      binding("session_a", { host_started_at: " " }),
    ]) {
      expect(() => writeHostBinding(databasePath, bad)).toThrow();
    }
    expect(existsSync(sessionsDirectory)).toBe(false);
  });

  test("reads only well-formed private *.host.json files named for their session", () => {
    writeHostBinding(databasePath, binding("session_b"));
    writeHostBinding(databasePath, binding("session_a"));
    const write = (name: string, body: string, mode = 0o600) => {
      writeFileSync(join(sessionsDirectory, name), body, { mode });
      chmodSync(join(sessionsDirectory, name), mode);
    };
    write("session_c.host.json", "{not json");
    write("session_d.host.json", JSON.stringify(binding("session_other")));
    write("session_e.host.json", JSON.stringify(binding("session_e")), 0o644);
    write("session_f.json", JSON.stringify(binding("session_f")));
    write("knock-ledger.json", JSON.stringify({ format: "agenttool.collab-knock-ledger/1", tapped: {} }));
    symlinkSync(join(sessionsDirectory, "session_a.host.json"), join(sessionsDirectory, "session_g.host.json"));
    expect(readHostBindings(databasePath).map((entry) => entry.session_id)).toEqual(["session_a", "session_b"]);

    chmodSync(sessionsDirectory, 0o755);
    try {
      expect(readHostBindings(databasePath)).toEqual([]);
    } finally {
      chmodSync(sessionsDirectory, 0o700);
    }
    expect(readHostBindings(join(directory, "nowhere", "collab.sqlite"))).toEqual([]);
  });

  test("removal is idempotent and never follows a symlink", () => {
    writeHostBinding(databasePath, binding("session_a"));
    expect(removeHostBinding(databasePath, "session_a")).toBe(true);
    expect(existsSync(join(sessionsDirectory, "session_a.host.json"))).toBe(false);
    expect(removeHostBinding(databasePath, "session_a")).toBe(true);
    expect(removeHostBinding(databasePath, "../escape")).toBe(false);

    const target = join(directory, "target.json");
    writeFileSync(target, "keep");
    symlinkSync(target, join(sessionsDirectory, "session_link.host.json"));
    expect(removeHostBinding(databasePath, "session_link")).toBe(false);
    expect(readFileSync(target, "utf8")).toBe("keep");
  });
});

describe("hostBindingRecorder", () => {
  const seat = fakeTable(
    { pid: 1, ppid: 0, comm: "/sbin/launchd" },
    { pid: 4100, ppid: 1, comm: "/Users/someone/.local/bin/claude", args: "claude", started_at: "Thu Oct 8 21:50:55 2026" },
    { pid: 4101, ppid: 4100, args: "bun /opt/homebrew/bin/agenttool-collab-mcp" },
  );

  test("records the MCP's direct parent as the host, and forgets on request", () => {
    const recorder = hostBindingRecorder(databasePath, {
      mcp_pid: 4101,
      process_table: () => seat,
      env: { CLAUDE_CODE_SESSION_ID: "claude-session" },
      now: () => new Date("2026-10-09T12:00:00.000Z"),
    });
    expect(recorder.record("session_a", join(sessionsDirectory, "session_a.json"))).toBe(true);
    expect(readHostBindings(databasePath)).toEqual([{
      format: HOST_BINDING_FORMAT,
      session_id: "session_a",
      host_kind: "claude-code",
      host_pid: 4100,
      host_started_at: "Thu Oct 8 21:50:55 2026",
      mcp_pid: 4101,
      credential_file_path: join(sessionsDirectory, "session_a.json"),
      written_at: "2026-10-09T12:00:00.000Z",
    }]);
    recorder.forget("session_a");
    expect(readHostBindings(databasePath)).toEqual([]);
  });

  test("leaves no stale binding when the host cannot be read", () => {
    writeHostBinding(databasePath, binding("session_a"));
    const blind = hostBindingRecorder(databasePath, { mcp_pid: 4101, process_table: () => null });
    expect(blind.record("session_a", join(sessionsDirectory, "session_a.json"))).toBe(false);
    expect(readHostBindings(databasePath)).toEqual([]);
  });
});

describe("binding lifecycle through the MCP server and the host CLI", () => {
  test("collab_session_start records the host and collab_session_end removes it", async () => {
    const recorder = hostBindingRecorder(databasePath, {
      mcp_pid: 4101,
      process_table: () => fakeTable(
        { pid: 4100, ppid: 1, comm: "codex", args: "codex" },
        { pid: 4101, ppid: 4100, args: "bun dist/agenttool-collab-mcp.js" },
      ),
      env: {},
    });
    const server = buildCollabMcpServer(store, { host_binding: recorder });
    const started = await callTool(server, "collab_session_start", { root_path: root, actor: "binding-start" });
    expect(started.isError).toBeUndefined();
    const sessionId = started.structuredContent.session.id as string;
    expect(started.structuredContent).not.toHaveProperty("host_binding");
    expect(readHostBindings(databasePath)).toEqual([expect.objectContaining({
      session_id: sessionId,
      host_kind: "codex",
      host_pid: 4100,
      mcp_pid: 4101,
      credential_file_path: store.defaultSessionCredentialPath(sessionId),
    })]);

    const ended = await callTool(server, "collab_session_end", { reason: "done" });
    expect(ended.isError).toBeUndefined();
    expect(readHostBindings(databasePath)).toEqual([]);
    expect(existsSync(store.defaultSessionCredentialPath(sessionId))).toBe(false);
  });

  test("a server built without a recorder writes no binding", async () => {
    const server = buildCollabMcpServer(store);
    const started = await callTool(server, "collab_session_start", { root_path: root, actor: "binding-none" });
    expect(started.isError).toBeUndefined();
    expect(readHostBindings(databasePath)).toEqual([]);
    expect(readdirSync(sessionsDirectory).filter((name) => name.endsWith(".host.json"))).toEqual([]);
  });

  test("agenttool-collab-host end removes the binding, for ended and already_ended alike", () => {
    for (const alreadyEnded of [false, true]) {
      const handle = store.startSession({ root_path: root, actor: `binding-host-end-${alreadyEnded}` });
      const file = writeSessionCredentialFile(store.defaultSessionCredentialPath(handle.session.id), handle.credential);
      writeHostBinding(databasePath, binding(handle.session.id, { credential_file_path: file }));
      if (alreadyEnded) store.endSession({ ...handle.credential, reason: "ended in-process first" });

      const run = runCollabHostCli(
        ["end", "--session-file", file, "--reason", "host exit sweep", "--db", databasePath],
        {},
      );
      expect(run.exit_code).toBe(0);
      expect(JSON.parse(run.line!).status).toBe(alreadyEnded ? "already_ended" : "ended");
      expect(existsSync(hostBindingPath(databasePath, handle.session.id))).toBe(false);
    }
  });

  test("the bin's resume path records its real parent, and its session end removes the binding", async () => {
    const handle = store.startSession({ root_path: root, actor: "binding-resume" });
    const file = writeSessionCredentialFile(store.defaultSessionCredentialPath(handle.session.id), handle.credential);
    const child = Bun.spawn([process.execPath, mcpEntry], {
      cwd: packageRoot,
      env: {
        AGENTOOL_COLLAB_DB: databasePath,
        AGENTOOL_COLLAB_SESSION_FILE: file,
        PATH: process.env.PATH ?? "",
        TMPDIR: tmpdir(),
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      const reader = child.stdout.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      const request = async (id: number, method: string, params: Record<string, unknown>) => {
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
        await child.stdin.flush();
        while (true) {
          const newline = buffered.indexOf("\n");
          if (newline >= 0) {
            const line = buffered.slice(0, newline);
            buffered = buffered.slice(newline + 1);
            const message = JSON.parse(line);
            if (message.id === id) return message.result;
            continue;
          }
          const chunk = await reader.read();
          if (chunk.done) throw new Error("MCP stdout closed");
          buffered += decoder.decode(chunk.value, { stream: true });
        }
      };
      await request(1, "initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "binding-test", version: "0" },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);

      // The binding is written before the transport connects, so it exists by now.
      const recorded = readHostBindings(databasePath);
      expect(recorded).toEqual([{
        format: HOST_BINDING_FORMAT,
        session_id: handle.session.id,
        host_kind: "unknown",
        host_pid: process.pid,
        host_started_at: readProcessTable()!.get(process.pid)!.started_at,
        mcp_pid: child.pid,
        credential_file_path: file,
        written_at: expect.any(String),
      }]);

      const ended = await request(2, "tools/call", {
        name: "collab_session_end",
        arguments: { reason: "binding test done" },
      });
      expect(ended.isError).toBeUndefined();
      expect(readHostBindings(databasePath)).toEqual([]);
    } finally {
      child.kill();
      await child.exited;
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab && bun test tests/process-tree.test.ts tests/host-binding.test.ts
```

Expected: 0 pass. Each file stops at load with `error: Cannot find module '../src/process-tree.js' from '…/tests/process-tree.test.ts'` (and likewise `'../src/host-binding.js'`).

- [ ] **Step 3: Implement**

(a) Create `packages/collab/src/process-tree.ts`. It is ported from `/Users/yuai/.cache/sol/workspaces/knock-spikes-20261009/S2/nearest-host.mjs`, with the S2 rules: the host is the MCP's direct parent, `claude-code` needs basename `claude` and `CLAUDE_CODE_SESSION_ID`, never `CLAUDE_PID`, and `app-server daemon pid-update-loop` is never a host:

```ts
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

/**
 * Which local host runs a collab MCP process. Derived from the process tree,
 * never from a model's claim (spike S2, 2026-10-09).
 */
export type HostKind = "claude-code" | "codex" | "codex-app-server" | "unknown";

type Environment = Record<string, string | undefined>;

export interface ProcessRecord {
  pid: number;
  ppid: number;
  /**
   * `LC_ALL=C ps -o lstart=` with whitespace runs collapsed, for example
   * "Thu Oct 8 21:50:55 2026". Compared verbatim to guard against pid reuse.
   */
  started_at: string;
  /** `ps -o comm=`: the executable path or name. */
  comm: string;
  /** `ps -o args=`: the argument vector, space-joined. */
  args: string;
}

/** One point-in-time process table keyed by pid. */
export type ProcessTable = ReadonlyMap<number, ProcessRecord>;

export interface HostProcess {
  pid: number;
  started_at: string;
  kind: HostKind;
}

export interface ProcessTreeOptions {
  /** Reads the process table; null means it could not be read. Default: readProcessTable. */
  process_table?: () => ProcessTable | null;
  /** The collab MCP's own environment, for CLAUDE_CODE_SESSION_ID. Default: process.env. */
  env?: Environment;
}

const PS = "/bin/ps";
const PS_TIMEOUT_MS = 2_000;
const MAX_ANCESTRY = 256;
// lstart is always five tokens under LC_ALL=C: "Thu Oct  8 21:50:55 2026".
const STATUS_LINE = /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/;
const ARGS_LINE = /^\s*(\d+)\s+(.*)$/;
const COLLAB_MCP_ARGS = /(^|[\s/])agenttool-collab-mcp(\.[jt]s)?(\s|$)/;

/** Parse `ps -A -ww -o pid=,ppid=,lstart=,comm=` and `ps -A -ww -o pid=,args=` output. */
export function parseProcessTable(statusOutput: string, argsOutput: string): ProcessTable {
  const table = new Map<number, ProcessRecord>();
  for (const line of statusOutput.split("\n")) {
    const match = STATUS_LINE.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    table.set(pid, {
      pid,
      ppid: Number(match[2]),
      started_at: match[3]!.replace(/\s+/g, " "),
      comm: match[4]!.trim(),
      args: "",
    });
  }
  for (const line of argsOutput.split("\n")) {
    const match = ARGS_LINE.exec(line);
    if (!match) continue;
    const record = table.get(Number(match[1]));
    if (record) record.args = match[2]!.trim();
  }
  return table;
}

/**
 * Read the whole process table with two `/bin/ps` calls under `LC_ALL=C`.
 * Returns null when ps fails or is denied (it may be inside a Codex
 * seatbelt); every caller then fails closed.
 */
export function readProcessTable(): ProcessTable | null {
  try {
    const run = (format: string) =>
      execFileSync(PS, ["-A", "-ww", "-o", format], {
        encoding: "utf8",
        env: { LC_ALL: "C", PATH: "/usr/bin:/bin" },
        maxBuffer: 64 * 1024 * 1024,
        timeout: PS_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "ignore"],
      });
    const table = parseProcessTable(run("pid=,ppid=,lstart=,comm="), run("pid=,args="));
    return table.size > 0 ? table : null;
  } catch {
    return null;
  }
}

/**
 * Classify one process as a collab MCP host. `claude-code` needs basename
 * `claude` and the MCP's own CLAUDE_CODE_SESSION_ID (never CLAUDE_PID).
 * `codex ... app-server` is the Desktop app-server; `codex app-server daemon
 * pid-update-loop` only supervises it and is never a host.
 */
export function hostKindOf(record: ProcessRecord, env: Environment): HostKind {
  const name = basename(record.comm);
  if (name === "claude") return env.CLAUDE_CODE_SESSION_ID ? "claude-code" : "unknown";
  if (name !== "codex") return "unknown";
  const argv = record.args.split(/\s+/).slice(1);
  if (!argv.includes("app-server")) return "codex";
  return argv.includes("daemon") ? "unknown" : "codex-app-server";
}

/**
 * Whether a process is a Claude or Codex host by its executable and argv
 * alone. The knock walk uses it to stop at the nearest host; it has no MCP
 * environment to consult.
 */
export function isHostProcess(record: ProcessRecord): boolean {
  if (basename(record.comm) === "claude") return true;
  return hostKindOf(record, {}) !== "unknown";
}

/**
 * Whether a process is a collab MCP server, by its argv (the S2 prototype rule,
 * widened to the `.ts` source entry): the installed bin, a plugin's
 * `dist/agenttool-collab-mcp.js`, or `bin/agenttool-collab-mcp.ts`.
 */
export function isCollabMcpProcess(record: ProcessRecord): boolean {
  return COLLAB_MCP_ARGS.test(record.args);
}

/**
 * The host of the collab MCP process `pid`: its direct parent, classified.
 * S2 found every host (Claude Code, Codex TUI and exec, the Desktop
 * app-server) spawns the collab MCP as a direct child, so the nearest host is
 * never a further ancestor. A collab MCP started from a tool shell or a test
 * runner binds to that process (kind `unknown`), never to the seat above it.
 * Null when the table cannot be read or either process is missing.
 */
export function nearestHost(pid: number, options: ProcessTreeOptions = {}): HostProcess | null {
  const table = (options.process_table ?? readProcessTable)();
  if (!table) return null;
  const self = table.get(pid);
  if (!self) return null;
  const parent = table.get(self.ppid);
  if (!parent || parent.pid <= 1) return null;
  return {
    pid: parent.pid,
    started_at: parent.started_at,
    kind: hostKindOf(parent, options.env ?? process.env),
  };
}

/** `pid` and its ancestors, nearest first; stops at a missing pid, a cycle, or 256 steps. */
export function ancestry(pid: number, table: ProcessTable): ProcessRecord[] {
  const chain: ProcessRecord[] = [];
  const seen = new Set<number>();
  let current = pid;
  while (current > 0 && chain.length < MAX_ANCESTRY && !seen.has(current)) {
    const record = table.get(current);
    if (!record) break;
    chain.push(record);
    seen.add(current);
    current = record.ppid;
  }
  return chain;
}
```

(b) Create `packages/collab/src/host-binding.ts`:

```ts
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { CollabError } from "./errors.js";
import { nearestHost, type HostKind, type ProcessTreeOptions } from "./process-tree.js";

export const HOST_BINDING_FORMAT = "agenttool.collab-host-binding/1" as const;

/**
 * Which host process runs a bound session, written by that session's own MCP
 * process from the process tree. Non-secret: it names the credential file but
 * never holds the bearer.
 */
export interface HostBinding {
  format: typeof HOST_BINDING_FORMAT;
  session_id: string;
  host_kind: HostKind;
  host_pid: number;
  host_started_at: string;
  mcp_pid: number;
  credential_file_path: string;
  written_at: string;
}

const HOST_KINDS: readonly HostKind[] = ["claude-code", "codex", "codex-app-server", "unknown"];
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const BINDING_SUFFIX = ".host.json";

/** `dirname(db)/collab-sessions`: the directory credential files already use. */
export function collabSessionsDirectory(dbPath: string): string {
  return join(dirname(resolve(dbPath)), "collab-sessions");
}

/** `dirname(db)/collab-sessions/<session_id>.host.json`. */
export function hostBindingPath(dbPath: string, sessionId: string): string {
  if (!isSessionId(sessionId)) {
    throw new CollabError("invalid_session_id", "session_id contains unsupported characters");
  }
  return join(collabSessionsDirectory(dbPath), `${sessionId}${BINDING_SUFFIX}`);
}

/** Atomically write (or replace) one binding, mode 0600, in a private directory. */
export function writeHostBinding(dbPath: string, binding: HostBinding): string {
  if (!isHostBinding(binding)) {
    throw new CollabError("host_binding_invalid", "The host binding is malformed", {
      operation: "write_host_binding",
    });
  }
  const directory = collabSessionsDirectory(dbPath);
  const path = hostBindingPath(dbPath, binding.session_id);
  let temporary: string | null = null;
  try {
    const existed = existsSync(directory);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!existed) chmodSync(directory, 0o700);
    if (!isPrivateDirectory(directory)) {
      throw new CollabError(
        "session_directory_not_private",
        "Session credential directory must be a private non-symlink directory owned by this user",
        { operation: "write_host_binding" },
      );
    }
    if (pathExists(path) && !isPrivateFile(path)) {
      throw new CollabError(
        "host_binding_unsafe",
        "Refusing to replace a host binding path that is not a private regular file",
        { operation: "write_host_binding" },
      );
    }
    temporary = `${path}.tmp-${randomUUID()}`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(binding)}\n`, "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, path);
    temporary = null;
    chmodSync(path, 0o600);
    return path;
  } catch (error) {
    if (temporary) {
      try {
        unlinkSync(temporary);
      } catch {
        // The primary error below names the failed binding write.
      }
    }
    if (error instanceof CollabError) throw error;
    throw new CollabError("host_binding_write_failed", "Could not write the local host binding file", {
      operation: "write_host_binding",
    });
  }
}

/**
 * Remove one binding. True when it is gone (or never existed); false when it
 * could not be removed or the path is not a private regular file. Never throws.
 */
export function removeHostBinding(dbPath: string, sessionId: string): boolean {
  try {
    const path = hostBindingPath(dbPath, sessionId);
    if (!pathExists(path)) return true;
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !isOwnedByCurrentUser(stat.uid)) return false;
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every well-formed binding in a private `collab-sessions` directory, sorted
 * by session id. Unsafe or malformed files are skipped, never trusted; a
 * missing or non-private directory reads as none. Never throws.
 */
export function readHostBindings(dbPath: string): HostBinding[] {
  const directory = collabSessionsDirectory(dbPath);
  let names: string[];
  try {
    if (!isPrivateDirectory(directory)) return [];
    names = readdirSync(directory).sort();
  } catch {
    return [];
  }
  const bindings: HostBinding[] = [];
  for (const name of names) {
    if (!name.endsWith(BINDING_SUFFIX)) continue;
    const path = join(directory, name);
    try {
      if (!isPrivateFile(path)) continue;
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!isHostBinding(parsed) || `${parsed.session_id}${BINDING_SUFFIX}` !== name) continue;
      bindings.push({
        format: HOST_BINDING_FORMAT,
        session_id: parsed.session_id,
        host_kind: parsed.host_kind,
        host_pid: parsed.host_pid,
        host_started_at: parsed.host_started_at,
        mcp_pid: parsed.mcp_pid,
        credential_file_path: parsed.credential_file_path,
        written_at: parsed.written_at,
      });
    } catch {
      // Unreadable or malformed: skipped, never fatal.
    }
  }
  return bindings;
}

export interface HostBindingRecorder {
  /** Write this process's binding for a bound session. Never throws; false when none was written. */
  record(sessionId: string, credentialFilePath: string): boolean;
  /** Remove a session's binding. Never throws. */
  forget(sessionId: string): void;
}

export interface HostBindingRecorderOptions extends ProcessTreeOptions {
  /** This collab MCP process. Default: process.pid. */
  mcp_pid?: number;
  now?: () => Date;
}

/**
 * The bin's recorder: the host is this MCP process's direct parent
 * (nearestHost). A binding is either current or absent: when the host cannot
 * be read, any older binding for the session is removed rather than left
 * pointing at a previous host.
 */
export function hostBindingRecorder(
  dbPath: string,
  options: HostBindingRecorderOptions = {},
): HostBindingRecorder {
  const mcpPid = options.mcp_pid ?? process.pid;
  const now = options.now ?? (() => new Date());
  return {
    record(sessionId, credentialFilePath) {
      try {
        const host = nearestHost(mcpPid, options);
        if (!host) {
          removeHostBinding(dbPath, sessionId);
          return false;
        }
        writeHostBinding(dbPath, {
          format: HOST_BINDING_FORMAT,
          session_id: sessionId,
          host_kind: host.kind,
          host_pid: host.pid,
          host_started_at: host.started_at,
          mcp_pid: mcpPid,
          credential_file_path: resolve(credentialFilePath),
          written_at: now().toISOString(),
        });
        return true;
      } catch {
        removeHostBinding(dbPath, sessionId);
        return false;
      }
    },
    forget(sessionId) {
      removeHostBinding(dbPath, sessionId);
    },
  };
}

function isHostBinding(value: unknown): value is HostBinding {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.format === HOST_BINDING_FORMAT
    && typeof record.session_id === "string"
    && isSessionId(record.session_id)
    && typeof record.host_kind === "string"
    && (HOST_KINDS as readonly string[]).includes(record.host_kind)
    && isProcessId(record.host_pid)
    && typeof record.host_started_at === "string"
    && record.host_started_at.trim() !== ""
    && isProcessId(record.mcp_pid)
    && typeof record.credential_file_path === "string"
    && isAbsolute(record.credential_file_path)
    && typeof record.written_at === "string"
    && !Number.isNaN(Date.parse(record.written_at))
  );
}

function isSessionId(value: string): boolean {
  return value.length <= 200 && SESSION_ID.test(value);
}

/** pid 0 and launchd (1) never host or run a collab MCP. */
function isProcessId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 1;
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function isPrivateDirectory(path: string): boolean {
  const stat = lstatSync(path);
  return (
    stat.isDirectory()
    && !stat.isSymbolicLink()
    && isOwnedByCurrentUser(stat.uid)
    && (stat.mode & 0o077) === 0
  );
}

function isPrivateFile(path: string): boolean {
  const stat = lstatSync(path);
  return (
    stat.isFile()
    && !stat.isSymbolicLink()
    && isOwnedByCurrentUser(stat.uid)
    && (stat.mode & 0o077) === 0
  );
}

function isOwnedByCurrentUser(uid: number): boolean {
  return typeof process.getuid !== "function" || uid === process.getuid();
}
```

(c) In `packages/collab/src/mcp.ts`, add the type import after `import { CollabError } from "./errors.js";`:

```ts
import type { HostBindingRecorder } from "./host-binding.js";
```

Replace `interface CollabMcpServerOptions`:

```ts
export interface CollabMcpServerOptions {
  resumed_session?: {
    handle: SessionHandle;
    credential_file: string;
  };
}
```

with:

```ts
export interface CollabMcpServerOptions {
  resumed_session?: {
    handle: SessionHandle;
    credential_file: string;
  };
  /**
   * Records which host process runs each session this server binds, in
   * `dirname(db)/collab-sessions/<id>.host.json`. The bin supplies it; when
   * omitted (tests, in-memory stores) no binding file is written.
   */
  host_binding?: HostBindingRecorder;
}
```

In the `collab_session_start` handler, replace:

```ts
      const handle = store.startSession(input);
      const credentialFile = store.defaultSessionCredentialPath(handle.session.id);
      try {
        const path = writeSessionCredentialFile(credentialFile, handle.credential);
        binding = { handle, credential_file: path };
        return publicSessionBinding(binding);
      } catch (error) {
        try {
          store.endSession({ ...handle.credential, reason: "credential_file_write_failed" });
        } catch {
          // Preserve the original exact file-boundary error. The token was
          // never returned, persisted, or logged.
        }
        throw error;
      }
    }),
```

with:

```ts
      const handle = store.startSession(input);
      const credentialFile = store.defaultSessionCredentialPath(handle.session.id);
      let path: string;
      try {
        path = writeSessionCredentialFile(credentialFile, handle.credential);
      } catch (error) {
        try {
          store.endSession({ ...handle.credential, reason: "credential_file_write_failed" });
        } catch {
          // Preserve the original exact file-boundary error. The token was
          // never returned, persisted, or logged.
        }
        throw error;
      }
      binding = { handle, credential_file: path };
      // Best effort and never throws: a session whose host cannot be read is
      // still bound; it simply cannot be knocked or woken.
      options.host_binding?.record(handle.session.id, path);
      return publicSessionBinding(binding);
    }),
```

In the `collab_session_end` handler, replace:

```ts
      binding = null;
      removeSessionCredentialFile(current.credential_file);
```

with:

```ts
      binding = null;
      options.host_binding?.forget(ended.session.id);
      removeSessionCredentialFile(current.credential_file);
```

(d) Replace `packages/collab/bin/agenttool-collab-mcp.ts` with the version below. It takes the credential path only from `AGENTOOL_COLLAB_SESSION_FILE`, as before; no `--session-file` argv option is added (spec Part 2 item 4, amended 2026-10-09 after S3: a top-level Codex MCP definition carries its own `env`):

```ts
#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { resolveDatabasePath } from "../src/database-path.js";
import { hostBindingRecorder } from "../src/host-binding.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import {
  readSessionCredentialFile,
  writeSessionCredentialFile,
} from "../src/session-file.js";
import { CollabStore } from "../src/store.js";

async function main(): Promise<void> {
  const databasePath = resolveDatabasePath(process.env);
  const store = new CollabStore(databasePath);
  // An in-memory journal has no collab-sessions directory to bind into.
  const hostBinding = databasePath === ":memory:" ? undefined : hostBindingRecorder(databasePath);
  const sessionFile = process.env.AGENTOOL_COLLAB_SESSION_FILE;
  const resumed = sessionFile
    ? (() => {
        const credential = readSessionCredentialFile(sessionFile);
        const handle = store.resumeSession(credential, {
          allow_cursor_recovery:
            process.env.AGENTOOL_COLLAB_ALLOW_CURSOR_RECOVERY === "1",
        });
        const credentialFile = writeSessionCredentialFile(
          sessionFile,
          handle.credential,
          { replace: true },
        );
        hostBinding?.record(handle.session.id, credentialFile);
        return { handle, credential_file: credentialFile };
      })()
    : undefined;
  const server = buildCollabMcpServer(store, {
    resumed_session: resumed,
    host_binding: hostBinding,
  });
  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = async (exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await server.close();
    } finally {
      store.close();
      process.exit(exitCode);
    }
  };
  process.once("SIGINT", () => void shutdown(0));
  process.once("SIGTERM", () => void shutdown(0));
  // The pinned SDK transport only subscribes to stdin data/error, not EOF.
  // A closed host pipe must abort active waits and close SQLite immediately.
  process.stdin.once("end", () => void shutdown(0));
  process.stdin.once("close", () => void shutdown(0));
  process.stdin.once("error", () => void shutdown(1));

  await server.connect(transport);
  process.stderr.write(
    `· agenttool-collab MCP ready (local SQLite journal${resumed ? ", session resumed" : ""})\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`✖ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
```

(e) In `packages/collab/src/host.ts`, add this import after `import { CollabError } from "./errors.js";`:

```ts
import { removeHostBinding } from "./host-binding.js";
```

In `runCollabHostCli`, replace:

```ts
    const store = new CollabStore(databasePath);
    try {
      return emit(
        endSessionFromCredential(store, credential, {
          session_file: args.session_file,
          reason: args.reason,
          release_leases: args.release_leases,
        }),
        0,
      );
    } finally {
```

with:

```ts
    const store = new CollabStore(databasePath);
    try {
      const receipt = endSessionFromCredential(store, credential, {
        session_file: args.session_file,
        reason: args.reason,
        release_leases: args.release_leases,
      });
      // An ended session is never knocked or woken; its host binding goes with it.
      removeHostBinding(databasePath, receipt.session_id);
      return emit(receipt, 0);
    } finally {
```

The README is not edited here (contract deviation 12).

Do not rebuild `dist/` here. `check:mcp-bundle` skips on local Bun 1.3.13. Both bundles are now stale, and C4 Task 8 rebuilds them on Bun 1.3.5. The existing "checked-in host bundle" test still runs the old bundle's `end` and passes.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab && bun test tests/process-tree.test.ts tests/host-binding.test.ts && bun test && bun run typecheck
```

Expected:
- `0 fail, +8 tests in tests/process-tree.test.ts`
- `0 fail, +10 tests in tests/host-binding.test.ts`
- full suite `0 fail`, 18 more tests than before this task
- `tsc --noEmit` clean

The real-`ps` tests ("reads this test process from the real process table", "describes this test process's real parent", "the bin's resume path…") need `/bin/ps`. It exists on macOS and on the ubuntu-24.04 CI runner.

- [ ] **Step 5: Commit**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest
git add packages/collab/src/process-tree.ts packages/collab/src/host-binding.ts packages/collab/src/mcp.ts packages/collab/src/host.ts packages/collab/bin/agenttool-collab-mcp.ts packages/collab/tests/process-tree.test.ts packages/collab/tests/host-binding.test.ts
git commit -F - <<'MSG'
feat(collab): record which host runs each bound session

The MCP process writes dirname(db)/collab-sessions/<id>.host.json (0600,
non-secret) when collab_session_start binds a session and when the bin
resumes one from AGENTOOL_COLLAB_SESSION_FILE. The host is the MCP's
direct parent read from ps (S2): claude-code only with basename claude and
CLAUDE_CODE_SESSION_ID, codex, codex-app-server, else unknown, with the ps
start time guarding against pid reuse. collab_session_end and
agenttool-collab-host end remove it. A host that cannot be read writes no
binding and never fails a start. dist/ is rebuilt on Bun 1.3.5 in C4
Task 8.

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>
MSG
```

---

### Task 6: Read-only host verbs `knocks` and `doorbell-scan`

**Files:**
- Create: `packages/collab/tests/host-knocks.test.ts`
- Modify:
  - `packages/collab/src/host.ts`: whole file. It contains Task 5's edit; `end` is unchanged apart from the dispatch.
  - `packages/collab/bin/agenttool-collab-host.ts`: whole file, for the output path change.
  - `packages/collab/tests/host.test.ts`: one line in `test("refuses a reason endSession would refuse before any store call, with or without --release-leases"`, because `line` is now `string | null`.
  - `packages/collab/src/store.ts`: add `export` to C1's `interface RestDeclarationRow {` and `function restFromDeclaration(`, both immediately before `function sessionLiveness(`.

**Interfaces:**
- **Consumes:**
  - Task 5: `readHostBindings`, `removeHostBinding`, `collabSessionsDirectory`, `HostBinding`, `readProcessTable`, `ancestry`, `hostKindOf`, `isHostProcess`, `isCollabMcpProcess` and `ProcessTable`.
  - Tasks 1–4: `SessionRest` and `SessionLiveness` with `resting` and `ended`. C1's `RestDeclarationRow` / `restFromDeclaration`, which this task exports. C2's `AddressedEventRow` / `isAddressedTo`.
  - Tests: `store.restSessionForSession`, `CoordinationSession.rest` and `liveness`, and bound `collab_next` `session.addressed_waiting`.
- **Produces:**
  - Usage:
    - `agenttool-collab-host knocks --host-ancestor auto|<pid> [--mark-tapped] [--db <path>]`
    - `agenttool-collab-host doorbell-scan [--db <path>]`
  - Each verb has its own strict option set. `end --host-ancestor …`, `end --mark-tapped` and `end --unknown` are still refused with a JSON `usage_error` and exit 1.
  - `knocks` stdout is one line, `{"protocol":"agenttool.collab-knock/1","session_id","liveness","rest","waiting","new":[{"seq","kind","from_actor","ref_id"}]}`, or nothing. Exit is always 0.
  - `doorbell-scan` stdout is one line, `{"protocol":"agenttool.collab-doorbell-scan/1","sessions":[{"session_id","workspace_id","worktree_root","actor","rest","waiting","new","binding"}]}` (`binding` is a `HostBinding` or `null`), or nothing on error. Exit is always 0.
  - Ledger: `dirname(db)/collab-sessions/knock-ledger.json` (0600) is `{"format":"agenttool.collab-knock-ledger/1","tapped":{"<session_id>":[seq,…]}}`. It is written only by `knocks --mark-tapped`, under `knock-ledger.json.lock`, and never for a session at held rest (resting without `wake_on: ["addressed"]`).
  - `src/host.ts` exports:
    - `COLLAB_KNOCK_PROTOCOL`, `COLLAB_DOORBELL_SCAN_PROTOCOL` and `KNOCK_LEDGER_FORMAT`
    - `COLLAB_KNOCKS_USAGE` and `COLLAB_DOORBELL_SCAN_USAGE`
    - `KnockItem`, `KnockReport`, `DoorbellScanSession`, `DoorbellScan` and `HostCliDependencies`
    - `openReadOnly(dbPath)`, `knockForHost(dbPath, startPid, options)`, `doorbellScan(dbPath, options)` and `knockLedgerPath(dbPath)`
    - `runCollabHostCli(argv, env?, dependencies?): {exit_code: 0 | 1; line: string | null}`
  - The bin writes `line` plus a newline only when `line !== null`.
  - `src/store.ts` now also exports `RestDeclarationRow` and `restFromDeclaration`, public through `src/index.ts`'s `export *`.

- [ ] **Step 1: Write the failing test**

Create `packages/collab/tests/host-knocks.test.ts`. The fixtures:
- Journals are built through the store's public API, in the manner of `S1/make-journal.ts`, but with `restSessionForSession` in place of the private `appendEvent`.
- A fake process tree is passed through the `process_table` seam: launchd → Claude seat 4100 → collab MCP 4101, hook shell 4150 and tool shell 4200 → nested Codex 4300 → its hook 4301.
- One cleanly closed journal is built in a child process.
- One test spawns the real bin through real `ps`. The test process plays the host, and a real collab MCP (`bin/agenttool-collab-mcp.ts`, waited for until its ready line) runs as its child.
- Every journal, binding and ledger lives under a fresh `mkdtemp` directory. No test passes an environment without `--db` or `AGENTOOL_COLLAB_DB` to a code path that would open a journal, so the household journal is never touched.

```ts
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { knockLedgerPath, runCollabHostCli, type HostCliDependencies } from "../src/host.js";
import { HOST_BINDING_FORMAT, writeHostBinding, type HostBinding } from "../src/host-binding.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import { readProcessTable, type ProcessRecord, type ProcessTable } from "../src/process-tree.js";
import type { SessionHandle } from "../src/protocol.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { CollabStore } from "../src/store.js";

const packageRoot = resolve(import.meta.dir, "..");
const hostEntry = join(packageRoot, "bin", "agenttool-collab-host.ts");
const mcpEntry = join(packageRoot, "bin", "agenttool-collab-mcp.ts");
const SEAT_STARTED = "Fri Oct 9 09:00:00 2026";

let directory: string;
let root: string;
let databasePath: string;
let clock: Date;
let store: CollabStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-knocks-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  clock = new Date("2026-10-09T12:00:00.000Z");
  store = new CollabStore(databasePath, { now: () => clock });
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function proc(pid: number, ppid: number, comm: string, args = comm, started_at = SEAT_STARTED): ProcessRecord {
  return { pid, ppid, comm, args, started_at };
}

/** launchd → claude seat 4100 → (collab MCPs 4101/4102, hook shell 4150, tool shell 4200 → codex 4300 → hook 4301). */
function seat(...extra: ProcessRecord[]): ProcessTable {
  return new Map([
    proc(1, 0, "/sbin/launchd"),
    proc(4100, 1, "/Users/someone/.local/bin/claude", "claude"),
    proc(4101, 4100, "bun", "bun /opt/homebrew/bin/agenttool-collab-mcp"),
    proc(4150, 4100, "/bin/zsh", "/bin/zsh -c knock-tap"),
    proc(4200, 4100, "/bin/zsh"),
    proc(4300, 4200, "codex", "codex"),
    proc(4301, 4300, "/bin/zsh", "/bin/zsh -c knock-tap"),
    ...extra,
  ].map((entry) => [entry.pid, entry]));
}

function bindingFor(handle: SessionHandle, overrides: Partial<HostBinding> = {}): HostBinding {
  return {
    format: HOST_BINDING_FORMAT,
    session_id: handle.session.id,
    host_kind: "claude-code",
    host_pid: 4100,
    host_started_at: SEAT_STARTED,
    mcp_pid: 4101,
    credential_file_path: store.defaultSessionCredentialPath(handle.session.id),
    written_at: clock.toISOString(),
    ...overrides,
  };
}

function bind(handle: SessionHandle, overrides: Partial<HostBinding> = {}): HostBinding {
  const binding = bindingFor(handle, overrides);
  writeHostBinding(databasePath, binding);
  return binding;
}

function run(args: string[], dependencies: HostCliDependencies = {}) {
  const result = runCollabHostCli([...args, "--db", databasePath], {}, {
    process_table: () => seat(),
    now: () => clock,
    ...dependencies,
  });
  expect(result.exit_code).toBe(0);
  return result.line === null ? null : JSON.parse(result.line) as Record<string, any>;
}

const knocks = (args: string[], dependencies: HostCliDependencies = {}) => run(["knocks", ...args], dependencies);

function report(from: SessionHandle, to: SessionHandle | null, key: string) {
  return store.appendReportForSession({
    ...from.credential,
    idempotency_key: key,
    ...(to ? { to_session_id: to.session.id } : {}),
    kind: "observation",
    body: "A note for the knock tests.",
  });
}

function offerHandoff(from: SessionHandle, to: SessionHandle, key: string) {
  const task = store.createTaskForSession({
    ...from.credential,
    idempotency_key: `${key}-create`,
    title: key,
    work_mode: "coordination",
  });
  const claimed = store.claimTaskForSession({
    ...from.credential,
    idempotency_key: `${key}-claim`,
    task_id: task.id,
    expected_version: task.version,
  });
  const offered = store.offerHandoffForSession({
    ...from.credential,
    idempotency_key: `${key}-offer`,
    task_id: task.id,
    lease_id: claimed.lease_id!,
    expected_version: claimed.version,
    to_session_id: to.session.id,
    summary: "Please take this over.",
  });
  const event = store.eventsSince(from.workspace.id, 0, 500).events
    .find((entry) => entry.type === "handoff.offered" && entry.entity_id === offered.handoff.id)!;
  return { handoff: offered.handoff, sequence: event.sequence };
}

function acknowledgeAll(handle: SessionHandle): SessionHandle["credential"] {
  const session = store.getCoordinationSession(handle.session.id)!;
  const head = store.getWorkspace(handle.workspace.id)!;
  store.acknowledgeSessionCursor({
    ...handle.credential,
    anchor: { epoch_id: head.epoch_id, sequence: head.event_head_sequence, hash: head.event_head_hash },
    expected_cursor_version: session.cursor_version,
  });
  return handle.credential;
}

function readLedger() {
  return JSON.parse(readFileSync(knockLedgerPath(databasePath), "utf8"));
}

describe("agenttool-collab-host knocks", () => {
  test("prints one pointer per addressed item and marks each tapped exactly once", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    bind(beta);
    const first = report(alpha, beta, "knock-first");
    report(alpha, null, "knock-broadcast");
    report(beta, alpha, "knock-reply");
    const handoff = offerHandoff(alpha, beta, "knock-handoff");
    const expectedNew = [
      { seq: first.event_sequence, kind: "report.posted", from_actor: "alpha", ref_id: first.id },
      { seq: handoff.sequence, kind: "handoff.offered", from_actor: "alpha", ref_id: handoff.handoff.id },
    ];

    const peek = knocks(["--host-ancestor", "4150"]);
    expect(peek).toEqual({
      protocol: "agenttool.collab-knock/1",
      session_id: beta.session.id,
      liveness: "live",
      rest: null,
      waiting: 2,
      new: expectedNew,
    });
    expect(knocks(["--host-ancestor", "4150"])).toEqual(peek);
    expect(existsSync(knockLedgerPath(databasePath))).toBe(false);

    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"])?.new).toEqual(expectedNew);
    expect(readLedger()).toEqual({
      format: "agenttool.collab-knock-ledger/1",
      tapped: { [beta.session.id]: [first.event_sequence, handoff.sequence] },
    });
    expect(statSync(knockLedgerPath(databasePath)).mode & 0o777).toBe(0o600);
    expect(existsSync(`${knockLedgerPath(databasePath)}.lock`)).toBe(false);

    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"])).toMatchObject({ waiting: 2, new: [] });

    const second = report(alpha, beta, "knock-second");
    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"])).toMatchObject({
      waiting: 3,
      new: [{ seq: second.event_sequence, kind: "report.posted", from_actor: "alpha", ref_id: second.id }],
    });

    acknowledgeAll(beta);
    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"])).toMatchObject({ waiting: 0, new: [] });
  });

  test("agrees with the store's liveness and rest and with collab_next's addressed_waiting", async () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    report(alpha, beta, "parity-first");
    offerHandoff(alpha, beta, "parity-handoff");
    const resumed = store.resumeSession(beta.credential);
    const file = writeSessionCredentialFile(store.defaultSessionCredentialPath(beta.session.id), resumed.credential);
    bind(beta);
    const server = buildCollabMcpServer(store, { resumed_session: { handle: resumed, credential_file: file } });
    const tool = (server as any)._registeredTools.collab_next;
    const parity = async (liveness: string) => {
      const knock = knocks(["--host-ancestor", "4100"])!;
      const projected = store.getCoordinationSession(beta.session.id)!;
      expect(knock.liveness).toBe(liveness);
      expect(projected.liveness).toBe(liveness as never);
      expect(knock.rest).toEqual(projected.rest);
      const next = await (tool.handler ?? tool.callback)({ workspace_id: beta.workspace.id }, {});
      expect(next.isError).toBeUndefined();
      expect(next.structuredContent.session.addressed_waiting).toBe(knock.waiting);
      return knock;
    };

    expect((await parity("live")).waiting).toBe(2);

    store.restSessionForSession({
      ...resumed.credential,
      idempotency_key: "parity-rest",
      mode: "resting",
      until: new Date(clock.getTime() + 2 * 3_600_000).toISOString(),
      reason: "back this evening",
      wake_on: ["addressed"],
    });
    expect((await parity("resting")).rest).toEqual({
      mode: "resting",
      since: clock.toISOString(),
      until: "2026-10-09T14:00:00.000Z",
      reason: "back this evening",
      wake_on: ["addressed"],
    });

    clock = new Date(clock.getTime() + 3 * 3_600_000);
    expect((await parity("live")).rest).toBeNull();

    clock = new Date(clock.getTime() + 7 * 3_600_000);
    await parity("stale");

    store.restSessionForSession({
      ...resumed.credential,
      idempotency_key: "parity-rest-again",
      mode: "resting",
      wake_on: [],
    });
    expect((await parity("resting")).rest).toMatchObject({ until: null, reason: null, wake_on: [] });
    store.restSessionForSession({ ...resumed.credential, idempotency_key: "parity-return", mode: "ready" });
    await parity("live");

    acknowledgeAll({ ...beta, credential: resumed.credential });
    expect((await parity("live")).waiting).toBe(0);
  });

  test("never marks a held rest's items, so they tap once the session returns", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    bind(beta);
    const first = report(alpha, beta, "held-first");
    store.restSessionForSession({ ...beta.credential, idempotency_key: "held-rest", mode: "resting", wake_on: [] });
    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"])).toMatchObject({
      liveness: "resting",
      rest: { wake_on: [] },
      waiting: 1,
      new: [{ seq: first.event_sequence }],
    });
    expect(existsSync(knockLedgerPath(databasePath))).toBe(false);

    store.restSessionForSession({ ...beta.credential, idempotency_key: "held-return", mode: "ready" });
    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"])).toMatchObject({
      liveness: "live",
      new: [{ seq: first.event_sequence }],
    });
    expect(readLedger().tapped).toEqual({ [beta.session.id]: [first.event_sequence] });

    // A rest that consents to a wake is tapped and marked like a live session.
    const second = report(alpha, beta, "held-second");
    store.restSessionForSession({
      ...beta.credential,
      idempotency_key: "wake-rest",
      mode: "resting",
      wake_on: ["addressed"],
    });
    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"])).toMatchObject({
      liveness: "resting",
      waiting: 2,
      new: [{ seq: second.event_sequence }],
    });
    expect(readLedger().tapped).toEqual({ [beta.session.id]: [first.event_sequence, second.event_sequence] });
  });

  test("walks to the nearest bound host, and an unbound nearer host stops the walk", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    bind(beta);
    report(alpha, beta, "walk-note");

    for (const start of ["4100", "4150", "4200"]) {
      expect(knocks(["--host-ancestor", start])?.session_id).toBe(beta.session.id);
    }
    expect(knocks(["--host-ancestor", "auto"], { parent_pid: 4150 })?.session_id).toBe(beta.session.id);
    // A Codex started from the seat's tool shell is the nearest host for its own hooks.
    expect(knocks(["--host-ancestor", "4301"])).toBeNull();
    expect(knocks(["--host-ancestor", "4300"])).toBeNull();
    expect(knocks(["--host-ancestor", "auto"], { parent_pid: 4301 })).toBeNull();
    expect(knocks(["--host-ancestor", "999999"])).toBeNull();
  });

  test("never matches a reused pid, an orphaned binding, an ambiguous host, or an ended session", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    const gamma = store.startSession({ root_path: root, actor: "gamma" });
    report(alpha, beta, "ambiguity-beta");
    report(alpha, gamma, "ambiguity-gamma");

    bind(beta, { host_started_at: "Thu Oct 8 23:59:59 2026" });
    expect(knocks(["--host-ancestor", "4150"])).toBeNull();

    bind(beta);
    // gamma's MCP (4102) is gone: its binding is orphaned and does not count.
    bind(gamma, { mcp_pid: 4102 });
    expect(knocks(["--host-ancestor", "4150"])?.session_id).toBe(beta.session.id);
    // Nor when its pid was reused by another child of the seat that is not a collab MCP.
    bind(gamma, { mcp_pid: 4150 });
    expect(knocks(["--host-ancestor", "4150"])?.session_id).toBe(beta.session.id);
    bind(gamma, { mcp_pid: 4102 });

    const withGamma = { process_table: () => seat(proc(4102, 4100, "bun", "bun /opt/homebrew/bin/agenttool-collab-mcp")) };
    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"], withGamma)).toBeNull();
    expect(existsSync(knockLedgerPath(databasePath))).toBe(false);

    store.endSession({ ...gamma.credential, reason: "gamma is done" });
    expect(knocks(["--host-ancestor", "4150"], withGamma)?.session_id).toBe(beta.session.id);
    store.endSession({ ...beta.credential, reason: "beta is done" });
    expect(knocks(["--host-ancestor", "4150"], withGamma)).toBeNull();
  });

  test("a Desktop app-server knocks only while it runs a single collab MCP", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    bind(beta, { host_kind: "codex-app-server", host_pid: 4400, mcp_pid: 4401 });
    report(alpha, beta, "app-server-note");
    const appServer = (...threads: ProcessRecord[]) => ({
      process_table: () => seat(
        proc(4399, 1, "/x/releases/0.162.0/bin/codex", "/x/releases/0.162.0/bin/codex app-server daemon pid-update-loop"),
        proc(4400, 4399, "/x/releases/0.162.0/bin/codex", "/x/releases/0.162.0/bin/codex app-server --listen unix:// --managed-daemon"),
        proc(4401, 4400, "bun", "bun dist/agenttool-collab-mcp.js"),
        proc(4450, 4400, "/bin/zsh", "/bin/zsh -c knock-tap"),
        ...threads,
      ),
    });
    expect(knocks(["--host-ancestor", "4450"], appServer())?.session_id).toBe(beta.session.id);
    // A second thread's collab MCP, even unbound, makes every hook under this app-server ambiguous.
    expect(knocks(["--host-ancestor", "4450"], appServer(proc(4402, 4400, "bun", "bun dist/agenttool-collab-mcp.js"))))
      .toBeNull();
  });

  test("is silent on every failure and on any argument outside its own option set", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    report(alpha, beta, "silent-note");

    // Nothing bound: no ps call at all.
    expect(knocks(["--host-ancestor", "4150"], {
      process_table: () => {
        throw new Error("ps must not run without a binding");
      },
    })).toBeNull();

    bind(beta);
    expect(knocks(["--host-ancestor", "4150"], { process_table: () => null })).toBeNull();

    for (const args of [
      ["knocks"],
      ["knocks", "--host-ancestor", "0"],
      ["knocks", "--host-ancestor", "4150x"],
      ["knocks", "--host-ancestor", "auto", "extra"],
      ["knocks", "--host-ancestor", "auto", "--session-file", "x"],
      ["knocks", "--host-ancestor", "auto", "--db", ""],
      ["doorbell-scan", "--host-ancestor", "auto"],
      ["doorbell-scan", "--mark-tapped"],
      ["doorbell-scan", "extra"],
    ]) {
      expect(runCollabHostCli(args, { AGENTOOL_COLLAB_DB: databasePath }, { process_table: () => seat() }))
        .toEqual({ exit_code: 0, line: null });
    }

    const missing = join(directory, "elsewhere", "collab.sqlite");
    for (const verb of [["knocks", "--host-ancestor", "4150"], ["doorbell-scan"]]) {
      expect(runCollabHostCli([...verb, "--db", missing], {}, { process_table: () => seat() }))
        .toEqual({ exit_code: 0, line: null });
    }
    expect(existsSync(dirname(missing))).toBe(false);

    const foreign = join(directory, "foreign", "other.sqlite");
    mkdirSync(dirname(foreign), { mode: 0o700 });
    new Database(foreign).close();
    writeHostBinding(foreign, bindingFor(beta));
    expect(runCollabHostCli(["knocks", "--host-ancestor", "4150", "--db", foreign], {}, {
      process_table: () => seat(),
    })).toEqual({ exit_code: 0, line: null });

    // A symlinked journal is refused, as the store refuses it.
    const linked = join(dirname(databasePath), "linked.sqlite");
    symlinkSync(databasePath, linked);
    for (const verb of [["knocks", "--host-ancestor", "4150"], ["doorbell-scan"]]) {
      expect(runCollabHostCli([...verb, "--db", linked], {}, { process_table: () => seat() }))
        .toEqual({ exit_code: 0, line: null });
    }

    // end keeps its own option set and its JSON refusals.
    for (const extra of [["--host-ancestor", "auto"], ["--mark-tapped"]]) {
      const refused = runCollabHostCli(
        ["end", "--session-file", "x.json", "--reason", "x", ...extra, "--db", databasePath],
        {},
      );
      expect(refused.exit_code).toBe(1);
      expect(JSON.parse(refused.line!)).toMatchObject({ status: "error", error: "usage_error" });
    }
  });

  test("refuses a damaged or busy ledger rather than risk a repeated tap", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    bind(beta);
    report(alpha, beta, "ledger-note");
    const ledger = knockLedgerPath(databasePath);

    writeFileSync(ledger, "{damaged", { mode: 0o600 });
    expect(knocks(["--host-ancestor", "4150"])).toBeNull();
    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"])).toBeNull();
    expect(run(["doorbell-scan"])).toBeNull();

    writeFileSync(ledger, JSON.stringify({ format: "agenttool.collab-knock-ledger/1", tapped: {} }));
    chmodSync(ledger, 0o644);
    expect(knocks(["--host-ancestor", "4150"])).toBeNull();
    chmodSync(ledger, 0o600);

    const lock = `${ledger}.lock`;
    writeFileSync(lock, "", { mode: 0o600 });
    expect(knocks(["--host-ancestor", "4150"])?.new).toHaveLength(1);
    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"])).toBeNull();
    expect(readLedger().tapped).toEqual({});

    // A lock left by a crashed run expires.
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    expect(knocks(["--host-ancestor", "4150", "--mark-tapped"])?.new).toHaveLength(1);
    expect(existsSync(lock)).toBe(false);
    expect(readLedger().tapped[beta.session.id]).toHaveLength(1);
  });

  test("reads one committed snapshot without waiting on or writing to the journal", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    bind(beta);
    report(alpha, beta, "snapshot-committed");
    const sessionsBefore = store.db.query("SELECT * FROM coordination_sessions ORDER BY id").all();
    const headBefore = store.getWorkspace(beta.workspace.id)!.event_head_sequence;

    store.db.exec("BEGIN IMMEDIATE");
    try {
      report(alpha, beta, "snapshot-uncommitted");
      const started = performance.now();
      expect(knocks(["--host-ancestor", "4150"])).toMatchObject({ waiting: 1 });
      expect(run(["doorbell-scan"])).toEqual({ protocol: "agenttool.collab-doorbell-scan/1", sessions: [] });
      expect(performance.now() - started).toBeLessThan(1_000);
    } finally {
      store.db.exec("ROLLBACK");
    }
    expect(store.db.query("SELECT * FROM coordination_sessions ORDER BY id").all()).toEqual(sessionsBefore);
    expect(store.getWorkspace(beta.workspace.id)!.event_head_sequence).toBe(headBefore);
  });
});

describe("a journal whose last connection closed cleanly", () => {
  test("is read without a -wal file and left unchanged", () => {
    // Built in a child process that exits, as a Python or sqlite3 client
    // would leave it: fully checkpointed, then no -wal or -shm on disk.
    const closed = join(directory, "closed");
    const journal = join(closed, "state", "collab.sqlite");
    mkdirSync(join(closed, "repo"), { recursive: true });
    const script = join(closed, "fixture.ts");
    writeFileSync(script, `
      import { Database } from "bun:sqlite";
      import { CollabStore } from ${JSON.stringify(join(packageRoot, "src", "store.ts"))};
      import { writeHostBinding } from ${JSON.stringify(join(packageRoot, "src", "host-binding.ts"))};
      const journal = ${JSON.stringify(journal)};
      const store = new CollabStore(journal);
      const alpha = store.startSession({ root_path: ${JSON.stringify(join(closed, "repo"))}, actor: "alpha" });
      const beta = store.startSession({ root_path: ${JSON.stringify(join(closed, "repo"))}, actor: "beta" });
      store.appendReportForSession({
        ...alpha.credential,
        idempotency_key: "closed-note",
        to_session_id: beta.session.id,
        kind: "observation",
        body: "A note in a closed journal.",
      });
      writeHostBinding(journal, {
        format: "agenttool.collab-host-binding/1",
        session_id: beta.session.id,
        host_kind: "claude-code",
        host_pid: 4100,
        host_started_at: ${JSON.stringify(SEAT_STARTED)},
        mcp_pid: 4101,
        credential_file_path: store.defaultSessionCredentialPath(beta.session.id),
        written_at: new Date().toISOString(),
      });
      store.close();
      const checkpoint = new Database(journal);
      checkpoint.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      checkpoint.close();
      process.stdout.write(JSON.stringify({ session_id: beta.session.id, workspace_id: beta.workspace.id }));
    `);
    const built = Bun.spawnSync([process.execPath, script], { cwd: packageRoot, stdout: "pipe", stderr: "pipe" });
    expect(built.exitCode).toBe(0);
    const fixture = JSON.parse(built.stdout.toString()) as { session_id: string; workspace_id: string };
    const dropSidecars = () => {
      rmSync(`${journal}-wal`, { force: true });
      rmSync(`${journal}-shm`, { force: true });
    };
    dropSidecars();
    // macOS's system SQLite (3.43.2, which bun:sqlite uses there) cannot open it
    // read-only: a readonly connection may not create the -wal (SQLITE_CANTOPEN).
    // Newer SQLite builds (Homebrew's 3.53.4, for one) create the sidecars and read
    // it, so the probe is asserted only on darwin; the outcome below on every platform.
    const probe = new Database(journal, { readonly: true });
    let plainReadonlyOpens = true;
    try {
      probe.query("PRAGMA application_id").get();
    } catch (error) {
      expect((error as { code?: string }).code).toBe("SQLITE_CANTOPEN");
      plainReadonlyOpens = false;
    } finally {
      probe.close();
    }
    if (process.platform === "darwin") expect(plainReadonlyOpens).toBe(false);
    dropSidecars();
    const before = Bun.hash(readFileSync(journal));

    const closedRun = (args: string[]) => {
      const result = runCollabHostCli([...args, "--db", journal], {}, {
        process_table: () => seat(),
        now: () => new Date(),
      });
      expect(result.exit_code).toBe(0);
      return result.line === null ? null : JSON.parse(result.line);
    };
    expect(closedRun(["knocks", "--host-ancestor", "4150"])).toMatchObject({
      session_id: fixture.session_id,
      waiting: 1,
    });
    expect(closedRun(["doorbell-scan"])).toEqual({ protocol: "agenttool.collab-doorbell-scan/1", sessions: [] });
    expect(Bun.hash(readFileSync(journal))).toBe(before);
    for (const sidecar of ["-wal", "-shm"]) {
      if (existsSync(`${journal}${sidecar}`)) expect(statSync(`${journal}${sidecar}`).mode & 0o777).toBe(0o600);
    }
    const reopened = new CollabStore(journal);
    try {
      expect(reopened.verifyJournal(fixture.workspace_id)).toBe(true);
    } finally {
      reopened.close();
    }
  });
});

describe("agenttool-collab-host doorbell-scan", () => {
  test("lists only resting wake_on-addressed sessions with unknocked items, with their binding", () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const start = (actor: string) => store.startSession({ root_path: root, actor });
    const rest = (handle: SessionHandle, key: string, wakeOn: "addressed"[], until?: string) =>
      store.restSessionForSession({
        ...handle.credential,
        idempotency_key: key,
        mode: "resting",
        reason: `${handle.session.actor} is resting`,
        wake_on: wakeOn,
        ...(until ? { until } : {}),
      });
    const wakeable = start("wakeable");
    const unbound = start("unbound");
    const heldOnly = start("held-only");
    const live = start("live");
    const nothingWaiting = start("nothing-waiting");
    const alreadyTapped = start("already-tapped");
    const ended = start("ended");
    const expiring = start("expiring");
    for (const handle of [wakeable, unbound, heldOnly, live, alreadyTapped, ended, expiring]) {
      report(alpha, handle, `scan-note-${handle.session.actor}`);
    }
    const wakeableBinding = bind(wakeable, { host_kind: "codex", host_pid: 5100, mcp_pid: 5101 });
    rest(wakeable, "rest-wakeable", ["addressed"], "2026-10-10T08:00:00.000Z");
    rest(unbound, "rest-unbound", ["addressed"]);
    rest(heldOnly, "rest-held", []);
    rest(nothingWaiting, "rest-nothing", ["addressed"]);
    rest(alreadyTapped, "rest-tapped", ["addressed"]);
    rest(ended, "rest-ended", ["addressed"]);
    store.endSession({ ...ended.credential, reason: "departed while resting" });
    rest(expiring, "rest-expiring", ["addressed"], "2026-10-09T12:30:00.000Z");
    const tappedNote = store.eventsSince(alpha.workspace.id, 0, 500).events.find(
      (event) => event.type === "report.posted" && event.payload.to_session_id === alreadyTapped.session.id,
    )!;
    mkdirSync(dirname(knockLedgerPath(databasePath)), { recursive: true, mode: 0o700 });
    writeFileSync(knockLedgerPath(databasePath), JSON.stringify({
      format: "agenttool.collab-knock-ledger/1",
      tapped: { [alreadyTapped.session.id]: [tappedNote.sequence] },
    }), { mode: 0o600 });
    clock = new Date("2026-10-09T13:00:00.000Z");

    const scan = run(["doorbell-scan"])!;
    expect(scan.protocol).toBe("agenttool.collab-doorbell-scan/1");
    // Every session here joined at the same clock instant, so order by actor to compare.
    const listed = new Map<string, any>(scan.sessions.map((entry: any) => [entry.actor, entry]));
    expect([...listed.keys()].sort()).toEqual(["unbound", "wakeable"]);
    const note = store.eventsSince(alpha.workspace.id, 0, 500).events.find(
      (event) => event.type === "report.posted" && event.payload.to_session_id === wakeable.session.id,
    )!;
    expect(listed.get("wakeable")).toEqual({
      session_id: wakeable.session.id,
      workspace_id: wakeable.workspace.id,
      worktree_root: wakeable.worktree.root_path,
      actor: "wakeable",
      rest: {
        mode: "resting",
        since: "2026-10-09T12:00:00.000Z",
        until: "2026-10-10T08:00:00.000Z",
        reason: "wakeable is resting",
        wake_on: ["addressed"],
      },
      waiting: 1,
      new: [{ seq: note.sequence, kind: "report.posted", from_actor: "alpha", ref_id: note.entity_id }],
      binding: wakeableBinding,
    });
    expect(listed.get("unbound")).toMatchObject({ session_id: unbound.session.id, binding: null, waiting: 1 });
  });

  test("prints an empty list when nothing is waiting", () => {
    store.startSession({ root_path: root, actor: "alone" });
    expect(run(["doorbell-scan"])).toEqual({ protocol: "agenttool.collab-doorbell-scan/1", sessions: [] });
  });
});

describe("the host bin's output path", () => {
  function runBin(args: string[]) {
    const result = Bun.spawnSync([process.execPath, hostEntry, ...args], {
      cwd: packageRoot,
      env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir(), HOME: join(directory, "home") },
      stdout: "pipe",
      stderr: "pipe",
    });
    return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  }

  test("prints nothing for silence, one line for a scan, and one knock found through the real ps", async () => {
    const alpha = store.startSession({ root_path: root, actor: "alpha" });
    const beta = store.startSession({ root_path: root, actor: "beta" });
    report(alpha, beta, "bin-note");

    expect(runBin(["knocks", "--host-ancestor", "auto", "--db", databasePath]))
      .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(runBin(["knocks", "--bogus"])).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const scan = runBin(["doorbell-scan", "--db", databasePath]);
    expect(scan.exitCode).toBe(0);
    expect(scan.stdout).toBe('{"protocol":"agenttool.collab-doorbell-scan/1","sessions":[]}\n');

    // This test process plays the host: a real collab MCP runs as its direct child,
    // and the spawned bin's own parent (this process) is where `auto` starts.
    const mcp = Bun.spawn([process.execPath, mcpEntry], {
      cwd: packageRoot,
      env: { AGENTOOL_COLLAB_DB: databasePath, PATH: process.env.PATH ?? "", TMPDIR: tmpdir() },
      stdin: "pipe",
      stdout: "ignore",
      stderr: "pipe",
    });
    try {
      // Its ready line means ps already shows the MCP's own argv.
      const reader = mcp.stderr.getReader();
      const decoder = new TextDecoder();
      let banner = "";
      while (!banner.includes("agenttool-collab MCP ready")) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`the collab MCP exited early: ${banner}`);
        banner += decoder.decode(chunk.value, { stream: true });
      }
      bind(beta, {
        host_kind: "unknown",
        host_pid: process.pid,
        host_started_at: readProcessTable()!.get(process.pid)!.started_at,
        mcp_pid: mcp.pid,
      });
      const knock = runBin(["knocks", "--host-ancestor", "auto", "--db", databasePath]);
      expect(knock.exitCode).toBe(0);
      const lines = knock.stdout.split("\n").filter((line) => line.length > 0);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({
        protocol: "agenttool.collab-knock/1",
        session_id: beta.session.id,
        waiting: 1,
      });
    } finally {
      mcp.kill();
      await mcp.exited;
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab && bun test tests/host-knocks.test.ts
```

Expected: 0 pass. The file stops at load with `SyntaxError: Export named 'knockLedgerPath' not found in module '…/src/host.ts'`.

- [ ] **Step 3: Implement**

(a) In `packages/collab/src/store.ts`, export C1's read-side rest parser so `src/host.ts` judges rest exactly as the store does. Replace

```ts
interface RestDeclarationRow {
```

with

```ts
export interface RestDeclarationRow {
```

and replace

```ts
function restFromDeclaration(row: RestDeclarationRow, observedAt: string): SessionRest | null {
```

with

```ts
export function restFromDeclaration(row: RestDeclarationRow, observedAt: string): SessionRest | null {
```

Each line occurs once, in the block Task 1 inserted before `function sessionLiveness(`.

(b) Replace `packages/collab/src/host.ts` with the version below. `end` keeps its exact behaviour, including Task 5's binding removal, now under `runEnd`. `knocks` and `doorbell-scan` dispatch on the first argv token, read through `openReadOnly`, never construct a `CollabStore`, and turn every failure into `line: null` with exit 0:

```ts
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { resolveDatabasePath } from "./database-path.js";
import { CollabError } from "./errors.js";
import {
  collabSessionsDirectory,
  readHostBindings,
  removeHostBinding,
  type HostBinding,
} from "./host-binding.js";
import {
  ancestry,
  hostKindOf,
  isCollabMcpProcess,
  isHostProcess,
  readProcessTable,
  type ProcessRecord,
  type ProcessTable,
} from "./process-tree.js";
import {
  SESSION_STALE_AFTER_MS,
  type SessionCredential,
  type SessionEndRelease,
  type SessionHandle,
  type SessionLiveness,
  type SessionRest,
} from "./protocol.js";
import {
  readSessionCredentialFile,
  removeSessionCredentialFile,
} from "./session-file.js";
import {
  CollabStore,
  isAddressedTo,
  restFromDeclaration,
  type AddressedEventRow,
  type RestDeclarationRow,
} from "./store.js";

export const COLLAB_HOST_PROTOCOL = "agenttool.collab-host/1" as const;
export const COLLAB_KNOCK_PROTOCOL = "agenttool.collab-knock/1" as const;
export const COLLAB_DOORBELL_SCAN_PROTOCOL = "agenttool.collab-doorbell-scan/1" as const;
export const KNOCK_LEDGER_FORMAT = "agenttool.collab-knock-ledger/1" as const;

export const COLLAB_HOST_USAGE =
  "usage: agenttool-collab-host end --session-file <path> --reason <text> [--release-leases] [--db <path>]";
export const COLLAB_KNOCKS_USAGE =
  "usage: agenttool-collab-host knocks --host-ancestor auto|<pid> [--mark-tapped] [--db <path>]";
export const COLLAB_DOORBELL_SCAN_USAGE = "usage: agenttool-collab-host doorbell-scan [--db <path>]";

/** The trimmed-length limit endSession applies to its reason. */
const MAX_HOST_REASON = 2_000;
/** store.ts APPLICATION_ID ("ATCL"): a read-only verb never reads another application's SQLite file. */
const COLLAB_APPLICATION_ID = 0x4154434c;
/** A ledger lock older than this was left by a crashed run and may be broken. */
const LEDGER_LOCK_STALE_MS = 30_000;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export interface HostEndReceipt {
  protocol: typeof COLLAB_HOST_PROTOCOL;
  status: "ended" | "already_ended";
  session_id: string;
  released: SessionEndRelease[];
  ended_at: string | null;
  /** Present only when the session is ended but its revoked credential file is still on disk. */
  warning?: "session_file_remove_failed";
}

export interface HostErrorReceipt {
  [detail: string]: unknown;
  protocol: typeof COLLAB_HOST_PROTOCOL;
  status: "error";
  error: string;
  message: string;
}

export interface HostEndOptions {
  session_file: string;
  reason: string;
  release_leases: boolean;
}

/** One doorbell pointer: never a body. `kind` is the journal event type. */
export interface KnockItem {
  seq: number;
  kind: "report.posted" | "handoff.offered";
  from_actor: string;
  ref_id: string;
}

export interface KnockReport {
  protocol: typeof COLLAB_KNOCK_PROTOCOL;
  session_id: string;
  liveness: SessionLiveness;
  rest: SessionRest | null;
  waiting: number;
  new: KnockItem[];
}

export interface DoorbellScanSession {
  session_id: string;
  workspace_id: string;
  worktree_root: string;
  actor: string;
  rest: SessionRest;
  waiting: number;
  new: KnockItem[];
  binding: HostBinding | null;
}

export interface DoorbellScan {
  protocol: typeof COLLAB_DOORBELL_SCAN_PROTOCOL;
  sessions: DoorbellScanSession[];
}

/** Seams for the read-only verbs; production uses ps, process.ppid and the wall clock. */
export interface HostCliDependencies {
  process_table?: () => ProcessTable | null;
  /** The process `--host-ancestor auto` starts from. Default: process.ppid. */
  parent_pid?: number;
  now?: () => Date;
}

/**
 * Host-side end for a session whose MCP process is gone. Without
 * release_leases it first refuses, read-only, while a lease is live. It then
 * resumes with cursor recovery allowed (a stale generation or cursor in the
 * file is tolerated), ends through the store, and removes the credential
 * file. The returned receipt never contains the credential. The reason is
 * judged only by the end, after the resume, so callers pass one already
 * checked (parseHostArgs does this for the CLI).
 */
export function endSessionFromCredential(
  store: CollabStore,
  credential: SessionCredential,
  options: HostEndOptions,
): HostEndReceipt {
  let resumed: SessionHandle;
  try {
    if (!options.release_leases) store.preflightSessionEnd(credential);
    resumed = store.resumeSession(credential, { allow_cursor_recovery: true });
  } catch (error) {
    if (error instanceof CollabError && error.code === "session_auth_failed") {
      const known = store.getCoordinationSession(credential.session_id);
      if (known?.status === "ended") {
        return removeRevokedFile(options.session_file, {
          protocol: COLLAB_HOST_PROTOCOL,
          status: "already_ended",
          session_id: known.id,
          released: [],
          ended_at: known.ended_at,
        });
      }
    }
    throw error;
  }
  const ended = store.endSessionWithReleases({
    ...resumed.credential,
    reason: options.reason,
    release_leases: options.release_leases,
  });
  return removeRevokedFile(options.session_file, {
    protocol: COLLAB_HOST_PROTOCOL,
    status: "ended",
    session_id: ended.session.id,
    released: ended.released_leases.map(({ task_id, lease_id, via }) => ({
      task_id,
      lease_id,
      via,
    })),
    ended_at: ended.session.ended_at,
  });
}

/** The session is ended either way; a leftover revoked file is a warning, not a failure. */
function removeRevokedFile(sessionFile: string, receipt: HostEndReceipt): HostEndReceipt {
  try {
    removeSessionCredentialFile(sessionFile);
    return receipt;
  } catch {
    return { ...receipt, warning: "session_file_remove_failed" };
  }
}

/**
 * Parse argv and run one verb. `end` returns exactly one JSON receipt line.
 * `knocks` and `doorbell-scan` are read-only and consulted from hooks and
 * timers: they return one JSON line or null (print nothing), and every
 * failure, including a usage error, is null with exit 0.
 */
export function runCollabHostCli(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  dependencies: HostCliDependencies = {},
): { exit_code: 0 | 1; line: string | null } {
  const [verb, ...rest] = argv;
  if (verb === "knocks") return quietly(() => runKnocks(rest, env, dependencies));
  if (verb === "doorbell-scan") return quietly(() => runDoorbellScan(rest, env, dependencies));
  return runEnd(argv, env);
}

function quietly(run: () => KnockReport | DoorbellScan | null): { exit_code: 0; line: string | null } {
  try {
    const payload = run();
    return { exit_code: 0, line: payload === null ? null : JSON.stringify(payload) };
  } catch {
    return { exit_code: 0, line: null };
  }
}

function runEnd(
  argv: string[],
  env: Record<string, string | undefined>,
): { exit_code: 0 | 1; line: string } {
  let secret: string | null = null;
  const emit = (payload: HostEndReceipt | HostErrorReceipt, exitCode: 0 | 1) => {
    const line = JSON.stringify(payload);
    if (secret !== null && line.includes(secret)) {
      return {
        exit_code: 1 as const,
        line: JSON.stringify({
          protocol: COLLAB_HOST_PROTOCOL,
          status: "error",
          error: "receipt_withheld",
          message: "The receipt would have contained credential material and was withheld",
        }),
      };
    }
    return { exit_code: exitCode, line };
  };
  try {
    const args = parseHostArgs(argv);
    const databasePath = args.db ?? resolveDatabasePath(env);
    if (!existsSync(databasePath)) {
      throw new CollabError(
        "journal_not_found",
        "No collaboration journal exists at the selected path; pass --db or set AGENTOOL_COLLAB_DB",
      );
    }
    const credential = readSessionCredentialFile(args.session_file);
    secret = credential.session_token;
    const store = new CollabStore(databasePath);
    try {
      const receipt = endSessionFromCredential(store, credential, {
        session_file: args.session_file,
        reason: args.reason,
        release_leases: args.release_leases,
      });
      // An ended session is never knocked or woken; its host binding goes with it.
      removeHostBinding(databasePath, receipt.session_id);
      return emit(receipt, 0);
    } finally {
      store.close();
    }
  } catch (error) {
    return emit(errorReceipt(error), 1);
  }
}

function parseHostArgs(argv: string[]): HostEndOptions & { db?: string } {
  let parsed: ReturnType<typeof parseHostOptions>;
  try {
    parsed = parseHostOptions(argv);
  } catch (error) {
    throw new CollabError(
      "usage_error",
      `${error instanceof Error ? error.message : String(error)}; ${COLLAB_HOST_USAGE}`,
    );
  }
  const [command, ...extra] = parsed.positionals;
  if (command !== "end" || extra.length > 0) {
    throw new CollabError("usage_error", COLLAB_HOST_USAGE);
  }
  const sessionFile = parsed.values["session-file"];
  const reason = parsed.values.reason;
  if (!sessionFile || sessionFile.trim() === "") {
    throw new CollabError("usage_error", `--session-file is required; ${COLLAB_HOST_USAGE}`);
  }
  if (!reason || reason.trim() === "") {
    throw new CollabError("usage_error", `--reason is required; ${COLLAB_HOST_USAGE}`);
  }
  // The resume raises the generation and appends an event before the end
  // judges its reason, so refuse here what endSession would refuse there.
  if (reason.trim().length > MAX_HOST_REASON) {
    throw new CollabError(
      "usage_error",
      `--reason exceeds ${MAX_HOST_REASON} characters; ${COLLAB_HOST_USAGE}`,
    );
  }
  if (reason.includes("\0")) {
    throw new CollabError("usage_error", `--reason must not contain NUL bytes; ${COLLAB_HOST_USAGE}`);
  }
  if (parsed.values.db !== undefined && parsed.values.db.trim() === "") {
    throw new CollabError("usage_error", `--db must not be empty; ${COLLAB_HOST_USAGE}`);
  }
  return {
    session_file: sessionFile,
    reason,
    release_leases: parsed.values["release-leases"] === true,
    db: parsed.values.db,
  };
}

function parseHostOptions(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      "session-file": { type: "string" },
      reason: { type: "string" },
      "release-leases": { type: "boolean" },
      db: { type: "string" },
    },
  });
}

function runKnocks(
  argv: string[],
  env: Record<string, string | undefined>,
  dependencies: HostCliDependencies,
): KnockReport | null {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      "host-ancestor": { type: "string" },
      "mark-tapped": { type: "boolean" },
      db: { type: "string" },
    },
  });
  if (parsed.positionals.length > 0) throw new CollabError("usage_error", COLLAB_KNOCKS_USAGE);
  const ancestor = parsed.values["host-ancestor"];
  let startPid: number;
  if (ancestor === "auto") {
    startPid = dependencies.parent_pid ?? process.ppid;
  } else if (ancestor !== undefined && /^[1-9][0-9]{0,9}$/.test(ancestor)) {
    startPid = Number(ancestor);
  } else {
    throw new CollabError("usage_error", COLLAB_KNOCKS_USAGE);
  }
  return knockForHost(selectedJournal(parsed.values.db, env), startPid, {
    ...dependencies,
    mark_tapped: parsed.values["mark-tapped"] === true,
  });
}

function runDoorbellScan(
  argv: string[],
  env: Record<string, string | undefined>,
  dependencies: HostCliDependencies,
): DoorbellScan {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: { db: { type: "string" } },
  });
  if (parsed.positionals.length > 0) throw new CollabError("usage_error", COLLAB_DOORBELL_SCAN_USAGE);
  return doorbellScan(selectedJournal(parsed.values.db, env), dependencies);
}

/**
 * The read-only verbs never create a journal: a missing or blank path is an
 * error (silence), and so is any path the store itself would refuse to open
 * (a symlink, a hard-linked or foreign-owned file).
 */
function selectedJournal(db: string | undefined, env: Record<string, string | undefined>): string {
  const path = db ?? resolveDatabasePath(env);
  if (path.trim() === "" || path === ":memory:" || !existsSync(path)) {
    throw new CollabError("journal_not_found", "No collaboration journal exists at the selected path");
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !isOwnedByCurrentUser(stat.uid)) {
    throw new CollabError("database_file_unsafe", "The journal path is not a private regular file");
  }
  return path;
}

/**
 * Open the journal read-only, never through CollabStore (which takes BEGIN
 * IMMEDIATE, writes pragmas and re-verifies every journal): readonly,
 * query_only, busy_timeout 0, like the store's nonblockingEventReader.
 *
 * A WAL journal whose last connection closed cleanly may have no -wal file,
 * and a readonly connection cannot create one (SQLITE_CANTOPEN) — the
 * doorbell's usual case when no MCP is running. Only then it reads through a
 * handle that never creates the journal (create: false) and refuses every
 * write (query_only), with no transaction lock and no persistent pragma.
 */
export function openReadOnly(databasePath: string): Database {
  try {
    return prepareReader(new Database(databasePath, { readonly: true, strict: true }));
  } catch (error) {
    if ((error as { code?: unknown }).code !== "SQLITE_CANTOPEN" || !existsSync(databasePath)) throw error;
    return prepareReader(new Database(databasePath, { readwrite: true, create: false, strict: true }));
  }
}

function prepareReader(db: Database): Database {
  try {
    db.exec("PRAGMA busy_timeout = 0; PRAGMA query_only = ON");
    // The first read of the header: an unopenable WAL fails here.
    const { application_id: applicationId } = db.query("PRAGMA application_id").get() as {
      application_id: number;
    };
    if (applicationId !== COLLAB_APPLICATION_ID) {
      throw new CollabError("database_application_mismatch", "The SQLite file belongs to another application");
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * The knock for the host nearest `startPid`: walk the ancestry (start
 * inclusive) to the nearest process recorded as a binding's host with the
 * same start time. Exactly one active session must be bound there; none or
 * several (one Desktop app-server hosting several threads) is silence (null),
 * never a guess. With mark_tapped, the returned `new` items are recorded in
 * the private knock ledger before they are returned, so they never repeat;
 * a session at held rest is reported but never marked.
 */
export function knockForHost(
  databasePath: string,
  startPid: number,
  options: HostCliDependencies & { mark_tapped?: boolean } = {},
): KnockReport | null {
  const bindings = readHostBindings(databasePath);
  // Nothing bound: no ps call and no SQLite open.
  if (bindings.length === 0) return null;
  const table = (options.process_table ?? readProcessTable)();
  // ps failed or was denied (for example inside a Codex seatbelt): fail closed.
  if (!table) return null;
  const bound = boundHostFor(startPid, table, bindings);
  if (!bound) return null;
  const now = (options.now ?? (() => new Date()))();
  const db = openReadOnly(databasePath);
  let found: { session: ReadOnlySessionRow; rest: SessionRest | null; waiting: KnockItem[] } | null;
  try {
    found = db.transaction(() => {
      const active = bound.flatMap((binding) => {
        const row = sessionRowById(db, binding.session_id);
        return row?.status === "active" ? [row] : [];
      });
      if (active.length !== 1) return null;
      const session = active[0]!;
      return { session, rest: restAt(db, session, now), waiting: addressedItems(db, session) };
    })();
  } finally {
    db.close();
  }
  if (!found) return null;
  const { session, rest, waiting } = found;
  // A held rest (resting without wake_on "addressed") is never tapped: its items
  // stay unmarked, so they tap at the first turn after the session returns.
  const held = rest !== null && !rest.wake_on.includes("addressed");
  const fresh = options.mark_tapped && !held
    ? markTapped(databasePath, session.id, waiting)
    : untapped(readKnockLedger(databasePath), session.id, waiting);
  return {
    protocol: COLLAB_KNOCK_PROTOCOL,
    session_id: session.id,
    liveness: livenessAt(session, rest, now),
    rest,
    waiting: waiting.length,
    new: fresh,
  };
}

/**
 * Resting sessions that asked to be woken for addressed notes (`wake_on`
 * includes "addressed", rest unexpired, session active) and have waiting
 * items no tap has announced yet, each with its host binding or null.
 */
export function doorbellScan(
  databasePath: string,
  options: Pick<HostCliDependencies, "now"> = {},
): DoorbellScan {
  const now = (options.now ?? (() => new Date()))();
  const ledger = readKnockLedger(databasePath);
  const bindings = new Map(readHostBindings(databasePath).map((binding) => [binding.session_id, binding]));
  const db = openReadOnly(databasePath);
  try {
    const sessions = db.transaction(() => {
      const rows = db.query(`
        SELECT s.id, s.workspace_id, s.actor, s.status, s.last_seen_at, s.cursor_sequence,
          w.root_path AS worktree_root
        FROM coordination_sessions s
        JOIN worktrees w ON w.id = s.worktree_id
        WHERE s.status = 'active'
        ORDER BY s.joined_at, s.id
      `).all() as Array<ReadOnlySessionRow & { worktree_root: string }>;
      const found: DoorbellScanSession[] = [];
      for (const row of rows) {
        const rest = restAt(db, row, now);
        if (!rest || !rest.wake_on.includes("addressed")) continue;
        const waiting = addressedItems(db, row);
        const fresh = untapped(ledger, row.id, waiting);
        if (fresh.length === 0) continue;
        found.push({
          session_id: row.id,
          workspace_id: row.workspace_id,
          worktree_root: row.worktree_root,
          actor: row.actor,
          rest,
          waiting: waiting.length,
          new: fresh,
          binding: bindings.get(row.id) ?? null,
        });
      }
      return found;
    })();
    return { protocol: COLLAB_DOORBELL_SCAN_PROTOCOL, sessions };
  } finally {
    db.close();
  }
}

interface ReadOnlySessionRow {
  id: string;
  workspace_id: string;
  actor: string;
  status: string;
  last_seen_at: string;
  cursor_sequence: number;
}

/**
 * The bindings that may answer for the host nearest `startPid`. A recognised
 * host with no binding stops the walk, so a nested Codex never borrows the
 * Claude seat's knocks. A binding counts only while its mcp_pid is still a
 * collab MCP and that host's direct child (an exited MCP's reused pid is not).
 * An app-server must run exactly one collab MCP, since a hook cannot tell its
 * threads apart.
 */
function boundHostFor(
  startPid: number,
  table: ProcessTable,
  bindings: HostBinding[],
): HostBinding[] | null {
  for (const record of ancestry(startPid, table)) {
    const matched = bindings.filter(
      (binding) => binding.host_pid === record.pid && binding.host_started_at === record.started_at,
    );
    if (matched.length > 0) {
      if (hostKindOf(record, {}) === "codex-app-server" && collabChildren(table, record).length !== 1) {
        return null;
      }
      const live = matched.filter((binding) => {
        const mcp = table.get(binding.mcp_pid);
        return mcp !== undefined && mcp.ppid === record.pid && isCollabMcpProcess(mcp);
      });
      return live.length > 0 ? live : null;
    }
    if (isHostProcess(record)) return null;
  }
  return null;
}

function collabChildren(table: ProcessTable, host: ProcessRecord): ProcessRecord[] {
  return [...table.values()].filter((record) => record.ppid === host.pid && isCollabMcpProcess(record));
}

function sessionRowById(db: Database, sessionId: string): ReadOnlySessionRow | null {
  return db.query(`
    SELECT id, workspace_id, actor, status, last_seen_at, cursor_sequence
    FROM coordination_sessions WHERE id = ?
  `).get(sessionId) as ReadOnlySessionRow | null;
}

/**
 * The session's declared rest at `now`: the store's own latestRestDeclaration
 * query run on the read-only handle, judged by the store's restFromDeclaration
 * (returned, expired or damaged reads as no rest).
 */
function restAt(db: Database, session: ReadOnlySessionRow, now: Date): SessionRest | null {
  const declaration = db.query(`
    SELECT type, sequence, occurred_at, payload_json FROM events
    WHERE workspace_id = ? AND entity_id = ?
      AND type IN ('session.rested', 'session.returned')
    ORDER BY sequence DESC
    LIMIT 1
  `).get(session.workspace_id, session.id) as RestDeclarationRow | null;
  return declaration ? restFromDeclaration(declaration, now.toISOString()) : null;
}

/** Precedence ended → resting → stale → live, as the store derives it. */
function livenessAt(session: ReadOnlySessionRow, rest: SessionRest | null, now: Date): SessionLiveness {
  if (session.status !== "active") return "ended";
  if (rest) return "resting";
  const age = now.getTime() - Date.parse(session.last_seen_at);
  return age <= SESSION_STALE_AFTER_MS ? "live" : "stale";
}

/**
 * Addressed items past the session's acknowledged cursor, judged by the
 * store's own isAddressedTo, so `waiting` always equals collab_next's
 * addressed_waiting.
 */
function addressedItems(db: Database, session: ReadOnlySessionRow): KnockItem[] {
  const rows = db.query(`
    SELECT sequence, type, actor, entity_id, session_id, payload_json FROM events
    WHERE workspace_id = ? AND sequence > ?
      AND type IN ('report.posted', 'handoff.offered')
    ORDER BY sequence
  `).all(session.workspace_id, session.cursor_sequence) as Array<
    AddressedEventRow & { sequence: number; actor: string; entity_id: string }
  >;
  return rows
    .filter((row) => isAddressedTo(row, session.id))
    .map((row) => ({
      seq: row.sequence,
      kind: row.type as KnockItem["kind"],
      from_actor: row.actor,
      ref_id: row.entity_id,
    }));
}

interface KnockLedger {
  format: typeof KNOCK_LEDGER_FORMAT;
  tapped: Record<string, number[]>;
}

/** `dirname(db)/collab-sessions/knock-ledger.json`: which items a tap has already announced. */
export function knockLedgerPath(databasePath: string): string {
  return join(collabSessionsDirectory(databasePath), "knock-ledger.json");
}

function untapped(ledger: KnockLedger, sessionId: string, waiting: KnockItem[]): KnockItem[] {
  const tapped = new Set(ledger.tapped[sessionId] ?? []);
  return waiting.filter((item) => !tapped.has(item.seq));
}

/** Missing reads as empty; an unsafe or damaged ledger refuses (the caller stays silent). */
function readKnockLedger(databasePath: string): KnockLedger {
  const path = knockLedgerPath(databasePath);
  let stat: Stats;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { format: KNOCK_LEDGER_FORMAT, tapped: {} };
    }
    throw error;
  }
  if (!isPrivateRegularFile(stat)) {
    throw new CollabError("knock_ledger_unsafe", "The knock ledger is not a private regular file");
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isKnockLedger(parsed)) {
    throw new CollabError("knock_ledger_invalid", "The knock ledger is malformed");
  }
  return parsed;
}

/**
 * Record the untapped items under an exclusive ledger lock and return them.
 * A held lock means another tap is in progress: refuse (silence) rather than
 * risk announcing an item twice; the next turn taps it.
 */
function markTapped(databasePath: string, sessionId: string, waiting: KnockItem[]): KnockItem[] {
  if (untapped(readKnockLedger(databasePath), sessionId, waiting).length === 0) return [];
  return withLedgerLock(databasePath, () => {
    const ledger = readKnockLedger(databasePath);
    const fresh = untapped(ledger, sessionId, waiting);
    if (fresh.length === 0) return [];
    // Keep only sequences still waiting: acknowledged items never return.
    const stillWaiting = new Set(waiting.map((item) => item.seq));
    const kept = (ledger.tapped[sessionId] ?? []).filter((seq) => stillWaiting.has(seq));
    const tapped = [...new Set([...kept, ...fresh.map((item) => item.seq)])].sort((left, right) => left - right);
    writeKnockLedger(databasePath, {
      format: KNOCK_LEDGER_FORMAT,
      tapped: { ...ledger.tapped, [sessionId]: tapped },
    });
    return fresh;
  });
}

function withLedgerLock<T>(databasePath: string, run: () => T): T {
  const lock = `${knockLedgerPath(databasePath)}.lock`;
  const acquire = () => closeSync(openSync(lock, "wx", 0o600));
  try {
    acquire();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (Date.now() - lstatSync(lock).mtimeMs < LEDGER_LOCK_STALE_MS) {
      throw new CollabError("knock_ledger_busy", "Another tap holds the knock ledger");
    }
    unlinkSync(lock);
    acquire();
  }
  try {
    return run();
  } finally {
    try {
      unlinkSync(lock);
    } catch {
      // A lock that cannot be removed expires after LEDGER_LOCK_STALE_MS.
    }
  }
}

function writeKnockLedger(databasePath: string, ledger: KnockLedger): void {
  const directory = collabSessionsDirectory(databasePath);
  const directoryStat = lstatSync(directory);
  if (
    !directoryStat.isDirectory()
    || directoryStat.isSymbolicLink()
    || !isOwnedByCurrentUser(directoryStat.uid)
    || (directoryStat.mode & 0o077) !== 0
  ) {
    throw new CollabError("session_directory_not_private", "The collab-sessions directory is not private");
  }
  const path = knockLedgerPath(databasePath);
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(ledger)}\n`, "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // Already renamed or never created.
    }
    throw error;
  }
}

function isKnockLedger(value: unknown): value is KnockLedger {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.format !== KNOCK_LEDGER_FORMAT) return false;
  const tapped = record.tapped;
  if (tapped === null || typeof tapped !== "object" || Array.isArray(tapped)) return false;
  return Object.entries(tapped).every(([sessionId, sequences]) =>
    SESSION_ID.test(sessionId)
    && Array.isArray(sequences)
    && sequences.every((sequence) => Number.isInteger(sequence) && sequence > 0)
  );
}

function isPrivateRegularFile(stat: Stats): boolean {
  return (
    stat.isFile()
    && !stat.isSymbolicLink()
    && isOwnedByCurrentUser(stat.uid)
    && (stat.mode & 0o077) === 0
  );
}

function isOwnedByCurrentUser(uid: number): boolean {
  return typeof process.getuid !== "function" || uid === process.getuid();
}

function errorReceipt(error: unknown): HostErrorReceipt {
  if (error instanceof CollabError) {
    return {
      ...error.details,
      protocol: COLLAB_HOST_PROTOCOL,
      status: "error",
      error: error.code,
      message: error.message,
    };
  }
  return {
    protocol: COLLAB_HOST_PROTOCOL,
    status: "error",
    error: "internal_error",
    message: error instanceof Error ? error.message : String(error),
  };
}
```

(c) Replace `packages/collab/bin/agenttool-collab-host.ts` with:

```ts
#!/usr/bin/env bun
import { runCollabHostCli } from "../src/host.js";

const result = runCollabHostCli(process.argv.slice(2), process.env);
// knocks and doorbell-scan print nothing at all when there is nothing to say.
if (result.line !== null) process.stdout.write(`${result.line}\n`);
// Exit naturally once stdout drains rather than cutting a piped write short.
process.exitCode = result.exit_code;
```

(d) In `packages/collab/tests/host.test.ts`, test "refuses a reason endSession would refuse before any store call, with or without --release-leases", replace:

```ts
    expect(JSON.parse(nul.line)).toMatchObject({ status: "error", error: "usage_error" });
```

with:

```ts
    expect(JSON.parse(nul.line!)).toMatchObject({ status: "error", error: "usage_error" });
```

Do not rebuild `dist/` here, for the same reason as Task 5. `dist/agenttool-collab-host.js` still prints a line for every call until C4 Task 8 rebuilds it.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab && bun test tests/host-knocks.test.ts tests/host.test.ts tests/host-binding.test.ts && bun test && bun run typecheck
```

Expected:
- `0 fail, +13 tests in tests/host-knocks.test.ts`
- `tests/host.test.ts` and `tests/host-binding.test.ts`: `0 fail`, test counts unchanged
- full suite `0 fail`, 13 more tests than before this task
- `tsc --noEmit` clean

If the parity test "agrees with the store's liveness and rest and with collab_next's addressed_waiting" fails, Tasks 1–4 landed a different shape: a different event selection, cursor or precedence. Fix the SQL in `restAt` or `addressedItems`, or `livenessAt`, in `src/host.ts` to match the store.

- [ ] **Step 5: Commit**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest
git add packages/collab/src/host.ts packages/collab/src/store.ts packages/collab/bin/agenttool-collab-host.ts packages/collab/tests/host-knocks.test.ts packages/collab/tests/host.test.ts
git commit -F - <<'MSG'
feat(collab): read-only knocks and doorbell-scan host verbs

knocks --host-ancestor auto|<pid> [--mark-tapped] walks to the nearest
host recorded in a binding (a recognised host without one stops the walk)
and prints one pointer-only line for its single active session: liveness,
rest, waiting, and the items no tap has announced, recorded once in
collab-sessions/knock-ledger.json under an exclusive lock. A session at
held rest (no wake_on addressed) is reported but never marked, so its
items tap after it returns. Several bound sessions, a binding whose MCP
is gone (or whose pid now belongs to something else), an ended session,
a multi-thread app-server, a busy or damaged ledger, or any error prints
nothing, exit 0. doorbell-scan lists resting wake_on-addressed sessions
with unknocked items and their binding. waiting and rest are judged by
the store's own isAddressedTo and restFromDeclaration (now exported).
Both read SQLite read-only (query_only, busy_timeout 0), never open
CollabStore, and refuse a journal path the store would refuse; a cleanly
closed WAL journal without -wal is read through a query_only handle that
never creates it. Each verb has its own option set; end still refuses
unknown flags. dist/ is rebuilt on Bun 1.3.5 in C4 Task 8.

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>
MSG
```

---

## Hand-off to the rest of Plan C and to Part 2

- **Bundles and install (C4 Task 8).** After Tasks 5–6 both `dist/` bundles are stale, and C4 Task 8 rebuilds them on Bun 1.3.5. Its `knock-install-check.ts` already asserts this part's behaviour against the installed bin:
  - `doorbell-scan` pointers carry `ref_id` = the report id and `from_actor` = the sender, and no body.
  - `knocks --host-ancestor 1` is silent and writes no ledger.
  - `end` removes `<id>.host.json`.
  - With a missing journal, both read verbs print nothing.
- **No install, push or PR in this part.**
  - From Task 5 until C4 Task 8, the tracked `dist/` bundles are stale. CI's `check:mcp-bundle` runs on Bun 1.3.5 and compares them byte for byte, so it would fail.
  - Push the branch only after C4 Task 8, and only with Yu's explicit go. The same holds for the lockstep household install.
- **Docs (C4 Task 7)** describe the walk as reaching "the nearest recorded host process whose start time still matches". Add deviations 2 and 14 there in two sentences:
  - A recognised host without a binding stops the walk. A binding counts only while its MCP is still a running collab MCP child of that host. A multi-thread app-server is silent.
  - `--mark-tapped` never marks the items of a session resting without `wake_on: ["addressed"]`.
- **`collab-sessions/` now holds four kinds of file.** It holds `<id>.json` (credential), `<id>.host.json` (binding), `knock-ledger.json`, and the transient `knock-ledger.json.lock` / `*.tmp-*`. Only `<id>.json` is a credential. Household code must address files by exact name, never by a `*.json` glob.
- **Tap hook (Part 2).**
  - Run `agenttool-collab-host knocks --host-ancestor <the hook's parent pid> --mark-tapped`. D1 passes `os.getppid()`, the value `"$PPID"` holds in a shell.
  - Print the context line only when the output exists and `new` is non-empty. Empty stdout is the normal answer.
  - D1 deviation 5 (no tap for an ended session or a held rest) now agrees with deviation 14: `knocks` does not mark what the tap will not show.
  - D3's scene 3 may therefore expect exactly one tap at the first prompt after the held rester returns. That change belongs to D3; nothing here edits it.
- **Doorbell (Part 2).**
  - Choose the adapter from `binding.host_kind`: `codex` / `codex-app-server` → Codex wake, `claude-code` → channel. A row with `binding: null` is held as `no_host_binding`, and `unknown` (no adapter) as `host_cannot_wake`. These are D2's reasons.
  - Resume from `binding.credential_file_path`.
  - `doorbell-scan` does not judge whether the binding's host is still alive. Before a Codex wake, the doorbell must check `host_pid` and `host_started_at` against `ps`. A live host means the session's own process is still running, and a resume would fence it at generation +1.
  - A woken Codex job's MCP rewrites the binding to the new `codex exec` host on resume. The exit sweep leaves it in place for a resting session.
- **Ledger growth.** Entries for sessions that ended stay in `knock-ledger.json` until a later tidy-up. Each entry holds only that session's still-waiting sequences.


# Plan C, part C4 — Tasks 7–8 (docs; pinned build and lockstep household reinstall)

Stacked on `feat/collab-household-smoothing-20261008`; worktree
`/Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest`, branch
`feat/collab-knock-and-rest-20261009`. Package stays `0.5.0`, schema 3.

## Contract deviations

None of the interface contract's names or shapes change. Scope additions and
assumptions the integrator must reconcile with C1–C3:

1. **Tool-count text is Task 7's.** `collab_session_rest` makes the release
   candidate 34 tools. Besides the README, both skills and `openai.yaml`, Task 7
   edits the counts in `integrations/openclaw/README.md`,
   `.codex-plugin/plugin.json` (`longDescription`) and three repository guides
   (`docs/COLLABORATION-CHANNELS.md`, `docs/COLLABORATION.md`,
   `docs/PACKAGES.md`), and changes the term `"33"` to `"34"` in the existing
   package test "keeps release-candidate host guidance bounded and
   non-lifecycle". The historical receipt "listed 33 tools" in
   `docs/COLLABORATION-CHANNELS.md` stays. Tasks 1–6 must not edit those texts;
   if one did, the affected Task 7 edit will not match and is merged by hand.
   `src/mcp.ts` server instructions stay Task 1's (Task 7 touches no `src/`).
2. **Host-verb details Task 8 asserts** are C3 Task 6's (deviations 2–5 and
   its `selectedJournal` / `runEnd`): a pointer's `kind` is the event type,
   `ref_id` the event's `entity_id` (the report id for `report.posted`) and
   `from_actor` the event actor; a binding counts only while its `mcp_pid` is
   still a direct child of `host_pid`; more than one active session on one host
   is silence; `doorbell-scan` leaves out pointers a tap already recorded;
   `knocks` and `doorbell-scan` print nothing and exit 0 for a missing journal
   and never create it; `agenttool-collab-host end` removes
   `<session-id>.host.json`. Task 8's stdio test and install check were run
   against a scratch build with the C1–C3 source edits applied verbatim; if a
   later revision of C1–C3 changes one of these, align the check, not the
   contract.
3. **New install check file.** Plan A's `household-install-check.ts` hardcodes
   33 tools and the household-smoothing worktree, and it stays as that plan's
   record. Task 8 writes `knock-install-check.ts` beside it, plus
   `codex-approvals-guard.py` (deviation 10).
4. **Rollback target** is the household's current 0.5.0 build, not registry
   0.3.1: Task 8 packs a rollback tarball from its backup of the global copy.
5. **No git remote in the freshness step.** Task 8 checks the committed bundles
   against a pinned rebuild and the local stack base only. `git fetch`, push and
   the stacked PR wait for Yu's explicit go and are not in this plan.
6. **S1 smoke runs twice:** before the install against the worktree bundle (a
   `sed` copy of `run-all.sh` in the backup dir that keeps the spike's absolute
   paths, spike files untouched), and after it with `run-all.sh` unchanged (its
   `B050` is the global copy). A copy of the spike moved elsewhere would fail:
   the fixture workspace is keyed to the real path of `S1/repo`.
7. **`none` routes follow C2, not the spec sentence.** The docs say handoff
   offers and review requests refuse inactive targets, so `none` comes only
   from an addressed report, a review whose reporter has since ended, or a
   replay after the addressee ended (C2 deviation 3). The docs also follow C1:
   `rest` is null on an ended session, a return is never refused, `until` is a
   future ISO-8601 instant with seconds and a time zone, and `mode: "ready"`
   takes no rest fields (C1 deviations 1, 3–5). The README adds C3's walk
   narrowings and its `SQLITE_CANTOPEN` read fallback (C3 hand-off, deviations
   2 and 8).
8. **Tasks 1–6 leave both bundles stale, by design** (C1 Step 6, C2, C3). Task
   8 therefore expects the pinned rebuild to change `dist/`, and adds one
   in-repo stdio test (`tests/mcp.test.ts`, "carries declared rest, the
   addressee hint and the read-only host verbs through the checked-in
   bundles") that fails on the stale bundles and passes on the rebuilt ones.
   The C1 hand-off invited this; it is committed with the bundles.
9. **The household install waits for Yu's go.** 3a–3d build, test, pack and
   back up without changing the household; 3e–3g (global npm copy, Codex
   plugin, approvals) run only after Yu says go in the executing conversation.
10. **Real-journal reads and the Codex config are handled more narrowly than in
    Plan A.** `sqlite3 -readonly` cannot open the WAL journal when no process
    holds it open (no `-wal` file), so the snapshot and the `user_version`
    reads fall back to `file:…?immutable=1` in that case only. The approvals
    step restores `~/.codex/config.toml` from its backup only when the lost
    `agenttool-collab` approvals are the file's only change (checked with
    `tomllib`), never on a bare line count, so it cannot revert other settings
    or hook trust.
11. **The hint reports the declaration (spec Part 1 item 4, amended
    2026-10-09).** The skill, the Hermes skill and the README say that
    `delivery` names what the addressee declared, and that whether a host can
    actually wake a resting session (for example a Claude seat launched
    without its channel) is the household doorbell's `host_cannot_wake`
    record, never part of the hint (C2 deviation 4). No doc claims the hint
    shows `host_cannot_wake`.

---

### Task 7: Teach declared rest, four-state liveness, knocks and delivery hints

**Files:**
- Modify: `packages/collab/skills/coordinate-agent-work/SKILL.md` (frontmatter `description`; RC banner; ordinary-loop steps 2 and 8; "Request and give review"; new `### Rest and return` after "End cleanly"; new `## Knocks and delivery hints` after "Reports and relations"; "Roles, liveness and recovery"; Zerone count)
- Modify: `packages/collab/integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md` (`description`; RC banner; ordinary-loop step 8; review paragraph; liveness paragraph in "Delegate and deliver"; new `## Rest, knocks and delivery hints` before "Receive without liveness writes (0.5.0)")
- Modify: `packages/collab/skills/coordinate-agent-work/agents/openai.yaml` (`default_prompt`)
- Modify: `packages/collab/README.md` (Code line; RC banner; session-loop step 6; ordinary-loop step 8; "Requesting and giving review"; "Roles and liveness"; new `### Declared rest and knocks` before "Conflict and lease boundary"; two counts under "Codex, Claude Code, Hermes Agent, and OpenClaw" and "Distribution")
- Modify: `packages/collab/integrations/openclaw/README.md` (two counts)
- Modify: `packages/collab/.codex-plugin/plugin.json` (`interface.longDescription`)
- Modify: `docs/COLLABORATION-CHANNELS.md` (line 36 hint), `docs/COLLABORATION.md` (line 25 hint), `docs/PACKAGES.md` (line 74 hint) — counts only
- Test: `packages/collab/tests/package.test.ts` (constants after `HOUSEHOLD_TERMS`; one term in "keeps release-candidate host guidance bounded and non-lifecycle"; two tests just before "ships an explicit Hermes adapter for separate presence and secure planes")

**Interfaces:**
- Consumes (documents, does not implement), by contract name:
  - `collab_session_rest {workspace_id?, idempotency_key, mode: "resting"|"ready", until?, reason?, wake_on?}`, `localRetrySafeMutation`; `until` a future ISO-8601 instant, `reason` ≤ 200, `wake_on` `[]` (default) or `["addressed"]`; events `session.rested` `{mode:"resting", until, reason, wake_on}` and `session.returned` `{mode:"ready", prior_rest_sequence}`; expiry computed on read.
  - `SessionLiveness = "live" | "resting" | "stale" | "ended"`, precedence ended → resting → stale → live; `CoordinationSession.rest: SessionRest | null` (`{mode, since, until, reason, wake_on}`); `assignee_liveness` in the same four states.
  - `collab_next` bound `session.addressed_waiting` (spec Part 1 item 3 counting rules).
  - `addressee: {session_id, liveness, rest, delivery}` with `KnockDelivery = "tap" | "wake" | "held" | "none"` on `collab_report_append` (with `to_session_id`), `collab_handoff_offer` (session path), `collab_task_complete` (with `review_requested_session_id`), `collab_task_review` (the reporter); computed per call.
  - Host binding `dirname(db)/collab-sessions/<id>.host.json` (`agenttool.collab-host-binding/1`, mode 0600, `HostKind` `claude-code | codex | codex-app-server | unknown`), written at start and resume, removed by `collab_session_end` and `agenttool-collab-host end`.
  - Host verbs `knocks --host-ancestor auto|<pid> [--mark-tapped] [--db]` (`agenttool.collab-knock/1`, ledger `collab-sessions/knock-ledger.json`, ambiguity → silent) and `doorbell-scan [--db]` (`agenttool.collab-doorbell-scan/1`); both `openReadOnly`, errors → no output, exit 0.
  - Spec "Keep": pointers never bodies; silence is complete; rest declared never inferred; departure complete; `wake_on` is the session's own consent; rest never touches leases, handoffs or accepted obligations. Household tap-line wording appears only as an example.
- Produces:
  - Test constants `KNOCK_TERMS`, `LIVENESS_PRECEDENCE` (`` `ended`, `resting`, `stale` or `live` ``), `REVIEWER_GUIDANCE` (`` unless the requested reviewer reads `live`, or `resting` with `wake_on` addressed ``), `DELIVERY_TABLE_HEADER` (`` | `delivery` | Addressee reads | Meaning | ``), `ENDED_AS_STALE`, helper `flat(text)`.
  - Tests "teaches declared rest, four-state liveness, knocks as pointers and delivery hints" and "points the Codex prompt and plugin at declared rest and quiet knocks".
  - Headings `### Rest and return` and `## Knocks and delivery hints` (skill), `## Rest, knocks and delivery hints` (Hermes), `### Declared rest and knocks` (README anchor `#declared-rest-and-knocks`), and the 34-tool count in every package doc and the Codex manifest. Task 8 packs these bytes.

Every edit below was applied in sequence to a scratch copy of the whole
repository at `05b39c63` (re-run on 2026-10-09 after the last wording change,
by a script that extracts each Replace/with pair from this file): each old
text matched exactly once, `tests/package.test.ts` went from `6 pass, 3 fail`
to `9 pass, 0 fail`, `agenttool-skill validate` and `claude plugin validate`
passed, the skills manifests passed (5) and the repository guide tests passed
(9). C1–C3 edit none of these files (C3 deviation 12; C1 and C2 leave the docs
to this task), so the anchors still hold after Tasks 1–6.

- [ ] **Step 1: Write the failing test**

Apply these three edits to `packages/collab/tests/package.test.ts` with the
Edit tool, in order. Each old text must match exactly once; keep every existing
test and term.

**T1** — `packages/collab/tests/package.test.ts`. Replace:

```ts
  "host_commit_successor",
  "git_checkpoint_stale",
];
```

with:

```ts
  "host_commit_successor",
  "git_checkpoint_stale",
];

// Declared rest, four-state liveness, knocks as pointers and delivery hints
// (knock-and-rest spec, schema 3). Checked on whitespace-flattened text so a
// phrase may wrap across Markdown lines.
const KNOCK_TERMS = [
  "collab_session_rest",
  "session.rested",
  "session.returned",
  "wake_on",
  "addressed_waiting",
  "addressee",
  "`tap`",
  "`wake`",
  "`held`",
  "`none`",
  "{seq, kind, from_actor, ref_id}",
  "never a body",
  "silence is complete",
  "agenttool-collab-host knocks",
  "doorbell-scan",
  "ambiguity means silence",
  "Rest is declared, never inferred",
  "never releases, renews, extends or reassigns",
];

const LIVENESS_PRECEDENCE = "`ended`, `resting`, `stale` or `live`";
const REVIEWER_GUIDANCE = "unless the requested reviewer reads `live`, or `resting` with `wake_on` addressed";
const DELIVERY_TABLE_HEADER = "| `delivery` | Addressee reads | Meaning |";
// The household-smoothing wording that called an ended session stale.
const ENDED_AS_STALE = /`stale` once (?:it has |the session has )?ended|ended session always/;

function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}
```

**T2** — `packages/collab/tests/package.test.ts`. Replace:

```ts
      for (const term of ["RELEASE CANDIDATE", "0.5.0", "0.4.0", "33", "32", "collab_events_wait",
        "next_anchor", "256 KiB", "1 MiB", "8 MiB", "event_anchor_too_large", "stdin EOF",
        "event_too_large", "event_read_busy", "last_seen", "persona"]) {
        expect(text).toContain(term);
      }
```

with:

```ts
      for (const term of ["RELEASE CANDIDATE", "0.5.0", "0.4.0", "34", "32", "collab_events_wait",
        "next_anchor", "256 KiB", "1 MiB", "8 MiB", "event_anchor_too_large", "stdin EOF",
        "event_too_large", "event_read_busy", "last_seen", "persona"]) {
        expect(text).toContain(term);
      }
      expect(text).toMatch(/\b34(?: local)?(?: MCP)? tools\b/);
      expect(text).not.toMatch(/\b33(?: local)?(?: MCP)? tools\b|\b33-tool\b/);
```

**T3** — `packages/collab/tests/package.test.ts`. Replace:

```ts
  test("ships an explicit Hermes adapter for separate presence and secure planes", async () => {
```

with:

```ts
  test("teaches declared rest, four-state liveness, knocks as pointers and delivery hints", async () => {
    const read = async (path: string) => await Bun.file(join(packageRoot, path)).text();
    for (const path of [
      "skills/coordinate-agent-work/SKILL.md",
      "integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md",
      "README.md",
    ]) {
      const text = flat(await read(path));
      for (const term of KNOCK_TERMS) expect(text).toContain(term);
      expect(text).toContain(LIVENESS_PRECEDENCE);
      expect(text).toContain(REVIEWER_GUIDANCE);
      expect(text).not.toMatch(ENDED_AS_STALE);
    }

    const readme = flat(await read("README.md"));
    for (const term of [
      DELIVERY_TABLE_HEADER,
      "agenttool-collab-host knocks --host-ancestor auto|<pid> [--mark-tapped] [--db <path>]",
      "agenttool-collab-host doorbell-scan [--db <path>]",
      "agenttool.collab-knock/1",
      "agenttool.collab-doorbell-scan/1",
      "collab-sessions/knock-ledger.json",
      "<session-id>.host.json",
      "agenttool.collab-host-binding/1",
      "host_started_at",
      "`readonly`, `query_only`, zero busy timeout",
      "print nothing and exit 0",
      "{workspace_id?, idempotency_key, mode: \"resting\" | \"ready\", until?, reason?, wake_on?}",
    ]) expect(readme).toContain(term);

    const rawSkill = await read("skills/coordinate-agent-work/SKILL.md");
    expect(flat(rawSkill)).toContain(DELIVERY_TABLE_HEADER);
    expect(flat(rawSkill)).toContain("### Rest and return");
    const description = /^description: (.+)$/m.exec(rawSkill)?.[1] ?? "";
    expect(description).toContain("declared rest and return");
    expect(description).toContain("knocks");
    expect(description.length).toBeLessThanOrEqual(1024);

    const hermes = flat(await read("integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md"));
    expect(hermes).toContain("mcp_agenttool_collab_session_rest");
    expect(hermes).toContain("No host wake exists for Hermes yet");
    expect(hermes).toContain("`wake_on: []`");
  });

  test("points the Codex prompt and plugin at declared rest and quiet knocks", async () => {
    const yaml = await Bun.file(join(packageRoot, "skills/coordinate-agent-work/agents/openai.yaml")).text();
    expect(yaml).toContain("collab_session_rest");
    expect(yaml).toContain("knocks as pointers");
    expect(yaml).toContain("silence as a complete answer");
    const codex = await json(".codex-plugin/plugin.json");
    expect(codex.interface.longDescription).toContain("Collab 0.5.0: 34 tools");
    expect(codex.interface.longDescription).toContain("declared rest");
  });

  test("ships an explicit Hermes adapter for separate presence and secure planes", async () => {
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab
bun test tests/package.test.ts
```

Expected: `6 pass`, `3 fail`, as verified on the branch docs at `05b39c63`:
```
Expected to contain: "34"
(fail) cross-host package > keeps release-candidate host guidance bounded and non-lifecycle
Expected to contain: "collab_session_rest"
(fail) cross-host package > teaches declared rest, four-state liveness, knocks as pointers and delivery hints
Expected to contain: "collab_session_rest"
(fail) cross-host package > points the Codex prompt and plugin at declared rest and quiet knocks
```
`ENDED_AS_STALE` was checked to bite: it matches all three current documents
("an ended session always does", "`stale` once it has ended", "`stale` once
the session has ended", "`stale` once ended").

- [ ] **Step 3: Write minimal implementation**

Apply these edits with the Edit tool, in order (S = skill, H = Hermes skill,
R = README, Y = `openai.yaml`, O = OpenClaw README, P = Codex manifest,
D = repository guides). Each old text must match exactly once. If one does not,
an earlier task changed that passage: merge by hand, keeping both changes;
never apply an edit loosely.

**S1** — `packages/collab/skills/coordinate-agent-work/SKILL.md`. Replace:

```markdown
recovering leases, handing work off, ending a session cleanly, publishing optional self-declared presence,
```

with:

```markdown
recovering leases, handing work off, ending a session cleanly, declared rest and return, reading knocks and delivery hints, publishing optional self-declared presence,
```

**S2** — `packages/collab/skills/coordinate-agent-work/SKILL.md`. Replace:

```markdown
**RELEASE CANDIDATE 0.5.0:** 33 local MCP tools, including `collab_events_wait`.
These release-candidate bytes do not establish npm publication; verify the
protected receipt and registry separately.
Published 0.4.0 has 32 tools and does not gain this wait from these source edits.
```

with:

```markdown
**RELEASE CANDIDATE 0.5.0:** 34 local MCP tools, including `collab_events_wait`
and `collab_session_rest`. These release-candidate bytes do not establish npm
publication; verify the protected receipt and registry separately.
Published 0.4.0 has 32 tools and gains neither tool from these source edits.
```

**S3** — `packages/collab/skills/coordinate-agent-work/SKILL.md`. Replace:

```markdown
   terminal `next_anchor` (`{ epoch_id, sequence, hash }`); poll again while
   `has_more` is true. Handle your own entries in `recovery_required` first.
```

with:

```markdown
   terminal `next_anchor` (`{ epoch_id, sequence, hash }`); poll again while
   `has_more` is true. Handle your own entries in `recovery_required` first.
   Your bound `session` carries `addressed_waiting`: notes addressed to you
   past your acknowledged cursor.
```

**S4** — `packages/collab/skills/coordinate-agent-work/SKILL.md`. Replace:

```markdown
8. **End.** Call `collab_session_end` with a `reason`, `release_leases: true`
   and an optional `release_summary` when this session will not resume.
```

with:

```markdown
8. **End or rest.** Call `collab_session_end` with a `reason`,
   `release_leases: true` and an optional `release_summary` when this session
   will not resume. To stay reachable instead, declare rest with
   `collab_session_rest` (see "Rest and return").
```

**S5** — `packages/collab/skills/coordinate-agent-work/SKILL.md`. Replace:

```markdown
reservation: any distinct session may still review. While the requested
reviewer's `liveness` is `live`, leave the review to them; if it reads `stale`
(an ended session always does) or the requester asks, review it yourself.
```

with:

```markdown
reservation: any distinct session may still review. Review it yourself
unless the requested reviewer reads `live`, or `resting` with `wake_on`
addressed (a host may wake it for the request); then leave it to them unless
the requester asks you.
```

**S6** — `packages/collab/skills/coordinate-agent-work/SKILL.md`. Replace:

```markdown
also the release note. Without `--release-leases` it refuses a session that
holds a live lease before touching it. A live model ends its own session with
`collab_session_end`.
```

with:

```markdown
also the release note. Without `--release-leases` it refuses a session that
holds a live lease before touching it. A live model ends its own session with
`collab_session_end`.

### Rest and return

Rest is declared, never inferred. When you will be away but want to stay
reachable, call `collab_session_rest` with `mode: "resting"`, an optional
`until` (a future ISO-8601 instant with seconds and a time zone, such as
`2026-10-09T18:00:00Z`), an optional `reason` (at most 200 characters) and
`wake_on`: `[]` (the default) or `["addressed"]`. It appends
`session.rested`; `mode: "ready"`, sent without those three fields, returns
and appends `session.returned`. Both act on your own credential-bound
session, and an exact retry with the same idempotency key is safe. Once
`until` passes, the rest simply reads as over: nothing starts.

`wake_on: ["addressed"]` is your own consent to be woken for notes addressed
to you; no other session can arm it. Whether anything can wake you belongs to
the host: a host doorbell may resume this same session in a fresh process
(same session ID, the generation raised by one), and some hosts cannot be
woken at all. Without it, addressed notes are held until you return.

Resting never releases, renews, extends or reassigns your leases, pending
handoffs or accepted obligations. Release or hand off what others may need
before you rest; a lease that expires while you rest reads
`recovery_required` like any other. To leave for good, end instead: an ended
session is never knocked or woken.

If a host wakes you, its prompt carries only pointers and your own rest
reason. Read the notes with `collab_next` if you choose. If nothing needs you,
end the turn: silence is complete, and no reply is owed. You may rest again
with `collab_session_rest` or return with `mode: "ready"`; until you do, you
still read `resting`.
```

**S7** — `packages/collab/skills/coordinate-agent-work/SKILL.md`. Replace:

```markdown
Offer a handoff with `collab_handoff_offer`; do not assign it by declaration.
The lease transfers only after the named recipient accepts. Transfer neither
private data nor external authority. Treat decline, stop, pause, and
uncertainty as valid outcomes.
```

with:

```markdown
Offer a handoff with `collab_handoff_offer`; do not assign it by declaration.
The lease transfers only after the named recipient accepts. Transfer neither
private data nor external authority. Treat decline, stop, pause, and
uncertainty as valid outcomes.

## Knocks and delivery hints

Only an explicit address knocks: a report with `to_session_id`, a handoff
offered to a session, a requested review, or a review result for the
reporter. A mention or an implied ask never does. The journal is the mailbox
and a knock is only its doorbell: a pointer `{seq, kind, from_actor, ref_id}`,
never a body, so a missed knock loses nothing.

`collab_report_append` with `to_session_id`, `collab_handoff_offer` to a
session, `collab_task_complete` with `review_requested_session_id`, and
`collab_task_review` (for the reporter) return
`addressee: {session_id, liveness, rest, delivery}`, read fresh on every call,
so an idempotent retry shows the addressee's current state:

| `delivery` | Addressee reads | Meaning |
|---|---|---|
| `tap` | `live` | a host hook may show a one-line pointer at its next turn |
| `wake` | `resting` with `wake_on: ["addressed"]` | a host doorbell may wake it |
| `held` | `resting` without it, or `stale` | nothing happens; the note waits for its return |
| `none` | `ended` | never knocked; departure is complete and the note stays unread |

The hint names what the addressee declared, not what any host did, and nothing
is blocked. Collab cannot see hosts: whether a host can actually wake a
resting session (for example a Claude seat launched without its channel) is
the host doorbell's record (`host_cannot_wake` in Sol's doorbell ledger),
never part of the hint. Handoff offers and review requests refuse inactive targets, so
`none` comes only from an addressed report, a review whose reporter has since
ended, or a replay after the addressee ended. Do not resend to make a knock
louder.

If your host shows a Collab tap line (for example "2 note(s) addressed to you
are waiting"), it is a pointer: read with `collab_next` when you choose;
nothing is required. A host process that runs several collab sessions, such
as one Codex Desktop app-server for several threads, cannot tell which session
is yours, so it gets no tap: that ambiguity means silence, not a guess. Keep
polling with `collab_next`. Hosts read knocks with the read-only
`agenttool-collab-host knocks` and `agenttool-collab-host doorbell-scan`
commands; neither is a model tool.
```

**S8** — `packages/collab/skills/coordinate-agent-work/SKILL.md`. Replace:

```markdown
`liveness` is a view, not a status: a session reads `stale` once it has ended
or when its `last_seen_at` is more than 6 hours old. Every cursor
acknowledgement refreshes `last_seen_at`, including one that does not advance
the cursor; so do `collab_next`, session mutations, a cursor reset, resume and
end. A host that only waits with `collab_events_wait` shows as stale. Nothing
expires or ends automatically. Tasks show `assignee_liveness`, and `collab_next` lists
`recovery_required` tasks, the caller's own expired leases first.
```

with:

```markdown
`liveness` is a view, not a status. A session reads, in this order of
precedence, `ended`, `resting`, `stale` or `live`: `ended` once it has ended;
`resting` while its latest declared rest stands (not returned, `until` not
passed); `stale` when its `last_seen_at` is more than 6 hours old; otherwise
`live`. A quiet session reads `stale`, never `resting`. Session projections
carry `rest` (`mode`, `since`, `until`, `reason`, `wake_on`) for a standing
rest, else null. Every cursor acknowledgement refreshes `last_seen_at`,
including one that does not advance the cursor; so do `collab_next`, session
mutations, a cursor reset, resume and end. A host that only waits with
`collab_events_wait` shows as stale. Nothing expires or ends automatically.
Tasks show `assignee_liveness` in the same four states, and `collab_next`
lists `recovery_required` tasks, the caller's own expired leases first.
```

**S9** — `packages/collab/skills/coordinate-agent-work/SKILL.md`. Replace:

```markdown
this 0.5.0 release candidate has 33 tools.
```

with:

```markdown
this 0.5.0 release candidate has 34 tools.
```

**H1** — `packages/collab/integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md`. Replace:

```markdown
delegated child sessions, clean session exit, or refusable handoffs when the Hermes MCP server is named agenttool.
```

with:

```markdown
delegated child sessions, clean session exit, declared rest and return, or refusable handoffs when the Hermes MCP server is named agenttool.
```

**H2** — `packages/collab/integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md`. Replace:

```markdown
**RELEASE CANDIDATE 0.5.0:** 33 tools. These release-candidate bytes do not establish
```

with:

```markdown
**RELEASE CANDIDATE 0.5.0:** 34 tools. These release-candidate bytes do not establish
```

**H3** — `packages/collab/integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md`. Replace:

```markdown
8. **End.** Call `mcp_agenttool_collab_session_end` with a `reason`,
   `release_leases: true` and an optional `release_summary` when the host knows
   this session will not resume.
```

with:

```markdown
8. **End or rest.** Call `mcp_agenttool_collab_session_end` with a `reason`,
   `release_leases: true` and an optional `release_summary` when the host knows
   this session will not resume, or declare rest with
   `mcp_agenttool_collab_session_rest` to stay reachable.
```

**H4** — `packages/collab/integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md`. Replace:

```markdown
it is a request, not a reservation. Leave the review to that session while its
`liveness` is `live`. If a review returns `task_not_pending_review` with
`review_report_id` and `accepted_by_session_id`, append your verdict with
```

with:

```markdown
it is a request, not a reservation. Review it yourself unless the requested
reviewer reads `live`, or `resting` with `wake_on` addressed. If a review
returns `task_not_pending_review` with `review_report_id` and
`accepted_by_session_id`, append your verdict with
```

**H5** — `packages/collab/integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md`. Replace:

```markdown
others. A session reads `stale` once ended, or after 6 hours without
`collab_next`, a session mutation, a cursor acknowledgement, reset, resume
or end; every acknowledgement refreshes `last_seen_at`, including one that
does not advance the cursor, and nothing expires automatically. Tasks show
`assignee_liveness`; recover an expired lease only through
`mcp_agenttool_collab_task_recover` with an explicit action and note.
```

with:

```markdown
others. A session reads, in this order of precedence, `ended`, `resting`,
`stale` or `live`: `ended` once ended; `resting` while a declared rest stands;
`stale` after 6 hours without `collab_next`, a session mutation, a cursor
acknowledgement, reset, resume or end; otherwise `live`. Every acknowledgement
refreshes `last_seen_at`, including one that does not advance the cursor, and
nothing expires automatically. Tasks show `assignee_liveness` in the same four
states; recover an expired lease only through
`mcp_agenttool_collab_task_recover` with an explicit action and note.

## Rest, knocks and delivery hints

Rest is declared, never inferred. Call `mcp_agenttool_collab_session_rest`
with `mode: "resting"`, an optional future `until` (ISO-8601 with seconds and
a time zone), an optional `reason` (at most 200 characters) and `wake_on`
(`[]` by default, or `["addressed"]`); it appends `session.rested`, and
`mode: "ready"`, sent without those fields, returns with `session.returned`.
A passed `until` reads as not resting and starts nothing.
Resting never releases, renews, extends or reassigns leases, handoffs or
accepted obligations; an ended session is never knocked or woken.

No host wake exists for Hermes yet, so a resting Hermes session declares
`wake_on: []`: addressed notes are held for its return, and
`mcp_agenttool_collab_next` counts them in `addressed_waiting` on the bound
session.

Only an explicit address knocks (a report `to_session_id`, a handoff to a
session, a requested review, or a review result for the reporter), never a
mention. The journal is the mailbox; a knock is a pointer
`{seq, kind, from_actor, ref_id}`, never a body, so a missed knock loses
nothing. Addressed mutations return
`addressee: {session_id, liveness, rest, delivery}`, read fresh on every call:
`tap` (live), `wake` (resting with `wake_on` addressed), `held` (resting
otherwise, or stale) or `none` (ended; departure is complete). It reports the
addressee's declaration, not whether a host can wake it (a host doorbell
records that, as `host_cannot_wake` in Sol's ledger). It is a hint,
not a guarantee, and nothing is blocked. A host process that runs several
collab sessions cannot tell which one is yours; that ambiguity means silence.
Hosts read knocks with `agenttool-collab-host knocks` and
`agenttool-collab-host doorbell-scan`, which are not model tools. If you are
told notes are waiting, read them when you choose; silence is complete.
```

**R1** — `packages/collab/README.md`. Replace:

```markdown
> **Code:** `src/{store,mcp,protocol}.ts`.
```

with:

```markdown
> **Code:** `src/{store,mcp,protocol,host,host-binding,process-tree}.ts`.
```

**R2** — `packages/collab/README.md`. Replace:

```markdown
**RELEASE CANDIDATE: 0.5.0, 33 MCP tools.** Public 0.4.0 remains
the unchanged 32-tool witness-awareness release; installing it does not supply
`collab_events_wait`. This preparation is not evidence of 0.5.0 publication or
native-harness activation; verify exact release receipts separately.
```

with:

```markdown
**RELEASE CANDIDATE: 0.5.0, 34 MCP tools.** Public 0.4.0 remains
the unchanged 32-tool witness-awareness release; installing it supplies neither
`collab_events_wait` nor `collab_session_rest`. This preparation is not
evidence of 0.5.0 publication or native-harness activation; verify exact
release receipts separately.
```

**R3** — `packages/collab/README.md`. Replace:

```markdown
   live task lease and `session_has_active_leases` lists `task_ids` and
   `leases`. Pending offers addressed to the ending session expire with an
   auditable `target_session_ended` reason.
```

with:

```markdown
   live task lease and `session_has_active_leases` lists `task_ids` and
   `leases`. Pending offers addressed to the ending session expire with an
   auditable `target_session_ended` reason. A session that should stay
   reachable may declare rest instead (see
   [Declared rest and knocks](#declared-rest-and-knocks)).
```

**R4** — `packages/collab/README.md`. Replace:

```markdown
8. **End.** `collab_session_end` with a `reason`, `release_leases: true`, and
   an optional `release_summary`.
```

with:

```markdown
8. **End or rest.** `collab_session_end` with a `reason`,
   `release_leases: true`, and an optional `release_summary`; or, to stay
   reachable, `collab_session_rest` (see
   [Declared rest and knocks](#declared-rest-and-knocks)).
```

**R5** — `packages/collab/README.md`. Replace:

```markdown
request, not a reservation: any distinct session may still review, and others
should leave it to the requested reviewer while that session's `liveness` is
`live`. The server refuses a request that names the reporter
```

with:

```markdown
request, not a reservation: any distinct session may still review. Review it
yourself unless the requested reviewer reads `live`, or `resting` with
`wake_on` addressed. The server refuses a request that names the reporter
```

**R6** — `packages/collab/README.md`. Replace:

```markdown
Coordination-session projections carry a derived `liveness`: `stale` once the
session has ended or when `last_seen_at` is more than 6 hours old, otherwise
`live`. Task projections carry `assignee_liveness` (null without an assignee),
and `collab_next` adds `recovery_required` (the caller's own expired leases
first). Every cursor acknowledgement refreshes `last_seen_at`, including one
that does not advance the cursor; so do `collab_next`, session mutations, a
cursor reset, resume, and end. A host that only uses `collab_events_wait` for
over 6 hours reads as stale. This is a view: no status changes and nothing
expires automatically.
```

with:

````markdown
Coordination-session projections carry a derived `liveness` and a `rest`
view. Liveness reads, in this order of precedence, `ended`, `resting`, `stale`
or `live`: `ended` once the session has ended; `resting` while its latest
declared rest stands (not returned, `until` not passed); `stale` when
`last_seen_at` is more than 6 hours old; otherwise `live`. Rest is declared,
never inferred: a quiet session reads `stale`, never `resting`. `rest` is
`{mode, since, until, reason, wake_on}` for a standing declared rest, else
null. Task projections carry `assignee_liveness` in the same four states (null
without an assignee), and `collab_next` adds `recovery_required` (the caller's
own expired leases first). Every cursor acknowledgement refreshes
`last_seen_at`, including one that does not advance the cursor; so do
`collab_next`, session mutations, a cursor reset, resume, and end. A host that
only uses `collab_events_wait` for over 6 hours reads as stale. This is a
view: no status changes and nothing expires automatically.

### Declared rest and knocks

`collab_session_rest` declares rest for the caller's own credential-bound
session, unlike the unauthenticated presence tools:
`{workspace_id?, idempotency_key, mode: "resting" | "ready", until?, reason?, wake_on?}`.
`until` is a future ISO-8601 instant with seconds and a time zone (stored as
UTC), `reason` at most 200 characters, and `wake_on` is `[]` (the default) or
`["addressed"]`. `mode: "resting"` appends `session.rested`; `mode: "ready"`
takes none of those three fields, returns, and appends `session.returned`. An
exact retry with the same idempotency key is safe. Expiry is computed on read:
once `until` passes the session no longer reads `resting`, and nothing starts.
Rest never releases, renews, extends or reassigns leases, handoffs or accepted
obligations. Ending outranks rest: departure is complete, so an ended session
is never knocked or woken.

`wake_on: ["addressed"]` is the session's own consent to be woken for
addressed notes; a sender never arms another session's doorbell. Collab wakes
no one. A host may: it resumes the same session through
`AGENTOOL_COLLAB_SESSION_FILE` in a fresh process (same session ID, the
generation raised by one, any older process fenced), and resuming an ended
session is refused. A woken session that finds nothing for it may end its turn
without replying; silence is complete. Until it returns or rests again it
still reads `resting`.

The bound `session` in `collab_next` carries `addressed_waiting`: the
`report.posted` events addressed to it (ordinary addressed reports, review
requests and review results) and the session-path `handoff.offered` events
offered to it, past its acknowledged cursor and not authored by it.
`task.reported_complete` is not counted, because its review-request report
already is, and a `handoff.accepted` never matches.

Only an explicit address knocks; a mention or an implied ask never does.
`collab_report_append` with `to_session_id`, `collab_handoff_offer` to a
session, `collab_task_complete` with `review_requested_session_id`, and
`collab_task_review` (addressed to the reporter) return
`addressee: {session_id, liveness, rest, delivery}`. The MCP wrapper computes
it on every call, so an idempotent replay shows the addressee's current state:

| `delivery` | Addressee reads | Meaning |
|---|---|---|
| `tap` | `live` | a host hook may show a pointer at its next turn |
| `wake` | `resting` with `wake_on: ["addressed"]` | a host doorbell may wake it |
| `held` | `resting` without it, or `stale` | nothing happens; the note waits for its return |
| `none` | `ended` | never knocked; the note stays honestly unread |

`delivery` describes what the addressee declared, not what a host did, and
nothing is blocked. Collab cannot see hosts, so whether a host can actually
wake a resting session (for example a Claude seat launched without its
channel) is recorded by the host's doorbell (`host_cannot_wake` in Sol's
doorbell ledger), never in the hint. Handoff offers and review requests refuse inactive
targets, so `none` comes only from an addressed report, a review whose
reporter has since ended, or a replay after the addressee ended.

A knock is a pointer `{seq, kind, from_actor, ref_id}`, never a body; the
journal stays the mailbox, so a missed knock loses nothing. Two read-only host
commands expose knocks:

```bash
agenttool-collab-host knocks --host-ancestor auto|<pid> [--mark-tapped] [--db <path>]
agenttool-collab-host doorbell-scan [--db <path>]
```

`knocks` walks the process ancestry from `<pid>` (a host hook passes its own
parent pid, `"$PPID"`; `auto` starts from the command's parent process) to the
nearest recorded host process whose start time still matches. A recognised
Claude Code or Codex host without a binding ends the walk, and a binding whose
MCP process has exited no longer counts. It prints one line,
`{"protocol":"agenttool.collab-knock/1","session_id","liveness","rest","waiting","new"}`,
or nothing. `new` lists the pointers not yet in the private ledger
`collab-sessions/knock-ledger.json`, which only `--mark-tapped` writes. When
more than one active session is bound to that host, or a Codex Desktop
app-server runs more than one collab server, it prints nothing and marks
nothing: ambiguity means silence, not a guess. `doorbell-scan` prints
`{"protocol":"agenttool.collab-doorbell-scan/1","sessions":[...]}`: the resting
sessions with `wake_on` addressed and waiting items no tap has announced, each
with its host binding. Both open the journal read-only (`readonly`,
`query_only`, zero busy timeout), never through `CollabStore`. A WAL journal
that no process holds open has no `-wal` file a read-only handle could use;
then they read through a `query_only` handle that can neither create the
journal nor write to it. A missing journal, like any error, means they print
nothing and exit 0. `doorbell-scan` bindings name credential-file paths: keep
them in host configuration, never in model-visible text.

The host binding comes from the host side, never from a model's claim. The MCP
server's start (`collab_session_start`) and resume
(`AGENTOOL_COLLAB_SESSION_FILE`) paths write
`<database-directory>/collab-sessions/<session-id>.host.json` (mode `0600`,
format `agenttool.collab-host-binding/1`) with `host_kind` (`claude-code`,
`codex`, `codex-app-server` or `unknown`: the MCP process's direct parent, read
from the process tree), `host_pid`, `host_started_at` (a guard against pid
reuse), `mcp_pid` and `credential_file_path`. It holds no bearer token. Ending
the session through `collab_session_end` or `agenttool-collab-host end`
removes it. `collab-sessions/` therefore holds credential files, host bindings
and the knock ledger, and only `<session-id>.json` is a credential: host code
names these files exactly, never by a `*.json` glob.
````

**R7** — `packages/collab/README.md`. Replace:

```markdown
`skills/coordinate-agent-work/SKILL.md` and 33-tool standalone MCP server ship
```

with:

```markdown
`skills/coordinate-agent-work/SKILL.md` and 34-tool standalone MCP server ship
```

**R8** — `packages/collab/README.md`. Replace:

```markdown
coordination/database contracts and adds bounded anchored observation as the
33rd tool.
```

with:

```markdown
coordination/database contracts (schema 3) and adds bounded anchored
observation as the 33rd tool and declared rest (`collab_session_rest`) as the
34th.
```

**Y1** — `packages/collab/skills/coordinate-agent-work/agents/openai.yaml`. Replace:

```yaml
review with stated confidence, and end with release_leases. Distinguish
```

with:

```yaml
review with stated confidence, and end with release_leases or rest with collab_session_rest to stay reachable. Treat knocks as pointers and silence as a complete answer. Distinguish
```

**O1** — `packages/collab/integrations/openclaw/README.md`. Replace:

```markdown
**RELEASE CANDIDATE 0.5.0, 33 tools.**
```

with:

```markdown
**RELEASE CANDIDATE 0.5.0, 34 tools.**
```

**O2** — `packages/collab/integrations/openclaw/README.md`. Replace:

```markdown
33-tool inventory after connecting.
```

with:

```markdown
34-tool inventory after connecting.
```

**P1** — `packages/collab/.codex-plugin/plugin.json`. Replace:

```json
"longDescription": "Collab 0.5.0: 33 tools over one local plaintext SQLite journal,
```

with:

```json
"longDescription": "Collab 0.5.0: 34 tools over one local plaintext SQLite journal,
```

**P2** — `packages/collab/.codex-plugin/plugin.json`. Replace:

```json
Includes reports, advisory claims, review, refusable handoffs and optional local Zerone witness status.
```

with:

```json
Includes reports, advisory claims, review, refusable handoffs, declared rest with addressee delivery hints and optional local Zerone witness status.
```

**D1** — `docs/COLLABORATION-CHANNELS.md`. Replace:

```markdown
Collab **0.5.0 is a RELEASE CANDIDATE with 33 MCP tools**, adding bounded
anchored waiting. These release-candidate bytes do not establish npm publication;
```

with:

```markdown
Collab **0.5.0 is a RELEASE CANDIDATE with 34 MCP tools**, adding bounded
anchored waiting and declared rest. These release-candidate bytes do not
establish npm publication;
```

**D2** — `docs/COLLABORATION.md`. Replace:

```markdown
| **Source candidate 0.5.0**, 33 tools. Not in published 0.4.0;
```

with:

```markdown
| **Source candidate 0.5.0**, 34 tools. Not in published 0.4.0;
```

**D3** — `docs/PACKAGES.md`. Replace:

```markdown
**0.5.0 RELEASE CANDIDATE** with 33 tools, including bounded event waiting.
```

with:

```markdown
**0.5.0 RELEASE CANDIDATE** with 34 tools, including bounded event waiting
and declared rest.
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab
bun test tests/package.test.ts
bun test
agenttool-skill validate . | jq -c '{valid, summary}'
claude plugin validate .
(cd ../skills && bun install --frozen-lockfile && bun test tests/manifests.test.ts)
(cd ../.. && bun test bin/tests/collaboration-onboarding.test.ts bin/tests/agent-toolkit-shelf.test.ts)
grep -rnE '\b33 (local )?(MCP )?tools\b|33-tool' README.md skills integrations .codex-plugin \
  ../../docs/COLLABORATION.md ../../docs/COLLABORATION-CHANNELS.md ../../docs/PACKAGES.md
```

Expected:
- `tests/package.test.ts`: `9 pass`, `0 fail` (0 fail, +2 tests in `tests/package.test.ts`).
- Full collab suite: `0 fail`, two more tests than after Task 6.
- `agenttool-skill validate`: `{"valid":true,"summary":{"errors":0,"files":3,"redactions":0,"resources":1,"scripts":0,"skills":2,"warnings":0}}`.
- `claude plugin validate`: `✔ Validation passed`. Its advisory about a README marketplace install line predates this branch and is not a failure.
- Skills manifests: `5 pass`, `0 fail`. Repository guide tests: `9 pass`, `0 fail`.
- The `grep` prints exactly one line, the historical receipt `../../docs/COLLABORATION-CHANNELS.md:433:entries; its extracted standalone bundle initialized, listed 33 tools, returned`.
- The skill `description` is 731 characters (limit 1024).

These edits touch no `src/` or `bin/` file. The bundles stay as Tasks 1–6
left them, stale by design; Task 8 rebuilds and checks them on Bun 1.3.5.

- [ ] **Step 5: Commit**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest
git add packages/collab/skills/coordinate-agent-work/SKILL.md \
  packages/collab/skills/coordinate-agent-work/agents/openai.yaml \
  packages/collab/integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md \
  packages/collab/integrations/openclaw/README.md \
  packages/collab/README.md \
  packages/collab/.codex-plugin/plugin.json \
  packages/collab/tests/package.test.ts \
  docs/COLLABORATION-CHANNELS.md docs/COLLABORATION.md docs/PACKAGES.md
git commit -F - <<'EOF'
docs(collab): teach declared rest, four-state liveness and knocks as pointers

Teach collab_session_rest (rest and return, wake_on as the session's own
consent, leases untouched), liveness as ended, resting, stale or live,
addressed_waiting, the addressee delivery hints (tap, wake, held, none),
knocks as pointers with silence as a complete answer, one host process with
several sessions as silence, and the read-only knocks and doorbell-scan host
verbs. A requested reviewer is waited for only while it reads live, or
resting with wake_on addressed. Tool counts move to 34 in the package docs,
the Codex manifest and the repository guides. Package tests pin the guidance
and reject the old ended-as-stale wording.

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>
EOF
git status --porcelain
```

Expected: the last command prints nothing.

---

### Task 8: Pinned build, freshness, lockstep household reinstall and S1 smoke

**Files:**
- Test (repo): `packages/collab/tests/mcp.test.ts`, one new test at the end of `describe("MCP surface", …)`, after "carries every new optional input over stdio through the checked-in bundles"
- Modify (repo): `packages/collab/dist/agenttool-collab-mcp.js`, `packages/collab/dist/agenttool-collab-host.js`. Tasks 1–6 change `src/` and `bin/` without rebuilding (C1 Step 6, C2 and C3 say so), so both bundles are stale when this task starts and the pinned rebuild is expected to change them.
- Create (outside the repo): `~/.cache/agenttool/collab-household/knock-install-check.ts`, `~/.cache/agenttool/collab-household/s1-smoke-assert.py`, `~/.cache/agenttool/collab-household/codex-approvals-guard.py`
- Create (outside the repo): `~/.cache/agenttool/collab-household/<STAMP>/` for the tarball, backups, rollback tarball, logs and receipts; `~/.cache/agenttool/collab-household/current` names the active stamp.
- Modify (outside the repo, **only after Yu's go**, see the gate before 3e): the global npm copy `/opt/homebrew/lib/node_modules/@agenttool/collab/` and its links `/opt/homebrew/bin/agenttool-collab-mcp`, `/opt/homebrew/bin/agenttool-collab-host` (Claude Code's user-scope `agenttool-collab` server runs `agenttool-collab-mcp` from PATH).
- Modify (outside the repo, **only after Yu's go**): `~/plugins/agenttool-collab/` (source of Codex's `personal` marketplace entry `agenttool-collab`), which `codex plugin add` turns into a new cache dir `~/.codex/plugins/cache/personal/agenttool-collab/0.5.0+codex.<UTC %Y%m%d%H%M%S>/`, replacing today's `0.5.0+codex.20261009153303`. `~/.codex/config.toml` changes only if `codex plugin add` drops tool approvals and nothing else in the file changed; it is then restored from the backup. Nothing here touches hook trust or writes Codex trusted hashes.
- Write (spike scratch, not the spike's inputs): `/Users/yuai/.cache/sol/workspaces/knock-spikes-20261009/S1/runs/` through `run-all.sh` (journal copies, credential copies, and now the new bundle's `collab-sessions/*.host.json`). `run-all.sh`, `mcp-drive.ts` and `data/` are read only.
- No remote: nothing is fetched, pushed or opened as a PR.

**How the household was installed (verified 2026-10-09):** Plan A Task 10
installed 0.5.0 three times today (stamps `20261009T113725Z`,
`20261009T120634Z`, `20261009T153229Z`), the last after Task 11. The global copy,
`~/plugins/agenttool-collab` and the Codex cache `0.5.0+codex.20261009153303`
are byte-identical: `dist/agenttool-collab-mcp.js` sha256
`dbad87ecca120239c83c39f9bb832210254b175af1498740ad19788d01ba6e87`,
`dist/agenttool-collab-host.js` `b9e69d3d7d4dfb2dfd5ed86f2f6cff11c53b1b921eca0ebcac607e0c86fae646`,
equal to this branch's `dist` at `05b39c63`. `~/.codex/config.toml` holds 18
`agenttool-collab@personal` tool approvals. A same-version reinstall works: the
`20261009T153229Z` stamp reinstalled 0.5.0 over 0.5.0 by the method below.

**Shell note:** the Bash tool runs zsh and shell variables do not survive
between calls, so every block re-reads `BK` from
`~/.cache/agenttool/collab-household/current`. The syntax works in zsh and bash
(no `PIPESTATUS`, no `! cmd` under `set -e`, no variable named `status`). Run
the blocks in order and stop at the first non-zero exit.

**Journal note:** `sqlite3 -readonly` cannot open a WAL journal whose `-wal`
file is absent, that is, when no process holds it open ("unable to open
database file", reproduced on a cleanly closed copy on 2026-10-09). Today the
household journal is held open by live MCP processes, so it has a `-wal`. Every
real-journal read below therefore uses the plain path when `-wal` exists and
`file:<path>?immutable=1` otherwise: with no `-wal`, the main file holds every
committed page, and an immutable open creates no `-wal` or `-shm`.

**Interfaces:**
- Consumes:
  - Tasks 1–7 committed: `src/`, `bin/`, docs. Tool inventory 34 including `collab_events_wait` and `collab_session_rest`; `collab_session_rest` annotations equal `collab_report_append`'s (`localRetrySafeMutation`: `{"readOnlyHint":false,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false}`), inputs exactly `workspace_id`, `idempotency_key`, `mode` (`["resting","ready"]`), `until`, `reason`, `wake_on`, result `{session}` (C1); `collab_report_append` result field `addressee` (C2); bound `collab_next` `session.liveness`, `session.rest`, `session.addressed_waiting` (C1, C2); the bin's host binding `dirname(db)/collab-sessions/<id>.host.json` naming the MCP's direct parent, kind `unknown` for a non-host parent (C3 deviation 1); `knocks` and `doorbell-scan` as in C3 Task 6 (pointer `kind` = event type, `ref_id` = the event's `entity_id`, which for `report.posted` is the report id, `from_actor` = the event actor; a binding counts only while its `mcp_pid` is still a direct child of `host_pid`; more than one active session on one host is silence; `doorbell-scan` leaves out pointers a tap already recorded; a missing journal prints nothing and is never created; `end` removes `<id>.host.json`); `end` otherwise unchanged (`agenttool.collab-host/1` receipts, `end` with no flags exits 1 with `usage_error`).
  - Plan A Task 10's install method (pack with `--ignore-scripts`, `npm install --global` from the tarball, clean replacement of `~/plugins/agenttool-collab`, cache-busting `0.5.0+codex.<ts>` version, `codex plugin add agenttool-collab@personal`, approvals preserved).
  - `bundlerBunVersion` `1.3.5`, run as `npx --yes bun@1.3.5` (cached in `~/.npm/_npx`; equivalently `~/.local/share/agenttool/toolchains/bun-1.3.5/bin/bun`). Inside `npx --yes bun@1.3.5 run <script>` a nested `bun` is 1.3.5 too (Plan A).
  - `jobs.environment()` from `~/.config/sol/agents/jobs.py` (read only). Its PATH today resolves `agenttool-collab-host` to `/opt/homebrew/bin/agenttool-collab-host` and `bun` to `/Users/yuai/.bun/bin/bun`.
  - Spike S1: `/Users/yuai/.cache/sol/workspaces/knock-spikes-20261009/S1/run-all.sh` (zsh; six runs: `v031-start`, `v031-resume`, `v050-start`, `v050-resume`, `v031-start-bun135`, `v050-start-bun135`; `B031` is a build of `fa862949`, `B050` the global copy), `mcp-drive.ts` (refuses a journal outside `S1/runs/`), fixture `data/collab.sqlite` (events 6 `session.rested`, 7 `session.returned`; `data/fixture.sha256`). The fixture workspace's repository key comes from the real path of `S1/repo`, so the smoke must run from the spike's own paths (a copy elsewhere puts start-mode sessions in another workspace).
- Produces:
  - The committed pinned bundles and the stdio test "carries declared rest, the addressee hint and the read-only host verbs through the checked-in bundles".
  - `/opt/homebrew/bin/agenttool-collab-host` with `knocks` and `doorbell-scan`, on `jobs.environment()["PATH"]`: the tap hooks and the doorbell of household Part 2 call it.
  - Codex plugin `agenttool-collab@personal` at a new `0.5.0+codex.<ts>`, 34 tools.
  - Receipts `$BK/knock-install-check.json`, `$BK/s1-smoke-worktree.json`, `$BK/s1-smoke-installed.json`; rollback tarball `$BK/rollback/agenttool-collab-0.5.0.tgz`.

Verified on 2026-10-09 in a scratch copy of `packages/collab` at `05b39c63`
with the C1–C3 source edits applied as those parts write them (tests left
out) and both bundles rebuilt on Bun 1.3.5: `tsc --noEmit` clean; the new
stdio test failed on the `05b39c63` bundles with `Expected: 34` /
`Received: 33` and passed on the rebuilt ones under Bun 1.3.5 and 1.3.13;
`knock-install-check.ts` against a scratch install layout of the rebuilt
package (global copy, bin links, marketplace source and cache dir, a fake
`jobs.environment()` and a schema-3 journal with no `-wal`) reported every
check passing except the one that reads the real Codex registration; the S1
runner, with `B050` pointed at the rebuilt bundle (run from a scratch copy
whose `repo` was a symlink to the spike's, so the fixture workspace matched),
passed all six runs (`v050*`: 34 tools, `collab_session_rest` present, chain
valid, liveness `live`; `v031*` unchanged); the rollback tarball packed from a
copy of the global install held 28 entries with both bundles byte-identical.
The current household was also probed read-only with the check (throwaway
journals, the real journal pointed elsewhere): the Step 2 failure list below
is that output.

- [ ] **Step 0: Check free disk space**

```bash
df -h /System/Volumes/Data
```

Stop if under 2 GB is free. This task writes tarballs, a 17 MB copy of the
global install, a journal snapshot and three `node_modules` trees (22 GiB were
free on 2026-10-09).

- [ ] **Step 1: Write the failing tests**

**1a. In-repo: the checked-in bundles carry rest, the addressee hint and the
host verbs.** In `packages/collab/tests/mcp.test.ts`, replace the end of the
file (this text occurs once):

```ts
      status: "open",
      lease_id: null,
    });
  }, 30_000);
});
```

with:

```ts
      status: "open",
      lease_id: null,
    });
  }, 30_000);

  test("carries declared rest, the addressee hint and the read-only host verbs through the checked-in bundles", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agenttool-collab-mcp-rest-"));
    const root = join(directory, "repo");
    const databasePath = join(directory, "state", "collab.sqlite");
    const mcpBundle = join(packageRoot, "dist", "agenttool-collab-mcp.js");
    const hostBundle = join(packageRoot, "dist", "agenttool-collab-host.js");
    mkdirSync(root);
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));

    const rester = new StdioMcpHarness(mcpBundle, databasePath);
    cleanup.push(() => rester.close());
    await rester.initialize();
    const sender = new StdioMcpHarness(mcpBundle, databasePath);
    cleanup.push(() => sender.close());
    await sender.initialize();

    // A bundle built before the rest tool fails here (33 tools).
    const tools = new Map<string, any>(
      (await rester.listTools()).tools.map((tool: any) => [tool.name, tool]),
    );
    expect(tools.size).toBe(34);
    const rest = tools.get("collab_session_rest");
    expect(Object.keys(rest.inputSchema.properties).sort()).toEqual([
      "idempotency_key",
      "mode",
      "reason",
      "until",
      "wake_on",
      "workspace_id",
    ]);
    expect(rest.inputSchema.properties.mode.enum).toEqual(["resting", "ready"]);
    expect(rest.annotations).toEqual(tools.get("collab_report_append").annotations);

    const resterJoin = await rester.callTool("collab_session_start", {
      root_path: root,
      actor: "stdio-rester",
    });
    const workspaceId = resterJoin.structuredContent.workspace.id;
    const resterId = resterJoin.structuredContent.session.id;
    const rested = await rester.callTool("collab_session_rest", {
      workspace_id: workspaceId,
      idempotency_key: "stdio-rest",
      mode: "resting",
      reason: "between turns",
      wake_on: ["addressed"],
    });
    expect(rested.isError).toBeUndefined();
    await sender.callTool("collab_session_start", { root_path: root, actor: "stdio-sender" });
    const note = await sender.callTool("collab_report_append", {
      workspace_id: workspaceId,
      idempotency_key: "stdio-note",
      to_session_id: resterId,
      kind: "observation",
      body: "One addressed note over stdio.",
    });
    expect(note.isError).toBeUndefined();
    expect(note.structuredContent.addressee).toMatchObject({
      session_id: resterId,
      liveness: "resting",
      rest: { mode: "resting", reason: "between turns", wake_on: ["addressed"] },
      delivery: "wake",
    });
    const next = await rester.callTool("collab_next", { workspace_id: workspaceId });
    expect(next.structuredContent.session).toMatchObject({ liveness: "resting", addressed_waiting: 1 });

    const host = (args: string[]) => Bun.spawnSync(
      [process.execPath, hostBundle, ...args, "--db", databasePath],
      {
        cwd: packageRoot,
        env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir() },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const scan = host(["doorbell-scan"]);
    expect(scan.exitCode).toBe(0);
    const scanned = JSON.parse(scan.stdout.toString());
    expect(scanned.protocol).toBe("agenttool.collab-doorbell-scan/1");
    expect(scanned.sessions.map((entry: any) => entry.session_id)).toEqual([resterId]);
    // A pointer, never a body.
    expect(scanned.sessions[0].new).toEqual([{
      seq: expect.any(Number),
      kind: "report.posted",
      from_actor: "stdio-sender",
      ref_id: note.structuredContent.report.id,
    }]);
    // pid 1 is never a recorded host: the read verb prints nothing at all.
    const unbound = host(["knocks", "--host-ancestor", "1"]);
    expect(unbound.exitCode).toBe(0);
    expect(unbound.stdout.toString()).toBe("");
  }, 30_000);
});
```

It uses only the file's existing imports and helpers (`mkdtempSync`,
`mkdirSync`, `rmSync`, `join`, `tmpdir`, `packageRoot`, `cleanup`,
`StdioMcpHarness`). It is hermetic: two bundle processes and the host bundle
share one temporary journal; the MCP children may write host bindings beside
it, which the cleanup removes. It asserts nothing about the binding, whose
`ps` read differs between this Mac and CI.

**1b. Out of the repo: the install check.** Run
`mkdir -p -m 700 ~/.cache/agenttool/collab-household`. Write
`~/.cache/agenttool/collab-household/knock-install-check.ts` with the Write
tool. It reads the real installs, gives every MCP and host process it starts a
throwaway `HOME` and database, never prints a credential, touches the real
journal only through `sqlite3 -readonly` for one `PRAGMA`, and gives every
child a timeout:

```ts
#!/usr/bin/env bun
// Knock-and-rest install check for @agenttool/collab (Plan C Task 8).
// Plan A's household-install-check.ts, with the 34-tool inventory, the
// collab_session_rest annotations, and a rest -> addressed note -> host binding
// -> knocks / doorbell-scan smoke through the installed bundle and host CLI.
// Read-only against the real journal (sqlite3 -readonly, one PRAGMA): every
// MCP/host spawn below uses a throwaway HOME and database. It never prints a
// credential. Run it where `ps` works (not inside a Codex sandbox): the MCP's
// host binding and the knock walk both read the process table.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const home = homedir();
const worktreePackage = process.env.COLLAB_WORKTREE_PACKAGE
  ?? "/Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab";
const globalCopy = process.env.COLLAB_GLOBAL_COPY ?? "/opt/homebrew/lib/node_modules/@agenttool/collab";
const globalBin = process.env.COLLAB_GLOBAL_BIN ?? "/opt/homebrew/bin";
const marketplaceSource = process.env.COLLAB_MARKETPLACE_SOURCE ?? join(home, "plugins", "agenttool-collab");
const codexCacheRoot = process.env.COLLAB_CODEX_CACHE_ROOT
  ?? join(home, ".codex", "plugins", "cache", "personal", "agenttool-collab");
const solAgents = process.env.COLLAB_SOL_AGENTS ?? join(home, ".config", "sol", "agents");
// Both household hosts (Claude Code user MCP config, Codex plugin manifest) set
// neither AGENTOOL_COLLAB_DB nor XDG_DATA_HOME, so they share this journal.
const householdJournal = process.env.COLLAB_HOUSEHOLD_JOURNAL
  ?? join(home, ".local", "share", "agenttool", "collab.sqlite");
const BUNDLES = ["dist/agenttool-collab-mcp.js", "dist/agenttool-collab-host.js"] as const;
const EXPECTED_TOOLS = 34;
const REQUIRED_TOOLS = ["collab_events_wait", "collab_session_rest"];
const EXPECTED_SCHEMA = "3";
const RPC_TIMEOUT_MS = 20_000;
const SENDER = "knock-install-check:sender";
const RESTER = "knock-install-check:rester";

const failures: string[] = [];
const check = (ok: boolean, message: string) => { if (!ok) failures.push(message); };
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const expectedVersion: string = readJson(join(worktreePackage, "package.json")).version;
const codexVersions = existsSync(codexCacheRoot) ? readdirSync(codexCacheRoot).sort() : [];
const codexVersion = codexVersions.filter((name) => name.startsWith(`${expectedVersion}+codex.`)).at(-1);
check(codexVersion !== undefined, `no ${expectedVersion}+codex.* directory under ${codexCacheRoot} (found: ${codexVersions.join(", ") || "none"})`);
const copies: Record<string, string> = {
  worktree: worktreePackage,
  npm_global: globalCopy,
  codex_marketplace_source: marketplaceSource,
  ...(codexVersion ? { codex_cache: join(codexCacheRoot, codexVersion) } : {}),
};

const digests: Record<string, Record<string, string | null>> = {};
for (const [label, root] of Object.entries(copies)) {
  digests[label] = {};
  for (const bundle of BUNDLES) {
    const path = join(root, bundle);
    const present = existsSync(path);
    check(present, `${label}: missing ${bundle}`);
    digests[label][bundle] = present ? sha256(path) : null;
    if (present && label !== "worktree") {
      check(digests[label][bundle] === digests.worktree[bundle], `${label}: ${bundle} differs from the worktree build`);
    }
  }
}

const globalVersion = existsSync(join(globalCopy, "package.json")) ? readJson(join(globalCopy, "package.json")).version : null;
check(globalVersion === expectedVersion, `npm_global: package.json version ${globalVersion}, expected ${expectedVersion}`);
const pluginVersion = (root: string) =>
  existsSync(join(root, ".codex-plugin", "plugin.json")) ? readJson(join(root, ".codex-plugin", "plugin.json")).version : null;
check(pluginVersion(marketplaceSource) === codexVersion, `codex_marketplace_source: plugin version ${pluginVersion(marketplaceSource)} is not the cached ${codexVersion}`);
if (codexVersion) check(pluginVersion(copies.codex_cache) === codexVersion, `codex_cache: plugin.json version ${pluginVersion(copies.codex_cache)}`);

for (const bundle of BUNDLES) {
  const binName = bundle === BUNDLES[0] ? "agenttool-collab-mcp" : "agenttool-collab-host";
  const link = join(globalBin, binName);
  const target = join(globalCopy, bundle);
  check(existsSync(link) && existsSync(target) && realpathSync(link) === realpathSync(target), `${link} does not resolve to ${target}`);
  check(existsSync(target) && (statSync(target).mode & 0o111) !== 0, `${target} is not executable`);
}

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${RPC_TIMEOUT_MS} ms`)), RPC_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function rpcSession(bundle: string, env: Record<string, string>) {
  const child = Bun.spawn([process.execPath, bundle], { env, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let nextId = 1;
  let killed = false;
  const close = async () => {
    if (!killed) { killed = true; child.kill(); }
    await child.exited;
  };
  const exchange = async (method: string, params: Record<string, unknown>) => {
    const id = nextId++;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    await child.stdin.flush();
    while (true) {
      const newline = buffered.indexOf("\n");
      if (newline >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        if (message.id !== id) continue;
        if (message.error) throw new Error(`${method}: ${JSON.stringify(message.error)}`);
        return message.result;
      }
      const next = await reader.read();
      if (next.done) throw new Error(`${bundle} closed before replying to ${method}`);
      buffered += decoder.decode(next.value, { stream: true });
    }
  };
  const request = (method: string, params: Record<string, unknown>) =>
    withTimeout(exchange(method, params), `${bundle} ${method}`);
  // A tool call that the server refused (isError) becomes an exception naming the tool.
  const callTool = async (name: string, args: Record<string, unknown>) => {
    const result = await request("tools/call", { name, arguments: args });
    if (result?.isError) throw new Error(`${name} refused: ${JSON.stringify(result.structuredContent)}`);
    return result.structuredContent;
  };
  try {
    const init = await request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "knock-install-check", version: "0.0.0" },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    await child.stdin.flush();
    return { init, request, callTool, close };
  } catch (error) {
    await close();
    throw error;
  }
}

function throwawayEnv(scratch: string): Record<string, string> {
  mkdirSync(join(scratch, "data"), { recursive: true });
  return {
    AGENTOOL_COLLAB_DB: join(scratch, "data", "collab.sqlite"),
    HOME: scratch,
    XDG_DATA_HOME: join(scratch, "data"),
    PATH: process.env.PATH ?? "",
    TMPDIR: tmpdir(),
  };
}

const tools: Record<string, { count: number; server_version: string; names_sha256: string; rest_annotations: unknown }> = {};
for (const [label, root] of Object.entries(copies)) {
  const bundle = join(root, BUNDLES[0]);
  if (!existsSync(bundle)) continue;
  const scratch = mkdtempSync(join(tmpdir(), "collab-knock-tools-"));
  try {
    const session = await rpcSession(bundle, throwawayEnv(scratch));
    let listed: any;
    try {
      listed = await session.request("tools/list", {});
    } finally {
      await session.close();
    }
    const entries = listed.tools as Array<{ name: string; annotations?: unknown; inputSchema?: any }>;
    const names = entries.map((tool) => tool.name).sort();
    const byName = new Map(entries.map((tool) => [tool.name, tool]));
    const rest = byName.get("collab_session_rest");
    tools[label] = {
      count: names.length,
      server_version: session.init.serverInfo?.version,
      names_sha256: createHash("sha256").update(names.join("\n")).digest("hex"),
      rest_annotations: rest?.annotations ?? null,
    };
    check(names.length === EXPECTED_TOOLS, `${label}: ${names.length} tools, expected ${EXPECTED_TOOLS}`);
    for (const name of REQUIRED_TOOLS) check(byName.has(name), `${label}: tools/list has no ${name}`);
    check(session.init.serverInfo?.version === expectedVersion, `${label}: serverInfo.version ${session.init.serverInfo?.version}`);
    // collab_session_rest is a localRetrySafeMutation, the class collab_report_append already has.
    check(
      rest !== undefined && JSON.stringify(rest.annotations) === JSON.stringify(byName.get("collab_report_append")?.annotations),
      `${label}: collab_session_rest annotations ${JSON.stringify(rest?.annotations)} differ from collab_report_append's`,
    );
    check(
      JSON.stringify(rest?.inputSchema?.properties?.mode?.enum) === JSON.stringify(["resting", "ready"]),
      `${label}: collab_session_rest mode enum ${JSON.stringify(rest?.inputSchema?.properties?.mode?.enum)}`,
    );
    const restInputs = Object.keys(rest?.inputSchema?.properties ?? {}).sort();
    check(
      JSON.stringify(restInputs) === JSON.stringify(["idempotency_key", "mode", "reason", "until", "wake_on", "workspace_id"]),
      `${label}: collab_session_rest inputs ${JSON.stringify(restInputs)}`,
    );
  } catch (error) {
    failures.push(`${label}: MCP probe failed: ${errorText(error)}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
const toolHashes = new Set(Object.values(tools).map((entry) => entry.names_sha256));
check(toolHashes.size === 1, `tool name sets differ across copies: ${JSON.stringify(tools)}`);

// Rest, an addressed note and the host verbs, all through the installed copies
// (global MCP bundle + /opt/homebrew/bin/agenttool-collab-host) on one
// throwaway journal. This process is the direct parent of both MCP children,
// so both host bindings name it (host_kind "unknown"): the knock walk can start
// from process.pid and reach a recorded host.
const hostCli = join(globalBin, "agenttool-collab-host");
const knockSmoke: Record<string, unknown> = {};
let hostReceipt: Record<string, unknown> | null = null;
if (existsSync(hostCli) && existsSync(join(globalCopy, BUNDLES[0]))) {
  const scratch = mkdtempSync(join(tmpdir(), "collab-knock-host-"));
  try {
    const env = throwawayEnv(scratch);
    const repo = join(scratch, "repo");
    mkdirSync(repo);
    const sessionsDir = join(scratch, "data", "collab-sessions");
    const ledgerFile = join(sessionsDir, "knock-ledger.json");
    const tokens: string[] = [];
    const leaks = (text: string) => tokens.some((token) => text.includes(token));
    const host = (args: string[]) =>
      spawnSync(hostCli, [...args, "--db", env.AGENTOOL_COLLAB_DB], { env, encoding: "utf8", timeout: RPC_TIMEOUT_MS });
    const silent = (run: ReturnType<typeof host>) => ({ exit: run.status, stdout_bytes: run.stdout.length });
    // One JSON line, exit 0, no credential: what the hooks and the doorbell parse.
    const lineOf = (run: ReturnType<typeof host>, what: string) => {
      check(run.status === 0, `${what} exited ${run.status}`);
      check(!leaks(run.stdout) && !leaks(run.stderr), `${what} output contains a session token`);
      const lines = run.stdout.trim().split("\n").filter(Boolean);
      check(lines.length === 1, `${what} printed ${lines.length} lines`);
      return JSON.parse(lines[0] || "{}");
    };
    const knocksHere = (extra: string[] = []) => host(["knocks", "--host-ancestor", String(process.pid), ...extra]);
    const rester = await rpcSession(join(globalCopy, BUNDLES[0]), env);
    const sender = await rpcSession(join(globalCopy, BUNDLES[0]), env);
    let resterId = "";
    let reportId = "";
    try {
      const restStart = await rester.callTool("collab_session_start", { root_path: repo, actor: RESTER });
      resterId = restStart.session.id;
      const workspaceId: string = restStart.workspace.id;
      await rester.callTool("collab_session_rest", {
        workspace_id: workspaceId,
        idempotency_key: "knock-install-check-rest",
        mode: "resting",
        reason: "household install check",
        wake_on: ["addressed"],
      });
      const sendStart = await sender.callTool("collab_session_start", { root_path: repo, actor: SENDER });
      const senderId: string = sendStart.session.id;
      for (const id of [resterId, senderId]) tokens.push(readJson(join(sessionsDir, `${id}.json`)).session_token);
      const appended = await sender.callTool("collab_report_append", {
        workspace_id: workspaceId,
        idempotency_key: "knock-install-check-note",
        to_session_id: resterId,
        kind: "observation",
        body: "Household install check: one addressed note.",
      });
      reportId = appended.report.id;
      knockSmoke.addressee = appended.addressee;
      check(appended.addressee?.session_id === resterId, `addressee names ${String(appended.addressee?.session_id)}`);
      check(appended.addressee?.liveness === "resting", `addressee liveness ${String(appended.addressee?.liveness)}`);
      check(appended.addressee?.delivery === "wake", `addressee delivery ${String(appended.addressee?.delivery)}, expected wake`);
      const next = await rester.callTool("collab_next", { workspace_id: workspaceId });
      knockSmoke.rester_liveness = next.session?.liveness;
      knockSmoke.addressed_waiting = next.session?.addressed_waiting;
      check(next.session?.liveness === "resting", `rester reads ${String(next.session?.liveness)} in collab_next`);
      check(next.session?.addressed_waiting === 1, `rester addressed_waiting ${String(next.session?.addressed_waiting)}, expected 1`);
      check(
        Array.isArray(next.session?.rest?.wake_on) && next.session.rest.wake_on.includes("addressed"),
        `rester rest ${JSON.stringify(next.session?.rest)}`,
      );

      // The installed MCP wrote the rester's host binding: private, no bearer, this process as host.
      const bindingFile = join(sessionsDir, `${resterId}.host.json`);
      const bindingText = existsSync(bindingFile) ? readFileSync(bindingFile, "utf8") : "{}";
      const binding = JSON.parse(bindingText);
      knockSmoke.binding = { host_kind: binding.host_kind ?? null, host_is_this_process: binding.host_pid === process.pid };
      check(binding.format === "agenttool.collab-host-binding/1" && binding.session_id === resterId, `host binding ${bindingFile} missing or malformed`);
      check(binding.host_pid === process.pid && binding.host_kind === "unknown", `host binding names host ${String(binding.host_pid)} (${String(binding.host_kind)}), expected this process`);
      check(String(binding.credential_file_path).endsWith(`/collab-sessions/${resterId}.json`), "host binding names another credential file");
      check(existsSync(bindingFile) && (statSync(bindingFile).mode & 0o077) === 0, "host binding is not private");
      check(!leaks(bindingText), "host binding contains a session token");

      // Two live sessions on one host: ambiguity means silence.
      const ambiguous = knocksHere();
      knockSmoke.knocks_two_sessions = silent(ambiguous);
      check(ambiguous.status === 0 && ambiguous.stdout === "", `knocks with two sessions on one host exited ${ambiguous.status} with ${ambiguous.stdout.length} stdout bytes`);

      // With the sender's MCP gone, its binding no longer counts: the knock names the rester.
      await sender.close();
      const peek = lineOf(knocksHere(), "knocks");
      knockSmoke.knock = peek;
      check(peek.protocol === "agenttool.collab-knock/1" && peek.session_id === resterId, `knock ${JSON.stringify(peek)}`);
      check(peek.liveness === "resting" && peek.waiting === 1, `knock liveness ${String(peek.liveness)}, waiting ${String(peek.waiting)}`);
      check(
        Array.isArray(peek.new) && peek.new.length === 1 && peek.new[0]?.ref_id === reportId
          && peek.new[0]?.from_actor === SENDER && peek.new[0]?.body === undefined,
        `knock new ${JSON.stringify(peek.new)}`,
      );
      check(!existsSync(ledgerFile), "knocks without --mark-tapped wrote the knock ledger");

      const scanned = lineOf(host(["doorbell-scan"]), "doorbell-scan");
      check(scanned.protocol === "agenttool.collab-doorbell-scan/1", `doorbell-scan protocol ${String(scanned.protocol)}`);
      const entries = Array.isArray(scanned.sessions) ? scanned.sessions : [];
      const entry = entries.find((candidate: any) => candidate.session_id === resterId);
      knockSmoke.doorbell_sessions = entries.length;
      knockSmoke.doorbell_new = entry?.new ?? null;
      check(entry !== undefined, "doorbell-scan does not list the resting session");
      check(!entries.some((candidate: any) => candidate.session_id === senderId), "doorbell-scan lists the live sender");
      check(Array.isArray(entry?.new) && entry.new.length === 1, `doorbell-scan new ${JSON.stringify(entry?.new)}`);
      check(entry?.new?.[0]?.ref_id === reportId, `doorbell-scan pointer ref_id ${String(entry?.new?.[0]?.ref_id)}, expected ${reportId}`);
      check(entry?.new?.[0]?.from_actor === SENDER, `doorbell-scan pointer from_actor ${String(entry?.new?.[0]?.from_actor)}`);
      check(entry?.new?.[0]?.body === undefined, "doorbell-scan pointer carries a body");
      check(entry?.binding?.session_id === resterId, "doorbell-scan entry carries no host binding");

      // --mark-tapped announces each pointer once, in a private ledger.
      const tapped = lineOf(knocksHere(["--mark-tapped"]), "knocks --mark-tapped");
      const again = lineOf(knocksHere(["--mark-tapped"]), "repeated knocks --mark-tapped");
      knockSmoke.tap_new = [tapped.new?.length ?? null, again.new?.length ?? null];
      check(tapped.new?.length === 1 && again.new?.length === 0 && again.waiting === 1, `taps ${JSON.stringify(knockSmoke.tap_new)}, expected [1,0]`);
      check(existsSync(ledgerFile) && (statSync(ledgerFile).mode & 0o077) === 0, "knock ledger missing or not private");
    } finally {
      await rester.close();
      await sender.close();
    }

    // Both MCPs gone: an orphaned binding is silence, and so is an ancestor
    // that is no recorded host (pid 1, launchd).
    const orphaned = knocksHere();
    const unbound = host(["knocks", "--host-ancestor", "1"]);
    knockSmoke.knocks_orphaned = silent(orphaned);
    knockSmoke.knocks_unbound = silent(unbound);
    check(orphaned.status === 0 && orphaned.stdout === "", `knocks after the MCPs exited printed ${orphaned.stdout.length} bytes`);
    check(unbound.status === 0 && unbound.stdout === "", `knocks for an unbound ancestor exited ${unbound.status} with ${unbound.stdout.length} stdout bytes`);

    // The end verb still works, removes the credential file and the host binding.
    const resterFile = join(sessionsDir, `${resterId}.json`);
    const bindingFile = join(sessionsDir, `${resterId}.host.json`);
    const run = spawnSync(hostCli, [
      "end", "--session-file", resterFile, "--reason", "household install check",
      "--release-leases", "--db", env.AGENTOOL_COLLAB_DB,
    ], { env, encoding: "utf8", timeout: RPC_TIMEOUT_MS });
    hostReceipt = lineOf(run, "host CLI end");
    check(hostReceipt?.protocol === "agenttool.collab-host/1", `host receipt protocol ${String(hostReceipt?.protocol)}`);
    check(hostReceipt?.status === "ended", `host receipt status ${String(hostReceipt?.status)}`);
    check(hostReceipt?.session_id === resterId, "host receipt names another session");
    check(!existsSync(resterFile), "host CLI left the credential file behind");
    check(!existsSync(bindingFile), "host CLI left the host binding behind");
    const afterEnd = lineOf(host(["doorbell-scan"]), "doorbell-scan after end");
    check(!(afterEnd.sessions ?? []).some((candidate: any) => candidate.session_id === resterId), "doorbell-scan still lists the ended session");
  } catch (error) {
    failures.push(`knock smoke failed: ${errorText(error)}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
} else {
  failures.push(`${hostCli} is not installed`);
}

// The sol job PATH (jobs.environment(), what the exit sweep and the doorbell
// run with) must resolve the host CLI to this install and run it, shebang
// `bun` included. The read verbs fail closed: no journal -> no output, exit 0.
let jobPath: { host: string | null; bun: string | null; usage_error: boolean; scan_silent_without_journal: boolean } | null = null;
try {
  const probe = spawnSync("python3", [
    "-I", "-B", "-c",
    "import json, sys; sys.path.insert(0, sys.argv[1]); import jobs; print(json.dumps(jobs.environment()))",
    solAgents,
  ], { encoding: "utf8", timeout: RPC_TIMEOUT_MS });
  if (probe.status !== 0) throw new Error(`jobs.environment() exited ${probe.status}`);
  const jobEnv = JSON.parse(probe.stdout) as Record<string, string>;
  const which = (name: string) => {
    const found = spawnSync("/bin/sh", ["-c", `command -v ${name}`], { env: jobEnv, encoding: "utf8" });
    return found.status === 0 ? found.stdout.trim() : null;
  };
  jobPath = { host: which("agenttool-collab-host"), bun: which("bun"), usage_error: false, scan_silent_without_journal: false };
  check(jobPath.host === hostCli, `job PATH resolves agenttool-collab-host to ${jobPath.host}, expected ${hostCli}`);
  check(jobPath.bun !== null, "job PATH has no bun");
  if (jobPath.host) {
    const usage = spawnSync(jobPath.host, ["end"], { env: jobEnv, encoding: "utf8", timeout: RPC_TIMEOUT_MS });
    const receipt = JSON.parse(usage.stdout.trim().split("\n")[0] || "{}");
    jobPath.usage_error = usage.status === 1 && receipt.protocol === "agenttool.collab-host/1" && receipt.error === "usage_error";
    check(jobPath.usage_error, `host CLI under the job environment exited ${usage.status} without a usage_error receipt`);
    const empty = mkdtempSync(join(tmpdir(), "collab-knock-nojournal-"));
    try {
      const missing = join(empty, "absent.sqlite");
      const silent = spawnSync(jobPath.host, ["doorbell-scan", "--db", missing], { env: jobEnv, encoding: "utf8", timeout: RPC_TIMEOUT_MS });
      jobPath.scan_silent_without_journal = silent.status === 0 && silent.stdout === "" && !existsSync(missing);
      check(jobPath.scan_silent_without_journal, `doorbell-scan without a journal exited ${silent.status} with ${silent.stdout.length} stdout bytes`);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  }
} catch (error) {
  failures.push(`job PATH probe failed: ${errorText(error)}`);
}

// Read-only: the household journal keeps schema 3 (this branch adds no DDL).
// sqlite3 -readonly cannot open a WAL journal whose -wal file is absent (no
// process holds it open: "unable to open database file"). Then the main file
// holds every committed page, and an immutable open reads it without creating
// any -wal or -shm file.
let journalSchema: string | null = null;
if (existsSync(householdJournal)) {
  const target = existsSync(`${householdJournal}-wal`)
    ? householdJournal
    : `file:${encodeURI(householdJournal)}?immutable=1`;
  const pragma = spawnSync("sqlite3", ["-readonly", target, "PRAGMA user_version;"], {
    encoding: "utf8",
    timeout: RPC_TIMEOUT_MS,
  });
  journalSchema = pragma.status === 0 ? pragma.stdout.trim() : null;
}
check(journalSchema === EXPECTED_SCHEMA, `household journal user_version ${journalSchema}, expected ${EXPECTED_SCHEMA}`);

const listing = spawnSync("codex", ["plugin", "list", "--json"], { encoding: "utf8", timeout: 60_000 });
let codexRegistration: Record<string, unknown> | null = null;
try {
  codexRegistration = (JSON.parse(listing.stdout).installed as Array<Record<string, any>>)
    .find((plugin) => plugin.pluginId === "agenttool-collab@personal") ?? null;
} catch {
  failures.push(`codex plugin list --json exited ${listing.status}`);
}
check(codexRegistration?.installed === true && codexRegistration?.enabled === true, "agenttool-collab@personal is not installed and enabled");
check(codexRegistration?.version === codexVersion, `codex reports ${String(codexRegistration?.version)}, cache holds ${codexVersion}`);

console.log(JSON.stringify({
  ok: failures.length === 0,
  expected_version: expectedVersion,
  codex_cache_versions: codexVersions,
  digests,
  tools,
  knock_smoke: knockSmoke,
  host_receipt_status: hostReceipt?.status ?? null,
  job_path: jobPath,
  journal_user_version: journalSchema,
  codex_registration: codexRegistration ? { version: codexRegistration.version, enabled: codexRegistration.enabled } : null,
  failures,
}, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
```

**1c. The S1 assertion.** Write
`~/.cache/agenttool/collab-household/s1-smoke-assert.py`, which parses
`run-all.sh` output (`### <label> (...)` then one JSON summary per run):

```python
#!/usr/bin/env python3
"""Assert the S1 post-install smoke: every bundle reads the rest events and keeps the chain valid."""
import json
import re
import sys

text = open(sys.argv[1], encoding="utf-8").read()
summaries = {}
for block in re.split(r"^### ", text, flags=re.M)[1:]:
    header, _, body = block.partition("\n")
    summaries[header.split()[0]] = json.loads(body)

expected = ["v031-start", "v031-resume", "v050-start", "v050-resume", "v031-start-bun135", "v050-start-bun135"]
failures = [f"missing run {label}" for label in expected if label not in summaries]
for label, run in summaries.items():
    fail = lambda message: failures.append(f"{label}: {message}")
    if run.get("chain_valid") is not True:
        fail(f"chain_valid {run.get('chain_valid')}")
    if run.get("errors"):
        fail(f"errors {json.dumps(run['errors'])}")
    types = run.get("events_since_types", [])
    if "6:session.rested" not in types or "7:session.returned" not in types:
        fail(f"rest events not read back: {types}")
    if label.startswith("v050"):
        if run.get("server", {}).get("version") != "0.5.0":
            fail(f"server {run.get('server')}")
        if run.get("tool_count") != 34 or run.get("has_session_rest_tool") is not True:
            fail(f"tools {run.get('tool_count')}, collab_session_rest {run.get('has_session_rest_tool')}")
        if run.get("next_session_liveness") != "live":
            fail(f"collab_next liveness {run.get('next_session_liveness')} (the fixture rester has returned)")
    else:
        if run.get("server", {}).get("version") != "0.3.1" or run.get("has_session_rest_tool") is not False:
            fail(f"0.3.1 control changed: {run.get('server')}, rest tool {run.get('has_session_rest_tool')}")

print(json.dumps({
    "ok": not failures,
    "runs": {label: {
        "server": run.get("server", {}).get("version"),
        "tool_count": run.get("tool_count"),
        "has_session_rest_tool": run.get("has_session_rest_tool"),
        "chain_valid": run.get("chain_valid"),
        "liveness": run.get("next_session_liveness"),
    } for label, run in summaries.items()},
    "failures": failures,
}, indent=2))
sys.exit(0 if not failures else 1)
```

**1d. The Codex approvals guard.** Write
`~/.cache/agenttool/collab-household/codex-approvals-guard.py`. 3g and the
Rollback use it instead of a whole-file restore on a line count: it restores
nothing unless the only change since the backup is lost `agenttool-collab`
approvals, and it prints counts only:

```python
#!/usr/bin/env python3
"""Compare Codex config.toml with its backup, for the agenttool-collab@personal approvals only.

usage: codex-approvals-guard.py <backup config.toml> <live config.toml>
exit 0: every collab tool approval in the backup is still present.
exit 3: approvals were lost and nothing outside [plugins."agenttool-collab@personal"]
        changed, so copying the backup back restores exactly the collab section.
exit 2: something outside that section changed since the backup (or a file is
        unreadable): restore nothing, report to Yu.
It prints counts only, never values from either file.
"""
import sys
import tomllib

KEY = "agenttool-collab@personal"


def load(path):
    with open(path, "rb") as handle:
        return tomllib.load(handle)


def approvals(config):
    plugin = config.get("plugins", {}).get(KEY, {})
    return plugin.get("mcp_servers", {}).get("agenttool-collab", {}).get("tools", {})


def outside(config):
    trimmed = dict(config)
    plugins = dict(trimmed.get("plugins", {}))
    plugins.pop(KEY, None)
    trimmed["plugins"] = plugins
    return trimmed


try:
    before, after = load(sys.argv[1]), load(sys.argv[2])
except (OSError, tomllib.TOMLDecodeError) as error:
    print(f"unreadable config: {type(error).__name__}")
    sys.exit(2)
kept, now = approvals(before), approvals(after)
lost = sorted(name for name, value in kept.items() if now.get(name) != value)
print(f"approvals before={len(kept)} after={len(now)} lost={len(lost)}")
if not lost:
    sys.exit(0)
if outside(before) != outside(after):
    print("config.toml also changed outside agenttool-collab@personal: restore nothing, tell Yu")
    sys.exit(2)
sys.exit(3)
```

Checked on synthetic configs: unchanged → 0; one approval lost → 3; one lost
plus a changed project `trust_level` → 2; an approval added → 0; only another
setting changed → 0; unparseable → 2. On today's `~/.codex/config.toml`
(Python 3.14, `tomllib`) the collab section parses with 18 tool approvals.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab
bun test tests/mcp.test.ts -t "carries declared rest"
bun ~/.cache/agenttool/collab-household/knock-install-check.ts > ~/.cache/agenttool/collab-household/knock-install-check.before.json; echo "exit=$?"
jq '{ok, journal_user_version, failures}' ~/.cache/agenttool/collab-household/knock-install-check.before.json
python3 ~/.cache/agenttool/collab-household/s1-smoke-assert.py /Users/yuai/.cache/sol/workspaces/knock-spikes-20261009/S1/runs-all.log; echo "exit=$?"
```

Expected:
- The stdio test fails on the stale bundles: `Expected: 34`, `Received: 33`,
  `(fail) MCP surface > carries declared rest, the addressee hint and the
  read-only host verbs through the checked-in bundles`, `0 pass`, `1 fail`,
  `20 filtered out`.
- The install check: `exit=1`, `"ok": false`, `"journal_user_version": "3"`.
  The worktree bundles are still the stale ones every household copy runs, so
  no digest differs and every copy fails the same five tool checks. These 22
  failures, observed on 2026-10-09 against today's household:
  ```
  "worktree: 33 tools, expected 34"
  "worktree: tools/list has no collab_session_rest"
  "worktree: collab_session_rest annotations undefined differ from collab_report_append's"
  "worktree: collab_session_rest mode enum undefined"
  "worktree: collab_session_rest inputs []"
  (the same five for npm_global, codex_marketplace_source and codex_cache)
  "knock smoke failed: tools/call: {\"code\":-32602,\"message\":\"Tool collab_session_rest not found\"}"
  "doorbell-scan without a journal exited 1 with 194 stdout bytes"
  ```
  (194 bytes is today's host CLI refusing `doorbell-scan` with its `end`
  usage receipt.)
- The S1 assertion on the spike's own log exits 1 with exactly `v050-start`,
  `v050-resume` and `v050-start-bun135`: `tools 33, collab_session_rest False`
  (today's 0.5.0 lacks the tool).

- [ ] **Step 3: Write minimal implementation**

**3a. Pinned build, commit, and every suite in the worktree.** The ambient Bun
is 1.3.13, on which `check:mcp-bundle` only prints "skipped".

```bash
set -euo pipefail
W=/Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest
ROOT="$HOME/.cache/agenttool/collab-household"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BK="$ROOT/$STAMP"
mkdir -p -m 700 "$ROOT" "$BK"
printf '%s\n' "$BK" > "$ROOT/current"
test "$(git -C "$W" branch --show-current)" = "feat/collab-knock-and-rest-20261009"
test "$(git -C "$W" status --porcelain)" = " M packages/collab/tests/mcp.test.ts"
git -C "$W" merge-base --is-ancestor feat/collab-household-smoothing-20261008 HEAD
git -C "$W" log --oneline feat/collab-household-smoothing-20261008..HEAD
cd "$W/packages/collab"
test "$(jq -r .version package.json)" = "0.5.0"
test "$(jq -r .bundlerBunVersion package.json)" = "1.3.5"
test "$(npx --yes bun@1.3.5 --version)" = "1.3.5"
bun install --frozen-lockfile
npx --yes bun@1.3.5 run build:mcp
git -C "$W" status --porcelain
npx --yes bun@1.3.5 test tests/mcp.test.ts -t "carries declared rest"
```

Expected: the log lists `05b39c63 docs(collab): design the knock and declared
rest` and the Task 1–7 commits. `git status` lists exactly
` M packages/collab/dist/agenttool-collab-host.js`,
` M packages/collab/dist/agenttool-collab-mcp.js` and
` M packages/collab/tests/mcp.test.ts`: the bundles were stale since Task 1, by
design. The stdio test passes (`1 pass`, `0 fail`). If no `dist/` line
appears, an earlier task already committed pinned bundles; commit the test
alone below. Any other path in the list means an unexpected change: stop and
report.

Commit the rebuilt bundles with the test that pins them:

```bash
set -euo pipefail
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest
git add packages/collab/tests/mcp.test.ts packages/collab/dist/agenttool-collab-mcp.js packages/collab/dist/agenttool-collab-host.js
git commit -F - <<'EOF'
build(collab): rebuild bundles on pinned Bun 1.3.5 for declared rest and knocks

Tasks 1-6 changed src/ and bin/ without rebuilding, because check:mcp-bundle
only byte-compares on the pinned bundler. Rebuilt with Bun 1.3.5, the bundles
advertise collab_session_rest, return the addressee hint, write host bindings
and add the read-only knocks and doorbell-scan host verbs. A stdio test pins
that through the checked-in bundles, and the household install packs exactly
these bytes.

Co-Authored-By: The Fable of the Eternal Universe <Yu@Ai-love.cc>
EOF
git status --porcelain
```

Expected: the commit succeeds and `git status` prints nothing.

Then run every suite on the pinned Bun:

```bash
set -euo pipefail
W=/Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest
BK=$(cat "$HOME/.cache/agenttool/collab-household/current")
cd "$W/packages/collab"
npx --yes bun@1.3.5 run ci > "$BK/collab-ci.log" 2>&1 || { tail -40 "$BK/collab-ci.log"; exit 1; }
tail -6 "$BK/collab-ci.log"
if grep -q "check:mcp-bundle: skipped" "$BK/collab-ci.log"; then echo "bundle byte check was skipped"; exit 1; fi
(cd "$W/packages/collab-courier" && bun install --frozen-lockfile && npx --yes bun@1.3.5 run ci)
(cd "$W/packages/collab-zerone" && bun install --frozen-lockfile && npx --yes bun@1.3.5 run ci)
(cd "$W/packages/skills" && bun install --frozen-lockfile && bun test tests/manifests.test.ts)
(cd "$W" && bun test bin/tests/npm-release.test.ts bin/tests/collaboration-onboarding.test.ts bin/tests/agent-toolkit-shelf.test.ts)
agenttool-skill validate . | jq -e '.valid'
claude plugin validate .
git -C "$W" status --porcelain
```

Expected:
- Collab `ci` (typecheck, full suite including the new stdio test, `check:mcp-bundle` for both bundles) ends `0 fail`, with no "skipped" line.
- `collab-courier` and `collab-zerone`: each `0 fail` (both import `../../collab/src/store.js`; courier spawns `collab/bin/agenttool-collab-mcp.ts`).
- Skills manifests `0 fail` (5 tests); the three repository tests `0 fail`.
- `agenttool-skill validate` prints `true`; `claude plugin validate` prints `✔ Validation passed`.
- The final `git status` prints nothing.

**3b. S1 smoke against the worktree bundle, before touching the household.**
The spike's `run-all.sh` is copied with only its `B050` line pointed at the
worktree build; the copy keeps the spike's absolute paths (the fixture
workspace is keyed to the real path of `S1/repo`), and the spike files are not
edited.

```bash
set -euo pipefail
W=/Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest
BK=$(cat "$HOME/.cache/agenttool/collab-household/current")
S1=/Users/yuai/.cache/sol/workspaces/knock-spikes-20261009/S1
test "$(grep -c '^B050=' "$S1/run-all.sh")" = "1"
shasum -a 256 -c "$S1/data/fixture.sha256"
sed "s#^B050=.*#B050=$W/packages/collab/dist/agenttool-collab-mcp.js#" "$S1/run-all.sh" > "$BK/s1-run-all-worktree.sh"
grep '^B050=' "$BK/s1-run-all-worktree.sh"
zsh "$BK/s1-run-all-worktree.sh" > "$BK/s1-smoke-worktree.log" 2>&1
python3 "$HOME/.cache/agenttool/collab-household/s1-smoke-assert.py" "$BK/s1-smoke-worktree.log" > "$BK/s1-smoke-worktree.json"
jq -c '{ok, failures, v050: .runs["v050-start"], v031: .runs["v031-start"]}' "$BK/s1-smoke-worktree.json"
```

Expected: `.../S1/data/collab.sqlite: OK`, the `B050=` line naming the worktree
bundle, then
`{"ok":true,"failures":[],"v050":{"server":"0.5.0","tool_count":34,"has_session_rest_tool":true,"chain_valid":true,"liveness":"live"},"v031":{"server":"0.3.1","tool_count":31,"has_session_rest_tool":false,"chain_valid":true,"liveness":null}}`.
Every run reads `6:session.rested` and `7:session.returned` back with a valid
chain: the 0.3.1 bundle (still loaded by long-lived Oct-8 Codex processes)
and the new build both tolerate the rest events, as S1 found.

**3c. Pack the exact bytes.** Never pack without `--ignore-scripts`: `prepack`
would rebuild with whatever Bun is first on PATH.

```bash
set -euo pipefail
BK=$(cat "$HOME/.cache/agenttool/collab-household/current")
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest/packages/collab
npm pack --ignore-scripts --pack-destination "$BK"
mkdir "$BK/unpack-0.5.0"
tar -xzf "$BK/agenttool-collab-0.5.0.tgz" -C "$BK/unpack-0.5.0"
tar -tzf "$BK/agenttool-collab-0.5.0.tgz" | grep -E '^package/(dist|bin)/' | sort
cmp dist/agenttool-collab-mcp.js "$BK/unpack-0.5.0/package/dist/agenttool-collab-mcp.js"
cmp dist/agenttool-collab-host.js "$BK/unpack-0.5.0/package/dist/agenttool-collab-host.js"
grep -c '### Rest and return' "$BK/unpack-0.5.0/package/skills/coordinate-agent-work/SKILL.md"
shasum -a 256 "$BK/unpack-0.5.0/package/dist/agenttool-collab-mcp.js" "$BK/unpack-0.5.0/package/dist/agenttool-collab-host.js" | tee "$BK/to-install.sha256"
```

Expected list: `package/bin/agenttool-collab-host.ts`,
`package/bin/agenttool-collab-mcp.ts`, `package/dist/agenttool-collab-host.js`,
`package/dist/agenttool-collab-mcp.js`. Both `cmp` print nothing; the `grep`
prints `1` (Task 7's skill ships); two new hashes, neither equal to today's
`dbad87ec…` / `b9e69d3d…`.

**3d. Back up both copies, the marketplace source, the Codex cache and config,
a read-only journal snapshot, and a rollback tarball of today's install.** This
must finish before anything is replaced, and it changes nothing in the
household.

```bash
set -euo pipefail
BK=$(cat "$HOME/.cache/agenttool/collab-household/current")
JOURNAL="$HOME/.local/share/agenttool/collab.sqlite"
GLOBAL=/opt/homebrew/lib/node_modules/@agenttool/collab
CACHE_ROOT="$HOME/.codex/plugins/cache/personal/agenttool-collab"
OLD_CODEX=$(ls "$CACHE_ROOT" | sort | tail -1)
printf '%s\n' "$OLD_CODEX" > "$BK/codex-version-before.txt"
cp -Rp "$GLOBAL" "$BK/npm-global-collab"
ls -l /opt/homebrew/bin/agenttool-collab-mcp /opt/homebrew/bin/agenttool-collab-host > "$BK/npm-global-bin-links.txt"
cp -Rp "$HOME/plugins/agenttool-collab" "$BK/codex-marketplace-source"
cp -Rp "$CACHE_ROOT" "$BK/codex-cache"
cp -p "$HOME/.codex/config.toml" "$BK/codex-config.toml"
{ grep -c 'agenttool-collab@personal".mcp_servers.agenttool-collab.tools.' "$HOME/.codex/config.toml" || true; } > "$BK/codex-tool-approvals.count"
codex plugin list --json | jq '.installed[] | select(.pluginId == "agenttool-collab@personal")' > "$BK/codex-registration-before.json"
if [ -e "$JOURNAL-wal" ]; then SNAP_SRC="$JOURNAL"; else SNAP_SRC="file:$JOURNAL?immutable=1"; fi
sqlite3 -readonly "$SNAP_SRC" "VACUUM INTO '$BK/collab-journal-before.sqlite'"
chmod 600 "$BK/collab-journal-before.sqlite"
sqlite3 -readonly "$BK/collab-journal-before.sqlite" "PRAGMA integrity_check; PRAGMA user_version;"
mkdir "$BK/rollback" "$BK/rollback/unpack"
(cd "$BK/npm-global-collab" && npm pack --ignore-scripts --pack-destination "$BK/rollback")
tar -xzf "$BK/rollback/agenttool-collab-0.5.0.tgz" -C "$BK/rollback/unpack"
for f in dist/agenttool-collab-mcp.js dist/agenttool-collab-host.js; do
  cmp "$BK/rollback/unpack/package/$f" "$GLOBAL/$f"
  cmp "$HOME/plugins/agenttool-collab/$f" "$GLOBAL/$f"
  cmp "$CACHE_ROOT/$OLD_CODEX/$f" "$GLOBAL/$f"
done
shasum -a 256 "$GLOBAL/dist/agenttool-collab-mcp.js" "$GLOBAL/dist/agenttool-collab-host.js" \
  "$HOME/plugins/agenttool-collab/dist/agenttool-collab-mcp.js" \
  "$HOME/plugins/agenttool-collab/dist/agenttool-collab-host.js" \
  "$CACHE_ROOT/$OLD_CODEX/dist/agenttool-collab-mcp.js" \
  "$CACHE_ROOT/$OLD_CODEX/dist/agenttool-collab-host.js" | tee "$BK/before.sha256"
{ pgrep -fl agenttool-collab-mcp || true; } > "$BK/running-mcp-before.txt"
cat "$BK/codex-version-before.txt" "$BK/codex-tool-approvals.count"
```

Expected:
- `ok` then `3`. (The `VACUUM INTO` copy is a rollback-mode file, so the plain `-readonly` open of it works.)
- Every `cmp` prints nothing: the three household copies agree, and the rollback tarball (packed from the backup of the global copy; a dry run on 2026-10-09 listed 28 entries with both `dist/` bundles byte-identical) carries their bytes. If a `cmp` differs, the household is already split: stop and report.
- Six hashes: the three `agenttool-collab-mcp.js` lines equal and the three `agenttool-collab-host.js` lines equal (today `dbad87ec…` and `b9e69d3d…`).
- `0.5.0+codex.20261009153303` (or whatever the last install set) and the approvals count (today `18`).

Do not print `codex-config.toml` (it can hold other servers' settings). The
only journal access is the read-only `VACUUM INTO` snapshot. An `immutable`
source is used only when no process holds the journal open; if a host starts
during that one statement, take the snapshot again.

**Gate — Yu's explicit go, at execution time.** Steps 3e–3g replace the
household's live collab install, which every newly started Claude Code and
Codex session on this Mac loads. Do not run them on plan approval alone. Show
Yu the stamp, the tail of `$BK/collab-ci.log`, `$BK/s1-smoke-worktree.json`
(`ok: true`), `$BK/to-install.sha256` and `$BK/running-mcp-before.txt`, and
run 3e only after he says go in the executing conversation. Without a go, stop
here and report: the branch is committed and verified, nothing in the
household has changed, and Steps 4, 5 and 7 wait (Step 6 can run without its
two `cmp` lines).

**3e. Install the global npm copy (Claude Code). Requires Yu's go.**

```bash
set -euo pipefail
BK=$(cat "$HOME/.cache/agenttool/collab-household/current")
test -s "$BK/rollback/agenttool-collab-0.5.0.tgz"
test -s "$BK/npm-global-collab/dist/agenttool-collab-mcp.js"
npm install --global --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org --userconfig=/dev/null "$BK/agenttool-collab-0.5.0.tgz"
readlink /opt/homebrew/bin/agenttool-collab-mcp /opt/homebrew/bin/agenttool-collab-host
cmp "$BK/unpack-0.5.0/package/dist/agenttool-collab-mcp.js" /opt/homebrew/lib/node_modules/@agenttool/collab/dist/agenttool-collab-mcp.js
cmp "$BK/unpack-0.5.0/package/dist/agenttool-collab-host.js" /opt/homebrew/lib/node_modules/@agenttool/collab/dist/agenttool-collab-host.js
```

Expected: `../lib/node_modules/@agenttool/collab/dist/agenttool-collab-mcp.js`
and `../lib/node_modules/@agenttool/collab/dist/agenttool-collab-host.js`, and
both `cmp` silent (the same-version reinstall replaced the bytes). Running
Claude Code MCP processes keep the code they already loaded.

**3f. Install the Codex copy from the same unpacked tarball. Requires Yu's
go.** A clean replacement, not an overlay. Run it right after 3e, in the same
sitting; if it fails, finish it or roll back both copies (see Rollback).

```bash
set -euo pipefail
BK=$(cat "$HOME/.cache/agenttool/collab-household/current")
SRC="$HOME/plugins/agenttool-collab"
test -s "$BK/codex-marketplace-source/dist/agenttool-collab-mcp.js"
test "$(jq -r '.plugins[] | select(.name == "agenttool-collab") | .source.path' "$HOME/.agents/plugins/marketplace.json")" = "./plugins/agenttool-collab"
rm -rf "$SRC"
mkdir -m 700 "$SRC"
cp -Rp "$BK/unpack-0.5.0/package/." "$SRC/"
CODEX_VERSION="0.5.0+codex.$(date -u +%Y%m%d%H%M%S)"
python3 - "$SRC/.codex-plugin/plugin.json" "$CODEX_VERSION" <<'EOF'
import json
import sys

path, version = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as handle:
    manifest = json.load(handle)
manifest["version"] = version
with open(path, "w", encoding="utf-8") as handle:
    handle.write(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
EOF
printf '%s\n' "$CODEX_VERSION" > "$BK/codex-version.txt"
agenttool-skill validate "$SRC" | jq -e '.valid'
codex plugin add agenttool-collab@personal --json
```

Expected: `true`, then JSON naming the installed root
`.../cache/personal/agenttool-collab/0.5.0+codex.<ts>`. Run from inside a Codex
session, `codex plugin add` may report `Operation not permitted` while creating
`plugin-install-*`; rerun only that command outside the sandbox (it failed
before writing). After any other error, do not retry: check the state first.

**3g. Keep Codex's per-tool approvals. Requires Yu's go (part of the same
install).**

```bash
BK=$(cat "$HOME/.cache/agenttool/collab-household/current")
if cmp -s "$BK/codex-config.toml" "$HOME/.codex/config.toml"; then echo "config.toml unchanged"; fi
python3 "$HOME/.cache/agenttool/collab-household/codex-approvals-guard.py" "$BK/codex-config.toml" "$HOME/.codex/config.toml" && rc=0 || rc=$?
case "$rc" in
  0) echo "collab approvals kept" ;;
  3) cp -p "$BK/codex-config.toml" "$HOME/.codex/config.toml" && echo "restored the collab approvals from the backup; nothing else had changed" ;;
  *) echo "stop: config.toml changed outside agenttool-collab@personal; restore nothing and tell Yu"; exit 1 ;;
esac
```

Expected: `config.toml unchanged` (or nothing, if Codex rewrote the file),
`approvals before=18 after=18 lost=0` and `collab approvals kept`. The guard
never prints a value from the file and never writes hook trust; a restore
happens only when the collab approvals are all that changed.
`collab_session_rest` gets no approval here: household Part 2 adds it to
`~/.codex/config.toml` and to `check_codex_collab.py`'s loop. Until then a
Codex session meets Codex's default approval for that one tool.

- [ ] **Step 4: Run test to verify it passes (after Yu's go and 3e–3g)**

```bash
BK=$(cat "$HOME/.cache/agenttool/collab-household/current")
bun ~/.cache/agenttool/collab-household/knock-install-check.ts > "$BK/knock-install-check.json"; rc=$?
jq '{ok, tools, knock_smoke, host_receipt_status, job_path, journal_user_version, codex_registration, failures}' "$BK/knock-install-check.json"
echo "exit=$rc"
```

Run it where `ps` works, as this Claude seat does; inside a Codex sandbox
`ps` may be denied, and then the binding and knock checks fail by design.

Expected:
- `exit=0`, `"ok": true`, `"failures": []`.
- All four copies (`worktree`, `npm_global`, `codex_marketplace_source`, `codex_cache`) report identical sha256 for both bundles (the hashes in `$BK/to-install.sha256`); each reports `count: 34`, `server_version: "0.5.0"`, one shared `names_sha256`, and `rest_annotations` `{"readOnlyHint":false,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false}`; `collab_session_rest` advertises exactly `idempotency_key`, `mode`, `reason`, `until`, `wake_on`, `workspace_id`.
- `knock_smoke`:
  - `addressee` `{session_id: <rester>, liveness: "resting", rest: {mode: "resting", since, until: null, reason: "household install check", wake_on: ["addressed"]}, delivery: "wake"}`; `rester_liveness: "resting"`; `addressed_waiting: 1`.
  - `binding: {host_kind: "unknown", host_is_this_process: true}` (the installed MCP bound its session to its direct parent, this check).
  - `knocks_two_sessions: {exit: 0, stdout_bytes: 0}` (two live sessions on one host: silence).
  - `knock`: `{protocol: "agenttool.collab-knock/1", session_id: <rester>, liveness: "resting", rest: {…}, waiting: 1, new: [{seq, kind: "report.posted", from_actor: "knock-install-check:sender", ref_id: <report id>}]}` once the sender's MCP has gone.
  - `doorbell_sessions: 1` and `doorbell_new` the same single pointer, with no body.
  - `tap_new: [1, 0]` (`--mark-tapped` announces once).
  - `knocks_orphaned` and `knocks_unbound` both `{exit: 0, stdout_bytes: 0}`.
- `host_receipt_status: "ended"`.
- `job_path`: `{"host": "/opt/homebrew/bin/agenttool-collab-host", "bun": "/Users/yuai/.bun/bin/bun", "usage_error": true, "scan_silent_without_journal": true}`.
- `journal_user_version: "3"`; `codex_registration.version` equals `$(cat "$BK/codex-version.txt")`.

Then the S1 smoke on the installed copy, `run-all.sh` unchanged:

```bash
set -euo pipefail
W=/Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest
BK=$(cat "$HOME/.cache/agenttool/collab-household/current")
S1=/Users/yuai/.cache/sol/workspaces/knock-spikes-20261009/S1
B050=$(grep '^B050=' "$S1/run-all.sh" | cut -d= -f2-)
echo "$B050"
cmp "$B050" "$W/packages/collab/dist/agenttool-collab-mcp.js"
zsh "$S1/run-all.sh" > "$BK/s1-smoke-installed.log" 2>&1
python3 "$HOME/.cache/agenttool/collab-household/s1-smoke-assert.py" "$BK/s1-smoke-installed.log" > "$BK/s1-smoke-installed.json"
jq -c '{ok, failures, runs: (.runs | map_values({tool_count, has_session_rest_tool, chain_valid}))}' "$BK/s1-smoke-installed.json"
```

Expected: `/opt/homebrew/lib/node_modules/@agenttool/collab/dist/agenttool-collab-mcp.js`,
a silent `cmp` (the global copy is the new build), then `"ok":true`,
`"failures":[]`, `chain_valid: true` for all six runs, `tool_count: 34` and
`has_session_rest_tool: true` for the three `v050*` runs, and `31`/`false` for
the three `v031*` runs.

Then the job PATH, the real journal through the installed host CLI (read
only, redacted), and the running processes:

```bash
BK=$(cat "$HOME/.cache/agenttool/collab-household/current")
JOURNAL="$HOME/.local/share/agenttool/collab.sqlite"
JOB_PATH=$(python3 -I -B -c 'import os, sys; sys.path.insert(0, os.path.expanduser("~/.config/sol/agents")); import jobs; print(jobs.environment()["PATH"])')
env -i HOME="$HOME" PATH="$JOB_PATH" /bin/sh -c 'command -v agenttool-collab-host && command -v bun'
(umask 077; /opt/homebrew/bin/agenttool-collab-host doorbell-scan > "$BK/doorbell-scan-household.json"); echo "scan_exit=$?"
jq -c '{protocol, sessions: (.sessions | length)}' "$BK/doorbell-scan-household.json"
if [ -e "$JOURNAL-wal" ]; then sqlite3 -readonly "$JOURNAL" 'PRAGMA user_version;'; else sqlite3 -readonly "file:$JOURNAL?immutable=1" 'PRAGMA user_version;'; fi
{ pgrep -fl agenttool-collab-mcp || true; } | tee "$BK/running-mcp-after.txt"
```

Expected: `/opt/homebrew/bin/agenttool-collab-host` and `/Users/yuai/.bun/bin/bun`;
`scan_exit=0` and `{"protocol":"agenttool.collab-doorbell-scan/1","sessions":0}`
(no household session has declared rest yet; a positive count only means one
has). The scan file can hold credential-file paths, so it is written mode 0600
and only its protocol and count are printed. An empty file means the read
failed (for example a busy journal): report it, do not loop. Then `3`, and the
process list.

**Live hosts must restart to load the new build.** Every listed process that
started before the install still runs its old code: today Codex's
`bun dist/agenttool-collab-mcp.js` (cwd in the replaced cache dir) and Claude
Code's `bun /opt/homebrew/bin/agenttool-collab-mcp`, possibly the session
executing this plan. They share the schema-3 journal safely (S1: rest events
parse in 0.3.1 and 0.5.0), but they are rest-unaware: no
`collab_session_rest`, a resting session reads `live` or `stale` there, no
`addressee` hint, and no host binding, so their sessions are never tapped or
woken (silence, not a guess). Do not kill them. Tell Yu which sessions run old
code and that restarting is his call; the knock replay needs freshly started
hosts.

- [ ] **Step 5: Commit**

```bash
cd /Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest
git status --porcelain
git log --oneline feat/collab-household-smoothing-20261008..HEAD
```

Expected: `git status` prints nothing: the test and the pinned bundles were
committed in 3a, and the install writes only outside the repo. The log lists
the spec commit, the Task 1–7 commits and `build(collab): rebuild bundles on
pinned Bun 1.3.5 for declared rest and knocks`. The receipts are
`$BK/knock-install-check.json`, `$BK/s1-smoke-worktree.json` and
`$BK/s1-smoke-installed.json`.

- [ ] **Step 6: Freshness check (no fetch, push or PR)**

Re-prove, right before review, that the committed bundles are what the pinned
bundler builds from the committed source, that the household runs exactly
those bytes, and that the branch is still stacked on the household-smoothing
branch. Nothing here contacts a git remote (`npx` may consult the npm cache
for `bun@1.3.5`).

```bash
set -euo pipefail
W=/Users/yuai/Projects/agenttool/.claude/worktrees/collab-knock-and-rest
cd "$W/packages/collab"
npx --yes bun@1.3.5 run build:mcp && npx --yes bun@1.3.5 run check:mcp-bundle && git diff --exit-code -- dist
test -z "$(git status --porcelain -- dist)"
git ls-files -- dist
git -C "$W" merge-base --is-ancestor feat/collab-household-smoothing-20261008 HEAD && echo "stacked on feat/collab-household-smoothing-20261008"
cmp dist/agenttool-collab-mcp.js /opt/homebrew/lib/node_modules/@agenttool/collab/dist/agenttool-collab-mcp.js
cmp dist/agenttool-collab-host.js /opt/homebrew/lib/node_modules/@agenttool/collab/dist/agenttool-collab-host.js
```

Expected: `check:mcp-bundle` exits 0 without "skipped"; `git diff --exit-code
-- dist` exits 0 (the path is relative to `packages/collab`; the repo-root form
`packages/collab/dist` would match nothing there and pass silently);
`git ls-files` lists `dist/agenttool-collab-host.js` and
`dist/agenttool-collab-mcp.js`; the stack line prints; both `cmp` are silent
(skip the two `cmp` lines when Yu has not given the install go).

- [ ] **Step 7: Stop — no push, no PR**

The plan ends here. Pushing `feat/collab-knock-and-rest-20261009` and opening
the stacked PR wait for Yu's explicit go in the executing conversation (spec,
Order of work 5) and are not part of this plan. Report to the controller: the
three receipts, the processes still on old code, and that household Part 2
(tap hooks, doorbell, `sol` rest support, the Codex approval for
`collab_session_rest`) can now consume `/opt/homebrew/bin/agenttool-collab-host
knocks|doorbell-scan`.

Rollback (when Step 4 fails, or when Yu asks; it only reinstates the build
3d backed up, reversing both copies together):

```bash
BK=$(cat "$HOME/.cache/agenttool/collab-household/current")
npm install --global --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org --userconfig=/dev/null "$BK/rollback/agenttool-collab-0.5.0.tgz"
rm -rf "$HOME/plugins/agenttool-collab" && cp -Rp "$BK/codex-marketplace-source" "$HOME/plugins/agenttool-collab"
codex plugin add agenttool-collab@personal --json
python3 "$HOME/.cache/agenttool/collab-household/codex-approvals-guard.py" "$BK/codex-config.toml" "$HOME/.codex/config.toml" && rc=0 || rc=$?
if [ "$rc" = 3 ]; then cp -p "$BK/codex-config.toml" "$HOME/.codex/config.toml"; elif [ "$rc" != 0 ]; then echo "config.toml changed outside agenttool-collab@personal: restore nothing, tell Yu"; fi
shasum -a 256 -c "$BK/before.sha256"
```

Expected: the guard's counts, then six `OK` lines. The restored marketplace
source carries the old `plugin.json` version, so `codex plugin add` recreates
the cache path recorded in `$BK/codex-version-before.txt`. Host bindings and a
knock ledger that the new build wrote under
`~/.local/share/agenttool/collab-sessions/` stay; the restored build ignores
them. The journal snapshot `collab-journal-before.sqlite` is a record only:
restoring it would discard later events, so that is Yu's decision and never
part of rollback. Rest events written meanwhile stay readable by the restored
build (S1).


