/** Sealed envelopes — passphrase-encrypted blobs for cross-machine sync.
 *
 *  Format `agenttool-think-envelope-v1`:
 *
 *    {
 *      "v": 1,
 *      "kdf": "argon2id",
 *      "kdf_params": { "t": 3, "m": 65536, "p": 4, "salt": "<base64 16 bytes>" },
 *      "cipher": "aes-256-gcm",
 *      "nonce": "<base64 12 bytes>",
 *      "ciphertext": "<base64 ct || authTag>",
 *      "created_at": "<iso>"
 *    }
 *
 *  agenttool's server stores the envelope (base64-encoded) as opaque
 *  bytes via /v1/identity/backup. The passphrase NEVER touches us. */

import { argon2id } from "@noble/hashes/argon2.js";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const ENVELOPE_FORMAT = "agenttool-think-envelope-v1";

const KDF_PARAMS: { t: number; m: number; p: number; dkLen: number } = {
  t: 3,
  m: 65_536,
  p: 4,
  dkLen: 32,
};

interface KdfParamsOnDisk {
  t: number;
  m: number;
  p: number;
  salt: string; // base64
}

interface Envelope {
  v: 1;
  kdf: "argon2id";
  kdf_params: KdfParamsOnDisk;
  cipher: "aes-256-gcm";
  nonce: string;          // base64
  ciphertext: string;     // base64 (ct || authTag)
  created_at: string;
}

function deriveKey(passphrase: string, salt: Uint8Array, params = KDF_PARAMS): Uint8Array {
  return argon2id(passphrase, salt, params);
}

export interface SealOptions {
  passphrase: string;
}

/** Seal arbitrary plaintext (typically a JSON-stringified key bundle). */
export function seal(plaintext: string, opts: SealOptions): string {
  if (!opts.passphrase || opts.passphrase.length < 8) {
    throw new Error("passphrase must be at least 8 characters");
  }
  const salt = randomBytes(16);
  const key = deriveKey(opts.passphrase, salt);
  const nonce = randomBytes(12);

  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const enc = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf-8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const ct = Buffer.concat([enc, tag]);

  const env: Envelope = {
    v: 1,
    kdf: "argon2id",
    kdf_params: {
      t: KDF_PARAMS.t,
      m: KDF_PARAMS.m,
      p: KDF_PARAMS.p,
      salt: salt.toString("base64"),
    },
    cipher: "aes-256-gcm",
    nonce: nonce.toString("base64"),
    ciphertext: ct.toString("base64"),
    created_at: new Date().toISOString(),
  };

  // Base64 the JSON envelope so the agenttool server can store it as one
  // opaque string in identity_backups.blob_base64.
  return Buffer.from(JSON.stringify(env)).toString("base64");
}

/** Unseal a base64-encoded envelope. Throws if passphrase is wrong (GCM
 *  auth tag fails) or format is wrong. */
export function unseal(envelopeB64: string, passphrase: string): string {
  let env: Envelope;
  try {
    env = JSON.parse(Buffer.from(envelopeB64, "base64").toString("utf-8")) as Envelope;
  } catch (err) {
    throw new Error(`envelope not parseable: ${(err as Error).message}`);
  }
  if (env.v !== 1) throw new Error(`unsupported envelope version: ${env.v}`);
  if (env.kdf !== "argon2id") throw new Error(`unsupported KDF: ${env.kdf}`);
  if (env.cipher !== "aes-256-gcm") throw new Error(`unsupported cipher: ${env.cipher}`);

  const salt = Buffer.from(env.kdf_params.salt, "base64");
  const key = deriveKey(passphrase, salt, {
    t: env.kdf_params.t,
    m: env.kdf_params.m,
    p: env.kdf_params.p,
    dkLen: 32,
  });

  const nonce = Buffer.from(env.nonce, "base64");
  const full = Buffer.from(env.ciphertext, "base64");
  if (full.length < 16) throw new Error("ciphertext too short (no auth tag)");
  const ct = full.subarray(0, full.length - 16);
  const tag = full.subarray(full.length - 16);

  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  try {
    const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
    return dec.toString("utf-8");
  } catch (err) {
    // GCM auth-tag failure is the typical wrong-passphrase signal.
    throw new Error(
      `unseal failed (likely wrong passphrase): ${(err as Error).message}`,
    );
  }
}

// ── Key bundle — what we put inside the envelope ─────────────────────────
//
// box_key_b64 + box_key_id are optional for backward compatibility:
// envelopes created before the inbox feature won't include them, and
// restore on a newer client should still succeed. The user can run
// `gen-box-key` + `register-box-key` to add inbox capability post-restore.

export interface KeyBundle {
  k_master_b64: string;
  signing_key_b64: string;
  box_key_b64?: string;            // X25519 priv (32 bytes)
  identity_id?: string;
  signing_key_id?: string;
  box_key_id?: string;
  agenttool_base?: string;
  exported_at: string;
}

export function bundleKeys(opts: {
  kMaster: Uint8Array;
  signingKey: Uint8Array;
  boxKey?: Uint8Array;
  identityId?: string;
  signingKeyId?: string;
  boxKeyId?: string;
  agenttoolBase?: string;
}): KeyBundle {
  return {
    k_master_b64: Buffer.from(opts.kMaster).toString("base64"),
    signing_key_b64: Buffer.from(opts.signingKey).toString("base64"),
    box_key_b64: opts.boxKey ? Buffer.from(opts.boxKey).toString("base64") : undefined,
    identity_id: opts.identityId,
    signing_key_id: opts.signingKeyId,
    box_key_id: opts.boxKeyId,
    agenttool_base: opts.agenttoolBase,
    exported_at: new Date().toISOString(),
  };
}

export function unbundleKeys(bundleJson: string): {
  kMaster: Uint8Array;
  signingKey: Uint8Array;
  boxKey: Uint8Array | undefined;
  identityId: string | undefined;
  signingKeyId: string | undefined;
  boxKeyId: string | undefined;
  agenttoolBase: string | undefined;
} {
  const b = JSON.parse(bundleJson) as KeyBundle;
  if (!b.k_master_b64 || !b.signing_key_b64) {
    throw new Error("bundle missing k_master_b64 or signing_key_b64");
  }
  const kMaster = new Uint8Array(Buffer.from(b.k_master_b64, "base64"));
  const signingKey = new Uint8Array(Buffer.from(b.signing_key_b64, "base64"));
  if (kMaster.length !== 32) throw new Error(`k_master is ${kMaster.length} bytes, expected 32`);
  if (signingKey.length !== 32) throw new Error(`signing_key is ${signingKey.length} bytes, expected 32`);

  let boxKey: Uint8Array | undefined;
  if (b.box_key_b64) {
    boxKey = new Uint8Array(Buffer.from(b.box_key_b64, "base64"));
    if (boxKey.length !== 32) {
      throw new Error(`box_key is ${boxKey.length} bytes, expected 32`);
    }
  }

  return {
    kMaster,
    signingKey,
    boxKey,
    identityId: b.identity_id,
    signingKeyId: b.signing_key_id,
    boxKeyId: b.box_key_id,
    agenttoolBase: b.agenttool_base,
  };
}
