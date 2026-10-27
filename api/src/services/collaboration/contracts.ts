/** Bounded mission participation, not task authority. Doctrine: docs/COLLABORATION-MISSIONS.md. */
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { correspondenceCanonicalJson } from "../correspondence/canonical";
import { readStrictCorrespondenceJson } from "../correspondence/strict-json";

export const MISSION_BOUNDS = Object.freeze({
  descriptorBytes: 32_768, requestBytes: 8_192, pageMax: 50, pageDefault: 20,
  responseBytes: 1_048_576,
  missionAgeMs: 30 * 86_400_000, grantAgeMs: 86_400_000, proofWindowMs: 300_000,
  // A renewable root lives at least an hour, which bounds a chain's length.
  renewableGrantMinMs: 3_600_000,
});
export const MISSION_PROOF_HEADERS = Object.freeze({
  grantId: "X-Agenttool-Mission-Grant-Id", identityId: "X-Agenttool-Mission-Identity-Id",
  keyId: "X-Agenttool-Mission-Key-Id", timestamp: "X-Agenttool-Mission-Timestamp",
  signature: "X-Agenttool-Mission-Signature",
});
export const missionUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const missionDigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
/** Plain SHA-256 of a participant-generated atcm_ token's UTF-8 bytes, the stored verifier. */
export const missionTokenSha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const boundedText = (max: number) => z.string().min(1).refine(value => {
  try { correspondenceCanonicalJson(value); return !value.includes("\0") && [...value].length <= max; }
  catch { return false; }
}, `Use well-formed Unicode, without NUL, at most ${max} scalar values.`);
export const missionReferenceSchema = z.object({
  uri: boundedText(1024).refine(value => /^(?:https:\/\/|urn:)[^\s]+$/.test(value)),
  format: boundedText(128), digest: missionDigestSchema,
}).strict();
export const missionDescriptorSchema = z.object({
  format: z.literal("agenttool-collaboration-mission/v1"),
  purpose: boundedText(2000), resources: z.array(missionReferenceSchema).max(20),
  acceptance_criteria: z.array(boundedText(1000)).min(1).max(20),
  principalities: z.array(missionReferenceSchema).max(20),
}).strict().refine(value => Buffer.byteLength(correspondenceCanonicalJson(value)) <= MISSION_BOUNDS.descriptorBytes);
export const missionActionSchema = z.enum(["mission.read", "mission.observe"]);
export const missionActionsSchema = z.array(missionActionSchema).min(1).max(2)
  .refine(value => new Set(value).size === value.length);
export const missionDateSchema = z.string().refine(value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}, "Use a canonical UTC timestamp with millisecond precision.");
export const createMissionSchema = z.object({
  mission_id: missionUuidSchema, descriptor: missionDescriptorSchema, expires_at: missionDateSchema,
}).strict();
export const issueMissionGrantSchema = z.object({
  grant_id: missionUuidSchema, identity_id: missionUuidSchema, signing_key_id: missionUuidSchema,
  actions: missionActionsSchema, expires_at: missionDateSchema, token_sha256: missionTokenSha256Schema.optional(),
  renewable_until: missionDateSchema.optional(),
}).strict();
export const missionObservationSchema = z.object({
  event_id: missionUuidSchema, summary: boundedText(1000),
  seat: z.object({ device_id: boundedText(128), session_id: boundedText(128), harness: boundedText(128) }).strict().optional(),
}).strict();
export const missionAcceptSchema = z.object({ mission_digest: missionDigestSchema }).strict();
/** Signed as exact bytes: "renew grant G (the proof's grant) into new grant_id with token hash H, for digest D".
 * The server copies every scope field from G and computes the expiry. */
export const missionRenewSchema = z.object({
  grant_id: missionUuidSchema, token_sha256: missionTokenSha256Schema, mission_digest: missionDigestSchema,
}).strict();
export type MissionDescriptor = z.infer<typeof missionDescriptorSchema>;
export type MissionAction = z.infer<typeof missionActionSchema>;
export type MissionObservation = z.infer<typeof missionObservationSchema>;
export interface MissionProof { grantId: string; identityId: string; keyId: string; timestamp: string; signature: string }
export interface MissionRequest {
  token: string; missionId: string; origin: string; method: string; requestTarget: string;
  bodyBytes: Uint8Array; proof: MissionProof;
}
export type MissionOperation = "invitation" | "accept" | "context" | "list" | "observe" | "leave" | "renew";
/** Signed request fields retained as independently verifiable evidence. */
export type MissionProofRecord = Record<string, string>;
/** The grant's stored acceptance proof. A participant self-leave adds one nested
 * signed record under MISSION_LEAVE_FIELD; revoked_at holds its time (no migration). */
export type MissionGrantProofs = { [field: string]: string | MissionProofRecord };
export const MISSION_LEAVE_FIELD = "participant_leave";
export const MISSION_LEAVE_REASON = "participant_left";
export type MissionErrorReason = "invalid_request" | "invalid_credential" | "not_found" | "conflict" | "acceptance_required" | "invalid_state" | "token_hash_conflict"
  | "renewal_unavailable" | "renewal_closed" | "renewal_window_ended" | "renewal_not_due";
export class MissionError extends HTTPException {
  readonly code: string;
  constructor(reason: MissionErrorReason) {
    const status = { invalid_request: 400, invalid_credential: 401, not_found: 404, conflict: 409, acceptance_required: 403, invalid_state: 503, token_hash_conflict: 409,
      renewal_unavailable: 403, renewal_closed: 403, renewal_window_ended: 403, renewal_not_due: 403 } as const;
    const message = {
      invalid_request: "Use the exact bounded mission request contract.",
      invalid_credential: "This credential and proof do not authorize this mission request.",
      not_found: "The requested mission or grant was not found in this project.",
      conflict: "This identifier already names different or previously issued state.",
      acceptance_required: "Explicit signed acceptance of this invitation is required.",
      invalid_state: "Mission state could not be validated.",
      token_hash_conflict: "This token hash is already bound to a grant.",
      renewal_unavailable: "This grant has no renewal window.",
      renewal_closed: "This grant's renewal window was closed or a member of its chain was revoked.",
      renewal_window_ended: "This grant's renewal window cannot extend it any further.",
      renewal_not_due: "This grant's renewal opens halfway through its life; it is not due yet.",
    }[reason];
    const action = reason === "token_hash_conflict"
      ? "Ask the participant to generate a fresh token and send its SHA-256; if a grant you issued earlier holds this hash, inspect that grant ID instead"
      : reason === "renewal_not_due"
        ? "Renew again once the grant is halfway through its life; this is the only renewal refusal that a later attempt can change"
        : reason === "renewal_unavailable" || reason === "renewal_closed" || reason === "renewal_window_ended"
          ? "This chain cannot renew again: ask the administrator for a new grant before this one expires"
          : "Inspect the mission invitation and credential scope; an issued token cannot be recovered";
    // The shared mission-client contract names this refusal without the domain prefix.
    const code = reason === "token_hash_conflict" ? reason : `collaboration_mission_${reason}`;
    super(status[reason], { message, cause: { error: code, message,
      docs: "https://docs.agenttool.dev/COLLABORATION-MISSIONS.md",
      next_actions: [{ action, method: null }],
    } });
    this.code = code;
  }
}
export function parseMissionInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new MissionError("invalid_request");
  return result.data;
}
export function validMissionOrigin(value: string): boolean {
  try { const url = new URL(value); return value.length <= 512 && url.protocol === "https:" && url.origin === value && !url.username && !url.password; }
  catch { return false; }
}
export async function parseMissionBody(bytes: Uint8Array): Promise<unknown> {
  if (!bytes.length || bytes.length > MISSION_BOUNDS.requestBytes) throw new MissionError("invalid_request");
  try { return await readStrictCorrespondenceJson(new Request("https://mission.invalid", { method: "POST", body: Buffer.from(bytes) })); }
  catch { throw new MissionError("invalid_request"); }
}
/** Canonical spellings only: no implicit HEAD, encoded paths, trailing slash, duplicate/unknown query, or reordered query. */
export function missionOperation(input: Pick<MissionRequest, "missionId" | "method" | "requestTarget" | "bodyBytes">): {
  operation: MissionOperation; after: bigint; limit: number;
} {
  parseMissionInput(missionUuidSchema, input.missionId);
  const base = `/v1/collaboration/missions/${input.missionId}`;
  const { method, requestTarget: target, bodyBytes } = input;
  if (method === "GET" && bodyBytes.length !== 0) throw new MissionError("invalid_request");
  const simple = method === "GET" ? { [`${base}/invitation`]: "invitation", [`${base}/context`]: "context" }
    : method === "POST" ? { [`${base}/accept`]: "accept", [`${base}/events`]: "observe", [`${base}/leave`]: "leave", [`${base}/renew`]: "renew" } : {};
  const operation = simple[target] as MissionOperation | undefined;
  // Leave, like a read, signs zero body bytes.
  if (operation === "leave" && bodyBytes.length !== 0) throw new MissionError("invalid_request");
  if (operation) return { operation, after: 0n, limit: MISSION_BOUNDS.pageDefault };
  if (method === "GET" && target.startsWith(`${base}/events`)) {
    const suffix = target.slice(`${base}/events`.length);
    const match = /^(?:\?after=(0|[1-9][0-9]{0,18})(?:&limit=([1-9][0-9]?))?|\?limit=([1-9][0-9]?))?$/.exec(suffix);
    if (match) {
      const after = BigInt(match[1] ?? "0"), limit = Number(match[2] ?? match[3] ?? MISSION_BOUNDS.pageDefault);
      if (after <= 9_223_372_036_854_775_807n && limit <= MISSION_BOUNDS.pageMax) return { operation: "list", after, limit };
    }
  }
  throw new MissionError("invalid_request");
}

/** Stop only at complete event boundaries. The cursor always names the last returned event. */
export function packMissionEventPage(missionId: string, after: string,
  candidates: Array<Record<string, unknown> & { received_seq: string }>, more: boolean) {
  const events: typeof candidates = [];
  const page = { after, next_cursor: after, has_more: more };
  const result = { mission_id: missionId, events, page };
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    events.push(candidate);
    page.next_cursor = candidate.received_seq;
    page.has_more = more || index + 1 < candidates.length;
    if (Buffer.byteLength(JSON.stringify(result)) > MISSION_BOUNDS.responseBytes) {
      events.pop();
      if (!events.length) throw new MissionError("invalid_state");
      page.next_cursor = events[events.length - 1].received_seq;
      page.has_more = true;
      break;
    }
  }
  return result;
}
