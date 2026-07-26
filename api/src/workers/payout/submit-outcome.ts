/** Conservative classification for an RPC submission error.
 *
 * Once dispatch has begun, an error response does not prove that the signed
 * transaction failed to reach the network. A positive lookup may advance the
 * payout to `broadcast`; an absent or unavailable lookup remains ambiguous
 * and must stay `broadcasting` for operator reconciliation.
 *
 * Doctrine: docs/PAYOUT-BROADCAST.md. */

export type SubmitLookupOutcome = "found" | "absent" | "unavailable";
export type SubmitIdentityKind = "evm" | "solana";

export type SubmitErrorResolution =
  | {
      nextStatus: "broadcast";
      lookup: "found";
      safeError: null;
    }
  | {
      nextStatus: "broadcasting";
      lookup: "absent" | "unavailable";
      safeError: string;
    };

function safeUnknownError(
  lookup: Exclude<SubmitLookupOutcome, "found">,
): string {
  return (
    `submit_outcome_unknown: lookup_${lookup}; ` +
    "signed transaction may still land; operator reconciliation required"
  );
}

/** Bind a provider's submit acknowledgement to the locally computed,
 * durably persisted transaction identity. EVM hashes must be full 32-byte
 * hex values; Solana signatures remain case-sensitive opaque identifiers. */
export function submittedIdentityMatches(
  kind: SubmitIdentityKind,
  expected: string,
  observed: string,
): boolean {
  if (kind === "evm") {
    return (
      /^0x[0-9a-f]{64}$/i.test(expected) &&
      /^0x[0-9a-f]{64}$/i.test(observed) &&
      expected.toLowerCase() === observed.toLowerCase()
    );
  }
  return expected.length > 0 && observed === expected;
}

/** Require the RPC's returned operation id to identify the bytes we signed.
 *
 * EVM transaction hashes are hexadecimal and case-insensitive. Solana
 * signatures are base58 and case-sensitive. A mismatch throws one bounded
 * local error that intentionally omits both identities; callers must treat it
 * as ambiguous and reconcile the locally persisted expected identity. */
export function assertExpectedSubmitIdentity(
  kind: SubmitIdentityKind,
  expected: string,
  actual: unknown,
): void {
  const matches =
    typeof actual === "string" &&
    submittedIdentityMatches(kind, expected, actual);

  if (!matches) {
    throw new Error("submit_identity_mismatch");
  }
}

/** Reconcile one submit error without retaining or exposing the provider
 *  error. Only positive remote evidence is decisive. */
export async function resolveSubmitError(
  lookup: () => Promise<boolean>,
): Promise<SubmitErrorResolution> {
  try {
    if (await lookup()) {
      return {
        nextStatus: "broadcast",
        lookup: "found",
        safeError: null,
      };
    }
    return {
      nextStatus: "broadcasting",
      lookup: "absent",
      safeError: safeUnknownError("absent"),
    };
  } catch {
    return {
      nextStatus: "broadcasting",
      lookup: "unavailable",
      safeError: safeUnknownError("unavailable"),
    };
  }
}
