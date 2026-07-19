/** Additive migration and bounded projection-query shape locks. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CLAIM_LINEAGE_RECONCILE_BATCH,
  isLiveClaimTipAt,
  summarizeCompetingClaimTips,
} from "../src/services/correspondence/store";

const root = join(import.meta.dir, "../..");
const migration = readFileSync(
  join(root, "api/migrations/20260719T102946_renaissance_correspondence.sql"),
  "utf8",
);
const store = readFileSync(
  join(root, "api/src/services/correspondence/store.ts"),
  "utf8",
);
const schema = readFileSync(
  join(root, "api/src/db/schema/correspondence.ts"),
  "utf8",
);
const route = readFileSync(
  join(root, "api/src/routes/correspondence.ts"),
  "utf8",
);

describe("correspondence durable storage contract", () => {
  test("uses additive project-local receipt order and retains sender forks", () => {
    expect(migration).toContain("CREATE SCHEMA IF NOT EXISTS correspondence");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS correspondence.events");
    expect(migration).toContain(
      "CONSTRAINT correspondence_events_project_seq_unique UNIQUE (project_id, received_seq)",
    );
    expect(schema).toContain('unique("correspondence_events_project_seq_unique").on(');
    expect(schema).not.toContain(
      'uniqueIndex("correspondence_events_project_seq_unique")',
    );
    expect(migration).toContain(
      "(project_id, sender_identity_id, device_id, session_id, session_seq, event_id)",
    );
    expect(schema).toMatch(
      /index\("correspondence_events_session_seq_idx"\)\.on\(\s*t\.projectId,\s*t\.senderIdentityId,\s*t\.deviceId,\s*t\.sessionId,\s*t\.sessionSeq,\s*t\.eventId,\s*\)/s,
    );
    expect(migration).toContain(
      "(project_id, repository_id, thread_id, received_seq)",
    );
    expect(schema).toMatch(
      /index\("correspondence_events_project_thread_seq_idx"\)\.on\(\s*t\.projectId,\s*t\.repositoryId,\s*t\.threadId,\s*t\.receivedSeq,\s*\)/s,
    );
    expect(migration).not.toMatch(/UNIQUE\s*\([^)]*session_seq/is);
    expect(migration).not.toMatch(/UNIQUE\s*\([^)]*claim_id[^)]*generation/is);
    expect(migration).toContain(
      "claim_projection_incomplete boolean NOT NULL DEFAULT false",
    );
    expect(migration).toContain("claim_projection_updated_at timestamptz NOT NULL DEFAULT 'epoch'");
    expect(migration).toContain("is_tip               boolean NOT NULL DEFAULT false");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS correspondence.claim_reconcile_queue");
    expect(migration).toContain("correspondence_claim_events_active_tips_idx");
    expect(migration).toContain("correspondence_claim_events_terminal_tips_idx");
    expect(migration).toContain("correspondence_claim_events_pending_reconcile_idx");
  });

  test("filters focused live claims before the cap, then bounds all terminal siblings", () => {
    const queryStart = store.indexOf("async function loadValidClaimTips");
    const queryEnd = store.indexOf("async function loadBoundedCompetingClaimTips", queryStart);
    const query = store.slice(queryStart, queryEnd);
    expect(query.indexOf("${threadClause}")).toBeGreaterThan(0);
    expect(query.indexOf("${pathClause}")).toBeGreaterThan(0);
    expect(query.indexOf("${pathClause}")).toBeLessThan(query.indexOf("LIMIT ${"));
    expect(query.indexOf("claim.event_kind IN ('claim.open', 'claim.renew')"))
      .toBeLessThan(query.indexOf("LIMIT ${"));
    expect(query.indexOf("claim.is_tip = true"))
      .toBeLessThan(query.indexOf("LIMIT ${"));
    expect(query.indexOf("claim.expires_at > ${activeAt}"))
      .toBeLessThan(query.indexOf("LIMIT ${"));
    expect(query).toContain("ORDER BY claim.expires_at, claim.claim_id, claim.event_id");
    expect(query).not.toContain("NOT EXISTS (");
    expect(store).toContain("visibleFocusedTips = focusedTips.rows.slice(0, MAX_ACTIVE_CLAIMS)");
    expect(store).toContain("visibleFocusedTips.map((row) => row.claim_id)");
    expect(store).toContain("focusedTips.rows.length > MAX_ACTIVE_CLAIMS");

    const siblingsStart = store.indexOf("async function loadBoundedCompetingClaimTips");
    const siblingsEnd = store.indexOf("interface LatestExpiryRow", siblingsStart);
    const siblings = store.slice(siblingsStart, siblingsEnd);
    expect(siblings).toContain("CROSS JOIN LATERAL");
    expect(siblings).toContain("claim.lineage_status = 'valid'");
    expect(siblings).toContain("claim.is_tip = true");
    expect(siblings).toContain("LIMIT ${MAX_COMPETING_TIP_IDS + 2}");
    expect(siblings).not.toContain("claim.event_kind IN ('claim.open', 'claim.renew')");
    expect(siblings).not.toContain("claim.expires_at >");
  });

  test("a released terminal sibling remains a conflict for a live branch", () => {
    expect(summarizeCompetingClaimTips("live-left", [
      { event_id: "live-left" },
      { event_id: "release-right" },
    ])).toEqual({ eventIds: ["release-right"], truncated: false });
  });

  test("terminal and expired hostile rows can never surface as active", () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    expect(isLiveClaimTipAt({
      event_kind: "claim.open",
      expires_at: "2026-07-19T12:00:00.001Z",
      is_tip: true,
    }, now)).toBe(true);
    expect(isLiveClaimTipAt({
      event_kind: "claim.renew",
      expires_at: "2026-07-19T13:00:00.000Z",
      is_tip: true,
    }, now)).toBe(true);
    for (const row of [
      { event_kind: "claim.release" as const, expires_at: null, is_tip: true },
      { event_kind: "claim.open" as const, expires_at: "2026-07-19T12:00:00.000Z", is_tip: true },
      { event_kind: "claim.renew" as const, expires_at: "1900-01-01T00:00:00.000Z", is_tip: true },
      { event_kind: "claim.open" as const, expires_at: "2026-07-20T00:00:00.000Z", is_tip: false },
    ]) {
      expect(isLiveClaimTipAt(row, now), JSON.stringify(row)).toBe(false);
    }
  });

  test("append response code never awaits post-commit projection or Wake fan-out", () => {
    const warningStart = store.indexOf("export function appendWarnings");
    const warningEnd = store.indexOf("export async function appendCorrespondenceEvent");
    const warningSource = store.slice(warningStart, warningEnd);
    expect(warningSource).not.toContain("listCorrespondenceClaims");
    expect(warningSource).not.toContain("await");
    expect(route).not.toContain("await notifier(");
    expect(route).toContain(".then(() => notifier(");
  });

  test("bounds lineage convergence under the stream lock and keeps truncation sentinels", () => {
    expect(CLAIM_LINEAGE_RECONCILE_BATCH).toBe(32);
    expect(store).toContain("while (workItems < CLAIM_LINEAGE_RECONCILE_BATCH)");
    expect(store).toContain(".limit(CLAIM_LINEAGE_RECONCILE_BATCH - workItems)");
    expect(store).toContain("correspondenceClaimReconcileQueue");
    expect(store).toContain("pendingChildrenCondition(projectId, frontier.predecessorEventId)");
    expect(store).toContain("enqueueReadyClaimPredecessor(tx, projectId, child.eventId)");
    expect(store).toContain("async function reconcileClaimProjectionForRead");
    expect(store).toContain('.for("update")');
    expect(store).toContain("reconciliation.incomplete !== lockedStream.claimProjectionIncomplete");
    expect(store).toContain("stream.claimProjectionIncomplete ||");
    expect(store).toContain("claimProjectionUpdatedAt: sql`clock_timestamp()`");
    expect(store.match(/SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/g)).toHaveLength(2);
    const claimsReadStart = store.indexOf("export async function listCorrespondenceClaims");
    const claimsReadEnd = store.indexOf("export function isLiveClaimTipAt", claimsReadStart);
    const claimsRead = store.slice(claimsReadStart, claimsReadEnd);
    expect(claimsRead).toContain("await reconcileClaimProjectionForRead(input.projectId);");
    expect(claimsRead.indexOf("await reconcileClaimProjectionForRead(input.projectId);"))
      .toBeLessThan(claimsRead.indexOf("return db.transaction"));
    const voiceReadStart = store.indexOf("export async function readCorrespondenceVoice");
    const voiceReadEnd = store.indexOf("export interface CorrespondenceService", voiceReadStart);
    const voiceRead = store.slice(voiceReadStart, voiceReadEnd);
    expect(voiceRead).toContain("await reconcileClaimProjectionForRead(input.projectId);");
    expect(voiceRead.indexOf("await reconcileClaimProjectionForRead(input.projectId);"))
      .toBeLessThan(voiceRead.indexOf("return db.transaction"));
    expect(store).not.toContain("resolvablePendingClaimCondition");
    expect(store).toContain(".limit(MAX_VOICE_RECENT_EVENTS + 1)");
    expect(store).toContain("missingParentConflicts(recent.records)");
    expect(store).toContain("WITH focused_seed(");
    expect(store).toContain("AS (VALUES ${seedValues})");
    expect(store).toContain("LIMIT 17");
    expect(store).toContain("LIMIT ${MAX_CLAIM_TIP_CANDIDATES + 1}");
    expect(store).toContain(".limit(MAX_COMPETING_TIP_IDS + 1)");
    expect(store).toContain("CROSS JOIN LATERAL");
    expect(store).not.toContain("CROSS JOIN LATERAL unnest(event.parents)");
    expect(store).not.toContain("HAVING count(*) > 1 AND bool_or(${focusMatch})");
    expect(store).not.toContain("(array_agg(event.event_id ORDER BY event.event_id))[1:16]");
  });
});
