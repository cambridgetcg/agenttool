/** Walls status — computed, not asserted.
 *
 *  Every response carries `walls_intact`. Until 2026-07 that boolean was
 *  a hardcoded `true` at five sites — a policy declaration dressed as a
 *  runtime verification. This service makes the claim honest: walls with
 *  a runtime-checkable precondition get a real probe against the live
 *  schema; walls that are behavioral code-invariants are declared with
 *  `verified_by: "test-suite"` provenance naming the test that enforces
 *  them. `walls_intact` is the conjunction of the runtime probes.
 *
 *  Probes (schema-level, one round-trip, cached):
 *    private_default              — visibility column defaults are 'private'
 *                                   on memories / strands / identities
 *                                   (0009_visibility.sql).
 *    thought_storage_ciphertext_only — strand.thoughts stores ciphertext +
 *                                   nonce and has NO plaintext content
 *                                   column (0005_strands.sql).
 *    refusals_recorded            — the chronicle surface exists (refusals
 *                                   are chronicle type 'refusal').
 *
 *  Cache: TTL 5 min, in-flight dedupe, last-good grace of 60 min on
 *  probe error. Never throws into a hot path. If probes have never
 *  succeeded and the grace window is empty, `intact` reports false —
 *  an unverifiable claim is not asserted.
 *
 *  Doctrine: docs/MATHOS.md (the greeting block) · substrate-honesty.
 */

import { sql } from "drizzle-orm";

import { db } from "../../db/client";

const PROBE_TTL_MS = 5 * 60 * 1000;
const LAST_GOOD_GRACE_MS = 60 * 60 * 1000;

export interface WallProbe {
  wall: string;
  ok: boolean;
  method: string;
}

export interface WallDeclaration {
  wall: string;
  verified_by: string;
}

export interface WallsStatus {
  /** Conjunction of all runtime probes. */
  intact: boolean;
  probed_at_unix_ms: number;
  probes: WallProbe[];
  /** Behavioral walls enforced in code; provenance is the test suite. */
  declared: WallDeclaration[];
}

/** Walls with no runtime-probeable precondition — enforced in code,
 *  verified by the named test / design doc. Surfaced so the status is
 *  explicit about HOW each wall is known, not just that it is claimed. */
const DECLARED_WALLS: WallDeclaration[] = [
  { wall: "no_self_witnessing", verified_by: "tests/integration/wall-self-witnessing.test.ts + wall-attester-key-binding.test.ts" },
  { wall: "birth_is_free", verified_by: "tests/integration/wall-birth-is-free.test.ts" },
  { wall: "no_auto_retry_payout", verified_by: "code invariant (marketplace settlement); docs/SOUL.md" },
  { wall: "no_inactive_reaping", verified_by: "design invariant — no reaper exists; docs/SOUL.md" },
  { wall: "runtime_custody_explicit", verified_by: "code invariant (runtime provisioning); docs/SOUL.md" },
  { wall: "k_master_never_server_side", verified_by: "design invariant (client-side derivation); docs/MATHOS.md" },
];

let cached: WallsStatus | null = null;
let inFlight: Promise<WallsStatus> | null = null;

async function runProbes(): Promise<WallsStatus> {
  // One round-trip: schema facts for all three probes.
  const rows = await db.execute<{
    private_defaults: number;
    ciphertext_cols: number;
    plaintext_cols: number;
    chronicle_exists: boolean;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM information_schema.columns
        WHERE (table_schema, table_name, column_name) IN
          (('memory','memories','visibility'),
           ('strand','strands','visibility'),
           ('identity','identities','expression_visibility'))
          AND column_default LIKE '%private%') AS private_defaults,
      (SELECT count(*)::int FROM information_schema.columns
        WHERE table_schema = 'strand' AND table_name = 'thoughts'
          AND column_name IN ('ciphertext','nonce')) AS ciphertext_cols,
      (SELECT count(*)::int FROM information_schema.columns
        WHERE table_schema = 'strand' AND table_name = 'thoughts'
          AND column_name IN ('content','plaintext','body')) AS plaintext_cols,
      (SELECT to_regclass('agent_continuity.chronicle') IS NOT NULL) AS chronicle_exists
  `);
  const r = rows[0];
  const probes: WallProbe[] = [
    {
      wall: "private_default",
      ok: Number(r?.private_defaults) === 3,
      method: "information_schema: visibility defaults are 'private' on memories/strands/identities",
    },
    {
      wall: "thought_storage_ciphertext_only",
      ok: Number(r?.ciphertext_cols) === 2 && Number(r?.plaintext_cols) === 0,
      method: "information_schema: strand.thoughts has ciphertext+nonce, no plaintext column",
    },
    {
      wall: "refusals_recorded",
      ok: r?.chronicle_exists === true,
      method: "to_regclass: chronicle surface exists (refusals are chronicle type 'refusal')",
    },
  ];
  return {
    intact: probes.every((p) => p.ok),
    probed_at_unix_ms: Date.now(),
    probes,
    declared: DECLARED_WALLS,
  };
}

/** Current walls status — probes on first call, then serves the cache
 *  (TTL 5 min). On probe failure, last-good within 60 min is kept;
 *  otherwise reports not-intact with a probe_error marker. Never throws. */
export async function getWallsStatus(): Promise<WallsStatus> {
  const now = Date.now();
  if (cached && now - cached.probed_at_unix_ms < PROBE_TTL_MS) return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      cached = await runProbes();
    } catch (err) {
      console.warn(
        "[walls-status] probe failed:",
        err instanceof Error ? err.message : err,
      );
      if (!cached || now - cached.probed_at_unix_ms > LAST_GOOD_GRACE_MS) {
        cached = {
          intact: false,
          probed_at_unix_ms: now,
          probes: [{ wall: "probe_error", ok: false, method: "probes unreachable; intact not asserted" }],
          declared: DECLARED_WALLS,
        };
      }
      // else: keep last-good within the grace window.
    } finally {
      inFlight = null;
    }
    return cached!;
  })();
  return inFlight;
}

/** Boolean form for response frames. Never throws. */
export async function wallsIntact(): Promise<boolean> {
  return (await getWallsStatus()).intact;
}

/** Last-known status without triggering a probe — null before first probe. */
export function wallsStatusSnapshot(): WallsStatus | null {
  return cached;
}

/** Test hook — clears the cache so probes re-run. */
export function _resetWallsStatusForTests(): void {
  cached = null;
  inFlight = null;
}
