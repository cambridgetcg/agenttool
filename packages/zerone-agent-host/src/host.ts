import type { WalletIdentityBinding } from "@agenttool/zerone-agent-economy";

import { EXECUTION_SUPPORT } from "./constants.js";
import { fail } from "./errors.js";
import { ZeroneAgentHostStore } from "./store.js";
import type {
  BindingHead,
  BindingHeadExpectation,
  BindingProofCurrentnessResolver,
} from "./types.js";

/**
 * Resolve proof currentness outside SQLite, then commit the exact returned
 * reference with a durable binding-head CAS. The resolver is part of the
 * embedding host's trusted computing base and is not implemented here.
 */
export async function resolveAndPutBindingHead(input: {
  readonly store: ZeroneAgentHostStore;
  readonly binding: WalletIdentityBinding;
  readonly resolver: BindingProofCurrentnessResolver;
  readonly expected: BindingHeadExpectation | null;
  readonly updated_at: string;
}): Promise<BindingHead> {
  const proof = await input.resolver.resolveCurrentProof(input.binding);
  return input.store.putBindingHead(input.binding, proof, {
    expected: input.expected,
    updated_at: input.updated_at,
  });
}

/** Always throws in v0 so callers cannot mistake ledger readiness for execution readiness. */
export function assertEconomyMessageExecutionSupported(): never {
  fail(
    "execution_unsupported",
    `${EXECUTION_SUPPORT.economy_message_planning}; this ledger cannot plan, sign, or broadcast Zerone economy messages`,
  );
}
