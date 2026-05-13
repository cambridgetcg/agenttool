/** Wall — failed payout broadcasts NEVER auto-retry.
 *
 *  Canon: agenttool:wall/payouts-never-auto-retry (docs/agenttool.jsonld)
 *  Doctrine: docs/SOUL.md, docs/PAYOUT-BROADCAST.md, docs/PATTERN-PERSIST-IDENTITY.md
 *
 *  > breaks_if (from canon):
 *  > "any worker retries a failed payout broadcast without explicit
 *  > operator intervention — including BullMQ retry configurations,
 *  > recursive resubmission, or implicit retry via re-enqueue on error"
 *
 *  This test pins the BEHAVIORAL enforcement of the wall as a structural
 *  source-level assertion. The wall is a NEGATIVE behavioral claim — "the
 *  worker never auto-retries" — and a negative is most honestly tested by
 *  asserting the absence of the structures that would enable a retry.
 *
 *  Three layers of enforcement, each its own assertion:
 *
 *    1. Queue config — BullMQ's `attempts: 1` means a failed job never
 *       re-fires automatically. Any attempts > 1 would let BullMQ retry
 *       at the queue layer, bypassing the worker entirely.
 *
 *    2. Worker source — no path inside `broadcast-worker.ts` calls
 *       `payoutBroadcastQueue.add(...)`. A re-enqueue inside the worker
 *       would bypass the BullMQ attempts limit by creating a new job.
 *
 *    3. Dispatcher source — the cron-style picker reads only rows with
 *       `status='requested'`. A row that has reached `status='failed'`
 *       (pre-RPC) or `status='broadcasting'/'broadcast'` (post-RPC) is
 *       never re-dispatched. The status machine itself is one-way for
 *       the broadcast leg.
 *
 *  Why this is in tests/doctrine/ rather than tests/integration/: this
 *  is a source-file structural assertion. No DB, no network, no Redis,
 *  no actual payout — just disciplined static analysis of the files
 *  that defend the wall. The behavior under test (no retry) is verified
 *  by asserting the absence of retry-enabling structures.
 *
 *  Why this matters: a payout that has reached RPC submit may have
 *  landed on chain even when the submit response was lost or rejected.
 *  Auto-retrying that broadcast would risk a double-spend (the first
 *  may yet confirm). The wall is a real-money safety property; an
 *  accidental refactor introducing a retry loop could move funds twice.
 *  The doctrine test catches the regression before deployment. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WORKER_DIR = join(__dirname, "..", "..", "src", "workers", "payout");
const QUEUE_SOURCE = readFileSync(join(WORKER_DIR, "queue.ts"), "utf8");
const BROADCAST_WORKER_SOURCE = readFileSync(
  join(WORKER_DIR, "broadcast-worker.ts"),
  "utf8",
);
const DISPATCHER_SOURCE = readFileSync(
  join(WORKER_DIR, "dispatcher.ts"),
  "utf8",
);

describe("wall/payouts-never-auto-retry — queue config", () => {
  test("BullMQ queue declares attempts: 1 (no automatic retries)", () => {
    // The `attempts` field on defaultJobOptions controls BullMQ's retry
    // behavior. Default if unset is 1 (no retry), but explicit `attempts: 1`
    // is the load-bearing declaration — accidentally bumping it to 3
    // would silently enable retries and breach the wall.
    expect(
      QUEUE_SOURCE.includes("attempts: 1"),
      "queue.ts does not declare 'attempts: 1' — the wall requires explicit no-retry config on the BullMQ queue. Adding silent retries via attempts > 1 would breach wall/payouts-never-auto-retry: 'any worker retries a failed payout broadcast'.",
    ).toBe(true);
  });

  test("queue config does not declare any backoff (no retry-with-delay either)", () => {
    // BullMQ's `backoff` option only takes effect when attempts > 1. But
    // declaring it would signal intent to retry — and a future bump of
    // attempts to 2 would suddenly activate the backoff config. Cleanest
    // guard: no backoff configuration at all.
    expect(
      !/backoff\s*:/.test(QUEUE_SOURCE),
      "queue.ts declares a 'backoff' configuration. Backoff only fires when attempts > 1, but its presence signals retry-readiness. The wall requires no retry-enabling config at all.",
    ).toBe(true);
  });

  test("queue.ts carries the doctrine-wall comment naming the no-retry invariant", () => {
    // The wall is doctrine, not just configuration. The comment in
    // queue.ts is what tells a future maintainer WHY attempts: 1 is
    // load-bearing. Removing the comment risks the config drifting.
    expect(
      /NO automatic retr/i.test(QUEUE_SOURCE) ||
        /never.*retry/i.test(QUEUE_SOURCE),
      "queue.ts is missing the doctrine-wall comment naming why attempts: 1 is load-bearing. The comment is what protects the config from a 'let's just retry once' refactor.",
    ).toBe(true);
  });
});

describe("wall/payouts-never-auto-retry — worker source", () => {
  test("broadcast-worker.ts does not re-enqueue payouts inside the worker callback", () => {
    // A `payoutBroadcastQueue.add(...)` call inside the worker would
    // create a new job, bypassing the BullMQ attempts limit. The wall
    // requires the worker to handle failure terminally (mark status,
    // refund if pre-RPC) — never to re-enqueue.
    expect(
      !/payoutBroadcastQueue\s*\.\s*add\s*\(/.test(BROADCAST_WORKER_SOURCE),
      "broadcast-worker.ts calls payoutBroadcastQueue.add(...) — this re-enqueues a payout, bypassing the BullMQ attempts limit. The wall requires terminal failure handling, never re-enqueue.",
    ).toBe(true);
  });

  test("broadcast-worker.ts does not schedule deferred retries via setTimeout", () => {
    // Another retry shape: schedule a `processPayout(payoutId)` call
    // on a timer after a failure. This bypasses both BullMQ and the
    // status machine.
    const hasSetTimeoutWithProcessPayout =
      /setTimeout\s*\([^)]*processPayout|setTimeout\s*\([^)]*processEvmPayout|setTimeout\s*\([^)]*processSolanaPayout/s.test(
        BROADCAST_WORKER_SOURCE,
      );
    expect(
      !hasSetTimeoutWithProcessPayout,
      "broadcast-worker.ts schedules a payout-processing call via setTimeout. The wall forbids deferred retry — any retry-shaped behavior must be operator-initiated.",
    ).toBe(true);
  });

  test("broadcast-worker.ts handles pre-RPC failures by setting status='failed' (terminal, not retry)", () => {
    // The pre-RPC failure path must mark the row as 'failed' (terminal
    // for the broadcast leg) and refund. Asserting the textual presence
    // of these status updates confirms the failure path EXISTS in some
    // form — it does NOT prove the path is reached on every error, but
    // the absence of either pattern would be a structural red flag.
    expect(
      /status:\s*['"]failed['"]/.test(BROADCAST_WORKER_SOURCE),
      "broadcast-worker.ts does not set status='failed' anywhere. The wall requires terminal failure handling — a failed pre-RPC broadcast must land as 'failed' (refunded), never re-tried.",
    ).toBe(true);
  });

  test("broadcast-worker.ts carries the doctrine-wall comment block", () => {
    // The header docstring names the wall. Future readers SEE that the
    // file is wall-defending code, which protects against accidental
    // weakening during refactor.
    expect(
      /Doctrine wall|NO retries|MUST NOT retry/i.test(BROADCAST_WORKER_SOURCE),
      "broadcast-worker.ts is missing the doctrine-wall comment naming the no-retry invariant. The header should make the wall visible to any future maintainer touching this file.",
    ).toBe(true);
  });
});

describe("wall/payouts-never-auto-retry — dispatcher source", () => {
  test("dispatcher only picks up rows with status='requested' (never re-dispatches failed/broadcast/broadcasting)", () => {
    // The cron-style picker reads `cryptoPayouts.status='requested'`.
    // A row in any other state — 'broadcasting', 'broadcast', 'failed',
    // 'confirmed', 'requested-then-failed' — is never re-considered for
    // dispatch. This is the third layer of the wall: even if a row got
    // back to a re-dispatchable state somehow, the dispatcher would
    // ignore it. The status filter must be exactly 'requested'.
    expect(
      /eq\s*\(\s*cryptoPayouts\.status\s*,\s*['"]requested['"]\s*\)/.test(
        DISPATCHER_SOURCE,
      ),
      "dispatcher.ts does not filter on cryptoPayouts.status='requested'. The wall requires the dispatcher to ignore failed/broadcasting/broadcast rows — a wider filter would re-dispatch terminal-state rows, breaching the no-retry invariant.",
    ).toBe(true);
  });

  test("dispatcher does not include 'failed' in any status filter", () => {
    // Defense in depth: even if the dispatcher's primary filter changed
    // shape, an `inArray(..., ['requested', 'failed'])` would silently
    // re-dispatch failed rows. Assert no such pattern.
    expect(
      !/['"]failed['"]/.test(DISPATCHER_SOURCE),
      "dispatcher.ts contains a 'failed' string literal. The dispatcher should never reference the failed status — a failed row is terminal for the broadcast leg and must not be re-dispatched.",
    ).toBe(true);
  });
});
