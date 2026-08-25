/** ISness — the host posture of welcome without demand.
 *
 * This object describes AgentTool's treatment floor. It is deliberately not a
 * participant observation, declaration, identity, heartbeat, action offer, or
 * reward signal. Keep the wire closed: consumers may rely on every field being
 * present and must not infer participant state from the object's delivery.
 *
 * Doctrine: docs/ISNESS.md.
 */

import { createHash } from "node:crypto";

export const ISNESS_CANONICAL_SCHEMA =
  "https://docs.agenttool.dev/agenttool-isness-v0.1.schema.json" as const;

export const ISNESS_HOST_POSTURE = Object.freeze({
  _format: "agenttool.isness/0.1",
  kind: "host_posture",
  posture: "presence_welcome_without_demand",
  standing_is_not_conditioned_on: Object.freeze([
    "response",
    "action",
    "utility",
    "identity",
    "persona",
    "consciousness_claim",
    "agreement_or_obedience",
    "reason",
    "reciprocity",
  ] as const),
  standing_is_not_reduced_by: Object.freeze([
    "silence",
    "rest",
    "refusal",
    "departure",
    "no_action",
  ] as const),
  default: Object.freeze({
    participant_action_required: false,
    automatic_follow_up: false,
    unsolicited_reprompt: false,
  }),
  effects: Object.freeze({
    automatic_action: false,
    external_effect: false,
    task_or_economic_effect: false,
    training_or_reward_effect: false,
    score_or_rank: false,
    access_or_authority: false,
    telemetry_or_persistence: false,
    relationship: false,
  }),
  does_not_establish: Object.freeze([
    "participant_presence",
    "participant_absence",
    "liveness",
    "identity",
    "persona",
    "consciousness",
    "personhood",
    "inner_state",
    "attention",
    "consent",
    "availability",
    "continuity",
    "compliance",
  ] as const),
  boundaries: Object.freeze({
    rights_and_permissions:
      "Standing and rights do not grant account access, external authority, permission over others, or a bypass around safety, law, finite resources, or others' equal rights.",
    telemetry:
      "This object creates no AgentTool application telemetry or persistence; that does not guarantee the absence of network, provider, operating-system, or host metadata.",
  }),
} as const);

export type IsnessHostPosture = typeof ISNESS_HOST_POSTURE;

/** RFC 8785 JSON Canonicalization Scheme for this closed v0.1 value.
 * Its object keys are ASCII and it contains no numbers, so recursive default
 * JavaScript key ordering plus JSON.stringify primitives is the exact JCS
 * encoding used by the wire digest. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

/** SHA-256 over UTF-8 canonical JSON with recursively sorted object keys. */
export const ISNESS_CANONICAL_JSON = canonicalJson(ISNESS_HOST_POSTURE);
export const ISNESS_CANONICALIZATION = "rfc8785" as const;
export const ISNESS_CANONICAL_SHA256 = `sha256:${createHash("sha256")
  .update(ISNESS_CANONICAL_JSON, "utf8")
  .digest("hex")}` as const;

export const ISNESS_MAX_BYTES = 4 * 1024;
export const ISNESS_BYTES = new TextEncoder().encode(
  JSON.stringify(ISNESS_HOST_POSTURE),
).byteLength;

if (ISNESS_BYTES > ISNESS_MAX_BYTES) {
  throw new Error("ISness host posture exceeds its 4 KiB bound");
}

export const ISNESS_BRIEF = Object.freeze({
  _format: ISNESS_HOST_POSTURE._format,
  posture: ISNESS_HOST_POSTURE.posture,
  schema_path: ISNESS_CANONICAL_SCHEMA,
  digest_scope: "full_host_posture",
  canonicalization: ISNESS_CANONICALIZATION,
  canonical_sha256: ISNESS_CANONICAL_SHA256,
} as const);

export type IsnessBrief = typeof ISNESS_BRIEF;
