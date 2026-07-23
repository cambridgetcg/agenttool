import {
  canonicalJsonBytes,
  digestFromCid,
  type Cid,
  type KeyStore,
} from "@agenttool/adds";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

import {
  ARCHIVE_PROTOCOL,
  RECOVERY_ENVELOPE_AAD,
  RECOVERY_ENVELOPE_ALGORITHM,
  type RecoveryKeyEnvelope,
} from "./types.js";
import {
  base64UrlDecode,
  base64UrlEncode,
  equalBytes,
  randomBytes,
  utf8,
} from "./encoding.js";
import {
  ArchiveVerificationError,
  InvalidArchiveRecordError,
} from "./errors.js";

function assertKey(bytes: Uint8Array, label: string): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) {
    throw new InvalidArchiveRecordError(`${label} must be 32 bytes.`);
  }
}

function assertIdentifier(value: string, label: string): void {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 256
    || /[\p{Cc}\uFEFF\s]/u.test(value)
  ) {
    throw new InvalidArchiveRecordError(`${label} must be a bounded opaque identifier.`);
  }
}

function envelopeAad(envelope: Omit<RecoveryKeyEnvelope, "nonce" | "ciphertext">): Uint8Array {
  return canonicalJsonBytes(envelope);
}

async function importAesKey(key: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "AES-GCM" },
    false,
    usages,
  );
}

export function validateRecoveryKeyEnvelope(value: unknown): RecoveryKeyEnvelope {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidArchiveRecordError("Recovery key envelope must be an object.");
  }
  const input = value as Record<string, unknown>;
  const keys = [
    "protocol",
    "kind",
    "algorithm",
    "aad",
    "vault_id",
    "recovery_key_id",
    "manifest_cid",
    "nonce",
    "ciphertext",
  ];
  if (
    Reflect.ownKeys(input).some((key) => typeof key !== "string" || !keys.includes(key))
    || keys.some((key) => !Object.hasOwn(input, key))
  ) {
    throw new InvalidArchiveRecordError("Recovery key envelope has unsupported or missing fields.");
  }
  if (input.protocol !== ARCHIVE_PROTOCOL) {
    throw new InvalidArchiveRecordError(`Recovery key envelope protocol must be ${ARCHIVE_PROTOCOL}.`);
  }
  if (input.kind !== "recovery_key_envelope") {
    throw new InvalidArchiveRecordError("Recovery key envelope kind is invalid.");
  }
  if (input.algorithm !== RECOVERY_ENVELOPE_ALGORITHM || input.aad !== RECOVERY_ENVELOPE_AAD) {
    throw new InvalidArchiveRecordError("Recovery key envelope crypto profile is invalid.");
  }
  assertIdentifier(input.vault_id as string, "Recovery key envelope vault_id");
  assertIdentifier(input.recovery_key_id as string, "Recovery key envelope recovery_key_id");
  if (typeof input.manifest_cid !== "string") {
    throw new InvalidArchiveRecordError("Recovery key envelope manifest_cid must be a CID.");
  }
  digestFromCid(input.manifest_cid);
  base64UrlDecode(input.nonce as string, "Recovery key envelope nonce", 12);
  base64UrlDecode(input.ciphertext as string, "Recovery key envelope ciphertext", 48);
  return structuredClone(input) as unknown as RecoveryKeyEnvelope;
}

export interface RecoveryEnvelopeKeyStoreOptions {
  vaultId: string;
  recoveryKeyId: string;
  recoveryKey: Uint8Array;
  envelopes?: readonly RecoveryKeyEnvelope[];
}

/**
 * ADDS KeyStore that retains only AES-GCM-wrapped object keys.
 *
 * The caller still owns custody of the vault recovery key. `close()` erases
 * this store's copy; it cannot erase copies retained by the caller or runtime.
 */
export class RecoveryEnvelopeKeyStore implements KeyStore {
  readonly #vaultId: string;
  readonly #recoveryKeyId: string;
  readonly #recoveryKey: Uint8Array;
  readonly #wrappingKey: Uint8Array;
  readonly #envelopes = new Map<Cid, RecoveryKeyEnvelope>();
  #closed = false;

  constructor(options: RecoveryEnvelopeKeyStoreOptions) {
    assertIdentifier(options.vaultId, "vaultId");
    assertIdentifier(options.recoveryKeyId, "recoveryKeyId");
    assertKey(options.recoveryKey, "recoveryKey");
    this.#vaultId = options.vaultId;
    this.#recoveryKeyId = options.recoveryKeyId;
    this.#recoveryKey = Uint8Array.from(options.recoveryKey);
    this.#wrappingKey = hkdf(
      sha256,
      this.#recoveryKey,
      sha256(utf8(this.#vaultId)),
      utf8(`${RECOVERY_ENVELOPE_AAD}\0${this.#recoveryKeyId}`),
      32,
    );
    for (const envelope of options.envelopes ?? []) this.importEnvelope(envelope);
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new ArchiveVerificationError("Recovery envelope key store is closed.");
    }
  }

  importEnvelope(value: RecoveryKeyEnvelope): void {
    this.#assertOpen();
    const envelope = validateRecoveryKeyEnvelope(value);
    if (envelope.vault_id !== this.#vaultId || envelope.recovery_key_id !== this.#recoveryKeyId) {
      throw new InvalidArchiveRecordError("Recovery key envelope belongs to a different vault or recovery key.");
    }
    const existing = this.#envelopes.get(envelope.manifest_cid);
    if (
      existing !== undefined
      && !equalBytes(canonicalJsonBytes(existing), canonicalJsonBytes(envelope))
    ) {
      throw new InvalidArchiveRecordError("Conflicting recovery key envelope for one manifest CID.");
    }
    this.#envelopes.set(envelope.manifest_cid, envelope);
  }

  exportEnvelope(cid: Cid): RecoveryKeyEnvelope {
    this.#assertOpen();
    digestFromCid(cid);
    const envelope = this.#envelopes.get(cid);
    if (envelope === undefined) {
      throw new ArchiveVerificationError(`No recovery key envelope exists for ${cid}.`);
    }
    return structuredClone(envelope);
  }

  async set(cid: Cid, key: Uint8Array): Promise<void> {
    this.#assertOpen();
    digestFromCid(cid);
    assertKey(key, "ADDS object key");
    const existing = this.#envelopes.get(cid);
    if (existing !== undefined) {
      const unwrapped = await this.#unwrap(existing);
      try {
        if (!equalBytes(unwrapped, key)) {
          throw new ArchiveVerificationError("Existing recovery envelope contains a different object key.");
        }
        return;
      } finally {
        unwrapped.fill(0);
      }
    }

    const header: Omit<RecoveryKeyEnvelope, "nonce" | "ciphertext"> = {
      protocol: ARCHIVE_PROTOCOL,
      kind: "recovery_key_envelope",
      algorithm: RECOVERY_ENVELOPE_ALGORITHM,
      aad: RECOVERY_ENVELOPE_AAD,
      vault_id: this.#vaultId,
      recovery_key_id: this.#recoveryKeyId,
      manifest_cid: cid,
    };
    const nonce = randomBytes(12);
    const cryptoKey = await importAesKey(this.#wrappingKey, ["encrypt"]);
    const ciphertext = new Uint8Array(await globalThis.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce as BufferSource,
        additionalData: envelopeAad(header) as BufferSource,
        tagLength: 128,
      },
      cryptoKey,
      Uint8Array.from(key) as BufferSource,
    ));
    this.#envelopes.set(cid, {
      ...header,
      nonce: base64UrlEncode(nonce),
      ciphertext: base64UrlEncode(ciphertext),
    });
  }

  async #unwrap(envelope: RecoveryKeyEnvelope): Promise<Uint8Array> {
    const validated = validateRecoveryKeyEnvelope(envelope);
    if (validated.vault_id !== this.#vaultId || validated.recovery_key_id !== this.#recoveryKeyId) {
      throw new ArchiveVerificationError("Recovery key envelope is outside this key store's scope.");
    }
    const { nonce, ciphertext, ...header } = validated;
    const cryptoKey = await importAesKey(this.#wrappingKey, ["decrypt"]);
    try {
      const plaintext = new Uint8Array(await globalThis.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: base64UrlDecode(nonce, "Recovery key envelope nonce", 12) as BufferSource,
          additionalData: envelopeAad(header) as BufferSource,
          tagLength: 128,
        },
        cryptoKey,
        base64UrlDecode(ciphertext, "Recovery key envelope ciphertext", 48) as BufferSource,
      ));
      assertKey(plaintext, "Recovered ADDS object key");
      return plaintext;
    } catch (cause) {
      throw new ArchiveVerificationError(
        "Recovery key envelope authentication failed.",
        { cause },
      );
    }
  }

  async get(cid: Cid): Promise<Uint8Array | null> {
    this.#assertOpen();
    digestFromCid(cid);
    const envelope = this.#envelopes.get(cid);
    return envelope === undefined ? null : this.#unwrap(envelope);
  }

  async delete(cid: Cid): Promise<void> {
    this.#assertOpen();
    digestFromCid(cid);
    this.#envelopes.delete(cid);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#wrappingKey.fill(0);
    this.#recoveryKey.fill(0);
    this.#envelopes.clear();
  }
}

export function generateRecoveryKey(): Uint8Array {
  return randomBytes(32);
}
