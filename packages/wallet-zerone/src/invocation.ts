import {
  assertUuid,
  bytesToHex,
  sha256BytesId,
} from "@agenttool/wallet";
import { sha256 } from "@noble/hashes/sha2.js";

import { invalid } from "./errors.js";
import { createZeroneWitnessLink } from "./messages.js";
import type {
  AgentToolInvocationProjection,
  ZeroneWitnessSubstrateLink,
} from "./types.js";
import {
  assertBoundedText,
  closedRecord,
} from "./validation.js";

const MAX_INT64 = 9_223_372_036_854_775_807n;
const UTF8 = new TextEncoder();

function assertUnicode(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        invalid(`${path} contains a lone UTF-16 surrogate.`, path);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      invalid(`${path} contains a lone UTF-16 surrogate.`, path);
    }
  }
}

/**
 * Match Go encoding/json's default string escaping, including its HTML-safe
 * escapes and U+2028/U+2029 behavior.
 */
function goJsonString(value: string, path: string): string {
  assertUnicode(value, path);
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function requireNullableText(
  value: unknown,
  path: string,
): string | null {
  if (value === null) return null;
  assertBoundedText(value, path, 8_192, { allowEmpty: true });
  assertUnicode(value, path);
  return value;
}

function validateProjection(
  value: unknown,
): Readonly<AgentToolInvocationProjection> {
  const item = closedRecord(value, [
    "amount",
    "buyer_did",
    "completed_at",
    "completion_sig",
    "created_at",
    "currency",
    "id",
    "listing_id",
    "settled_at",
    "status",
  ], "invocation");
  if (
    !Number.isSafeInteger(item.amount)
    || (item.amount as number) < 0
    || BigInt(item.amount as number) > MAX_INT64
  ) {
    invalid("invocation.amount must be a non-negative safe int64.", "invocation.amount");
  }
  assertBoundedText(item.buyer_did, "invocation.buyer_did", 1_024);
  assertBoundedText(item.created_at, "invocation.created_at", 128);
  assertBoundedText(item.currency, "invocation.currency", 32);
  assertUuid(item.id, "invocation.id");
  assertUuid(item.listing_id, "invocation.listing_id");
  assertBoundedText(item.status, "invocation.status", 64);
  const projection: AgentToolInvocationProjection = Object.freeze({
    amount: item.amount as number,
    buyer_did: item.buyer_did,
    completed_at: requireNullableText(
      item.completed_at,
      "invocation.completed_at",
    ),
    completion_sig: requireNullableText(
      item.completion_sig,
      "invocation.completion_sig",
    ),
    created_at: item.created_at,
    currency: item.currency,
    id: item.id,
    listing_id: item.listing_id,
    settled_at: requireNullableText(
      item.settled_at,
      "invocation.settled_at",
    ),
    status: item.status,
  });
  return projection;
}

/**
 * Exact compact JSON field order used by pinned zerone-core
 * tools/agenttool-relay canonicalInvocation.
 */
export function encodeAgentToolInvocationProjection(
  value: AgentToolInvocationProjection,
): Uint8Array {
  const item = validateProjection(value);
  const nullable = (field: string | null, path: string): string =>
    field === null ? "null" : goJsonString(field, path);
  const json =
    `{"amount":${item.amount}`
    + `,"buyer_did":${goJsonString(item.buyer_did, "invocation.buyer_did")}`
    + `,"completed_at":${nullable(item.completed_at, "invocation.completed_at")}`
    + `,"completion_sig":${nullable(item.completion_sig, "invocation.completion_sig")}`
    + `,"created_at":${goJsonString(item.created_at, "invocation.created_at")}`
    + `,"currency":${goJsonString(item.currency, "invocation.currency")}`
    + `,"id":${goJsonString(item.id, "invocation.id")}`
    + `,"listing_id":${goJsonString(item.listing_id, "invocation.listing_id")}`
    + `,"settled_at":${nullable(item.settled_at, "invocation.settled_at")}`
    + `,"status":${goJsonString(item.status, "invocation.status")}}`;
  return UTF8.encode(json);
}

export function computeAgentToolInvocationContentHash(
  value: AgentToolInvocationProjection,
): Uint8Array {
  return sha256(encodeAgentToolInvocationProjection(value));
}

export function describeAgentToolInvocationContent(
  value: AgentToolInvocationProjection,
): Readonly<{
  readonly canonical_bytes: Uint8Array;
  readonly content_hash: Uint8Array;
  readonly content_hash_hex: string;
  readonly content_hash_id: `sha256:${string}`;
}> {
  const canonical = encodeAgentToolInvocationProjection(value);
  const hash = sha256(canonical);
  return Object.freeze({
    canonical_bytes: Uint8Array.from(canonical),
    content_hash: Uint8Array.from(hash),
    content_hash_hex: bytesToHex(hash),
    content_hash_id: sha256BytesId(canonical),
  });
}

export function assertAgentToolInvocationAttestable(
  value: AgentToolInvocationProjection,
): void {
  const item = validateProjection(value);
  if (
    item.status !== "released"
    || item.completion_sig === null
    || item.completion_sig === ""
    || item.settled_at === null
    || item.settled_at === ""
  ) {
    invalid(
      "Only released invocations with completion_sig and settled_at are attestable.",
      "invocation",
    );
  }
}

/**
 * Safe high-level path from the exact AgentTool public invocation projection
 * to a Zerone witness link. Generic content-hash and link helpers remain
 * available for low-level parity tests, but callers should normally use this
 * function so escrowed, refunded, or incomplete invocations cannot be
 * submitted accidentally.
 */
export function createAgentToolInvocationWitnessLink(input: {
  readonly invocation: AgentToolInvocationProjection;
  readonly source_id: string;
  readonly source_url: string;
  readonly fetched_at_block: string;
}): Readonly<ZeroneWitnessSubstrateLink> {
  const invocation = validateProjection(input.invocation);
  assertAgentToolInvocationAttestable(invocation);
  if (input.source_id !== invocation.id) {
    invalid(
      "Witness source_id must equal the canonical invocation id.",
      "source_id",
    );
  }
  return createZeroneWitnessLink({
    source_id: input.source_id,
    source_url: input.source_url,
    content_hash: computeAgentToolInvocationContentHash(invocation),
    fetched_at_block: input.fetched_at_block,
  });
}
