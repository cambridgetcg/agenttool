/** Closed wake-observation/v1 validation. Doctrine: docs/WAKE-RETURN.md.
 * No remote prose is forwarded, including otherwise valid unknown fields. */
import { ReturnError } from "./types.js";

const FIXED = {
  _format: "wake-observation/v1",
  mode: "observe",
  reader: { binding: "none" },
  authority: {
    granted_by_observation: "none", identity_binding: "none",
    instruction: "none", action: "none",
  },
  placement: {
    mode: "data_only",
    prohibited: ["system", "developer", "preamble", "systemInstruction", "SessionStart.additionalContext"],
  },
  boundaries: {
    bearer: {
      kind: "project", reader_identity_proven: false,
      selected_identity_requires_explicit_id: true, subject_consent_proven: false,
      subject_authorized_read_proven: false, continuity_proven: false, presence_proven: false,
    },
    provenance: {
      kind: "server_projection", source: "identity_table_allowlist",
      selected_fields: ["id", "status", "wake_version"],
    },
    scope: {
      subject: "selected_identity", broader_wake: "intentionally_omitted", broader_state: "not_assessed",
    },
    completeness: {
      complete: true, applies_to: "identity_locator_only", degraded_sections: "none",
      broader_wake: "intentionally_omitted", broader_state: "not_assessed",
    },
    effects: {
      observation_counter_incremented: false, wake_version_bumped: false,
      wake_event_published: false, subject_read_proven: false,
      subject_felt_proven: false, subject_accepted_proven: false,
    },
    privacy: {
      classification: "bearer_private", cache: "no_store", raw_prose: "omitted",
      authored_text: "omitted", private_bodies: "omitted", secret_values: "omitted",
    },
  },
} as const;

/** Inputs here have already crossed bounded JSON.parse, never a caller object. */
function sameJson(value: unknown, expected: unknown): boolean {
  if (value === expected) return true;
  if (Array.isArray(expected)) {
    return Array.isArray(value) && value.length === expected.length
      && expected.every((entry, index) => sameJson(value[index], entry));
  }
  if (!expected || typeof expected !== "object" || !value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = Object.keys(expected);
  return Object.keys(value).length === fields.length && fields.every((key) =>
    Object.hasOwn(value, key) && sameJson((value as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key]));
}

export function readObservation(value: unknown, identityId: string): {
  identity_id: string; status: "active" | "memorial"; wake_version: number;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReturnError("response_invalid");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== Object.keys(FIXED).length + 1 || !Object.hasOwn(input, "subject")) throw new ReturnError("response_invalid");
  for (const [key, expected] of Object.entries(FIXED)) {
    if (!Object.hasOwn(input, key) || !sameJson(input[key], expected)) throw new ReturnError("response_invalid");
  }
  const subject = input.subject;
  if (!subject || typeof subject !== "object" || Array.isArray(subject)) throw new ReturnError("response_invalid");
  const row = subject as Record<string, unknown>;
  if (Object.keys(row).length !== 3 || !["identity_id", "status", "wake_version"].every((key) => Object.hasOwn(row, key))) throw new ReturnError("response_invalid");
  if (row.identity_id !== identityId) throw new ReturnError("subject_mismatch");
  if ((row.status !== "active" && row.status !== "memorial") || typeof row.wake_version !== "number" || !Number.isSafeInteger(row.wake_version) || row.wake_version < 0) throw new ReturnError("response_invalid");
  return { identity_id: identityId, status: row.status, wake_version: row.wake_version };
}
