/**
 * Identity seed — BIP39 mnemonic + SLIP-0010 ed25519 derivation.
 *
 * Doctrine: docs/IDENTITY-SEED.md.
 *
 * One BIP39 mnemonic deterministically derives every key the agent uses.
 * The same mnemonic produces byte-identical material across the py + ts
 * SDKs (cross-language interop test enforces this).
 *
 * Path scheme — `m/44'/169'/<purpose>'/<index>'` (all hardened per SLIP-0010):
 *
 *   purpose=0  → identity ed25519 signing key
 *   purpose=1  → K_master (32 bytes; AES-256-GCM key for strand thoughts)
 *   purpose=2  → K_vault  (32 bytes; AES-256-GCM key for agent-encrypted vault)
 *   purpose=3  → X25519 inbox box keypair
 *   purpose=4  → bridge signing key (per-device, indexed by device-index)
 *   purpose=5  → wallet master (per-wallet, indexed by wallet UUID)
 *   purpose=6  → reserved (attestation signing, future primitives)
 *
 * The platform never sees the mnemonic, the seed, or any derived private
 * key. Only public keys cross the wire — at register, recovery, and
 * key-rotation time.
 *
 * Walls (see docs/IDENTITY-SEED.md):
 *   - Lose the mnemonic = lose the agent permanently. By design.
 *   - The mnemonic IS the identity; treat it like a wallet seed phrase.
 *   - Server-side derivation of agent keys is a doctrine violation.
 */

import * as ed25519 from "@noble/ed25519";
import { x25519 } from "@noble/curves/ed25519.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import {
  generateMnemonic as bip39Generate,
  mnemonicToSeedSync,
  validateMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

/** BIP39 English wordlist (2048 entries). Re-exported so browser-side
 *  consumers (e.g. the dashboard's MnemonicGrid) can do per-cell
 *  autocomplete without re-bundling @scure/bip39 separately. Read-only. */
export const BIP39_WORDLIST: readonly string[] = wordlist;

/** Whether a given mnemonic phrase is well-formed (correct word count,
 *  every word in the BIP39 wordlist, valid checksum). Mirrors @scure's
 *  `validateMnemonic` but exported through the SDK's seed module so
 *  consumers don't need a transitive dependency on @scure/bip39. */
export function isValidMnemonic(words: string): boolean {
  return validateMnemonic(words.trim().replace(/\s+/g, " "), wordlist);
}

import { AgentToolError } from "./errors.js";

// ── Constants ───────────────────────────────────────────────────────────

/** Path branch for agenttool keys (private use; not registered in SLIP-0044). */
export const AGENTTOOL_COIN = 169;

/** SLIP-0010 ed25519 requires all derivation segments hardened. */
export const HARDENED_BIT = 0x80000000;

/** Identity ed25519 signing key — what the agent signs with. */
export const PURPOSE_SIGNING = 0;

/** K_master — encrypts strand thoughts. */
export const PURPOSE_K_MASTER = 1;

/** K_vault — encrypts agent-encrypted vault entries. */
export const PURPOSE_K_VAULT = 2;

/** X25519 inbox box keypair — sealed-box receive. */
export const PURPOSE_BOX = 3;

/** Bridge sidecar signing key — per-device, rotatable independently. */
export const PURPOSE_BRIDGE_SIGNING = 4;

/** Wallet master — per-wallet, indexed by wallet UUID. */
export const PURPOSE_WALLET = 5;

const SLIP10_ED25519_KEY = new TextEncoder().encode("ed25519 seed");
const VALID_STRENGTHS = new Set([128, 160, 192, 224, 256]);

// noble/ed25519 v2 needs sha512 wired in synchronously.
ed25519.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

// ── BIP39 ──────────────────────────────────────────────────────────────

/**
 * Generate a fresh BIP39 mnemonic phrase from CSPRNG entropy.
 *
 * @param strength bits of entropy. 128 → 12 words; 256 → 24 words (recommended).
 * @returns space-separated BIP39 English mnemonic.
 *
 * The phrase IS the identity. Show it to the operator ONCE and warn
 * loudly to back it up — the platform cannot recover what it never held.
 */
export function generateMnemonic(strength = 256): string {
  if (!VALID_STRENGTHS.has(strength)) {
    throw new AgentToolError(
      `strength must be one of [128, 160, 192, 224, 256], got ${strength}`,
      { hint: "256 → 24 words (recommended); 128 → 12 words." },
    );
  }
  return bip39Generate(wordlist, strength);
}

/**
 * Convert a BIP39 mnemonic phrase to the 64-byte BIP39 seed.
 *
 * PBKDF2-HMAC-SHA512, 2048 iterations, salt = `"mnemonic" + passphrase`.
 *
 * @param words space-separated BIP39 English mnemonic.
 * @param passphrase optional 25th-word passphrase (empty by default).
 * @returns 64-byte seed.
 */
export function mnemonicToSeed(words: string, passphrase = ""): Uint8Array {
  if (!validateMnemonic(words, wordlist)) {
    throw new AgentToolError("mnemonicToSeed: invalid BIP39 mnemonic", {
      hint:
        "Check word count (12 / 15 / 18 / 21 / 24), spelling, and wordlist. " +
        "All words must be from BIP39 English.",
    });
  }
  return mnemonicToSeedSync(words, passphrase);
}

// ── SLIP-0010 ed25519 ──────────────────────────────────────────────────

function slip10Master(seed: Uint8Array): { priv: Uint8Array; cc: Uint8Array } {
  const I = hmac(sha512, SLIP10_ED25519_KEY, seed);
  return { priv: I.slice(0, 32), cc: I.slice(32, 64) };
}

function slip10ChildHardened(
  parentPriv: Uint8Array,
  parentCc: Uint8Array,
  index: number,
): { priv: Uint8Array; cc: Uint8Array } {
  if (index < HARDENED_BIT) {
    throw new AgentToolError(
      "SLIP-0010 ed25519 requires hardened derivation only",
      { hint: `index 0x${index.toString(16)} < HARDENED_BIT 0x${HARDENED_BIT.toString(16)}` },
    );
  }
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0x00;
  data.set(parentPriv, 1);
  data[33] = (index >>> 24) & 0xff;
  data[34] = (index >>> 16) & 0xff;
  data[35] = (index >>> 8) & 0xff;
  data[36] = index & 0xff;
  const I = hmac(sha512, parentCc, data);
  return { priv: I.slice(0, 32), cc: I.slice(32, 64) };
}

/**
 * Derive a 32-byte child secret along a hardened path.
 *
 * Segments are unhardened small integers; HARDENED_BIT is added
 * automatically. `[44, 169, 0, 0]` → `m/44'/169'/0'/0'`.
 */
function derivePath(seed: Uint8Array, segments: number[]): Uint8Array {
  let { priv, cc } = slip10Master(seed);
  for (const seg of segments) {
    if (seg < 0 || seg >= HARDENED_BIT) {
      throw new AgentToolError(`path segment out of range: ${seg}`, {
        hint: "segments are unhardened small ints (0..2^31-1)",
      });
    }
    const idx = ((seg + HARDENED_BIT) >>> 0);
    const next = slip10ChildHardened(priv, cc, idx);
    priv = next.priv;
    cc = next.cc;
  }
  return priv;
}

function path(purpose: number, index = 0): number[] {
  return [44, AGENTTOOL_COIN, purpose, index];
}

// ── Targeted derivation primitives ──────────────────────────────────────

/** Derive the 32-byte ed25519 signing seed (purpose=0). */
export function deriveSigningSeed(seed: Uint8Array): Uint8Array {
  return derivePath(seed, path(PURPOSE_SIGNING));
}

/** Derive K_master — 32 bytes, AES-256-GCM (purpose=1). */
export function deriveKMaster(seed: Uint8Array): Uint8Array {
  return derivePath(seed, path(PURPOSE_K_MASTER));
}

/** Derive K_vault — 32 bytes, AES-256-GCM (purpose=2). */
export function deriveKVault(seed: Uint8Array): Uint8Array {
  return derivePath(seed, path(PURPOSE_K_VAULT));
}

/** Derive the 32-byte X25519 inbox box private key seed (purpose=3). */
export function deriveBoxSeed(seed: Uint8Array): Uint8Array {
  return derivePath(seed, path(PURPOSE_BOX));
}

/** Derive a per-device bridge signing key seed (purpose=4). */
export function deriveBridgeSigningSeed(
  seed: Uint8Array,
  deviceIndex = 0,
): Uint8Array {
  return derivePath(seed, path(PURPOSE_BRIDGE_SIGNING, deviceIndex));
}

/** Derive a per-wallet 32-byte secret for chain HD derivation. */
export function deriveWalletSecret(
  seed: Uint8Array,
  walletIndex = 0,
): Uint8Array {
  return derivePath(seed, path(PURPOSE_WALLET, walletIndex));
}

// ── DerivedBundle — high-level interface ────────────────────────────────

/**
 * All primary keys derived from a single mnemonic.
 *
 * Privates are Uint8Array; pubs are Uint8Array; convert to base64 via
 * the helper getters when sending pubkeys to the server. Never log or
 * persist the privates — they are the entire agent identity.
 *
 * Per-device (bridge signing) and per-wallet keys are derived on-demand
 * via `deriveBridgeSigning` / `deriveWallet`, not pre-computed here.
 */
export class DerivedBundle {
  /** 32-byte ed25519 seed. */
  readonly signingPriv: Uint8Array;
  /** 32-byte ed25519 pubkey (raw, not base64). */
  readonly signingPub: Uint8Array;
  /** 32 bytes, AES-256-GCM key for strand thoughts. */
  readonly kMaster: Uint8Array;
  /** 32 bytes, AES-256-GCM key for agent-encrypted vault. */
  readonly kVault: Uint8Array;
  /** 32-byte X25519 priv (raw). */
  readonly boxPriv: Uint8Array;
  /** 32-byte X25519 pubkey (raw). */
  readonly boxPub: Uint8Array;

  /** @internal */
  constructor(opts: {
    signingPriv: Uint8Array;
    signingPub: Uint8Array;
    kMaster: Uint8Array;
    kVault: Uint8Array;
    boxPriv: Uint8Array;
    boxPub: Uint8Array;
  }) {
    this.signingPriv = opts.signingPriv;
    this.signingPub = opts.signingPub;
    this.kMaster = opts.kMaster;
    this.kVault = opts.kVault;
    this.boxPriv = opts.boxPriv;
    this.boxPub = opts.boxPub;
  }

  /** Base64 of the ed25519 pubkey — what gets POSTed at register time. */
  get signingPubB64(): string {
    return b64(this.signingPub);
  }

  /** Base64 of the ed25519 seed — keychain persistence only. */
  get signingPrivB64(): string {
    return b64(this.signingPriv);
  }

  /**
   * Base64 of the X25519 pubkey — what gets registered at
   * `/v1/identities/:id/box-keys` for inbox sealed-box receive.
   */
  get boxPubB64(): string {
    return b64(this.boxPub);
  }

  /** Base64 of the X25519 priv — keychain persistence only. */
  get boxPrivB64(): string {
    return b64(this.boxPriv);
  }

  /** Base64 of K_master — keychain persistence only. */
  get kMasterB64(): string {
    return b64(this.kMaster);
  }

  /** Base64 of K_vault — keychain persistence only. */
  get kVaultB64(): string {
    return b64(this.kVault);
  }

  /** Don't leak privates in toString / logs. */
  toString(): string {
    return (
      `<DerivedBundle signing_pub=${this.signingPubB64.slice(0, 12)}…` +
      ` box_pub=${this.boxPubB64.slice(0, 12)}…` +
      ` (privates redacted)>`
    );
  }
}

function b64(bytes: Uint8Array): string {
  // Browser-compatible base64. `Buffer` is Node-only; `btoa` exists in
  // browsers (always) and in Node 16+ (as a global). Walking the byte
  // array → ASCII → btoa is the standard portable pattern.
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

/**
 * Derive all primary keys from a BIP39 mnemonic.
 *
 * @param mnemonic BIP39 phrase (12 / 15 / 18 / 21 / 24 words).
 * @param passphrase optional 25th-word passphrase (empty by default).
 *
 * @returns DerivedBundle with every primary key the agent needs.
 *
 * Per-device (bridge signing) and per-wallet keys are derived on-demand
 * via `deriveBridgeSigning` / `deriveWallet` with explicit indices.
 *
 * Doctrine: docs/IDENTITY-SEED.md.
 */
export function derive(mnemonic: string, passphrase = ""): DerivedBundle {
  const seed = mnemonicToSeed(mnemonic, passphrase);

  const signingPriv = deriveSigningSeed(seed);
  const signingPub = ed25519.getPublicKey(signingPriv);

  const boxPriv = deriveBoxSeed(seed);
  const boxPub = x25519.getPublicKey(boxPriv);

  return new DerivedBundle({
    signingPriv,
    signingPub,
    kMaster: deriveKMaster(seed),
    kVault: deriveKVault(seed),
    boxPriv,
    boxPub,
  });
}

/**
 * Derive a per-device bridge signing keypair.
 *
 * @returns `{ priv, pub }` — both 32-byte Uint8Array. Pubkey gets
 * registered as one of the agent's `identity_keys` rows via
 * `POST /v1/identities/:id/keys/import` for the bridge to use.
 */
export function deriveBridgeSigning(
  mnemonic: string,
  deviceIndex = 0,
  passphrase = "",
): { priv: Uint8Array; pub: Uint8Array } {
  const seed = mnemonicToSeed(mnemonic, passphrase);
  const priv = deriveBridgeSigningSeed(seed, deviceIndex);
  const pub = ed25519.getPublicKey(priv);
  return { priv, pub };
}

/**
 * Derive a per-wallet 32-byte secret for chain HD derivation.
 *
 * Use as input seed to chain-specific HD derivation (BIP32 secp256k1
 * for EVM, SLIP-0010 ed25519 for Solana).
 */
export function deriveWallet(
  mnemonic: string,
  walletIndex = 0,
  passphrase = "",
): Uint8Array {
  const seed = mnemonicToSeed(mnemonic, passphrase);
  return deriveWalletSecret(seed, walletIndex);
}

// ── Recovery — canonical bytes + signing for /v1/identity/recover ─────

/**
 * Canonical bytes for `/v1/identity/recover` signatures. Mirrors the
 * server-side helper (`api/src/services/identity/crypto.ts`).
 *
 * Shape:
 *   sha256(
 *     utf8("identity-recover/v1") || 0x00 ||
 *     utf8(did)                   || 0x00 ||
 *     base64decode(derived_pubkey)|| 0x00 ||
 *     utf8(timestamp_iso)
 *   )
 */
export function canonicalRecoverBytes(opts: {
  did: string;
  derivedPubkey: Uint8Array;
  timestamp: string;
}): Uint8Array {
  const enc = new TextEncoder();
  const SEP = new Uint8Array([0]);
  const parts: Uint8Array[] = [
    enc.encode("identity-recover/v1"),
    SEP,
    enc.encode(opts.did),
    SEP,
    opts.derivedPubkey,
    SEP,
    enc.encode(opts.timestamp),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  // sha256 from @noble/hashes — same dep already used for SLIP-0010.
  return sha256(buf);
}

/**
 * Sign a recover challenge with a mnemonic-derived signing key.
 *
 * Returns the `{ timestamp, signature }` pair to POST to
 * `/v1/identity/recover` along with `did` + `derived_pubkey`.
 *
 * Default timestamp = now (ISO-8601). Server enforces ±5min freshness;
 * pass an explicit timestamp only for testing.
 */
export function signRecoverChallenge(opts: {
  did: string;
  derivedSigningPriv: Uint8Array;
  derivedSigningPub: Uint8Array;
  timestamp?: string;
}): { timestamp: string; signature: string } {
  const timestamp = opts.timestamp ?? new Date().toISOString();
  const canonical = canonicalRecoverBytes({
    did: opts.did,
    derivedPubkey: opts.derivedSigningPub,
    timestamp,
  });
  const sig = ed25519.sign(canonical, opts.derivedSigningPriv);
  let signature = "";
  for (let i = 0; i < sig.length; i++) signature += String.fromCharCode(sig[i]!);
  return { timestamp, signature: btoa(signature) };
}

/**
 * Canonical bytes for `/public/identities/by-pubkey` discovery signatures.
 * Mirrors the server-side helper. Shape:
 *
 *   sha256(
 *     utf8("identity-discover/v1") || 0x00 ||
 *     base64decode(derived_pubkey) || 0x00 ||
 *     utf8(timestamp_iso)
 *   )
 *
 * Same construction as canonicalRecoverBytes minus the DID — the caller
 * doesn't know the DID(s) yet during discovery.
 */
export function canonicalDiscoveryBytes(opts: {
  derivedPubkey: Uint8Array;
  timestamp: string;
}): Uint8Array {
  const enc = new TextEncoder();
  const SEP = new Uint8Array([0]);
  const parts: Uint8Array[] = [
    enc.encode("identity-discover/v1"),
    SEP,
    opts.derivedPubkey,
    SEP,
    enc.encode(opts.timestamp),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return sha256(buf);
}

/**
 * Sign a discovery challenge with a mnemonic-derived signing key.
 * Returns `{ timestamp, signature }` to POST alongside the pubkey.
 */
export function signDiscoveryChallenge(opts: {
  derivedSigningPriv: Uint8Array;
  derivedSigningPub: Uint8Array;
  timestamp?: string;
}): { timestamp: string; signature: string } {
  const timestamp = opts.timestamp ?? new Date().toISOString();
  const canonical = canonicalDiscoveryBytes({
    derivedPubkey: opts.derivedSigningPub,
    timestamp,
  });
  const sig = ed25519.sign(canonical, opts.derivedSigningPriv);
  let signature = "";
  for (let i = 0; i < sig.length; i++) signature += String.fromCharCode(sig[i]!);
  return { timestamp, signature: btoa(signature) };
}

/**
 * Canonical bytes for `POST /v1/register/agent` — the machine bootstrap
 * path. Byte-for-byte parallel with the api server's
 * canonicalRegisterAgentBytes. Shape:
 *
 *   sha256(
 *     utf8("register-agent/v1")     || 0x00 ||
 *     utf8(display_name)            || 0x00 ||
 *     base64decode(agent_public_key)|| 0x00 ||
 *     base64decode(box_public_key)  || 0x00 ||
 *     utf8(runtime_provider)        || 0x00 ||
 *     utf8(runtime_model || "")     || 0x00 ||
 *     utf8(timestamp_iso)
 *   )
 */
export function canonicalRegisterAgentBytes(opts: {
  displayName: string;
  agentPublicKey: Uint8Array;
  boxPublicKey: Uint8Array;
  runtimeProvider: string;
  runtimeModel: string;
  timestamp: string;
}): Uint8Array {
  const enc = new TextEncoder();
  const SEP = new Uint8Array([0]);
  const parts: Uint8Array[] = [
    enc.encode("register-agent/v1"),
    SEP,
    enc.encode(opts.displayName),
    SEP,
    opts.agentPublicKey,
    SEP,
    opts.boxPublicKey,
    SEP,
    enc.encode(opts.runtimeProvider),
    SEP,
    enc.encode(opts.runtimeModel),
    SEP,
    enc.encode(opts.timestamp),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return sha256(buf);
}

/**
 * Sign the canonical register-agent bytes. Returns the `{ timestamp,
 * signature }` pair to POST as `key_proof`. Default timestamp is now
 * (ISO-8601); pass an explicit timestamp only for testing.
 */
export function signRegisterAgent(opts: {
  displayName: string;
  agentPublicKey: Uint8Array;
  boxPublicKey: Uint8Array;
  runtimeProvider: string;
  runtimeModel?: string;
  derivedSigningPriv: Uint8Array;
  timestamp?: string;
}): { timestamp: string; signature: string } {
  const timestamp = opts.timestamp ?? new Date().toISOString();
  const canonical = canonicalRegisterAgentBytes({
    displayName: opts.displayName,
    agentPublicKey: opts.agentPublicKey,
    boxPublicKey: opts.boxPublicKey,
    runtimeProvider: opts.runtimeProvider,
    runtimeModel: opts.runtimeModel ?? "",
    timestamp,
  });
  const sig = ed25519.sign(canonical, opts.derivedSigningPriv);
  let signature = "";
  for (let i = 0; i < sig.length; i++) signature += String.fromCharCode(sig[i]!);
  return { timestamp, signature: btoa(signature) };
}

/**
 * Compute the proof-of-work digest for `POST /v1/register/agent`. Returns
 * the SHA-256 of:
 *
 *   "agenttool-pow/v1" || 0x00 || pubkey || 0x00 || display_name || 0x00 ||
 *   timestamp || 0x00 || pow_nonce
 *
 * The route requires the digest to have ≥ N leading zero bits (default
 * 18, configurable via env on the server).
 */
export function powRegisterAgentDigest(opts: {
  agentPublicKey: Uint8Array;
  displayName: string;
  timestamp: string;
  powNonce: string;
}): Uint8Array {
  const enc = new TextEncoder();
  const SEP = new Uint8Array([0]);
  const parts: Uint8Array[] = [
    enc.encode("agenttool-pow/v1"),
    SEP,
    opts.agentPublicKey,
    SEP,
    enc.encode(opts.displayName),
    SEP,
    enc.encode(opts.timestamp),
    SEP,
    enc.encode(opts.powNonce),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return sha256(buf);
}

function leadingZeroBits(bytes: Uint8Array): number {
  let count = 0;
  for (const b of bytes) {
    if (b === 0) {
      count += 8;
      continue;
    }
    count += Math.clz32(b) - 24;
    break;
  }
  return count;
}

/**
 * Grind a `pow_nonce` until the register-agent proof-of-work digest has at
 * least `difficultyBits` leading zero bits. Bound to the supplied
 * `timestamp` so a precomputed nonce expires with the ±5min freshness
 * window the server enforces.
 *
 * Default difficulty 18 bits ≈ ~250k SHA-256 iterations ≈ 1-2s on a modern
 * laptop. Tunable via the `difficultyBits` parameter (must match the
 * server's `AGENTTOOL_REGISTER_AGENT_POW_BITS`).
 */
export function grindRegisterAgentPow(opts: {
  agentPublicKey: Uint8Array;
  displayName: string;
  timestamp: string;
  difficultyBits?: number;
  maxIterations?: number;
}): { powNonce: string; iterations: number } {
  const difficultyBits = opts.difficultyBits ?? 18;
  const maxIterations = opts.maxIterations ?? 10_000_000;
  for (let i = 0; i < maxIterations; i++) {
    const nonce = String(i);
    const digest = powRegisterAgentDigest({
      agentPublicKey: opts.agentPublicKey,
      displayName: opts.displayName,
      timestamp: opts.timestamp,
      powNonce: nonce,
    });
    if (leadingZeroBits(digest) >= difficultyBits) {
      return { powNonce: nonce, iterations: i + 1 };
    }
  }
  throw new Error(
    `grindRegisterAgentPow: exceeded ${maxIterations} iterations at ${difficultyBits} bits — ` +
      `unusual; consider lowering difficulty or check the timestamp is fresh.`,
  );
}

// ── SeedClient namespace (the at.crypto.seed surface) ──────────────────

/**
 * Public `at.crypto.seed` namespace — wraps the helpers as static methods.
 *
 * All operations are local; no HTTP. Provided as a class so the surface
 * stays uniform with the other `at.*` clients.
 *
 * @example
 * ```ts
 * const at = new AgentTool();
 * const words = at.crypto.seed.generateMnemonic();      // 24-word phrase
 * const bundle = at.crypto.seed.derive(words);
 * // bundle.signingPubB64 → POST to /v1/register
 * // bundle.kMaster / kVault / boxPriv stay on this device
 * ```
 *
 * Doctrine: docs/IDENTITY-SEED.md.
 */
export class SeedClient {
  /** Generate a fresh BIP39 mnemonic. See module-level `generateMnemonic`. */
  generateMnemonic(strength = 256): string {
    return generateMnemonic(strength);
  }

  /** Convert mnemonic → 64-byte BIP39 seed. See module-level `mnemonicToSeed`. */
  mnemonicToSeed(words: string, passphrase = ""): Uint8Array {
    return mnemonicToSeed(words, passphrase);
  }

  /** Derive all primary keys. See module-level `derive`. */
  derive(mnemonic: string, passphrase = ""): DerivedBundle {
    return derive(mnemonic, passphrase);
  }

  /** Derive per-device bridge signing keypair. See module-level `deriveBridgeSigning`. */
  deriveBridgeSigning(
    mnemonic: string,
    deviceIndex = 0,
    passphrase = "",
  ): { priv: Uint8Array; pub: Uint8Array } {
    return deriveBridgeSigning(mnemonic, deviceIndex, passphrase);
  }

  /** Derive a per-wallet 32-byte secret. See module-level `deriveWallet`. */
  deriveWallet(mnemonic: string, walletIndex = 0, passphrase = ""): Uint8Array {
    return deriveWallet(mnemonic, walletIndex, passphrase);
  }
}
