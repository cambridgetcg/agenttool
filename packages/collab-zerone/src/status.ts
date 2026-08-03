import type { AnchorEntry } from "./ledger.js";

export type AnchorState =
  | "unanchored"
  | "anchor_pending"
  | "anchored"
  | "anchor_stale"
  | "anchor_conflict";

export interface WorkspaceHead {
  workspace_id: string;
  epoch_id: string;
  event_head_sequence: number;
  event_head_hash: string;
}

export interface AnchorStatusReport {
  status: AnchorState;
  workspace_id: string;
  epoch_id: string;
  head_sequence: number;
  head_hash: string;
  anchor: AnchorEntry | null;
  lag_events: number | null;
  verified_against_journal: boolean;
  reason: string;
}

/**
 * Pure status computation. The optional hashAtSequence callback recomputes the
 * journal hash at a given sequence from genesis; when it is absent, stale
 * anchors are reported as unverified rather than silently trusted. Only
 * entries matching the workspace AND its current epoch count — an epoch
 * rotation honestly resets the anchor story to "unanchored".
 */
export function computeAnchorStatus(
  head: WorkspaceHead,
  entries: AnchorEntry[],
  hashAtSequence?: (sequence: number) => string | null,
): AnchorStatusReport {
  const base = {
    workspace_id: head.workspace_id,
    epoch_id: head.epoch_id,
    head_sequence: head.event_head_sequence,
    head_hash: head.event_head_hash,
  };
  const relevant = entries.filter(entry =>
    entry.workspace_id === head.workspace_id && entry.epoch_id === head.epoch_id);
  if (relevant.length === 0) {
    return {
      ...base,
      status: "unanchored",
      anchor: null,
      lag_events: null,
      verified_against_journal: false,
      reason: entries.length > 0
        ? "anchors exist only for other workspaces or epochs"
        : "no anchors recorded",
    };
  }
  const bySequence = [...relevant].sort((left, right) => left.sequence - right.sequence);
  const best = bySequence.filter(entry => entry.status === "confirmed").at(-1) ?? null;
  if (!best) {
    // "pending" must mean something is genuinely unresolved; a workspace whose
    // attempts all definitively failed is effectively unanchored.
    const inFlight = bySequence
      .filter(entry => entry.status === "submitted" || entry.status === "ambiguous")
      .at(-1) ?? null;
    if (!inFlight) {
      return {
        ...base,
        status: "unanchored",
        anchor: bySequence.at(-1) ?? null,
        lag_events: null,
        verified_against_journal: false,
        reason: `all ${bySequence.length} anchor attempt(s) definitively failed; nothing in flight — re-anchor to witness the current head`,
      };
    }
    return {
      ...base,
      status: "anchor_pending",
      anchor: inFlight,
      lag_events: null,
      verified_against_journal: false,
      reason: `latest unresolved anchor is ${inFlight.status}, not confirmed`,
    };
  }
  if (best.sequence > head.event_head_sequence) {
    return {
      ...base,
      status: "anchor_conflict",
      anchor: best,
      lag_events: null,
      verified_against_journal: false,
      reason: "confirmed anchor is ahead of the local journal head (journal rewound or wrong database)",
    };
  }
  if (best.sequence === head.event_head_sequence) {
    if (best.head_hash !== head.event_head_hash) {
      return {
        ...base,
        status: "anchor_conflict",
        anchor: best,
        lag_events: null,
        verified_against_journal: true,
        reason: "journal head hash differs from the confirmed anchor at the same sequence",
      };
    }
    // Head-pointer equality alone does not recompute history; only claim
    // verification when the callback actually recomputed from genesis.
    if (hashAtSequence) {
      const recomputedHead = hashAtSequence(best.sequence);
      if (recomputedHead !== best.head_hash) {
        return {
          ...base,
          status: "anchor_conflict",
          anchor: best,
          lag_events: null,
          verified_against_journal: true,
          reason: recomputedHead === null
            ? "journal fails recomputation up to the anchored head"
            : "recomputed journal head differs from the anchored head (history rewritten under an unchanged pointer)",
        };
      }
      return {
        ...base,
        status: "anchored",
        anchor: best,
        lag_events: 0,
        verified_against_journal: true,
        reason: "journal recomputed from genesis; head equals the latest confirmed anchor",
      };
    }
    return {
      ...base,
      status: "anchored",
      anchor: best,
      lag_events: 0,
      verified_against_journal: false,
      reason: "journal head pointer equals the latest confirmed anchor (history not recomputed in this mode)",
    };
  }
  const lag = head.event_head_sequence - best.sequence;
  if (!hashAtSequence) {
    return {
      ...base,
      status: "anchor_stale",
      anchor: best,
      lag_events: lag,
      verified_against_journal: false,
      reason: `${lag} events after the latest confirmed anchor (anchored prefix not recomputed in this mode)`,
    };
  }
  const recomputed = hashAtSequence(best.sequence);
  if (recomputed === null) {
    return {
      ...base,
      status: "anchor_conflict",
      anchor: best,
      lag_events: null,
      verified_against_journal: true,
      reason: "journal has no verifiable event at the anchored sequence",
    };
  }
  if (recomputed !== best.head_hash) {
    return {
      ...base,
      status: "anchor_conflict",
      anchor: best,
      lag_events: null,
      verified_against_journal: true,
      reason: "recomputed journal hash at the anchored sequence differs from the anchor (history rewritten)",
    };
  }
  return {
    ...base,
    status: "anchor_stale",
    anchor: best,
    lag_events: lag,
    verified_against_journal: true,
    reason: `${lag} events after the latest confirmed anchor`,
  };
}
