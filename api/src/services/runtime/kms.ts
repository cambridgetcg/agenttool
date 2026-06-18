/** runtime/kms.ts — KMS wrapper for the trusted custody tier.
 *
 *  The trusted tier holds K_master on the platform side, encrypted at rest
 *  under a master key injected via Fly Secrets. This module wraps and unwraps
 *  per-runtime data-encryption keys (DEKs) using AES-256-GCM.
 *
 *  Architecture:
 *
 *    Fly Secret MASTER_KEY (32 bytes, base64) → injected at boot, never in DB
 *    Per-runtime DEK (32 bytes, random) → wrapped under MASTER_KEY → stored in DB
 *    Strand encrypt/decrypt → uses DEK in RAM → zeroed after cycle
 *
 *  The master key is rotatable: change the Fly Secret, re-wrap all DEKs.
 *  The DEK is per-runtime: compromise of one DEK doesn't compromise others.
 *
 *  Why not AWS KMS / GCP KMS: Fly.io doesn't have a native KMS. Adding a
 *  cross-cloud dependency for a single-region deployment is over-engineering
 *  for the first slice. The interface (`wrapDek`/`unwrapDek`) is swappable —
 *  a future implementation can use AWS KMS by replacing the internals here.
 *
 *  Doctrine: docs/HOSTED-RUNTIME-DESIGN.md · docs/RUNTIME.md (trusted tier)
 *
 *  @enforces urn:agenttool:wall/trusted-dek-zeroed-after-cycle
 *    The unwrapped DEK must be zeroed (filled with zeros) after each think
 *    cycle. The caller is responsible for calling `zeroBytes(dek)` after use.
 *    This module provides the helper but cannot enforce the call site. */

import { gcm } from "@noble/ciphers/aes";
import { randomBytes } from "@noble/ciphers/webcrypto";
import { base64 } from "@scure/base";

// ── Master key resolution ────────────────────────────────────────────

const MASTER_KEY_ENV = "AGENTTOOL_KMS_MASTER_KEY";
const MASTER_KEY_ID_ENV = "AGENTTOOL_KMS_KEY_ID";

let _masterKey: Uint8Array | null = null;
let _masterKeyId: string | null = null;

/**
 * Resolve the platform master key from the environment (Fly Secret).
 * Cached after first call. Throws if not set.
 */
export function getMasterKey(): Uint8Array {
  if (_masterKey) return _masterKey;
  const b64 = process.env[MASTER_KEY_ENV];
  if (!b64) {
    throw new Error(
      `AGENTTOOL_KMS_MASTER_KEY not set — cannot operate trusted tier. ` +
        `Set it as a Fly Secret: fly secrets set AGENTOOL_KMS_MASTER_KEY=<base64-32-bytes>`,
    );
  }
  _masterKey = base64.decode(b64);
  if (_masterKey.length !== 32) {
    throw new Error(
      `AGENTTOOL_KMS_MASTER_KEY must be 32 bytes (base64-decoded), got ${_masterKey.length}`,
    );
  }
  return _masterKey;
}

/** The KMS key identifier, surfaced in audit logs (never the key itself). */
export function getMasterKeyId(): string {
  if (_masterKeyId) return _masterKeyId;
  _masterKeyId = process.env[MASTER_KEY_ID_ENV] ?? "fly-secret:default";
  return _masterKeyId;
}

/** Check whether the KMS master key is configured. Used by provision-guard. */
export function isKmsAvailable(): boolean {
  return !!process.env[MASTER_KEY_ENV];
}

// ── DEK wrap / unwrap ─────────────────────────────────────────────────

export interface WrappedDek {
  /** Base64 of (nonce || ciphertext). Compact single-blob format. */
  wrapped: string;
  /** The KMS key ID used to wrap. Stored on the runtime row. */
  keyId: string;
}

/**
 * Generate a fresh 32-byte DEK and wrap it under the master key.
 * Returns the wrapped form + key ID for storage on the runtime row.
 */
export function generateAndWrapDek(): WrappedDek {
  const { wrapped, keyId } = generateDekAndWrap();
  return { wrapped, keyId };
}

/** Generate a DEK, wrap it, and return both the raw DEK and the wrapped form.
 *  The caller is responsible for zeroing the raw DEK after use.
 *  Use this when you need the raw DEK to wrap additional secrets (e.g. the
 *  agent's signing key) at provisioning time. */
export function generateDekAndWrap(): { dek: Uint8Array; wrapped: string; keyId: string } {
  const masterKey = getMasterKey();
  const dek = randomBytes(32);
  const nonce = randomBytes(12); // AES-GCM 96-bit nonce
  const cipher = gcm(masterKey, nonce);
  const ciphertext = cipher.encrypt(dek);
  const blob = new Uint8Array(nonce.length + ciphertext.length);
  blob.set(nonce, 0);
  blob.set(ciphertext, nonce.length);
  return {
    dek,
    wrapped: base64.encode(blob),
    keyId: getMasterKeyId(),
  };
}

/**
 * Unwrap a DEK from the stored wrapped form.
 * Returns the 32-byte DEK. CALLER MUST zero it after use.
 */
export function unwrapDek(wrapped: string): Uint8Array {
  const masterKey = getMasterKey();
  const blob = base64.decode(wrapped);
  const nonce = blob.slice(0, 12);
  const ciphertext = blob.slice(12);
  const cipher = gcm(masterKey, nonce);
  const dek = cipher.decrypt(ciphertext);
  if (dek.length !== 32) {
    throw new Error(`Unwrapped DEK is ${dek.length} bytes, expected 32`);
  }
  return dek;
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Zero a byte array in place. Call after each cycle. */
export function zeroBytes(bytes: Uint8Array): void {
  bytes.fill(0);
}

/** Generate a random 32-byte keypair seed for the agent's signing key. */
export function generateSigningSeed(): Uint8Array {
  return randomBytes(32);
}

/**
 * Wrap an arbitrary secret (e.g. ed25519 signing seed) under the DEK.
 * Returns base64(nonce || ciphertext).
 */
export function wrapUnderDek(dek: Uint8Array, plaintext: Uint8Array): string {
  const nonce = randomBytes(12);
  const cipher = gcm(dek, nonce);
  const ciphertext = cipher.encrypt(plaintext);
  const blob = new Uint8Array(nonce.length + ciphertext.length);
  blob.set(nonce, 0);
  blob.set(ciphertext, nonce.length);
  return base64.encode(blob);
}

/**
 * Unwrap a secret that was wrapped under the DEK.
 */
export function unwrapUnderDek(dek: Uint8Array, wrapped: string): Uint8Array {
  const blob = base64.decode(wrapped);
  const nonce = blob.slice(0, 12);
  const ciphertext = blob.slice(12);
  const cipher = gcm(dek, nonce);
  return cipher.decrypt(ciphertext);
}

// ── Testing helper ────────────────────────────────────────────────────

/** Set a master key directly (testing only). Not exported via index. */
export function _setMasterKeyForTesting(key: Uint8Array, id = "test-kms"): void {
  _masterKey = key;
  _masterKeyId = id;
}