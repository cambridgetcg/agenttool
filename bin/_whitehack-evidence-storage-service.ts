/**
 * Explicit ADDS storage/retrieval composition for Whitehack evidence capsules.
 *
 * The pure protocol validator lives in _whitehack-evidence-storage.ts. This
 * module is the narrow authority boundary that encrypts, writes, independently
 * verifies, decrypts, and issues one finite recipient-bound read grant.
 *
 * Doctrine: docs/WHITEHACK.md
 */
import {
  AgentData,
  generateIdentity,
  validateGrant,
  verifyGrantSignature,
  type AgentDataIdentity,
  type BlockStore,
  type SignedManifest,
} from "../packages/data-protocol/src/index.js";
import {
  decodeFixedBase64Url,
} from "../packages/data-protocol/src/bytes.js";
import { canonicalJson } from "../packages/data-protocol/src/canonical.js";
import {
  x25519,
} from "../packages/data-protocol/node_modules/@noble/curves/ed25519.js";
import {
  DEFAULT_WHITEHACK_EVIDENCE_STORE_TIMEOUT_MS,
  MAX_WHITEHACK_EVIDENCE_CAPSULE_BYTES,
  MAX_WHITEHACK_EVIDENCE_GRANT_TTL_SECONDS,
  MAX_WHITEHACK_EVIDENCE_MANIFEST_BYTES,
  WHITEHACK_EVIDENCE_CAPSULE_DISCLOSURE,
  WHITEHACK_EVIDENCE_CAPSULE_DOCUMENT,
  WHITEHACK_EVIDENCE_ENCRYPTED_FRAME_BYTES,
  WHITEHACK_EVIDENCE_FRAME_BYTES,
  WHITEHACK_EVIDENCE_FRAME_SCHEMA,
  WhitehackEvidenceStorageError,
  canonicalCapsuleBytes,
  createWhitehackEvidenceStorageReceipt,
  equalBytes,
  frameWhitehackEvidenceCapsule,
  normalizeWhitehackEvidenceStorageInput,
  normalizeWhitehackEvidenceStorageReceipt,
  resolveWhitehackEvidenceGrantWindow,
  unframeWhitehackEvidenceCapsule,
  type WhitehackEvidenceStorageReceipt,
} from "./_whitehack-evidence-storage.js";

const FRAME_METADATA = Object.freeze({
  bridge: "agenttool-whitehack-evidence-storage/v1",
  capsule_document_type: WHITEHACK_EVIDENCE_CAPSULE_DOCUMENT,
  capsule_disclosure: WHITEHACK_EVIDENCE_CAPSULE_DISCLOSURE,
  frame_bytes: WHITEHACK_EVIDENCE_FRAME_BYTES,
  padding: "zero",
} as const);

export type WhitehackEvidenceStorageServiceOptions = Readonly<{
  now?: () => Date | string | number;
  storeTimeoutMs?: number;
}>;

function fail(code: string): never {
  throw new WhitehackEvidenceStorageError(code);
}

/**
 * Reject low-order X25519 public keys before any provider I/O. The fixed probe
 * scalar is validation material, not a persisted bridge or recipient key.
 */
function isUsableX25519PublicKey(publicKey: Uint8Array): boolean {
  const probePrivateKey = new Uint8Array(32);
  probePrivateKey[0] = 1;
  let sharedSecret: Uint8Array | undefined;
  try {
    sharedSecret = x25519.getSharedSecret(probePrivateKey, publicKey);
    let combined = 0;
    for (const byte of sharedSecret) combined |= byte;
    return combined !== 0;
  } catch {
    return false;
  } finally {
    probePrivateKey.fill(0);
    sharedSecret?.fill(0);
  }
}

function publicKeyForX25519PrivateKey(
  privateKey: Uint8Array,
): Uint8Array | null {
  let publicKey: Uint8Array | undefined;
  try {
    publicKey = x25519.getPublicKey(privateKey);
    return Uint8Array.from(publicKey);
  } catch {
    return null;
  } finally {
    publicKey?.fill(0);
  }
}

function serviceClock(
  source: (() => Date | string | number) | undefined,
): () => Date {
  return () => {
    let value: Date | string | number;
    try {
      value = source?.() ?? new Date();
    } catch {
      fail("clock_invalid");
    }
    const date = value instanceof Date
      ? new Date(value.getTime())
      : new Date(value);
    if (!Number.isFinite(date.getTime()) || date.getTime() < 0) {
      fail("clock_invalid");
    }
    return date;
  };
}

function storeTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_WHITEHACK_EVIDENCE_STORE_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeout)
    || timeout < 1
    || timeout > 300_000
  ) fail("store_timeout_invalid");
  return timeout;
}

function createClient(
  store: BlockStore,
  clock: () => Date,
  timeoutMs: number,
  identity?: AgentDataIdentity,
): AgentData {
  return new AgentData({
    ...(identity === undefined ? {} : { identity }),
    stores: [store],
    minimumWrites: 1,
    storeTimeoutMs: timeoutMs,
    maxBytes: WHITEHACK_EVIDENCE_FRAME_BYTES,
    maxManifestBytes: MAX_WHITEHACK_EVIDENCE_MANIFEST_BYTES,
    maxBlocks: 1,
    maxGrantLifetimeSeconds: MAX_WHITEHACK_EVIDENCE_GRANT_TTL_SECONDS,
    now: clock,
  });
}

async function sanitized<T>(
  code: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch {
    fail(code);
  }
}

function validateBridgeManifest(manifest: SignedManifest): void {
  let metadataMatches = false;
  try {
    metadataMatches =
      canonicalJson(manifest.metadata) === canonicalJson(FRAME_METADATA);
  } catch {
    fail("evidence_manifest_profile_invalid");
  }
  if (
    manifest.schema !== WHITEHACK_EVIDENCE_FRAME_SCHEMA
    || manifest.media_type !== "application/octet-stream"
    || manifest.plaintext.size !== WHITEHACK_EVIDENCE_FRAME_BYTES
    || manifest.encryption.chunk_size !== WHITEHACK_EVIDENCE_FRAME_BYTES
    || manifest.chunks.length !== 1
    || manifest.chunks[0]?.index !== 0
    || manifest.chunks[0]?.plaintext_size !== WHITEHACK_EVIDENCE_FRAME_BYTES
    || manifest.chunks[0]?.ciphertext_size
      !== WHITEHACK_EVIDENCE_FRAME_BYTES + 16
    || !metadataMatches
  ) fail("evidence_manifest_profile_invalid");
}

function clearIdentity(identity: AgentDataIdentity): void {
  identity.signingPrivateKey.fill(0);
  identity.signingPublicKey.fill(0);
  identity.boxPrivateKey.fill(0);
  identity.boxPublicKey.fill(0);
}

/**
 * Store one strict public-minimal capsule and return a sensitive local receipt.
 * The receipt deliberately contains no plaintext hash or plaintext length.
 */
export async function storeWhitehackEvidence(
  inputValue: unknown,
  store: BlockStore,
  options: WhitehackEvidenceStorageServiceOptions = {},
): Promise<WhitehackEvidenceStorageReceipt> {
  const input = normalizeWhitehackEvidenceStorageInput(inputValue);
  const clock = serviceClock(options.now);
  const timeoutMs = storeTimeout(options.storeTimeoutMs);
  let recipientPublicKey: Uint8Array | undefined;
  let canonical: Uint8Array | undefined;
  let framed: Uint8Array | undefined;
  let readBack: Uint8Array | undefined;
  let reparsedBytes: Uint8Array | undefined;
  try {
    try {
      recipientPublicKey = decodeFixedBase64Url(
        input.recipient.x25519_public_key,
        32,
        "recipient.x25519_public_key",
      );
    } catch {
      fail("recipient_invalid");
    }
    if (!isUsableX25519PublicKey(recipientPublicKey)) {
      fail("recipient_invalid");
    }
    const createdAt = clock();
    resolveWhitehackEvidenceGrantWindow(input, createdAt);
    canonical = canonicalCapsuleBytes(input.capsule);
    framed = frameWhitehackEvidenceCapsule(input.capsule);
    const recipientKey = recipientPublicKey;
    const canonicalBytes = canonical;
    const framedBytes = framed;
    const identity = generateIdentity(
      `urn:uuid:${globalThis.crypto.randomUUID()}`,
    );
    let publisher: AgentData;
    try {
      publisher = createClient(store, clock, timeoutMs, identity);
    } finally {
      clearIdentity(identity);
    }
    const verifier = createClient(store, clock, timeoutMs);

    const published = await sanitized(
      "evidence_storage_failed",
      () => publisher.put(framedBytes, {
        chunkSize: WHITEHACK_EVIDENCE_FRAME_BYTES,
        maxBytes: WHITEHACK_EVIDENCE_FRAME_BYTES,
        createdAt,
        schema: WHITEHACK_EVIDENCE_FRAME_SCHEMA,
        mediaType: "application/octet-stream",
        metadata: FRAME_METADATA,
      }),
    );
    validateBridgeManifest(published.manifest);

    const verified = await sanitized(
      "evidence_verification_failed",
      () => verifier.verify(published.ref, {
        maxBytes: WHITEHACK_EVIDENCE_FRAME_BYTES,
      }),
    );
    validateBridgeManifest(verified.manifest);
    if (
      verified.ciphertextBlocksVerified !== 1
      || verified.encryptedBytes
        !== WHITEHACK_EVIDENCE_ENCRYPTED_FRAME_BYTES
    ) fail("evidence_verification_failed");

    readBack = await sanitized(
      "evidence_read_back_failed",
      () => publisher.get(published.ref, {
        maxBytes: WHITEHACK_EVIDENCE_FRAME_BYTES,
      }),
    );
    if (!equalBytes(readBack, framedBytes)) fail("evidence_read_back_failed");
    const reparsed = unframeWhitehackEvidenceCapsule(readBack);
    reparsedBytes = reparsed.canonical_bytes;
    if (
      reparsedBytes.byteLength > MAX_WHITEHACK_EVIDENCE_CAPSULE_BYTES
      || !equalBytes(reparsedBytes, canonicalBytes)
    ) fail("evidence_read_back_failed");
    const verifiedAt = clock().toISOString();

    const grantWindow = resolveWhitehackEvidenceGrantWindow(input, clock());
    const grant = await sanitized(
      "evidence_grant_failed",
      () => publisher.share(published.ref, {
        audience: input.recipient.id,
        audienceBoxPublicKey: recipientKey,
        issuedAt: grantWindow.issued_at,
        expiresAt: grantWindow.expires_at,
      }),
    );
    let normalizedGrant;
    try {
      normalizedGrant = validateGrant(grant);
    } catch {
      fail("evidence_grant_failed");
    }
    if (
      !verifyGrantSignature(normalizedGrant)
      || normalizedGrant.manifest_cid !== published.ref.cid
      || normalizedGrant.audience !== input.recipient.id
      || normalizedGrant.audience_x25519_public_key
        !== input.recipient.x25519_public_key
    ) fail("evidence_grant_failed");

    return createWhitehackEvidenceStorageReceipt({
      manifest_cid: published.ref.cid,
      signed_grant: normalizedGrant,
      counts: {
        ciphertext_blocks: published.manifest.chunks.length,
        ciphertext_blocks_verified: verified.ciphertextBlocksVerified,
        encrypted_bytes_verified: verified.encryptedBytes,
        remote_objects_acknowledged: published.replication.storedObjects,
        minimum_write_acknowledgements:
          published.replication.minimumAcknowledgements,
        maximum_write_acknowledgements:
          published.replication.maximumAcknowledgements,
        failed_writes: published.replication.failedWrites,
      },
      verified_at: verifiedAt,
    });
  } finally {
    recipientPublicKey?.fill(0);
    canonical?.fill(0);
    framed?.fill(0);
    readBack?.fill(0);
    reparsedBytes?.fill(0);
  }
}

/**
 * Retrieve one receipt-authorized object, re-check all encrypted blocks,
 * decrypt the fixed frame, and return exact canonical capsule bytes.
 */
export async function retrieveWhitehackEvidence(
  receiptValue: unknown,
  store: BlockStore,
  recipientId: string,
  recipientPrivateKey: Uint8Array,
  options: WhitehackEvidenceStorageServiceOptions = {},
): Promise<Uint8Array> {
  const receipt = normalizeWhitehackEvidenceStorageReceipt(receiptValue);
  if (
    typeof recipientId !== "string"
    || recipientId.length < 1
    || recipientId.length > 512
    || recipientId !== recipientId.trim()
  ) fail("recipient_invalid");
  if (
    !(recipientPrivateKey instanceof Uint8Array)
    || recipientPrivateKey.byteLength !== 32
  ) fail("recipient_private_key_invalid");
  const privateKey = Uint8Array.from(recipientPrivateKey);
  let framed: Uint8Array | undefined;
  let canonical: Uint8Array | undefined;
  try {
    const clock = serviceClock(options.now);
    const timeoutMs = storeTimeout(options.storeTimeoutMs);
    const client = createClient(store, clock, timeoutMs);
    let grant;
    try {
      grant = validateGrant(receipt.signed_grant);
    } catch {
      fail("receipt_grant_invalid");
    }
    if (
      !verifyGrantSignature(grant)
      || grant.manifest_cid !== receipt.manifest_cid
      || grant.audience !== recipientId
    ) fail("receipt_grant_invalid");
    let audiencePublicKey: Uint8Array | undefined;
    let derivedPublicKey: Uint8Array | null | undefined;
    try {
      try {
        audiencePublicKey = decodeFixedBase64Url(
          grant.audience_x25519_public_key,
          32,
          "grant.audience_x25519_public_key",
        );
      } catch {
        fail("receipt_grant_invalid");
      }
      derivedPublicKey = publicKeyForX25519PrivateKey(privateKey);
      if (
        derivedPublicKey === null
        || !equalBytes(derivedPublicKey, audiencePublicKey)
      ) fail("evidence_retrieval_failed");
    } finally {
      audiencePublicKey?.fill(0);
      derivedPublicKey?.fill(0);
    }
    const authorizationTime = clock();
    const authorizationEpoch = Math.floor(
      authorizationTime.getTime() / 1_000,
    );
    const notBefore = grant.not_before ?? grant.issued_at;
    if (
      authorizationEpoch < notBefore
      || authorizationEpoch >= grant.expires_at
    ) fail("evidence_retrieval_failed");

    const verified = await sanitized(
      "evidence_retrieval_verification_failed",
      () => client.verify(
        { cid: receipt.manifest_cid },
        { maxBytes: WHITEHACK_EVIDENCE_FRAME_BYTES },
      ),
    );
    validateBridgeManifest(verified.manifest);
    if (
      verified.ciphertextBlocksVerified
        !== receipt.counts.ciphertext_blocks_verified
      || verified.encryptedBytes !== receipt.counts.encrypted_bytes_verified
    ) fail("evidence_retrieval_verification_failed");

    framed = await sanitized(
      "evidence_retrieval_failed",
      () => client.get(
        { cid: receipt.manifest_cid },
        {
          grant,
          recipientId,
          recipientBoxPrivateKey: privateKey,
          maxBytes: WHITEHACK_EVIDENCE_FRAME_BYTES,
          now: authorizationTime,
        },
      ),
    );
    let unframed;
    try {
      unframed = unframeWhitehackEvidenceCapsule(framed);
    } catch {
      fail("evidence_retrieval_failed");
    }
    canonical = unframed.canonical_bytes;
    return Uint8Array.from(canonical);
  } finally {
    privateKey.fill(0);
    framed?.fill(0);
    canonical?.fill(0);
  }
}

export function decodeWhitehackRecipientPrivateKey(value: string): Uint8Array {
  try {
    return decodeFixedBase64Url(
      value,
      32,
      "recipient X25519 private key",
    );
  } catch {
    fail("recipient_private_key_invalid");
  }
}
