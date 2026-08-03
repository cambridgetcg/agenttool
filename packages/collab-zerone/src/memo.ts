import { ANCHOR_MEMO_PROTOCOL, MAX_MEMO_CHARS } from "./constants.js";

export interface AnchorMemo {
  workspace_id: string;
  epoch_id: string;
  sequence: number;
  head_hash: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MEMO_PATTERN = new RegExp(
  `^${escapeRegExp(ANCHOR_MEMO_PROTOCOL)} ws=(\\S{1,200}) epoch=(\\S{1,200}) seq=([1-9][0-9]{0,15}) head=([0-9a-f]{64})$`,
);

export function buildAnchorMemo(anchor: AnchorMemo): string {
  if (!/^\S{1,200}$/.test(anchor.workspace_id)) throw new Error("invalid workspace_id for anchor memo");
  if (!/^\S{1,200}$/.test(anchor.epoch_id)) throw new Error("invalid epoch_id for anchor memo");
  if (!Number.isSafeInteger(anchor.sequence) || anchor.sequence < 1) {
    throw new Error("invalid sequence for anchor memo");
  }
  if (!/^[0-9a-f]{64}$/.test(anchor.head_hash)) throw new Error("invalid head_hash for anchor memo");
  const memo = `${ANCHOR_MEMO_PROTOCOL} ws=${anchor.workspace_id} epoch=${anchor.epoch_id}`
    + ` seq=${anchor.sequence} head=${anchor.head_hash}`;
  // zerone-1 genesis caps memos at 256 chars; the ante layer also DID-validates
  // memos starting "did:zrn:", which our protocol prefix can never produce.
  if (memo.length > MAX_MEMO_CHARS) {
    throw new Error(`anchor memo is ${memo.length} chars; the chain caps memos at ${MAX_MEMO_CHARS}`);
  }
  return memo;
}

export function parseAnchorMemo(memo: string): AnchorMemo | null {
  const match = MEMO_PATTERN.exec(memo);
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
