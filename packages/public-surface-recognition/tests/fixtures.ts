import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import type {
  PublicSurfaceBinding,
  RecordSigner,
} from "@agenttool/public-surface-binding";

import type {
  PublicSurfaceAdoption,
  PublicSurfaceAdoptionCore,
  PublicSurfaceWithdrawal,
  PublicSurfaceWithdrawalCore,
} from "../src/index.js";

export interface RecordDetails<T> {
  canonical_json: string;
  canonical_utf8_hex: string;
  canonical_sha256: string;
  record: T;
}

export interface RecognitionVectors {
  format: string;
  package_version: string;
  warning: string;
  deterministic_root: {
    private_seed_hex: string;
    public_key_base64: string;
  };
  source_binding: {
    package_version: string;
    binding_id: string;
    document_sha256: string;
    record: PublicSurfaceBinding;
  };
  adoption: RecordDetails<PublicSurfaceAdoption> & {
    signature_domain: string;
    id_domain: string;
    core: PublicSurfaceAdoptionCore;
    core_canonical_json: string;
    signing_bytes_hex: string;
    signing_digest_hex: string;
    signature_base64: string;
    adoption_id: string;
  };
  withdrawal: RecordDetails<PublicSurfaceWithdrawal> & {
    signature_domain: string;
    id_domain: string;
    core: PublicSurfaceWithdrawalCore;
    core_canonical_json: string;
    signing_bytes_hex: string;
    signing_digest_hex: string;
    signature_base64: string;
    withdrawal_id: string;
  };
}

export const VECTORS = JSON.parse(readFileSync(
  join(import.meta.dir, "../vectors/agenttool-public-surface-recognition-v0.1-vectors.json"),
  "utf8",
)) as RecognitionVectors;

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function hexBytes(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

export function hex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

export function withNobleSha512<T>(operation: () => T): T {
  const previous = ed25519.etc.sha512Sync;
  ed25519.etc.sha512Sync = (...messages: Uint8Array[]) => {
    const hash = sha512.create();
    for (const message of messages) hash.update(message);
    return hash.digest();
  };
  try {
    return operation();
  } finally {
    ed25519.etc.sha512Sync = previous;
  }
}

export function signerFromSeed(seed: Uint8Array): RecordSigner {
  return {
    public_key: Buffer.from(withNobleSha512(() => ed25519.getPublicKey(seed))).toString("base64"),
    sign_digest(digest) {
      return Buffer.from(withNobleSha512(() => ed25519.sign(digest, seed))).toString("base64");
    },
  };
}

export const ROOT_SIGNER = signerFromSeed(hexBytes(VECTORS.deterministic_root.private_seed_hex));
export const ALTERNATE_ROOT_SIGNER = signerFromSeed(
  Uint8Array.from({ length: 32 }, (_, index) => index + 96),
);
export const BINDING_SIGNER = signerFromSeed(
  Uint8Array.from({ length: 32 }, (_, index) => index),
);
