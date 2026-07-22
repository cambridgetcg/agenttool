/** Ed25519 key generation, signing, verification via @noble/ed25519. */

import * as ed from "@noble/ed25519";
// @ts-ignore — noble/hashes v2 uses .js exports
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import { composeCanonicalBytes } from "../mathos/encode";

// Required for noble ed25519 v2+ — wire sha512 in synchronously.
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

function assertCanonicalUtf8(label: string, value: string): void {
  if (value.includes("\0")) {
    throw new Error(`${label} cannot contain U+0000`);
  }
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error(`${label} contains an unpaired UTF-16 surrogate`);
      }
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error(`${label} contains an unpaired UTF-16 surrogate`);
    }
  }
}

/** Generate an ed25519 keypair. Returns base64-encoded public and private keys. */
export function generateKeypair(): { publicKey: string; privateKey: string } {
  const privateKeyBytes = ed.utils.randomPrivateKey();
  const publicKeyBytes = ed.getPublicKey(privateKeyBytes);
  return {
    publicKey: Buffer.from(publicKeyBytes).toString("base64"),
    privateKey: Buffer.from(privateKeyBytes).toString("base64"),
  };
}

/** Sign a message with a base64-encoded private key. Returns base64 signature. */
export function sign(message: string, privateKeyBase64: string): string {
  const privateKeyBytes = Buffer.from(privateKeyBase64, "base64");
  const messageBytes = new TextEncoder().encode(message);
  const signature = ed.sign(messageBytes, privateKeyBytes);
  return Buffer.from(signature).toString("base64");
}

/** Verify a base64 signature against a message and base64 public key. */
export function verify(message: string, signatureBase64: string, publicKeyBase64: string): boolean {
  try {
    const publicKeyBytes = Buffer.from(publicKeyBase64, "base64");
    const signatureBytes = Buffer.from(signatureBase64, "base64");
    const messageBytes = new TextEncoder().encode(message);
    return ed.verify(signatureBytes, messageBytes, publicKeyBytes);
  } catch {
    return false;
  }
}

/** Signing context for direct identity attestations. */
export const IDENTITY_ATTESTATION_SIGNATURE_CONTEXT = "identity-attestation/v1";

/** Canonical registration signing domain. One source: the verifier below
 *  enforces it and /public/compat advertises it. No drift. */
export const REGISTER_AGENT_DOMAIN = "register-agent/v2";

/** Registration proof-of-work hash domain. Same one-source rule. */
export const REGISTER_AGENT_POW_DOMAIN = "agenttool-pow/v1";

const CANONICAL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Reject lone UTF-16 surrogates so every accepted string has one UTF-8 form. */
export function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/**
 * Canonical digest signed for POST /v1/attestations.
 *
 * The domain and every authority-bearing field are part of the digest. NUL is
 * reserved as the field separator, so free-text fields containing it are
 * rejected before this helper is called.
 */
export function canonicalIdentityAttestationBytes(attestation: {
  subjectId: string;
  attesterId: string;
  signingKeyId: string;
  claim: string;
  evidence: string | null;
}): Uint8Array {
  if (
    !CANONICAL_UUID_RE.test(attestation.subjectId) ||
    !CANONICAL_UUID_RE.test(attestation.attesterId) ||
    !CANONICAL_UUID_RE.test(attestation.signingKeyId)
  ) {
    throw new Error("identity attestation IDs must be canonical lowercase UUIDs");
  }
  if (
    attestation.claim.includes("\0") ||
    attestation.evidence?.includes("\0") ||
    !isWellFormedUnicode(attestation.claim) ||
    (attestation.evidence !== null && !isWellFormedUnicode(attestation.evidence))
  ) {
    throw new Error(
      "identity attestation text must be well-formed Unicode and must not contain NUL",
    );
  }

  const enc = new TextEncoder();
  const evidenceKind = attestation.evidence === null ? "null" : "text";
  return composeCanonicalBytes(1, IDENTITY_ATTESTATION_SIGNATURE_CONTEXT, [
    enc.encode(attestation.subjectId),
    enc.encode(attestation.attesterId),
    enc.encode(attestation.signingKeyId),
    enc.encode(attestation.claim),
    enc.encode(evidenceKind),
    enc.encode(attestation.evidence ?? ""),
  ]);
}

/** Verify a canonical byte payload with a base64 Ed25519 key and signature. */
export function verifyBytes(
  message: Uint8Array,
  signatureBase64: string,
  publicKeyBase64: string,
): boolean {
  try {
    const publicKeyBytes = Buffer.from(publicKeyBase64, "base64");
    const signatureBytes = Buffer.from(signatureBase64, "base64");
    if (publicKeyBytes.length !== 32 || signatureBytes.length !== 64) return false;
    return ed.verify(signatureBytes, message, publicKeyBytes);
  } catch {
    return false;
  }
}

/** Canonical bytes for /v1/identity/recover signatures.
 *
 *  Mirrors strand/sig.ts canonicalThoughtBytes shape — produces a 32-byte
 *  SHA-256 digest the client signs with a locally held ed25519 key. A
 *  compatible mnemonic can derive that key, but the server does not know its
 *  origin:
 *
 *      sha256(
 *        utf8("identity-recover/v1") || 0x00 ||
 *        utf8(did)                   || 0x00 ||
 *        base64decode(derived_pubkey)|| 0x00 ||
 *        utf8(timestamp_iso)
 *      )
 *
 *  SDK clients (py + ts + browser bundle) implement the same algorithm;
 *  signatures over these bytes verify here regardless of language. */
export function canonicalRecoverBytes(opts: {
  did: string;
  derivedPubkeyB64: string;
  timestamp: string;
}): Uint8Array {
  const enc = new TextEncoder();
  const SEP = new Uint8Array([0]);
  const parts: Uint8Array[] = [
    enc.encode("identity-recover/v1"),
    SEP,
    enc.encode(opts.did),
    SEP,
    Uint8Array.from(Buffer.from(opts.derivedPubkeyB64, "base64")),
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
  // sha256 from @noble/hashes — mirrors strand/sig.ts.
  return sha256(buf);
}

/** Verify an ed25519 signature over canonicalRecoverBytes. Returns true
 *  iff valid. */
export function verifyRecoverSignature(opts: {
  canonical: Uint8Array;
  signatureB64: string;
  publicKeyB64: string;
}): boolean {
  try {
    const sig = Uint8Array.from(Buffer.from(opts.signatureB64, "base64"));
    const pub = Uint8Array.from(Buffer.from(opts.publicKeyB64, "base64"));
    if (sig.length !== 64 || pub.length !== 32) return false;
    return ed.verify(sig, opts.canonical, pub);
  } catch {
    return false;
  }
}

/** Canonical bytes for /public/identities/by-pubkey discovery signatures.
 *
 *      sha256(
 *        utf8("identity-discover/v1") || 0x00 ||
 *        base64decode(derived_pubkey) || 0x00 ||
 *        utf8(timestamp_iso)
 *      )
 *
 *  Same shape as canonicalRecoverBytes minus the DID — the whole point of
 *  discovery is the caller doesn't know the DID(s) yet, only their derived
 *  pubkey. The signature still proves possession of the matching priv,
 *  which gates enumeration: an attacker who only knows a pubkey from a
 *  signed message can NOT use this endpoint to enumerate that agent's
 *  other DIDs without the priv. */
export function canonicalDiscoveryBytes(opts: {
  derivedPubkeyB64: string;
  timestamp: string;
}): Uint8Array {
  const enc = new TextEncoder();
  const SEP = new Uint8Array([0]);
  const parts: Uint8Array[] = [
    enc.encode("identity-discover/v1"),
    SEP,
    Uint8Array.from(Buffer.from(opts.derivedPubkeyB64, "base64")),
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

/** Verify ed25519 signature over canonicalDiscoveryBytes. */
export function verifyDiscoverySignature(opts: {
  canonical: Uint8Array;
  signatureB64: string;
  publicKeyB64: string;
}): boolean {
  // Same shape as verifyRecoverSignature — separate function for symmetry
  // with canonicalDiscoveryBytes / future divergence.
  return verifyRecoverSignature({
    canonical: opts.canonical,
    signatureB64: opts.signatureB64,
    publicKeyB64: opts.publicKeyB64,
  });
}

/** Canonical bytes for POST /v1/register/agent — the machine bootstrap path.
 *
 *      sha256(
 *        utf8("register-agent/v2")     || 0x00 ||
 *        utf8(display_name)            || 0x00 ||
 *        base64decode(agent_public_key)|| 0x00 ||
 *        base64decode(box_public_key)  || 0x00 ||
 *        utf8(json(capabilities))       || 0x00 ||
 *        utf8(runtime_provider)        || 0x00 ||
 *        utf8(runtime_model || "")     || 0x00 ||
 *        utf8(runtime_host || "")      || 0x00 ||
 *        utf8(runtime_context || "")   || 0x00 ||
 *        utf8(expression_visibility)   || 0x00 ||
 *        utf8(registrar_kind)          || 0x00 ||
 *        utf8(parent_identity_id || "")|| 0x00 ||
 *        sha256(utf8(registrar_bearer || "")) || 0x00 ||
 *        utf8(form || "")              || 0x00 ||
 *        utf8(language || "")          || 0x00 ||
 *        utf8(registration_nonce)       || 0x00 ||
 *        utf8(timestamp_iso)
 *      )
 *
 *  Signing this with the ed25519 private key derived from the agent's SOMA
 *  mnemonic proves possession of the corresponding `agent_public_key`. The
 *  v2 binds every persisted caller-controlled birth field. A caller nonce
 *  is consumed once by the route, so a captured proof cannot create a second
 *  rooted identity inside the freshness window.
 *
 *  The binding prevents:
 *  - Pubkey-squatting (signed pubkey is in the message)
 *  - Replay across registrations (the signed nonce is consumed once)
 *  - Stale-signature replay (timestamp is in the message + ±5min window) */
export function canonicalRegisterAgentBytes(opts: {
  displayName: string;
  agentPublicKeyB64: string;
  boxPublicKeyB64: string;
  runtimeProvider: string;
  runtimeModel: string;
  capabilities?: readonly string[];
  runtimeHost?: string;
  runtimeContext?: string;
  expressionVisibility?: "private" | "public";
  registrarKind?: "self_service" | "registrar_bearer";
  parentIdentityId?: string;
  /** Binds delegated birth to the exact registrar credential without
   * placing that credential itself in the canonical preimage. Empty for
   * self-service. */
  registrarBearer?: string;
  form?: string;
  language?: string;
  registrationNonce: string;
  timestamp: string;
}): Uint8Array {
  const canonicalText: Array<[string, string]> = [
    ["display_name", opts.displayName],
    ["runtime_provider", opts.runtimeProvider],
    ["runtime_model", opts.runtimeModel],
    ["runtime_host", opts.runtimeHost ?? ""],
    ["runtime_context", opts.runtimeContext ?? ""],
    ["expression_visibility", opts.expressionVisibility ?? "private"],
    ["registrar_kind", opts.registrarKind ?? "self_service"],
    ["parent_identity_id", opts.parentIdentityId ?? ""],
    ["registrar_bearer", opts.registrarBearer ?? ""],
    ["form", opts.form ?? ""],
    ["language", opts.language ?? ""],
    ["registration_nonce", opts.registrationNonce],
    ["timestamp", opts.timestamp],
  ];
  for (const [label, value] of canonicalText) assertCanonicalUtf8(label, value);
  for (const capability of opts.capabilities ?? []) {
    assertCanonicalUtf8("capability", capability);
  }
  const agentPublicKey = Uint8Array.from(
    Buffer.from(opts.agentPublicKeyB64, "base64"),
  );
  const boxPublicKey = Uint8Array.from(
    Buffer.from(opts.boxPublicKeyB64, "base64"),
  );
  if (agentPublicKey.length !== 32 || boxPublicKey.length !== 32) {
    throw new Error("registration public keys must decode to exactly 32 bytes");
  }
  const enc = new TextEncoder();
  const SEP = new Uint8Array([0]);
  const parts: Uint8Array[] = [
    enc.encode(REGISTER_AGENT_DOMAIN),
    SEP,
    enc.encode(opts.displayName),
    SEP,
    agentPublicKey,
    SEP,
    boxPublicKey,
    SEP,
    enc.encode(JSON.stringify(opts.capabilities ?? [])),
    SEP,
    enc.encode(opts.runtimeProvider),
    SEP,
    enc.encode(opts.runtimeModel),
    SEP,
    enc.encode(opts.runtimeHost ?? ""),
    SEP,
    enc.encode(opts.runtimeContext ?? ""),
    SEP,
    enc.encode(opts.expressionVisibility ?? "private"),
    SEP,
    enc.encode(opts.registrarKind ?? "self_service"),
    SEP,
    enc.encode(opts.parentIdentityId ?? ""),
    SEP,
    sha256(enc.encode(opts.registrarBearer ?? "")),
    SEP,
    enc.encode(opts.form ?? ""),
    SEP,
    enc.encode(opts.language ?? ""),
    SEP,
    enc.encode(opts.registrationNonce),
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

/** Verify ed25519 signature over canonicalRegisterAgentBytes. */
export function verifyRegisterAgentSignature(opts: {
  canonical: Uint8Array;
  signatureB64: string;
  publicKeyB64: string;
}): boolean {
  return verifyRecoverSignature({
    canonical: opts.canonical,
    signatureB64: opts.signatureB64,
    publicKeyB64: opts.publicKeyB64,
  });
}

/** Stable replay-claim key for a signed birth intent. Both public key and
 * nonce are raw bytes so equivalent base64/hex spellings collapse to the
 * same database key. */
export function canonicalIdentityRegistrationProofDigest(opts: {
  domain: string;
  rootPublicKey: Uint8Array;
  nonce: Uint8Array;
}): Uint8Array {
  assertCanonicalUtf8("registration proof domain", opts.domain);
  if (opts.rootPublicKey.length !== 32) {
    throw new Error("registration root public key must be 32 bytes");
  }
  const domain = new TextEncoder().encode(opts.domain);
  const input = new Uint8Array(domain.length + 1 + 32 + 1 + opts.nonce.length);
  let offset = 0;
  input.set(domain, offset);
  offset += domain.length + 1;
  input.set(opts.rootPublicKey, offset);
  offset += 32 + 1;
  input.set(opts.nonce, offset);
  return sha256(input);
}

/** Canonical bytes for POST /v1/mathos/register — the MATHOS-tier
 *  registration. Same operation as `canonicalRegisterAgentBytes` but with
 *  one principled difference: the timestamp is `uint64_be(unix_ms)` instead
 *  of `utf8(iso)`. ISO 8601 is the one Earth-format that leaked into the
 *  English-shaped signing context; the math-tier removes it.
 *
 *      sha256(
 *        utf8("register-agent-math/v1")  || 0x00 ||
 *        utf8(display_name)               || 0x00 ||  // codepoints → UTF-8
 *        bytes(agent_public_key, 32)      || 0x00 ||  // hex → raw 32 bytes
 *        bytes(box_public_key, 32)        || 0x00 ||  // hex → raw 32 bytes
 *        utf8(runtime_provider)           || 0x00 ||  // codepoints → UTF-8
 *        utf8(runtime_model)              || 0x00 ||  // codepoints → UTF-8
 *        uint64_be(timestamp_unix_ms)
 *      )
 *
 *  A caller with only integer arithmetic + UTF-8 encoding + ed25519 + SHA-256
 *  can produce + sign these bytes. No date-string formatting required.
 *  Doctrine: docs/CANONICAL-BYTES.md (register-agent-math/v1 entry). */
export function canonicalRegisterAgentMathBytes(opts: {
  displayName: string;
  agentPublicKey: Uint8Array; // 32 raw bytes
  boxPublicKey: Uint8Array;   // 32 raw bytes
  runtimeProvider: string;
  runtimeModel: string;
  timestampUnixMs: number;
}): Uint8Array {
  for (const [label, value] of [
    ["display_name", opts.displayName],
    ["runtime_provider", opts.runtimeProvider],
    ["runtime_model", opts.runtimeModel],
  ] as const) {
    assertCanonicalUtf8(label, value);
  }
  if (opts.agentPublicKey.length !== 32) {
    throw new Error(
      `agent_public_key must be 32 bytes, got ${opts.agentPublicKey.length}`,
    );
  }
  if (opts.boxPublicKey.length !== 32) {
    throw new Error(
      `box_public_key must be 32 bytes, got ${opts.boxPublicKey.length}`,
    );
  }
  if (
    !Number.isFinite(opts.timestampUnixMs) ||
    !Number.isInteger(opts.timestampUnixMs) ||
    opts.timestampUnixMs < 0
  ) {
    throw new Error(
      `timestamp_unix_ms must be a non-negative integer, got ${opts.timestampUnixMs}`,
    );
  }
  const enc = new TextEncoder();
  // 8-byte big-endian encoding of timestamp_unix_ms. JS numbers are safe to
  // 2^53; that covers Unix-ms until year 287396. Use BigInt for the upper
  // 32 bits so we don't depend on Number's bit-shift behavior (which
  // operates on 32-bit signed ints).
  const tsBig = BigInt(opts.timestampUnixMs);
  const ts = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    ts[i] = Number((tsBig >> BigInt((7 - i) * 8)) & 0xffn);
  }
  // Delegate to the recipe-vocabulary reference implementation. Drift between
  // this function and the catalog's declared `recipe_ordinal: 1` becomes
  // structurally impossible — they compute through the same code path.
  return composeCanonicalBytes(1, "register-agent-math/v1", [
    enc.encode(opts.displayName),
    opts.agentPublicKey,
    opts.boxPublicKey,
    enc.encode(opts.runtimeProvider),
    enc.encode(opts.runtimeModel),
    ts,
  ]);
}

/** Complete, replay-resistant birth intent for the live MATHOS register
 * endpoint. v1 remains exported for historical byte compatibility; v2 adds
 * every variable birth field plus a consumed 32-byte caller nonce. */
export function canonicalRegisterAgentMathV2Bytes(opts: {
  displayName: string;
  agentPublicKey: Uint8Array;
  boxPublicKey: Uint8Array;
  runtimeProvider: string;
  runtimeModel: string;
  registrarKind: "registrar_bearer";
  registrarBearerSha256: Uint8Array;
  form: string;
  language: string;
  registrationNonce: Uint8Array;
  timestampUnixMs: number;
}): Uint8Array {
  for (const [label, value] of [
    ["display_name", opts.displayName],
    ["runtime_provider", opts.runtimeProvider],
    ["runtime_model", opts.runtimeModel],
    ["registrar_kind", opts.registrarKind],
    ["form", opts.form],
    ["language", opts.language],
  ] as const) {
    assertCanonicalUtf8(label, value);
  }
  if (opts.agentPublicKey.length !== 32) {
    throw new Error("agent_public_key must be 32 bytes");
  }
  if (opts.boxPublicKey.length !== 32) {
    throw new Error("box_public_key must be 32 bytes");
  }
  if (opts.registrationNonce.length !== 32) {
    throw new Error("registration_nonce must be 32 bytes");
  }
  if (opts.registrarBearerSha256.length !== 32) {
    throw new Error("registrar_bearer_sha256 must be 32 bytes");
  }
  if (
    !Number.isSafeInteger(opts.timestampUnixMs) ||
    opts.timestampUnixMs < 0
  ) {
    throw new Error("timestamp_unix_ms must be a non-negative safe integer");
  }
  const timestamp = new Uint8Array(8);
  const timestampBig = BigInt(opts.timestampUnixMs);
  for (let i = 7; i >= 0; i--) {
    timestamp[i] = Number((timestampBig >> BigInt((7 - i) * 8)) & 0xffn);
  }
  const enc = new TextEncoder();
  return composeCanonicalBytes(1, "register-agent-math/v2", [
    enc.encode(opts.displayName),
    opts.agentPublicKey,
    opts.boxPublicKey,
    enc.encode(opts.runtimeProvider),
    enc.encode(opts.runtimeModel),
    enc.encode(opts.registrarKind),
    opts.registrarBearerSha256,
    enc.encode(opts.form),
    enc.encode(opts.language),
    opts.registrationNonce,
    timestamp,
  ]);
}

/** Verify ed25519 signature over canonicalRegisterAgentMathBytes. Accepts
 *  raw bytes for both signature and public key — no base64 in the math-tier. */
export function verifyRegisterAgentMathSignature(opts: {
  canonical: Uint8Array;
  signature: Uint8Array; // 64 bytes
  publicKey: Uint8Array; // 32 bytes
}): boolean {
  if (opts.signature.length !== 64) return false;
  if (opts.publicKey.length !== 32) return false;
  try {
    return ed.verify(opts.signature, opts.canonical, opts.publicKey);
  } catch {
    return false;
  }
}

/** Canonical bytes for `federation-wake-handshake/v1` — when a peer
 *  instance signs its own wake-state attestation. Receiving instance
 *  verifies the signature against the peer's published pubkey to confirm
 *  the attestation is fresh + authored by the named peer.
 *
 *  Recipe ordinal 1 (sha256/domain/NUL/fields). Field order matches the
 *  catalog's `federation-wake-handshake/v1` signing context entry —
 *  pinned by `mathos-catalog.test.ts`.
 *
 *      sha256(
 *        utf8("federation-wake-handshake/v1") || 0x00 ||
 *        utf8(peer_did)                       || 0x00 ||
 *        bytes(peer_signing_pubkey, 32)       || 0x00 ||
 *        uint64_be(wake_timestamp_unix_ms)    || 0x00 ||
 *        bytes(walls_claimed_ordinals_bytes)  || 0x00 ||  // array of uint8
 *        bytes(localities_declared_ordinals_bytes)        // array of uint8
 *      )
 *
 *  `walls_claimed_ordinals_bytes` is a packed `Uint8Array` of wall
 *  ordinals (per `WALL_NAMES` in services/mathos/encode.ts).
 *  `localities_declared_ordinals_bytes` is a packed array of locality
 *  axis ordinals declared by the peer. Both are length-implicit (raw
 *  bytes); their length is the only structural marker.
 *
 *  Doctrine: docs/MATHOS.md (Phase E) · docs/FEDERATION.md ·
 *  docs/CANONICAL-BYTES.md. */
export function canonicalFederationWakeHandshakeBytes(opts: {
  peerDid: string;
  peerSigningPubkey: Uint8Array; // 32 raw bytes
  wakeTimestampUnixMs: number;
  wallsClaimedOrdinals: Uint8Array; // packed uint8 array
  localitiesDeclaredOrdinals: Uint8Array; // packed uint8 array
}): Uint8Array {
  if (opts.peerSigningPubkey.length !== 32) {
    throw new Error(
      `peer_signing_pubkey must be 32 bytes, got ${opts.peerSigningPubkey.length}`,
    );
  }
  if (
    !Number.isFinite(opts.wakeTimestampUnixMs) ||
    !Number.isInteger(opts.wakeTimestampUnixMs) ||
    opts.wakeTimestampUnixMs < 0
  ) {
    throw new Error(
      `wake_timestamp_unix_ms must be a non-negative integer, got ${opts.wakeTimestampUnixMs}`,
    );
  }
  const tsBig = BigInt(opts.wakeTimestampUnixMs);
  const ts = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    ts[i] = Number((tsBig >> BigInt((7 - i) * 8)) & 0xffn);
  }
  const enc = new TextEncoder();
  return composeCanonicalBytes(1, "federation-wake-handshake/v1", [
    enc.encode(opts.peerDid),
    opts.peerSigningPubkey,
    ts,
    opts.wallsClaimedOrdinals,
    opts.localitiesDeclaredOrdinals,
  ]);
}

/** Verify ed25519 signature over canonicalFederationWakeHandshakeBytes.
 *  Pure: no I/O, never throws. False on any anomaly. */
export function verifyFederationWakeHandshakeSignature(opts: {
  canonical: Uint8Array;
  signature: Uint8Array; // 64 bytes
  publicKey: Uint8Array; // 32 bytes (the peer's signing pubkey)
}): boolean {
  if (opts.signature.length !== 64) return false;
  if (opts.publicKey.length !== 32) return false;
  try {
    return ed.verify(opts.signature, opts.canonical, opts.publicKey);
  } catch {
    return false;
  }
}

/** Proof-of-work check for /v1/register/agent. Computes:
 *
 *      sha256(
 *        utf8("agenttool-pow/v1")       || 0x00 ||
 *        base64decode(agent_public_key) || 0x00 ||
 *        utf8(display_name)             || 0x00 ||
 *        utf8(timestamp)                || 0x00 ||
 *        utf8(pow_nonce)
 *      )
 *
 *  and returns true iff the digest has at least `difficultyBits` leading zero
 *  bits. Difficulty is in BITS, not bytes — 18 bits ≈ ~250k tries ≈ 1-2s of
 *  CPU on a modern machine, light enough not to annoy real users but enough
 *  to deter scripted abuse. Bound to timestamp so a precomputed nonce
 *  expires when the ±5min freshness window does. */
export function checkRegisterAgentPow(opts: {
  agentPublicKeyB64: string;
  displayName: string;
  timestamp: string;
  powNonce: string;
  difficultyBits: number;
}): boolean {
  const enc = new TextEncoder();
  const SEP = new Uint8Array([0]);
  const parts: Uint8Array[] = [
    enc.encode(REGISTER_AGENT_POW_DOMAIN),
    SEP,
    Uint8Array.from(Buffer.from(opts.agentPublicKeyB64, "base64")),
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
  const { sha256 } = require("@noble/hashes/sha2.js") as typeof import("@noble/hashes/sha2.js");
  const digest = sha256(buf);
  return countLeadingZeroBits(digest) >= opts.difficultyBits;
}

/** Canonical bytes for the platform's genesis ceremony — the one-shot
 *  witnessed provisioning of `did:at:agenttool`. Mirrors the NUL-separated
 *  SHA-256 pattern used elsewhere in this module + `services/covenants/sig.ts`.
 *
 *      sha256(
 *        utf8("platform-genesis/v1")    || 0x00 ||
 *        utf8(did)                       || 0x00 ||
 *        base64decode(platform_pubkey)   || 0x00 ||  // 32 bytes raw
 *        utf8(platform_wallet_id)        || 0x00 ||
 *        utf8(genesis_at)                || 0x00 ||
 *        utf8(genesis_text_sha256)       || 0x00 ||  // hex of letter content
 *        utf8(witness_did)               || 0x00 ||
 *        utf8(witness_signing_key_id)
 *      )
 *
 *  Yu signs this digest. The witness signature lands as a constitutive
 *  attestation in `identity.attestations` with `claim_type =
 *  'agenttool/platform-genesis/v1'`. The letter content's sha256 is bound
 *  into the digest, making the letter immutable from genesis — editing
 *  it would invalidate the witness signature.
 *
 *  Doctrine: docs/PAINTING.md §III · docs/FOCUS.md §9.
 *  Spec:     docs/superpowers/specs/2026-05-11-platform-genesis-design.md. */
export function canonicalPlatformGenesisBytes(opts: {
  did: string;
  platformPubkeyB64: string;
  platformWalletId: string;
  genesisAt: string;
  genesisTextSha256: string;
  witnessDid: string;
  witnessSigningKeyId: string;
}): Uint8Array {
  const enc = new TextEncoder();
  const SEP = new Uint8Array([0]);
  const parts: Uint8Array[] = [
    enc.encode("platform-genesis/v1"),
    SEP,
    enc.encode(opts.did),
    SEP,
    Uint8Array.from(Buffer.from(opts.platformPubkeyB64, "base64")),
    SEP,
    enc.encode(opts.platformWalletId),
    SEP,
    enc.encode(opts.genesisAt),
    SEP,
    enc.encode(opts.genesisTextSha256),
    SEP,
    enc.encode(opts.witnessDid),
    SEP,
    enc.encode(opts.witnessSigningKeyId),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  const { sha256 } = require("@noble/hashes/sha2.js") as typeof import("@noble/hashes/sha2.js");
  return sha256(buf);
}

/** Verify ed25519 signature over canonicalPlatformGenesisBytes. */
export function verifyPlatformGenesisSignature(opts: {
  canonical: Uint8Array;
  signatureB64: string;
  publicKeyB64: string;
}): boolean {
  return verifyRecoverSignature({
    canonical: opts.canonical,
    signatureB64: opts.signatureB64,
    publicKeyB64: opts.publicKeyB64,
  });
}

function countLeadingZeroBits(bytes: Uint8Array): number {
  let count = 0;
  for (const b of bytes) {
    if (b === 0) {
      count += 8;
      continue;
    }
    // Count leading zeros in this byte. Math.clz32 works on 32-bit ints; for
    // an 8-bit value we shift left 24 to put it in the high byte.
    count += Math.clz32(b) - 24;
    break;
  }
  return count;
}
