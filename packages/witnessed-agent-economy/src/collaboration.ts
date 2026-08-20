import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { COLLABORATION_PARTICIPANT_HMAC_PROTOCOL, HASH_DOMAINS } from "./constants.js";
import { invalid } from "./errors.js";
import {
  bytesToHex,
  concatBytes,
  hexToBytes,
  opaqueScopedRef,
  scopedHash,
  sha256Bytes,
} from "./hash.js";
import {
  canonicalInstant,
  canonicalJson,
  exactKeys,
  hex,
  nonEmptyString,
  object,
  snapshotInputWrapper,
  snapshotObject,
  validated,
  type JsonObject,
  type JsonValue,
} from "./internal.js";
import { rfc6962DomainMerkleRootHex } from "./merkle.js";
import type {
  CollaborationCheckpointProjection,
  CollaborationJournalEventSource,
  CollaborationWorkspaceHeadSource,
} from "./types.js";

const LEGACY_COLLAB_PROTOCOL = "agenttool.collab/0.1" as const;
const CURRENT_COLLAB_PROTOCOL = "agenttool.collab/0.2" as const;
const JOURNAL_GENESIS_HASH = "0".repeat(64);
const PARTICIPANT_SET_DOMAIN = "collaboration-participant-set";
const utf8 = new TextEncoder();
const NUL = new Uint8Array([0]);

function boundedSourceToken(value: JsonValue, path: string, maxBytes = 200): string {
  const token = nonEmptyString(value, path, maxBytes);
  if (/\s/u.test(token)) invalid(`${path} must not contain whitespace.`, path);
  return token;
}

function safeSourceSequence(value: JsonValue, path: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    invalid(`${path} must be a non-negative safe source-journal integer.`, path);
  }
  return value;
}

function parsePayloadJson(value: JsonValue, path: string): JsonObject {
  const text = nonEmptyString(value, path, 128 * 1024);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return invalid(`${path} must contain valid JSON.`, path);
  }
  return object(snapshotObject(parsed, path), path);
}

function validateWorkspace(value: unknown): Readonly<CollaborationWorkspaceHeadSource> {
  const record = snapshotObject(value, "$collaboration.workspace");
  exactKeys(record, ["id", "epoch_id", "event_head_sequence", "event_head_hash"], "$collaboration.workspace");
  boundedSourceToken(record.id!, "$collaboration.workspace.id");
  boundedSourceToken(record.epoch_id!, "$collaboration.workspace.epoch_id");
  safeSourceSequence(record.event_head_sequence!, "$collaboration.workspace.event_head_sequence", 0);
  hex(record.event_head_hash!, 32, "$collaboration.workspace.event_head_hash");
  return validated<CollaborationWorkspaceHeadSource>(record);
}

function validateEvent(value: unknown, index: number): Readonly<CollaborationJournalEventSource> {
  const path = `$collaboration.events[${index}]`;
  const record = snapshotObject(value, path);
  exactKeys(record, [
    "workspace_id", "epoch_id", "sequence", "id", "protocol", "type",
    "entity_id", "actor", "session_id", "occurred_at", "payload_json",
    "prev_hash", "hash",
  ], path);
  boundedSourceToken(record.workspace_id!, `${path}.workspace_id`);
  boundedSourceToken(record.epoch_id!, `${path}.epoch_id`);
  safeSourceSequence(record.sequence!, `${path}.sequence`, 1);
  boundedSourceToken(record.id!, `${path}.id`);
  if (record.protocol !== LEGACY_COLLAB_PROTOCOL && record.protocol !== CURRENT_COLLAB_PROTOCOL) {
    invalid(`${path}.protocol is not a supported AgentTool collaboration journal protocol.`, `${path}.protocol`);
  }
  boundedSourceToken(record.type!, `${path}.type`);
  boundedSourceToken(record.entity_id!, `${path}.entity_id`);
  nonEmptyString(record.actor!, `${path}.actor`, 200);
  if (record.session_id !== null) boundedSourceToken(record.session_id!, `${path}.session_id`);
  canonicalInstant(record.occurred_at!, `${path}.occurred_at`);
  parsePayloadJson(record.payload_json!, `${path}.payload_json`);
  hex(record.prev_hash!, 32, `${path}.prev_hash`);
  hex(record.hash!, 32, `${path}.hash`);
  return validated<CollaborationJournalEventSource>(record);
}

/** Exact port of the AgentTool collab journal event hash recipe. */
export function collaborationEventHash(value: unknown): string {
  const event = validateEvent(value, 0);
  const body: Record<string, unknown> = {
    protocol: event.protocol,
    workspace_id: event.workspace_id,
    epoch_id: event.epoch_id,
    sequence: event.sequence,
    id: event.id,
    type: event.type,
    entity_id: event.entity_id,
    actor: event.actor,
    occurred_at: event.occurred_at,
    payload: parsePayloadJson(event.payload_json as unknown as JsonValue, "$collaboration.event.payload_json"),
    prev_hash: event.prev_hash,
  };
  if (event.protocol !== LEGACY_COLLAB_PROTOCOL) body.session_id = event.session_id;
  return bytesToHex(sha256Bytes(utf8.encode(canonicalJson(body))));
}

export interface CollaborationCheckpointInput {
  workspace: unknown;
  /** Full ordered journal prefix 1..head. No database or hosted state is read. */
  events: readonly unknown[];
  /** Caller-supplied cryptographically random 32-byte secret. It is never
   * included in the projection, is required to recompute/verify the participant
   * root, and must not be reused across privacy domains or as an identity
   * credential. */
  participant_blinding_key_hex: string;
}

export function projectCollaborationCheckpoint(
  inputValue: CollaborationCheckpointInput,
): Readonly<CollaborationCheckpointProjection> {
  const input = snapshotInputWrapper(
    inputValue,
    "$collaboration",
    ["workspace", "events", "participant_blinding_key_hex"],
    ["events"],
  );
  const workspace = validateWorkspace(input.workspace);
  if (typeof input.participant_blinding_key_hex !== "string") {
    invalid("participant_blinding_key_hex must be a string.", "$collaboration.participant_blinding_key_hex");
  }
  const participantBlindingKey = hexToBytes(input.participant_blinding_key_hex, 32);
  if (!Array.isArray(input.events)) invalid("Collaboration events must be an array.", "$collaboration.events");
  if (input.events.length > 4_096) invalid("Collaboration checkpoint exceeds 4096 events.", "$collaboration.events");
  const events = input.events.map(validateEvent);
  if (workspace.event_head_sequence !== events.length) {
    invalid("Workspace head sequence must equal the complete supplied journal length.", "$collaboration.workspace.event_head_sequence");
  }
  let previous = JOURNAL_GENESIS_HASH;
  for (const [index, event] of events.entries()) {
    if (
      event.workspace_id !== workspace.id
      || event.epoch_id !== workspace.epoch_id
      || event.sequence !== index + 1
      || event.prev_hash !== previous
      || event.hash !== collaborationEventHash(event)
    ) {
      invalid("Collaboration event does not extend the exact verified journal prefix.", `$collaboration.events[${index}]`);
    }
    previous = event.hash;
  }
  if (workspace.event_head_hash !== previous) {
    invalid("Workspace head hash does not match the recomputed complete journal.", "$collaboration.workspace.event_head_hash");
  }
  const participantRefs = [...new Set(events.map((event) => bytesToHex(hmac(
    sha256,
    participantBlindingKey,
    concatBytes(
      utf8.encode(COLLABORATION_PARTICIPANT_HMAC_PROTOCOL), NUL,
      utf8.encode(workspace.id), NUL,
      utf8.encode(workspace.epoch_id), NUL,
      utf8.encode(event.actor), NUL,
      utf8.encode(event.session_id ?? ""),
    ),
  ))))].sort();
  return Object.freeze({
    workspace_ref: opaqueScopedRef(HASH_DOMAINS.collaboration_workspace_ref, {
      workspace_id: workspace.id,
    }),
    epoch_ref: scopedHash(HASH_DOMAINS.collaboration_epoch_ref, {
      workspace_id: workspace.id,
      epoch_id: workspace.epoch_id,
    }),
    event_head_sequence: workspace.event_head_sequence.toString(),
    event_head_hash: `sha256:${workspace.event_head_hash}`,
    event_count: events.length.toString(),
    participant_set_root: `sha256:${rfc6962DomainMerkleRootHex(
      PARTICIPANT_SET_DOMAIN,
      participantRefs.map((participant_ref) => ({ participant_ref })),
    )}`,
  });
}
