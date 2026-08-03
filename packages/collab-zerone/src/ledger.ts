import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { ANCHOR_LEDGER_PROTOCOL } from "./constants.js";

export type AnchorEntryStatus = "submitted" | "confirmed" | "failed" | "ambiguous";

export interface AnchorEntry {
  id: string;
  workspace_id: string;
  epoch_id: string;
  sequence: number;
  head_hash: string;
  network: string;
  caip2: string;
  account: string;
  memo: string;
  tx_hash: string | null;
  status: AnchorEntryStatus;
  submitted_at: string;
  confirmed_at?: string;
  confirmed_height?: number;
  note?: string;
}

export interface AnchorLedger {
  protocol: typeof ANCHOR_LEDGER_PROTOCOL;
  updated_at: string;
  anchors: AnchorEntry[];
}

const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;

/**
 * Advisory exclusive lock around every load→mutate→save cycle. The tmp+rename
 * in saveLedger is atomic per writer but does not serialise writers: without
 * this, two concurrent anchor runs can interleave loads and silently drop each
 * other's entries — including the pre-broadcast "submitted" record whose whole
 * purpose is to survive.
 */
export function withLedgerLock<T>(path: string, fn: () => T): T {
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const fd = openSync(lockPath, "wx");
      writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
      closeSync(fd);
      break;
    } catch {
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        // lock vanished between attempts; retry immediately
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`could not acquire ledger lock ${lockPath} within ${LOCK_TIMEOUT_MS}ms`);
      }
      Bun.sleepSync(LOCK_RETRY_MS);
    }
  }
  try {
    return fn();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // already removed (stale takeover); nothing to release
    }
  }
}

export function emptyLedger(now: string = new Date().toISOString()): AnchorLedger {
  return { protocol: ANCHOR_LEDGER_PROTOCOL, updated_at: now, anchors: [] };
}

export function loadLedger(path: string): AnchorLedger {
  if (!existsSync(path)) return emptyLedger();
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<AnchorLedger> | null;
  if (parsed?.protocol !== ANCHOR_LEDGER_PROTOCOL || !Array.isArray(parsed.anchors)) {
    throw new Error(`${path} is not a ${ANCHOR_LEDGER_PROTOCOL} ledger`);
  }
  return parsed as AnchorLedger;
}

export function saveLedger(path: string, ledger: AnchorLedger): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const body = { ...ledger, updated_at: new Date().toISOString() };
  writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

export function newAnchorEntry(
  fields: Omit<AnchorEntry, "id" | "status" | "submitted_at" | "tx_hash">
    & Partial<Pick<AnchorEntry, "status" | "tx_hash">>,
): AnchorEntry {
  return {
    tx_hash: null,
    status: "submitted",
    ...fields,
    id: `anchor_${randomUUID()}`,
    submitted_at: new Date().toISOString(),
  };
}

export function appendAnchor(path: string, entry: AnchorEntry): AnchorLedger {
  return withLedgerLock(path, () => {
    const ledger = loadLedger(path);
    ledger.anchors.push(entry);
    saveLedger(path, ledger);
    return ledger;
  });
}

export function patchAnchor(path: string, id: string, patch: Partial<AnchorEntry>): AnchorEntry {
  return withLedgerLock(path, () => {
    const ledger = loadLedger(path);
    const index = ledger.anchors.findIndex(anchor => anchor.id === id);
    const existing = ledger.anchors[index];
    if (!existing) throw new Error(`anchor ${id} not found in ${path}`);
    const updated = { ...existing, ...patch };
    ledger.anchors[index] = updated;
    saveLedger(path, ledger);
    return updated;
  });
}

/**
 * Patch by id, or restore the full entry (with the patch applied) if it has
 * vanished. Post-broadcast outcome writes go through this: a record of a
 * transaction that may exist on chain must never be lost to a race or crash.
 */
export function recordAnchorOutcome(
  path: string,
  entry: AnchorEntry,
  patch: Partial<AnchorEntry>,
): AnchorEntry {
  return withLedgerLock(path, () => {
    const ledger = loadLedger(path);
    const index = ledger.anchors.findIndex(anchor => anchor.id === entry.id);
    const updated = { ...(index === -1 ? entry : ledger.anchors[index] as AnchorEntry), ...patch };
    if (index === -1) ledger.anchors.push(updated);
    else ledger.anchors[index] = updated;
    saveLedger(path, ledger);
    return updated;
  });
}

export function anchorsForWorkspace(
  ledger: AnchorLedger,
  workspaceId: string,
  epochId?: string,
  network?: string,
): AnchorEntry[] {
  return ledger.anchors
    .filter(anchor => anchor.workspace_id === workspaceId
      && (epochId === undefined || anchor.epoch_id === epochId)
      && (network === undefined || anchor.network === network))
    .sort((left, right) => left.sequence - right.sequence);
}

export function latestConfirmedAnchor(
  ledger: AnchorLedger,
  workspaceId: string,
  epochId: string,
  network?: string,
): AnchorEntry | null {
  const confirmed = anchorsForWorkspace(ledger, workspaceId, epochId, network)
    .filter(anchor => anchor.status === "confirmed");
  return confirmed.at(-1) ?? null;
}
