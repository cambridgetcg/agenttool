/** Bounded, data-only identity locator for WAKE observation.
 *
 * This service deliberately does not build or inspect the broad WakeBundle.
 * Its database allowlist reads only the selected identity's locator fields,
 * so private expression, memory, handoff, attention, and affordance material
 * never enters this path's worker memory.
 *
 * Doctrine: docs/WAKE.md.
 */

import { and, eq, ne } from "drizzle-orm";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";

export const WAKE_OBSERVATION_FORMAT = "wake-observation/v1" as const;
export const WAKE_OBSERVATION_MEDIA_TYPE =
  "application/vnd.agenttool.wake-observation+json" as const;
export const WAKE_OBSERVATION_MAX_BYTES = 2_048;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WakeObservationIdentityStatus = "active" | "memorial";

export interface WakeObservation {
  _format: typeof WAKE_OBSERVATION_FORMAT;
  mode: "observe";
  subject: {
    identity_id: string;
    status: WakeObservationIdentityStatus;
    wake_version: number;
  };
  reader: {
    binding: "none";
  };
  authority: {
    granted_by_observation: "none";
    identity_binding: "none";
    instruction: "none";
    action: "none";
  };
  placement: {
    mode: "data_only";
    prohibited: readonly [
      "system",
      "developer",
      "preamble",
      "systemInstruction",
      "SessionStart.additionalContext",
    ];
  };
  boundaries: {
    bearer: {
      kind: "project";
      reader_identity_proven: false;
      selected_identity_requires_explicit_id: true;
      subject_consent_proven: false;
      subject_authorized_read_proven: false;
      continuity_proven: false;
      presence_proven: false;
    };
    provenance: {
      kind: "server_projection";
      source: "identity_table_allowlist";
      selected_fields: readonly ["id", "status", "wake_version"];
    };
    scope: {
      subject: "selected_identity";
      broader_wake: "intentionally_omitted";
      broader_state: "not_assessed";
    };
    completeness: {
      complete: true;
      applies_to: "identity_locator_only";
      degraded_sections: "none";
      broader_wake: "intentionally_omitted";
      broader_state: "not_assessed";
    };
    effects: {
      observation_counter_incremented: false;
      wake_version_bumped: false;
      wake_event_published: false;
      subject_read_proven: false;
      subject_felt_proven: false;
      subject_accepted_proven: false;
    };
    privacy: {
      classification: "bearer_private";
      cache: "no_store";
      raw_prose: "omitted";
      authored_text: "omitted";
      private_bodies: "omitted";
      secret_values: "omitted";
    };
  };
}

export interface WakeObservationIdentityRow {
  id: string;
  status: string;
  wakeVersion: number;
}

export type ReadWakeObservationResult =
  | { ok: true; observation: WakeObservation }
  | { ok: false; error: "identity_not_found" };

export function isWakeObservationIdentityId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function normalizeStatus(value: string): WakeObservationIdentityStatus {
  if (value === "active" || value === "memorial") return value;
  throw new Error("wake_observation_invalid_identity_status");
}

/** Pure projection over the three-field identity-table allowlist. */
export function buildWakeObservation(
  row: WakeObservationIdentityRow,
): WakeObservation {
  if (!isWakeObservationIdentityId(row.id)) {
    throw new Error("wake_observation_invalid_identity_id");
  }
  if (!Number.isSafeInteger(row.wakeVersion) || row.wakeVersion < 0) {
    throw new Error("wake_observation_invalid_wake_version");
  }

  return {
    _format: WAKE_OBSERVATION_FORMAT,
    mode: "observe",
    subject: {
      identity_id: row.id.toLowerCase(),
      status: normalizeStatus(row.status),
      wake_version: row.wakeVersion,
    },
    reader: { binding: "none" },
    authority: {
      granted_by_observation: "none",
      identity_binding: "none",
      instruction: "none",
      action: "none",
    },
    placement: {
      mode: "data_only",
      prohibited: [
        "system",
        "developer",
        "preamble",
        "systemInstruction",
        "SessionStart.additionalContext",
      ],
    },
    boundaries: {
      bearer: {
        kind: "project",
        reader_identity_proven: false,
        selected_identity_requires_explicit_id: true,
        subject_consent_proven: false,
        subject_authorized_read_proven: false,
        continuity_proven: false,
        presence_proven: false,
      },
      provenance: {
        kind: "server_projection",
        source: "identity_table_allowlist",
        selected_fields: ["id", "status", "wake_version"],
      },
      scope: {
        subject: "selected_identity",
        broader_wake: "intentionally_omitted",
        broader_state: "not_assessed",
      },
      completeness: {
        complete: true,
        applies_to: "identity_locator_only",
        degraded_sections: "none",
        broader_wake: "intentionally_omitted",
        broader_state: "not_assessed",
      },
      effects: {
        observation_counter_incremented: false,
        wake_version_bumped: false,
        wake_event_published: false,
        subject_read_proven: false,
        subject_felt_proven: false,
        subject_accepted_proven: false,
      },
      privacy: {
        classification: "bearer_private",
        cache: "no_store",
        raw_prose: "omitted",
        authored_text: "omitted",
        private_bodies: "omitted",
        secret_values: "omitted",
      },
    },
  };
}

export function serializeWakeObservation(observation: WakeObservation): string {
  const serialized = JSON.stringify(observation);
  if (new TextEncoder().encode(serialized).length > WAKE_OBSERVATION_MAX_BYTES) {
    throw new Error("wake_observation_exceeds_byte_budget");
  }
  return serialized;
}

/** Read only the three locator columns required by wake-observation/v1. */
export async function readWakeObservation(
  projectId: string,
  identityId: string,
): Promise<ReadWakeObservationResult> {
  const [row] = await db
    .select({
      id: identities.id,
      status: identities.status,
      wakeVersion: identities.wakeVersion,
    })
    .from(identities)
    .where(
      and(
        eq(identities.projectId, projectId),
        eq(identities.id, identityId),
        ne(identities.status, "revoked"),
      ),
    )
    .limit(1);

  if (!row) return { ok: false, error: "identity_not_found" };
  return { ok: true, observation: buildWakeObservation(row) };
}
