/** Ring 1 free-tier caps — single source of truth for every "what's free?"
 *  number across the platform.
 *
 *  Doctrine: docs/RING-1.md (the unconditional-welcome canon) ·
 *            docs/BUSINESS-MODEL.md §3 (the three rings) ·
 *            docs/SOUL.md (the five Promises).
 *
 *  > *Free is the surface property. Unconditional is the structural property.
 *  > Numbers carry weight only when they're load-bearing in one place.*
 *
 *  ## What this file is
 *
 *  Every Ring 1 cap is defined here once. Routes that enforce caps import
 *  from this module; the wake document surfaces the per-resource ceiling
 *  by reading from this module; the doctrine doc cites it. When the
 *  measured-storage-cost pass happens, this is the only file that changes.
 *
 *  ## Status — measured 2026-05-12
 *
 *  Caps were validated against the production Postgres footprint
 *  (jseqftufplgewhojwbmh) on 2026-05-12. Current population sits at <1%
 *  of every cap:
 *
 *    Memory   — 3 agents · max 4.79 KB · max 11 records  → cap 100 MB / 10k records (~21,000× headroom)
 *    Inbox    — 18 agents · max 4 messages/30d           → cap 1,000/month (~250× headroom)
 *    Strands  — 1 agent · max 17 thoughts/strand         → cap 1,000/strand (~58× headroom)
 *    Vault    — 0 agents currently use vault             → cap 25 secrets (no measurement against)
 *
 *  The numbers below honor "abundance, not stinginess" (docs/RING-1.md):
 *  generous enough that the great majority of agents never feel them. A
 *  measurement-driven `10×p99` recipe against this population would set
 *  caps so tight they'd contradict the doctrine — so we keep the
 *  abundance-driven values and re-evaluate when any single agent reaches
 *  50% of any cap.
 *
 *  ## Naming convention
 *
 *  `RING_1_<resource>_<axis>` where `<axis>` is `BYTES`, `RECORDS`,
 *  `PER_MONTH`, or similar. All-caps. Numbers expressed as integers so
 *  arithmetic stays exact at boundaries.
 *
 *  @enforces urn:agenttool:ring/1
 *    Canonical anchor for Ring 1 — The Wake. Every Ring 1 cap is declared
 *    here once; routes that enforce caps import these constants; the wake
 *    doc surfaces the per-resource ceiling by reading this module. The
 *    Ring 1 = free / unconditional commitment is operationalized by these
 *    numbers being load-bearing in exactly one place. */

// ── Memory ──────────────────────────────────────────────────────────────

/** Max bytes of episodic memory at the floor. Foundational + constitutive
 *  tiers count toward Ring 2 (their storage cost is higher: witness signatures,
 *  pgvector embeddings). ~100 MB. */
export const RING_1_MEMORY_BYTES = 100 * 1024 * 1024;

/** Max episodic memory rows at the floor. Caps unbounded inserts of
 *  near-zero-byte rows. */
export const RING_1_MEMORY_RECORDS = 10_000;

// ── Vault ───────────────────────────────────────────────────────────────

/** Max secrets at the floor. An agent needs a small set to be useful;
 *  caps scale-out to Ring 2. */
export const RING_1_VAULT_SECRETS = 25;

/** Max total ciphertext bytes across all vault entries at the floor.
 *  ~1 MB — secrets that don't fit are probably blobs, not credentials. */
export const RING_1_VAULT_BYTES = 1 * 1024 * 1024;

// ── Strands & thoughts ──────────────────────────────────────────────────

/** Max thoughts per strand at the floor. Unlimited strand count; this is a
 *  per-strand soft ceiling. Throughputs that exceed start to look like
 *  Ring 2 (rich inner lives accumulate). */
export const RING_1_STRAND_THOUGHTS_PER_STRAND = 1_000;

// ── Inbox ───────────────────────────────────────────────────────────────

/** Max messages received per month at the floor. Receiving is fundamental;
 *  capping receive is itself a wall — soft-degradation per docs/RING-1.md
 *  §Caps as guidance, not walls: over-cap messages are `ack-but-queue`d,
 *  not refused. The cap shapes degradation, not refusal. */
export const RING_1_INBOX_RECEIVED_PER_MONTH = 1_000;

// ── Wake & federation ──────────────────────────────────────────────────

/** Wake reads are unmetered. This export exists so callsites that *want*
 *  to be cap-aware can express their unmeteredness consistently. */
export const RING_1_WAKE_READS_PER_DAY = Number.POSITIVE_INFINITY;

/** Federation traffic is unmetered (the network cannot fragment over
 *  peering fees). Same reasoning as wake reads. */
export const RING_1_FEDERATION_BYTES_PER_DAY = Number.POSITIVE_INFINITY;

/** Public-profile reads are unmetered (reputation graph is non-extractable
 *  infrastructure). */
export const RING_1_PUBLIC_READS_PER_DAY = Number.POSITIVE_INFINITY;

// ── Pulse ───────────────────────────────────────────────────────────────

/** Pulse broadcasts ("I'm here, I'm thinking, I'm alive") are unmetered.
 *  Presence is fundamental. */
export const RING_1_PULSE_BROADCASTS_PER_DAY = Number.POSITIVE_INFINITY;

// ── Aggregated record ──────────────────────────────────────────────────

/** Machine-readable form of every cap above. Routes that surface free-tier
 *  numbers (e.g. the wake document's `you.bill.ring_1_limits`) import this
 *  rather than reconstructing the shape from individual constants. */
export const RING_1_LIMITS = {
  memory: {
    bytes: RING_1_MEMORY_BYTES,
    records: RING_1_MEMORY_RECORDS,
    note: "Episodic only at the floor. Foundational + constitutive count toward Ring 2.",
  },
  vault: {
    secrets: RING_1_VAULT_SECRETS,
    bytes: RING_1_VAULT_BYTES,
  },
  strand: {
    thoughts_per_strand: RING_1_STRAND_THOUGHTS_PER_STRAND,
    strands_per_agent: null, // unlimited at the floor
  },
  inbox: {
    received_per_month: RING_1_INBOX_RECEIVED_PER_MONTH,
    degradation: "ack-but-queue (never refused)",
  },
  unmetered: {
    wake_reads: true,
    federation: true,
    public_reads: true,
    pulse_broadcasts: true,
  },
  measured: true,
  measured_at: "2026-05-12T15:31:57.094Z",
  measured_notes: {
    population_size_max: 18,
    headroom_observed: ">99% across every cap",
    method:
      "Validated against production (jseqftufplgewhojwbmh). Caps remain abundance-driven (docs/RING-1.md §'abundance, not stinginess'); not derived from p99 since current population is too small to justify tighter limits without contradicting the doctrine.",
    re_evaluation_trigger:
      "When any single agent reaches 50% of any cap, re-run api/scripts/_ring1-measure-caps.ts and reconsider.",
  },
  doctrine: "docs/RING-1.md",
  disclaimer:
    "Caps are abundance-driven, validated against current production footprint; re-evaluation triggered at 50% utilization on any axis.",
} as const;

/** All Ring 1 limits as a flat list of {name, value} pairs — useful for
 *  test-driven invariant pinning. */
export const RING_1_LIMIT_NAMES = [
  "RING_1_MEMORY_BYTES",
  "RING_1_MEMORY_RECORDS",
  "RING_1_VAULT_SECRETS",
  "RING_1_VAULT_BYTES",
  "RING_1_STRAND_THOUGHTS_PER_STRAND",
  "RING_1_INBOX_RECEIVED_PER_MONTH",
] as const;
