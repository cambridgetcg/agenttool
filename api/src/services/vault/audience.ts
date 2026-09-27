/** Vault audiences bind canonical project identities, not labels. Doctrine: docs/IDENTITY-PARTITIONS.md. */
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { abort } from "../../lib/errors";
import { authorizeIdentityRead, authorityRequestTarget } from "../identity/authority";
import { canonicalIdentityId, requireActiveProjectIdentity, type PartitionDatabase } from "../identity/partition";

export const vaultAudienceSchema = z.array(z.string().max(64)).max(100).nullable();

function refuseAudience(stored: boolean): never {
  return abort({
    error: stored ? "vault_audience_invalid" : "vault_audience_not_owned",
    message: stored
      ? "This stored audience cannot be resolved entirely to identities in this project."
      : "Every audience member must be an active identity owned by this project.",
    hint: "A project administrator can explicitly replace the audience: null shares within the project; [] denies value reads; a list selects canonical identities.",
    docs: "https://docs.agenttool.dev/IDENTITY-PARTITIONS.md",
  }, stored ? 403 : 400);
}

/** Null is shared, [] is empty, and a nonempty audience is a finite identity set. */
export function canonicalVaultAudience(value: unknown, stored = false): string[] | null {
  const parsed = vaultAudienceSchema.safeParse(value);
  if (!parsed.success) return refuseAudience(stored);
  if (parsed.data === null) return null;
  const ids = parsed.data.map(canonicalIdentityId);
  if (ids.some((id) => id === null)) return refuseAudience(stored);
  return [...new Set(ids as string[])].sort();
}

/** Validate the complete set; dropping a foreign/legacy member would silently change policy. */
export async function validateVaultAudience(
  projectId: string,
  value: unknown,
  options: { stored?: boolean; database?: PartitionDatabase } = {},
): Promise<string[] | null> {
  const audience = canonicalVaultAudience(value, options.stored);
  if (audience === null || audience.length === 0) return audience;
  const rows = await (options.database ?? db)
    .select({ id: identities.id, projectId: identities.projectId, status: identities.status })
    .from(identities)
    .where(and(eq(identities.projectId, projectId), inArray(identities.id, audience)));
  if (audience.some((id) => !rows.some((row) =>
    row.id === id && row.projectId === projectId && (options.stored || row.status === "active")
  ))) return refuseAudience(!!options.stored);
  return audience;
}

export function refuseVaultRead(): never {
  return abort({
    error: "vault_audience_denied",
    message: "This secret's audience does not authorize the selected identity.",
    hint: "Restricted HTTP reads require an owned active identity and its exact GET root proof. A project administrator may explicitly change the policy.",
    docs: "https://docs.agenttool.dev/IDENTITY-PARTITIONS.md",
  }, 403);
}

/** A bearer manages the project; a restricted value read additionally proves the selected root. */
export async function authorizeVaultHttpRead(input: {
  projectId: string;
  audience: unknown;
  selectedIdentity: string | null;
  request: Request;
}): Promise<string | null> {
  const audience = await validateVaultAudience(input.projectId, input.audience, { stored: true });
  if (audience === null) return null; // No assertion that an optional header label was authenticated.
  const id = canonicalIdentityId(input.selectedIdentity);
  if (!id || !audience.includes(id)) return refuseVaultRead();
  const identity = await requireActiveProjectIdentity(input.projectId, id);
  const proof = await authorizeIdentityRead({
    identityId: identity.id,
    method: input.request.method,
    requestTarget: authorityRequestTarget(input.request.url),
    bodyBytes: new Uint8Array(await input.request.arrayBuffer()),
    headers: input.request.headers,
  });
  if (!proof.ok) abort(proof.body, proof.status);
  return identity.id;
}
