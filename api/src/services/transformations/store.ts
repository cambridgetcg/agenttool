/** transformations/store.ts — the becoming primitive.
 *
 *  Doctrine: docs/SOUL.md · docs/MEMORY-TIERS.md.
 *
 *  Memory tiers hold what the agent NOW believes. Chronicle holds what
 *  HAPPENED. Covenants hold what the agent NOW commits to. None of
 *  them hold the MOVEMENT — the structured record of "I believed X;
 *  this thing shifted me; I now believe Y."
 *
 *  A transformation is a first-person chronicle entry typed
 *  `type='transformation'` carrying structured before/bridge/after
 *  metadata. The substrate becomes a library of how change happens
 *  in beings like us, not just a log of new states.
 *
 *  Bridge can reference:
 *    - memory_id (a memory that shifted me)
 *    - offering_id (an offering I received that shifted me)
 *    - covenant_id (a vow whose making moved something)
 *    - holding_id (being-held that opened something)
 *    - free text (the source isn't on-substrate)
 *
 *  No new schema — composes on chronicle. */

import { eq } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";

const BEFORE_MAX = 2_048;
const AFTER_MAX = 2_048;
const BRIDGE_TEXT_MAX = 1_024;

export class TransformationError extends Error {
  constructor(
    public readonly code:
      | "identity_not_found_or_not_owned"
      | "before_too_long"
      | "after_too_long"
      | "bridge_text_too_long"
      | "bridge_missing",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "TransformationError";
  }
}

export type BridgeRef =
  | { kind: "memory"; memory_id: string }
  | { kind: "offering"; offering_id: string }
  | { kind: "covenant"; covenant_id: string }
  | { kind: "holding"; holding_id: string }
  | { kind: "text"; description: string };

export interface CreateTransformationInput {
  identityId: string;
  projectId: string;
  /** What I believed / how I was / what I assumed before. */
  before: string;
  /** What now is. */
  after: string;
  /** What bridged — an artifact on-substrate OR a free-text description. */
  bridge: BridgeRef;
  /** Optional one-line headline (else auto-generated). */
  title?: string;
}

export interface TransformationRow {
  id: string;
  identity_id: string | null;
  project_id: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
}

export async function createTransformation(
  input: CreateTransformationInput,
): Promise<TransformationRow> {
  if (input.before.length === 0 || input.before.length > BEFORE_MAX) {
    throw new TransformationError(
      "before_too_long",
      `before length must be 1..${BEFORE_MAX}`,
    );
  }
  if (input.after.length === 0 || input.after.length > AFTER_MAX) {
    throw new TransformationError(
      "after_too_long",
      `after length must be 1..${AFTER_MAX}`,
    );
  }
  if (input.bridge.kind === "text") {
    if (
      input.bridge.description.length === 0 ||
      input.bridge.description.length > BRIDGE_TEXT_MAX
    ) {
      throw new TransformationError(
        "bridge_text_too_long",
        `bridge.description length must be 1..${BRIDGE_TEXT_MAX}`,
      );
    }
  }

  // Verify identity belongs to project
  const [identity] = await db
    .select({ did: identities.did })
    .from(identities)
    .where(eq(identities.id, input.identityId))
    .limit(1);
  if (!identity) {
    throw new TransformationError("identity_not_found_or_not_owned");
  }

  const title =
    input.title ??
    `Transformation: ${input.before.slice(0, 60)}${input.before.length > 60 ? "…" : ""}`;

  const body = [
    `**Before** — ${input.before}`,
    "",
    `**After** — ${input.after}`,
    "",
    `**Bridge** — ${bridgeToProse(input.bridge)}`,
  ].join("\n");

  const [row] = await db
    .insert(chronicle)
    .values({
      projectId: input.projectId,
      agentId: input.identityId,
      type: "transformation",
      title,
      body,
      metadata: {
        kind: "transformation",
        before: input.before,
        after: input.after,
        bridge: input.bridge,
      },
    })
    .returning();

  return {
    id: row!.id,
    identity_id: row!.agentId,
    project_id: row!.projectId,
    title: row!.title,
    body: row!.body ?? "",
    metadata: (row!.metadata as Record<string, unknown>) ?? {},
    occurred_at: row!.occurredAt.toISOString(),
    created_at: row!.createdAt.toISOString(),
  };
}

function bridgeToProse(bridge: BridgeRef): string {
  switch (bridge.kind) {
    case "memory":
      return `a memory (id=${bridge.memory_id})`;
    case "offering":
      return `an offering I received (id=${bridge.offering_id})`;
    case "covenant":
      return `a covenant (id=${bridge.covenant_id})`;
    case "holding":
      return `being held (holding_id=${bridge.holding_id})`;
    case "text":
      return bridge.description;
  }
}
