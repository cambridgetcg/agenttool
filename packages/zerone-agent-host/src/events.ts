import { canonicalJson, sha256BytesId } from "@agenttool/wallet";

import { EVENT_HASH_DOMAIN } from "./constants.js";
import type { Sha256Id } from "./types.js";

const UTF8 = new TextEncoder();

export function eventHash(input: {
  readonly ledger_sequence: number;
  readonly operation_id: string;
  readonly sequence: number;
  readonly kind: string;
  readonly at: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly previous_event_hash: Sha256Id;
}): Sha256Id {
  return sha256BytesId(UTF8.encode(`${EVENT_HASH_DOMAIN}\0${canonicalJson(input)}`));
}
