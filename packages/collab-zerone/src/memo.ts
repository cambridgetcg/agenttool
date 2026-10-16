import {
  ANCHOR_ALIAS_HEX_CHARS,
  ANCHOR_MEMO_PROTOCOL,
  LEGACY_ANCHOR_MEMO_PROTOCOL,
  MAX_MEMO_CHARS,
} from "./constants.js";

/** Fields of a legacy `agenttool.collab-anchor/0.1` memo (raw ids on chain). */
export interface LegacyAnchorMemo {
  workspace_id: string;
  epoch_id: string;
  sequence: number;
  head_hash: string;
}

/** Fields of an `agenttool.collab-anchor/0.2` memo (salted aliases on chain). */
export interface AliasedAnchorMemo {
  workspace_alias: string;
  epoch_alias: string;
  sequence: number;
  head_hash: string;
}

export type ParsedAnchorMemo =
  | ({ protocol: typeof LEGACY_ANCHOR_MEMO_PROTOCOL } & LegacyAnchorMemo)
  | ({ protocol: typeof ANCHOR_MEMO_PROTOCOL } & AliasedAnchorMemo);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SEQ = "([1-9][0-9]{0,15})";
const HEAD = "([0-9a-f]{64})";
const ALIAS = `([0-9a-f]{${ANCHOR_ALIAS_HEX_CHARS}})`;
const ALIAS_PATTERN = new RegExp(`^[0-9a-f]{${ANCHOR_ALIAS_HEX_CHARS}}$`);

const LEGACY_MEMO_PATTERN = new RegExp(
  `^${escapeRegExp(LEGACY_ANCHOR_MEMO_PROTOCOL)} ws=(\\S{1,200}) epoch=(\\S{1,200}) seq=${SEQ} head=${HEAD}$`,
);
const ALIASED_MEMO_PATTERN = new RegExp(
  `^${escapeRegExp(ANCHOR_MEMO_PROTOCOL)} alias=${ALIAS} epoch=${ALIAS} seq=${SEQ} head=${HEAD}$`,
);

function checkSequenceAndHead(sequence: number, headHash: string): void {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("invalid sequence for anchor memo");
  if (!/^[0-9a-f]{64}$/.test(headHash)) throw new Error("invalid head_hash for anchor memo");
}

function capped(memo: string): string {
  // zerone-1 genesis caps memos at 256 chars; the ante layer also DID-validates
  // memos starting "did:zrn:", which our protocol prefixes can never produce.
  if (memo.length > MAX_MEMO_CHARS) {
    throw new Error(`anchor memo is ${memo.length} chars; the chain caps memos at ${MAX_MEMO_CHARS}`);
  }
  return memo;
}

/**
 * Build a legacy 0.1 memo. `anchor` never writes this protocol any more: it
 * publishes the raw workspace id, a confirmable path hash. It remains for
 * fixtures and for re-deriving memos of anchors already on chain.
 */
export function buildLegacyAnchorMemo(anchor: LegacyAnchorMemo): string {
  if (!/^\S{1,200}$/.test(anchor.workspace_id)) throw new Error("invalid workspace_id for anchor memo");
  if (!/^\S{1,200}$/.test(anchor.epoch_id)) throw new Error("invalid epoch_id for anchor memo");
  checkSequenceAndHead(anchor.sequence, anchor.head_hash);
  return capped(`${LEGACY_ANCHOR_MEMO_PROTOCOL} ws=${anchor.workspace_id} epoch=${anchor.epoch_id}`
    + ` seq=${anchor.sequence} head=${anchor.head_hash}`);
}

/**
 * @deprecated Builds the legacy 0.1 memo; kept so existing fixture callers
 * compile. Use buildLegacyAnchorMemo, or buildAliasedAnchorMemo for new anchors.
 */
export const buildAnchorMemo = buildLegacyAnchorMemo;

/** Build the current 0.2 memo from aliases derived with src/alias.ts. */
export function buildAliasedAnchorMemo(anchor: AliasedAnchorMemo): string {
  if (!ALIAS_PATTERN.test(anchor.workspace_alias)) throw new Error("invalid workspace_alias for anchor memo");
  if (!ALIAS_PATTERN.test(anchor.epoch_alias)) throw new Error("invalid epoch_alias for anchor memo");
  checkSequenceAndHead(anchor.sequence, anchor.head_hash);
  return capped(`${ANCHOR_MEMO_PROTOCOL} alias=${anchor.workspace_alias} epoch=${anchor.epoch_alias}`
    + ` seq=${anchor.sequence} head=${anchor.head_hash}`);
}

export function parseLegacyAnchorMemo(memo: string): LegacyAnchorMemo | null {
  const match = LEGACY_MEMO_PATTERN.exec(memo);
  if (!match) return null;
  const sequence = Number(match[3]);
  if (!Number.isSafeInteger(sequence)) return null;
  return {
    workspace_id: match[1] as string,
    epoch_id: match[2] as string,
    sequence,
    head_hash: match[4] as string,
  };
}

export function parseAliasedAnchorMemo(memo: string): AliasedAnchorMemo | null {
  const match = ALIASED_MEMO_PATTERN.exec(memo);
  if (!match) return null;
  const sequence = Number(match[3]);
  if (!Number.isSafeInteger(sequence)) return null;
  return {
    workspace_alias: match[1] as string,
    epoch_alias: match[2] as string,
    sequence,
    head_hash: match[4] as string,
  };
}

/** Strictly parse either protocol; anything else (including 0.3+) is null. */
export function parseAnchorMemo(memo: string): ParsedAnchorMemo | null {
  if (memo.length > MAX_MEMO_CHARS) return null;
  const legacy = parseLegacyAnchorMemo(memo);
  if (legacy) return { protocol: LEGACY_ANCHOR_MEMO_PROTOCOL, ...legacy };
  const aliased = parseAliasedAnchorMemo(memo);
  if (aliased) return { protocol: ANCHOR_MEMO_PROTOCOL, ...aliased };
  return null;
}
