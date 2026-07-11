import type { JsonObject } from "./canonical.js";
import type { Cid } from "./cid.js";

export const ADDS_VERSION = "0.1" as const;
export const MANIFEST_SIGNATURE_DOMAIN = "adds-manifest/v1" as const;
export const GRANT_SIGNATURE_DOMAIN = "adds-grant/v1" as const;
export const BLOCK_AAD_DOMAIN = "adds-block/v1" as const;
export const GRANT_WRAP_DOMAIN = "adds-grant-wrap/v1" as const;
export const GRANT_KEK_INFO = "adds-grant-kek/v1" as const;

export interface Signature {
  algorithm: "Ed25519";
  public_key: string;
  value: string;
}

export interface Signer {
  id: string;
  ed25519_public_key: string;
}

export interface ManifestChunk {
  index: number;
  cid: Cid;
  nonce: string;
  plaintext_size: number;
  ciphertext_size: number;
}

export interface UnsignedManifest {
  adds_version: typeof ADDS_VERSION;
  kind: "manifest";
  object_id: string;
  created_at: number;
  plaintext: {
    size: number;
  };
  encryption: {
    algorithm: "AES-256-GCM";
    chunk_size: number;
    block_aad: typeof BLOCK_AAD_DOMAIN;
    key_id: string;
    aad_context: string;
  };
  chunks: ManifestChunk[];
  publisher: Signer;
  schema?: string;
  media_type?: string;
  metadata?: JsonObject;
  provenance?: {
    parents?: Cid[];
    transformation?: string;
    generated_by?: string;
  };
  extensions?: JsonObject;
}

export type SignedManifest = UnsignedManifest & { signature: Signature };

export interface GrantWrap {
  algorithm: "X25519-HKDF-SHA256-AES-256-GCM";
  ephemeral_public_key: string;
  nonce: string;
  ciphertext: string;
}

export interface UnsignedGrant {
  adds_version: typeof ADDS_VERSION;
  kind: "grant";
  grant_id: string;
  manifest_cid: Cid;
  issuer: Signer;
  audience: string;
  audience_x25519_public_key: string;
  audience_x25519_key_id: string;
  rights: ["read"];
  issued_at: number;
  not_before?: number;
  expires_at: number;
  extensions?: JsonObject;
  key_wrap: GrantWrap;
}

export type SignedGrant = UnsignedGrant & { signature: Signature };

export interface DataRef {
  cid: Cid;
}

export interface ReplicationSummary {
  storedObjects: number;
  /** Per-block provider write acknowledgements; not proof of complete replicas or durability. */
  minimumAcknowledgements: number;
  maximumAcknowledgements: number;
  failedWrites: number;
}

/** Safe ordinary publish result: it deliberately does not expose the object's DEK. */
export interface PutResult {
  ref: DataRef;
  manifest: SignedManifest;
  replication: ReplicationSummary;
}

export interface AgentDataIdentity {
  /** Generic principal URI/identifier; signatures bind this claim but do not resolve or attest it externally. */
  id: string;
  signingPrivateKey: Uint8Array;
  signingPublicKey: Uint8Array;
  boxPrivateKey: Uint8Array;
  boxPublicKey: Uint8Array;
}

export type ByteSource =
  | string
  | Uint8Array
  | ArrayBuffer
  | Blob
  | Iterable<Uint8Array>
  | AsyncIterable<Uint8Array>;

export interface PutOptions {
  chunkSize?: number;
  maxBytes?: number;
  createdAt?: Date | string | number;
  schema?: string;
  mediaType?: string;
  metadata?: JsonObject;
  provenance?: UnsignedManifest["provenance"];
  extensions?: JsonObject;
}

export interface ShareOptions {
  audience: string;
  audienceBoxPublicKey: Uint8Array;
  /** Optional assertion; when supplied it must equal the protocol's deterministic sha256 fingerprint. */
  audienceBoxKeyId?: string;
  issuedAt?: Date | string | number;
  notBefore?: Date | string | number;
  /** Mandatory finite expiry. */
  expiresAt: Date | string | number;
}

export interface GetOptions {
  grant?: SignedGrant;
  recipientBoxPrivateKey?: Uint8Array;
  recipientId?: string;
  maxBytes?: number;
  now?: Date | string | number;
}

export interface InspectOptions {
  maxBytes?: number;
}

export interface VerifyResult {
  cid: Cid;
  manifest: SignedManifest;
  /** CID, frame, descriptor, and nonce checks only; not AEAD/plaintext verification. */
  ciphertextBlocksVerified: number;
  encryptedBytes: number;
}
