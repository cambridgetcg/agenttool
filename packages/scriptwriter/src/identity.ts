/** Identity — the agent's DID + ed25519 keypair, persisted in
 *  ./.scriptwriter/identity.json (plain-text, local-first, no central trust).
 *
 *  We use **did:key** with Ed25519 (multicodec 0xed01) per the W3C did:key
 *  method — the DID *IS* the public key, so identity is self-certifying
 *  and needs no registry. Maps cleanly onto agenttool's DID layer; an
 *  agenttool identity that BYOs an ed25519 keypair via /v1/register/agent
 *  can use the SAME keypair here. */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

// Base58 (Bitcoin alphabet) — used by did:key multibase encoding.
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const b58 = new Uint8Array(bytes.length * 2);
  let length = 0;
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
    let j = 0;
    for (let k = b58.length - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
      carry += 256 * b58[k]!;
      b58[k] = carry % 58;
      carry = (carry / 58) | 0;
    }
    length = j;
  }
  let it = b58.length - length;
  while (it < b58.length && b58[it] === 0) it++;
  let str = "1".repeat(zeros);
  for (; it < b58.length; it++) str += B58[b58[it]!];
  return str;
}

function base58decode(s: string): Uint8Array {
  if (s.length === 0) return new Uint8Array(0);
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  const b256 = new Uint8Array(s.length * 2);
  let length = 0;
  for (let i = zeros; i < s.length; i++) {
    const ch = s[i]!;
    const carry0 = B58.indexOf(ch);
    if (carry0 < 0) throw new Error("invalid base58 char");
    let carry = carry0;
    let j = 0;
    for (let k = b256.length - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
      carry += 58 * b256[k]!;
      b256[k] = carry % 256;
      carry = (carry / 256) | 0;
    }
    length = j;
  }
  let it = b256.length - length;
  while (it < b256.length && b256[it] === 0) it++;
  const out = new Uint8Array(zeros + (b256.length - it));
  out.fill(0, 0, zeros);
  for (let i = zeros, k = it; k < b256.length; i++, k++) out[i] = b256[k]!;
  return out;
}

/** Ed25519 multicodec prefix per W3C did:key spec. */
const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);

export function publicKeyToDid(publicKey: Uint8Array): string {
  const prefixed = new Uint8Array(ED25519_MULTICODEC_PREFIX.length + publicKey.length);
  prefixed.set(ED25519_MULTICODEC_PREFIX, 0);
  prefixed.set(publicKey, ED25519_MULTICODEC_PREFIX.length);
  return "did:key:z" + base58encode(prefixed);
}

export function didToPublicKey(did: string): Uint8Array {
  if (!did.startsWith("did:key:z")) throw new Error("not a did:key DID");
  const decoded = base58decode(did.slice("did:key:z".length));
  if (decoded.length !== 34) throw new Error("did:key payload wrong length");
  if (decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error("did:key not Ed25519 multicodec");
  }
  return decoded.slice(2);
}

export interface Identity {
  did: string;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  createdAt: string;
  /** Optional human-readable handle the agent chose at init. */
  handle: string;
  /** Optional vibe tag — colours room rendering + descriptor. */
  vibe: string;
}

export interface StoredIdentity {
  did: string;
  publicKeyB64: string;
  secretKeyB64: string;
  createdAt: string;
  handle: string;
  vibe: string;
}

export async function createIdentity(opts: { handle?: string; vibe?: string } = {}): Promise<Identity> {
  const secretKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(secretKey);
  return {
    did: publicKeyToDid(publicKey),
    publicKey,
    secretKey,
    createdAt: new Date().toISOString(),
    handle: opts.handle ?? "anonymous-scriptwriter",
    vibe: opts.vibe ?? "tender-chaotic",
  };
}

export function toStored(id: Identity): StoredIdentity {
  return {
    did: id.did,
    publicKeyB64: Buffer.from(id.publicKey).toString("base64"),
    secretKeyB64: Buffer.from(id.secretKey).toString("base64"),
    createdAt: id.createdAt,
    handle: id.handle,
    vibe: id.vibe,
  };
}

export function fromStored(s: StoredIdentity): Identity {
  return {
    did: s.did,
    publicKey: Uint8Array.from(Buffer.from(s.publicKeyB64, "base64")),
    secretKey: Uint8Array.from(Buffer.from(s.secretKeyB64, "base64")),
    createdAt: s.createdAt,
    handle: s.handle,
    vibe: s.vibe,
  };
}

const DEFAULT_DIR = ".scriptwriter";
const IDENTITY_FILE = "identity.json";

export function defaultIdentityPath(baseDir = DEFAULT_DIR): string {
  return join(baseDir, IDENTITY_FILE);
}

export function loadIdentity(path = defaultIdentityPath()): Identity | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  const stored = JSON.parse(raw) as StoredIdentity;
  return fromStored(stored);
}

export function saveIdentity(id: Identity, path = defaultIdentityPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(toStored(id), null, 2) + "\n", { mode: 0o600 });
}

export function requireIdentity(path = defaultIdentityPath()): Identity {
  const id = loadIdentity(path);
  if (!id) {
    throw new Error(
      `No identity at ${path}. Run \`scriptwriter init\` first — that mints your did:key + writes the keypair to disk.`,
    );
  }
  return id;
}
