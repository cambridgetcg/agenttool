/** Agent-held constitutional HTTP mutation and exact-private-read proofs.
 * Byte-identical to api/src/services/identity/authority.ts. */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

export const IDENTITY_AUTHORITY_DOMAIN = "identity-authority/v1";
export const IDENTITY_READ_AUTHORITY_DOMAIN = "identity-read-authority/v1";
export const AUTHORITY_HEADERS = Object.freeze({
  sequence: "X-Agenttool-Authority-Sequence",
  timestamp: "X-Agenttool-Authority-Timestamp",
  signature: "X-Agenttool-Authority-Signature",
});

export interface CanonicalIdentityAuthorityOpts {
  identityDid: string;
  method: string;
  /** Origin-form path plus its exact query string, if any. */
  requestTarget: string;
  /** The exact bytes that will be transmitted as the HTTP request entity. */
  body: string | Uint8Array;
  sequence: number;
  timestamp: string;
}

export interface CanonicalIdentityReadAuthorityOpts {
  identityDid: string;
  /** Origin-form GET path plus its exact query string, if any. */
  requestTarget: string;
  /** The identity's current mutation sequence. Reads do not advance it. */
  currentSequence: number;
  timestamp: string;
}

function bytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? new TextEncoder().encode(value) : value;
}

function hex(value: Uint8Array): string {
  return Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("");
}

function b64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

export function canonicalIdentityAuthorityBytes(
  opts: CanonicalIdentityAuthorityOpts,
): Uint8Array {
  if (!Number.isSafeInteger(opts.sequence) || opts.sequence < 1) {
    throw new Error("authority sequence must be a positive safe integer");
  }
  if (!opts.requestTarget.startsWith("/") || opts.requestTarget.includes("#")) {
    throw new Error(
      "authority requestTarget must be an absolute path with optional query and no fragment",
    );
  }
  const enc = new TextEncoder();
  const fields = [
    enc.encode(opts.identityDid),
    enc.encode(opts.method.toUpperCase()),
    enc.encode(opts.requestTarget),
    enc.encode(hex(sha256(bytes(opts.body)))),
    enc.encode(String(opts.sequence)),
    enc.encode(opts.timestamp),
  ];
  const parts: Uint8Array[] = [enc.encode(IDENTITY_AUTHORITY_DOMAIN)];
  for (const field of fields) parts.push(new Uint8Array([0]), field);
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return sha256(joined);
}

export function identityAuthorityHeaders(
  opts: CanonicalIdentityAuthorityOpts & { signingKey: Uint8Array },
): Record<string, string> {
  if (opts.signingKey.length !== 32) {
    throw new Error("signingKey must be a 32-byte ed25519 seed");
  }
  const signature = b64(
    ed.sign(canonicalIdentityAuthorityBytes(opts), opts.signingKey),
  );
  return {
    [AUTHORITY_HEADERS.sequence]: String(opts.sequence),
    [AUTHORITY_HEADERS.timestamp]: opts.timestamp,
    [AUTHORITY_HEADERS.signature]: signature,
  };
}

/**
 * Return the exact digest for an identity-read-authority/v1 proof.
 *
 * Private reads are deliberately GET-only with an empty request body. The
 * current mutation sequence (including zero) is bound but never consumed.
 */
export function canonicalIdentityReadAuthorityBytes(
  opts: CanonicalIdentityReadAuthorityOpts,
): Uint8Array {
  if (
    !Number.isSafeInteger(opts.currentSequence) ||
    opts.currentSequence < 0
  ) {
    throw new Error(
      "read authority currentSequence must be a non-negative safe integer",
    );
  }
  if (!opts.requestTarget.startsWith("/") || opts.requestTarget.includes("#")) {
    throw new Error(
      "read authority requestTarget must be an absolute path with optional query and no fragment",
    );
  }
  const enc = new TextEncoder();
  const fields = [
    enc.encode(opts.identityDid),
    enc.encode("GET"),
    enc.encode(opts.requestTarget),
    enc.encode(hex(sha256(new Uint8Array()))),
    enc.encode(String(opts.currentSequence)),
    enc.encode(opts.timestamp),
  ];
  const parts: Uint8Array[] = [enc.encode(IDENTITY_READ_AUTHORITY_DOMAIN)];
  for (const field of fields) parts.push(new Uint8Array([0]), field);
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return sha256(joined);
}

/** Sign one exact private GET without consuming the mutation sequence. */
export function identityReadAuthorityHeaders(
  opts: CanonicalIdentityReadAuthorityOpts & { signingKey: Uint8Array },
): Record<string, string> {
  if (opts.signingKey.length !== 32) {
    throw new Error("signingKey must be a 32-byte ed25519 seed");
  }
  const signature = b64(
    ed.sign(canonicalIdentityReadAuthorityBytes(opts), opts.signingKey),
  );
  return {
    [AUTHORITY_HEADERS.sequence]: String(opts.currentSequence),
    [AUTHORITY_HEADERS.timestamp]: opts.timestamp,
    [AUTHORITY_HEADERS.signature]: signature,
  };
}
