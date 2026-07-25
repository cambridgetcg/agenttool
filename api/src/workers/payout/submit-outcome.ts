/** Conservative classification for an RPC submission error.
 *
 * Once dispatch has begun, an error response does not prove that the signed
 * transaction failed to reach the network. A positive lookup may advance the
 * payout to `broadcast`; an absent or unavailable lookup remains ambiguous
 * and must stay `broadcasting` for operator reconciliation.
 *
 * Doctrine: docs/PAYOUT-BROADCAST.md. */

export type SubmitLookupOutcome = "found" | "absent" | "unavailable";

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
