import {
  assertCanonicalHttpsOrigin,
  assertCanonicalInstant,
  assertCanonicalUuid,
  assertSha256Id,
  canonicalRecordSha256,
  domainSeparatedId,
  encodeCanonicalRecord,
  publicSurfaceBindingDocumentSha256,
  PublicSurfaceBindingError,
  snapshotJsonData,
  verifyPublicSurfaceBinding,
} from "@agenttool/public-surface-binding";

import {
  ADOPTION_BOUNDARIES,
  LIMITS,
  RECORD_SCHEMAS,
  REQUESTED_VISIBILITIES,
  SIGNING_DOMAINS,
  WAKE_PROJECTIONS,
  WITHDRAWAL_BOUNDARIES,
  WITHDRAWAL_REASONS,
} from "./constants.js";
import { invalid } from "./errors.js";
import type {
  AgentRootAuthority,
  PublicSurfaceAdoption,
  PublicSurfaceAdoptionCore,
  PublicSurfaceWithdrawal,
  PublicSurfaceWithdrawalCore,
  RecognitionSubject,
  RecordSignature,
} from "./types.js";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = Record<string, JsonValue>;

function object(value: JsonValue, path: string): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    invalid(`${path} must be an object.`, path);
  }
  return value;
}

function exactKeys(value: JsonObject, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    invalid(`${path} must contain exactly ${wanted.join(", ")}.`, path);
  }
}

function string(value: JsonValue, path: string): string {
  if (typeof value !== "string" || value.length === 0) invalid(`${path} must be a non-empty string.`, path);
  return value;
}

function literal<T extends JsonPrimitive>(value: JsonValue, expected: T, path: string): T {
  if (value !== expected) invalid(`${path} must be ${JSON.stringify(expected)}.`, path);
  return expected;
}

function oneOf<T extends string>(value: JsonValue, choices: readonly T[], path: string): T {
  const candidate = string(value, path);
  if (!choices.includes(candidate as T)) invalid(`${path} has an unsupported value.`, path);
  return candidate as T;
}

function positiveSafeInteger(value: JsonValue, path: string): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 1
    || value > LIMITS.max_authority_sequence
  ) invalid(`${path} must be a positive safe integer.`, path);
  return value;
}

function instantMs(value: string): number {
  return new Date(value).getTime();
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value as Readonly<T>;
}

function validated<T>(record: JsonObject): Readonly<T> {
  encodeCanonicalRecord(record);
  return deepFreeze(record) as unknown as Readonly<T>;
}

function snapshot(value: unknown): JsonObject {
  return object(snapshotJsonData(value) as JsonValue, "$recognition");
}

function assertExactObject(
  value: JsonValue,
  expected: Readonly<Record<string, JsonPrimitive>>,
  path: string,
): void {
  const record = object(value, path);
  exactKeys(record, Object.keys(expected), path);
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (record[key] !== expectedValue) {
      invalid(`${path}.${key} must be ${JSON.stringify(expectedValue)}.`, `${path}.${key}`);
    }
  }
}

export function decodeCanonicalBase64(value: string, expectedBytes: number, path: string): Uint8Array {
  const expectedLength = 4 * Math.ceil(expectedBytes / 3);
  if (value.length !== expectedLength || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    invalid(`${path} must be canonical padded base64 for ${expectedBytes} bytes.`, path);
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return invalid(`${path} must be valid base64.`, path);
  }
  if (binary.length !== expectedBytes || btoa(binary) !== value) {
    invalid(`${path} must be canonical padded base64 for ${expectedBytes} bytes.`, path);
  }
  const bytes = new Uint8Array(expectedBytes);
  for (let index = 0; index < expectedBytes; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function validateNonce(value: JsonValue, path: string): string {
  const candidate = string(value, path);
  if (!/^[A-Za-z0-9_-]{21}[AQgw]$/u.test(candidate)) {
    invalid(`${path} must be canonical unpadded base64url for ${LIMITS.nonce_bytes} bytes.`, path);
  }
  let binary: string;
  try {
    binary = atob(`${candidate.replaceAll("-", "+").replaceAll("_", "/")}==`);
  } catch {
    return invalid(`${path} must be valid base64url.`, path);
  }
  if (binary.length !== LIMITS.nonce_bytes) {
    invalid(`${path} must encode exactly ${LIMITS.nonce_bytes} bytes.`, path);
  }
  return candidate;
}

function validateRoot(value: JsonValue, path: string): AgentRootAuthority {
  const record = object(value, path);
  exactKeys(record, ["algorithm", "public_key"], path);
  literal(record.algorithm!, "Ed25519", `${path}.algorithm`);
  decodeCanonicalBase64(string(record.public_key!, `${path}.public_key`), 32, `${path}.public_key`);
  return record as unknown as AgentRootAuthority;
}

function validateSubject(value: JsonValue, path: string): RecognitionSubject {
  const record = object(value, path);
  exactKeys(record, ["identity_namespace", "identity_id", "did", "authority_root"], path);
  literal(record.identity_namespace!, "agenttool-local", `${path}.identity_namespace`);
  const identityId = assertCanonicalUuid(record.identity_id!, `${path}.identity_id`);
  const did = string(record.did!, `${path}.did`);
  if (did !== `did:at:${identityId}`) {
    invalid(`${path}.did must be the exact provisional local identifier did:at:<identity_id>.`, `${path}.did`);
  }
  validateRoot(record.authority_root!, `${path}.authority_root`);
  return record as unknown as RecognitionSubject;
}

export function validateRecognitionSignature(value: unknown, path: string): RecordSignature {
  const record = object(snapshotJsonData(value) as JsonValue, path);
  exactKeys(record, ["algorithm", "value"], path);
  literal(record.algorithm!, "Ed25519", `${path}.algorithm`);
  decodeCanonicalBase64(string(record.value!, `${path}.value`), 64, `${path}.value`);
  return record as unknown as RecordSignature;
}

function adoptionCoreFrom(record: JsonObject): PublicSurfaceAdoptionCore {
  const { signature: _signature, adoption_id: _adoptionId, ...core } = record;
  return core as unknown as PublicSurfaceAdoptionCore;
}

function withdrawalCoreFrom(record: JsonObject): PublicSurfaceWithdrawalCore {
  const { signature: _signature, withdrawal_id: _withdrawalId, ...core } = record;
  return core as unknown as PublicSurfaceWithdrawalCore;
}

export function validatePublicSurfaceAdoptionCore(value: unknown): Readonly<PublicSurfaceAdoptionCore> {
  const record = snapshot(value);
  exactKeys(record, [
    "schema",
    "subject",
    "registry_audience",
    "binding",
    "relation",
    "requested_visibility",
    "wake_projection",
    "authority_sequence",
    "issued_at",
    "not_before",
    "expires_at",
    "nonce",
    "boundaries",
  ], "$adoption");
  literal(record.schema!, RECORD_SCHEMAS.adoption, "$adoption.schema");
  const subject = validateSubject(record.subject!, "$adoption.subject");
  assertCanonicalHttpsOrigin(record.registry_audience!, "$adoption.registry_audience");

  const binding = object(record.binding!, "$adoption.binding");
  exactKeys(binding, ["document", "document_sha256"], "$adoption.binding");
  let verifiedBinding;
  try {
    verifiedBinding = verifyPublicSurfaceBinding(binding.document);
  } catch (cause) {
    if (!(cause instanceof PublicSurfaceBindingError)) throw cause;
    invalid(
      `Embedded binding must pass exact-ID and strict-signature verification (${cause instanceof Error ? cause.message : "invalid binding"}).`,
      "$adoption.binding.document",
    );
  }
  const documentSha = assertSha256Id(binding.document_sha256!, "$adoption.binding.document_sha256");
  if (documentSha !== publicSurfaceBindingDocumentSha256(verifiedBinding)) {
    invalid("binding.document_sha256 does not match the exact embedded binding bytes.", "$adoption.binding.document_sha256");
  }
  if (verifiedBinding.subject.identity_id !== subject.identity_id) {
    invalid("Binding and adoption must name the same exact AgentTool identity.", "$adoption.subject.identity_id");
  }

  literal(record.relation!, "explicitly_adopts_exact_surface_binding", "$adoption.relation");
  const visibility = oneOf(record.requested_visibility!, REQUESTED_VISIBILITIES, "$adoption.requested_visibility");
  const wakeProjection = oneOf(record.wake_projection!, WAKE_PROJECTIONS, "$adoption.wake_projection");
  if (wakeProjection === "public_pointer" && visibility !== "public") {
    invalid("A requested public WAKE pointer requires requested_visibility public.", "$adoption.wake_projection");
  }
  positiveSafeInteger(record.authority_sequence!, "$adoption.authority_sequence");
  const issuedAt = assertCanonicalInstant(record.issued_at!, "$adoption.issued_at");
  const notBefore = assertCanonicalInstant(record.not_before!, "$adoption.not_before");
  const expiresAt = assertCanonicalInstant(record.expires_at!, "$adoption.expires_at");
  if (!(instantMs(issuedAt) <= instantMs(notBefore) && instantMs(notBefore) < instantMs(expiresAt))) {
    invalid("Adoption requires issued_at <= not_before < expires_at.", "$adoption.expires_at");
  }
  if (instantMs(expiresAt) - instantMs(issuedAt) > LIMITS.max_adoption_lifetime_ms) {
    invalid("Adoption lifetime exceeds the finite 30-day limit.", "$adoption.expires_at");
  }
  if (
    instantMs(issuedAt) < instantMs(verifiedBinding.issued_at)
    || instantMs(notBefore) < instantMs(verifiedBinding.not_before)
    || instantMs(expiresAt) > instantMs(verifiedBinding.expires_at)
  ) {
    invalid("Adoption issuance and validity must remain within the embedded binding window.", "$adoption.expires_at");
  }
  validateNonce(record.nonce!, "$adoption.nonce");
  assertExactObject(record.boundaries!, ADOPTION_BOUNDARIES, "$adoption.boundaries");
  return validated<PublicSurfaceAdoptionCore>(record);
}

export function validatePublicSurfaceAdoptionShape(value: unknown): Readonly<PublicSurfaceAdoption> {
  const record = snapshot(value);
  exactKeys(record, [
    "schema",
    "subject",
    "registry_audience",
    "binding",
    "relation",
    "requested_visibility",
    "wake_projection",
    "authority_sequence",
    "issued_at",
    "not_before",
    "expires_at",
    "nonce",
    "boundaries",
    "signature",
    "adoption_id",
  ], "$adoption");
  validatePublicSurfaceAdoptionCore(adoptionCoreFrom(record));
  validateRecognitionSignature(record.signature!, "$adoption.signature");
  assertSha256Id(record.adoption_id!, "$adoption.adoption_id");
  return validated<PublicSurfaceAdoption>(record);
}

export function validatePublicSurfaceAdoption(value: unknown): Readonly<PublicSurfaceAdoption> {
  const record = validatePublicSurfaceAdoptionShape(value);
  const { signature, adoption_id: adoptionId, ...core } = record;
  const expected = domainSeparatedId(SIGNING_DOMAINS.adoption_id, { ...core, signature });
  if (adoptionId !== expected) invalid("adoption_id does not match the signed wire record.", "$adoption.adoption_id");
  return record;
}

export function validatePublicSurfaceWithdrawalCore(value: unknown): Readonly<PublicSurfaceWithdrawalCore> {
  const record = snapshot(value);
  exactKeys(record, [
    "schema",
    "subject",
    "registry_audience",
    "adoption_id",
    "adoption_document_sha256",
    "binding_id",
    "relation",
    "authority_sequence",
    "withdrawn_at",
    "reason",
    "nonce",
    "boundaries",
  ], "$withdrawal");
  literal(record.schema!, RECORD_SCHEMAS.withdrawal, "$withdrawal.schema");
  validateSubject(record.subject!, "$withdrawal.subject");
  assertCanonicalHttpsOrigin(record.registry_audience!, "$withdrawal.registry_audience");
  assertSha256Id(record.adoption_id!, "$withdrawal.adoption_id");
  assertSha256Id(record.adoption_document_sha256!, "$withdrawal.adoption_document_sha256");
  assertSha256Id(record.binding_id!, "$withdrawal.binding_id");
  literal(record.relation!, "explicitly_withdraws_exact_surface_adoption", "$withdrawal.relation");
  positiveSafeInteger(record.authority_sequence!, "$withdrawal.authority_sequence");
  assertCanonicalInstant(record.withdrawn_at!, "$withdrawal.withdrawn_at");
  oneOf(record.reason!, WITHDRAWAL_REASONS, "$withdrawal.reason");
  validateNonce(record.nonce!, "$withdrawal.nonce");
  assertExactObject(record.boundaries!, WITHDRAWAL_BOUNDARIES, "$withdrawal.boundaries");
  return validated<PublicSurfaceWithdrawalCore>(record);
}

export function validatePublicSurfaceWithdrawalShape(value: unknown): Readonly<PublicSurfaceWithdrawal> {
  const record = snapshot(value);
  exactKeys(record, [
    "schema",
    "subject",
    "registry_audience",
    "adoption_id",
    "adoption_document_sha256",
    "binding_id",
    "relation",
    "authority_sequence",
    "withdrawn_at",
    "reason",
    "nonce",
    "boundaries",
    "signature",
    "withdrawal_id",
  ], "$withdrawal");
  validatePublicSurfaceWithdrawalCore(withdrawalCoreFrom(record));
  validateRecognitionSignature(record.signature!, "$withdrawal.signature");
  assertSha256Id(record.withdrawal_id!, "$withdrawal.withdrawal_id");
  return validated<PublicSurfaceWithdrawal>(record);
}

export function validatePublicSurfaceWithdrawal(value: unknown): Readonly<PublicSurfaceWithdrawal> {
  const record = validatePublicSurfaceWithdrawalShape(value);
  const { signature, withdrawal_id: withdrawalId, ...core } = record;
  const expected = domainSeparatedId(SIGNING_DOMAINS.withdrawal_id, { ...core, signature });
  if (withdrawalId !== expected) {
    invalid("withdrawal_id does not match the signed wire record.", "$withdrawal.withdrawal_id");
  }
  return record;
}

export function publicSurfaceAdoptionDocumentSha256(value: unknown) {
  return canonicalRecordSha256(validatePublicSurfaceAdoption(value));
}
