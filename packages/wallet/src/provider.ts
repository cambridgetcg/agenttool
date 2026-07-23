import { sha256 } from "@noble/hashes/sha2.js";

import { base64UrlDecode, base64UrlEncode, bytesToHex } from "./bytes.js";
import { assertAuthorizedIntent } from "./capability.js";
import { LIMITS } from "./constants.js";
import { WalletProtocolError, invalid } from "./errors.js";
import { assertBoundedString, assertSha256Id, assertUuid } from "./identifiers.js";
import type {
  AuthorizedIntent,
  SignedPayload,
  SignerDescription,
  SigningRequest,
} from "./types.js";

const signingRequests = new WeakSet<object>();

function closedDataSnapshot(
  value: unknown,
  expected: readonly string[],
  reject: (message: string) => never,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return reject("Value must be a closed data object.");
  }
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return reject("Value properties could not be snapshotted safely.");
  }
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key !== "string")) {
    return reject("Value must not contain symbol properties.");
  }
  const actual = (ownKeys as string[]).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    return reject(`Value must contain exactly: ${sorted.join(", ")}.`);
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      return reject("Value fields must be enumerable data properties, not accessors.");
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

export function sha256BytesId(bytes: Uint8Array): `sha256:${string}` {
  if (!(bytes instanceof Uint8Array)) invalid("Payload must be Uint8Array.", "payload");
  return `sha256:${bytesToHex(sha256(bytes))}`;
}

export function validateSignerDescription(value: unknown): Readonly<SignerDescription> {
  const item = closedDataSnapshot(
    value,
    ["algorithm", "exportable", "provider", "signer_key_id"],
    (message) => invalid(`Signer description is closed: ${message}`),
  );
  assertSha256Id(item.signer_key_id, "signer.signer_key_id");
  assertBoundedString(item.algorithm, "signer.algorithm", 128);
  assertBoundedString(item.provider, "signer.provider", 256);
  if (item.exportable !== false) invalid("Signer keys must be declared non-exportable.", "signer.exportable");
  return Object.freeze({
    signer_key_id: item.signer_key_id,
    algorithm: item.algorithm,
    provider: item.provider,
    exportable: false,
  });
}

export function createSigningRequest(options: {
  request_id: string;
  authorization: AuthorizedIntent;
  signer_key_id: `sha256:${string}`;
  unsigned_payload: Uint8Array;
}): Readonly<SigningRequest> {
  const item = closedDataSnapshot(
    options,
    ["authorization", "request_id", "signer_key_id", "unsigned_payload"],
    (message) => invalid(`Signing request options are closed: ${message}`),
  );
  assertUuid(item.request_id, "request_id");
  assertSha256Id(item.signer_key_id, "signer_key_id");
  if (!item.authorization || typeof item.authorization !== "object" || Array.isArray(item.authorization)) {
    invalid("authorization must be an object returned by assertIntentWithinCapabilityStatic.", "authorization");
  }
  assertAuthorizedIntent(item.authorization);
  if (!(item.unsigned_payload instanceof Uint8Array)) invalid("unsigned_payload must be Uint8Array.");
  const unsignedPayload = Uint8Array.prototype.slice.call(item.unsigned_payload) as Uint8Array;
  if (unsignedPayload.byteLength === 0 || unsignedPayload.byteLength > LIMITS.max_payload_bytes) {
    invalid(`unsigned_payload must contain 1..${LIMITS.max_payload_bytes} bytes.`, "unsigned_payload");
  }
  const request = Object.freeze({
    request_id: item.request_id,
    authorization: item.authorization,
    signer_key_id: item.signer_key_id,
    unsigned_payload_b64u: base64UrlEncode(unsignedPayload),
    unsigned_payload_hash: sha256BytesId(unsignedPayload),
  });
  signingRequests.add(request);
  return request;
}

export function assertSignedPayloadMatchesRequest(
  request: SigningRequest,
  result: SignedPayload,
): Readonly<SignedPayload> {
  if (!signingRequests.has(request)) {
    throw new WalletProtocolError(
      "SIGNER_RESPONSE_MISMATCH",
      "Signing request must be returned by createSigningRequest in this process.",
    );
  }
  const item = closedDataSnapshot(result, [
    "operation_id",
    "request_id",
    "signed_payload_b64u",
    "signed_payload_hash",
    "signer_key_id",
    "unsigned_payload_hash",
  ], (message) => {
    throw new WalletProtocolError("SIGNER_RESPONSE_MISMATCH", `Signer response is closed: ${message}`);
  });
  if (
    item.request_id !== request.request_id
    || item.signer_key_id !== request.signer_key_id
    || item.unsigned_payload_hash !== request.unsigned_payload_hash
  ) {
    throw new WalletProtocolError(
      "SIGNER_RESPONSE_MISMATCH",
      "Signer response does not bind the exact request, key, and unsigned payload.",
    );
  }
  if (typeof item.signed_payload_b64u !== "string") {
    throw new WalletProtocolError("SIGNER_RESPONSE_MISMATCH", "Signer returned no signed payload bytes.");
  }
  const signedPayload = base64UrlDecode(item.signed_payload_b64u, "signed_payload_b64u");
  if (signedPayload.byteLength === 0 || signedPayload.byteLength > LIMITS.max_payload_bytes) {
    throw new WalletProtocolError(
      "SIGNER_RESPONSE_MISMATCH",
      `Signer returned a payload outside 1..${LIMITS.max_payload_bytes} bytes.`,
    );
  }
  assertSha256Id(item.signed_payload_hash, "signed_payload_hash");
  if (sha256BytesId(signedPayload) !== item.signed_payload_hash) {
    throw new WalletProtocolError("SIGNER_RESPONSE_MISMATCH", "signed_payload_hash does not match signer bytes.");
  }
  if (item.operation_id !== null) assertBoundedString(item.operation_id, "operation_id", 512);
  return Object.freeze({
    request_id: request.request_id,
    signer_key_id: request.signer_key_id,
    unsigned_payload_hash: request.unsigned_payload_hash,
    signed_payload_b64u: item.signed_payload_b64u,
    signed_payload_hash: item.signed_payload_hash,
    operation_id: item.operation_id,
  });
}
