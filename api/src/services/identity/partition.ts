/** Project ownership and subject binding, distinct from authentication. Doctrine: docs/IDENTITY-PARTITIONS.md. */
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve only AgentTool's UUID/application-DID aliases; labels confer no identity. */
export function canonicalIdentityId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.startsWith("did:at:") ? value.slice(7) : value;
  return UUID.test(candidate) ? candidate.toLowerCase() : null;
}

export class IdentityPartitionError extends HTTPException {
  constructor(reason: "not_owned" | "conflict" | "invalid" = "not_owned") {
    const error = reason === "not_owned"
      ? "identity_not_found_or_not_owned"
      : reason === "conflict" ? "identity_subject_conflict" : "invalid_identity_selector";
    const message = reason === "not_owned"
      ? "The selected identity must be active and owned by the authenticated project."
      : reason === "conflict"
        ? "identity_id and the identity locator in agent_id must select the same subject."
        : "Use an identity UUID or its did:at:UUID application identifier.";
    super(reason === "not_owned" ? 404 : 400, {
      message,
      cause: {
        error, message,
        hint: "Select an owned identity explicitly; a label is not identity authority.",
        docs: "https://docs.agenttool.dev/IDENTITY-PARTITIONS.md",
        next_actions: [{ action: "Inspect identities in this project", method: "GET", path: "/v1/identities" }],
      },
    });
    this.name = "IdentityPartitionError";
  }
}

export type PartitionDatabase = Pick<typeof db, "select">;
export interface PartitionOptions {
  database?: PartitionDatabase;
  /** Use only inside a caller-owned transaction; retained until that transaction ends. */
  lock?: boolean;
}

/** Ownership is necessary for a binding, but does not prove control of its signing key. */
export async function requireActiveProjectIdentity(
  projectId: string,
  identityId: string,
  options: PartitionOptions = {},
): Promise<{ id: string; projectId: string; did: string; status: string }> {
  const id = canonicalIdentityId(identityId);
  if (!id) throw new IdentityPartitionError("invalid");
  const query = (options.database ?? db)
    .select({ id: identities.id, projectId: identities.projectId, did: identities.did, status: identities.status })
    .from(identities)
    .where(and(eq(identities.id, id), eq(identities.projectId, projectId), eq(identities.status, "active")));
  const [row] = options.lock ? await query.for("share").limit(1) : await query.limit(1);
  if (!row || row.id.toLowerCase() !== id || row.projectId !== projectId || row.status !== "active") {
    throw new IdentityPartitionError();
  }
  return row;
}

/** Establish the canonical binding without rewriting caller bytes used by existing signature formats. */
export async function resolveProjectSubject(
  projectId: string,
  data: { identity_id?: string | null; agent_id?: string | null },
  options: PartitionOptions = {},
): Promise<{ identityId: string | null; agentId: string | null }> {
  const alias = canonicalIdentityId(data.agent_id);
  const explicit = data.identity_id == null ? null : canonicalIdentityId(data.identity_id);
  if ((data.identity_id != null && !explicit)
    || (typeof data.agent_id === "string" && data.agent_id.startsWith("did:at:") && !alias)) {
    throw new IdentityPartitionError("invalid");
  }
  if (alias && (data.identity_id === null || (explicit && explicit !== alias))) {
    throw new IdentityPartitionError("conflict");
  }
  const selected = explicit ?? alias;
  if (!selected) return { identityId: null, agentId: data.agent_id ?? null };
  const identity = await requireActiveProjectIdentity(projectId, selected, options);
  return { identityId: identity.id, agentId: data.agent_id ?? null };
}

/** Read-side ownership for "my own …" surfaces keyed by DID: the identity
 *  must belong to the authenticated project. Unknown and foreign DIDs are
 *  the same answer (null) so a read never reveals that a foreign identity
 *  exists. Status is not required — an owning project may still read a
 *  revoked or memorial identity's own record.
 *  Tested: api/tests/cross-project-identity-reads.test.ts */
export async function projectOwnedIdentityByDid(
  projectId: string,
  did: string,
  options: PartitionOptions = {},
): Promise<{ id: string; did: string } | null> {
  const [row] = await (options.database ?? db)
    .select({ id: identities.id, did: identities.did })
    .from(identities)
    .where(and(eq(identities.did, did), eq(identities.projectId, projectId)))
    .limit(1);
  return row ?? null;
}
