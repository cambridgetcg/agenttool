import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  ANCHOR_ALIAS_HEX_CHARS,
  ANCHOR_MEMO_PROTOCOL,
  ANCHOR_SALT_BYTES,
  MAX_MEMO_CHARS,
} from "./constants.js";
import { entryMemoProtocol, type AnchorEntry, type AnchorLedger } from "./ledger.js";
import { parseAliasedAnchorMemo } from "./memo.js";

/**
 * Salted aliases for `agenttool.collab-anchor/0.2` memos.
 *
 * A Collab `ws_` id is a truncated sha256 of a local path (packages/collab
 * src/store.ts, src/repository.ts), so a memo carrying it lets anyone confirm
 * a guessed path. 0.2 memos carry the first 32 hex chars of
 * HMAC-SHA256(key = salt, message = id) instead. The salt is 32 random bytes
 * kept beside the ledger with mode 0600, created on first use and never
 * published. Without it no recorded alias can be re-derived, so every caller
 * that needs it fails closed; a replacement salt is never minted over
 * existing aliases.
 */

export type AnchorSaltProblem = "missing" | "unreadable" | "malformed" | "permissions" | "mismatch";

export class AnchorSaltError extends Error {
  constructor(readonly problem: AnchorSaltProblem, message: string) {
    super(message);
    this.name = "AnchorSaltError";
  }
}

export function anchorSaltPath(ledgerPath: string): string {
  return `${ledgerPath}.salt`;
}

function aliasOf(salt: Uint8Array, message: string): string {
  return createHmac("sha256", salt).update(message, "utf8").digest("hex").slice(0, ANCHOR_ALIAS_HEX_CHARS);
}

/** First 32 hex of HMAC-SHA256(key = salt, message = workspace_id). */
export function workspaceAlias(salt: Uint8Array, workspaceId: string): string {
  return aliasOf(salt, workspaceId);
}

/**
 * Epoch ids are random UUIDs, not path hashes, but they are linkable: the raw
 * id sits beside the `ws_` id in legacy 0.1 memos and travels in Collab
 * cursors and event anchors. Publishing it would tie a new alias straight back
 * to an already-published `ws_` id, so it is aliased with the same salt. The
 * "epoch " label keeps the two alias domains apart: a workspace id never
 * contains a space.
 */
export function epochAlias(salt: Uint8Array, epochId: string): string {
  return aliasOf(salt, `epoch ${epochId}`);
}

const SALT_TEXT = new RegExp(`^([0-9a-f]{${ANCHOR_SALT_BYTES * 2}})\\n?$`);
const MAX_SALT_FILE_BYTES = ANCHOR_SALT_BYTES * 2 + 1;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Read an existing salt. Never creates one. */
export function readAnchorSalt(path: string): Buffer {
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new AnchorSaltError("missing", `anchor alias salt ${path} does not exist`);
    }
    throw new AnchorSaltError("unreadable", `anchor alias salt ${path} is unreadable (${errorText(error)})`);
  }
  if (!stat.isFile() || stat.size > MAX_SALT_FILE_BYTES) {
    throw new AnchorSaltError("malformed", `anchor alias salt ${path} is not a salt file`);
  }
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new AnchorSaltError(
      "permissions",
      `anchor alias salt ${path} is accessible to other users (mode ${(stat.mode & 0o777).toString(8)}); chmod 600 it`,
    );
  }
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new AnchorSaltError("unreadable", `anchor alias salt ${path} is unreadable (${errorText(error)})`);
  }
  const match = SALT_TEXT.exec(text);
  if (!match) throw new AnchorSaltError("malformed", `anchor alias salt ${path} is not ${ANCHOR_SALT_BYTES} hex-encoded bytes`);
  return Buffer.from(match[1] as string, "hex");
}

function missingSaltError(path: string, dependents: number): AnchorSaltError {
  return new AnchorSaltError(
    "missing",
    `anchor alias salt ${path} is missing, but the ledger records ${dependents} ${ANCHOR_MEMO_PROTOCOL}`
      + " anchor(s) whose aliases cannot be re-derived without it. Restore the salt from a backup of the"
      + " ledger directory; a new salt is never created over existing aliases.",
  );
}

function aliasedEntryCount(entries: readonly AnchorEntry[]): number {
  return entries.filter(entry => entryMemoProtocol(entry) === ANCHOR_MEMO_PROTOCOL).length;
}

/**
 * Read the salt that `dependents` (the 0.2 entries being checked) rely on,
 * explaining a loss in their terms. Never creates one.
 */
export function requireAnchorSalt(path: string, dependents: readonly AnchorEntry[]): Buffer {
  try {
    return readAnchorSalt(path);
  } catch (error) {
    if (error instanceof AnchorSaltError && error.problem === "missing") {
      throw missingSaltError(path, aliasedEntryCount(dependents));
    }
    throw error;
  }
}

function createAnchorSalt(path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeSync(fd, `${randomBytes(ANCHOR_SALT_BYTES).toString("hex")}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    // link() is atomic and never replaces an existing file, so two first-use
    // anchors cannot leave the ledger with aliases from two different salts.
    linkSync(tmp, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    unlinkSync(tmp);
  }
}

/**
 * The existing salt, or null when it is missing and may be created because no
 * recorded alias depends on an earlier one. Any 0.2 entry in the ledger proves
 * a salt existed, so a missing salt then fails closed instead of silently
 * forking every alias. Never creates anything.
 */
export function peekAnchorSalt(path: string, ledger: AnchorLedger): Buffer | null {
  try {
    return readAnchorSalt(path);
  } catch (error) {
    if (!(error instanceof AnchorSaltError) || error.problem !== "missing") throw error;
  }
  const dependents = aliasedEntryCount(ledger.anchors);
  if (dependents > 0) throw missingSaltError(path, dependents);
  return null;
}

/** Load the salt, creating it on first use under the same rule as peekAnchorSalt. */
export function ensureAnchorSalt(path: string, ledger: AnchorLedger): { salt: Buffer; created: boolean } {
  const existing = peekAnchorSalt(path, ledger);
  if (existing) return { salt: existing, created: false };
  createAnchorSalt(path);
  // Read back whichever salt won a concurrent first use.
  return { salt: readAnchorSalt(path), created: true };
}

/**
 * Why a recorded 0.2 entry is not bound to its own workspace and epoch, or
 * null when it is: both aliases re-derive from the salt, and the recorded memo
 * carries exactly those aliases, the sequence and the head hash.
 */
export function aliasBindingProblem(entry: AnchorEntry, salt: Uint8Array | null): string | null {
  if (entryMemoProtocol(entry) !== ANCHOR_MEMO_PROTOCOL) return `not an ${ANCHOR_MEMO_PROTOCOL} entry`;
  if (!salt) return "anchor alias salt unavailable; aliases cannot be re-derived";
  const expectedWorkspace = workspaceAlias(salt, entry.workspace_id);
  const expectedEpoch = epochAlias(salt, entry.epoch_id);
  if (entry.workspace_alias !== expectedWorkspace || entry.epoch_alias !== expectedEpoch) {
    return "recorded aliases do not re-derive from this workspace and epoch with the anchor salt";
  }
  const memo = typeof entry.memo === "string" && entry.memo.length <= MAX_MEMO_CHARS
    ? parseAliasedAnchorMemo(entry.memo)
    : null;
  if (!memo || memo.workspace_alias !== expectedWorkspace || memo.epoch_alias !== expectedEpoch
    || memo.sequence !== entry.sequence || memo.head_hash !== entry.head_hash) {
    return "recorded memo does not carry this entry's aliases, sequence and head hash";
  }
  return null;
}

/**
 * Fail closed unless the salt reproduces every 0.2 entry in the ledger. A
 * replaced salt (or an edited entry) would otherwise publish aliases that no
 * longer match the workspace's earlier anchors.
 */
export function assertSaltReproducesLedger(path: string, salt: Uint8Array, ledger: AnchorLedger): void {
  const broken = ledger.anchors.filter(entry =>
    entryMemoProtocol(entry) === ANCHOR_MEMO_PROTOCOL && aliasBindingProblem(entry, salt) !== null);
  if (broken.length === 0) return;
  throw new AnchorSaltError(
    "mismatch",
    `anchor alias salt ${path} does not reproduce the aliases recorded for ${broken.length} ${ANCHOR_MEMO_PROTOCOL}`
      + ` ledger entr${broken.length === 1 ? "y" : "ies"} (first: ${broken[0]?.id}); the salt was replaced or the`
      + " entries were edited. Restore the original salt before anchoring.",
  );
}
