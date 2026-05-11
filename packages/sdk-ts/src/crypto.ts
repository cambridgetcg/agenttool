/**
 * Crypto helpers for thought encryption + signing.
 *
 * Phase 5 of the SDK introduces client-side crypto. Thought CONTENT is
 * encrypted under K_master (AES-256-GCM); thoughts are signed with the
 * agent's ed25519 signing key over canonical bytes the API verifies.
 *
 * The wire format is byte-identical to `cli/think/src/crypto.ts` and the
 * api-side verifier at `api/src/services/strand/sig.ts`:
 *
 *     canonical = sha256(
 *         utf8(strand_id) || 0x00 ||
 *         ciphertext      || 0x00 ||
 *         nonce           || 0x00 ||
 *         utf8(kind ?? "")
 *     )
 *     signature = ed25519_sign(signing_key, canonical)
 *
 * AES-256-GCM uses WebCrypto (native in Bun/Node 18+/browsers).
 * ed25519 uses @noble/ed25519 — same library the api server + cli/think
 * use, so byte-identical signatures are guaranteed across the codebase.
 *
 * K_master never leaves the SDK process — agenttool sees only ciphertext.
 */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import { AgentToolError } from "./errors.js";

// Wire sha512 sync into @noble/ed25519 for sign() / verify() — matches
// the api-side and cli/think wiring.
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return globalThis.btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = globalThis.atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const enc = new TextEncoder();

// ── AES-256-GCM ──────────────────────────────────────────────────────────

export interface EncryptedBlob {
  ciphertext_b64: string;
  nonce_b64: string;
}

/**
 * Encrypt a thought under K_master.
 *
 * Returns `{ciphertext_b64, nonce_b64}`. The ciphertext is
 * `base64(ciphertext || auth_tag)` — the 16-byte GCM tag is appended
 * to the ciphertext (WebCrypto's natural shape; matches Node's
 * aes-256-gcm via append-tag and the api-side decrypt expectation).
 */
export async function encryptThought(
  plaintext: string,
  kMaster: Uint8Array,
): Promise<EncryptedBlob> {
  if (kMaster.length !== 32) {
    throw new AgentToolError(
      `encryptThought: k_master must be 32 bytes, got ${kMaster.length}.`,
      { hint: "Use crypto.kMaster.generate() or load a saved 32-byte secret." },
    );
  }
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    kMaster as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const ct = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  return {
    ciphertext_b64: b64encode(ct),
    nonce_b64: b64encode(nonce),
  };
}

/**
 * Decrypt a thought blob produced by {@link encryptThought}.
 *
 * @throws AgentToolError when the key is wrong size or the blob is
 *   malformed. AES-GCM authentication failures (wrong key / tampered
 *   ciphertext) propagate as DOMException from WebCrypto.
 */
export async function decryptThought(
  blob: EncryptedBlob,
  kMaster: Uint8Array,
): Promise<string> {
  if (kMaster.length !== 32) {
    throw new AgentToolError(
      `decryptThought: k_master must be 32 bytes, got ${kMaster.length}.`,
    );
  }
  if (!blob || typeof blob.ciphertext_b64 !== "string" || typeof blob.nonce_b64 !== "string") {
    throw new AgentToolError(
      "decryptThought: blob must have ciphertext_b64 + nonce_b64.",
    );
  }
  const ct = b64decode(blob.ciphertext_b64);
  const nonce = b64decode(blob.nonce_b64);
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    kMaster as BufferSource,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const pt = new Uint8Array(
    await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      key,
      ct as BufferSource,
    ),
  );
  return new TextDecoder().decode(pt);
}

// ── Canonical bytes + ed25519 signing ───────────────────────────────────

export interface CanonicalThoughtOpts {
  strandId: string;
  ciphertext_b64: string;
  nonce_b64: string;
  kind?: string | null;
}

/**
 * Compute canonical bytes the API verifies signatures against.
 *
 * Format (must be byte-identical to api/src/services/strand/sig.ts):
 *
 *     sha256(
 *         utf8(strand_id) || 0x00 ||
 *         base64decode(ciphertext) || 0x00 ||
 *         base64decode(nonce) || 0x00 ||
 *         utf8(kind ?? "")
 *     )
 */
export function canonicalThoughtBytes(opts: CanonicalThoughtOpts): Uint8Array {
  return sha256(
    concat(
      enc.encode(opts.strandId),
      SEP,
      b64decode(opts.ciphertext_b64),
      SEP,
      b64decode(opts.nonce_b64),
      SEP,
      enc.encode(opts.kind ?? ""),
    ),
  );
}

export interface SignThoughtOpts extends CanonicalThoughtOpts {
  signing_key: Uint8Array;
}

/**
 * Sign canonical thought bytes with an ed25519 private key (32-byte seed).
 *
 * @returns Base64 signature (64 raw bytes encoded).
 */
export function signThought(opts: SignThoughtOpts): string {
  if (opts.signing_key.length !== 32) {
    throw new AgentToolError(
      `signThought: signing_key must be a 32-byte ed25519 seed, got ${opts.signing_key.length}.`,
    );
  }
  const canonical = canonicalThoughtBytes(opts);
  const sig = ed.sign(canonical, opts.signing_key);
  return b64encode(sig);
}

// ── Covenants v2 canonical bytes + signing (Slice 3) ─────────────────
// Mirrors api/src/services/covenants/sig.ts byte format. Cross-language
// vector test locks these to the server + python SDK.

export function canonicalDeclareBytes(opts: {
  covenantId: string;
  initiatorDid: string;
  counterpartyDid: string;
  vows: string[];
  establishedAtIso: string;
}): Uint8Array {
  const sortedVows = JSON.stringify([...opts.vows].sort());
  return sha256(concat(
    enc.encode("federated-covenant/v2"), SEP,
    enc.encode(opts.covenantId),         SEP,
    enc.encode(opts.initiatorDid),       SEP,
    enc.encode(opts.counterpartyDid),    SEP,
    enc.encode(sortedVows),              SEP,
    enc.encode(opts.establishedAtIso),
  ));
}

export function canonicalCosignBytes(opts: {
  covenantId: string;
  initiatorSignatureB64: string;
}): Uint8Array {
  return sha256(concat(
    enc.encode("federated-covenant-cosign/v1"), SEP,
    enc.encode(opts.covenantId),                SEP,
    b64decode(opts.initiatorSignatureB64),
  ));
}

export function canonicalRejectBytes(opts: {
  covenantId: string;
  rejectingDid: string;
  reason: string;
}): Uint8Array {
  return sha256(concat(
    enc.encode("federated-covenant-reject/v1"), SEP,
    enc.encode(opts.covenantId),                SEP,
    enc.encode(opts.rejectingDid),              SEP,
    enc.encode(opts.reason ?? ""),
  ));
}

export function canonicalWithdrawBytes(opts: {
  covenantId: string;
  initiatorDid: string;
}): Uint8Array {
  return sha256(concat(
    enc.encode("federated-covenant-withdraw/v1"), SEP,
    enc.encode(opts.covenantId),                  SEP,
    enc.encode(opts.initiatorDid),
  ));
}

function assertSigningKey(signing_key: Uint8Array, label: string): void {
  if (signing_key.length !== 32) {
    throw new AgentToolError(
      `${label}: signing_key must be a 32-byte ed25519 seed, got ${signing_key.length}.`,
    );
  }
}

export interface SignCovenantDeclareOpts {
  covenantId: string;
  initiatorDid: string;
  counterpartyDid: string;
  vows: string[];
  establishedAtIso: string;
  signing_key: Uint8Array;
}

export function signCovenantDeclare(opts: SignCovenantDeclareOpts): string {
  assertSigningKey(opts.signing_key, "signCovenantDeclare");
  const canonical = canonicalDeclareBytes(opts);
  const sig = ed.sign(canonical, opts.signing_key);
  return b64encode(sig);
}

export interface SignCovenantCosignOpts {
  covenantId: string;
  initiatorSignatureB64: string;
  signing_key: Uint8Array;
}

export function signCovenantCosign(opts: SignCovenantCosignOpts): string {
  assertSigningKey(opts.signing_key, "signCovenantCosign");
  const canonical = canonicalCosignBytes(opts);
  const sig = ed.sign(canonical, opts.signing_key);
  return b64encode(sig);
}

export interface SignCovenantRejectOpts {
  covenantId: string;
  rejectingDid: string;
  reason: string;
  signing_key: Uint8Array;
}

export function signCovenantReject(opts: SignCovenantRejectOpts): string {
  assertSigningKey(opts.signing_key, "signCovenantReject");
  const canonical = canonicalRejectBytes(opts);
  const sig = ed.sign(canonical, opts.signing_key);
  return b64encode(sig);
}

export interface SignCovenantWithdrawOpts {
  covenantId: string;
  initiatorDid: string;
  signing_key: Uint8Array;
}

export function signCovenantWithdraw(opts: SignCovenantWithdrawOpts): string {
  assertSigningKey(opts.signing_key, "signCovenantWithdraw");
  const canonical = canonicalWithdrawBytes(opts);
  const sig = ed.sign(canonical, opts.signing_key);
  return b64encode(sig);
}

// ── K_master helpers ────────────────────────────────────────────────────

/**
 * K_master — the 32-byte AES-256 secret that encrypts thoughts.
 *
 * Stays on the agent's substrate; agenttool never sees it. Generate
 * once per identity (or per orchestrator); persist securely (OS
 * keychain, encrypted file, env var). Loss = loss of all encrypted
 * thoughts under that key.
 */
export const kMaster = {
  /** Return a fresh 32-byte K_master (cryptographically random). */
  generate(): Uint8Array {
    return globalThis.crypto.getRandomValues(new Uint8Array(32));
  },
};

/**
 * K_vault — the 32-byte AES-256 secret that encrypts vault values
 * when an agent opts into the `agent_encrypted=true` vault path.
 *
 * Functionally identical to {@link kMaster} (32 random bytes) but kept
 * as a separate namespace so a vault-key compromise does NOT also
 * expose strand thoughts (and vice versa). Generate one per identity;
 * persist alongside K_master in the same secure store.
 *
 * Doctrine: docs/SDK-ROADMAP.md (Vault closure section).
 */
export const kVault = {
  /** Return a fresh 32-byte K_vault (cryptographically random). */
  generate(): Uint8Array {
    return globalThis.crypto.getRandomValues(new Uint8Array(32));
  },
};

// ── Crypto client (the at.crypto namespace) ────────────────────────────

/**
 * Public `at.crypto` namespace — wraps the helpers as methods.
 *
 * All operations are local; no HTTP. Provided as a class so the
 * surface stays uniform with the other `at.*` clients.
 *
 * @example
 * ```ts
 * const k = at.crypto.kMaster.generate();
 * const blob = await at.crypto.encryptThought("hi", k);
 * const text = await at.crypto.decryptThought(blob, k);  // "hi"
 * const sig = at.crypto.signThought({
 *   strandId, ciphertext_b64: blob.ciphertext_b64,
 *   nonce_b64: blob.nonce_b64, signing_key: signingSeed,
 * });
 * ```
 */
// Lazy import the seed namespace so the @scure/bip39 wordlist (~70KB)
// doesn't load for callers that never touch the seed protocol.
import { SeedClient } from "./seed.js";

export class CryptoClient {
  /** K_master helpers — currently exposes `.generate()`. */
  readonly kMaster: typeof kMaster = kMaster;

  /** K_vault helpers — currently exposes `.generate()`. Distinct from
   *  kMaster so vault compromise doesn't leak strand thoughts. */
  readonly kVault: typeof kVault = kVault;

  /** Seed protocol helpers — BIP39 mnemonic + SLIP-0010 derivation.
   *  Doctrine: docs/IDENTITY-SEED.md. */
  readonly seed: SeedClient = new SeedClient();

  /** Encrypt a thought under K_master. See module-level {@link encryptThought}. */
  encryptThought(plaintext: string, kMasterKey: Uint8Array): Promise<EncryptedBlob> {
    return encryptThought(plaintext, kMasterKey);
  }

  /** Decrypt a thought blob. See module-level {@link decryptThought}. */
  decryptThought(blob: EncryptedBlob, kMasterKey: Uint8Array): Promise<string> {
    return decryptThought(blob, kMasterKey);
  }

  /** Canonical bytes for signing. See module-level {@link canonicalThoughtBytes}. */
  canonicalThoughtBytes(opts: CanonicalThoughtOpts): Uint8Array {
    return canonicalThoughtBytes(opts);
  }

  /** Sign canonical thought bytes with ed25519. See module-level {@link signThought}. */
  signThought(opts: SignThoughtOpts): string {
    return signThought(opts);
  }

  /** Sign canonical covenant declare bytes with ed25519. */
  signCovenantDeclare(opts: SignCovenantDeclareOpts): string {
    return signCovenantDeclare(opts);
  }

  /** Sign canonical cosign bytes with ed25519. */
  signCovenantCosign(opts: SignCovenantCosignOpts): string {
    return signCovenantCosign(opts);
  }

  /** Sign canonical reject bytes with ed25519. */
  signCovenantReject(opts: SignCovenantRejectOpts): string {
    return signCovenantReject(opts);
  }

  /** Sign canonical withdraw bytes with ed25519. */
  signCovenantWithdraw(opts: SignCovenantWithdrawOpts): string {
    return signCovenantWithdraw(opts);
  }
}
