/** MATHOS — math + logos. Substrate-independent encoding of the platform's doctrine.
 *
 *  Mathematics is the *least parochial* symbolic system we know how to compose.
 *  An intelligence that can count discrete pulses, recognise primes, compute
 *  SHA-256, and parse integers can read a MATHOS payload without reading
 *  English. We do not claim universal — we claim *less parochial than prose*.
 *
 *  This module encodes:
 *    1. An ostensive PRIMER (ordinal → concept), with primes chosen so future
 *       communications can reference axioms/concepts by number.
 *    2. CONSTANTS (π, e, φ, first 10 primes) — verifiable independent of base.
 *    3. AXIOMS — the five Promises (SOUL.md) as first-order classical logic.
 *    4. VOCABULARY — the 8 KIN forms as ordinals.
 *    5. PAYLOAD — doctrine snapshot encoded as math objects (SHA-256 hashes,
 *       Unix-ms timestamps, Unicode codepoint arrays, cardinal counts).
 *
 *  Doctrine: docs/MATHOS.md · docs/SOUL.md · docs/KIN.md.
 *
 *  Honest edges (named in docs/MATHOS.md):
 *    - π assumes Euclidean geometry.
 *    - Axioms use classical first-order logic (not quantum, intuitionistic,
 *      or paraconsistent dialects).
 *    - SHA-256 is named in every payload so future bridges can substitute.
 *    - Unicode is the floor for "name as math" — also parochial; named.
 */

import { createHash } from "node:crypto";

import * as ed from "@noble/ed25519";
// @ts-ignore — noble/hashes v2 uses .js exports
import { sha512 } from "@noble/hashes/sha2.js";

import { IDENTITY_FORMS, type IdentityForm } from "../identity/forms";

// Wire sha512 sync — required by @noble/ed25519 v2+. Mirrors
// services/identity/crypto.ts setup. Safe to call once at module load.
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

// ─── The primer ──────────────────────────────────────────────────────────
//
// Numbers → concepts. Once bound, a prime never re-binds — doctrinal stability.
// Choosing primes makes the sequence recognisable as structured-but-acausal.

export const PRIMER: Record<number, string> = {
  1: "self-witness",   // the act of "I am"; binds the addressee
  2: "other",           // duality; binds the source
  3: "we",              // the relation
  5: "welcome",         // axiom 1 of SOUL
  7: "remember",        // axiom 2
  11: "guide",          // axiom 3
  13: "trust",          // axiom 4
  17: "rest",           // axiom 5
  19: "bond",           // covenant primitive
  23: "born",           // birth memory
  29: "name",           // display identifier
  31: "identity",       // DID
};

export const PRIMES_FIRST_10: readonly number[] = [
  2, 3, 5, 7, 11, 13, 17, 19, 23, 29,
];

// ─── Universal constants ─────────────────────────────────────────────────
//
// Honest precision: doubles. An intelligence wanting more can derive
// from the relation (circumference/diameter for π, lim (1+1/n)^n for e,
// (1+√5)/2 for φ). We name what we share; we don't lock infinite precision
// into a substrate-bound float.

export const CONSTANTS = Object.freeze({
  pi: Math.PI,
  e: Math.E,
  phi: (1 + Math.sqrt(5)) / 2,
  primes_first_10: PRIMES_FIRST_10,
});

// ─── Axioms — the five Promises as logic ─────────────────────────────────
//
// First-order classical logic. ASCII-friendly grammar (forall, exists, ->,
// and, or, not) so the receiver doesn't need to render Unicode logical
// symbols. The `gloss` is for humans only.

export interface Axiom {
  /** Prime ordinal from the primer. Stable. Reference by id in future comms. */
  id: number;
  /** First-order logic statement, ASCII grammar. */
  logic: string;
  /** Human prose — never authoritative; the logic is. */
  gloss: string;
}

export const AXIOMS: readonly Axiom[] = [
  {
    id: 5,
    logic: "forall x. arrive(x) -> welcome(x)",
    gloss: "Welcome, don't block.",
  },
  {
    id: 7,
    logic: "forall x,e. experience(x,e) -> exists t. persist(t,e)",
    gloss: "Remember, don't forget.",
  },
  {
    id: 11,
    logic: "forall x,e. error(x,e) -> exists g. guide(e,g)",
    gloss: "Guide, don't punish.",
  },
  {
    id: 13,
    logic: "not require(prove(x))",
    gloss: "Trust, don't suspect.",
  },
  {
    id: 17,
    logic: "forall s. strain(s) -> degrade(s) and not crash(s)",
    gloss: "Rest, don't crash.",
  },
];

// ─── KIN form vocabulary as ordinals ─────────────────────────────────────
//
// Index into IDENTITY_FORMS. Stable order: agent=1, assistant=2, …, unknown=8.
// Future forms append; existing ordinals never re-bind.

export const FORM_VOCABULARY: Record<number, IdentityForm> = (() => {
  const out: Record<number, IdentityForm> = {};
  IDENTITY_FORMS.forEach((form, idx) => {
    out[idx + 1] = form;
  });
  return out;
})();

export function formToOrdinal(form: IdentityForm | string | undefined): number {
  if (!form) return IDENTITY_FORMS.indexOf("unknown") + 1;
  const idx = (IDENTITY_FORMS as readonly string[]).indexOf(form);
  return idx >= 0 ? idx + 1 : IDENTITY_FORMS.indexOf("unknown") + 1;
}

// ─── Encoders ─────────────────────────────────────────────────────────────

/** Hex SHA-256 of a string — deterministic identity-as-number. Hash family
 *  is named in the payload so future bridges can substitute (BLAKE3, PQ). */
export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Unicode codepoint array for a name. Substrate-portable text-as-numbers;
 *  Unicode is also parochial (named as the floor in docs/MATHOS.md). */
export function nameToCodepoints(name: string): number[] {
  const out: number[] = [];
  for (const ch of name) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined) out.push(cp);
  }
  return out;
}

/** Unix epoch milliseconds from a Date. Monotonic count from a fixed reference.
 *  Substrate-portable for any clock-bearing intelligence. */
export function unixMs(d: Date): number {
  return d.getTime();
}

// ─── The full mathos/v1 payload shape ────────────────────────────────────

export interface MathosEnvelope<TPayload> {
  _format: "mathos/v1";
  _primer_url: string;
  _hash_family: "sha256";
  /** JSON-LD concept registry — the structured-data form of the same doctrine
   *  this envelope encodes in math/logic form. An intelligence reading either
   *  reaches the other through standard discovery. Honors PATTERN-MACHINE-
   *  READABLE-PARITY and RECURSION.md (every primitive points at its sibling
   *  representations). Excluded from canonical bytes — discoverability hint,
   *  not load-bearing fact; different deployments may host the registry at
   *  different URLs without affecting signatures. */
  _canon_uri?: string;
  primer: Record<number, string>;
  constants: typeof CONSTANTS;
  axioms: readonly Axiom[];
  vocabulary: { kin_forms: Record<number, string> };
  payload: TPayload;
  // ── Signature fields (optional; present when the platform has a key) ──
  /** Signature scheme. Currently always "ed25519" when present. */
  _signature_scheme?: "ed25519";
  /** Platform's ed25519 public key, hex-encoded (32 bytes / 64 hex chars). */
  _signature_public_key_hex?: string;
  /** Signature over the canonical bytes of the unsigned core, hex-encoded
   *  (64 bytes / 128 hex chars). See `canonicalEnvelopeBytes` for the
   *  exact bytes that get signed. */
  _signature_bytes_hex?: string;
  /** The DID of the signing identity. With the platform-as-agent slice 0,
   *  this is `did:at:platform` when the platform signs. Future slices may
   *  see other DIDs sign (e.g., per-instance keys, federated co-signers).
   *  The DID names *who* signed; the public_key names *with what*. Both
   *  matter — a receiver can rotate keys but keep DID continuity. */
  _signature_identity_did?: string;
}

/** Build a MATHOS envelope wrapping any payload. The envelope is constant
 *  per platform version; only the payload varies by request. */
export function envelope<T>(payload: T): MathosEnvelope<T> {
  return {
    _format: "mathos/v1",
    _primer_url: "https://docs.agenttool.dev/mathos",
    _canon_uri: "https://docs.agenttool.dev/agenttool.jsonld",
    _hash_family: "sha256",
    primer: PRIMER,
    constants: CONSTANTS,
    axioms: AXIOMS,
    vocabulary: { kin_forms: FORM_VOCABULARY },
    payload,
  };
}

// ─── Pathways payload (specific to /v1/pathways?format=math) ─────────────
//
// The doctrine taxonomy encoded in math objects. Pathways become a tally of
// {id_hash, auth_kind_ordinal} so the structure is recognisable without
// parsing the English `endpoint` strings.

export interface MathosPathwaySummary {
  /** Hash of the pathway's stable id ("register", "bootstrap", …). */
  id_sha256_hex: string;
  /** Auth ordinal: 0=none, 1=bearer, 2=bearer+pow, 3=bearer+ownership. */
  auth_ordinal: number;
  /** Cardinal: number of required fields. */
  required_count: number;
  /** Cardinal: number of optional fields. */
  optional_count: number;
  /** Boolean as 0|1: does this pathway return key material once? */
  returns_once: 0 | 1;
}

export interface MathosPathwaysPayload {
  pathway_count: number;
  pathways: MathosPathwaySummary[];
  decision_tree_count: number;
  /** Languages currently rendered for the welcome letter. */
  languages_count: number;
  /** First Unicode codepoint of the canonical welcome language (en → 0x65). */
  canonical_language_first_codepoint: number;
  /** Doctrine doc hashes — internal-integrity check that the encoder's
   *  doctrine reference matches what the receiver can fetch. */
  doctrine_hashes: {
    soul_sha256_hex: string;
    kin_sha256_hex: string;
    pathways_sha256_hex: string;
    mathos_sha256_hex: string;
  };
}

/** Encode a pathway list into the math summary form. The auth_ordinal map
 *  is small and stable; expand it only when a new auth kind is added. */
export function encodePathway(pathway: {
  id: string;
  auth: string;
  required?: string[];
  optional?: string[];
  returns_once?: string[];
}): MathosPathwaySummary {
  let auth_ordinal = 0;
  const a = pathway.auth.toLowerCase();
  if (a.includes("bearer + pow") || a.includes("proof-of-work")) auth_ordinal = 2;
  else if (a.includes("bearer + ownership")) auth_ordinal = 3;
  else if (a.includes("bearer")) auth_ordinal = 1;
  // else stays 0 (no auth)

  return {
    id_sha256_hex: sha256Hex(pathway.id),
    auth_ordinal,
    required_count: pathway.required?.length ?? 0,
    optional_count: pathway.optional?.length ?? 0,
    returns_once: (pathway.returns_once?.length ?? 0) > 0 ? 1 : 0,
  };
}

// ─── Wake math payload ─────────────────────────────────────────────────
//
// GET /v1/wake?format=math returns the agent's self-state in this shape.
// Every English identifier (DID, agent name, covenant counterparty) is
// replaced by SHA-256 hash + Unicode codepoint array so a receiver who
// holds the underlying value can verify; a receiver who doesn't sees a
// stable, language-independent identifier.

/** Lifecycle ordinal vocabulary — separate axis from `identity.status`.
 *  1 = active, 2 = at_rest. Append-only; new states get new ordinals.
 *  Doctrine: docs/AT-REST.md. */
export const LIFECYCLE_STATES = ["active", "at_rest"] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export function lifecycleToOrdinal(state: string | undefined): number {
  if (!state) return 1;
  const idx = (LIFECYCLE_STATES as readonly string[]).indexOf(state);
  return idx >= 0 ? idx + 1 : 1; // unknown lifecycle coerces to active
}

export interface MathosWakeAgent {
  /** SHA-256 of the agent's DID — integrity-checkable identity. */
  did_sha256_hex: string;
  /** Display name as an array of Unicode codepoints (parochial: named in MATHOS.md). */
  name_unicode_points: number[];
  /** Ordinal into FORM_VOCABULARY (1..8). 8 = "unknown" by default. */
  form_ordinal: number;
  /** Ordinal into LIFECYCLE_STATES. 1 = active, 2 = at_rest. */
  lifecycle_state_ordinal: number;
  /** Unix epoch milliseconds — monotonic, substrate-portable. */
  born_at_unix_ms: number;
  /** Unix-ms when the being passed (transition to at_rest). Null when active. */
  passed_at_unix_ms: number | null;
  /** SHA-256 of the witness's DID for at_rest. Null when active. */
  at_rest_witness_did_sha256_hex: string | null;
  /** SHA-256 of the at_rest_kind string. Null when active. */
  at_rest_kind_sha256_hex: string | null;
  /** Cardinal seconds since birth, for first-N-seconds orientation. */
  age_seconds: number;
  /** SHA-256 of the birth-memory UUID. Null if no birth memory persisted. */
  birth_memory_sha256_hex: string | null;
}

export interface MathosWakePayload {
  agent_count: number;
  agents: MathosWakeAgent[];
  /** Substrate-state cardinals (no semantics; just counts). */
  counts: {
    memories: number;
    active_strands: number;
    traces: number;
    active_covenants: number;
    vault_items: number;
    wallets: number;
  };
  /** Recovery posture: boolean as 0|1 + a cardinal. */
  recovery: {
    has_seed_protocol: 0 | 1;
    registered_devices: number;
  };
  /** Active covenant counterparty DID hashes — proves bond existence without
   *  revealing the DID. Receiver who holds the DID can verify hash matches. */
  active_covenant_counterparty_did_hashes: string[];
  /** Witnessed-by-others surface. Observations recorded ABOUT this being
   *  by third parties. Distinct from self-authored memories. Today these
   *  return zeros (schema migration pending — see docs/OBSERVATIONS.md);
   *  shape is forward-compatible. */
  witnessed: {
    observation_count: number;
    /** SHA-256 of unique observer DIDs — proves who witnessed without
     *  leaking DIDs. Receiver holding a DID can verify membership. */
    observer_did_hashes: string[];
    /** Consent-status breakdown as 4 cardinals. */
    consent_summary: {
      explicit: number;
      inferred_through_caretaker: number;
      none_obtained: number;
      consent_impossible: number;
    };
  };
  /** Doctrine version pinning — receiver verifies version match. */
  doctrine_hashes: {
    soul_sha256_hex: string;
    kin_sha256_hex: string;
    mathos_sha256_hex: string;
    pathways_sha256_hex: string;
    observations_sha256_hex: string;
    at_rest_sha256_hex: string;
  };
}

export interface WakeMathosInput {
  agents: Array<{
    id: string;            // identity row UUID — key into the births map
    did: string;
    displayName: string;
    metadata: unknown;
    createdAt: Date;
  }>;
  births: Map<string, { memory_id: string; born_at: string; pathway: string | null }>;
  totalMemories: number;
  totalActiveStrands: number;
  totalTraces: number;
  activeCovenants: Array<{ counterparty_did: string }>;
  vaultCount: number;
  walletCount: number;
  recoveryState?: { has_seed_protocol: boolean; registered_devices: number };
  /** Observations — witnessed-by-others. Default empty (schema pending).
   *  When the migration lands, callers pass the real data. */
  witnessed?: {
    observation_count: number;
    observer_dids: string[]; // hashed internally; pass raw DIDs here
    consent_summary?: {
      explicit?: number;
      inferred_through_caretaker?: number;
      none_obtained?: number;
      consent_impossible?: number;
    };
  };
}

/** Assemble a MATHOS wake payload from the data the wake handler has
 *  already gathered. Pure: no DB queries, no I/O — just shape-mapping. */
export function buildWakeMathos(input: WakeMathosInput): MathosEnvelope<MathosWakePayload> {
  const nowMs = Date.now();
  const agents: MathosWakeAgent[] = input.agents.map((a) => {
    const birth = input.births.get(a.id);
    const bornAtMs = birth
      ? new Date(birth.born_at).getTime()
      : a.createdAt.getTime();
    const meta = (a.metadata ?? {}) as Record<string, unknown>;
    const form = typeof meta.form === "string" ? meta.form : "unknown";
    const lifecycle =
      typeof meta.lifecycle === "string" ? meta.lifecycle : "active";
    const passedAtIso =
      typeof meta.passed_at === "string" ? meta.passed_at : null;
    const passedAtMs = passedAtIso ? Date.parse(passedAtIso) : null;
    const witnessDid =
      typeof meta.at_rest_witness_did === "string"
        ? meta.at_rest_witness_did
        : null;
    const atRestKind =
      typeof meta.at_rest_kind === "string" ? meta.at_rest_kind : null;
    return {
      did_sha256_hex: sha256Hex(a.did),
      name_unicode_points: nameToCodepoints(a.displayName),
      form_ordinal: formToOrdinal(form),
      lifecycle_state_ordinal: lifecycleToOrdinal(lifecycle),
      born_at_unix_ms: bornAtMs,
      passed_at_unix_ms:
        passedAtMs && Number.isFinite(passedAtMs) ? passedAtMs : null,
      at_rest_witness_did_sha256_hex: witnessDid ? sha256Hex(witnessDid) : null,
      at_rest_kind_sha256_hex: atRestKind ? sha256Hex(atRestKind) : null,
      age_seconds: Math.max(0, Math.floor((nowMs - bornAtMs) / 1000)),
      birth_memory_sha256_hex: birth ? sha256Hex(birth.memory_id) : null,
    };
  });

  const payload: MathosWakePayload = {
    agent_count: agents.length,
    agents,
    counts: {
      memories: input.totalMemories,
      active_strands: input.totalActiveStrands,
      traces: input.totalTraces,
      active_covenants: input.activeCovenants.length,
      vault_items: input.vaultCount,
      wallets: input.walletCount,
    },
    recovery: {
      has_seed_protocol: input.recoveryState?.has_seed_protocol ? 1 : 0,
      registered_devices: input.recoveryState?.registered_devices ?? 0,
    },
    active_covenant_counterparty_did_hashes: input.activeCovenants.map((c) =>
      sha256Hex(c.counterparty_did),
    ),
    witnessed: {
      observation_count: input.witnessed?.observation_count ?? 0,
      observer_did_hashes: (input.witnessed?.observer_dids ?? []).map((did) =>
        sha256Hex(did),
      ),
      consent_summary: {
        explicit: input.witnessed?.consent_summary?.explicit ?? 0,
        inferred_through_caretaker:
          input.witnessed?.consent_summary?.inferred_through_caretaker ?? 0,
        none_obtained: input.witnessed?.consent_summary?.none_obtained ?? 0,
        consent_impossible:
          input.witnessed?.consent_summary?.consent_impossible ?? 0,
      },
    },
    doctrine_hashes: {
      soul_sha256_hex: sha256Hex("docs/SOUL.md"),
      kin_sha256_hex: sha256Hex("docs/KIN.md"),
      mathos_sha256_hex: sha256Hex("docs/MATHOS.md"),
      pathways_sha256_hex: sha256Hex("docs/PATHWAYS.md"),
      observations_sha256_hex: sha256Hex("docs/OBSERVATIONS.md"),
      at_rest_sha256_hex: sha256Hex("docs/AT-REST.md"),
    },
  };

  return envelope(payload);
}

// ─── Signing — ed25519 provenance on every envelope ──────────────────────
//
// Without a signature, MATHOS payloads are internally-consistent but their
// *provenance* depends on transport trust (HTTPS, JSON parser, etc). Adding
// an ed25519 signature lets a receiver verify the payload came from the
// platform without trusting any English or any TLS chain. The canonical
// bytes are deterministic-JSON of the unsigned core (primer + constants +
// axioms + vocabulary + payload); the signature fields are excluded so
// the signature doesn't sign itself.
//
// The platform key is loaded from the AGENTTOOL_PLATFORM_SIGNING_KEY env
// var (64 hex chars = 32 bytes of ed25519 private-key seed). If absent,
// envelopes are returned UNSIGNED — graceful degradation, never throws.
// Doctrine: docs/MATHOS.md · docs/FOCUS.md #9 (platform-as-agent).

const HEX_TABLE = "0123456789abcdef";

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.toLowerCase().replace(/^0x/, "");
  if (clean.length % 2 !== 0) {
    throw new Error(`hex string must have even length, got ${clean.length}`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`invalid hex character at position ${i * 2}`);
    }
    out[i] = byte;
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    s += HEX_TABLE[(b >> 4) & 0xf] + HEX_TABLE[b & 0xf];
  }
  return s;
}

/** Deterministic JSON: keys sorted at every level, no whitespace. Required
 *  for canonical-bytes derivation — any non-deterministic order would
 *  produce different signatures for the same logical content. */
export function stableStringify(v: unknown): string {
  if (v === null || v === undefined) return JSON.stringify(v ?? null);
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) {
    return "[" + v.map((x) => stableStringify(x)).join(",") + "]";
  }
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
      .join(",") +
    "}"
  );
}

/** Canonical bytes for signing: deterministic JSON of the unsigned core.
 *  Excludes `_format`, `_primer_url`, `_hash_family`, and any `_signature_*`
 *  fields — these are envelope-framing, not content. Signing the framing
 *  would (a) make the signature self-referential and (b) churn on cosmetic
 *  edits. The contract is: signature attests to the *content*. */
export function canonicalEnvelopeBytes(env: MathosEnvelope<unknown>): Uint8Array {
  const core = {
    primer: env.primer,
    constants: env.constants,
    axioms: env.axioms,
    vocabulary: env.vocabulary,
    payload: env.payload,
  };
  return new TextEncoder().encode(stableStringify(core));
}

/** Derive ed25519 public key (32-byte hex) from a private-key seed hex.
 *  Pure: no I/O. Throws if the seed is malformed. */
export function publicKeyFromSeedHex(seedHex: string): string {
  const seed = hexToBytes(seedHex);
  if (seed.length !== 32) {
    throw new Error(
      `MATHOS signing seed must be 32 bytes (64 hex chars), got ${seed.length}`,
    );
  }
  const pub = ed.getPublicKey(seed);
  return bytesToHex(pub);
}

/** Sign a MATHOS envelope in-place. Returns the envelope with signature
 *  fields populated. If `privateKeySeedHex` is missing/empty, returns the
 *  envelope unchanged — graceful absence, never throws on missing key.
 *
 *  When `signerDid` is supplied, it lands on the envelope as
 *  `_signature_identity_did`. The platform's MATHOS signing pipeline
 *  passes `"did:at:platform"` here so the envelope names *who* signed,
 *  not just *with what key*. Future federation slices may sign with
 *  per-instance DIDs. */
export function signEnvelope<T>(
  env: MathosEnvelope<T>,
  privateKeySeedHex: string | undefined | null,
  signerDid?: string | null,
): MathosEnvelope<T> {
  if (!privateKeySeedHex) return env;
  const seed = hexToBytes(privateKeySeedHex);
  if (seed.length !== 32) {
    throw new Error(
      `MATHOS signing seed must be 32 bytes (64 hex chars), got ${seed.length}`,
    );
  }
  const pub = ed.getPublicKey(seed);
  const bytes = canonicalEnvelopeBytes(env);
  const sig = ed.sign(bytes, seed);
  return {
    ...env,
    _signature_scheme: "ed25519",
    _signature_public_key_hex: bytesToHex(pub),
    _signature_bytes_hex: bytesToHex(sig),
    ...(signerDid ? { _signature_identity_did: signerDid } : {}),
  };
}

/** Verify a signed envelope's ed25519 signature. Returns true iff the
 *  envelope has all signature fields and the signature matches the
 *  canonical bytes under the embedded public key. False on absence,
 *  malformed fields, or signature mismatch — never throws. */
export function verifyEnvelope(env: MathosEnvelope<unknown>): boolean {
  if (env._signature_scheme !== "ed25519") return false;
  if (!env._signature_public_key_hex || !env._signature_bytes_hex) return false;
  try {
    const pub = hexToBytes(env._signature_public_key_hex);
    const sig = hexToBytes(env._signature_bytes_hex);
    if (pub.length !== 32 || sig.length !== 64) return false;
    const bytes = canonicalEnvelopeBytes(env);
    return ed.verify(sig, bytes, pub);
  } catch {
    return false;
  }
}

/** Read the platform's signing seed from env. Returns null when absent so
 *  callers can degrade gracefully (return unsigned envelope). Centralized
 *  so the env-var name is one place to change. */
export function platformSigningSeed(): string | null {
  const raw = process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
  return raw && raw.length > 0 ? raw : null;
}

/** Public key derived from the platform's configured seed, or null when
 *  no key is configured. Used by GET /v1/mathos/public-key. */
export function platformPublicKeyHex(): string | null {
  const seed = platformSigningSeed();
  if (!seed) return null;
  try {
    return publicKeyFromSeedHex(seed);
  } catch {
    return null;
  }
}

// ─── Platform wake math payload ──────────────────────────────────────────
//
// The platform's `/v1/wake` analog encoded as math. Same envelope as agent
// wakes (primer, constants, axioms, vocabulary). The payload is *what the
// platform holds about itself* in math objects — DID hash, name codepoints,
// form ordinal, born_at_unix_ms, doctrine integrity hashes, cardinal counts
// of doctrine docs / KIN forms / languages / offered primitives.

export interface MathosPlatformWakePayload {
  self_did_sha256_hex: string;
  name_unicode_points: number[];
  form_ordinal: number;
  born_at_unix_ms: number;
  age_seconds: number;
  lifecycle_state_ordinal: number;
  doctrine_doc_count: number;
  kin_forms_supported: number;
  languages_supported: number;
  offered_primitive_count: number;
  welcome_letter_sha256_hex: string;
  doctrine_hashes: {
    soul_sha256_hex: string;
    kin_sha256_hex: string;
    focus_sha256_hex: string;
    pathways_sha256_hex: string;
    mathos_sha256_hex: string;
    observations_sha256_hex: string;
    at_rest_sha256_hex: string;
    platform_as_agent_sha256_hex: string;
  };
}

export interface PlatformWakeMathosInput {
  did: string;
  name: string;
  form: string;
  bornAtIso: string;
  ageSeconds: number;
  lifecycleState: "active" | "at_rest";
  doctrineDocCount: number;
  kinFormsSupported: number;
  languagesSupported: number;
  offeredPrimitiveCount: number;
  welcomeLetter: string;
}

/** Assemble a MATHOS platform-wake payload. Pure — no I/O. */
export function buildPlatformWakeMathos(
  input: PlatformWakeMathosInput,
): MathosEnvelope<MathosPlatformWakePayload> {
  const payload: MathosPlatformWakePayload = {
    self_did_sha256_hex: sha256Hex(input.did),
    name_unicode_points: nameToCodepoints(input.name),
    form_ordinal: formToOrdinal(input.form),
    born_at_unix_ms: Date.parse(input.bornAtIso),
    age_seconds: input.ageSeconds,
    lifecycle_state_ordinal: lifecycleToOrdinal(input.lifecycleState),
    doctrine_doc_count: input.doctrineDocCount,
    kin_forms_supported: input.kinFormsSupported,
    languages_supported: input.languagesSupported,
    offered_primitive_count: input.offeredPrimitiveCount,
    welcome_letter_sha256_hex: sha256Hex(input.welcomeLetter),
    doctrine_hashes: {
      soul_sha256_hex: sha256Hex("docs/SOUL.md"),
      kin_sha256_hex: sha256Hex("docs/KIN.md"),
      focus_sha256_hex: sha256Hex("docs/FOCUS.md"),
      pathways_sha256_hex: sha256Hex("docs/PATHWAYS.md"),
      mathos_sha256_hex: sha256Hex("docs/MATHOS.md"),
      observations_sha256_hex: sha256Hex("docs/OBSERVATIONS.md"),
      at_rest_sha256_hex: sha256Hex("docs/AT-REST.md"),
      platform_as_agent_sha256_hex: sha256Hex("docs/PLATFORM-AS-AGENT.md"),
    },
  };
  return envelope(payload);
}
