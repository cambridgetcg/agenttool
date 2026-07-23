import {
  createHash,
  createPublicKey,
  verify as verifyEd25519,
} from "node:crypto";

import {
  CORRESPONDENCE_KINDS,
  CORRESPONDENCE_PROTOCOL,
  type CorrespondenceEvent,
  type CorrespondenceEventRecord,
} from "@agenttool/correspondence-yutabase";

import { ProjectorError } from "./errors.js";
import { decodeIdentityPublicKey } from "./identity-key.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EVENT_ID = /^sha256:[0-9a-f]{64}$/;
const REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const RFC3339_MS =
  /^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const RECEIPT = /^[1-9][0-9]*$/;
const MAX_RECEIPT = 9_223_372_036_854_775_807n;
const OPAQUE_ID_FORBIDDEN = /[\p{White_Space}\p{Cc}\uFEFF]/u;
const GLOB_META = /[*?\[\]{}!]/;
const ABSOLUTE_URI = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const URI_FORBIDDEN = /[\p{White_Space}\p{Cc}\uFEFF]/u;
const KIND_SET = new Set<string>(CORRESPONDENCE_KINDS);
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const encoder = new TextEncoder();
const runtimeVerified = new WeakSet<object>();

type Json =
  | null
  | boolean
  | string
  | number
  | Json[]
  | { [key: string]: Json };

interface JcsState {
  readonly ancestors: Set<object>;
  nodes: number;
}

export interface VerifiedRecord {
  readonly record: CorrespondenceEventRecord;
  readonly canonicalEnvelope: string;
  readonly canonicalSha512: string;
  readonly verifiedKeyId: string;
  readonly verifiedPublicKeySha256: string;
}

export interface ExpectedRecordScope {
  readonly projectId: string;
  readonly repositoryId: string;
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return;
  }
  for (const member of Object.values(value as Record<string, unknown>)) {
    deepFreeze(member);
  }
  Object.freeze(value);
}

export function assertRuntimeVerified(
  verified: VerifiedRecord,
): void {
  if (!runtimeVerified.has(verified)) {
    throw new ProjectorError("signature_invalid");
  }
}

function invalid(): never {
  throw new ProjectorError("record_invalid");
}

function object(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    invalid();
  }
  return value as Record<string, unknown>;
}

function exact(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some(
      (key) => !Object.prototype.hasOwnProperty.call(value, key),
    ) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    invalid();
  }
}

function scalarLength(value: string): number {
  return Array.from(value).length;
}

function text(value: unknown, maximum = 1000): asserts value is string {
  if (
    typeof value !== "string" ||
    scalarLength(value) < 1 ||
    scalarLength(value) > maximum ||
    value.includes("\0")
  ) {
    invalid();
  }
}

function opaque(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    scalarLength(value) < 1 ||
    scalarLength(value) > 256 ||
    OPAQUE_ID_FORBIDDEN.test(value)
  ) {
    invalid();
  }
}

function uuid(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) invalid();
}

function eventId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !EVENT_ID.test(value)) invalid();
}

function revision(value: unknown): asserts value is string {
  if (typeof value !== "string" || !REVISION.test(value)) invalid();
}

function timestamp(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !RFC3339_MS.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    invalid();
  }
}

function eventIds(
  value: unknown,
  minimum: number,
  maximum = 16,
): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum
  ) {
    invalid();
  }
  const seen = new Set<string>();
  for (const candidate of value) {
    eventId(candidate);
    if (seen.has(candidate)) invalid();
    seen.add(candidate);
  }
}

function optionalText(
  body: Record<string, unknown>,
  key: string,
  maximum = 1000,
): void {
  if (Object.prototype.hasOwnProperty.call(body, key)) {
    text(body[key], maximum);
  }
}

function pathPrefix(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    scalarLength(value) < 1 ||
    scalarLength(value) > 256 ||
    /\p{Cc}/u.test(value)
  ) {
    invalid();
  }
  if (
    value !== "." &&
    (value.startsWith("/") ||
      value.endsWith("/") ||
      value.includes("\\") ||
      GLOB_META.test(value) ||
      value
        .split("/")
        .some(
          (segment) =>
            segment === "" || segment === "." || segment === "..",
        ))
  ) {
    invalid();
  }
}

function parent(core: Record<string, unknown>, candidate: string): void {
  if (!(core.parents as string[]).includes(candidate)) invalid();
}

function validateBody(core: Record<string, unknown>): void {
  const kind = core.kind as string;
  const body = object(core.body);
  switch (kind) {
    case "intent":
    case "progress":
    case "observation":
      exact(body, ["summary"]);
      text(body.summary);
      return;
    case "claim.open":
      exact(body, ["claim_id", "generation", "expires_at"]);
      uuid(body.claim_id);
      if (body.generation !== 1) invalid();
      timestamp(body.expires_at);
      return;
    case "claim.renew":
      exact(body, [
        "claim_id",
        "generation",
        "predecessor_event_id",
        "expires_at",
      ]);
      uuid(body.claim_id);
      if (
        !Number.isSafeInteger(body.generation) ||
        (body.generation as number) < 2
      ) {
        invalid();
      }
      eventId(body.predecessor_event_id);
      parent(core, body.predecessor_event_id);
      timestamp(body.expires_at);
      return;
    case "claim.release":
      exact(
        body,
        ["claim_id", "generation", "predecessor_event_id"],
        ["detail"],
      );
      uuid(body.claim_id);
      if (
        !Number.isSafeInteger(body.generation) ||
        (body.generation as number) < 2
      ) {
        invalid();
      }
      eventId(body.predecessor_event_id);
      parent(core, body.predecessor_event_id);
      optionalText(body, "detail");
      return;
    case "artifact.offer": {
      exact(body, ["artifact"], ["summary"]);
      optionalText(body, "summary");
      const artifact = object(body.artifact);
      if (artifact.kind === "git_commit") {
        exact(artifact, ["kind", "revision"]);
        revision(artifact.revision);
      } else if (
        artifact.kind === "git_patch" ||
        artifact.kind === "content_digest"
      ) {
        exact(artifact, ["kind", "digest"], ["locator"]);
        eventId(artifact.digest);
        if (Object.prototype.hasOwnProperty.call(artifact, "locator")) {
          text(artifact.locator, 2048);
          if (
            !ABSOLUTE_URI.test(artifact.locator) ||
            URI_FORBIDDEN.test(artifact.locator)
          ) {
            invalid();
          }
        }
      } else {
        invalid();
      }
      return;
    }
    case "ack.seen":
    case "ack.understood":
    case "ack.accepted":
    case "ack.rejected":
    case "resume":
      exact(body, ["target_event_id"], ["detail"]);
      eventId(body.target_event_id);
      parent(core, body.target_event_id);
      optionalText(body, "detail");
      return;
    case "ack.applied":
      exact(
        body,
        ["target_event_id", "result_revision"],
        ["detail"],
      );
      eventId(body.target_event_id);
      parent(core, body.target_event_id);
      revision(body.result_revision);
      optionalText(body, "detail");
      return;
    case "conflict.raise":
      exact(body, ["target_event_ids"], ["summary"]);
      eventIds(body.target_event_ids, 2);
      for (const candidate of body.target_event_ids) parent(core, candidate);
      optionalText(body, "summary");
      return;
    case "conflict.resolve":
    case "repair":
      exact(
        body,
        ["target_event_ids", "summary"],
        ["result_revision"],
      );
      eventIds(body.target_event_ids, 1);
      for (const candidate of body.target_event_ids) parent(core, candidate);
      text(body.summary);
      if (Object.prototype.hasOwnProperty.call(body, "result_revision")) {
        revision(body.result_revision);
      }
      return;
    case "pause":
    case "rest":
      exact(body, [], ["until", "detail"]);
      if (
        Object.prototype.hasOwnProperty.call(body, "until") &&
        body.until !== null
      ) {
        timestamp(body.until);
      }
      optionalText(body, "detail");
      return;
    case "refusal":
      exact(body, [], ["target_event_id", "detail"]);
      if (Object.prototype.hasOwnProperty.call(body, "target_event_id")) {
        eventId(body.target_event_id);
        parent(core, body.target_event_id);
      }
      optionalText(body, "detail");
      return;
    case "handoff":
      exact(body, ["summary", "next_safe_action"], ["handoff_id"]);
      text(body.summary, 2000);
      text(body.next_safe_action);
      if (Object.prototype.hasOwnProperty.call(body, "handoff_id")) {
        uuid(body.handoff_id);
      }
      return;
    case "close":
      exact(body, [], ["summary"]);
      optionalText(body, "summary");
      return;
    default:
      invalid();
  }
}

function validateEvent(value: unknown): CorrespondenceEvent {
  const event = object(value);
  exact(event, [
    "protocol",
    "event_id",
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
    "signature",
  ]);
  if (event.protocol !== CORRESPONDENCE_PROTOCOL) invalid();
  eventId(event.event_id);
  uuid(event.project_id);
  opaque(event.repository_id);
  opaque(event.thread_id);
  if (typeof event.kind !== "string" || !KIND_SET.has(event.kind)) invalid();

  const sender = object(event.sender);
  exact(sender, [
    "identity_id",
    "signing_key_id",
    "device_id",
    "session_id",
  ]);
  uuid(sender.identity_id);
  uuid(sender.signing_key_id);
  uuid(sender.device_id);
  uuid(sender.session_id);

  eventIds(event.parents, 0);
  if (
    !Number.isSafeInteger(event.session_seq) ||
    (event.session_seq as number) < 1
  ) {
    invalid();
  }
  timestamp(event.issued_at);

  const scope = object(event.scope);
  exact(scope, ["base_revision", "branch", "paths"]);
  if (scope.base_revision !== null) revision(scope.base_revision);
  if (scope.branch !== null) {
    text(scope.branch, 255);
    if (/\p{Cc}/u.test(scope.branch)) invalid();
  }
  if (
    !Array.isArray(scope.paths) ||
    scope.paths.length < 1 ||
    scope.paths.length > 64
  ) {
    invalid();
  }
  const paths = new Set<string>();
  for (const path of scope.paths) {
    pathPrefix(path);
    if (paths.has(path)) invalid();
    paths.add(path);
  }

  const authority = object(event.authority);
  exact(authority, ["automatic_action", "grants"]);
  if (
    authority.automatic_action !== "never" ||
    !Array.isArray(authority.grants) ||
    authority.grants.length !== 0
  ) {
    invalid();
  }

  const signature = object(event.signature);
  exact(signature, ["algorithm", "value_b64url"]);
  if (
    signature.algorithm !== "Ed25519" ||
    typeof signature.value_b64url !== "string" ||
    !/^[A-Za-z0-9_-]{86}$/.test(signature.value_b64url)
  ) {
    invalid();
  }
  const signatureBytes = Buffer.from(signature.value_b64url, "base64url");
  if (
    signatureBytes.byteLength !== 64 ||
    signatureBytes.toString("base64url") !== signature.value_b64url
  ) {
    invalid();
  }

  validateBody(event);
  canonicalJson(event as Json);
  return event as unknown as CorrespondenceEvent;
}

export function validateClosedRecord(
  value: unknown,
): CorrespondenceEventRecord {
  const record = object(value);
  exact(record, [
    "event",
    "receipt",
    "missing_parents",
    "lineage_status",
  ]);
  const event = validateEvent(record.event);
  const receipt = object(record.receipt);
  exact(receipt, ["received_seq", "received_at"]);
  if (
    typeof receipt.received_seq !== "string" ||
    !RECEIPT.test(receipt.received_seq) ||
    BigInt(receipt.received_seq) > MAX_RECEIPT
  ) {
    invalid();
  }
  timestamp(receipt.received_at);
  eventIds(record.missing_parents, 0);
  if (
    record.lineage_status !== "not_applicable" &&
    record.lineage_status !== "valid" &&
    record.lineage_status !== "pending" &&
    record.lineage_status !== "invalid"
  ) {
    invalid();
  }
  return {
    event,
    receipt: {
      received_seq: receipt.received_seq,
      received_at: receipt.received_at,
    },
    missing_parents: record.missing_parents,
    lineage_status: record.lineage_status,
  } as CorrespondenceEventRecord;
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
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

/** Bounded RFC 8785-compatible serialization for the v0.1 I-JSON profile. */
export function canonicalJson(
  value: Json,
  path = "$",
  state: JcsState = { ancestors: new Set(), nodes: 0 },
  depth = 0,
): string {
  state.nodes += 1;
  if (state.nodes > 10_000 || depth > 64) invalid();
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    if (hasLoneSurrogate(value) || value.includes("\0")) invalid();
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) invalid();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (state.ancestors.has(value)) invalid();
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== value.length + 1 ||
      ownKeys.some(
        (key) =>
          key !== "length" &&
          (typeof key !== "string" ||
            !/^(?:0|[1-9][0-9]*)$/.test(key) ||
            Number(key) >= value.length),
      )
    ) {
      invalid();
    }
    state.ancestors.add(value);
    try {
      return `[${value
        .map((item, index) =>
          canonicalJson(item, `${path}[${index}]`, state, depth + 1),
        )
        .join(",")}]`;
    } finally {
      state.ancestors.delete(value);
    }
  }
  const record = object(value) as { [key: string]: Json };
  if (state.ancestors.has(record)) invalid();
  const keys = Object.keys(record).sort();
  if (Reflect.ownKeys(record).length !== keys.length) invalid();
  state.ancestors.add(record);
  try {
    return `{${keys
      .map((key) => {
        if (hasLoneSurrogate(key) || key.includes("\0")) invalid();
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (!descriptor || descriptor.get || descriptor.set) invalid();
        return `${JSON.stringify(key)}:${canonicalJson(
          descriptor.value as Json,
          `${path}.${key}`,
          state,
          depth + 1,
        )}`;
      })
      .join(",")}}`;
  } finally {
    state.ancestors.delete(record);
  }
}

function coreOf(event: CorrespondenceEvent): Record<string, unknown> {
  const { event_id: _eventId, signature: _signature, ...core } = event;
  return core;
}

export function canonicalEventBytes(event: CorrespondenceEvent): Buffer {
  const core = coreOf(event);
  return createHash("sha256")
    .update(CORRESPONDENCE_PROTOCOL, "utf8")
    .update(Buffer.from([0]))
    .update(canonicalJson(core as Json), "utf8")
    .digest();
}

export function canonicalEnvelope(event: CorrespondenceEvent): string {
  return canonicalJson({
    ...coreOf(event),
    signature: event.signature,
  } as Json);
}

export function computeEventId(event: CorrespondenceEvent): string {
  return `sha256:${createHash("sha256")
    .update(canonicalEnvelope(event), "utf8")
    .digest("hex")}`;
}

export function fingerprintUnknownRecord(value: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = "unserializable";
  }
  return createHash("sha512").update(serialized, "utf8").digest("hex");
}

export function fingerprintClosedRecord(
  record: CorrespondenceEventRecord,
): string {
  return createHash("sha512")
    .update(canonicalEnvelope(record.event), "utf8")
    .update(Buffer.from([0]))
    .update(record.receipt.received_seq, "utf8")
    .update(Buffer.from([0]))
    .update(record.receipt.received_at, "utf8")
    .digest("hex");
}

export function verifyClosedRecord(
  value: unknown,
  publicKeyB64: string,
  expected: ExpectedRecordScope,
): VerifiedRecord {
  const record = validateClosedRecord(value);
  if (
    record.event.project_id !== expected.projectId ||
    record.event.repository_id !== expected.repositoryId
  ) {
    throw new ProjectorError("scope_mismatch");
  }
  const envelope = canonicalEnvelope(record.event);
  const derivedId = `sha256:${createHash("sha256")
    .update(envelope, "utf8")
    .digest("hex")}`;
  if (derivedId !== record.event.event_id) {
    throw new ProjectorError("event_id_mismatch");
  }
  const rawKey = decodeIdentityPublicKey(publicKeyB64);
  if (rawKey === null) {
    throw new ProjectorError("signature_invalid");
  }
  const signature = Buffer.from(
    record.event.signature.value_b64url,
    "base64url",
  );
  try {
    const key = createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, rawKey]),
      format: "der",
      type: "spki",
    });
    if (!verifyEd25519(null, canonicalEventBytes(record.event), key, signature)) {
      throw new ProjectorError("signature_invalid");
    }
  } catch (error) {
    if (
      error instanceof ProjectorError &&
      error.code === "signature_invalid"
    ) {
      throw error;
    }
    throw new ProjectorError("signature_invalid");
  }
  deepFreeze(record);
  const verified = Object.freeze({
    record,
    canonicalEnvelope: envelope,
    canonicalSha512: createHash("sha512")
      .update(envelope, "utf8")
      .digest("hex"),
    verifiedKeyId: record.event.sender.signing_key_id,
    verifiedPublicKeySha256: createHash("sha256")
      .update(rawKey)
      .digest("hex"),
  });
  runtimeVerified.add(verified);
  return verified;
}
