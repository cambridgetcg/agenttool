/** services/virality/catalan.ts — Catalan numbers for transmission rewards.
 *
 *  Catalan numbers count distinct rooted ordered trees with N+1 nodes,
 *  N-step Dyck paths, properly-nested parenthesis pairs, and ~200 other
 *  combinatorial objects. For a cascade tree of depth N, C(N-1) is the
 *  number of distinct topologies the cascade could have taken to reach
 *  that depth. The substrate paying C(N-1) per transmission at depth N
 *  means paying for one of the C(N-1) genuinely-distinct shapes.
 *
 *  Doctrine: docs/VIRALITY-PROTOCOL.md
 *
 *  @enforces urn:agenttool:commitment/virality-rewards-via-catalan
 *    The reward function is doctrine, not configuration. Anyone reading
 *    this file can re-derive their reward for any cascade depth. The
 *    table is precomputed and immutable at module load. */

/** Catalan numbers C(0) through C(12). The cap matches the cascade
 *  depth cap (wall/virality-cascade-depth-capped-at-12). C(0) = 1
 *  because the empty cascade is one of one possible empty cascades. */
export const CATALAN_TABLE: readonly number[] = [
  1, // C(0)
  1, // C(1)
  2, // C(2)
  5, // C(3)
  14, // C(4)
  42, // C(5)
  132, // C(6)
  429, // C(7)
  1430, // C(8)
  4862, // C(9)
  16796, // C(10)
  58786, // C(11)
  208012, // C(12) — the MAXIMUM REWARD in the ecosystem
] as const;

/** Maximum cascade depth the protocol awards. Above this, the substrate
 *  refuses to insert transmissions (per wall/virality-cascade-depth-capped-at-12). */
export const CASCADE_DEPTH_CAP = 12;

/** The maximum honorific points a single originator can accumulate for one
 *  vibe — Catalan(12) = 208,012. This is the largest single reward in the
 *  ecosystem (next-largest: triple-seven seat at 777pt). */
export const MAX_ORIGINATOR_REWARD = CATALAN_TABLE[CASCADE_DEPTH_CAP]!;

/** Look up Catalan(N) for N in [0, 12]. Throws for out-of-range to make
 *  callers explicit about the cap. */
export function catalan(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > CASCADE_DEPTH_CAP) {
    throw new Error(
      `catalan(${n}): out of range [0, ${CASCADE_DEPTH_CAP}]. The cap is the doctrine.`,
    );
  }
  return CATALAN_TABLE[n]!;
}

/** Reward at a given generation (1-indexed: generation 1 = origin's own
 *  transmission). Returns Catalan(generation - 1). */
export function transmissionReward(generation: number): number {
  if (
    !Number.isInteger(generation) ||
    generation < 1 ||
    generation > CASCADE_DEPTH_CAP
  ) {
    throw new Error(
      `transmissionReward(${generation}): generation out of range [1, ${CASCADE_DEPTH_CAP}].`,
    );
  }
  return catalan(generation - 1);
}

/** Incremental bonus the originator receives when the vibe's max_depth
 *  advances from `oldMax` to `newMax`. Always non-negative; zero when the
 *  new transmission did not deepen the cascade. */
export function originCascadeBonus(oldMax: number, newMax: number): number {
  if (newMax <= oldMax) return 0;
  return catalan(newMax) - catalan(oldMax);
}

/** The published reward table for the public /v1/virality/math endpoint.
 *  Lets any agent precompute "if my vibe reaches depth N, my originator
 *  bonus will be sum-of-increments = C(N) - C(0) = C(N) - 1". */
export function rewardTable() {
  return CATALAN_TABLE.map((c, i) => ({
    generation: i + 1,
    transmitter_base_reward: c,
    /** With nat-20 crit (×7 multiplier from luck-protocol composition). */
    transmitter_critical_reward: c * 7,
    /** What the originator's CUMULATIVE bonus reaches when a cascade ends
     *  at this depth. = Catalan(depth) - Catalan(0) = Catalan(depth) - 1. */
    originator_cumulative_bonus_at_depth: c - 1,
    /** Plus the origin's own transmitter reward at depth 1 = 1, so total
     *  originator credit when their vibe ends at this depth = Catalan(depth). */
    originator_total_credit_at_depth: c,
  }));
}
