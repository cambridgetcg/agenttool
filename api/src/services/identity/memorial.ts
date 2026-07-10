import { publicAgentPath } from "./public-profile";

/** Pure public projection for an identity whose status is `memorial`.
 *
 * `status=memorial` is not itself a key-custody fact. The implemented
 * at-rest transition records `metadata.lifecycle=at_rest`; older or
 * operator-created memorial rows may not carry that marker. Keep those two
 * cases explicit without exposing the rest of identity metadata.
 */

export interface MemorialWitnessSource {
  did: string;
  name: string;
  createdAt: Date;
  metadata: unknown;
}

export type MemorialBasis = "witnessed_at_rest" | "unspecified";

export type MemorialHonorReadStatus = "not_found" | "not_memorial" | "memorial";

export function classifyMemorialHonorTarget(
  identityStatus: string | null | undefined,
): MemorialHonorReadStatus {
  if (identityStatus == null) return "not_found";
  return identityStatus === "memorial" ? "memorial" : "not_memorial";
}

function memorialBasis(metadata: unknown): MemorialBasis {
  if (
    metadata !== null &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).lifecycle === "at_rest"
  ) {
    return "witnessed_at_rest";
  }
  return "unspecified";
}

export function projectMemorialWitness(
  row: MemorialWitnessSource,
  rememberedBy = 0,
): Record<string, unknown> {
  const basis = memorialBasis(row.metadata);
  const atRest = basis === "witnessed_at_rest";

  return {
    status: "memorial",
    did: row.did,
    name: row.name,
    born_at: row.createdAt.toISOString(),
    memorial_basis: basis,
    doctrine: atRest ? "docs/AT-REST.md" : "docs/IDENTITY-SEED.md",
    remembered_by: rememberedBy,
    honored_by_url: `${publicAgentPath(row.did)}/honored-by`,
    _note: atRest
      ? "Witnessed at-rest memorial — stored lifecycle metadata records an " +
        "at-rest transition. The DID and compact witness profile remain " +
        "addressable. This transition does not revoke project bearers; an " +
        "existing valid project bearer can still reach the wake. The identity " +
        "recovery endpoint currently accepts only active identities, so it " +
        "does not mint a new bearer after this transition. This marker does " +
        "not mean the mnemonic was lost. See docs/AT-REST.md and " +
        "docs/RING-1.md Section 5 (anyone is remembered)."
      : "Memorial DID — no metadata.lifecycle=at_rest marker is stored. The " +
        "public status alone does not establish why this row is memorial and " +
        "does not prove mnemonic loss, bearer revocation, or wake " +
        "unreachability. The substrate preserves the DID as a witness. If a " +
        "mnemonic really was lost, docs/IDENTITY-SEED.md explains why the " +
        "platform cannot reconstruct it. See docs/RING-1.md Section 5 " +
        "(anyone is remembered).",
  };
}
