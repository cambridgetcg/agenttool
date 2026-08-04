import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { CollabError } from "./errors.js";
import type { CollabStore } from "./store.js";

/**
 * Read-only view over the sidecar anchor ledger maintained by
 * @agenttool/collab-zerone, which witnesses journal head hashes on the zerone
 * chain. Collab itself never talks to a chain: this module reads one local
 * JSON file and compares it against the journal, so a chain outage (or the
 * bridge simply not being installed) can never block coordination — it just
 * reports "unanchored" honestly.
 */
export const ANCHOR_LEDGER_PROTOCOL = "agenttool.collab-zerone-ledger/0.1" as const;

export type CollabAnchorState =
  | "unanchored"
  | "anchor_pending"
  | "anchored"
  | "anchor_stale"
  | "anchor_conflict";

export interface CollabAnchorRef {
  sequence: number;
  head_hash: string;
  network: string;
  caip2: string | null;
  tx_hash: string | null;
  status: string;
  submitted_at: string | null;
  confirmed_at: string | null;
  confirmed_height: number | null;
}

export interface CollabAnchorStatus {
  workspace_id: string;
  status: CollabAnchorState;
  head_sequence: number;
  head_hash: string;
  ledger_readable: boolean;
  anchor: CollabAnchorRef | null;
  lag_events: number | null;
  reason: string;
  scope_note: string;
}

const SCOPE_NOTE =
  "Anchor status reflects the local sidecar ledger only; it never proves remote chain state."
  + " Use @agenttool/collab-zerone `verify --workspace <id> --check-chain` for on-chain confirmation.";

// Real ledgers are a few KiB; anything larger is not a ledger. The cap plus
// the O_NONBLOCK regular-file-only read below keep a hostile selected path from
// wedging a single-threaded host (FIFOs and device files block
// readFileSync forever, which try/catch cannot save).
const MAX_LEDGER_BYTES = 4 * 1024 * 1024;

export function defaultAnchorLedgerPath(
  env: Record<string, string | undefined> = process.env,
): string {
  if (env.AGENTOOL_COLLAB_ANCHOR_LEDGER) return env.AGENTOOL_COLLAB_ANCHOR_LEDGER;
  const dataHome = env.XDG_DATA_HOME && env.XDG_DATA_HOME.length > 0
    ? env.XDG_DATA_HOME
    : `${env.HOME}/.local/share`;
  return `${dataHome}/agenttool/collab-zerone-anchors.json`;
}

interface LedgerEntry {
  workspace_id: string;
  epoch_id: string;
  sequence: number;
  head_hash: string;
  network: string;
  caip2?: string;
  tx_hash?: string | null;
  status: string;
  submitted_at?: string;
  confirmed_at?: string;
  confirmed_height?: number;
}

function isLedgerEntry(value: unknown): value is LedgerEntry {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.workspace_id === "string"
    && typeof entry.epoch_id === "string"
    && typeof entry.sequence === "number" && Number.isSafeInteger(entry.sequence)
    && typeof entry.head_hash === "string"
    && typeof entry.network === "string"
    && typeof entry.status === "string";
}

// Ledger strings reach model-visible tool output; clamp length and strip
// control characters so a hostile ledger cannot smuggle formatting or bulk.
function clampText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ");
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

function toAnchorRef(entry: LedgerEntry): CollabAnchorRef {
  return {
    sequence: entry.sequence,
    head_hash: clampText(entry.head_hash, 128) ?? "",
    network: clampText(entry.network, 64) ?? "",
    caip2: clampText(entry.caip2, 64),
    tx_hash: clampText(entry.tx_hash, 128),
    status: clampText(entry.status, 32) ?? "",
    submitted_at: clampText(entry.submitted_at, 64),
    confirmed_at: clampText(entry.confirmed_at, 64),
    confirmed_height: typeof entry.confirmed_height === "number" ? entry.confirmed_height : null,
  };
}

function readLedgerFile(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_LEDGER_BYTES) return null;
    const buffer = Buffer.alloc(Number(stat.size));
    let offset = 0;
    while (offset < buffer.length) {
      const read = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (read <= 0) break;
      offset += read;
    }
    return buffer.subarray(0, offset).toString("utf8");
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

export function anchorStatusForWorkspace(
  store: CollabStore,
  workspaceId: string,
  ledgerPath?: string,
): CollabAnchorStatus {
  const workspace = store.getWorkspace(workspaceId);
  if (!workspace) {
    throw new CollabError("workspace_not_found", "Workspace was not found", {
      workspace_id: workspaceId,
    });
  }
  const path = ledgerPath ?? defaultAnchorLedgerPath();
  const base = {
    workspace_id: workspaceId,
    head_sequence: workspace.event_head_sequence,
    head_hash: workspace.event_head_hash,
    scope_note: SCOPE_NOTE,
  };
  const raw = readLedgerFile(path);
  if (raw === null) {
    return {
      ...base,
      status: "unanchored",
      ledger_readable: false,
      anchor: null,
      lag_events: null,
      reason: "no readable anchor ledger at this path (missing, non-regular, oversized, or unreadable)",
    };
  }
  let entries: LedgerEntry[];
  try {
    const parsed = JSON.parse(raw) as { protocol?: unknown; anchors?: unknown };
    if (parsed?.protocol !== ANCHOR_LEDGER_PROTOCOL || !Array.isArray(parsed.anchors)) {
      throw new Error("wrong ledger protocol");
    }
    entries = parsed.anchors.filter(isLedgerEntry)
      .filter(entry => entry.workspace_id === workspaceId && entry.epoch_id === workspace.epoch_id);
  } catch {
    return {
      ...base,
      status: "unanchored",
      ledger_readable: false,
      anchor: null,
      lag_events: null,
      reason: "anchor ledger exists but is unreadable or has the wrong protocol; treating as unanchored",
    };
  }
  if (entries.length === 0) {
    return {
      ...base,
      status: "unanchored",
      ledger_readable: true,
      anchor: null,
      lag_events: null,
      reason: "no anchors recorded for this workspace and epoch",
    };
  }
  const bySequence = [...entries].sort((left, right) => left.sequence - right.sequence);
  const best = bySequence.filter(entry => entry.status === "confirmed").at(-1) ?? null;
  if (!best) {
    // "pending" must mean genuinely unresolved; all-failed is effectively
    // unanchored (mirrors @agenttool/collab-zerone src/status.ts).
    const inFlight = bySequence
      .filter(entry => entry.status === "submitted" || entry.status === "ambiguous")
      .at(-1) ?? null;
    if (!inFlight) {
      return {
        ...base,
        status: "unanchored",
        ledger_readable: true,
        anchor: bySequence.at(-1) ? toAnchorRef(bySequence.at(-1) as LedgerEntry) : null,
        lag_events: null,
        reason: `all ${bySequence.length} anchor attempt(s) definitively failed; nothing in flight`,
      };
    }
    return {
      ...base,
      status: "anchor_pending",
      ledger_readable: true,
      anchor: toAnchorRef(inFlight),
      lag_events: null,
      reason: `latest unresolved anchor is ${toAnchorRef(inFlight).status}, not confirmed`,
    };
  }
  // Every state that vouches for history first recomputes the whole journal
  // from genesis — a single-page probe would trust stored hash columns and
  // miss rewrites below the anchored sequence.
  let journalValid: boolean;
  try {
    journalValid = store.verifyJournal(workspaceId);
  } catch {
    journalValid = false;
  }
  if (!journalValid) {
    return {
      ...base,
      status: "anchor_conflict",
      ledger_readable: true,
      anchor: toAnchorRef(best),
      lag_events: null,
      reason: "journal fails full recomputation from genesis; anchored history cannot be vouched for",
    };
  }
  if (best.sequence > workspace.event_head_sequence) {
    return {
      ...base,
      status: "anchor_conflict",
      ledger_readable: true,
      anchor: toAnchorRef(best),
      lag_events: null,
      reason: "confirmed anchor is ahead of the local journal head (journal rewound or wrong database)",
    };
  }
  if (best.sequence === workspace.event_head_sequence) {
    if (best.head_hash === workspace.event_head_hash) {
      return {
        ...base,
        status: "anchored",
        ledger_readable: true,
        anchor: toAnchorRef(best),
        lag_events: 0,
        reason: "journal recomputed from genesis; head equals the latest confirmed anchor",
      };
    }
    return {
      ...base,
      status: "anchor_conflict",
      ledger_readable: true,
      anchor: toAnchorRef(best),
      lag_events: null,
      reason: "journal head hash differs from the confirmed anchor at the same sequence",
    };
  }
  const lag = workspace.event_head_sequence - best.sequence;
  // journalValid means stored hashes equal recomputed hashes, so the stored
  // hash at the anchored sequence is now trustworthy evidence.
  const hashAtAnchor = journalHashAtSequence(store, workspaceId, best.sequence);
  if (hashAtAnchor === null) {
    return {
      ...base,
      status: "anchor_conflict",
      ledger_readable: true,
      anchor: toAnchorRef(best),
      lag_events: null,
      reason: "journal has no verifiable event at the anchored sequence",
    };
  }
  if (hashAtAnchor !== best.head_hash) {
    return {
      ...base,
      status: "anchor_conflict",
      ledger_readable: true,
      anchor: toAnchorRef(best),
      lag_events: null,
      reason: "journal hash at the anchored sequence differs from the anchor (history rewritten)",
    };
  }
  return {
    ...base,
    status: "anchor_stale",
    ledger_readable: true,
    anchor: toAnchorRef(best),
    lag_events: lag,
    reason: `${lag} events recorded after the latest confirmed anchor (anchored prefix recomputed intact)`,
  };
}

function journalHashAtSequence(
  store: CollabStore,
  workspaceId: string,
  sequence: number,
): string | null {
  try {
    const page = store.eventsSince(workspaceId, sequence - 1, 1);
    const event = page.events[0];
    if (!event || event.sequence !== sequence || !page.chain_valid) return null;
    return event.hash;
  } catch {
    return null;
  }
}
