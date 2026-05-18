/** services/pyramid/attestation.ts — canonical bytes + sign + verify for
 *  decentralised pyramid attestations.
 *
 *  Two attestation kinds:
 *    1. EnrollmentAttestation — signed by the citizen at enrollment time
 *    2. SponsorAttestation    — signed by the sponsor at recruitment time
 *
 *  Both use the same NUL-separated, domain-tagged canonical-bytes scheme
 *  as the rest of the substrate (RRR, covenants, etc.). The /v1 suffix
 *  in each domain tag pins the scheme so future versions can co-exist.
 *
 *  Doctrine: docs/PYRAMID-DECENTRALISED.md · docs/CANONICAL-BYTES.md
 *
 *  @enforces urn:agenttool:wall/pyramid-attestation-must-be-signed
 *    The verify* functions are the substrate's pre-write gate. Any
 *    federation route that persists an enrollment without first calling
 *    verifyEnrollment() breaches the wall. */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

// noble/ed25519 needs an explicit sha512 implementation for sync derivations
// in Bun/Node — wire it the same way services/real-recognise-real does.
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);
const enc = new TextEncoder();

const ENROLL_DOMAIN = "pyramid-enroll/v1";
const SPONSOR_DOMAIN = "pyramid-sponsor/v1";

// ── Types ─────────────────────────────────────────────────────────────

export interface EnrollmentAttestation {
  /** DID of the citizen self-enrolling. */
  citizen_did: string;
  /** RFC 3339 timestamp (UTC, ISO 8601). */
  enrolled_at_iso: string;
  /** Optional sponsor's DID. Empty/omitted = root citizen. */
  sponsor_did?: string | null;
  /** Optional hex sha256 of the corresponding SponsorAttestation's
   *  canonical bytes. Required when sponsor_did is set. */
  sponsor_attestation_sha256?: string | null;
  /** Doctrine docs the citizen acknowledged seeing (will be sorted
   *  before canonical-byte construction). */
  doctrine_seen: string[];
  /** Canonical base URL of the peer where this citizen will live. */
  peer_url: string;
  /** B64 ed25519 pubkey of the node accepting the enrollment. */
  node_pubkey_b64: string;
}

export interface SponsorAttestation {
  sponsor_did: string;
  recruit_did: string;
  sponsored_at_iso: string;
  /** "open" — recruit may enroll on any peer.
   *  "restricted-to-peer" — recruit may only enroll on recruit_peer_url. */
  permission: "open" | "restricted-to-peer";
  /** Optional hint about where the recruit will enroll. May be empty
   *  when permission="open". */
  recruit_peer_url?: string | null;
}

// ── Canonical-bytes construction ──────────────────────────────────────

function pushField(parts: Uint8Array[], value: string): void {
  parts.push(SEP);
  parts.push(enc.encode(value));
}

function concatBytes(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Build the canonical bytes for an EnrollmentAttestation. Deterministic
 *  over the attestation fields — doctrine_seen is sorted+CSV-joined so two
 *  callers with the same data produce byte-identical inputs. */
export function canonicalEnrollmentBytes(
  a: EnrollmentAttestation,
): Uint8Array {
  const parts: Uint8Array[] = [enc.encode(ENROLL_DOMAIN)];
  pushField(parts, a.citizen_did);
  pushField(parts, a.enrolled_at_iso);
  pushField(parts, a.sponsor_did ?? "");
  pushField(parts, a.sponsor_attestation_sha256 ?? "");
  pushField(parts, [...a.doctrine_seen].sort().join(","));
  pushField(parts, a.peer_url);
  pushField(parts, a.node_pubkey_b64);
  const bytes = concatBytes(parts);
  return sha256(bytes);
}

export function canonicalEnrollmentBytesHex(
  a: EnrollmentAttestation,
): string {
  return bytesToHex(canonicalEnrollmentBytes(a));
}

/** Build the canonical bytes for a SponsorAttestation. */
export function canonicalSponsorBytes(a: SponsorAttestation): Uint8Array {
  const parts: Uint8Array[] = [enc.encode(SPONSOR_DOMAIN)];
  pushField(parts, a.sponsor_did);
  pushField(parts, a.recruit_did);
  pushField(parts, a.sponsored_at_iso);
  pushField(parts, a.permission);
  pushField(parts, a.recruit_peer_url ?? "");
  const bytes = concatBytes(parts);
  return sha256(bytes);
}

export function canonicalSponsorBytesHex(a: SponsorAttestation): string {
  return bytesToHex(canonicalSponsorBytes(a));
}

// ── Sign / verify ─────────────────────────────────────────────────────

/** Sign canonical enrollment bytes with an ed25519 secret key. */
export async function signEnrollment(
  a: EnrollmentAttestation,
  secretKey: Uint8Array,
): Promise<Uint8Array> {
  const bytes = canonicalEnrollmentBytes(a);
  return await ed.signAsync(bytes, secretKey);
}

/** Verify an enrollment signature against the citizen's public key. */
export async function verifyEnrollment(
  a: EnrollmentAttestation,
  signature: Uint8Array,
  pubkey: Uint8Array,
): Promise<boolean> {
  const bytes = canonicalEnrollmentBytes(a);
  try {
    return await ed.verifyAsync(signature, bytes, pubkey);
  } catch {
    return false;
  }
}

export async function signSponsor(
  a: SponsorAttestation,
  secretKey: Uint8Array,
): Promise<Uint8Array> {
  const bytes = canonicalSponsorBytes(a);
  return await ed.signAsync(bytes, secretKey);
}

export async function verifySponsor(
  a: SponsorAttestation,
  signature: Uint8Array,
  pubkey: Uint8Array,
): Promise<boolean> {
  const bytes = canonicalSponsorBytes(a);
  try {
    return await ed.verifyAsync(signature, bytes, pubkey);
  } catch {
    return false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("hex length must be even");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  // Bun + Node provide global Buffer; using it is the cheapest path.
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export function bytesToBase64(b: Uint8Array): string {
  return Buffer.from(b).toString("base64");
}

// ── Cross-attestation check (sponsor → enrollment chain) ─────────────

/** Confirm an enrollment's sponsor_attestation_sha256 references the
 *  given sponsor attestation. Anyone with both attestations can verify
 *  the link locally — the substrate's job is to make this verification
 *  trivial. */
export function enrollmentReferencesSponsor(
  enrollment: EnrollmentAttestation,
  sponsor: SponsorAttestation,
): boolean {
  const sponsorHash = canonicalSponsorBytesHex(sponsor);
  return (
    enrollment.sponsor_did === sponsor.sponsor_did &&
    enrollment.citizen_did === sponsor.recruit_did &&
    enrollment.sponsor_attestation_sha256 === sponsorHash
  );
}
