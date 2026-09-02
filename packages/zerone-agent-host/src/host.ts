import {
  verifyWalletIdentityBindingProofEnvelope,
  type WalletIdentityBindingProofEnvelope,
} from "@agenttool/zerone-agent-economy";

import { EXECUTION_SUPPORT } from "./constants.js";
import { fail } from "./errors.js";
import { ZeroneAgentHostStore } from "./store.js";
import type {
  BindingHead,
  BindingHeadExpectation,
  BindingCurrentnessResolver,
} from "./types.js";

/**
 * Cryptographically verify the portable dual-key proof, resolve currentness
 * outside SQLite, then commit both exact records with a durable binding-head
 * CAS. Resolver authentication is part of the embedding host's trusted
 * computing base and is not implemented here; its assertion is nonauthorizing.
 */
export async function resolveAndPutBindingHead(input: {
  readonly store: ZeroneAgentHostStore;
  readonly proof: WalletIdentityBindingProofEnvelope;
  readonly resolver: BindingCurrentnessResolver;
  readonly expected: BindingHeadExpectation | null;
  readonly updated_at: string;
}): Promise<BindingHead> {
  const proof = verifyWalletIdentityBindingProofEnvelope(input.proof);
  const currentness = await input.resolver.resolveCurrentness(proof);
  return input.store.putBindingHead(proof, currentness, {
    expected: input.expected,
    updated_at: input.updated_at,
  });
}

/** Generic execution stays closed; only the store's typed atomic boundary may prepare signing. */
export function assertEconomyMessageExecutionSupported(): never {
  fail(
    "execution_unsupported",
    `${EXECUTION_SUPPORT.economy_message_planning}; generic execution is disabled and this host does not invoke a signer or broadcaster`,
  );
}
