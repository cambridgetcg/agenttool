/**
 * agent-data/v1 record identity, computed client-side.
 *
 * An exporter that writes into a local `@agenttool/data` node must know the
 * record id the node will assign BEFORE it writes, so it can detect identity
 * drift (the node and the SDK disagreeing about what was stored). That needs
 * two things to be byte-compatible with the reference node:
 *
 *   - `canonicalJson`, the same spelling as `packages/data/src/canonical.ts`
 *     (`Object.keys(...).sort()` order, `JSON.stringify` scalars, `-0` → `0`,
 *     non-finite numbers and non-JSON values refused); and
 *   - the identity object `packages/data/src/node.ts § buildRecordEnvelope`
 *     hashes: `rec_` + sha256 hex of the canonical identity.
 *
 * The shared vector file `tests/fixtures/agent-data-record-id-vectors.json`
 * pins both against the real node from `packages/data/tests/` and against the
 * Python twin `packages/sdk-py/src/agenttool/_agent_data_id.py`. The data
 * package is normative: if the vectors disagree, this module is wrong.
 *
 * Internal module (leading underscore): the parity gate reads it as internal
 * on both sides. `agentDataRecordId` is re-exported from the package root.
 */

import { createHash } from "node:crypto";

import { AgentToolError } from "./errors.js";

/** The protocol label that is part of every record identity. */
const AGENT_DATA_PROTOCOL_LABEL = "agent-data/v1" as const;

/** Exactly the fields `@agenttool/data` hashes into a record id. */
export interface AgentDataRecordIdentity {
  protocol: typeof AGENT_DATA_PROTOCOL_LABEL;
  collection_id: string;
  source: {
    collector_id: string;
    uri: string;
    external_id?: string;
  };
  content: {
    sha256: string;
    size: number;
    media_type: string;
  };
  schema_version: string;
  key?: string;
  version?: string;
  supersedes_id?: string;
}

/** Inputs the `text` collector turns into one record. */
export interface AgentDataTextRecordInput {
  collection_id: string;
  /** The target collection's `schema.version` (the node default is `"1"`). */
  schema_version: string;
  text: string;
  /** Already-normalized media type, for example `application/json`. */
  media_type: string;
  source_uri: string;
  external_id?: string;
  key?: string;
  version?: string;
  supersedes_id?: string;
}

/**
 * Canonical JSON, byte-compatible with `packages/data/src/canonical.ts`.
 *
 * Keys sort by UTF-16 code unit (the default `Array.prototype.sort`), scalars
 * use `JSON.stringify`, `-0` is written as `0`, and anything JSON cannot hold
 * (a non-finite number, `undefined`, a function, a bigint) is refused rather
 * than coerced — a coerced value would hash to bytes the node never sees.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw invalidJson("JSON numbers must be finite");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") {
    throw invalidJson("Value is not JSON-compatible");
  }
  const object = value as Record<string, unknown>;
  const entries = Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`);
  return `{${entries.join(",")}}`;
}

/** Lowercase SHA-256 hex of a UTF-8 string or raw bytes. */
export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** UTF-8 byte length, as the node measures `content.size`. */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * The record id `@agenttool/data` assigns to an identity object:
 * `rec_` + sha256 hex of its canonical JSON. Mirrors
 * `packages/data/src/node.ts § recordIdForIdentity`. Pass the identity
 * exactly as the node builds it; optional fields that are absent must be
 * absent, not `undefined` (which canonical JSON refuses).
 */
export function agentDataRecordId(identity: AgentDataRecordIdentity): string {
  return `rec_${sha256Hex(canonicalJson(identity))}`;
}

/**
 * The identity the reference node's `text` collector produces for one input.
 *
 * Mirrors `buildRecordEnvelope`: `external_id`, `key`, `version`, and
 * `supersedes_id` are included only when non-empty, and content is the UTF-8
 * encoding of `text`. `observed_at`, `metadata`, and `provenance` are not part
 * of a record's identity and therefore do not appear here.
 */
export function agentDataTextRecordIdentity(
  input: AgentDataTextRecordInput,
): AgentDataRecordIdentity {
  const bytes = new TextEncoder().encode(input.text);
  return {
    protocol: AGENT_DATA_PROTOCOL_LABEL,
    collection_id: input.collection_id,
    source: {
      collector_id: "text",
      uri: input.source_uri,
      ...(input.external_id ? { external_id: input.external_id } : {}),
    },
    content: {
      sha256: sha256Hex(bytes),
      size: bytes.byteLength,
      media_type: input.media_type,
    },
    schema_version: input.schema_version,
    ...(input.key ? { key: input.key } : {}),
    ...(input.version ? { version: input.version } : {}),
    ...(input.supersedes_id ? { supersedes_id: input.supersedes_id } : {}),
  };
}

function invalidJson(message: string): AgentToolError {
  return new AgentToolError(message, {
    code: "invalid_json",
    hint: "Agent data canonical JSON accepts only finite numbers, strings, booleans, null, arrays, and plain objects.",
  });
}
