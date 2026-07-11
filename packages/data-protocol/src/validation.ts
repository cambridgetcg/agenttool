import { base64UrlEncode, decodeFixedBase64Url } from "./bytes.js";
import { digestFromCid } from "./cid.js";
import { verifyGrantSignature, verifyManifestSignature, x25519KeyId } from "./crypto.js";
import { AccessDeniedError, IntegrityError, InvalidInputError } from "./errors.js";
import {
  ADDS_VERSION,
  BLOCK_AAD_DOMAIN,
  type SignedGrant,
  type SignedManifest,
} from "./types.js";

export const MAX_CHUNK_SIZE = 16 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
export const MAX_BLOCK_COUNT = 1_048_576;
const MAX_EPOCH_SECONDS = 253_402_300_799;
const MAX_ID_LENGTH = 2_048;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidInputError(`${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidInputError(`${label} must be a plain object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  object: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const keys = Reflect.ownKeys(object);
  if (keys.some((key) => typeof key !== "string")) {
    throw new InvalidInputError(`${label} must not contain symbol keys.`);
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of keys as string[]) {
    if (!allowed.has(key)) throw new InvalidInputError(`${label} contains unsupported field ${key}.`);
  }
  for (const key of required) {
    if (!Object.hasOwn(object, key)) throw new InvalidInputError(`${label} is missing ${key}.`);
  }
}

function string(value: unknown, label: string, options: { max?: number; empty?: boolean } = {}): string {
  if (typeof value !== "string" || (!options.empty && value.length === 0)) {
    throw new InvalidInputError(`${label} must be ${options.empty ? "a" : "a non-empty"} string.`);
  }
  if (value.length > (options.max ?? MAX_ID_LENGTH)) {
    throw new InvalidInputError(`${label} is too long.`);
  }
  return value;
}

function safeInteger(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || Object.is(value, -0)) {
    throw new InvalidInputError(`${label} must be a safe integer >= ${minimum}.`);
  }
  return value as number;
}

function epoch(value: unknown, label: string): number {
  const seconds = safeInteger(value, label);
  if (seconds > MAX_EPOCH_SECONDS) throw new InvalidInputError(`${label} is outside the supported epoch range.`);
  return seconds;
}

function validateSigner(value: unknown, label: string): { id: string; ed25519_public_key: string } {
  const signer = record(value, label);
  exactKeys(signer, ["id", "ed25519_public_key"], [], label);
  const id = string(signer.id, `${label}.id`);
  const publicKey = string(signer.ed25519_public_key, `${label}.ed25519_public_key`);
  decodeFixedBase64Url(publicKey, 32, `${label}.ed25519_public_key`);
  return { id, ed25519_public_key: publicKey };
}

function validateSignature(value: unknown, expectedPublicKey: string, label: string): void {
  const signature = record(value, label);
  exactKeys(signature, ["algorithm", "public_key", "value"], [], label);
  if (signature.algorithm !== "Ed25519") throw new InvalidInputError(`${label}.algorithm must be Ed25519.`);
  const publicKey = string(signature.public_key, `${label}.public_key`);
  decodeFixedBase64Url(publicKey, 32, `${label}.public_key`);
  decodeFixedBase64Url(string(signature.value, `${label}.value`), 64, `${label}.value`);
  if (publicKey !== expectedPublicKey) {
    throw new IntegrityError(`${label}.public_key does not match the record signer.`);
  }
}

function validateMetadata(value: unknown): void {
  record(value, "manifest.metadata");
}

function validateExtensions(value: unknown, label: string): void {
  const extensions = record(value, label);
  for (const namespace of Object.keys(extensions)) {
    if (!/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(namespace)) {
      throw new InvalidInputError(`${label} keys must be absolute URI namespaces.`);
    }
  }
}

export function validateManifest(value: unknown): SignedManifest {
  const manifest = record(value, "manifest");
  exactKeys(
    manifest,
    [
      "adds_version",
      "kind",
      "object_id",
      "created_at",
      "plaintext",
      "encryption",
      "chunks",
      "publisher",
      "signature",
    ],
    ["schema", "media_type", "metadata", "provenance", "extensions"],
    "manifest",
  );
  if (manifest.adds_version !== ADDS_VERSION || manifest.kind !== "manifest") {
    throw new InvalidInputError("Record is not an ADDS 0.1 manifest.");
  }
  string(manifest.object_id, "manifest.object_id");
  epoch(manifest.created_at, "manifest.created_at");

  const plaintext = record(manifest.plaintext, "manifest.plaintext");
  exactKeys(plaintext, ["size"], [], "manifest.plaintext");
  const totalSize = safeInteger(plaintext.size, "manifest.plaintext.size");

  const encryption = record(manifest.encryption, "manifest.encryption");
  exactKeys(
    encryption,
    ["algorithm", "chunk_size", "block_aad", "key_id", "aad_context"],
    [],
    "manifest.encryption",
  );
  if (encryption.algorithm !== "AES-256-GCM" || encryption.block_aad !== BLOCK_AAD_DOMAIN) {
    throw new InvalidInputError("Manifest uses an unsupported encryption profile.");
  }
  const chunkSize = safeInteger(encryption.chunk_size, "manifest.encryption.chunk_size", 1);
  if (chunkSize > MAX_CHUNK_SIZE) {
    throw new InvalidInputError(`manifest.encryption.chunk_size exceeds ${MAX_CHUNK_SIZE}.`);
  }
  string(encryption.key_id, "manifest.encryption.key_id");
  decodeFixedBase64Url(
    string(encryption.aad_context, "manifest.encryption.aad_context"),
    32,
    "manifest.encryption.aad_context",
  );

  if (!Array.isArray(manifest.chunks)) throw new InvalidInputError("manifest.chunks must be an array.");
  const expectedCount = totalSize === 0 ? 1 : Math.ceil(totalSize / chunkSize);
  if (manifest.chunks.length !== expectedCount) {
    throw new IntegrityError("Manifest chunk count does not match plaintext size and chunk size.");
  }
  if (manifest.chunks.length > MAX_BLOCK_COUNT) {
    throw new InvalidInputError(`Manifest exceeds ${MAX_BLOCK_COUNT} chunks.`);
  }
  const cids = new Set<string>();
  const nonces = new Set<string>();
  for (let index = 0; index < manifest.chunks.length; index += 1) {
    if (!Object.hasOwn(manifest.chunks, index)) throw new InvalidInputError("manifest.chunks must be dense.");
    const chunk = record(manifest.chunks[index], `manifest.chunks[${index}]`);
    exactKeys(
      chunk,
      ["index", "cid", "nonce", "plaintext_size", "ciphertext_size"],
      [],
      `manifest.chunks[${index}]`,
    );
    if (chunk.index !== index) throw new IntegrityError("Manifest chunk indexes must be contiguous and ordered.");
    const cid = string(chunk.cid, `manifest.chunks[${index}].cid`, { max: 59 });
    digestFromCid(cid);
    if (cids.has(cid)) throw new IntegrityError("Manifest must not contain duplicate chunk CIDs.");
    cids.add(cid);
    const nonce = string(chunk.nonce, `manifest.chunks[${index}].nonce`);
    decodeFixedBase64Url(nonce, 12, `manifest.chunks[${index}].nonce`);
    if (nonces.has(nonce)) throw new IntegrityError("Manifest must not reuse an AES-GCM nonce.");
    nonces.add(nonce);
    const expectedPlaintextSize = Math.min(chunkSize, totalSize - index * chunkSize);
    if (chunk.plaintext_size !== expectedPlaintextSize) {
      throw new IntegrityError(`Manifest chunk ${index} has an inconsistent plaintext_size.`);
    }
    if (chunk.ciphertext_size !== expectedPlaintextSize + 16) {
      throw new IntegrityError(`Manifest chunk ${index} has an inconsistent ciphertext_size.`);
    }
  }

  const publisher = validateSigner(manifest.publisher, "manifest.publisher");
  validateSignature(manifest.signature, publisher.ed25519_public_key, "manifest.signature");
  if (manifest.schema !== undefined) string(manifest.schema, "manifest.schema", { max: 1_024 });
  if (manifest.media_type !== undefined) string(manifest.media_type, "manifest.media_type", { max: 1_024 });
  if (manifest.metadata !== undefined) validateMetadata(manifest.metadata);
  if (manifest.extensions !== undefined) validateExtensions(manifest.extensions, "manifest.extensions");
  if (manifest.provenance !== undefined) {
    const provenance = record(manifest.provenance, "manifest.provenance");
    exactKeys(provenance, [], ["parents", "transformation", "generated_by"], "manifest.provenance");
    if (provenance.parents !== undefined) {
      if (!Array.isArray(provenance.parents)) throw new InvalidInputError("manifest.provenance.parents must be an array.");
      const parents = new Set<string>();
      for (const parent of provenance.parents) {
        const cid = string(parent, "manifest.provenance.parents[]", { max: 59 });
        digestFromCid(cid);
        if (parents.has(cid)) throw new InvalidInputError("manifest.provenance.parents must be unique.");
        parents.add(cid);
      }
    }
    if (provenance.transformation !== undefined) string(provenance.transformation, "manifest.provenance.transformation");
    if (provenance.generated_by !== undefined) string(provenance.generated_by, "manifest.provenance.generated_by");
  }

  const typed = manifest as unknown as SignedManifest;
  if (!verifyManifestSignature(typed)) throw new IntegrityError("Manifest Ed25519 signature is invalid.");
  return typed;
}

export function validateGrant(value: unknown): SignedGrant {
  const grant = record(value, "grant");
  exactKeys(
    grant,
    [
      "adds_version",
      "kind",
      "grant_id",
      "manifest_cid",
      "issuer",
      "audience",
      "audience_x25519_public_key",
      "audience_x25519_key_id",
      "rights",
      "issued_at",
      "expires_at",
      "key_wrap",
      "signature",
    ],
    ["not_before", "extensions", "scope", "parent_grant"],
    "grant",
  );
  if (grant.adds_version !== ADDS_VERSION || grant.kind !== "grant") {
    throw new InvalidInputError("Record is not an ADDS 0.1 grant.");
  }
  string(grant.grant_id, "grant.grant_id");
  digestFromCid(string(grant.manifest_cid, "grant.manifest_cid", { max: 59 }));
  const issuer = validateSigner(grant.issuer, "grant.issuer");
  string(grant.audience, "grant.audience");
  const audiencePublicKey = string(grant.audience_x25519_public_key, "grant.audience_x25519_public_key");
  const audienceBytes = decodeFixedBase64Url(audiencePublicKey, 32, "grant.audience_x25519_public_key");
  const audienceKeyId = string(grant.audience_x25519_key_id, "grant.audience_x25519_key_id");
  if (audienceKeyId !== x25519KeyId(audienceBytes)) {
    throw new IntegrityError("grant.audience_x25519_key_id does not fingerprint its public key.");
  }
  if (!Array.isArray(grant.rights) || grant.rights.length !== 1 || grant.rights[0] !== "read") {
    throw new InvalidInputError("ADDS 0.1 direct grants must have exactly rights [\"read\"].");
  }
  const issuedAt = epoch(grant.issued_at, "grant.issued_at");
  const notBefore = grant.not_before === undefined ? issuedAt : epoch(grant.not_before, "grant.not_before");
  const expiresAt = epoch(grant.expires_at, "grant.expires_at");
  if (issuedAt > notBefore || notBefore >= expiresAt) {
    throw new InvalidInputError("Grant time order must satisfy issued_at <= not_before < expires_at.");
  }
  if (grant.parent_grant !== undefined) {
    digestFromCid(string(grant.parent_grant, "grant.parent_grant", { max: 59 }));
    throw new InvalidInputError("Delegated parent_grant is not supported by the direct-read profile.");
  }
  if (grant.scope !== undefined) {
    throw new InvalidInputError("Grant scope is not supported by the direct-read reference profile.");
  }
  if (grant.extensions !== undefined) validateExtensions(grant.extensions, "grant.extensions");

  const keyWrap = record(grant.key_wrap, "grant.key_wrap");
  exactKeys(
    keyWrap,
    ["algorithm", "ephemeral_public_key", "nonce", "ciphertext"],
    [],
    "grant.key_wrap",
  );
  if (keyWrap.algorithm !== "X25519-HKDF-SHA256-AES-256-GCM") {
    throw new InvalidInputError("Grant uses an unsupported key-wrap algorithm.");
  }
  decodeFixedBase64Url(
    string(keyWrap.ephemeral_public_key, "grant.key_wrap.ephemeral_public_key"),
    32,
    "grant.key_wrap.ephemeral_public_key",
  );
  decodeFixedBase64Url(string(keyWrap.nonce, "grant.key_wrap.nonce"), 12, "grant.key_wrap.nonce");
  decodeFixedBase64Url(string(keyWrap.ciphertext, "grant.key_wrap.ciphertext"), 48, "grant.key_wrap.ciphertext");
  validateSignature(grant.signature, issuer.ed25519_public_key, "grant.signature");

  const typed = grant as unknown as SignedGrant;
  if (!verifyGrantSignature(typed)) throw new IntegrityError("Grant Ed25519 signature is invalid.");
  return typed;
}

export function assertGrantTime(grant: SignedGrant, now: number): void {
  safeInteger(now, "authorization current time");
  const effectiveNotBefore = grant.not_before ?? grant.issued_at;
  if (now < effectiveNotBefore) throw new AccessDeniedError("Grant is not active yet.");
  if (now >= grant.expires_at) throw new AccessDeniedError("Grant has expired.");
}

export function assertDirectIssuer(manifest: SignedManifest, grant: SignedGrant): void {
  if (
    manifest.publisher.id !== grant.issuer.id ||
    manifest.publisher.ed25519_public_key !== grant.issuer.ed25519_public_key
  ) {
    throw new IntegrityError("Direct grant issuer is not the manifest publisher.");
  }
}
