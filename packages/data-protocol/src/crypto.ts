import { x25519 } from "@noble/curves/ed25519.js";
import * as ed25519 from "@noble/ed25519";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import {
  assertByteLength,
  base64UrlDecode,
  base64UrlEncode,
  concatBytes,
  copyBytes,
  decodeFixedBase64Url,
  equalBytes,
  randomBytes,
  utf8Encoder,
} from "./bytes.js";
import { canonicalJsonBytes } from "./canonical.js";
import { AccessDeniedError, IntegrityError, InvalidInputError } from "./errors.js";
import {
  ADDS_VERSION,
  BLOCK_AAD_DOMAIN,
  GRANT_SIGNATURE_DOMAIN,
  GRANT_KEK_INFO,
  GRANT_WRAP_DOMAIN,
  MANIFEST_SIGNATURE_DOMAIN,
  type AgentDataIdentity,
  type GrantWrap,
  type Signature,
  type SignedGrant,
  type SignedManifest,
  type Signer,
  type UnsignedGrant,
  type UnsignedManifest,
} from "./types.js";

ed25519.etc.sha512Sync = (...messages: Uint8Array[]) => {
  const hash = sha512.create();
  for (const message of messages) hash.update(message);
  return hash.digest();
};

const WRAP_ALGORITHM = "X25519-HKDF-SHA256-AES-256-GCM" as const;

function domainSeparatedBytes(domain: string, value: unknown): Uint8Array {
  return concatBytes(utf8Encoder.encode(`${domain}:`), canonicalJsonBytes(value));
}

function publicKeyForPrivate(privateKey: Uint8Array): Uint8Array {
  assertByteLength(privateKey, 32, "Ed25519 private key");
  return ed25519.getPublicKey(privateKey);
}

function unsignedManifest(manifest: SignedManifest): UnsignedManifest {
  const { signature: _signature, ...unsigned } = manifest;
  return unsigned;
}

function unsignedGrant(grant: SignedGrant): UnsignedGrant {
  const { signature: _signature, ...unsigned } = grant;
  return unsigned;
}

function createSignature(domain: string, value: unknown, privateKey: Uint8Array, publicKey: Uint8Array): Signature {
  assertByteLength(privateKey, 32, "Ed25519 private key");
  assertByteLength(publicKey, 32, "Ed25519 public key");
  const derivedPublicKey = publicKeyForPrivate(privateKey);
  if (!equalBytes(derivedPublicKey, publicKey)) {
    throw new InvalidInputError("Ed25519 private and public keys do not match.");
  }
  return {
    algorithm: "Ed25519",
    public_key: base64UrlEncode(publicKey),
    value: base64UrlEncode(ed25519.sign(domainSeparatedBytes(domain, value), privateKey)),
  };
}

/** @internal Strict ADDS verifier: canonical encodings and prime-subgroup A/R points. */
export function strictEd25519Verify(
  signatureBytes: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    assertByteLength(publicKey, 32, "Ed25519 public key");
    assertByteLength(signatureBytes, 64, "Ed25519 signature");
    const publicPoint = ed25519.Point.fromHex(publicKey, false);
    const rPoint = ed25519.Point.fromHex(signatureBytes.subarray(0, 32), false);
    if (
      publicPoint.isSmallOrder() ||
      !publicPoint.isTorsionFree() ||
      rPoint.isSmallOrder() ||
      !rPoint.isTorsionFree()
    ) return false;
    return ed25519.verify(
      signatureBytes,
      message,
      publicKey,
      { zip215: false },
    );
  } catch {
    return false;
  }
}

function verifySignature(domain: string, value: unknown, signature: Signature): boolean {
  if (signature.algorithm !== "Ed25519") return false;
  try {
    const publicKey = decodeFixedBase64Url(signature.public_key, 32, "signature.public_key");
    const signatureBytes = decodeFixedBase64Url(signature.value, 64, "signature.value");
    return strictEd25519Verify(signatureBytes, domainSeparatedBytes(domain, value), publicKey);
  } catch {
    return false;
  }
}

export function signerForIdentity(identity: AgentDataIdentity): Signer {
  return {
    id: identity.id,
    ed25519_public_key: base64UrlEncode(identity.signingPublicKey),
  };
}

export function x25519KeyId(publicKey: Uint8Array): string {
  assertByteLength(publicKey, 32, "X25519 public key");
  return `sha256:${base64UrlEncode(sha256(publicKey))}`;
}

function assertNonZeroSharedSecret(sharedSecret: Uint8Array): void {
  let combined = 0;
  for (const byte of sharedSecret) combined |= byte;
  if (combined === 0) {
    throw new InvalidInputError("X25519 rejected a low-order public key (all-zero shared secret)." );
  }
}

/** @internal Reject a low-order X25519 public key without retaining probe material. */
export function isUsableX25519PublicKey(publicKey: Uint8Array): boolean {
  const probePrivateKey = new Uint8Array(32);
  probePrivateKey[0] = 1;
  let sharedSecret: Uint8Array | undefined;
  try {
    assertByteLength(publicKey, 32, "X25519 public key");
    sharedSecret = x25519.getSharedSecret(probePrivateKey, publicKey);
    assertNonZeroSharedSecret(sharedSecret);
    return true;
  } catch {
    return false;
  } finally {
    probePrivateKey.fill(0);
    sharedSecret?.fill(0);
  }
}

/** @internal Derive a caller-owned X25519 public-key copy. */
export function x25519PublicKeyForPrivateKey(
  privateKey: Uint8Array,
): Uint8Array {
  assertByteLength(privateKey, 32, "X25519 private key");
  const derived = x25519.getPublicKey(privateKey);
  try {
    return Uint8Array.from(derived);
  } finally {
    derived.fill(0);
  }
}

/** Generate independent Ed25519 signing and X25519 box keypairs. */
export function generateIdentity(id: string): AgentDataIdentity {
  if (typeof id !== "string" || id.length === 0 || id.length > 2_048) {
    throw new InvalidInputError("Identity id must be a non-empty string of at most 2048 characters.");
  }
  const signingPrivateKey = randomBytes(32);
  let boxPrivateKey = x25519.utils.randomSecretKey();
  while (equalBytes(signingPrivateKey, boxPrivateKey)) boxPrivateKey = x25519.utils.randomSecretKey();
  return {
    id,
    signingPrivateKey,
    signingPublicKey: ed25519.getPublicKey(signingPrivateKey),
    boxPrivateKey,
    boxPublicKey: x25519.getPublicKey(boxPrivateKey),
  };
}

/** Validate and normalize caller-managed private keys into an ADDS identity. */
export function identityFromPrivateKeys(
  id: string,
  signingPrivateKey: Uint8Array,
  boxPrivateKey: Uint8Array,
): AgentDataIdentity {
  if (typeof id !== "string" || id.length === 0 || id.length > 2_048) {
    throw new InvalidInputError("Identity id must be a non-empty string of at most 2048 characters.");
  }
  assertByteLength(signingPrivateKey, 32, "Ed25519 private key");
  assertByteLength(boxPrivateKey, 32, "X25519 private key");
  if (equalBytes(signingPrivateKey, boxPrivateKey)) {
    throw new InvalidInputError("Ed25519 signing and X25519 box keys must use distinct private key material.");
  }
  return {
    id,
    signingPrivateKey: Uint8Array.from(signingPrivateKey),
    signingPublicKey: ed25519.getPublicKey(signingPrivateKey),
    boxPrivateKey: Uint8Array.from(boxPrivateKey),
    boxPublicKey: x25519.getPublicKey(boxPrivateKey),
  };
}

export function signManifest(unsigned: UnsignedManifest, identity: AgentDataIdentity): SignedManifest {
  const publisher = signerForIdentity(identity);
  if (
    unsigned.publisher.id !== publisher.id ||
    unsigned.publisher.ed25519_public_key !== publisher.ed25519_public_key
  ) {
    throw new InvalidInputError("Manifest publisher must match the signing identity.");
  }
  return {
    ...unsigned,
    signature: createSignature(
      MANIFEST_SIGNATURE_DOMAIN,
      unsigned,
      identity.signingPrivateKey,
      identity.signingPublicKey,
    ),
  };
}

export function verifyManifestSignature(manifest: SignedManifest): boolean {
  try {
    return (
      manifest.signature.public_key === manifest.publisher.ed25519_public_key &&
      verifySignature(MANIFEST_SIGNATURE_DOMAIN, unsignedManifest(manifest), manifest.signature)
    );
  } catch {
    return false;
  }
}

export function signGrant(unsigned: UnsignedGrant, identity: AgentDataIdentity): SignedGrant {
  const issuer = signerForIdentity(identity);
  if (
    unsigned.issuer.id !== issuer.id ||
    unsigned.issuer.ed25519_public_key !== issuer.ed25519_public_key
  ) {
    throw new InvalidInputError("Grant issuer must match the signing identity.");
  }
  return {
    ...unsigned,
    signature: createSignature(
      GRANT_SIGNATURE_DOMAIN,
      unsigned,
      identity.signingPrivateKey,
      identity.signingPublicKey,
    ),
  };
}

export function verifyGrantSignature(grant: SignedGrant): boolean {
  try {
    return (
      grant.signature.public_key === grant.issuer.ed25519_public_key &&
      verifySignature(GRANT_SIGNATURE_DOMAIN, unsignedGrant(grant), grant.signature)
    );
  } catch {
    return false;
  }
}

export interface BlockAadFields {
  objectId: string;
  keyId: string;
  aadContext: string;
  index: number;
  plaintextSize: number;
  blockCount: number;
  totalPlaintextSize: number;
  chunkSize: number;
}

export function blockAad(fields: BlockAadFields): Uint8Array {
  return domainSeparatedBytes(BLOCK_AAD_DOMAIN, {
    adds_version: ADDS_VERSION,
    kind: "block",
    algorithm: "AES-256-GCM",
    object_id: fields.objectId,
    key_id: fields.keyId,
    aad_context: fields.aadContext,
    index: fields.index,
    plaintext_size: fields.plaintextSize,
    block_count: fields.blockCount,
    total_plaintext_size: fields.totalPlaintextSize,
    chunk_size: fields.chunkSize,
  });
}

async function importAesKey(keyBytes: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  assertByteLength(keyBytes, 32, "AES-256 key");
  return globalThis.crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "AES-GCM" },
    false,
    usages,
  );
}

export async function encryptBlock(
  plaintext: Uint8Array,
  keyBytes: Uint8Array,
  aad: Uint8Array,
  suppliedNonce?: Uint8Array,
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  const plaintextSnapshot = copyBytes(plaintext);
  const keySnapshot = copyBytes(keyBytes);
  const aadSnapshot = copyBytes(aad);
  const nonce = suppliedNonce === undefined ? randomBytes(12) : copyBytes(suppliedNonce);
  assertByteLength(nonce, 12, "AES-GCM nonce");
  const key = await importAesKey(keySnapshot, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, additionalData: aadSnapshot as BufferSource, tagLength: 128 },
      key,
      plaintextSnapshot as BufferSource,
    ),
  );
  return { ciphertext, nonce };
}

export async function decryptBlock(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  keyBytes: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const ciphertextSnapshot = copyBytes(ciphertext);
  const nonceSnapshot = copyBytes(nonce);
  const keySnapshot = copyBytes(keyBytes);
  const aadSnapshot = copyBytes(aad);
  assertByteLength(nonceSnapshot, 12, "AES-GCM nonce");
  const key = await importAesKey(keySnapshot, ["decrypt"]);
  try {
    return new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonceSnapshot as BufferSource, additionalData: aadSnapshot as BufferSource, tagLength: 128 },
        key,
        ciphertextSnapshot as BufferSource,
      ),
    );
  } catch (cause) {
    throw new IntegrityError("AES-GCM authentication failed for encrypted block.", { cause });
  }
}

type GrantBeforeWrap = Omit<UnsignedGrant, "key_wrap">;

function grantWrapBinding(grant: UnsignedGrant): unknown {
  const { key_wrap: keyWrap, signature: _signature, ...rest } = grant as UnsignedGrant & { signature?: Signature };
  return {
    ...rest,
    key_wrap: {
      algorithm: keyWrap.algorithm,
      ephemeral_public_key: keyWrap.ephemeral_public_key,
    },
  };
}

async function wrappingKey(sharedSecret: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
  return hkdf(sha256, sharedSecret, sha256(aad), utf8Encoder.encode(GRANT_KEK_INFO), 32);
}

/** Wrap a 32-byte object DEK for exactly one X25519 recipient and signed grant context. */
export async function wrapObjectKey(
  objectKey: Uint8Array,
  grant: GrantBeforeWrap,
  audienceBoxPublicKey: Uint8Array,
): Promise<GrantWrap> {
  const objectKeySnapshot = copyBytes(objectKey);
  const audienceKeySnapshot = copyBytes(audienceBoxPublicKey);
  assertByteLength(objectKeySnapshot, 32, "Object key");
  assertByteLength(audienceKeySnapshot, 32, "Audience X25519 public key");
  const encodedAudienceKey = base64UrlEncode(audienceKeySnapshot);
  if (grant.audience_x25519_public_key !== encodedAudienceKey) {
    throw new InvalidInputError("Grant audience key does not match the key being wrapped.");
  }

  const ephemeralPrivateKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const provisional: UnsignedGrant = {
    ...grant,
    key_wrap: {
      algorithm: WRAP_ALGORITHM,
      ephemeral_public_key: base64UrlEncode(ephemeralPublicKey),
      nonce: "",
      ciphertext: "",
    },
  };
  const aad = domainSeparatedBytes(GRANT_WRAP_DOMAIN, grantWrapBinding(provisional));
  let sharedSecret: Uint8Array;
  try {
    sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, audienceKeySnapshot);
    assertNonZeroSharedSecret(sharedSecret);
  } catch (cause) {
    throw new InvalidInputError("Audience X25519 public key is invalid.", { cause });
  }
  const keyBytes = await wrappingKey(sharedSecret, aad);
  const nonce = randomBytes(12);
  const key = await importAesKey(keyBytes, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, additionalData: aad as BufferSource, tagLength: 128 },
      key,
      objectKeySnapshot as BufferSource,
    ),
  );
  return {
    algorithm: WRAP_ALGORITHM,
    ephemeral_public_key: base64UrlEncode(ephemeralPublicKey),
    nonce: base64UrlEncode(nonce),
    ciphertext: base64UrlEncode(ciphertext),
  };
}

/** Open a direct grant only when both the recipient ID and X25519 key match its audience. */
/** @internal Policy checks must run before this primitive; it is not exported from the package root. */
export async function unwrapObjectKeyUnsafe(
  grant: UnsignedGrant,
  recipientId: string,
  recipientBoxPrivateKey: Uint8Array,
): Promise<Uint8Array> {
  assertByteLength(recipientBoxPrivateKey, 32, "Recipient X25519 private key");
  if (grant.audience !== recipientId) {
    throw new AccessDeniedError("Grant audience does not match the recipient identity.");
  }
  const recipientPublicKey = x25519.getPublicKey(recipientBoxPrivateKey);
  const expectedPublicKey = decodeFixedBase64Url(
    grant.audience_x25519_public_key,
    32,
    "grant.audience_x25519_public_key",
  );
  if (!equalBytes(recipientPublicKey, expectedPublicKey)) {
    throw new AccessDeniedError("Grant is bound to a different recipient X25519 key.");
  }
  if (grant.key_wrap.algorithm !== WRAP_ALGORITHM) {
    throw new InvalidInputError("Grant uses an unsupported key-wrap algorithm.");
  }
  const ephemeralPublicKey = decodeFixedBase64Url(
    grant.key_wrap.ephemeral_public_key,
    32,
    "grant.key_wrap.ephemeral_public_key",
  );
  const nonce = decodeFixedBase64Url(grant.key_wrap.nonce, 12, "grant.key_wrap.nonce");
  const ciphertext = base64UrlDecode(grant.key_wrap.ciphertext, "grant.key_wrap.ciphertext");
  if (ciphertext.byteLength !== 48) {
    throw new InvalidInputError("Wrapped object key must be 48 bytes including its GCM tag.");
  }
  const aad = domainSeparatedBytes(GRANT_WRAP_DOMAIN, grantWrapBinding(grant));
  let sharedSecret: Uint8Array;
  try {
    sharedSecret = x25519.getSharedSecret(recipientBoxPrivateKey, ephemeralPublicKey);
    assertNonZeroSharedSecret(sharedSecret);
  } catch (cause) {
    throw new AccessDeniedError("Grant contains an invalid ephemeral X25519 key.", { cause });
  }
  const keyBytes = await wrappingKey(sharedSecret, aad);
  const key = await importAesKey(keyBytes, ["decrypt"]);
  try {
    const objectKey = new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce as BufferSource, additionalData: aad as BufferSource, tagLength: 128 },
        key,
        ciphertext as BufferSource,
      ),
    );
    assertByteLength(objectKey, 32, "Unwrapped object key");
    return objectKey;
  } catch (cause) {
    throw new AccessDeniedError("Grant key unwrap failed for this recipient or grant context.", { cause });
  }
}
