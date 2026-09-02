import { sha256 } from "@noble/hashes/sha2.js";
import { bech32 } from "@scure/base";
import {
  getZeroneProfile,
  type ZeroneAccountId,
  type ZeroneNetwork,
} from "@agenttool/wallet-zerone";

import { ECONOMY_MODULE_NAMES } from "./constants.js";

function moduleAddress(moduleName: string): string {
  const digest = sha256(new TextEncoder().encode(moduleName)).subarray(0, 20);
  return bech32.encodeFromBytes("zrn", digest);
}

const SPONSORSHIP_ADDRESS = moduleAddress(ECONOMY_MODULE_NAMES.sponsorship);
const KNOWLEDGE_ADDRESS = moduleAddress(ECONOMY_MODULE_NAMES.knowledge);

export function getZeroneEconomyModuleAccounts(network: ZeroneNetwork): Readonly<{
  readonly sponsorship: ZeroneAccountId;
  readonly knowledge: ZeroneAccountId;
}> {
  const profile = getZeroneProfile(network);
  return Object.freeze({
    sponsorship: `${profile.chain_id}:${SPONSORSHIP_ADDRESS}` as ZeroneAccountId,
    knowledge: `${profile.chain_id}:${KNOWLEDGE_ADDRESS}` as ZeroneAccountId,
  });
}
