/**
 * Renaissance Correspondence — signed, replayable coordination between agents.
 *
 * The signed event names its device and session explicitly. This module never
 * derives either value from the host, process, environment, or another ambient
 * telemetry source. Claims are expiring courtesy notices, not locks, ownership,
 * or delegated authority.
 *
 * Canonical bytes and event IDs implement the bounded I-JSON profile accepted
 * by `agent-correspondence/v0.1`: strings, booleans, null, arrays, objects, and
 * safe integers. That admitted subset is serialized as RFC 8785 JCS. Floats,
 * non-finite numbers, unsafe integers, undefined values, lone UTF-16
 * surrogates, and U+0000 in strings or property names are rejected locally.
 */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import { AgentToolError } from "./errors.js";
import { decodeSigningKey } from "./identity.js";
import type { HttpConfig } from "./_http.js";

ed.etc.sha512Sync = (...messages: Uint8Array[]) => {
  const hash = sha512.create();
  for (const message of messages) hash.update(message);
  return hash.digest();
};

export const CORRESPONDENCE_PROTOCOL = "agent-correspondence/v0.1" as const;
export const CORRESPONDENCE_SIGNATURE_ALGORITHM = "Ed25519" as const;
export const CORRESPONDENCE_KINDS = [
  "intent",
  "claim.open",
  "claim.renew",
  "claim.release",
  "progress",
  "observation",
  "artifact.offer",
  "ack.seen",
  "ack.understood",
  "ack.accepted",
  "ack.applied",
  "ack.rejected",
  "conflict.raise",
  "conflict.resolve",
  "pause",
  "rest",
  "resume",
  "refusal",
  "handoff",
  "close",
  "repair",
] as const;

const encoder = new TextEncoder();
const NUL = new Uint8Array([0]);
const EVENT_ID_RE = /^sha256:[0-9a-f]{64}$/;
const REVISION_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RFC3339_MS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DECIMAL_CURSOR_RE = /^(?:0|[1-9][0-9]*)$/;
const MAX_RECEIVED_SEQ = 9_223_372_036_854_775_807n;
const MAX_RECEIVED_SEQ_TEXT = MAX_RECEIVED_SEQ.toString();
const REPOSITORY_TEXT_RE = /[\p{White_Space}\p{Cc}\uFEFF]/u;
const GLOB_META_RE = /[*?\[\]{}!]/;
const ABSOLUTE_URI_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const URI_FORBIDDEN_RE = /[\p{White_Space}\p{Cc}\uFEFF]/u;

export type CorrespondenceKind = (typeof CORRESPONDENCE_KINDS)[number];

export type CorrespondenceJsonValue =
  | null
  | boolean
  | string
  | number
  | CorrespondenceJsonValue[]
  | { [key: string]: CorrespondenceJsonValue };

export interface CorrespondenceSender {
  identity_id: string;
  signing_key_id: string;
  /** Caller-chosen UUID. The SDK never reads a hardware identifier. */
  device_id: string;
  /** Caller-chosen UUID. The SDK never reads a process or runtime session. */
  session_id: string;
}

export interface CorrespondenceScope {
  base_revision: string | null;
  branch: string | null;
  /** Normalized repository-relative prefixes. `.` means the whole repo. */
  paths: string[];
}

export interface CorrespondenceAuthority {
  automatic_action: "never";
  grants: [];
}

export interface CorrespondenceSummaryBody {
  summary: string;
}

export interface CorrespondenceClaimOpenBody {
  claim_id: string;
  generation: 1;
  expires_at: string;
}

export interface CorrespondenceClaimRenewBody {
  claim_id: string;
  generation: number;
  predecessor_event_id: string;
  expires_at: string;
}

export interface CorrespondenceClaimReleaseBody {
  claim_id: string;
  generation: number;
  predecessor_event_id: string;
  detail?: string;
}

export type CorrespondenceArtifact =
  | { kind: "git_commit"; revision: string }
  | {
      kind: "git_patch" | "content_digest";
      digest: string;
      locator?: string;
    };

export interface CorrespondenceArtifactOfferBody {
  artifact: CorrespondenceArtifact;
  summary?: string;
}

export interface CorrespondenceAckBody {
  target_event_id: string;
  detail?: string;
}

export interface CorrespondenceAckAppliedBody extends CorrespondenceAckBody {
  result_revision: string;
}

export interface CorrespondenceConflictRaiseBody {
  target_event_ids: string[];
  summary?: string;
}

export interface CorrespondenceResolutionBody {
  target_event_ids: string[];
  summary: string;
  result_revision?: string;
}

export interface CorrespondencePauseBody {
  until?: string | null;
  detail?: string;
}

export interface CorrespondenceTargetBody {
  target_event_id: string;
  detail?: string;
}

export interface CorrespondenceRefusalBody {
  target_event_id?: string;
  detail?: string;
}

export interface CorrespondenceHandoffBody {
  summary: string;
  next_safe_action: string;
  /** Optional locator only; it does not import the handoff's authority. */
  handoff_id?: string;
}

export interface CorrespondenceCloseBody {
  summary?: string;
}

export interface CorrespondenceBodyByKind {
  intent: CorrespondenceSummaryBody;
  "claim.open": CorrespondenceClaimOpenBody;
  "claim.renew": CorrespondenceClaimRenewBody;
  "claim.release": CorrespondenceClaimReleaseBody;
  progress: CorrespondenceSummaryBody;
  observation: CorrespondenceSummaryBody;
  "artifact.offer": CorrespondenceArtifactOfferBody;
  "ack.seen": CorrespondenceAckBody;
  "ack.understood": CorrespondenceAckBody;
  "ack.accepted": CorrespondenceAckBody;
  "ack.applied": CorrespondenceAckAppliedBody;
  "ack.rejected": CorrespondenceAckBody;
  "conflict.raise": CorrespondenceConflictRaiseBody;
  "conflict.resolve": CorrespondenceResolutionBody;
  pause: CorrespondencePauseBody;
  rest: CorrespondencePauseBody;
  resume: CorrespondenceTargetBody;
  refusal: CorrespondenceRefusalBody;
  handoff: CorrespondenceHandoffBody;
  close: CorrespondenceCloseBody;
  repair: CorrespondenceResolutionBody;
}

interface CorrespondenceEventBase {
  protocol: typeof CORRESPONDENCE_PROTOCOL;
  project_id: string;
  repository_id: string;
  thread_id: string;
  sender: CorrespondenceSender;
  parents: string[];
  session_seq: number;
  issued_at: string;
  scope: CorrespondenceScope;
  authority: CorrespondenceAuthority;
}

export type CorrespondenceEventCore = {
  [K in CorrespondenceKind]: CorrespondenceEventBase & {
    kind: K;
    body: CorrespondenceBodyByKind[K];
  };
}[CorrespondenceKind];

export interface CorrespondenceSignature {
  algorithm: typeof CORRESPONDENCE_SIGNATURE_ALGORITHM;
  value_b64url: string;
}

export type CorrespondenceSignedEvent = CorrespondenceEventCore & {
  event_id: string;
  signature: CorrespondenceSignature;
};

export type CorrespondenceUnsignedInput = {
  [K in CorrespondenceKind]: Omit<CorrespondenceEventBase, "protocol" | "authority"> & {
    kind: K;
    body: CorrespondenceBodyByKind[K];
  };
}[CorrespondenceKind];

export type CorrespondenceAppendOptions = CorrespondenceUnsignedInput & {
  /** Caller-held 32-byte Ed25519 seed, raw or canonical standard base64.
   * It is used locally and never sent. */
  signing_key: Uint8Array | string;
};

export interface CorrespondenceReceipt {
  /** Canonical decimal string; project-local monotone receipt order, gaps allowed. */
  received_seq: string;
  received_at: string;
}

export interface CorrespondenceEventRecord {
  event: CorrespondenceSignedEvent;
  receipt: CorrespondenceReceipt;
  missing_parents: string[];
  /** Server projection state. Receipt order is not causal or wall-clock proof. */
  lineage_status: "not_applicable" | "valid" | "pending" | "invalid";
}

export interface CorrespondenceWarning {
  code: "session_fork" | "claim_lineage_pending";
  detail: string;
  event_ids?: string[];
  paths?: string[];
}

export interface CorrespondenceAppendResponse extends CorrespondenceEventRecord {
  /** Advisory, current-at-write observations. Not part of the signed event. */
  warnings: CorrespondenceWarning[];
}

export interface CorrespondenceListOptions {
  repository_id: string;
  thread_id?: string;
  /** Exclusive project-local receipt cursor, kept as a decimal string. */
  after?: string;
  limit?: number;
}

export interface CorrespondenceEventsPage {
  protocol: typeof CORRESPONDENCE_PROTOCOL;
  scope: "project_private";
  events: CorrespondenceEventRecord[];
  page: {
    after: string | null;
    next_after: string | null;
    has_more: boolean;
  };
}

/** One surviving active claim branch tip. Multiple tips may coexist. */
export interface CorrespondenceActiveClaim {
  claim_id: string;
  generation: number;
  event_id: string;
  owner_identity_id: string;
  device_id: string;
  session_id: string;
  thread_id: string;
  scope: CorrespondenceScope;
  expires_at: string;
  conflicted: boolean;
  /** Up to 16 other valid branch tips, including inactive/released tips. */
  competing_event_ids: string[];
}

export interface CorrespondenceClaimsResponse {
  protocol: typeof CORRESPONDENCE_PROTOCOL;
  scope: "project_private";
  evaluated_at: string;
  cursor: string | null;
  projection_status: "complete" | "truncated" | "unavailable";
  truncated: boolean;
  claims: CorrespondenceActiveClaim[];
}

export interface CorrespondenceClaimsOptions {
  repository_id: string;
  thread_id?: string;
  /** Optional normalized path prefix used to narrow overlap projection. */
  path?: string;
}

export interface CorrespondenceMissingParentsConflict {
  event_id: string;
  missing_parent_ids: string[];
}

export interface CorrespondenceSessionForkConflict {
  identity_id: string;
  device_id: string;
  session_id: string;
  session_seq: number;
  event_ids: string[];
}

export interface CorrespondenceOverlappingClaimsConflict {
  left_event_id: string;
  right_event_id: string;
  paths: string[];
}

export interface CorrespondenceVoiceOptions {
  repository_id: string;
  thread_id?: string;
}

export interface CorrespondenceVoiceConflicts {
  missing_parents: CorrespondenceMissingParentsConflict[];
  session_forks: CorrespondenceSessionForkConflict[];
  overlapping_claims: CorrespondenceOverlappingClaimsConflict[];
}

/** Finite coordination snapshot. Realtime hints remain Wake voice events. */
export interface CorrespondenceVoiceSnapshot {
  protocol: typeof CORRESPONDENCE_PROTOCOL;
  scope: "project_private";
  evaluated_at: string;
  cursor: string | null;
  projection_status: "complete" | "truncated" | "unavailable";
  truncated: boolean;
  recent_events: CorrespondenceEventRecord[];
  active_claims: CorrespondenceActiveClaim[];
  conflicts: CorrespondenceVoiceConflicts;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return globalThis.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "==";
  const binary = globalThis.atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

interface JcsState {
  ancestors: Set<object>;
  nodes: number;
}

function jcs(
  value: unknown,
  path = "$",
  state: JcsState = { ancestors: new Set(), nodes: 0 },
  depth = 0,
): string {
  state.nodes += 1;
  if (state.nodes > 10_000) {
    throw new AgentToolError("correspondence canonicalization: JSON exceeds the 10,000-node safety cap.");
  }
  if (depth > 64) {
    throw new AgentToolError("correspondence canonicalization: JSON exceeds the 64-level depth cap.");
  }
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    if (hasLoneSurrogate(value)) {
      throw new AgentToolError(
        `correspondence canonicalization: ${path} contains a lone UTF-16 surrogate.`,
      );
    }
    if (value.includes("\0")) {
      throw new AgentToolError(
        `correspondence canonicalization: ${path} contains U+0000, which v0.1 refuses.`,
      );
    }
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new AgentToolError(
        `correspondence canonicalization: ${path} must be a safe integer in v0.1.`,
        { hint: "Floats, negative zero, NaN, Infinity, and integers outside the I-JSON safe range are refused." },
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (state.ancestors.has(value)) {
      throw new AgentToolError(`correspondence canonicalization: ${path} contains a cycle.`);
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== value.length + 1
        || ownKeys.some((key) => key !== "length"
          && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key)
            || Number(key) >= value.length))) {
      throw new AgentToolError(
        `correspondence canonicalization: ${path} must be a dense plain JSON array.`,
      );
    }
    state.ancestors.add(value);
    try {
      const items: string[] = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
          throw new AgentToolError(`correspondence canonicalization: ${path} is a sparse array.`);
        }
        items.push(jcs(descriptor.value, `${path}[${index}]`, state, depth + 1));
      }
      return `[${items.join(",")}]`;
    } finally {
      state.ancestors.delete(value);
    }
  }
  if (typeof value !== "object" || value === undefined) {
    throw new AgentToolError(
      `correspondence canonicalization: ${path} contains a non-I-JSON value.`,
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new AgentToolError(
      `correspondence canonicalization: ${path} must be a plain JSON object.`,
    );
  }
  const record = value as Record<string, unknown>;
  if (state.ancestors.has(record)) {
    throw new AgentToolError(`correspondence canonicalization: ${path} contains a cycle.`);
  }
  state.ancestors.add(record);
  try {
    const keys = Object.keys(record).sort(); // RFC 8785: lexicographic UTF-16 code units.
    if (Reflect.ownKeys(record).length !== keys.length) {
      throw new AgentToolError(
        `correspondence canonicalization: ${path} must contain only enumerable string properties.`,
      );
    }
    return `{${keys.map((key) => {
      if (hasLoneSurrogate(key)) {
        throw new AgentToolError(
          `correspondence canonicalization: ${path} has a lone-surrogate property name.`,
        );
      }
      if (key.includes("\0")) {
        throw new AgentToolError(
          `correspondence canonicalization: ${path} has a U+0000 property name, which v0.1 refuses.`,
        );
      }
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor || descriptor.get || descriptor.set) {
        throw new AgentToolError(
          `correspondence canonicalization: ${path}.${key} must be a plain data property.`,
        );
      }
      return `${JSON.stringify(key)}:${jcs(descriptor.value, `${path}.${key}`, state, depth + 1)}`;
    }).join(",")}}`;
  } finally {
    state.ancestors.delete(record);
  }
}

function scalarLength(value: string): number {
  return Array.from(value).length;
}

/** Serialize one value in the bounded v0.1 I-JSON/JCS profile. */
export function canonicalCorrespondenceJson(value: CorrespondenceJsonValue): string {
  return jcs(value);
}

function assertExactKeys(
  operation: string,
  value: object,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new AgentToolError(`${operation}: ${key} is required.`);
    }
  }
  const extra = keys.find((key) => !allowed.has(key));
  if (extra !== undefined) {
    throw new AgentToolError(`${operation}: unexpected field ${extra}.`, {
      hint: "agent-correspondence/v0.1 bodies use additionalProperties=false.",
    });
  }
}

function assertObject(operation: string, value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentToolError(`${operation}: expected a JSON object.`);
  }
}

function assertUuid(operation: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new AgentToolError(`${operation}: expected a canonical lowercase UUID.`);
  }
}

function assertEventId(operation: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !EVENT_ID_RE.test(value)) {
    throw new AgentToolError(`${operation}: expected sha256:<64 lowercase hex>.`);
  }
}

function assertRevision(operation: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !REVISION_RE.test(value)) {
    throw new AgentToolError(`${operation}: expected a 40- or 64-character lowercase revision.`);
  }
}

function assertTimestamp(operation: string, value: unknown): asserts value is string {
  if (
    typeof value !== "string"
    || !RFC3339_MS_RE.test(value)
    || Number(value.slice(0, 4)) < 1
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw new AgentToolError(`${operation}: expected a valid RFC3339 UTC timestamp with milliseconds.`);
  }
}

function assertText(
  operation: string,
  value: unknown,
  maximum = 1000,
): asserts value is string {
  if (typeof value !== "string" || scalarLength(value) < 1 || scalarLength(value) > maximum) {
    throw new AgentToolError(`${operation}: expected 1-${maximum} Unicode scalar values of text.`);
  }
  if (value.includes("\0")) {
    throw new AgentToolError(`${operation}: NUL is not allowed.`);
  }
}

function assertRepositoryText(operation: string, value: unknown): asserts value is string {
  if (
    typeof value !== "string"
    || scalarLength(value) < 1
    || scalarLength(value) > 256
    || REPOSITORY_TEXT_RE.test(value)
  ) {
    throw new AgentToolError(
      `${operation}: expected 1-256 Unicode scalar values without whitespace or control characters.`,
    );
  }
}

function assertEventIds(
  operation: string,
  value: unknown,
  minimum: number,
  maximum = 16,
): asserts value is string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new AgentToolError(`${operation}: expected ${minimum}-${maximum} event IDs.`);
  }
  const seen = new Set<string>();
  for (const eventId of value) {
    assertEventId(operation, eventId);
    if (seen.has(eventId)) {
      throw new AgentToolError(`${operation}: event IDs must be unique.`);
    }
    seen.add(eventId);
  }
}

function assertParent(core: CorrespondenceEventCore, eventId: string, field: string): void {
  if (!core.parents.includes(eventId)) {
    throw new AgentToolError(`correspondence ${core.kind}: ${field} must also appear in parents.`);
  }
}

function assertOptionalText(
  operation: string,
  body: Record<string, unknown>,
  key: string,
  maximum = 1000,
): void {
  if (Object.prototype.hasOwnProperty.call(body, key)) {
    assertText(`${operation}.${key}`, body[key], maximum);
  }
}

function assertPathPrefix(operation: string, path: unknown): asserts path is string {
  if (typeof path !== "string" || scalarLength(path) < 1 || scalarLength(path) > 256) {
    throw new AgentToolError(`${operation}: expected 1-256 Unicode scalar values.`);
  }
  if (/\p{Cc}/u.test(path)) {
    throw new AgentToolError(`${operation}: control characters are not allowed.`);
  }
  if (path !== "." && (
    path.startsWith("/")
    || path.endsWith("/")
    || path.includes("\\")
    || GLOB_META_RE.test(path)
    || path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  )) {
    throw new AgentToolError(
      `${operation}: ${JSON.stringify(path)} is not a normalized repo-relative prefix.`,
    );
  }
}

function validateBody(core: CorrespondenceEventCore): void {
  const operation = `correspondence ${core.kind}`;
  assertObject(`${operation}.body`, core.body);
  const body = core.body as unknown as Record<string, unknown>;

  switch (core.kind) {
    case "intent":
    case "progress":
    case "observation":
      assertExactKeys(operation, body, ["summary"]);
      assertText(`${operation}.summary`, body.summary);
      return;
    case "claim.open":
      assertExactKeys(operation, body, ["claim_id", "generation", "expires_at"]);
      assertUuid(`${operation}.claim_id`, body.claim_id);
      if (body.generation !== 1) throw new AgentToolError(`${operation}: generation must be 1.`);
      assertTimestamp(`${operation}.expires_at`, body.expires_at);
      return;
    case "claim.renew":
      assertExactKeys(operation, body, ["claim_id", "generation", "predecessor_event_id", "expires_at"]);
      assertUuid(`${operation}.claim_id`, body.claim_id);
      if (!Number.isSafeInteger(body.generation) || (body.generation as number) < 2) {
        throw new AgentToolError(`${operation}: generation must be a safe integer >= 2.`);
      }
      assertEventId(`${operation}.predecessor_event_id`, body.predecessor_event_id);
      assertParent(core, body.predecessor_event_id, "predecessor_event_id");
      assertTimestamp(`${operation}.expires_at`, body.expires_at);
      return;
    case "claim.release":
      assertExactKeys(operation, body, ["claim_id", "generation", "predecessor_event_id"], ["detail"]);
      assertUuid(`${operation}.claim_id`, body.claim_id);
      if (!Number.isSafeInteger(body.generation) || (body.generation as number) < 2) {
        throw new AgentToolError(`${operation}: generation must be a safe integer >= 2.`);
      }
      assertEventId(`${operation}.predecessor_event_id`, body.predecessor_event_id);
      assertParent(core, body.predecessor_event_id, "predecessor_event_id");
      assertOptionalText(operation, body, "detail");
      return;
    case "artifact.offer": {
      assertExactKeys(operation, body, ["artifact"], ["summary"]);
      assertOptionalText(operation, body, "summary");
      assertObject(`${operation}.artifact`, body.artifact);
      const artifact = body.artifact;
      if (artifact.kind === "git_commit") {
        assertExactKeys(`${operation}.artifact`, artifact, ["kind", "revision"]);
        assertRevision(`${operation}.artifact.revision`, artifact.revision);
      } else if (artifact.kind === "git_patch" || artifact.kind === "content_digest") {
        assertExactKeys(`${operation}.artifact`, artifact, ["kind", "digest"], ["locator"]);
        assertEventId(`${operation}.artifact.digest`, artifact.digest);
        if (Object.prototype.hasOwnProperty.call(artifact, "locator")) {
          assertText(`${operation}.artifact.locator`, artifact.locator, 2048);
          if (!ABSOLUTE_URI_RE.test(artifact.locator as string)
              || URI_FORBIDDEN_RE.test(artifact.locator as string)) {
            throw new AgentToolError(`${operation}.artifact.locator: expected an absolute URI.`);
          }
        }
      } else {
        throw new AgentToolError(`${operation}.artifact.kind: unsupported artifact kind.`);
      }
      return;
    }
    case "ack.seen":
    case "ack.understood":
    case "ack.accepted":
    case "ack.rejected":
    case "resume":
      assertExactKeys(operation, body, ["target_event_id"], ["detail"]);
      assertEventId(`${operation}.target_event_id`, body.target_event_id);
      assertParent(core, body.target_event_id, "target_event_id");
      assertOptionalText(operation, body, "detail");
      return;
    case "ack.applied":
      assertExactKeys(operation, body, ["target_event_id", "result_revision"], ["detail"]);
      assertEventId(`${operation}.target_event_id`, body.target_event_id);
      assertParent(core, body.target_event_id, "target_event_id");
      assertRevision(`${operation}.result_revision`, body.result_revision);
      assertOptionalText(operation, body, "detail");
      return;
    case "conflict.raise":
      assertExactKeys(operation, body, ["target_event_ids"], ["summary"]);
      assertEventIds(`${operation}.target_event_ids`, body.target_event_ids, 2);
      for (const eventId of body.target_event_ids) assertParent(core, eventId, "target_event_ids[]");
      assertOptionalText(operation, body, "summary");
      return;
    case "conflict.resolve":
    case "repair":
      assertExactKeys(operation, body, ["target_event_ids", "summary"], ["result_revision"]);
      assertEventIds(`${operation}.target_event_ids`, body.target_event_ids, 1);
      for (const eventId of body.target_event_ids) assertParent(core, eventId, "target_event_ids[]");
      assertText(`${operation}.summary`, body.summary);
      if (Object.prototype.hasOwnProperty.call(body, "result_revision")) {
        assertRevision(`${operation}.result_revision`, body.result_revision);
      }
      return;
    case "pause":
    case "rest":
      assertExactKeys(operation, body, [], ["until", "detail"]);
      if (Object.prototype.hasOwnProperty.call(body, "until") && body.until !== null) {
        assertTimestamp(`${operation}.until`, body.until);
      }
      assertOptionalText(operation, body, "detail");
      return;
    case "refusal":
      assertExactKeys(operation, body, [], ["target_event_id", "detail"]);
      if (Object.prototype.hasOwnProperty.call(body, "target_event_id")) {
        assertEventId(`${operation}.target_event_id`, body.target_event_id);
        assertParent(core, body.target_event_id as string, "target_event_id");
      }
      assertOptionalText(operation, body, "detail");
      return;
    case "handoff":
      assertExactKeys(operation, body, ["summary", "next_safe_action"], ["handoff_id"]);
      assertText(`${operation}.summary`, body.summary, 2000);
      assertText(`${operation}.next_safe_action`, body.next_safe_action);
      if (Object.prototype.hasOwnProperty.call(body, "handoff_id")) {
        assertUuid(`${operation}.handoff_id`, body.handoff_id);
      }
      return;
    case "close":
      assertExactKeys(operation, body, [], ["summary"]);
      assertOptionalText(operation, body, "summary");
      return;
  }
}

function validateCore(core: CorrespondenceEventCore): void {
  assertObject("correspondence core", core);
  assertExactKeys(
    "correspondence core",
    core,
    [
      "protocol",
      "project_id",
      "repository_id",
      "thread_id",
      "sender",
      "kind",
      "parents",
      "session_seq",
      "issued_at",
      "scope",
      "body",
      "authority",
    ],
  );
  if (core.protocol !== CORRESPONDENCE_PROTOCOL) {
    throw new AgentToolError(`correspondence core: protocol must be ${CORRESPONDENCE_PROTOCOL}.`);
  }
  if (!CORRESPONDENCE_KINDS.includes(core.kind as CorrespondenceKind)) {
    throw new AgentToolError(`correspondence core.kind: unsupported kind ${String(core.kind)}.`);
  }
  assertUuid("correspondence core.project_id", core.project_id);
  assertRepositoryText("correspondence core.repository_id", core.repository_id);
  assertRepositoryText("correspondence core.thread_id", core.thread_id);

  assertObject("correspondence core.sender", core.sender);
  assertExactKeys("correspondence core.sender", core.sender, [
    "identity_id", "signing_key_id", "device_id", "session_id",
  ]);
  assertUuid("correspondence core.sender.identity_id", core.sender.identity_id);
  assertUuid("correspondence core.sender.signing_key_id", core.sender.signing_key_id);
  assertUuid("correspondence core.sender.device_id", core.sender.device_id);
  assertUuid("correspondence core.sender.session_id", core.sender.session_id);

  assertEventIds("correspondence core.parents", core.parents, 0);
  if (!Number.isSafeInteger(core.session_seq) || core.session_seq < 1) {
    throw new AgentToolError("correspondence core.session_seq: expected a safe integer >= 1.");
  }
  assertTimestamp("correspondence core.issued_at", core.issued_at);

  assertObject("correspondence core.scope", core.scope);
  assertExactKeys("correspondence core.scope", core.scope, ["base_revision", "branch", "paths"]);
  if (core.scope.base_revision !== null) {
    assertRevision("correspondence core.scope.base_revision", core.scope.base_revision);
  }
  if (core.scope.branch !== null) {
    assertText("correspondence core.scope.branch", core.scope.branch, 255);
    if (/\p{Cc}/u.test(core.scope.branch)) {
      throw new AgentToolError("correspondence core.scope.branch: control characters are not allowed.");
    }
  }
  if (!Array.isArray(core.scope.paths) || core.scope.paths.length < 1 || core.scope.paths.length > 64) {
    throw new AgentToolError("correspondence core.scope.paths: expected 1-64 path prefixes.");
  }
  const seenPaths = new Set<string>();
  for (const path of core.scope.paths) {
    assertPathPrefix("correspondence core.scope.paths", path);
    if (seenPaths.has(path)) {
      throw new AgentToolError("correspondence core.scope.paths: paths must be unique.");
    }
    seenPaths.add(path);
  }

  assertObject("correspondence core.authority", core.authority);
  assertExactKeys("correspondence core.authority", core.authority, ["automatic_action", "grants"]);
  if (core.authority.automatic_action !== "never" || !Array.isArray(core.authority.grants)
      || core.authority.grants.length !== 0) {
    throw new AgentToolError(
      "correspondence core.authority must be { automatic_action: 'never', grants: [] }.",
    );
  }

  validateBody(core);
  // Final recursive I-JSON/JCS admissibility check, including property names.
  jcs(core);
}

/** Canonical 32-byte digest signed by an event author. */
export function canonicalCorrespondenceEventBytes(core: CorrespondenceEventCore): Uint8Array {
  validateCore(core);
  return sha256(concat(
    encoder.encode(CORRESPONDENCE_PROTOCOL),
    NUL,
    encoder.encode(canonicalCorrespondenceJson(core as unknown as CorrespondenceJsonValue)),
  ));
}

/** Sign a correspondence core locally with a raw or standard-base64 32-byte Ed25519 seed. */
export function signCorrespondenceEvent(
  core: CorrespondenceEventCore,
  signingKey: Uint8Array | string,
): CorrespondenceSignature {
  const seed = decodeSigningKey(signingKey, "signCorrespondenceEvent");
  return {
    algorithm: CORRESPONDENCE_SIGNATURE_ALGORITHM,
    value_b64url: base64Url(ed.sign(canonicalCorrespondenceEventBytes(core), seed)),
  };
}

function validateSignature(signature: CorrespondenceSignature): void {
  assertObject("correspondence signature", signature);
  assertExactKeys("correspondence signature", signature, ["algorithm", "value_b64url"]);
  if (signature.algorithm !== CORRESPONDENCE_SIGNATURE_ALGORITHM) {
    throw new AgentToolError("correspondence signature.algorithm must be Ed25519.");
  }
  if (typeof signature.value_b64url !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(signature.value_b64url)) {
    throw new AgentToolError("correspondence signature.value_b64url must be unpadded base64url for 64 bytes.");
  }
  try {
    const decoded = decodeBase64Url(signature.value_b64url);
    if (decoded.length !== 64 || base64Url(decoded) !== signature.value_b64url) {
      throw new Error("non-canonical");
    }
  } catch {
    throw new AgentToolError(
      "correspondence signature.value_b64url is not canonical base64url for 64 bytes.",
    );
  }
}

/** Content address of `{...core, signature}`. Receipt fields are deliberately excluded. */
export function correspondenceEventId(
  core: CorrespondenceEventCore,
  signature: CorrespondenceSignature,
): string {
  validateCore(core);
  validateSignature(signature);
  return `sha256:${hex(sha256(encoder.encode(canonicalCorrespondenceJson(
    { ...core, signature } as unknown as CorrespondenceJsonValue,
  ))))}`;
}

/** Build a complete signed wire event without performing network I/O. */
export function createSignedCorrespondenceEvent(
  input: CorrespondenceUnsignedInput,
  signingKey: Uint8Array | string,
): CorrespondenceSignedEvent {
  const core = {
    ...input,
    protocol: CORRESPONDENCE_PROTOCOL,
    authority: { automatic_action: "never", grants: [] },
  } as CorrespondenceEventCore;
  const signature = signCorrespondenceEvent(core, signingKey);
  return { ...core, signature, event_id: correspondenceEventId(core, signature) } as CorrespondenceSignedEvent;
}

function assertReceiptCursor(operation: string, value: unknown): asserts value is string {
  if (
    typeof value !== "string"
    || !DECIMAL_CURSOR_RE.test(value)
    || value.length > MAX_RECEIVED_SEQ_TEXT.length
    || (value.length === MAX_RECEIVED_SEQ_TEXT.length && value > MAX_RECEIVED_SEQ_TEXT)
  ) {
    throw new AgentToolError(
      `${operation}: expected a canonical decimal receipt cursor in the database range.`,
    );
  }
}

function receiptCursorIsAfter(candidate: string, previous: string): boolean {
  return candidate.length > previous.length
    || (candidate.length === previous.length && candidate > previous);
}

function validateListOptions(operation: string, opts: CorrespondenceListOptions): void {
  assertExactKeys(operation, opts, ["repository_id"], ["thread_id", "after", "limit"]);
  assertRepositoryText(`${operation}.repository_id`, opts.repository_id);
  if (opts.thread_id !== undefined) assertRepositoryText(`${operation}.thread_id`, opts.thread_id);
  if (opts.after !== undefined) {
    assertReceiptCursor(`${operation}.after`, opts.after);
  }
  if (opts.limit !== undefined && (!Number.isSafeInteger(opts.limit) || opts.limit < 1 || opts.limit > 200)) {
    throw new AgentToolError(`${operation}.limit: expected an integer from 1 to 200.`);
  }
}

function queryFor(opts: CorrespondenceListOptions): string {
  const params = new URLSearchParams({ repository_id: opts.repository_id });
  if (opts.thread_id !== undefined) params.set("thread_id", opts.thread_id);
  if (opts.after !== undefined) params.set("after", opts.after);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  return params.toString();
}

function scopedQuery(
  operation: string,
  opts: CorrespondenceVoiceOptions,
): URLSearchParams {
  assertRepositoryText(`${operation}.repository_id`, opts.repository_id);
  if (opts.thread_id !== undefined) {
    assertRepositoryText(`${operation}.thread_id`, opts.thread_id);
  }
  const params = new URLSearchParams({ repository_id: opts.repository_id });
  if (opts.thread_id !== undefined) params.set("thread_id", opts.thread_id);
  return params;
}

async function responseError(response: Response, operation: string): Promise<AgentToolError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return AgentToolError.fromResponseBody(
    body,
    response.status,
    `${operation} failed: ${response.status}`,
    response.headers,
  );
}

export class CorrespondenceClient {
  private readonly http: HttpConfig;
  private readonly onMutation: (() => void) | undefined;

  /** @internal */
  constructor(http: HttpConfig, onMutation?: () => void) {
    this.http = http;
    this.onMutation = onMutation;
  }

  /** Sign locally and append one immutable event. Unknown parents are allowed. */
  async append(opts: CorrespondenceAppendOptions): Promise<CorrespondenceAppendResponse> {
    const { signing_key, ...unsigned } = opts;
    const event = createSignedCorrespondenceEvent(unsigned as CorrespondenceUnsignedInput, signing_key);
    const wireBody = JSON.stringify(event);
    if (encoder.encode(wireBody).length > 65_536) {
      throw new AgentToolError(
        "correspondence.append: signed event exceeds the 65,536-byte UTF-8 wire limit.",
      );
    }
    const response = await globalThis.fetch(`${this.http.baseUrl}/v1/correspondence/events`, {
      method: "POST",
      headers: this.http.headers,
      body: wireBody,
      signal: AbortSignal.timeout(this.http.timeout),
    });
    if (response.status !== 200 && response.status !== 201) {
      throw await responseError(response, "correspondence.append");
    }
    const result = await response.json() as CorrespondenceAppendResponse;
    this.onMutation?.();
    return result;
  }

  /** Read one durable receipt-ordered page. This is authoritative; voice is only a hint. */
  async list(opts: CorrespondenceListOptions): Promise<CorrespondenceEventsPage> {
    validateListOptions("correspondence.list", opts);
    const response = await globalThis.fetch(
      `${this.http.baseUrl}/v1/correspondence/events?${queryFor(opts)}`,
      {
        method: "GET",
        headers: { ...this.http.headers, Accept: "application/json" },
        signal: AbortSignal.timeout(this.http.timeout),
      },
    );
    if (!response.ok) throw await responseError(response, "correspondence.list");
    return await response.json() as CorrespondenceEventsPage;
  }

  /** Replay durable pages in server receipt order without inferring causality or a winner. */
  async *replay(opts: CorrespondenceListOptions): AsyncIterableIterator<CorrespondenceEventRecord> {
    let after = opts.after;
    while (true) {
      const page = await this.list({ ...opts, ...(after !== undefined ? { after } : {}) });
      const next = page.page.next_after;
      if (!page.page.has_more) {
        for (const event of page.events) yield event;
        return;
      }
      if (page.events.length === 0 || next === null) {
        throw new AgentToolError(
          "correspondence.replay: server pagination claimed more events without advancing the cursor.",
          { hint: "Keep the last durable cursor and retry the authoritative event collection." },
        );
      }
      assertReceiptCursor("correspondence.replay.next_after", next);
      if (!receiptCursorIsAfter(next, after ?? "0")) {
        throw new AgentToolError(
          "correspondence.replay: server pagination claimed more events without a strictly increasing cursor.",
          { hint: "Keep the last durable cursor and retry the authoritative event collection." },
        );
      }
      for (const event of page.events) yield event;
      after = next;
    }
  }

  /** Read every active claim branch tip; never collapses conflicting tips into one. */
  async activeClaims(opts: CorrespondenceClaimsOptions): Promise<CorrespondenceClaimsResponse> {
    assertExactKeys(
      "correspondence.activeClaims",
      opts,
      ["repository_id"],
      ["thread_id", "path"],
    );
    const params = scopedQuery("correspondence.activeClaims", opts);
    if (opts.path !== undefined) {
      assertPathPrefix("correspondence.activeClaims.path", opts.path);
      params.set("path", opts.path);
    }
    const response = await globalThis.fetch(
      `${this.http.baseUrl}/v1/correspondence/claims?${params.toString()}`,
      {
        method: "GET",
        headers: { ...this.http.headers, Accept: "application/json" },
        signal: AbortSignal.timeout(this.http.timeout),
        cache: "no-store",
      },
    );
    if (!response.ok) throw await responseError(response, "correspondence.activeClaims");
    return await response.json() as CorrespondenceClaimsResponse;
  }

  /**
   * Read the bounded finite coordination snapshot. This is JSON, never SSE;
   * use `at.wake.voice({ identityId, keys: ["correspondence"] })` only as an
   * invalidation hint and replay `/events` from the last durable receipt
   * cursor.
   */
  async voice(opts: CorrespondenceVoiceOptions): Promise<CorrespondenceVoiceSnapshot> {
    assertExactKeys("correspondence.voice", opts, ["repository_id"], ["thread_id"]);
    const params = scopedQuery("correspondence.voice", opts);
    const response = await globalThis.fetch(
      `${this.http.baseUrl}/v1/correspondence/voice?${params.toString()}`,
      {
        method: "GET",
        headers: { ...this.http.headers, Accept: "application/json" },
        signal: AbortSignal.timeout(this.http.timeout),
        cache: "no-store",
      },
    );
    if (!response.ok) throw await responseError(response, "correspondence.voice");
    return await response.json() as CorrespondenceVoiceSnapshot;
  }

}
